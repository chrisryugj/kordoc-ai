/**
 * 예제 문서 묶음 만들기 — 앱의 "예제로 해 보기"(서무 업무 시연 흐름)용 합성 문서.
 *
 * 전부 지어낸 내용이다: 기관은 가상의 "가온도·가온시", 사람·연락처·주민등록번호도 가짜
 * (주민번호는 마스킹 엔진이 실제로 잡도록 검증 숫자만 맞춘 가짜). 실존 기관·인물을 흉내 내지 않는다.
 * 결과(node-sidecar/samples/)는 레포에 커밋한다 — 빌드마다 만들 필요 없음.
 *
 * 사용: node scripts/make-samples.mjs   (node-sidecar 에서)
 *       받은 공문 PDF 는 이 스크립트가 만들지 않는다(아래 1번 주석) — 커밋된 파일을 그대로 쓴다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as k from 'kordoc';
import JSZip from 'jszip';

/** 앱의 rhwpCompat(src/core/gongmun/rhwp-compat.ts)과 같은 보정 — 목차 틀 pageBreak CELL → NONE (rhwp 조판 결함 우회) */
async function rhwpCompat(buf) {
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n))) {
    let xml = await zip.file(name).async('string');
    let from = 0;
    for (let cell; (cell = xml.indexOf('name="__kordoc_toc"', from)) >= 0; from = cell + 1) {
      const tbl = xml.lastIndexOf('<hp:tbl ', cell);
      const end = xml.indexOf('>', tbl);
      xml = xml.slice(0, tbl) + xml.slice(tbl, end).replace('pageBreak="CELL"', 'pageBreak="NONE"') + xml.slice(end);
    }
    zip.file(name, xml);
  }
  const mt = await zip.file('mimetype').async('uint8array');
  zip.file('mimetype', mt, { compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const OUT = 'samples';

mkdirSync(join(OUT, '취합'), { recursive: true });

const save = (name, bytes) => {
  writeFileSync(join(OUT, name), Buffer.from(bytes));
  console.log(`  ${name} (${Buffer.from(bytes).byteLength.toLocaleString()}B)`);
};

/** 검증 숫자를 맞춘 가짜 주민등록번호 (앞 12자리 → 13번째) */
function fakeRrn(front6, back6) {
  const d = (front6 + back6).split('').map(Number);
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const sum = w.reduce((s, x, i) => s + x * d[i], 0);
  return `${front6}-${back6}${(11 - (sum % 11)) % 10}`;
}

// ── 1. 받은 공문 (일반기안문 서식에 값 채움 → HWPX + PDF) ──
const gian = k.readBuiltinTemplate(k.resolveBuiltinTemplate('gian'));
const received = await k.fillHwpx(gian, {
  행정기관명: '가온도',
  수신자: '가온시장(행정지원과장)',
  경유: ' ', // 빈칸이면 누름틀 안내 글자가 인쇄에 찍힌다
  제목: '2026년 가온도민 한마음 체육대회 참가 협조 요청',
  본문: [
    '1. 관련: 가온도 체육진흥과-2187(2026. 9. 30.)',
    '2. 우리 도는 도민 화합과 생활체육 활성화를 위하여 다음과 같이 한마음 체육대회를 개최하오니, 귀 시 직원이 참가할 수 있도록 협조하여 주시기 바랍니다.',
    '  가. 일시: 2026. 11. 13.(금) 10:00~17:00',
    '  나. 장소: 가온도 종합운동장 주경기장',
    '  다. 종목: 계주, 줄다리기, 족구, 단체 줄넘기(4종)',
    '  라. 참가 규모: 시·군별 30명 이내(선수 20명, 응원 10명)',
    '3. 참가를 희망하는 시·군은 참가 신청서와 선수 명단을 2026. 10. 23.(금)까지 공문으로 제출하여 주시기 바랍니다.',
    '4. 참가자 여행자보험 가입과 단체 버스는 우리 도에서 지원합니다.',
  ].join('\n'),
  붙임: '참가 신청서 및 대회 세부 운영 계획',
  발신명의: '가온도지사',
  수신자명단: ' ', // 빈칸이면 누름틀 안내 글자가 인쇄에 찍힌다
  기안자: '주무관 한누리',
  검토자: '체육진흥팀장 문하늘',
  결재권자: '체육진흥과장 서다온',
  협조자: ' ', // 빈칸이면 누름틀 안내 글자가 인쇄에 찍힌다
  시행번호: '체육진흥과-2203',
  시행일: '2026. 10. 2.',
  접수번호: ' ', // 빈칸이면 누름틀 안내 글자가 인쇄에 찍힌다
  접수일: ' ', // 빈칸이면 누름틀 안내 글자가 인쇄에 찍힌다
  우편번호: '00000',
  주소: '가온도 가온시 도청로 1',
  홈페이지: 'www.gaon.example',
  전화번호: '000-123-4567',
  팩스번호: '000-123-4568',
  전자우편: 'sports@gaon.example',
  공개구분: '공개',
});
const receivedBytes = new Uint8Array(received.buffer);
if (received.unmatched.length) console.warn('  (채우지 못한 칸: ' + received.unmatched.join(', ') + ')');
save('1-받은공문_도민체육대회 참가 협조 요청.hwpx', receivedBytes);
// PDF 는 내장 한글 편집기(rhwp)로 그린 쪽을 인쇄해 만든다 — kordoc 렌더는 칸 안 줄바꿈(hp:lineBreak)을
// 아직 무시해서 본문이 한 덩어리로 붙는다(kordoc 수정 대상). 지금 PDF 는 rhwp-studio getPageSvg → Chrome 인쇄.

// ── 2. 취합: 부서별 교육 수요조사서 5장 ──
const depts = [
  ['총무과', '이가람', '1201', '공문서 작성과 AI 활용 실무', '6', '11월', '오후 반나절 과정이면 좋겠습니다.'],
  ['기획예산과', '박새봄', '1302', '예산 편성 데이터 분석', '4', '12월', '엑셀 실습 위주로 부탁드립니다.'],
  ['민원봉사과', '최다솜', '1405', '민원 응대와 쉬운 공공언어', '9', '11월', '교대 근무라 두 차례로 나눠 주세요.'],
  ['복지정책과', '정한결', '1510', '개인정보 보호와 비식별 처리', '7', '10월', ''],
  ['도시계획과', '윤시원', '1622', '공간정보 시각화 기초', '5', '12월', '노트북 지참 가능합니다.'],
];
for (const [dept, person, ext, course, n, when, note] of depts) {
  const md = [
    '# 2026년 하반기 직무교육 수요조사서',
    '',
    '| 항목 | 내용 |',
    '| --- | --- |',
    `| 부서명 | ${dept} |`,
    `| 담당자 | ${person} |`,
    `| 내선번호 | ${ext} |`,
    `| 희망 교육과정 | ${course} |`,
    `| 희망 인원 | ${n}명 |`,
    `| 희망 시기 | ${when} |`,
    `| 건의 사항 | ${note || '없음'} |`,
    '',
    '위와 같이 교육 수요를 제출합니다.',
  ].join('\n');
  save(join('취합', `교육수요조사서_${dept}.hwpx`), await k.markdownToHwpx(md, { gongmun: { preset: '공문' } }));
}

// ── 3. 개인정보가 든 민원 서류 (정보공개 청구서) ──
const rrn = fakeRrn('900101', '123456');
const md3 = [
  '# 정보공개 청구서',
  '',
  '| 구분 | 내용 |',
  '| --- | --- |',
  '| 청구인 성명 | 김가온 |',
  `| 주민등록번호 | ${rrn} |`,
  '| 주소 | 가온시 한빛로 123, 101동 1004호 |',
  '| 전화번호 | 010-2345-6789 |',
  '| 전자우편 | gaon.kim@example.com |',
  '| 환불 계좌 | 가온은행 123-456789-01-012 |',
  '',
  '## 청구 내용',
  '',
  '2026년 가온시 생활체육 시설 사용료 감면 현황(월별 건수와 금액)을 공개하여 주시기 바랍니다.',
  '',
  `청구인 김가온(연락처 010-2345-6789)은 위와 같이 정보공개를 청구합니다.`,
  '',
  '2026\\. 10. 5.',
].join('\n');
save('3-민원서류_정보공개 청구서.hwpx', await k.markdownToHwpx(md3, { gongmun: { preset: '공문' } }));

// ── 4. 긴 계획 보고서 (요약·문서와 대화용) ──
const md4 = [
  '# 2026 가온시 디지털 행정 혁신 추진계획',
  '',
  '> 반복 문서 업무를 줄이고 시민 응대 품질을 높이기 위해 디지털 행정 혁신 과제를 추진하고자 함',
  '',
  '## 추진 배경',
  '',
  '- 직원 1인당 하루 평균 문서 작성·취합에 2시간 이상 쓰고 있어 본연의 업무 시간이 부족함',
  '  - 2026년 상반기 자체 조사 결과, 취합 업무가 부서당 월 평균 14건 발생',
  '- 정보공개 청구가 전년 대비 18% 늘었으나 개인정보 가림 처리를 손으로 하고 있음',
  '',
  '## 추진 목표',
  '',
  '- 반복 문서 업무 처리 시간 30% 단축 (2026년 12월 기준)',
  '- 정보공개 개인정보 가림 처리 오류 0건',
  '- 전 부서 문서 도구 활용 교육 이수율 80%',
  '',
  '## 세부 추진 과제',
  '',
  '### 공문서 작성 지원',
  '',
  '- 기관 표준 서식을 등록해 칸 채우기만으로 공문을 완성',
  '- 받은 공문을 읽어 회신 초안을 만들고 담당자가 검토 후 결재',
  '',
  '### 취합 자동화',
  '',
  '- 부서별 제출 양식을 한 번에 읽어 엑셀 한 장으로 정리',
  '- 제출 누락 부서를 자동으로 표시',
  '',
  '### 개인정보 보호',
  '',
  '- 정보공개 전 주민등록번호·연락처·계좌 등을 서식 그대로 가림',
  '- 가린 뒤 남은 개인정보를 다시 검사해 사람이 최종 확인',
  '',
  '## 추진 일정',
  '',
  '| 과제 | 10월 | 11월 | 12월 |',
  '| --- | --- | --- | --- |',
  '| 서식 등록·교육 | 시범 부서 3곳 | 전 부서 확대 | 성과 점검 |',
  '| 취합 자동화 | 설계 | 운영 | 개선 |',
  '| 개인정보 보호 | 운영 | 운영 | 점검 |',
  '',
  '## 소요 예산',
  '',
  '- 총 1,200만 원 (교육 운영비 800만 원, 장비 400만 원)',
  '  - 도구는 무료 공개 소프트웨어를 써서 구입비 없음',
  '',
  '## 기대 효과',
  '',
  '- 직원 1인당 월 10시간 이상의 문서 업무 시간 절감',
  '- 개인정보 노출 사고 예방과 정보공개 처리 기간 단축',
].join('\n');
save('4-보고서_디지털 행정 혁신 추진계획.hwpx', await rhwpCompat(await k.markdownToHwpx(md4, { gongmun: { preset: '개조식', cover: { org: '가온시 행정지원과', date: '2026. 10. 1.' }, toc: true } })));

// ── 목록 ──
const index = {
  version: 4,
  note: '모든 예제는 가상의 기관(가온도·가온시)과 가짜 개인정보로 만든 합성 문서입니다.',
  scenarios: [
    { id: 'reply', title: '받은 공문에 회신하기', description: '받은 공문을 읽어 회신 공문 초안을 만들고, 한글 편집기로 고친 뒤 PDF·HWP로 내보냅니다.', files: ['1-받은공문_도민체육대회 참가 협조 요청.pdf', '1-받은공문_도민체육대회 참가 협조 요청.hwpx'] },
    { id: 'collect', title: '부서 제출 양식 취합하기', description: '다섯 부서가 낸 교육 수요조사서를 엑셀 한 장으로 모읍니다.', files: depts.map(([d]) => `취합/교육수요조사서_${d}.hwpx`) },
    { id: 'redact', title: '공개 전 개인정보 가리기', description: '정보공개 청구서의 주민등록번호·연락처·계좌를 서식 그대로 가리고 남은 것이 없는지 다시 검사합니다.', files: ['3-민원서류_정보공개 청구서.hwpx'] },
    { id: 'summary', title: '긴 보고서 요약·질문하기', description: '계획 보고서를 한 장 보고로 줄이고, 질문에는 문서 속 근거를 달아 답합니다.', files: ['4-보고서_디지털 행정 혁신 추진계획.hwpx'] },
  ],
};
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2));
console.log(`[samples] ✅ ${OUT}/ (주민번호 예시 ${rrn} — 가짜)`);
