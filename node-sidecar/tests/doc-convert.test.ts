/** 문서 읽기·변환 — convert·convert_batch·doc_info·scan_paths·search_files·extract_images·to_hwpx (실파일) */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx, parse, validateHwpx } from 'kordoc';
import { call, corpus, hasCorpus, makePng, sample, setupEnv, SAMPLES } from './doc-helpers.js';
import { estimatePages } from '../src/core/render/rhwp.js';
import { guessPreset } from '../src/core/gongmun/index.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const REPORT = sample('4-보고서_디지털 행정 혁신 추진계획.hwpx');
const LETTER_HWPX = sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx');
const LETTER_PDF = sample('1-받은공문_도민체육대회 참가 협조 요청.pdf');
let env: ReturnType<typeof setupEnv>;

beforeAll(() => {
  env = setupEnv();
});

describe('convert', () => {
  it('HWPX → md 저장 (설정 출력 폴더, 같은 이름이면 (2))', async () => {
    const a = await call('convert', { path: REPORT, format: 'md' });
    expect(a.output_path).toBe(join(env.out, '4-보고서_디지털 행정 혁신 추진계획.md'));
    expect(a.content).toContain('# 2026 가온시 디지털 행정 혁신 추진계획');
    expect(readFileSync(a.output_path, 'utf-8')).toBe(a.content);
    const b = await call('convert', { path: REPORT, format: 'md' });
    expect(b.output_path).toBe(join(env.out, '4-보고서_디지털 행정 혁신 추진계획 (2).md'));
  });

  it('save=false 면 저장 없이 content 만 — html·json·chunks·txt', async () => {
    const before = readdirSync(env.out).length;
    const html = await call('convert', { path: LETTER_PDF, format: 'html', save: false });
    expect(html.output_path).toBeUndefined();
    expect(html.content).toMatch(/^<!DOCTYPE html>/i);
    expect(html.content).toContain('체육대회');
    const json = JSON.parse((await call('convert', { path: LETTER_HWPX, format: 'json', save: false })).content);
    expect(json.fileType).toBe('hwpx');
    expect(Array.isArray(json.blocks)).toBe(true);
    const chunks = JSON.parse((await call('convert', { path: REPORT, format: 'chunks', save: false })).content);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].id).toBe('c0001');
    const txt = await call('convert', { path: LETTER_HWPX, format: 'txt', save: false });
    expect(txt.content).toContain('가온도');
    expect(readdirSync(env.out).length).toBe(before);
  });

  it('CSV 는 글은 그대로, json 에는 표 블록 (칸 채우기 마법사의 명부 고르기가 첫 표를 찾는다)', async () => {
    const csv = join(env.work, '명부.csv');
    writeFileSync(csv, '성명,부서\n홍길동,총무과\n\n김가온,기획예산과\n');
    const md = await call('convert', { path: csv, format: 'md', save: false });
    expect(md.content).toBe('성명,부서\n홍길동,총무과\n\n김가온,기획예산과\n');
    const json = JSON.parse((await call('convert', { path: csv, format: 'json', save: false })).content);
    expect(json.blocks).toHaveLength(1);
    expect(json.blocks[0].type).toBe('table');
    expect(json.blocks[0].table).toMatchObject({ rows: 3, cols: 2, hasHeader: true });
    expect(json.blocks[0].table.cells.map((r: Array<{ text: string }>) => r.map((c) => c.text))).toEqual([['성명', '부서'], ['홍길동', '총무과'], ['김가온', '기획예산과']]);
  });

  it('없는 파일은 사람이 읽을 오류', async () => {
    await expect(call('convert', { path: join(env.work, '없음.hwpx') })).rejects.toThrow(/찾을 수 없습니다/);
  });

  it('맥 우클릭·끌어 놓기로 온 자소 분리(NFD) 경로도 결과 파일 이름은 완성형(NFC) (윈도에서 이름이 안 깨지게)', async () => {
    const nfd = join(env.work, '자소분리시험.hwpx'.normalize('NFD'));
    writeFileSync(nfd, readFileSync(REPORT));
    const r = await call('convert', { path: nfd, format: 'md' });
    const name = r.output_path.split(/[\\/]/).pop();
    expect(name).toBe('자소분리시험.md'.normalize('NFC'));
    expect(name.normalize('NFC')).toBe(name);
  });

  it.skipIf(!hasCorpus('hwp5/changing-paragraph-text.hwp'))('HWP5 실문서', async () => {
    const r = await call('convert', { path: corpus('hwp5/changing-paragraph-text.hwp'), save: false });
    expect(r.content.length).toBeGreaterThan(5);
  });
});

