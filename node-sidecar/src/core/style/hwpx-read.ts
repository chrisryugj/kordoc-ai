/** 서식 읽기용 HWPX 얇은 파서 — 용지·여백, 글자 모양(charPr)·문단 모양(paraPr), 문단별 글·모양, 표, 쪽 번호
 *
 * kordoc parse 는 글과 구조만 주고 글꼴·크기·들여쓰기는 버린다. 서식을 재려면 header.xml 과 section*.xml 을 직접 읽는다.
 * 단위: 길이는 HWPUNIT(1mm = 7200/25.4), 글자 크기는 pt.
 */

import JSZip from 'jszip';
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';

export const HWPUNIT_PER_MM = 7200 / 25.4;

export interface CharShape {
  pt: number;
  font: string;
  bold: boolean;
  /** 글꼴 갈래 (fontface typeInfo familyType) — 명조·고딕 가르기 */
  family?: string;
}

export interface ParaShape {
  align: string;
  left: number;
  indent: number;
  /** PERCENT 일 때만 퍼센트 값 */
  lineSpacing?: number;
}

export interface Para {
  text: string;
  paraPr: ParaShape;
  /** 글자 수로 가중한 대표 글자 모양 (부호를 뺀 내용 기준은 extract 가 runs 로 다시 잰다) */
  runs: Array<{ shape: CharShape; text: string }>;
  /** 0 = 본문, 1 이상 = 표 안 (중첩 깊이) */
  tableDepth: number;
  /** 표 안이면 그 표 번호 (doc.tables 의 index) */
  table?: number;
  /** 표 안이면 칸 자리 */
  cell?: { row: number; col: number };
  /** 쪽 나눔·구역으로만 센 쪽 번호(0부터, 자동 줄넘김 쪽은 모른다) */
  page: number;
}

export interface TableInfo {
  index: number;
  rows: number;
  cols: number;
  tableDepth: number;
  /** 본문 문단 순서에서 이 표 앞에 나온 본문 글 문단 수 */
  bodyParasBefore: number;
  cells: Array<{ row: number; col: number; text: string; fill?: string; borderFill?: string }>;
}

export interface HwpxDoc {
  page: { width: number; height: number; landscape: boolean };
  margins: { top: number; bottom: number; left: number; right: number; header: number; footer: number };
  paras: Para[];
  tables: TableInfo[];
  pageNumbers: boolean;
  /** borderFill id → 채움색 */
  fills: Map<string, string>;
}

