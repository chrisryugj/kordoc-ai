/** 서류 관문 — 안내서 '제출 서류 규격 미준수·항목 누락 시 심사 제외' 를 막는다.
 *  설정: docs/contest/gate.json · 사람 할 일: docs/contest/checklist.md (- [ ] 줄)
 *  제출물(PDF·영상)은 레포 밖 폴더(gate.json 의 out_dir)에 둔다 — GitLab 에 올리지 않는다 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { ROOT, SIDECAR, record } from './lib.mjs';

const A = '서류';
const require = createRequire(join(SIDECAR, 'package.json'));

export function loadConfig() {
  const p = join(ROOT, 'docs', 'contest', 'gate.json');
  if (!existsSync(p)) throw new Error('docs/contest/gate.json 이 없습니다');
  const c = JSON.parse(readFileSync(p, 'utf-8'));
  c.out_dir = isAbsolute(c.out_dir) ? c.out_dir : join(ROOT, c.out_dir);
  return c;
}

/** 파일명: [구분]_기관명_팀명(개인은 성명).확장자 */
const fileName = (c, kind, ext) => `[${kind}]_${c.org}_${c.team || c.name}.${ext}`;

export async function docChecks({ final }) {
  const c = loadConfig();
  const miss = final ? 'FAIL' : 'TODO';
  const { PDFDocument } = require('pdf-lib');

  for (const d of c.documents) {
    const f = join(c.out_dir, fileName(c, d.kind, 'pdf'));
    if (!existsSync(f)) { record(A, `${d.kind} PDF`, miss, `없음: ${f}`); continue; }
    const pdf = await PDFDocument.load(readFileSync(f), { ignoreEncryption: true });
    const pages = pdf.getPages();
    // 세로 A4 여야 한다: 한컴 PDF 저장은 양식의 인쇄 설정(모아 찍기)을 따라 가로 한 장에 두 쪽을 담기도 한다 (실측: 안내서 원본 PrintMethod=4)
    const a4 = pages.every((p) => {
      const { width, height } = p.getSize();
      const [w, h] = p.getRotation().angle % 180 ? [height, width] : [width, height];
      return Math.abs(w - 595.3) < 4 && Math.abs(h - 841.9) < 4;
    });
    const inRange = pages.length >= d.pages[0] && pages.length <= d.pages[1];
    record(A, `${d.kind} 쪽수 ${d.pages[0]}~${d.pages[1]}쪽`, inRange ? 'PASS' : 'FAIL', `${pages.length}쪽`);
    record(A, `${d.kind} 세로 A4 (모아 찍기 아님)`, a4 ? 'PASS' : 'FAIL', a4 ? '' : pages.map((p) => { const s = p.getSize(); return `${Math.round(s.width)}×${Math.round(s.height)}`; }).join(', '));
    const text = readPdfText(f);
    if (!text) { record(A, `${d.kind} 글 읽기`, 'FAIL', 'kordoc 으로 글을 읽지 못함 (그림으로만 된 PDF?)'); continue; }
    const lost = d.must.filter((k) => !text.replace(/\s+/g, '').includes(k.replace(/\s+/g, '')));
    record(A, `${d.kind} 양식 항목 빠짐없음`, lost.length ? 'FAIL' : 'PASS', lost.length ? `없음: ${lost.join(', ')}` : `${d.must.length}개`);
    hygiene(`${d.kind} PDF`, text, c);
    if (d.kind === '참가신청서') {
      const link = /https:\/\/gitlab\.aigov\.go\.kr\/[\w.-]+\/[\w.-]+/.exec(text)?.[0];
      record(A, '참가신청서 GitLab 링크', link && !/AILab_Manager\/central_budget/.test(link) ? 'PASS' : 'FAIL', link ?? '링크 없음 (예시 링크 그대로면 안 됨)');
    }
  }

  const video = join(c.out_dir, fileName(c, '시연영상', 'mp4'));
  if (!existsSync(video)) record(A, '시연영상 mp4', miss, `없음: ${video}`);
  else {
    const sec = mp4Seconds(video);
    record(A, '시연영상 5분 이내', sec != null && sec <= c.video_max_sec ? 'PASS' : 'FAIL', sec == null ? '길이를 읽지 못함' : `${Math.floor(sec / 60)}분 ${Math.round(sec % 60)}초 · ${(statSync(video).size / 1024 / 1024).toFixed(0)}MB`);
  }

  // README — GitLab 에서 심사위원·AI 심사가 가장 먼저 읽는다 (안내서: 접속 주소·주요 기능·실행·작동 방법)
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const noSection = c.readme_must.filter((r) => !new RegExp(r).test(readme));
  record(A, 'README 필수 내용', noSection.length ? 'FAIL' : 'PASS', noSection.length ? `없음: ${noSection.join(', ')}` : '');
  hygiene('README', readme, c);

  checklist(final);
}

/** 줄표·금지어·남은 자리표시 */
function hygiene(where, text, c) {
  const dash = (text.match(/[—–]/g) ?? []).length;
  record(A, `${where} 줄표(— –) 없음`, dash ? 'FAIL' : 'PASS', dash ? `${dash}곳` : '');
  const banned = c.banned.filter((w) => text.includes(w));
  record(A, `${where} 금지어 없음`, banned.length ? 'FAIL' : 'PASS', banned.join(', '));
  const holes = [...(text.match(/○○|TODO|XXX|Ex\)/g) ?? []), ...c.leftovers.filter((w) => text.includes(w))];
  record(A, `${where} 남은 자리표시·양식 안내 문구 없음`, holes.length ? 'FAIL' : 'PASS', holes.length ? [...new Set(holes)].join(' / ') : '');
}

function readPdfText(f) {
  const cli = join(SIDECAR, 'node_modules', 'kordoc', 'dist', 'cli.js');
  const r = spawnSync(process.execPath, [cli, f], { encoding: 'utf-8', maxBuffer: 1 << 26, timeout: 120_000 });
  return (r.stdout ?? '').trim();
}

/** mp4 의 mvhd 상자에서 길이(초) */
function mp4Seconds(f) {
  const b = readFileSync(f);
  const i = b.indexOf('mvhd');
  if (i < 0) return null;
  const v = b[i + 4];
  return v === 1 ? Number(b.readBigUInt64BE(i + 28)) / b.readUInt32BE(i + 24) : b.readUInt32BE(i + 20) / b.readUInt32BE(i + 16);
}

function checklist(final) {
  const p = join(ROOT, 'docs', 'contest', 'checklist.md');
  const lines = readFileSync(p, 'utf-8').split(/\r?\n/);
  const todo = lines.filter((l) => /^\s*- \[ \]/.test(l)).map((l) => l.replace(/^\s*- \[ \]\s*/, ''));
  const done = lines.filter((l) => /^\s*- \[x\]/i.test(l)).length;
  for (const t of todo) record('사람', t, final ? 'FAIL' : 'TODO');
  record('사람', `체크리스트 ${done}/${done + todo.length}`, todo.length ? (final ? 'FAIL' : 'TODO') : 'PASS');
}
