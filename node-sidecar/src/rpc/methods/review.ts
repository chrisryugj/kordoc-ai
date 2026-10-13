/** RPC 메서드 — 결재 전 한 번에 점검 (core/gongmun/precheck) · 글 → 쪽 찾기 */

import type { RpcRouter } from '../router.js';
import { precheck } from '../../core/gongmun/precheck.js';
import { findPages } from '../../core/gongmun/pages.js';
import { bool, registrar, reqPath, strList } from './params.js';

export function registerReview(router: RpcRouter): void {
  const reg = registrar(router);
  reg('precheck', (p, signal) => precheck({ path: reqPath(p.path), munche: bool(p.munche), keep: strList(p.keep) }, signal), { heavy: true });
  reg('find_pages', (p, signal) => findPages({ path: reqPath(p.path), texts: (strList(p.texts) ?? []).slice(0, 200) }, signal));
}
