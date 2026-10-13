/**
 * D 영역 화면 검증 — 서무 도구(문서 수합·늦게 온 파일·시작 못 하는 까닭·업무별 목록·인쇄)·접수함(접수대장 엑셀).
 *   node scripts/e2e-ui/d-gather.mjs --relay http://127.0.0.1:7724 --out <스크린샷·작업 폴더>
 * 만든 엑셀은 열어서(xl/worksheets XML) 값·노란 칸·합계·제출 현황까지 대조한다. 프린터로 실제로 보내지는 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';
import { makeGatherFixtures } from './d-gather-fixtures.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg('--relay', 'http://127.0.0.1:7724');
const OUT = arg('--out', join(process.cwd(), 'e2e-out-d'));
mkdirSync(OUT, { recursive: true });
const JSZip = createRequire(join(ROOT, 'node-sidecar', 'package.json'))('jszip');

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

/** xlsx → { 시트 이름: { A1: { v, s } } } (inlineStr·숫자, s = 칸 스타일 번호: 5 노란 표시, 7 굵은 숫자) */
async function readBook(path) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const names = [...(await zip.file('xl/workbook.xml').async('string')).matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  const out = {};
  for (const [i, name] of names.entries()) {
    const xml = await zip.file(`xl/worksheets/sheet${i + 1}.xml`).async('string');
    const cells = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const inner = m[3] ?? '';
      cells[m[1]] = { v: (/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '').replace(/&amp;/g, '&'), s: /s="(\d+)"/.exec(m[2])?.[1] ?? '0' };
    }
    out[name] = cells;
  }
  return out;
}
const row = (cells, r, n = 11) => Array.from({ length: n }, (_, c) => cells[`${String.fromCharCode(65 + c)}${r}`]?.v ?? '');
const rows = (cells) => { const out = []; for (let r = 1; cells[`A${r}`]; r++) out.push(row(cells, r)); return out; };

const fx = await makeGatherFixtures(join(OUT, 'fx'));
const ui = await openUi({ relay: RELAY, width: 1280, height: 900, prefs: { 'kordoc-first-run-done': true, 'kordoc-nav-collapsed': false } });
const { page } = ui;
const text = (sel) => page.$eval(sel, (e) => e.innerText).catch(() => '');
const openBatch = async () => { await page.click('.kd-nav-item[data-screen="batch"]'); await sleep(500); };

