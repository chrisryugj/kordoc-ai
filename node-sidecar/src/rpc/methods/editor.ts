/** RPC 메서드 — 내장 한글 편집기 (리드) */

import type { RpcRouter } from '../router.js';
import { startEditorServer } from '../../core/editor-server/index.js';

export function registerEditor(router: RpcRouter): void {
  router.register('editor_server', () => startEditorServer());
}
