/** 넘친 줄 AI 줄여 쓰기 — 가짜 OpenAI 호환 서버, 줄 배치는 진짜 rhwp */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeOpenAi, lastUser, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { fitLinesWithAi, findSpills } from '../src/core/ai/fit-lines.js';
import { generateHwpx } from '../src/core/gongmun/index.js';

process.env.KORDOC_AI_DATA_DIR = mkdtempSync(join(tmpdir(), 'kordoc-ai-fit-'));
const signal = () => new AbortController().signal;

// 메모 → 보고서 생성본(실측): 아래 두 줄은 장평 맞춤(autoFit) 뒤에도 rhwp 조판에서 마지막 줄에 다섯 글자가 넘친다
const LONG = '사고 발생 건수: 9건 보고됨 (경상 8건, 중상 1건), 보험 처리는 완료되었음';
const SHORT = '사고 발생 건수: 9건(경상 8건, 중상 1건), 보험 처리 완료';
const LONG2 = '맞추어진 시간대 집중 관리: 출근 시간대 배차 및 재배치에 역량 집중 예정';
const MD = `# 3분기 공공자전거 운영 실적 보고\n\n## 운영 실적\n\n□ 안전사고 현황\n  ㅇ ${LONG}\n\n## 개선 방향\n\n□ 운영 개선 계획\n  ㅇ ${LONG2}\n`;

let fake: FakeServer;
beforeAll(async () => {
  fake = await startFakeOpenAi({
    reply: (b) => {
      const items = [...lastUser(b).matchAll(/^(\d+)\. \(\d+자 이상 줄이기\) (.+)$/gm)].map(([, id, text]) => ({
        id,
        // 첫 줄은 겹친 말을 덜고, 둘째 줄은 없던 숫자를 넣어 버려지는지 본다
        text: text === LONG ? SHORT : text === LONG2 ? '출근 시간대 1개 집중 관리: 배차·재배치 역량 집중' : text,
      }));
      return JSON.stringify({ items });
    },
  });
  await updateSettings({ ai: { provider: 'openai', openai: { base_url: `${fake.url}/v1`, model: 'test-model' } }, privacy: { offline: false } });
});
afterAll(async () => { await fake.close(); });

describe('ai_fit_lines', () => {
  it('넘친 줄만 줄여 한 줄로, 숫자가 바뀐 답은 버린다', async () => {
    const before = await generateHwpx({ markdown: MD, preset: 'report', preview_only: true, preview_hwpx: true });
    const spills = await findSpills(Buffer.from(before.preview_hwpx_b64!, 'base64'));
    expect(spills.map((s) => s.text)).toContain(LONG);

    const r = await fitLinesWithAi({ markdown: MD, preset: 'report' }, signal());
    expect(r.changes).toEqual([{ before: LONG, after: SHORT }]);
    expect(r.markdown).toContain(`  ㅇ ${SHORT}`);
    expect(r.markdown).toContain(LONG2);
    expect(r.markdown).not.toContain('1개 집중');
    const after = await generateHwpx({ markdown: r.markdown, preset: 'report', preview_only: true, preview_hwpx: true });
    expect((await findSpills(Buffer.from(after.preview_hwpx_b64!, 'base64'))).map((s) => s.text)).not.toContain(SHORT);
  });

  it('넘친 줄이 없으면 AI 를 부르지 않는다', async () => {
    const n = fake.chats().length;
    const r = await fitLinesWithAi({ markdown: '# 짧은 보고\n\n□ 개요\n  ㅇ 짧은 문장\n', preset: 'report' }, signal());
    expect(r).toEqual({ markdown: '# 짧은 보고\n\n□ 개요\n  ㅇ 짧은 문장\n', changes: [], remaining: 0 });
    expect(fake.chats().length).toBe(n);
  });
});
