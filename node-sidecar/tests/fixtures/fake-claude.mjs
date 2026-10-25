#!/usr/bin/env node
// 시험용 가짜 Claude Code (실제 claude 는 구독 사용량을 쓴다). 공식 CLI 의 stream-json 출력 모양만 흉내 낸다.
// FAKE_CLAUDE_MODE: ok · tools · mcp · early · permission · apikey · nokeysrc · auth · retry · toolong · ratelimit · hang · old · exit
//   · noinit(시작 보고 없이 답) · linger(답 뒤 안 끝남) · servertool · userevent · empty
// FAKE_CLAUDE_AUTH: subscription(기본) · apikey · out  (`auth status --json` 의 답)
// FAKE_CLAUDE_REPLY: ok 의 답 글
// FAKE_LOG: 기록 파일. 없으면(앱이 자식 환경을 허용 목록으로 걸러 못 받을 때) 임시 폴더의 kordoc-fake-claude.jsonl
import { appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
const logFile = process.env.FAKE_LOG ?? join(tmpdir(), 'kordoc-fake-claude.jsonl');
const log = (e) => appendFileSync(logFile, `${JSON.stringify(e)}\n`);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const watched = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'NODE_OPTIONS', 'KORDOC_SECRET', 'DISABLE_AUTOUPDATER', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'];
log({ kind: 'run', pid: process.pid, args, cwd: process.cwd(), env: Object.fromEntries(watched.map((k) => [k, process.env[k] ?? null])) });

if (args[0] === '--version') { process.stdout.write('2.1.302 (Claude Code)\n'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') {
  const auth = process.env.FAKE_CLAUDE_AUTH ?? 'subscription';
  const body = auth === 'out' ? { loggedIn: false, authMethod: 'none' }
    : auth === 'apikey' ? { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty', email: 'kim@example.com' }
    : { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'kim@example.com', orgName: '가온시청', subscriptionType: 'max' };
  process.stdout.write(JSON.stringify(body, null, 2));
  process.exit(body.loggedIn ? 0 : 1);
}
if (mode === 'old') { process.stderr.write("error: unknown option '--restricted'\n"); process.exit(1); }
if (mode === 'exit') process.exit(3);

const sysFile = args[args.indexOf('--system-prompt-file') + 1];
log({ kind: 'system', text: readFileSync(sysFile, 'utf-8') });

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  for (const line of input.split('\n').filter(Boolean)) log({ kind: 'stdin', line });
  respond();
});

const init = (over = {}) => out({ type: 'system', subtype: 'init', tools: [], mcp_servers: [], apiKeySource: 'none', model: 'claude-test', ...over });
const delta = (text, type = 'text_delta') => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type, [type === 'text_delta' ? 'text' : 'thinking']: text } } });
const fail = (error, text, status = null) => {
  out({ type: 'assistant', error, message: { role: 'assistant', content: [{ type: 'text', text }] } });
  out({ type: 'result', subtype: 'success', is_error: true, result: text, api_error_status: status });
};
const hang = () => setInterval(() => {}, 1000);

function respond() {
  switch (mode) {
    case 'tools': init({ tools: ['Bash', 'Read'] }); return hang();
    case 'nokeysrc': out({ type: 'system', subtype: 'init', tools: [], mcp_servers: [] }); return hang();
    case 'noinit': out({ type: 'result', subtype: 'success', is_error: false, result: '시작 보고 없는 답' }); return;
    case 'servertool': init(); out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', name: 'web_search' } } }); return hang();
    case 'userevent': init(); out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }); return hang();
    case 'empty': init(); out({ type: 'result', subtype: 'success', is_error: false, result: '' }); return;
    case 'linger': init(); out({ type: 'result', subtype: 'success', is_error: false, result: '안녕하세요' }); return hang();
    case 'mcp': init({ mcp_servers: [{ name: 'github', status: 'connected' }] }); return hang();
    case 'early': out({ type: 'assistant', message: { content: [{ type: 'text', text: '먼저' }] } }); init(); return hang();
    case 'permission': init(); out({ type: 'control_request', request_id: '1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }); return hang();
    case 'apikey': init({ apiKeySource: 'ANTHROPIC_API_KEY' }); return hang();
    case 'hang': init(); return hang();
    case 'auth': init(); process.stderr.write('account kim@example.com\n'); fail('authentication_failed', 'Not logged in · Please run /login'); return;
    case 'toolong': init(); fail('invalid_request', 'Prompt is too long', 400); return;
    case 'ratelimit':
      init();
      out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600 } });
      fail('rate_limit', "You've hit your limit", 429);
      return;
    case 'retry':
      init();
      out({ type: 'stream_event', event: { type: 'message_start' } });
      delta('앞 시도');
      out({ type: 'stream_event', event: { type: 'message_start' } });
      delta('다시 쓴 답입니다');
      out({ type: 'result', subtype: 'success', is_error: false, result: '다시 쓴 답입니다' });
      return;
    default: {
      const reply = process.env.FAKE_CLAUDE_REPLY ?? '안녕하세요';
      init();
      out({ type: 'stream_event', event: { type: 'message_start' } });
      delta('생각 중', 'thinking_delta');
      const half = Math.ceil(reply.length / 2);
      delta(reply.slice(0, half));
      delta(reply.slice(half));
      out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } });
      out({ type: 'result', subtype: 'success', is_error: false, result: reply });
    }
  }
}
