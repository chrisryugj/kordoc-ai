/** PDF 용량 줄이기 (pdf_shrink) — 결재 첨부 한도에 맞춘다
 *
 * 1) 그림만 줄인다: PDF 속 그림을 긴 변 상한까지 줄이고 JPEG 로 다시 압축한다. 글자·선·표는 그대로라 복사·검색이 된다.
 *    손대지 않는 그림: 마스크 자체(ImageMask)·색 키 Mask 배열·/Decode·CMYK·Indexed 등 RGB/회색이 아닌 색 공간·8비트가 아닌 것(1비트 스캔·JBIG2·CCITT 는 이미 작다)·
 *    JPEG2000(JPX, 풀 수 없음). 따로 든 마스크 그림(Mask·SMask 스트림)은 크기가 달라도 되어 그림만 줄인다.
 *    다시 압축한 것이 원래보다 거의 안 작으면 원래 것을 둔다.
 * 2) 한도(target_mb)를 주면 가볍게 → 보통 → 강하게 순서로 한도 안에 들 때까지 올린다.
 * 3) 그래도 넘고 allow_raster 면 쪽마다 그림으로 다시 만든다(글자 복사·검색이 안 된다 — 사용자가 켰을 때만).
 * 한글·워드 등은 PDF로 바꾼 뒤 줄인다(export 의 docToPdf).
 */

import { writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from 'pdf-lib';
import { docToPdf } from '../export/index.js';
import { openPdf, rasterPdfPage } from '../render/pdfium.js';
import { outputFile, stemOf } from '../output/index.js';
import { sendProgress } from '../../infra/progress.js';
import type { PdfShrinkLevel, PdfShrinkResult } from '../../types/rpc-contract.js';

export type ShrinkLevel = PdfShrinkLevel;

/** 단계별 그림 긴 변 상한(px)과 JPEG 화질 — A4 긴 변 기준 약 300·150·100dpi */
export const LEVELS: Record<ShrinkLevel, { maxPx: number; quality: number; label: string }> = {
  light: { maxPx: 3508, quality: 85, label: '가볍게' },
  normal: { maxPx: 1754, quality: 72, label: '보통' },
  strong: { maxPx: 1170, quality: 55, label: '강하게' },
};
const ORDER: ShrinkLevel[] = ['light', 'normal', 'strong'];
/** 쪽을 그림으로: 해상도(dpi)·화질 — 앞 것으로 한도를 못 맞추면 뒤 것으로 */
const RASTER_STEPS = [{ dpi: 150, quality: 70 }, { dpi: 110, quality: 55 }];
const RASTER_HINT = '첨부 한도를 고르고 "쪽을 그림으로 바꿔서라도 줄이기"를 켜면 줄일 수 있습니다.';

export interface ShrinkParams {
  path: string;
  level?: ShrinkLevel;
  /** 첨부 한도(MB) — 주면 한도 안에 들 때까지 단계를 올린다 */
  target_mb?: number;
  /** 그래도 넘으면 쪽을 그림으로 (글자 복사·검색 안 됨) */
  allow_raster?: boolean;
  output_path?: string;
  output_dir?: string;
}

export type ShrinkResult = PdfShrinkResult;

const MB = 1024 * 1024;
const name = (o: PDFObject | undefined): string | undefined => (o instanceof PDFName ? o.decodeText() : undefined);
const num = (o: PDFObject | undefined): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined);

/** 그림의 채널 수 — RGB 3·회색 1, 그 밖(CMYK·Indexed·Lab·Separation …)은 null */
function channelsOf(doc: PDFDocument, cs: PDFObject | undefined): 1 | 3 | null {
  const v = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  const n = name(v);
  if (n === 'DeviceRGB' || n === 'CalRGB') return 3;
  if (n === 'DeviceGray' || n === 'CalGray') return 1;
  if (v instanceof PDFArray && name(v.get(0)) === 'ICCBased') {
    const icc = doc.context.lookup(v.get(1));
    const N = icc instanceof PDFRawStream ? num(icc.dict.get(PDFName.of('N'))) : undefined;
    return N === 3 ? 3 : N === 1 ? 1 : null;
  }
  if (v instanceof PDFArray && (name(v.get(0)) === 'CalRGB' || name(v.get(0)) === 'CalGray')) return name(v.get(0)) === 'CalRGB' ? 3 : 1;
  return null;
}

