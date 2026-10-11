/**
 * 번들 스모크 — 설치본이 까는 그대로 사이드카를 띄워 엔진 셀프테스트를 통과하는지 본다.
 *
 * 설치본에는 레포의 node_modules 가 없다. dist/(bundle.mjs + 스테이징된 dist/node_modules) 와
 * models/ 만 실린다. 그래서 둘을 레포 바깥 임시 폴더로 옮겨, 동봉할 Node 런타임
 * (src-tauri/resources/node) 으로 띄운다 — 위쪽 node_modules 를 주워 올 수 없는 사용자 PC 조건.
 *
 * 관문: engine_selftest 의 모든 단계(HWPX 왕복·PDF·렌더·이미지 OCR·llama 바인딩) 통과.
 * (v1.5.0 은 ping 만 봐서, 엔진은 뜨는데 기능이 죽는 번들을 못 걸렀다)
 *
 * 사용: node scripts/smoke-bundle.mjs   (node-sidecar 에서, build:bundle 다음)
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 어디서 실행해도 node-sidecar 기준으로
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

const TIMEOUT_MS = 180_000;

if (!existsSync('dist/bundle.mjs') || !existsSync('dist/node_modules')) {
  console.error('[smoke] dist/bundle.mjs·dist/node_modules 없음 — 먼저 `tsc && npm run build:bundle`');
  process.exit(1);
}

const bundledNode = resolve('..', 'src-tauri', 'resources', 'node', process.platform === 'win32' ? 'node.exe' : 'node');
if (!existsSync(bundledNode)) {
  console.error(`[smoke] 동봉 Node 없음 (${bundledNode}) — 먼저 node scripts/fetch-node.mjs (레포 루트). 시스템 Node 로는 설치본 조건을 증명할 수 없다`);
  process.exit(1);
}
const nodeBin = bundledNode;

const stage = mkdtempSync(join(tmpdir(), 'kordoc-smoke-'));
cpSync('dist', join(stage, 'dist'), { recursive: true });
if (existsSync('models')) cpSync('models', join(stage, 'models'), { recursive: true });
const withEditor = existsSync('editor');
if (withEditor) cpSync('editor', join(stage, 'editor'), { recursive: true });
const dataDir = join(stage, 'appdata');

// Node 가 없는 사용자 PC 조건: PATH 에서 node·npm·npx 가 든 폴더를 빼고 NODE_OPTIONS·NODE_PATH 도 지운다.
// (CI 러너·개발 PC 에는 Node 가 있어서, 그대로 두면 엔진이 몰래 시스템 Node 에 기대도 못 잡는다)
const tools = process.platform === 'win32' ? ['node.exe', 'npm.cmd', 'npx.cmd'] : ['node', 'npm', 'npx'];
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const pathDirs = (process.env[pathKey] ?? '').split(delimiter).filter(Boolean);
const cleanDirs = pathDirs.filter((d) => !tools.some((t) => existsSync(join(d, t))));
const env = { ...process.env, [pathKey]: cleanDirs.join(delimiter), KORDOC_AI_DATA_DIR: dataDir };
delete env.KORDOC_MODEL_CACHE;
delete env.NODE_PATH;
delete env.NODE_OPTIONS;

console.log(`[smoke] 동봉 Node ${nodeBin}`);
console.log(`[smoke] ${join(stage, 'dist', 'bundle.mjs')} (node_modules 없음, PATH 에서 Node 폴더 ${pathDirs.length - cleanDirs.length}곳 뺌)`);
const child = spawn(nodeBin, [join(stage, 'dist', 'bundle.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], cwd: stage, env });

let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'engine_selftest', params: {} })}\n`);

let settled = false;
function finish(ok, reason) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  child.kill('SIGKILL');
  try {
    rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* Windows EBUSY — 청소 실패는 판정과 무관 */
  }
  if (ok) {
    console.log('[smoke] ✅ 엔진 셀프테스트 통과');
    process.exit(0);
  }
  console.error(`[smoke] ❌ ${reason}`);
  if (err) console.error(`[smoke] stderr:\n${err.split('\n').slice(-40).join('\n')}`);
  process.exit(1);
}

let selftestOk = false;
child.stdout.on('data', async () => {
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 1 && !selftestOk) {
      if (msg.error) return finish(false, `RPC 오류: ${msg.error.message}`);
      for (const s of msg.result.steps) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name} ${s.ms}ms${s.detail ? ` — ${s.detail}` : ''}`);
      if (!msg.result.ok) return finish(false, '셀프테스트 실패 단계 있음');
      selftestOk = true;
      if (!withEditor) {
        console.log('  - editor_server 건너뜀 (node-sidecar/editor 없음 — scripts/build-rhwp-studio.mjs)');
        return finish(true);
      }
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'editor_server', params: {} })}\n`);
    }
    if (msg.id === 2) {
      if (msg.error) return finish(false, `editor_server 오류: ${msg.error.message}`);
      try {
        const host = await fetch(msg.result.host_url);
        const studio = await fetch(new URL('./studio/index.html', msg.result.host_url));
        const wasm = await fetch(new URL('./studio/rhwp_bg.wasm', msg.result.host_url), { method: 'HEAD' });
        const ok = host.ok && studio.ok && wasm.ok && wasm.headers.get('content-type') === 'application/wasm';
        console.log(`  ${ok ? '✓' : '✗'} editor_server ${msg.result.host_url} (studio ${msg.result.studio_version})`);
        return finish(ok, '편집기 파일 응답 이상');
      } catch (e) {
        return finish(false, `편집기 서버 접속 실패: ${e.message}`);
      }
    }
  }
});
child.on('exit', (code) => finish(false, `사이드카가 응답 전에 종료됨 (code ${code})`));
const timer = setTimeout(() => finish(false, `${TIMEOUT_MS / 1000}초 안에 응답 없음`), TIMEOUT_MS);
