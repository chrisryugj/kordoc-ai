/** HWP 5.0 컨테이너와 레코드 — 한컴 "한글 문서 파일 구조 5.0" 공개 문서 기준.
 *
 * - 컨테이너는 CFB. FileHeader 속성(36바이트 째 UINT32) 첫 비트가 켜져 있으면 DocInfo·BodyText 스트림은 raw deflate.
 * - 레코드 머리 32비트: 태그 10비트 · 수준 10비트 · 크기 12비트. 크기가 0xFFF 면 다음 UINT32 가 크기.
 * - 문단 글(PARA_TEXT)의 컨트롤 글자: 0·10·13·24~31 은 한 글자(2바이트), 나머지 0~31 은 8 WCHAR(16바이트,
 *   둘째~셋째 WCHAR 가 컨트롤 ID, 마지막 WCHAR 가 같은 코드).
 */

import * as CFB from 'cfb';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const TAG = { PARA_HEADER: 66, PARA_TEXT: 67, CTRL_HEADER: 71, LIST_HEADER: 72, MEMO_LIST: 93 } as const;

export interface Rec {
  tag: number;
  level: number;
  data: Buffer;
  /** 머리까지 포함한 원래 바이트 (그대로 옮겨 붙일 때) */
  raw: Buffer;
}

export function readRecords(buf: Buffer): Rec[] {
  const out: Rec[] = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const start = i;
    const h = buf.readUInt32LE(i);
    let size = h >>> 20;
    i += 4;
    if (size === 0xfff) { size = buf.readUInt32LE(i); i += 4; }
    out.push({ tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: buf.subarray(i, i + size), raw: buf.subarray(start, i + size) });
    i += size;
  }
  return out;
}

export function writeRecord(tag: number, level: number, data: Buffer): Buffer {
  const big = data.length >= 0xfff;
  const head = Buffer.alloc(big ? 8 : 4);
  head.writeUInt32LE(((tag & 0x3ff) | ((level & 0x3ff) << 10) | ((big ? 0xfff : data.length) << 20)) >>> 0, 0);
  if (big) head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data]);
}

/** 컨트롤 ID 4글자 (바이트를 거꾸로 읽는다: 'secd'·'tbl '·'%clk') */
export const ctrlId = (b: Buffer, at = 0): string => String.fromCharCode(b[at + 3], b[at + 2], b[at + 1], b[at]);

/** 한 글자(2바이트)인 컨트롤 코드 */
const CHAR_CODES = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

/** 문단 글 안의 확장 컨트롤 글자들: 위치(바이트)와 코드 */
export function inlineControls(text: Buffer): Array<{ at: number; code: number }> {
  const out: Array<{ at: number; code: number }> = [];
  for (let i = 0; i + 1 < text.length;) {
    const c = text.readUInt16LE(i);
    if (c < 32 && !CHAR_CODES.has(c)) { out.push({ at: i, code: c }); i += 16; } else i += 2;
  }
  return out;
}

export interface Hwp5 {
  cfb: ReturnType<typeof CFB.read>;
  compressed: boolean;
  /** 구역 스트림 이름(BodyText/SectionN) → 풀어 놓은 바이트 */
  sections: Map<string, Buffer>;
}

const SECTION = /^Root Entry\/BodyText\/Section\d+$/;

export function readHwp5(bytes: Uint8Array): Hwp5 {
  const cfb = CFB.read(Buffer.from(bytes), { type: 'buffer' });
  const header = CFB.find(cfb, '/FileHeader');
  if (!header) throw new Error('HWP 파일 머리를 찾지 못했습니다.');
  const compressed = (Buffer.from(header.content as Uint8Array).readUInt32LE(36) & 1) === 1;
  const sections = new Map<string, Buffer>();
  cfb.FullPaths.forEach((p, i) => {
    if (!SECTION.test(p)) return;
    const raw = Buffer.from(cfb.FileIndex[i].content as Uint8Array);
    sections.set(p.replace(/^Root Entry\//, ''), compressed ? inflateRawSync(raw) : raw);
  });
  return { cfb, compressed, sections };
}

/** 바꾼 구역만 다시 넣어 HWP 바이트로 */
export function writeHwp5(h: Hwp5, changed: Map<string, Buffer>): Uint8Array {
  for (const [name, data] of changed) {
    const entry = CFB.find(h.cfb, `/${name}`);
    if (!entry) throw new Error(`HWP 안에 ${name} 이 없습니다.`);
    entry.content = h.compressed ? deflateRawSync(data) : data;
    entry.size = (entry.content as Buffer).length;
  }
  return freeUnusedSectors(Buffer.from(CFB.write(h.cfb, { type: 'buffer' }) as Buffer));
}

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

/** cfb 라이브러리는 FAT·미니 FAT 의 남는 칸(없는 섹터)을 ENDOFCHAIN 으로 채운다. MS-CFB 공개 명세의 빈 칸 값은 FREESECT.
 *  그대로 두면 rhwp 가 다시 읽어 저장할 때 요약 정보·미리보기 같은 스트림을 잃는다 (실측) */
export function freeUnusedSectors(buf: Buffer): Uint8Array {
  const size = 1 << buf.readUInt16LE(30);
  const per = size / 4;
  const sectors = Math.ceil((buf.length - size) / size);
  const at = (sec: number) => size * (sec + 1);
  // FAT 섹터 목록: 머리 109칸 + DIFAT 사슬
  const fat: number[] = [];
  for (let i = 0; i < 109; i++) { const s = buf.readUInt32LE(76 + i * 4); if (s < sectors) fat.push(s); }
  for (let d = buf.readUInt32LE(68), n = buf.readUInt32LE(72); n > 0 && d < sectors; n--) {
    for (let i = 0; i < per - 1; i++) { const s = buf.readUInt32LE(at(d) + i * 4); if (s < sectors) fat.push(s); }
    d = buf.readUInt32LE(at(d) + (per - 1) * 4);
  }
  const fatEntry = (sec: number) => buf.readUInt32LE(at(fat[Math.floor(sec / per)]) + (sec % per) * 4);
  fat.forEach((f, k) => {
    for (let i = 0; i < per; i++) {
      const p = at(f) + i * 4;
      if (k * per + i >= sectors && buf.readUInt32LE(p) === ENDOFCHAIN) buf.writeUInt32LE(FREESECT, p);
    }
  });
  // 미니 FAT: 미니 스트림(뿌리 항목 크기) 밖 칸
  const root = at(buf.readUInt32LE(48));
  const miniCount = Math.ceil(Number(buf.readBigUInt64LE(root + 120)) / 64);
  let k = 0;
  for (let s = buf.readUInt32LE(60), n = buf.readUInt32LE(64); n > 0 && s < sectors; n--, k++) {
    for (let i = 0; i < per; i++) {
      const p = at(s) + i * 4;
      if (k * per + i >= miniCount && buf.readUInt32LE(p) === ENDOFCHAIN) buf.writeUInt32LE(FREESECT, p);
    }
    s = fatEntry(s);
  }
  return new Uint8Array(buf);
}

export const isHwp5 = (b: Uint8Array) => b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
/** FileHeader 속성 비트 (1: 압축, 4: 배포용, 0x4000: 변경 추적) */
export function headerFlags(bytes: Uint8Array): number {
  const cfb = CFB.read(Buffer.from(bytes), { type: 'buffer' });
  const header = CFB.find(cfb, '/FileHeader');
  return header ? Buffer.from(header.content as Uint8Array).readUInt32LE(36) : 0;
}
