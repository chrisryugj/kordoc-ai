/**
 * 문서 수합 화면 검증용 가상 제출물 폴더 (가온시, 지어낸 이름·번호)
 *
 *   node scripts/e2e-ui/d-gather-fixtures.mjs <폴더>
 *   → <폴더>/제출물/  한글 5개(예제 서식, 파일 이름 꼴 제각각, 도시계획과는 희망 시기 빈칸)
 *                     엑셀 2개(세무과: 제목 줄·합계 줄 / 가온1동: 칸에만 동 이름)
 *                     서식이 다른 워드 1개(교통행정과 의견)
 *     <폴더>/부서명단.xlsx  8개 부서(환경위생과·문화체육과 미제출)
 *     <폴더>/늦게 온 파일/환경위생과_교육수요.csv
 * 앞서 필요: node-sidecar 를 tsc 로 빌드(dist/core/excel/xlsx.js)
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, SAMPLES } from './ui-lib.mjs';

const require = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
const JSZip = require('jszip');
const { buildXlsx } = await import(pathToFileURL(join(ROOT, 'node-sidecar', 'dist', 'core', 'excel', 'xlsx.js')).href);

export const ROSTER = ['총무과', '기획예산과', '민원봉사과', '복지정책과', '도시계획과', '세무과', '환경위생과', '문화체육과'];

export async function makeGatherFixtures(base) {
  rmSync(base, { recursive: true, force: true });
  const dir = join(base, '제출물');
  const lateDir = join(base, '늦게 온 파일');
  mkdirSync(dir, { recursive: true });
  mkdirSync(lateDir, { recursive: true });
  const names = {
    총무과: '[총무과] 교육수요조사서 제출.hwpx',
    기획예산과: '교육수요조사서(기획예산과).hwpx',
    민원봉사과: '민원봉사과_교육수요조사서.hwpx',
    복지정책과: '복지정책팀 수요조사.hwpx',
    도시계획과: '도시계획과_수요조사서_최종.hwpx',
  };
  for (const [dept, name] of Object.entries(names)) copyFileSync(join(SAMPLES, '취합', `교육수요조사서_${dept}.hwpx`), join(dir, name));
  // 도시계획과: 희망 시기 칸을 비워 냄
  const city = join(dir, names.도시계획과);
  const zip = await JSZip.loadAsync(readFileSync(city));
  for (const n of Object.keys(zip.files).filter((x) => /Contents\/section\d+\.xml$/.test(x))) zip.file(n, (await zip.file(n).async('string')).replace(/>12월</, '><'));
  writeFileSync(city, await zip.generateAsync({ type: 'nodebuffer' }));

  writeFileSync(join(dir, '세무과_교육수요.xlsx'), await buildXlsx([{ name: '제출', rows: [
    ['2026년 하반기 직무교육 수요조사 (세무과)'],
    ['부서', '담당자', '내선 번호', '희망교육과정', '희망 인원(명)', '희망 시기', '비고'],
    ['세무과', '한누리', '1701', '지방세 체납 관리 실무', '3', '11월', '오전 희망'],
    ['세무과', '서다인', '1702', '', '2', '12월', ''],
    ['합계', '', '', '', '5', '', ''],
  ] }]));
  writeFileSync(join(dir, '가온1동 제출.xlsx'), await buildXlsx([{ name: 'Sheet1', header: true, rows: [
    ['부서명', '담당자', '내선번호', '희망 교육과정', '희망 인원', '희망 시기', '건의 사항'],
    ['가온 1동', '문하늘', '2101', '민원 응대 실무', '4명', '10월', '저녁 과정도 있으면 좋겠습니다.'],
  ] }]));

  // 서식이 다른 문서: 표 없는 워드 의견서 (최소 docx)
  const docx = new JSZip();
  docx.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  docx.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  docx.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${para('교육 수요 의견')}${para('교통행정과는 이번 조사에 서식 없이 의견만 드립니다.')}${para('운전직 공무원 안전운전 교육을 11월에 4명 희망합니다.')}</w:body></w:document>`);
  writeFileSync(join(dir, '교통행정과 의견.docx'), await docx.generateAsync({ type: 'nodebuffer' }));

  writeFileSync(join(base, '부서명단.xlsx'), await buildXlsx([{ name: '명단', header: true, rows: [['연번', '부서명', '부서장'], ...ROSTER.map((d, i) => [String(i + 1), d, '부서장'])] }]));
  writeFileSync(join(lateDir, '환경위생과_교육수요.csv'), '﻿부서,담당자,내선번호,희망 교육과정,희망 인원,희망 시기,건의 사항\r\n환경위생과,오세찬,1801,식품위생 점검 실무,2,11월,없음\r\n');
  return { dir, roster: join(base, '부서명단.xlsx'), late: join(lateDir, '환경위생과_교육수요.csv') };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await makeGatherFixtures(process.argv[2] ?? join(ROOT, '.tmp-gather'));
  console.log(JSON.stringify(out, null, 2));
}
