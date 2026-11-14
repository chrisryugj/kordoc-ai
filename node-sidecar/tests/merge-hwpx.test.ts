/** HWPX·HWP 서식 유지 수합 — 한컴오피스 없이 XML 수준 병합 (레포 예제 + 코퍼스가 있으면 실문서) */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { parse, validateHwpx } from 'kordoc';
import { mergeFiles } from '../src/core/merge/index.js';
import { mergeHwpx, readManifest, sectionHrefs } from '../src/core/merge/hwpx-merge.js';
import { splitHwpx } from '../src/core/merge/hwpx-split.js';
import { openRhwp } from '../src/core/render/rhwp.js';
import { decorate, hpfOf } from './hwpx-parts.js';

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

/** rhwp 가 그린 쪽 SVG 들 */
async function pageSvgs(bytes: Uint8Array): Promise<string[]> {
  const doc = (await openRhwp(bytes)) as unknown as { pageCount(): number; renderPageSvg(i: number): string; free?(): void };
  try {
    return Array.from({ length: doc.pageCount() }, (_, i) => doc.renderPageSvg(i));
  } finally {
    doc.free?.();
  }
}
/** SVG 의 글만 (태그·공백 뺌. rhwp 는 글자를 따로따로 놓기도 한다) */
const plain = (svg: string) => svg.replace(/<[^>]*>/g, '').replace(/\s/g, '');

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

  it('뒤 문서의 바탕쪽·차트도 옮긴다: 문서마다 masterpage0·chart1 이어도 쪽마다 제 문서의 바탕쪽·차트가 보인다', async () => {
    const decorated = async (mark: string) => {
      const zip = await JSZip.loadAsync(readFileSync(received));
      await decorate(zip, 'Contents/section0.xml', { master: 0, chart: 1, image: 'image1', mark });
      return zip.generateAsync({ type: 'uint8array' });
    };
    const marks = ['A', 'B', 'C', 'D'];
    const [a, b, c, d] = await Promise.all(marks.map(decorated));
    // 합친 문서에 또 합쳐도 (바탕에 masterpage0~2·chart1~3 이 이미 있다)
    const out = join(dir, 'parts.hwpx');
    writeFileSync(out, (await mergeHwpx([(await mergeHwpx([a, b, c])).bytes, d])).bytes);
    const { bytes } = await check(out, ['한마음 체육대회']);
    const zip = await JSZip.loadAsync(bytes);
    const m = readManifest(await zip.file(hpfOf(zip))!.async('string'));
    expect(new Set(m.items.map((i) => i.id)).size).toBe(m.items.length);
    const hrefs = sectionHrefs(m);
    expect(hrefs).toHaveLength(4);
    for (const [i, href] of hrefs.entries()) {
      const sec = await zip.file(href)!.async('string');
      // 바탕쪽: manifest 로 찾는 부품(rhwp·한글)과 뿌리 id 로 찾는 부품(kordoc)이 같은 그 문서 것
      const idRef = /<hp:masterPage idRef="([^"]*)"/.exec(sec)![1];
      const master = await zip.file(m.items.find((it) => it.id === idRef)!.href)!.async('string');
      expect(master).toContain(`바탕쪽 ${marks[i]}`);
      expect(/<masterPage\b[^>]*\sid="([^"]*)"/.exec(master)![1]).toBe(idRef);
      // 바탕쪽 안의 글자 모양·그림 참조도 그 문서의 새 ID 로 (본문 첫 글자 모양과 같은 ID 를 썼다)
      expect(/charPrIDRef="(\d+)"/.exec(master)![1]).toBe(/charPrIDRef="(\d+)"/.exec(sec)![1]);
      const bin = /binaryItemIDRef="([^"]*)"/.exec(master)![1];
      expect(await zip.file(m.items.find((it) => it.id === bin)!.href)!.async('string')).toBe(`picture-${marks[i]}`);
      const chart = /chartIDRef="([^"]*)"/.exec(sec)![1];
      expect(await zip.file(chart)!.async('string')).toContain(`${marks[i]} 예산`);
    }
    // 실제로 그린 쪽: 쪽마다 그 문서의 바탕쪽 글과 차트
    const pages = await pageSvgs(bytes);
    expect(pages).toHaveLength(4);
    for (const [i, svg] of pages.entries()) {
      expect(plain(svg)).toContain(`바탕쪽${marks[i]}`);
      for (const mark of marks) expect(svg.includes(`${mark} 예산`), `${i + 1}쪽 차트 ${mark}`).toBe(mark === marks[i]);
    }
  }, 60_000);

  it('메모 답글 관계(memoExtended)도 뒤 문서 것을 이어 붙인다', async () => {
    const withMemoEx = async (memos: string) => {
      const zip = await JSZip.loadAsync(readFileSync(received));
      zip.file('Contents/memoExtended.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><he:memosEx xmlns:he="http://www.hancom.co.kr/hwpml/2021/extended">${memos}</he:memosEx>`);
      const hpf = hpfOf(zip);
      zip.file(hpf, (await zip.file(hpf)!.async('string')).replace('</opf:manifest>', '<opf:item id="memoextended" href="Contents/memoExtended.xml" media-type="application/xml"/></opf:manifest>'));
      return zip.generateAsync({ type: 'uint8array' });
    };
    const plainDoc = new Uint8Array(readFileSync(received));
    const a = await withMemoEx('<he:memo id="1001" parentId="1000"/>');
    const b = await withMemoEx('<he:memo id="2001" parentId="2000"/><he:memo id="2002" parentId="2000"/>');
    for (const [inputs, want] of [[[a, b], ['1001', '2001', '2002']], [[plainDoc, b], ['2001', '2002']]] as const) {
      const r = await mergeHwpx([...inputs]);
      expect((await validateHwpx(r.bytes)).ok).toBe(true);
      const zip = await JSZip.loadAsync(r.bytes);
      const ex = await zip.file('Contents/memoExtended.xml')!.async('string');
      expect([...ex.matchAll(/<he:memo id="(\d+)"/g)].map((x) => x[1])).toEqual(want);
      expect((await zip.file(hpfOf(zip))!.async('string')).match(/href="Contents\/memoExtended\.xml"/g)).toHaveLength(1);
    }
  });

  it('나눈 조각을 차례를 바꿔 다시 합쳐도 구역마다 한 번씩 들어간다 (옛 판 조각은 Contents/section0.xml 의 id 가 원래 구역 번호)', async () => {
    const merged = await mergeHwpx([received, pii, report].map((p) => new Uint8Array(readFileSync(p))));
    const parts = (await splitHwpx(merged.bytes, 'section')).parts;
    // 옛 판 조각: 남긴 구역 항목의 id 를 그대로 두었다 (두 번째 조각 = id="section1" href="Contents/section0.xml")
    const old = await Promise.all(parts.map(async (bytes, i) => {
      const zip = await JSZip.loadAsync(bytes);
      const hpf = hpfOf(zip);
      zip.file(hpf, (await zip.file(hpf)!.async('string')).replace(/\bid="section0"/, `id="section${i}"`).replace(/\bidref="section0"/, `idref="section${i}"`));
      return zip.generateAsync({ type: 'uint8array' });
    }));
    const out = join(dir, 'remerged.hwpx');
    const r = await mergeHwpx([old[1], old[0], old[2]]);
    expect(r.sections).toBe(3);
    writeFileSync(out, r.bytes);
    const { bytes } = await check(out, ['정보공개 청구서', '한마음 체육대회', '디지털 행정 혁신']);
    const zip = await JSZip.loadAsync(bytes);
    const m = readManifest(await zip.file(hpfOf(zip))!.async('string'));
    expect(new Set(m.items.map((i) => i.id)).size).toBe(m.items.length);
    const hrefs = sectionHrefs(m);
    expect(new Set(hrefs).size).toBe(3);
    const md = await parse(bytes);
    const at = (t: string) => (md.success ? md.markdown.indexOf(t) : -1);
    expect(at('정보공개 청구서')).toBeLessThan(at('한마음 체육대회'));
    expect(at('한마음 체육대회')).toBeLessThan(at('디지털 행정 혁신'));
    // 구역 파일 번호가 비어도(section0·2·3) rhwp 가 세 조각을 다 그린다
    const drawn = (await pageSvgs(bytes)).map(plain).join('');
    for (const t of ['정보공개청구서', '한마음체육대회', '디지털행정혁신']) expect(drawn, t).toContain(t);
  }, 60_000);

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
