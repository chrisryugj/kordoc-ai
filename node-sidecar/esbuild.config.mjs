import { build } from 'esbuild';
import { readFileSync } from 'fs';

/**
 * kordoc 내부에서 createRequire()로 동적 require하는 패키지들을
 * esbuild가 번들에 포함시키도록 강제하는 플러그인.
 *
 * kordoc ESM 빌드에서 createRequire(import.meta.url) → require2("cfb") 패턴 사용.
 * esbuild는 createRequire로 만든 require를 정적 분석 못 해서
 * 프로덕션에서 "Cannot find module 'cfb'" 발생.
 *
 * 해결: kordoc 소스 로드 시 createRequire 패턴을 정적 import로 치환.
 */
const dynamicRequirePlugin = {
  name: 'dynamic-require-resolver',
  setup(build) {
    // kordoc의 chunk/index 파일에서 createRequire 패턴을 정적 require로 교체
    build.onLoad({ filter: /kordoc[\\/]dist[\\/].*\.js$/ }, async (args) => {
      let contents = readFileSync(args.path, 'utf-8');

      // require2 = createRequire(...); require2("cfb") → import cfb from "cfb" 효과
      // CJS 번들 출력이므로 require("cfb")로 교체하면 esbuild가 인라인함
      if (contents.includes('require2("cfb")')) {
        contents = contents
          // createRequire import 제거
          .replace(/import\s*\{\s*createRequire\s*\}\s*from\s*"module";\s*/, '')
          // require2 생성 제거
          .replace(/var\s+require2\s*=\s*createRequire\([^)]+\);\s*/, '')
          // require2("cfb") → (await import("cfb")).default || (await import("cfb"))
          // 대신 정적 import 추가 + 변수 참조로 교체
          .replace(/var\s+CFB\s*=\s*require2\("cfb"\);/, '// cfb는 esbuild가 정적 번들링');

        // 파일 맨 앞에 정적 import 추가 — esbuild가 번들에 포함시킴
        contents = `import CFB from "cfb";\n` + contents;
      }

      return { contents, loader: 'js' };
    });
  },
};

await build({
  entryPoints: ['dist/main.js'],   // tsc 출력을 번들링
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/bundle.cjs',
  banner: {
    js: [
      `const __importMetaUrl = require('url').pathToFileURL(__filename).href;`,
      `if (typeof DOMMatrix === 'undefined') { globalThis.DOMMatrix = class DOMMatrix { constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; } multiply(){return new DOMMatrix();} inverse(){return new DOMMatrix();} translate(){return new DOMMatrix();} scale(){return new DOMMatrix();} }; }`,
      `if (typeof DOMPoint === 'undefined') { globalThis.DOMPoint = class DOMPoint { constructor(x,y){this.x=x;this.y=y;} }; }`,
      `if (typeof ImageData === 'undefined') { globalThis.ImageData = class ImageData { constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }; }`,
      `if (typeof Path2D === 'undefined') { globalThis.Path2D = class Path2D {}; }`,
    ].join('\n'),
  },
  define: {
    'import.meta.url': '__importMetaUrl',
  },
  // pdfjs-dist의 worker는 런타임에 별도 로드 — 번들에서 제외
  external: [],
  plugins: [dynamicRequirePlugin],
  minify: false,        // 디버깅 용이
  sourcemap: true,
  logLevel: 'info',
});
