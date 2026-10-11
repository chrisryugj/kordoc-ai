/** RPC 메서드 — 법령 근거 확인 (core/law). 인터넷·법제처 아이디(OC)가 있어야 대조하고, 폐쇄망이면 인용 찾기만 */

import type { RpcRouter } from '../router.js';
import { lawCheck, lawTest } from '../../core/law/index.js';
import { optPath, registrar } from './params.js';

export function registerLaw(router: RpcRouter): void {
  const reg = registrar(router);
  reg('law_check', (p, signal) => lawCheck({ text: typeof p.text === 'string' ? p.text : undefined, path: optPath(p.path) }, signal));
  reg('law_test', (_p, signal) => lawTest(signal));
}
