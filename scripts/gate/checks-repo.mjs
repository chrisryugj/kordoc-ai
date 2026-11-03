/** 저장소 관문 — 공공 GitLab 은 push 마다 Gitleaks·Semgrep·OSV·Trivy 를 돌려 하나라도 걸리면 push 를 통째로 거부한다.
 *  올리기 전에 여기서 먼저: 비밀값(커밋 이력 전체) · 의존성 취약점 · 문서보안(DRM)으로 암호화·깨진 파일 · 라이선스 고지 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SIDECAR, record } from './lib.mjs';

const A = '저장소';
const git = (args, opts = {}) => spawnSync('git', args, { cwd: ROOT, encoding: opts.buffer ? 'buffer' : 'utf-8', maxBuffer: 1 << 30 });

/** 흔한 비밀값 꼴 (Gitleaks 기본 규칙 중 이 프로젝트에 나올 만한 것) */
const SECRETS = [
  ['개인 키', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Anthropic 키', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI 키', /sk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ['Google API 키', /AIza[0-9A-Za-z_-]{35}/],
  ['GitHub 토큰', /gh[pousr]_[A-Za-z0-9]{36}/],
  ['GitLab 토큰', /glpat-[A-Za-z0-9_-]{20}/],
  ['AWS 키', /AKIA[0-9A-Z]{16}/],
  ['Slack 토큰', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['npm 토큰', /npm_[A-Za-z0-9]{36}/],
  ['HuggingFace 토큰', /hf_[A-Za-z0-9]{34}/],
];
/** Gitleaks 와 같은 허용 표시만 본다 (단어로 봐주면 GitLab 이 거부한다: 실측 test 파일의 가짜 키 5곳) */
const ALLOW = /gitleaks:allow/;
/** Gitleaks generic-api-key 에 가깝게: 키 이름 + 대입 + 10자 넘는 값, 값의 엔트로피가 3.5 넘으면 */
const GENERIC = /(?:api[_-]?key|apikey|secret|token|passwd|password|credential|access[_-]?key)[\w.-]{0,20}["'`\s]{0,3}(?::|=|=>|:=)[\s"'`=]{0,5}([\w.=+/-]{10,150})/gi;
const entropy = (s) => { const n = new Map(); for (const c of s) n.set(c, (n.get(c) ?? 0) + 1); let h = 0; for (const k of n.values()) { const p = k / s.length; h -= p * Math.log2(p); } return h; };

export async function repoChecks() {
  secretScan();
  drmScan();
  vulnScan();
  await osvScan();
  const notices = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt'].filter((f) => !existsSync(join(ROOT, f)));
  record(A, '라이선스·제3자 고지 파일', notices.length ? 'FAIL' : 'PASS', notices.length ? `없음: ${notices.join(', ')}` : '');
  // 셸 따옴표 실수로 생긴 파일("$(grep", "k.toUpperCase()" 같은 빈 파일)이 올라가지 않게 (실측: 한 번 올라갔다 지움)
  const tracked = git(['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  const junk = tracked.filter((f) => /[$`'"{}]|^[+~]|[+~]]$/.test(f.split('/').pop()) || (existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).size === 0 && !/(^|\/)\.(gitkeep|keep)$|__init__\.py$/.test(f)));
  record(A, '이상한 이름·빈 파일 없음', junk.length ? 'FAIL' : 'PASS', junk.slice(0, 10).join(', '));
  const dirty = git(['status', '--porcelain']).stdout.trim();
  record(A, '커밋 안 한 변경 없음', dirty ? 'WARN' : 'PASS', dirty.split('\n').slice(0, 5).join(' | '));
}

function secretScan() {
  // 커밋 이력 전체 (새 GitLab 저장소에 처음 올리면 이력이 다 스캔된다) + 작업 폴더
  const all = new RegExp(SECRETS.map(([, r]) => r.source).join('|'));
  const hist = git(['log', '--all', '-p', '--no-color', '--no-ext-diff', '-U0', '--format=@@commit %h']).stdout ?? '';
  const work = git(['grep', '-I', '-n', '-P', all.source]).stdout ?? '';
  const hits = [];
  let commit = '';
  for (const line of hist.split('\n')) {
    if (line.startsWith('@@commit ')) { commit = line.slice(9); continue; }
    if (!line.startsWith('+') || ALLOW.test(line)) continue;
    const k = SECRETS.find(([, r]) => r.test(line));
    if (k) hits.push(`${commit} ${k[0]}: ${line.slice(0, 90)}`);
  }
  for (const line of work.split('\n')) {
    if (!line || ALLOW.test(line)) continue;
    const k = SECRETS.find(([, r]) => r.test(line));
    if (k) hits.push(`작업 폴더 ${k[0]}: ${line.slice(0, 90)}`);
  }
  // 일반 API 키 규칙은 GitLab 처럼 올릴 트리(추적 파일)만: 키 이름에 대입한 값이 길고 무작위해 보이면
  const generic = git(['grep', '-I', '-n', '-i', '-P', '(api[_-]?key|apikey|secret|token|passwd|password|credential|access[_-]?key)']).stdout ?? '';
  for (const line of generic.split('\n')) {
    if (!line || ALLOW.test(line) || /\.(md|lock|ya?ml)\:|pnpm-lock|package-lock/.test(line)) continue;
    for (const m of line.matchAll(GENERIC)) {
      if (entropy(m[1]) > 3.5 && /\d/.test(m[1]) && /[a-z]/i.test(m[1])) { hits.push(`일반 키(Gitleaks generic-api-key 꼴): ${line.slice(0, 110)}`); break; }
    }
  }
  record(A, '비밀값 없음 (커밋 이력 전체 + 작업 폴더)', hits.length ? 'FAIL' : 'PASS', [...new Set(hits)].slice(0, 8).join('\n'));
}

/** 확장자별 첫 바이트 — 기관 문서보안(DRM)이 암호화하면 머리가 바뀐다 (실측: VER3.2P + base64, 확장자 .pLDH) */
const MAGIC = {
  hwpx: [0x50, 0x4b], docx: [0x50, 0x4b], xlsx: [0x50, 0x4b], pptx: [0x50, 0x4b], zip: [0x50, 0x4b],
  pdf: [0x25, 0x50, 0x44, 0x46], hwp: [0xd0, 0xcf, 0x11, 0xe0], xls: [0xd0, 0xcf, 0x11, 0xe0], doc: [0xd0, 0xcf, 0x11, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8], jpeg: [0xff, 0xd8], gif: [0x47, 0x49, 0x46], mp4: null,
};
function drmScan() {
  const files = git(['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  const bad = [];
  for (const f of files) {
    if (/\.pLDH$/i.test(f)) { bad.push(`${f} (DRM 확장자)`); continue; }
    const ext = f.split('.').pop().toLowerCase();
    const want = MAGIC[ext];
    if (!want) continue;
    const head = git(['show', `HEAD:${f}`], { buffer: true }).stdout?.subarray(0, 8);
    const wt = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f)).subarray(0, 8) : null;
    for (const [where, b] of [['커밋', head], ['작업 폴더', wt]]) {
      if (!b) continue;
      if (b.toString('latin1').startsWith('VER')) bad.push(`${f} (${where}: 문서보안 암호화)`);
      else if (!want.every((x, i) => b[i] === x)) bad.push(`${f} (${where}: ${ext} 머리 아님)`);
    }
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter((f) => /\.pLDH$/i.test(f));
  record(A, '문서보안(DRM) 암호화·깨진 파일 없음', bad.length ? 'FAIL' : untracked.length ? 'WARN' : 'PASS',
    bad.length ? bad.slice(0, 8).join('\n') : untracked.length ? `커밋 안 된 DRM 사본: ${untracked.join(', ')} (올리지 말 것)` : `${files.length}개 파일`);
}

/** 레포의 lockfile 세 개(엔진 npm·화면 pnpm·Rust Cargo)를 GitLab 이 쓰는 OSV 데이터베이스에 그대로 묻는다 */
function lockPackages() {
  const out = [];
  const npmLock = JSON.parse(readFileSync(join(SIDECAR, 'package-lock.json'), 'utf-8'));
  for (const [k, v] of Object.entries(npmLock.packages ?? {})) {
    if (!k || !v.version) continue;
    out.push({ eco: 'npm', name: v.name ?? k.split('node_modules/').pop(), version: v.version, file: 'node-sidecar/package-lock.json' });
  }
  const pnpm = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf-8').split(/\r?\n/);
  let inPkgs = false;
  for (const l of pnpm) {
    if (/^packages:/.test(l)) { inPkgs = true; continue; }
    if (/^\S/.test(l)) inPkgs = false;
    const m = inPkgs && /^ {2}'?(@?[^@\s'(]+)@([0-9][^\s'(:]*)/.exec(l);
    if (m) out.push({ eco: 'npm', name: m[1], version: m[2], file: 'pnpm-lock.yaml' });
  }
  const cargo = join(ROOT, 'src-tauri', 'Cargo.lock');
  if (existsSync(cargo)) {
    for (const block of readFileSync(cargo, 'utf-8').split('[[package]]').slice(1)) {
      const name = /name = "([^"]+)"/.exec(block)?.[1];
      const version = /version = "([^"]+)"/.exec(block)?.[1];
      if (name && version && /source = "registry/.test(block)) out.push({ eco: 'crates.io', name, version, file: 'src-tauri/Cargo.lock' });
    }
  }
  const seen = new Set();
  return out.filter((p) => { const k = `${p.eco}:${p.name}@${p.version}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function osvScan() {
  const pkgs = lockPackages();
  const vulns = new Map();
  try {
    for (let i = 0; i < pkgs.length; i += 500) {
      const chunk = pkgs.slice(i, i + 500);
      const r = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: p.eco }, version: p.version })) }) });
      if (!r.ok) throw new Error(`OSV ${r.status}`);
      (await r.json()).results.forEach((res, j) => { for (const v of res.vulns ?? []) vulns.set(v.id, [...(vulns.get(v.id) ?? []), chunk[j]]); });
    }
  } catch (e) {
    record(A, 'OSV (lockfile 전체: npm·pnpm·Cargo)', 'WARN', `OSV 에 묻지 못함: ${e.message}`);
    return;
  }
  // lockfile 과 같은 폴더(또는 위 폴더)의 osv-scanner.toml [[IgnoredVulns]] — GitLab 의 OSV-Scanner 도 읽는다(Docufinder 에서 통과 확인)
  const ignores = git(['ls-files', '-z']).stdout.split('\0').filter((f) => f.endsWith('osv-scanner.toml')).map((f) => ({
    dir: f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '',
    ids: new Set([...readFileSync(join(ROOT, f), 'utf-8').matchAll(/^\s*id\s*=\s*"([^"]+)"/gm)].map((m) => m[1])),
  }));
  const ignored = (id, file) => ignores.some((g) => file.startsWith(g.dir) && g.ids.has(id));
  const rows = [];
  let skipped = 0;
  for (const [id, where] of vulns) {
    const live = where.filter((p) => !ignored(id, p.file));
    if (!live.length) { skipped++; continue; }
    const v = await (await fetch(`https://api.osv.dev/v1/vulns/${id}`)).json().catch(() => ({}));
    const sev = String(v.database_specific?.severity ?? '').toUpperCase() || (v.severity?.length ? 'CVSS' : '모름');
    rows.push({ id, sev, pkgs: live.map((p) => `${p.name}@${p.version} (${p.file})`) });
  }
  // GitLab 은 등급과 상관없이 하나라도 있으면 거부한다 (실측: LOW 1건·RUSTSEC 정보성 권고로 push 거부)
  const detail = rows.map((r) => `${r.sev} ${r.id} ${r.pkgs[0]}${r.pkgs.length > 1 ? ` 외 ${r.pkgs.length - 1}` : ''}`).join('\n');
  record(A, `OSV (lockfile ${pkgs.length}개 패키지, 무시 목록 ${skipped}건 뺌)`, rows.length ? 'FAIL' : 'PASS', rows.length ? `${rows.length}건:\n${detail}` : '알려진 취약점 없음');
}

function vulnScan() {
  const audit = (cwd, cmd, args) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf-8', shell: process.platform === 'win32', maxBuffer: 1 << 28 });
    try { return JSON.parse(r.stdout); } catch { return null; }
  };
  const npm = audit(SIDECAR, process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--omit=dev', '--json']);
  const pnpm = audit(ROOT, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['audit', '--prod', '--json']);
  for (const [name, j] of [['엔진(npm)', npm], ['화면(pnpm)', pnpm]]) {
    if (!j) { record(A, `취약점 ${name}`, 'WARN', 'audit 결과를 읽지 못함 (인터넷 필요)'); continue; }
    const v = j.metadata?.vulnerabilities ?? {};
    const crit = (v.critical ?? 0) + (v.high ?? 0);
    record(A, `취약점 ${name}`, crit ? 'FAIL' : (v.moderate ?? 0) ? 'WARN' : 'PASS', `치명 ${v.critical ?? 0} · 높음 ${v.high ?? 0} · 보통 ${v.moderate ?? 0} · 낮음 ${v.low ?? 0}`);
  }
}