try {
  await openBatch();
  // ── 업무별 목록 (문서 수합 먼저) · 시작 못 하는 까닭
  const groups = await page.$$eval('.kd-tasklist h2', (hs) => hs.map((h) => h.textContent.trim()));
  check('업무별 묶음 순서', JSON.stringify(groups.slice(0, 8)) === JSON.stringify(['문서 수합', '명부로 여러 장', '정보공개 공개본', '결재 합본', '신구대조표', '문서 찾기', '형식 바꾸기', '폴더 지켜보기']), groups.join(' / '));
  const pressed = await page.$eval('.kd-taskitem[aria-pressed="true"]', (e) => e.dataset.task);
  check('처음 고른 일 = 문서 수합', pressed === 'collect', pressed);
  const startOff = await page.evaluate(() => [...document.querySelectorAll('.kd-batch-opts button')].find((b) => b.textContent.trim().startsWith('시작'))?.disabled);
  const reason = await text('#task-block');
  check('파일 없을 때 시작이 꺼진 까닭', startOff && reason.includes('파일을 먼저 넣으세요'), reason);
  await ui.shot(join(OUT, 'd01-batch-empty.png'));

  // ── 제출물 폴더 + 명단 파일 + 기한 → 시작
  await ui.dialog([fx.dir]);
  await ui.click('폴더 추가');
  await ui.waitText('파일 8개');
  const rowDesc = await page.$eval('.kd-filerow .kd-row-desc', (e) => ({ t: e.textContent, title: e.getAttribute('title') }));
  check('파일 줄은 폴더 이름만, 전체 경로는 올려 보기', rowDesc.t.startsWith('제출물 폴더') && rowDesc.title.startsWith('/'), JSON.stringify(rowDesc));
  await ui.dialog([[fx.roster]]);
  await ui.click('명단 파일에서 가져오기');
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="부서 명단"]')?.value.includes('문화체육과'), { timeout: 15000 });
  const rosterLabel = await page.evaluate(() => [...document.querySelectorAll('.kd-label')].map((e) => e.textContent).find((t) => t.startsWith('부서 명단')));
  check('명단 파일 → 8개 부서', rosterLabel?.includes('8개 부서'), rosterLabel);
  await page.type('input[aria-label="제출 기한"]', '10. 20.(화)');
  await ui.click('시작 (8개)');
  await ui.waitText('엑셀 한 장으로 모았습니다', 60000);
  await sleep(400);
  await ui.shot(join(OUT, 'd02-gather-result.png'));
  const savedPath = await page.$eval('.kd-batch-opts .kd-note[data-tone="ok"] .kd-path', (e) => e.getAttribute('title'));
  check('엑셀 저장 (제출물 폴더 옆, 제목_수합.xlsx)', savedPath && basename(savedPath) === '2026년 하반기 직무교육 수요조사서_수합.xlsx' && existsSync(savedPath), savedPath);
  const summary = await page.evaluate(() => [...document.querySelectorAll('.kd-batch-opts p.kd-small')].map((p) => p.textContent).find((t) => /같은 서식 \d/.test(t)));
  check('요약 줄: 같은 서식 5·엑셀 2·빈칸·합계', /같은 서식 5개 · 엑셀 2개/.test(summary ?? '') && /빈칸 \d+곳/.test(summary) && /합계 희망 인원 40/.test(summary), summary);
  const missingHead = await text('#gather-missing-t');
  check('미제출 2개 부서', missingHead === '미제출 2개 부서: 환경위생과, 문화체육과', missingHead);
  const reminder = await page.$eval('textarea[aria-label="독촉 글"]', (e) => e.value);
  check('독촉 글: 제목·부서·기한, 줄표 없음', reminder.includes('「2026년 하반기 직무교육 수요조사서」') && reminder.includes('환경위생과, 문화체육과') && reminder.includes('10. 20.(화)까지') && !/[—–]/.test(reminder), reminder.split('\n')[0]);
  await ui.click('독촉 글 복사');
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e}`);
  check('독촉 글 복사 → 클립보드', clip === reminder, clip.slice(0, 40));
  const sep = await text('#gather-sep-t');
  check('서식이 달라 따로 볼 문서 = 워드 1개', sep === '서식이 달라 따로 봐야 할 문서 1개', sep);

  // 엑셀 열어 대조
  const book = await readBook(savedPath);
  const s1 = book['수합'];
  const all = rows(s1);
  check('시트 두 장', Object.keys(book).join(',') === '수합,제출 현황', Object.keys(book).join(','));
  check('머리 행', all[0].slice(0, 9).join('|') === '제출 파일|부서|부서명|담당자|내선번호|희망 교육과정|희망 인원|희망 시기|건의 사항' && all[0][9] === '비고' && all[0][10] === '확인 사항', all[0].join('|'));
  check('자료 9줄 + 합계 행', all.length === 11 && all[10][0] === '합계' && all[10][6] === '40' && s1.G11.s === '7', `${all.length}줄, 합계 ${all[10]?.[6]}`);
  const byFile = Object.fromEntries(all.slice(1, 10).map((r) => [`${r[0]}#${r[3]}`, r]));
  check('파일 이름 꼴이 제각각이어도 부서 (팀·괄호·대괄호)', byFile['복지정책팀 수요조사.hwpx#정한결']?.[1] === '복지정책과' && byFile['[총무과] 교육수요조사서 제출.hwpx#이가람']?.[1] === '총무과' && byFile['교육수요조사서(기획예산과).hwpx#박새봄']?.[1] === '기획예산과');
  check('엑셀 제출물 행 잇기 (세무과 2줄, 합계 줄 뺌)', all.filter((r) => r[0] === '세무과_교육수요.xlsx').length === 2);
  check('칸에만 있는 동 이름 → 가온1동 (명단 밖)', byFile['가온1동 제출.xlsx#문하늘']?.[1] === '가온 1동' || byFile['가온1동 제출.xlsx#문하늘']?.[1] === '가온1동', byFile['가온1동 제출.xlsx#문하늘']?.[1]);
  const cityRow = all.findIndex((r) => r[0] === '도시계획과_수요조사서_최종.hwpx') + 1;
  check('빈 필수 칸 노란 표시 (도시계획과 희망 시기)', s1[`H${cityRow}`]?.s === '5', JSON.stringify(s1[`H${cityRow}`]));
  check('워드 의견서는 비고에 따로 확인', all.some((r) => r[0] === '교통행정과 의견.docx' && r[10] === '서식이 달라 따로 확인'));
  const st = rows(book['제출 현황']);
  check('제출 현황 머리', st[0].slice(0, 4).join('|') === '부서|제출 여부|파일|빈칸 수');
  check('제출 현황: 명단 순서·미제출', st[1][0] === '총무과' && st[7][0] === '환경위생과' && st[7][1] === '미제출' && st[8][1] === '미제출' && book['제출 현황'].B8.s === '5', st.slice(1, 9).map((r) => `${r[0]}:${r[1]}`).join(' '));
  check('제출 현황: 명단에 없는 부서', st.some((r) => r[0] === '교통행정과 (명단에 없음)'), st.map((r) => r[0]).join(','));

  // ── 늦게 온 파일 더 넣기 → 같은 파일 바꾸기
  await ui.dialog([[fx.late]]);
  await ui.click('늦게 온 파일 더 넣기');
  await ui.waitText('늦게 온 파일 1개를 넣었습니다');
  await ui.shot(join(OUT, 'd03-late-prompt.png'));
  await ui.click('같은 파일 바꾸기');
  await ui.waitText('엑셀 한 장으로 모았습니다', 60000);
  await sleep(400);
  const again = await page.$eval('.kd-batch-opts .kd-note[data-tone="ok"] .kd-path', (e) => e.getAttribute('title'));
  const missing2 = await text('#gather-missing-t');
  check('늦게 온 파일: 같은 파일로 다시 만들고 미제출 1개', again === savedPath && missing2 === '미제출 1개 부서: 문화체육과', `${basename(again)} / ${missing2}`);
  const st2 = rows((await readBook(again))['제출 현황']);
  check('다시 만든 엑셀에 환경위생과 제출', st2[7][0] === '환경위생과' && st2[7][1] === '제출' && st2[7][2] === '환경위생과_교육수요.csv', st2[7].slice(0, 3).join('|'));
  await ui.shot(join(OUT, 'd04-late-done.png'));
  // 새 파일로 만들기 (번호 붙음)
  await ui.dialog([[join(SAMPLES, '취합', '교육수요조사서_총무과.hwpx')]]);
  await ui.click('늦게 온 파일 더 넣기');
  await ui.waitText('늦게 온 파일 1개를 넣었습니다');
  await ui.click('새 파일로 만들기');
  await ui.waitText('엑셀 한 장으로 모았습니다', 60000);
  await sleep(400);
  const numbered = await page.$eval('.kd-batch-opts .kd-note[data-tone="ok"] .kd-path', (e) => e.getAttribute('title'));
  check('새 파일로 만들기 = 번호 붙은 파일', basename(numbered) === '2026년 하반기 직무교육 수요조사서_수합 (2).xlsx', basename(numbered));

  // 외톨이 줄 (1280 · 1024)
  const orph1280 = await ui.orphans('.kd-batch-opts p, .kd-batch-opts .kd-field-hint, .kd-batch-opts .kd-row-desc, .kd-batch-opts h3, .kd-tasklist .kd-row-desc');
  check('외톨이 줄 0 (1280)', orph1280.length === 0, JSON.stringify(orph1280));
  await page.setViewport({ width: 1024, height: 860 });
  await sleep(400);
  const orph1024 = await ui.orphans('.kd-batch-opts p, .kd-batch-opts .kd-field-hint, .kd-batch-opts .kd-row-desc, .kd-batch-opts h3, .kd-tasklist .kd-row-desc');
  check('외톨이 줄 0 (1024)', orph1024.length === 0, JSON.stringify(orph1024));
  await ui.shot(join(OUT, 'd05-gather-1024.png'));
  await page.setViewport({ width: 1280, height: 900 });

  // ── 다른 일: 글로(쉬운 이름)·인쇄(프린터)·모두 빼기 뒤 까닭
  await page.click('.kd-taskitem[data-task="convert"]');
  await sleep(300);
  const segs = await page.$$eval('.kd-batch-opts .kd-seg button', (bs) => bs.map((b) => b.textContent));
  check('글로: 쉬운 이름 (마크다운·HTML 없음)', segs.join('|') === '제목·표 살린 글|웹 페이지|글자만', segs.join('|'));
  const out = await page.$eval('.kd-batch-opts .kd-path', (e) => ({ t: e.textContent, title: e.getAttribute('title') }));
  check('저장할 곳: 폴더 이름만', !out.t.includes('/'), JSON.stringify(out));
  await page.click('.kd-taskitem[data-task="print"]');
  await sleep(1200);
  const printUi = await text('.kd-batch-opts');
  const printReason = await text('#task-block');
  check('한꺼번에 인쇄: 프린터 목록 또는 없음 안내', /프린터/.test(printUi) && (printReason.includes('연결된 프린터가 없습니다') || printReason === ''), `${printUi.split('\n').slice(0, 4).join(' / ')} | ${printReason}`);
  await ui.shot(join(OUT, 'd06-print.png'));
  await ui.click('모두 빼기');
  await page.click('.kd-taskitem[data-task="collect"]');
  await sleep(300);
  check('모두 뺀 뒤 까닭', (await text('#task-block')).includes('파일을 먼저 넣으세요'));

  // ── 홈 → 아래쪽 일로 들어오면 목록에서 보이게
  const homeHas = await page.evaluate(() => !!document.querySelector('.kd-nav-item[data-screen="home"]'));
  if (homeHas) {
    await page.setViewport({ width: 1280, height: 520 });
    await page.click('.kd-nav-item[data-screen="home"]');
    await sleep(500);
    const went = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button, a')].find((e) => e.offsetParent && /폴더 지켜보기|스캔|그림만|표 뽑기/.test(e.textContent));
      if (!b) return '';
      b.click();
      return b.textContent.trim();
    });
    await sleep(800);
    const vis = await page.evaluate(() => {
      const el = document.querySelector('.kd-taskitem[aria-pressed="true"]');
      const nav = document.querySelector('.kd-tasklist');
      if (!el || !nav) return null;
      const a = el.getBoundingClientRect(); const b = nav.getBoundingClientRect();
      return { task: el.dataset.task, inside: a.top >= b.top - 1 && a.bottom <= b.bottom + 1, scrolled: nav.scrollTop };
    });
    check('미리 고른 일이 목록에서 보이게 (홈에서 들어옴)', !went || (vis && vis.inside), `${went} → ${JSON.stringify(vis)}`);
    await ui.shot(join(OUT, 'd07-preselect.png'));
    await page.setViewport({ width: 1280, height: 900 });
  }

  // ── 접수함: 접수대장 엑셀 (저장 폴더를 작업 폴더로: 문서 폴더에 시험 파일을 남기지 않게)
  await ui.call('update_settings', { settings: { convert: { output_dir: OUT } } });
  await page.click('.kd-nav-item[data-screen="inbox"]');
  await sleep(600);
  await ui.dialog([[join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.hwpx')]]);
  await ui.click('공문 추가');
  await ui.waitText('공문 1건을 정리했습니다', 30000).catch(() => undefined);
  await ui.click('접수대장 엑셀');
  await ui.waitText('접수대장을 엑셀로 저장했습니다', 20000);
  const ledgerPath = await page.$eval('.kd-inbox .kd-note[data-tone="ok"] .kd-path', (e) => e.getAttribute('title'));
  const ledger = rows((await readBook(ledgerPath))['접수대장']);
  check('접수대장 열 10개', ledger[0].slice(0, 10).join('|') === '접수일|보낸 곳|문서번호|시행일|제목|요청 사항|기한|상태|메모|파일', ledger[0].join('|'));
  check('접수대장 값', ledger[1][1] === '가온도' && ledger[1][6] === '2026-10-23' && ledger[1][7] === '할 일' && ledger[1][9].endsWith('.hwpx'), ledger[1].slice(0, 10).join('|'));
  await ui.shot(join(OUT, 'd08-inbox-ledger.png'));
  const inboxOrph = await ui.orphans('.kd-inbox .kd-note');
  check('접수함 저장 안내 외톨이 줄 0', inboxOrph.length === 0, JSON.stringify(inboxOrph));

  check('페이지 오류 없음', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
} catch (e) {
  check('흐름이 끝까지 돎', false, String(e?.stack ?? e));
  await ui.shot(join(OUT, 'd99-error.png')).catch(() => undefined);
} finally {
  await ui.clearDialog().catch(() => undefined);
  await ui.call('update_settings', { settings: { convert: { output_dir: '' } } }).catch(() => undefined);
  await ui.close();
}
writeFileSync(join(OUT, 'd-gather-report.json'), JSON.stringify(checks, null, 2));
const fail = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - fail.length}/${checks.length} 통과`);
process.exit(fail.length ? 1 : 0);
