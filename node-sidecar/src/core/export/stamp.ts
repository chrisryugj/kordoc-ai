/** PDF 표시 — 워터마크(대각선 흐린 글자)·쪽번호("- 1 -")
 *
 * pdf-lib 기본 글꼴엔 한글이 없어 한글 워터마크는 OS 의 TrueType 한글 글꼴(윈도 맑은 고딕, 맥 AppleGothic)을
 * 쓰인 글자만 부분 임베드한다 (Pretendard 같은 CFF 글꼴은 pdf-lib fontkit 이 못 읽음). 영문·쪽번호는 Helvetica.
 * 쪽 회전(/Rotate)을 반영해 보이는 방향 기준으로 그린다.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { StandardFonts, degrees, rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';

function koreanFontCandidates(): string[] {
  if (process.platform === 'win32') {
    const win = process.env.WINDIR ?? 'C:\\Windows';
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return [join(win, 'Fonts', 'malgun.ttf'), join(win, 'Fonts', 'NanumGothic.ttf'), join(local, 'Microsoft', 'Windows', 'Fonts', 'NanumGothic.ttf')];
  }
  if (process.platform === 'darwin') {
    return ['/System/Library/Fonts/Supplemental/AppleGothic.ttf', '/Library/Fonts/NanumGothic.ttf', join(homedir(), 'Library', 'Fonts', 'NanumGothic.ttf')];
  }
  return ['/usr/share/fonts/truetype/nanum/NanumGothic.ttf', '/usr/share/fonts/nanum/NanumGothic.ttf'];
}

let koreanFont: Uint8Array | null | undefined;

async function fontFor(doc: PDFDocument, text: string): Promise<PDFFont> {
  if (/^[\x20-\x7e]*$/.test(text)) return doc.embedFont(StandardFonts.HelveticaBold);
  if (koreanFont === undefined) {
    const path = koreanFontCandidates().find((p) => existsSync(p));
    koreanFont = path ? readFileSync(path) : null;
  }
  if (!koreanFont) throw new Error('한글 워터마크에 쓸 글꼴(맑은 고딕·나눔고딕)을 찾지 못했습니다. 글꼴을 설치하거나 영문으로 적으세요.');
  doc.registerFontkit(fontkit);
  return doc.embedFont(koreanFont, { subset: true });
}

/** 보이는 방향 좌표(u 오른쪽, v 위) → 쪽 좌표 + 글자 회전각 */
function placer(page: PDFPage) {
  const box = page.getCropBox();
  const W = box.width;
  const H = box.height;
  const rot = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const vw = rot % 180 ? H : W;
  const vh = rot % 180 ? W : H;
  const map = (u: number, v: number): { x: number; y: number } => {
    const [x, y] = rot === 90 ? [W - v, u] : rot === 180 ? [W - u, H - v] : rot === 270 ? [v, H - u] : [u, v];
    return { x: box.x + x, y: box.y + y };
  };
  return { vw, vh, rot, map };
}

export async function stampPdf(doc: PDFDocument, opts: { watermark?: string; page_numbers?: boolean }): Promise<void> {
  const text = opts.watermark?.trim();
  const wmFont = text ? await fontFor(doc, text) : undefined;
  const numFont = opts.page_numbers ? await doc.embedFont(StandardFonts.Helvetica) : undefined;
  doc.getPages().forEach((page, i) => {
    const { vw, vh, rot, map } = placer(page);
    if (text && wmFont) {
      const diag = Math.hypot(vw, vh);
      const w1 = wmFont.widthOfTextAtSize(text, 1) || 1;
      const size = Math.min(Math.max((diag * 0.55) / w1, 18), 180);
      const w = w1 * size;
      const a = Math.atan2(vh, vw);
      const [dx, dy, nx, ny] = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
      const u = vw / 2 - (w / 2) * dx - size * 0.35 * nx;
      const v = vh / 2 - (w / 2) * dy - size * 0.35 * ny;
      page.drawText(text, { ...map(u, v), size, font: wmFont, color: rgb(0.55, 0.55, 0.55), opacity: 0.2, rotate: degrees(rot + (a * 180) / Math.PI) });
    }
    if (numFont) {
      const label = `- ${i + 1} -`;
      const w = numFont.widthOfTextAtSize(label, 10);
      page.drawText(label, { ...map(vw / 2 - w / 2, 18), size: 10, font: numFont, color: rgb(0.2, 0.2, 0.2), rotate: degrees(rot) });
    }
  });
}
