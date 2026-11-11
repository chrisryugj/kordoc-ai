/** 결재 전 한 번에 점검 — 엔진 검사(요일·표 합계·끝. 표시·채우지 않은 자리)·표기 결과 다듬기·precheck·find_pages·고친 사본 다시 점검 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { markdownToHwpx } from 'kordoc';
import { call, setupEnv } from './doc-helpers.js';
import { endMarkFindings, placeholderFindings, sumFindings, weekdayFindings } from '../src/core/gongmun/consistency.js';
import { lintText, replaceWords } from '../src/core/gongmun/lint.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let env: ReturnType<typeof setupEnv>;
beforeAll(() => { env = setupEnv(); });

describe('날짜와 요일 (엔진)', () => {
  it('년·월·일 꼴의 틀린 요일 — 맞는 요일과 공문서 날짜 꼴로 고칠 거리', () => {
    const f = weekdayFindings('설명회: 2026년 11월 2일(수) 14:00');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'error', category: '날짜와 요일', fix: { from: '2026년 11월 2일(수)', to: '2026. 11. 2.(월)' } });
    expect(f[0].message).toContain('11월 2일은 월요일입니다');
  });

  it('맞는 요일·점 날짜(kordoc 이 본다)는 짚지 않는다', () => {
    expect(weekdayFindings('2026년 11월 2일(월), 2026. 11. 6.(목)')).toEqual([]);
  });

  it('연도 없는 날짜는 문서 연도가 하나일 때만 (살필 것)', () => {
    const one = weekdayFindings('2026. 10. 1.(목) 공고\n접수: 10. 6.(월)까지');
    expect(one).toHaveLength(1);
    // 연도를 짐작한 지적이라 살필 것으로만: 고칠 값은 싣지 않는다 ("모두 고치기"가 맞는 요일을 틀리게 바꾸지 않게)
    expect(one[0]).toMatchObject({ severity: 'warning', excerpt: '10. 6.(월)' });
    expect(one[0].message).toContain('화요일');
    expect(one[0].fix).toBeUndefined();
    expect(weekdayFindings('2025. 1. 1. 과 2026. 1. 1.\n접수: 10. 6.(월)까지')).toEqual([]);
  });

  it('해를 넘긴 날짜는 다음 해의 요일로도 본다 (12월 공문의 "1. 15.(금)": 2027-01-15 는 금요일)', () => {
    expect(weekdayFindings('1. 관련: 총무과-1234(2026. 12. 28.)\n일시: 1. 15.(금) 14:00')).toEqual([]);
    // 다음 해로 봐도 틀린 요일은 짚는다 (2027-01-15 는 금요일)
    expect(weekdayFindings('1. 관련: 총무과-1234(2026. 12. 28.)\n일시: 1. 15.(수) 14:00')).toHaveLength(1);
    // 같은 해의 가까운 날짜는 다음 해 요일과 맞아도 통과시키지 않는다 (2026-10-06 은 화요일, 2025-10-06 이 월요일)
    expect(weekdayFindings('2026. 10. 1.(목) 공고\n접수: 10. 6.(월)까지')).toHaveLength(1);
  });
});

describe('표 합계 (엔진)', () => {
  const table = (rows: string[][]) => `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;

  it('합계 행이 위 칸의 합과 다르면 기대값을 보인다', () => {
    const md = table([['항목', '금액(원)', '비고'], ['기념품', '800,000', '300명'], ['홍보물', '400,000', ''], ['운영', '250,000', ''], ['합계', '1,500,000', '']]);
    const f = sumFindings([], md);
    expect(f).toHaveLength(1);
    // 살필 것으로, 고칠 값 없이 (표의 짜임을 다 알 수 없어 맞는 합계를 틀렸다고 볼 수 있다: 자동으로 바꾸지 않는다)
    expect(f[0]).toMatchObject({ category: '표 합계', severity: 'warning', excerpt: '1,500,000' });
    expect(f[0].fix).toBeUndefined();
    expect(f[0].message).toMatch(/1,500,000인데.*1,450,000입니다/);
  });

  it('맞는 합계를 틀렸다고 하지 않는다: 단위가 다른 앞 열(사업량), 세부 항목이 하나뿐인 큰 항목', () => {
    // 계 = 국비 + 도비 + 시비 (사업량은 더하지 않는다)
    expect(sumFindings([], table([['사업명', '사업량', '국비', '도비', '시비', '계'], ['도로 정비', '2', '100', '60', '60', '220'], ['공원 조성', '1', '50', '28', '28', '106']]))).toEqual([]);
    // 그 묶음으로도 안 맞으면 짚는다
    expect(sumFindings([], table([['사업명', '사업량', '국비', '도비', '시비', '계'], ['도로 정비', '2', '100', '60', '60', '999'], ['공원 조성', '1', '50', '28', '28', '106']]))).toHaveLength(1);
    // 운영비 430 아래 세부 항목 하나(- 사무관리비 430): 합계는 큰 항목만 더한 1,070
    expect(sumFindings([], table([['구분', '금액'], ['인건비', '640'], ['- 기본급', '400'], ['- 수당', '240'], ['운영비', '430'], ['- 사무관리비', '430'], ['합계', '1,070']]))).toEqual([]);
    // 같은 값의 두 큰 항목(세부 항목 꼴 이름이 아님)은 둘 다 더한다
    expect(sumFindings([], table([['구분', '금액'], ['가 사업', '430'], ['나 사업', '430'], ['합계', '860']]))).toEqual([]);
  });

  it('머리행 바로 아래 합계(공문 관행)는 아래 칸의 합, 위에 둔 소계는 다음 소계까지', () => {
    const md = table([['항목', '금액(원)'], ['합계', '1,500,000'], ['기념품', '800,000'], ['홍보물', '400,000'], ['운영', '250,000']]);
    const f = sumFindings([], md);
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/1,500,000인데.*1,450,000입니다/);
    expect(f[0].message).toContain('아래 칸을 더하면');
    const groups = table([['구분', '금액'], ['합계', '300'], ['소계', '100'], ['가', '60'], ['나', '40'], ['소계', '200'], ['다', '200']]);
    expect(sumFindings([], groups)).toEqual([]);
  });

  it('kordoc 이 합계만 위로 옮기고 소계는 무리 뒤에 둔 표·2줄 머리 표는 짚지 않고, 무리 앞 소계 표의 틀린 맨 아래 합계는 짚는다', async () => {
    // generate_hwpx 가 만든 표 그대로 (합계 맨 위, 소계는 무리 뒤)
    expect(sumFindings([], table([['구분', '금액'], ['총계', '300'], ['가', '60'], ['나', '40'], ['소계', '100'], ['다', '150'], ['라', '50'], ['소계', '200']]))).toEqual([]);
    expect(sumFindings([], table([['구분', '인원', '인원', '인원'], ['', '계', '남', '여'], ['가', '30', '10', '20'], ['나', '30', '15', '15'], ['소계', '60', '25', '35'], ['다', '40', '20', '20'], ['라', '10', '5', '5'], ['소계', '50', '25', '25'], ['합계', '110', '50', '60']]))).toEqual([]);
    const f = sumFindings([], table([['구분', '세부', '금액'], ['A', '소계', '100'], ['', '가', '60'], ['', '나', '40'], ['B', '소계', '200'], ['', '다', '150'], ['', '라', '50'], ['합계', '', '999']]));
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/999인데.*300입니다/);
    // 배치는 표마다 하나로 본다: 소계 앞 배치의 둘째 소계는 아래 칸 합으로, 한쪽만 견줄 수 있어도 틀린 값을 놓치지 않는다
    const subFirst = sumFindings([], table([['구분', '세부', '금액'], ['A', '소계', '100'], ['', '가', '60'], ['', '나', '40'], ['B', '소계', '999'], ['', '다', '150'], ['', '라', '50'], ['합계', '', '300']]));
    const says = (x: { message: string }[]) => x.map((f) => /(\S+)인데.*더하면 (\S+)입니다/.exec(f.message)!.slice(1, 3));
    expect(says(subFirst)).toEqual([['999', '200']]);
    expect(says(sumFindings([], table([['구분', '금액'], ['가', '60'], ['나', '40'], ['소계', '999'], ['기타', '10'], ['합계', '110']])))).toEqual([['999', '100']]);
    expect(says(sumFindings([], table([['구분', '금액'], ['총계', '300'], ['가', '60'], ['나', '40'], ['소계', '200'], ['다', '150'], ['라', '50'], ['소계', '200']])))).toEqual([['200', '100']]);
    // 사업별 "계" 아래 재원 내역, 무리 뒤 "계" + 맨 아래 합계, 연도 2줄 머리는 맞는 표
    expect(sumFindings([], table([['사업명', '재원', '금액'], ['A사업', '계', '100'], ['', '국비', '60'], ['', '시비', '40'], ['B사업', '계', '200'], ['', '국비', '150'], ['', '시비', '50']]))).toEqual([]);
    expect(sumFindings([], table([['구분', '금액'], ['가', '60'], ['나', '40'], ['계', '100'], ['다', '150'], ['라', '50'], ['계', '200'], ['합계', '300']]))).toEqual([]);
    expect(sumFindings([], table([['구분', '예산', '예산', '예산'], ['', '계', '2025', '2026'], ['가', '300', '100', '200'], ['나', '30', '10', '20'], ['합계', '330', '110', '220']]))).toEqual([]);
    // 만든 문서를 다시 점검해도 깨끗하다
    const md = '# 사업비\n\n| 구분 | 금액(천원) |\n| --- | --- |\n| 가 사업 | 60 |\n| 나 사업 | 40 |\n| 소계 | 100 |\n| 다 사업 | 150 |\n| 라 사업 | 50 |\n| 소계 | 200 |\n| 합계 | 300 |\n';
    const made = await call('generate_hwpx', { markdown: md, preset: 'report', output_path: join(env.work, '사업비.hwpx') });
    const r = await call('precheck', { path: made.output_path });
    expect(r.items.filter((x: { rule: string }) => x.rule === 'SUM_MISMATCH')).toEqual([]);
  }, 30000); // 표 여럿을 엔진 CLI 로 만들고 읽는다: 다른 프로그램이 CPU 를 쓰면 10초를 넘는다 (실측)

  it('계층 표(큰 항목 아래 세부 항목)의 합계는 큰 항목만 더해 맞으면 맞는 것으로 본다', () => {
    // 인건비 1,000 = 기본급 600 + 수당 400. 모두 더하면 2,500 이지만 합계 1,500 이 맞다
    expect(sumFindings([], table([['구분', '금액'], ['합계', '1,500'], ['인건비', '1,000'], ['기본급', '600'], ['수당', '400'], ['운영비', '500']]))).toEqual([]);
    expect(sumFindings([], table([['구분', '금액'], ['인건비', '1,000'], ['기본급', '600'], ['수당', '400'], ['운영비', '500'], ['합계', '1,500']]))).toEqual([]);
    // 큰 항목만 더해도 안 맞으면 그대로 짚는다
    expect(sumFindings([], table([['구분', '금액'], ['합계', '1,600'], ['인건비', '1,000'], ['기본급', '600'], ['수당', '400'], ['운영비', '500']]))).toHaveLength(1);
  });

  it('맞는 합계·소계, 비율 열은 짚지 않는다', () => {
    const md = table([['구분', '인원', '비율'], ['가', '10', '25%'], ['나', '30', '75%'], ['소계', '40', '100%'], ['다', '5', ''], ['합계', '45', '']]);
    expect(sumFindings([], md)).toEqual([]);
  });

  it('합계 열 — 같은 줄 왼쪽 칸의 합', () => {
    const md = table([['부서', '1분기', '2분기', '계'], ['총무과', '3', '4', '8'], ['기획과', '1', '1', '2']]);
    const f = sumFindings([], md);
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('총무과');
    expect(f[0].message).toMatch(/8인데.*7입니다/);
  });
});

describe('끝. 표시·채우지 않은 자리 (엔진)', () => {
  it('붙임 뒤 끝. 이 없으면 살필 것 + 바르게 쓴 모양, 있으면 없음', () => {
    const f = endMarkFindings('# 제목\n\n1. 본문입니다.\n\n붙임 계획서 1부.');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'END_MARK_MISSING', severity: 'warning', suggestion: '계획서 1부.  끝.' });
    expect(endMarkFindings('# 제목\n\n붙임 계획서 1부.  끝.')).toEqual([]);
    expect(endMarkFindings('# 보고서\n\n□ 추진 배경')).toEqual([]);
  });

  it('○○○·OOO 같은 자리 표시', () => {
    const f = placeholderFindings('담당: ○○○ 주무관\n○ 항목은 짚지 않음');
    expect(f).toHaveLength(1);
    expect(f[0].excerpt).toBe('○○○');
  });
});

describe('표기 결과 다듬기', () => {
  it('규칙 코드 대신 갈래 이름·합니다체, 낱말 단위 발췌, 실제 고칠 값(금액은 천 단위 쉼표)', () => {
    const f = lintText('1. 관련 : 가온시-1234(2026.10.5.)\n라. 예산: 금1500000원\n오후 2시 30분에 시작', { parsed: true });
    const colon = f.find((x) => x.rule === 'COLON_SPACE')!;
    expect(colon.category).toBe('쌍점 띄어쓰기');
    expect(colon.context).toContain('관련 :');
    expect(colon.fix).toEqual({ from: '관련 :', to: '관련:' });
    expect(f.find((x) => x.rule === 'MONEY_NO_HANGUL')!.fix!.to).toBe('금1,500,000원(금일백오십만원)');
    expect(f.find((x) => x.rule === 'TIME_AMPM')!.fix).toEqual({ from: '오후 2시 30분에', to: '14:30에' });
    for (const x of f) expect(x.message).toMatch(/니다[.)]?\)?$/);
    expect(JSON.stringify(f)).not.toMatch(/[—–]/);
  });

  it('앞 시각만 바꾸면 글이 망가지는 꼴은 고칠 값을 정하지 않는다 (시각 범위·"반"·"5일까지")', () => {
    for (const line of ['오후 2시부터 4시까지 진행', '오전 10시 반에 시작', '오후 6시∼8시 운영', '오후 2시 ~ 5시']) {
      const f = lintText(line, { parsed: true }).find((x) => x.rule === 'TIME_AMPM');
      expect(f?.fix, line).toBeUndefined();
    }
    // 뒤에 다른 시각이 없으면 고친다
    expect(lintText('오후 2시에 시작하여 회의실에서 진행', { parsed: true }).find((x) => x.rule === 'TIME_AMPM')?.fix?.to).toMatch(/^14:00/);
    const d = lintText('2026. 11. 5일까지 제출', { parsed: true }).find((x) => x.rule === 'DATE_NO_END_DOT');
    if (d) expect(d.fix).toBeUndefined();
  });

  it('바꿀 말이 다른 낱말 속에 있으면 건드리지 않는다 (금일백만원 속 금일)', () => {
    expect(replaceWords('금일 회의, 금1,000,000원(금일백만원)', '금일', '오늘')).toEqual({ text: '오늘 회의, 금1,000,000원(금일백만원)', count: 1 });
  });
});

/** 틀린 곳을 심은 기안문 (scripts/e2e-ui/make-precheck-sample.mjs 와 같은 모양, 짧게) */
async function plantedDoc(): Promise<string> {
  const md = `# 걷기대회 개최 계획

1. 관련 : 가온시 체육진흥과-1234(2026.10.5.)
2. 일시: 2026. 11. 6.(목) 10:00∼12:00, 설명회 2026년 11월 2일(수)
3. 소요 예산: 금1500000원
4. 문의: 주무관 홍길동(010-2345-6789), 대표번호 031-123-4567
5. 시행일: @@FIELD@@

| 항목 | 금액(원) |
| --- | --- |
| 기념품 | 800,000 |
| 홍보물 | 400,000 |
| 운영 | 250,000 |
| 합계 | 1,500,000 |

붙임  세부 계획 1부.
`;
  const zip = await JSZip.loadAsync(await markdownToHwpx(md, { gongmun: { preset: 'official', endMark: false } }));
  const name = Object.keys(zip.files).find((n) => /section0\.xml$/.test(n))!;
  const guide = '시행 날짜를 입력하세요';
  const rest = `Direction:wstring:${guide.length}:${guide} HelpState:wstring:0:  `;
  const field = `</hp:t><hp:ctrl><hp:fieldBegin id="1900000001" type="CLICK_HERE" name="시행일" editable="1"><hp:parameters cnt="1" name=""><hp:stringParam name="Command">Clickhere:set:${rest.length}:${rest}</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl><hp:ctrl><hp:fieldEnd beginIDRef="1900000001"/></hp:ctrl><hp:t>`;
  zip.file(name, (await zip.file(name)!.async('string')).replace('@@FIELD@@', field));
  const path = join(env.work, '점검.hwpx');
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
}

