/**
 * KorDoc Studio Phase B — 양식 채우기 RPC 4종 E2E (mock 없음, 실제 kordoc + rhwp WASM).
 * 실양식(서면자문 의견서)이 로컬에 있으면 실파일 드롭→채움→저장→재파싱 검증까지 수행.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

// progress가 stdout(JSON-RPC 채널)에 쓰는 것 방지
import { vi } from 'vitest';
vi.mock('../src/infra/progress.js', () => ({ sendProgress: vi.fn(), sendNotification: vi.fn() }));
vi.mock('../src/infra/config.js', () => ({
  getConfig: () => ({ output_dir: '' }),
  getSettings: () => ({ gemini: {}, convert: {}, general: {} }),
  updateSettings: vi.fn(),
}));

import { formSchema, formFill, patchBlocks } from '../src/core/fill/index.js';
import { renderPreview } from '../src/core/preview/index.js';

const REAL_FORM = 'D:/AI_Project/edu-facility-ai/docs/원본자료/4. 서면자문 의견서(양식).hwpx';
const hasRealForm = existsSync(REAL_FORM);
/** 표 기반 실양식 — 인접 라벨-값 셀 전략 검증 */
const REAL_FORM2 = 'D:/AI_Project/edu-facility-ai/docs/원본자료/5. 수당 및 여비지급 관련 양식.hwpx';
const hasRealForm2 = existsSync(REAL_FORM2);

