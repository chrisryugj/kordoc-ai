/** 우리 서식으로 맞추기 충실도 재기 — 견본 A 의 서식으로 내용 문서 B 를 만들고, 결과에서 서식을 다시 읽어 A 와 항목마다 대조
 *
 * 실행 (node-sidecar 에서):
 *   KORDOC_AI_DATA_DIR=<빈 폴더> node node_modules/tsx/dist/cli.mjs scripts/style-fidelity.ts <말뭉치 폴더> <결과 폴더> [--png]
 * 말뭉치 폴더: kordoc bench/corpus (공공 문서 — 결과 폴더에만 사본·결과를 쓰고 레포에는 넣지 않는다)
 * --png: 쌍마다 견본 1쪽·결과 1쪽을 rhwp 로 그려 나란히 놓은 PNG (눈으로 보기)
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { extractStyle } from '../src/core/style/extract.ts';
import { restyle } from '../src/core/style/apply.ts';
import { compareFormats, compareStructure, docStructure, type FieldCheck } from '../src/core/style/compare.ts';
import { renderPreset } from '../src/core/style/apply.ts';
import { parseDoc } from '../src/core/converter/index.ts';
import { rhwpPageSvgs } from '../src/core/render/rhwp.ts';

const [corpus, outDir, ...flags] = process.argv.slice(2);
if (!corpus || !outDir) throw new Error('사용법: style-fidelity.ts <말뭉치 폴더> <결과 폴더> [--png]');
const png = flags.includes('--png');
mkdirSync(outDir, { recursive: true });

// 견본 A: 기관·갈래가 다른 21건 (기안문 10 · 보고서·계획서·보도자료 11)
const SAMPLES = [
  'seoul/36262848_결재문서본문_초과근무내역서(현장대응단,+2026-06-09).hwpx',
  'seoul/36262206_결재문서본문_2026년+전입직원+실무적응++교육+결과+제출(현장대응단).hwpx',
  'seoul2/36262198_결재문서본문_국가+예비문화유산+선정조사+실시+알림(국립스포츠박물관).hwpx',
  'seoul2/36262185_결재문서본문_제336회+정례회+의원발의+의안에+대한+의견제출+추가요청.hwpx',
  'review/36428161_결재문서본문.hwpx',
  'gongmun-central/경찰청_20261007_고속도로_경찰관_2차_사고_예방_대책_알림.hwp',
  'gongmun-central/경찰청_20260807_의료사고_수사절차_개선_추진_계획(알림).hwp',
  'hwp5/10773018_결재문서본문.hwpx',
  'hwp5/10772963_결재문서본문.hwpx',
  'misc/「아차산메아리」 게재 요청의 건.hwpx',
  'korea-kr/156765958_[별첨1] 교육혁신선도지역 기본계획 시안.hwpx',
  'korea-kr/156765958_[별첨2] 소규모학교 혁신을 통한 지역 교육력 제고 방안.hwpx',
  'korea-kr/156765937_[보도참고자료] 정은경 장관 쪽방촌 방문, 안전하고 시원한 여름 위해 지원 아끼지 않을 것.hwpx',
  'korea-kr/156765957_백제보 완전개방으로 금강의 물흐름 하나로 연결한다(보도자료)(물관리 6.10).hwpx',
  'korea-kr/156765992_260610 (국방부 보도자료) 핵추진잠수함 범정부협의체(TF) 2차 전체회의_게시.hwpx',
  'korea-kr-pairs/156782177_260917(즉시) _2028년 유엔해양총회_ 준비위 공식출범(기획총괄팀).hwpx',
  'misc/서울어린이대공원-_서울어린이정원페스티벌_개요(2026) (1).hwpx',
  'misc/2026년 5월호 아차산메아리 게재자료 제출.hwpx',
  'hwp5/10773038_결재문서본문.hwpx',
  'seoul-old/10772935_결재문서본문_안전관리활동+결과보고서.hwpx',
  'korea-kr/156765959_260610_보도자료_공공기관 노동이사제 현장안착 지원을 위한 교육 실시(한국고용노동교육원).hwpx',
];

// 내용 문서 B: PDF·HWPX·HWP·워드 섞어서
const CONTENTS = [
  'gongmun-central/과학기술정보통신부_20260908_2027년_띠(양)_특별전_개최_계획(안)_보고.pdf',
  'gongmun-local/경기도_20260805_2026년_소프트웨어_과업심의위원회_심의의견_반영_여부_요청_회신.pdf',
  'seoul2/36262997_결재문서본문_조치명령대상+확인점검+결과보고(○호텔).hwpx',
  'korea-kr/156765943_260611_중기부·농식품부·식약처,_K-푸드_산업의_AI+_제조혁신과_글로벌_진출을_위해_손잡다!.hwpx',
  'gongmun-central/경찰청_20260911_2026년_추석_연휴_교통관리_대책_알림(협조_요청).hwp',
  'lo-pairs/arko-국제교류신청서.docx',
  'gongmun-central/농촌진흥청_20260914_국제농기계_심포지엄_개최_계획(안).pdf',
  'misc/소식지 홍보요청 서식(광진소방서 홍보교육팀).hwpx',
];

const resolve = (rel: string) => {
  const p = join(corpus, rel);
  if (existsSync(p)) return p;
  throw new Error(`없는 파일: ${rel}`);
};

async function firstPagePng(bytes: Uint8Array, width = 620): Promise<Buffer> {
  const pages = await rhwpPageSvgs(bytes);
  return sharp(Buffer.from(pages[0].svg), { density: 96, unlimited: true }).resize({ width }).flatten({ background: '#ffffff' }).png().toBuffer();
}

async function sideBySide(sample: Uint8Array, result: Uint8Array, file: string): Promise<void> {
  const [a, b] = await Promise.all([firstPagePng(sample), firstPagePng(result)]);
  const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
  const h = Math.max(ma.height ?? 0, mb.height ?? 0);
  await sharp({ create: { width: 1260, height: h, channels: 3, background: '#d0d0d0' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 640, top: 0 }]).png().toFile(file);
}

const tally = new Map<string, { ok: number; n: number }>();
const family = (f: string) => f.replace(/\.\d+(\.|$)/, '.N$1');
const rows: Array<{ sample: string; content: string; checks: FieldCheck[]; structure?: FieldCheck[]; error?: string; output?: string }> = [];
const stally = new Map<string, { ok: number; n: number }>();
const srcMd = new Map<string, string>();

for (const [i, rel] of SAMPLES.entries()) {
  const samplePath = resolve(rel);
  let ex;
  try {
    ex = await extractStyle(samplePath);
  } catch (err) {
    rows.push({ sample: rel, content: '-', checks: [], error: `견본 읽기 실패: ${(err as Error).message}` });
    continue;
  }
  console.log(`\n[${i + 1}] ${basename(rel).slice(0, 60)}\n    ${ex.format.summary}`);
  for (const crel of [CONTENTS[(2 * i) % CONTENTS.length], CONTENTS[(2 * i + 1) % CONTENTS.length]]) {
    try {
      const r = await restyle(resolve(crel), ex.format);
      const out = join(outDir, `${String(i + 1).padStart(2, '0')}_${basename(crel).replace(/\.[^.]+$/, '').slice(0, 40)}_우리서식.hwpx`);
      writeFileSync(out, r.bytes);
      const back = await extractStyle(out);
      const checks = compareFormats(ex.format, back.format);
      for (const c of checks) {
        const k = family(c.field);
        const t = tally.get(k) ?? { ok: 0, n: 0 };
        t.n++;
        if (c.ok) t.ok++;
        tally.set(k, t);
      }
      const bad = checks.filter((c) => !c.ok);
      console.log(`    + ${basename(crel).slice(0, 40)}: ${checks.length - bad.length}/${checks.length}${bad.length ? `  (${bad.map((c) => `${c.field} ${c.want}→${c.got}`).join(', ')})` : ''}`);
      // 구조: 원문·결과를 kordoc 으로 다시 읽어 같은 규칙으로 센다 (항목·붙임·끝 표시·표·수신·제목)
      if (!srcMd.has(crel)) srcMd.set(crel, (await parseDoc(resolve(crel), { images: false, ocr: 'off' })).markdown);
      const outMd = (await parseDoc(out, { images: false, ocr: 'off' })).markdown;
      const structure = compareStructure(docStructure(srcMd.get(crel)!), docStructure(outMd), { official: renderPreset(ex.format) === 'official', outText: outMd });
      for (const c of structure) {
        const t = stally.get(c.field) ?? { ok: 0, n: 0 };
        t.n++;
        if (c.ok) t.ok++;
        stally.set(c.field, t);
      }
      const sbad = structure.filter((c) => !c.ok);
      if (sbad.length) console.log(`      구조 다름: ${sbad.map((c) => `${c.field} ${c.want}→${c.got}`).join(', ')}`);
      rows.push({ sample: rel, content: crel, checks, structure, output: out });
      if (png) await sideBySide(ex.bytes, r.bytes, out.replace(/\.hwpx$/, '_나란히.png')).catch((err: Error) => console.log(`      (그림 실패: ${err.message.slice(0, 80)})`));
    } catch (err) {
      console.log(`    x ${basename(crel).slice(0, 40)}: ${(err as Error).message}`);
      rows.push({ sample: rel, content: crel, checks: [], error: (err as Error).message });
    }
  }
}

let ok = 0;
let n = 0;
console.log('\n항목별 일치율');
for (const [k, t] of [...tally].sort()) {
  ok += t.ok;
  n += t.n;
  console.log(`  ${k.padEnd(22)} ${t.ok}/${t.n} (${Math.round((t.ok / t.n) * 100)}%)`);
}
let sok = 0;
let sn = 0;
console.log('\n구조 일치');
for (const [k, t] of [...stally].sort()) {
  sok += t.ok;
  sn += t.n;
  console.log(`  ${k.padEnd(22)} ${t.ok}/${t.n}`);
}
const pairs = rows.filter((r) => r.checks.length);
console.log(`구조 다른 쌍 ${rows.filter((r) => r.structure?.some((c) => !c.ok)).length}/${pairs.length} · 구조 항목 ${sok}/${sn}`);
console.log(`\n전체 ${ok}/${n} (${Math.round((ok / n) * 100)}%) · 쌍 ${pairs.length}/${rows.length} 생성 · 실패 ${rows.filter((r) => r.error).length}`);
writeFileSync(join(outDir, 'fidelity.json'), JSON.stringify({ rows, tally: Object.fromEntries(tally), structure: Object.fromEntries(stally) }, null, 2));
