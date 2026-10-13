/** 서식(StyleFormat) + 내용 문서 → 그 서식의 새 HWPX
 *
 * 서식 → kordoc GongmunOptions: 갈래(preset)·여백·용지·본문 글꼴·크기·줄 간격·기호 체계·2단계 기호·단계별 글꼴·쪽 번호.
 * 표 모양은 견본 표에서 읽은 머리 줄·본문 칸 모양으로 내용 문서의 표마다 서식 프로필을 새로 짜서 넘긴다
 * (견본 표의 프로필을 그대로 넘기면 표 차례·앵커가 내용 문서와 안 맞아 적용되지 않는다).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { markdownToHwpx, type BorderFillDef, type FormatProfile, type GongmunOptions, type GongmunPreset } from 'kordoc';
import type { BatchItemResult, StyleFormat, StyleTableCell } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { orgDocFoot } from '../template/org.js';
import { sendProgress } from '../../infra/progress.js';
import { cleanMessage, errorText } from '../errors.js';
import { parseDoc } from '../converter/index.js';
import { formatOf, TEXT_FORMATS } from '../files/format.js';
import { AUTO_FIT } from '../gongmun/index.js';
import { rhwpCompat } from '../gongmun/rhwp-compat.js';
import { outputDir, outputFile, safeFileName, stemOf } from '../output/index.js';
import { rhwpConvert } from '../render/rhwp.js';
import { titleText } from './extract.js';
import { readHwpx } from './hwpx-read.js';
import { mdChunks, normalizeContent, type NormalizedContent } from './normalize.js';

/** 빈 값은 빼고, 다 비면 undefined */
function compact<T extends Record<string, unknown>>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => (Array.isArray(v) ? v.length : v !== undefined && v !== '')));
  return Object.keys(out).length ? (out as T) : undefined;
}

const clampPt = (pt: number) => Math.min(60, Math.max(6, Math.round(pt * 2) / 2));

/** 생성기가 갈래마다 쓰는 머리말·꼬리말 여백(mm, kordoc 4.21.30 실측) — 본문 시작 자리를 맞추려고 위·아래 여백에서 뺀다 */
const PRESET_HF: Record<string, number> = { official: 0, minutes: 0, report: 12.7, plan: 12.7, bangchim: 12.7, notice: 10, press: 10, ministry: 10, gaejosik: 15 };
const REPORT_FAMILY = new Set(['report', 'plan', 'press', 'bangchim', 'ministry', 'gaejosik']);

/** 만들 때 쓸 갈래 — 보고서 계열은 제목을 늘 제목 상자로 그린다. 견본 제목이 상자가 아니면 제목을 가운데 줄로 그리는 통지 틀로 */
export function renderPreset(f: StyleFormat): GongmunPreset {
  if (f.preset !== 'gaejosik' && REPORT_FAMILY.has(f.preset) && f.title.kind !== 'box') return 'notice';
  return f.preset as GongmunPreset;
}

/** 견본 첫 기호가 체계의 몇째 단계인지 (○ 로 시작하는 보고서 = 1, 가. 로 시작하는 기안문 = 1) */
export function depthOffset(f: StyleFormat): number {
  const first = f.numbering.markers[0];
  if (!first) return 0;
  const order = f.numbering.scheme === 'report' ? ['□', '○', '-', 'ㆍ'] : ['1.', '가.', '1)', '가)', '(1)', '(가)', '①', '㉮'];
  return Math.max(0, order.indexOf(first));
}