const childEls = (n: Node | null | undefined): Element[] => {
  const out: Element[] = [];
  for (let c = n?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
};
const local = (e: Element) => e.localName ?? e.nodeName.replace(/^.*:/, '');
const kids = (e: Element, name: string) => childEls(e).filter((c) => local(c) === name);
const kid = (e: Element | undefined, name: string) => (e ? kids(e, name)[0] : undefined);
const num = (v: string | null | undefined, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

function* descendants(e: Element, name: string): Generator<Element> {
  for (const c of childEls(e)) {
    if (local(c) === name) yield c;
    yield* descendants(c, name);
  }
}

/** hh:margin — 새 형식(hc:left 자식, hp:switch 의 default 가 HWPUNIT)과 옛 형식(속성) 둘 다 */
function readParaShape(pp: Element): ParaShape {
  const align = kid(pp, 'align')?.getAttribute('horizontal') ?? 'JUSTIFY';
  let holder: Element = pp;
  const sw = kid(pp, 'switch');
  if (sw) holder = kid(sw, 'default') ?? kid(sw, 'case') ?? pp;
  const margin = kid(holder, 'margin') ?? kid(pp, 'margin');
  const line = kid(holder, 'lineSpacing') ?? kid(pp, 'lineSpacing');
  let left = 0;
  let indent = 0;
  if (margin) {
    const l = kid(margin, 'left');
    const i = kid(margin, 'intent') ?? kid(margin, 'indent');
    left = l ? num(l.getAttribute('value')) : num(margin.getAttribute('left'));
    indent = i ? num(i.getAttribute('value')) : num(margin.getAttribute('indent') ?? margin.getAttribute('intent'));
  }
  const type = line?.getAttribute('type') ?? 'PERCENT';
  return { align, left, indent, ...(line && type === 'PERCENT' ? { lineSpacing: num(line.getAttribute('value'), 160) } : {}) };
}

function readHeader(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement as unknown as Element;
  const fonts = new Map<string, { face: string; family?: string }>();
  for (const ff of descendants(root, 'fontface')) {
    if (ff.getAttribute('lang') !== 'HANGUL') continue;
    for (const f of kids(ff, 'font')) fonts.set(f.getAttribute('id') ?? '', { face: f.getAttribute('face') ?? '', family: kid(f, 'typeInfo')?.getAttribute('familyType') ?? undefined });
  }
  const chars = new Map<string, CharShape>();
  for (const cp of descendants(root, 'charPr')) {
    const ref = kid(cp, 'fontRef')?.getAttribute('hangul') ?? '0';
    const f = fonts.get(ref);
    chars.set(cp.getAttribute('id') ?? '', { pt: num(cp.getAttribute('height'), 1000) / 100, font: f?.face ?? '', bold: !!kid(cp, 'bold'), ...(f?.family ? { family: f.family } : {}) });
  }
  const paras = new Map<string, ParaShape>();
  for (const pp of descendants(root, 'paraPr')) paras.set(pp.getAttribute('id') ?? '', readParaShape(pp));
  const fills = new Map<string, string>();
  for (const bf of descendants(root, 'borderFill')) {
    const brush = [...descendants(bf, 'winBrush')][0];
    const c = brush?.getAttribute('faceColor');
    if (c && c !== 'none' && !/^#?FFFFFF$/i.test(c)) fills.set(bf.getAttribute('id') ?? '', c.toUpperCase());
  }
  return { chars, paras, fills };
}

/** 문단 글 — hp:t 안의 탭은 공백 하나로 */
function runText(t: Element): string {
  let s = '';
  for (let c = t.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) s += c.nodeValue ?? '';
    else if (c.nodeType === 1 && local(c as Element) === 'tab') s += ' ';
  }
  return s;
}

export async function readHwpx(bytes: Uint8Array | ArrayBuffer): Promise<HwpxDoc> {
  const zip = await JSZip.loadAsync(bytes);
  const headerFile = zip.file('Contents/header.xml');
  if (!headerFile) throw new Error('HWPX 구조가 아닙니다. 한글에서 HWPX로 다시 저장해 넣으세요.');
  const { chars, paras: paraShapes, fills } = readHeader(await headerFile.async('string'));
  const sections = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => num(/\d+/.exec(a)?.[0]) - num(/\d+/.exec(b)?.[0]));
  const fallbackChar: CharShape = { pt: 10, font: '', bold: false };
  const fallbackPara: ParaShape = { align: 'JUSTIFY', left: 0, indent: 0 };
  const out: HwpxDoc = {
    page: { width: 59528, height: 84188, landscape: false },
    margins: { top: 5668, bottom: 4252, left: 8504, right: 8504, header: 4252, footer: 4252 },
    paras: [], tables: [], pageNumbers: false, fills,
  };
  let gotPage = false;
  let bodyCount = 0;
  let page = 0;

  const walkPara = (p: Element, tableDepth: number, table?: number, cell?: Para['cell']) => {
    if (tableDepth === 0 && p.getAttribute('pageBreak') === '1' && out.paras.length) page++;
    const runs: Para['runs'] = [];
    for (const run of kids(p, 'run')) {
      const shape = chars.get(run.getAttribute('charPrIDRef') ?? '') ?? fallbackChar;
      for (const c of childEls(run)) {
        const name = local(c);
        if (name === 't') runs.push({ shape, text: runText(c) });
        else if (name === 'tbl') walkTable(c, tableDepth + 1);
        // 글상자(그리기 개체 안 글) — 제목 상자·목차가 여기 있을 때가 많다. 본문 밖(표 안과 같은 깊이)으로 읽는다
        else if (name !== 'secPr' && name !== 'ctrl') {
          for (const dt of descendants(c, 'drawText')) for (const sub of kids(dt, 'subList')) for (const p2 of kids(sub, 'p')) walkPara(p2, tableDepth + 1);
        }
        else if (name === 'secPr' && !gotPage) readSecPr(c);
        else if (name === 'ctrl') {
          for (const cc of childEls(c)) {
            const n = local(cc);
            if (n === 'pageNum') out.pageNumbers = true;
            if (n === 'header' || n === 'footer') {
              for (const an of descendants(cc, 'autoNum')) if (an.getAttribute('numType') === 'PAGE') out.pageNumbers = true;
              for (const _ of descendants(cc, 'pageNum')) out.pageNumbers = true;
            }
          }
        }
      }
    }
    const text = runs.map((r) => r.text).join('');
    const para: Para = { text, paraPr: paraShapes.get(p.getAttribute('paraPrIDRef') ?? '') ?? fallbackPara, runs, tableDepth, page, ...(table !== undefined ? { table } : {}), ...(cell ? { cell } : {}) };
    out.paras.push(para);
    if (tableDepth === 0 && text.trim()) bodyCount++;
  };

  const walkTable = (tbl: Element, tableDepth: number) => {
    const index = out.tables.length;
    const info: TableInfo = { index, rows: num(tbl.getAttribute('rowCnt'), 1), cols: num(tbl.getAttribute('colCnt'), 1), tableDepth, bodyParasBefore: bodyCount, cells: [] };
    out.tables.push(info);
    for (const tr of kids(tbl, 'tr')) {
      for (const tc of kids(tr, 'tc')) {
        const addr = kid(tc, 'cellAddr');
        const row = num(addr?.getAttribute('rowAddr'));
        const col = num(addr?.getAttribute('colAddr'));
        const start = out.paras.length;
        for (const sub of kids(tc, 'subList')) for (const p of kids(sub, 'p')) walkPara(p, tableDepth, index, { row, col });
        const text = out.paras.slice(start).filter((x) => x.table === index).map((x) => x.text).join('\n').trim();
        const bf = tc.getAttribute('borderFillIDRef') ?? undefined;
        info.cells.push({ row, col, text, ...(bf ? { borderFill: bf } : {}), ...(bf && fills.get(bf) ? { fill: fills.get(bf) } : {}) });
      }
    }
  };

  const readSecPr = (sec: Element) => {
    const pp = kid(sec, 'pagePr');
    if (!pp) return;
    gotPage = true;
    const w = num(pp.getAttribute('width'), 59528);
    const h = num(pp.getAttribute('height'), 84188);
    // 한컴 규약: 세로 문서는 WIDELY, 가로 문서는 NARROWLY (폭·높이는 방향과 무관하게 용지 실치수)
    out.page = { width: w, height: h, landscape: pp.getAttribute('landscape') === 'NARROWLY' };
    const m = kid(pp, 'margin');
    if (m) out.margins = { top: num(m.getAttribute('top')), bottom: num(m.getAttribute('bottom')), left: num(m.getAttribute('left')), right: num(m.getAttribute('right')), header: num(m.getAttribute('header')), footer: num(m.getAttribute('footer')) };
  };

  for (const [i, name] of sections.entries()) {
    if (i > 0) page++;
    const doc = new DOMParser().parseFromString(await zip.file(name)!.async('string'), 'text/xml');
    for (const p of kids(doc.documentElement as unknown as Element, 'p')) walkPara(p, 0);
  }
  return out;
}
