/** RPC 메서드 — 작업 에이전트 도구 (core/agent-tools). 모델 한 차례는 ai_agent_step, 도구 실행은 여기서 엔진 안 디스패치로 */

import type { RpcRouter } from '../router.js';
import { routerDispatch } from '../dispatch.js';
import { WORK_SYSTEM, runWorkTool, workToolDefs } from '../../core/agent-tools/index.js';
import { registrar, str } from './params.js';
import { savedMinutes } from '../../infra/usage.js';

export function registerAgent(router: RpcRouter): void {
  const reg = registrar(router);
  reg('agent_tools', () => ({ system: WORK_SYSTEM, tools: workToolDefs({ app: true }) }));
  // heavy 아님: 안에서 부르는 메서드가 차선 자리를 잡는다 (겉에서 잡으면 자리 둘을 겹쳐 쥔다). 화면이 멈추면 안의 호출도 멈춘다
  reg('agent_tool_run', async (p, signal) => {
    const name = str(p.name);
    if (!name) throw new Error('도구 이름이 없습니다.');
    const input = p.input && typeof p.input === 'object' && !Array.isArray(p.input) ? (p.input as Record<string, unknown>) : {};
    let saved = 0;
    const r = await runWorkTool(name, input, routerDispatch(router, signal, (m, params, result) => { saved += savedMinutes(m, params, result); }), { app: true });
    return { ...r, ...(saved && !r.isError ? { saved_min: saved } : {}) };
  });
}
