/** 법령 근거 확인 — 글·문서 속 「법령명」 제N조 인용을 찾아 법제처 현행 법령과 대조 (law_check·law_test)
 *
 * 폐쇄망 모드·아이디(OC) 없음이면 인용 찾기만 한다(checked:false). 법제처 통신은 drf.ts(net-guard 관문 경유).
 * 상태: ok(법령·조문 있음) · article_missing(조문 없음·삭제된 조문) · renamed(옛 이름, current_name=현행 이름)
 *       · not_found(현행 법령에 없음, 비슷한 이름이 있으면 current_name) · unchecked(묻지 못함·자치법규)
 */

import type { LawCheckResult, LawCitation } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { OfflineBlockedError } from '../../infra/net-guard.js';
import { sendProgress } from '../../infra/progress.js';
import { parseDoc } from '../converter/index.js';
import { cacheSave } from './cache.js';
import { findCitations, normName, type FoundCitation } from './cite.js';
import { LawAuthError, LawNetError, articleKey, lawArticles, searchLaws, type ArticleInfo, type DrfOptions, type LawRow } from './drf.js';

export const NOTE_OFFLINE = '폐쇄망 모드라 법제처에 묻지 않았습니다. 인용만 찾았습니다.';
export const NOTE_NO_OC = '설정 › 법령 확인에서 법제처 Open API 아이디(OC)를 넣으면 현행 법령과 대조합니다.';
const NOTE_NONE = '「법령명」 제N조 꼴의 법령 인용을 찾지 못했습니다.';
const NOTE_AUTH = '법제처가 아이디(OC)를 확인하지 못해 대조하지 않았습니다. 설정 › 법령 확인에서 아이디를 고치고 연결 확인을 눌러 보세요.';
const NOTE_NET = '법제처에 연결하지 못한 인용은 확인하지 못했습니다. 인터넷 연결을 확인하고 다시 확인하세요.';
const NOTE_LOCAL = '조례 같은 자치법규는 법제처 현행 법령 목록에 없어 대조하지 않았습니다.';
/** 문서 하나에서 법제처에 물을 법령 수 상한 */
const MAX_LAWS = 30;
const NOTE_LIMIT = `법령이 많아 앞의 ${MAX_LAWS}개만 대조했습니다.`;

const ERR_AUTH = '법제처가 아이디(OC)를 확인하지 못했습니다. open.law.go.kr에 신청한 아이디가 맞는지, 신청할 때 등록한 IP 주소·도메인이 이 PC와 맞는지 확인하세요.';
const ERR_NET = '법제처에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시험하세요.';

type Options = Pick<DrfOptions, 'base' | 'timeoutMs'>;

type Resolution =
  | { kind: 'found'; name: string; row: LawRow; arts?: Record<string, ArticleInfo> | null }
  | { kind: 'renamed'; name: string; current: string }
  | { kind: 'missing'; name: string; suggestion?: string }
  | { kind: 'unchecked'; name: string; reason: 'local' | 'net' | 'limit' };

/** 자치법규는 target=law 에 없다: 조례·조례 시행규칙, 또는 ○○시·군·구·도로 시작하는 이름(못 찾았을 때만) */
const isOrdinance = (name: string) => /조례(?: ?시행규칙)?$/.test(name);
const looksLocal = (name: string) => /^[가-힣]{1,6}(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구) /.test(name);
const SUB = /\s*(?:시행령|시행규칙)$/;

/** 법제처 법령 화면 주소 (law.go.kr/법령/이름/제N조 → 현행 판으로 열린다) */
function lawUrl(name: string, jo?: number, branch?: number): string {
  return `https://www.law.go.kr/법령/${name.replace(/\s+/g, '')}${jo ? `/제${jo}조${branch ? `의${branch}` : ''}` : ''}`;
}

/** 현행 행 중 이름(또는 약칭)이 정확히 같은 것 — 띄어쓰기·가운뎃점은 무시 */
function exactRow(rows: LawRow[], name: string): LawRow | undefined {
  const n = normName(name);
  return rows.find((r) => r.current && normName(r.name) === n) ?? rows.find((r) => r.current && r.abbr !== '' && normName(r.abbr) === n);
}

/** 글자 둘씩 겹침(Dice) — 0~1 */
function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const x = grams(normName(a));
  const y = grams(normName(b));
  let inter = 0;
  let total = 0;
  for (const [g, c] of x) { inter += Math.min(c, y.get(g) ?? 0); total += c; }
  for (const c of y.values()) total += c;
  return total ? (2 * inter) / total : 0;
}

