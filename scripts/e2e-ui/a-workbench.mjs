/**
 * A 영역 화면 검증 — 문서(작업대) 도구 탭 넷·회신 단추·정보 일치·내보내기(글만·인쇄)·글 보기·메신저용 복사·비교 어두운 화면.
 *   node scripts/e2e-ui/a-workbench.mjs --relay http://127.0.0.1:7721 --out <스크린샷 폴더>
 * 첫 실행 마법사는 건너뛴다(화면 기억값). 저장은 --out/out 으로 (samples 에 쓰지 않는다). 인쇄는 가로채 실제로 보내지 않는다.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg('--relay', 'http://127.0.0.1:7721');
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const SAVE = join(OUT, 'out');
mkdirSync(SAVE, { recursive: true });
const LETTER = join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.hwpx');
const LETTER_PDF = join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.pdf');
const REPORT = join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx');

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

async function run(width, height, dark) {
  // 저장 폴더는 화면을 열기 전에 (앱이 처음 읽는 설정에 들어가야 samples 옆에 쓰지 않는다)
  await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method: 'update_settings', params: { settings: { org: { name: '가온시', person: '김가온' }, convert: { output_dir: SAVE } } } } }) });
  const ui = await openUi({ relay: RELAY, width, height, dark, prefs: { 'kordoc-first-run-done': true, 'kordoc-nav-collapsed': width < 1200, 'kordoc-theme': dark ? 'dark' : 'light' } });
  const { page } = ui;
  const tag = `${width}${dark ? '-dark' : ''}`;
  // 인쇄는 실제로 보내지 않는다 (중계기 호출을 가로채 성공으로)
  let printed = null;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const body = req.postData();
    // 프린터가 없는 PC 에서도 인쇄 흐름을 본다 (목록을 가짜로)
    if (body && body.includes('"list_printers"')) {
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, result: [{ name: '사무실 복합기', isDefault: true, status: 'ready' }, { name: '3층 프린터', isDefault: false, status: 'ready' }] }) });
    }
    if (body && body.includes('"print_files"')) {
      printed = JSON.parse(body).args.params;
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, result: { queued: 1, jobIds: ['e2e-1'], failed: [] } }) });
    }
    req.continue();
  });
  const openDoc = async (path) => {
    await ui.dialog([[path]]);
    await page.click('.kd-nav-item[data-screen="workbench"]');
    await sleep(200);
    await ui.click('문서 열기', { within: '.kd-screen:not([hidden]) .kd-head' });
    await page.waitForFunction(() => document.querySelector('.kd-docws:not([hidden]) .kd-tools'), { timeout: 30000 });
    await sleep(2500);
  };
  const tab = async (label) => { await page.evaluate((l) => [...document.querySelectorAll('.kd-docws:not([hidden]) [role=tab]')].find((t) => t.textContent === l)?.click(), label); await sleep(500); };
  try {
    // ── 받은 공문 HWPX
    await openDoc(LETTER);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.kd-docws:not([hidden]) [role=tab]')].map((t) => ({ t: t.textContent, top: t.getBoundingClientRect().top, off: t.disabled })));
    check(`[${tag}] 도구 탭 넷, 한 줄`, tabs.map((x) => x.t).join('/') === '읽기/고치기/검토/내보내기' && new Set(tabs.map((x) => Math.round(x.top))).size === 1, JSON.stringify(tabs));
    const replies = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && b.textContent.includes('회신 쓰기')).map((b) => `${b.textContent.trim()}|${b.className}`));
    check(`[${tag}] 받은 공문: 회신 단추는 머리에 주 단추 하나`, replies.length === 1 && replies[0].startsWith('이 공문에 회신 쓰기') && !/secondary/.test(replies[0]), replies.join(' / '));
    const info = await page.evaluate(() => {
      const ws = document.querySelector('.kd-docws:not([hidden])');
      const dl = Object.fromEntries([...ws.querySelectorAll('.kd-dl > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]));
      return {
        dl,
        head: document.querySelector('.kd-screen:not([hidden]) .kd-head-sub')?.textContent ?? '',
        list: document.querySelector('.kd-docitem[aria-current="true"] .kd-row-desc')?.textContent ?? '',
        viewer: ws.querySelector('.kd-toolbar .kd-num')?.textContent ?? '',
        sections: [...ws.querySelectorAll('.kd-tool-body > div:not([hidden]) .kd-tool-sec-h')].map((h) => h.textContent),
        follow: ws.querySelector('[data-tool="info"]')?.innerText.includes('접수함에 넣기'),
        aiFollow: ws.querySelector('[data-tool="ai"]')?.innerText.includes('이 공문으로 이어서'),
      };
    });
    const pages = info.dl['쪽수'];
    const n = (s) => (s.match(/(\d+)쪽/) ?? [])[1];
    check(`[${tag}] 쪽수 하나로 (머리·목록·정보·미리보기)`, pages && [info.head, info.list, info.viewer].every((s) => n(s) === n(pages)), JSON.stringify({ pages, head: info.head, list: info.list, viewer: info.viewer }));
    check(`[${tag}] 작성자 rhwp·빈칸 숨김`, !('작성자' in info.dl) || !/rhwp/i.test(info.dl['작성자']), JSON.stringify(info.dl));
    check(`[${tag}] 읽기 탭: 정보·AI 요약·묻기·표 뽑기 소제목`, info.sections.join('/') === '정보/AI 요약·묻기/표 뽑기', info.sections.join('/'));
    check(`[${tag}] 받은 공문이면 정보에 접수함에 넣기, AI 칸에 겹친 회신 없음`, info.follow && !info.aiFollow, JSON.stringify({ follow: info.follow, aiFollow: info.aiFollow }));
    await ui.shot(join(OUT, `w-${tag}-01-letter-read.png`));
    const orph1 = await ui.orphans('.kd-tools p, .kd-tools .kd-small, .kd-tools .kd-note');
    check(`[${tag}] 읽기 탭 외톨이 줄 없음`, orph1.length === 0, JSON.stringify(orph1));

    // 글 보기: 가. 나. 항목이 따로 줄에
    await page.evaluate(() => [...document.querySelectorAll('.kd-docws:not([hidden]) .kd-seg button')].find((b) => b.textContent === '글 보기')?.click());
    await page.waitForFunction(() => document.querySelector('.kd-docws:not([hidden]) .markdown-body'), { timeout: 20000 });
    await sleep(500);
    const body = await page.evaluate(() => document.querySelector('.kd-docws:not([hidden]) .markdown-body').innerText);
    check(`[${tag}] 글 보기: 가.·나. 항목이 줄마다`, /\n\s*가\. 일시/.test(body) && /\n\s*나\. 장소/.test(body), body.slice(body.indexOf('2. 우리'), body.indexOf('2. 우리') + 160).replace(/\n/g, '⏎'));
    await ui.click('메신저용 복사', { within: '.kd-docws:not([hidden]) .kd-viewer' });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(`[${tag}] 메신저용 복사: 표시 없이`, clip.includes('10:00~17:00') && !/\\~|^#|^\|/m.test(clip), clip.slice(0, 120).replace(/\n/g, '⏎'));
    await ui.shot(join(OUT, `w-${tag}-02-letter-text.png`));

    // 내보내기: 형식 고르기 줄, 폴더 이름만, 인쇄
    await tab('내보내기');
    const seg = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.kd-docws:not([hidden]) [data-tool="export"] .kd-seg')[0].querySelectorAll('button')];
      const rows = {};
      for (const b of btns) { const t = Math.round(b.getBoundingClientRect().top); rows[t] = (rows[t] ?? 0) + 1; }
      return Object.values(rows);
    });
    check(`[${tag}] 저장 형식 고르기: 한 줄에 하나만 떨어지지 않음`, seg.length && seg.every((c) => c > 1), JSON.stringify(seg));
    const where = await page.evaluate(() => { const el = document.querySelector('.kd-docws:not([hidden]) [data-tool="export"] .kd-path'); return { text: el?.textContent, title: el?.title }; });
    check(`[${tag}] 저장할 곳은 폴더 이름만, 전체 경로는 마우스 올리면`, where.text && !where.text.includes('/') && where.title.includes('/'), JSON.stringify(where));
    await ui.click('인쇄', { exact: true, within: '.kd-docws:not([hidden]) [data-tool="print"]' });
    await ui.waitText('인쇄를 보냈습니다');
    check(`[${tag}] 내보내기 탭에서 인쇄 (HWPX, 고른 프린터)`, printed && printed.files[0] === LETTER && printed.printer === '사무실 복합기', JSON.stringify(printed));
    await ui.shot(join(OUT, `w-${tag}-03-letter-export.png`));
    const orph2 = await ui.orphans('.kd-tools p, .kd-tools .kd-small, .kd-tools .kd-note, .kd-tools .kd-field-hint');
    check(`[${tag}] 내보내기 탭 외톨이 줄 없음`, orph2.length === 0, JSON.stringify(orph2));

    // ── 보고서: 받은 공문 아님 → 회신은 보통 단추, 글만 저장
    await openDoc(REPORT);
    const replies2 = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && b.textContent.includes('회신 쓰기')).map((b) => `${b.textContent.trim()}|${b.className}`));
    check(`[${tag}] 받은 공문 아님: 회신은 보통 단추 하나`, replies2.length === 1 && replies2[0].startsWith('회신 쓰기') && /secondary/.test(replies2[0]), replies2.join(' / '));
    await tab('내보내기');
    await page.evaluate(() => [...document.querySelectorAll('.kd-docws:not([hidden]) [data-tool="export"] .kd-seg button')].find((b) => b.textContent === '글만')?.click());
    const before = new Set(readdirSync(SAVE));
    await ui.click('저장', { exact: true, within: '.kd-docws:not([hidden]) [data-tool="export"]' });
    await ui.waitText('저장했습니다');
    const txtName = readdirSync(SAVE).find((f) => !before.has(f) && f.endsWith('.txt'));
    const txt = txtName ? readFileSync(join(SAVE, txtName), 'utf-8') : '';
    check(`[${tag}] 글만(txt): 마크다운 표시 없음, 표는 탭`, txt && !/^#|^\||^>|\\[~#|]/m.test(txt) && txt.includes('과제\t10월\t11월\t12월'), txt.slice(0, 160).replace(/\n/g, '⏎'));
    await tab('고치기');
    const fixSecs = await page.evaluate(() => [...document.querySelectorAll('.kd-docws:not([hidden]) .kd-tool-body > div:not([hidden]) .kd-tool-sec-h')].map((h) => h.textContent));
    check(`[${tag}] 고치기 탭: 채우기·편집·도장`, fixSecs.join('/') === '채우기·편집/도장', fixSecs.join('/'));
    await ui.shot(join(OUT, `w-${tag}-04-report-fix.png`));
    await tab('검토');
    const revSecs = await page.evaluate(() => [...document.querySelectorAll('.kd-docws:not([hidden]) .kd-tool-body > div:not([hidden]) .kd-tool-sec-h')].map((h) => h.textContent));
    check(`[${tag}] 검토 탭: 결재 전 점검·개인정보 가리기`, revSecs.join('/') === '결재 전 점검/개인정보 가리기', revSecs.join('/'));

    // ── PDF: 고치기 탭은 꺼지고 이유, 인쇄 됨
    await openDoc(LETTER_PDF);
    const pdfTabs = await page.evaluate(() => [...document.querySelectorAll('.kd-docws:not([hidden]) [role=tab]')].map((t) => `${t.textContent}:${t.disabled ? `off(${t.title})` : 'on'}`));
    check(`[${tag}] PDF: 고치기 탭 꺼짐 + 이유`, pdfTabs.some((t) => t.startsWith('고치기:off(한글 문서')), pdfTabs.join(' / '));
    await tab('내보내기');
    printed = null;
    await ui.click('인쇄', { exact: true, within: '.kd-docws:not([hidden]) [data-tool="print"]' });
    await sleep(800);
    check(`[${tag}] 내보내기 탭에서 인쇄 (PDF)`, printed && printed.files[0] === LETTER_PDF, JSON.stringify(printed));
    const seg5 = await page.evaluate(() => {
      const rows = {};
      for (const b of document.querySelectorAll('.kd-docws:not([hidden]) [data-tool="export"] .kd-seg')[0].querySelectorAll('button')) { const t = Math.round(b.getBoundingClientRect().top); rows[t] = (rows[t] ?? 0) + 1; }
      return Object.values(rows);
    });
    check(`[${tag}] PDF 저장 형식 다섯: 외톨이 칸 없음`, seg5.every((c) => c > 1), JSON.stringify(seg5));
    await ui.shot(join(OUT, `w-${tag}-05-pdf-export.png`));

    // ── 글 파일(.txt)은 마크다운으로 해석하지 않는다
    const memo = join(OUT, '메모.txt');
    writeFileSync(memo, '# 이건 제목이 아님\n| 칸 | 그대로 |\n가. 첫째\n나. 둘째\n');
    await openDoc(memo);
    const pre = await page.evaluate(() => document.querySelector('.kd-docws:not([hidden]) .kd-textview pre')?.textContent ?? '');
    check(`[${tag}] .txt 는 글 그대로 (마크다운 해석 안 함)`, pre.includes('# 이건 제목이 아님') && pre.includes('| 칸 | 그대로 |'), pre.slice(0, 60).replace(/\n/g, '⏎'));
    await ui.shot(join(OUT, `w-${tag}-06-txt.png`));
    check(`[${tag}] 화면 오류 없음`, ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
  } catch (e) {
    check(`[${tag}] 시나리오 끝까지`, false, String(e));
    await ui.shot(join(OUT, `w-${tag}-zz-fail.png`)).catch(() => {});
  } finally {
    await ui.clearDialog().catch(() => {});
    await ui.close();
  }
}

/** 비교: 어두운 화면에서 지운 낱말 표시가 바탕과 또렷이 갈린다 */
async function compareDark() {
  const { markdownToHwpx } = await import(pathToFileURL(join(ROOT, 'node-sidecar/node_modules/kordoc/dist/index.js')).href);
  const a = join(OUT, '조례_현행.hwpx');
  const b = join(OUT, '조례_개정안.hwpx');
  writeFileSync(a, Buffer.from(await markdownToHwpx('# 가온시 조례\n\n제2조(정의) 이 조례에서 "주민"이란 시에 주소를 둔 사람을 말한다.\n\n제3조(위임) 시행에 필요한 사항은 규칙으로 정한다.')));
  writeFileSync(b, Buffer.from(await markdownToHwpx('# 가온시 조례\n\n제2조(정의) 이 조례에서 "주민"이란 시에 주민등록을 한 사람을 말한다.\n\n제3조(위임) 시행에 필요한 사항은 규칙으로 정한다.')));
  const ui = await openUi({ relay: RELAY, width: 1280, height: 800, dark: true, prefs: { 'kordoc-first-run-done': true, 'kordoc-theme': 'dark', 'kordoc-nav-collapsed': false } });
  const { page } = ui;
  try {
    await ui.click('신구대조표 만들기');
    await ui.dialog([[a]]);
    await ui.click('파일 고르기', { within: '[data-drop="compare-old"]' });
    await ui.dialog([[b]]);
    await ui.click('파일 고르기', { within: '[data-drop="compare-new"]' });
    await ui.click('비교하기', { exact: true });
    await page.waitForSelector('.kd-cmp del', { timeout: 30000 });
    const st = await page.evaluate(() => { const d = getComputedStyle(document.querySelector('.kd-cmp del')); return { bg: d.backgroundColor, deco: d.textDecorationColor, thick: d.textDecorationThickness }; });
    const alpha = Number((st.bg.match(/[\d.]+\)$/) ?? ['0'])[0].replace(')', '')) || (st.bg.startsWith('rgb(') ? 1 : 0);
    check('[dark] 비교: 지운 낱말 바탕이 진하다 (불투명도 0.25 이상)', alpha >= 0.25, JSON.stringify(st));
    await ui.shot(join(OUT, 'c-dark-compare.png'));
  } catch (e) {
    check('[dark] 비교 시나리오', false, String(e));
  } finally {
    await ui.clearDialog().catch(() => {});
    await ui.close();
  }
}

await run(1280, 800, false);
await run(1024, 768, true);
await compareDark();
writeFileSync(join(OUT, 'a-workbench.json'), JSON.stringify(checks, null, 2));
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} 통과`);
process.exit(failed ? 1 : 0);
