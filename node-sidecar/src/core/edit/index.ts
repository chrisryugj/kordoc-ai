/**
 * 문서 클릭-편집 세션 (KorDoc Studio Phase C) — kordoc v3.1 HwpxSession 연동.
 *
 * Phase B의 patch_blocks(stateless)와 달리 사이드카가 세션을 유지한다:
 * - capability 사전 판정 → 프론트 잠금 시각화의 단일 진실 소스
 * - undo/redo: 패치 전 바이트 스냅샷 스택 (세션은 새 바이트로 재구축)
 * - 자동저장: 프론트 타이머가 edit_save 호출 (사이드카는 상태만 보관)
 *
 * 제약: HWPX 전용 (HwpxSession과 동일). 세션 수/undo 깊이 상한으로 메모리 가드.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HwpxSession, type BlockEdit, type BlockCapabilityInfo, type IRBlock } from 'kordoc';
import { logger } from '../../infra/logger.js';

/** 동시 보유 세션 상한 — 초과 시 가장 오래 안 쓴 세션 강제 종료 */
const MAX_SESSIONS = 4;
/** undo 스냅샷 깊이 상한 (문서당) */
const UNDO_LIMIT = 50;
/** 응답 doc_b64 동봉 상한 — fill 모듈과 동일 가드 */
const MAX_INLINE_DOC_BYTES = 30 * 1024 * 1024;

function isZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

interface EditSessionEntry {
  session: HwpxSession;
  /** 패치 직전 바이트 스냅샷 (가장 최근이 마지막) */
  undoStack: Uint8Array[];
  redoStack: Uint8Array[];
  lastAccess: number;
}

const sessions = new Map<string, EditSessionEntry>();

function getSession(id: string): EditSessionEntry {
  const entry = sessions.get(id);
  if (!entry) throw new Error('편집 세션이 없거나 만료되었습니다 — 문서를 다시 여세요');
  entry.lastAccess = Date.now();
  return entry;
}

function evictIfNeeded(): void {
  while (sessions.size >= MAX_SESSIONS) {
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [id, e] of sessions) {
      if (e.lastAccess < oldestAt) { oldestAt = e.lastAccess; oldest = id; }
    }
    if (!oldest) break;
    sessions.delete(oldest);
    logger.info(`[edit] 세션 상한 초과 — 최저 사용 세션 종료: ${oldest}`);
  }
}

// ── 직렬화 뷰 ──
// IRBlock은 imageData(바이너리) 등 무거운 필드를 포함하므로 그대로 보내지 않고
// 에디터에 필요한 최소 형태로 줄인다.

export interface EditCellView {
  text: string;
  rowSpan: number;
  colSpan: number;
}

export interface EditBlockView {
  index: number;
  type: string;
  text?: string;
  level?: number;
  table?: { rows: number; cols: number; cells: Array<Array<EditCellView | null>> };
}

function toBlockView(block: IRBlock, index: number): EditBlockView {
  const view: EditBlockView = { index, type: block.type };
  if (block.text !== undefined) view.text = block.text;
  if (block.level !== undefined) view.level = block.level;
  if (block.type === 'table' && block.table) {
    view.table = {
      rows: block.table.rows,
      cols: block.table.cols,
      cells: block.table.cells.map((row) =>
        row.map((c) => (c ? { text: c.text, rowSpan: c.rowSpan, colSpan: c.colSpan } : null))),
    };
  }
  return view;
}

export interface EditStateResult {
  success: boolean;
  session_id: string;
  blocks: EditBlockView[];
  capabilities: BlockCapabilityInfo[];
  can_undo: boolean;
  can_redo: boolean;
  doc_b64?: string;
  error?: string;
}

function stateResult(id: string, entry: EditSessionEntry, includeDoc: boolean): EditStateResult {
  const bytes = entry.session.bytes;
  return {
    success: true,
    session_id: id,
    blocks: entry.session.blocks.map(toBlockView),
    capabilities: entry.session.capabilities(),
    can_undo: entry.undoStack.length > 0,
    can_redo: entry.redoStack.length > 0,
    ...(includeDoc && bytes.length <= MAX_INLINE_DOC_BYTES ? { doc_b64: Buffer.from(bytes).toString('base64') } : {}),
  };
}

// ── edit_open ──

export interface EditOpenParams {
  input_path?: string;
  doc_b64?: string;
  /** 응답에 문서 바이트 동봉 (기본 true — 프론트 rhwp 미리보기) */
  include_doc?: boolean;
}

