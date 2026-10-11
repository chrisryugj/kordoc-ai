/** kordoc 생성본을 내장 편집기·PDF(rhwp)에서도 제 모양으로 보이게 다듬기
 *
 * 목차 틀(`__kordoc_toc` 칸이 든 1칸 표)은 쪽 높이에 가까운 칸을 `pageBreak="CELL"`(칸 단위 쪽 나눔)로
 * 낸다. rhwp 는 줄 배치(lineseg)가 없는 문서에서 이 조합을 조판할 때 칸 안 글 폭을 좁게 잡고
 * (목차 제목이 "추진 배 / 경" 으로 끊김) 세로 가운데 정렬도 놓친다. 목차 틀은 한 쪽짜리라 쪽 나눔이
 * 필요 없으니 `NONE` 으로 바꾼다. (근본 수정: rhwp 조판·kordoc 목차 틀 속성 — 앱은 그 전까지 이걸로)
 */

import JSZip from 'jszip';

export async function rhwpCompat(buf: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buf);
  let changed = false;
  for (const name of Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async('string');
    if (!xml.includes('name="__kordoc_toc"')) continue;
    let out = xml;
    let from = 0;
    for (;;) {
      const cell = out.indexOf('name="__kordoc_toc"', from);
      if (cell < 0) break;
      const tbl = out.lastIndexOf('<hp:tbl ', cell);
      const end = out.indexOf('>', tbl);
      const tag = out.slice(tbl, end);
      if (tag.includes('pageBreak="CELL"')) {
        out = out.slice(0, tbl) + tag.replace('pageBreak="CELL"', 'pageBreak="NONE"') + out.slice(end);
        changed = true;
      }
      from = cell + 1;
    }
    zip.file(name, out);
  }
  if (!changed) return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const mimetype = await zip.file('mimetype')?.async('uint8array');
  if (mimetype) zip.file('mimetype', mimetype, { compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
