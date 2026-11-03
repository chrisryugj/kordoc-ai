/** 저장소 관문 — 공공 GitLab 은 push 마다 Gitleaks·Semgrep·OSV·Trivy 를 돌려 하나라도 걸리면 push 를 통째로 거부한다.
 *  올리기 전에 여기서 먼저: 비밀값(커밋 이력 전체) · 의존성 취약점 · 문서보안(DRM)으로 암호화·깨진 파일 · 라이선스 고지 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
/** 시험용 가짜 값으로 알려진 줄 (허용) */
const ALLOW = /(fake|dummy|example|test|placeholder|가짜|xxxx)/i;

export function repoChecks() {
  secretScan();
  drmScan();
  vulnScan();
  const notices = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt'].filter((f) => !existsSync(join(ROOT, f)));
  record(A, '라이선스·제3자 고지 파일', notices.length ? 'FAIL' : 'PASS', notices.length ? `없음: ${notices.join(', ')}` : '');
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
