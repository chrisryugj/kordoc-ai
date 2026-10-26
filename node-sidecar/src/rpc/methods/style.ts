/** RPC 메서드 — 우리 서식으로 맞추기 (core/style) · 우리 기관 서식 묶음 (core/org-corpus) */

import type { RpcRouter } from '../router.js';
import { styleApply, styleDelete, styleExtract, styleList, stylePreview, styleSave } from '../../core/style/index.js';
import { orgCorpusAdd, orgCorpusList, orgCorpusReference, orgCorpusRemove, orgCorpusSet } from '../../core/org-corpus/index.js';
import { bool, optPath, registrar, reqPath, reqPaths, str } from './params.js';

export function registerStyle(router: RpcRouter): void {
  const reg = registrar(router);
  reg('style_extract', (p, signal) => styleExtract(reqPath(p.path), signal), { heavy: true });
  reg('style_preview', (p) => stylePreview({ style_id: str(p.style_id), format: p.format }));
  reg('style_save', (p) => styleSave({ name: String(p.name ?? ''), format: p.format }));
  reg('style_list', () => styleList());
  reg('style_delete', (p) => styleDelete(String(p.id ?? '')));
  reg('style_apply', (p, signal) => styleApply({
    source_paths: reqPaths(p.source_paths),
    style_id: str(p.style_id),
    sample_path: optPath(p.sample_path),
    output_dir: optPath(p.output_dir),
  }, signal), { heavy: true });

  reg('org_corpus_list', (p) => orgCorpusList(bool(p.settle) ?? false));
  reg('org_corpus_add', (p, signal) => orgCorpusAdd(reqPaths(p.paths), signal), { heavy: true });
  reg('org_corpus_set', (p) => orgCorpusSet({ id: String(p.id ?? ''), kind: str(p.kind), exemplar: bool(p.exemplar) }));
  reg('org_corpus_remove', (p) => orgCorpusRemove(String(p.id ?? '')));
  reg('org_corpus_reference', (p, signal) => orgCorpusReference(String(p.kind ?? ''), signal));
}
