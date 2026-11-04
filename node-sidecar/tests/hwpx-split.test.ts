/** 한글 나누기 (core/merge/hwpx-split) — 구역·강제 쪽 나눔마다 서식 그대로, 원본은 그대로 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import JSZip from 'jszip';
import { parse, validateHwpx } from 'kordoc';
import { call, sample, setupEnv } from './doc-helpers.js';

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