describe('convert_batch', () => {
  it('여러 파일 + 실패는 결과 안에', async () => {
    const bad = join(env.work, 'broken.hwpx');
    writeFileSync(bad, 'not a document');
    const r = await call('convert_batch', { paths: [LETTER_HWPX, bad, LETTER_PDF], format: 'txt' });
    expect(r.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, false, true]);
    expect(r.results[1].error).toBeTruthy();
    expect(existsSync(r.results[0].output_path)).toBe(true);
    expect(r.output_dir).toBe(env.out);
  });
});

describe('doc_info', () => {
  it('HWPX — 편집·미리보기 가능', async () => {
    const r = await call('doc_info', { path: REPORT });
    expect(r).toMatchObject({ format: 'hwpx', editable: true, has_layout: true, encrypted: false, needs_ocr: false });
  });

  it('한글에서 저장하지 않은 긴 HWPX(줄 배치 정보 없음)는 글 양으로 쪽 수를 어림잡고 그렇다고 밝힌다', async () => {
    const md = '# 긴 문서\n\n' + Array.from({ length: 300 }, (_, i) => `${i + 1}. ${'예산 집행 현황과 향후 계획을 설명하는 긴 문장입니다. '.repeat(6)}`).join('\n\n');
    const path = join(env.work, '생성본_긴문서.hwpx');
    writeFileSync(path, Buffer.from(await markdownToHwpx(md)));
    const r = await call('doc_info', { path });
    expect(r.page_count).toBeGreaterThan(50);
    expect(r.warnings.join(' ')).toContain('어림잡은 값');
    // 한글이 저장한 문서(줄 배치 정보 있음)·짧은 문서·빽빽한 1쪽은 그대로
    expect(estimatePages(393, 'x'.repeat(295_311))).toBeNull();
    expect(estimatePages(1, 'x'.repeat(1_500))).toBeNull();
    expect((await call('doc_info', { path: REPORT })).warnings.join(' ')).not.toContain('어림');
  });

  it('PDF — 쪽 수·OCR 불필요', async () => {
    const r = await call('doc_info', { path: LETTER_PDF });
    expect(r).toMatchObject({ format: 'pdf', page_count: 1, has_layout: true, editable: false, needs_ocr: false });
  });

  it.skipIf(!hasCorpus('pdf-local/gwangjin_202207.pdf'))('스캔 PDF — needs_ocr, 큰 파일도 일부 쪽만 읽어 빠르게', async () => {
    const t = Date.now();
    const r = await call('doc_info', { path: corpus('pdf-local/gwangjin_202207.pdf') });
    expect(r.needs_ocr).toBe(true);
    expect(r.page_count).toBe(24);
    expect(r.warnings.join(' ')).not.toMatch(/CLI/);
    expect(Date.now() - t).toBeLessThan(8000);
  });
});

describe('scan_paths', () => {
  it('폴더 하위까지 지원 문서만 (index.json 은 건너뜀)', async () => {
    const r = await call('scan_paths', { paths: [SAMPLES] });
    const names = r.files.map((f: { name: string }) => f.name);
    expect(names).toContain('교육수요조사서_총무과.hwpx');
    expect(names).toContain('1-받은공문_도민체육대회 참가 협조 요청.pdf');
    expect(names).not.toContain('index.json');
    expect(r.skipped).toBeGreaterThanOrEqual(1);
  });
});

describe('search_files', () => {
  it('띄어쓰기 무시 + 쪽 번호·문맥', async () => {
    const r = await call('search_files', { paths: [SAMPLES], query: '디지털행정' });
    expect(r.searched).toBeGreaterThanOrEqual(9);
    const hit = r.results.find((x: { path: string }) => x.path === REPORT);
    expect(hit.hits[0].excerpt).toContain('디지털 행정');
    expect(r.results.some((x: { path: string }) => x.path === LETTER_PDF)).toBe(false);
  });
});

