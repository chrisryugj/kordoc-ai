/** 받은 문서(HWPX·DOCX·XLSX)의 ZIP 항목을 상한을 세며 푼다
 *
 * JSZip 의 async() 는 항목을 끝까지 다 푼다: 1.8MB HWPX 하나(구역 XML 1.8GB)를 미리보기로 열기만 해도 RSS 2.4GB 를 쓰고
 * V8 힙이 바닥나면 엔진이 통째로 죽는다. kordoc 은 같은 문서를 비압축 크기·실제로 푼 양으로 막지만, 앱이 JSZip 으로 직접 여는 길
 * (미리보기 안내문·합치기·나누기·서식 읽기·도장)은 그 검사를 안 거쳤다. 여기서 풀면 중앙 목록에 적힌 크기와 실제로 푼 바이트를 함께 세어
 * 항목 하나·묶음 하나(같은 JSZip 에서 푼 것 모두)가 kordoc 과 같은 상한을 넘으면 끊는다.
 */

import type JSZip from 'jszip';

/** kordoc(4.24 HWPX 읽기)과 같은 상한: 256MB, KORDOC_MAX_UNZIP_MB 로 늘리면 같이(8GB 까지) */
export function unzipLimit(): number {
  const mb = Number(process.env.KORDOC_MAX_UNZIP_MB);
  return Number.isFinite(mb) && mb > 0 ? Math.min(mb, 8192) * 1024 * 1024 : 256 * 1024 * 1024;
}

const tooBig = () => Object.assign(
  new Error(`문서 안의 내용을 풀면 너무 커서(${Math.round(unzipLimit() / 1024 / 1024)}MB 넘음) 열지 않았습니다. 손상됐거나 일부러 크게 만든 파일일 수 있습니다. 보낸 곳에서 원본을 다시 받거나 만든 프로그램에서 다시 저장해 넣으세요.`),
  { code: 'ZIP_TOO_BIG' },
);

/** 묶음마다 지금까지 푼 바이트 */
const spent = new WeakMap<JSZip, number>();

type Entry = JSZip.JSZipObject | string | null | undefined;

function inflate(zip: JSZip, entry: Entry): Promise<Buffer | undefined> {
  const file = typeof entry === 'string' ? zip.file(entry) : entry;
  if (!file) return Promise.resolve(undefined);
  const max = unzipLimit();
  // 읽어 온 문서 항목은 중앙 목록의 비압축 크기를 안다(앱이 새로 넣은 항목은 모른다). 적힌 것보다 많이 풀리면 거짓 크기다
  const declared = (file as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
  const limit = typeof declared === 'number' && declared >= 0 ? declared : Number.POSITIVE_INFINITY;
  if ((spent.get(zip) ?? 0) + (Number.isFinite(limit) ? limit : 0) > max) return Promise.reject(tooBig());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = file.nodeStream('nodebuffer');
    stream.on('data', (c: Buffer) => {
      size += c.length;
      const used = (spent.get(zip) ?? 0) + c.length;
      spent.set(zip, used);
      if (size > limit || used > max) {
        stream.pause();
        reject(tooBig());
        return;
      }
      chunks.push(c);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks, size)));
  });
}

/** 중앙 목록에 적힌 비압축 크기 합이 상한을 넘으면 풀기 전에 끊는다 (합치기처럼 어느 파일 때문인지 알려야 할 때 먼저 부른다) */
export function checkZipSize(zip: JSZip): void {
  let total = 0;
  for (const f of Object.values(zip.files)) {
    const n = (f as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
    if (typeof n === 'number' && n > 0) total += n;
  }
  if (total > unzipLimit()) throw tooBig();
}

/** 항목 글(UTF-8). 없으면 undefined */
export async function entryText(zip: JSZip, entry: Entry): Promise<string | undefined> {
  return (await inflate(zip, entry))?.toString('utf-8');
}

/** 항목 바이트. 없으면 undefined */
export async function entryBytes(zip: JSZip, entry: Entry): Promise<Uint8Array | undefined> {
  const b = await inflate(zip, entry);
  return b && new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

/** ZIP 이면 중앙 목록에 적힌 .xml 항목들의 비압축 크기 합(풀지 않고), 아니면 0.
 *  압축된 파일 크기로는 일이 얼마나 클지 모른다: 200KB HWPX 의 구역 XML 이 43MB 였다 */
export function zipXmlBytes(buf: Uint8Array): number {
  if (buf.length < 22 || buf[0] !== 0x50 || buf[1] !== 0x4b) return 0;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return 0;
  const count = v.getUint16(eocd + 10, true);
  let pos = v.getUint32(eocd + 16, true);
  let total = 0;
  for (let i = 0; i < count && pos + 46 <= buf.length && v.getUint32(pos, true) === 0x02014b50; i++) {
    const nameLen = v.getUint16(pos + 28, true);
    const name = Buffer.from(buf.buffer, buf.byteOffset + pos + 46, Math.min(nameLen, buf.length - pos - 46)).toString('latin1');
    if (/\.xml$/i.test(name)) total += v.getUint32(pos + 24, true);
    pos += 46 + nameLen + v.getUint16(pos + 30, true) + v.getUint16(pos + 32, true);
  }
  return total;
}
