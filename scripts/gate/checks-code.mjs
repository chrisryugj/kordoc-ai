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
  vitest(A, '엔진 시험 전체', SIDECAR);
  vitest(A, '화면 시험 전체', ROOT);
  step(A, '화면 빌드 (vite)', pnpm, ['exec', 'vite', 'build']);

  // 번들이 소스보다 오래되면 엔진 관문이 옛 코드를 본다 (검증 에이전트가 실제로 잡은 함정)
  if (final || !existsSync(BUNDLE)) step(A, '엔진 번들 새로 빌드', node, ['scripts/build-sidecar.mjs'], { timeout: 30 * 60_000 });
  else {
    // 소스뿐 아니라 의존성(lockfile)이 바뀌어도 번들·스테이징을 다시 해야 한다
    const newest = Math.max(newestMtime(join(SIDECAR, 'src')), statSync(join(SIDECAR, 'package-lock.json')).mtimeMs);
    const stale = statSync(BUNDLE).mtimeMs < newest;
    record(A, '엔진 번들이 소스보다 새것', stale ? 'FAIL' : 'PASS', stale ? 'node scripts/build-sidecar.mjs 로 다시 빌드하거나 --final 로 돌리세요' : '');
  }

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
