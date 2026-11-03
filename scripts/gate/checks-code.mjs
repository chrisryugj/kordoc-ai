/** 코드 관문 — 타입·RPC 계약·시험·빌드, 최종이면 번들 새로 빌드 + 설치본 조건 스모크 + Rust 시험 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BUNDLE, ROOT, SIDECAR, record, step } from './lib.mjs';

const node = process.execPath;
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export function codeChecks({ final }) {
  const A = '코드';
  step(A, '엔진 타입 검사', node, [join('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], { cwd: SIDECAR });
  step(A, '화면 타입 검사', pnpm, ['exec', 'tsc', '--noEmit']);
  step(A, 'RPC 계약 ↔ Rust 허용 목록', node, ['scripts/sync-rpc-whitelist.mjs', '--check']);
  tauriVersions(A);
  vitest(A, '엔진 시험 전체', SIDECAR);
  vitest(A, '화면 시험 전체', ROOT);
  step(A, '화면 빌드 (vite)', pnpm, ['exec', 'vite', 'build']);
  cssCollisions(A);

  // 번들이 소스보다 오래되면 엔진 관문이 옛 코드를 본다 (검증 에이전트가 실제로 잡은 함정)
  // 엔진 번들을 띄운 프로세스(중계기·앱)가 있으면 네이티브 모듈이 잠겨 스테이징이 EPERM 으로 깨진다 (실측)
  const holders = bundleHolders();
  if (holders.length) record(A, '엔진 번들을 쥔 프로세스 없음', 'FAIL', `먼저 끄세요: ${holders.join(', ')}`);
  // 소스뿐 아니라 의존성(lockfile)이 바뀌어도 번들·스테이징을 다시 해야 한다. 최종이면 늘 새로
  const newest = Math.max(newestMtime(join(SIDECAR, 'src')), statSync(join(SIDECAR, 'package-lock.json')).mtimeMs);
  // 번들과 스테이징(dist/node_modules) 둘 다 봐야 한다: 스테이징이 깨져도 번들 파일은 새것일 수 있다 (실측)
  const staged = join(SIDECAR, 'dist', 'node_modules', '.staged');
  const stale = !existsSync(BUNDLE) || !existsSync(staged) || Math.min(statSync(BUNDLE).mtimeMs, statSync(staged).mtimeMs) < newest;
  if (final || stale) step(A, `엔진 번들 새로 빌드${stale ? ' (소스·의존성이 더 새것)' : ''}`, node, ['scripts/build-sidecar.mjs'], { timeout: 30 * 60_000 });
  else record(A, '엔진 번들이 소스보다 새것', 'PASS');

  const bundledNode = join(ROOT, 'src-tauri', 'resources', 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  if (existsSync(bundledNode)) step(A, '설치본 조건 스모크 (동봉 Node, node_modules 없음)', node, ['scripts/smoke-bundle.mjs'], { cwd: SIDECAR, timeout: 10 * 60_000 });
  else record(A, '설치본 조건 스모크', final ? 'FAIL' : 'SKIP', '동봉 Node 없음: node scripts/fetch-node.mjs');

  if (final) {
    if (!existsSync(join(SIDECAR, 'editor'))) step(A, '내장 한글 편집기 빌드', node, ['scripts/build-rhwp-studio.mjs'], { timeout: 20 * 60_000 });
    step(A, 'Rust 시험 (cargo test --lib)', 'cargo', ['test', '--lib'], { cwd: join(ROOT, 'src-tauri'), timeout: 40 * 60_000 });
  } else record(A, 'Rust 시험', 'SKIP', '--final 에서');
}

/** vitest — 개수와 실패한 시험 이름을 남기고, 실패하면 한 번 더: 두 번째에 통과하면 흔들리는 시험(WARN), 또 실패하면 FAIL */
function vitest(area, name, cwd) {
  const once = () => {
    const out = join(tmpdir(), `kordoc-gate-vitest-${process.pid}-${Date.now()}.json`);
    const t0 = Date.now();
    spawnSync(node, [join('node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=json', `--outputFile=${out}`], { cwd, encoding: 'utf-8', timeout: 30 * 60_000, maxBuffer: 1 << 28 });
    try {
      const j = JSON.parse(readFileSync(out, 'utf-8'));
      rmSync(out, { force: true });
      const failed = j.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => `${basename(f.name)} > ${a.fullName}: ${(a.failureMessages[0] ?? '').split('\n')[0].slice(0, 120)}`));
      const fileErr = j.testResults.filter((f) => f.status === 'failed' && !f.assertionResults.some((a) => a.status === 'failed')).map((f) => `${basename(f.name)}: ${String(f.message).split('\n')[0].slice(0, 120)}`);
      return { ok: j.success, pass: j.numPassedTests, skip: j.numPendingTests, failed: [...failed, ...fileErr], ms: Date.now() - t0 };
    } catch { return { ok: false, pass: 0, skip: 0, failed: ['결과 JSON 을 읽지 못함 (vitest 가 죽음?)'], ms: Date.now() - t0 }; }
  };
  const a = once();
  if (a.ok) return record(area, name, 'PASS', `${a.pass}개 통과 · ${a.skip}개 건너뜀`, a.ms);
  const b = once();
  if (b.ok) return record(area, `${name} (흔들리는 시험)`, 'WARN', `첫 번째 실패, 다시 돌리니 통과 — ${a.failed.join(' / ')}`, a.ms + b.ms);
  record(area, name, 'FAIL', `${b.failed.length}개 실패: ${b.failed.join('\n')}`, a.ms + b.ms);
}

