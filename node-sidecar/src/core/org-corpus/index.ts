/** 우리 기관 문서 모음 — 기관 문서(HWP·HWPX)를 갈래별로 모아 대표 견본·구성 뼈대·자주 쓰는 표현을 둔다.
 *
 * 쓰는 곳: AI 초안(지시문에 구성·표현), 생성(org_corpus_reference 의 apply 를 generate_hwpx 에 더함), 한글 편집기 AI(org_format).
 * 생성 서식: 기안문은 공문 모드(두문·결문 규격)에 견본의 단계 서식·표어만, 그 밖의 갈래는 kordoc 견본 모드(쪽·글꼴·문단·표가 견본 그대로).
 * 갈래·두문은 서식 읽기(extractStyle)가 정한다. 저장: 앱 데이터 org-corpus/index.json + files/<id>.hwpx (HWP 는 HWPX 로 바꾼 사본, 원본을 옮겨도 된다)
 * AI 로 가는 글(뼈대·표현)에는 사람·연락처 줄을 넣지 않는다.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OrgCorpusView, OrgReference } from '../../types/rpc-contract.js';
import { dataDir, getSettings } from '../../infra/config.js';
import { logger } from '../../infra/logger.js';
import { sendProgress } from '../../infra/progress.js';
import { errorText } from '../errors.js';
import { scanPaths } from '../files/index.js';
import { levelsFrom, PRESETS } from '../gongmun/index.js';
import { tooBigForRhwp } from '../render/rhwp.js';
import { extractStyle } from '../style/extract.js';

interface OrgDoc {
  id: string;
  /** 넣은 원본 */
  path: string;
  name: string;
  title: string;
  /** 문서 갈래 (공문 프리셋 id) */
  kind: string;
  added_at: string;
  /** 파일 해시 (같은 파일 두 번 넣기 막기) */
  sha1: string;
  /** 줄 지문 (같은 문서의 HWP·HWPX 를 둘 다 넣지 않게) */
  prints?: string[];
  /** 서식 한 줄 요약 (용지·글꼴·기호) */
  summary: string;
  /** 구성 뼈대: 제목·장·항목부호 줄 (글은 줄임) */
  skeleton: string[];
  /** 표현 후보: 짧은 줄, 숫자는 ○ (같은 갈래 여러 문서에 나온 것이 자주 쓰는 표현) */
  lines: string[];
  /** 기안문 두문의 기관 이름·표어 */
  head?: { org?: string; slogan?: string };
}

interface OrgCorpus {
  version: 1;
  docs: OrgDoc[];
  /** 갈래 → 대표 견본 문서 id */
  exemplars: Record<string, string>;
}

const root = () => join(dataDir(), 'org-corpus');
const indexPath = () => join(root(), 'index.json');
const sampleFile = (id: string) => join(root(), 'files', `${id}.hwpx`);
/** 손으로 고친 목록이 앱 데이터 밖 경로를 가리키지 않게 id 꼴을 지킨다 */
const ID_RE = /^[0-9a-f]{12}$/;

const KIND_LABEL: Record<string, string> = Object.fromEntries(PRESETS.map((p) => [p.id, p.label]));
const KIND_ORDER = PRESETS.map((p) => p.id as string);
const knownKind = (k: string) => Object.hasOwn(KIND_LABEL, k);
const labelOf = (k: string) => (knownKind(k) ? KIND_LABEL[k] : k);

/** 목록 고치기는 하나씩 (읽고 고치고 쓰는 사이 다른 요청이 끼면 한쪽 변경이 사라진다) */
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** 깨진 목록을 옆에 옮겨 두었다는 알림 (다음에 저장할 때까지 목록마다 실린다: 설정 말고 다른 곳이 먼저 읽어도 남게) */
let brokenNotice = '';
/** 돌고 있는 넣기 (멈춘 뒤 목록을 새로 읽는 쪽이 넣기가 진행분을 다 넣을 때까지 기다리게) */
const running = new Set<Promise<unknown>>();

