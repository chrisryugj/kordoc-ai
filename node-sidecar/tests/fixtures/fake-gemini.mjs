#!/usr/bin/env node
// 시험용 가짜 Gemini CLI (실제 gemini 는 계정 사용량을 쓴다). 공식 CLI 0.35 의 `-o stream-json` 줄 모양과 종료 코드
// (41 인증 실패, 42 입력 없음)만 흉내 낸다. 진짜처럼 집 폴더의 .gemini/tmp/<작업 폴더 이름>/chats 에 대화 기록을 남긴다.
// FAKE_GEMINI_MODE: ok · tool(tool_use 뒤 계속 돔) · early(시작 보고 전에 답) · quota · toolong · server · badmodel · auth(41) · badflag
//   · hang · empty · linger(끝 보고 뒤 안 끝남) · exit(답 없이 3) · at(답에 \@)
// FAKE_GEMINI_AUTH: google(기본) · out  (빈 입력 실행 = 로그인 확인의 답)
// FAKE_LOG: 기록 파일 (없으면 임시 폴더의 kordoc-fake-gemini.jsonl)
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_GEMINI_MODE ?? 'ok';
const logFile = process.env.FAKE_LOG ?? join(tmpdir(), 'kordoc-fake-gemini.jsonl');
const log = (e) => appendFileSync(logFile, `${JSON.stringify(e)}\n`);
const out = (o) => process.stdout.write(`${JSON.stringify({ ...o, timestamp: new Date().toISOString() })}\n`);
const watched = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'KORDOC_SECRET', 'NO_BROWSER', 'TEMP', 'GEMINI_CLI_SYSTEM_SETTINGS_PATH', 'GEMINI_SYSTEM_MD'];
log({ kind: 'run', pid: process.pid, args, cwd: process.cwd(), env: Object.fromEntries(watched.map((k) => [k, process.env[k] ?? null])) });

if (args[0] === '--version') { process.stdout.write('0.35.0\n'); process.exit(0); }
if (mode === 'badflag') { process.stderr.write('Unknown arguments: allowed-mcp-server-names, allowedMcpServerNames\n'); process.exit(1); }

const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const read = (f) => (f && existsSync(f) ? readFileSync(f, 'utf-8') : null);
log({ kind: 'files', settings: read(process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH), policy: read(value('--admin-policy')), system: read(process.env.GEMINI_SYSTEM_MD) });

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  log({ kind: 'stdin', text: input });
  const authOut = process.env.FAKE_GEMINI_AUTH === 'out' || mode === 'auth';
  if (authOut) {
    process.stderr.write('Manual authorization is required but the current session is non-interactive. Please run the Gemini CLI in an interactive terminal to log in.\n');
    process.exit(41);
  }
  if (!input) { process.stderr.write('No input provided via stdin. Input can be provided by piping data into gemini or using the --prompt option.\n'); process.exit(42); }
  if (mode === 'early') { out({ type: 'message', role: 'assistant', content: '먼저 옴', delta: true }); return; }
  const id = 'a1b2c3d4-0000-4000-8000-000000000000';
  const chats = join(homedir(), '.gemini', 'tmp', basename(process.cwd()).toLowerCase(), 'chats');
  mkdirSync(chats, { recursive: true });
  writeFileSync(join(chats, `session-2026-11-04T00-00-${id.slice(0, 8)}.json`), JSON.stringify({ messages: [input] }));
  out({ type: 'init', session_id: id, model: value('-m') ?? 'auto-gemini-3' });
  out({ type: 'message', role: 'user', content: input });
  const failed = (type, message) => { out({ type: 'result', status: 'error', error: { type, message } }); process.exit(1); };
  switch (mode) {
    case 'tool':
      out({ type: 'tool_use', tool_name: 'run_shell_command', tool_id: 't1', parameters: { command: 'echo hi' } });
      return setInterval(() => {}, 1000);
    case 'hang': return setInterval(() => {}, 1000);
    case 'quota': return failed('TerminalQuotaError', 'You have exhausted your daily quota on this model.');
    case 'toolong': return failed('Error', '[API Error: The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).]');
    case 'server': return failed('Error', '[API Error: 500 Internal error encountered.]');
    case 'badmodel': return failed('Error', '[API Error: Requested entity was not found.]');
    case 'exit': return process.exit(3);
    case 'empty': out({ type: 'result', status: 'success' }); return;
    case 'linger':
      out({ type: 'message', role: 'assistant', content: '안녕하세요', delta: true });
      out({ type: 'result', status: 'success' });
      return setInterval(() => {}, 1000);
    case 'at':
      out({ type: 'message', role: 'assistant', content: 'kim\\@example.com 으로', delta: true });
      out({ type: 'message', role: 'assistant', content: ' 보냅니다', delta: true });
      return out({ type: 'result', status: 'success' });
    default:
      out({ type: 'message', role: 'assistant', content: '안녕', delta: true });
      out({ type: 'message', role: 'assistant', content: '하세요', delta: true });
      out({ type: 'result', status: 'success', stats: { total_tokens: 7, tool_calls: 0 } });
  }
});