/** 합성 HWPX — 인라인 + 표 라벨 양식 */
async function makeSyntheticForm(dir: string): Promise<string> {
  const section = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="0" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>신청인 성명: 작성일자:</hp:t></hp:run></hp:p>
  <hp:p id="1" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>본문 내용입니다.</hp:t></hp:run></hp:p>
</hs:sec>`;
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip');
  zip.file('Contents/section0.xml', section);
  const buf = Buffer.from(await zip.generateAsync({ type: 'arraybuffer' }));
  const p = join(dir, 'synthetic-form.hwpx');
  await writeFile(p, buf);
  return p;
}

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'kordoc-fill-'));
});

describe('form_schema', () => {
  it('합성 양식 — 인라인 빈 라벨 2개를 타입과 함께 노출', async () => {
    const p = await makeSyntheticForm(tmpDir);
    const r = await formSchema({ input_path: p, include_doc: true });
    expect(r.success).toBe(true);
    expect(r.fillable).toBe(true);
    const labels = new Map(r.fields.map((f) => [f.label, f]));
    expect(labels.get('성명')?.empty).toBe(true);
    expect(labels.get('작성일자')?.type).toBe('date');
    expect(r.doc_b64).toBeTruthy();
  });

  it.skipIf(!hasRealForm)('실양식 — 성명/작성일자 채움 대상 인식', async () => {
    const r = await formSchema({ input_path: REAL_FORM });
    expect(r.success).toBe(true);
    expect(r.fillable).toBe(true);
    const labels = r.fields.map((f) => f.label);
    expect(labels).toContain('성명');
    expect(labels).toContain('작성일자');
  });
});

describe('form_fill', () => {
  it('합성 양식 — 채움 + 저장 + 재파싱 검증 + 비변경 엔트리 바이트 보존', async () => {
    const p = await makeSyntheticForm(tmpDir);
    const out = join(tmpDir, 'filled.hwpx');
    const r = await formFill({
      input_path: p,
      values: { 성명: '홍길동', 작성일자: '2026. 6. 12.' },
      output_path: out,
    });
    expect(r.success).toBe(true);
    expect(r.filled.map((f) => f.label).sort()).toEqual(['성명', '작성일자']);
    expect(r.unmatched).toEqual([]);
    expect(r.verification.reparse_ok).toBe(true);
    expect(r.output_path).toBe(out);

    // 저장 파일 검증 — 채움 내용 + mimetype 바이트 보존
    const saved = await readFile(out);
    const zip = await JSZip.loadAsync(saved);
    const xml = await zip.file('Contents/section0.xml')!.async('text');
    expect(xml).toContain('성명: 홍길동');
    expect(xml).toContain('작성일자: 2026. 6. 12.');
    expect(xml).toContain('본문 내용입니다.'); // 비대상 문단 무손상
  });

  it('비-HWPX 입력 거부 (한국어 안내)', async () => {
    const p = join(tmpDir, 'fake.hwp');
    await writeFile(p, Buffer.from('not a zip'));
    await expect(formFill({ input_path: p, values: { 성명: 'x' } })).rejects.toThrow(/HWPX/);
  });

  it.skipIf(!hasRealForm2)('실양식2(표 기반) — 스키마 타입 추론 + 빈 셀 채움 E2E', async () => {
    const schema = await formSchema({ input_path: REAL_FORM2 });
    expect(schema.fillable).toBe(true);
    const byLabel = new Map(schema.fields.map((f) => [f.label, f]));
    expect(byLabel.get('성명')?.empty).toBe(true);
    expect(byLabel.get('수당금액')?.type).toBe('amount');

    const out = join(tmpDir, 'real2-filled.hwpx');
    const r = await formFill({
      input_path: REAL_FORM2,
      values: { 성명: '김민수', 주소: '서울특별시 광진구 능동로 120' },
      output_path: out,
    });
    expect(r.success).toBe(true);
    expect(r.filled.length).toBeGreaterThanOrEqual(2);
    expect(r.verification.reparse_ok).toBe(true);
    expect(existsSync(out)).toBe(true);
  });

  it.skipIf(!hasRealForm)('실양식 — 드롭→채움→저장→재파싱 E2E', async () => {
    const out = join(tmpDir, 'real-filled.hwpx');
    const r = await formFill({
      input_path: REAL_FORM,
      values: { 성명: '홍길동', 작성일자: '2026. 6. 12.' },
      output_path: out,
    });
    expect(r.success).toBe(true);
    expect(r.filled.map((f) => f.label).sort()).toEqual(['성명', '작성일자']);
    expect(r.unmatched).toEqual([]);
    expect(r.verification.reparse_ok).toBe(true);
    expect(existsSync(out)).toBe(true);
  });
});

describe('patch_blocks', () => {
  it('합성 문서 — 문단 텍스트 패치 + changes 보고', async () => {
    const p = await makeSyntheticForm(tmpDir);
    const schema = await formSchema({ input_path: p, include_doc: true });
    // 블록 1 = "본문 내용입니다." 문단
    const r = await patchBlocks({
      doc_b64: schema.doc_b64!,
      edits: [{ blockIndex: 1, newText: '수정된 본문입니다.' }],
    });
    expect(r.success).toBe(true);
    expect(r.applied).toBe(1);
    expect(r.changed_blocks).toBe(1);
    const patched = Buffer.from(r.doc_b64!, 'base64');
    const zip = await JSZip.loadAsync(patched);
    const xml = await zip.file('Contents/section0.xml')!.async('text');
    expect(xml).toContain('수정된 본문입니다.');
  });
});

describe('render_preview (rhwp WASM)', () => {
  it.skipIf(!hasRealForm)('실양식 — SVG 페이지 렌더', async () => {
    const r = await renderPreview({ input_path: REAL_FORM, max_pages: 2 });
    expect(r.success).toBe(true);
    expect(r.page_count).toBeGreaterThanOrEqual(3);
    expect(r.pages.length).toBe(2);
    expect(r.pages[0].svg).toContain('<svg');
    expect(r.pages[0].svg.length).toBeGreaterThan(10_000); // 글자 단위 배치 SVG
  }, 30_000);

  it.skipIf(!hasRealForm)('채움 직후 미저장 바이트(doc_b64) 렌더', async () => {
    const fill = await formFill({
      input_path: REAL_FORM,
      values: { 성명: '홍길동' },
      dry_run: true,
    });
    const r = await renderPreview({ doc_b64: fill.doc_b64!, pages: [0] });
    expect(r.success).toBe(true);
    // rhwp SVG는 글자 단위 <text> 배치 — 개별 문자로 검증
    for (const ch of ['홍', '길', '동']) {
      expect(r.pages[0].svg).toContain(`>${ch}</text>`);
    }
  }, 30_000);
});
