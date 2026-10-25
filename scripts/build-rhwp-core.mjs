/**
 * 패치한 rhwp 엔진 빌드 — rhwp 고정 태그 소스에 vendor/rhwp-core/patches 를 차례로 얹고 wasm-pack 으로 빌드해
 * vendor/rhwp-core 의 rhwp.js·rhwp_bg.wasm 등을 바꾸고 package.json 의 rhwp.wasmSha256 을 적는다.
 *
 * 앱 빌드(build-rhwp-studio·사이드카·화면)는 이걸 돌리지 않는다. 레포에 든 빌드 결과를 그대로 쓴다.
 * 필요: git, rustup(태그의 rust-toolchain.toml 이 툴체인·wasm32 대상을 고른다), wasm-pack 0.15.0
 * 패치 출처: 이음오피스(Apache-2.0) vendor/rhwp-core/patches, 내용은 vendor/rhwp-core/README.md
 *
 * 사용: node scripts/build-rhwp-core.mjs [--keep]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const VENDOR = resolve('vendor', 'rhwp-core');
const MANIFEST = join(VENDOR, 'package.json');
const PACKAGE_FILES = ['rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm', 'rhwp_bg.wasm.d.ts'];
const LICENSE_FILES = ['LICENSE', 'THIRD_PARTY_LICENSES.md'];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
const { tag, commit, patches } = manifest.rhwp;
const work = join(tmpdir(), 'kordoc-rhwp-core', tag);

const run = (cmd, args, cwd, env = process.env) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

// 패치는 손대지 않은 태그에만 건다 — 매번 새로 받는다 (예제 문서 수 GB 는 빼고)
rmSync(work, { recursive: true, force: true });
mkdirSync(dirname(work), { recursive: true });
run('git', ['-c', 'core.autocrlf=false', 'clone', '--filter=blob:none', '--no-checkout', '--branch', tag, 'https://github.com/edwardkim/rhwp.git', work], dirname(work));
git(['config', 'core.autocrlf', 'false'], work);
git(['sparse-checkout', 'set', '--no-cone', '/*', '!/samples/'], work);
git(['checkout', '--quiet', tag], work);
const head = git(['rev-parse', 'HEAD'], work);
if (head !== commit) throw new Error(`[rhwp-core] ${tag} 가 ${head} 를 가리킵니다. 기대한 커밋: ${commit}`);
for (const p of patches) run('git', ['apply', '--whitespace=nowarn', join(VENDOR, 'patches', p)], work);

// 빌드한 PC 의 경로가 WASM(크레이트 panic 위치)에 남지 않게
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
const RUSTFLAGS = [process.env.RUSTFLAGS ?? '', `--remap-path-prefix=${cargoHome}=/cargo`, `--remap-path-prefix=${work}=/rhwp`].join(' ').trim();
run('wasm-pack', ['build', '--target', 'web', '--release'], work, { ...process.env, RUSTFLAGS });

for (const f of PACKAGE_FILES) copyFileSync(join(work, 'pkg', f), join(VENDOR, f));
for (const f of LICENSE_FILES) copyFileSync(join(work, f), join(VENDOR, f));
const wasm = readFileSync(join(VENDOR, 'rhwp_bg.wasm'));
for (const leak of [homedir(), work]) {
  if (wasm.includes(Buffer.from(leak))) throw new Error(`[rhwp-core] rhwp_bg.wasm 에 이 PC 경로가 남았습니다: ${leak}`);
}
manifest.rhwp.wasmSha256 = createHash('sha256').update(wasm).digest('hex');
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[rhwp-core] ✅ ${tag} + 패치 ${patches.length}개 (${wasm.length} 바이트, sha256 ${manifest.rhwp.wasmSha256.slice(0, 12)})`);

if (!process.argv.includes('--keep') && existsSync(work)) rmSync(work, { recursive: true, force: true });
