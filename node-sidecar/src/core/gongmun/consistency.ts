/** 결재 전 점검의 엔진 검사 (AI 없이) — 날짜·요일, 표 합계, "끝."·붙임 표시, 채우지 않은 자리
 *
 * kordoc 표기 검사가 보지 않는 것만 더한다:
 * - 요일: kordoc WEEKDAY_MISMATCH 는 "2026. 11. 5.(목)" 꼴만 본다 → "2026년 11월 5일(목)"·연도 없는 "11. 5.(목)"(문서 안 연도가 하나일 때)
 * - 표 합계: 합계·소계·계·총계 행(또는 열)과 위 칸들의 합
 * - "끝." 표시: 한글·PDF 를 파싱한 글은 kordoc 이 원고 전용 규칙으로 빼서(연속 공백이 접힘) 여기서 있고 없음만 본다
 */

import type { IRBlock, IRTable } from 'kordoc';
import type { LintFinding } from '../../types/rpc-contract.js';
import { contextOf, plainText } from './lint.js';

const WEEK = '일월화수목금토';

function weekdayOf(y: number, m: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return WEEK[dt.getUTCDay()];
}

/** 문서에 나온 네 자리 연도(날짜 꼴) — 하나뿐이면 연도 없는 날짜의 연도로 쓴다 */
function soleYear(text: string): number | undefined {
  const years = new Set<number>();
  for (const m of text.matchAll(/(?<!\d)((?:19|20)\d{2})(?:\.\s*\d{1,2}\.\s*\d{1,2}|년\s*\d{1,2}월)/g)) years.add(Number(m[1]));
  return years.size === 1 ? [...years][0] : undefined;
}

