#!/usr/bin/env node
// 시험용 가짜 Codex (실제 codex 는 구독 사용량을 쓴다). 공식 CLI 의 `exec --json` 줄 모양만 흉내 낸다.
// FAKE_CODEX_MODE: ok · oldcodex(셸 기능 없음) · stuck(셸 기능이 안 꺼짐) · toolitem · usage · toolong · signedout · server · badflag · hang
//   · todo(계획 항목) · empty · linger(끝 알림 뒤 안 끝남) · slowfeatures(기능 확인이 0.5초)
// FAKE_CODEX_AUTH: chatgpt(기본) · apikey · out  (`login status` 의 답)
// FAKE_LOG: 기록 파일 (없으면 임시 폴더의 kordoc-fake-codex.jsonl)
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? 'ok';
const logFile = process.env.FAKE_LOG ?? join(tmpdir(), 'kordoc-fake-codex.jsonl');
const log = (e) => appendFileSync(logFile, `${JSON.stringify(e)}\n`);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const watched = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'KORDOC_SECRET'];
log({ kind: 'run', pid: process.pid, args, cwd: process.cwd(), env: Object.fromEntries(watched.map((k) => [k, process.env[k] ?? null])) });

const FEATURES = ['shell_tool', 'unified_exec', 'view_image', 'apps', 'plugins', 'fast_mode'];
if (args[0] === '--version') { process.stdout.write('codex-cli 0.157.0\n'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') {
  const auth = process.env.FAKE_CODEX_AUTH ?? 'chatgpt';
  process.stderr.write(auth === 'out' ? 'Not logged in\n' : auth === 'apikey' ? 'Logged in using an API key - sk-proj-***ABCD\n' : 'Logged in using ChatGPT\n');
  process.exit(auth === 'out' ? 1 : 0);
}
if (args[0] === 'features' && args[1] === 'list') {
  if (mode === 'slowfeatures') await new Promise((r) => setTimeout(r, 500));
  const off = new Set(args.flatMap((a, i) => (args[i - 1] === '--disable' ? [a] : [])));
  const names = mode === 'oldcodex' ? FEATURES.filter((f) => f !== 'shell_tool') : [...FEATURES, 'search_tool'];
  for (const f of names) {
    const on = f === 'search_tool' ? false : (mode === 'stuck' && f === 'shell_tool') || f === 'unified_exec' || !off.has(f);
    process.stdout.write(`${f.padEnd(40)} ${f === 'search_tool' ? 'removed' : 'stable'}             ${on}\n`);
  }
  process.exit(0);
}
if (args[0] === 'debug' && args[1] === 'models') {
  out({ models: [
    { slug: 'gpt-test-mini', display_name: 'Test Mini', visibility: 'list', priority: 5 },
    { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide', priority: 1 },
    { slug: 'gpt-test', display_name: 'Test', visibility: 'list', priority: 2 },
  ] });
  process.exit(0);
}
if (args[0] !== 'exec') process.exit(2);
if (mode === 'badflag') { process.stderr.write("error: unexpected argument '--ignore-rules' found\n"); process.exit(2); }

const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const schemaFile = value('--output-schema');
const images = args.flatMap((a, i) => (args[i - 1] === '--image' ? [a] : []));
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  log({ kind: 'stdin', text: input, schema: schemaFile ? readFileSync(schemaFile, 'utf-8') : null, images: images.map((f) => ({ path: f, exists: existsSync(f) })) });
  out({ type: 'thread.started', thread_id: 't-1' });
  out({ type: 'turn.started' });
  const failed = (message) => out({ type: 'turn.failed', error: { message } });
  switch (mode) {
    case 'toolitem': out({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'ls /' } }); return setInterval(() => {}, 1000);
    case 'hang': return setInterval(() => {}, 1000);
    case 'usage': return failed("You've hit your usage limit. Try again later.");
    case 'toolong': return failed('Your input exceeds the context window of this model (input 140123 tokens, status 400).');
    case 'empty': out({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '' } }); return out({ type: 'turn.completed' });
    case 'linger': out({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '안녕하세요' } }); out({ type: 'turn.completed' }); return setInterval(() => {}, 1000);
    case 'todo':
      out({ type: 'item.updated', item: { id: 'i0', type: 'todo_list', items: [{ text: '요약', completed: false }] } });
      out({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '안녕하세요' } });
      return out({ type: 'turn.completed' });
    case 'server': return failed('unexpected status 500 Internal Server Error');
    case 'signedout':
      out({ type: 'error', message: 'Reconnecting... 1/5 (unexpected status 401 Unauthorized)' });
      return failed('unexpected status 401 Unauthorized: Missing bearer or basic authentication in header');
    default:
      out({ type: 'item.completed', item: { id: 'i0', type: 'error', message: 'Code Mode is unavailable' } });
      out({ type: 'item.completed', item: { id: 'i1', type: 'reasoning', text: '생각' } });
      out({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: '확인하겠습니다.' } });
      out({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: schemaFile ? '{"a":"1"}' : '안녕하세요' } });
      out({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } });
  }
});