describe('precheck·find_pages', () => {
  it('한 목록 — 요일 둘·표 합계·개인정보·빈칸 안내 글자·끝. 표시, 심각한 것부터, 쪽, 남길 것 제외', async () => {
    const path = await plantedDoc();
    const r = await call('precheck', { path, keep: ['031-123-4567', '홍길동'] });
    const cats = r.items.map((f: { category: string }) => f.category);
    expect(cats.filter((c: string) => c === '날짜와 요일')).toHaveLength(2);
    expect(cats).toEqual(expect.arrayContaining(['표 합계', '날짜 표기', '쌍점 띄어쓰기', '금액 표기', '개인정보', '빈칸 안내 글자', '붙임·끝 표시']));
    const order = { error: 0, warning: 1, info: 2 } as const;
    const sev = r.items.map((f: { severity: keyof typeof order }) => order[f.severity]);
    expect(sev).toEqual([...sev].sort((a, b) => a - b));
    expect(r.items.every((f: { page?: number }) => f.page === 1)).toBe(true);
    expect(r.page_count).toBe(1);
    const json = JSON.stringify(r);
    expect(json).not.toContain('010-2345-6789'); // 개인정보는 가린 모양으로만
    expect(json).not.toContain('031-●●●'); // 남길 것은 짚지 않는다
    expect(json).not.toMatch(/"rule":"[A-Z_]+","severity":"[a-z]+","message"/); // 갈래 없이 코드만 있는 지적 없음
    expect(r.fixable).toBeGreaterThanOrEqual(5);
    // 표 합계·짐작한 연도의 요일은 고칠 값을 싣지 않는다 (사람이 확인할 것)
    expect(r.items.find((f: { category: string }) => f.category === '표 합계').fix).toBeUndefined();
    expect(r.checked).toEqual(expect.arrayContaining(['표기법', '날짜와 요일', '표 합계', '빈칸 안내 글자', '개인정보']));

    // 고칠 수 있는 것 모두 고치기 → 고친 사본을 다시 점검하면 고칠 것 0
    const fixes = [...new Map(r.items.filter((f: { fix?: unknown }) => f.fix).map((f: { fix: { from: string; to: string } }) => [`${f.fix.from}\u0000${f.fix.to}`, f.fix])).values()];
    const fixed = await call('lint_fix', { path, fixes });
    expect(fixed.output_path).toMatch(/_수정\.hwpx$/);
    const again = await call('precheck', { path: fixed.output_path, keep: ['031-123-4567', '홍길동'] });
    expect(again.counts.error).toBe(0);
    // 표 합계는 자동으로 고치지 않아 살필 것으로 남는다
    expect(again.items.find((f: { category: string }) => f.category === '표 합계')?.severity).toBe('warning');

    const pages = await call('find_pages', { path, texts: ['세부 계획 1부', '없는 글입니다'] });
    expect(pages.pages).toEqual([1, null]);
  }, 30000);
});