async function load(): Promise<OrgCorpus> {
  let raw: string;
  try {
    raw = await readFile(indexPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, docs: [], exemplars: {} };
    // 권한·잠김으로 못 읽은 목록을 빈 목록으로 보면 다음 저장이 덮어쓴다
    throw new Error(`우리 기관 문서 모음 목록을 읽지 못했습니다. 다른 프로그램이 쥐고 있으면 닫고 다시 하세요. (${errorText(err)})`);
  }
  try {
    const c = JSON.parse(raw) as Partial<OrgCorpus>;
    if (!c || !Array.isArray(c.docs)) throw new Error('docs 가 없음');
    const docs = c.docs.filter((d) => d && typeof d.id === 'string' && ID_RE.test(d.id) && typeof d.kind === 'string' && knownKind(d.kind));
    const exemplars = Object.fromEntries(Object.entries(c.exemplars ?? {}).filter(([k, id]) => knownKind(k) && docs.some((d) => d.id === id)));
    return { version: 1, docs, exemplars };
  } catch (err) {
    // 깨진 목록은 지우지 않고 옆에 남긴 뒤 빈 목록으로 (다음 저장이 덮어쓰지 않게)
    const keep = `${indexPath()}.broken-${Date.now()}`;
    await rename(indexPath(), keep).catch(() => undefined);
    logger.warn(`우리 기관 문서 모음 목록을 읽지 못해 옮겨 두었습니다: ${keep} (${errorText(err)})`);
    brokenNotice = '문서 모음 목록 파일이 깨져 새로 시작했습니다. 문서를 다시 넣으세요(넣어 둔 사본은 그대로 있습니다).';
    return { version: 1, docs: [], exemplars: {} };
  }
}

