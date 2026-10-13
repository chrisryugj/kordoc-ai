/** 공문에 인용한 법조문 검증 — 항·호·목, 인용 문장과 조문 내용, 공문 시행일 당시 조문 (가짜 법제처, 실제 인터넷 호출 없음) */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
}));

// AI 는 가짜: aiOn 이 켜지면 연결된 것처럼, ask 는 aiReply 를 돌려준다
const ai = vi.hoisted(() => ({ on: false, calls: [] as Array<{ system?: string; content: string }>, reply: (_c: string) => '{}' }));
vi.mock('../src/infra/llm/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/llm/index.js')>()),
  aiConfigured: () => ai.on,
  ask: async (o: { system?: string; messages: Array<{ content: string }> }) => {
    ai.calls.push({ system: o.system, content: o.messages[0].content });
    return { text: ai.reply(o.messages[0].content), redacted: 0 };
  },
}));

import { updateSettings } from '../src/infra/config.js';
import { findCitations } from '../src/core/law/cite.js';
import { lawCheck } from '../src/core/law/index.js';
import { documentDate, wordDiff } from '../src/core/law/asof.js';
import { citingSentence, contentWords, wordMatch } from '../src/core/law/match.js';
import { findLevel, parseArticle } from '../src/core/law/article.js';
// @ts-expect-error 시험용 JS 모듈 (형식 선언 없음)
import { BODIES, SAMPLE_GONGMUN, startFakeDrf } from './law-fake-drf.mjs';

process.env.KORDOC_AI_DATA_DIR = mkdtempSync(join(tmpdir(), 'kordoc-lawv-'));

let drf: { base: string; requests: URL[]; close: () => Promise<void> };
beforeAll(async () => { drf = await startFakeDrf(); });
afterAll(async () => { await drf.close(); });
beforeEach(async () => {
  ai.on = false;
  ai.calls = [];
  await updateSettings({ law: { oc: 'test-oc' }, privacy: { offline: false } });
});

const TODAY = '2026-10-13';
const check = (text: string, extra: { ai?: boolean; as_of?: string } = {}) => lawCheck({ text, ...extra }, undefined, { base: drf.base, today: TODAY });
type R = Awaited<ReturnType<typeof check>>;
const at = (r: R, article: string) => r.citations.find((c) => c.article === article)!;

describe('인용 찾기: 항·호·목', () => {
  const brief = (t: string) => findCitations(t).map((f) => [f.names[0], f.article, f.paragraph, f.item, f.subitem]);

  it('제17조제1항제2호 · 띄어 쓴 제17조 제1항 제2호가목 · 제2호의3 · 같은 법 · 동법 시행령', () => {
    expect(brief('「가온 개인정보 시험법」 제17조제1항제2호, 같은 법 제2조 제1호 가목 및 동법 시행령 제3조, 같은 법 제5조제2호의3')).toEqual([
      ['가온 개인정보 시험법', '제17조제1항제2호', 1, '2', undefined],
      ['가온 개인정보 시험법', '제2조제1호가목', undefined, '1', '가'],
      ['가온 개인정보 시험법 시행령', '제3조', undefined, undefined, undefined],
      ['가온 개인정보 시험법', '제5조제2호의3', undefined, '2의3', undefined],
    ]);
  });

  it('인용 시작 위치로 인용 문장을 찾는다 (날짜 점은 문장 끝이 아니다)', () => {
    const text = '가. 2026. 3. 2.부터 시행합니다. 「가온 개인정보 시험법」 제17조에 따라 동의를 받아 개인정보를 제3자에게 제공합니다. 다음 문장입니다.';
    const f = findCitations(text)[0];
    expect(citingSentence(text, f.start, f.end, f.texts)).toBe('「가온 개인정보 시험법」 제17조에 따라 동의를 받아 개인정보를 제3자에게 제공합니다.');
    // 내용이 모자란 "근거" 줄이면 다음 줄까지
    const t2 = '근거: 「가온 개인정보 시험법」 제17조\n정보주체의 동의를 받아 개인정보를 제공합니다.';
    const g = findCitations(t2)[0];
    expect(citingSentence(t2, g.start, g.end, g.texts)).toBe('근거: 「가온 개인정보 시험법」 제17조 정보주체의 동의를 받아 개인정보를 제공합니다.');
  });
});

