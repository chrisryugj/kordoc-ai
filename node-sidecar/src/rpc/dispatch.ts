/** 엔진 안에서 다른 RPC 메서드를 부르기 (작업 에이전트 도구·MCP 공용) — 화면이 부른 것과 같은 길(집계·차선·오류 문장).
 *  signal: 부른 쪽(agent_tool_run)이 멈추면 안에서 부른 호출도 멈춘다 */

import type { RpcRouter } from './router.js';
import type { Dispatch } from '../core/agent-tools/index.js';

export function routerDispatch(router: RpcRouter, signal?: AbortSignal): Dispatch {
  return async (method, params) => {
    const r = await router.dispatch(method, { ...(params as Record<string, unknown>) }, undefined, signal);
    if (r.error) throw new Error(r.error.message);
    return r.result as never;
  };
}
