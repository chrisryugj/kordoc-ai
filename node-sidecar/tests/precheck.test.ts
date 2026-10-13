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
    expect(one[0]).toMatchObject({ severity: 'warning', fix: { from: '10. 6.(월)', to: '10. 6.(화)' } });
    expect(weekdayFindings('2025. 1. 1. 과 2026. 1. 1.\n접수: 10. 6.(월)까지')).toEqual([]);
  });
});

describe('표 합계 (엔진)', () => {
  const table = (rows: string[][]) => `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;

  it('합계 행이 위 칸의 합과 다르면 기대값을 보인다', () => {
    const md = table([['항목', '금액(원)', '비고'], ['기념품', '800,000', '300명'], ['홍보물', '400,000', ''], ['운영', '250,000', ''], ['합계', '1,500,000', '']]);
    const f = sumFindings([], md);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ category: '표 합계', severity: 'error', fix: { from: '1,500,000', to: '1,450,000' } });
    expect(f[0].message).toMatch(/1,500,000인데.*1,450,000입니다/);
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
    expect(f[0].fix?.to).toBe('7');
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
    expect(r.fixable).toBeGreaterThanOrEqual(6);
    expect(r.checked).toEqual(expect.arrayContaining(['표기법', '날짜와 요일', '표 합계', '빈칸 안내 글자', '개인정보']));

    // 고칠 수 있는 것 모두 고치기 → 고친 사본을 다시 점검하면 고칠 것 0
    const fixes = [...new Map(r.items.filter((f: { fix?: unknown }) => f.fix).map((f: { fix: { from: string; to: string } }) => [`${f.fix.from}\u0000${f.fix.to}`, f.fix])).values()];
    const fixed = await call('lint_fix', { path, fixes });
    expect(fixed.output_path).toMatch(/_수정\.hwpx$/);
    const again = await call('precheck', { path: fixed.output_path, keep: ['031-123-4567', '홍길동'] });
    expect(again.counts.error).toBe(0);
    expect(again.items.some((f: { category: string }) => f.category === '표 합계')).toBe(false);

    const pages = await call('find_pages', { path, texts: ['세부 계획 1부', '없는 글입니다'] });
    expect(pages.pages).toEqual([1, null]);
  }, 30000);
});
