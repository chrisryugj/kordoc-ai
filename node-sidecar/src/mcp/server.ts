/** MCP 서버 (stdio) — 엔진 번들을 `--mcp` 로 띄우면 작업 에이전트 도구(core/agent-tools)를 바깥 AI 에이전트에 낸다.
 *
 * 앱 화면의 'AI에게 일 시키기'와 같은 도구·같은 실행 길(라우터 디스패치)이다. 의존성 없이 MCP 기본 메서드만:
 * initialize · tools/list · tools/call · ping (알림은 받기만).
 * KORDOC_ROOT 가 있으면 그 폴더 밖 파일을 막는다 (MCP 등록 때 고른 폴더).
 */

import { createInterface } from 'node:readline';
import type { RpcRouter } from '../rpc/router.js';
import { routerDispatch } from '../rpc/dispatch.js';
import { WORK_SYSTEM, runWorkTool, workToolDefs } from '../core/agent-tools/index.js';
import { muteNotifications } from '../infra/progress.js';
import { reloadIfChanged } from '../infra/config.js';
import { syncOfflineEnv } from '../infra/net-guard.js';
import { logger } from '../infra/logger.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Msg { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
type Reply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export function createMcpHandler(router: RpcRouter, opts: { version: string; root?: string }) {
  const dispatch = routerDispatch(router);
  return async (msg: Msg): Promise<Reply | null> => {
    if (msg.id === undefined || msg.id === null) return null; // 알림 (notifications/initialized 등)
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
        const r = await runWorkTool(name, input, dispatch, { root: opts.root });
        return ok({ content: [{ type: 'text', text: `${r.summary}\n\n${r.output}` }], isError: !!r.isError });
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
  const handle = createMcpHandler(router, { version, root: process.env.KORDOC_ROOT || undefined });
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
  rl.on('close', () => process.exit(0));
  logger.info(`[mcp] KorDoc AI MCP 서버 시작 (도구 ${workToolDefs().length}개${process.env.KORDOC_ROOT ? `, 허용 폴더 ${process.env.KORDOC_ROOT}` : ''})`);
}