function closest(name: string, rows: LawRow[]): string | undefined {
  let best: string | undefined;
  let score = 0.5;
  for (const r of rows) {
    const s = r.current ? similarity(name, r.name) : 0;
    if (s > score) { score = s; best = r.name; }
  }
  return best;
}

/** 확인 안 한 인용의 주소 — 이름이 확실할 때만(따옴표 없는 이름은 앞 어절이 섞였을 수 있다), 자치법규는 빼고 */
const uncheckedUrl = (f: FoundCitation) => (f.names.length === 1 && !isOrdinance(f.names[0]) ? { url: lawUrl(f.names[0], f.jo, f.branch) } : {});

function uncheckedAll(found: FoundCitation[], note: string): LawCheckResult {
  return {
    checked: false,
    note,
    citations: found.map((f) => ({
      text: f.texts[0],
      law: f.names[0],
      ...(f.article ? { article: f.article } : {}),
      status: 'unchecked' as const,
      ...uncheckedUrl(f),
    })),
  };
}

async function readText(p: { text?: string; path?: string }, signal?: AbortSignal): Promise<string> {
  if (p.text !== undefined) return p.text;
  if (!p.path) throw new Error('확인할 글이나 파일을 넣으세요.');
  return (await parseDoc(p.path, { images: false, ocr: 'off', signal })).markdown;
}

