/** 명부 엑셀의 칸 표시 형식·숨긴 행 — kordoc 표는 숫자 칸의 원래 값만 준다(010-1234-5678 로 보이는 칸이 1012345678).
 *
 * 시트 XML 을 따로 읽어 숫자 칸마다 표시 형식(백분율·#,##0·자리 채움 000000·0##-####-#### 같은 사용자 형식)을 적용한 글을 만든다.
 * 날짜 형식은 kordoc 이 이미 날짜로 바꾸므로 건드리지 않는다. 못 읽는 형식(지수·분수·한자 숫자)은 원래 값 그대로.
 */

import JSZip from 'jszip';

export interface SheetView {
  /** `${행},${열}`(0부터) → 엑셀 화면에 보이는 글 */
  display: Map<string, string>;
  /** 숨긴 행(0부터) */
  hiddenRows: Set<number>;
}

/** 표준 번호 서식 (ECMA-376 18.8.30). 나라마다 다른 통화·회계 서식(5-8, 41-44)은 뺀다 */
const BUILTIN: Record<number, string> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;(#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;(#,##0.00)',
};

const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

/** 서식 문자열을 ; 로 나눈다 (따옴표·대괄호 안의 ; 는 그대로) */
function sections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') { const j = code.indexOf('"', i + 1); const end = j < 0 ? code.length : j; cur += code.slice(i, end + 1); i = end; }
    else if (ch === '[') { const j = code.indexOf(']', i + 1); const end = j < 0 ? code.length : j; cur += code.slice(i, end + 1); i = end; }
    else if (ch === '\\' || ch === '_' || ch === '*') { cur += code.slice(i, i + 2); i++; }
    else if (ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const COND = /\[(<=|>=|<>|<|>|=)(-?\d+(?:\.\d+)?)\]/;
const test = (op: string, a: number, b: number) => (op === '<=' ? a <= b : op === '>=' ? a >= b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : a === b);

type Tok = { k: 'lit'; t: string } | { k: 'ph'; t: string } | { k: 'dot' } | { k: 'comma' };

function tokenize(sec: string): Tok[] | null {
  const out: Tok[] = [];
  for (let i = 0; i < sec.length; i++) {
    const ch = sec[i];
    if (ch === '"') { const j = sec.indexOf('"', i + 1); const end = j < 0 ? sec.length : j; out.push({ k: 'lit', t: sec.slice(i + 1, end) }); i = end; }
    else if (ch === '[') {
      const j = sec.indexOf(']', i + 1);
      const inner = sec.slice(i + 1, j < 0 ? sec.length : j);
      i = j < 0 ? sec.length : j;
      // [$₩-412] 같은 통화 기호는 글로, 색·조건·나라는 버린다. 한자·한글 숫자([DBNum1])는 못 그린다
      if (/^DBNum/i.test(inner)) return null;
      const cur = /^\$([^-]*)/.exec(inner);
      if (cur?.[1]) out.push({ k: 'lit', t: cur[1] });
    } else if (ch === '\\') { out.push({ k: 'lit', t: sec[i + 1] ?? '' }); i++; }
    else if (ch === '_') { out.push({ k: 'lit', t: ' ' }); i++; }
    else if (ch === '*') i++;
    else if (ch === '0' || ch === '#' || ch === '?') out.push({ k: 'ph', t: ch });
    else if (ch === '.') out.push(out.some((x) => x.k === 'dot') ? { k: 'lit', t: '.' } : { k: 'dot' });
    else if (ch === ',') out.push({ k: 'comma' });
    // 지수·분수·글 자리·날짜 글자는 이 함수가 다루지 않는다
    else if (/[eE/@]/.test(ch) || /[ymdhsAaGg]/.test(ch)) return null;
    else out.push({ k: 'lit', t: ch });
  }
  return out;
}

/** 반올림 (엑셀처럼 0.5 는 0 에서 멀어지는 쪽) */
const roundTo = (v: number, d: number) => (String(v).includes('e') ? Math.round(v * 10 ** d) / 10 ** d : Number(`${Math.round(Number(`${v}e${d}`))}e-${d}`));

/** 숫자 하나를 서식 문자열로. 못 그리면 null */
export function formatNumber(v: number, code: string): string | null {
  if (!Number.isFinite(v)) return null;
  const secs = sections(code);
  let sec: string;
  let neg = v < 0;
  if (secs.some((s) => COND.test(s))) {
    const hit = secs.find((s) => { const m = COND.exec(s); return m ? test(m[1], v, Number(m[2])) : false; });
    sec = hit ?? secs.find((s) => !COND.test(s)) ?? secs[secs.length - 1];
  } else if (v < 0 && secs.length >= 2) { sec = secs[1]; neg = false; }
  else if (v === 0 && secs.length >= 3) sec = secs[2];
  else sec = secs[0];
  const toks = tokenize(sec);
  if (!toks) return null;
  const dot = toks.findIndex((t) => t.k === 'dot');
  const intToks = dot < 0 ? toks : toks.slice(0, dot);
  const fracToks = dot < 0 ? [] : toks.slice(dot + 1);
  const intPh = intToks.filter((t) => t.k === 'ph').map((t) => t.t);
  const fracPh = fracToks.filter((t) => t.k === 'ph').map((t) => t.t);
  if (!intPh.length && !fracPh.length) return null;
  // 쉼표: 자리 사이면 세 자리 묶음, 정수 끝 자리 바로 뒤면 1,000 으로 나눔
  const lastPh = intToks.map((t) => t.k).lastIndexOf('ph');
  const firstPh = intToks.findIndex((t) => t.k === 'ph');
  let group = false;
  let scaleDown = 0;
  intToks.forEach((t, i) => {
    if (t.k !== 'comma') return;
    if (i > firstPh && i < lastPh && firstPh >= 0) group = true;
    else if (i > lastPh && lastPh >= 0 && intToks.slice(lastPh + 1, i).every((x) => x.k === 'comma')) scaleDown++;
  });
  const pct = toks.filter((t) => t.k === 'lit' && t.t === '%').length;
  const n = roundTo(Math.abs(v) * 100 ** pct / 1000 ** scaleDown, fracPh.length);
  const [intRaw, fracRaw = ''] = n.toFixed(fracPh.length).split('.');
  const firstZero = intPh.indexOf('0');
  const minLen = firstZero < 0 ? 0 : intPh.length - firstZero;
  let digits = intRaw === '0' ? '' : intRaw;
  digits = digits.padStart(minLen, '0');
  if (group) digits = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // 정수 자리: 오른쪽부터 한 자리씩, 남은 자리는 맨 왼쪽 자리에 다 (묶음이면 한 덩어리)
  let intOut = '';
  if (firstPh < 0) intOut = digits + intToks.map((t) => (t.k === 'lit' ? t.t : '')).join('');
  else if (group) {
    intToks.forEach((t, i) => {
      if (i === firstPh) intOut += digits;
      else if (t.k === 'lit' && (i < firstPh || i > lastPh)) intOut += t.t;
    });
  } else {
    let rest = digits;
    const parts: string[] = [];
    for (let i = intToks.length - 1; i >= 0; i--) {
      const t = intToks[i];
      if (t.k === 'lit') parts.push(t.t);
      else if (t.k === 'comma') parts.push(i > lastPh ? '' : ',');
      else if (t.k === 'ph') {
        if (i === firstPh) { parts.push(rest || (t.t === '?' ? ' ' : '')); rest = ''; }
        else { parts.push(rest ? rest.slice(-1) : t.t === '?' ? ' ' : ''); rest = rest.slice(0, -1); }
      }
    }
    intOut = parts.reverse().join('');
  }
  // 소수 자리: 왼쪽부터, 끝의 # 자리는 0 을 지운다
  const frac = [...fracRaw];
  for (let i = fracPh.length - 1; i >= 0 && fracPh[i] !== '0' && frac[i] === '0'; i--) frac[i] = fracPh[i] === '?' ? ' ' : '';
  let fi = 0;
  const fracOut = fracToks.map((t) => (t.k === 'ph' ? frac[fi++] ?? '' : t.k === 'lit' ? t.t : t.k === 'comma' ? ',' : '')).join('');
  const body = `${intOut}${dot >= 0 ? '.' : ''}${fracOut}`;
  return neg && n !== 0 ? `-${body}` : body;
}

/** 날짜·시각 서식인가 (kordoc 이 이미 날짜 글로 바꾼다) */
const isDateCode = (code: string) => /[ymdhs]/i.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''));