describe('extract_images', () => {
  it('문서 속 그림을 폴더로', async () => {
    const png = await makePng(120, 60);
    const hwpx = join(env.work, '그림문서.hwpx');
    writeFileSync(hwpx, Buffer.from(await markdownToHwpx('# 그림\n\n![로고](logo.png)', { images: { 'logo.png': png } })));
    const r = await call('extract_images', { path: hwpx });
    expect(r.count).toBe(1);
    expect(readdirSync(r.output_dir)).toHaveLength(1);
  });

  it('그림 없는 문서는 안내 오류, allow_empty(일괄 처리)면 빈 결과', async () => {
    await expect(call('extract_images', { path: LETTER_HWPX })).rejects.toThrow(/그림이 없습니다/);
    expect(await call('extract_images', { path: LETTER_HWPX, allow_empty: true })).toEqual({ output_dir: '', count: 0 });
  });
});

describe('to_hwpx', () => {
  it('PDF → 고칠 수 있는 HWPX (기안문 서식)', async () => {
    const r = await call('to_hwpx', { path: LETTER_PDF, preset: '기안문' });
    const back = await parse(readFileSync(r.output_path));
    expect(back.success && back.markdown).toContain('체육대회');
  });

  it('일괄 — md 와 PDF', async () => {
    const md = join(env.work, '메모.md');
    writeFileSync(md, '# 회의 메모\n\n- 첫째 안건\n- 둘째 안건\n');
    const r = await call('to_hwpx_batch', { paths: [md, LETTER_PDF] });
    expect(r.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    const back = await parse(readFileSync(r.results[0].output_path));
    expect(back.success && back.markdown).toContain('둘째 안건');
  });

  it("preset 'auto' — 문서 모양을 보고 갈래를 고르고, 애매하면 서식 없이 (고른 서식은 style·일괄 note 로)", async () => {
    const report = join(env.work, '추진보고.md');
    writeFileSync(report, '# 민원 응대 개선 결과\n\n□ 추진 배경\n\n○ 민원이 늘었음\n\n□ 추진 결과\n\n○ 응대 시간이 줄었음\n');
    const plain = join(env.work, '메모2.md');
    writeFileSync(plain, '# 장보기\n\n우유, 달걀, 두부\n');
    expect((await call('to_hwpx', { path: LETTER_PDF, preset: 'auto' })).style).toBe('기안문 서식');
    expect((await call('to_hwpx', { path: report, preset: 'auto' })).style).toBe('보고서 서식');
    expect((await call('to_hwpx', { path: plain, preset: 'auto' })).style).toBe('꾸밈 없이');
    const b = await call('to_hwpx_batch', { paths: [report, plain], preset: 'auto' });
    expect(b.results.map((x: { note?: string }) => x.note)).toEqual(['보고서 서식', '꾸밈 없이']);
    // 규칙: 계획서·회의록·보도자료·공고, 수신만 있고 제목·시행이 없으면 기안문으로 보지 않음
    expect(guessPreset('# 2027 업무 계획\n\n□ 목표\n○ 가\n○ 나\n□ 과제\n')).toBe('plan');
    expect(guessPreset('# 3분기 회의록\n\n참석자: 홍길동')).toBe('minutes');
    expect(guessPreset('# 보도자료\n\n보도 일시: 2026. 10. 1.')).toBe('press');
    expect(guessPreset('# 하반기 교육 안내\n\n아래와 같이 교육을 엽니다.')).toBe('notice');
    expect(guessPreset('# 메모\n\n수신 확인 부탁')).toBeUndefined();
  });

  it('이미 HWPX 면 안내', async () => {
    await expect(call('to_hwpx', { path: REPORT })).rejects.toThrow(/이미 HWPX/);
  });

  it('옛 HWP → 다시 짜지 않고 서식 그대로 HWPX (rhwp), 결재·시행 칸까지 남는다', async () => {
    const { openRhwp } = await import('../src/core/render/rhwp.js');
    const doc = (await openRhwp(new Uint8Array(readFileSync(LETTER_HWPX)))) as unknown as { exportHwp(): Uint8Array; free?(): void };
    const hwp = join(env.work, '받은공문.hwp');
    try { writeFileSync(hwp, doc.exportHwp()); } finally { doc.free?.(); }
    const r = await call('to_hwpx', { path: hwp, preset: '보고서' });
    expect(r.warnings).toEqual([]);
    const bytes = readFileSync(r.output_path);
    expect((await validateHwpx(bytes)).ok).toBe(true);
    const back = await parse(bytes);
    const text = back.success ? back.markdown : '';
    expect(text).toContain('2026년 가온도민 한마음 체육대회 참가 협조 요청');
    expect(text).toContain('체육진흥과-2203'); // 시행 칸 (다시 짜면 서식 칸이 무너진다)
  });
});