/** PNG 예측자(Predictor 10~15) 풀기 — 8비트 한정 */
export function unpredictPng(data: Buffer, columns: number, colors: number): Buffer | null {
  const rowLen = columns * colors;
  if (data.length % (rowLen + 1)) return null;
  const rows = data.length / (rowLen + 1);
  const out = Buffer.alloc(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const f = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const x = data[src + i];
      const a = i >= colors ? out[dst + i - colors] : 0;
      const b = r ? out[dst - rowLen + i] : 0;
      const c = r && i >= colors ? out[dst - rowLen + i - colors] : 0;
      let v: number;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else return null;
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}

/** 그림 하나를 다시 압축 — 바꿀 수 없거나 이득이 없으면 null */
async function shrinkImage(doc: PDFDocument, ref: PDFRef, s: PDFRawStream, lvl: { maxPx: number; quality: number }): Promise<Buffer | null> {
  const sharp = (await import('sharp')).default;
  const d = s.dict;
  // 색 키 마스크(Mask 배열)는 정확한 색 값에 걸려 JPEG 로 바꾸면 깨진다. 따로 든 마스크 그림(Mask·SMask 스트림)은 크기가 달라도 되므로 둔 채 줄인다
  if (d.get(PDFName.of('ImageMask'))?.toString() === 'true' || d.get(PDFName.of('Mask')) instanceof PDFArray || d.has(PDFName.of('Decode'))) return null;
  if (num(d.get(PDFName.of('BitsPerComponent'))) !== 8) return null;
  const w = num(d.get(PDFName.of('Width')));
  const h = num(d.get(PDFName.of('Height')));
  if (!w || !h) return null;
  const ch = channelsOf(doc, d.get(PDFName.of('ColorSpace')));
  if (!ch) return null;
  let filters = d.get(PDFName.of('Filter'));
  const filterArray = filters instanceof PDFArray;
  if (filters instanceof PDFArray) filters = filters.size() === 1 ? filters.get(0) : undefined;
  const filter = name(filters);
  let input: ReturnType<typeof sharp>;
  if (filter === 'DCTDecode') {
    // ColorTransform 같은 해독 인자가 든 JPEG 는 그대로 풀면 색이 달라진다
    if (d.has(PDFName.of('DecodeParms'))) return null;
    input = sharp(Buffer.from(s.contents));
    // 적힌 색 공간과 JPEG 의 실제 채널이 다르면(CMYK JPEG 에 DeviceRGB 등) 손대지 않는다
    if ((await input.metadata()).channels !== ch) return null;
  } else if (filter === 'FlateDecode') {
    let px: Buffer | null = inflateSync(Buffer.from(s.contents));
    let parms = d.lookup(PDFName.of('DecodeParms'));
    // 필터가 배열일 때만 해독 인자도 배열로 짝을 이룬다(이름 하나에 배열은 규격 밖이라 뷰어마다 다르게 그린다)
    if (parms instanceof PDFArray) parms = filterArray && parms.size() === 1 ? d.context.lookup(parms.get(0)) : undefined;
    if (d.has(PDFName.of('DecodeParms')) && !(parms instanceof PDFDict)) return null;
    const pred = parms instanceof PDFDict ? num(parms.get(PDFName.of('Predictor'))) ?? 1 : 1;
    if (pred >= 10) {
      const cols = parms instanceof PDFDict ? num(parms.get(PDFName.of('Columns'))) ?? w : w;
      const colors = parms instanceof PDFDict ? num(parms.get(PDFName.of('Colors'))) ?? ch : ch;
      if (cols !== w || colors !== ch) return null;
      px = unpredictPng(px, w, ch);
    } else if (pred !== 1) return null; // TIFF 예측자 등
    if (!px || px.length !== w * h * ch) return null;
    input = sharp(px, { raw: { width: w, height: h, channels: ch } });
  } else return null;

  const scale = Math.min(1, lvl.maxPx / Math.max(w, h));
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  let img = scale < 1 ? input.resize(nw, nh, { fit: 'fill' }) : input;
  // JPEG 안 색 프로필(Display P3 등)을 sRGB 로 바꾸지 않는다 — PDF 뷰어는 그 프로필을 무시하고 /ColorSpace 로 그려서 색 값이 바뀌면 색이 달라진다
  img = ch === 1 ? img.toColourspace('b-w') : img.keepIccProfile();
  const out = await img.jpeg({ quality: lvl.quality, mozjpeg: true }).toBuffer();
  // 줄인 것이 원래의 90% 를 넘으면 이득이 작다 — 화질만 떨어뜨리지 않게 둔다
  if (out.length >= s.contents.length * 0.9) return null;
  const meta = await sharp(out).metadata();
  if ((meta.channels ?? ch) !== ch) return null;
  const nd = d.clone(doc.context);
  nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  nd.delete(PDFName.of('DecodeParms'));
  nd.set(PDFName.of('Width'), PDFNumber.of(meta.width ?? nw));
  nd.set(PDFName.of('Height'), PDFNumber.of(meta.height ?? nh));
  nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  doc.context.assign(ref, PDFRawStream.of(nd, out));
  return out;
}

/** 그림만 줄인 PDF 바이트 */
async function shrinkImages(bytes: Uint8Array, level: ShrinkLevel, signal?: AbortSignal): Promise<{ bytes: Uint8Array; images: number; shrunk: number; skippedBytes: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const lvl = LEVELS[level];
  const imgs = doc.context.enumerateIndirectObjects()
    .filter((e): e is [PDFRef, PDFRawStream] => e[1] instanceof PDFRawStream && name(e[1].dict.get(PDFName.of('Subtype'))) === 'Image');
  // 투명도·가림 마스크(SMask·Mask 스트림)는 손대지 않는다 — 직인처럼 가장자리가 0/255 로 딱 떨어지는 알파가 JPEG 에서 번진다.
  // Matte 가 있는 SMask 는 부모 그림과 크기가 같아야 하므로 그 부모도 둔다
  const masks = new Set<string>();
  const matteParents = new Set<PDFRawStream>();
  for (const [, o] of imgs) {
    for (const k of ['SMask', 'Mask']) {
      const m = o.dict.get(PDFName.of(k));
      if (!(m instanceof PDFRef)) continue;
      masks.add(m.toString());
      const ms = doc.context.lookup(m);
      if (ms instanceof PDFRawStream && ms.dict.has(PDFName.of('Matte'))) matteParents.add(o);
    }
  }
  let images = 0;
  let shrunk = 0;
  let skippedBytes = 0;
  for (const [ref, obj] of imgs) {
    if (masks.has(ref.toString())) continue;
    signal?.throwIfAborted();
    images++;
    let done = false;
    if (!matteParents.has(obj)) {
      try {
        done = !!(await shrinkImage(doc, ref, obj, lvl));
      } catch { /* 풀지 못한 그림은 그대로 둔다 */ }
    }
    if (done) shrunk++;
    else if (obj.contents.length > 100 * 1024) skippedBytes += obj.contents.length;
    if (images % 20 === 0) sendProgress({ current: images, total: imgs.length - masks.size, message: `그림 줄이는 중 (${images}개)` });
  }
  // PDF/A-1 은 객체 묶음(object stream)을 허용하지 않는다 — 기록물 원본의 규격을 깨지 않게 그대로 쓴다
  const pdfa1 = /pdfaid:part(?:>\s*|="\s*)1/.test(Buffer.from(bytes).toString('latin1'));
  return { bytes: await doc.save({ useObjectStreams: !pdfa1 }), images, shrunk, skippedBytes };
}

/** 쪽마다 그림으로 — 글자 복사·검색이 안 된다 */
async function rasterize(bytes: Uint8Array, step: { dpi: number; quality: number }, signal?: AbortSignal): Promise<Uint8Array> {
  const src = await openPdf(bytes).catch((err: unknown) => {
    if (err instanceof Error && /암호/.test(err.message)) throw new Error('열기 암호가 걸린 PDF는 줄일 수 없습니다. 암호를 푼 사본을 저장해 다시 해 보세요.');
    throw err;
  });
  try {
    const out = await PDFDocument.create();
    const n = src.getPageCount();
    for (let i = 1; i <= n; i++) {
      signal?.throwIfAborted();
      const { originalWidth } = src.getPage(i - 1).getOriginalSize();
      const r = await rasterPdfPage(src, i, Math.round((originalWidth / 72) * step.dpi), 'jpeg', step.quality);
      const pic = await out.embedJpg(r.data);
      out.addPage([r.width, r.height]).drawImage(pic, { x: 0, y: 0, width: r.width, height: r.height });
      sendProgress({ current: i, total: n, message: `쪽을 그림으로 바꾸는 중 (${i}/${n}쪽)` });
    }
    return await out.save({ useObjectStreams: true });
  } finally {
    src.destroy();
  }
}

const mb = (b: number) => (b >= MB ? `${(b / MB).toFixed(b < 10 * MB ? 1 : 0)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

export async function pdfShrink(p: ShrinkParams, signal?: AbortSignal): Promise<ShrinkResult> {
  const target = p.target_mb && p.target_mb > 0 ? p.target_mb * MB : undefined;
  const isPdf = /\.pdf$/i.test(p.path);
  const source = await docToPdf(p.path, signal);
  const before = source.length;
  const startAt = ORDER.indexOf(p.level ?? (target ? 'light' : 'normal'));
  if (startAt < 0) throw new Error('단계는 가볍게·보통·강하게 가운데 하나를 고르세요.');
  const signed = /\/ByteRange\s*\[/.test(Buffer.from(source).toString('latin1'));
  // 이미 한도 안이면 화질을 깎은 사본을 만들지 않는다 (한글·워드는 PDF 로 바꾼 것을 그대로 저장)
  if (target && before <= target) {
    if (isPdf) {
      return { output_path: null, before_bytes: before, after_bytes: before, level_used: null, images: 0, images_shrunk: 0, under_target: true, text_kept: true, note: `이미 한도 ${p.target_mb}MB 안(${mb(before)})이라 줄이지 않았습니다.` };
    }
    const outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stemOf(p.path)}.pdf` });
    await writeFile(outPath, source);
    return { output_path: outPath, before_bytes: before, after_bytes: before, level_used: null, images: 0, images_shrunk: 0, under_target: true, text_kept: true, note: `PDF로 바꿨습니다(${mb(before)}). 이미 한도 안이라 더 줄이지 않았습니다.` };
  }

  let best = { bytes: source, level: null as ShrinkResult['level_used'], images: 0, shrunk: 0, skippedBytes: 0 };
  let loaded = true;
  for (const level of ORDER.slice(startAt, target ? undefined : startAt + 1)) {
    let r: Awaited<ReturnType<typeof shrinkImages>>;
    try {
      r = await shrinkImages(source, level, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      // 보안 설정·손상으로 구조를 못 고치는 PDF — 그림으로 바꾸기만 남는다
      loaded = false;
      break;
    }
    if (r.bytes.length < best.bytes.length) best = { bytes: r.bytes, level, images: r.images, shrunk: r.shrunk, skippedBytes: r.skippedBytes };
    else best = { ...best, images: r.images, skippedBytes: r.skippedBytes };
    if (!target || best.bytes.length <= target) break;
  }

  let textKept = true;
  if (p.allow_raster && target && best.bytes.length > target) {
    for (const step of RASTER_STEPS) {
      const r = await rasterize(source, step, signal);
      if (r.length < best.bytes.length) { best = { ...best, bytes: r, level: 'raster' }; textKept = false; }
      if (best.bytes.length <= target) break;
    }
  }

  const after = best.bytes.length;
  const underTarget = target ? after <= target : null;
  // 원래 PDF 를 거의 못 줄였으면 같은 파일을 하나 더 만들지 않는다 (한글·워드는 PDF 로 바꾼 것 자체가 결과라 저장)
  if (isPdf && after >= before * 0.98) {
    return {
      output_path: null, before_bytes: before, after_bytes: before, level_used: null, images: best.images, images_shrunk: 0, under_target: target ? before <= target : null, text_kept: true,
      note: !loaded
        ? `보안 설정이 걸렸거나 구조를 읽지 못하는 PDF라 그림을 줄이지 못했습니다. ${RASTER_HINT}`
        : best.images === 0
          ? '그림이 없는 PDF라 더 줄일 것이 없습니다. 글과 선만으로도 한도를 넘으면 쪽을 나눠 첨부하세요.'
          : best.skippedBytes > 0
            ? `이 도구가 다시 압축하지 못하는 그림(인쇄용 CMYK 색 등)이라 더 줄이지 못했습니다. ${RASTER_HINT}`
            : '그림이 이미 작게 저장돼 있어 더 줄일 수 없습니다.',
    };
  }
  const outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stemOf(p.path)}_용량줄임.pdf` });
  await writeFile(outPath, best.bytes);
  const notes: string[] = [`${mb(before)} → ${mb(after)}`];
  if (target && !underTarget) notes.push(`한도 ${p.target_mb}MB 를 아직 넘습니다${p.allow_raster ? '' : '. "쪽을 그림으로 바꿔서라도 줄이기"를 켜면 더 줄일 수 있습니다'}`);
  if (!textKept) notes.push('쪽을 그림으로 바꿔 글자 복사·검색이 되지 않습니다');
  if (signed) notes.push('전자서명이 든 PDF라 줄인 사본에서는 서명이 풀립니다. 서명이 필요하면 원본을 첨부하세요');
  return {
    output_path: outPath, before_bytes: before, after_bytes: after, level_used: best.level, images: best.images, images_shrunk: best.shrunk,
    under_target: underTarget, text_kept: textKept, note: notes.join('. '),
  };
}
