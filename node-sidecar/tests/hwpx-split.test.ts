/** 한글 나누기 (core/merge/hwpx-split) — 구역·강제 쪽 나눔마다 서식 그대로, 원본은 그대로 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import JSZip from 'jszip';
import { parse, validateHwpx } from 'kordoc';
import { call, sample, setupEnv } from './doc-helpers.js';
import { decorate, hpfOf } from './hwpx-parts.js';
import { splitHwpx } from '../src/core/merge/hwpx-split.js';
import { mergeHwpx, readManifest } from '../src/core/merge/hwpx-merge.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const LETTER = sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'); // 구역 1·쪽 나눔 없음
const REPORT = sample('4-보고서_디지털 행정 혁신 추진계획.hwpx'); // 구역 1·쪽 나눔 2 (표지 → 목차 → 본문)
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const textOf = async (p: string) => { const r = await parse(readFileSync(p)); return r.success ? r.markdown : ''; };
const sectionXml = async (p: string) => {
  const zip = await JSZip.loadAsync(readFileSync(p));
  const names = Object.keys(zip.files).filter((n) => /section\d+\.xml$/.test(n));
  return { names, xml: await zip.file(names[0])!.async('string') };
};

let env: ReturnType<typeof setupEnv>;
let merged = '';
beforeAll(async () => {
  env = setupEnv();
  merged = (await call('merge_files', { files: [LETTER, REPORT], mode: 'native', output_path: join(env.work, '합본.hwpx') })).output_path;
}, 60_000);

describe('한글 나누기', () => {
  it('자동: 구역이 여럿(합친 문서)이면 구역마다 → 원래 두 문서로, 원본은 그대로', async () => {
    const before = sha(merged);
    const r = await call('split_hangul', { path: merged });
    expect(r.output_files.map((f: string) => basename(f))).toEqual(['합본_1.hwpx', '합본_2.hwpx']);
    expect(r.sections).toBe(2);
    for (const f of r.output_files) {
      expect((await validateHwpx(readFileSync(f))).ok).toBe(true);
      expect((await sectionXml(f)).names).toEqual(['Contents/section0.xml']);
    }
    const [a, b] = await Promise.all(r.output_files.map(textOf));
    expect(a).toContain('체육대회 참가 협조 요청');
    expect(a).not.toContain('디지털 행정 혁신');
    expect(b).toContain('디지털 행정 혁신');
    expect(sha(merged)).toBe(before);
  }, 60_000);

  it('자동: 구역이 하나면 강제 쪽 나눔마다 (표지·목차·본문), 뒤 조각도 쪽 설정을 가진다', async () => {
    const r = await call('split_hangul', { path: REPORT, output_dir: join(env.work, '보고서_나누기') });
    expect(r.output_files).toHaveLength(3);
    expect(r.page_breaks).toBe(2);
    const texts = await Promise.all(r.output_files.map(textOf));
    // 목차 쪽: kordoc 은 목차를 읽기 결과에서 일부러 뺀다(원본도 같음) → 본문 글자로 확인
    const toc = [...(await sectionXml(r.output_files[1])).xml.matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((m) => m[1]).join('');
    expect(toc.replace(/\s+/g, '')).toContain('목차');
    expect(toc).toContain('추진 배경');
    expect(texts[2]).toContain('추진 배경');
    expect(texts[0]).not.toContain('추진 배경');
    for (const f of r.output_files.slice(1)) {
      const { xml } = await sectionXml(f);
      expect(xml).toContain('<hp:secPr');
      expect(xml).not.toContain('pageBreak="1"');
      expect((await validateHwpx(readFileSync(f))).ok).toBe(true);
    }
  }, 60_000);

  it('조각에는 그 조각이 쓰는 그림과 그 조각의 미리보기만 들어간다 (다른 조각의 그림·첫 쪽 글이 딸려 가지 않는다)', async () => {
    // 합본에 구역마다 쓰는 그림 하나씩과 원본 첫 쪽 미리보기를 넣는다
    const zip = await JSZip.loadAsync(readFileSync(merged));
    const hpfPath = Object.keys(zip.files).find((n) => /content\.hpf$/i.test(n))!;
    const sections = Object.keys(zip.files).filter((n) => /section\d+\.xml$/.test(n)).sort();
    for (const [i, name] of sections.entries()) {
      zip.file(`BinData/zz${i}.png`, `그림 ${i}`);
      zip.file(name, (await zip.file(name)!.async('string')).replace(/(<hs:sec\b[^>]*>)/, `$1<!-- binaryItemIDRef="zzimg${i}" -->`));
    }
    zip.file(hpfPath, (await zip.file(hpfPath)!.async('string')).replace('</opf:manifest>', `${sections.map((_, i) => `<opf:item id="zzimg${i}" href="BinData/zz${i}.png" media-type="image/png" isEmbeded="1"/>`).join('')}</opf:manifest>`));
    zip.file('Preview/PrvText.txt', '원본 첫 쪽: 체육대회 참가 협조 요청');
    zip.file('Preview/PrvImage.png', '원본 첫 쪽 그림');
    const src = join(env.work, '그림 든 합본.hwpx');
    writeFileSync(src, Buffer.from(await zip.generateAsync({ type: 'arraybuffer' })));

    const r = await call('split_hangul', { path: src, output_dir: join(env.work, '그림_나누기') });
    expect(r.output_files).toHaveLength(2);
    const [a, b] = await Promise.all(r.output_files.map((f: string) => JSZip.loadAsync(readFileSync(f))));
    expect(a.file('BinData/zz0.png')).not.toBeNull();
    expect(a.file('BinData/zz1.png')).toBeNull();
    expect(b.file('BinData/zz1.png')).not.toBeNull();
    expect(b.file('BinData/zz0.png')).toBeNull();
    const hpfB = await b.file(hpfPath)!.async('string');
    expect(hpfB).toContain('id="zzimg1"');
    expect(hpfB).not.toContain('id="zzimg0"');
    // 미리보기 글은 그 조각의 글, 첫 쪽 그림은 첫 조각에만
    expect(await a.file('Preview/PrvText.txt')!.async('string')).toContain('체육대회');
    const previewB = await b.file('Preview/PrvText.txt')!.async('string');
    expect(previewB).not.toContain('체육대회');
    expect(previewB).toContain('디지털 행정 혁신');
    expect(await a.file('Preview/PrvImage.png')!.async('string')).toBe('원본 첫 쪽 그림');
    expect(await b.file('Preview/PrvImage.png')!.async('string')).not.toContain('원본 첫 쪽');
  }, 60_000);

  it('조각의 구역 항목은 id 도 section0: 조각을 차례를 바꿔 다시 합쳐도 구역 id 가 겹치지 않는다', async () => {
    const { parts } = await splitHwpx(new Uint8Array(readFileSync(merged)), 'section');
    for (const p of parts) {
      const m = readManifest(await (await JSZip.loadAsync(p)).file('Contents/content.hpf')!.async('string'));
      expect(m.items.filter((i) => /section\d+\.xml$/.test(i.href)).map((i) => [i.id, i.href])).toEqual([['section0', 'Contents/section0.xml']]);
      expect(m.spine).toContain('section0');
    }
    const back = await mergeHwpx([parts[1], parts[0]]);
    const m = readManifest(await (await JSZip.loadAsync(back.bytes)).file('Contents/content.hpf')!.async('string'));
    expect(new Set(m.items.map((i) => i.id)).size).toBe(m.items.length);
    const md = await parse(back.bytes);
    const at = (t: string) => (md.success ? md.markdown.indexOf(t) : -1);
    expect(at('디지털 행정 혁신')).toBeGreaterThanOrEqual(0);
    expect(at('디지털 행정 혁신')).toBeLessThan(at('체육대회 참가 협조 요청'));
  }, 60_000);

  it('조각에는 그 조각 구역이 가리키는 바탕쪽·차트만 들어간다 (다른 조각의 바탕쪽 글·그림·차트 숫자가 딸려 가지 않는다)', async () => {
    // 구역 둘(부서 둘), 구역마다 바탕쪽(글·그림)과 차트
    const zip = await JSZip.loadAsync(readFileSync(LETTER));
    const hpf = hpfOf(zip);
    zip.file('Contents/section1.xml', await zip.file('Contents/section0.xml')!.async('string'));
    zip.file(hpf, (await zip.file(hpf)!.async('string'))
      .replace('</opf:manifest>', '<opf:item id="section1" href="Contents/section1.xml" media-type="application/xml"/></opf:manifest>')
      .replace('</opf:spine>', '<opf:itemref idref="section1" linear="yes"/></opf:spine>'));
    zip.file('Contents/header.xml', (await zip.file('Contents/header.xml')!.async('string')).replace(/secCnt="\d+"/, 'secCnt="2"'));
    await decorate(zip, 'Contents/section0.xml', { master: 0, chart: 1, image: 'image1', mark: '총무과' });
    await decorate(zip, 'Contents/section1.xml', { master: 1, chart: 2, image: 'image2', mark: '재무과' });
    const { parts } = await splitHwpx(await zip.generateAsync({ type: 'uint8array' }), 'section');
    expect(parts).toHaveLength(2);
    for (const [i, [mine, other]] of [['총무과', '재무과'], ['재무과', '총무과']].entries()) {
      expect((await validateHwpx(parts[i])).ok).toBe(true);
      const part = await JSZip.loadAsync(parts[i]);
      const names = Object.keys(part.files).filter((n) => !part.files[n].dir);
      const texts = await Promise.all(names.map((n) => part.file(n)!.async('string')));
      for (const want of [`바탕쪽 ${mine}`, `${mine} 예산`, `picture-${mine}`]) expect(texts.some((t) => t.includes(want)), want).toBe(true);
      for (const [k, t] of texts.entries()) expect(t, names[k]).not.toContain(other);
      expect(names.filter((n) => /masterpage|^Chart\//.test(n)).sort()).toEqual([`Contents/masterpage${i}.xml`, `Chart/chart${i + 1}.xml`].sort());
      const items = readManifest(await part.file(hpf)!.async('string')).items.map((it) => it.id);
      expect(items).toContain(`masterpage${i}`);
      expect(items).not.toContain(`masterpage${1 - i}`);
      expect(items).not.toContain(`image${2 - i}`);
    }
  }, 60_000);

  it('쪽 나눔마다 나눠도 바탕쪽은 조각마다 그대로, 차트는 그 차트가 든 조각에만', async () => {
    const zip = await JSZip.loadAsync(readFileSync(REPORT));
    await decorate(zip, 'Contents/section0.xml', { master: 0, chart: 1, image: 'image1', mark: '기획과' }); // 차트는 본문 맨 끝(셋째 조각)
    const { parts } = await splitHwpx(await zip.generateAsync({ type: 'uint8array' }), 'pagebreak');
    expect(parts).toHaveLength(3);
    for (const [i, p] of parts.entries()) {
      const part = await JSZip.loadAsync(p);
      expect(await part.file('Contents/section0.xml')!.async('string')).toContain('<hp:masterPage idRef="masterpage0"/>');
      expect(part.file('Contents/masterpage0.xml'), `${i + 1}번째 조각 바탕쪽`).not.toBeNull();
      expect(part.file('BinData/image1.png'), `${i + 1}번째 조각 바탕쪽 그림`).not.toBeNull();
      expect(!!part.file('Chart/chart1.xml'), `${i + 1}번째 조각 차트`).toBe(i === 2);
    }
  }, 60_000);

  it('쪽 나눔마다를 고르면 합친 문서도 구역 안 쪽 나눔까지 (1 + 3)', async () => {
    const r = await call('split_hangul', { path: merged, mode: 'pagebreak', output_dir: join(env.work, '합본_쪽마다') });
    expect(r.output_files).toHaveLength(4);
  }, 60_000);

  it('output_dir 는 상위 폴더: 그 안에 <이름>_나누기, 다시 나누면 덮어쓰지 않고 (2) 폴더', async () => {
    const parent = join(env.base, '나눈 결과');
    const a = await call('split_hangul', { path: merged, output_dir: parent });
    expect(a.output_dir).toBe(join(parent, '합본_나누기'));
    const first = sha(a.output_files[0]);
    const b = await call('split_hangul', { path: merged, output_dir: parent });
    expect(b.output_dir).toBe(join(parent, '합본_나누기 (2)'));
    expect(b.output_files.every((f: string) => f.startsWith(b.output_dir))).toBe(true);
    expect(sha(a.output_files[0])).toBe(first);
    // 이름이 이미 <이름>_나누기 인 빈 폴더를 주면 그 폴더에 (옛 화면 호환)
    const own = join(env.base, '따로', '합본_나누기');
    mkdirSync(own, { recursive: true });
    expect((await call('split_hangul', { path: merged, output_dir: own })).output_dir).toBe(own);
  }, 60_000);

  it('나눌 곳이 없으면 알려 준다', async () => {
    const one = join(env.work, '한구역.hwpx');
    copyFileSync(LETTER, one);
    await expect(call('split_hangul', { path: one })).rejects.toThrow(/나눌 곳이 없습니다/);
  });

  it('옛 HWP 도 HWPX 로 바꿔 나눈다', async () => {
    const hwp = (await call('merge_files', { files: [LETTER, REPORT], mode: 'native', output_path: join(env.work, '합본2.hwp') })).output_path as string;
    expect(hwp.endsWith('.hwp')).toBe(true);
    const r = await call('split_hangul', { path: hwp });
    expect(r.output_files).toHaveLength(2);
    expect(r.output_files.every((f: string) => f.endsWith('.hwpx'))).toBe(true);
    expect(await textOf(r.output_files[1])).toContain('디지털 행정 혁신');
  }, 90_000);
});
