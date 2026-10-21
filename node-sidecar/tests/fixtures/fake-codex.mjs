#!/usr/bin/env node
// 가짜 Codex app-server (JSON-RPC, 줄 단위) — 실제 codex 대신 시험에서 띄운다.
// FAKE_CODEX_MODE: ok · apikey · signedout · mcp · nostatus · usage · noprofile · hang · toolitem · imageview · noinit · oldcodex · toolong · server
// FAKE_LOG: 받은 인자·요청을 JSON 줄로 남길 파일
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_CODEX_MODE ?? 'ok';
const log = (entry) => { if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(entry)}\n`); };
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
log({ kind: 'start', pid: process.pid, args: process.argv.slice(2), cwd: process.cwd(), env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null, CODEX_API_KEY: process.env.CODEX_API_KEY ?? null } });

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const m = JSON.parse(line);
  log({ kind: 'rpc', method: m.method, params: m.params, id: m.id, result: m.result, error: m.error });
  if (m.id === undefined || m.method === undefined) return;
  const reply = (result) => out({ id: m.id, result });
  switch (m.method) {
    case 'initialize': return mode === 'noinit' ? undefined : reply({ userAgent: 'fake' });
    case 'account/read':
      if (mode === 'apikey') return reply({ account: { type: 'apiKey' }, requiresOpenaiAuth: true });
      if (mode === 'signedout') return reply({ account: null, requiresOpenaiAuth: true });
      return reply({ account: { type: 'chatgpt', planType: 'plus', email: 'kim@example.com' }, requiresOpenaiAuth: true });
    case 'config/read': {
      // 실제 Codex 처럼 받은 -c 덮어쓰기를 설정에 반영한다 (oldcodex: shell_tool 이름을 모르는 낮은 버전)
      const config = { mcp_servers: { github: { command: 'gh-mcp' } }, features: { shell_tool: true, unified_exec: true, view_image: true }, web_search: null };
      const argv = process.argv.slice(2);
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] !== '-c') continue;
        const [k, v] = argv[i + 1].split('=');
        if (k.startsWith('features.') && !(mode === 'oldcodex' && k === 'features.shell_tool')) config.features[k.slice(9)] = v === 'true';
        if (k === 'web_search') config.web_search = JSON.parse(v);
      }
      if (mode === 'oldcodex') delete config.features.shell_tool;
      return reply({ config });
    }
    case 'model/list': return reply({ data: [{ id: 'gpt-5.5-codex', displayName: 'GPT-5.5 Codex', isDefault: true }, { id: 'gpt-5.5-mini', displayName: 'Mini' }, { id: 'hidden-one', hidden: true }], nextCursor: null });
    case 'thread/start': {
      const profile = m.params?.config?.default_permissions;
      if (mode === 'noprofile') return reply({ thread: { id: profile ? 'thread-profile' : 'thread-ro' }, activePermissionProfile: null });
      // 시험은 프로세스가 둘이 들 수 있어 서버 요청 하나를 끼워 본다 (거절로 답해야 함)
      out({ id: 'srv-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1' } });
      return reply({ thread: { id: 'thread-1' }, activePermissionProfile: profile ? { id: profile } : null });
    }
    case 'thread/delete': return reply({});
    case 'mcpServerStatus/list':
      if (mode === 'nostatus') return reply({ data: [{ name: 'github', tools: {} }], nextCursor: null });
      return reply({ data: [{ name: 'github', runtimeStatus: mode === 'mcp' ? 'ready' : 'disabled', tools: mode === 'mcp' ? { search: {} } : {} }], nextCursor: null });
    case 'turn/start': {
      reply({ turn: { id: 'turn-1' } });
      if (mode === 'hang') return;
      const threadId = m.params.threadId;
      const n = (method, params) => out({ method, params: { threadId, turnId: 'turn-1', ...params } });
      n('turn/started', { turn: { id: 'turn-1' } });
      if (mode === 'usage') {
        out({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 1800 } } } });
        n('turn/completed', { turn: { id: 'turn-1', status: 'failed', error: { message: 'usage limit', codexErrorInfo: 'usageLimitExceeded' } } });
        return;
      }
      if (mode === 'toolitem') { n('item/started', { item: { type: 'commandExecution', command: 'type C:\\secret.txt' } }); return; }
      if (mode === 'imageview') { n('item/started', { item: { type: 'imageView', path: 'C:\\secret.png' } }); return; }
      if (mode === 'toolong') { n('turn/completed', { turn: { id: 'turn-1', status: 'failed', error: { message: 'too long', codexErrorInfo: 'contextWindowExceeded' } } }); return; }
      if (mode === 'server') { n('turn/completed', { turn: { id: 'turn-1', status: 'failed', error: { message: 'x', codexErrorInfo: { responseStreamConnectionFailed: { httpStatusCode: 502 } } } } }); return; }
      const text = m.params.outputSchema ? '{"a":"1"}' : '안녕하세요';
      n('item/agentMessage/delta', { delta: text.slice(0, 2) });
      n('item/completed', { item: { type: 'agentMessage', text } });
      n('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
      return;
    }
    case 'turn/interrupt': return reply({});
    default: return out({ id: m.id, error: { code: -32601, message: 'unknown' } });
  }
});
rl.on('close', () => process.exit(0));
