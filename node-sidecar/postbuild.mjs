/**
 * postbuild — esbuild 번들에 포함 안 되는 동적 require 모듈을
 * dist/node_modules/ 에 복사. Tauri resources가 dist/ 전체를 포함하므로
 * 프로덕션 설치 환경에서도 createRequire()로 찾을 수 있음.
 */
import { cpSync, mkdirSync, readdirSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distNodeModules = join(__dirname, 'dist', 'node_modules');
const require2 = createRequire(join(__dirname, 'package.json'));

// kordoc이 createRequire로 동적 로드하는 모듈
const ROOT_MODULES = ['cfb'];

mkdirSync(distNodeModules, { recursive: true });

/** 모듈 디렉토리를 직접 복사 (경로 기반) */
function copyDir(modName, srcDir, visited) {
  if (visited.has(modName)) return;
  visited.add(modName);

  const dest = join(distNodeModules, modName);
  if (existsSync(dest)) return;

  cpSync(srcDir, dest, { recursive: true });
  console.log(`  ✓ ${modName}`);
}

const visited = new Set();

for (const mod of ROOT_MODULES) {
  try {
    const pkgPath = require2.resolve(`${mod}/package.json`);
    const realPkgPath = realpathSync(pkgPath);
    const modDir = dirname(realPkgPath);

    copyDir(mod, modDir, visited);

    // pnpm virtual store 구조: .pnpm/<pkg>/node_modules/{cfb, adler-32, crc-32}
    // modDir의 parent가 node_modules/ → 그 안의 모든 sibling이 transitive deps
    const virtualNodeModules = dirname(modDir);
    for (const entry of readdirSync(virtualNodeModules)) {
      if (entry === mod || entry.startsWith('.')) continue;
      const entryPath = join(virtualNodeModules, entry);
      try {
        // symlink 해결하여 실제 디렉토리 복사
        const realPath = realpathSync(entryPath);
        if (lstatSync(realPath).isDirectory()) {
          copyDir(entry, realPath, visited);
        }
      } catch { /* skip broken symlinks */ }
    }
  } catch (e) {
    console.warn(`  ✗ ${mod}: ${e.message}`);
  }
}

console.log('postbuild: dynamic modules copied to dist/node_modules/');
