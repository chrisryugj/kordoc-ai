/**
 * 네이티브·WASM 모듈 스테이징 — 번들이 external 로 남긴 패키지를 전이 의존까지 dist/node_modules 에.
 *
 * 설치본에는 레포의 node_modules 가 없다. 번들 옆 dist/node_modules 만 따라간다.
 * 버전은 지금 설치된 것과 똑같이 맞춘다 (kordoc 이 쓰는 pdfjs-dist 는 kordoc 안쪽 사본 버전).
 * 실행 OS·CPU 의 바이너리만 남기고 나머지는 지운다 — 설치 파일 크기.
 *
 * 사용: node scripts/stage-natives.mjs   (node-sidecar 에서, esbuild 다음)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DROPPED_PACKAGES, STAGED_EXTERNALS } from './externals.mjs';

/** 레지스트리에 없는 패키지 — 레포 폴더에서 파일째 옮긴다 (패치한 rhwp 엔진, 의존 없음) */
const VENDORED = { '@rhwp/core': resolve('..', 'vendor', 'rhwp-core') };

const STAGE = join('dist', 'stage-natives');
const TARGET = join('dist', 'node_modules');

function installedVersion(name) {
  const p = join('node_modules', name, 'package.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')).version : null;
}

const deps = {};
for (const name of STAGED_EXTERNALS.filter((n) => !VENDORED[n])) {
  const v = installedVersion(name);
  if (!v) throw new Error(`[stage] ${name} 가 설치돼 있지 않다 — npm install 먼저`);
  deps[name] = v;
}

rmSync(STAGE, { recursive: true, force: true });
rmSync(TARGET, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
writeFileSync(join(STAGE, 'package.json'), JSON.stringify({ name: 'kordoc-sidecar-natives', private: true, dependencies: deps }, null, 2));
console.log('[stage] 설치:', Object.entries(deps).map(([k, v]) => `${k}@${v}`).join(' '));

const npm = process.env.npm_execpath && process.env.npm_execpath.endsWith('.js')
  ? [process.execPath, [process.env.npm_execpath]]
  : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []];
execFileSync(npm[0], [...npm[1], 'install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', '--ignore-scripts'], {
  cwd: STAGE,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip' },
});

// 이동
renameSync(join(STAGE, 'node_modules'), TARGET);
rmSync(STAGE, { recursive: true, force: true });
for (const [name, dir] of Object.entries(VENDORED)) {
  const to = join(TARGET, name);
  mkdirSync(to, { recursive: true });
  const { files } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
  for (const f of ['package.json', ...files]) copyFileSync(join(dir, f), join(to, f));
  console.log(`[stage] ${name}: ${dir} 에서 복사`);
}

// ── 가지치기 ──
const plat = process.platform; // darwin | win32 | linux
const arch = process.arch;
let pruned = 0;
const rm = (p) => { if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); pruned++; } };

for (const p of DROPPED_PACKAGES) rm(join(TARGET, p));
// onnxruntime-node: bin/napi-v*/<os>/<arch>
const ortBin = join(TARGET, 'onnxruntime-node', 'bin');
if (existsSync(ortBin)) {
  for (const napi of readdirSync(ortBin)) {
    for (const os of readdirSync(join(ortBin, napi))) {
      if (os !== plat) { rm(join(ortBin, napi, os)); continue; }
      for (const a of readdirSync(join(ortBin, napi, os))) if (a !== arch) rm(join(ortBin, napi, os, a));
    }
  }
  // npm 은 심볼릭 링크를 못 실어서 같은 라이브러리가 두 벌 온다(libonnxruntime.1.dylib·libonnxruntime.1.30.0.dylib, 43MB씩).
  // 바인딩이 찾는 이름(@rpath/libonnxruntime.1.dylib, .so.1)만 남긴다
  (function dedupe(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) dedupe(p);
      else if (/^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(e.name) && existsSync(join(dir, 'libonnxruntime.1.dylib'))) rm(p);
      else if (/^libonnxruntime\.so\.\d+\.\d+\.\d+$/.test(e.name) && existsSync(join(dir, 'libonnxruntime.so.1'))) rm(p);
    }
  })(ortBin);
}
// node-llama-cpp: 소스 빌드용 llama.cpp 번들(34MB) — build:'never' 라 안 씀
rm(join(TARGET, 'node-llama-cpp', 'llama', 'gitRelease.bundle'));
// node-llama-cpp CUDA 판(윈도우 168MB + 351MB) — NVIDIA 전용이라 뺀다. GPU 는 Vulkan 판(대부분의 그래픽카드), 없으면 CPU 판
if (existsSync(join(TARGET, '@node-llama-cpp'))) {
  for (const d of readdirSync(join(TARGET, '@node-llama-cpp'))) if (/-cuda/.test(d)) rm(join(TARGET, '@node-llama-cpp', d));
}
// onnxruntime DirectML(윈도우 약 38MB) — kordoc OCR 은 executionProviders ["cpu"] 만 써서 불리지 않는다
for (const f of ['DirectML.dll', 'dxcompiler.dll', 'dxil.dll']) rm(join(TARGET, 'onnxruntime-node', 'bin', 'napi-v6', 'win32', arch, f));
// 문서·타입·소스맵
for (const pkg of readdirSync(TARGET)) {
  const dirs = pkg.startsWith('@') ? readdirSync(join(TARGET, pkg)).map((d) => join(pkg, d)) : [pkg];
  for (const d of dirs) {
    for (const junk of ['docs', 'example', 'examples', 'test', 'tests', '.github']) rm(join(TARGET, d, junk));
  }
}
// pdfjs-dist: 뷰어·타입 (kordoc 은 legacy/build 만 씀)
rm(join(TARGET, 'pdfjs-dist', 'web'));
rm(join(TARGET, 'pdfjs-dist', 'types'));
// 소스맵 전부
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.map')) { rmSync(p); pruned++; }
  }
})(TARGET);

