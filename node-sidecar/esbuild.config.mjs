import { build } from 'esbuild';

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
  minify: false,        // 디버깅 용이
  sourcemap: true,
  logLevel: 'info',
});
