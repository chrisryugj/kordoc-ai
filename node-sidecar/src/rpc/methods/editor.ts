/** RPC 메서드 — 내장 한글 편집기 (리드) */

import type { RpcRouter } from '../router.js';
import { startEditorServer } from '../../core/editor-server/index.js';
import { editorOpen, editorWrite } from '../../core/hwp-save/index.js';
import { bool, registrar, reqPath, str } from './params.js';

export function registerEditor(router: RpcRouter): void {
  router.register('editor_server', () => startEditorServer());
  const reg = registrar(router);
  reg('editor_open', (p) => editorOpen(reqPath(p.path)));
  reg('editor_write', (p) => editorWrite({ path: reqPath(p.path), data_b64: String(p.data_b64 ?? ''), token: str(p.token), overwrite: bool(p.overwrite), backup: bool(p.backup) }));
}
