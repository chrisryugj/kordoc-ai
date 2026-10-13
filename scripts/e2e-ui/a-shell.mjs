/**
 * A 영역 화면 검증 — 메뉴(업무 말)·오늘·첫 실행·설정(저장 안 함·고급)·비교.
 *   node scripts/e2e-ui/a-shell.mjs --relay http://127.0.0.1:7721 --out <스크린샷 폴더>
 * 중계기는 빈 데이터 폴더로 띄운다 (첫 실행 마법사부터 본다).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openUi, SAMPLES, sleep } from './ui-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg('--relay', 'http://127.0.0.1:7721');
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
mkdirSync(OUT, { recursive: true });
const LETTER = join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.hwpx');
const LETTER_PDF = join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.pdf');

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

const ui = await openUi({ relay: RELAY, width: 1280, height: 800, prefs: { 'kordoc-nav-collapsed': false } });
const { page } = ui;
try {
  // ── 첫 실행: AI 는 나중에 → 설정의 AI 연결 구획으로
  await ui.waitText('처음 오셨네요', 30000);
  await page.type('.kd-wizard input', '가온시');
  await ui.click('다음', { exact: true });
  await ui.click('AI는 나중에 정하기');
  await ui.shot(join(OUT, '01-wizard-done.png'));
  await ui.click('저장하고 시작');
  await sleep(1500);
  const landed = await page.evaluate(() => {
    const cur = document.querySelector('.kd-settings-index [aria-current="true"]')?.textContent ?? '';
    const sec = document.getElementById('set-ai');
    const root = document.querySelector('.kd-settings-scroll');
    const gap = sec && root ? Math.round(sec.getBoundingClientRect().top - root.getBoundingClientRect().top) : null;
    return { cur, gap, screen: document.querySelector('.kd-nav-item[aria-current="page"]')?.getAttribute('data-screen') };
  });
  check('첫 실행 끝 → 설정 AI 연결 구획', landed.screen === 'settings' && landed.cur.includes('AI 연결') && landed.gap != null && Math.abs(landed.gap) < 40, JSON.stringify(landed));
  await ui.shot(join(OUT, '02-settings-ai.png'));

  // ── 설정: 기술 용어는 고급 접기 안에만
  const visibleTech = await page.evaluate(() => {
    const body = document.querySelector('.kd-settings-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const hits = [];
    const re = /토큰|GGUF|\.gguf|GPU|MCP|OpenAI 방식|\bOC\b|Node |darwin|THIRD_PARTY|det\.onnx/;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest('details:not([open])') || el.closest('[hidden]') || el.offsetParent === null) continue;
      if (re.test(n.textContent)) hits.push(n.textContent.trim().slice(0, 60));
    }
    return hits;
  });
  check('설정 펼친 화면에 기술 용어 없음 (고급 안에만)', visibleTech.length === 0, visibleTech.join(' | '));

  // ── 설정: 저장 안 한 변경 표시 + 떠날 때 묻기
  await ui.click('내 기관 정보', { within: '.kd-settings-index' });
  await sleep(600);
  const dept = await page.$('#set-org input[placeholder="예: 총무과"]');
  await dept.type('총무과');
  await sleep(300);
  const marks = await page.evaluate(() => ({
    dot: !!document.querySelector('.kd-settings-index .kd-index-dirty'),
    badge: document.querySelector('#set-org .kd-section-head')?.textContent.includes('저장 안 함'),
  }));
  check('고친 구획: 목차 점 + 제목 옆 "저장 안 함"', marks.dot && marks.badge, JSON.stringify(marks));
  await ui.shot(join(OUT, '03-settings-dirty.png'));
  await page.click('.kd-nav-item[data-screen="home"]');
  await sleep(400);
  const modal = await page.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? '');
  check('저장 안 하고 떠나면 묻기', modal.includes('저장하지 않은 설정') && modal.includes('내 기관 정보'), modal.replace(/\n/g, ' / '));
  await ui.shot(join(OUT, '04-settings-leave.png'));
  await ui.click('저장하고 나가기');
  await sleep(1200);
  const after = await page.evaluate(() => document.querySelector('.kd-nav-item[aria-current="page"]')?.getAttribute('data-screen'));
  const saved = await ui.call('get_settings');
  check('저장하고 나가기 → 저장 + 오늘 화면', after === 'home' && saved.org.dept === '총무과', `${after} / ${saved.org.dept}`);

  // ── 메뉴: 업무 말, 비교는 메뉴에서 빠짐, 화면 id 그대로
  const nav = await page.evaluate(() => [...document.querySelectorAll('.kd-nav-item')].map((b) => `${b.dataset.screen}:${b.querySelector('.kd-nav-title')?.textContent}`));
  check('메뉴 이름 (오늘·접수함·문서·새로 쓰기·서무 도구·물어보기·설정)', nav.join(',') === 'home:오늘,inbox:접수함,workbench:문서,create:새로 쓰기,batch:서무 도구,assistant:물어보기,settings:설정', nav.join(','));

  // ── 오늘: 처리 0건이면 효과 줄 숨김, 기한 임박 공문
  check('처리 0건이면 "이번 달 처리" 줄 없음', !(await page.evaluate(() => !!document.querySelector('.kd-impact-line'))));
  const added = await ui.call('inbox_add', { paths: [LETTER] });
  await ui.call('inbox_update', { id: added.items[0].id, due: '2026-10-15' });
  await page.click('.kd-nav-item[data-screen="inbox"]');
  await sleep(300);
  await page.click('.kd-nav-item[data-screen="home"]');
  await ui.waitText('기한이 다가온 공문');
  const due = await page.evaluate(() => [...document.querySelectorAll('[aria-labelledby="due-t"] .kd-row')].map((r) => r.innerText.replace(/\n/g, ' ')));
  check('오늘: 기한 임박 공문 (최대 3)', due.length >= 1 && due.length <= 3 && /D-\d/.test(due[0]), due.join(' | '));
  const groups = await page.evaluate(() => [...document.querySelectorAll('.kd-index-title')].map((h) => h.textContent));
  check('업무별 목차 (접수·회신/쓰기/검토/서무 도구/묻기)', groups.join('/') === '접수·회신/쓰기/검토/서무 도구/묻기', groups.join('/'));
  const firstCol = await page.evaluate(() => document.querySelector('.kd-index-col')?.innerText ?? '');
  check('받은 공문 기한 정리가 접수·회신에', firstCol.includes('받은 공문 기한 정리'));
  await ui.shot(join(OUT, '05-home-1280.png'));
  await page.setViewport({ width: 1024, height: 768 });
  await sleep(400);
  await ui.shot(join(OUT, '06-home-1024.png'));
  const orphHome = await ui.orphans();
  check('오늘 화면 외톨이 줄 없음 (1024)', orphHome.length === 0, JSON.stringify(orphHome));
  await page.setViewport({ width: 1280, height: 800 });

  // ── 접힌 메뉴: 상태 아이콘 아래 짧은 글
  await page.click('.kd-nav-foot .kd-icon-btn');
  await sleep(400);
  const stat = await page.evaluate(() => [...document.querySelectorAll('.kd-nav-stat')].map((b) => b.innerText.trim()));
  check('접힌 메뉴 상태 아이콘에 짧은 이름', stat.length === 2 && stat.every(Boolean), stat.join(','));
  await ui.shot(join(OUT, '07-nav-collapsed.png'));
  await page.click('.kd-nav-foot .kd-icon-btn');
  await sleep(300);

  // ── 비교: 오늘 목차에서 들어가기, 지원 형식만, 파일 이름만, 한국어 오류
  const dialogFilters = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const body = req.postData();
    if (body && body.includes('plugin:dialog|open')) { try { dialogFilters.push(JSON.parse(body).args?.options?.filters); } catch { /* */ } }
    req.continue();
  });
  await ui.click('신구대조표 만들기');
  await ui.waitText('두 문서를 넣고 비교하기를 누르세요');
  await ui.dialog([[LETTER_PDF]]);
  await ui.click('파일 고르기', { within: '[data-drop="compare-old"]' });
  await sleep(500);
  const ext = (dialogFilters[0]?.[0]?.extensions ?? []).join(',');
  check('비교 파일 고르기는 지원 형식만', ext && !/txt|md|csv|png/.test(ext) && ext.includes('hwpx'), ext);
  const broken = join(OUT, '깨진 문서.hwpx');
  writeFileSync(broken, 'not a zip');
  await ui.dialog([[broken]]);
  await ui.click('파일 고르기', { within: '[data-drop="compare-new"]' });
  await sleep(400);
  await ui.click('비교하기', { exact: true });
  await sleep(2500);
  const errText = await page.evaluate(() => [...document.querySelectorAll('.kd-note[data-tone="err"]')].map((n) => n.innerText).join(' | '));
  check('비교 오류는 "새 문서를 읽지 못했습니다"', errText.includes('새 문서를 읽지 못했습니다') && !/문서B|파싱/.test(errText), errText);
  const slotText = await page.evaluate(() => document.querySelector('[data-drop="compare-old"]')?.innerText ?? '');
  check('비교 칸은 파일 이름만 (폴더 경로 없음)', !slotText.includes('/'), slotText.replace(/\n/g, ' '));
  await ui.dialog([[LETTER]]);
  await ui.click('바꾸기', { within: '[data-drop="compare-new"]' });
  await sleep(300);
  await ui.click('비교하기', { exact: true });
  await ui.waitText('바뀜 ', 30000);
  await ui.shot(join(OUT, '08-compare-light.png'));
  await ui.clearDialog();

  // ── 설정 다시: 고급 펼침·외톨이 줄 (1280·1024), 저장하지 않고 나가기
  await page.click('.kd-nav-item[data-screen="settings"]');
  await sleep(500);
  await ui.click('기관 AI 서버나 Ollama');
  await page.evaluate(() => document.querySelectorAll('.kd-settings-body details').forEach((d) => { d.open = true; }));
  await sleep(300);
  for (const [w, h] of [[1280, 800], [1024, 768]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(400);
    const o = await ui.orphans('.kd-settings-body p, .kd-settings-body .kd-row-desc, .kd-settings-body .kd-field-hint, .kd-settings-body .kd-small, .kd-settings-body li');
    check(`설정 외톨이 줄 없음 (${w}, 고급 펼침)`, o.length === 0, JSON.stringify(o));
    await page.evaluate(() => document.getElementById('set-ai')?.scrollIntoView());
    await ui.shot(join(OUT, `09-settings-ai-advanced-${w}.png`));
  }
  await page.setViewport({ width: 1280, height: 800 });
  const aiDirty = await page.evaluate(() => document.querySelector('#set-ai .kd-section-head')?.textContent.includes('저장 안 함'));
  check('AI 연결 갈래만 바꿔도 "저장 안 함"', aiDirty);
  await page.click('.kd-nav-item[data-screen="inbox"]');
  await sleep(400);
  await ui.click('저장하지 않고 나가기');
  await sleep(600);
  const s2 = await ui.call('get_settings');
  const now = await page.evaluate(() => document.querySelector('.kd-nav-item[aria-current="page"]')?.getAttribute('data-screen'));
  check('저장하지 않고 나가기 → 저장 안 됨 + 접수함', now === 'inbox' && s2.ai.provider === 'none', `${now} / ${s2.ai.provider}`);
  await page.click('.kd-nav-item[data-screen="settings"]');
  await sleep(400);
  const cleared = await page.evaluate(() => !document.querySelector('.kd-settings-index .kd-index-dirty'));
  check('나간 뒤 고친 것은 되돌려져 표시 없음', cleared);
  check('화면 오류 없음', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
} catch (e) {
  check('시나리오 끝까지', false, String(e));
  await ui.shot(join(OUT, 'zz-fail.png')).catch(() => {});
} finally {
  await ui.clearDialog().catch(() => {});
  await ui.close();
}
writeFileSync(join(OUT, 'a-shell.json'), JSON.stringify(checks, null, 2));
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} 통과`);
process.exit(failed ? 1 : 0);
