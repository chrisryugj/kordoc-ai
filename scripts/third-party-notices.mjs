/**
 * 제3자 고지 모음 THIRD_PARTY_NOTICES.txt 만들기 (레포 루트). 설치본에 NOTICE·LICENSE 와 함께 실린다(src-tauri/tauri.conf.json bundle.resources).
 *
 * 읽기만 하고 네트워크는 쓰지 않는다. 빌드(build-sidecar·build-rhwp-studio)를 마친 뒤 레포 루트에서:
 *   node scripts/third-party-notices.mjs
 *
 * 모으는 것
 * - 앱 화면: 루트 package.json dependencies 와 그 의존 (node_modules)
 * - 문서 엔진: node-sidecar/package.json dependencies 와 그 의존 + 설치본에 싣는 node-sidecar/dist/node_modules 전부
 * - 앱 본체: src-tauri/Cargo.lock 의 크레이트. 라이선스는 $CARGO_HOME/registry/src/<색인>/<이름>-<버전>/Cargo.toml
 * - 내장 한글 편집기: node-sidecar/editor/licenses, rhwp 빌드 임시 폴더가 남아 있으면 그 THIRD_PARTY_LICENSES.md 와 rhwp-studio 의존
 * - 글꼴: 편집기 글꼴(WOFF2 name 표의 저작권 줄 + FONTS.md 라이선스 칸)·앱 화면 글꼴(public/fonts)
 * - OCR 모델(node-sidecar/models/ppocr)·동봉 Node(src-tauri/resources/node)
 * 패키지에 전문 파일이 없으면 scripts/license-texts/<SPDX id>.txt 표준 전문을 싣고 그 줄에 패키지 정보의 저작권자를 적는다.
 * (표준 전문의 출처: MIT·BSD·ISC·Zlib·MPL-2.0·LPPL-1.3c 는 SPDX license-list-data, Apache-2.0 은 apache.org,
 *  LGPL-3.0·GPL-3.0 은 FSF 배포본 사본(Homebrew mpfr 의 COPYING.LESSER·COPYING), GUST 는 gust.org.pl. 글자 그대로 둔다.)
 * 그래도 못 푼 것(소스 없는 크레이트, 전문을 구할 수 없는 글꼴 등)은 파일 끝 "확인할 항목"과 터미널에 찍는다.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'THIRD_PARTY_NOTICES.txt');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const clean = (t) => t.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
const warnings = [];

// ── 라이선스 전문: 같은 글은 한 번만 싣고 번호(L1…)로 가리킨다 ──
const texts = new Map();
function addText(title, body, user) {
  const b = clean(body);
  if (!b) return null;
  const h = createHash('sha256').update(b.replace(/\s+/g, ' ')).digest('hex');
  let t = texts.get(h);
  if (!t) texts.set(h, (t = { id: `L${texts.size + 1}`, title, body: b, users: [] }));
  if (!t.users.includes(user)) t.users.push(user);
  return t.id;
}

const LICENSE_FILE = /^(licen[cs]es?|copying|copyright|notice|unlicense|patents|third[-_ ]?party([-_ ]?(notices?|licen[cs]es?))?|thirdpartynotices?)([-_.].*)?$/i;
const CODE_FILE = /\.(js|cjs|mjs|ts|json|html|py|rs|toml|png|jpg|svg)$/i;
function licenseFiles(dir) {
  const out = [];
  for (const n of (isDir(dir) ? readdirSync(dir) : []).sort()) {
    if (!LICENSE_FILE.test(n) || CODE_FILE.test(n)) continue;
    const p = join(dir, n);
    if (!isDir(p)) { out.push({ name: n, text: readFileSync(p, 'utf8') }); continue; }
    for (const m of readdirSync(p).sort()) {
      if (!isDir(join(p, m)) && !CODE_FILE.test(m)) out.push({ name: `${n}/${m}`, text: readFileSync(join(p, m), 'utf8') });
    }
  }
  return out;
}

/** 라이선스 파일이 없을 때 README 의 "License(ing)" 절 (sharp-libvips 처럼 묶음 라이브러리 표가 거기에만 있다) */
function readmeLicense(dir) {
  const f = (isDir(dir) ? readdirSync(dir) : []).find((n) => /^readme(\.md)?$/i.test(n));
  if (!f) return '';
  const md = readFileSync(join(dir, f), 'utf8');
  const m = /^(#{1,3})\s*licen[cs](e|ing)\b.*$/im.exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(new RegExp(`^#{1,${m[1].length}}\\s`, 'm'));
  return m[0] + (next < 0 ? rest : rest.slice(0, next));
}

// ── 표준 전문 (scripts/license-texts/<id>.txt) ──
const STD_DIR = join(ROOT, 'scripts', 'license-texts');
const STD = Object.fromEntries(readdirSync(STD_DIR).filter((n) => n.endsWith('.txt')).sort().map((n) => [n.slice(0, -4), readFileSync(join(STD_DIR, n), 'utf8')]));
function stdText(id, user) {
  const ref = addText(`${id} 표준 전문 (scripts/license-texts/${id}.txt)`, STD[id], user);
  const t = [...texts.values()].find((x) => x.id === ref); // 패키지 파일이 먼저 같은 글로 실렸으면 제목에 밝힌다
  if (!t.title.includes('표준 전문')) t.title += ` (${id} 표준 전문과 같은 글)`;
  return ref;
}
const APACHE = STD['Apache-2.0'];
// SPDX id → 실을 표준 전문. LGPL-3.0 은 GPL-3.0 에 덧붙인 허가라 둘 다 싣는다
const STD_OF = { 'LGPL-3.0-or-later': ['LGPL-3.0', 'GPL-3.0'], 'LGPL-3.0-only': ['LGPL-3.0', 'GPL-3.0'], 'LGPL-3.0': ['LGPL-3.0', 'GPL-3.0'], 'GPL-3.0-or-later': ['GPL-3.0'], 'GPL-3.0-only': ['GPL-3.0'] };
const stdIds = (id) => STD_OF[id] ?? (STD[id] ? [id] : []);
// 패키지 파일이 이미 그 라이선스 전문인지 (그러면 표준 전문을 또 싣지 않는다)
const SIGN = { 'Apache-2.0': /Apache License/i, MIT: /Permission is hereby granted, free of charge/i, 'LGPL-3.0': /GNU LESSER GENERAL PUBLIC LICENSE/i, 'GPL-3.0': /^\s*GNU GENERAL PUBLIC LICENSE/im, 'MPL-2.0': /Mozilla Public License/i };
// OR(옛 표기 "/" 포함)는 이 순서로 처음 나오는 것을 고른다. AND 는 전부 따른다
const PERMISSIVE = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'Zlib'];
function chooseLicense(expr) {
  const e = (expr ?? '').replace(/[()]/g, ' ').trim();
  if (/\sAND\s/.test(e)) return { use: e.split(/\s+AND\s+/), chosen: '' };
  const opts = e.split(/\s+OR\s+|\s*\/\s*/).filter(Boolean);
  if (opts.length < 2) return { use: opts, chosen: '' };
  const pick = PERMISSIVE.find((p) => opts.includes(p));
  return { use: [pick ?? opts[0]], chosen: pick ?? '' };
}
const COPYLEFT = /\b(MPL|GPL|LGPL|AGPL|EPL|CDDL|EUPL|CC-BY-SA)\b/i;
/** package.json author·contributors 또는 Cargo.toml authors. 없으면 '' */
function personOf(p) {
  if (typeof p === 'string') return p.trim();
  return p?.name ? `${p.name}${p.email ? ` <${p.email}>` : ''}` : '';
}

