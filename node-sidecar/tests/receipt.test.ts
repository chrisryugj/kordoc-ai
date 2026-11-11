/** 영수증으로 지출조서 — 값 뽑기 규칙(글 줄), 합성 영수증 OCR 정확도, 지출조서 HWPX·TSV·HTML, 기관 서식 학습·채우기 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { amountsIn, brnValid, dateIn, findItems, linesFromMarkdown, linesFromOcr, looksRefund, maskCardLines, parseReceipt, purposeOf, type ReceiptLine } from '../src/core/receipt/parse.js';
import { dateText } from '../src/core/receipt/report.js';
import { fieldOf } from '../src/core/receipt/template.js';
import { ocrModelsReady } from '../src/core/system/index.js';
import { call, setupEnv } from './doc-helpers.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'receipts');
const EXPECTED = JSON.parse(readFileSync(join(FX, 'expected.json'), 'utf-8')) as Record<string, {
  date: string; vendor: string; brn: string; total: number; vat?: number; supply?: number; payment?: string; approval?: string; card?: string; items: number; via?: string;
}>;
const L = (...rows: Array<string | string[]>): ReceiptLine[] => rows.map((r) => (Array.isArray(r) ? { text: r.join(' '), cells: r, confidence: 1 } : { text: r, cells: [r], confidence: 1 }));

let env: ReturnType<typeof setupEnv>;
beforeAll(() => { env = setupEnv(); });

describe('값 뽑기 규칙', () => {
  it('날짜: 여러 꼴, 시각이 붙어 읽혀도, 두 자리 연도, 전화·사업자번호는 날짜 아님', () => {
    expect(dateIn('[등록]2026-10-2814:32:10')).toBe('2026-10-28');
    expect(dateIn('2026/11/0212:05:33')).toBe('2026-11-02');
    expect(dateIn('일자:2026.10.30.(금)12:41')).toBe('2026-10-30');
    expect(dateIn('2026년11월3일')).toBe('2026-11-03');
    expect(dateIn('26.11.04 15:20')).toBe('2026-11-04');
    expect(dateIn('TEL 031-000-1234')).toBeNull();
    expect(dateIn('105-12-00347')).toBeNull();
    expect(dateIn('2026-13-01')).toBeNull();
  });

  it('금액: 쉼표·점 꼴, ₩·W 떼기, 날짜·시각·카드·사업자번호는 금액 아님', () => {
    expect(amountsIn('W36,000')).toEqual([36000]);
    expect(amountsIn('합계 23.800')).toEqual([23800]);
    expect(amountsIn('2026-10-28 14:32 5,300')).toEqual([5300]);
    expect(amountsIn('카드 4518-****-****-2201')).toEqual([]);
    expect(amountsIn('사업자 129-33-00668')).toEqual([]);
  });

  it('사업자등록번호 검증 숫자 (가짜 시험 번호는 틀리게 만든다)', () => {
    expect(brnValid('1048100003')).toBe(false);
    // 검증 숫자 규칙: 가중치 1,3,7,1,3,7,1,3,5 + 9번째×5/10
    const d9 = '123456789';
    const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
    let s = [...d9].reduce((a, c, i) => a + Number(c) * w[i], 0) + Math.floor((9 * 5) / 10);
    s = (10 - (s % 10)) % 10;
    expect(brnValid(`${d9}${s}`)).toBe(true);
  });

  it('합계: 받은금액·거스름돈보다 받을금액, 합계수량·과세물품가액은 합계 아님', () => {
    const { fields } = parseReceipt(L(['한빛식당'], ['품명', '수량', '단가', '금액'], ['김치찌개', '2', '9,000', '18,000'], ['합계수량', '2'], ['과세물품가액', '16,364'],
      ['받을금액', '18,000'], ['받은금액(현금)', '50,000'], ['거스름돈', '32,000']));
    expect(fields.total?.value).toBe('18000');
    expect(fields.total!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(fields.payment?.value).toBe('현금');
  });

  it('칸 머리 아래 줄의 값 (간이영수증 "공급대가총액")', () => {
    const { fields } = parseReceipt(L(['작성년월일', '공급대가총액'], ['2026년11월3일', 'W36,000'], ['상호', '한결인쇄']));
    expect(fields.date?.value).toBe('2026-11-03');
    expect(fields.vendor?.value).toBe('한결인쇄');
  });

  it('카드번호는 앞 네 자리만, 승인번호는 다음 줄에 있어도', () => {
    const { fields } = parseReceipt(L('카드 4518-****-****-2201 승인', '77001234'));
    expect(fields.card?.value).toBe('4518-****-****-****');
    expect(fields.approval?.value).toBe('77001234');
    expect(fields.payment?.value).toBe('카드');
  });

  it('품목: 수량·단가가 붙어 읽힌 것을 금액에 맞춰 가른다, 적요는 첫 품목 + 외 n건', () => {
    const items = findItems(L(['품명', '수량 단가', '금액'], ['삼각김밥 참치', '21,3002,600'], ['테이프', '21,200', '2,400'], ['생수500ml', '6', '900 5,400'], ['합계', '10,400']));
    expect(items).toEqual([
      { name: '삼각김밥 참치', qty: 2, unit_price: 1300, amount: 2600 },
      { name: '테이프', qty: 2, unit_price: 1200, amount: 2400 },
      { name: '생수500ml', qty: 6, unit_price: 900, amount: 5400 },
    ]);
    expect(purposeOf(items).value).toBe('삼각김밥 참치 외 2건');
    expect(purposeOf([]).value).toBe('');
  });

  it('가게 이름: 이름표 > 위쪽 큰 글, 머리 글(영수증·매출전표)은 뺀다', () => {
    expect(parseReceipt(L('가온서점 전자영수증', '거래일: 2026-10-25')).fields.vendor?.value).toBe('가온서점');
    const ocr = linesFromOcr({ lines: [
      { text: '신용카드', box: { x: 10, y: 10, w: 100, h: 33 }, confidence: 1 },
      { text: '매출전표', box: { x: 120, y: 10, w: 100, h: 33 }, confidence: 1 },
      { text: '가맹점명', box: { x: 10, y: 300, w: 100, h: 25 }, confidence: 1 },
      { text: '가온문구', box: { x: 300, y: 301, w: 100, h: 25 }, confidence: 0.9 },
    ] });
    expect(ocr.map((l) => l.text)).toEqual(['신용카드 매출전표', '가맹점명 가온문구']);
    const v = parseReceipt(ocr).fields.vendor!;
    expect(v.value).toBe('가온문구');
    expect(v.source).toBe('가맹점명 가온문구');
  });

  it('사용자가 고친 날짜 꼴도 공문 날짜로, 서식 칸 이름 동의어', () => {
    expect(['2026-10-28', '2026.10.28', '2026/1/5', '2026년 10월 28일', '2026. 10. 28.'].map(dateText)).toEqual(['2026. 10. 28.', '2026. 10. 28.', '2026. 1. 5.', '2026. 10. 28.', '2026. 10. 28.']);
    expect(dateText('10월 말')).toBe('10월 말');
    expect(['지출일자', '사용 일자', '거래처(상호)', '지출금액(원)', '사용내역', '결제 수단', '사업자 등록번호', '확인'].map(fieldOf))
      .toEqual(['date', 'date', 'vendor', 'amount', 'purpose', 'payment', 'brn', '']);
    // '번호'가 들었다고 연번 칸이 아니다 (연번이 전화번호·승인번호 칸에 들어가면 안 된다)
    expect(['연번', '번호', '순번', '카드 승인번호', '전화번호', '계좌번호', '문서번호'].map(fieldOf)).toEqual(['seq', 'seq', 'seq', 'approval', '', '', '']);
  });

  it('취소·환불 전표: 금액은 읽되 사람이 보게 낮은 믿음으로. 안내 글의 "환불"만으로는 취소 전표로 보지 않는다', () => {
    const cancelled = parseReceipt(L('가온문구', '승인취소', '합계 -11,000', '공급가액 10,000', '부가세 1,000'));
    expect(cancelled.fields.total?.value).toBe('11000');
    expect(cancelled.fields.total!.confidence).toBeLessThan(0.8);
    expect(looksRefund(['가온문구', '합계 △11,000'], '합계 △11,000')).toBe(true);
    expect(looksRefund(['가온문구', '합계 11,000', '교환·환불은 7일 이내 영수증 지참'], '합계 11,000')).toBe(false);
    for (const line of ['거래종류 신용취소', '[취소]', '취소금액 11,000', '카드취소', '반품', '현금영수증 취소']) expect(looksRefund(['가온문구', line], '합계 11,000'), line).toBe(true);
    for (const total of ['합계 -11000', '합계 -11.000', '합계 -500', '합계금액-11,000', '합계 -11,000원']) expect(looksRefund(['가온문구'], total), total).toBe(true);
    for (const line of ['결제취소 시 영수증 지참', '거래취소는 14일 이내', '카드취소 문의 02-123-4567']) expect(looksRefund(['가온문구', line], '합계 11,000'), line).toBe(false);
    for (const total of ['합계 11,000', '2026-10-23 합계 11,000', '승인번호 1234-5678']) expect(looksRefund(['가온문구'], total), total).toBe(false);
    const normal = parseReceipt(L('가온문구', '합계 11,000', '공급가액 10,000', '부가세 1,000', '교환·환불은 7일 이내 영수증 지참'));
    expect(normal.fields.total!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('이름표와 금액이 한 조각("합계 18,000")이어도 그 줄의 금액 (다음 줄 받은금액을 합계로 잡지 않는다)', () => {
    const { fields } = parseReceipt(L('가온문구', '합계 18,000', '받은금액 20,000', '거스름돈 2,000', '공급가액 16,364', '부가세 1,636'));
    expect(fields.total?.value).toBe('18000');
    expect(fields.supply?.value).toBe('16364');
    expect(fields.vat?.value).toBe('1636');
    // 글자층 PDF 의 표 아닌 줄도 한 조각
    expect(parseReceipt(linesFromMarkdown('가온서점\n\n총 결제금액 18,000원\n\n받은금액 20,000원')).fields.total?.value).toBe('18000');
  });

  it('날짜: 없는 날(2월 30일·4월 31일)은 날짜로 잡지 않는다', () => {
    expect(dateIn('2026-02-30')).toBeNull();
    expect(dateIn('2026.04.31')).toBeNull();
    expect(dateIn('26.02.29')).toBeNull();
    expect(dateIn('2026-02-30 2024-02-29')).toBe('2024-02-29');
  });

  it('마크다운의 그림 자리 글(![image](…))은 영수증 줄이 아니다', () => {
    expect(linesFromMarkdown('![image](image_001.png)')).toEqual([]);
  });

  it('사업자번호: 검증 숫자가 틀리면 신뢰도를 0.8 아래로 (사람이 확인하게), 맞으면 높게', () => {
    const d9 = '317040052';
    const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
    const s = [...d9].reduce((a, c, i) => a + Number(c) * w[i], 0) + Math.floor((Number(d9[8]) * 5) / 10);
    const good = `${d9}${(10 - (s % 10)) % 10}`;
    const bad = `${d9}${(Number(good[9]) + 1) % 10}`;
    const fmt = (d: string) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    const ok = parseReceipt(L(['사업자번호', fmt(good)])).fields.brn!;
    const ng = parseReceipt(L(['사업자번호', fmt(bad)])).fields.brn!;
    expect(ok.value).toBe(fmt(good));
    expect(ok.confidence).toBeGreaterThanOrEqual(0.9);
    expect(ng.value).toBe(fmt(bad));
    expect(ng.confidence).toBeLessThan(0.8);
  });

  it('사업자번호가 여럿이면 카드사·결제대행(VAN) 쪽이 아닌 가게 쪽 번호', () => {
    const { fields } = parseReceipt(L(['신용카드 매출전표'], ['매입사', '한빛카드'], ['사업자번호', '110-81-00012'], ['카드번호', '4012-34**-****-5678'],
      ['합계', '22,000'], ['가맹점명', '바른사무'], ['사업자번호', '208-11-00336'], ['대표자명', '오바른']));
    expect(fields.brn?.value).toBe('208-11-00336');
    expect(parseReceipt(L(['VAN사 KICC 사업자번호 120-86-00018'], ['가온문구'], ['사업자 317-04-00528'])).fields.brn?.value).toBe('317-04-00528');
    expect(parseReceipt(L(['가맹점번호 00123456 사업자번호 120-86-00018'], ['상호', '가온문구'], ['사업자등록번호', '317-04-00528'])).fields.brn?.value).toBe('317-04-00528');
    // 하나뿐이면 그대로
    expect(parseReceipt(L(['매입사 한빛카드'], ['사업자번호', '110-81-00012'])).fields.brn?.value).toBe('110-81-00012');
  });

  it('합계: "(부가세포함)"·"(VAT포함)" 이 붙은 합계·총액도 합계 후보', () => {
    for (const label of ['합계(부가세포함)', '총액(VAT포함)', '합계금액(부가세 포함)']) {
      const { fields } = parseReceipt(L(['가온문구'], ['공급가액', '20,000'], ['부가세', '2,000'], [label, '22,000'], ['받은금액', '50,000'], ['거스름돈', '28,000']));
      expect(fields.total?.value, label).toBe('22000');
      expect(fields.total!.confidence, label).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('합계: "부가세"·"부가세액"·"과세물품가액" 단독 줄은 합계 아님', () => {
    for (const label of ['부가세', '부가세액', '과세물품가액', '부가세(VAT포함)']) {
      const { fields } = parseReceipt(L(['가온문구'], [label, '2,000'], ['결제금액', '22,000']));
      expect(fields.total?.value, label).toBe('22000');
    }
    expect(parseReceipt(L(['가온문구'], ['부가세액', '2,000'])).fields.total?.confidence ?? 0).toBeLessThan(0.8);
  });

  it('카드번호는 근거 줄(source)·읽은 줄에서도 앞 네 자리만', () => {
    const lines = L(['카드번호', '5412-3456-7890-1234'], ['신용카드', '23,800'], '카드 4518 3456 7890 2201 승인 77001234', ['합계', '23,800']);
    const { fields } = parseReceipt(lines);
    expect(fields.card?.value).toBe('5412-****-****-****');
    expect(fields.card?.source).toBe('카드번호 5412-****-****-****');
    expect(fields.approval?.source).toBe('카드 4518 **** **** **** 승인 77001234');
    expect(fields.approval?.value).toBe('77001234');
    const masked = maskCardLines(lines);
    expect(masked.map((l) => l.text).join('\n')).not.toMatch(/3456|7890|1234-|2201/);
    expect(masked[0].cells).toEqual(['카드번호', '5412-****-****-****']);
    // 카드번호가 아닌 숫자(사업자번호·전화·금액·승인번호)는 그대로
    expect(maskCardLines(L('사업자 129-33-00668 TEL 031-000-1234 합계 51,700 승인 77001234'))[0].text).toBe('사업자 129-33-00668 TEL 031-000-1234 합계 51,700 승인 77001234');
  });

  it('마크다운 표 → 칸 (글자층 PDF)', () => {
    const lines = linesFromMarkdown('## 가온서점\n\n| 품명 | 수량 | 단가 | 금액 |\n| --- | --- | --- | --- |\n| 공문서 작성 실무 | 1 | 18,000 | 18,000 |\n| 총 결제금액 |  |  | 18,000 |');
    expect(lines[1].cells).toEqual(['품명', '수량', '단가', '금액']);
    expect(parseReceipt(lines).fields.total?.value).toBe('18000');
  });
});

describe('합성 영수증 OCR 정확도 (금액·일자·사업자번호 필수)', () => {
  const files = Object.keys(EXPECTED);
  it.skipIf(!ocrModelsReady())(`${files.length}장 모두 맞다`, async () => {
    const r = await call('receipt_read', { paths: files.map((f) => join(FX, f)) });
    expect(r.receipts).toHaveLength(files.length);
    const score = { total: 0, date: 0, brn: 0, vendor: 0, payment: 0 };
    for (const [i, f] of files.entries()) {
      const got = r.receipts[i];
      const want = EXPECTED[f];
      expect(got.ok, f).toBe(true);
      score.total += Number(got.fields.total?.value === String(want.total));
      score.date += Number(got.fields.date?.value === want.date);
      score.brn += Number(got.fields.brn?.value === want.brn);
      score.vendor += Number(got.fields.vendor?.value === want.vendor);
      score.payment += Number(!want.payment || got.fields.payment?.value === want.payment);
      expect({ f, total: got.fields.total?.value, date: got.fields.date?.value, brn: got.fields.brn?.value })
        .toEqual({ f, total: String(want.total), date: want.date, brn: want.brn });
      if (want.vat !== undefined) expect(got.fields.vat?.value, f).toBe(String(want.vat));
      if (want.supply !== undefined) expect(got.fields.supply?.value, f).toBe(String(want.supply));
      if (want.approval) expect(got.fields.approval?.value, f).toBe(want.approval);
      if (want.card) expect(got.fields.card?.value, f).toBe(`${want.card}-****-****-****`);
      expect(got.items.length, f).toBe(want.items);
      if (want.via) expect(got.via, f).toBe(want.via);
      // 근거 줄과 신뢰도
      expect(got.fields.total!.source, f).toBeTruthy();
      expect(got.fields.total!.confidence, f).toBeGreaterThanOrEqual(0.8);
      // 시험 사업자번호는 검증 숫자가 일부러 틀렸다 → 사람이 확인하게 낮은 신뢰도
      expect(brnValid(want.brn.replace(/-/g, '')), f).toBe(false);
      expect(got.fields.brn!.confidence, f).toBeLessThan(0.8);
      // 카드번호는 읽은 줄·근거 줄에도 앞 네 자리만
      if (want.card) {
        const shown = [...got.lines, ...Object.values(got.fields).map((v) => (v as { source?: string }).source ?? '')].join('\n');
        expect(shown, f).not.toMatch(new RegExp(`${want.card}[-\\s]?\\d{2}`));
      }
    }
    console.log(`[receipt] ${files.length}장: 금액 ${score.total} · 일자 ${score.date} · 사업자번호 ${score.brn} · 가게 ${score.vendor} · 결제 ${score.payment}`);
    expect(score.vendor).toBeGreaterThanOrEqual(files.length - 1);
    expect(r.ai_used).toBe(false);
  }, 120_000);

  it('그림·PDF 가 아니면 그 파일만 실패로', async () => {
    const r = await call('receipt_read', { paths: [join(env.work, '없는.hwpx')] });
    expect(r.receipts[0]).toMatchObject({ ok: false });
    expect(r.receipts[0].error).toMatch(/그림|PDF/);
  });
});

describe('지출조서 만들기 (기본 서식)', () => {
  const rows = [
    { date: '2026-10-28', vendor: '가온마트 한빛점', brn: '214-86-00017', purpose: '우유 1L 외 3건', amount: '23800', payment: '카드' },
    { date: '2026-10-30', vendor: '한빛식당', brn: '105-12-00347', purpose: '업무 협의 식대', amount: '30,000', payment: '현금', note: '3명' },
  ];

  it('클립보드용 TSV·HTML: 머리줄 바로 아래 합계, 금액은 쉼표, 파일은 안 만든다', async () => {
    const r = await call('receipt_report', { rows, save: false });
    expect(r.output_path).toBeUndefined();
    expect(r.total).toBe(53800);
    const lines = r.tsv.split('\r\n').map((l: string) => l.split('\t'));
    expect(lines[0]).toEqual(['연번', '지출일자', '거래처', '사업자등록번호', '적요(품목)', '금액', '결제방법', '비고']);
    expect(lines[1]).toEqual(['합계', '', '', '', '영수증 2장', '53,800', '', '']);
    expect(lines[2]).toEqual(['1', '2026. 10. 28.', '가온마트 한빛점', '214-86-00017', '우유 1L 외 3건', '23,800', '카드', '']);
    expect(lines[3][5]).toBe('30,000');
    expect(lines[3][7]).toBe('3명');
    expect(r.html).toMatch(/^<table/);
    expect(r.html).toContain('font-weight:bold;">53,800</td>');
    expect(r.html.indexOf('합계')).toBeLessThan(r.html.indexOf('가온마트'));
  });

  it('HWPX 저장: 다시 읽으면 합계가 둘째 줄, 금액 합이 맞다', async () => {
    const { parse, validateHwpx } = await import('kordoc');
    const r = await call('receipt_report', { rows, output_dir: env.out });
    expect(r.output_path).toMatch(/지출조서_\d{8}\.hwpx$/);
    const buf = readFileSync(r.output_path);
    expect((await validateHwpx(buf)).ok).toBe(true);
    const md = (await parse(buf)).markdown;
    expect(md).toContain('지출조서');
    const table = md.split('\n').filter((l: string) => l.startsWith('|') && !l.startsWith('| ---'));
    expect(table[0]).toContain('사업자등록번호');
    expect(table[1]).toMatch(/^\| 합계 .*53,800/);
    expect(table[2]).toContain('가온마트 한빛점');
  });
});

/** 합성 기관 서식: 결재란 표가 먼저, 지출 표는 칸 이름·차례가 서로 다르다 */
async function makeTemplate(name: string, md: string): Promise<string> {
  const { markdownToHwpx } = await import('kordoc');
  const p = join(env.work, name);
  writeFileSync(p, Buffer.from(await markdownToHwpx(md)));
  return p;
}
const APPROVAL = '| 담당 | 팀장 | 과장 |\n| --- | --- | --- |\n|  |  |  |\n';
const tableRows = (md: string, re: RegExp) => md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---') && re.test(l));

