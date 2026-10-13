/** 문서 수합 — 서식이 다른 문서를 AI 로 뽑기 (가짜 OpenAI 호환 서버) · AI 가 없으면 따로 볼 문서로 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markdownToHwpx } from 'kordoc';
import { startFakeOpenAi, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { collectGather } from '../src/core/collect/gather.js';

const dir = mkdtempSync(join(tmpdir(), 'kordoc-gather-ai-'));
process.env.KORDOC_AI_DATA_DIR = dir;
const SAMPLE = (d: string) => join(__dirname, '..', 'samples', '취합', `교육수요조사서_${d}.hwpx`);
const signal = () => new AbortController().signal;
let fake: FakeServer;
let paths: string[];

beforeAll(async () => {
  fake = await startFakeOpenAi({ reply: () => JSON.stringify({ 부서명: '교통행정과', 담당자: '', 내선번호: '1901', '희망 교육과정': '안전운전 교육', '희망 인원': '4명', '희망 시기': '11월', '건의 사항': '' }) });
  await updateSettings({ ai: { provider: 'openai', openai: { base_url: `${fake.url}/v1`, model: 'test-model' } }, privacy: { offline: false }, convert: { output_dir: dir } });
  paths = ['총무과', '기획예산과'].map((d) => { const to = join(dir, `${d}.hwpx`); copyFileSync(SAMPLE(d), to); return to; });
  const other = join(dir, '교통행정과_의견.hwpx');
  writeFileSync(other, Buffer.from(await markdownToHwpx('# 교육 수요 의견\n\n교통행정과는 운전직 안전운전 교육을 11월에 4명 희망합니다. 문의 내선 1901.')));
  paths.push(other);
});
afterAll(async () => { await fake.close(); });

describe('collect_gather + AI', () => {
  it('서식이 다른 문서는 기준 칸으로 AI 가 뽑아 같은 표에, 확인 사항에 밝힌다', async () => {
    const r = await collectGather({ paths, roster: ['총무과', '기획예산과', '교통행정과'], use_ai: true }, signal());
    expect(r.by_kind).toEqual({ form: 2, excel: 0, ai: 1 });
    expect(r.separate).toEqual([]);
    expect(r.missing).toEqual([]);
    const schema = fake.chats().at(-1)!.response_format?.json_schema?.schema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(['부서명', '담당자', '내선번호', '희망 교육과정', '희망 인원', '희망 시기', '건의 사항']);
    expect(r.columns.find((c) => c.label === '희망 인원')?.total).toBe(6 + 4 + 4);
    // AI 가 비워 둔 담당자·건의 사항은 빈칸으로 센다
    expect(r.blanks).toBe(2);
    expect(r.status.find((s) => s.dept === '교통행정과')).toMatchObject({ submitted: true, blanks: 2 });
  }, 60_000);

  it('use_ai 를 끄면 따로 볼 문서', async () => {
    const r = await collectGather({ paths, roster: ['총무과', '기획예산과', '교통행정과'], use_ai: false }, signal());
    expect(r.by_kind.ai).toBe(0);
    expect(r.separate.map((s) => s.dept)).toEqual(['교통행정과']);
  }, 60_000);
});