describe('공문 서식(틀 표) 문서 고치기', () => {
  // 실측: 홈 "이어서 결재 전 점검" 에서 Gemma 가 만든 회신 기안문을 fix_notation 하자 엔진이
  // "편집 마크다운이 기본(보이는 대로) 출력에서 나왔습니다 … 틀 표" 로 거부했다. 패치용 글은 keep 출력이어야 한다
  it('generate_hwpx(official) 로 만든 문서도 점검 → lint_fix 가 서식 그대로 고친다', async () => {
    const made = await call('generate_hwpx', { markdown: '# 도민체육대회 참가 회신\n\n1. 귀 기관의 협조 요청에 따라 아래와 같이 회신합니다.\n  가. 일시: 2026년 11월 2일(수) 14:00\n  나. 참가 인원: 20명  끝.', preset: 'official' });
    const r = await call('precheck', { path: made.output_path });
    const fixes = r.items.filter((f: { fix?: unknown }) => f.fix).map((f: { fix: { from: string; to: string } }) => f.fix);
    expect(fixes.length).toBeGreaterThan(0);
    const fixed = await call('lint_fix', { path: made.output_path, fixes });
    expect(fixed.replaced).toBeGreaterThan(0);
    const again = await call('precheck', { path: fixed.output_path });
    expect(again.items.some((f: { category: string }) => f.category === '날짜와 요일')).toBe(false);
  }, 60000);
});
