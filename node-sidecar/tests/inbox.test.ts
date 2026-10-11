/** 받은 공문 — 예제 공문(HWPX·PDF) 뽑기, 여러 날짜 꼴, 기한 아닌 날짜(행사 일시), 저장·다시 넣기·상태 유지·정렬·실패 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, corpus, hasCorpus, sample, setupEnv } from './doc-helpers.js';
import { extractInbox } from '../src/core/inbox/extract.js';
import { inboxId } from '../src/core/inbox/index.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const LETTER_HWPX = sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx');
const LETTER_PDF = sample('1-받은공문_도민체육대회 참가 협조 요청.pdf');
const TODAY = '2026-10-10';
let env: ReturnType<typeof setupEnv>;

beforeAll(() => {
  env = setupEnv();
});

/** 합성 공문: 두문 + 본문 + 발신명의 + 시행 줄 */
const letter = (body: string, sent = '2026. 10. 2.') => ['가온도', '수신 가온시장(행정지원과장)', '(경유)', '제목 시험 공문', body, '가온도지사', `시행 총무과-100 (${sent}) 접수 ( )`].join('\n\n');
const reqs = (body: string, sent?: string) => extractInbox(letter(body, sent), TODAY).requests;

describe('예제 공문 (도민체육대회 참가 협조 요청)', () => {
  const expectLetter = (it: Record<string, unknown>) => {
    expect(it).toMatchObject({
      sender: '가온도',
      doc_number: '가온도 체육진흥과-2203',
      sent_date: '2026-10-02',
      title: '2026년 가온도민 한마음 체육대회 참가 협조 요청',
      requests: [{ text: '참가 신청서와 선수 명단을 공문으로 제출', due: '2026-10-23' }],
      due: '2026-10-23',
      status: 'todo',
    });
    // 행사 일시(11. 13. 개최)는 기한이 아니다
    expect(JSON.stringify(it)).not.toContain('2026-11-13');
  };

  it('HWPX — 보낸 곳·문서번호·시행일·제목·요청·기한', async () => {
    const r = await call('inbox_add', { paths: [LETTER_HWPX] });
    expect(r.failed).toEqual([]);
    expect(r.items).toHaveLength(1);
    expectLetter(r.items[0]);
    expect(r.items[0].name).toBe('1-받은공문_도민체육대회 참가 협조 요청.hwpx');
  }, 30_000);

  it('같은 공문 PDF 도 같은 값', async () => {
    const r = await call('inbox_add', { paths: [LETTER_PDF] });
    expect(r.failed).toEqual([]);
    expectLetter(r.items[0]);
    await call('inbox_remove', { id: r.items[0].id });
    await call('inbox_remove', { id: inboxId(LETTER_HWPX) });
  }, 30_000);
});

describe('날짜 꼴', () => {
  it.each([
    ['2026. 10. 23.(금)까지', '2026-10-23'],
    ['10. 23.(금)까지', '2026-10-23'],
    ['10월 23일까지', '2026-10-23'],
    ['10. 23.까지', '2026-10-23'],
    ["'26.10.23.(금)까지", '2026-10-23'],
    ['2026년 10월 23일(금) 18:00까지', '2026-10-23'],
    ['2026. 10. 23.(월)까지', '2026-10-23'], // 요일이 틀려도 날짜를 믿는다
  ])('%s → %s', (when, due) => {
    expect(reqs(`1. 신청서를 ${when} 제출하여 주시기 바랍니다.`)).toEqual([{ text: '신청서를 제출', due }]);
  });

  it('연도 없는 날짜가 시행일보다 이른 달이면 다음 해', () => {
    expect(reqs('1. 결과를 1. 5.(화)까지 보고하여 주시기 바랍니다.', '2026. 12. 20.')).toEqual([{ text: '결과를 보고', due: '2027-01-05' }]);
  });

  it('시행일이 없으면 오늘 기준 연도', () => {
    const ex = extractInbox('신청서를 1. 5.까지 제출하여 주시기 바랍니다.', TODAY);
    expect(ex.requests).toEqual([{ text: '신청서를 제출', due: '2027-01-05' }]);
    expect(ex.sent_date).toBeUndefined();
  });

  it('"기한:" 줄은 같은 항목의 요청에 붙는다', () => {
    expect(reqs('1. 다음과 같이 자료를 제출하여 주시기 바랍니다.\n 가. 제출기한: 2026. 10. 23.(금)\n 나. 제출방법: 공문')).toEqual([{ text: '자료를 제출', due: '2026-10-23' }]);
    expect(reqs('1. 수요조사서를 작성하여 제출하여 주시기 바랍니다.\n ㅇ 기한 : 10. 30.')).toEqual([{ text: '수요조사서를 작성하여 제출', due: '2026-10-30' }]);
  });

  it('표의 기한 칸', () => {
    expect(reqs('1. 아래 서류를 제출하여 주시기 바랍니다.\n\n| 구분 | 제출기한 |\n| --- | --- |\n| 신청서 | 2026. 10. 30.(금) |')).toEqual([{ text: '아래 서류를 제출', due: '2026-10-30' }]);
  });

  it('범위 "9월 28일~10월 23일까지 신청" → 끝 날짜, 개조식 줄도 요청', () => {
    expect(reqs('- 9월 28일~10월 23일까지 전국 농·축협으로 신청', '2026. 9. 15.')).toEqual([{ text: '전국 농·축협으로 신청', due: '2026-10-23' }]);
    expect(reqs('나. 2026. 6. 16. (화)까지 인수증 변환(PDF) 첨부하여 공문 제출', '2026. 6. 9.')).toEqual([{ text: '인수증 변환(PDF) 첨부하여 공문 제출', due: '2026-06-16' }]);
  });

  it('강조·밑줄이 감싼 날짜, 배경 절·주어 걷기', () => {
    const body = '2. 의안에 대한 의견을 청취하고자 하니, 소관 부서에서는 붙임 내용을 검토하여 <u>**2026. 6. 10.(수)**</u>까지 의견을 제출하여 주시기 바랍니다.';
    expect(reqs(body, '2026. 6. 9.')).toEqual([{ text: '붙임 내용을 검토하여 의견을 제출', due: '2026-06-10' }]);
  });
});

