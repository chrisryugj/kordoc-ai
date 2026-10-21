#!/usr/bin/env node
// 가짜 Claude Code — 실제 claude 대신 시험에서 띄운다 (구독 사용량을 쓰지 않게).
// FAKE_CLAUDE_MODE: ok · tools · early · auth · ratelimit · hang · old · exit · permission
// FAKE_CLAUDE_AUTH: subscription(기본) · apikey · out — `auth status --json` 의 답
// FAKE_LOG: 받은 인자·환경·stdin 줄을 JSON 줄로 남길 파일
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
const log = (entry) => { if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(entry)}\n`); };
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

if (args[0] === '--version') { process.stdout.write('2.1.300 (Claude Code)\n'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') {
  const auth = process.env.FAKE_CLAUDE_AUTH ?? 'subscription';
  if (auth === 'out') out({ loggedIn: false });
  else if (auth === 'apikey') out({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty', email: 'kim@example.com', orgName: '가온시청' });
  else out({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', email: 'kim@example.com', orgName: '가온시청' });
  process.exit(0);
}

log({ kind: 'start', pid: process.pid, args, cwd: process.cwd(), env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null, DISABLE_AUTOUPDATER: process.env.DISABLE_AUTOUPDATER ?? null } });

if (mode === 'old') { process.stderr.write("error: unknown option '--restricted'\n"); process.exit(1); }
if (mode === 'exit') process.exit(3);

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  log({ kind: 'stdin', line });
  const msg = JSON.parse(line);
  if (msg.type === 'control_request' && msg.request.subtype === 'initialize') {
    out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { models: [
      { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-5-5' },
      { value: 'sonnet', displayName: 'Sonnet' },
      { value: '--evil', displayName: 'Bad' },
    ], account: { email: 'kim@example.com' } } } });
    if (mode === 'early') out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '먼저' } } });
    return;
  }
  if (msg.type !== 'user') return;
  if (mode === 'hang') return;
  out({ type: 'system', subtype: 'init', tools: mode === 'tools' ? ['Bash', 'Read'] : [], mcp_servers: [] });
  if (mode === 'tools') return;
  if (mode === 'permission') { out({ type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }); return; }
  if (mode === 'auth') {
    out({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Invalid API key · Please run /login (kim@example.com)' }] } });
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key' });
    return;
  }
  if (mode === 'ratelimit') {
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600 } });
    out({ type: 'assistant', error: 'rate_limit', message: { content: [{ type: 'text', text: 'limit reached' }] } });
    out({ type: 'result', subtype: 'success', is_error: true, result: 'limit reached' });
    return;
  }
  const text = process.env.FAKE_CLAUDE_REPLY ?? '안녕하세요';
  out({ type: 'stream_event', event: { type: 'message_start' } });
  for (const piece of text.match(/.{1,2}/gsu) ?? []) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } } });
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '속생각' } } });
  out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: text, stop_reason: 'end_turn' });
});
rl.on('close', () => { log({ kind: 'stdin-closed' }); process.exit(0); });
