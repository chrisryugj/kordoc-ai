/** 법제처 국가법령정보 공동활용 Open API(DRF) — 현행 법령 검색·조문 목록
 *
 * 실측(2026-10):
 * - 검색(lawSearch)은 띄어쓰기를 무시하고 약칭까지 부분 일치한다(민법 → 난민법·북한이탈주민법도) → 이름 비교는 여기서.
 * - 아이디(OC) 오류도 HTTP 200 + {"result":"사용자 정보 검증에 실패하였습니다.", "msg": ...}, target 오타는 200 + 빈 본문.
 * - target=law 는 현행만, 조례(자치법규)는 없다. MST(법령일련번호)는 개정마다 바뀐다 → 고정하지 않고 캐시도 24시간.
 * - eflaw 검색은 옛 이름으로도 그 법령ID의 현행 행(바뀐 이름)을 함께 준다 → 이름 바뀐 법령 찾기.
 * - 시행일 판: lawSearch target=eflaw 에 efYd=시작~끝(YYYYMMDD)·sort=efdes, 본문은 lawService target=eflaw 에 MST + efYd(그 판의 시행일자).
 *   ID 만 주면 efYd 를 무시하고 현행을 준다(open.law.go.kr 안내서).
 * OC 는 주소에만 싣고 로그·오류 문장에는 남기지 않는다.
 */

import { assertAllowed } from '../../infra/net-guard.js';
import { logger } from '../../infra/logger.js';
import { cacheGet, cacheSet } from './cache.js';
import { INTERPUNCT, normName } from './cite.js';
import { list, parseArticle, str, type ArticleInfo } from './article.js';

export type { ArticleInfo } from './article.js';

export const DRF_BASE = 'https://www.law.go.kr/DRF/';

export interface DrfOptions {
  oc: string;
  signal?: AbortSignal;
  /** 시험용 — 가짜 서버 주소·짧은 시간 초과 */
  base?: string;
  timeoutMs?: number;
  /** 캐시를 건너뛰고 새로 묻기 (연결 확인) */
  fresh?: boolean;
}

/** 법제처가 아이디(OC)를 확인하지 못함 */
export class LawAuthError extends Error {}
/** 연결 실패·시간 초과·알 수 없는 응답 */
export class LawNetError extends Error {}

export interface LawRow {
  name: string;
  /** 약칭 (없으면 빈 문자열) */
  abbr: string;
  mst: string;
  id: string;
  current: boolean;
  /** 시행일자 YYYYMMDD (모르면 빈 문자열) */
  ef: string;
}


/** 요청 사이 간격 — 문서 하나에 법령 수십 개를 물어도 법제처에 몰아치지 않게 */
const GAP_MS = 150;
const TIMEOUT_MS = 10_000;
let lastAt = 0;

type Obj = Record<string, unknown>;

async function drfGet(path: 'lawSearch.do' | 'lawService.do', params: Record<string, string>, o: DrfOptions): Promise<Obj> {
  const url = new URL(path, o.base ?? DRF_BASE);
  url.searchParams.set('OC', o.oc);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('type', 'JSON');
  await assertAllowed(url.href);

  const wait = lastAt + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  o.signal?.throwIfAborted();
  lastAt = Date.now();

  const timeout = AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS);
  let body: string;
  try {
    const res = await fetch(url, { signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout });
    body = await res.text();
    if (!res.ok) throw new LawNetError(`HTTP ${res.status}`);
  } catch (err) {
    o.signal?.throwIfAborted();
    const e = err instanceof LawNetError ? err : new LawNetError(timeout.aborted ? '시간 초과' : '연결 실패');
    logger.warn(`[law] ${path} ${params.target}: ${e.message}`);
    throw e;
  }
  if (!body.trim()) throw new LawNetError('빈 응답');
  let j: Obj;
  try {
    j = JSON.parse(body) as Obj;
  } catch {
    throw new LawNetError('JSON이 아닌 응답');
  }
  if (typeof j.result === 'string' && !j.LawSearch && !j['법령']) {
    if (/검증에 실패/.test(j.result)) throw new LawAuthError(j.result);
    throw new LawNetError(j.result);
  }
  return j;
}

/** 법령 검색 — target=law 는 현행만, eflaw 는 연혁·시행예정까지.
 *  at.until(YYYYMMDD) 을 주면 eflaw 에서 그날까지 시행된 판만 시행일 늦은 순으로 (efYd 범위 + sort=efdes), at.lid 는 법령ID 로 좁히기(LID) */
export async function searchLaws(target: 'law' | 'eflaw', query: string, o: DrfOptions, at?: { until: string; lid?: string }): Promise<LawRow[]> {
  const q = query.replace(INTERPUNCT, 'ㆍ');
  const key = `search2:${target}:${normName(q)}${at ? `:${at.until}:${at.lid ?? ''}` : ''}`;
  const hit = o.fresh ? undefined : cacheGet<LawRow[]>(key);
  if (hit) return hit;
  const params: Record<string, string> = { target, ...(q ? { query: q } : {}), display: '100' };
  if (at) Object.assign(params, { efYd: `19480101~${at.until}`, sort: 'efdes', ...(at.lid ? { LID: at.lid } : {}) });
  const j = await drfGet('lawSearch.do', params, o);
  const ls = j.LawSearch as Obj | undefined;
  if (!ls || typeof ls !== 'object') throw new LawNetError('검색 응답 모양이 다름');
  const rows = list(ls.law)
    .map((r) => ({ name: str(r['법령명한글']), abbr: str(r['법령약칭명']), mst: str(r['법령일련번호']), id: str(r['법령ID']), current: str(r['현행연혁코드']) === '현행', ef: str(r['시행일자']).replace(/\D/g, '') }))
    .filter((r) => r.name && r.mst);
  cacheSet(key, rows);
  return rows;
}

export const articleKey = (jo: number, branch = 0) => (branch ? `${jo}의${branch}` : String(jo));

/** 법령 한 판의 조문 목록 — 키는 articleKey (17, 7의2).
 *  at 이 없으면 현행(target=law, MST), 있으면 그 시행일 판(target=eflaw, MST + efYd). */
export async function lawArticles(mst: string, o: DrfOptions, at?: { efYd: string }): Promise<Record<string, ArticleInfo>> {
  const key = at ? `art2:ef:${mst}:${at.efYd}` : `art2:${mst}`;
  const hit = cacheGet<Record<string, ArticleInfo>>(key);
  if (hit) return hit;
  const j = await drfGet('lawService.do', at ? { target: 'eflaw', MST: mst, efYd: at.efYd } : { target: 'law', MST: mst }, o);
  const law = j['법령'] as Obj | undefined;
  if (!law || typeof law !== 'object') throw new LawNetError('조문 응답 모양이 다름');
  const arts: Record<string, ArticleInfo> = {};
  for (const u of list((law['조문'] as Obj | undefined)?.['조문단위'])) {
    if (u['조문여부'] !== '조문') continue;
    const jo = parseInt(str(u['조문번호']), 10);
    if (!jo) continue;
    const k = articleKey(jo, parseInt(str(u['조문가지번호']), 10) || 0);
    if (arts[k]) continue;
    arts[k] = parseArticle(u);
  }
  cacheSet(key, arts);
  return arts;
}
