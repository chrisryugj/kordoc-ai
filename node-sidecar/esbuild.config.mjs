import { build } from 'esbuild';

await build({
  entryPoints: ['dist/main.js'],   // tsc 출력을 번들링
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/bundle.js',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  // pdfjs-dist의 worker는 런타임에 별도 로드 — 번들에서 제외
  external: [],
  minify: false,        // 디버깅 용이
  sourcemap: true,
  logLevel: 'info',
});
