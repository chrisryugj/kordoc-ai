/** MCP 서버 (stdio) — 엔진 번들을 `--mcp` 로 띄우면 작업 에이전트 도구(core/agent-tools)를 바깥 AI 에이전트에 낸다.
 *
 * 앱 화면의 'AI에게 일 시키기'와 같은 도구·같은 실행 길(라우터 디스패치)이다. 의존성 없이 MCP 기본 메서드만:
 * initialize · tools/list · tools/call · ping (알림은 받기만. notifications/cancelled 는 돌던 도구를 멈춘다).
 * KORDOC_ROOT 가 있으면 그 폴더 밖 파일을 막는다 (MCP 등록 때 고른 폴더).
 */

import { createInterface } from 'node:readline';
import type { RpcRouter } from '../rpc/router.js';
import { routerDispatch } from '../rpc/dispatch.js';
import { WORK_SYSTEM, runWorkTool, workToolDefs } from '../core/agent-tools/index.js';
import { muteNotifications } from '../infra/progress.js';
import { reloadIfChanged } from '../infra/config.js';
import { syncOfflineEnv } from '../infra/net-guard.js';
import { confineOutputs } from '../core/output/index.js';
import { logger } from '../infra/logger.js';
import { flushUsage } from '../infra/usage.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Msg { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
type Reply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export function createMcpHandler(router: RpcRouter, opts: { version: string; root?: string }) {
  /** 돌고 있는 tools/call (요청 id → 멈춤 신호). 바깥 AI 에서 사용자가 중지를 누르면 그 요청의 도구를 멈춘다:
   *  무시하면 수백 쪽 글자 인식이 끝까지 돌며 다음 요청을 줄 세운다 */
  const running = new Map<string | number, AbortController>();
  return async (msg: Msg): Promise<Reply | null> => {
    if (msg.id === undefined || msg.id === null) {
      // 알림 (notifications/initialized 등)에는 답하지 않는다
      if (msg.method === 'notifications/cancelled') running.get(msg.params?.requestId as string | number)?.abort();
      return null;
    }
    const ok = (result: unknown): Reply => ({ jsonrpc: '2.0', id: msg.id!, result });
    switch (msg.method) {
      case 'initialize': {
        const asked = String(msg.params?.protocolVersion ?? '');
        return ok({
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'kordoc-ai', title: 'KorDoc AI', version: opts.version },
          instructions: WORK_SYSTEM,
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: workToolDefs() });
      case 'tools/call': {
        const name = String(msg.params?.name ?? '');
        const args = msg.params?.arguments;
        const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
        // 앱에서 그새 설정을 바꿨으면 따른다 (폐쇄망 모드를 켰는데 이 프로세스만 인터넷 AI 로 보내지 않게)
        if (reloadIfChanged()) syncOfflineEnv();
        const ac = new AbortController();
        running.set(msg.id, ac);
        try {
          const r = await runWorkTool(name, input, routerDispatch(router, ac.signal), { root: opts.root });
          // 멈춘 요청에는 답을 보내지 않는다 (MCP 규격)
          if (ac.signal.aborted) return null;
          return ok({ content: [{ type: 'text', text: `${r.summary}\n\n${r.output}` }], isError: !!r.isError });
        } finally {
          running.delete(msg.id);
        }
      }
      default:
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  };
}

export function runMcpServer(router: RpcRouter, version: string): void {
  muteNotifications();
  // 라이브러리가 console.log 로 stdout 을 더럽히지 않게
  console.log = console.info = (...a: unknown[]) => console.error(...a);
  const root = process.env.KORDOC_ROOT || undefined;
  // 허용 폴더를 정했으면 결과도 그 안에 (설정의 저장 폴더가 밖이면 허용 폴더 안의 같은 이름 폴더로)
  if (root) confineOutputs(root);
  const handle = createMcpHandler(router, { version, root });
  const write = (r: Reply) => process.stdout.write(`${JSON.stringify(r, (_k, v: unknown) => (typeof v === 'string' ? (v as string & { toWellFormed(): string }).toWellFormed() : v))}\n`);
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Msg;
    try { msg = JSON.parse(line) as Msg; } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    void handle(msg).then((r) => { if (r) write(r); }).catch((e) => {
      logger.error(`[mcp] ${msg.method}: ${e}`);
      if (msg.id !== undefined && msg.id !== null) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e instanceof Error ? e.message : e) } });
    });
  });
  // 효과 집계는 기록 2초 뒤에 저장한다: 미뤄 둔 것을 쓰고 끝낸다
  rl.on('close', () => { flushUsage(); process.exit(0); });
  logger.info(`[mcp] KorDoc AI MCP 서버 시작 (도구 ${workToolDefs().length}개${process.env.KORDOC_ROOT ? `, 허용 폴더 ${process.env.KORDOC_ROOT}` : ''})`);
}
