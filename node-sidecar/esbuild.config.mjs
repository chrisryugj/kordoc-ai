import { build } from 'esbuild';
import { readFileSync, cpSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

/**
 * kordoc 내부에서 createRequire()로 동적 require하는 패키지를
 * esbuild가 번들에 포함시키도록 강제하는 플러그인.
 *
 * kordoc ESM 빌드는 createRequire(import.meta.url) → <req>("cfb") 패턴을 쓴다.
 * esbuild는 createRequire로 만든 require를 정적 분석하지 못해 런타임 require로
 * 남기는데, MSI에는 node_modules가 없어서 "Cannot find module 'cfb'" → 엔진 오류가 난다.
 *
 * ⚠️ 이름을 짚어 치환하지 말 것. kordoc dist는 같은 패턴을 파일마다 다른 이름으로 낸다
 * (require2("cfb")와 require3("cfb")). v1.5.0은 앞의 것만 치환하고 뒤의 것을 놓쳐서
 * 깨진 번들이 그대로 배포됐다 — 개발 환경엔 node_modules가 있어 아무도 못 봤다.
 * 그래서 이름을 보지 않고 "무엇이든 ("cfb")를 호출하는 자리"를 전부 정적 바인딩으로 바꾼다.
 * createRequire 선언 자체는 건드리지 않는다 — 안 쓰이면 그만이고, 다른 모듈을 로드하는
 * 데 쓰이고 있을 수도 있어서다.
 */
const CFB_CALL = /\b[A-Za-z_$][\w$]*\(\s*["']cfb["']\s*\)/g;
const CFB_BINDING = '__kordocCfb';

/**
 * 출력 검사용 — CFB_CALL 과 **일부러 따로** 둔다.
 * 검사가 치환과 같은 정규식을 쓰면, 치환이 좁아질 때 검사도 같이 눈이 멀어
 * "고칠 것 없음"으로 통과시킨다. 놓친 걸 잡으라고 있는 관문이 놓친 것과 함께
 * 실명하면 관문이 아니다. 그러니 여기는 넓게, 독립적으로 잡는다.
 */
const CFB_LEAK = /[\w$]+\(\s*["']cfb["']\s*\)/g;

let cfbPatched = 0;

const dynamicRequirePlugin = {
  name: 'dynamic-require-resolver',
  setup(build) {
    build.onLoad({ filter: /kordoc[\\/]dist[\\/].*\.js$/ }, async (args) => {
      const source = readFileSync(args.path, 'utf-8');
      const hits = source.match(CFB_CALL);
      if (!hits) return null;

      cfbPatched += hits.length;
      return {
        contents: `import ${CFB_BINDING} from "cfb";\n` + source.replace(CFB_CALL, CFB_BINDING),
        loader: 'js',
      };
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
  // puppeteer-core는 Chromium 외부 실행 + 동적 require 패턴이 많아 external 처리.
  // 인쇄 기능 사용 시 sidecar 배포 디렉토리에 puppeteer-core가 함께 있어야 함.
  // @rhwp/core는 WASM 파일을 디스크에서 로드해야 해서 번들 불가 — external +
  // 아래 copy 단계로 dist/node_modules에 동봉 (preview/index.ts의 createRequire가 해석)
  external: ['puppeteer-core', 'onnxruntime-node', 'sharp', '@huggingface/transformers', '@rhwp/core'],
  plugins: [dynamicRequirePlugin],
  minify: false,        // 디버깅 용이
  sourcemap: true,
  logLevel: 'info',
});

// cfb 치환이 한 자리도 안 걸렸거나 번들에 여전히 동적 호출이 남았으면 여기서 끊는다.
// 이걸 놓치면 빌드는 초록인데 사용자 PC에서만 엔진이 죽는다 (v1.5.0 실제 사고).
if (cfbPatched === 0) {
  throw new Error(
    '[esbuild] kordoc dist에서 cfb 동적 require를 한 자리도 못 찾았다. ' +
      'kordoc이 패턴을 바꿨을 수 있으니 dist를 열어 확인하고 CFB_CALL을 고쳐라.',
  );
}
const bundled = readFileSync('dist/bundle.cjs', 'utf-8');
const leaked = bundled.match(CFB_LEAK);
if (leaked) {
  throw new Error(
    `[esbuild] 번들에 cfb 동적 호출이 ${leaked.length}자리 남았다 (${[...new Set(leaked)].join(', ')}). ` +
      'MSI에는 node_modules가 없어 이대로면 엔진 오류가 난다.',
  );
}
console.log(`[esbuild] cfb 동적 require ${cfbPatched}자리를 정적 번들로 치환`);

// @rhwp/core 패키지(rhwp.js + rhwp_bg.wasm)를 번들 옆 node_modules로 복사 —
// Tauri resources가 dist/만 가져가므로 WASM이 MSI에 함께 패키징되게 한다.
const require = createRequire(import.meta.url);
const rhwpDir = dirname(require.resolve('@rhwp/core'));
cpSync(rhwpDir, join('dist', 'node_modules', '@rhwp', 'core'), { recursive: true });
console.log('[esbuild] @rhwp/core → dist/node_modules/@rhwp/core 복사 완료');
