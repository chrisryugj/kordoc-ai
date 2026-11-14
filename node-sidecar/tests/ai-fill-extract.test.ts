/** 서식 칸 값 제안·여러 문서 표 추출 — 가짜 OpenAI 호환 서버 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { startFakeOpenAi, lastUser, systemOf, type ChatBody, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { suggestFill } from '../src/core/ai/fill.js';
import { extractTable } from '../src/core/ai/extract.js';
import { tempDir } from './tmp-dirs.js';

const dir = tempDir('kordoc-ai-fill-');
process.env.KORDOC_AI_DATA_DIR = dir;
const signal = () => new AbortController().signal;

let fake: FakeServer;
let reply: (b: ChatBody, n: number) => string = () => '{}';

beforeAll(async () => {
  fake = await startFakeOpenAi({ reply: (b, n) => reply(b, n) });
  await updateSettings({
    ai: { provider: 'openai', openai: { base_url: `${fake.url}/v1`, model: 'test-model' } },
    privacy: { offline: false },
    org: { name: '가온시', dept: '총무과', person: '홍길동', phone: '031-000-0000' },
    convert: { output_dir: '' },
  });
  writeFileSync(join(dir, '계획.md'), '# 2026년 직원 체육대회 계획\n\n- 일시: 2026. 4. 10.(금) 14:00\n- 장소: 구민체육센터\n- 예산: 1,500,000원');
  writeFileSync(join(dir, '안내.md'), '# 청렴 교육 안내\n\n- 일시: 2026. 5. 20.\n- 장소: 대강당');
});
afterAll(async () => { await fake.close(); });

describe('ai_fill_suggest', () => {
  it('칸 이름을 키로 하는 JSON 스키마로 묻고, 없는 칸은 빈 문자열', async () => {
    reply = () => JSON.stringify({ 제목: '2026년 직원 체육대회 개최 알림', 일시: '2026. 4. 10.(금) 14:00', 장소: '구민체육센터', 본문: '직원 화합을 위해\n체육대회를 엽니다.' });
    const r = await suggestFill({
      fields: ['제목', '일시', '장소', '본문', '문의처'],
      references: [join(dir, '계획.md')],
      instruction: '체육대회 개최 안내 공문',
      guides: { 본문: '행사 목적과 내용을 적으세요' },
    }, signal());
    expect(r.values).toEqual({ 제목: '2026년 직원 체육대회 개최 알림', 일시: '2026. 4. 10.(금) 14:00', 장소: '구민체육센터', 본문: '직원 화합을 위해\n체육대회를 엽니다.', 문의처: '' });
    const body = fake.chats().at(-1)!;
    const schema = body.response_format?.json_schema?.schema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(['제목', '일시', '장소', '본문', '문의처']);
    expect(schema.required).toHaveLength(5);
    const sent = lastUser(body);
    expect(sent).toContain('[쓰려는 문서]\n체육대회 개최 안내 공문');
    expect(sent).toContain('- 본문: 행사 목적과 내용을 적으세요');
    expect(sent).toContain('기관명: 가온시');
    expect(sent).toContain('1,500,000원');
    expect(systemOf(body)).toContain('설명');
  });

  it('출처에 없는 숫자는 지어낸 것으로 본다: 짧은 칸은 비우고 긴 칸은 그 숫자만 ○○', async () => {
    reply = () => JSON.stringify({ 전화: '02-123-4567', 본문: '체육대회는 2026. 4. 10. 열리며 참가 인원은 300명으로 예상되고 장소는 구민체육센터입니다.' });
    const r = await suggestFill({ fields: ['전화', '본문'], references: [join(dir, '계획.md')] }, signal());
    expect(r.values.전화).toBe('');
    expect(r.values.본문).toContain('2026. 4. 10.');
    expect(r.values.본문).toContain('○○명');
    expect(r.values.본문).not.toContain('300');
  });

  it('참고 문서 없이 지시만 줘도 항목 번호·회차·부수는 지어낸 숫자로 보지 않는다 (값 숫자만 대조)', async () => {
    reply = () => JSON.stringify({ 제목: '제1회 직원 체육대회 개최 알림', 본문: '1. 직원 화합을 위하여 체육대회를 개최합니다.\n2. 많은 참여 바랍니다.\n3. 참가 인원은 300명으로 예상합니다.', 붙임: '붙임 1. 계획서 1부.' });
    const r = await suggestFill({ fields: ['제목', '본문', '붙임'], instruction: '직원 체육대회 개최를 알리는 공문' }, signal());
    expect(r.values.제목).toBe('제1회 직원 체육대회 개최 알림');
    expect(r.values.붙임).toBe('붙임 1. 계획서 1부.');
    expect(r.values.본문).toMatch(/^1\. 직원 화합을/);
    expect(r.values.본문).toContain('\n2. 많은 참여');
    expect(r.values.본문).toContain('\n3. 참가 인원은 ○○명');
  });

  it('외부 AI 로 보낼 때 가린 값은 답에서 원래 값으로 되돌린다 (같은 모양이 둘이면 그대로 둔다)', async () => {
    const { restoreMasked } = await import('../src/infra/llm/index.js');
    const { redactMarkdown } = await import('../src/core/redact/rules.js');
    const src = '문의: 총무과 홍길동(☎ 02-450-7114, chongmu@gaon.example)';
    const masked = redactMarkdown(src, { rules: ['phone', 'email'] }).text;
    expect(masked).toContain('●');
    expect(restoreMasked(src, `문의는 ${masked.slice(masked.indexOf('☎'))}`)).toBe(`문의는 ${src.slice(src.indexOf('☎'))}`);
    expect(restoreMasked(src, '가린 값이 없는 답')).toBe('가린 값이 없는 답');
    // 끝자리가 같아 가린 모양이 같은 전화가 둘이면 어느 것인지 알 수 없다
    const two = '02-450-7114, 02-460-7114';
    const m2 = redactMarkdown(two, { rules: ['phone'] }).text.split(', ');
    if (m2[0] === m2[1]) expect(restoreMasked(two, m2[0])).toBe(m2[0]);
    // 더 긴 가림 모양 안에 든 짧은 모양을 바꾸지 않는다 (다른 주소의 일부가 엉뚱한 주소로 바뀌던 것)
    const addr = '가온시 한빛로 123\n가온시 시청로 456\n가온시 중앙로 78';
    const masked3 = redactMarkdown(addr, { rules: ['address'] }).text;
    const back = restoreMasked(addr, masked3);
    expect(back.split('\n')[2]).toBe('가온시 중앙로 78');
    for (const line of back.split('\n').slice(0, 2)) expect(line).not.toContain('중앙로');
    // 원문에 이미 가려 둔 자리는 채우지 않는다
    expect(restoreMasked('010-●●●●-5678 과 010-1234-5678', '010-●●●●-5678')).toBe('010-●●●●-5678');
  });

  it('받은 공문 번호를 따로 주고, 본문 칸의 관련 줄이 다른 번호(받은 공문 본문의 관련)면 바로잡는다', async () => {
    writeFileSync(join(dir, '받은공문.md'), '# 가온도\n\n1. 관련: 가온도 체육진흥과-2187(2026. 9. 30.)\n2. 참가 신청서를 제출하여 주시기 바랍니다.  끝.\n\n가온도지사\n\n시행 체육진흥과-2203 (2026. 10. 2.) 접수 ( )');
    reply = () => JSON.stringify({ 제목: '체육대회 참가 회신', 본문: '1. 관련: 가온도 체육진흥과-2187(2026. 9. 30.)\n2. 위 호와 관련하여 참가 신청서를 제출합니다.' });
    const r = await suggestFill({ fields: ['제목', '본문'], references: [join(dir, '받은공문.md')], instruction: '참가 회신 공문' }, signal());
    expect(r.values.본문).toBe('1. 관련: 가온도 체육진흥과-2203(2026. 10. 2.)\n2. 위 호와 관련하여 참가 신청서를 제출합니다.');
    const body = fake.chats().at(-1)!;
    expect(lastUser(body)).toContain('[받은 공문 번호]\n가온도 체육진흥과-2203(2026. 10. 2.)');
    expect(systemOf(body)).toContain('지시에 있을 때만');
  });

  it('칸이 없거나 근거가 하나도 없으면 안내 오류', async () => {
    await expect(suggestFill({ fields: [], references: [join(dir, '계획.md')] }, signal())).rejects.toThrow(/칸/);
    await expect(suggestFill({ fields: ['제목'], references: [] }, signal())).rejects.toThrow(/참고 문서/);
  });
});

describe('긴 문서를 일부만 읽었을 때', () => {
  const filler = Array.from({ length: 60 }, (_, i) => `## 항목 ${i + 1}\n\n${'일반 행정 사무에 관한 내용을 적은 문단입니다. '.repeat(12)}`).join('\n\n');
  it('표로 뽑기는 그 문서를 partial 로 알린다 (빈칸이 "문서에 없음"인지 "보지 못함"인지 가릴 수 있게)', async () => {
    const big = join(dir, '긴문서.md');
    writeFileSync(big, `# 종합 계획\n\n${filler}\n\n## 청렴 교육\n\n일시: 2026. 5. 20.`);
    reply = () => JSON.stringify({ 일시: '2026. 5. 20.', 장소: '' });
    const r = await extractTable({ paths: [join(dir, '계획.md'), big], columns: ['일시', '장소'], output_path: join(dir, '일부.xlsx') }, signal());
    expect(r.partial).toEqual([big]);
    const whole = await extractTable({ paths: [join(dir, '계획.md')], columns: ['일시', '장소'], output_path: join(dir, '전체.xlsx') }, signal());
    expect(whole.partial).toBeUndefined();
  });

  it('칸 채우기 제안도 일부만 읽었다고 알린다', async () => {
    const big = join(dir, '긴참고.md');
    writeFileSync(big, `# 종합 계획\n\n${filler}`);
    reply = () => JSON.stringify({ 제목: '종합 계획' });
    const r = await suggestFill({ fields: ['제목'], references: [big] }, signal());
    expect(r.note).toContain('일부만 읽고');
    const small = await suggestFill({ fields: ['제목'], references: [join(dir, '계획.md')] }, signal());
    expect(small.note).toBeUndefined();
  });
});

describe('ai_extract', () => {
  it('문서마다 1회 호출, 실패한 문서는 failed 로, xlsx 저장 (파일 칸 맨 앞)', async () => {
    reply = (b) => (lastUser(b).includes('계획.md')
      ? JSON.stringify({ 일시: '2026. 4. 10.(금) 14:00', 장소: '구민체육센터' })
      : JSON.stringify({ 일시: '2026. 5. 20.', 장소: '대강당' }));
    const before = fake.chats().length;
    const r = await extractTable({ paths: [join(dir, '계획.md'), join(dir, '없는파일.md'), join(dir, '안내.md')], columns: ['일시', '장소'] }, signal());
    expect(fake.chats().length - before).toBe(2);
    expect(r.rows).toEqual([
      { 파일: '계획.md', 일시: '2026. 4. 10.(금) 14:00', 장소: '구민체육센터' },
      { 파일: '안내.md', 일시: '2026. 5. 20.', 장소: '대강당' },
    ]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ path: join(dir, '없는파일.md'), ok: false });
    expect(r.output_path).toBe(join(dir, '계획 외 2건 추출표.xlsx'));
    const zip = await JSZip.loadAsync(readFileSync(r.output_path));
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('<t xml:space="preserve">파일</t>');
    expect(sheet).toContain('구민체육센터');
    expect(sheet).toContain('r="C3"');
    // 같은 이름이 있으면 (2)
    const again = await extractTable({ paths: [join(dir, '계획.md'), join(dir, '없는파일.md'), join(dir, '안내.md')], columns: ['일시', '장소'] }, signal());
    expect(again.output_path).toBe(join(dir, '계획 외 2건 추출표 (2).xlsx'));
  });

  it('output_path 가 .csv 면 CSV(BOM) 로', async () => {
    reply = () => JSON.stringify({ 장소: '대강당, 2층' });
    const out = join(dir, '결과.csv');
    const r = await extractTable({ paths: [join(dir, '안내.md')], columns: ['장소'], output_path: out }, signal());
    expect(r.output_path).toBe(out);
    expect(readFileSync(out, 'utf-8')).toBe('\uFEFF파일,장소\r\n안내.md,"대강당, 2층"\r\n');
    // 같은 경로를 다시 주면 덮어쓰지 않고 (2)
    const again = await extractTable({ paths: [join(dir, '안내.md')], columns: ['장소'], output_path: out }, signal());
    expect(again.output_path).toBe(join(dir, '결과 (2).csv'));
    expect(readFileSync(out, 'utf-8')).toContain('대강당, 2층');
  });

  it('모든 문서가 실패하면 오류', async () => {
    await expect(extractTable({ paths: [join(dir, '없음.md')], columns: ['장소'] }, signal())).rejects.toThrow(/어느 문서에서도/);
  });
});
