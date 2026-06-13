/**
 * 양식 채우기 작업대 (KorDoc Studio Phase B) — kordoc v3.1 에디터 API 연동.
 *
 * - formSchema: 양식 필드 인식 + 타입 추론 (FillWizard 좌측 폼 자동 생성)
 * - formFill: fillHwpx 바이트 보존 채우기 + 재파싱 검증 배지
 * - patchBlocks: 블록 단위 증분 패치 (Phase C 클릭-편집 대비, stateless)
 *
 * Phase B 제약: 채우기/패치는 HWPX 전용 (HWP5 빈 셀 채우기는 Phase E R&D).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import {
  parse, extractFormSchema, fillHwpx, patchHwpxBlocks, compare,
  type FormFieldSchema, type BlockEdit, type DiffResult,
} from 'kordoc';
import { getConfig } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';

/** HWPX = ZIP 매직 (PK\x03\x04) — fillHwpx/patchBlocks가 지원하는 유일한 컨테이너 */
function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** 미리보기/편집용 문서 바이트 동봉 상한 — IPC JSON 직렬화 비용 가드 */
const MAX_INLINE_DOC_BYTES = 30 * 1024 * 1024;

// ── form_schema ──

export interface FormSchemaParams {
  input_path: string;
  pages?: string;
  /** true면 응답에 문서 바이트(base64) 동봉 — 프론트 rhwp 미리보기용 */
  include_doc?: boolean;
}

export interface FormSchemaRpcResult {
  success: boolean;
  fields: FormFieldSchema[];
  confidence: number;
  /** 채우기 지원 여부 (HWPX만 true) */
  fillable: boolean;
  /** fillable=false 사유 (한국어) */
  fillable_reason?: string;
  /** include_doc 시 원본 문서 base64 (HWPX) */
  doc_b64?: string;
  error?: string;
}

export async function formSchema(params: FormSchemaParams, signal?: AbortSignal): Promise<FormSchemaRpcResult> {
  const { input_path, pages, include_doc } = params;
  logger.info(`[form_schema] 시작: ${input_path}`);
  signal?.throwIfAborted();

  const buffer = await readFile(input_path);
  signal?.throwIfAborted();

  const result = await parse(toArrayBuffer(buffer), { pages });
  if (!result.success) {
    return { success: false, fields: [], confidence: 0, fillable: false, error: result.error };
  }

  const schema = extractFormSchema(result.blocks);
  const hwpx = isZip(buffer) && result.fileType === 'hwpx';
  const out: FormSchemaRpcResult = {
    success: true,
    fields: schema.fields,
    confidence: schema.confidence,
    fillable: hwpx,
    ...(hwpx ? {} : { fillable_reason: 'HWPX 양식만 채우기를 지원합니다. 한컴오피스에서 HWPX로 저장 후 다시 시도하세요.' }),
  };
  if (include_doc && hwpx && buffer.length <= MAX_INLINE_DOC_BYTES) {
    out.doc_b64 = buffer.toString('base64');
  }
  logger.info(`[form_schema] ${schema.fields.length}개 필드 (confidence ${schema.confidence}, fillable=${hwpx})`);
  return out;
}

// ── form_fill ──

export interface FormFillParams {
  input_path: string;
  /** 라벨 → 값 */
  values: Record<string, string>;
  /** 미지정 시 설정 출력 폴더 → 원본 폴더, 파일명 `{stem}_채움.hwpx` */
  output_path?: string;
  /** true면 저장 없이 결과 바이트만 반환 (미리보기 갱신용) */
  dry_run?: boolean;
  /** 응답에 채워진 문서 base64 동봉 (기본 true — 미리보기 갱신) */
  include_doc?: boolean;
}

export interface FormFillRpcResult {
  success: boolean;
  filled: Array<{ label: string; value: string }>;
  unmatched: string[];
  output_path: string;
  /** 재파싱 검증: 채움 전→후 diff에서 modified 수 (changes ≥ filled 수 미만이면 정상 범위) */
  verification: { reparse_ok: boolean; changed_blocks: number };
  doc_b64?: string;
  error?: string;
}

