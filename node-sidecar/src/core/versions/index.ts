/** 버전 찾기·최종본 찾기 (find_versions) — 같은 문서의 여러 판(…_수정, …_최종, …_진짜최종, (2), v3, 날짜 붙은 것)을
 * 같은 폴더·하위 폴더·바로 위 폴더에서 찾아 고친 차례대로 잇는다.
 *
 * 같은 문서로 보는 기준: 이름에서 판 표시를 뗀 나머지가 닮았거나(이름 점수) 본문 지문이 겹친다(본문 점수, 4글자 조각 포함률).
 * 최종으로 보이는 것: 가장 나중에 고친 판. 이름의 '최종'이 그보다 오래됐으면 짚어 준다(사람이 가장 자주 헷갈리는 곳).
 * 원본은 읽기만 한다.
 */

import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { DocFormat, VersionEntry, VersionsResult } from '../../types/rpc-contract.js';
import { formatOf, isJunkName } from '../files/format.js';
import { textOf } from '../search/index.js';

const MAX_FILES = 600;
const MAX_PARSE = 60;
const SHINGLE = 4;
const TEXT_LIMIT = 40_000;

/** 판끼리 견줄 수 있는 갈래 (한글·워드·PDF 는 서로 내보낸 사본일 수 있어 한 무리) */
const FAMILY: Partial<Record<DocFormat, string>> = {
  hwp: 'doc', hwp3: 'doc', hwpx: 'doc', hwpml: 'doc', docx: 'doc', pdf: 'doc', xls: 'sheet', xlsx: 'sheet', pptx: 'slide',
};

