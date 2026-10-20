/** 서식대로 새로 쓰기 — 견본 골격을 AI 에 주고, 받은 글을 견본 서식에 넣고, 게이트 지적을 돌려준다 (가짜 OpenAI 호환 서버) */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { markdownToHwpx, parse } from 'kordoc';
import { startFakeOpenAi, lastUser, type ChatBody, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { writeFromTemplate } from '../src/core/ai/template-write.js';

const dir = mkdtempSync(join(tmpdir(), 'kordoc-ai-tplwrite-'));
process.env.KORDOC_AI_DATA_DIR = dir;
const signal = () => new AbortController().signal;

let fake: FakeServer;
let reply: (b: ChatBody, n: number) => string = () => '';

beforeAll(async () => {
  fake = await startFakeOpenAi({ reply: (b, n) => reply(b, n) });
  await updateSettings({
    ai: { provider: 'openai', openai: { base_url: `${fake.url}/v1`, model: 'test-model' } },
    privacy: { offline: false },
    org: { name: '가온시', dept: '총무과', person: '홍길동' },
  });
});
afterAll(async () => { await fake.close(); });

/** 기관 견본처럼: 개조식 보고서 한 장 */
async function sample(): Promise<string> {
  const md = '# 가온천 산책로 정비 계획\n\n## 추진 배경\n\n□ 산책로 노후 민원 32건(2025년)\n\n## 추진 계획\n\n□ 노면 정비 1.2km\n\n□ 조명 20기 교체\n';
  const path = join(dir, '견본.hwpx');
  writeFileSync(path, Buffer.from(await markdownToHwpx(md, { gongmun: { preset: '개조식' } })));
  return path;
}

const sectionXml = async (bytes: Uint8Array) => (await JSZip.loadAsync(bytes)).file('Contents/section0.xml')!.async('string');

describe('writeFromTemplate', () => {
  it('골격을 주고 받은 글을 견본 서식에 넣는다 — 늘린 항목은 같은 부호 문단의 서식을 받는다', async () => {
    const path = await sample();
    const skeleton = (await parse(readFileSync(path).buffer as ArrayBuffer, { layoutTables: 'keep' }));
    const sk = skeleton.success ? skeleton.markdown : '';
    let seen = '';
    reply = (b) => {
      seen = lastUser(b);
      return sk
        .replace('가온천 산책로 정비 계획', '경로당 냉방기 교체 계획')
        .replace('산책로 노후 민원 32건(2025년)', '경로당 냉방기 고장 민원 14건(2025년)')
        .replace('노면 정비 1.2km', '냉방기 교체 ○○대')
        .replace('조명 20기 교체', '설치 일정: 2026. 6.까지')
        + '\n\n□ 소요예산: 금○○원\n';
    };
    const r = await writeFromTemplate({ path, instruction: '경로당 냉방기 교체 계획을 써줘', output_path: join(dir, '결과.hwpx') }, signal());
    expect(seen).toContain('[견본 골격]');
    expect(seen).toContain('산책로 노후 민원');           // 견본 골격을 준다
    expect(seen).toContain('경로당 냉방기 교체 계획을 써줘');
    const out = readFileSync(r.output_path);
    const md = (await parse(out.buffer as ArrayBuffer)).markdown ?? '';
    expect(md).toContain('냉방기 고장 민원 14건');
    expect(md).toContain('소요예산');
    expect(md).not.toContain('노후 민원');
    expect(r.converted).toBe(false);
    // 늘린 □ 문단이 견본의 □ 문단과 같은 문단 모양을 쓴다
    const xml = await sectionXml(out);
    const paraPr = (text: string) => {
      const at = xml.indexOf(text);
      const open = xml.lastIndexOf('<hp:p ', at);
      return /paraPrIDRef="(\d+)"/.exec(xml.slice(open, xml.indexOf('>', open)))?.[1];
    };
    expect(paraPr('소요예산')).toBeDefined();
    expect(paraPr('소요예산')).toBe(paraPr('냉방기 교체 ○○대'));
  });

  it('줄로 고칠 수 있는 윤문 error 는 한 번 고쳐 쓰고, 남은 지적은 돌려준다', async () => {
    const path = await sample();
    const skeleton = (await parse(readFileSync(path).buffer as ArrayBuffer, { layoutTables: 'keep' }));
    const sk = skeleton.success ? skeleton.markdown : '';
    reply = (_b, n) => {
      if (n === 0) return sk.replace('노면 정비 1.2km', '결론적으로 노면 정비 1.2km');
      // 고쳐 쓰기 요청 (JSON 줄 목록)
      const line = sk.split('\n').findIndex((l) => l.includes('노면 정비')) + 1;
      return JSON.stringify({ lines: [{ line, text: '□ 노면 정비 1.2km' }] });
    };
    const r = await writeFromTemplate({ path, instruction: '같은 내용으로 다시', output_path: join(dir, '결과2.hwpx') }, signal());
    expect(r.findings.some((f) => f.rule === 'SLOP_PIVOT')).toBe(false);
    const md = (await parse(readFileSync(r.output_path).buffer as ArrayBuffer)).markdown ?? '';
    expect(md).not.toContain('결론적으로');
  });

  it('지시도 참고 문서도 없으면 묻는다', async () => {
    await expect(writeFromTemplate({ path: await sample(), instruction: ' ' }, signal())).rejects.toThrow(/지시/);
  });
});
