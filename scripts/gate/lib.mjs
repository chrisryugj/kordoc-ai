/** 출품 관문 공용 — 결과 기록·명령 실행·엔진(번들) JSON-RPC 클라이언트 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const SIDECAR = join(ROOT, 'node-sidecar');
export const BUNDLE = join(SIDECAR, 'dist', 'bundle.mjs');
export const SAMPLES = join(SIDECAR, 'samples');

/** 결과 한 줄: PASS · WARN(사람이 볼 것) · FAIL(출품 불가) · SKIP(이번엔 안 봄, 최종 모드면 FAIL) · TODO(사람 할 일) */
export const results = [];
export function record(area, name, status, detail = '', ms = 0) {
  results.push({ area, name, status, detail, ms });
  const mark = { PASS: '✓', WARN: '!', FAIL: '✗', SKIP: '-', TODO: '□' }[status];
  console.log(`${mark} [${area}] ${name}${detail ? ` — ${detail.split('\n')[0].slice(0, 160)}` : ''}${ms ? ` (${(ms / 1000).toFixed(1)}s)` : ''}`);
}

/** 명령 하나 — 끝 코드 0 이면 PASS. 마지막 출력 몇 줄을 detail 로 */
/** Windows: Git Bash 에서 돌려도 Windows 기본 tar(System32)가 먼저 잡히게 — GNU tar 는 "C:\…" 를 원격 호스트로 읽는다(실측) */
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
export const childEnv = (extra = {}) => ({
  ...process.env,
  ...(process.platform === 'win32' ? { [PATH_KEY]: `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32;${process.env[PATH_KEY] ?? ''}` } : {}),
  ...extra,
  FORCE_COLOR: '0',
});

export function step(area, name, cmd, args, { cwd = ROOT, timeout = 15 * 60_000, env } = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd, timeout, encoding: 'utf-8', shell: process.platform === 'win32' && /\.cmd$/.test(cmd), env: childEnv(env) });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '').trim();
  const lines = out.split('\n').filter(Boolean);
  const tail = lines.slice(-6).join('\n');
  // 실패면 실패를 말하는 줄(✗·❌·error)을 먼저: 마지막 줄만 남기면 어느 단계인지 안 보인다 (실측: 스모크)
  const bad = lines.filter((l) => /✗|❌|\bFAIL|\berror\b|Error:/i.test(l)).slice(0, 8).join('\n');
  record(area, name, r.status === 0 ? 'PASS' : 'FAIL', r.status === 0 ? tail.split('\n').pop() ?? '' : (r.error?.message ?? (bad || tail)), Date.now() - t0);
  return { ok: r.status === 0, out };
}

export const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** 폴더 안 모든 파일의 해시 (원본 불변 확인용) */
export function hashTree(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p); else out.set(p, sha(p));
    }
  };
  walk(dir);
  return out;
}

/** 엔진 번들을 띄운다. mcp 면 MCP stdio, 아니면 앱과 같은 JSON-RPC. stdout 의 JSON 아닌 줄은 nonJson 에 모은다 */
export function startEngine({ dataDir, mcp = false, env = {} }) {
  const p = spawn(process.execPath, [BUNDLE, ...(mcp ? ['--mcp'] : [])], { cwd: SIDECAR, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, KORDOC_AI_DATA_DIR: dataDir, ...env } });
  let buf = '';
  let n = 0;
  const wait = new Map();
  const nonJson = [];
  const stderr = [];
  p.stderr.on('data', (d) => stderr.push(String(d)));
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { nonJson.push(line); continue; }
      if (m.id != null) wait.get(m.id)?.(m);
    }
  });
  const raw = (method, params, timeoutMs = 300_000) => new Promise((res, rej) => {
    const id = ++n;
    const t = setTimeout(() => rej(new Error(`${method} 시간 초과`)), timeoutMs);
    wait.set(id, (m) => { clearTimeout(t); res(m); });
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const call = async (method, params, timeoutMs) => {
    const m = await raw(method, params, timeoutMs);
    if (m.error) throw new Error(m.error.message);
    return m.result;
  };
  const notify = (method, params) => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  const stop = () => new Promise((r) => { p.once('exit', r); p.stdin.end(); setTimeout(() => { p.kill(); r(); }, 5000); });
  return { call, raw, notify, stop, nonJson, stderr };
}
