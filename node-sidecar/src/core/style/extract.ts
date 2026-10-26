/** 견본 한글 문서 → 서식(StyleFormat) — 용지·여백·본문 글꼴·크기·줄 간격·항목 기호 단계·단계별 글꼴·제목 모양·쪽 번호·표 모양·갈래
 *
 * 모든 값은 글자 수로 가중한 최빈값이다(한두 문단의 예외 서식에 끌려가지 않게).
 * 기안문의 두문(수신·제목 표)과 결문(시행·접수·전화 표)은 서식 재기에서 뺀다: 본문이 아니라 틀이다.
 */

import { readFile } from 'node:fs/promises';
import { hwpxToProfile, type BorderDef, type GongmunPreset } from 'kordoc';
import type { StyleFormat, StyleTable, StyleTableCell } from '../../types/rpc-contract.js';
import { formatOf } from '../files/format.js';
import { rhwpConvert } from '../render/rhwp.js';
import { parseDoc } from '../converter/index.js';
import { guessPreset, PRESETS } from '../gongmun/index.js';
import { readHwpx, HWPUNIT_PER_MM, type CharShape, type HwpxDoc, type Para, type TableInfo } from './hwpx-read.js';
import { BULLET2, DepthStack, readMarker, type MarkerFamily } from './markers.js';

/** 견본 바이트 (HWP 는 rhwp 로 서식 그대로 HWPX 로 옮겨서 잰다) */
export async function sampleBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> {
  const fmt = formatOf(path);
  const raw = new Uint8Array(await readFile(path));
  if (fmt === 'hwpx') return raw;
  if (fmt === 'hwp') return rhwpConvert(raw, 'hwpx', signal);
  throw new Error('견본은 한글 문서(HWPX·HWP)만 됩니다. 우리 기관에서 쓴 한글 파일을 고르세요.');
}

/** 가중 최빈값 */
function modeOf<T>(items: Array<{ v: T; w: number }>, key: (v: T) => string): T | undefined {
  const acc = new Map<string, { v: T; w: number }>();
  for (const it of items) {
    if (it.w <= 0) continue;
    const k = key(it.v);
    const a = acc.get(k);
    if (a) a.w += it.w;
    else acc.set(k, { v: it.v, w: it.w });
  }
  let best: { v: T; w: number } | undefined;
  for (const a of acc.values()) if (!best || a.w > best.w) best = a;
  return best?.v;
}

const shapeKey = (s: CharShape) => `${s.font}|${s.pt}|${s.bold ? 1 : 0}`;
const visible = (s: string) => s.replace(/[\s　 ]/g, '').length;

/** 문단 앞 skip 글자(기호·띄어쓰기)를 뺀 내용의 글자 모양 (글자 수 가중) */
function contentShapes(p: Para, skip: number): Array<{ v: CharShape; w: number }> {
  const out: Array<{ v: CharShape; w: number }> = [];
  let left = skip;
  for (const r of p.runs) {
    let t = r.text;
    if (left > 0) {
      const cut = Math.min(left, t.length);
      t = t.slice(cut);
      left -= cut;
    }
    const w = visible(t);
    if (w) out.push({ v: r.shape, w });
  }
  return out;
}

const leadLen = (text: string, rest: string) => text.length - rest.length;
const mm = (hu: number) => Math.round((hu / HWPUNIT_PER_MM) * 10) / 10;

/** 명조·고딕 가르기 — 글꼴 이름이 먼저(생성기가 붙인 typeInfo 는 갈래가 틀릴 때가 있다), 모르면 typeInfo */
export const isGothic = (font: string, family?: string) =>
  /명조|바탕|궁서|serif|batang|myeongjo|신명/i.test(font) ? false
    : /고딕|돋움|굴림|gothic|dotum|gulim|맑은|헤드라인|스퀘어|sans/i.test(font) || family === 'FCAT_GOTHIC';

const HEAD_RE = /^(수\s*신|제\s*목|\(?경\s*유\)?)/;
const FOOT_RE = /^(시\s*행|접\s*수|협\s*조\s*자|우\s*\d{3}|전\s*화|전\s*송|공개\s*구분|비공개|부분공개|공개\b)/;