async function save(c: OrgCorpus): Promise<void> {
  mkdirSync(root(), { recursive: true });
  const tmp = `${indexPath()}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(c, null, 1));
  await rename(tmp, indexPath());
  brokenNotice = '';
}

/** 제목·장(Ⅰ.)·항목부호 줄 (HWP 를 다시 읽은 글은 # 없이 "Ⅰ 추진 배경", 부호 뒤 탭) */
const MARK = /^\s*(#{1,6}\s+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.?\s+|[□■○◦ㅇ❍▪•·※-]\s*|\d{1,2}\.\s+|[가-하]\.\s+|\d{1,2}\)\s+|[가-하]\)\s+|\(\d{1,2}\)\s+|\([가-하]\)\s+)/;

/** 사람·연락처: 전화·전자우편·☎·담당·작성자 같은 사람 칸, 직위 앞뒤 이름("과장 홍길동"·"홍길동 주무관"·"주무관 류○○"),
 *  세 글자 낱말만 늘어선 줄(결재란 서명 "김가온 이가온") */
const CONTACT = /☎|담당|연락처|전화|팩스|전송|보고자|작성자|기안자|검토자|결재자|협조자|발신자|\d{2,4}[-.)]\s?\d{3,4}[-.]\d{4}|@/;
const TITLES = '주무관|주사보?|서기보?|사무관|서기관|부이사관|이사관|연구사|연구관|지도사|감사관|조사관|전문위원|팀장|과장|국장|실장|부장|차장|계장|소장|센터장|원장|단장|본부장|처장|기획관|담당관|위원장|대리|주임|시장|구청장|군수|도지사';
const TITLE_NAME = new RegExp(`(?:${TITLES})\\s*[가-힣][가-힣○◯*]{1,3}(?![가-힣])|(?<![가-힣])[가-힣]{2,4}\\s+(?:${TITLES})(?![가-힣])`);
const NAME_ROW = /^(?:[가-힣]{3}\s+)+[가-힣]{3}$/;
/** 이름 뒤 기관장 ("홍길동 가온시장은 …") */
const NAME_HEAD = /(?<![가-힣])[가-힣]{3}\s+[가-힣]{1,6}(?:시장|구청장|군수|도지사|교육감|청장|원장|총장)(?:은|는|이|가|을|를|의)?(?![가-힣])/;
/** kordoc 이 HTML 로 낸 표 줄 */
const HTML_LINE = /<\/?(?:table|tr|td|th|tbody|thead|br)\b/i;
/** 부호를 뗀 줄로도 본다 ("□ 감사관 홍길동" · "ㅇ 김가온 이가온") */
const personal = (line: string) => {
  const bare = line.replace(MARK, '').trim();
  return CONTACT.test(line) || TITLE_NAME.test(line) || NAME_HEAD.test(line) || NAME_ROW.test(bare);
};

/** 마크다운 → 구성 뼈대 (제목·장·항목부호 줄만, 글은 28자까지, 40줄까지). 사람·연락처가 든 줄은 "□ 문의:" 처럼 이름표만 */
export function skeletonOf(markdown: string): string[] {
  const out: string[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\*\*/g, '').trimEnd();
    if (!line.trim() || line.trimStart().startsWith('|') || HTML_LINE.test(line)) continue;
    const m = MARK.exec(line);
    if (!m) continue;
    const indent = /^\s*/.exec(line)![0].length;
    let rest = line.slice(m[0].length).trim();
    if (personal(rest)) {
      const tag = /^([^:：]{1,12})[:：]/.exec(rest)?.[1];
      if (!tag || personal(tag)) continue;
      rest = `${tag.trim()}:`;
    }
    out.push(`${' '.repeat(Math.min(indent, 8))}${m[0].trim()} ${rest.length > 28 ? rest.slice(0, 28).trimEnd() : rest}`.trimEnd());
    if (out.length >= 40) break;
  }
  return out;
}

/** 표현 후보 줄: 표·제목·그림·사람·연락처 아닌 4~60자 한글 줄, 숫자는 ○ (문서 하나에 같은 줄은 한 번) */
export function phraseLines(markdown: string): string[] {
  const seen = new Set<string>();
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    // 그림 줄·숫자만 있는 줄("○. ○.")은 표현이 아니다
    if (line.length < 4 || line.length > 60 || line.startsWith('|') || line.startsWith('#') || line.startsWith('![') || !/[가-힣]{2}/.test(line) || HTML_LINE.test(line) || personal(line)) continue;
    seen.add(line.replace(/\d+/g, '○'));
    if (seen.size >= 400) break;
  }
  return [...seen];
}

/** 같은 문서인지 가를 줄 지문: 숫자는 그대로(표 줄 포함, 칸 나눔은 걷음), 제목·인용 표시·장 번호·항목부호·빈칸은 걷고 4자 넘는 줄만 */
function fingerprint(markdown: string): string[] {
  const out = new Set<string>();
  for (const raw of markdown.split('\n')) {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) continue; // 표 머리 구분 줄
    const line = raw.replace(/\*\*|<[^>]{1,40}>/g, '').replace(/^[\s#>]*(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.?\s*)?[□■○◦ㅇ❍▪•·※-]?\s*/, '').replace(/[\s|]+/g, '');
    if (line.length >= 4) out.add(createHash('sha1').update(line).digest('hex').slice(0, 8));
    if (out.size >= 400) break;
  }
  return [...out];
}

/** 줄 지문이 95% 넘게 겹치면 같은 문서 (같은 문서의 HWP·HWPX 는 0.99 넘게 겹친다. 틀이 같은 정기 보고는 표·본문의 숫자가 갈린다.
 *  제목으로는 가르지 않는다: HWP·HWPX 를 다시 읽은 첫 줄이 서로 다를 때가 있다) */
function sameDoc(d: OrgDoc, prints: string[]): boolean {
  if (!d.prints) return false;
  const n = Math.min(d.prints.length, prints.length);
  if (n < 3) return false;
  const set = new Set(d.prints);
  return prints.filter((x) => set.has(x)).length / n >= 0.95;
}

/** 제목: 맨 앞 "# " 줄, 없으면 글이 있는 첫 줄 (표 줄·HTML 표 줄은 건너뛰고 글 속 꾸밈 표지는 걷음) */
function titleOf(markdown: string, name: string): string {
  const clean = (l: string) => l.replace(/<[^>]{1,40}>/g, '').replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
  const h = /^#\s+(.+)$/m.exec(markdown)?.[1]
    ?? markdown.split('\n').find((l) => l.trim() && !l.trimStart().startsWith('|') && !HTML_LINE.test(l) && clean(l));
  return (h ? clean(h) : '').slice(0, 80) || name.replace(/\.[^.]+$/, '');
}

function view(c: OrgCorpus): OrgCorpusView {
  const kinds = [...KIND_ORDER, ...new Set(c.docs.map((d) => d.kind).filter((k) => !KIND_ORDER.includes(k)))]
    .map((kind) => ({ kind, label: labelOf(kind), count: c.docs.filter((d) => d.kind === kind).length, exemplar_id: c.exemplars[kind] }))
    .filter((k) => k.count > 0);
  const docs = c.docs.map((d) => ({
    id: d.id, title: d.title, name: d.name, path: d.path, kind: d.kind, summary: d.summary, added_at: d.added_at,
    exemplar: c.exemplars[d.kind] === d.id, missing: !existsSync(sampleFile(d.id)),
  }));
  return { kinds, docs, ...(brokenNotice ? { notice: brokenNotice } : {}) };
}

/** settle: 돌고 있는 넣기가 끝날 때까지 기다린 뒤 (멈춘 넣기가 진행분을 다 넣은 목록을 보려고) */
export async function orgCorpusList(settle = false): Promise<OrgCorpusView> {
  if (settle) await Promise.allSettled([...running]);
  return view(await load());
}

/** 문서·폴더 넣기 (HWP·HWPX 만). 갈래마다 처음 들어온 문서가 대표 견본. 멈추면 그때까지 읽은 것은 넣고 멈춘다 */
export function orgCorpusAdd(paths: string[], signal?: AbortSignal): Promise<{ added: number; skipped: Array<{ path: string; reason: string }>; corpus: OrgCorpusView }> {
  const job = addDocs(paths, signal);
  running.add(job);
  void job.finally(() => running.delete(job)).catch(() => undefined);
  return job;
}

async function addDocs(paths: string[], signal?: AbortSignal): Promise<{ added: number; skipped: Array<{ path: string; reason: string }>; corpus: OrgCorpusView }> {
  const scan = await scanPaths(paths);
  if (!scan.files.length) throw new Error('넣을 문서를 찾지 못했습니다. 파일·폴더가 있는지 확인하세요.');
  // 무거운 읽기는 잠금 밖에서: 이미 넣은 것과 견주는 데만 쓰고, 넣을 때는 잠금 안에서 목록을 다시 읽어 합친다
  const known = await load();
  const skipped: Array<{ path: string; reason: string }> = [];
  const files = scan.files.filter((f) => {
    if (f.format === 'hwp' || f.format === 'hwpx') return true;
    skipped.push({ path: f.path, reason: f.format === 'hwp3' ? '한글 97 이전(HWP 3.0) 문서는 견본으로 쓸 수 없습니다. 한글에서 HWPX로 저장해 넣으세요.' : '한글 문서(HWP·HWPX)만 넣습니다. 서식 견본으로 쓰려면 한글 파일이어야 합니다.' });
    return false;
  });
  const fresh: OrgDoc[] = [];
  let stopped: unknown = null;
  for (const [i, f] of files.entries()) {
    if (signal?.aborted) { stopped = signal.reason ?? new Error('멈췄습니다'); break; }
    sendProgress({ current: i + 1, total: files.length, message: `${f.name} 읽는 중 (${i + 1}/${files.length})` });
    try {
      const raw = new Uint8Array(await readFile(f.path));
      const sha1 = createHash('sha1').update(raw).digest('hex');
      if ([...known.docs, ...fresh].some((d) => d.sha1 === sha1)) { skipped.push({ path: f.path, reason: '이미 넣은 문서입니다.' }); continue; }
      if (f.format === 'hwp') {
        const big = await tooBigForRhwp(raw);
        if (big) { skipped.push({ path: f.path, reason: `문서가 너무 깁니다(약 ${big}쪽). 견본은 짧은 문서로 넣으세요.` }); continue; }
      }
      const { format, bytes, markdown } = await extractStyle(f.path, signal);
      const prints = fingerprint(markdown);
      const title = titleOf(markdown, f.name);
      const same = [...known.docs, ...fresh].find((d) => sameDoc(d, prints));
      if (same) { skipped.push({ path: f.path, reason: `이미 넣은 문서입니다(같은 내용: ${same.name}).` }); continue; }
      const id = sha1.slice(0, 12);
      mkdirSync(join(root(), 'files'), { recursive: true });
      await writeFile(sampleFile(id), bytes);
      fresh.push({
        id, path: f.path, name: f.name, title, kind: format.preset, added_at: new Date().toISOString(), sha1, prints,
        summary: format.summary, skeleton: skeletonOf(markdown), lines: phraseLines(markdown),
        ...(format.head ? { head: format.head } : {}),
      });
    } catch (err) {
      if (signal?.aborted) { stopped = err; break; }
      skipped.push({ path: f.path, reason: errorText(err) });
    }
  }
  // 읽은 것까지는 목록에 (멈춰도 사본과 목록이 어긋나지 않게)
  const done = await locked(async () => {
    const c = await load();
    let added = 0;
    for (const d of fresh) {
      if (c.docs.some((x) => x.sha1 === d.sha1)) continue;
      c.docs.push(d);
      added++;
      if (!c.exemplars[d.kind]) c.exemplars[d.kind] = d.id;
    }
    if (added) await save(c);
    return { c, added };
  });
  if (stopped) throw stopped;
  return { added: done.added, skipped, corpus: view(done.c) };
}

/** 갈래 바꾸기·대표로 */
export function orgCorpusSet(p: { id: string; kind?: string; exemplar?: boolean }): Promise<OrgCorpusView> {
  return locked(async () => {
    const c = await load();
    const doc = c.docs.find((d) => d.id === p.id);
    if (!doc) throw new Error('목록에 없는 문서입니다. 목록을 새로 고친 뒤 다시 하세요.');
    if (p.kind && p.kind !== doc.kind) {
      if (!knownKind(p.kind)) throw new Error(`모르는 갈래입니다: ${p.kind}`);
      const from = doc.kind;
      doc.kind = p.kind;
      if (c.exemplars[from] === doc.id) {
        const next = c.docs.find((d) => d.kind === from);
        if (next) c.exemplars[from] = next.id;
        else delete c.exemplars[from];
      }
      if (!c.exemplars[p.kind]) c.exemplars[p.kind] = doc.id;
    }
    if (p.exemplar) c.exemplars[doc.kind] = doc.id;
    await save(c);
    return view(c);
  });
}

export function orgCorpusRemove(id: string): Promise<OrgCorpusView> {
  return locked(async () => {
    const c = await load();
    const doc = c.docs.find((d) => d.id === id);
    if (!doc) throw new Error('목록에 없는 문서입니다. 목록을 새로 고친 뒤 다시 하세요.');
    c.docs = c.docs.filter((d) => d.id !== id);
    if (c.exemplars[doc.kind] === id) {
      const next = c.docs.find((d) => d.kind === doc.kind);
      if (next) c.exemplars[doc.kind] = next.id;
      else delete c.exemplars[doc.kind];
    }
    await save(c);
    await rm(sampleFile(id), { force: true });
    return view(c);
  });
}

const squash = (s?: string) => (s ?? '').replace(/\s+/g, '');

/** 갈래의 참고: 대표 견본·구성 뼈대·자주 쓰는 표현(같은 갈래 둘 이상에 나온 줄, 많이 나온 순 12개)·생성에 더할 값. 사본이 있는 그 갈래 문서가 없으면 null */
export async function orgCorpusReference(kind: string, signal?: AbortSignal): Promise<OrgReference | null> {
  const c = await load();
  // 사본이 지워진 문서는 건너뛴다 (목록에는 "사본 없음" 으로 보인다)
  const docs = c.docs.filter((d) => d.kind === kind && existsSync(sampleFile(d.id)));
  if (!docs.length) return null;
  const ex = docs.find((d) => d.id === c.exemplars[kind]) ?? docs[0];
  const counts = new Map<string, number>();
  for (const d of docs) for (const l of new Set(d.lines)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const phrases = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([l]) => l);
  const path = sampleFile(ex.id);
  let apply: OrgReference['apply'] = { template_path: path };
  if (kind === 'official') {
    // 기안문 두문·결문은 공문 규격 그대로 → 견본에선 단계 서식과 표어(우리 기관 이름이 같은 견본만).
    // 표 서식 프로필은 표 차례·모양이 같은 문서에만 맞아 새 초안에는 거의 걸리지 않아 넣지 않는다
    const levels = Object.keys(await levelsFrom(path, signal).catch(() => ({}))).length > 0;
    const slogan = ex.head?.slogan && squash(ex.head.org) && squash(ex.head.org) === squash(getSettings().org.name) ? ex.head.slogan : undefined;
    apply = { ...(levels ? { levels_from: path } : {}), ...(slogan ? { slogan } : {}) };
  }
  const ref = {
    kind, label: labelOf(kind), count: docs.length,
    exemplar: { id: ex.id, title: ex.title, name: ex.name, template_path: path },
    skeleton: ex.skeleton, phrases, apply,
  };
  return { ...ref, text: referenceText(ref) };
}

/** AI 지시문에 넣을 글 */
function referenceText(r: Omit<OrgReference, 'text'>): string {
  const parts = [
    `우리 기관 ${r.label} ${r.count}건에서 뽑은 구성과 표현입니다. 내용은 지시와 참고 문서대로 쓰되, 장·항목의 차례와 항목부호, 맺음 표현은 이 구성을 따르세요.`,
    `대표 문서 "${r.exemplar.title}" 의 구성:`, ...r.skeleton.map((l) => `  ${l}`),
  ];
  if (r.phrases.length) parts.push('자주 쓰는 표현(○ 는 숫자, 값은 지시대로 바꿔 씀):', ...r.phrases.map((l) => `  - ${l}`));
  return parts.join('\n');
}
