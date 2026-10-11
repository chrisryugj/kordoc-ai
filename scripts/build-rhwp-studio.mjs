/**
 * 내장 한글 편집기 빌드 — rhwp-studio(MIT, edwardkim/rhwp) 를 오프라인용으로 빌드해 node-sidecar/editor/ 에.
 *
 * - 소스: rhwp 고정 태그를 스파스 클론 (편집기·SDK·글꼴만, 3.7GB 레포를 다 받지 않는다)
 * - WASM: 같은 버전의 npm @rhwp/core 가 wasm-pack 산출물(pkg)과 같다 → Rust 없이 Node 만으로 빌드
 * - 외부 웹폰트 끔(RHWP_DISABLE_EXTERNAL_WEBFONTS=1) — 폐쇄망. 글꼴은 레포 assets/fonts(OFL) 동봉
 * - 서비스워커·예제 문서 제거 — 앱 안 임시 포트에서 도는 페이지라 캐시가 쌓이기만 한다
 * - 앱 쪽 중계 페이지(node-sidecar/editor-host)와 SDK(@rhwp/editor) 를 같은 출처에 함께 둔다
 *
 * 사용: node scripts/build-rhwp-studio.mjs      (레포 루트에서. 결과가 있으면 버전이 같을 때 건너뜀)
 *       node scripts/build-rhwp-studio.mjs --force
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const RHWP_VERSION = '0.8.6'; // 올릴 땐 이 줄만 (studio·core·editor SDK 를 같은 버전으로 맞춘다)
const OUT = resolve('node-sidecar', 'editor');
const HOST_SRC = resolve('node-sidecar', 'editor-host');
const force = process.argv.includes('--force');

const versionFile = join(OUT, 'version.json');
if (!force && existsSync(versionFile) && JSON.parse(readFileSync(versionFile, 'utf-8')).studio === RHWP_VERSION) {
  // 중계 페이지만 고쳤을 수 있으니 그건 늘 다시 복사
  for (const f of readdirSync(HOST_SRC)) cpSync(join(HOST_SRC, f), join(OUT, f));
  console.log(`[rhwp-studio] 이미 ${RHWP_VERSION} — 중계 페이지만 갱신`);
  process.exit(0);
}

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd, env = {}) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin, env: { ...process.env, ...env } });

const work = join(tmpdir(), `kordoc-rhwp-build-${RHWP_VERSION}`);
const src = join(work, 'rhwp');
mkdirSync(work, { recursive: true });

// 1) 소스 (스파스·blobless)
if (!existsSync(join(src, 'rhwp-studio', 'package.json'))) {
  rmSync(src, { recursive: true, force: true });
  run('git', ['clone', '--depth', '1', '--branch', `v${RHWP_VERSION}`, '--filter=blob:none', '--sparse', 'https://github.com/edwardkim/rhwp.git', 'rhwp'], work);
  run('git', ['sparse-checkout', 'set', 'rhwp-studio', 'npm/editor', 'npm/hwpctrl-ocx', 'assets/logo', 'assets/fonts'], src);
}

// 2) WASM pkg = npm @rhwp/core 같은 버전, SDK = npm @rhwp/editor 같은 버전
const packs = join(work, 'packs');
rmSync(packs, { recursive: true, force: true });
mkdirSync(packs, { recursive: true });
run(npm, ['pack', `@rhwp/core@${RHWP_VERSION}`, `@rhwp/editor@${RHWP_VERSION}`, '--silent'], packs);
for (const t of readdirSync(packs).filter((f) => f.endsWith('.tgz'))) {
  const dir = join(packs, t.replace(/\.tgz$/, ''));
  mkdirSync(dir, { recursive: true });
  run('tar', ['-xzf', t, '-C', dir], packs);
}
const corePkg = join(packs, `rhwp-core-${RHWP_VERSION}`, 'package');
const sdkPkg = join(packs, `rhwp-editor-${RHWP_VERSION}`, 'package');
const pkgDir = join(src, 'pkg');
mkdirSync(pkgDir, { recursive: true });
for (const f of ['rhwp.js', 'rhwp_bg.wasm', 'rhwp.d.ts', 'rhwp_bg.wasm.d.ts']) cpSync(join(corePkg, f), join(pkgDir, f));
const studioDir = join(src, 'rhwp-studio');
for (const f of ['rhwp.js', 'rhwp_bg.wasm']) cpSync(join(pkgDir, f), join(studioDir, 'public', f));

// 3) 빌드
run(npm, ['ci', '--no-audit', '--no-fund'], studioDir);
rmSync(join(studioDir, 'dist'), { recursive: true, force: true });
run(process.execPath, [join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--base=./'], studioDir, { RHWP_DISABLE_EXTERNAL_WEBFONTS: '1' });

// 4) 가지치기
const dist = join(studioDir, 'dist');
for (const p of ['samples', 'sw.js', 'registerSW.js', 'manifest.webmanifest', 'rhwp.d.ts', 'rhwp_bg.wasm.d.ts']) rmSync(join(dist, p), { recursive: true, force: true });
for (const f of readdirSync(dist)) if (/^workbox-.*\.js$/.test(f)) rmSync(join(dist, f));
const indexPath = join(dist, 'index.html');
let html = readFileSync(indexPath, 'utf-8');
html = html
  .replace(/<script[^>]*registerSW\.js[^>]*><\/script>/g, '')
  .replace(/<link[^>]*manifest\.webmanifest[^>]*>/g, '');
writeFileSync(indexPath, html);
if (/registerSW|serviceWorker\.register/.test(html)) throw new Error('[rhwp-studio] 서비스워커 등록이 index.html 에 남았다');

// 5) 배치: studio/ + sdk/ + 중계 페이지 + 라이선스
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(dist, join(OUT, 'studio'), { recursive: true, dereference: true });
mkdirSync(join(OUT, 'sdk'), { recursive: true });
for (const f of ['index.js', 'transport.js', 'document-agent-contract.js']) cpSync(join(sdkPkg, f), join(OUT, 'sdk', f));
for (const f of readdirSync(HOST_SRC)) cpSync(join(HOST_SRC, f), join(OUT, f));
mkdirSync(join(OUT, 'licenses'), { recursive: true });
cpSync(join(corePkg, 'LICENSE'), join(OUT, 'licenses', 'rhwp-LICENSE.txt'));
const fontsDir = join(src, 'assets', 'fonts');
for (const f of readdirSync(fontsDir)) if (/\.(md|txt)$/i.test(f)) cpSync(join(fontsDir, f), join(OUT, 'licenses', f));
// rhwp 가 밝힌 제3자 목록(WASM 에 든 Rust 크레이트)과 스튜디오에 묶이는 패키지 라이선스. 빌드 임시 폴더가 지워져도 고지(scripts/third-party-notices.mjs)가 읽게
if (existsSync(join(src, 'THIRD_PARTY_LICENSES.md'))) cpSync(join(src, 'THIRD_PARTY_LICENSES.md'), join(OUT, 'licenses', 'rhwp-THIRD_PARTY_LICENSES.md'));
for (const dep of Object.keys(JSON.parse(readFileSync(join(studioDir, 'package.json'), 'utf-8')).dependencies ?? {})) {
  const dir = join(studioDir, 'node_modules', dep);
  const lic = existsSync(dir) ? readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f)) : undefined;
  if (lic) cpSync(join(dir, lic), join(OUT, 'licenses', `rhwp-studio-${dep.replace(/^@/, '').replace('/', '-')}-LICENSE.txt`));
}
writeFileSync(versionFile, JSON.stringify({ studio: RHWP_VERSION, sdk: RHWP_VERSION, built_at: new Date().toISOString() }, null, 2));

for (const must of ['studio/index.html', 'studio/rhwp_bg.wasm', 'studio/rhwp.js', 'sdk/index.js', 'host.html', 'host.js']) {
  if (!existsSync(join(OUT, must))) throw new Error(`[rhwp-studio] 빠진 파일: ${must}`);
}
console.log(`[rhwp-studio] ✅ ${RHWP_VERSION} → ${OUT}`);
