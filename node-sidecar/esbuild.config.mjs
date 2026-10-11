import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { NATIVE_EXTERNALS } from './scripts/externals.mjs';

/**
 * 사이드카 번들 — 순수 JS 는 dist/bundle.mjs 한 파일로, 네이티브·WASM 모듈은 external.
 * external 은 scripts/stage-natives.mjs 가 전이 의존까지 dist/node_modules 에 깐다.
 *
 * ESM 으로 내는 이유: node-llama-cpp 는 ESM 전용이고 kordoc 도 ESM 이다.
 * CJS 로 묶으면 kordoc 의 createRequire("cfb") 를 정적으로 바꿔치기해야 했다(v1.5.0 사고 원인).
 * ESM 번들은 createRequire 가 그대로 살아 있으니 cfb 를 번들 안에서 찾게 alias 만 남긴다.
 */

await build({
  entryPoints: ['dist/main.js'], // tsc 출력을 묶는다
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/bundle.mjs',
  banner: {
    js: [
      `import { createRequire as __kdCreateRequire } from 'node:module';`,
      `import { fileURLToPath as __kdFileURLToPath } from 'node:url';`,
      `import { dirname as __kdDirname } from 'node:path';`,
      `const require = __kdCreateRequire(import.meta.url);`,
      `const __filename = __kdFileURLToPath(import.meta.url);`,
      `const __dirname = __kdDirname(__filename);`,
    ].join('\n'),
  },
  external: NATIVE_EXTERNALS,
  minify: false,
  sourcemap: true,
  logLevel: 'info',
});

const out = readFileSync('dist/bundle.mjs', 'utf-8');
console.log(`[esbuild] dist/bundle.mjs ${(out.length / 1024 / 1024).toFixed(1)}MB`);