describe('조문 구조 (항번호 ①·호번호 1.·목번호 가., 항 없는 조문)', () => {
  const art17 = parseArticle(BODIES['910002'][3]);
  const art2 = parseArticle(BODIES['910002'][2]);

  it('항·호·목을 찾고, 없는 단계는 쉬운 말로', () => {
    expect(findLevel(art17, { paragraph: 1, item: '1' }, '제17조').text).toBe('1. 정보주체의 동의를 받은 경우');
    expect(findLevel(art17, { paragraph: 5 }, '제17조')).toMatchObject({ missing: 'paragraph', reason: '제17조에 제5항이 없습니다. 제17조는 제3항까지 있습니다.' });
    expect(findLevel(art17, { paragraph: 3 }, '제17조')).toMatchObject({ missing: 'paragraph', deleted: true, reason: '제17조제3항은 삭제된 항입니다(삭제 <2026.6.1>).' });
    expect(findLevel(art17, { paragraph: 1, item: '7' }, '제17조')).toMatchObject({ missing: 'item', reason: '제17조제1항에 제7호가 없습니다. 제2호까지 있습니다.' });
    expect(findLevel(art2, { item: '1', subitem: '나' }, '제2조').text).toMatch(/^나\. 해당 정보만으로는/);
    expect(findLevel(art2, { item: '1', subitem: '다' }, '제2조')).toMatchObject({ missing: 'subitem', reason: '제2조제1호에 다목이 없습니다.' });
    expect(findLevel(art2, { item: '2', subitem: '가' }, '제2조').reason).toBe('제2조제2호에 가목이 없습니다. 목으로 나뉘지 않았습니다.');
    // 항으로 나뉘지 않은 조문의 "제1항"은 조문 몸으로 본다, 제2항은 없다
    expect(findLevel(art2, { paragraph: 1, item: '2' }, '제2조').text).toMatch(/^2\. "처리"란/);
    expect(findLevel(art2, { paragraph: 2 }, '제2조').reason).toBe('제2조에 제2항이 없습니다. 항으로 나뉘지 않은 조문입니다.');
  });
});

describe('낱말 겹침', () => {
  it('인용 글·법령 이름·흔한 말은 빼고, 조사·어미를 뗀다', () => {
    expect(contentWords('「가온 개인정보 시험법」 제17조에 따라 정보주체의 동의를 받아 제공합니다.', ['「가온 개인정보 시험법」 제17조'])).toEqual(['정보주체', '동의', '제공']);
  });

  it('겹침이 아주 적으면 확인 필요 + 겹친 낱말, 문장 낱말이 셋 미만이면 비교하지 않는다', () => {
    const art = '개인정보처리자는 정보주체의 동의를 받은 경우 개인정보를 제3자에게 제공할 수 있다.';
    expect(wordMatch('정보주체의 동의를 받아 개인정보를 제3자에게 제공합니다.', art, [])).toMatchObject({ verdict: 'match', by: 'words', overlap: expect.arrayContaining(['정보주체', '동의', '제공']) });
    expect(wordMatch('주차장 요금 감면 대상 차량을 매월 보고합니다.', art, [])).toMatchObject({ verdict: 'check', score: 0, reason: expect.stringMatching(/같은 낱말이 없습니다/) });
    expect(wordMatch('근거 법령입니다.', art, [])).toBeUndefined();
  });
});