/** 통합 문서의 n 번째 시트(0부터)의 표시 글·숨긴 행 */
export async function readSheetView(buf: Uint8Array, sheetIndex: number): Promise<SheetView> {
  const view: SheetView = { display: new Map(), hiddenRows: new Set() };
  const zip = await JSZip.loadAsync(buf);
  const text = (p: string) => zip.file(p)?.async('text');
  const workbook = await text('xl/workbook.xml');
  if (!workbook) return view;
  const rid = [...workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)].map((m) => attr(m[1], 'r:id') ?? attr(m[1], '\\w+:id'))[sheetIndex];
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  const rel = [...rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)].find((m) => attr(m[1], 'Id') === rid);
  let target = rel ? attr(rel[1], 'Target') ?? '' : `worksheets/sheet${sheetIndex + 1}.xml`;
  target = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`;
  const sheet = await text(target);
  if (!sheet) return view;

  const styles = (await text('xl/styles.xml')) ?? '';
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<(?:\w+:)?numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1], 'numFmtId'));
    const code = attr(m[1], 'formatCode');
    if (Number.isFinite(id) && code !== undefined) custom.set(id, unescapeXml(code));
  }
  const xfBlock = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(styles)?.[1] ?? '';
  const xfCodes = [...xfBlock.matchAll(/<(?:\w+:)?xf\b([^>]*?)(?:\/>|>)/g)].map((m) => {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    const code = custom.get(id) ?? BUILTIN[id];
    return code && !isDateCode(code) && code !== 'General' ? code : undefined;
  });

  let prevRow = -1;
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const rAttr = attr(rm[1], 'r');
    const row = rAttr ? Number(rAttr) - 1 : prevRow + 1;
    prevRow = row;
    if (/^(1|true)$/.test(attr(rm[1], 'hidden') ?? '')) view.hiddenRows.add(row);
    let prevCol = -1;
    for (const cm of (rm[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = /^([A-Z]+)\d+$/.exec(attr(cm[1], 'r') ?? '');
      const col = ref ? [...ref[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1 : prevCol + 1;
      prevCol = col;
      const t = attr(cm[1], 't');
      if (t && t !== 'n') continue;
      const code = xfCodes[Number(attr(cm[1], 's') ?? 0)];
      const raw = /<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/.exec(cm[2] ?? '')?.[1];
      if (!code || raw === undefined || raw.trim() === '') continue;
      const shown = formatNumber(Number(raw), code);
      if (shown !== null) view.display.set(`${row},${col}`, shown);
    }
  }
  return view;
}