export async function formFill(params: FormFillParams, signal?: AbortSignal): Promise<FormFillRpcResult> {
  const { input_path, values, output_path, dry_run, include_doc = true } = params;
  const labels = Object.keys(values ?? {});
  if (labels.length === 0) throw new Error('채울 값이 없습니다 ("values" 비어 있음)');

  logger.info(`[form_fill] 시작: ${input_path} (${labels.length}개 값)`);
  sendProgress({ current: 0, total: 3, message: '양식 읽는 중...' });
  signal?.throwIfAborted();

  const buffer = await readFile(input_path);
  if (!isZip(buffer)) {
    throw new Error('HWPX 양식만 채우기를 지원합니다 (HWP 5.x는 HWPX로 변환 후 사용)');
  }
  signal?.throwIfAborted();

  sendProgress({ current: 1, total: 3, message: '값 채우는 중 (원본 서식 보존)...' });
  const fill = await fillHwpx(toArrayBuffer(buffer), values);
  const filledBuf = Buffer.from(fill.buffer);

  // 재파싱 검증 — 채움 결과가 파싱 가능하고 변경이 채움 범위 안인지 기계 증명
  sendProgress({ current: 2, total: 3, message: '재파싱 검증 중...' });
  let verification = { reparse_ok: false, changed_blocks: -1 };
  try {
    const diff: DiffResult = await compare(toArrayBuffer(buffer), toArrayBuffer(filledBuf));
    verification = {
      reparse_ok: diff.stats.added === 0 && diff.stats.removed === 0,
      changed_blocks: diff.stats.modified,
    };
  } catch (e) {
    logger.warn(`[form_fill] 검증 diff 실패: ${e instanceof Error ? e.message : e}`);
  }

  let outPath = '';
  if (!dry_run) {
    const cfg = getConfig('convert');
    const outDir = output_path ? dirname(output_path) : (cfg.output_dir || dirname(input_path));
    const stem = basename(input_path, extname(input_path));
    outPath = output_path || join(outDir, `${stem}_채움.hwpx`);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, filledBuf);
  }

  sendProgress({ current: 3, total: 3, message: `${fill.filled.length}개 필드 채움 완료${outPath ? ` → ${basename(outPath)}` : ''}` });
  logger.info(`[form_fill] filled=${fill.filled.length} unmatched=${fill.unmatched.length} verify=${JSON.stringify(verification)}`);

  return {
    success: true,
    filled: fill.filled.map((f) => ({ label: f.label, value: f.value })),
    unmatched: fill.unmatched,
    output_path: outPath,
    verification,
    ...(include_doc && filledBuf.length <= MAX_INLINE_DOC_BYTES ? { doc_b64: filledBuf.toString('base64') } : {}),
  };
}

// ── patch_blocks ──

export interface PatchBlocksParams {
  /** 둘 중 하나 필수 — doc_b64 우선 (프론트가 들고 있는 최신 상태) */
  input_path?: string;
  doc_b64?: string;
  edits: BlockEdit[];
  output_path?: string;
  include_doc?: boolean;
}

export interface PatchBlocksRpcResult {
  success: boolean;
  applied: number;
  skipped: Array<{ reason: string; detail?: string }>;
  /** 패치 전→후 diff 요약 (session changes 의미 — 적용 편집 수만큼 modified가 정상) */
  changed_blocks: number;
  output_path: string;
  doc_b64?: string;
  error?: string;
}

export async function patchBlocks(params: PatchBlocksParams, signal?: AbortSignal): Promise<PatchBlocksRpcResult> {
  const { input_path, doc_b64, edits, output_path, include_doc = true } = params;
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('편집 목록이 비어 있습니다 ("edits")');

  const bytes = doc_b64
    ? Buffer.from(doc_b64, 'base64')
    : await readFile(input_path!);
  if (!isZip(bytes)) throw new Error('HWPX 문서만 블록 패치를 지원합니다');
  signal?.throwIfAborted();

  logger.info(`[patch_blocks] ${edits.length}개 편집`);
  const result = await patchHwpxBlocks(new Uint8Array(bytes), edits);
  if (!result.success || !result.data) {
    return {
      success: false, applied: result.applied, changed_blocks: 0, output_path: '',
      skipped: result.skipped.map((s) => ({ reason: s.reason, detail: s.before ?? s.after })),
      error: result.error ?? '패치 실패',
    };
  }

  const patched = Buffer.from(result.data);
  let outPath = '';
  if (output_path) {
    outPath = output_path;
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, patched);
  }

  return {
    success: true,
    applied: result.applied,
    skipped: result.skipped.map((s) => ({ reason: s.reason, detail: s.before ?? s.after })),
    changed_blocks: result.changes?.stats.modified ?? -1,
    output_path: outPath,
    ...(include_doc && patched.length <= MAX_INLINE_DOC_BYTES ? { doc_b64: patched.toString('base64') } : {}),
  };
}