/** 서식 → kordoc 공문서 옵션 (내용 쪽 값: 기안문 수신·제목) */
export function gongmunOptions(f: StyleFormat, content: { title?: string; to?: string; keptEndMark?: boolean } = {}): GongmunOptions {
  const preset = renderPreset(f);
  const m = f.margins;
  const hf = PRESET_HF[preset] ?? 0;
  const g: GongmunOptions = {
    preset,
    // 본문이 시작하는 자리(위 + 머리말)를 맞춘다: 생성기 머리말 여백만큼 위·아래 여백에서 뺀다
    margins: { top: Math.max(0, m.top + m.header - hf), bottom: Math.max(0, m.bottom + m.footer - hf), left: m.left, right: m.right },
    bodyFont: f.body.gothic ? 'gothic' : 'myeongjo',
    bodyPt: clampPt(f.body.pt),
    lineSpacing: Math.round(f.body.line_spacing),
    pageNumbers: f.page_numbers,
    autoFit: { ...AUTO_FIT },
  };
  const fonts = compact({ body: f.body.font, heading: f.title.font, ref: f.ref?.font, table: f.table?.body.font ?? f.table?.header.font });
  if (fonts) g.fonts = fonts;
  const sizes = compact({ cham: f.ref ? clampPt(f.ref.pt) : undefined, table: f.table?.body.pt ? clampPt(f.table.body.pt) : undefined });
  if (sizes) g.sizes = sizes;
  if (f.numbering.scheme !== 'none') g.numbering = f.numbering.scheme;
  if (f.numbering.bullet2) g.bullet2 = f.numbering.bullet2 as GongmunOptions['bullet2'];
  // 단계별 글꼴: 견본에서 잰 단계 + 더 깊은 단계는 본문 모양 (생성기 기본값이 섞이지 않게)
  const deepest = f.numbering.scheme === 'report' ? 4 : 8;
  const offset = depthOffset(f);
  const levels: NonNullable<GongmunOptions['levels']> = {};
  for (let d = 0; d < deepest; d++) {
    const l = f.levels.find((x) => x.depth === d - offset);
    levels[d] = l ? { font: l.font || f.body.font, pt: clampPt(l.pt), bold: l.bold } : { font: f.body.font, pt: clampPt(f.body.pt), bold: false };
    // kordoc 4.21.30: 보고서 기호 체계에서 단계 크기가 본문 크기와 같으면 지정이 없는 것으로 보고 기본값(□ 본문+2, - ㆍ 본문-1)을 쓴다.
    // 0.01pt 만 비켜 지정이 먹게 한다 (눈에 띄지 않는 차이. kordoc 쪽 고칠 일로 보고)
    if (f.numbering.scheme === 'report' && levels[d].pt === g.bodyPt && d !== 1) levels[d].pt = g.bodyPt! + 0.01;
  }
  g.levels = levels;
  if (f.title.kind === 'center') g.centerTitle = true;
  else if (f.title.kind === 'left') g.centerTitle = false;
  if (f.chapters && preset !== 'official' && preset !== 'gaejosik') g.h2Marker = f.chapters.style === 'band' ? 'band' : 'roman';
  if (preset === 'gaejosik') {
    // 개조식: 표지(기관 이름)·목차는 견본에 있을 때만, 본문 첫 쪽 제목 상자는 견본 제목이 상자일 때만
    g.cover = f.front?.cover ? (f.front.org ? { org: f.front.org } : true) : false;
    g.toc = !!f.front?.toc;
    g.bodyTitleBox = f.title.kind === 'box';
  }
  if (preset === 'official') {
    // 두문 행정기관명은 내 기관 이름이 먼저 (견본 기관 이름·표어는 기관 정보가 없을 때만 — 남의 기관 이름으로 시행하지 않게)
    const org = getSettings().org;
    const own = org.name?.trim();
    if (f.title.kind === 'head') g.docHead = compact({ org: own || f.head?.org, slogan: own ? undefined : f.head?.slogan, to: content.to ?? '내부결재', title: content.title });
    // 끝 표시는 글 정리 단계에서 마지막 줄 끝에 둔다 (생성기 자동 끝 표시는 늘 따로 한 줄)
    if (content.keptEndMark) g.endMark = false;
    if (f.title.kind === 'head') g.docFoot = orgDocFoot(org) ?? {};
  }
  return g;
}

const border = (b: StyleTableCell['border'] | undefined) => (b ? { type: b.type, width: b.width, color: b.color } : { type: 'SOLID', width: '0.12 mm', color: '#000000' });

