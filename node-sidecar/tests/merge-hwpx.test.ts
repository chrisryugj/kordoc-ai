/** HWPX·HWP 서식 유지 수합 — 한컴오피스 없이 XML 수준 병합 (레포 예제 + 코퍼스가 있으면 실문서) */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { parse, validateHwpx } from 'kordoc';
import { mergeFiles, splitHangul } from '../src/core/merge/index.js';
import { openRhwp, rhwpPages } from '../src/core/render/rhwp.js';

const SAMPLES = resolve(__dirname, '..', 'samples');
const received = join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.hwpx');
const pii = join(SAMPLES, '3-민원서류_정보공개 청구서.hwpx');
const report = join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx');
const CORPUS = join(homedir(), 'workspace', 'kordoc', 'bench', 'corpus');
const pressDir = join(CORPUS, 'korea-kr');
const press = existsSync(pressDir) ? readdirSync(pressDir).filter((n) => n.endsWith('.hwpx')).map((n) => join(pressDir, n))[0] : undefined;
const hwp5 = join(CORPUS, 'hwp5', 'merging-cell.hwp');

const signal = new AbortController().signal;
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'merge-hwpx-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function check(out: string, texts: string[]) {
  const bytes = readFileSync(out);
  const v = await validateHwpx(bytes);
  expect(v.ok, JSON.stringify(v.issues)).toBe(true);
  const r = await parse(bytes);
  expect(r.success).toBe(true);
  for (const t of texts) expect(r.success && r.markdown.includes(t), t).toBe(true);
  const doc = (await openRhwp(new Uint8Array(bytes))) as unknown as { pageCount(): number; free?(): void };
  const pages = doc.pageCount();
  doc.free?.();
  return { bytes, pages };
}

/** 첫 구역 첫 문단(쪽 설정이 든 run)에 쪽 번호와 알아볼 글이 든 머리말을 넣은 사본 */
async function withPageCtrls(src: string, name: string, mark: string) {
  const zip = await JSZip.loadAsync(readFileSync(src));
  const xml = await zip.file('Contents/section0.xml')!.async('string');
  const at = xml.indexOf('</hp:run>', xml.indexOf('</hp:secPr>'));
  const ctrls = `<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl><hp:ctrl><hp:header id="1" applyPageType="BOTH"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="42520" textHeight="4252" hasTextRef="0" hasNumRef="0"><hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>${mark}</hp:t></hp:run></hp:p></hp:subList></hp:header></hp:ctrl>`;
  zip.file('Contents/section0.xml', xml.slice(0, at) + ctrls + xml.slice(at));
  const path = join(dir, name);
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
}

/** 구역이 바탕쪽(masterpage0)을 가리키는 사본 */
async function withMasterPage(src: string, name: string, mark: string) {
  const zip = await JSZip.loadAsync(readFileSync(src));
  zip.file('Contents/masterpage0.xml', `<?xml version="1.0" encoding="UTF-8"?><masterPage xmlns="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" id="masterpage0" type="BOTH"><hp:subList><hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="7"><hp:t>${mark}</hp:t></hp:run></hp:p></hp:subList></masterPage>`);
  const hpf = await zip.file('Contents/content.hpf')!.async('string');
  zip.file('Contents/content.hpf', hpf.replace('</opf:manifest>', '<opf:item id="masterpage0" href="Contents/masterpage0.xml" media-type="application/xml"/></opf:manifest>'));
  const sec = await zip.file('Contents/section0.xml')!.async('string');
  zip.file('Contents/section0.xml', sec.replace(/masterPageCnt="0"/, 'masterPageCnt="1"').replace('</hp:secPr>', '<hp:masterPage idRef="masterpage0"/></hp:secPr>'));
  const path = join(dir, name);
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
}