describe('문서 날짜·차이', () => {
  it('시행 줄의 날짜 → 없으면 날짜만 있는 줄·작성일 줄, 본문 속 날짜는 아니다', () => {
    expect(documentDate(SAMPLE_GONGMUN, TODAY)).toEqual({ date: '2026-03-02', source: '시행일' });
    expect(documentDate('보고서\n2025. 12. 1.(월)\n본문', TODAY)).toEqual({ date: '2025-12-01', source: '문서 날짜' });
    expect(documentDate('| 작성일 | 2025. 7. 3. |', TODAY)).toEqual({ date: '2025-07-03', source: '문서 날짜' });
    expect(documentDate('2026. 3. 2.까지 제출하여 주시기 바랍니다.', TODAY)).toBeUndefined();
  });

  it('어절 차이', () => {
    expect(wordDiff('법률에 특별한 규정이 있거나 법령상 의무를 준수하기 위하여 불가피한 경우', '법률에 특별한 규정이 있는 경우')).toEqual({
      removed: ['있거나 법령상 의무를 준수하기 위하여 불가피한'], added: ['있는'],
    });
  });
});

describe('lawCheck: 공문 견본 전체 (가짜 법제처)', () => {
  it('맞음·개정됨·지금은 삭제된 항·없는 항·목·그 당시엔 없던 조문·내용 어긋남·이름 바뀜·없는 조문', async () => {
    const r = await check(SAMPLE_GONGMUN);
    expect(r.checked).toBe(true);
    expect(r).toMatchObject({ as_of: '2026-03-02', as_of_source: '시행일' });

    // 1. 맞음: 인용 문장·인용한 호 원문·조 전체·낱말 겹침
    const c1 = at(r, '제17조제1항제1호');
    expect(c1).toMatchObject({ status: 'ok', paragraph: 1, item: '1', cited_text: '1. 정보주체의 동의를 받은 경우', as_of: '2026-03-02', url: 'https://www.law.go.kr/법령/가온개인정보시험법/제17조' });
    expect(c1.sentence).toBe('「가온 개인정보 시험법」 제17조제1항제1호에 따라 정보주체의 동의를 받은 경우 개인정보를 제3자에게 제공할 수 있습니다.');
    expect(c1.article_full).toMatch(/^① 개인정보처리자는[^\n]*\n1\. 정보주체의 동의를 받은 경우\n2\./);
    expect(c1.match).toMatchObject({ verdict: 'match', by: 'words' });
    expect(c1.changed_since).toBeUndefined();

    // 2. 공문 시행일 뒤 개정 (현행과 다름) + 짧은 차이
    const c2 = at(r, '제17조제1항제2호');
    expect(c2.status).toBe('ok');
    expect(c2.changed_since).toMatchObject({
      kind: 'amended', reason: '공문 시행일(2026. 3. 2.) 이후 개정되었습니다(현행과 다름).',
      then_text: '2. 법률에 특별한 규정이 있거나 법령상 의무를 준수하기 위하여 불가피한 경우',
      removed: ['있거나 법령상 의무를 준수하기 위하여 불가피한'], added: ['있는'],
    });

    // 3. 지금은 삭제된 항, 그 당시엔 있었음
    const c3 = at(r, '제17조제3항');
    expect(c3).toMatchObject({ status: 'article_missing', missing: 'paragraph', reason: '제17조제3항은 삭제된 항입니다(삭제 <2026.6.1>).' });
    expect(c3.changed_since).toMatchObject({ kind: 'deleted_since', reason: '공문 시행일(2026. 3. 2.) 당시에는 있었으나 지금은 삭제된 항입니다.', then_text: '③ 개인정보처리자는 제3자에게 제공한 내역을 기록하고 3년간 보관하여야 한다.' });

    // 4. 없는 항 (그 당시에도 없음)
    expect(at(r, '제17조제5항')).toMatchObject({ status: 'article_missing', missing: 'paragraph', reason: '제17조에 제5항이 없습니다. 제17조는 제3항까지 있습니다. 공문 시행일(2026. 3. 2.) 당시에도 없었습니다.' });

    // 5. 목까지
    expect(at(r, '제2조제1호가목')).toMatchObject({ status: 'ok', item: '1', subitem: '가', cited_text: '가. 성명, 주민등록번호 및 영상 등을 통하여 개인을 알아볼 수 있는 정보' });

    // 6. 그 당시엔 없던 조문
    expect(at(r, '제18조').changed_since).toMatchObject({ kind: 'added_later', reason: '공문 시행일(2026. 3. 2.) 당시에는 없던 조문입니다. 그 뒤에 새로 생겼습니다.' });

    // 7. 내용 어긋남 (낱말이 거의 안 겹침) → 확인 필요
    expect(at(r, '제1조').match).toMatchObject({ verdict: 'check', by: 'words', overlap: [] });

    // 8. 이름 바뀜·없는 조문
    expect(r.citations.find((c) => c.law === '가온 옛이름법')).toMatchObject({ status: 'renamed', current_name: '가온 새이름법', reason: expect.stringMatching(/^법령 이름이 「가온 새이름법」으로 바뀌었습니다/) });
    expect(at(r, '제99조')).toMatchObject({ status: 'article_missing', missing: 'article', reason: '현행 「가온 개인정보 시험법」에 제99조가 없습니다. 조 번호를 확인하세요. 공문 시행일(2026. 3. 2.) 당시에도 없었습니다.' });

    // 확인한 것·못 한 것
    expect(r.checks!.done).toEqual(expect.arrayContaining(['법령 이름', '인용 문장과 조문 내용(낱말 비교)', '공문 시행일(2026. 3. 2.) 당시 조문과 현행 비교']));
    expect(r.checks!.skipped).toContain('AI 판단: AI가 연결되어 있지 않아 낱말 비교만 했습니다');

    // 그 당시 판은 LID + efYd 범위 + 시행일 늦은 순으로 찾고, 본문은 MST + efYd
    const hist = drf.requests.find((u) => u.searchParams.get('target') === 'eflaw' && u.searchParams.get('LID') === '910000')!;
    expect(hist.searchParams.get('efYd')).toBe('19480101~20260302');
    expect(hist.searchParams.get('sort')).toBe('efdes');
    expect(drf.requests.some((u) => u.pathname.endsWith('lawService.do') && u.searchParams.get('target') === 'eflaw' && u.searchParams.get('MST') === '910001' && u.searchParams.get('efYd') === '20240101')).toBe(true);
  });

  it('문서 날짜가 현행 판 시행일 뒤면 연혁을 묻지 않는다, 날짜가 없으면 못 본 것에 밝힌다', async () => {
    const before = drf.requests.filter((u) => u.searchParams.get('target') === 'eflaw').length;
    const r = await check('「가온 주차 시험법」 제5조제1항에 따라 장애인 차량의 주차요금을 감면합니다.\n2026. 9. 1.');
    expect(r.citations[0]).toMatchObject({ status: 'ok', as_of: '2026-09-01' });
    expect(r.citations[0].changed_since).toBeUndefined();
    expect(drf.requests.filter((u) => u.searchParams.get('target') === 'eflaw').length).toBe(before);

    const none = await check('「가온 주차 시험법」 제5조에 따라 장애인 차량의 주차요금을 감면합니다.');
    expect(none.as_of).toBeUndefined();
    expect(none.checks!.skipped).toContain('그 당시 조문: 문서에서 시행일이나 날짜를 찾지 못해 현행 법령과만 대조했습니다');
  });

  it('부른 쪽이 준 날짜(받은 공문 시행일)를 쓴다', async () => {
    const r = await check('「가온 개인정보 시험법」 제20조에 따라 수집 출처를 알립니다.', { as_of: '2025-05-01' });
    expect(r).toMatchObject({ as_of: '2025-05-01', as_of_source: '받은 공문 시행일' });
    expect(at(r, '제20조')).toMatchObject({ status: 'article_missing', missing: 'article' });
    expect(at(r, '제20조').changed_since).toMatchObject({ kind: 'deleted_since', reason: '공문 시행일(2025. 5. 1.) 당시에는 있었으나 지금은 삭제된 조문입니다.' });
  });

  it('그 당시 판을 찾지 못하면 무엇을 못 봤는지 밝힌다', async () => {
    const r = await check('「가온 개인정보 시험법」 제1조에 따라 개인정보의 처리 및 보호에 관한 사항을 정합니다.', { as_of: '2010-01-01' });
    expect(r.citations[0].as_of).toBeUndefined();
    expect(r.checks!.skipped).toContain('공문 시행일(2010. 1. 1.) 당시 조문: 그 당시 시행 중이던 판을 찾지 못해 일부는 비교하지 못했습니다');
  });

  it('폐쇄망: 인용 문장은 보이고, 확인 못 한 것을 하나씩 밝힌다', async () => {
    await updateSettings({ privacy: { offline: true } });
    const n = drf.requests.length;
    const r = await check(SAMPLE_GONGMUN);
    expect(drf.requests.length).toBe(n);
    expect(r.checked).toBe(false);
    expect(at(r, '제17조제3항')).toMatchObject({ status: 'unchecked', paragraph: 3, sentence: expect.stringMatching(/^동법 제17조제3항에 따라/) });
    expect(r.checks).toEqual({
      done: ['인용 찾기(법령 이름·조·항·호·목)'],
      skipped: [
        '법령 이름과 조문이 현행 법령에 있는지: 폐쇄망 모드라 법제처에 묻지 않았습니다',
        '인용 문장과 조문 내용: 법제처 원문을 받지 못해 비교하지 않았습니다',
        '그 당시 조문: 법제처 연혁을 받지 못해 비교하지 않았습니다',
      ],
    });
  });
});

