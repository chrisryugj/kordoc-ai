/** 문서와 대화 — 번호 붙인 조각·[n] 인용 → Citation, BM25 검색, 파싱 캐시 (가짜 OpenAI 호환 서버) */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markdownToHwpx } from 'kordoc';
import { startFakeOpenAi, lastUser, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { chatWithDocs, extractCitations } from '../src/core/ai/chat.js';
import { bm25Scores, tokenize } from '../src/core/ai/bm25.js';
import { loadDoc } from '../src/core/ai/docs.js';
import { extractNumbers, indexKeys, splitSentences, verifyCitations } from '../src/core/ai/verify.js';

const dir = mkdtempSync(join(tmpdir(), 'kordoc-ai-chat-'));
process.env.KORDOC_AI_DATA_DIR = dir;
const signal = () => new AbortController().signal;
/** 가짜 모델이 제대로 인용하게 — needle 이 든 조각의 번호 */
const num = (prompt: string, needle: string) => {
  const head = prompt.slice(0, prompt.indexOf(needle));
  return [...head.matchAll(/\[(\d+)\] \(/g)].at(-1)?.[1] ?? '0';
};

let fake: FakeServer;
let reply = (_body: unknown): string => '';

beforeAll(async () => {
  fake = await startFakeOpenAi({ reply: (b) => reply(b) });
  await updateSettings({ ai: { provider: 'openai', openai: { base_url: `${fake.url}/v1`, model: 'test-model' } }, privacy: { offline: false } });
});
afterAll(async () => { await fake.close(); });

describe('BM25 (글자 2-gram)', () => {
  it('한글은 2글자씩, 영문·숫자는 낱말로', () => {
    expect(tokenize('예산집행 2026년 AI')).toEqual(['예산', '산집', '집행', '2026', '년', 'ai']);
  });
  it('조사가 붙어도 어간이 겹치는 글이 위로', () => {
    const s = bm25Scores(['체육대회 예산을 집행한다', '청렴 교육 일정 안내', '예산 편성 지침'], '예산 집행');
    expect(s[0]).toBeGreaterThan(s[2]);
    expect(s[1]).toBe(0);
  });
});

describe('extractCitations', () => {
  const shown = [
    { path: '/a.md', name: 'a.md', page: 2, heading: '개요', text: '행사는 4월 10일에 열린다.\n장소는 구민체육센터다.' },
    { path: '/b.md', name: 'b.md', text: '예산은 150만 원이다.' },
  ];
  it('[n]·[n, m] 을 근거로, 없는 번호도 답에 남기고 path 빈 근거로', () => {
    const r = extractCitations('행사는 4월 10일입니다[1]. 예산은 150만 원입니다 [1, 2]. 없는 번호[9].', shown);
    expect(r.citations.map((c) => c.n)).toEqual([1, 2, 9]);
    expect(r.citations[0]).toMatchObject({ path: '/a.md', page: 2, heading: '개요' });
    expect(r.citations[0].excerpt).toContain('4월 10일');
    expect(r.citations[1]).toMatchObject({ path: '/b.md', excerpt: '예산은 150만 원이다.' });
    expect(r.citations[2]).toMatchObject({ n: 9, path: '', excerpt: '' });
    expect(r.answer).toContain('[9]');
    expect(r.answer).toContain('[1, 2]');
  });
});

describe('인용 검증 (verify)', () => {
  const keys = (t: string) => extractNumbers(t).flatMap((x) => x.keys);
  it('표기 차이를 정규화해 같은 값으로 본다', () => {
    expect(keys('2026. 10. 13.')).toContain('d:2026-10-13');
    expect(keys('2026년 10월 13일')).toContain('d:2026-10-13');
    expect(keys('2026-10-13')).toContain('d:2026-10-13');
    expect(keys('10월 13일')).toEqual(['md:10-13']);
    expect(keys('1,200만 원')).toContain('w:12000000');
    expect(keys('12,000,000원')).toContain('w:12000000');
    expect(keys('1억 2천만 원')).toContain('w:120000000');
    expect(keys('30%')).toContain('p:30');
    expect(keys('30퍼센트')).toContain('p:30');
    expect(keys('오후 2시')).toEqual(['t:14:00']);
    expect(keys('14:00')).toEqual(['t:14:00']);
    expect(keys('민원 14건')).toEqual(['n:14', 'w:14']);
    // 원문 연월일은 월·일, 연·월로도 찾힌다
    const idx = indexKeys('행사는 2026. 4. 10.(금)에 연다. 예산 1,500,000원');
    expect(idx.has('xmd:4-10')).toBe(true);
    expect(idx.has('ym:2026-4')).toBe(true);
    expect(idx.has('w:1500000')).toBe(true);
  });

  it('문장 나누기: 문장 끝 온점 뒤 [n] 은 앞 문장, 날짜 온점에서는 안 자른다', () => {
    expect(splitSentences('신청은 2026. 3. 27.까지입니다. [2] 예산은 150만 원입니다[1].\n- 장소: 대강당 [3]')).toEqual([
      '신청은 2026. 3. 27.까지입니다. [2]', '예산은 150만 원입니다[1].', '- 장소: 대강당 [3]',
    ]);
  });

  it('근거에 없는 숫자는 mismatch·verified false, 정규화된 같은 값은 verified true, 번호 없는 숫자 문장은 unsupported', () => {
    const shown = [
      { path: '/a.md', name: 'a.md', text: '소요 예산은 1,500,000원이다. 행사는 2026. 4. 10.(금) 14:00에 열린다.' },
      { path: '/b.md', name: 'b.md', text: '참가 대상은 본청 직원 약 420명이다.' },
    ];
    const answer = '예산은 150만 원이고 행사는 4월 10일 오후 2시입니다[1]. 대상은 450명입니다[2]. 기념품은 1인당 2,143원입니다. 장소는 미정입니다[9].';
    const raw = extractCitations(answer, shown).citations;
    const r = verifyCitations(answer, shown, raw);
    const by = Object.fromEntries(r.citations.map((c) => [c.n, c]));
    expect(by[1]).toMatchObject({ verified: true });
    expect(by[1].mismatch).toBeUndefined();
    expect(by[2]).toMatchObject({ verified: false, mismatch: ['450명'] });
    expect(by[9]).toMatchObject({ verified: false, path: '' });
    expect(r.unsupported).toEqual(['기념품은 1인당 2,143원입니다.']);
  });

  it('연도가 틀린 날짜는 월·일이 같아도 불일치, 원문이 연도 없이 쓴 월·일은 연도를 붙여도 인정', () => {
    const shown = [{ path: '/a.md', name: 'a.md', text: '행사는 2026. 3. 27.(금)에 열고, 결과 보고는 4. 15.까지 한다.' }];
    const answer = '행사는 2027. 3. 27.입니다[1]. 결과 보고는 2026. 4. 15.까지입니다[1]. 행사는 3월 27일입니다[1].';
    const r = verifyCitations(answer, shown, extractCitations(answer, shown).citations);
    expect(r.citations[0].verified).toBe(false);
    expect(r.citations[0].mismatch).toEqual(['2027. 3. 27.']);
  });
});

describe('ai_chat', () => {
  it('작은 문서는 통째로 번호를 붙여 넣고, 답의 [n] 을 Citation 으로', async () => {
    const a = join(dir, '체육대회.md');
    writeFileSync(a, '# 2026년 체육대회 계획\n\n## 일정\n\n행사는 2026. 4. 10.(금) 14:00에 구민체육센터에서 열린다.\n\n## 예산\n\n소요 예산은 1,500,000원이다.');
    reply = (b) => `체육대회는 2026. 4. 10.에 열립니다[${num(lastUser(b as never), '2026. 4. 10.')}]. 예산은 1,500,000원입니다[${num(lastUser(b as never), '1,500,000원이다')}].`;
    const r = await chatWithDocs({ paths: [a], question: '언제 열리고 예산은 얼마야?' }, signal());
    const sent = lastUser(fake.chats().at(-1)!);
    expect(sent).toContain('[문서 조각: 문서 전체]');
    expect(sent).toMatch(/\[1\] \(체육대회\.md · .*일정\)/);
    expect(r.answer).toContain('[1]');
    expect(r.citations).toHaveLength(2);
    expect(r.citations[0]).toMatchObject({ n: 1, path: a });
    expect(r.citations[0].heading).toContain('일정');
    expect(r.citations[1].excerpt).toContain('1,500,000원');
    expect(r.redacted).toBe(0);
  });

  it('예산보다 큰 문서는 질문과 가까운 조각만 고른다 (BM25)', async () => {
    const big = join(dir, '긴문서.md');
    const filler = Array.from({ length: 60 }, (_, i) => `## 항목 ${i + 1}\n\n${'일반 행정 사무에 관한 내용을 적은 문단입니다. '.repeat(12)}`).join('\n\n');
    writeFileSync(big, `# 종합 계획\n\n${filler}\n\n## 청렴 교육\n\n청렴 교육은 2026. 5. 20.에 전 직원을 대상으로 실시한다.`);
    reply = (b) => `청렴 교육은 2026. 5. 20.에 실시합니다[${num(lastUser(b as never), '청렴 교육은 2026')}].`;
    const r = await chatWithDocs({ paths: [big], question: '청렴 교육은 언제 하나요?' }, signal());
    const sent = lastUser(fake.chats().at(-1)!);
    expect(sent).toMatch(/\[문서 조각: 문서에서 질문과 가까운 부분 \d+곳\]/);
    expect(sent.length).toBeLessThan(12_000); // 8K 컨텍스트 가정 예산 안
    expect(sent).toContain('청렴 교육은 2026. 5. 20.');
    expect(r.citations[0].excerpt).toContain('2026. 5. 20.');
  });

  it('번호를 빼먹은 답은 가장 많이 겹치는 조각을 근거로 단다', async () => {
    const a = join(dir, '체육대회.md');
    reply = () => '예산은 1,500,000원입니다.';
    const r = await chatWithDocs({ paths: [a], question: '예산은?' }, signal());
    expect(r.citations.length).toBeGreaterThan(0);
    expect(r.citations.some((c) => c.excerpt.includes('1,500,000원'))).toBe(true);
  });

  it('이전 대화를 함께 보내고, HWPX 도 쪽·제목이 붙은 조각으로 읽는다', async () => {
    const hwpx = join(dir, '안내.hwpx');
    writeFileSync(hwpx, Buffer.from(await markdownToHwpx('# 주차 안내\n\n## 이용 시간\n\n지하 주차장은 07:00부터 22:00까지 이용할 수 있습니다.')));
    reply = (b) => `07:00부터 22:00까지입니다[${num(lastUser(b as never), '22:00')}].`;
    const r = await chatWithDocs({
      paths: [hwpx],
      question: '그럼 몇 시까지야?',
      history: [{ role: 'user', content: '주차장 있어?' }, { role: 'assistant', content: '네, 지하에 있습니다.' }],
    }, signal());
    const body = fake.chats().at(-1)!;
    expect(body.messages.filter((m) => m.role !== 'system').map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(r.citations[0].path).toBe(hwpx);
    expect(r.citations[0].excerpt).toContain('22:00');
  });

  it('같은 파일은 다시 파싱하지 않는다 (경로+수정시각 캐시)', async () => {
    const a = join(dir, '체육대회.md');
    const d1 = await loadDoc(a, signal());
    const d2 = await loadDoc(a, signal());
    expect(d2).toBe(d1);
    writeFileSync(a, '# 바뀐 문서\n\n내용이 바뀌었습니다.');
    const d3 = await loadDoc(a, signal());
    expect(d3).not.toBe(d1);
    expect(d3.markdown).toContain('바뀐 문서');
  });

  it('인용 검증: 가짜 모델이 틀린 숫자를 근거에 붙이면 verified false·mismatch, 번호 없는 숫자 문장은 unsupported', async () => {
    const f = join(dir, '예산.md');
    writeFileSync(f, '# 예산 계획\n\n## 예산\n\n소요 예산은 1,500,000원이며 복리후생비로 집행한다.\n\n## 일정\n\n참가 신청은 2026. 3. 27.(금)까지 받는다.');
    reply = (b) => {
      const p = lastUser(b as never);
      return `예산은 1,800,000원입니다[${num(p, '1,500,000원')}]. 신청 마감은 3월 27일입니다[${num(p, '2026. 3. 27.')}]. 참가자는 420명으로 예상됩니다.`;
    };
    const r = await chatWithDocs({ paths: [f], question: '예산과 신청 마감은?' }, signal());
    const sent = (await import('./ai-fake-server.js')).systemOf(fake.chats().at(-1)!);
    expect(sent).toContain('근거 조각에 적힌 값 그대로만');
    const budget = r.citations.find((c) => c.excerpt.includes('1,500,000원'))!;
    expect(budget.verified).toBe(false);
    expect(budget.mismatch).toEqual(['1,800,000원']);
    const deadline = r.citations.find((c) => c.excerpt.includes('3. 27.'))!;
    expect(deadline.verified).toBe(true);
    expect(r.unsupported).toEqual(['참가자는 420명으로 예상됩니다.']);
  });

  it('질문·문서가 없으면 안내 오류', async () => {
    await expect(chatWithDocs({ paths: [join(dir, '체육대회.md')], question: ' ' }, signal())).rejects.toThrow(/질문/);
    await expect(chatWithDocs({ paths: [], question: '무엇?' }, signal())).rejects.toThrow(/문서/);
  });
});

describe('selectPassages', () => {
  it('예산이 조각 하나보다 작으면 가장 가까운 조각을 잘라 넣는다', async () => {
    const { selectPassages } = await import('../src/core/ai/docs.js');
    const big = { path: '/x.md', name: 'x.md', text: `청렴 ${'가'.repeat(1300)}` };
    const other = { path: '/x.md', name: 'x.md', text: `예산 ${'나'.repeat(1300)}` };
    const r = selectPassages([other, big], '청렴', 500);
    expect(r.selected).toHaveLength(1);
    expect(r.selected[0].text.startsWith('청렴')).toBe(true);
    expect(r.selected[0].text.length).toBeLessThanOrEqual(400);
  });
});

describe('extractNumbers 경계', () => {
  it('숫자 덩어리 안의 "시"·"월" 은 시각·날짜로 읽지 않는다', () => {
    const ks = extractNumbers('2024시민 참여 112월 3시간').flatMap((t) => t.keys);
    expect(ks.some((k) => k.startsWith('t:'))).toBe(false);
    expect(ks.some((k) => k.startsWith('md:'))).toBe(false);
  });
});
