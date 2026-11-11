/** 문서 수합 — 부서 명단 읽기·제출물의 부서 맞추기
 *
 * 이름 비교는 띄어쓰기·가운뎃점·괄호를 지우고 한다. 끝의 과·팀·동 같은 말을 뗀 줄기로도 찾는다(총무과 ↔ 총무팀 ↔ 총무).
 * 줄기 비교는 파일 이름과 부서 칸에서만 한다. 본문에는 "가온시"처럼 줄기(가온동 → 가온)와 겹치는 말이 많아서,
 * 본문은 온이름이나 "줄기+과·팀·동·실" 꼴만 본다.
 */

import { basename, extname } from 'node:path';
import { parseDoc, readTextFile } from '../converter/index.js';
import { parseCsv } from '../excel/csv.js';
import { tableGrid } from '../excel/index.js';
import { formatOf } from '../files/format.js';

const SUFFIX = /(사업소|센터|담당관|과|팀|동|실|국|단|읍|면)$/;
const DEPT_TOKEN = /(사업소|센터|담당관|과|팀|동|실|국)$/;

export const norm = (s: string) => s.normalize('NFC').replace(/[\s·・.,:()[\]「」『』<>]/g, '');

/** 끝말(과·팀·동 등)을 뗀 줄기 — 두 글자보다 짧아지면 온이름 */
export function deptStem(name: string): string {
  const n = norm(name);
  const s = n.replace(SUFFIX, '');
  return s.length >= 2 ? s : n;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 파일 이름에서 부서 이름 뒤에 띄우지 않고 흔히 붙여 쓰는 말 */
const AFTER_DEPT = /^(?:주민센터|행정복지센터|제출|자료|취합|회신|작성|수정|최종|검토|확인|요청|보고|현황|결과|의견|답변|송부|명단|조사|수요)/;

/** 명단 머리말·번호 줄로 쓰이는 말 */
const ROSTER_HEADER = /^(부서|부서명|과|과명|팀|팀명|소속|기관|기관명|동|동명|연번|번호|순번|명단|부서명단|구분|비고)$/;

/** 붙여 넣은 글 → 부서 이름 (줄·쉼표·탭으로 나눔, 앞 번호·괄호 설명은 뗀다) */
export function rosterFromText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\n\r,，;\t、]+/)) {
    const name = raw
      .replace(/^\s*(?:[-*•○□◦·]|\d+[.)]|\(\d+\)|[가-하][.)])\s*/, '')
      .replace(/\(.*?\)|（.*?）/g, '')
      .trim();
    const k = norm(name);
    if (!k || k.length > 30 || /^\d+$/.test(k) || ROSTER_HEADER.test(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(name.replace(/\s+/g, ' '));
  }
  return out.slice(0, 300);
}

/** 표 격자 → 부서 열 (머리에 부서·과·팀·소속이 든 열, 없으면 글이 가장 많은 첫 열) */
function rosterFromGrid(grid: string[][]): string[] {
  const rows = grid.filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return [];
  const head = rows[0].map((c) => norm(c));
  let col = head.findIndex((h) => /부서|과명|팀명|소속|기관|동명/.test(h));
  let body = rows.slice(1);
  if (col < 0) {
    const cols = Math.max(...rows.map((r) => r.length));
    const texty = (c: number) => rows.filter((r) => /[가-힣]/.test(r[c] ?? '') && !/^\d+$/.test(norm(r[c] ?? ''))).length;
    col = Array.from({ length: cols }, (_, c) => c).sort((a, b) => texty(b) - texty(a) || a - b)[0];
    body = rows;
  }
  return rosterFromText(body.map((r) => r[col] ?? '').join('\n'));
}