describe('HWPX 서식 유지 수합 (순수 XML)', () => {
  it('예제 3개 → 한 파일, 세 문서 글이 다 있고 구조 검증·rhwp 열기 통과', async () => {
    const out = join(dir, 'samples.hwpx');
    const r = await mergeFiles({ files: [received, pii, report], output_path: out, mode: 'native' }, signal);
    expect(r.success).toBe(true);
    expect(r.file_count).toBe(3);
    const { bytes, pages } = await check(out, ['한마음 체육대회', '정보공개 청구서', '디지털 행정 혁신']);
    expect(pages).toBeGreaterThanOrEqual(4);
    // 구역 3개·mimetype 이 첫 항목이고 압축 없음
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
    const hpf = await zip.file('Contents/content.hpf')!.async('string');
    expect((hpf.match(/<opf:itemref idref="section\d+"/g) ?? []).length).toBe(3);
    expect(await zip.file('Contents/header.xml')!.async('string')).toContain('secCnt="3"');
  });

  it('글자 모양 ID 가 겹치지 않게 다시 매겨진다 (뒤 문서 참조가 바탕 목록 범위 안)', async () => {
    const out = join(dir, 'ids.hwpx');
    await mergeFiles({ files: [received, report], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const header = await zip.file('Contents/header.xml')!.async('string');
    const charIds = new Set([...header.matchAll(/<hh:charPr id="(\d+)"/g)].map((m) => m[1]));
    const paraIds = new Set([...header.matchAll(/<hh:paraPr id="(\d+)"/g)].map((m) => m[1]));
    for (const sec of Object.keys(zip.files).filter((n) => /section\d+\.xml$/.test(n))) {
      const xml = await zip.file(sec)!.async('string');
      for (const m of xml.matchAll(/charPrIDRef="(\d+)"/g)) expect(charIds.has(m[1]), `${sec} charPr ${m[1]}`).toBe(true);
      for (const m of xml.matchAll(/paraPrIDRef="(\d+)"/g)) expect(paraIds.has(m[1]), `${sec} paraPr ${m[1]}`).toBe(true);
    }
  });

  it('합친 문서에 또 합쳐도 앞서 합친 문서의 그림이 덮이지 않는다 (그림 이름 머리가 겹치지 않게)', async () => {
    // 세 문서 모두 그림 id 가 image1 (내용은 서로 다름)
    const withPicture = async (name: string, mark: string) => {
      const zip = await JSZip.loadAsync(readFileSync(received));
      zip.file('BinData/image1.png', Buffer.from(`picture-${mark}`));
      const hpf = await zip.file('Contents/content.hpf')!.async('string');
      zip.file('Contents/content.hpf', hpf.replace('</opf:manifest>', '<opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/></opf:manifest>'));
      const path = join(dir, name);
      writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
      return path;
    };
    const [a, b, c] = [await withPicture('pic-a.hwpx', 'A'), await withPicture('pic-b.hwpx', 'B'), await withPicture('pic-c.hwpx', 'C')];
    const ab = join(dir, 'pic-ab.hwpx');
    await mergeFiles({ files: [a, b], output_path: ab, mode: 'native' }, signal);
    const abc = join(dir, 'pic-abc.hwpx');
    await mergeFiles({ files: [ab, c], output_path: abc, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(readFileSync(abc));
    const pics = Object.keys(zip.files).filter((n) => /^BinData\/.*image1\.png$/.test(n));
    const contents = await Promise.all(pics.map((n) => zip.file(n)!.async('string')));
    expect(contents.sort()).toEqual(['picture-A', 'picture-B', 'picture-C']);
    const hpf = await zip.file('Contents/content.hpf')!.async('string');
    const ids = [...hpf.matchAll(/<opf:item [^>]*\bid="([^"]*image1)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toHaveLength(3);
  });

  it('암호 걸린 HWPX 가 섞이면 그 파일만 빼고 합치고, 까닭을 한국어로 알린다', async () => {
    const zip = await JSZip.loadAsync(readFileSync(pii));
    zip.file('Contents/header.xml', Buffer.from([0x8f, 0x12, 0xa0, 0x3c, 0x77, 0x01, 0xfe, 0x55]));
    zip.file('META-INF/manifest.xml', '<?xml version="1.0"?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><odf:file-entry odf:full-path="Contents/header.xml"><odf:encryption-data/></odf:file-entry></odf:manifest>');
    const locked = join(dir, 'locked.hwpx');
    writeFileSync(locked, await zip.generateAsync({ type: 'nodebuffer' }));
    const out = join(dir, 'with-locked.hwpx');
    const r = await mergeFiles({ files: [received, locked, report], output_path: out, mode: 'native' }, signal);
    expect(r.failed.map((f) => f.path)).toEqual([locked]);
    expect(r.failed[0].error).toMatch(/암호가 걸린 문서/);
    expect(r.failed[0].error).not.toMatch(/[A-Za-z]{6,}/);
    expect(r.file_count).toBe(2);
    await check(out, ['한마음 체육대회', '디지털 행정 혁신']);
  });

  it('앞 문서의 머리말·쪽 번호가 뒤 문서 쪽에 찍히지 않는다 (뒤 문서 첫 구역에 끊는 빈 것), 자기 것이 있으면 그대로', async () => {
    const headed = await withPageCtrls(report, 'headed.hwpx', '총무과머리말표시');
    const out = join(dir, 'header-carry.hwpx');
    await mergeFiles({ files: [headed, received], output_path: out, mode: 'native' }, signal);
    const { bytes } = await check(out, ['한마음 체육대회', '디지털 행정 혁신']);
    const zip = await JSZip.loadAsync(bytes);
    const sec1 = await zip.file('Contents/section1.xml')!.async('string');
    expect(sec1).toMatch(/<hp:header id="0" applyPageType="BOTH"><hp:subList\b[^>]*><hp:p\b[^>]*><hp:run\b[^>]*><hp:t\/><\/hp:run><\/hp:p><\/hp:subList><\/hp:header>/);
    expect(sec1).toContain('<hp:pageNum pos="NONE"');
    expect(sec1).not.toContain('총무과머리말표시');
    // 그린 쪽: 앞 문서 쪽에는 머리말과 쪽 번호(보고서는 표지 쪽만 감추기), 공문 쪽(마지막)에는 둘 다 없다
    const pages: string[] = [];
    for await (const p of rhwpPages(new Uint8Array(bytes))) pages.push([...p.svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')).join('').replace(/\s+/g, ''));
    expect(pages[1]).toContain('총무과머리말표시');
    expect(pages.at(-2)).toMatch(/-\d+-$/);
    expect(pages.at(-1)).toContain('체육대회');
    expect(pages.at(-1)).not.toContain('총무과머리말표시');
    expect(pages.at(-1)).not.toMatch(/-\d+-$/);

    // 뒤 문서가 자기 머리말·쪽 번호를 가지면 끊는 것을 넣지 않는다
    const own = await withPageCtrls(received, 'own.hwpx', '회계과머리말표시');
    const out2 = join(dir, 'header-own.hwpx');
    await mergeFiles({ files: [headed, own], output_path: out2, mode: 'native' }, signal);
    const sec = await (await JSZip.loadAsync(readFileSync(out2))).file('Contents/section1.xml')!.async('string');
    expect(sec.match(/<hp:header\b/g)).toHaveLength(1);
    expect(sec.match(/<hp:pageNum\b/g)).toHaveLength(1);
    expect(sec).toContain('회계과머리말표시');
    expect(sec).not.toContain('pos="NONE"');
  }, 60_000);

  it('뒤 문서 구역이 가리키는 바탕쪽을 이름 머리를 붙여 옮긴다 (첫 문서의 같은 이름 바탕쪽과 겹치지 않게)', async () => {
    const a = await withMasterPage(received, 'master-a.hwpx', '첫문서바탕쪽', 0);
    const b = await withMasterPage(report, 'master-b.hwpx', '대외비바탕쪽', 7);
    const out = join(dir, 'master.hwpx');
    await mergeFiles({ files: [a, b], output_path: out, mode: 'native' }, signal);
    await check(out, ['한마음 체육대회', '디지털 행정 혁신']);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const hpf = await zip.file('Contents/content.hpf')!.async('string');
    expect(hpf).toContain('<opf:item id="masterpage0" href="Contents/masterpage0.xml"');
    expect(hpf).toContain('<opf:item id="m1_masterpage0" href="Contents/m1_masterpage0.xml"');
    expect(await zip.file('Contents/masterpage0.xml')!.async('string')).toContain('첫문서바탕쪽');
    const moved = await zip.file('Contents/m1_masterpage0.xml')!.async('string');
    expect(moved).toContain('대외비바탕쪽');
    expect(moved).toContain('id="m1_masterpage0"');
    // 바탕쪽 안의 글자 모양도 합본의 id 로 (뒤 문서의 charPr 7 은 합본에서 첫 문서 글자 모양 뒤 번호)
    const baseChars = ((await (await JSZip.loadAsync(readFileSync(received))).file('Contents/header.xml')!.async('string')).match(/<hh:charPr id=/g) ?? []).length;
    expect(moved).toContain(`charPrIDRef="${baseChars + 7}"`);
    expect(await zip.file('Contents/section0.xml')!.async('string')).toContain('<hp:masterPage idRef="masterpage0"/>');
    expect(await zip.file('Contents/section1.xml')!.async('string')).toContain('<hp:masterPage idRef="m1_masterpage0"/>');
  });

  it('번호 머리의 글자 모양 참조도 합본의 id 로 바꾼다', async () => {
    const zip = await JSZip.loadAsync(readFileSync(report));
    const head = await zip.file('Contents/header.xml')!.async('string');
    zip.file('Contents/header.xml', head.replace(/(<hh:paraHead\b[^>]*\blevel="1"[^>]*\bcharPrIDRef=")4294967295"/, '$15"'));
    const b = join(dir, 'numhead.hwpx');
    writeFileSync(b, await zip.generateAsync({ type: 'nodebuffer' }));
    const out = join(dir, 'numhead-out.hwpx');
    await mergeFiles({ files: [received, b], output_path: out, mode: 'native' }, signal);
    const merged = await (await JSZip.loadAsync(readFileSync(out))).file('Contents/header.xml')!.async('string');
    const baseChars = ((await (await JSZip.loadAsync(readFileSync(received))).file('Contents/header.xml')!.async('string')).match(/<hh:charPr id=/g) ?? []).length;
    const heads = [...merged.matchAll(/<hh:paraHead\b[^>]*\blevel="1"[^>]*\bcharPrIDRef="(\d+)"/g)].map((m) => m[1]);
    expect(heads).toContain(String(baseChars + 5));
    expect(heads).not.toContain('5');
  });

  it.skipIf(!press || !existsSync(hwp5))('실문서: 그림 든 보도자료 + HWP 5.x 섞어 합치기 (그림 옮김)', async () => {
    const out = join(dir, 'real.hwpx');
    const r = await mergeFiles({ files: [received, press!, hwp5], output_path: out, mode: 'native' }, signal);
    expect(r.failed_files).toHaveLength(0);
    const { bytes } = await check(out, ['한마음 체육대회', '쪽방']);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).some((n) => n.startsWith('BinData/m1_'))).toBe(true);
  }, 60_000);

  it('HWP 로 저장 (rhwp 변환)', async () => {
    const out = join(dir, 'merged.hwp');
    await mergeFiles({ files: [received, pii], output_path: out, mode: 'native' }, signal);
    const r = await parse(readFileSync(out));
    expect(r.success && r.markdown.includes('한마음 체육대회') && r.markdown.includes('정보공개 청구서')).toBe(true);
  });

  it('깨진 HWPX 하나는 빼고 합치며 어느 파일인지·이유를 failed 에 담는다', async () => {
    const bad = join(dir, '깨진 문서.hwpx');
    writeFileSync(bad, 'PK not really');
    const out = join(dir, 'with-bad.hwpx');
    const r = await mergeFiles({ files: [received, bad, report], output_path: out, mode: 'native' }, signal);
    expect(r.file_count).toBe(2);
    expect(r.failed_files).toEqual([bad]);
    expect(r.failed).toEqual([{ path: bad, error: expect.stringMatching(/손상됐거나 저장이 끝나지 않은/) }]);
    await check(out, ['한마음 체육대회', '디지털 행정 혁신']);
  });

  it('0바이트 HWP·HWP 가 아닌 HWP 는 그 파일만 빼고, 까닭을 영어 오류 코드 없이 한국어로 알린다 (나누기도)', async () => {
    const empty = join(dir, '빈 공문.hwp');
    writeFileSync(empty, Buffer.alloc(0));
    const junk = join(dir, '이름만 한글.hwp');
    writeFileSync(junk, 'not a hwp file at all');
    const out = join(dir, 'with-empty.hwpx');
    const r = await mergeFiles({ files: [received, empty, junk, report], output_path: out, mode: 'native' }, signal);
    expect(r.file_count).toBe(2);
    const why = Object.fromEntries(r.failed.map((f) => [f.path, f.error]));
    expect(why[empty]).toMatch(/빈 파일\(0바이트\)/);
    expect(why[junk]).toMatch(/한글\(HWP\) 문서로 읽을 수 없습니다/);
    for (const e of Object.values(why)) expect(e).not.toMatch(/[A-Za-z]{6,}|rhwp/);
    await expect(splitHangul({ path: empty, output_dir: join(dir, 'split-empty') }, signal)).rejects.toThrow(/빈 공문\.hwp: 내용이 없는 빈 파일/);
    await expect(splitHangul({ path: junk, output_dir: join(dir, 'split-junk') }, signal)).rejects.toThrow(/한글\(HWP\) 문서로 읽을 수 없습니다/);
  });

  it('합칠 수 있는 문서가 하나뿐이면 오류에 못 읽은 파일 이름을 넣는다', async () => {
    const bad = join(dir, '깨진 공문.hwpx');
    writeFileSync(bad, 'PK not really');
    await expect(mergeFiles({ files: [received, bad], output_path: join(dir, 'x.hwpx'), mode: 'native' }, signal)).rejects.toThrow(/깨진 공문\.hwpx/);
  });

  it('마크다운 방식: 일부 실패는 failed 에, 다 실패하면 빈 파일 대신 오류', async () => {
    const bad = join(dir, '깨진.hwpx');
    writeFileSync(bad, 'PK not really');
    const out = join(dir, 'part.md');
    const r = await mergeFiles({ files: [received, bad], output_path: out, mode: 'markdown' }, signal);
    expect(r.file_count).toBe(1);
    expect(r.failed.map((f) => f.path)).toEqual([bad]);
    expect(r.failed[0].error).not.toMatch(/[A-Za-z]{6,}/);
    const none = join(dir, 'none.md');
    await expect(mergeFiles({ files: [bad, bad], output_path: none, mode: 'markdown' }, signal)).rejects.toThrow(/합칠 수 있는 문서가 없습니다/);
    expect(existsSync(none)).toBe(false);
  });
});
