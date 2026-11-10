/** 한글 문서 안 그림 속 글자 검사 — 엔진은 그림 화소를 보지 않는다
 *
 * 붙여 넣은 신분증·통장 사본 같은 그림은 본문을 다 가려도 그대로 나간다. 그림마다 글자를 읽어(OCR) 개인정보로 보이는
 * 글이 있는지 본다. 그림 속 글자를 가리지는 못한다: 찾은 수와 읽지 못한 수를 알려 사람이 보게 한다.
 * 그림에 걸리는 글이 없으면 조용히 넘어간다 (기관 표지·직인마다 경고를 띄우지 않게).
 */

import { parse, type RedactRule } from 'kordoc';
import { sendProgress } from '../../infra/progress.js';
import { parseDoc } from '../converter/index.js';
import { imageToPdf } from './pdf.js';
import { redactMarkdown } from './rules.js';

/** 한 문서에서 읽을 그림 수 상한 — 그림 수백 장짜리 문서에서 몇 분씩 붙잡지 않게 (넘는 것은 읽지 못한 것으로 센다) */
const MAX_PICTURES = 24;
/** 이보다 작은 그림은 글이 들 자리가 없다 (글머리표·선 조각) */
const MIN_SIDE = 48;

export interface PictureScan {
  /** 그림 수 */
  total: number;
  /** 개인정보로 보이는 글이 나온 그림 수와 그 글의 수 */
  flagged: number;
  hits: number;
  /** 글자를 읽지 못한 그림 수 (못 여는 형식·읽기 실패·상한 넘음) */
  unread: number;
}

export async function scanPictures(path: string, rules: readonly RedactRule[], keep: (s: string) => boolean, signal?: AbortSignal): Promise<PictureScan> {
  const out: PictureScan = { total: 0, flagged: 0, hits: 0, unread: 0 };
  // BMP·TIFF 는 엔진이 PNG 로 바꿔 준다 (그림 읽기 도구가 못 여는 형식)
  const doc = await parseDoc(path, { images: true, drawableImages: true, ocr: 'off', signal }).catch((err) => { if (signal?.aborted) throw err; return null; });
  const images = doc?.images ?? [];
  out.total = images.length;
  if (!images.length) return out;
  const sharp = (await import('sharp')).default;
  for (const [i, img] of images.entries()) {
    signal?.throwIfAborted();
    if (i >= MAX_PICTURES) { out.unread += images.length - i; break; }
    sendProgress({ current: i + 1, total: Math.min(images.length, MAX_PICTURES), message: '문서 안 그림 속 글자를 읽는 중' });
    try {
      const bytes = new Uint8Array(img.data);
      const meta = await sharp(Buffer.from(bytes)).metadata();
      if ((meta.width ?? 0) < MIN_SIDE || (meta.height ?? 0) < MIN_SIDE) continue;
      const r = await parse(Buffer.from(await imageToPdf(bytes)), { ocr: 'force', images: false });
      if (!r.success) { out.unread++; continue; }
      const found = redactMarkdown(r.markdown, { rules }).hits.filter((h) => !keep(r.markdown.slice(h.index, h.index + h.length))).length;
      if (found) { out.flagged++; out.hits += found; }
    } catch {
      // 못 여는 형식(WMF·EMF)이거나 깨진 그림
      out.unread++;
    }
  }
  return out;
}

/** 검사 결과 → 사람이 볼 곳 안내 */
export function pictureNotes(s: PictureScan): string[] {
  const notes: string[] = [];
  if (s.flagged) notes.push(`문서 안 그림 ${s.flagged}개에서 개인정보로 보이는 글자 ${s.hits}곳을 찾았습니다. 그림 속 글자는 가리지 못하니, 그림을 지우거나 가린 그림으로 바꾼 뒤 내보내세요.`);
  if (s.unread) notes.push(`문서 안 그림 ${s.unread}개는 글자를 읽지 못했습니다. 스캔한 신분증·통장 사본이 아닌지 눈으로 확인하세요.`);
  return notes;
}
