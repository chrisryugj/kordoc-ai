/** RPC 메서드 — 작성실(공문서 생성·서식 채우기)·직장인 문서 작업 묶음·서식함·내 기관 정보 (documents.ts 에서 등록)
 *
 * generate_hwpx·template_fields·gongmun_meta·서식함 조회는 작성실이 입력할 때마다 부르므로 heavy 아님.
 */

import type { RpcRouter } from '../router.js';
import { generateHwpx, gongmunMeta } from '../../core/gongmun/index.js';
import { mailMerge, templateFields, templateFill } from '../../core/template/index.js';
import { templateAdd, templateAnalyze, templateLibrary, templateRemove, templateStarter } from '../../core/template/library.js';
import { orgAutofill } from '../../core/template/org.js';
import { toHwpx, toHwpxBatch } from '../../core/to-hwpx/index.js';
import { compareHwpx } from '../../core/comparator/index.js';
import { bundlePdf, pdfStamp } from '../../core/export/index.js';
import { collectFields, collectRun, extractImages } from '../../core/extract/index.js';
import { searchFiles } from '../../core/search/index.js';
import { previewBytes, readFileB64, writeFileB64 } from '../../core/files/io.js';
import { bool, num, oneOf, optPath, registrar, reqPath, reqPaths, str, strList } from './params.js';

export function registerDocumentWork(router: RpcRouter): void {
  const reg = registrar(router);

  // ── 작성실 ──
  reg('gongmun_meta', () => gongmunMeta());
  reg('generate_hwpx', (p, signal) => {
    const cover = p.cover && typeof p.cover === 'object' ? (p.cover as { org?: unknown; date?: unknown }) : undefined;
    return generateHwpx({
      markdown: String(p.markdown ?? ''),
      output_path: optPath(p.output_path),
      preset: str(p.preset),
      agency: str(p.agency),
      levels_from: optPath(p.levels_from),
      profile_from: optPath(p.profile_from),
      cover: cover ? { org: str(cover.org), date: str(cover.date) } : undefined,
      toc: bool(p.toc),
      approval: strList(p.approval),
      page_numbers: bool(p.page_numbers),
      end_mark: bool(p.end_mark),
      preview_only: bool(p.preview_only),
      preview_pages: num(p.preview_pages),
      preview_hwpx: bool(p.preview_hwpx),
    }, signal);
  });
  reg('template_fields', (p) => templateFields({ template: str(p.template), path: optPath(p.path) }));
  reg('template_fill', (p) => templateFill({
    template: str(p.template),
    path: optPath(p.path),
    values: (p.values && typeof p.values === 'object' ? p.values : {}) as Record<string, string>,
    output_path: optPath(p.output_path),
  }), { heavy: true });
  reg('mail_merge', (p, signal) => mailMerge({
    template_path: optPath(p.template_path),
    template: str(p.template),
    data_path: reqPath(p.data_path),
    name_column: str(p.name_column),
    output_dir: optPath(p.output_dir),
  }, signal), { heavy: true });

  // ── 직장인 문서 작업 묶음 ──
  reg('to_hwpx', (p, signal) => toHwpx({ path: reqPath(p.path), preset: str(p.preset), ocr: oneOf(p.ocr, ['auto', 'force', 'off'] as const), output_path: optPath(p.output_path) }, signal), { heavy: true });
  reg('to_hwpx_batch', (p, signal) => toHwpxBatch({ paths: reqPaths(p.paths), preset: str(p.preset), output_dir: optPath(p.output_dir) }, signal), { heavy: true });
  reg('compare_hwpx', (p, signal) => compareHwpx({ old_path: reqPath(p.old_path), new_path: reqPath(p.new_path), title: str(p.title), output_path: optPath(p.output_path) }, signal), { heavy: true });
  reg('bundle_pdf', (p, signal) => bundlePdf({ paths: reqPaths(p.paths), output_path: optPath(p.output_path), watermark: str(p.watermark), page_numbers: bool(p.page_numbers) }, signal), { heavy: true });
  reg('pdf_stamp', (p, signal) => pdfStamp({ path: reqPath(p.path), watermark: str(p.watermark), page_numbers: bool(p.page_numbers), output_path: optPath(p.output_path) }, signal), { heavy: true });
  reg('extract_images', (p, signal) => extractImages({ path: reqPath(p.path), output_dir: optPath(p.output_dir), allow_empty: bool(p.allow_empty) }, signal), { heavy: true });
  reg('search_files', (p, signal) => searchFiles({ paths: reqPaths(p.paths), query: String(p.query ?? ''), max_hits: num(p.max_hits) }, signal), { heavy: true });
  reg('collect_fields', (p, signal) => collectFields({ paths: reqPaths(p.paths) }, signal), { heavy: true });
  reg('collect_run', (p, signal) => collectRun({ paths: reqPaths(p.paths), fields: strList(p.fields) ?? [], output_path: optPath(p.output_path) }, signal), { heavy: true });
  reg('write_file', (p) => writeFileB64({ path: reqPath(p.path), data_b64: String(p.data_b64 ?? ''), overwrite: bool(p.overwrite) }));
  reg('read_file_b64', (p) => readFileB64(reqPath(p.path), bool(p.preview)));
  reg('preview_bytes', (p) => previewBytes({ data_b64: String(p.data_b64 ?? '') }));

  // ── 서식함·내 기관 정보 ──
  reg('template_library', () => templateLibrary());
  reg('template_add', (p, signal) => templateAdd({ path: reqPath(p.path), name: str(p.name), category: str(p.category) }, signal), { heavy: true });
  reg('template_remove', (p) => templateRemove(String(p.id ?? '')));
  reg('template_analyze', (p, signal) => templateAnalyze(reqPath(p.path), signal), { heavy: true });
  reg('template_starter', (p) => templateStarter({ preset: String(p.preset ?? ''), agency: str(p.agency), output_path: optPath(p.output_path) }));
  reg('org_autofill', (p) => orgAutofill(strList(p.fields) ?? []));
}