/** 내용 문서 표마다(차례대로) 견본 표 모양 프로필 — 머리 줄은 header, 나머지는 body, 바깥 변은 outer */
export function tableProfile(f: StyleFormat, tables: Array<{ rows: number; cols: number }>): FormatProfile | undefined {
  const t = f.table;
  if (!t || !tables.length) return undefined;
  const fills: Record<string, BorderFillDef> = {};
  const chars: NonNullable<FormatProfile['tables'][number]['used_char_prs']> = {};
  const charOf = (c: StyleTableCell) => ({ ...(c.pt ? { height_hwpunit: String(Math.round(c.pt * 100)) } : {}), ...(c.bold ? { bold: true } : {}), ...(c.font ? { fontName_hangul: c.font } : {}) });
  chars.h = charOf(t.header);
  chars.b = charOf(t.body);
  const fillKey = (head: boolean, top: boolean, bottom: boolean, left: boolean, right: boolean) => {
    const key = `${head ? 'h' : 'b'}${+top}${+bottom}${+left}${+right}`;
    if (!fills[key]) {
      const cell = head ? t.header : t.body;
      const inner = border(cell.border ?? t.body.border);
      const outer = t.outer ? border(t.outer) : inner;
      fills[key] = {
        leftBorder: left ? outer : inner,
        rightBorder: right ? outer : inner,
        topBorder: top ? outer : inner,
        bottomBorder: bottom ? outer : head && t.header.border ? border(t.header.border) : inner,
        // 견본 칸에 음영이 없으면 흰색을 적어 둔다 (안 적으면 생성기가 기본 머리 줄 음영을 깐다)
        fill: { faceColor: cell.fill ?? '#FFFFFF' },
      };
    }
    return key;
  };
  return {
    tables: tables.map((tb, table_index) => {
      const cells: FormatProfile['tables'][number]['cells'] = [];
      for (let r = 0; r < tb.rows; r++) {
        for (let c = 0; c < tb.cols; c++) {
          const head = r === 0 && tb.rows > 1;
          cells.push({ row: r, col: c, borderFillIDRef: fillKey(head, r === 0, r === tb.rows - 1, c === 0, c === tb.cols - 1), charPrIDRef: head ? 'h' : 'b' });
        }
      }
      return { table_index, rows: tb.rows, cols: tb.cols, cells, used_border_fills: fills, used_char_prs: chars };
    }),
  };
}

/** 마크다운에 실제로 남은 표의 줄·칸 수 (생성기가 표를 세는 차례와 같게 — kordoc 글은 1칸 표 일부를 글로 풀어서 블록 표 차례와 다르다) */
export function markdownTables(md: string): Array<{ rows: number; cols: number }> {
  const out: Array<{ rows: number; cols: number }> = [];
  for (const chunk of mdChunks(md)) {
    let t = chunk.trim();
    if (/^<table/i.test(t)) {
      // 칸 안의 표(중첩)는 바깥 표의 줄·칸이 아니다 → 안쪽 표부터 지운다
      while ((t.match(/<table\b/gi) ?? []).length > 1) t = t.replace(/<table\b[^>]*>(?:(?!<table\b)[\s\S])*?<\/table>/i, '');
      // 칸 합치기(rowspan·colspan)까지 격자로 세기
      const taken: boolean[][] = [];
      let rows = 0;
      let cols = 0;
      for (const [r, tr] of [...t.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m, i) => [i, m[1]] as const)) {
        rows = r + 1;
        let c = 0;
        for (const cell of tr.matchAll(/<t[hd]\b([^>]*)>/gi)) {
          while (taken[r]?.[c]) c++;
          const cs = Number(/colspan="?(\d+)/i.exec(cell[1])?.[1] ?? 1);
          const rs = Number(/rowspan="?(\d+)/i.exec(cell[1])?.[1] ?? 1);
          for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) (taken[y] ??= [])[x] = true;
          c += cs;
          cols = Math.max(cols, c);
        }
      }
      if (rows) out.push({ rows, cols });
    } else if (/^\|/.test(t)) {
      const lines = t.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
      const body = lines.filter((l) => !/^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?$/.test(l));
      if (body.length) out.push({ rows: body.length, cols: body[0].replace(/^\||\|$/g, '').split('|').length });
    }
  }
  return out;
}

