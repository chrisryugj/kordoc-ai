/** RPC 메서드 — 문서 (kordoc 엔진, 전부 로컬). 직장인 묶음·서식함·작성실은 documents-work.ts
 *
 * 무거운 메서드(파싱·변환·PDF)는 heavy — 동시 실행 상한을 거친다.
 * 반응성이 필요한 것(doc_info·render_pages·lint·validate·watch·render_preview·편집 세션)은 heavy 아님.
 */

import type { BlockEdit } from 'kordoc';
import type { RpcRouter } from '../router.js';
import type { ConvertParams, RedactRule } from '../../types/rpc-contract.js';
import { convert, convertBatch } from '../../core/converter/index.js';
import { docInfo } from '../../core/files/index.js';
import { renderPages } from '../../core/render/index.js';
import { exportPdf } from '../../core/export/index.js';
import { ocr } from '../../core/ocr/index.js';
import { compareDocs } from '../../core/comparator/index.js';
import { tablesExtract } from '../../core/excel/index.js';
import { lintDoc, lintFix } from '../../core/gongmun/lint.js';
import { redact, redactBatch } from '../../core/redact/index.js';
import { patchDocument, seal, validateHwpxFile } from '../../core/hwpx-tools/index.js';
import { watchList, watchStart, watchStop } from '../../core/watch/index.js';
import { mergeFiles, splitPdf, extractPdfPages, getPdfPageCount } from '../../core/merge/index.js';
import { printFiles, listPrinters } from '../../core/print/index.js';
import { formSchema, formFill, patchBlocks } from '../../core/fill/index.js';
import { renderPreview } from '../../core/preview/index.js';
import { editOpen, editPatch, editUndo, editRedo, editSave, editClose } from '../../core/edit/index.js';
import { outputDir, outputFile, stemOf, uniquePath } from '../../core/output/index.js';
import { bool, num, oneOf, optPath, registrar, reqPath, reqPaths, str, strList } from './params.js';
import { registerDocumentWork } from './documents-work.js';
import { extname, join } from 'node:path';

const REDACT_RULES: readonly RedactRule[] = ['rrn', 'phone', 'email', 'card', 'account', 'passport', 'driver', 'brn', 'crn', 'ip', 'name', 'address'];

/** 계약 ConvertParams 꺼내기 (convert·convert_batch 공용) */
function convertParams(p: Record<string, unknown>): ConvertParams {
  return {
    format: oneOf(p.format, ['md', 'html', 'json', 'chunks', 'txt'] as const),
    pages: str(p.pages),
    password: str(p.password),
    ocr: oneOf(p.ocr, ['auto', 'force', 'off'] as const),
    html_tables: bool(p.html_tables),
    keep_layout: bool(p.keep_layout),
    images: bool(p.images),
    output_dir: optPath(p.output_dir),
  };
}

const rules = (v: unknown) => strList(v)?.filter((r): r is RedactRule => (REDACT_RULES as readonly string[]).includes(r));

