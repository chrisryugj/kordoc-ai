/**
 * 화면 검증용 중계기 — 브라우저에서 띄운 실제 프론트를 진짜 사이드카(설치본과 같은 번들)에 붙인다.
 *
 * Tauri 창이 아닌 헤드리스 브라우저에서는 invoke 가 없으니, 프론트의 목(mock) 계층이 `?relay=<주소>` 일 때
 * Tauri 명령을 이 서버로 넘긴다. 사이드카 알림(progress·ai_token·watch_event)은 SSE 로 돌려준다.
 *
 *   POST /invoke   { cmd, args }  → { ok:true, result } | { ok:false, error }
 *   GET  /events   SSE: event=<Tauri 이벤트 이름>, data=<payload JSON>
 *   POST /dialog   { queue: [경로|경로배열|null, …], reset? }  — 다음 파일 대화상자 응답들을 미리 넣어 둔다(테스트용). reset 이면 남은 응답을 비우고
 *   POST /emit     { event, payload }  — Rust 가 내보내는 이벤트(open-files·deep-link) 흉내
 *
 * 사용: node scripts/dev-relay.mjs [--port 7717] [--data <앱 데이터 폴더>]
 *   사이드카: node-sidecar/dist/bundle.mjs (동봉 Node 우선), 없으면 dist/main.js (시스템 Node)
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const PORT = Number(arg('--port', '7717'));
const DATA = arg('--data', mkdtempSync(join(tmpdir(), 'kordoc-relay-data-')));
const sidecarDir = resolve('node-sidecar');
const bundledNode = resolve('src-tauri', 'resources', 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const useBundle = existsSync(join(sidecarDir, 'dist', 'bundle.mjs')) && existsSync(join(sidecarDir, 'dist', 'node_modules'));
const nodeBin = useBundle && existsSync(bundledNode) ? bundledNode : process.execPath;
const entry = useBundle ? 'dist/bundle.mjs' : 'dist/main.js';

const child = spawn(nodeBin, [entry], {
  cwd: sidecarDir,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, KORDOC_AI_DATA_DIR: DATA },
});
console.log(`[relay] 사이드카 ${nodeBin} ${entry} (데이터 ${DATA})`);

let nextId = 1;
const pending = new Map();
const clients = new Set();
const dialogQueue = [];

function broadcast(event, payload) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(line);
}

let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id == null && msg.method) {
      if (msg.method === 'progress') broadcast('pipeline:progress', msg.params);
      broadcast('sidecar:notify', { method: msg.method, params: msg.params });
      continue;
    }
    const p = pending.get(msg.id);
    if (!p) continue;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  }
});
child.stderr.on('data', (d) => {
  for (const line of String(d).split('\n')) if (line.trim()) broadcast('sidecar:log', line);
});
child.on('exit', (code) => {
  console.error(`[relay] 사이드카 종료 (code ${code})`);
  for (const p of pending.values()) p.reject(new Error('Sidecar process closed'));
  pending.clear();
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolveP, rejectP) => {
    pending.set(id, { resolve: resolveP, reject: rejectP });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`);
  });
}

/** Tauri 명령 흉내 — Rust 쪽 명령 이름 그대로 */
async function invoke(cmd, args = {}) {
  switch (cmd) {
    case 'sidecar_call':
      if (args.method === 'cancel') {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'cancel', params: args.params ?? {} })}\n`);
        return { cancelled: true };
      }
      return rpc(args.method, args.params);
    case 'sidecar_status':
      return child.exitCode == null ? 'ready' : { error: '프로세스 종료됨' };
    case 'sidecar_start':
      return null;
    case 'get_settings':
      return rpc('get_settings', {});
    case 'update_settings':
      return rpc('update_settings', args.settings ?? args);
    case 'shell_menu_status':
    case 'shell_menu_install':
    case 'shell_menu_uninstall':
      return { supported: false, installed: false, kind: 'none' };
    case 'shell_take_pending':
      return []; // 꺼진 앱으로 들어온 우클릭·주소 동작 대기열 (개발 중계엔 없다)
    case 'plugin:dialog|open':
    case 'plugin:dialog|save':
      return dialogQueue.length ? dialogQueue.shift() : null;
    default:
      throw new Error(`중계기가 모르는 명령: ${cmd}`);
  }
}

const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => r(s ? JSON.parse(s) : {})); });

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.url === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': ok\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method !== 'POST') return res.writeHead(404).end();
  const body = await readBody(req);
  const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/invoke') {
    try { send({ ok: true, result: await invoke(body.cmd, body.args) }); } catch (e) { send({ ok: false, error: e.message }); }
    return;
  }
  if (req.url === '/dialog') {
    if (body.reset) dialogQueue.length = 0; // 앞 실행에서 못 쓴 응답이 다음 대화상자로 새지 않게
    dialogQueue.push(...(body.queue ?? []));
    return send({ ok: true, queued: dialogQueue.length });
  }
  if (req.url === '/emit') { broadcast(body.event, body.payload); return send({ ok: true }); }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => console.log(`[relay] http://127.0.0.1:${PORT}`));

process.on('SIGTERM', () => { child.kill(); process.exit(0); });
process.on('SIGINT', () => { child.kill(); process.exit(0); });
