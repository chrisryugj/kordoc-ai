/** RPC 메서드 등록 — 영역별 파일로 나눔 */

import type { RpcRouter } from '../router.js';
import { registerSystem } from './system.js';
import { registerDocuments } from './documents.js';
import { registerAi } from './ai.js';
import { registerEditor } from './editor.js';
import { registerInsight } from './insight.js';
import { registerInbox } from './inbox.js';
import { registerLaw } from './law.js';
import { registerReview } from './review.js';
import { registerStyle } from './style.js';

export function registerAllMethods(router: RpcRouter): void {
  registerSystem(router);
  registerDocuments(router);
  registerAi(router);
  registerEditor(router);
  registerInsight(router);
  registerInbox(router);
  registerLaw(router);
  registerReview(router);
  registerStyle(router);
}