describe('기관 서식 학습·채우기', () => {
  const rows = [
    { date: '2026-11-01', vendor: '가온25 시청점', brn: '129-33-00668', purpose: '사무용품', amount: '51700', payment: '카드' },
    { date: '2026-11-02', vendor: '가온문구', brn: '317-04-00528', purpose: '복사지', amount: '45,100', payment: '카드' },
    { date: '2026-11-03', vendor: '한결인쇄', brn: '602-19-00788', purpose: '현수막 제작', amount: '36000', payment: '계좌이체' },
  ];

  it('서식 A: 빈 줄 2개 + 아래 합계 → 줄을 더해 채우고 결재란·제목은 그대로, 원본은 읽기만', async () => {
    const { parse, validateHwpx } = await import('kordoc');
    const path = await makeTemplate('지출조서_가.hwpx', `# 지 출 조 서\n\n${APPROVAL}\n부서: 총무과\n\n| 번호 | 사용일자 | 사용처 | 사용내역 | 지출금액(원) | 비고 |\n| --- | --- | --- | --- | --- | --- |\n| 1 |  |  |  |  |  |\n| 2 |  |  |  |  |  |\n| 합계 |  |  |  |  |  |\n\n위와 같이 지출하였음을 확인합니다.\n`);
    const before = readFileSync(path);
    const info = await call('receipt_template_learn', { path, save: true });
    expect(info.columns.map((c: { field: string }) => c.field)).toEqual(['seq', 'date', 'vendor', 'purpose', 'amount', 'note']);
    expect(info).toMatchObject({ rows: 2, total_row: true, saved: true });
    expect(readFileSync(path).equals(before)).toBe(true);
    expect((await call('get_settings')).receipt.template_name).toBe('지출조서_가.hwpx');

    const r = await call('receipt_report', { rows, output_dir: env.out });
    expect(r.template).toBe('지출조서_가.hwpx');
    expect(r.tsv.split('\r\n')[0]).toBe('번호\t사용일자\t사용처\t사용내역\t지출금액(원)\t비고');
    // 미리보기·복사 표도 서식처럼 합계가 맨 아래, 합계 줄에는 금액만
    const tsv = r.tsv.split('\r\n');
    expect(tsv).toHaveLength(5);
    expect(tsv[1].startsWith('1\t')).toBe(true);
    expect(tsv[4]).toBe('합계\t\t\t\t132,800\t');
    expect(r.html.lastIndexOf('132,800')).toBeGreaterThan(r.html.lastIndexOf('36,000'));
    const buf = readFileSync(r.output_path);
    expect((await validateHwpx(buf)).ok).toBe(true);
    const md = (await parse(buf)).markdown;
    expect(md).toContain('지출조서');
    expect(md).toContain('| 담당 | 팀장 | 과장 |');
    expect(md).toContain('위와 같이 지출하였음을 확인합니다.');
    const t = tableRows(md, /사용일자|합계|^\| \d/);
    expect(t[0]).toContain('사용일자');
    expect(t[1]).toBe('| 1 | 2026. 11. 1. | 가온25 시청점 | 사무용품 | 51,700 |  |');
    expect(t[3]).toBe('| 3 | 2026. 11. 3. | 한결인쇄 | 현수막 제작 | 36,000 |  |');
    expect(t[4]).toBe('| 합계 |  |  |  | 132,800 |  |');
  });

  it('서식 B: 합계가 머리줄 바로 아래, 칸 이름·차례가 다르고 못 맞춘 칸은 비움 → 고친 대응표로 채움', async () => {
    const { parse } = await import('kordoc');
    const path = await makeTemplate('지출조서_나.hwpx', `# 지출 내역서\n\n${APPROVAL}\n| 연번 | 거래처(상호) | 사업자번호 | 집행일 | 품명 | 결제수단 | 금액 | 확인 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 합계 |  |  |  |  |  |  |  |\n|  |  |  |  |  |  |  |  |\n`);
    const info = await call('receipt_template_learn', { path, save: true });
    expect(info.columns.map((c: { field: string; by: string }) => `${c.field}:${c.by}`)).toEqual(
      ['seq:rule', 'vendor:rule', 'brn:rule', 'date:rule', 'purpose:rule', 'payment:rule', 'amount:rule', ':none']);
    expect(info).toMatchObject({ rows: 1, total_row: true });
    const set = await call('receipt_template_set', { fields: ['seq', 'vendor', 'brn', 'date', 'purpose', 'payment', 'amount', 'approval'] });
    expect(set.columns[7]).toMatchObject({ header: '확인', field: 'approval', by: 'user' });
    expect((await call('receipt_template_get')).columns[7].field).toBe('approval');

    const r = await call('receipt_report', { rows: rows.slice(0, 2), output_dir: env.out });
    // 미리보기·복사 표: 이 서식은 합계가 머리줄 바로 아래
    expect(r.tsv.split('\r\n')[1]).toBe('합계\t\t\t\t\t\t96,800\t');
    const md = (await parse(readFileSync(r.output_path))).markdown;
    const t = tableRows(md, /연번|합계|^\| \d/);
    expect(t[1]).toBe('| 합계 |  |  |  |  |  | 96,800 |  |');
    expect(t[2]).toBe('| 1 | 가온25 시청점 | 129-33-00668 | 2026. 11. 1. | 사무용품 | 카드 | 51,700 |  |');
    expect(t[3]).toBe('| 2 | 가온문구 | 317-04-00528 | 2026. 11. 2. | 복사지 | 카드 | 45,100 |  |');
  });

  it('서식 C: 아래 합계 밑에 빈 줄이 더 있어도 영수증 줄은 합계 위에만 (모자라면 합계 위에 줄을 더함)', async () => {
    const { parse } = await import('kordoc');
    const path = await makeTemplate('지출조서_다.hwpx', `# 지출조서\n\n| 번호 | 사용일자 | 사용처 | 사용내역 | 지출금액(원) | 비고 |\n| --- | --- | --- | --- | --- | --- |\n| 1 |  |  |  |  |  |\n| 2 |  |  |  |  |  |\n| 합계 |  |  |  |  |  |\n|  |  |  |  |  |  |\n`);
    const info = await call('receipt_template_learn', { path, save: true });
    expect(info).toMatchObject({ rows: 2, total_row: true });
    const r = await call('receipt_report', { rows, output_dir: env.out });
    const md = (await parse(readFileSync(r.output_path))).markdown;
    const t = md.split('\n').filter((l: string) => l.startsWith('| ') && !l.startsWith('| ---'));
    expect(t[1]).toBe('| 1 | 2026. 11. 1. | 가온25 시청점 | 사무용품 | 51,700 |  |');
    expect(t[2]).toBe('| 2 | 2026. 11. 2. | 가온문구 | 복사지 | 45,100 |  |');
    expect(t[3]).toBe('| 3 | 2026. 11. 3. | 한결인쇄 | 현수막 제작 | 36,000 |  |');
    expect(t[4]).toBe('| 합계 |  |  |  | 132,800 |  |');
    expect(t[5]).toMatch(/^\|(\s+\|)+$/);
    await call('receipt_template_clear');
  });

  it('표 없는 문서는 할 일을 알리고, 서식을 지우면 기본 서식으로', async () => {
    const path = await makeTemplate('그냥문서.hwpx', '# 안내\n\n본문만 있습니다.\n');
    await expect(call('receipt_template_learn', { path })).rejects.toThrow(/지출일자·거래처·금액 같은 칸 이름/);
    expect(await call('receipt_template_clear')).toBe(true);
    expect(await call('receipt_template_get')).toBeNull();
    const r = await call('receipt_report', { rows: rows.slice(0, 1), save: false });
    expect(r.template).toBeUndefined();
    expect(r.tsv.startsWith('연번\t지출일자')).toBe(true);
  });

  it('효과 집계: 저장한 지출조서만 장 수로', async () => {
    const { usageReport, flushUsage } = await import('../src/infra/usage.js');
    const before = usageReport('month').items.find((i) => i.key === 'receipt')!.count;
    await call('receipt_report', { rows, save: false });
    await call('receipt_report', { rows, output_dir: env.out });
    const item = usageReport('month').items.find((i) => i.key === 'receipt')!;
    expect(item.count - before).toBe(3);
    expect(item).toMatchObject({ label: '영수증으로 지출조서', unit: '장', baseline_min: 5 });
    flushUsage();
  });
});