// ── 패키지 기록 ──
const pkgs = new Map();
function addPackage(group, name, version, license, url, dir, extra = [], meta = {}) {
  const key = `${group === 'rust' ? 'crate' : 'pkg'}:${name}@${version}`;
  let rec = pkgs.get(key);
  if (!rec) {
    rec = { name, version, license, url, groups: new Set(), refs: [], note: '', notes: [], resolved: false, lgpl: null };
    const user = `${name} ${version}`.trim();
    const own = [...extra, ...licenseFiles(dir)];
    for (const f of own) rec.refs.push(addText(f.name, f.text, user));
    const hasOwn = rec.refs.some(Boolean);
    const { use, chosen } = chooseLicense(license);
    const lgpl = use.some((id) => /^LGPL-/.test(id));
    let readme = '';
    if (dir && (!hasOwn || lgpl)) readme = readmeLicense(dir);
    if (readme) rec.refs.push(addText('README 의 라이선스 절', readme, user));
    // 전문 파일이 없거나(README 절만 있는 것 포함) LGPL 을 꼭 따라야 하면 표준 전문을 붙인다
    if (!hasOwn || lgpl) {
      const ownText = own.map((f) => f.text).join('\n');
      const ids = use.flatMap(stdIds).filter((id) => !(SIGN[id] && SIGN[id].test(ownText)));
      for (const id of ids) rec.refs.push(stdText(id, user));
      if (!hasOwn && ids.length) {
        const holder = meta.holder || `패키지 저장소 참고 (${meta.repo || url})`;
        rec.notes.push(`패키지에 전문 파일이 없어 ${ids.join('·')} 표준 전문을 실음`, `저작권자: ${holder}`);
      } else if (!hasOwn && readme) rec.note = 'README 의 라이선스 절만 있음';
      else if (hasOwn && ids.length) rec.notes.push(`${ids.join('·')} 표준 전문을 함께 실음`);
    }
    if (chosen && COPYLEFT.test(license)) { rec.notes.push(`따르는 라이선스: ${chosen} (${license.replace(/^\((.*)\)$/, '$1')} 중에서 고름)`); rec.resolved = true; }
    else if (chosen && !hasOwn) rec.notes.push(`따르는 라이선스: ${chosen}`);
    const mpl = chosen ? '' : use.find((id) => /^MPL-/.test(id));
    if (mpl && url) {
      rec.notes.push(`${mpl}: 수정하지 않고 그대로 씀. 소스 코드는 ${url} 에서 받을 수 있음`);
      rec.resolved = true;
    }
    if (lgpl) rec.lgpl = dir;
    rec.refs = [...new Set(rec.refs.filter(Boolean))];
    pkgs.set(key, rec);
  }
  rec.groups.add(group);
  return rec;
}