// ── Windows: VC++ 런타임 앱 폴더 배포 ──
// OCR(onnxruntime)·내장 AI(llama) 의 .node·.dll 은 MSVCP140·VCRUNTIME140 을 불러온다. 깨끗한 PC 에는 없을 수 있고,
// Node 는 모듈을 "모듈 자기 폴더 먼저"(LOAD_WITH_ALTERED_SEARCH_PATH) 로 불러서 node.exe 옆에 둬도 못 찾는다.
// 그래서 그 모듈이 든 폴더마다 런타임 DLL 을 둔다 (시스템 폴더의 오래된 런타임보다 먼저 잡힌다).
/** PE 파일이 불러오는 DLL 이름 (실행하지 않고 가져오기 표만 읽음) */
function peImports(file) {
  const b = readFileSync(file);
  if (b.length < 0x40 || b.readUInt16LE(0) !== 0x5a4d) return [];
  const pe = b.readUInt32LE(0x3c);
  if (b.readUInt32LE(pe) !== 0x4550) return [];
  const nsec = b.readUInt16LE(pe + 6);
  const optsz = b.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const impRva = b.readUInt32LE(opt + (b.readUInt16LE(opt) === 0x20b ? 112 : 96) + 8);
  const secs = [];
  for (let i = 0; i < nsec; i++) {
    const s = opt + optsz + i * 40;
    secs.push({ va: b.readUInt32LE(s + 12), size: Math.max(b.readUInt32LE(s + 8), b.readUInt32LE(s + 16)), raw: b.readUInt32LE(s + 20) });
  }
  const off = (rva) => { const s = secs.find((x) => rva >= x.va && rva < x.va + x.size); return s ? s.raw + rva - s.va : -1; };
  const names = [];
  for (let o = impRva ? off(impRva) : -1; o >= 0; o += 20) {
    const nameRva = b.readUInt32LE(o + 12);
    if (!nameRva) break;
    const no = off(nameRva);
    names.push(b.toString('latin1', no, b.indexOf(0, no)));
  }
  return names;
}
/** Visual Studio 재배포 폴더의 CRT (…\VC\Redist\MSVC\<버전>\x64\Microsoft.VC143.CRT) */
function vcRuntimeDir() {
  const vcArch = arch === 'arm64' ? 'arm64' : 'x64';
  const roots = process.env.VCToolsRedistDir ? [process.env.VCToolsRedistDir] : [];
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (existsSync(vswhere)) {
    const install = execFileSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf-8' }).trim();
    const msvc = join(install, 'VC', 'Redist', 'MSVC');
    if (install && existsSync(msvc)) roots.push(...readdirSync(msvc).sort().reverse().map((v) => join(msvc, v)));
  }
  for (const r of roots) {
    const a = join(r, vcArch);
    const crt = existsSync(a) && readdirSync(a).find((d) => /^Microsoft\.VC\d+\.CRT$/.test(d));
    if (crt) return join(a, crt);
  }
  return null;
}
if (plat === 'win32') {
  const needs = new Set();
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(node|dll)$/i.test(e.name) && peImports(p).some((n) => /^(vcruntime|msvcp|concrt)140/i.test(n))) needs.add(dir);
    }
  })(TARGET);
  const crt = vcRuntimeDir();
  if (!crt) {
    const msg = '[stage] VC++ 런타임(Visual Studio 재배포 폴더)을 찾지 못했다 — OCR·내장 AI 가 VC++ 재배포 패키지 없는 PC 에서 죽는다';
    if (process.env.CI) throw new Error(msg);
    console.warn(`${msg} (개발 PC 라 계속)`);
  } else {
    const dlls = readdirSync(crt).filter((f) => f.toLowerCase().endsWith('.dll'));
    for (const d of needs) for (const f of dlls) copyFileSync(join(crt, f), join(d, f));
    console.log(`[stage] VC++ 런타임 ${dlls.length}개 → 모듈 폴더 ${needs.size}곳 (${crt})`);
  }
}

// 검증: 각 external 이 dist/node_modules 에 깔렸는가 (exports 필드 때문에 resolve 대신 파일로 본다)
for (const name of STAGED_EXTERNALS) {
  if (!existsSync(join(TARGET, name, 'package.json'))) throw new Error(`[stage] dist/node_modules 에 ${name} 가 없다`);
}
const size = execFileSync(process.platform === 'win32' ? 'powershell' : 'du', process.platform === 'win32'
  ? ['-NoProfile', '-Command', `"{0:N0}MB" -f ((Get-ChildItem -Recurse '${TARGET}' | Measure-Object Length -Sum).Sum / 1MB)`]
  : ['-sh', TARGET]).toString().trim();
console.log(`[stage] ✅ ${Object.keys(deps).length}개 external 스테이징, 가지치기 ${pruned}곳 — ${size}`);