export async function editOpen(params: EditOpenParams, signal?: AbortSignal): Promise<EditStateResult> {
  const { input_path, doc_b64, include_doc = true } = params;
  const bytes = doc_b64
    ? new Uint8Array(Buffer.from(doc_b64, 'base64'))
    : new Uint8Array(await readFile(input_path!));
  if (!isZip(bytes)) throw new Error('HWPX 문서만 클릭-편집을 지원합니다 (HWP 5.x는 HWPX로 변환 후 사용)');
  signal?.throwIfAborted();

  evictIfNeeded();
  const session = await HwpxSession.open(bytes);
  const id = randomUUID();
  const entry: EditSessionEntry = { session, undoStack: [], redoStack: [], lastAccess: Date.now() };
  sessions.set(id, entry);
  logger.info(`[edit_open] 세션 ${id} — 블록 ${session.blocks.length}개 (활성 세션 ${sessions.size})`);
  return stateResult(id, entry, include_doc);
}

// ── edit_patch ──

export interface EditPatchParams {
  session_id: string;
  edits: BlockEdit[];
  include_doc?: boolean;
}

export interface EditPatchResult extends EditStateResult {
  applied: number;
  skipped: Array<{ reason: string; detail?: string }>;
}

export async function editPatch(params: EditPatchParams, signal?: AbortSignal): Promise<EditPatchResult> {
  const { session_id, edits, include_doc = true } = params;
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('편집 목록이 비어 있습니다 ("edits")');
  const entry = getSession(session_id);
  signal?.throwIfAborted();

  const before = entry.session.bytes;
  const result = await entry.session.patchBlocks(edits);
  const skipped = result.skipped.map((s) => ({ reason: s.reason, detail: s.before ?? s.after }));
  if (!result.success) {
    return {
      ...stateResult(session_id, entry, false),
      success: false, applied: 0, skipped,
      error: result.error ?? '패치 실패',
    };
  }
  if (result.applied > 0) {
    entry.undoStack.push(before);
    if (entry.undoStack.length > UNDO_LIMIT) entry.undoStack.shift();
    entry.redoStack = [];
  }
  logger.info(`[edit_patch] 세션 ${session_id} — 적용 ${result.applied} / 건너뜀 ${skipped.length}`);
  return { ...stateResult(session_id, entry, include_doc), applied: result.applied, skipped };
}

// ── edit_undo / edit_redo ──

export interface EditHistoryParams {
  session_id: string;
  include_doc?: boolean;
}

export async function editUndo(params: EditHistoryParams, signal?: AbortSignal): Promise<EditStateResult> {
  const { session_id, include_doc = true } = params;
  const entry = getSession(session_id);
  const prev = entry.undoStack.pop();
  if (!prev) throw new Error('되돌릴 변경이 없습니다');
  signal?.throwIfAborted();
  entry.redoStack.push(entry.session.bytes);
  entry.session = await HwpxSession.open(prev);
  logger.info(`[edit_undo] 세션 ${session_id} — 남은 undo ${entry.undoStack.length}`);
  return stateResult(session_id, entry, include_doc);
}

export async function editRedo(params: EditHistoryParams, signal?: AbortSignal): Promise<EditStateResult> {
  const { session_id, include_doc = true } = params;
  const entry = getSession(session_id);
  const next = entry.redoStack.pop();
  if (!next) throw new Error('다시 실행할 변경이 없습니다');
  signal?.throwIfAborted();
  entry.undoStack.push(entry.session.bytes);
  if (entry.undoStack.length > UNDO_LIMIT) entry.undoStack.shift();
  entry.session = await HwpxSession.open(next);
  logger.info(`[edit_redo] 세션 ${session_id} — 남은 redo ${entry.redoStack.length}`);
  return stateResult(session_id, entry, include_doc);
}

// ── edit_save ──

export interface EditSaveParams {
  session_id: string;
  output_path: string;
}

export async function editSave(params: EditSaveParams): Promise<{ success: boolean; output_path: string }> {
  const { session_id, output_path } = params;
  const entry = getSession(session_id);
  await mkdir(dirname(output_path), { recursive: true });
  await writeFile(output_path, entry.session.bytes);
  logger.info(`[edit_save] 세션 ${session_id} → ${output_path}`);
  return { success: true, output_path };
}

// ── edit_close ──

export async function editClose(params: { session_id: string }): Promise<{ success: boolean }> {
  sessions.delete(params.session_id);
  logger.info(`[edit_close] 세션 ${params.session_id} 종료 (활성 ${sessions.size})`);
  return { success: true };
}
