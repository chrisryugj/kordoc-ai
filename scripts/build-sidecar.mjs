/**
 * 문서 엔진(사이드카) 빌드 — 설치본에 실리는 node-sidecar/{dist,models} 를 만든다.
 *   의존성 설치(lockfile 그대로) → tsc → esbuild 번들 → 네이티브 스테이징 → 내장 OCR 모델
 * 끝나면 `node node-sidecar/scripts/smoke-bundle.mjs` 로 설치본 조건 셀프테스트(CI 관문).
 *
 * 사용: node scripts/build-sidecar.mjs   (레포 루트에서)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve('node-sidecar');
const isWin = process.platform === 'win32';
const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: 'inherit', shell: isWin && cmd.endsWith('.cmd') });
const node = (...args) => run(process.execPath, args);

// 깔린 kordoc 판이 package.json 의 정확한 판과 다르면(판만 올리고 node_modules 를 그대로 둔 경우) 다시 깐다:
// 스테이징은 깔린 판을 그대로 실어, 설치본에 옛 엔진이 들어갔다
const wanted = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).dependencies?.kordoc;
const installedPkg = join(dir, 'node_modules', 'kordoc', 'package.json');
const installed = existsSync(installedPkg) ? JSON.parse(readFileSync(installedPkg, 'utf-8')).version : null;
if (installed !== wanted) {
  if (installed) console.log(`[build-sidecar] kordoc ${installed} 이 깔려 있어 ${wanted} 로 다시 깝니다 (npm ci)`);
  run(isWin ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund']);
}
node(join('node_modules', 'typescript', 'bin', 'tsc'), '-p', '.');
node('esbuild.config.mjs');
node(join('scripts', 'stage-natives.mjs'));
node(join('scripts', 'fetch-ocr-models.mjs'));
console.log('[build-sidecar] ✅ dist/ + models/ 준비 끝 — 다음: node node-sidecar/scripts/smoke-bundle.mjs');
