/** 영수증 — AI 를 켰을 때: 적요·품목 이름만 AI 로(금액·날짜는 규칙 값 그대로), 서식의 못 맞춘 칸만 AI 로. 가짜 OpenAI 호환 서버 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToHwpx } from 'kordoc';
import { startFakeOpenAi, lastUser, systemOf, type ChatBody, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { receiptRead } from '../src/core/receipt/read.js';
import { templateLearn } from '../src/core/receipt/template.js';
import { tempDir } from './tmp-dirs.js';

const dir = tempDir('kordoc-receipt-ai-');
process.env.KORDOC_AI_DATA_DIR = dir;
const signal = () => new AbortController().signal;
const PDF = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'receipts', 'e-receipt.pdf');

let fake: FakeServer;
let reply: (b: ChatBody) => string = () => '{}';

beforeAll(async () => {
  fake = await startFakeOpenAi({ reply: (b) => reply(b) });
  await updateSettings({ ai: { provider: 'openai', openai: { base_url: `${fake.url}/v1`, model: 'test-model' } }, privacy: { offline: false }, convert: { output_dir: '' } });
});
afterAll(async () => { await fake.close(); });

describe('receipt_read ai', () => {
  it('적요는 AI 제안, 품목 이름은 같은 개수일 때만 바꾸고 금액·날짜는 규칙 값', async () => {
    reply = () => JSON.stringify({ receipts: [{ i: 0, purpose: '업무 참고 도서 구입', names: ['공문서 작성 실무(개정판)', '행정 문서 편람'] }] });
    const r = await receiptRead({ paths: [PDF], ai: true }, signal());
    expect(r.ai_used).toBe(true);
    const x = r.receipts[0];
    expect(x.purpose).toMatchObject({ value: '업무 참고 도서 구입', source: 'AI 제안' });
    expect(x.items.map((i) => i.name)).toEqual(['공문서 작성 실무(개정판)', '행정 문서 편람']);
    expect(x.items.map((i) => i.amount)).toEqual([18000, 14400]);
    expect(x.fields.total?.value).toBe('32400');
    // 보낸 것: 고정 지시문 + 영수증 줄 (금액을 다시 묻지 않는다)
    const body = fake.chats().at(-1)!;
    expect(systemOf(body)).toContain('적요(용도)');
    expect(lastUser(body)).toContain('가온서점');
  });

  it('AI 가 실패하면 품목 첫 줄 요약으로 두고 알린다', async () => {
    reply = () => 'JSON 아님';
    const r = await receiptRead({ paths: [PDF], ai: true }, signal());
    expect(r.ai_used).toBe(false);
    expect(r.receipts[0].purpose.value).toBe('공문서 작성 실무 외 1건');
    expect(r.warnings[0]).toMatch(/AI가 적요를 정리하지 못해/);
  });

  it('ai 를 안 켜면 AI 를 부르지 않는다', async () => {
    const n = fake.chats().length;
    const r = await receiptRead({ paths: [PDF] }, signal());
    expect(r.ai_used).toBe(false);
    expect(fake.chats().length).toBe(n);
  });
});

describe('receipt_template_learn ai', () => {
  it('이름으로 못 맞춘 칸만 AI 제안 (이미 쓴 값은 받지 않음)', async () => {
    const p = join(dir, '서식.hwpx');
    writeFileSync(p, Buffer.from(await markdownToHwpx('| 순번 | 지급일 | 지급 상대방 | 산출내역 | 지급액 |\n| --- | --- | --- | --- | --- |\n|  |  |  |  |  |\n')));
    reply = () => JSON.stringify({ fields: ['seq', 'date', 'vendor', 'purpose', 'amount'] });
    const info = await templateLearn({ path: p, ai: true }, signal());
    expect(info.columns.map((c) => `${c.field}:${c.by}`)).toEqual(['seq:rule', 'date:ai', 'vendor:ai', 'purpose:rule', 'amount:ai']);
    expect(lastUser(fake.chats().at(-1)!)).toContain('지급 상대방');
  });
});
