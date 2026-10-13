/** 행정업무운영 편람 맞춤 — 기안문 두문·결문, 받은 공문 읽기(문서번호·갈래·요청·기한), 서식 칸 채우기, 초안 지침, 서식 맞추기 글 정리
 *
 * 글은 모두 가상의 가온시·나라시 예문이다 (실공문 글 없음).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx, parse } from 'kordoc';
import { beforeAll, describe, expect, it } from 'vitest';
import { ORG, setupEnv } from './doc-helpers.js';
import { updateSettings } from '../src/infra/config.js';
import { receivedDocRef } from '../src/core/ai/prompts.js';
import { KIND_GUIDE, MARKDOWN_RULES, PRESET_GUIDE } from '../src/core/ai/draft-guides.js';
import { generateHwpx, guessPreset, indentAttachments, officialFrame } from '../src/core/gongmun/index.js';
import { extractInbox } from '../src/core/inbox/extract.js';
import { untilDates } from '../src/core/inbox/dates.js';
import { orgAutofill, orgDocFoot, splitZip } from '../src/core/template/org.js';
import { extractStyle } from '../src/core/style/extract.js';
import { gongmunOptions } from '../src/core/style/apply.js';
import { nextGlyph, normalizeContent } from '../src/core/style/normalize.js';

let env: ReturnType<typeof setupEnv>;
const ORG_ZIP = { ...ORG, address: '12345 가온시 시청로 1, 3층' };

beforeAll(async () => {
  env = setupEnv();
  await updateSettings({ org: ORG_ZIP });
});

describe('결문(orgDocFoot)·서식 칸 채우기', () => {
  it('발신명의는 기관장, 결재선은 기안자 + 결재 라인, 우편번호는 주소에서 떼고, 시행은 처리과명만', () => {
    const f = orgDocFoot(ORG_ZIP)!;
    expect(f.sender).toBe('가온시장');
    expect(f.approvers).toEqual(['주무관 김가온', '담당', '팀장', '과장']);
    expect(f).not.toHaveProperty('drafter');
    expect(f.zip).toBe('12345');
    expect(f.address).toBe('가온시 시청로 1, 3층');
    expect(f.docNum).toMatch(/^총무과-\s+\(\s+\)$/);
    expect(f).not.toHaveProperty('disclosure');
    expect(splitZip('가온시 시청로 1')).toEqual({ address: '가온시 시청로 1' });
    expect(orgDocFoot({ ...ORG, name: '', dept: '', position: '', person: '', phone: '', fax: '', email: '', address: '', homepage: '', approval_line: [], doc_number_prefix: '' })).toBeUndefined();
  });

  it('검토자 = 결재 라인 마지막 빼고, 결재권자 = 마지막, 우편번호 따로, "총무과-" 시행번호·공개구분은 비운다', () => {
    const r = orgAutofill(['기안자', '검토자', '결재권자', '우편번호', '주소', '시행번호', '공개구분', '발신명의']);
    expect(r.values).toMatchObject({ 기안자: '주무관 김가온', 검토자: '담당 팀장', 결재권자: '과장', 우편번호: '12345', 주소: '가온시 시청로 1, 3층', 발신명의: '가온시장' });
    expect(r.values).not.toHaveProperty('시행번호');
    expect(r.values).not.toHaveProperty('공개구분');
  });
});

describe('작성실 기안문 두문·결문 (generateHwpx official)', () => {
  const MD = '# 가온시 체육대회 참가 회신\n\n수신: 나라시장(체육과장)\n\n1. 관련: 나라시 체육과-12(2026. 9. 1.)\n2. 참가 계획을 회신합니다.\n\n붙임  1. 참가 계획 1부.\n2. 선수 명단 1부.  끝.\n';

  it('제목·수신 줄은 두문으로 옮기고 본문에서 뺀다', () => {
    const r = officialFrame(indentAttachments(MD));
    expect(r.docHead).toEqual({ org: '가온시', to: '나라시장(체육과장)', title: '가온시 체육대회 참가 회신' });
    expect(r.docFoot?.sender).toBe('가온시장');
    expect(r.markdown).not.toMatch(/^#|수신/m);
    expect(r.markdown.startsWith('1. 관련:')).toBe(true);
    // 쌍점 없는 수신 줄(편람 표기)도
    expect(officialFrame('# 알림\n\n수신 내부결재\n\n1. 알립니다.').docHead?.to).toBe('내부결재');
  });

  it('붙임 둘째 줄부터 6칸 들여 같은 붙임으로 (번호가 본문 항목으로 바뀌지 않게)', () => {
    expect(indentAttachments('붙임  1. 계획 1부.\n2. 명단 1부.\n3. 사진 1부.  끝.')).toBe('붙임  1. 계획 1부.\n      2. 명단 1부.\n      3. 사진 1부.  끝.');
    expect(indentAttachments('1. 첫째\n2. 둘째')).toBe('1. 첫째\n2. 둘째');
  });

  it('만든 문서: 두문 기관명·수신·제목, 결문 발신명의·기안자, 붙임 번호 유지', async () => {
    const out = join(env.out, '회신.hwpx');
    await generateHwpx({ markdown: MD, preset: 'official', output_path: out });
    const text = (await parse(readFileSync(out))).markdown;
    expect(text).toContain('나라시장(체육과장)');
    expect(text).toContain('가온시장');
    expect(text).toContain('김가온');
    expect(text).toMatch(/2\. 선수 명단 1부\./);
    expect(text).not.toMatch(/3\. 선수 명단/);
  });
});

describe('우리 서식으로 맞추기: 두문 기관명·결문', () => {
  it('견본 기관 이름·표어 대신 내 기관 이름, 발신명의는 기관장, 결재선 맨 앞은 기안자', async () => {
    const p = join(env.work, '나라시_견본.hwpx');
    writeFileSync(p, Buffer.from(await markdownToHwpx('1. 알립니다.\n2. 협조 바랍니다.\n', {
      gongmun: { preset: 'official', docHead: { org: '나라시', slogan: '살기 좋은 나라시', to: '내부결재', title: '견본 제목' } }, warnings: [],
    })));
    const { format } = await extractStyle(p);
    const g = gongmunOptions(format, { to: '가온도지사(총무과장)', title: '새 제목' });
    expect(g.docHead).toMatchObject({ org: '가온시', to: '가온도지사(총무과장)', title: '새 제목' });
    expect(g.docHead?.slogan).toBeUndefined();
    expect(g.docFoot).toMatchObject({ sender: '가온시장', approvers: ['주무관 김가온', '담당', '팀장', '과장'], zip: '12345' });
    expect(g.docFoot).not.toHaveProperty('drafter');
  });
});

describe('받은 공문 문서번호 (receivedDocRef)', () => {
  it('시행일 괄호가 없거나 비어도, "시 행"·"시행:"·여러 마디 번호·숫자로 시작하거나 띄어 쓴 처리과명도', () => {
    expect(receivedDocRef('가온도\n\n시행 체육과-77 접수')?.number).toBe('체육과-77');
    expect(receivedDocRef('시행 감사과-8 ( ) 접수 ( )')?.ref).toBe('감사과-8');
    expect(receivedDocRef('시 행 총무과-12 (2026. 1. 5.)')?.ref).toBe('총무과-12(2026. 1. 5.)');
    expect(receivedDocRef('○ 시행: 기획부-15(2026-10-01) 접수')?.ref).toBe('기획부-15(2026-10-01)');
    expect(receivedDocRef('시행 인증단-2026-55 ( 2026년 09월 15일 )')).toMatchObject({ number: '인증단-2026-55', dept: '인증단' });
    expect(receivedDocRef('시행 119구조과-31 접수')?.number).toBe('119구조과-31');
    expect(receivedDocRef('시행 가온도교육청 가온도서관 -28 ( ) 접수 ( )')?.number).toBe('가온도교육청 가온도서관-28');
    expect(receivedDocRef('시행 미래사업 추진 TF-9 ( 2026.09.09 )')?.number).toBe('미래사업 추진 TF-9');
    expect(receivedDocRef('시행 가온클럽-7 2026.09.30. 접수 ( )')?.ref).toBe('가온클럽-7(2026.09.30.)');
  });

  it('본문에 나온 "시행"보다 끝의 결문 시행 줄을 쓴다', () => {
    expect(receivedDocRef('1. 사업을 시행 계획-3 에 따라 추진합니다.\n\n시행 총무과-40 (2026. 2. 1.)')?.number).toBe('총무과-40');
  });
});

describe('갈래 고르기 (guessPreset)', () => {
  it('"수 신"·"제 목" 옛 서식, 보도자료를 보고하는 기안문도 기안문', () => {
    expect(guessPreset('가온시\n\n수 신 내부결재\n\n제 목 시설 점검 결과 보고\n\n1. 보고합니다.')).toBe('official');
    expect(guessPreset('가온시\n\n수신 내부결재\n\n제목 언론 보도자료 배포 보고\n\n1. 보도자료를 배포하고자 합니다.')).toBe('official');
    expect(guessPreset('# 보도자료\n\n보도 일시: 2026. 10. 1.')).toBe('press');
  });
});

describe('받은 공문 요청·기한 (extractInbox)', () => {
  const doc = (body: string, to = '가온시장(총무과장)') => `나라시\n\n수신 ${to}\n\n제목 행사 협조 요청\n\n${body}\n\n나라시장\n\n시행 행사과-5 (2026. 10. 1.) 접수 ( )`;

  it('수신이 내부결재면 요청이 없다', () => {
    expect(extractInbox(doc('1. 결과를 2026. 10. 20.까지 제출하여 주시기 바랍니다.', '내부결재'), '2026-10-13').requests).toEqual([]);
  });

  it('"부탁드립니다"·"요청 드립니다"도 요청', () => {
    expect(extractInbox(doc('1. 행사에 참석하여 주시기를 부탁드립니다.'), '2026-10-13').requests.map((r) => r.text).join()).toContain('참석');
    expect(extractInbox(doc('1. 위 호와 관련하여 예산 배정을 아래와 같이 요청 드립니다.'), '2026-10-13').requests[0]?.text).toContain('예산 배정');
  });

  it('"…주시기 바라며, …주시기 바랍니다"는 요청 둘', () => {
    const r = extractInbox(doc('1. 회의를 개최하오니 참석하여 주시기 바라며, 각 부서는 의견을 제출하여 주시기 바랍니다.'), '2026-10-13').requests.map((q) => q.text);
    expect(r.some((t) => t.includes('참석'))).toBe(true);
    expect(r.some((t) => t.includes('의견을 제출'))).toBe(true);
  });

  it('PDF 에서 갈라진 "까 지", 물결 기한 "~10.16."·"~ 2026. 10. 16."', () => {
    expect(extractInbox(doc('1. 명단을 10. 20.(화)까 지 제출하여 주시기 바랍니다.'), '2026-10-13').requests[0]?.due).toBe('2026-10-20');
    const r = extractInbox(doc('가. 제출: 실적 자료 ~10.16. / 문서 회신\n\n나. 설문조사: ~ 2026. 10. 23.'), '2026-10-13').requests;
    expect(r.map((q) => q.due)).toEqual(['2026-10-16', '2026-10-23']);
    expect(r[1].text).toContain('설문조사');
  });

  it('기간(앞에 날짜·요일)·괄호 속 일정·"5월4주"는 물결 기한이 아니다', () => {
    expect(untilDates('기간: 2026. 10. 1.(목) ~ 10. 5.(월)', '2026-10-13')).toEqual([]);
    expect(untilDates('확정 통보(~10월 28일)', '2026-10-13')).toEqual([]);
    expect(untilDates('공고 ~5월4주', '2026-10-13')).toEqual([]);
    expect(untilDates('운영: ~12. 31.', '2026-10-13')).toEqual(['2026-12-31']);
  });
});

describe('초안 지침 (편람 표기)', () => {
  it('금액은 한글 병기, 수신은 쌍점 없이, 관련 문서는 (날짜, “제목”)', () => {
    expect(MARKDOWN_RULES).toContain('금1,500,000원(금일백오십만원)');
    expect(KIND_GUIDE.reply).toContain('"수신 " 뒤에');
    expect(KIND_GUIDE.reply).not.toContain('"수신: "');
    expect(PRESET_GUIDE.official).toContain('(2026. 3. 5., “근거 공문 제목”)');
  });
});

describe('서식 맞추기 글 정리: 원문 결문·두문 걷기, 가./나. 단계', () => {
  const SRC = [
    '살기 좋은 나라시', '나라시', '수신 내부결재', '(경유)', '제목 민원 회신',
    '민원 내용은 다음과 같습니다.', '가. 첫째 질의입니다.', '나. 둘째 질의입니다.', '이상과 같이 판단됩니다.',
    '검토 의견은 다음과 같습니다.', '가. 첫째 의견을 적었습니다.', '해당 사례가 아닙니다.', '나. 둘째 의견을 적었습니다.',
    '문의는 담당자에게 하시기 바랍니다.',
    '주무관 박나라 팀장 이나라 과장 전결 10/02', '최나라', '협조자', '시행 민원과-9 ( 2026. 10. 2. ) 접수 ( )',
    '우 54321 나라시 중앙로 9 / www.nara.example', '전화 000-0000-0000 /전송 000-0000-0001 / nara@example.go.kr / 공개',
  ].join('\n\n');

  it('끝 표시가 없어도 서명 줄·협조자·시행·주소·전화 줄을 버리고, 두문 줄도 남기지 않는다', () => {
    const r = normalizeContent(SRC, { keepEndMark: true, legalDepth: true });
    expect(r.title).toBe('민원 회신');
    expect(r.to).toBe('내부결재');
    expect(r.markdown).not.toMatch(/박나라|최나라|협조자|시행|54321|전화|살기 좋은|수신|경유/);
    expect(r.markdown).toMatch(/하시기 바랍니다\.  끝\.\n$/);
  });

  it('가./나. 는 2단계 그대로 (1. 로 바꾸지 않음), 번호를 잇는 사이 문단은 앞 항목에, 새 목록은 가. 부터', () => {
    const md = normalizeContent(SRC, { keepEndMark: true, legalDepth: true }).markdown;
    expect(md).toContain('  - 첫째 질의입니다.\n  - 둘째 질의입니다.\n\n이상과 같이 판단됩니다.');
    expect(md).toContain('  - 첫째 의견을 적었습니다. 해당 사례가 아닙니다.\n  - 둘째 의견을 적었습니다.');
    expect(nextGlyph('가.')).toBe('나.');
    expect(nextGlyph('2)')).toBe('3)');
    expect(nextGlyph('(가)')).toBe('(나)');
    expect(nextGlyph('①')).toBe('②');
  });

  it('결문 날짜 서명 줄("… 전결 2026. 6. 26.")도 걷는다', () => {
    const md = normalizeContent('수신 내부결재\n\n제목 보고\n\n1. 보고합니다.\n\n주무관 팀장 과장 전결 2026. 6. 26.\n\n김나라 이나라\n\n협조자\n\n시행 기획과-3 접수', { keepEndMark: true, legalDepth: true }).markdown;
    expect(md).toBe('# 보고\n\n- 보고합니다.  끝.\n');
  });
});