/** 이름의 판 표시 — 떼어 낸 것은 markers 로 */
const MARK_WORDS = /(?:진짜\s*)*(?:최최종|최종본?|수정본?|변경|교정|검토|보완|완료|확정|제출본?|결재본?|초안|원본|사본|복사본|final|draft|copy|rev|ver)(?:\s*\d+)?/gi;
const MARK_V = /(?:^|[\s_\-.(\[])v\s*\d+(?:\.\d+)*/gi;
const MARK_DATE = /(?:20)?\d{2}[.\-_]?(?:0[1-9]|1[0-2])[.\-_]?(?:0[1-9]|[12]\d|3[01])/g;
const MARK_NUM = /\(\d+\)|[_\-\s]\d{1,2}$/g;

export function splitName(path: string): { core: string; markers: string[] } {
  let s = basename(path, extname(path)).normalize('NFC');
  const markers: string[] = [];
  for (const re of [MARK_WORDS, MARK_V, MARK_DATE, MARK_NUM]) {
    s = s.replace(re, (m) => { markers.push(m.replace(/^[\s_\-.(\[]+/, '').trim()); return ' '; });
  }
  return { core: s.toLowerCase().replace(/[\s_\-.()[\]{}~!@#$%^&*+=,]+/g, ''), markers: markers.filter(Boolean) };
}

/** 글자 두 개 조각 다이스 계수 */
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const x = grams(a);
  const y = grams(b);
  let hit = 0;
  for (const [g, n] of x) hit += Math.min(n, y.get(g) ?? 0);
  const total = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * hit) / total;
}

interface Body { shingles: Set<string>; lines: Set<string>; chars: number }

async function bodyOf(path: string, signal?: AbortSignal): Promise<Body | null> {
  try {
    const e = await textOf(path, signal);
    const text = e.chunks.map((c) => c.text).join('\n');
    const flat = text.replace(/[#*|>\-\s`_]/g, '').slice(0, TEXT_LIMIT);
    const shingles = new Set<string>();
    for (let i = 0; i + SHINGLE <= flat.length; i++) shingles.add(flat.slice(i, i + SHINGLE));
    const lines = new Set(text.split('\n').map((l) => l.replace(/[#*|>\s`_-]/g, '')).filter((l) => l.length >= 4));
    return { shingles, lines, chars: e.chars };
  } catch {
    return null;
  }
}

/** 짧은 쪽 기준 포함률 — 문서가 자라도(판마다 내용이 붙어도) 같은 문서로 본다 */
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let hit = 0;
  for (const g of s) if (l.has(g)) hit++;
  return hit / s.size;
}

async function listCandidates(target: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (out.length >= MAX_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (isJunkName(e.name) || e.isSymbolicLink() || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0) await walk(p, depth - 1); } else if (e.isFile() && out.length < MAX_FILES) out.push(p);
    }
  };
  const here = dirname(target);
  await walk(here, 2);
  const up = dirname(here);
  if (up !== here) await walk(up, 0);
  return [...new Set(out.map((p) => resolve(p)))];
}

const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const isFinal = (m: string[]) => m.some((x) => /최종|final/i.test(x));

export async function findVersions(path: string, signal?: AbortSignal): Promise<VersionsResult> {
  const target = resolve(path);
  const family = FAMILY[formatOf(target)];
  if (!family) throw new Error('버전을 찾을 수 있는 문서가 아닙니다. 한글·워드·PDF·엑셀·파워포인트 파일을 고르세요.');
  const all = await listCandidates(target);
  const me = splitName(target);
  const myBody = await bodyOf(target, signal);

  // 이름이 닮은 것부터, 같은 폴더의 같은 갈래는 이름이 달라도(통째로 이름을 바꾼 판) 최근 것 몇 개를 본문으로 견준다
  // 같은 폴더의 똑같은 이름(확장자만 다름)은 한 판을 다른 형식으로 저장한 것이라 판으로 세지 않는다
  // (실측: 받은 공문 HWPX 의 카드가 짝 PDF 를 "최종으로 보이는 것" 으로 짚음)
  const stemOf = (p: string) => join(dirname(p), basename(p, extname(p))).normalize('NFC').toLowerCase();
  const myStem = stemOf(target);
  const same = all.filter((p) => p !== target && FAMILY[formatOf(p)] === family && stemOf(p) !== myStem);
  const scored = await Promise.all(same.map(async (p) => ({ p, st: await stat(p), name: dice(me.core, splitName(p).core) })));
  scored.sort((a, b) => b.name - a.name || b.st.mtimeMs - a.st.mtimeMs);
  const toRead = scored.filter((c) => c.name >= 0.5 || dirname(c.p) === dirname(target)).slice(0, MAX_PARSE);

  const versions: Array<VersionEntry & { body: Body | null }> = [];
  const tst = await stat(target);
  versions.push({ path: target, name: basename(target), format: formatOf(target), size: tst.size, modified: tst.mtimeMs, chars: myBody?.chars ?? 0, name_score: 1, text_score: 1, markers: me.markers, target: true, body: myBody });
  for (const c of toRead) {
    signal?.throwIfAborted();
    const body = await bodyOf(c.p, signal);
    const text = myBody && body ? overlap(myBody.shingles, body.shingles) : 0;
    const sameCore = !!me.core && me.core === splitName(c.p).core;
    if (!(text >= 0.5 || (c.name >= 0.8 && text >= 0.15) || (sameCore && (text >= 0.1 || !myBody || !body)))) continue;
    versions.push({ path: c.p, name: basename(c.p), format: formatOf(c.p), size: c.st.size, modified: c.st.mtimeMs, chars: body?.chars ?? 0, name_score: Math.round(c.name * 100) / 100, text_score: Math.round(text * 100) / 100, markers: splitName(c.p).markers, target: false, body });
  }

  versions.sort((a, b) => a.modified - b.modified);
  for (let i = 1; i < versions.length; i++) {
    const prev = versions[i - 1].body;
    const cur = versions[i].body;
    if (!prev || !cur) continue;
    let added = 0; let removed = 0;
    for (const l of cur.lines) if (!prev.lines.has(l)) added++;
    for (const l of prev.lines) if (!cur.lines.has(l)) removed++;
    versions[i].change = { added, removed };
  }

  const latest = versions[versions.length - 1];
  const reasons = [`가장 나중에 고쳤습니다 (${day(latest.modified)})`];
  if (isFinal(latest.markers)) reasons.push('이름에 "최종"이 붙어 있습니다');
  if (versions.length > 1 && latest.chars >= Math.max(...versions.map((v) => v.chars))) reasons.push('내용이 가장 많습니다');

  const notes: string[] = [];
  const finals = versions.filter((v) => v !== latest && isFinal(v.markers));
  if (finals.length) notes.push(`이름에 "최종"이 붙은 ${finals.map((v) => v.name).join(', ')} 보다 더 나중에 고친 판이 있습니다: ${latest.name}`);
  const tIdx = versions.findIndex((v) => v.target);
  if (tIdx < versions.length - 1) notes.push(`고른 문서보다 나중에 고친 판이 ${versions.length - 1 - tIdx}개 있습니다.`);
  if (latest.change && latest.change.removed > latest.change.added * 2 && latest.change.removed >= 5) notes.push(`가장 최근 판은 바로 앞 판보다 ${latest.change.removed}줄이 빠졌습니다. 지운 것이 맞는지 확인하세요.`);
  if (latest.format === 'pdf' && versions.some((v) => v.format !== 'pdf')) notes.push('가장 최근 판이 PDF 입니다. 고칠 땐 한글 원본을 쓰세요.');
  if (versions.length === 1) notes.push('같은 문서의 다른 판을 찾지 못했습니다.');

  return {
    target,
    versions: versions.map(({ body: _b, ...v }) => v),
    latest: latest.path,
    reasons,
    notes,
    searched: same.length + 1,
  };
}
