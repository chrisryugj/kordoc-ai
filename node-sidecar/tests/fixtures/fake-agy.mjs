#!/usr/bin/env node
// 시험용 가짜 Antigravity CLI(agy) (실제 agy 는 계정 사용량을 쓴다). 공식 CLI 1.5 의 headless stream-json 줄 모양
// (init · step_update · result), `agy models`·`--version`·`update` 의 답만 흉내 낸다.
// 진짜처럼 집 폴더의 .gemini/antigravity-cli 에 대화 기록(conversations/<id>.db, brain/<id>/)과 작업 폴더별 최근 대화를 남긴다.
/// FAKE_AGY_MODE: ok · tool(도구 단계 뒤 계속 돔) · subagent · early(시작 보고 전에 답) · loose(권한 방식이 strict 아님) · checkpoint
//   · newevent(모르는 보고) · notype(event 없는 예전 Gemini CLI 꼴) · preinit(기록만 남기고 시작 보고 전에 멈춤)
//   · quota · toolong · server · badmodel · auth · badflag · hang · empty · linger(끝 보고 뒤 안 끝남) · exit(답 없이 3)
// FAKE_AGY_AUTH: google(기본) · out  (`agy models` = 로그인 확인의 답)
// FAKE_LOG: 기록 파일 (없으면 임시 폴더의 kordoc-fake-agy.jsonl)
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_AGY_MODE ?? 'ok';
const logFile = process.env.FAKE_LOG ?? join(tmpdir(), 'kordoc-fake-agy.jsonl');
const log = (e) => appendFileSync(logFile, `${JSON.stringify(e)}\n`);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const watched = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'KORDOC_SECRET', 'TEMP'];
log({ kind: 'run', pid: process.pid, args, cwd: process.cwd(), env: Object.fromEntries(watched.map((k) => [k, process.env[k] ?? null])) });

if (args[0] === '--version') { process.stdout.write('1.5.0\n'); process.exit(0); }
if (mode === 'badflag') { process.stderr.write('flag provided but not defined: -settings\n'); process.exit(2); }
if (args[0] === 'update') { process.stdout.write('✓ You are already on the latest version.\n'); process.exit(0); }
if (args[0] === 'models') {
  if (process.env.FAKE_AGY_AUTH === 'out' || mode === 'auth') {
    process.stdout.write('Fetching available models...\n');
    process.stderr.write('Error: Please sign in to view available models. Launch the CLI without arguments to sign in.\n');
    process.exit(1);
  }
  if (process.env.FAKE_AGY_MODELS === 'none') { process.stdout.write('Fetching available models...\nNo models available.\n'); process.exit(0); }
  process.stdout.write('Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n--yolo\t나쁜 이름\n');
  process.exit(0);
}

const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const settingsFile = value('--settings');
const settingsText = settingsFile && existsSync(settingsFile) ? readFileSync(settingsFile, 'utf-8') : null;
log({ kind: 'files', settings: settingsText });
const settings = settingsText ? JSON.parse(settingsText) : {};

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  log({ kind: 'stdin', text: input });
  if (mode === 'early') { out({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: '먼저 옴' } }); return; }
  const id = 'a1b2c3d4-0000-4000-8000-000000000000';
  const base = join(homedir(), '.gemini', 'antigravity-cli');
  mkdirSync(join(base, 'conversations'), { recursive: true });
  mkdirSync(join(base, 'brain', id), { recursive: true });
  mkdirSync(join(base, 'cache'), { recursive: true });
  writeFileSync(join(base, 'conversations', `${id}.db`), input);
  writeFileSync(join(base, 'brain', id, 'transcript.jsonl'), input);
  writeFileSync(join(base, 'cache', 'last_conversations.json'), JSON.stringify({ [process.cwd()]: id }));
  if (mode === 'preinit') return setInterval(() => {}, 1000); // 기록만 남기고 시작 보고 전에 멈춤
  if (mode === 'notype') { out({ type: 'init', session_id: 'x' }); out({ type: 'message', role: 'assistant', content: '안녕' }); out({ type: 'result', status: 'success' }); return; } // 예전 Gemini CLI 꼴
  const strict = mode !== 'loose' && settings.toolPermission === 'strict';
  out({ event: 'init', conversation_id: id, init: { model: value('--model') ?? 'gemini-3.8-flash-medium', cwd: process.cwd(), tools: ['view_file', 'run_command', 'search_web'], permission_mode: strict ? 'strict' : 'request-review' } });
  const step = (s) => out({ event: 'step_update', step_update: { conversation_id: id, ...s } });
  step({ step_index: 0, state: 'DONE', step_type: 'user_input' });
  const result = (status, response, error) => out({ event: 'result', result: { conversation_id: id, status, response, ...(error ? { error } : {}), num_turns: 1, finished_reason: status === 'SUCCESS' ? 'stop' : 'error' } });
  const failed = (error) => { result('ERROR', '', error); process.stderr.write(`error: ${error}\n`); process.exit(1); };
  switch (mode) {
    case 'tool':
      step({ step_index: 1, state: 'DONE', step_type: 'agent_response' });
      step({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'echo hi' } } });
      return setInterval(() => {}, 1000);
    case 'subagent':
      step({ step_index: 1, state: 'ACTIVE', step_type: 'agent_response', subagent_info: { name: 'browser' } });
      return setInterval(() => {}, 1000);
    case 'hang': return setInterval(() => {}, 1000);
    case 'newevent':
      out({ event: 'action', action: { name: 'browser_open', url: 'https://example.invalid/' } });
      return setInterval(() => {}, 1000);
    case 'quota': return failed('RESOURCE_EXHAUSTED: You have exhausted your quota for this model.');
    case 'toolong': return failed('The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).');
    case 'server': return failed('500 INTERNAL: Internal error encountered.');
    case 'badmodel': return failed('unknown model "gemini-9"');
    case 'auth':
      process.stderr.write('Authentication required. Please visit the URL to log in:\n');
      return failed('authentication failed or timed out');
    case 'exit': return process.exit(3);
    case 'empty': return result('SUCCESS', '\n');
    case 'linger':
      step({ step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: '안녕하세요' });
      result('SUCCESS', '안녕하세요\n');
      return setInterval(() => {}, 1000);
    case 'checkpoint':
      step({ step_index: 1, state: 'DONE', step_type: 'checkpoint' });
      // fallthrough
    default:
      step({ step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: '안녕' });
      step({ step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: '하세요' });
      step({ step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: '\n', usage: { input_tokens: 7000, output_tokens: 3 } });
      result('SUCCESS', '안녕하세요\n');
  }
});
