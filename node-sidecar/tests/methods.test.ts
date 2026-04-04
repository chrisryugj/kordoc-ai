/** 10개 핵심 RPC 메서드 단위 테스트 — kordoc/gemini mock */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── kordoc mock ──
const mockParse = vi.fn();
const mockCompare = vi.fn();
const mockExtractFormFields = vi.fn();
const mockMarkdownToHwpx = vi.fn();
const mockBlocksToMarkdown = vi.fn();

vi.mock('kordoc', () => ({
  parse: (...args: unknown[]) => mockParse(...args),
  compare: (...args: unknown[]) => mockCompare(...args),
  extractFormFields: (...args: unknown[]) => mockExtractFormFields(...args),
  markdownToHwpx: (...args: unknown[]) => mockMarkdownToHwpx(...args),
  blocksToMarkdown: (...args: unknown[]) => mockBlocksToMarkdown(...args),
}));

// ── gemini mock ──
const mockCallGemini = vi.fn();
const mockCallGeminiVision = vi.fn();

vi.mock('../src/infra/gemini.js', () => ({
  callGemini: (...args: unknown[]) => mockCallGemini(...args),
  callGeminiVision: (...args: unknown[]) => mockCallGeminiVision(...args),
  resetClient: vi.fn(),
}));

// ── config mock ──
vi.mock('../src/infra/config.js', () => ({
  getConfig: (section: string) => {
    if (section === 'convert') return { output_dir: '', ocr_fallback: true };
    if (section === 'gemini') return {
      model: 'test-model', lite_model: 'test-lite', api_key: 'key',
      proxy_url: '', max_retries: 0, timeout_ms: 5000, mode: 'online',
    };
    return {};
  },
  getSettings: () => ({ gemini: {}, convert: {}, general: {} }),
  updateSettings: vi.fn(),
}));

