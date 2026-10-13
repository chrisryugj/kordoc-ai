/**
 * 결재 전 점검 화면 검증용 예시 문서 — 일부러 틀린 곳을 심은 기안문 HWPX 를 만든다.
 *
 * 심은 것: 요일 틀림(점 날짜·년월일 날짜), 표 합계 틀림, 날짜 띄어쓰기, 쌍점 띄어쓰기, 금액 한글 병기 없음,
 * 쉬운 말(금번), 개인정보(휴대전화·이름·주소), 기관 대표번호(남길 것), 빈 누름틀(안내 글자), "끝." 없음.
 *
 * 사용: node scripts/e2e-ui/make-precheck-sample.mjs <출력 폴더>   (node-sidecar 의 kordoc·jszip 을 쓴다)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = resolve(process.argv[2] ?? '.');
const req = createRequire(resolve('node-sidecar/package.json'));
const { markdownToHwpx } = await import(pathToFileURL(req.resolve('kordoc')).href);
const JSZip = (await import(pathToFileURL(req.resolve('jszip')).href)).default;

const FIELD = '@@FIELD@@';
const md = `# 2026년 가온시민 한마음 걷기대회 개최 계획

1. 관련 : 가온시 체육진흥과-1234(2026.10.5.)
2. 가온시민의 건강 증진과 화합을 위하여 다음과 같이 걷기대회를 개최하고자 합니다.
  가. 일시: 2026. 11. 6.(목) 10:00∼12:00
  나. 장소: 가온천 둔치 산책로
  다. 사전 설명회: 2026년 11월 2일(수) 14:00
  라. 소요 예산: 금1500000원
  마. 문의: 체육진흥과 주무관 홍길동(010-2345-6789), 대표번호 031-123-4567
  바. 시행일: ${FIELD}
3. 행사는 다음 순서로 진행합니다.

| 시간 | 내용 | 담당 |
| --- | --- | --- |
| 09:30∼10:00 | 참가자 접수 및 기념품 배부 | 체육진흥과 |
| 10:00∼10:20 | 개회식 및 준비 운동 | 가온시체육회 |
| 10:20∼11:30 | 둔치 산책로 5㎞ 걷기 | 전 참가자 |
| 11:30∼12:00 | 경품 추첨 및 폐회 | 체육진흥과 |

  가. 안전 관리: 구간별 안전 요원 20명을 두고 구급차 1대를 출발점에 대기시킵니다.
  나. 교통 통제: 가온천 둔치 진입로 2곳을 09:00부터 12:30까지 통제합니다.
  다. 우천 시: 행사 3일 전까지 기상 예보를 확인하여 연기 여부를 알립니다.
  라. 홍보: 시 누리집과 읍면동 게시판, 현수막 10곳으로 알립니다.
  마. 참가 신청: 2026. 10. 26.(월)부터 2026. 10. 30.(금)까지 읍면동 주민센터에서 받습니다.
  바. 참가 대상: 가온시민 누구나(어린이는 보호자와 함께)
  사. 기념품: 참가자 300명에게 걷기용 손수건과 생수를 나누어 줍니다.
  아. 쓰레기 줄이기: 일회용 컵 대신 개인 물병을 가져오도록 안내합니다.
  자. 장애인 참가: 휠체어가 다닐 수 있는 1㎞ 구간을 따로 정해 운영합니다.
  차. 의료 지원: 보건소 간호사 2명이 반환점 쉼터에서 응급 처치를 맡습니다.
  카. 주차: 종합운동장 주차장(300면)을 쓰고 셔틀버스 2대를 운행합니다.
  타. 자원봉사: 가온시자원봉사센터를 통해 봉사자 30명을 모집합니다.
  파. 사진 기록: 행사 사진은 시 누리집 소식란에 올려 함께 나눕니다.
  하. 만족도 조사: 행사 뒤 참가자 100명을 뽑아 설문을 받습니다.

4. 세부 예산은 아래와 같습니다.

| 항목 | 금액(원) | 비고 |
| --- | --- | --- |
| 기념품 | 800,000 | 300명 |
| 홍보물 | 400,000 | 현수막 |
| 행사 운영 | 250,000 | 음료 |
| 합계 | 1,500,000 | |

5. 금번 행사 참가자 명단은 담당자 김영희(서울특별시 광진구 자양로 117)에게 제출하여 주시기 바랍니다.

붙임  걷기대회 세부 계획 1부.
`;

const buf = await markdownToHwpx(md, { gongmun: { preset: 'official', endMark: false } });
const zip = await JSZip.loadAsync(buf);
const name = Object.keys(zip.files).find((n) => /Contents\/section0\.xml$/.test(n));
let xml = await zip.file(name).async('string');
// 빈 누름틀(안내 글자만 있는 칸)을 심는다 — 한컴 기안문 서식과 같은 모양
const guide = '시행 날짜를 입력하세요';
const rest = `Direction:wstring:${guide.length}:${guide} HelpState:wstring:0:  `;
const field = `<hp:ctrl><hp:fieldBegin id="1900000001" type="CLICK_HERE" name="시행일" editable="1"><hp:parameters cnt="1" name=""><hp:stringParam name="Command">Clickhere:set:${rest.length}:${rest}</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl><hp:ctrl><hp:fieldEnd beginIDRef="1900000001"/></hp:ctrl>`;
const at = xml.indexOf(FIELD);
if (at < 0) throw new Error('누름틀 자리를 찾지 못했습니다');
const tEnd = xml.indexOf('</hp:t>', at);
xml = `${xml.slice(0, at)}</hp:t>${field}<hp:t>${xml.slice(at + FIELD.length, tEnd)}${xml.slice(tEnd)}`.replace('<hp:t></hp:t>', '');
zip.file(name, xml);
mkdirSync(out, { recursive: true });
const file = join(out, '결재전점검_예시.hwpx');
writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(file);
