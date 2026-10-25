/**
 * rhwp HWP 저장 손실 진단 — 한컴 HWP 를 rhwp 로 열어 구역마다 글자 하나를 넣었다 지운 뒤(구역을 다시 쓰게)
 * HWP 로 내보내고, 원본과 내보낸 파일의 레코드를 견준다.
 *
 * 근거: 한컴 "한글 문서 파일 구조 5.0" 공개 문서 — CFB 컨테이너, FileHeader 속성 첫 비트 = 압축(raw deflate),
 * 레코드 머리 32비트 = 태그 10·수준 10·크기 12비트(크기 0xFFF 면 다음 4바이트), 컨트롤은 CTRL_HEADER 첫 4바이트 ID.
 *
 * 사용: node scripts/hwp-save-audit.mjs <HWP 파일 또는 폴더> [--limit 200] [--json 결과.json] [--core <rhwp 빌드 폴더>]
 *   손실(원본에 있는데 내보낸 파일에 없음)과 늘어남을 스트림·레코드 태그·컨트롤 ID 별로 센다.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const require = createRequire(resolve('node-sidecar', 'package.json'));
const CFB = require('cfb');
// --core <폴더>: 다른 rhwp 빌드(wasm-pack --target web 산출물)로 견준다. 없으면 설치된 @rhwp/core
const coreAt = process.argv.indexOf('--core');
const coreJs = coreAt > 0 ? resolve(process.argv[coreAt + 1], 'rhwp.js') : require.resolve('@rhwp/core');
const { default: init, HwpDocument } = await import(coreJs);
await init({ module_or_path: readFileSync(join(coreJs, '..', 'rhwp_bg.wasm')) });

/** 공개 문서의 태그 이름 (HWPTAG_BEGIN = 0x10) */
const TAGS = {
  16: 'DOCUMENT_PROPERTIES', 17: 'ID_MAPPINGS', 18: 'BIN_DATA', 19: 'FACE_NAME', 20: 'BORDER_FILL', 21: 'CHAR_SHAPE',
  22: 'TAB_DEF', 23: 'NUMBERING', 24: 'BULLET', 25: 'PARA_SHAPE', 26: 'STYLE', 27: 'DOC_DATA', 28: 'DISTRIBUTE_DOC_DATA',
  30: 'COMPATIBLE_DOCUMENT', 31: 'LAYOUT_COMPATIBILITY', 32: 'TRACKCHANGE',
  66: 'PARA_HEADER', 67: 'PARA_TEXT', 68: 'PARA_CHAR_SHAPE', 69: 'PARA_LINE_SEG', 70: 'PARA_RANGE_TAG', 71: 'CTRL_HEADER',
  72: 'LIST_HEADER', 73: 'PAGE_DEF', 74: 'FOOTNOTE_SHAPE', 75: 'PAGE_BORDER_FILL', 76: 'SHAPE_COMPONENT', 77: 'TABLE',
  78: 'SHAPE_COMPONENT_LINE', 79: 'SHAPE_COMPONENT_RECTANGLE', 80: 'SHAPE_COMPONENT_ELLIPSE', 81: 'SHAPE_COMPONENT_ARC',
  82: 'SHAPE_COMPONENT_POLYGON', 83: 'SHAPE_COMPONENT_CURVE', 84: 'SHAPE_COMPONENT_OLE', 85: 'SHAPE_COMPONENT_PICTURE',
  86: 'SHAPE_COMPONENT_CONTAINER', 87: 'CTRL_DATA', 88: 'EQEDIT', 90: 'SHAPE_COMPONENT_TEXTART', 91: 'FORM_OBJECT',
  92: 'MEMO_SHAPE', 93: 'MEMO_LIST', 94: 'FORBIDDEN_CHAR', 95: 'CHART_DATA', 96: 'TRACK_CHANGE', 97: 'TRACK_CHANGE_AUTHOR',
  98: 'VIDEO_DATA', 99: 'SHAPE_COMPONENT_UNKNOWN',
};
const tagName = (t) => TAGS[t] ?? `TAG_${t}`;

/** 레코드 목록: { tag, level, data } */
export function records(buf) {
  const out = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const h = buf.readUInt32LE(i);
    let size = h >>> 20;
    i += 4;
    if (size === 0xfff) { size = buf.readUInt32LE(i); i += 4; }
    out.push({ tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: buf.subarray(i, i + size) });
    i += size;
  }
  return out;
}

/** 컨트롤 ID: CTRL_HEADER 첫 4바이트를 거꾸로 읽은 글자 ('secd'·'tbl '·'%hlk' 등) */
const ctrlId = (data) => (data.length >= 4 ? String.fromCharCode(data[3], data[2], data[1], data[0]) : '?');