export async function lawCheck(p: { text?: string; path?: string }, signal?: AbortSignal, opts: Options = {}): Promise<LawCheckResult> {
  const found = findCitations(await readText(p, signal));
  if (!found.length) return { citations: [], checked: false, note: NOTE_NONE };
  const s = getSettings();
  if (s.privacy.offline) return uncheckedAll(found, NOTE_OFFLINE);
  const oc = s.law.oc.trim();
  if (!oc) return uncheckedAll(found, NOTE_NO_OC);
  const o: DrfOptions = { ...opts, oc, signal };

  let asked = 0;
  let netFails = 0;
  const resolve = async (names: string[], needArticles: boolean): Promise<Resolution> => {
    const first = names[0];
    if (isOrdinance(first)) return { kind: 'unchecked', name: first, reason: 'local' };
    if (asked >= MAX_LAWS) return { kind: 'unchecked', name: first, reason: 'limit' };
    if (netFails >= 2) return { kind: 'unchecked', name: first, reason: 'net' };
    asked++;
    try {
      const seen: LawRow[] = [];
      let hit: { name: string; row: LawRow } | undefined;
      for (const name of names) {
        const rows = await searchLaws('law', name, o);
        const row = exactRow(rows, name);
        if (row) { hit = { name, row }; break; }
        seen.push(...rows);
      }
      netFails = 0;
      if (hit) {
        if (!needArticles) return { kind: 'found', ...hit };
        try {
          return { kind: 'found', ...hit, arts: await lawArticles(hit.row.mst, o) };
        } catch (err) {
          if (!(err instanceof LawNetError)) throw err;
          netFails++;
          return { kind: 'found', ...hit, arts: null };
        }
      }
      // 옛 이름이면 eflaw 검색이 같은 법령ID 의 현행 행(바뀐 이름)을 함께 준다
      const n = normName(first);
      const hist = await searchLaws('eflaw', first, o);
      const ids = new Set(hist.filter((r) => normName(r.name) === n).map((r) => r.id));
      const now = hist.find((r) => r.current && ids.has(r.id) && normName(r.name) !== n);
      if (now) return { kind: 'renamed', name: first, current: now.name };
      if (looksLocal(first)) return { kind: 'unchecked', name: first, reason: 'local' };
      if (!seen.length && SUB.test(first)) seen.push(...(await searchLaws('law', first.replace(SUB, ''), o)));
      return { kind: 'missing', name: first, suggestion: closest(first, seen) };
    } catch (err) {
      if (!(err instanceof LawNetError)) throw err;
      netFails++;
      return { kind: 'unchecked', name: first, reason: 'net' };
    }
  };

  // 같은 법령명(후보 묶음)은 한 번만 묻는다
  const keyOf = (f: FoundCitation) => f.names.map(normName).join('|');
  const groups = new Map<string, FoundCitation[]>();
  for (const f of found) groups.set(keyOf(f), [...(groups.get(keyOf(f)) ?? []), f]);
  const done = new Map<string, Resolution>();
  try {
    let i = 0;
    for (const [key, fs] of groups) {
      sendProgress({ current: ++i, total: groups.size, message: `법제처 현행 법령과 대조하는 중 (${i}/${groups.size})` });
      done.set(key, await resolve(fs[0].names, fs.some((f) => f.jo)));
    }
  } catch (err) {
    if (err instanceof LawAuthError) return uncheckedAll(found, NOTE_AUTH);
    if (err instanceof OfflineBlockedError) return uncheckedAll(found, NOTE_OFFLINE);
    throw err;
  } finally {
    await cacheSave();
  }

  const reasons = new Set<string>();
  let checked = false;
  const rows = found.map((f): { law: string; c: LawCitation } => {
    const r = done.get(keyOf(f))!;
    const at = Math.max(0, f.names.indexOf(r.name));
    const base = { text: f.texts[at], law: r.name, ...(f.article ? { article: f.article } : {}) };
    if (r.kind === 'unchecked') {
      reasons.add(r.reason);
      return { law: r.name, c: { ...base, status: 'unchecked', ...(r.reason === 'local' ? {} : uncheckedUrl(f)) } };
    }
    checked = true;
    if (r.kind === 'renamed') return { law: r.current, c: { ...base, status: 'renamed', current_name: r.current, url: lawUrl(r.current) } };
    if (r.kind === 'missing') return { law: r.name, c: { ...base, status: 'not_found', ...(r.suggestion ? { current_name: r.suggestion } : {}) } };
    const law = r.row.name;
    if (!f.jo) return { law, c: { ...base, status: 'ok', url: lawUrl(law) } };
    if (r.arts === null) {
      reasons.add('net');
      return { law, c: { ...base, status: 'unchecked', url: lawUrl(law, f.jo, f.branch) } };
    }
    const a = r.arts?.[articleKey(f.jo, f.branch)];
    if (!a || a.deleted) return { law, c: { ...base, status: 'article_missing', ...(a ? { article_text: a.text } : {}), url: lawUrl(law) } };
    return { law, c: { ...base, status: 'ok', ...(a.title ? { article_title: a.title } : {}), article_text: a.text, url: lawUrl(law, f.jo, f.branch) } };
  });

  // 서로 다르게 적었어도 같은 법령·조문이면 한 번만, 조문을 인용한 법령의 "법령만 인용"은 뺀다
  const withArticle = new Set(rows.filter((x) => x.c.article).map((x) => normName(x.law)));
  const seen = new Set<string>();
  const citations = rows.filter((x) => {
    const key = `${normName(x.law)}|${x.c.article ?? ''}`;
    if ((!x.c.article && withArticle.has(normName(x.law))) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((x) => x.c);

  const notes = [
    ...(reasons.has('net') ? [NOTE_NET] : []),
    ...(reasons.has('local') ? [NOTE_LOCAL] : []),
    ...(reasons.has('limit') ? [NOTE_LIMIT] : []),
  ];
  return { citations, checked, ...(notes.length ? { note: notes.join(' ') } : {}) };
}

/** 연결 확인 — 설정의 OC 로 "민법"을 검색해 본다 */
export async function lawTest(signal?: AbortSignal, opts: Options = {}): Promise<{ ok: boolean; error?: string }> {
  const s = getSettings();
  if (s.privacy.offline) return { ok: false, error: '폐쇄망 모드라 법제처에 연결하지 않았습니다. 인터넷 PC에서 설정 › 보안의 폐쇄망 모드를 끄고 시험하세요.' };
  const oc = s.law.oc.trim();
  if (!oc) return { ok: false, error: '법제처 Open API 아이디(OC)를 넣고 저장한 뒤 시험하세요.' };
  try {
    const rows = await searchLaws('law', '민법', { ...opts, oc, signal, fresh: true });
    return exactRow(rows, '민법') ? { ok: true } : { ok: false, error: '법제처 응답에서 민법을 찾지 못했습니다. 잠시 뒤 다시 시험하세요.' };
  } catch (err) {
    if (err instanceof LawAuthError) return { ok: false, error: ERR_AUTH };
    if (err instanceof LawNetError) return { ok: false, error: ERR_NET };
    if (err instanceof OfflineBlockedError) return { ok: false, error: err.message };
    throw err;
  } finally {
    await cacheSave();
  }
}
