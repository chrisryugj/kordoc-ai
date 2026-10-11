/**
 * Node.js 런타임 동봉 — nodejs.org 공식 바이너리를 받아 SHA-256 검증 후 src-tauri/resources/node/ 에.
 * 사용자 PC 에 Node 를 따로 깔 필요가 없게 한다 (비개발자·폐쇄망).
 *
 * 사용: node scripts/fetch-node.mjs [--arch x64|arm64]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NODE_VERSION = 'v24.21.0'; // LTS Krypton — 올릴 땐 이 줄만
const archArg = process.argv.indexOf('--arch');
const arch = archArg > 0 ? process.argv[archArg + 1] : process.arch;
const plat = process.platform === 'win32' ? 'win' : process.platform; // darwin | linux | win
const ext = plat === 'win' ? 'zip' : 'tar.gz';
const name = `node-${NODE_VERSION}-${plat}-${arch}`;
const outDir = join('src-tauri', 'resources', 'node');
const outBin = join(outDir, plat === 'win' ? 'node.exe' : 'node');
const stamp = join(outDir, '.version');

if (existsSync(outBin) && existsSync(stamp) && readFileSync(stamp, 'utf-8').trim() === name) {
  console.log(`[fetch-node] 이미 있음: ${name}`);
  process.exit(0);
}

const base = `https://nodejs.org/dist/${NODE_VERSION}`;
const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const expected = sums.split('\n').find((l) => l.endsWith(`  ${name}.${ext}`))?.split(/\s+/)[0];
if (!expected) throw new Error(`[fetch-node] SHASUMS256 에 ${name}.${ext} 없음`);

const res = await fetch(`${base}/${name}.${ext}`);
if (!res.ok) throw new Error(`[fetch-node] 다운로드 실패 ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const actual = createHash('sha256').update(buf).digest('hex');
if (actual !== expected) throw new Error(`[fetch-node] SHA-256 불일치 ${actual} ≠ ${expected}`);

const work = mkdtempSync(join(tmpdir(), 'kordoc-node-'));
const archive = join(work, `${name}.${ext}`);
writeFileSync(archive, buf);
// bsdtar 는 zip 도 푼다 (Windows 10 1803+ 기본 탑재)
execFileSync('tar', ['-xf', archive, '-C', work]);
const src = plat === 'win' ? join(work, name, 'node.exe') : join(work, name, 'bin', 'node');

mkdirSync(outDir, { recursive: true });
copyFileSync(src, outBin);
if (plat !== 'win') chmodSync(outBin, 0o755);
copyFileSync(join(work, name, 'LICENSE'), join(outDir, 'LICENSE'));
writeFileSync(stamp, name);
rmSync(work, { recursive: true, force: true });
console.log(`[fetch-node] ✅ ${name} → ${outBin} (sha256 ${expected.slice(0, 12)}…)`);
