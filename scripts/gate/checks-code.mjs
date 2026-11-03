/** 코드 관문 — 타입·RPC 계약·시험·빌드, 최종이면 번들 새로 빌드 + 설치본 조건 스모크 + Rust 시험 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLE, ROOT, SIDECAR, record, step } from './lib.mjs';

const node = process.execPath;
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export function codeChecks({ final }) {
  const A = '코드';
  step(A, '엔진 타입 검사', node, [join('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], { cwd: SIDECAR });
  step(A, '화면 타입 검사', pnpm, ['exec', 'tsc', '--noEmit']);
  step(A, 'RPC 계약 ↔ Rust 허용 목록', node, ['scripts/sync-rpc-whitelist.mjs', '--check']);
  step(A, '엔진 시험 전체', node, [join('node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: SIDECAR, timeout: 30 * 60_000 });
  step(A, '화면 시험 전체', node, [join('node_modules', 'vitest', 'vitest.mjs'), 'run']);
  step(A, '화면 빌드 (vite)', pnpm, ['exec', 'vite', 'build']);

  // 번들이 소스보다 오래되면 엔진 관문이 옛 코드를 본다 (검증 에이전트가 실제로 잡은 함정)
  if (final || !existsSync(BUNDLE)) step(A, '엔진 번들 새로 빌드', node, ['scripts/build-sidecar.mjs'], { timeout: 30 * 60_000 });
  else {
    const newest = newestMtime(join(SIDECAR, 'src'));
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