describe('AI 판단 (있을 때만, 건수 상한, 원문은 법제처 것)', () => {
  it('낱말이 덜 겹치는 것부터 최대 5건, 이유의 조문 낱말은 원문에 있는 것만', async () => {
    ai.on = true;
    ai.reply = (content) => (content.includes('주차장')
      ? JSON.stringify({ verdict: 'mismatch', reason: "조문은 '개인정보의 처리 및 보호'를 정할 뿐 주차요금 감면과는 관계가 없습니다 — 다른 근거를 찾으세요.", words: ['개인정보의 처리 및 보호', '주차요금 감면 조항'] })
      : JSON.stringify({ verdict: 'match', reason: "조문의 '동의'와 같은 내용입니다.", words: ['동의'] }));
    const r = await check(SAMPLE_GONGMUN);
    expect(ai.calls.length).toBe(5);
    // 시스템 지시는 고정 문구, 문서·조문은 messages 로 (클라우드 가림 대상)
    expect(ai.calls[0].system).toMatch(/조문에 없는 내용을 지어내거나/);
    expect(ai.calls[0].content).toMatch(/조문\(법제처 원문\)/);
    const c = at(r, '제1조');
    expect(c.match).toMatchObject({ verdict: 'mismatch', by: 'ai', overlap: ['개인정보의 처리 및 보호'] });
    expect(c.match!.reason).not.toMatch(/[—–]/);
    // 법제처 원문은 그대로
    expect(c.cited_text).toBe('이 법은 개인정보의 처리 및 보호에 관한 사항을 정함을 목적으로 한다.');
    expect(r.checks!.done.some((d) => /AI 판단 5건/.test(d))).toBe(true);
  });

  it('ai:false 면 묻지 않고, AI 가 실패하면 낱말 비교를 그대로 둔다', async () => {
    ai.on = true;
    await check(SAMPLE_GONGMUN, { ai: false });
    expect(ai.calls.length).toBe(0);
    ai.reply = () => 'JSON 아님';
    const r = await check(SAMPLE_GONGMUN);
    expect(at(r, '제1조').match).toMatchObject({ by: 'words', verdict: 'check' });
    expect(r.checks!.skipped).toContain('AI 판단: AI가 답하지 못한 인용은 낱말 비교로 두었습니다');
  });
});
