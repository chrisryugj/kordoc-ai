/** HWPX·HWP 서식 유지 수합 — 한컴오피스 없이 XML 수준 병합 (레포 예제 + 코퍼스가 있으면 실문서) */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { parse, validateHwpx } from 'kordoc';
import { mergeFiles } from '../src/core/merge/index.js';
import { openRhwp } from '../src/core/render/rhwp.js';

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
