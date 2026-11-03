/** 엔진 안에서 다른 RPC 메서드를 부르기 (작업 에이전트 도구·MCP 공용) — 화면이 부른 것과 같은 길(집계·차선·오류 문장).
 *  signal: 부른 쪽(agent_tool_run)이 멈추면 안에서 부른 호출도 멈춘다.
 *  onDone: 성공한 호출마다 (효과 집계와 같은 기준으로 아낀 시간을 더한다) */

import type { RpcRouter } from './router.js';
import type { Dispatch } from '../core/agent-tools/index.js';

export function routerDispatch(router: RpcRouter, signal?: AbortSignal, onDone?: (method: string, params: Record<string, unknown>, result: unknown) => void): Dispatch {
  return async (method, params) => {
    const p = { ...(params as Record<string, unknown>) };
    const r = await router.dispatch(method, { ...p }, undefined, signal);
    if (r.error) throw new Error(r.error.message);
    onDone?.(method, p, r.result);
    return r.result as never;
  };
}
