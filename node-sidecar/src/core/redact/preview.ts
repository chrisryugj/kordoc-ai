/** 미리보기 손질 — 본문만 고친 사본의 첫 쪽 글(PrvText)·첫 쪽 그림(PrvImage)에 남은 글을 마저 가린다
 *
 * 한글 문서는 첫 쪽 글과 그림을 본문과 따로 품는다. 본문만 고치면 탐색기 미리보기·검색 색인에 가린 글이 그대로 남는다.
 */

import { readFile, writeFile } from 'node:fs/promises';
import * as CFB from 'cfb';
import JSZip from 'jszip';
import { freeUnusedSectors } from '../hwp-save/hwp5.js';

async function blankPng(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer();
}

const isPng = (b: Uint8Array) => b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** pairs: [원문, 가린 글]. blankImage 면 첫 쪽 그림도 흰 그림으로 바꾼다(엔진이 사본을 만들지 않아 그림이 그대로일 때).
 *  돌려주는 값: 첫 쪽 그림을 바꾸지 못했는가 (PNG 가 아닌 그림) */
export async function sealPreview(path: string, format: 'hwp' | 'hwpx', pairs: ReadonlyArray<readonly [string, string]>, blankImage: boolean): Promise<{ imageLeft: boolean }> {
  const swap = (s: string) => pairs.reduce((t, [orig, masked]) => t.split(orig).join(masked), s);
  const buf = await readFile(path);
  let changed = false;
  let imageLeft = false;

  if (format === 'hwpx') {
    const zip = await JSZip.loadAsync(buf);
    for (const txt of zip.file(/^Preview\/PrvText\.txt$/i)) {
      const before = await txt.async('string');
      const after = swap(before);
      if (after !== before) { zip.file(txt.name, after); changed = true; }
    }
    if (blankImage) {
      for (const img of zip.file(/^Preview\/PrvImage\./i)) {
        if (!isPng(await img.async('uint8array'))) { imageLeft = true; continue; }
        zip.file(img.name, await blankPng(), { compression: 'STORE' });
        changed = true;
      }
    }
    if (changed) {
      // HWPX 규칙: mimetype 은 맨 앞·압축 없음
      const mimetype = await zip.file('mimetype')?.async('uint8array');
      if (mimetype) zip.file('mimetype', mimetype, { compression: 'STORE' });
      await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
    }
    return { imageLeft };
  }

  const cfb = CFB.read(buf, { type: 'buffer' });
  const put = (entry: CFB.CFB$Entry, data: Buffer) => { entry.content = data; entry.size = data.length; changed = true; };
  const txt = CFB.find(cfb, '/PrvText');
  if (txt?.content) {
    const before = Buffer.from(txt.content as Uint8Array).toString('utf16le');
    const after = swap(before);
    if (after !== before) put(txt, Buffer.from(after, 'utf16le'));
  }
  const img = blankImage ? CFB.find(cfb, '/PrvImage') : null;
  if (img?.content) {
    if (isPng(img.content as Uint8Array)) put(img, await blankPng());
    else imageLeft = true;
  }
  if (changed) await writeFile(path, freeUnusedSectors(Buffer.from(CFB.write(cfb, { type: 'buffer' }) as Buffer)));
  return { imageLeft };
}
