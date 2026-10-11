/** 초안·고쳐 쓰기·요약·K팀장 검토 — 가짜 OpenAI 호환 서버 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintGongmunText, markdownToHwpx, parse } from 'kordoc';
import { startFakeOpenAi, lastUser, systemOf, type ChatBody, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { draftDocument } from '../src/core/ai/draft.js';
import { rewriteText } from '../src/core/ai/rewrite.js';
import { summarize } from '../src/core/summary/index.js';
import { reviewDocument } from '../src/core/inspect/index.js';
import { cleanOutput, dropGreeting, escapeLineDates, fixRecipientLine, fixRelatedLine, receivedDocRef } from '../src/core/ai/prompts.js';
import { chunkText, loadDoc } from '../src/core/ai/docs.js';

const dir = mkdtempSync(join(tmpdir(), 'kordoc-ai-draft-'));
process.env.KORDOC_AI_DATA_DIR = dir;
const signal = () => new AbortController().signal;

let fake: FakeServer;
let reply: (b: ChatBody, n: number) => string = () => '';

beforeAll(async () => {
  fake = await startFakeOpenAi({ reply: (b, n) => reply(b, n) });
  await updateSettings({
    ai: { provider: 'openai', openai: { base_url: `${fake.url}/v1`, model: 'test-model' } },
    privacy: { offline: false },
    org: { name: '서울특별시 광진구', dept: '총무과', person: '홍길동', phone: '02-450-0000' },
  });
});
afterAll(async () => { await fake.close(); });

describe('cleanOutput', () => {
  it('감싼 코드펜스·작업 머리말·작업 꼬리말만 걷는다', () => {
    expect(cleanOutput('```markdown\n# 제목\n\n본문\n```')).toBe('# 제목\n\n본문');
    expect(cleanOutput('요청하신 초안입니다.\n\n# 제목')).toBe('# 제목');
    expect(cleanOutput('다듬은 글은 다음과 같습니다:\n본문입니다.\n\n추가로 수정이 필요하시면 말씀해 주세요.')).toBe('본문입니다.');
    // 원문 내용인 "다음은 …입니다." 와 민원 답변의 문의 안내는 남긴다
    expect(cleanOutput('다음은 2026년 사업 계획입니다.\n\n세부 내용')).toBe('다음은 2026년 사업 계획입니다.\n\n세부 내용');
    expect(cleanOutput('본문\n\n궁금하신 점은 총무과로 말씀해 주세요.')).toBe('본문\n\n궁금하신 점은 총무과로 말씀해 주세요.');
  });
});

describe('cleanOutput — 원문 보호', () => {
  it('원문에 있던 문장은 머리말처럼 보여도 남기고, 공문의 "…알려 주시기 바랍니다"는 꼬리말로 지우지 않는다', () => {
    const src = '2026년 상반기 추진 실적을 정리한 결과는 다음과 같습니다.\n1. 민원 152건 처리';
    expect(cleanOutput('2026년 상반기 추진 실적을 정리한 결과는 아래와 같습니다.\n1. 민원 152건 처리', src)).toContain('정리한 결과는 아래와 같습니다');
    const reply = '1. 불편을 드려 죄송합니다.\n\n4. 추가로 궁금하신 사항은 총무과로 알려 주시기 바랍니다.';
    expect(cleanOutput(reply)).toBe(reply);
    expect(cleanOutput('본문입니다.\n\n수정이 더 필요하시면 말씀해 주세요.')).toBe('본문입니다.');
  });
});

describe('chunkText', () => {
  it('빈 줄 없이 줄바꿈만 있는 긴 글은 줄 단위로, 긴 줄은 문장 끝에서 자르고 구분자를 기억한다', () => {
    const text = Array.from({ length: 6 }, (_, i) => `${i + 1}번째 줄입니다. 내용이 이어집니다.`).join('\n');
    const chunks = chunkText(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text + c.sep).join('')).toBe(text);
    expect(chunks.every((c) => c.text.length <= 60)).toBe(true);
    const long = '첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다.';
    const parts = chunkText(long, 12); // 문장 하나(8~9자)는 들어가고 둘(18자)은 넘침
    expect(parts.map((c) => c.text)).toEqual(['첫 문장입니다.', '둘째 문장입니다.', '셋째 문장입니다.']);
    expect(parts.map((c) => c.text + c.sep).join('')).toBe(long);
  });
});

describe('텍스트 파일 인코딩', () => {
  it('UTF-8 이 아니면 CP949 로 읽는다 (한국어 엑셀 CSV)', async () => {
    const f = join(dir, 'cp949.csv');
    writeFileSync(f, Buffer.from([0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9, 0x2c, 0x31])); // "가나다,1"
    expect((await loadDoc(f, signal())).text).toBe('가나다,1');
    const g = join(dir, 'cp949-ext.csv');
    writeFileSync(g, Buffer.from('8c63bee7b2e12c31', 'hex')); // "똠양꿍,1" (똠 = CP949 확장 0x8C63, Node 의 euc-kr 디코더는 깨뜨림)
    expect((await loadDoc(g, signal())).text).toBe('똠양꿍,1');
  });
});

describe('받은 공문 번호', () => {
  it('끝 시행 줄 + 발신명의가 있는 기관명. 시행일 빈 칸·본문만 있는 문서·제목 줄은 기관으로 안 봄', () => {
    expect(receivedDocRef('# 가온도\n\n1. 관련: 가온도 체육진흥과-2187(2026. 9. 30.)\n\n가온도지사\n\n시행 체육진흥과-2203 (2026. 10. 2.) 접수 ( )')).toEqual({
      number: '체육진흥과-2203', ref: '가온도 체육진흥과-2203(2026. 10. 2.)', dept: '체육진흥과', recipient: '가온도지사(체육진흥과장)',
    });
    expect(receivedDocRef('광진구\n\n광진구청장\n\n시행 총무과-77 (2026. 3. 2.)')?.recipient).toBe('광진구청장(총무과장)');
    expect(receivedDocRef('1. 재난관리과-8525(2016.12.19.)호와 관련입니다.\n시행 고덕119안전센터-5761 ( ) 접수 ( )')?.ref).toBe('고덕119안전센터-5761');
    expect(receivedDocRef('체육대회\n\n체육대회 장소: 대강당\n시행 총무과-12 (2026. 1. 5.)')?.ref).toBe('총무과-12(2026. 1. 5.)');
    expect(receivedDocRef('| 문서번호 | 환경정책과-21901 |')?.number).toBe('환경정책과-21901');
    expect(receivedDocRef('# 회의록\n\n번호 없음')).toBeUndefined();
  });

  it('수신 줄은 받은 공문을 보낸 부서가 있으면 그대로, 아니면 [회신 받을 곳]으로 (수신자 줄은 안 건드림)', () => {
    const rec = { number: '체육진흥과-2203', ref: '', dept: '체육진흥과', recipient: '가온도지사(체육진흥과장)' };
    expect(fixRecipientLine('# 회신\n\n수신: 가온도 행정지원과장\n\n1. 관련: x', rec)).toBe('# 회신\n\n수신: 가온도지사(체육진흥과장)\n\n1. 관련: x');
    expect(fixRecipientLine('수신: 가온도지사(체육진흥과장)', rec)).toBe('수신: 가온도지사(체육진흥과장)');
    expect(fixRecipientLine('수신자: 가온시장', rec)).toBe('수신자: 가온시장');
  });

  it('지시에 없는 인사 걷기: 문장만·다음 줄 끌어올리기·항목 빼고 번호 당기기, 날짜 줄은 그대로', () => {
    expect(dropGreeting('1. 관련: 체육진흥과-2203\n2. 귀 도의 무궁한 발전을 기원합니다.\n  위 호와 관련하여 회신합니다.\n  가. 참가합니다.'))
      .toBe('1. 관련: 체육진흥과-2203\n2. 위 호와 관련하여 회신합니다.\n  가. 참가합니다.');
    expect(dropGreeting('1. 귀 기관의 무궁한 발전을 기원합니다.\n2. 관련: 체육진흥과-2203\n3. 회신합니다.\n\n붙임  1. 명단 1부.  끝.'))
      .toBe('1. 관련: 체육진흥과-2203\n2. 회신합니다.\n\n붙임  1. 명단 1부.  끝.');
    expect(dropGreeting('1. 귀 시의 무궁한 발전을 기원합니다. 다음과 같이 알립니다.')).toBe('1. 다음과 같이 알립니다.');
    expect(dropGreeting('2026. 10. 5.\n1. 회신합니다.')).toBe('2026. 10. 5.\n1. 회신합니다.');
    // 변형: 기원드립니다·기원하며 (작은 모델이 실제로 낸 꼴)
    expect(dropGreeting('1. 관련: 체육진흥과-2203\n2. 귀 도의 무궁한 발전을 기원드립니다.\n3. 회신합니다.')).toBe('1. 관련: 체육진흥과-2203\n2. 회신합니다.');
    expect(dropGreeting('2. 귀 기관의 무궁한 발전을 기원하며, 위 호와 관련하여 참가를 회신합니다.')).toBe('2. 위 호와 관련하여 참가를 회신합니다.');
    // 본문을 지우면 안 된다: 요청 문장 뒤에 붙은 인사만 걷고, 인사 관용구가 아닌 '기원'은 그대로
    expect(dropGreeting('2. 참가 신청서는 10월 20일까지 제출하여 주시기 바라며 귀 기관의 무궁한 발전을 기원합니다.\n3. 문의: 총무과')).toBe('2. 참가 신청서는 10월 20일까지 제출하여 주시기 바랍니다.\n3. 문의: 총무과');
    expect(dropGreeting('  가. 행사 목적: 시민 건강과 안전을 기원하고 공동체 의식 함양')).toBe('  가. 행사 목적: 시민 건강과 안전을 기원하고 공동체 의식 함양');
    expect(dropGreeting('1. 이번 대회는 지역 발전을 기원하며 10월 3일 개최합니다.')).toBe('1. 이번 대회는 지역 발전을 기원하며 10월 3일 개최합니다.');
  });

  it('관련 줄은 받은 번호가 이미 있으면 그대로, 다른 번호면 받은 번호로', () => {
    const rec = { number: '체육진흥과-2203', ref: '가온도 체육진흥과-2203(2026. 10. 2.)', dept: '체육진흥과' };
    expect(fixRelatedLine('1. 관련: 가온도 체육진흥과-2203(2026. 10. 2.)호 「협조 요청」', rec)).toBe('1. 관련: 가온도 체육진흥과-2203(2026. 10. 2.)호 「협조 요청」');
    expect(fixRelatedLine('# 제목\n\n1. 관련: 가온도 체육진흥과-2187(2026. 9. 30.)\n2. 회신합니다.', rec)).toBe('# 제목\n\n1. 관련: 가온도 체육진흥과-2203(2026. 10. 2.)\n2. 회신합니다.');
  });
});

describe('줄 첫머리 날짜 이스케이프', () => {
  it('"2026. 10. 5." 로 시작하는 줄은 첫 마침표를 이스케이프하되, 제목 뒤 요약 상자 인용문은 그대로', () => {
    const md = '# 보고\n\n> 2026. 10. 5. 시행 계획을 보고하고자 함\n\n2026. 10. 5.\n- 2026. 10. 13. 개최\n1. 2026. 3. 5. 회의\n> 2026. 4. 1. 시행\n□ 2026. 1. 2. 그대로';
    expect(escapeLineDates(md)).toBe('# 보고\n\n> 2026. 10. 5. 시행 계획을 보고하고자 함\n\n2026\\. 10. 5.\n- 2026\\. 10. 13. 개최\n1. 2026\\. 3. 5. 회의\n> 2026\\. 4. 1. 시행\n□ 2026. 1. 2. 그대로');
  });
});

describe('ai_draft', () => {
  it('표기법 error 가 있으면 지적된 줄만 한 번 고쳐 받아 그 줄에 바꿔 넣는다', async () => {
    const bad = '# 체육대회 개최 알림\n\n1. 관련: 총무과-1234(2026.3.5.)\n2. 체육대회를 개최하고자 합니다.\n\n붙임: 신청서 1부.';
    const good = '# 체육대회 개최 알림\n\n1. 관련: 총무과-1234(2026. 3. 5.)\n2. 체육대회를 개최하고자 합니다.\n\n붙임  신청서 1부.  끝.';
    expect(lintGongmunText(bad, { document: true }).some((f) => f.severity === 'error')).toBe(true);
    const fixes = { lines: [{ line: 3, text: '1. 관련: 총무과-1234(2026. 3. 5.)' }, { line: 6, text: '붙임  신청서 1부.  끝.' }, { line: 4, text: '지적 안 된 줄은 무시' }] };
    reply = (b) => (lastUser(b).includes('지적된 줄') ? JSON.stringify(fixes) : bad);
    const r = await draftDocument({ instruction: '직원 체육대회 개최 알림 공문을 써 줘', preset: '기안문' }, signal());
    expect(r.markdown).toBe(good);
    const [first, second] = fake.chats().slice(-2);
    expect(systemOf(first)).toContain('[기안문 형식]');
    expect(systemOf(first)).not.toContain('홍길동'); // 기관 정보는 system 이 아니라 메시지로 (클라우드 마스킹 대상)
    expect(lastUser(first)).toContain('[내 기관 정보]');
    expect(lastUser(first)).toContain('담당자: 홍길동');
    expect(lastUser(second)).toContain('3줄: 1. 관련: 총무과-1234(2026.3.5.)');
    expect(lastUser(second)).toContain('6줄: 붙임: 신청서 1부.');
    expect(lastUser(second)).not.toContain('체육대회를 개최하고자'); // 초안 전체를 다시 보내지 않는다
    expect(second.response_format?.type).toBe('json_schema');
  });

  it('회신 날짜 줄(2026. 10. 5.)이 HWPX 로 만들고 다시 읽어도 그대로 남는다', async () => {
    reply = () => '# 체육대회 참가 회신\n\n2026. 10. 5.\n\n1. 위 호와 관련하여 참가 인원을 회신합니다.\n  가. 2026. 10. 13. 개최 행사에 12명 참가  끝.';
    const r = await draftDocument({ instruction: '회신', preset: 'official' }, signal());
    expect(r.markdown).toContain('2026\\. 10. 5.');
    const back = await parse(Buffer.from(await markdownToHwpx(r.markdown, { gongmun: { preset: 'official' } })));
    expect(back.success).toBe(true);
    const text = back.success ? back.markdown : '';
    expect(text).toContain('2026. 10. 5.');
    expect(text).toContain('2026. 10. 13. 개최');
    expect(text).not.toMatch(/^\s*(?:\d+|[가-하])\. 5\.\s*$/m); // "1. 5." 같은 번호 문단으로 깨지지 않음
    expect(text).not.toContain('\\');
  });

  it('제목(# )이 없으면 붙이고, 코드펜스·머리말은 걷는다', async () => {
    reply = () => '요청하신 보고서 초안입니다.\n\n```markdown\n2026년 청렴 교육 계획\n\n> 청렴 의식을 높이고자 함\n\n## 추진 배경\n\n□ 청렴도 평가 대비 필요\n```';
    const r = await draftDocument({ instruction: '청렴 교육 계획', preset: 'report' }, signal());
    expect(r.markdown.startsWith('# 2026년 청렴 교육 계획')).toBe(true);
    expect(r.markdown).not.toContain('```');
    expect(systemOf(fake.chats().at(-1)!)).toContain('하고자 함');
  });

  it('kordoc 이 모르는 글머리(•)는 들여쓰기 그대로 "- " 로', async () => {
    reply = () => '# 안내\n\n1. 행사를 엽니다.\n  가. 개요:\n    • 일시: 2026. 4. 10.\n    • 장소: 대강당  끝.';
    const r = await draftDocument({ instruction: '행사 안내', preset: 'official' }, signal());
    expect(r.markdown).toContain('\n    - 일시: 2026. 4. 10.\n    - 장소: 대강당');
    expect(r.markdown).not.toContain('•');
  });

  it("kind 'reply' — 받은 공문을 [받은 공문]으로 넣고 회신 지침을 붙인다", async () => {
    const recv = join(dir, '받은공문.md');
    writeFileSync(recv, '# 2026년 체육대회 참가 인원 제출 요청\n\n1. 관련: 서울특별시 체육진흥과-777(2026. 3. 2.)\n2. 부서별 참가 인원을 2026. 3. 20.까지 제출하여 주시기 바랍니다.');
    reply = () => '# 2026년 체육대회 참가 인원 제출\n\n수신: 서울특별시장(체육진흥과장)\n\n1. 관련: 서울특별시 체육진흥과-777(2026. 3. 2.)\n2. 위 호와 관련하여 참가 인원을 다음과 같이 제출합니다.\n  가. 참가 인원: ○○명  끝.';
    const r = await draftDocument({ instruction: '참가 인원은 12명으로 회신', kind: 'reply', references: [recv] }, signal());
    const body = fake.chats().at(-1)!;
    expect(systemOf(body)).toContain('[회신 기안 지침]');
    expect(systemOf(body)).toContain('[기안문 형식]'); // reply 기본 프리셋 = 기안문
    expect(lastUser(body)).toContain('=== 받은 공문: 받은공문.md ===');
    expect(lastUser(body)).toContain('체육진흥과-777');
    expect(r.markdown).toContain('1. 관련:');
    await expect(draftDocument({ instruction: 'x', kind: 'reply' }, signal())).rejects.toThrow(/받은 공문/);
  });

  it("kind 'reply' — 받은 공문 끝 시행 줄 번호를 따로 주고, 본문 관련 줄을 베낀 초안은 바로잡는다", async () => {
    const recv = join(dir, '받은공문-시행.md');
    writeFileSync(recv, '# 가온도\n\n수신 가온시장(행정지원과장)\n\n제목 한마음 체육대회 참가 협조 요청\n\n1. 관련: 가온도 체육진흥과-2187(2026. 9. 30.)\n2. 참가 신청서를 2026. 10. 23.(금)까지 제출하여 주시기 바랍니다.  끝.\n\n# 가온도지사\n\n시행 체육진흥과-2203 (2026. 10. 2.) 접수 ( )');
    reply = () => '# 한마음 체육대회 참가 회신\n\n수신: 가온시장(행정지원과장)\n\n1. 관련: 가온도 체육진흥과-2187(2026. 9. 30.)\n2. 귀 도의 무궁한 발전을 기원합니다.\n  위 호와 관련하여 참가 인원을 회신합니다.  끝.';
    const r = await draftDocument({ instruction: '25명 참가로 회신', kind: 'reply', references: [recv] }, signal());
    expect(lastUser(fake.chats().at(-1)!)).toContain('[받은 공문 번호]\n가온도 체육진흥과-2203(2026. 10. 2.)');
    expect(lastUser(fake.chats().at(-1)!)).toContain('[회신 받을 곳]\n가온도지사(체육진흥과장)');
    expect(systemOf(fake.chats().at(-1)!)).toContain('지시에 있을 때만');
    expect(r.markdown).toContain('수신: 가온도지사(체육진흥과장)');
    expect(r.markdown).toContain('1. 관련: 가온도 체육진흥과-2203(2026. 10. 2.)');
    expect(r.markdown).toContain('2. 위 호와 관련하여 참가 인원을 회신합니다.');
    expect(r.markdown).not.toMatch(/2187|발전을 기원/);
    // 지시에 문서번호를 직접 적으면 그대로 둔다
    const r2 = await draftDocument({ instruction: '관련은 체육진흥과-2187 로 써서 회신', kind: 'reply', references: [recv] }, signal());
    expect(r2.markdown).toContain('1. 관련: 가온도 체육진흥과-2187(2026. 9. 30.)');
  });

  it("kind 'memo' — 사용자 글은 [메모]로 넘기고 보고서 프리셋·메모 정리 지침", async () => {
    reply = () => '# 청사 주차장 개선 보고\n\n> 청사 주차난을 줄이고자 함\n\n## 현황\n\n□ 주차면 부족\n  ㅇ 민원 월 ○○건';
    const memo = '주차장 민원 많음. 10/14 회의에서 2부제 얘기 나옴. 시설과랑 협의 필요';
    const r = await draftDocument({ instruction: memo, kind: 'memo' }, signal());
    const body = fake.chats().at(-1)!;
    expect(systemOf(body)).toContain('[메모 정리 지침]');
    expect(systemOf(body)).toContain('[보고서 형식');
    expect(lastUser(body)).toContain(`[메모]\n${memo}`);
    expect(r.markdown.startsWith('# 청사 주차장 개선 보고')).toBe(true);
    await expect(draftDocument({ instruction: '', kind: 'memo' }, signal())).rejects.toThrow(/메모를 붙여 넣거나/);
  });

  it("kind 'complaint'·'onepage'·'press'·'minutes' 는 종류별 지침과 기본 프리셋", async () => {
    reply = () => '# 제목\n\n본문';
    const cases: Array<[string, string, string]> = [
      ['complaint', '[민원 답변 지침]', '[기안문 형식]'],
      ['onepage', '[한 장 보고 지침]', '[보고서 형식'],
      ['press', '[보도자료 지침]', '[보도자료 형식]'],
      ['minutes', '[회의록 정리 지침]', '[회의록 형식]'],
    ];
    for (const [kind, guide, preset] of cases) {
      await draftDocument({ instruction: '테스트', kind: kind as never }, signal());
      const sys = systemOf(fake.chats().at(-1)!);
      expect(sys).toContain(guide);
      expect(sys).toContain(preset);
    }
  });
});

describe('ai_rewrite', () => {
  it('결과는 바꿔 넣을 글만 (머리말·따옴표 없이), 앞뒤 줄바꿈은 원문대로', async () => {
    reply = () => '다듬은 글입니다.\n\n"회의는 오늘 열립니다."';
    const r = await rewriteText({ text: '\n회의는 오늘 열린다고 합니다.\n', mode: 'polish' }, signal());
    expect(r.text).toBe('\n회의는 오늘 열립니다.\n');
  });

  it('public — kordoc 공공언어 검사 결과(금일→오늘)를 고칠 거리로 넣는다', async () => {
    reply = () => '오늘 알린 지침에 따라 다음 날부터 준비합니다.';
    await rewriteText({ text: '금일 시달된 지침에 의거하여 익일부터 준비합니다.', mode: 'public' }, signal());
    const sent = lastUser(fake.chats().at(-1)!);
    expect(sent).toContain('쉬운 공공언어');
    expect(sent).toContain('해요체'); // "부드럽게"를 해요체로 알아듣지 않게 끝맺음 유지 지시
    expect(sent).toContain('[이 글에서 꼭 고칠 표현]');
    expect(sent).toMatch(/"금일": 금일 → 오늘/);
  });

  it('gaejosik — 서술형 종결이 남으면 kordoc 문체 검사로 한 번 더 고친다', async () => {
    reply = (b) => (lastUser(b).includes('[지적]') ? '□ 체육대회 개최\n  ㅇ 4월 10일 개최 예정' : '□ 체육대회 개최\n  ㅇ 4월 10일에 개최합니다.');
    const r = await rewriteText({ text: '체육대회를 4월 10일에 개최합니다.', mode: 'gaejosik' }, signal());
    expect(r.text).toBe('□ 체육대회 개최\n  ㅇ 4월 10일 개최 예정');
  });

  it('custom 은 지시가 있어야 하고, 모르는 방식은 안내 오류', async () => {
    await expect(rewriteText({ text: '글', mode: 'custom' }, signal())).rejects.toThrow(/지시/);
    await expect(rewriteText({ text: '글', mode: 'weird' as never }, signal())).rejects.toThrow(/방식/);
    await expect(rewriteText({ text: '   ', mode: 'polish' }, signal())).rejects.toThrow(/비어/);
  });
});

describe('ai_summarize', () => {
  it('파일을 읽어 요약, 결과는 { summary, redacted }', async () => {
    const f = join(dir, '보고.md');
    writeFileSync(f, '# 주간 보고\n\n이번 주 민원 처리 건수는 152건으로 전주 대비 12% 늘었다.');
    reply = () => '## 핵심 내용\n- 민원 처리 152건(전주 대비 12% 증가)';
    const r = await summarize({ path: f, style: 'briefing', length: 'short' }, signal());
    expect(r).toEqual({ summary: '## 핵심 내용\n- 민원 처리 152건(전주 대비 12% 증가)', redacted: 0 });
    const sent = lastUser(fake.chats().at(-1)!);
    expect(sent).toContain('상급자 보고용');
    expect(sent).toContain('152건');
  });

  it('긴 글은 조각별 요점 → 최종 요약 (map-reduce)', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `${i + 1}번 문단: ${'예산 집행 현황과 향후 계획을 설명하는 긴 문장입니다. '.repeat(10)}`).join('\n\n');
    const before = fake.chats().length;
    reply = (b) => (lastUser(b).includes('부분입니다') ? '- 요점' : '최종 요약');
    const r = await summarize({ text: long }, signal());
    expect(r.summary).toBe('최종 요약');
    const calls = fake.chats().slice(before);
    expect(calls.length).toBeGreaterThan(2);
    expect(lastUser(calls.at(-1)!)).toContain('부분별로 먼저 정리한 요점');
  });

  it('아주 긴 글은 처음과 끝을 넣어 고르게 8조각만 읽고, 요약 끝에 밝힌다', async () => {
    const long = Array.from({ length: 400 }, (_, i) => `${i + 1}번 문단: ${'예산 집행 현황과 향후 계획을 설명하는 긴 문장입니다. '.repeat(10)}`).join('\n\n');
    const before = fake.chats().length;
    reply = (b) => (lastUser(b).includes('부분입니다') ? '- 요점' : '최종 요약');
    const r = await summarize({ text: long }, signal());
    const pieces = fake.chats().slice(before).filter((b) => lastUser(b).includes('부분입니다'));
    expect(pieces).toHaveLength(8);
    expect(lastUser(pieces[0])).toContain('1번 문단:');
    expect(lastUser(pieces[7])).toContain('400번 문단:');
    expect(r.summary).toMatch(/^최종 요약\n\n※ 문서가 길어 \d+부분으로 나눈 뒤 처음부터 끝까지 고르게 8부분만 읽고 요약했습니다\.$/);
  });

  it('빈 입력은 안내 오류', async () => {
    await expect(summarize({ text: '  ' }, signal())).rejects.toThrow(/요약할 내용이 없습니다/);
  });
});

describe('ai_review (K팀장)', () => {
  it('AI 검토(JSON 스키마) + kordoc 표기법 검사를 함께 돌려준다', async () => {
    const f = join(dir, '계획서.md');
    writeFileSync(f, '# 체육대회 계획\n\n1. 일시: 2026.4.10.\n2. 예산: 총 300만 원(대관 200만 원 + 물품 50만 원)\n\n붙임: 예산서 1부.');
    reply = () => JSON.stringify({
      summary: '예산 합계가 맞지 않습니다.',
      issues: [
        { category: 'number', severity: 'error', location: '2번 항목', description: '세부 합계(250만 원)와 총액(300만 원)이 다릅니다.', original: '총 300만 원', suggestion: '합계를 다시 확인하세요.' },
        { category: 'typo', severity: 'suggestion', location: '', description: '띄어쓰기 확인', original: '', suggestion: '' },
        { category: '없는분류', severity: 'error', location: '', description: '버려야 함', original: '', suggestion: '' },
      ],
    });
    const r = await reviewDocument({ path: f }, signal());
    const body = fake.chats().at(-1)!;
    expect(body.response_format?.type).toBe('json_schema');
    expect(r.summary).toBe('예산 합계가 맞지 않습니다.');
    expect(r.issues).toHaveLength(2);
    expect(r.issues[0]).toMatchObject({ severity: 'error', category: '숫자·금액', message: '세부 합계(250만 원)와 총액(300만 원)이 다릅니다.', suggestion: '합계를 다시 확인하세요.' });
    expect(r.issues[0].location).toContain('총 300만 원');
    expect(r.issues[1].severity).toBe('info');
    expect(r.lint.some((l) => l.rule === 'DATE_NO_SPACE' && l.severity === 'error')).toBe(true);
    expect(r.lint.some((l) => l.rule === 'BUNIM_COLON')).toBe(true);
    expect(r.redacted).toBe(0);
  });
});
