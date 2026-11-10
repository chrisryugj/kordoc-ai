/** RPC 메서드 — 작업 에이전트 도구 (core/agent-tools). 모델 한 차례는 ai_agent_step, 도구 실행은 여기서 엔진 안 디스패치로 */

import type { RpcRouter } from '../router.js';
import { routerDispatch } from '../dispatch.js';
import { APP_SYSTEM, runWorkTool, workToolDefs } from '../../core/agent-tools/index.js';
import { registrar, str, strList } from './params.js';
import { savedMinutes } from '../../infra/usage.js';

export function registerAgent(router: RpcRouter): void {
  const reg = registrar(router);
  reg('agent_tools', () => ({ system: APP_SYSTEM, tools: workToolDefs({ app: true }) }));
  // heavy 아님: 안에서 부르는 메서드가 차선 자리를 잡는다 (겉에서 잡으면 자리 둘을 겹쳐 쥔다). 화면이 멈추면 안의 호출도 멈춘다
  reg('agent_tool_run', async (p, signal) => {
    const name = str(p.name);
    if (!name) throw new Error('도구 이름이 없습니다.');
    const input = p.input && typeof p.input === 'object' && !Array.isArray(p.input) ? (p.input as Record<string, unknown>) : {};
    let saved = 0;
    // scope: 화면이 넘긴 "사용자가 맡긴 것" (붙인 파일·한 말). 있으면 그 밖의 파일을 막는다
    const sc = p.scope && typeof p.scope === 'object' && !Array.isArray(p.scope) ? (p.scope as Record<string, unknown>) : null;
    const scope = sc ? { files: strList(sc.files) ?? [], said: strList(sc.said) ?? [] } : undefined;
    const r = await runWorkTool(name, input, routerDispatch(router, signal, (m, params, result) => { saved += savedMinutes(m, params, result); }), { app: true, scope });
    return { ...r, ...(saved && !r.isError ? { saved_min: saved } : {}) };
  });
}
