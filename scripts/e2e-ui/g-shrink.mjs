/**
 * PDF 용량 줄이기 화면 검증 — 결재 첨부 한도
 *  - 문서 화면: PDF 를 열면 "이 문서로 할 수 있는 일" 첫째가 용량 줄이기 → 강하게 → 줄기 전·후 크기
 *  - 서무 도구 › PDF 용량 줄이기: 한도 직접 입력 → 파일 둘 → 행마다 줄기 전·후 크기, 원본은 그대로
 *  - 외톨이 줄·화면 오류
 *
 * 사용: node scripts/e2e-ui/g-shrink.mjs --relay http://127.0.0.1:7727 --out <스크린샷·작업 폴더>
 *   중계기: node scripts/dev-relay.mjs --port 7727 --data <임시 폴더>
 *   사진이 든 시험 PDF 는 작업 폴더 안에 만든다(잡음 사진이라 잘 안 줄어드는 크기)
 */
import { createRequire } from 'node:module';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openUi, ROOT, sleep } from './ui-lib.mjs';

const require = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
const sharp = require('sharp');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg('--relay', 'http://127.0.0.1:7727');
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const IN = join(OUT, 'fixtures');
mkdirSync(IN, { recursive: true });

async function photoPdf(name, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const w = 2600, h = 1900, px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < px.length; i++) px[i] = ((i + p * 7919) * 2654435761) >>> 24;
    const jpg = await doc.embedJpg(await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer());
    const page = doc.addPage([595, 842]);
    page.drawText(`Attachment page ${p + 1}`, { x: 50, y: 800, size: 14, font });
    page.drawImage(jpg, { x: 50, y: 300, width: 495, height: 362 });
  }
  const path = join(IN, name);
  writeFileSync(path, await doc.save());
  return path;
}

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };
const A = await photoPdf('사진첨부.pdf', 2);
const B = await photoPdf('현장사진.pdf', 3);
const sizes = [A, B].map((p) => statSync(p).size);

const ui = await openUi({ relay: RELAY, width: 1280, height: 800, prefs: { 'kordoc-first-run-done': true } });
const { page } = ui;
try {
  await sleep(1500);
  await fetch(`${RELAY}/emit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'open-files', payload: [A] }) });
  await ui.waitText('이 문서로 할 수 있는 일', 30000);
  const next = await page.evaluate(() => [...document.querySelectorAll('.kd-next-btn')].map((b) => b.textContent));
  check('PDF 의 할 수 있는 일 첫째가 용량 줄이기', next[0] === '용량 줄이기', next.join(','));
  await ui.click('용량 줄이기', { exact: true });
  await sleep(600);
  await ui.click('강하게', { exact: true });
  await page.evaluate(() => [...document.querySelectorAll('[data-tool="shrink"] button')].find((b) => b.textContent.includes('용량 줄이기'))?.click());
  await ui.waitText('용량을 줄인 PDF를 저장했습니다', 120000);
  const msg = await page.evaluate(() => document.querySelector('[data-tool="shrink"] .kd-note')?.textContent ?? '');
  check('문서 화면: 줄기 전·후 크기와 줄인 비율', /MB → .+줄임/.test(msg), msg);
  await ui.shot(join(OUT, '01-tool.png'));

  await page.evaluate(() => document.querySelector('.kd-nav-item[data-screen="batch"]')?.click());
  await sleep(800);
  await ui.click('PDF 용량 줄이기');
  await ui.dialog([[A, B]]);
  await ui.click('파일 추가');
  await sleep(1200);
  await ui.click('직접', { exact: true });
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="첨부 한도(MB)"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '1');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const rasterShown = await page.evaluate(() => document.body.innerText.includes('쪽을 그림으로 바꿔서라도 줄이기'));
  check('한도를 정하면 쪽을 그림으로 고르는 칸이 보인다', rasterShown);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^시작/.test(b.textContent.trim()))?.click());
  await ui.waitText('개 완료', 180000);
  await sleep(600);
  const rows = await page.evaluate(() => document.body.innerText.match(/\d+(\.\d+)?(MB|KB) → [^\n]+/g) ?? []);
  check('서무 도구: 두 파일 모두 줄기 전·후 크기', rows.length >= 2, rows.join(' | '));
  check('원본 파일은 그대로', [A, B].every((p, i) => statSync(p).size === sizes[i]));
  await ui.shot(join(OUT, '02-batch.png'));
  const o = await ui.orphans();
  check('외톨이 줄 없음', o.length === 0, JSON.stringify(o));
  check('화면 오류 없음', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
} finally {
  await ui.browser.close();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} 통과`);
writeFileSync(join(OUT, 'g-shrink.json'), JSON.stringify(checks, null, 2));

process.exit(failed ? 1 : 0);