/** 같은 클래스를 두 스타일 파일이 맨 앞 선택자로 정의하면 한쪽 화면이 깨진다
 *  (실측: 일 시키기 타임라인 .kd-steps 가 새로 쓰기 단계 표시와, 이어서 칩 .kd-next 가 문서 화면 상자와 부딪힘) */
function cssCollisions(area) {
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.css')) files.push(p); } };
  walk(join(ROOT, 'src'));
  const owner = new Map();
  for (const f of files) {
    const css = readFileSync(f, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/(?:^|[},])\s*(\.kd-[a-z0-9-]+)(?=[\s{:[,.>+~]|$)/gm)) {
      const set = owner.get(m[1]) ?? new Set();
      set.add(basename(f));
      owner.set(m[1], set);
    }
  }
  // 맨 앞 선택자가 다른 파일에도 있는 것 (@media 안 재정의는 같은 파일이면 괜찮다)
  const clash = [...owner].filter(([, s]) => s.size > 1).map(([c, s]) => `${c} (${[...s].join(', ')})`);
  record(area, '스타일 클래스 이름 충돌 없음', clash.length ? 'WARN' : 'PASS', clash.slice(0, 12).join('\n'));
}

/** tauri build 는 npm 패키지와 Rust crate 의 major.minor 가 다르면 멈춘다 (실측: 2.2.0 릴리스 CI 가 notification 2.3 ↔ 2.8 로 실패) */
function tauriVersions(area) {
  const lock = readFileSync(join(ROOT, 'src-tauri', 'Cargo.lock'), 'utf-8');
  const crates = new Map([...lock.matchAll(/name = "(tauri(?:-plugin-[a-z-]+)?)"\r?\nversion = "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const mm = (v) => v.split('.').slice(0, 2).join('.');
  const bad = [];
  for (const [crate, ver] of crates) {
    const pkg = join(ROOT, 'node_modules', '@tauri-apps', crate === 'tauri' ? 'api' : crate.replace('tauri-', ''), 'package.json');
    if (!existsSync(pkg)) continue;
    const npmVer = JSON.parse(readFileSync(pkg, 'utf-8')).version;
    if (mm(npmVer) !== mm(ver)) bad.push(`${crate} ${ver} ↔ npm ${npmVer}`);
  }
  record(area, 'Tauri npm ↔ Rust 판 맞음 (major.minor)', bad.length ? 'FAIL' : 'PASS', bad.join('\n'));
}

/** dist/bundle.mjs 를 띄운 node 프로세스 (Windows 만: wmic 대신 PowerShell CIM) */
function bundleHolders() {
  if (process.platform !== 'win32') return [];
  const r = spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'bundle\\.mjs' } | ForEach-Object { \"$($_.ProcessId)\" }"], { encoding: 'utf-8' });
  return (r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((pid) => `node ${pid}`);
}

function newestMtime(dir) {
  let t = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else t = Math.max(t, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return t;
}