export function registerDocuments(router: RpcRouter): void {
  const reg = registrar(router);

  // ── 읽기·보기 ──
  reg('doc_info', (p) => docInfo(reqPath(p.path), str(p.password)));
  reg('convert', (p, signal) => convert({ ...convertParams(p), path: reqPath(p.path), save: bool(p.save) }, signal), { heavy: true });
  reg('convert_batch', (p, signal) => convertBatch({ ...convertParams(p), paths: reqPaths(p.paths) }, signal), { heavy: true });
  reg('render_pages', (p, signal) => renderPages({ path: reqPath(p.path), pages: str(p.pages), max_width: num(p.max_width), password: str(p.password) }, signal));
  reg('export_pdf', (p, signal) => exportPdf({ path: reqPath(p.path), output_path: optPath(p.output_path), overwrite: bool(p.overwrite) }, signal), { heavy: true });
  reg('ocr', (p, signal) => ocr({
    input_path: reqPath(p.input_path),
    output_path: optPath(p.output_path),
    pages: str(p.pages),
    engine: oneOf(p.engine, ['local', 'ai'] as const),
    force: bool(p.force),
  }, signal), { heavy: true });

  // ── 비교·표·검사·보안 ──
  reg('compare', (p, signal) => compareDocs({
    old_path: reqPath(p.old_path),
    new_path: reqPath(p.new_path),
    export: oneOf(p.export, ['html', 'md', 'xlsx'] as const),
    output_path: optPath(p.output_path),
  }, signal), { heavy: true });
  reg('tables_extract', (p, signal) => tablesExtract({
    path: reqPath(p.path),
    format: oneOf(p.format, ['xlsx', 'csv', 'md'] as const) ?? 'xlsx',
    pages: str(p.pages),
    only_data: bool(p.only_data),
    output_path: optPath(p.output_path),
    allow_empty: bool(p.allow_empty),
  }, signal), { heavy: true });
  reg('lint', (p, signal) => lintDoc({ text: typeof p.text === 'string' ? p.text : undefined, path: optPath(p.path), numbers: bool(p.numbers), styles: bool(p.styles), munche: bool(p.munche) }, signal));
  reg('redact', (p, signal) => redact({
    path: reqPath(p.path),
    rules: rules(p.rules),
    mask_char: str(p.mask_char),
    dry_run: bool(p.dry_run),
    output_path: optPath(p.output_path),
    keep: strList(p.keep),
    also_pdf: bool(p.also_pdf),
  }, signal), { heavy: true });
  reg('redact_batch', (p, signal) => redactBatch({ paths: reqPaths(p.paths), rules: rules(p.rules), mask_char: str(p.mask_char), output_dir: optPath(p.output_dir), keep: strList(p.keep) }, signal), { heavy: true });

  // ── 한글 문서 손질 ──
  reg('seal', (p) => seal({ path: reqPath(p.path), image_path: reqPath(p.image_path), anchor: str(p.anchor) ?? '(인)', output_path: optPath(p.output_path) }), { heavy: true });
  reg('lint_fix', (p) => {
    const fixes = Array.isArray(p.fixes) ? p.fixes.filter((f): f is { from: string; to: string } => !!f && typeof f.from === 'string' && typeof f.to === 'string') : [];
    if (!fixes.length) throw new Error('고칠 지적을 하나 이상 고르세요.');
    return lintFix({ path: reqPath(p.path), fixes, output_path: optPath(p.output_path) });
  }, { heavy: true });
  reg('patch_document', (p) => patchDocument({ path: reqPath(p.path), markdown: String(p.markdown ?? ''), output_path: optPath(p.output_path) }), { heavy: true });
  reg('validate_hwpx', (p) => validateHwpxFile(reqPath(p.path)));

  // ── 폴더 감시 ──
  reg('watch_start', (p) => watchStart({ dir: reqPath(p.dir), out_dir: optPath(p.out_dir), format: oneOf(p.format, ['md', 'html', 'txt'] as const) }));
  reg('watch_stop', (p) => watchStop(String(p.id ?? '')));
  reg('watch_list', () => watchList());

  // ── 합치기·나누기·인쇄 ──
  reg('merge_files', (p, signal) => {
    const files = reqPaths(p.files);
    const mode = oneOf(p.mode, ['native', 'markdown'] as const) ?? 'markdown';
    const ext = mode === 'native' ? extname(files[0]).toLowerCase() : '.md';
    const output_path = outputFile({ output_path: optPath(p.output_path), source: files[0], name: `${stemOf(files[0])}_병합${ext}` });
    return mergeFiles({ files, output_path, mode }, signal);
  }, { heavy: true });
  reg('split_pdf', (p, signal) => {
    const file = reqPath(p.input_path);
    const output_dir = optPath(p.output_dir) ?? uniquePath(join(outputDir({ source: file }), `${stemOf(file)}_분리`));
    return splitPdf({ file, output_dir, mode: oneOf(p.mode, ['each', 'range'] as const), ranges: str(p.ranges) }, signal);
  }, { heavy: true });
  reg('pdf_page_count', (p) => getPdfPageCount(reqPath(p.input_path)));
  reg('pdf_extract_pages', (p, signal) => {
    const file = reqPath(p.input_path);
    const pages = str(p.pages);
    if (!pages) throw new Error('뽑을 쪽을 "1-3,5"처럼 적으세요.');
    const mode = oneOf(p.mode, ['include', 'exclude'] as const) ?? 'include';
    const output_path = outputFile({ output_path: optPath(p.output_path), source: file, name: `${stemOf(file)}_${mode === 'exclude' ? '쪽빼기' : '쪽뽑기'}.pdf` });
    return extractPdfPages({ file, output_path, pages, mode }, signal);
  }, { heavy: true });
  reg('print_files', (p, signal) => printFiles({ files: reqPaths(p.files), printer: str(p.printer) }, signal), { heavy: true });
  reg('list_printers', () => listPrinters());

  // ── 양식 채우기 작업대·클릭 편집 세션 (v1 모양 유지) ──
  reg('form_schema', (p, signal) => formSchema({ input_path: reqPath(p.input_path), pages: str(p.pages), include_doc: bool(p.include_doc) }, signal), { heavy: true });
  reg('form_fill', (p, signal) => formFill({
    input_path: reqPath(p.input_path),
    values: p.values as Record<string, string>,
    output_path: optPath(p.output_path),
    dry_run: bool(p.dry_run),
    include_doc: bool(p.include_doc),
  }, signal), { heavy: true });
  reg('patch_blocks', (p, signal) => {
    const input_path = optPath(p.input_path);
    if (!input_path && !p.doc_b64) throw new Error('input_path 또는 doc_b64가 필요합니다.');
    return patchBlocks({ input_path, doc_b64: str(p.doc_b64), edits: p.edits as BlockEdit[], output_path: optPath(p.output_path), include_doc: bool(p.include_doc) }, signal);
  }, { heavy: true });
  reg('render_preview', (p, signal) => {
    const input_path = optPath(p.input_path);
    if (!input_path && !p.doc_b64) throw new Error('input_path 또는 doc_b64가 필요합니다.');
    return renderPreview({ input_path, doc_b64: str(p.doc_b64), pages: p.pages as number[] | undefined, max_pages: num(p.max_pages) }, signal);
  });
  reg('edit_open', (p, signal) => {
    const input_path = optPath(p.input_path);
    if (!input_path && !p.doc_b64) throw new Error('input_path 또는 doc_b64가 필요합니다.');
    return editOpen({ input_path, doc_b64: str(p.doc_b64), include_doc: bool(p.include_doc) }, signal);
  }, { heavy: true });
  reg('edit_patch', (p, signal) => editPatch({ session_id: String(p.session_id ?? ''), edits: p.edits as BlockEdit[], include_doc: bool(p.include_doc) }, signal));
  reg('edit_undo', (p, signal) => editUndo({ session_id: String(p.session_id ?? ''), include_doc: bool(p.include_doc) }, signal));
  reg('edit_redo', (p, signal) => editRedo({ session_id: String(p.session_id ?? ''), include_doc: bool(p.include_doc) }, signal));
  reg('edit_save', (p) => editSave({ session_id: String(p.session_id ?? ''), output_path: reqPath(p.output_path) }));
  reg('edit_close', (p) => editClose({ session_id: String(p.session_id ?? '') }));

  registerDocumentWork(router);
}
