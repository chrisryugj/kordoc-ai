/** 내장 한글 편집기의 열기·저장 (editor_open·editor_write) — rhwp 가 HWP 저장에서 빠뜨리는 것을 원본에서 되살린다
 *
 * rhwp 0.8.7 은 고친 구역을 다시 쓸 때 구역 끝의 바탕쪽·메모 목록과 수식 캡션을 빠뜨리고(한글이 못 여는 파일이 된다),
 * 메모 필드를 여는 글자의 종류를 "알 수 없음"으로 바꾸며(메모 자리마다 줄바꿈이 사라진다), 변경 추적 문서는
 * 지운 글까지 표시한 두 번째 본문(ViewText)을 읽는다(쪽 수가 몇 배로 늘고 저장하면 한글이 못 연다).
 * 그래서 열 때 추적 문서는 지금 내용으로 바꿔 주고, 원본의 목록·필드 종류를 표(token)로 간직했다가 저장할 때 되붙인다.
 * 편집기에서 새로 넣은 탭은 rhwp 가 폭 0 으로 써서 한글에서 붙어 나오니, 편집기가 잰 폭을 써 넣는다(editor_tab_spots → measureTabs → tabs).
 * 처음 덮어쓰는 파일은 옆에 `.bak` 을 남긴다(이미 있으면 그대로 둔다). 판단 근거와 한컴 한글 확인은 이음오피스 결정 0024·0026·0027·0028.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, constants } from 'node:fs/promises';
import { readFileB64, writeFileB64 } from '../files/io.js';
import { fieldKindsOf, restoreFieldKinds, type FieldKinds } from './field-kinds.js';
import { restoreSectionTails, sectionTailsOf, type SectionTails } from './section-tails.js';
import { hasTrackedChanges, withoutTrackedChanges } from './tracked-changes.js';
import { MAX_NEW_TABS, newTabsOf, writeTabWidths, type MeasuredTab, type TabSpot } from './tab-widths.js';

interface OpenedDoc {
  tails: SectionTails | null;
  kinds: FieldKinds | null;
  /** 추적 기록을 뺄 수 없었던 추적 문서 — 엔진이 지운 글까지 읽으므로 HWP 로 저장하지 않는다 */
  tracked: boolean;
  /** 이 열기에서 이미 쓴 파일 — 두 번째 저장부터는 앱이 쓴 바이트를 덮으니 `.bak` 을 다시 만들지 않는다 */
  written: Set<string>;
}

/** 편집기에 연 문서마다 하나. 편집기는 한 번에 한 문서라 몇 개만 남긴다 */
const opened = new Map<string, OpenedDoc>();
const KEEP = 8;

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const starts = (b: Uint8Array, magic: number[]) => b.length >= magic.length && magic.every((x, i) => b[i] === x);

export const EDITOR_REOPEN_NEEDED = '편집기 엔진이 다시 시작돼 이 문서의 저장 보정 정보가 없어졌습니다. 원본을 지키려고 저장하지 않았습니다. 편집 내용은 다른 이름으로 HWPX 로 저장하거나, 문서를 닫고 다시 연 뒤 고쳐 주세요.';
export const TRACKED_SAVE_BLOCK = '변경 내용 추적이 든 한글 문서인데 추적 기록을 뺄 수 없어, 지운 글까지 들어간 채 저장하게 됩니다. HWPX 로 저장하거나 한글에서 변경 내용을 반영한 뒤 다시 여세요.';

export async function editorOpen(path: string): Promise<{ data_b64: string; name: string; size: number; token: string; tracking_dropped: boolean; save_blocked?: string }> {
  const file = await readFileB64(path);
  let bytes: Uint8Array = Buffer.from(file.data_b64, 'base64');
  let trackingDropped = false;
  let tracked = false;
  if (starts(bytes, OLE) && hasTrackedChanges(bytes)) {
    const current = withoutTrackedChanges(bytes);
    if (current) { bytes = current; trackingDropped = true; } else tracked = true;
  }
  const hwp = starts(bytes, OLE);
  const token = randomUUID();
  opened.set(token, { tails: hwp ? sectionTailsOf(bytes) : null, kinds: hwp ? fieldKindsOf(bytes) : null, tracked, written: new Set() });
  while (opened.size > KEEP) opened.delete(opened.keys().next().value!);
  return {
    data_b64: trackingDropped ? Buffer.from(bytes).toString('base64') : file.data_b64,
    name: file.name,
    size: file.size,
    token,
    tracking_dropped: trackingDropped,
    ...(tracked ? { save_blocked: TRACKED_SAVE_BLOCK } : {}),
  };
}

/** 편집기 내보내기에서 rhwp 가 폭 없이 쓴 새 탭들 — 편집기가 재서(measureTabs) editor_write 의 tabs 로 넘긴다 */
export function editorTabSpots(p: { data_b64: string; format: 'hwp' | 'hwpx' }): { spots: TabSpot[] } {
  if (typeof p.data_b64 !== 'string' || !p.data_b64) return { spots: [] };
  try {
    return { spots: newTabsOf(Buffer.from(p.data_b64, 'base64'), p.format).slice(0, MAX_NEW_TABS) };
  } catch {
    return { spots: [] };
  }
}

export async function editorWrite(p: { path: string; data_b64: string; token?: string; overwrite?: boolean; backup?: boolean; tabs?: MeasuredTab[] }): Promise<{ path: string; backup_path?: string; tails_lost?: boolean }> {
  if (typeof p.data_b64 !== 'string' || !p.data_b64) throw new Error('저장할 내용이 없습니다.');
  let bytes: Uint8Array = Buffer.from(p.data_b64, 'base64');
  const hwp = /\.hwp$/i.test(p.path);
  // 이름이 약속한 형식의 바이트인지 — 사용자 파일을 다른 형식으로 덮지 않는다
  if (/\.hwpx?$/i.test(p.path) && !starts(bytes, hwp ? OLE : ZIP)) {
    throw new Error(`${hwp ? 'HWP' : 'HWPX'} 형식이 아닌 내용을 ${hwp ? '.hwp' : '.hwpx'} 파일로 저장하려 했습니다. 확장자를 맞춰 다시 저장하세요.`);
  }
  // 탭이 먼저: 탭 자리는 엔진이 쓴 바이트에서 찾았고, 목록 되붙이기는 구역 본문을 그대로 둔다
  if (p.tabs?.length && /\.hwpx?$/i.test(p.path)) bytes = writeTabWidths(bytes, hwp ? 'hwp' : 'hwpx', p.tabs).bytes;
  const doc = p.token ? opened.get(p.token) : undefined;
  // 열 때 받은 표가 없다 = 엔진이 다시 켜졌다. 보정 없이 쓰면 한글이 못 여는 HWP 가 원본 자리에 남는다
  if (p.token && !doc && hwp) throw new Error(EDITOR_REOPEN_NEEDED);
  let tailsLost = false;
  if (doc && hwp) {
    if (doc.tracked) throw new Error(TRACKED_SAVE_BLOCK);
    if (doc.kinds) bytes = restoreFieldKinds(bytes, doc.kinds).bytes;
    if (doc.tails) {
      const r = restoreSectionTails(bytes, doc.tails);
      bytes = r.bytes;
      tailsLost = !!r.skipped;
    }
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
  return { path: r.path, ...(backup ? { backup_path: backup } : {}), ...(tailsLost ? { tails_lost: true } : {}) };
}
