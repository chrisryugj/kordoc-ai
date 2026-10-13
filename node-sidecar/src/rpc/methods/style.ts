/** RPC 메서드 — 우리 서식으로 맞추기 (core/style) */

import type { RpcRouter } from '../router.js';
import { styleApply, styleDelete, styleExtract, styleList, stylePreview, styleSave } from '../../core/style/index.js';
import { optPath, registrar, reqPath, reqPaths, str } from './params.js';

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
}