export function streamsOf(bytes) {
  const cfb = CFB.read(Buffer.from(bytes), { type: 'buffer' });
  const header = CFB.find(cfb, '/FileHeader');
  const compressed = header ? (Buffer.from(header.content).readUInt32LE(36) & 1) === 1 : true;
  const out = {};
  for (const [i, p] of cfb.FullPaths.entries()) {
    const e = cfb.FileIndex[i];
    if (e.type !== 2) continue;
    let data = Buffer.from(e.content ?? []);
    const recordStream = /^\/(DocInfo|BodyText\/Section\d+|ViewText\/Section\d+)$/.test(p.replace(/^Root Entry/, ''));
    if (recordStream && compressed) { try { data = inflateRawSync(data); } catch { /* 압축 안 된 스트림 */ } }
    out[p.replace(/^Root Entry/, '')] = { data, recordStream };
  }
  return out;
}

/** 스트림별 레코드 태그 수와 컨트롤 ID 수 */
export function census(bytes) {
  const s = streamsOf(bytes);
  const tags = {};
  const ctrls = {};
  for (const [name, { data, recordStream }] of Object.entries(s)) {
    if (!recordStream) continue;
    const scope = name.startsWith('/DocInfo') ? 'DocInfo' : 'Section';
    for (const r of records(data)) {
      const k = `${scope}:${tagName(r.tag)}`;
      tags[k] = (tags[k] ?? 0) + 1;
      if (r.tag === 71) { const c = `ctrl:${ctrlId(r.data)}`; ctrls[c] = (ctrls[c] ?? 0) + 1; }
    }
  }
  return { streams: Object.keys(s).sort(), tags, ctrls };
}

/** 구역마다 첫 문단에 글자 하나를 넣었다 지워 그 구역을 다시 쓰게 한 뒤 HWP 로 */
function roundTrip(bytes) {
  const doc = new HwpDocument(new Uint8Array(bytes));
  try {
    for (let s = 0; s < doc.getSectionCount(); s++) {
      doc.insertText(s, 0, 0, 'X');
      doc.deleteText(s, 0, 0, 1);
    }
    return doc.exportHwp();
  } finally { doc.free(); }
}

function diff(a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

if (process.argv[1]?.endsWith('hwp-save-audit.mjs')) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const target = process.argv[2];
  const limit = Number(arg('--limit', '200'));
  const files = [];
  (function walk(p) {
    if (files.length >= limit) return;
    if (statSync(p).isDirectory()) { for (const f of readdirSync(p).sort()) walk(join(p, f)); return; }
    if (/\.hwp$/i.test(p)) files.push(p);
  })(target);
  const total = { files: 0, failed: 0, lostFiles: {}, lost: {}, gained: {}, streamsLost: {} };
  const perFile = [];
  for (const f of files) {
    const orig = readFileSync(f);
    let a, b;
    try {
      a = census(orig);
      // HWP 5.0 본문이 있는 파일만 (이름만 .hwp 인 HWPX·HWP 3.0·배포용 문서(ViewText)는 뺀다)
      if (!a.streams.includes('/BodyText/Section0') || a.streams.some((x) => x.startsWith('/ViewText/'))) { total.skipped = (total.skipped ?? 0) + 1; continue; }
      b = census(roundTrip(orig));
    } catch (e) { total.failed++; perFile.push({ f, error: String(e).slice(0, 120) }); continue; }
    total.files++;
    const d = { ...diff(a.tags, b.tags), ...diff(a.ctrls, b.ctrls) };
    const lostStreams = a.streams.filter((x) => !b.streams.includes(x));
    for (const x of lostStreams) total.streamsLost[x.replace(/\d+$/, 'N')] = (total.streamsLost[x.replace(/\d+$/, 'N')] ?? 0) + 1;
    for (const [k, v] of Object.entries(d)) {
      if (v < 0) { total.lost[k] = (total.lost[k] ?? 0) - v; total.lostFiles[k] = (total.lostFiles[k] ?? 0) + 1; }
      else total.gained[k] = (total.gained[k] ?? 0) + v;
    }
    if (Object.keys(d).length || lostStreams.length) perFile.push({ f, d, lostStreams });
  }
  const top = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]);
  console.log(`파일 ${total.files} (실패 ${total.failed}, 뺀 것 ${total.skipped ?? 0})`);
  console.log('잃은 것 (레코드 수 · 파일 수):');
  for (const [k, v] of top(total.lost)) console.log(`  ${k}  ${v} · ${total.lostFiles[k]}`);
  console.log('늘어난 것:');
  for (const [k, v] of top(total.gained).slice(0, 15)) console.log(`  ${k}  ${v}`);
  console.log('빠진 스트림:', JSON.stringify(total.streamsLost));
  const json = arg('--json');
  if (json) writeFileSync(json, JSON.stringify({ total, perFile }, null, 2));
}