describe('기한이 아닌 것', () => {
  it('행사 일시는 기한이 아니고, 요청 기한만 잡는다', () => {
    const body = '1. 체육대회를 다음과 같이 개최합니다.\n 가. 일시: 2026. 11. 13.(금) 10:00~17:00\n2. 참가 신청서를 10. 23.(금)까지 제출하여 주시기 바랍니다.';
    expect(reqs(body)).toEqual([{ text: '참가 신청서를 제출', due: '2026-10-23' }]);
  });

  it('참석 요청에 일시만 있으면 기한 없음', () => {
    const ex = extractInbox(letter('1. 아래와 같이 설명회를 개최하오니 참석하여 주시기 바랍니다.\n 가. 일시: 2026. 11. 13.(금) 14:00'), TODAY);
    expect(ex.requests).toEqual([{ text: '설명회 참석' }]);
  });

  it('참고하시기 바랍니다는 할 일이 아니다, 다른 요청이 없으면 협조 요청을 쓴다', () => {
    expect(reqs('1. 자세한 내용은 붙임을 참고하시기 바랍니다.')).toEqual([]);
    expect(reqs('1. 행사가 원활히 진행되도록 협조하여 주시기 바랍니다.')).toEqual([{ text: '행사가 원활히 진행되도록 협조' }]);
  });

  it('요청이 여럿이면 기한 이른 것부터, 문서 기한은 가장 이른 것', async () => {
    const body = '1. 신청서를 10. 30.(금)까지 제출하여 주시기 바랍니다.\n2. 명단은 10. 20.(화)까지 회신하여 주시기 바랍니다.\n3. 결과를 알려 주시기 바랍니다.';
    expect(reqs(body)).toEqual([{ text: '명단 회신', due: '2026-10-20' }, { text: '신청서를 제출', due: '2026-10-30' }, { text: '결과를 알려 주기' }]);
    const p = join(env.work, '여러 요청.txt');
    writeFileSync(p, letter(body));
    const r = await call('inbox_add', { paths: [p] });
    expect(r.items[0].due).toBe('2026-10-20');
    await call('inbox_remove', { id: r.items[0].id });
  });
});

