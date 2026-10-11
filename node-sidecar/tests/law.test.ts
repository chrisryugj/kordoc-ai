/** 법령 근거 확인 — 인용 찾기 + 가짜 법제처(DRF) 서버로 대조·캐시·폐쇄망 (실제 인터넷 호출 없음)
 *
 * 가짜 응답 모양은 2026-10 실측 그대로(LawSearch.law[]·법령.조문.조문단위[]·OC 오류 {"result": ...}).
 * 내용은 시험용이다. 개인정보 보호법 제1조·제17조와 행정업무 규정 이름 바뀜만 실제 응답에서 발췌했다.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { OfflineBlockedError } from '../src/infra/net-guard.js';
import { findCitations } from '../src/core/law/cite.js';
import { lawCheck, lawTest, NOTE_NO_OC, NOTE_OFFLINE } from '../src/core/law/index.js';
import { searchLaws } from '../src/core/law/drf.js';
import { RpcRouter } from '../src/rpc/router.js';
import { registerLaw } from '../src/rpc/methods/law.js';

const DATA = mkdtempSync(join(tmpdir(), 'kordoc-law-'));
process.env.KORDOC_AI_DATA_DIR = DATA;

// ── 가짜 법제처 ──

type Row = { 법령명한글: string; 법령약칭명: string; 법령일련번호: string; 법령ID: string; 현행연혁코드: '현행' | '연혁' };
const row = (name: string, mst: string, id: string, abbr = '', state: '현행' | '연혁' = '현행'): Row =>
  ({ 법령명한글: name, 법령약칭명: abbr, 법령일련번호: mst, 법령ID: id, 현행연혁코드: state });

const CURRENT: Row[] = [
  row('개인정보 보호법', '283839', '011357'),
  row('개인정보 보호법 시행령', '289537', '011468'),
  row('민법', '284415', '001706'),
  row('난민법', '188376', '011546'),
  row('보조금 관리에 관한 법률', '900002', '900002'),
  row('행정업무의 운영 및 혁신에 관한 규정', '290525', '003728', '행정업무규정'),
  row('가온 시험법', '900010', '900010'),
];
const HISTORY: Row[] = [row('행정업무의 효율적 운영에 관한 규정', '173586', '003728', '', '연혁')];

const unit = (jo: string, content: unknown, extra: Record<string, unknown> = {}) => ({ 조문번호: jo, 조문여부: '조문', 조문내용: content, ...extra });
const BODIES: Record<string, unknown[]> = {
  '283839': [
    { 조문번호: '1', 조문여부: '전문', 조문내용: '          제1장 총칙' },
    unit('1', '제1조(목적) 이 법은 개인정보의 처리 및 보호에 관한 사항을 정함으로써 개인의 자유와 권리를 보호하고, 나아가 개인의 존엄과 가치를 구현함을 목적으로 한다. <개정 2014.3.24>', { 조문제목: '목적' }),
    unit('17', '제17조(개인정보의 제공)', {
      조문제목: '개인정보의 제공',
      항: [
        { 항번호: '①', 항내용: '① 개인정보처리자는 다음 각 호의 어느 하나에 해당되는 경우에는 정보주체의 개인정보를 제3자에게 제공(공유를 포함한다. 이하 같다)할 수 있다. <개정 2020.2.4, 2023.3.14>', 호: [{ 호번호: '1.', 호내용: '1. 정보주체의 동의를 받은 경우' }] },
        { 항번호: '③', 항내용: '③ 삭제 <2023.3.14>' },
      ],
    }),
  ],
  '289537': [unit('14', '제14조((시험) 조문) 시험용 본문', { 조문제목: '(시험) 조문', 조문가지번호: '2' })],
  '284415': [unit('750', '제750조((시험) 조문) 시험용 본문', { 조문제목: '(시험) 조문' })],
  '900002': [unit('22', '제22조((시험) 사용 제한) 시험용 본문입니다.', { 조문제목: '(시험) 사용 제한' })],
  '290525': [unit('7', '제7조((시험) 문서의 작성) 시험용 본문', { 조문제목: '(시험) 문서의 작성' })],
  '900010': [unit('1', '제1조(목적) 시험용 목적 조문', { 조문제목: '목적' }), unit('2', '제2조 삭제 <2023.3.14>')],
};

const norm = (s: string) => s.replace(/\s+/g, '').replace(/[·ㆍ]/g, '');
const requests: URL[] = [];
const count = (pred: (u: URL) => boolean = () => true) => requests.filter(pred).length;
let server: Server;
let BASE = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    requests.push(u);
    const p = u.searchParams;
    const json = (v: unknown) => { res.writeHead(200, { 'content-type': 'application/json;charset=UTF-8' }); res.end(JSON.stringify(v)); };
    if (p.get('OC') === 'bad-oc') return json({ result: '사용자 정보 검증에 실패하였습니다.', msg: 'OPEN API 호출 시 사용자 검증을 위하여 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.' });
    if (p.get('type') !== 'JSON') return json({});
    if (u.pathname === '/DRF/lawSearch.do') {
      const q = norm(p.get('query') ?? '');
      if (q.includes('느린')) { setTimeout(() => json({ LawSearch: { totalCnt: '0' } }), 600); return; }
      const hit = (r: Row) => norm(r.법령명한글).includes(q) || (r.법령약칭명 !== '' && norm(r.법령약칭명).includes(q));
      let law: Row[];
      if (p.get('target') === 'law') law = CURRENT.filter(hit);
      else if (p.get('target') === 'eflaw') {
        // 실측: 옛 이름으로 찾아도 같은 법령ID 의 현행 행(바뀐 이름)이 함께 온다
        const ids = new Set([...CURRENT, ...HISTORY].filter(hit).map((r) => r.법령ID));
        law = [...CURRENT, ...HISTORY].filter((r) => ids.has(r.법령ID));
      } else { res.writeHead(200); res.end(''); return; } // target 오타 = 200 + 빈 본문
      return json({ LawSearch: { target: p.get('target'), totalCnt: String(law.length), resultCode: '00', ...(law.length ? { law: law.length === 1 ? law[0] : law } : {}) } });
    }
    if (u.pathname === '/DRF/lawService.do') {
      const units = BODIES[p.get('MST') ?? ''];
      if (!units) return json({ Law: '일치하는 법령이 없습니다. 법령명을 확인하여 주십시오.' });
      return json({ 법령: { 기본정보: { 법령명_한글: '' }, 조문: { 조문단위: units } } });
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/DRF/`;
});
afterAll(async () => { await new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }); });
beforeEach(async () => { await updateSettings({ law: { oc: 'test-oc' }, privacy: { offline: false } }); });

const check = (text: string, opts: { timeoutMs?: number; base?: string } = {}) => lawCheck({ text }, undefined, { base: BASE, ...opts });
const pick = (r: Awaited<ReturnType<typeof check>>, law: string, article?: string) => r.citations.find((c) => c.law === law && c.article === article);

// ── 인용 찾기 ──

describe('findCitations (인용 찾기, 인터넷 없이)', () => {
  const brief = (text: string) => findCitations(text).map((f) => [f.names[0], f.article ?? '', f.texts[0]]);

  it('「법령명」 제N조의N 제N항 제N호, 원문 인용 글 그대로', () => {
    expect(brief('「개인정보 보호법」 제17조제1항제2호와 「민법」 제750조의2 제3항에 따라')).toEqual([
      ['개인정보 보호법', '제17조제1항제2호', '「개인정보 보호법」 제17조제1항제2호'],
      ['민법', '제750조의2제3항', '「민법」 제750조의2 제3항'],
    ]);
  });

  it('같은 법·동법·같은 영·같은 법 시행령은 바로 앞 법령으로', () => {
    expect(brief('「개인정보 보호법」 제17조 및 같은 법 시행령 제14조의2, 동법 제18조')).toEqual([
      ['개인정보 보호법', '제17조', '「개인정보 보호법」 제17조'],
      ['개인정보 보호법 시행령', '제14조의2', '같은 법 시행령 제14조의2'],
      ['개인정보 보호법', '제18조', '동법 제18조'],
    ]);
    // 규정(대통령령) 뒤의 같은 영은 그 규정
    expect(brief('「행정업무의 운영 및 혁신에 관한 규정」 제7조\n같은 영 제8조')[1]).toEqual(['행정업무의 운영 및 혁신에 관한 규정', '제8조', '같은 영 제8조']);
    // 앞 법령이 없으면 찾지 않는다
    expect(brief('같은 법 제3조에 따라')).toEqual([]);
  });

  it('제48조, 제49조(제목) 및 제53조 — 이어지는 조문은 앞 법령', () => {
    expect(brief('「지방공무원법」 제48조, 제49조(성실 의무) 및 제53조를 지킨다').map((x) => x[1])).toEqual(['제48조', '제49조', '제53조']);
    expect(findCitations('「지방공무원법」 제48조, 제49조').every((f) => f.names[0] === '지방공무원법')).toBe(true);
  });

  it('따옴표 없는 ○○법·시행령, 앞의 조사·접속어는 떼고 이름 안 어절은 살린다', () => {
    expect(brief('이 사업은 보조금 관리에 관한 법률 제22조에 따라, 도로교통법 시행령 제5조도 본다')).toEqual([
      ['보조금 관리에 관한 법률', '제22조', '보조금 관리에 관한 법률 제22조'],
      ['도로교통법 시행령', '제5조', '도로교통법 시행령 제5조'],
    ]);
    expect(brief('계약은 국가를 당사자로 하는 계약에 관한 법률 제5조를 따른다')[0][0]).toBe('국가를 당사자로 하는 계약에 관한 법률');
    // 앞 어절 경계가 불확실하면 짧은 후보도 둔다 (대조 단계가 고른다)
    expect(findCitations('운전자가 도로교통법 제5조')[0].names).toEqual(['운전자가 도로교통법', '도로교통법']);
  });

  it('표·괄호 안, HTML 칸, 『』·“” 따옴표, 「법령명」 시행령', () => {
    expect(brief('| 근거 | 「전자정부법」 제99조 |\n<td>(「민법」<br>제1조 참조)</td>').map((x) => x[0])).toEqual(['전자정부법', '민법']);
    expect(brief('『민법』 제1조, “행정업무규정” 제7조')).toEqual([['민법', '제1조', '『민법』 제1조'], ['행정업무규정', '제7조', '“행정업무규정” 제7조']]);
    expect(brief('「개인정보 보호법」 시행령 제14조')[0]).toEqual(['개인정보 보호법 시행령', '제14조', '「개인정보 보호법」 시행령 제14조']);
    expect(brief('「개인정보 보호법」(이하 "법"이라 한다) 제17조')[0][1]).toBe('제17조');
  });

  it('중복은 한 번, 조문을 인용한 법령의 "법령만 인용"은 빼고, 법령이 아닌 것은 무시', () => {
    expect(brief('「민법」에 따라 「민법」 제750조와 민법 제750조, 「민법」 제750조')).toEqual([['민법', '제750조', '「민법」 제750조']]);
    expect(brief('「개인정보 보호법」에 따라 처리한다')).toEqual([['개인정보 보호법', '', '「개인정보 보호법」']]);
    expect(brief('「2026년 업무계획」 제3조, 이 법 제3조, 위 법 제2조, 관계 법령 제1조, 「행정안전부 훈령」, 「법령 개정안」')).toEqual([]);
  });
});

// ── 대조 (가짜 법제처) ──

describe('lawCheck (가짜 법제처 대조)', () => {
  it('ok — 조문 제목·앞부분·법제처 화면 주소, 개정 표시는 뺀다', async () => {
    const r = await check('「개인정보 보호법」 제17조제1항에 따라 제공한다.');
    expect(r.checked).toBe(true);
    expect(r.note).toBeUndefined();
    const c = r.citations[0];
    expect(c).toMatchObject({ text: '「개인정보 보호법」 제17조제1항', law: '개인정보 보호법', article: '제17조제1항', status: 'ok', article_title: '개인정보의 제공', url: 'https://www.law.go.kr/법령/개인정보보호법/제17조' });
    expect(c.article_text).toMatch(/^① 개인정보처리자는 다음 각 호의/);
    expect(c.article_text).not.toMatch(/개정 2020/);
    expect(c.article_text!.length).toBeLessThanOrEqual(161);
  });

  it('article_missing — 없는 조문, 삭제된 조문(삭제 날짜를 보여 줌)', async () => {
    const r = await check('「가온 시험법」 제99조와 같은 법 제2조, 같은 법 제1조');
    expect(pick(r, '가온 시험법', '제99조')).toMatchObject({ status: 'article_missing', url: 'https://www.law.go.kr/법령/가온시험법' });
    expect(pick(r, '가온 시험법', '제99조')!.article_text).toBeUndefined();
    expect(pick(r, '가온 시험법', '제2조')).toMatchObject({ status: 'article_missing', article_text: '삭제 <2023.3.14>' });
    expect(pick(r, '가온 시험법', '제1조')).toMatchObject({ status: 'ok', article_title: '목적' });
    // 같은 법령은 검색 1번·조문 1번만
    expect(count((u) => u.searchParams.get('query') === '가온 시험법')).toBe(1);
    expect(count((u) => u.searchParams.get('MST') === '900010')).toBe(1);
  });

  it('renamed — 옛 이름이면 현행 이름을 알려 준다', async () => {
    const r = await check('「행정업무의 효율적 운영에 관한 규정」 제7조에 따라');
    expect(r.citations[0]).toMatchObject({ status: 'renamed', law: '행정업무의 효율적 운영에 관한 규정', current_name: '행정업무의 운영 및 혁신에 관한 규정', url: 'https://www.law.go.kr/법령/행정업무의운영및혁신에관한규정' });
    expect(r.checked).toBe(true);
  });

  it('not_found — 비슷한 현행 법령이 있으면 current_name, 지어낸 이름은 비움', async () => {
    const r = await check('「개인정보 보호법 시행규칙」 제3조, 「가상 진흥법」 제1조');
    expect(pick(r, '개인정보 보호법 시행규칙', '제3조')).toMatchObject({ status: 'not_found', current_name: '개인정보 보호법 시행령' });
    expect(pick(r, '가상 진흥법', '제1조')!.status).toBe('not_found');
    expect(pick(r, '가상 진흥법', '제1조')!.current_name).toBeUndefined();
    expect(pick(r, '가상 진흥법', '제1조')!.url).toBeUndefined();
  });

  it('띄어쓰기·약칭이 달라도 같은 법령, 부분 일치(민법→난민법)는 고르지 않는다', async () => {
    const r = await check('개인정보보호법 제1조, “행정업무규정” 제7조, 「민법」에 따라');
    expect(pick(r, '개인정보보호법', '제1조')).toMatchObject({ status: 'ok', article_title: '목적' });
    expect(pick(r, '행정업무규정', '제7조')).toMatchObject({ status: 'ok', url: 'https://www.law.go.kr/법령/행정업무의운영및혁신에관한규정/제7조' });
    expect(pick(r, '민법')).toMatchObject({ status: 'ok', url: 'https://www.law.go.kr/법령/민법' });
  });

  it('따옴표 없는 이름은 정확히 같은 후보로 (앞 어절이 섞여도)', async () => {
    const r = await check('이 사업은 보조금 관리에 관한 법률 제22조에 따라 추진하고, 운전자가 민법 제1조');
    expect(pick(r, '보조금 관리에 관한 법률', '제22조')).toMatchObject({ text: '보조금 관리에 관한 법률 제22조', status: 'ok' });
    expect(r.citations.find((c) => c.article === '제1조')).toMatchObject({ law: '민법', text: '민법 제1조', status: 'article_missing' });
  });

  it('조례는 묻지 않고 확인 안 함 + 안내', async () => {
    const before = count();
    const r = await check('「가온시 주차장 설치 및 관리 조례」 제3조');
    expect(r.citations[0]).toMatchObject({ status: 'unchecked', law: '가온시 주차장 설치 및 관리 조례' });
    expect(r.citations[0].url).toBeUndefined();
    expect(r.checked).toBe(false);
    expect(r.note).toMatch(/자치법규/);
    expect(count()).toBe(before);
  });

  it('인용이 없으면 안내만', async () => {
    const r = await check('이 문서에는 법령 인용이 없습니다.');
    expect(r).toEqual({ citations: [], checked: false, note: expect.stringMatching(/찾지 못했습니다/) });
  });
});

describe('lawCheck — 묻지 못할 때는 인용만 (unchecked)', () => {
  const TEXT = '「개인정보 보호법」 제17조와 「민법」 제1조';

  it('폐쇄망 모드: 법제처에 아무것도 묻지 않는다', async () => {
    await updateSettings({ privacy: { offline: true } });
    const before = count();
    const r = await check(TEXT);
    expect(r.checked).toBe(false);
    expect(r.note).toBe(NOTE_OFFLINE);
    expect(r.note).toBe('폐쇄망 모드라 법제처에 묻지 않았습니다. 인용만 찾았습니다.');
    expect(r.citations.map((c) => c.status)).toEqual(['unchecked', 'unchecked']);
    expect(r.citations[0].url).toBe('https://www.law.go.kr/법령/개인정보보호법/제17조');
    expect(count()).toBe(before);
  });

  it('폐쇄망 모드면 통신 관문(assertAllowed)이 외부 주소를 막는다', async () => {
    await updateSettings({ privacy: { offline: true } });
    await expect(searchLaws('law', '민법', { oc: 'test-oc', base: 'http://203.0.113.1/DRF/', fresh: true })).rejects.toBeInstanceOf(OfflineBlockedError);
  });

  it('OC 없음: 설정 안내', async () => {
    await updateSettings({ law: { oc: '  ' } });
    const r = await check(TEXT);
    expect(r).toMatchObject({ checked: false, note: NOTE_NO_OC });
    expect(r.note).toBe('설정 › 법령 확인에서 법제처 Open API 아이디(OC)를 넣으면 현행 법령과 대조합니다.');
  });

  it('OC 를 법제처가 확인하지 못하면(200 + result) 대조하지 않고 아이디 안내', async () => {
    await updateSettings({ law: { oc: 'bad-oc' } });
    const r = await check('「개인정보 보호법」 제1조와 「난민법」 제2조');
    expect(r.checked).toBe(false);
    expect(r.note).toMatch(/아이디\(OC\)를 확인하지 못해/);
    expect(r.citations.every((c) => c.status === 'unchecked')).toBe(true);
  });

  it('연결 실패: 그 인용만 확인 안 함 + 인터넷 안내', async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const port = (dead.address() as AddressInfo).port;
    await new Promise<void>((r) => dead.close(() => r()));
    const r = await check('「연결 시험 하나법」 제1조, 「연결 시험 둘법」 제1조, 「연결 시험 셋법」 제1조', { base: `http://127.0.0.1:${port}/DRF/` });
    expect(r.checked).toBe(false);
    expect(r.citations.map((c) => c.status)).toEqual(['unchecked', 'unchecked', 'unchecked']);
    expect(r.note).toMatch(/인터넷 연결을 확인/);
  });

  it('시간 초과: 확인 안 함 (기다리다 멈추지 않는다)', async () => {
    const t0 = Date.now();
    const r = await check('「느린 응답법」 제1조', { timeoutMs: 150 });
    expect(r.citations[0].status).toBe('unchecked');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('캐시 — 같은 법령을 문서마다 다시 묻지 않는다', () => {
  const TEXT = '「개인정보 보호법 시행령」 제14조의2';

  it('메모리 → 파일(law-cache.json, 다시 켜도) → 24시간 지나면 다시 묻는다', async () => {
    const asked = () => count((u) => u.searchParams.get('query') === '개인정보 보호법 시행령' || u.searchParams.get('MST') === '289537');
    const first = await check(TEXT);
    expect(first.citations[0]).toMatchObject({ status: 'ok', article_title: '(시험) 조문', url: 'https://www.law.go.kr/법령/개인정보보호법시행령/제14조의2' });
    expect(asked()).toBe(2); // 검색 1 + 조문 1
    await check(TEXT);
    expect(asked()).toBe(2);
    expect(existsSync(join(DATA, 'law-cache.json'))).toBe(true);

    // 앱을 다시 켠 것처럼 모듈을 새로 읽는다 (메모리 캐시 없음 → 파일에서)
    vi.resetModules();
    const fresh = await import('../src/core/law/index.js');
    const again = await fresh.lawCheck({ text: TEXT }, undefined, { base: BASE });
    expect(again.citations[0].status).toBe('ok');
    expect(asked()).toBe(2);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
      await fresh.lawCheck({ text: TEXT }, undefined, { base: BASE });
      expect(asked()).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('lawTest·RPC', () => {
  it('민법 검색이 되면 ok, 캐시를 쓰지 않는다', async () => {
    const before = count((u) => u.searchParams.get('query') === '민법');
    expect(await lawTest(undefined, { base: BASE })).toEqual({ ok: true });
    expect(await lawTest(undefined, { base: BASE })).toEqual({ ok: true });
    expect(count((u) => u.searchParams.get('query') === '민법')).toBe(before + 2);
  });

  it('아이디 오류·OC 없음·폐쇄망은 ok:false 와 할 일', async () => {
    await updateSettings({ law: { oc: 'bad-oc' } });
    expect((await lawTest(undefined, { base: BASE })).error).toMatch(/아이디\(OC\)를 확인하지 못했습니다.*IP 주소/);
    await updateSettings({ law: { oc: '' } });
    expect(await lawTest(undefined, { base: BASE })).toMatchObject({ ok: false, error: expect.stringMatching(/아이디\(OC\)를 넣고 저장/) });
    await updateSettings({ law: { oc: 'test-oc' }, privacy: { offline: true } });
    expect(await lawTest(undefined, { base: BASE })).toMatchObject({ ok: false, error: expect.stringMatching(/폐쇄망 모드/) });
  });

  it('RPC law_check: 글·파일 경로, 둘 다 없으면 할 일을 알려 주는 오류', async () => {
    await updateSettings({ law: { oc: '' } });
    const router = new RpcRouter();
    registerLaw(router);
    const byText = await router.dispatch('law_check', { text: '「민법」 제1조' }, 1);
    expect(byText.result).toMatchObject({ checked: false, citations: [{ law: '민법', article: '제1조', status: 'unchecked' }] });
    const file = join(DATA, '공문.txt');
    writeFileSync(file, '근거: 「개인정보 보호법」 제17조\n', 'utf-8');
    const byPath = await router.dispatch('law_check', { path: file }, 2);
    expect(byPath.result).toMatchObject({ citations: [{ text: '「개인정보 보호법」 제17조' }] });
    const none = await router.dispatch('law_check', {}, 3);
    expect(none.error?.message).toBe('확인할 글이나 파일을 넣으세요.');
    const test = await router.dispatch('law_test', {}, 4);
    expect(test.result).toMatchObject({ ok: false });
  });
});
