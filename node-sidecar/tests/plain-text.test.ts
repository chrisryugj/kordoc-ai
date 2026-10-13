/** "글만" 저장·메신저용 복사 — 마크다운 표시 없이, 표는 탭으로 이은 줄 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { markdownToPlain } from '../src/core/converter/plain.js';
import { call, sample, setupEnv } from './doc-helpers.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

describe('markdownToPlain', () => {
  it('제목·인용·굵게·이스케이프·링크·그림을 걷는다', () => {
    const md = '# 추진 계획\n\n> 반복 업무를 줄이고자 함\n\n**일시**: 10:00\\~17:00 \\#1\n\n![image](image_1.png)\n\n[누리집](http://x.example)\n';
    expect(markdownToPlain(md)).toBe('추진 계획\n\n반복 업무를 줄이고자 함\n\n일시: 10:00~17:00 #1\n\n누리집\n');
  });

  it('GFM 표는 구분 줄을 빼고 칸을 탭으로 (칸 속 \\| 는 글자)', () => {
    const md = '| 과제 | 10월 | 11월 |\n| --- | :---: | --- |\n| 서식 등록 | 시범 부서 3곳 | A\\|B |\n| 빈칸 |  | 끝 |\n';
    expect(markdownToPlain(md)).toBe('과제\t10월\t11월\n서식 등록\t시범 부서 3곳\tA|B\n빈칸\t\t끝\n');
  });

  it('HTML 표(병합 칸)도 탭으로 이은 줄로', () => {
    const md = '앞 글\n\n<table><tr><th colspan="2">구분</th></tr><tr><td>가<br>나</td><td>&amp; 다</td></tr></table>\n\n뒤 글';
    expect(markdownToPlain(md)).toBe('앞 글\n\n구분\n가 나\t& 다\n\n뒤 글\n');
  });

  it('항목 기호·들여쓰기·번호는 그대로 둔다', () => {
    const md = '1. 관련: 가온도\n 가. 일시: 2026. 11. 13.\n    - 세부 사항\n○ 추진 배경\n* 별표 목록';
    expect(markdownToPlain(md)).toBe('1. 관련: 가온도\n 가. 일시: 2026. 11. 13.\n    - 세부 사항\n○ 추진 배경\n- 별표 목록\n');
  });
});

describe('convert txt', () => {
  beforeAll(() => { setupEnv(); });

  it('실문서 "글만"에 마크다운 표시가 남지 않는다', async () => {
    const report = await call('convert', { path: sample('4-보고서_디지털 행정 혁신 추진계획.hwpx'), format: 'txt', save: false });
    expect(report.content).not.toMatch(/^#|^\||^>|\\[~#|]/m);
    expect(report.content).toContain('과제\t10월\t11월\t12월');
    expect(report.content).toContain('서식 등록·교육\t시범 부서 3곳\t전 부서 확대\t성과 점검');
    const letter = await call('convert', { path: sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'), format: 'txt', save: false });
    expect(letter.content).toContain('10:00~17:00');
  });
});