describe('저장·다시 넣기·상태 유지', () => {
  const write = (name: string, body: string) => {
    const p = join(env.work, name);
    writeFileSync(p, letter(body));
    return p;
  };

  it('고친 기한·상태·메모는 다시 넣어도 그대로, 뽑은 값만 갱신', async () => {
    const a = write('가.txt', '1. 신청서를 10. 23.(금)까지 제출하여 주시기 바랍니다.');
    const first = (await call('inbox_add', { paths: [a] })).items[0];
    expect(first).toMatchObject({ id: inboxId(a), due: '2026-10-23', status: 'todo', sender: '가온도' });

    const upd = await call('inbox_update', { id: first.id, status: 'done', note: ' 담당 김가온 ', due: '2026-10-20' });
    expect(upd).toMatchObject({ status: 'done', note: '담당 김가온', due: '2026-10-20' });

    write('가.txt', '1. 신청서를 10. 27.(화)까지 제출하여 주시기 바랍니다.');
    const again = (await call('inbox_add', { paths: [a] })).items[0];
    expect(again).toMatchObject({ id: first.id, added_at: first.added_at, status: 'done', note: '담당 김가온', due: '2026-10-20' });
    expect(again.requests).toEqual([{ text: '신청서를 제출', due: '2026-10-27' }]);

    expect((await call('inbox_update', { id: first.id, due: null })).due).toBe('2026-10-27');
    expect((await call('inbox_update', { id: first.id, due: '' })).due).toBeUndefined();
    expect((await call('inbox_update', { id: first.id, note: '' })).note).toBeUndefined();

    const saved = JSON.parse(readFileSync(join(env.data, 'inbox.json'), 'utf-8'));
    expect(saved.version).toBe(1);
    expect(saved.items.find((x: { id: string }) => x.id === first.id)).toMatchObject({ manual_due: '', status: 'done' });
    // 화면으로는 manual_due 가 나가지 않는다
    expect((await call('inbox_list')).items[0]).not.toHaveProperty('manual_due');

    await expect(call('inbox_update', { id: first.id, due: '10월 23일' })).rejects.toThrow(/연-월-일/);
    await expect(call('inbox_update', { id: 'nope', status: 'done' })).rejects.toThrow(/목록에 없는 공문/);
  });

  it('할 일 먼저 기한 순(기한 없는 것 뒤), 끝난 것은 아래 · 빼기', async () => {
    const b = write('나.txt', '1. 명단을 10. 15.(목)까지 회신하여 주시기 바랍니다.');
    const c = write('다.txt', '1. 행사가 원활히 진행되도록 협조하여 주시기 바랍니다.');
    const d = write('라.txt', '1. 자료를 10. 12.(월)까지 제출하여 주시기 바랍니다.');
    await call('inbox_add', { paths: [b, c, d] });
    await call('inbox_update', { id: inboxId(d), status: 'done' });
    const names = (await call('inbox_list')).items.map((x: { name: string }) => x.name);
    expect(names).toEqual(['나.txt', '다.txt', '라.txt', '가.txt']);

    expect(await call('inbox_remove', { id: inboxId(b) })).toBe(true);
    expect(await call('inbox_remove', { id: inboxId(b) })).toBe(false);
    expect((await call('inbox_list')).items).toHaveLength(3);
  });

  it('맥 경로의 자소 분리(NFD)·완성형(NFC)은 같은 공문', () => {
    const p = join(env.work, '받은 공문.txt');
    expect(inboxId(p.normalize('NFD'))).toBe(inboxId(p.normalize('NFC')));
  });

  it('못 읽는 파일은 failed 에 할 일까지 적는다', async () => {
    const empty = join(env.work, '빈 공문.txt');
    writeFileSync(empty, '   ');
    const sheet = join(env.work, '명부.xlsx');
    writeFileSync(sheet, 'x');
    const r = await call('inbox_add', { paths: [join(env.work, '없는 파일.hwpx'), sheet, empty] });
    expect(r.items).toEqual([]);
    expect(r.failed.map((f: { error: string }) => f.error)).toEqual([
      expect.stringMatching(/찾을 수 없습니다/),
      expect.stringMatching(/읽을 수 없는 형식입니다.*넣으세요/),
      expect.stringMatching(/글자를 읽지 못했습니다.*켜고 다시 넣으세요/),
    ]);
    await expect(call('inbox_add', { paths: [] })).rejects.toThrow(/하나 이상/);
  });
});

describe('실문서 (kordoc 코퍼스, 읽기만)', () => {
  const MOLIT = 'seoul2/36266437_1.+관련+공문.hwpx';
  const KICKOFF = 'seoul2/36268270_결재문서본문_착수보고회(자문회의)+참석+요청.hwpx';
  it.skipIf(!hasCorpus(MOLIT, KICKOFF))('국토교통부 설명회 참석 요청 · 서울시 착수보고회 참석 요청', async () => {
    const r = await call('inbox_add', { paths: [corpus(MOLIT), corpus(KICKOFF)] });
    expect(r.failed).toEqual([]);
    const [molit, kickoff] = r.items;
    expect(molit).toMatchObject({ sender: '국토교통부', doc_number: '국토교통부 지하안전팀-1420', sent_date: '2026-06-04', due: '2026-06-18' });
    expect(molit.requests[0]).toEqual({ text: '붙임 양식을 작성하여 교육담당자에게 제출', due: '2026-06-18' });
    // 회의 일시(6. 16. 16:00)는 기한이 아니다
    expect(kickoff).toMatchObject({ sender: '서울특별시', title: '착수보고회(자문회의) 참석 요청', requests: [{ text: '착수보고회(자문회의) 참석' }] });
    expect(kickoff.due).toBeUndefined();
    expect(existsSync(corpus(MOLIT))).toBe(true);
  }, 30_000);
});