// ── npm ──
function licenseOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => x.type ?? x).join(' OR ');
  return l?.type ?? '';
}
function repoOf(pkg) {
  let r = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!r) return pkg.homepage ?? '';
  r = r.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://').replace(/^git@github\.com:/, 'https://github.com/');
  if (r.startsWith('github:')) return `https://github.com/${r.slice(7)}`;
  return /^[\w.-]+\/[\w.-]+$/.test(r) ? `https://github.com/${r}` : r;
}
function addNpm(group, dir) {
  const pkg = readJson(join(dir, 'package.json'));
  const holder = [pkg.author, ...(Array.isArray(pkg.contributors) ? pkg.contributors : [])].map(personOf).filter(Boolean).join(', ');
  if (pkg.name && pkg.version) addPackage(group, pkg.name, pkg.version, licenseOf(pkg), repoOf(pkg), dir, [], { holder });
  return pkg;
}
/** Node 의 찾기 순서 그대로: 패키지 실제 폴더에서 위로 올라가며 node_modules/<이름> (npm·pnpm 둘 다) */
function findPkg(from, name) {
  for (let dir = from; ; dir = dirname(dir)) {
    const cand = join(dir, 'node_modules', name);
    if (existsSync(join(cand, 'package.json'))) return realpathSync(cand);
    if (dirname(dir) === dir) return null;
  }
}
/** dependencies(+설치된 optionalDependencies) 를 따라간다. devDependencies 는 설치본에 없다 */
function walkNpm(group, projectDir) {
  const root = readJson(join(projectDir, 'package.json'));
  const queue = Object.keys(root.dependencies ?? {}).map((n) => [projectDir, n, false]);
  const seen = new Set();
  while (queue.length) {
    const [from, name, optional] = queue.shift();
    const dir = findPkg(from, name);
    if (!dir) { if (!optional) warnings.push(`${group}: ${name} 을(를) node_modules 에서 못 찾음`); continue; }
    if (seen.has(dir)) continue;
    seen.add(dir);
    const pkg = addNpm(group, dir);
    for (const d of Object.keys(pkg.dependencies ?? {})) queue.push([dir, d, false]);
    for (const d of Object.keys(pkg.optionalDependencies ?? {})) queue.push([dir, d, true]);
  }
}
/** 번들(dist/bundle.mjs)에 녹은 순수 JS 패키지: source map 의 node_modules 경로 */
function bundledDirs(mapFile) {
  const map = readJson(mapFile);
  const dirs = new Set();
  for (const s of map.sources ?? []) {
    const m = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(resolve(dirname(mapFile), map.sourceRoot ?? '', s));
    if (m && existsSync(join(m[1], 'package.json'))) dirs.add(m[1]);
  }
  return dirs;
}
/** 설치본에 그대로 실리는 node_modules 폴더 전부 (안쪽 node_modules 포함) */
function eachPackage(nm, cb) {
  for (const n of isDir(nm) ? readdirSync(nm).sort() : []) {
    if (n.startsWith('.')) continue;
    const p = join(nm, n);
    for (const d of n.startsWith('@') ? readdirSync(p).sort().map((s) => join(p, s)) : [p]) {
      if (existsSync(join(d, 'package.json'))) { cb(d); eachPackage(join(d, 'node_modules'), cb); }
    }
  }
}