/** 날짜와 요일 — 년·월·일 꼴과 연도 없는 꼴 (점 날짜에 연도가 붙은 꼴은 kordoc 이 본다) */
export function weekdayFindings(text: string): LintFinding[] {
  const out: LintFinding[] = [];
  const lines = text.split('\n');
  const year = soleYear(text);
  const full = /(?<!\d)((?:19|20)\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일\s*\(\s*([일월화수목금토])(?:요일)?\s*\)/g;
  // 연도 없는 날짜: "11. 5.(목)"·"11월 5일(목)". 앞에 연도가 붙은 점 날짜("2026. 11. 5.")·년월일은 빼고
  const short = /(?<![\d.'’]\s?)(?<![\d.'’])(?<!년\s?)(\d{1,2})(?:\.\s*|월\s*)(\d{1,2})(?:\.|일)?\s*\(\s*([일월화수목금토])(?:요일)?\s*\)/g;
  lines.forEach((line, i) => {
    for (const m of line.matchAll(full)) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const real = weekdayOf(y, mo, d);
      if (!real || real === m[4]) continue;
      out.push({
        rule: 'WEEKDAY_MISMATCH', severity: 'error', category: '날짜와 요일',
        message: `${mo}월 ${d}일은 ${real}요일입니다. 공문서 날짜는 숫자와 온점으로 적습니다.`,
        line: i + 1, excerpt: m[0], context: contextOf(line, m.index!, m.index! + m[0].length),
        fix: { from: m[0], to: `${y}. ${mo}. ${d}.(${real})` },
      });
    }
    if (!year) return;
    for (const m of line.matchAll(short)) {
      const before = line.slice(0, m.index);
      if (/(?:(?:19|20)\d{2}|['’]\d{2})\.\s*$/.test(before) || /(?:19|20)\d{2}년\s*$/.test(before)) continue;
      const [mo, d] = [Number(m[1]), Number(m[2])];
      if (mo < 1 || mo > 12) continue;
      const real = weekdayOf(year, mo, d);
      if (!real || real === m[3]) continue;
      const dotted = !m[0].includes('월');
      out.push({
        rule: 'WEEKDAY_MISMATCH', severity: 'warning', category: '날짜와 요일',
        message: `문서의 연도(${year}년)로 보면 ${mo}월 ${d}일은 ${real}요일입니다.`,
        line: i + 1, excerpt: m[0], context: contextOf(line, m.index!, m.index! + m[0].length),
        fix: { from: m[0], to: dotted ? m[0].replace(/\(\s*[일월화수목금토](요일)?\s*\)/, `(${real})`) : `${mo}. ${d}.(${real})` },
      });
    }
  });
  return out;
}

// ── 표 합계 ──

const TOTAL_LABEL = /^(합\s*계|총\s*계|총\s*합\s*계|계|총\s*액|합)$/;
const SUBTOTAL_LABEL = /^(소\s*계)$/;
/** 더해서는 안 되는 열 (비율·단가·번호·연도 등) */
const NON_ADDITIVE = /비율|비중|%|％|단가|률|율|번호|연번|순번|순위|연도|년도|평균|증감|대비|코드|날짜|일자|기간|전화/;

interface Num { value: number; decimals: number }

/** 칸 글 → 숫자 (원·명·건 등 단위, 천 단위 쉼표, △·▲ 음수). 숫자가 아니면 undefined, 비었거나 "-" 면 0 */
export function cellNumber(raw: string): Num | undefined {
  const s = plainText(raw).replace(/\s+/g, '');
  if (!s || /^[-–―]$/.test(s)) return { value: 0, decimals: 0 };
  const m = /^([-△▲]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(원|명|건|개|개소|곳|회|대|권|부|천원|백만원|만원|억원|km|㎞|m|㎡|kg|t|톤)?$/.exec(s);
  if (!m) return undefined;
  const value = Number(m[2].replace(/,/g, '') + (m[3] ? `.${m[3]}` : ''));
  return { value: m[1] ? -value : value, decimals: m[3]?.length ?? 0 };
}

const showNum = (v: number, decimals: number, like: string) => {
  const fixed = Math.abs(v).toFixed(decimals);
  const [i, f] = fixed.split('.');
  const grouped = /\d,\d{3}/.test(like) || Math.abs(v) >= 10000 ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : i;
  const sign = v < 0 ? (/△/.test(like) ? '△' : /▲/.test(like) ? '▲' : '-') : '';
  const unit = /(원|명|건|개|개소|곳|회|대|권|부|천원|백만원|만원|억원|km|㎞|m|㎡|kg|t|톤)\s*$/.exec(plainText(like))?.[1] ?? '';
  return `${sign}${grouped}${f ? `.${f}` : ''}${unit}`;
};

/** 병합 칸을 펼친 격자 (병합으로 가려진 칸은 null) */
function grid(t: IRTable): Array<Array<string | null>> {
  const g: Array<Array<string | null | undefined>> = Array.from({ length: t.rows }, () => Array(t.cols).fill(undefined));
  let overflow = false;
  t.cells.forEach((row, r) => {
    let c = 0;
    for (const cell of row) {
      while (c < t.cols && g[r]?.[c] !== undefined) c++;
      if (c >= t.cols || !g[r]) { overflow = true; return; }
      for (let dr = 0; dr < Math.max(1, cell.rowSpan); dr++) {
        for (let dc = 0; dc < Math.max(1, cell.colSpan); dc++) {
          if (g[r + dr] && c + dc < t.cols) g[r + dr][c + dc] = dr === 0 && dc === 0 ? cell.text : null;
        }
      }
      c += Math.max(1, cell.colSpan);
    }
  });
  if (overflow) return t.cells.map((row) => Array.from({ length: t.cols }, (_, c) => row[c]?.text ?? null));
  return g.map((row) => row.map((v) => (v === undefined ? '' : v)));
}

/** 마크다운 GFM 표 (글 파일·블록 없는 문서) */
function markdownTables(md: string): Array<Array<Array<string | null>>> {
  const out: Array<Array<Array<string | null>>> = [];
  let cur: string[][] = [];
  const flush = () => { if (cur.length >= 3) out.push(cur); cur = []; };
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) { flush(); continue; }
    const cells = t.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    cur.push(cells);
  }
  flush();
  return out;
}

function tablesOf(blocks: IRBlock[]): IRTable[] {
  const out: IRTable[] = [];
  const walk = (bs: IRBlock[]) => {
    for (const b of bs) {
      if (b.table) {
        out.push(b.table);
        for (const row of b.table.cells) for (const c of row) if (c.blocks) walk(c.blocks);
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

const label = (s: string | null | undefined) => plainText(s ?? '').replace(/\s+/g, '');

/** 한 줄(행 또는 열)의 합계 대조 — values 는 위에서부터 칸 글. 맞지 않으면 [기대값, 지금 값] */
function compareSum(parts: Array<string | null>, total: string): { expected: string; got: string } | undefined {
  const t = cellNumber(total);
  if (!t || !plainText(total).trim()) return undefined;
  const nums = parts.map((p) => (p === null ? undefined : cellNumber(p)));
  const real = parts.filter((p, i) => p !== null && nums[i] && plainText(p).replace(/[\s-–―]/g, '') !== '');
  if (real.length < 2 || nums.some((n, i) => parts[i] !== null && !n)) return undefined;
  const decimals = Math.max(t.decimals, ...nums.map((n) => n?.decimals ?? 0));
  const sum = nums.reduce((a, n) => a + (n?.value ?? 0), 0);
  const tol = decimals ? (10 ** -decimals) * Math.max(1, real.length) / 2 : 0;
  if (Math.abs(sum - t.value) <= tol + 1e-9) return undefined;
  return { expected: showNum(sum, decimals, total), got: plainText(total) };
}

/** 표 합계 — 합계·소계·계 행(맨 왼쪽 칸)과 합계 열(맨 위 칸) */
export function sumFindings(blocks: IRBlock[], markdown: string): Array<LintFinding & { table: number }> {
  const tables = blocks.length ? tablesOf(blocks).map(grid) : markdownTables(markdown);
  const out: Array<LintFinding & { table: number }> = [];
  tables.forEach((g, ti) => {
    if (g.length < 3 || (g[0]?.length ?? 0) < 2) return;
    const cols = g[0].length;
    const head = g[0].map(label);
    // 행 합계: 맨 왼쪽(또는 둘째) 칸이 합계·소계
    const labelCol = (r: number) => [0, 1].find((c) => TOTAL_LABEL.test(label(g[r][c])) || SUBTOTAL_LABEL.test(label(g[r][c])));
    let groupStart = 1;
    for (let r = 1; r < g.length; r++) {
      const lc = labelCol(r);
      if (lc === undefined) continue;
      const sub = SUBTOTAL_LABEL.test(label(g[r][lc]));
      const rows: number[] = [];
      for (let k = sub ? groupStart : 1; k < r; k++) {
        const kl = labelCol(k);
        if (kl !== undefined) continue; // 다른 합계·소계 행은 더하지 않는다 (소계 아래 칸을 그대로 더한다)
        rows.push(k);
      }
      for (let c = lc + 1; c < cols; c++) {
        if (NON_ADDITIVE.test(head[c] ?? '')) continue;
        const total = g[r][c];
        if (total === null || total === undefined) continue;
        const bad = compareSum(rows.map((k) => g[k][c]), total);
        if (!bad) continue;
        out.push({
          rule: 'SUM_MISMATCH', severity: 'error', category: '표 합계', table: ti + 1,
          message: `표 ${ti + 1}의 ${plainText(g[r][lc] ?? '합계')} 행${head[c] ? `(${plainText(g[0][c] ?? '')})` : ''}이 ${bad.got}인데, 위 칸을 더하면 ${bad.expected}입니다.`,
          excerpt: bad.got, context: [plainText(g[r][lc] ?? ''), bad.got].join(' '),
          fix: { from: bad.got, to: bad.expected },
        });
      }
      if (sub) groupStart = r + 1;
    }
    // 열 합계: 맨 위 칸이 합계·계인 열 = 같은 줄 왼쪽 숫자 칸의 합
    head.forEach((h, c) => {
      if (c < 2 || !TOTAL_LABEL.test(h)) return;
      const partsCols = Array.from({ length: c }, (_, k) => k).filter((k) => !NON_ADDITIVE.test(head[k]) && g.slice(1).every((row) => row[k] === null || cellNumber(row[k] ?? '') !== undefined));
      if (partsCols.length < 2) return;
      for (let r = 1; r < g.length; r++) {
        const total = g[r][c];
        if (total === null || total === undefined) continue;
        const bad = compareSum(partsCols.map((k) => g[r][k]), total);
        if (!bad) continue;
        out.push({
          rule: 'SUM_MISMATCH', severity: 'error', category: '표 합계', table: ti + 1,
          message: `표 ${ti + 1}의 ${plainText(g[r][0] ?? '')} 줄 ${plainText(g[0][c] ?? '합계')} 칸이 ${bad.got}인데, 왼쪽 칸을 더하면 ${bad.expected}입니다.`,
          excerpt: bad.got, context: [plainText(g[r][0] ?? ''), bad.got].join(' '),
          fix: { from: bad.got, to: bad.expected },
        });
      }
    });
  });
  // 같은 칸을 행·열 두 번 짚지 않게
  const seen = new Set<string>();
  return out.filter((f) => { const k = `${f.table}|${f.context}|${f.excerpt}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── "끝." 표시·붙임 ──

/** 시행문·기안문 모양인가 (수신·제목 줄, 또는 붙임 줄) */
function officialLike(text: string): boolean {
  const head = text.slice(0, 4000);
  return (/^\s*수신\s*[:：]?\s*\S/m.test(head) && /^\s*(제목|제\s+목)\s*[:：]?\s*\S/m.test(head)) || /^\s*(\*\*)?붙\s*임(?=[\s:：*]|$)/m.test(text);
}

/** 파싱한 글에서 "끝." 표시가 있는가 — 붙임이 있으면 붙임 줄들 끝에, 없으면 본문 어딘가에 */
export function endMarkFindings(text: string): LintFinding[] {
  if (!officialLike(text)) return [];
  if (/(^|[\s.])끝\s*\.(?=\s|$)/m.test(text)) return [];
  const lines = text.split('\n');
  const bunim = lines.reduce((last, l, i) => (/^\s*(\*\*)?붙\s*임(?=[\s:：*]|$)/.test(l) ? i : last), -1);
  // 붙임 다음에 이어지는 "2. …" 붙임 목록 줄까지
  let end = bunim;
  if (bunim >= 0) {
    for (let i = bunim + 1; i < lines.length && i <= bunim + 8; i++) {
      if (!lines[i].trim()) continue;
      if (/^\s*\d+\.\s+\S.*\d+\s*부\.?\s*$/.test(lines[i])) end = i; else break;
    }
  }
  const at = end >= 0 ? end : undefined;
  const last = at !== undefined ? lines[at].replace(/\s+$/, '') : undefined;
  return [{
    rule: 'END_MARK_MISSING', severity: 'warning', category: '붙임·끝 표시',
    message: at !== undefined ? "붙임 표시 끝에 '끝.' 표시가 없습니다." : "본문이 끝나는 곳에 '끝.' 표시가 없습니다.",
    ...(at !== undefined ? { line: at + 1, excerpt: last, context: plainText(last!).slice(-40) } : {}),
    // 바르게 쓴 모양만 보인다. 자동으로 고치지 않는다: "붙임  …" 처럼 두 칸 띄운 문단은 kordoc 패치가 공백을 지킬 수 없어 거부한다
    ...(last && /부\.\s*$/.test(last) ? { suggestion: `${plainText(last).split(' ').slice(-2).join(' ')}  끝.` } : {}),
  }];
}

/** 채우지 않은 자리 표시 (○○○·OOO·□□) — 서식에서 옮겨 와 그대로 남은 곳 */
export function placeholderFindings(text: string): LintFinding[] {
  const out: LintFinding[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/(?<![○◯OＯ□])(?:[○◯]{2,}|[OＯ]{3,}|[□]{2,}|[XＸ]{3,})(?![○◯OＯ□])/g)) {
      out.push({
        rule: 'PLACEHOLDER', severity: 'warning', category: '채우지 않은 자리',
        message: `'${m[0]}'처럼 채우지 않은 자리 표시가 남아 있습니다. 실제 내용으로 바꾸세요.`,
        line: i + 1, excerpt: m[0], context: contextOf(line, m.index!, m.index! + m[0].length),
      });
    }
  });
  return out.slice(0, 20);
}