// ── progress/logger mock (stdout 오염 방지) ──
vi.mock('../src/infra/progress.js', () => ({
  sendProgress: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock('../src/infra/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── imports (mock 이후) ──
import { convert } from '../src/core/converter/index.js';
import { convertBatch } from '../src/core/batch/index.js';
import { ocr } from '../src/core/ocr/index.js';
import { summarize } from '../src/core/summary/index.js';
import { diff } from '../src/core/comparator/index.js';
import { formExtract } from '../src/core/form/index.js';
import { generateHwpx } from '../src/core/generator/index.js';
import { extractTables } from '../src/core/excel/index.js';
import { mergeFiles } from '../src/core/merge/index.js';
import { scanReceipt } from '../src/core/receipt/index.js';

let tmpDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await mkdtemp(join(tmpdir(), 'kordoc-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── 1. convert ──
describe('convert', () => {
  it('HWPX 파일 → 마크다운 변환 성공', async () => {
    const inputPath = join(tmpDir, 'test.hwpx');
    await writeFile(inputPath, 'dummy');

    mockParse.mockResolvedValueOnce({
      success: true,
      markdown: '# 제목\n\n본문',
      blocks: [],
      fileType: 'hwpx',
      pageCount: 3,
    });

    const result = await convert({ input_path: inputPath });
    expect(result.success).toBe(true);
    expect(result.markdown).toBe('# 제목\n\n본문');
    expect(result.file_type).toBe('hwpx');
    expect(result.page_count).toBe(3);

    // 출력 파일 생성 확인
    const output = await readFile(result.output_path, 'utf-8');
    expect(output).toBe('# 제목\n\n본문');
  });

  it('파싱 실패 시 에러 반환', async () => {
    const inputPath = join(tmpDir, 'bad.pdf');
    await writeFile(inputPath, 'dummy');

    mockParse.mockResolvedValueOnce({
      success: false,
      error: 'Encrypted document',
      code: 'ENCRYPTED',
      fileType: 'pdf',
    });

    const result = await convert({ input_path: inputPath });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Encrypted document');
    expect(result.code).toBe('ENCRYPTED');
  });
});

// ── 2. convert_batch ──
describe('convert_batch', () => {
  it('다중 파일 변환 + 실패 처리', async () => {
    const file1 = join(tmpDir, 'a.hwpx');
    const file2 = join(tmpDir, 'b.pdf');
    await writeFile(file1, 'dummy');
    await writeFile(file2, 'dummy');

    mockParse
      .mockResolvedValueOnce({ success: true, markdown: '# A', blocks: [], fileType: 'hwpx' })
      .mockResolvedValueOnce({ success: false, error: 'fail', fileType: 'pdf' });

    const ac = new AbortController();
    const result = await convertBatch({ files: [file1, file2] }, ac.signal);

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('AbortSignal 취소', async () => {
    const file1 = join(tmpDir, 'c.hwpx');
    await writeFile(file1, 'dummy');

    const ac = new AbortController();
    ac.abort();

    await expect(convertBatch({ files: [file1] }, ac.signal))
      .rejects.toThrow('Aborted');
  });
});

// ── 3. ocr ──
describe('ocr', () => {
  it('텍스트 기반 PDF → kordoc parse로 바로 성공', async () => {
    const inputPath = join(tmpDir, 'text.pdf');
    await writeFile(inputPath, 'dummy');

    mockParse.mockResolvedValueOnce({
      success: true,
      markdown: '# 텍스트 PDF',
      blocks: [],
      fileType: 'pdf',
      pageCount: 3,
    });

    const ac = new AbortController();
    const result = await ocr({ input_path: inputPath }, ac.signal);

    expect(result.success).toBe(true);
    expect(result.markdown).toBe('# 텍스트 PDF');
  });

  it('이미지 PDF → Gemini Vision 폴백', async () => {
    const inputPath = join(tmpDir, 'scan.pdf');
    await writeFile(inputPath, 'dummy');

    mockParse.mockResolvedValueOnce({
      success: false,
      fileType: 'pdf',
      pageCount: 2,
      isImageBased: true,
      error: '이미지 기반 PDF',
      code: 'IMAGE_BASED_PDF',
    });

    mockCallGeminiVision.mockResolvedValueOnce('# OCR 결과\n\n텍스트 내용');

    const ac = new AbortController();
    const result = await ocr({ input_path: inputPath }, ac.signal);

    expect(result.success).toBe(true);
    expect(result.markdown).toBe('# OCR 결과\n\n텍스트 내용');
    expect(result.warnings).toContain('Gemini Vision OCR 사용 (이미지 기반 PDF)');
    expect(mockCallGeminiVision).toHaveBeenCalledOnce();
  });
});

// ── 4. summarize ──
describe('summarize', () => {
  it('텍스트 요약', async () => {
    mockCallGemini.mockResolvedValueOnce('요약 결과입니다.');

    const ac = new AbortController();
    const result = await summarize({ text: '긴 문서 내용...' }, ac.signal);

    expect(result.success).toBe(true);
    expect(result.summary).toBe('요약 결과입니다.');
    expect(mockCallGemini).toHaveBeenCalledOnce();
  });

  it('파일 경로에서 읽기', async () => {
    const inputPath = join(tmpDir, 'doc.md');
    await writeFile(inputPath, '파일에서 읽은 내용');

    mockCallGemini.mockResolvedValueOnce('파일 요약');

    const ac = new AbortController();
    const result = await summarize({ input_path: inputPath }, ac.signal);

    expect(result.success).toBe(true);
    expect(result.original_length).toBe('파일에서 읽은 내용'.length);
  });

  it('텍스트/파일 모두 없으면 에러', async () => {
    const ac = new AbortController();
    await expect(summarize({}, ac.signal)).rejects.toThrow('text 또는 input_path');
  });
});

// ── 5. diff ──
describe('diff', () => {
  it('두 파일 비교', async () => {
    const fileA = join(tmpDir, 'old.hwpx');
    const fileB = join(tmpDir, 'new.hwpx');
    await writeFile(fileA, 'dummy-a');
    await writeFile(fileB, 'dummy-b');

    mockCompare.mockResolvedValueOnce({
      stats: { added: 2, removed: 1, modified: 3, unchanged: 10 },
      diffs: [],
    });

    const result = await diff({ file_a: fileA, file_b: fileB });

    expect(result.success).toBe(true);
    expect(result.stats.added).toBe(2);
    expect(result.stats.modified).toBe(3);
  });
});

// ── 6. form_extract ──
describe('form_extract', () => {
  it('양식 필드 추출', async () => {
    const inputPath = join(tmpDir, 'form.hwpx');
    await writeFile(inputPath, 'dummy');

    mockParse.mockResolvedValueOnce({
      success: true,
      markdown: '',
      blocks: [{ type: 'table' }],
      fileType: 'hwpx',
    });
    mockExtractFormFields.mockReturnValueOnce({
      fields: [{ label: '성명', value: '홍길동', row: 0, col: 0 }],
      confidence: 0.9,
    });

    const result = await formExtract({ input_path: inputPath });

    expect(result.success).toBe(true);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].label).toBe('성명');
    expect(result.confidence).toBe(0.9);
  });

  it('파싱 실패 시 빈 결과', async () => {
    const inputPath = join(tmpDir, 'bad.hwpx');
    await writeFile(inputPath, 'dummy');

    mockParse.mockResolvedValueOnce({
      success: false,
      error: 'corrupted',
      fileType: 'hwpx',
    });

    const result = await formExtract({ input_path: inputPath });
    expect(result.success).toBe(false);
    expect(result.fields).toHaveLength(0);
  });
});

// ── 7. generate_hwpx ──
describe('generate_hwpx', () => {
  it('마크다운 → HWPX 변환', async () => {
    const outputPath = join(tmpDir, 'output.hwpx');
    const fakeBuffer = new ArrayBuffer(128);

    mockMarkdownToHwpx.mockResolvedValueOnce(fakeBuffer);

    const result = await generateHwpx({
      markdown: '# 제목\n\n본문',
      output_path: outputPath,
    });

    expect(result.success).toBe(true);
    expect(result.output_path).toBe(outputPath);
    expect(result.size).toBe(128);
  });

  it('입력 없으면 에러', async () => {
    await expect(generateHwpx({})).rejects.toThrow('markdown 또는 input_path');
  });
});

// ── 8. extract_tables ──
describe('extract_tables', () => {
  it('테이블 블록 추출', async () => {
    const inputPath = join(tmpDir, 'tables.pdf');
    await writeFile(inputPath, 'dummy');

    mockParse.mockResolvedValueOnce({
      success: true,
      markdown: '',
      blocks: [
        { type: 'paragraph', text: '문단' },
        { type: 'table', table: { rows: 2, cols: 3, cells: [[{ text: '항목', colSpan: 1, rowSpan: 1 }, { text: '수량', colSpan: 1, rowSpan: 1 }, { text: '금액', colSpan: 1, rowSpan: 1 }], [{ text: '사과', colSpan: 1, rowSpan: 1 }, { text: '10', colSpan: 1, rowSpan: 1 }, { text: '5000', colSpan: 1, rowSpan: 1 }]], hasHeader: true }, pageNumber: 1 },
        { type: 'table', table: { rows: 4, cols: 2, cells: [[{ text: '구분', colSpan: 1, rowSpan: 1 }, { text: '값', colSpan: 1, rowSpan: 1 }], [{ text: '합계', colSpan: 1, rowSpan: 1 }, { text: '100', colSpan: 1, rowSpan: 1 }]], hasHeader: false }, pageNumber: 2 },
      ],
      fileType: 'pdf',
    });
    mockBlocksToMarkdown.mockReturnValue('| a | b |\n');

    const result = await extractTables({ input_path: inputPath });

    expect(result.success).toBe(true);
    expect(result.table_count).toBe(2);
    expect(result.tables[0].rows).toBe(2);
    expect(result.tables[1].page).toBe(2);
  });
});

// ── 9. merge_files ──
describe('merge_files', () => {
  it('다중 파일 병합', async () => {
    const file1 = join(tmpDir, 'doc1.hwpx');
    const file2 = join(tmpDir, 'doc2.hwpx');
    const outputPath = join(tmpDir, 'merged.md');
    await writeFile(file1, 'dummy');
    await writeFile(file2, 'dummy');

    mockParse
      .mockResolvedValueOnce({ success: true, markdown: '# 문서1\n내용1', blocks: [], fileType: 'hwpx' })
      .mockResolvedValueOnce({ success: true, markdown: '# 문서2\n내용2', blocks: [], fileType: 'hwpx' });

    const ac = new AbortController();
    const result = await mergeFiles({ files: [file1, file2], output_path: outputPath }, ac.signal);

    expect(result.success).toBe(true);
    expect(result.file_count).toBe(2);
    expect(result.failed_files).toHaveLength(0);

    const merged = await readFile(outputPath, 'utf-8');
    expect(merged).toContain('문서1');
    expect(merged).toContain('문서2');
  });
});

// ── 10. scan_receipt ──
describe('scan_receipt', () => {
  it('영수증 이미지 → 구조화 데이터', async () => {
    const inputPath = join(tmpDir, 'receipt.jpg');
    await writeFile(inputPath, 'fake-image-data');

    mockCallGeminiVision.mockResolvedValueOnce(JSON.stringify({
      store_name: '테스트 가게',
      date: '2026-04-04',
      items: [{ name: '커피', quantity: 2, unit_price: 4500, amount: 9000 }],
      total: 9000,
    }));

    const ac = new AbortController();
    const result = await scanReceipt({ input_path: inputPath }, ac.signal);

    expect(result.success).toBe(true);
    expect(result.store_name).toBe('테스트 가게');
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(9000);
  });

  it('JSON 파싱 실패 시 raw_text 반환', async () => {
    const inputPath = join(tmpDir, 'receipt2.png');
    await writeFile(inputPath, 'fake');

    mockCallGeminiVision.mockResolvedValueOnce('파싱 불가능한 텍스트');

    const ac = new AbortController();
    const result = await scanReceipt({ input_path: inputPath }, ac.signal);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.raw_text).toBe('파싱 불가능한 텍스트');
  });
});
