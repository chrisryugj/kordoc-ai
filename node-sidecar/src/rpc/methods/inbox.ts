/** RPC 메서드 — 받은 공문 기한·요청 관리 (core/inbox) */

import type { RpcRouter } from '../router.js';
import { inboxAdd, inboxList, inboxRemove, inboxUpdate } from '../../core/inbox/index.js';
import { oneOf, registrar, reqPaths } from './params.js';

export function registerInbox(router: RpcRouter): void {
  const reg = registrar(router);
  reg('inbox_add', (p, signal) => inboxAdd(reqPaths(p.paths), signal), { heavy: true });
  reg('inbox_list', () => inboxList());
  reg('inbox_update', (p) => inboxUpdate({
    id: String(p.id ?? ''),
    status: oneOf(p.status, ['todo', 'done'] as const),
    due: p.due === null ? null : typeof p.due === 'string' ? p.due : undefined,
    note: typeof p.note === 'string' ? p.note : undefined,
  }));
  reg('inbox_remove', (p) => inboxRemove(String(p.id ?? '')));
}
