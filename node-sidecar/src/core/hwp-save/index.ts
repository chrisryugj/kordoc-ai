/** 내장 한글 편집기의 열기·저장 (editor_open·editor_write).
 *
 * 열 때 원본 바이트를 표(token)로 간직했다가, HWP 로 저장할 때 rhwp 0.8.7 이 빠뜨리는 것을 원본에서 메운다(fixups.ts:
 * 구역 끝 묶음·필드 글자 종류·새 탭 폭). 처음 덮어쓰는 파일은 옆에 `.bak` 을 남긴다(이미 있으면 그대로 둔다).
 * 변경 추적 문서(FileHeader 0x4000)는 보정하지 않고 알리기만 한다: rhwp 는 본문(BodyText) 대신 검토 기록이 섞인 화면용
 * 본문(ViewText)을 읽어, 저장하면 그 모양이 본문이 되고 추적 기록은 남지 않는다. 원본 BodyText 기준 보정을 섞으면 안 된다.
 * 되살리기(recover)는 복구 사본 바이트를 주되 보정 기준은 원래 경로의 파일이다.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, constants } from 'node:fs/promises';
import { basename } from 'node:path';
import { readFileB64, writeFileB64 } from '../files/io.js';
import { recoveryBytes } from '../recovery/index.js';
import { loadRhwp } from '../render/rhwp.js';
import { fillTabWidths, hasZeroWidthTabs, restoreFieldKinds, restoreSectionTails, type Caret } from './fixups.js';
import { headerFlags, isHwp5, readHwp5, writeHwp5 } from './hwp5.js';

interface OpenedDoc {
  /** 원본 HWP 바이트 (보정 기준). HWPX·원본 없음·변경 추적 문서는 null */
  original: Uint8Array | null;
  /** 이 열기에서 이미 쓴 파일 — 두 번째 저장부터는 앱이 쓴 바이트를 덮으니 `.bak` 을 다시 만들지 않는다 */
  written: Set<string>;
}

/** 편집기에 연 문서마다 하나. 편집기는 한 번에 한 문서라 몇 개만 남긴다 */
const opened = new Map<string, OpenedDoc>();
const KEEP = 8;
const TRACKED = 0x4000;

export const EDITOR_REOPEN_NEEDED = '편집기 엔진이 다시 시작돼 이 문서의 저장 보정 정보가 없어졌습니다. 원본을 지키려고 저장하지 않았습니다. HWPX 로 저장하거나, 문서를 닫고 다시 연 뒤 고쳐 주세요.';
export const RECOVERY_GONE = '되살릴 사본이 없습니다. 이미 저장했거나 버린 문서입니다. 문서를 그냥 여세요.';

export async function editorOpen(path: string, recover = false): Promise<{ data_b64: string; name: string; size: number; token: string; tracked: boolean }> {
  const copy = recover ? recoveryBytes(path) : null;
  if (recover && !copy) throw new Error(RECOVERY_GONE);
  const file = copy
    ? (existsSync(path) ? await readFileB64(path) : { data_b64: '', name: basename(path), size: 0 })
    : await readFileB64(path);
  const original = Buffer.from(file.data_b64, 'base64');
  const hwp = isHwp5(original);
  const tracked = hwp && (headerFlags(original) & TRACKED) !== 0;
  const token = randomUUID();
  opened.set(token, { original: hwp && !tracked ? original : null, written: new Set() });
  while (opened.size > KEEP) opened.delete(opened.keys().next().value!);
  const shown = copy ?? original;
  return {
    data_b64: Buffer.from(shown).toString('base64'),
    name: file.name,
    size: shown.length,
    token,
    tracked,
  };
}

/** 저장본 HWP 를 원본 기준으로 보정 — 바꾼 게 없으면 받은 바이트 그대로. lost: 구역 수가 달라 되붙이지 못한 묶음 */
export async function fixHwp(saved: Uint8Array, original: Uint8Array): Promise<{ bytes: Uint8Array; lost: boolean }> {
  const out = readHwp5(saved);
  const orig = readHwp5(original);
  const changed = new Map<string, Buffer>();
  const { lost } = restoreSectionTails(orig, out, changed);
  restoreFieldKinds(orig, out, changed);
  if (!hasZeroWidthTabs(out, changed)) return { bytes: changed.size ? writeHwp5(out, changed) : saved, lost };
  // 새 탭 폭은 저장본을 엔진으로 열어 조판 결과에서 잰다
  const rhwp = await loadRhwp();
  const doc = new rhwp.HwpDocument(saved) as unknown as {
    getCursorRect(s: number, p: number, o: number): string;
    getTextRange(s: number, p: number, o: number, n: number): string;
    getParagraphLength(s: number, p: number): number;
    free?(): void;
  };
  try {
    fillTabWidths(out, changed, (s, p, o) => {
      try { return JSON.parse(doc.getCursorRect(s, p, o)) as Caret; } catch { return null; }
    }, (s, p) => {
      try { const n = doc.getParagraphLength(s, p); return n ? doc.getTextRange(s, p, 0, n) : ''; } catch { return ''; }
    });
  } finally {
    doc.free?.();
  }
  return { bytes: changed.size ? writeHwp5(out, changed) : saved, lost };
}

export async function editorWrite(p: { path: string; data_b64: string; token?: string; overwrite?: boolean; backup?: boolean }): Promise<{ path: string; backup_path?: string; tails_lost?: boolean }> {
  if (typeof p.data_b64 !== 'string' || !p.data_b64) throw new Error('저장할 내용이 없습니다.');
  let bytes: Uint8Array = Buffer.from(p.data_b64, 'base64');
  const hwp = /\.hwp$/i.test(p.path);
  // 이름이 약속한 형식의 바이트인지 — 사용자 파일을 다른 형식으로 덮지 않는다
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/\.hwpx?$/i.test(p.path) && !(hwp ? isHwp5(bytes) : zip)) {
    throw new Error(`${hwp ? 'HWP' : 'HWPX'} 형식이 아닌 내용을 ${hwp ? '.hwp' : '.hwpx'} 파일로 저장하려 했습니다. 확장자를 맞춰 다시 저장하세요.`);
  }
  const doc = p.token ? opened.get(p.token) : undefined;
  // 열 때 받은 표가 없다 = 엔진이 다시 켜졌다. 보정 없이 쓰면 메모·바탕쪽이 빠진 HWP 가 원본 자리에 남는다
  if (p.token && !doc && hwp) throw new Error(EDITOR_REOPEN_NEEDED);
  let lost = false;
  if (doc?.original && hwp) {
    const r = await fixHwp(bytes, doc.original);
    bytes = r.bytes;
    lost = r.lost;
  }
  let backup: string | undefined;
  if (doc && p.backup !== false && existsSync(p.path) && !doc.written.has(p.path)) {
    // 이미 있는 .bak 은 처음 원본이다 — 다시 열어 저장해도 덮지 않는다
    try {
      await copyFile(p.path, `${p.path}.bak`, constants.COPYFILE_EXCL);
      backup = `${p.path}.bak`;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  const r = await writeFileB64({ path: p.path, data_b64: Buffer.from(bytes).toString('base64'), overwrite: p.overwrite });
  doc?.written.add(r.path);
  return { path: r.path, ...(backup ? { backup_path: backup } : {}), ...(lost ? { tails_lost: true } : {}) };
}