/** 내용 문서 하나 → 그 서식의 HWPX 바이트 */
export async function restyle(path: string, f: StyleFormat, signal?: AbortSignal): Promise<{ bytes: Uint8Array; content: NormalizedContent; warnings: string[] }> {
  const fmt = formatOf(path);
  const r = await parseDoc(path, { images: true, signal });
  if (!r.markdown.trim()) throw new Error('문서에서 글자를 찾지 못했습니다. 스캔본이면 설정에서 글자 읽기(OCR)를 켜고 다시 시도하세요.');
  // 한글 문서는 글자 크기로 제목 줄을 찾아 둔다 (kordoc 글에는 제목 표시가 없다)
  let titleHint: string | undefined;
  if (fmt === 'hwpx' || fmt === 'hwp') {
    const raw = new Uint8Array(await readFile(path));
    const bytes = fmt === 'hwp' ? await rhwpConvert(raw, 'hwpx', signal).catch(() => null) : raw;
    if (bytes) titleHint = titleText(await readHwpx(bytes).catch(() => null));
  }
  const r2 = await generateStyled(f, r.markdown, { titleHint, textSource: TEXT_FORMATS.has(fmt) || fmt === 'docx', images: Object.fromEntries((r.images ?? []).map((i) => [i.filename, i.data])) });
  return r2;
}

/** 글(kordoc 마크다운) → 그 서식의 HWPX (미리보기도 같은 길로) */
export async function generateStyled(
  f: StyleFormat,
  markdown: string,
  opts: { titleHint?: string; textSource?: boolean; images?: Record<string, Uint8Array> } = {},
): Promise<{ bytes: Uint8Array; content: NormalizedContent; warnings: string[] }> {
  const keepEndMark = renderPreset(f) === 'official';
  const content = normalizeContent(markdown, { titleHint: opts.titleHint, textSource: opts.textSource, headingsAsItems: !f.chapters, depthOffset: keepEndMark ? 0 : depthOffset(f), keepEndMark, legalDepth: keepEndMark });
  const gongmun = gongmunOptions(f, { ...content, keptEndMark: keepEndMark });
  // 기안문 두문에 제목을 넣으면 본문 제목 줄은 뺀다
  let md = content.markdown;
  if (gongmun.docHead?.title) md = md.replace(/^# .*\n+/, '');
  const profile = tableProfile(f, markdownTables(md));
  const warnings: string[] = [];
  const buf = await markdownToHwpx(md, {
    gongmun,
    page: { size: f.paper.size === 'custom' ? { widthMm: f.paper.width_mm, heightMm: f.paper.height_mm } : f.paper.size, orientation: f.paper.landscape ? 'landscape' : 'portrait' },
    ...(profile ? { profile } : {}),
    ...(opts.images && Object.keys(opts.images).length ? { images: opts.images } : {}),
    warnings,
  });
  // 요약 상자·문체 안내는 새로 쓰는 보고서용이라 서식 맞추기에선 뺀다 (원문 글을 그대로 옮긴다)
  const useful = warnings.map(cleanMessage).filter((w) => !/요약\s*박스|요약 상자|summary|문체|종결/.test(w));
  return { bytes: await rhwpCompat(buf), content, warnings: [...new Set(useful)] };
}

export async function applyStyle(
  p: { source_paths: string[]; format: StyleFormat; output_dir?: string },
  signal?: AbortSignal,
): Promise<{ results: BatchItemResult[]; output_dir: string }> {
  const results: BatchItemResult[] = [];
  for (const [i, path] of p.source_paths.entries()) {
    signal?.throwIfAborted();
    sendProgress({ current: i + 1, total: p.source_paths.length, message: `${basename(path)} 서식 맞추는 중 (${i + 1}/${p.source_paths.length})` });
    try {
      const r = await restyle(path, p.format, signal);
      const out = outputFile({ output_dir: p.output_dir, source: path, name: `${safeFileName(stemOf(path))}_우리서식.hwpx` });
      await writeFile(out, r.bytes);
      results.push({ path, ok: true, output_path: out, ...(r.warnings.length ? { note: r.warnings[0] } : {}) });
    } catch (err) {
      if (signal?.aborted) throw err;
      results.push({ path, ok: false, error: errorText(err) });
    }
  }
  return { results, output_dir: outputDir({ output_dir: p.output_dir, source: p.source_paths[0] }) };
}