function tableKind(t: TableInfo): 'head' | 'foot' | 'other' {
  const texts = t.cells.flatMap((c) => c.text.split('\n')).map((s) => s.trim()).filter(Boolean);
  if (texts.some((s) => /^수\s*신/.test(s)) && texts.some((s) => /^제\s*목/.test(s))) return 'head';
  if (texts.filter((s) => FOOT_RE.test(s)).length >= 2) return 'foot';
  return 'other';
}

function paperSize(w: number, h: number): StyleFormat['paper']['size'] {
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  const near = (x: number, y: number) => Math.abs(a - x) <= 2 && Math.abs(b - y) <= 2;
  if (near(210, 297)) return 'A4';
  if (near(297, 420)) return 'A3';
  if (near(257, 364)) return 'B4';
  if (near(182, 257)) return 'B5';
  if (near(215.9, 279.4)) return 'Letter';
  return 'custom';
}

interface Bucket { depths: Map<number, number>; glyphs: Map<string, number>; shapes: Array<{ v: CharShape; w: number }>; count: number; family: MarkerFamily }

/** 표 모양 — 데이터 표(2줄·2칸 이상, 두문·결문 빼고)의 머리 줄 가운데 칸·본문 가운데 칸·바깥 선 */
async function tableStyle(bytes: Uint8Array, doc: HwpxDoc, skip: Set<number>): Promise<StyleTable | undefined> {
  const profile = await hwpxToProfile(Buffer.from(bytes)).catch(() => null);
  if (!profile) return undefined;
  // hwpxToProfile 은 맨 위 표만 차례대로 센다 — 읽기 쪽 표 중 tableDepth 1 인 것과 차례가 같다
  const topTables = doc.tables.filter((t) => t.tableDepth === 1);
  // 선이 보이는 표를 먼저 (선 없는 배치용 표는 표 모양이 아니다)
  const lined = (t: (typeof profile.tables)[number]) => Object.values(t.used_border_fills).some((bf) => [bf.leftBorder, bf.rightBorder, bf.topBorder, bf.bottomBorder].some((b) => b && b.type !== 'NONE'));
  const cand = profile.tables.map((t, i) => ({ t, info: topTables[i] })).filter(({ t, info }) => t.rows >= 2 && t.cols >= 2 && info && !skip.has(info.index));
  const pick = cand.sort((a, b) => Number(lined(b.t)) - Number(lined(a.t)) || b.t.rows * b.t.cols - a.t.rows * a.t.cols)[0];
  if (!pick) return undefined;
  const { t, info } = pick;
  const cellAt = (r: number, c: number) => t.cells.find((x) => x.row === r && x.col === c) ?? t.cells.find((x) => x.row === r);
  // 글꼴·크기·굵기는 글이 든 칸의 글자 모양(글자 수 가중)으로 — 빈 칸의 글자 모양은 엉뚱한 값(1pt 등)일 때가 있다
  const textShape = (head: boolean) => modeOf(doc.paras.filter((p) => p.table === info.index && p.cell && (p.cell.row === 0) === head).flatMap((p) => contentShapes(p, 0)), shapeKey);
  const describe = (cell: ReturnType<typeof cellAt>, side: 'bottomBorder' | 'topBorder', head: boolean): StyleTableCell => {
    const bf = cell?.borderFillIDRef ? t.used_border_fills[cell.borderFillIDRef] : undefined;
    const border: BorderDef | undefined = bf?.[side];
    const s = textShape(head);
    return {
      ...(s?.font ? { font: s.font } : {}),
      ...(s ? { pt: s.pt, bold: s.bold } : {}),
      ...(bf?.fill?.faceColor && !/^#?FFFFFF$/i.test(bf.fill.faceColor) ? { fill: bf.fill.faceColor.toUpperCase() } : {}),
      ...(border ? { border: { type: border.type, width: border.width, color: border.color } } : {}),
    };
  };
  const midCol = t.cols > 2 ? 1 : 0;
  const header = describe(cellAt(0, midCol), 'bottomBorder', true);
  const body = describe(cellAt(Math.min(1, t.rows - 1), midCol), 'topBorder', false);
  const corner = cellAt(0, 0)?.borderFillIDRef ? t.used_border_fills[cellAt(0, 0)!.borderFillIDRef!] : undefined;
  const outer = corner?.topBorder ? { type: corner.topBorder.type, width: corner.topBorder.width, color: corner.topBorder.color } : undefined;
  return { header, body, ...(outer ? { outer } : {}) };
}

const fmtNum = (n: number) => (Math.round(n * 10) / 10).toString();

export function styleSummary(f: StyleFormat): string {
  const m = f.margins;
  const kind = PRESETS.find((p) => p.id === f.preset)?.label ?? '문서';
  const parts = [
    `${kind} 서식${f.front?.cover ? ' (표지' + (f.front.toc ? '·목차)' : ')') : f.front?.toc ? ' (목차)' : ''}`,
    `${f.paper.size === 'custom' ? `${fmtNum(f.paper.width_mm)}×${fmtNum(f.paper.height_mm)}mm` : f.paper.size}${f.paper.landscape ? ' 가로' : ''}`,
    `여백 위 ${fmtNum(m.top)} 아래 ${fmtNum(m.bottom)} 왼쪽 ${fmtNum(m.left)} 오른쪽 ${fmtNum(m.right)} mm${m.header || m.footer ? ` (머리말 ${fmtNum(m.header)} 꼬리말 ${fmtNum(m.footer)})` : ''}`,
    `본문 ${f.body.font || '기본 글꼴'} ${fmtNum(f.body.pt)}pt`,
    `줄 간격 ${f.body.line_spacing}%`,
    f.numbering.markers.length ? `항목 ${f.numbering.markers.map((k) => (k === '○' && f.numbering.bullet2 ? f.numbering.bullet2 : k)).join(' ')}` : '항목 기호 없음',
  ];
  if (f.title.kind === 'box') parts.push('제목 상자');
  else if (f.title.kind === 'head') parts.push('수신·제목 머리 표');
  else if (f.title.kind === 'center') parts.push('제목 가운데');
  parts.push(f.page_numbers ? '쪽 번호 있음' : '쪽 번호 없음');
  return parts.join(' · ');
}

interface Frame {
  body: Para[];
  /** 표지·목차 쪽 표 (표 모양 재기에서 뺀다) */
  frontTables: Set<number>;
  front?: StyleFormat['front'];
  title: StyleFormat['title'];
  /** 제목 글 (상자 칸 글 또는 제목 줄) */
  titleText?: string;
  headTable?: TableInfo;
  frameTables: Set<number>;
  warnings: string[];
}

/** 본문 문단·제목·두문/결문 표 가르기 */
/** 표지(첫 쪽: 글이 적고 큰 제목) · 목차 쪽("목 차") — 서식 재기에서 빼고 따로 적는다 */
function detectFront(doc: HwpxDoc): { front?: StyleFormat['front']; skip: Set<number> } {
  const skip = new Set<number>();
  const lastPage = Math.max(0, ...doc.paras.map((p) => p.page));
  const p0 = doc.paras.filter((p) => p.page === 0 && visible(p.text));
  const big = (p: Para) => (modeOf(contentShapes(p, 0), shapeKey)?.pt ?? 0) >= 18;
  const cover = lastPage >= 1 && p0.reduce((n, p) => n + visible(p.text), 0) < 200 && p0.some(big);
  if (cover) skip.add(0);
  const tocAt = doc.paras.find((p) => p.page <= 2 && /^목차$/.test(p.text.replace(/\s/g, '')));
  if (tocAt) skip.add(tocAt.page);
  if (!cover && !tocAt) return { skip };
  // 표지의 기관 이름: 표지 끝쪽 짧은 줄 (날짜 줄 빼고)
  const ptOf = (p: Para) => modeOf(contentShapes(p, 0), shapeKey)?.pt ?? 0;
  const titleP = cover ? [...p0].sort((a, b) => ptOf(b) - ptOf(a) || visible(b.text) - visible(a.text))[0] : undefined;
  const org = cover ? [...p0].reverse().find((p) => p !== titleP && visible(p.text) <= 20 && !/\d{4}\s*\./.test(p.text))?.text.replace(/\s+/g, ' ').trim() : undefined;
  return { front: { cover, toc: !!tocAt, ...(org ? { org } : {}) }, skip };
}

function analyzeFrame(whole: HwpxDoc): Frame {
  const warnings: string[] = [];
  const { front, skip } = detectFront(whole);
  const doc: HwpxDoc = skip.size ? { ...whole, paras: whole.paras.filter((p) => !skip.has(p.page)), tables: whole.tables.filter((t) => !whole.paras.some((p) => p.table === t.index && skip.has(p.page))) } : whole;
  const kinds = new Map(doc.tables.map((t) => [t.index, tableKind(t)]));
  const frameTables = new Set([...kinds].filter(([, k]) => k !== 'other').map(([i]) => i));
  const headTable = doc.tables.find((t) => kinds.get(t.index) === 'head');

  // 본문 문단: 맨 바깥 문단. 거의 다 표 안에 쓴 문서면 두문·결문 표 밖의 표 안 문단까지
  let body = doc.paras.filter((p) => p.tableDepth === 0 && visible(p.text));
  // 기안문은 두문·결문 표 사이 짧은 본문이 정상이라 거의 비었을 때만
  if (body.reduce((s, p) => s + visible(p.text), 0) < (headTable ? 40 : 60)) {
    body = doc.paras.filter((p) => visible(p.text) && !(p.table !== undefined && frameTables.has(p.table)));
    if (body.length) warnings.push('본문 대부분이 표 안에 있어 표 안 글로 서식을 쟀습니다.');
  }

  // 제목: 맨 위 상자(1~2줄 작은 표) 또는 첫 줄들 중 크고 짧은 줄
  const roughBody = modeOf(body.flatMap((p) => contentShapes(p, 0)), shapeKey) ?? { pt: 10, font: '', bold: false };
  let title: StyleFormat['title'] = { kind: 'none' };
  let titleText: string | undefined;
  let titlePara: Para | undefined;
  const first = doc.tables.find((t) => t.tableDepth === 1);
  if (headTable) {
    title = { kind: 'head' };
  } else if (first && first.bodyParasBefore === 0 && !frameTables.has(first.index) && first.rows <= 2 && first.cols <= 3) {
    const paras = doc.paras.filter((p) => p.table === first.index && visible(p.text));
    const s = modeOf(paras.flatMap((p) => contentShapes(p, 0)), shapeKey);
    const len = paras.reduce((n, p) => n + visible(p.text), 0);
    if (s && len <= 80 && s.pt >= roughBody.pt + 2) {
      title = { kind: 'box', font: s.font, pt: s.pt, bold: s.bold };
      titleText = paras.map((p) => p.text.trim()).join(' ');
      body = body.filter((p) => p.table !== first.index);
    }
  }
  if (title.kind === 'none') {
    const top = body.slice(0, 3).filter((p) => p.tableDepth === 0 && !readMarker(p.text) && visible(p.text) <= 60);
    const big = top.map((p) => ({ p, s: modeOf(contentShapes(p, 0), shapeKey)! })).filter((x) => x.s).sort((a, b) => b.s.pt - a.s.pt)[0];
    if (big && (big.s.pt >= roughBody.pt + 2 || big.p.paraPr.align === 'CENTER')) {
      titlePara = big.p;
      titleText = big.p.text.trim();
      title = { kind: big.p.paraPr.align === 'CENTER' ? 'center' : 'left', font: big.s.font, pt: big.s.pt, bold: big.s.bold };
    }
  }
  if (titlePara) body = body.filter((p) => p !== titlePara);
  const frontTables = new Set(whole.tables.filter((t) => !doc.tables.includes(t)).map((t) => t.index));
  return { body, frontTables, ...(front ? { front } : {}), title, ...(titleText ? { titleText } : {}), ...(headTable ? { headTable } : {}), frameTables, warnings };
}

/** 내용 문서(한글)의 제목 글 — 글자 크기·상자로 찾는다 */
export function titleText(doc: HwpxDoc | null): string | undefined {
  return doc ? analyzeFrame(doc).titleText : undefined;
}

/** markdown = 갈래 짐작에 쓴 kordoc 글 (읽지 못했으면 본문 문단 글) */
export async function extractStyle(path: string, signal?: AbortSignal): Promise<{ format: StyleFormat; warnings: string[]; bytes: Uint8Array; markdown: string }> {
  const bytes = await sampleBytes(path, signal);
  const doc = await readHwpx(bytes);
  const { body, front, title, headTable, frameTables, frontTables, warnings } = analyzeFrame(doc);
  if (!body.length) throw new Error('견본에서 본문 글을 찾지 못했습니다. 본문이 있는 문서를 고르세요.');
  const roughBody = modeOf(body.flatMap((p) => contentShapes(p, 0)), shapeKey) ?? { pt: 10, font: '', bold: false };

  // 항목 기호 단계
  const stack = new DepthStack();
  const buckets = new Map<string, Bucket>();
  const refShapes: Array<{ v: CharShape; w: number }> = [];
  const refGlyphs: Array<{ v: string; w: number }> = [];
  const bodyShapes: Array<{ v: CharShape; w: number }> = [];
  /** 기호 없는 서술 문단 — 생성기의 본문 글꼴·크기는 이 문단(과 정하지 않은 단계)에 쓰인다 */
  const plainShapes: Array<{ v: CharShape; w: number }> = [];
  const spacing: Array<{ v: number; w: number }> = [];
  // 장(Ⅰ. Ⅱ.) — 글 줄 또는 장 띠 표(첫 칸이 로마 숫자)
  const bands = doc.tables.filter((t) => !frameTables.has(t.index) && t.rows <= 2 && /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.?(\s|$)/.test(t.cells.find((c) => c.text.trim())?.text.trim() ?? '')).length;
  let romans = 0;
  let inAttach = false;
  for (const p of body) {
    // 붙임 줄과 그 아래 "      2. …" 이어진 줄은 항목·본문이 아니다 (붙임 모양)
    if (/^[\s\u3000]*붙\s*임/.test(p.text)) { inAttach = true; continue; }
    if (inAttach && /^[\s\u3000]{2,}\d{1,2}\.\s/.test(p.text)) continue;
    inAttach = false;
    const m = readMarker(p.text);
    const skip = m ? leadLen(p.text, m.rest) : 0;
    const shapes = contentShapes(p, skip);
    const w = shapes.reduce((s, x) => s + x.w, 0);
    if (p.paraPr.lineSpacing) spacing.push({ v: p.paraPr.lineSpacing, w });
    if (m?.family === 'ref') {
      refShapes.push(...shapes);
      refGlyphs.push({ v: m.glyph.startsWith('*') ? '*' : '※', w: 1 });
      continue;
    }
    bodyShapes.push(...shapes);
    if (!m) { plainShapes.push(...shapes); continue; }
    if (m.family === 'chapter') { stack.reset(); romans++; continue; }
    const depth = stack.depthOf(m.key);
    const b: Bucket = buckets.get(m.key) ?? { depths: new Map(), glyphs: new Map(), shapes: [], count: 0, family: m.family };
    b.depths.set(depth, (b.depths.get(depth) ?? 0) + 1);
    b.glyphs.set(m.glyph, (b.glyphs.get(m.glyph) ?? 0) + 1);
    b.shapes.push(...shapes);
    b.count++;
    buckets.set(m.key, b);
  }
  const modal = (b: Bucket) => [...b.depths].sort((x, y) => y[1] - x[1])[0][0];
  const markers: string[] = [];
  for (let d = 0; d < 8; d++) {
    const at = [...buckets].filter(([k, b]) => modal(b) === d && !markers.includes(k)).sort((x, y) => y[1].count - x[1].count)[0];
    if (!at) break;
    markers.push(at[0]);
  }
  const total = bodyShapes.reduce((n, x) => n + x.w, 0);
  const plainChars = plainShapes.reduce((n, x) => n + x.w, 0);
  // 서술 문단이 넉넉하면 그 모양이 본문, 거의 다 항목인 문서면 전체 최빈값
  const bodyShape = (plainChars >= Math.max(50, total * 0.3) ? modeOf(plainShapes, shapeKey) : modeOf(bodyShapes, shapeKey)) ?? roughBody;
  const levels: StyleFormat['levels'] = markers.map((k, depth) => {
    const b = buckets.get(k)!;
    const s = modeOf(b.shapes, shapeKey) ?? bodyShape;
    return { depth, marker: k, font: s.font, pt: s.pt, bold: s.bold, count: b.count };
  });
  const scheme: StyleFormat['numbering']['scheme'] = !markers.length ? 'none' : buckets.get(markers[0])!.family === 'legal' ? 'standard' : 'report';
  let bullet2: string | undefined;
  const circle = buckets.get('○');
  if (circle) {
    const g = [...circle.glyphs].sort((x, y) => y[1] - x[1])[0][0].replace(/[●◯]/, '○');
    if ((BULLET2 as readonly string[]).includes(g)) bullet2 = g;
  }

  // 갈래: 문서 모양(kordoc 글) + 기호 체계
  const md = (await parseDoc(path, { images: false, ocr: 'off', signal }).catch(() => null))?.markdown ?? body.map((p) => p.text).join('\n\n');
  let preset: GongmunPreset | undefined = guessPreset(md);
  if (title.kind === 'head') preset = 'official';
  else if ((front?.cover || front?.toc) && scheme === 'report') preset = 'gaejosik';
  else if (!preset) preset = scheme === 'report' ? 'report' : scheme === 'standard' ? 'official' : 'notice';

  // 기안문 두문의 기관 이름: 머리 표에서 가장 큰 짧은 줄 (수신·제목·경유 줄 빼고)
  let head: StyleFormat['head'];
  if (headTable) {
    const cand = doc.paras.filter((p) => p.table === headTable.index && visible(p.text) && visible(p.text) <= 30 && !HEAD_RE.test(p.text.trim()));
    const org = cand.map((p) => ({ p, s: modeOf(contentShapes(p, 0), shapeKey) })).filter((x) => x.s).sort((a, b) => b.s!.pt - a.s!.pt)[0];
    // "금 천 소 방 서" 처럼 한 글자씩 띄운 기관명은 붙인다 (생성기가 두문 기관명을 다시 띄워 쓴다)
    const name = org?.p.text.replace(/\s+/g, ' ').trim();
    if (name) head = { org: name.split(' ').every((t) => t.length === 1) ? name.replace(/ /g, '') : name };
    // 기관 표어: 머리 표에서 기관 이름보다 앞에 오는 작은 글 줄
    // (기관 이름은 "가 온 시" 처럼 짧아서 글자 수 조건은 표어 쪽에만)
    const all = doc.paras.filter((p) => p.table === headTable.index && visible(p.text) && !HEAD_RE.test(p.text.trim()));
    const orgAt = org ? all.indexOf(org.p) : -1;
    const slogan = orgAt > 0 ? all.slice(0, orgAt).find((p) => visible(p.text) > 5 && (modeOf(contentShapes(p, 0), shapeKey)?.pt ?? 99) < org!.s!.pt) : undefined;
    if (slogan && head) head.slogan = slogan.text.replace(/\s+/g, ' ').trim();
  }

  const refShape = modeOf(refShapes, shapeKey);
  const lineSpacing = modeOf(spacing, (v) => String(v)) ?? 160;
  const table = await tableStyle(bytes, doc, new Set([...frameTables, ...frontTables]));
  const w = mm(doc.page.width);
  const h = mm(doc.page.height);
  const format: StyleFormat = {
    version: 1,
    preset,
    paper: { size: paperSize(w, h), width_mm: w, height_mm: h, landscape: doc.page.landscape },
    margins: { top: mm(doc.margins.top), bottom: mm(doc.margins.bottom), left: mm(doc.margins.left), right: mm(doc.margins.right), header: mm(doc.margins.header), footer: mm(doc.margins.footer) },
    body: { font: bodyShape.font, pt: bodyShape.pt, line_spacing: lineSpacing, gothic: isGothic(bodyShape.font, bodyShape.family) },
    numbering: { scheme, markers, ...(bullet2 ? { bullet2 } : {}) },
    levels,
    title,
    ...(refShape ? { ref: { glyph: modeOf(refGlyphs, (v) => v) ?? '※', font: refShape.font, pt: refShape.pt } } : {}),
    page_numbers: doc.pageNumbers,
    ...(front ? { front } : {}),
    ...(bands || romans ? { chapters: { count: bands || romans, style: bands >= romans ? 'band' as const : 'roman' as const } } : {}),
    ...(table ? { table } : {}),
    ...(head ? { head } : {}),
    summary: '',
    stats: { paragraphs: body.length, chars: body.reduce((s, p) => s + visible(p.text), 0), plain_chars: plainChars },
  };
  format.summary = styleSummary(format);
  if (!markers.length) warnings.push('항목 기호(□ ○ 1. 가. 등)를 찾지 못했습니다. 문단 글꼴과 여백만 맞춥니다.');
  return { format, warnings, bytes, markdown: md };
}
