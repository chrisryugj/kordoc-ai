/** 서식 두 개 대조 (충실도 재기) — 견본 서식 A 와, A 로 만든 결과에서 다시 읽은 서식 B 를 항목마다 같은지 본다
 *
 * 여백은 본문이 시작하는 자리(위 + 머리말, 아래 + 꼬리말)로 잰다: 생성기는 머리말·꼬리말 여백을 0 으로 쓰고 위·아래에 더한다.
 * 단계는 둘 다 있는 단계만 잰다(내용 문서에 셋째 단계가 없으면 결과에도 없다).
 */

import type { StyleFormat } from '../../types/rpc-contract.js';
import { DepthStack, readMarker } from './markers.js';
import { mdChunks } from './normalize.js';

export interface FieldCheck {
  field: string;
  ok: boolean;
  want: string;
  got: string;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

export function compareFormats(want: StyleFormat, got: StyleFormat): FieldCheck[] {
  const out: FieldCheck[] = [];
  const add = (field: string, ok: boolean, w: unknown, g: unknown) => out.push({ field, ok, want: String(w), got: String(g) });
  add('paper', want.paper.size === got.paper.size && want.paper.landscape === got.paper.landscape, `${want.paper.size}${want.paper.landscape ? ' 가로' : ''}`, `${got.paper.size}${got.paper.landscape ? ' 가로' : ''}`);
  const wm = want.margins;
  const gm = got.margins;
  add('margin.top', near(wm.top + wm.header, gm.top + gm.header, 0.6), wm.top + wm.header, gm.top + gm.header);
  add('margin.bottom', near(wm.bottom + wm.footer, gm.bottom + gm.footer, 0.6), wm.bottom + wm.footer, gm.bottom + gm.footer);
  add('margin.left', near(wm.left, gm.left, 0.6), wm.left, gm.left);
  add('margin.right', near(wm.right, gm.right, 0.6), wm.right, gm.right);
  // 본문(서술 문단) 모양은 둘 다 서술 문단이 있을 때만 잰다 — 항목뿐인 결과는 본문 대신 단계 모양으로 잰다
  const plain = (f: StyleFormat) => (f.stats.plain_chars ?? 0) >= Math.max(50, f.stats.chars * 0.3);
  if (plain(want) && plain(got)) {
    add('body.font', want.body.font === got.body.font, want.body.font, got.body.font);
    add('body.pt', near(want.body.pt, got.body.pt, 0.25), want.body.pt, got.body.pt);
  }
  add('body.line_spacing', near(want.body.line_spacing, got.body.line_spacing, 1), want.body.line_spacing, got.body.line_spacing);
  add('numbering.scheme', want.numbering.scheme === got.numbering.scheme || got.numbering.scheme === 'none', want.numbering.scheme, got.numbering.scheme);
  const glyph = (f: StyleFormat, k: string) => (k === '○' ? f.numbering.bullet2 ?? '○' : k);
  const depths = Math.min(want.numbering.markers.length, got.numbering.markers.length);
  for (let d = 0; d < depths; d++) {
    const wk = glyph(want, want.numbering.markers[d]);
    const gk = glyph(got, got.numbering.markers[d]);
    add(`marker.${d}`, wk === gk, wk, gk);
    const wl = want.levels.find((l) => l.depth === d);
    const gl = got.levels.find((l) => l.depth === d);
    if (wl && gl) {
      add(`level.${d}.font`, wl.font === gl.font, wl.font, gl.font);
      add(`level.${d}.pt`, near(wl.pt, gl.pt, 0.25), wl.pt, gl.pt);
      add(`level.${d}.bold`, wl.bold === gl.bold, wl.bold, gl.bold);
    }
  }
  // 견본에 제목 줄이 없어도 내용 문서의 제목은 넣는다 → 견본에 제목이 있을 때만 잰다
  if (want.title.kind !== 'none') add('title.kind', want.title.kind === got.title.kind, want.title.kind, got.title.kind);
  add('page_numbers', want.page_numbers === got.page_numbers, want.page_numbers, got.page_numbers);
  if (want.front) {
    add('front.cover', want.front.cover === !!got.front?.cover, want.front.cover, !!got.front?.cover);
    add('front.toc', want.front.toc === !!got.front?.toc, want.front.toc, !!got.front?.toc);
  }
  if (want.table && got.table) {
    add('table.header.fill', (want.table.header.fill ?? '') === (got.table.header.fill ?? ''), want.table.header.fill ?? '없음', got.table.header.fill ?? '없음');
    add('table.body.font', (want.table.body.font ?? '') === (got.table.body.font ?? ''), want.table.body.font, got.table.body.font);
    add('table.body.pt', near(want.table.body.pt ?? 0, got.table.body.pt ?? 0, 0.25), want.table.body.pt, got.table.body.pt);
  }
  return out;
}

/** 문서 구조 (내용이 제자리에 옮겨졌는지 재기) — kordoc 이 읽은 글(마크다운)에서 센다. 원문과 결과를 같은 규칙으로 잰다 */
export interface DocStructure {
  /** 기안문 제목 줄 또는 첫 # 제목 */
  title?: string;
  /** 기안문 수신 */
  to?: string;
  /** 항목(기호 있는 문단·장 제목) 수와 그중 첫 단계 수 */
  items: number;
  top: number;
  /** 붙임 줄 수 (붙임  1. … 2. … 면 2) */
  attach: number;
  /** 끝 표시: 마지막 줄 끝에 붙음 / 혼자 한 줄 / 없음 */
  end: 'line-end' | 'alone' | 'none';
  /** 두문·결문 표를 뺀 표 수 */
  tables: number;
  /** 끝 표시(또는 결문) 바로 앞이 표·그림 */
  endsWithTable: boolean;
}

/** 두문(수신·제목 칸) 또는 결문(시행·접수·전화 칸 둘 이상) 표 */
function frameTable(html: string): boolean {
  const cells = html.split(/<t[hd][^>]*>|<br\s*\/?>|\n|\|/i).map((x) => x.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  if (cells.some((x) => /^수\s*신/.test(x)) && cells.some((x) => /^제\s*목/.test(x))) return true;
  return cells.filter((x) => /^(시\s*행|접\s*수|협\s*조\s*자|전\s*화|전\s*송|우\s*\d{3})/.test(x)).length >= 2;
}
const FOOT_LINE = /^(시\s*행\b|접\s*수\b|협\s*조\s*자|우\s*\d{3}|전\s*화|전\s*송|공개\s*구분|\/\s*(비|부분)?공개)/;
const END_MARK = /(?:^|\s|(?<=\.))끝\s*\.?\s*$/;

export function docStructure(md: string): DocStructure {
  const lines: string[] = [];
  let tables = 0;
  /** 마지막으로 나온 덩이가 표·그림이었는지 (끝 표시·결문 줄 전까지) */
  let tail: 'table' | 'text' = 'text';
  let closed = false;
  for (const chunk of mdChunks(md)) {
    const c = chunk.trim();
    if (!c) continue;
    if (/^(<table|\|)/i.test(c)) {
      if (!frameTable(c)) { tables++; if (!closed) tail = 'table'; }
      continue;
    }
    // 그림도 표처럼 덩이 (그림으로 끝나면 끝 표시는 다음 줄)
    if (/^!\[/.test(c)) { if (!closed) tail = 'table'; continue; }
    const ls = chunk.split('\n').filter((l) => l.trim());
    if (!closed && ls.some((l) => !FOOT_LINE.test(l.trim()) && !/^\s*끝\s*\.?\s*$/.test(l))) tail = 'text';
    if (ls.some((l) => END_MARK.test(l) || FOOT_LINE.test(l.trim()))) closed = true;
    lines.push(...ls);
  }
  const s: DocStructure = { items: 0, top: 0, attach: 0, end: 'none', tables, endsWithTable: tail === 'table' };
  const titleLine = lines.find((l) => /^\s*제\s*목\s*[:：]?\s*\S/.test(l));
  s.title = titleLine?.replace(/^\s*제\s*목\s*[:：]?\s*/, '').trim() ?? /^#\s+(.+)$/m.exec(md)?.[1].trim();
  const toLine = lines.find((l) => /^\s*수\s*신(자)?\s*[:：]?\s*\S/.test(l));
  if (toLine) s.to = toLine.replace(/^\s*수\s*신(자)?\s*[:：]?\s*/, '').replace(/\(\s*경\s*유\s*\).*$/, '').trim();
  const endAt = lines.map((l) => END_MARK.test(l)).lastIndexOf(true);
  if (endAt >= 0) s.end = /^\s*끝\s*\.?\s*$/.test(lines[endAt]) ? 'alone' : 'line-end';
  const body = endAt >= 0 ? lines.slice(0, endAt + 1) : lines.filter((l) => !FOOT_LINE.test(l.trim()));
  const stack = new DepthStack();
  let inAttach = false;
  let attachNo = 0;
  for (const raw of body) {
    const l = raw.trim().replace(/^\*\*(.*)\*\*$/, '$1');
    if (/^(수\s*신|\(?\s*경\s*유|제\s*목)/.test(l) || /^#\s/.test(l)) continue;
    const att = /^(?:[-*+]\s+)?붙\s*임\s*[:：]?\s*(.*)$/.exec(l);
    if (att) {
      inAttach = true;
      s.attach++;
      attachNo = /^1\.\s/.test(att[1]) ? 1 : 0;
      continue;
    }
    const num = /^(\d{1,2})\.\s/.exec(l);
    if (inAttach && num && attachNo && Number(num[1]) === attachNo + 1) { attachNo++; s.attach++; continue; }
    inAttach = false;
    const wrapped = /^[-*+]\s+(.*)$/.exec(l);
    const text = wrapped && readMarker(wrapped[1]) ? wrapped[1] : l;
    const h = /^(#{2,6})\s/.exec(text);
    const m = readMarker(text.replace(/^(\d{1,2})\\\./, '$1.'));
    const key = h ? `#${h[1].length}` : m && m.family !== 'ref' ? (m.family === 'chapter' ? '#2' : m.key) : wrapped ? 'md' : null;
    if (!key) continue;
    const d = stack.depthOf(key);
    s.items++;
    if (d === 0) s.top++;
  }
  return s;
}

/** 원문 구조와 결과 구조 대조. official = 기안문 서식(끝 표시·수신이 남아야 함) */
export function compareStructure(src: DocStructure, out: DocStructure, opts: { official: boolean; outText: string }): FieldCheck[] {
  const c: FieldCheck[] = [];
  const add = (field: string, ok: boolean, w: unknown, g: unknown) => c.push({ field, ok, want: String(w), got: String(g) });
  const flat = (t: string) => t.replace(/[\s*\\_`]/g, '');
  if (src.title) add('s.title', flat(opts.outText).includes(flat(src.title)), src.title, out.title ?? '');
  if (opts.official && src.to) add('s.to', out.to === src.to, src.to, out.to ?? '');
  add('s.items', src.items === out.items, src.items, out.items);
  add('s.top', src.top === out.top, src.top, out.top);
  add('s.attach', src.attach === out.attach, src.attach, out.attach);
  // 기안문 서식: 끝 표시가 있어야 하고(원문에 없으면 붙인다) 원문이 표 다음 줄이면 그대로, 아니면 마지막 줄 끝. 다른 서식은 쓰지 않는다
  const wantEnd = opts.official ? (src.end === 'alone' || src.endsWithTable ? 'alone' : 'line-end') : 'none';
  add('s.end', out.end === wantEnd, wantEnd, out.end);
  add('s.tables', src.tables === out.tables, src.tables, out.tables);
  return c;
}