/** 명단 파일 → 부서 이름 (엑셀·CSV 는 부서 열, 한글·워드·PDF 는 첫 표의 부서 열이나 줄마다 하나) */
export async function rosterFromFile(path: string, signal?: AbortSignal): Promise<string[]> {
  const fmt = formatOf(path);
  if (fmt === 'csv') return rosterFromGrid(parseCsv(await readTextFile(path)));
  if (fmt === 'txt' || fmt === 'md') return rosterFromText(await readTextFile(path));
  const r = await parseDoc(path, { images: false, ocr: 'off', signal });
  const table = r.blocks.find((b) => b.type === 'table' && b.table && b.table.rows >= 2)?.table;
  if (table) {
    const names = rosterFromGrid(tableGrid(table));
    if (names.length) return names;
  }
  return rosterFromText(r.markdown.replace(/^#+\s*/gm, '').replace(/\|/g, '\n'));
}

/** 파일 이름에서 부서처럼 생긴 토막 (명단이 없을 때) */
function deptFromFileName(path: string): string {
  const tokens = basename(path, extname(path)).normalize('NFC').split(/[_\-\s()[\]]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.length >= 2 && t.length <= 12 && DEPT_TOKEN.test(t) && /[가-힣]/.test(t)) return t;
  }
  return '';
}

export interface DeptHints {
  path: string;
  /** 부서·소속 칸 값 */
  values: string[];
  /** 본문 글 (앞부분만 봐도 된다) */
  text: string;
}

/** 제출물 하나의 부서. roster 가 있으면 명단 이름으로(in_roster), 없거나 못 찾으면 부서 칸·파일 이름에서 짐작 */
export function matchDept(roster: string[], h: DeptHints): { dept: string; in_roster: boolean } {
  const keys = roster.map((name) => ({ name, full: norm(name), stem: deptStem(name) }));
  if (keys.length) {
    // 1) 부서 칸 값: 온이름 또는 줄기가 같다
    for (const v of h.values) {
      const n = norm(v);
      if (!n) continue;
      const hit = keys.find((k) => k.full === n) ?? keys.find((k) => k.stem === deptStem(v));
      if (hit) return { dept: hit.name, in_roster: true };
    }
    // 2) 파일 이름: 온이름이 든 것 중 가장 긴 것, 없으면 줄기 (같은 길이면 뒤에 나온 것: 서식 이름_부서 꼴)
    // 줄기(총무과의 "총무")는 파일 이름의 토막 하나가 그 줄기일 때만 맞춘다. 이름 어디에든 들어 있으면 맞는 것으로 보면
    // "교육수요조사_최종"이 조사과로, "홍보계획_제출"이 홍보과로 잡혀 그 부서가 미제출 목록에서 빠진다
    const tokens = basename(h.path, extname(h.path)).normalize('NFC').split(/[\s_\-.,()[\]{}·~+]+/).filter(Boolean);
    const stemAt = (stem: string) => tokens.map((t) => norm(t) === stem || deptStem(t) === stem).lastIndexOf(true);
    const byStem = keys
      .map((k) => ({ k, at: k.stem.length >= 2 ? stemAt(k.stem) : -1 }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => b.k.stem.length - a.k.stem.length || b.at - a.at)[0]?.k;
    // 온이름도 다른 낱말의 앞부분이면 그 부서가 아니다 ("교육과정 수요조사" 의 "교육과").
    // 띄어쓰기를 지우기 전 이름에서 본다: 뒤가 띄어쓰기·구분 글자·끝이거나("주민자치 지원팀 제출자료"), 부서 이름 뒤에 흔히 붙여 쓰는 말이
    // 이어질 때("총무과제출자료"·"구의제1동주민센터")만 맞춘다. 돌려주는 자리는 띄어쓰기를 지운 이름 기준(가장 뒤의 것)
    const raw = basename(h.path, extname(h.path)).normalize('NFC');
    const fullAt = (full: string) => {
      const re = new RegExp([...full].map(escapeRe).join('[\\s·・.,:()\\[\\]「」『』<>]*'), 'g');
      let best = -1;
      for (const m of raw.matchAll(re)) {
        const after = raw.slice(m.index + m[0].length);
        if (!/^[가-힣]/.test(after) || AFTER_DEPT.test(norm(after))) best = norm(raw.slice(0, m.index)).length;
      }
      return best;
    };
    const byFull = keys
      .map((k) => ({ k, at: k.full.length >= 2 ? fullAt(k.full) : -1 }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => b.k.full.length - a.k.full.length || b.at - a.at)[0];
    // 온이름과 줄기 토막이 서로 다른 부서를 가리키면 뒤에 나온 쪽 (서식 이름_부서 꼴: "총무과 요청자료_기획예산")
    const stemPos = byStem ? norm(tokens.slice(0, stemAt(byStem.stem)).join('')).length : -1;
    const byFile = byFull && byStem && byFull.k !== byStem ? (stemPos > byFull.at ? byStem : byFull.k) : byFull?.k ?? byStem;
    if (byFile) return { dept: byFile.name, in_roster: true };
    // 3) 본문: 온이름 또는 "줄기+과·팀·동·실" 이 가장 먼저 나오는 부서
    const text = norm(h.text.slice(0, 4000));
    const found = keys
      .map((k) => {
        const m = new RegExp(`${escapeRe(k.stem)}(?:과|팀|동|실)`).exec(text);
        const at = [text.indexOf(k.full), m ? m.index : -1].filter((x) => x >= 0);
        return { k, at: at.length ? Math.min(...at) : -1 };
      })
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at || b.k.full.length - a.k.full.length)[0];
    if (found) return { dept: found.k.name, in_roster: true };
  }
  const guess = h.values.map((v) => v.trim()).find((v) => v && v.length <= 20) ?? deptFromFileName(h.path);
  return { dept: guess, in_roster: false };
}