// ── Rust 크레이트 ──
function cargoPackage(toml) {
  const out = {};
  let table = '';
  let multi = false;
  let authors = null; // authors = [ ... ] 이 여러 줄일 때 모으는 중
  for (const line of toml.split(/\r?\n/)) {
    if (authors !== null || (table === 'package' && /^\s*authors\s*=\s*\[/.test(line))) {
      authors = (authors ?? '') + line;
      if (/\]\s*$/.test(line)) { out.authors = [...authors.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]); authors = null; }
      continue;
    }
    const q = (line.match(/"""/g) ?? []).length;
    if (multi) { if (q % 2) multi = false; continue; }
    if (q % 2) { multi = true; continue; }
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (h) { table = h[1].trim(); continue; }
    const m = table === 'package' && /^\s*(license|license-file|repository)\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (m) out[m[1]] = m[2].replace(/\\(.)/g, '$1');
  }
  return out;
}
function walkCrates() {
  const regRoot = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'registry', 'src');
  const regs = isDir(regRoot) ? readdirSync(regRoot).map((d) => join(regRoot, d)) : [];
  const missing = [];
  const lock = readFileSync(join(ROOT, 'src-tauri', 'Cargo.lock'), 'utf8');
  for (const block of lock.split('[[package]]').slice(1)) {
    const get = (k) => new RegExp(`^${k} = "([^"]*)"`, 'm').exec(block)?.[1];
    const [name, version, source] = [get('name'), get('version'), get('source')];
    if (!source) continue; // 이 레포의 크레이트(kordoc-ai)
    const page = `https://crates.io/crates/${name}/${version}`;
    const dir = regs.map((r) => join(r, `${name}-${version}`)).find(isDir);
    if (!dir) { missing.push(`${name} ${version}`); addPackage('rust', name, version, '', page, null).note = '이 PC 에 소스 없음'; continue; }
    const meta = cargoPackage(readFileSync(join(dir, 'Cargo.toml'), 'utf8'));
    const lf = meta['license-file'] && join(dir, meta['license-file']);
    const extra = lf && existsSync(lf) && !isDir(lf) ? [{ name: meta['license-file'], text: readFileSync(lf, 'utf8') }] : [];
    addPackage('rust', name, version, meta.license ?? (meta['license-file'] ? `license-file: ${meta['license-file']}` : ''), page, dir, extra, { holder: (meta.authors ?? []).join(', '), repo: meta.repository });
  }
  return missing;
}

// ── 글꼴: name 표 (WOFF2 는 Brotli 한 덩어리에 표가 이어져 있다) ──
function base128(buf, o) {
  let v = 0;
  for (let i = 0; i < 5; i++) { const b = buf[o.p++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; }
  throw new Error('UIntBase128');
}
function nameTable(buf) {
  if (buf.toString('latin1', 0, 4) === 'wOF2') {
    const num = buf.readUInt16BE(12);
    const o = { p: 48 };
    let off = 0;
    let found = null;
    for (let i = 0; i < num; i++) {
      const flags = buf[o.p++];
      const idx = flags & 63;
      const tag = idx === 63 ? buf.toString('latin1', o.p, (o.p += 4)) : idx;
      const orig = base128(buf, o);
      const transformed = idx === 10 || idx === 11 ? flags >> 6 === 0 : flags >> 6 !== 0; // glyf·loca 는 0 이 변환
      const len = transformed ? base128(buf, o) : orig;
      if (tag === 5 || tag === 'name') found = { off, len };
      off += len;
    }
    if (!found) return null;
    return brotliDecompressSync(buf.subarray(o.p, o.p + buf.readUInt32BE(20))).subarray(found.off, found.off + found.len);
  }
  for (let i = 0, n = buf.readUInt16BE(4); i < n; i++) { // OTF·TTF
    const r = 12 + i * 16;
    if (buf.toString('latin1', r, r + 4) === 'name') return buf.subarray(buf.readUInt32BE(r + 8), buf.readUInt32BE(r + 8) + buf.readUInt32BE(r + 12));
  }
  return null;
}
/** 0 저작권 · 1 이름 · 5 버전 · 13 라이선스 · 14 라이선스 주소 (Windows 영어 문자열 우선) */
function fontNames(file) {
  const t = nameTable(readFileSync(file));
  const out = {};
  if (!t) return out;
  const best = {};
  for (let i = 0, so = t.readUInt16BE(4); i < t.readUInt16BE(2); i++) {
    const r = 6 + i * 12;
    const [pid, lid, nid, len, off] = [t.readUInt16BE(r), t.readUInt16BE(r + 4), t.readUInt16BE(r + 6), t.readUInt16BE(r + 8), t.readUInt16BE(r + 10)];
    const raw = Buffer.from(t.subarray(so + off, so + off + len));
    const s = pid === 1 ? raw.toString('latin1') : raw.swap16().toString('utf16le');
    const score = (pid === 3 ? 4 : pid === 0 ? 2 : 1) + (lid === 0x409 || (pid === 1 && lid === 0) ? 2 : 0);
    if (!best[nid] || best[nid] < score) { best[nid] = score; out[nid] = s.replace(/\s+/g, ' ').trim(); }
  }
  return out;
}
/** FONTS.md 의 "라이선스" 칸 (파일명 칸의 * 는 여러 파일) */
function fontsMdLicenses(md) {
  const rules = [];
  let col = -1;
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) { col = -1; continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, ''));
    if (cells.includes('라이선스')) { col = cells.indexOf('라이선스'); continue; }
    if (col < 0 || !/\.woff2/.test(cells[0])) continue;
    const pat = cells[0].replace(/\s*\(.*\)$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    rules.push({ re: new RegExp(`^${pat}$`), license: cells[col] });
  }
  return rules;
}

// ── 모으기 ──
walkNpm('app', ROOT);
const staged = join(ROOT, 'node-sidecar', 'dist', 'node_modules');
const bundleMap = join(ROOT, 'node-sidecar', 'dist', 'bundle.mjs.map');
if (isDir(staged) && existsSync(bundleMap)) {
  eachPackage(staged, (d) => addNpm('engine', d));
  for (const d of bundledDirs(bundleMap)) addNpm('engine', d);
} else {
  walkNpm('engine', join(ROOT, 'node-sidecar'));
  warnings.push('node-sidecar/dist 의 node_modules·bundle.mjs.map 이 없어 문서 엔진은 package.json 의존 전체로 적음(설치본에 없는 선택 의존이 섞일 수 있음). node scripts/build-sidecar.mjs 뒤 다시 실행');
}
const missingCrates = walkCrates();

const RHWP_VERSION = /const RHWP_VERSION = '([^']+)'/.exec(readFileSync(join(ROOT, 'scripts', 'build-rhwp-studio.mjs'), 'utf8'))?.[1] ?? '';
const editorLic = join(ROOT, 'node-sidecar', 'editor', 'licenses');
const editorExtra = [];
if (isDir(editorLic)) {
  for (const n of readdirSync(editorLic).filter((f) => /rhwp/i.test(f))) editorExtra.push({ name: `licenses/${n}`, text: readFileSync(join(editorLic, n), 'utf8') });
} else warnings.push('node-sidecar/editor/licenses 가 없음 (node scripts/build-rhwp-studio.mjs 뒤 다시 실행)');
addPackage('editor', 'rhwp (rhwp-studio · @rhwp/core · @rhwp/editor)', RHWP_VERSION, 'MIT', 'https://github.com/edwardkim/rhwp', null, editorExtra);
const rhwpSrc = join(tmpdir(), `kordoc-rhwp-build-${RHWP_VERSION}`, 'rhwp');
let rhwpThirdParty = '';
if (isDir(join(rhwpSrc, 'rhwp-studio', 'node_modules'))) {
  walkNpm('editor', join(rhwpSrc, 'rhwp-studio'));
  if (existsSync(join(rhwpSrc, 'THIRD_PARTY_LICENSES.md'))) rhwpThirdParty = addText('rhwp THIRD_PARTY_LICENSES.md', readFileSync(join(rhwpSrc, 'THIRD_PARTY_LICENSES.md'), 'utf8'), `rhwp ${RHWP_VERSION}`);
} else warnings.push(`rhwp 빌드 임시 폴더(임시 폴더/kordoc-rhwp-build-${RHWP_VERSION})가 없어 편집기 화면 의존(canvaskit-wasm 등)과 rhwp WASM 크레이트 목록을 못 넣음 (node scripts/build-rhwp-studio.mjs --force 뒤 다시 실행)`);

// 글꼴
const OFL_SRC = join(ROOT, 'public', 'fonts', 'OFL.txt');
const oflFull = existsSync(OFL_SRC) ? readFileSync(OFL_SRC, 'utf8') : '';
const oflBody = oflFull.slice(Math.max(0, oflFull.indexOf('This Font Software is licensed under the SIL Open Font License')));
const fonts = [];
// FONTS.md 가 "무료 배포"라고만 적은 글꼴의 공식 출처 (2026-10-11 curl 로 확인. 조건은 출처 문서의 문장만 옮긴다)
const FONT_SOURCES = [
  { re: /^Cafe24/, url: 'https://fonts.cafe24.com', ofl: true, note: '설치본의 파일은 공식 배포 zip 의 webfont 파일과 같은 파일이고, 그 zip 의 라이선스 안내(License-*.pdf)에 "SIL OPEN FONT LICENSE(Version 1.1)에 따라 사용이 허가됩니다" 라고 적혀 있음' },
  { re: /^Happiness/, url: 'https://thehyundaifont.com', ofl: false, note: '출처 안내문: "현대백화점 해피니스 산스 글꼴은 무료로 배포되며 영리적, 비영리적 목적으로 개인 및 기업 사용자 모두 자유롭게 사용하실 수 있습니다. 단, 현대백화점 해피니스 산스 글꼴의 지식재산권은 (주)현대백화점에 있으며, 폰트 파일은 유료로 판매하실 수 없습니다. 자세한 라이센스 범위는 글꼴 파일에 첨부된 PDF를 확인해주세요."', pdf: 'licenses/HapinessSans_License.pdf', why: '상세 라이선스는 공식 배포 zip 의 HapinessSans_License.pdf 에만 있는데(글자를 뽑을 수 없는 PDF), 레포 licenses/ 에 그 파일이 없음' },
];
const fontsMd = join(ROOT, 'node-sidecar', 'editor', 'studio', 'fonts', 'FONTS.md');
const mdRules = existsSync(fontsMd) ? fontsMdLicenses(readFileSync(fontsMd, 'utf8')) : [];
for (const [where, dir] of [['편집기', join(ROOT, 'node-sidecar', 'editor', 'studio', 'fonts')], ['앱 화면', join(ROOT, 'public', 'fonts')]]) {
  for (const f of (isDir(dir) ? readdirSync(dir) : []).filter((n) => /\.(woff2|otf|ttf)$/i.test(n)).sort()) {
    const n = fontNames(join(dir, f));
    const md = mdRules.find((r) => r.re.test(f))?.license ?? '';
    const src = where === '편집기' ? FONT_SOURCES.find((s) => s.re.test(f)) : null;
    const ofl = /OFL|open\s?font\s?licen[cs]e/i.test(`${md} ${n[13] ?? ''} ${n[14] ?? ''}`) || !!src?.ofl;
    const own = (isDir(editorLic) ? readdirSync(editorLic) : []).filter((l) => /OFL/i.test(l) && f.startsWith(l.replace(/-?OFL.*$/i, '')));
    const refs = [];
    if (where === '앱 화면' && oflFull) refs.push(addText('public/fonts/OFL.txt', oflFull, `${n[1] ?? f} (앱 화면)`));
    for (const l of own) refs.push(addText(`licenses/${l}`, readFileSync(join(editorLic, l), 'utf8'), n[1] ?? f));
    if (ofl && !refs.length && oflBody) refs.push(addText('SIL Open Font License 1.1', oflBody, n[1] ?? f));
    // GUST Font License 는 LPPL 1.3c 에 요청 한 줄을 더한 것이라 둘 다 싣는다
    if (/GUST/i.test(`${md} ${n[0] ?? ''} ${n[13] ?? ''}`)) for (const id of ['GUST-Font-License', 'LPPL-1.3c']) refs.push(stdText(id, n[1] ?? f));
    const license = md && src ? `출처의 ${md} 조건 (FONTS.md)` : md || (ofl ? 'SIL OFL 1.1' : n[13] ?? '');
    // 전문을 글로 못 뽑는 라이선스(PDF)는 공식 배포본 파일을 설치본 licenses/ 에 그대로 싣는다 (tauri.conf.json resources)
    const shipped = !!src?.pdf && existsSync(join(ROOT, src.pdf));
    fonts.push({ where, file: f, family: n[1] ?? '', version: (n[5] ?? '').replace(/^Version\s*/i, ''), copyright: n[0] ?? '', license, ofl, src, shipped, refs: [...new Set(refs.filter(Boolean))] });
  }
}

// OCR 모델·동봉 Node
const ocrDir = join(ROOT, 'node-sidecar', 'models', 'ppocr');
if (isDir(ocrDir)) {
  const files = readdirSync(ocrDir).sort().join(' · ');
  addPackage('model', `PP-OCRv5 korean (${files})`, '', 'Apache-2.0', 'https://github.com/PaddlePaddle/PaddleOCR', null, APACHE ? [{ name: 'Apache License 2.0 표준 전문', text: APACHE }] : []);
} else warnings.push('node-sidecar/models/ppocr 가 없음 (node scripts/build-sidecar.mjs 뒤 다시 실행)');
const NODE_VERSION = /const NODE_VERSION = '([^']+)'/.exec(readFileSync(join(ROOT, 'scripts', 'fetch-node.mjs'), 'utf8'))?.[1] ?? '';
const nodeLicense = existsSync(join(ROOT, 'src-tauri', 'resources', 'node', 'LICENSE'));
addPackage('model', 'Node.js (동봉 런타임)', NODE_VERSION.replace(/^v/, ''), 'MIT 및 포함 구성요소 라이선스', 'https://nodejs.org', null).note = nodeLicense ? '전문: 설치 폴더 node/LICENSE (Node.js 배포본 그대로)' : '';
if (!nodeLicense) warnings.push('src-tauri/resources/node/LICENSE 가 없음 (node scripts/fetch-node.mjs 뒤 다시 실행)');

// ── 확인할 항목 ──
const all = [...pkgs.values()];
const label = (p) => `${p.name}${p.version ? ` ${p.version}` : ''}`;
const ODD = /^$|UNLICENSED|SEE LICEN[CS]E|UNKNOWN|\bNC\b|non-?commercial|custom/i;

/** LGPL 구성요소의 대응 소스 안내 (sharp 가 싣는 libvips). 모르는 패키지면 null: 확인할 항목에 남는다 */
function lgplSource(p) {
  const dir = p.lgpl;
  let vips = '';
  try { vips = readJson(join(dir, 'versions.json')).vips ?? ''; } catch { /* versions.json 없음 */ }
  const libvips = vips ? ` · libvips ${vips}: https://github.com/libvips/libvips/tree/v${vips}` : '';
  const lib = isDir(join(dir, 'lib')) ? readdirSync(join(dir, 'lib')).sort() : [];
  if (/^@img\/sharp-libvips-/.test(p.name)) {
    return [
      `${label(p)}: libvips 와 그 의존 라이브러리를 묶은 공유 라이브러리(lib/${lib.filter((f) => /^libvips/.test(f)).join(', lib/')}). 앱이 실행 중에 불러오는 별도 파일이라 사용자가 다른 빌드로 바꿔 넣을 수 있다.`,
      `대응 소스: sharp-libvips ${p.version} https://github.com/lovell/sharp-libvips/tree/v${p.version} (빌드 스크립트·패치)${libvips}. 묶인 라이브러리별 버전은 패키지의 versions.json, 라이선스 표는 README 의 라이선스 절.`,
    ];
  }
  if (p.name === '@img/sharp-wasm32') {
    const sharp = findPkg(dir, 'sharp');
    const dev = sharp ? readJson(join(sharp, 'package.json')).devDependencies?.['@img/sharp-libvips-dev-wasm32'] : '';
    return [
      `${label(p)}: sharp 의 바인딩과 libvips·그 의존 라이브러리가 WebAssembly 모듈(lib/${lib.filter((f) => f.endsWith('.wasm')).join(', lib/')}) 하나에 정적으로 들어 있다. 모듈은 실행 중에 불러오는 별도 파일이라 아래 공개 소스로 다시 빌드한 모듈로 바꿔 넣을 수 있다.`,
      `대응 소스: sharp ${p.version} https://github.com/lovell/sharp/tree/v${p.version} (npm/wasm32) · sharp-libvips ${dev ? `${dev} https://github.com/lovell/sharp-libvips/tree/v${dev}` : 'https://github.com/lovell/sharp-libvips'} (emscripten 빌드)${libvips}. 묶인 라이브러리별 버전은 패키지의 versions.json, 라이선스 표는 README 의 라이선스 절.`,
    ];
  }
  return null;
}
for (const p of all.filter((x) => x.lgpl)) {
  p.lgplSource = lgplSource(p);
  if (p.lgplSource) { p.resolved = true; p.notes.push('LGPL 대응 소스 안내: 이 절 끝'); }
}

const checks = {
  copyleft: all.filter((p) => COPYLEFT.test(p.license) && !p.resolved),
  odd: all.filter((p) => p.note !== '이 PC 에 소스 없음' && !p.name.startsWith('Node.js') && ODD.test(p.license)),
  noText: all.filter((p) => !p.refs.length && p.note !== '이 PC 에 소스 없음' && !p.name.startsWith('Node.js')),
  readmeOnly: all.filter((p) => p.note === 'README 의 라이선스 절만 있음'),
  fonts: fonts.filter((f) => !f.refs.length && !f.shipped),
};

// ── 쓰기 ──
const wrap = (s, w = 100) => s.split(' ').reduce((lines, word) => {
  const last = lines[lines.length - 1];
  if (last && (last + ' ' + word).length <= w) lines[lines.length - 1] = `${last} ${word}`;
  else lines.push(word);
  return lines;
}, []).join('\n  ');
const line = (p) => {
  const parts = [label(p), p.license || '라이선스 표기 없음', p.url].filter(Boolean);
  const refs = p.refs.length ? `전문 ${p.refs.join(', ')}` : p.note === '이 PC 에 소스 없음' ? '이 PC 에 소스 없음' : p.name.startsWith('Node.js') ? p.note : '전문 없음';
  const notes = [p.note && p.refs.length ? p.note : '', ...p.notes].filter(Boolean);
  return `- ${parts.join(' · ')} · ${refs}${notes.length ? ` (${notes.join(' · ')})` : ''}`;
};
const byName = (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en');
const section = (g) => all.filter((p) => p.groups.has(g)).sort(byName);
const HR = '='.repeat(100);
const out = [];
const sections = [
  ['app', '1. 앱 화면 (React, npm 패키지)'],
  ['engine', '2. 문서 엔진 (Node, npm 패키지: 번들에 든 것과 설치본 node-sidecar/dist/node_modules)'],
  ['rust', '3. 앱 본체 (Rust 크레이트, src-tauri/Cargo.lock 전체: 빌드 도구·다른 운영체제용 포함)'],
  ['editor', `4. 내장 한글 편집기 (rhwp ${RHWP_VERSION})`],
];
out.push('KorDoc AI 제3자 고지 (THIRD_PARTY_NOTICES)', '');
out.push('KorDoc AI 는 MIT 라이선스(LICENSE)로 배포한다. 설치본에 함께 들어 있는 제3자 저작물의 이름·버전·라이선스와');
out.push('라이선스 전문을 아래에 모았다. 각 저작물의 권리는 원 저작권자에게 있고 각자의 라이선스를 따른다.');
out.push('요약과 Microsoft 구성요소(Visual C++ 런타임·WebView2 설치 파일)의 배포 조건은 NOTICE 에 있다.', '');
out.push('패키지에 전문 파일이 없는 것은 선언한 라이선스의 표준 전문(scripts/license-texts)을 싣고, 그 줄에 패키지 정보의 저작권자를');
out.push('적었다. 표준 전문의 <year> <copyright holders> 같은 자리표시는 그 줄의 저작권자로 읽는다. 여러 라이선스 중 고를 수 있는');
out.push('것(OR)은 MIT·Apache-2.0·BSD-3-Clause·BSD-2-Clause·ISC·Zlib 순서로 처음 나오는 것을 따른다.', '');
out.push('이 파일은 scripts/third-party-notices.mjs 가 만든다(손으로 고치지 않는다).');
out.push(`만든 환경: ${process.platform}-${process.arch}. 운영체제마다 다른 네이티브 모듈(sharp·node-llama-cpp 등)은 만든 환경의 것이 적힌다.`, '');
out.push('목차');
for (const [g, title] of sections) out.push(`  ${title}: ${section(g).length}개`);
out.push(`  5. 글꼴: ${fonts.length}개 파일`, '  6. OCR 모델·동봉 Node', '  7. 확인할 항목', `  8. 라이선스 전문: ${texts.size}개`, '');
for (const [g, title] of sections) {
  out.push(HR, title, HR, '');
  out.push(...section(g).map(line));
  if (g === 'editor' && rhwpThirdParty) out.push('', `rhwp 가 밝힌 제3자 목록(WASM 에 든 Rust 크레이트·글꼴 포함): 전문 ${rhwpThirdParty}`);
  const lg = section(g).filter((p) => p.lgplSource);
  if (lg.length) out.push('', 'LGPL 구성요소의 대응 소스 (LGPL-3.0·GPL-3.0 전문은 8절)', ...lg.flatMap((p) => p.lgplSource.map((s, i) => `${i ? '  ' : '- '}${wrap(s, 98)}`)));
  out.push('');
}
out.push(HR, '5. 글꼴', HR, '');
for (const f of fonts) {
  const head = [`${f.where}: ${f.file}`, f.family, f.version && `버전 ${f.version}`, f.license || '라이선스 표기 없음'].filter(Boolean).join(' · ');
  out.push(`- ${head} · ${f.refs.length ? `전문 ${f.refs.join(', ')}` : '전문 없음'}`);
  if (f.copyright) out.push(`  ${wrap(f.copyright, 98)}`);
  if (f.src) out.push(`  출처: ${f.src.url}`, `  ${wrap(f.src.note, 98)}`);
  if (f.shipped) out.push(`  라이선스 전문: 설치 폴더 ${f.src.pdf} (공식 배포 zip 의 파일 그대로)`);
}
out.push('', HR, '6. OCR 모델·동봉 Node', HR, '');
out.push(...section('model').map(line), '');
out.push(HR, '7. 확인할 항목 (사람이 볼 것)', HR, '');
const list = (title, items, fmt) => { if (items.length) out.push(title, ...items.map(fmt), ''); };
list('MPL·GPL 계열인데 따를 라이선스나 소스 안내를 정하지 못한 것 (MPL 은 소스 받을 곳, LGPL 은 대응 소스 안내가 필요)', checks.copyleft, (p) => `- ${label(p)} · ${p.license} · ${p.url}`);
list('라이선스 표기가 없거나 표준이 아닌 것', checks.odd, (p) => `- ${label(p)} · ${p.license || '표기 없음'} · ${p.url}`);
list('전문 파일을 못 찾은 것', checks.noText, (p) => `- ${label(p)} · ${p.license || '표기 없음'} · ${p.url}`);
list('README 의 라이선스 절만 실은 것 (전문 파일 없음)', checks.readmeOnly, (p) => `- ${label(p)} · ${p.license}`);
list('라이선스 전문이 없는 글꼴', checks.fonts, (f) => `- ${f.file} · ${f.family} · ${f.license || '표기 없음'} · ${f.src?.why ?? f.copyright}`);
list('이 PC 의 Cargo 저장소에 소스가 없어 라이선스를 못 읽은 크레이트 (이 PC 의 빌드에 쓰이지 않아 내려받지 않은 것: 다른 운영체제용 등. 그 운영체제에서 빌드한 PC 나 src-tauri 에서 cargo fetch 를 마친 PC 에서 다시 실행하면 채워짐)', missingCrates, (c) => `- ${c}`);
list('만들 때 경고', warnings, (w) => `- ${w}`);
if (out.at(-1) === '' && out.at(-2) === HR && out.at(-3)?.startsWith('7. ')) out.push('없음', '');
out.push(HR, '8. 라이선스 전문', HR);
for (const t of texts.values()) {
  out.push('', `${'-'.repeat(100)}`, `[${t.id}] ${t.title}`, `대상: ${wrap(t.users.join(', '))}`, '', t.body);
}
writeFileSync(OUT, `${out.join('\n')}\n`);

// ── 터미널 요약 ──
const size = statSync(OUT).size;
console.log(`[notices] ${OUT} (${(size / 1024).toFixed(0)}KB, 전문 ${texts.size}개)`);
for (const [g, title] of sections) console.log(`  ${title.split(' (')[0]}: ${section(g).length}개`);
console.log(`  글꼴 ${fonts.length}개 · 소스 없는 크레이트 ${missingCrates.length}개`);
for (const [k, v] of Object.entries(checks)) if (v.length) console.log(`  확인 ${k}: ${v.map((p) => p.file ?? label(p)).join(', ')}`);
for (const w of warnings) console.log(`  경고: ${w}`);
