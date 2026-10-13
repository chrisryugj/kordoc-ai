/**
 * F 영역 화면 검증 — 공문에 인용한 법조문 검증기: 검토 탭(결재 전 한 번에 점검 목록 + 인용한 법령 자세히)과 접수함(인용 법령 확인).
 * 가짜 법제처(node-sidecar/tests/law-fake-drf.mjs)로 돌린다. 실제 법제처·아이디(OC)는 쓰지 않는다.
 *
 *   1) 가짜 법제처를 띄울 포트를 정하고(기본 7736), 중계기를 그 주소로 띄운다
 *      KORDOC_LAW_BASE=http://127.0.0.1:7736/DRF/ node scripts/dev-relay.mjs --port 7726 --data <임시 폴더>
 *   2) node scripts/e2e-ui/f-law.mjs --relay http://127.0.0.1:7726 --drf-port 7736 --out <스크린샷 폴더>
 *
 * 견본 공문(맞는 인용·개정됨·지금은 삭제된 항·없는 항·목·그 뒤 생긴 조문·내용 어긋남·이름 바뀜·없는 조문)은 --out/docs 에 HWPX 로 만든다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openUi, ROOT, sleep } from './ui-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg('--relay', 'http://127.0.0.1:7726');
const DRF_PORT = Number(arg('--drf-port', '7736'));
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DOCS = join(OUT, 'docs');
mkdirSync(DOCS, { recursive: true });

const { startFakeDrf, SAMPLE_GONGMUN } = await import(pathToFileURL(join(ROOT, 'node-sidecar/tests/law-fake-drf.mjs')).href);
const drf = await startFakeDrf({ port: DRF_PORT });
console.log(`가짜 법제처 ${drf.base}`);

const req = createRequire(join(ROOT, 'node-sidecar/package.json'));
const { markdownToHwpx } = await import(pathToFileURL(req.resolve('kordoc')).href);
const SAMPLE = join(DOCS, '인용법령_예시.hwpx');
writeFileSync(SAMPLE, Buffer.from(await markdownToHwpx(SAMPLE_GONGMUN.split('\n').filter(Boolean).join('\n\n'))));

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };
const DASH = /[—–]/;
const BADGES = ['맞음', '확인 필요', '항 없음', '조문 없음', '이름 바뀜', '개정됨', '그 뒤 생김', '그 뒤 삭제'];

const call = async (method, params) => {
  const r = await (await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method, params } }) })).json();
  if (!r.ok) throw new Error(r.error);
  return r.result;
};
const settings = (s) => call('update_settings', { settings: s });

async function run(width, height) {
  const tag = String(width);
  await settings({ law: { oc: 'fake-oc' }, privacy: { offline: false }, ai: { provider: 'none' } });
  const ui = await openUi({ relay: RELAY, width, height, prefs: { 'kordoc-first-run-done': true, 'kordoc-nav-collapsed': width < 1200, 'kordoc-theme': 'light' } });
  const { page } = ui;
  const ws = '.kd-docws:not([hidden])';
  const review = `${ws} [data-tool="review"]`;
  try {
    // ── 검토 탭: 결재 전 한 번에 점검 ──
    await ui.dialog([[SAMPLE]]);
    await page.click('.kd-nav-item[data-screen="workbench"]');
    await sleep(200);
    await ui.click('문서 열기', { within: '.kd-screen:not([hidden]) .kd-head' });
    await page.waitForFunction((s) => document.querySelector(`${s} .kd-tools`), { timeout: 30000 }, ws);
    await sleep(2000);
    await page.evaluate((s) => [...document.querySelectorAll(`${s} [role=tab]`)].find((t) => t.textContent === '검토')?.click(), ws);
    await sleep(500);
    await ui.click('결재 전 한 번에 점검', { within: review });
    await ui.waitText('점검 결과', 30000);
    await page.waitForFunction((s) => /법령 근거: /.test(document.querySelector(s)?.innerText ?? ''), { timeout: 30000 }, review);
    await sleep(800);
    const list = await page.evaluate((s) => [...document.querySelectorAll(`${s} [aria-label="점검 결과 목록"] .kd-finding`)].map((e) => e.innerText), review);
    const lawList = list.filter((x) => x.includes('법령 근거'));
    check(`[${tag}] 점검 목록에 법령 근거 지적`, lawList.length >= 6, `${lawList.length}건`);
    for (const want of ['제17조에 제5항이 없습니다', '제17조제3항은 삭제된 항입니다', '이후 개정되었습니다(현행과 다름)', '당시에는 없던 조문입니다', '같은 낱말이 없습니다', '「가온 새이름법」으로 바뀌었습니다', '제99조가 없습니다']) {
      check(`[${tag}] 목록: ${want}`, lawList.some((x) => x.includes(want)));
    }
    await ui.shot(join(OUT, `f-${tag}-01-precheck.png`));

    // 인용한 법령 자세히 → 배지·이유·확인한 것·나란히 보기
    await ui.click('인용한 법령', { within: review });
    await sleep(300);
    const detail = await page.evaluate((s) => document.querySelector(`${s} [data-testid="law-detail"]`)?.innerText ?? '', review);
    const badges = await page.evaluate((s) => [...document.querySelectorAll(`${s} [data-testid="law-detail"] .kd-badge`)].map((b) => b.textContent), review);
    for (const b of BADGES) check(`[${tag}] 배지 ${b}`, badges.includes(b));
    check(`[${tag}] 확인한 것에 공문 시행일 당시 비교`, detail.includes('공문 시행일(2026. 3. 2.) 당시 조문과 현행 비교'));
    check(`[${tag}] AI 없을 때 못 본 것을 밝힘`, detail.includes('AI가 연결되어 있지 않아 낱말 비교만 했습니다'));
    check(`[${tag}] 인용 문장이 보임`, detail.includes('공문 문장: 같은 법 제17조 제1항 제2호에 따라 법령상 의무를'));
    check(`[${tag}] 줄표 없음`, !DASH.test(detail));
    // 개정된 인용의 나란히 보기를 펼친다
    await page.evaluate((s) => {
      const li = [...document.querySelectorAll(`${s} [data-testid="law-detail"] .kd-finding`)].find((x) => x.innerText.includes('개정됨'));
      li?.querySelector('details.kd-law-src')?.setAttribute('open', '');
      li?.scrollIntoView({ block: 'start' });
    }, review);
    await sleep(300);
    const amended = await page.evaluate((s) => [...document.querySelectorAll(`${s} [data-testid="law-detail"] .kd-finding`)].find((x) => x.innerText.includes('개정됨'))?.innerText ?? '', review);
    check(`[${tag}] 나란히: 현행 원문`, amended.includes('법제처 현행 원문 (제17조제1항제2호 개인정보의 제공)') && amended.includes('2. 법률에 특별한 규정이 있는 경우'));
    check(`[${tag}] 나란히: 그 당시 원문과 차이`, amended.includes('그 당시 원문') && amended.includes('빠진 말: 있거나 법령상 의무를 준수하기 위하여 불가피한') && amended.includes('더해진 말: 있는'));
    await ui.shot(join(OUT, `f-${tag}-02-side-by-side.png`));
    // 접힌 자리(닫힌 details 안)는 보이지 않으니 뺀다
    const shown = (sel) => sel.split(', ').map((x) => `${x}:not(details:not([open]) > :not(summary) *, details:not([open]) > :not(summary))`).join(', ');
    const orph = await ui.orphans(shown(`${review} p, ${review} .kd-small, ${review} .kd-note, ${review} .kd-text, ${review} .kd-law-text`));
    check(`[${tag}] 검토 탭 외톨이 줄 없음`, orph.length === 0, JSON.stringify(orph));

    // ── 접수함: 인용 법령 확인 (누를 때만) ──
    const asked0 = drf.requests.length;
    const added = await call('inbox_add', { paths: [SAMPLE] });
    check(`[${tag}] 접수함에 넣을 때는 법제처에 묻지 않음`, drf.requests.length === asked0);
    await page.click('.kd-nav-item[data-screen="inbox"]');
    await sleep(800);
    const id = added.items[0].id;
    const open = await page.evaluate((i) => document.querySelector(`[aria-controls="inbox-${i}"]`)?.getAttribute('aria-expanded'), id);
    if (open !== 'true') await page.click(`[aria-controls="inbox-${id}"]`);
    await sleep(400);
    await ui.click('인용 법령 확인', { within: `#inbox-${id}` });
    await page.waitForFunction((i) => document.querySelector(`#inbox-${i} .kd-inbox-law .kd-findings`), { timeout: 30000 }, id);
    await sleep(300);
    const inbox = await page.evaluate((i) => document.querySelector(`#inbox-${i} .kd-inbox-law`).innerText, id);
    const ibadges = await page.evaluate((i) => [...document.querySelectorAll(`#inbox-${i} .kd-inbox-law .kd-badge`)].map((b) => b.textContent), id);
    check(`[${tag}] 접수함: 공문 시행일 안내`, inbox.includes('공문 시행일(3. 2.(월)) 당시 조문과 지금 조문도 견줍니다'), inbox.slice(0, 120));
    for (const b of ['맞음', '항 없음', '개정됨', '그 뒤 생김', '이름 바뀜']) check(`[${tag}] 접수함 배지 ${b}`, ibadges.includes(b));
    // 개정된 인용을 펼쳐 공문 문장과 법제처 원문을 나란히 (넓은 자리에서는 두 칸)
    const cols = await page.evaluate((i) => {
      const li = [...document.querySelectorAll(`#inbox-${i} .kd-inbox-law .kd-finding`)].find((x) => x.innerText.includes('개정됨'));
      li?.querySelector('details.kd-law-src')?.setAttribute('open', '');
      li?.scrollIntoView({ block: 'start' });
      const g = li?.querySelector('.kd-law-grid');
      return g ? getComputedStyle(g).gridTemplateColumns.split(' ').filter((w) => parseFloat(w) > 0).length : 0; // auto-fit 빈 칸은 0px
    }, id);
    check(`[${tag}] 접수함: 공문 문장과 원문 두 칸 나란히`, cols === 2, `${cols}칸`);
    await sleep(200);
    await ui.shot(join(OUT, `f-${tag}-03-inbox.png`));
    const orph2 = await ui.orphans(shown(`#inbox-${id} .kd-inbox-law p, #inbox-${id} .kd-inbox-law .kd-small, #inbox-${id} .kd-inbox-law .kd-text`));
    check(`[${tag}] 접수함 외톨이 줄 없음`, orph2.length === 0, JSON.stringify(orph2));

    // ── 폐쇄망: 확인 못 한 것을 밝힘 ──
    await settings({ privacy: { offline: true } });
    const asked1 = drf.requests.length;
    await ui.click('인용 법령 확인', { within: `#inbox-${id}` });
    await page.waitForFunction((i) => /확인 못 함/.test(document.querySelector(`#inbox-${i} .kd-inbox-law`)?.innerText ?? ''), { timeout: 30000 }, id);
    await sleep(300);
    const off = await page.evaluate((i) => document.querySelector(`#inbox-${i} .kd-inbox-law`).innerText, id);
    check(`[${tag}] 폐쇄망: 법제처에 묻지 않음`, drf.requests.length === asked1);
    check(`[${tag}] 폐쇄망: 안내와 못 본 것`, off.includes('폐쇄망 모드라 법제처에 묻지 않았습니다') && off.includes('확인 못 한 것: 인용 문장과 조문 내용: 법제처 원문을 받지 못해 비교하지 않았습니다'));
    await page.evaluate((i) => document.querySelector(`#inbox-${i} .kd-inbox-law`)?.scrollIntoView({ block: 'start' }), id);
    await ui.shot(join(OUT, `f-${tag}-04-offline.png`));
    await settings({ privacy: { offline: false } });
    await call('inbox_remove', { id });
    check(`[${tag}] 화면 오류 없음`, ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
  } finally {
    await ui.close();
  }
}

try {
  await run(1280, 860);
  await run(1024, 768);
} finally {
  await drf.close();
}
const fail = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - fail.length}/${checks.length} 통과`);
process.exit(fail.length ? 1 : 0);
