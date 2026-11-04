/** AI 오류 문장 — 영어 원문 대신 할 일을 적은 한국어 */

import { describe, it, expect } from 'vitest';
import { toAiError } from '../src/core/errors.js';

const text = (e: unknown) => (e as Error).message;

describe('toAiError', () => {
  it('연결 실패·키 오류·한도·서버 오류·답 해석 실패를 한국어 안내로', () => {
    expect(text(toAiError(new TypeError('fetch failed')))).toMatch(/AI 서버에 연결하지 못했습니다.*설정 › AI 연결/);
    expect(text(toAiError(new Error('401 {"type":"error","error":{"type":"authentication_error"}}')))).toMatch(/AI 키가 맞지 않거나/);
    expect(text(toAiError(new Error('429 Too Many Requests')))).toMatch(/사용량 한도/);
    expect(text(toAiError(new Error('오류 500 {"error":"Internal Server Error"}')))).toMatch(/AI 서버가 오류를 냈습니다/);
    expect(text(toAiError(new SyntaxError("Expected ',' or ']' after array element in JSON at position 10")))).toMatch(/AI 답을 읽지 못했습니다/);
  });

  it('이미 한국어로 다듬은 안내와 취소는 그대로', () => {
    expect(text(toAiError(new Error('AI가 아직 연결되지 않았습니다. 설정에서 연결하세요.')))).toBe('AI가 아직 연결되지 않았습니다. 설정에서 연결하세요.');
    const abort = new DOMException('취소', 'AbortError');
    expect(toAiError(abort)).toBe(abort);
  });
});

describe('파일 오류·이름·글자 코드', () => {
  it('손상 파일·암호 PDF·그림 형식 오류를 할 일을 적은 한국어로', async () => {
    const { toUserError } = await import('../src/core/errors.js');
    expect(text(toUserError(new Error("Can't find end of central directory : is this a zip file ?")))).toMatch(/손상됐거나/);
    expect(text(toUserError(new Error('Input document to `PDFDocument.load` is encrypted. You can use ignoreEncryption')))).toMatch(/암호가 걸린 PDF/);
    expect(text(toUserError(new Error('Input buffer contains unsupported image format')))).toMatch(/PNG·JPG/);
  });

  it('깨진 PDF·한글 문서의 개발자 문장을 원인별 할 일로', async () => {
    const { toUserError } = await import('../src/core/errors.js');
    const pdf = text(toUserError(new Error('Failed to parse PDF document (line:0 col:18 offset=9): No PDF header found')));
    expect(pdf).toMatch(/^PDF로 읽을 수 없는 파일입니다\. 파일이 손상됐거나 저장이 끝나지 않은 파일일 수 있습니다\. PDF 보기 프로그램에서 열리는지/);
    const hangul = text(toUserError(new Error('렌더 미지원 형식(unknown): 레이아웃 렌더는 HWPX·HWP 만 지원합니다')));
    expect(hangul).toMatch(/^한글 문서로 읽을 수 없는 파일입니다\..*한글에서 열리는지 확인/);
    const hwp = text(toUserError(new Error('FileHeader 스트림 없음')));
    expect(hwp).toMatch(/^HWP 문서의 머리 정보가 없어 열 수 없습니다\..*한글에서 열리는지 확인/);
    for (const m of [pdf, hangul, hwp]) expect(m).not.toMatch(/[A-Za-z]{4,}/);
  });

  it('윈도 예약 이름은 확장자가 붙어도 피한다', async () => {
    const { safeFileName } = await import('../src/core/output/index.js');
    expect(safeFileName('con.2024')).toBe('_con.2024');
    expect(safeFileName('nul.보고')).toBe('_nul.보고');
    expect(safeFileName('console 보고')).toBe('console 보고');
  });

  it('UTF-16(엑셀 유니코드 텍스트) 글을 깨지지 않게 읽는다', async () => {
    const { decodeText } = await import('../src/core/converter/index.js');
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('성명\t부서\n김가온\t총무과', 'utf16le')]);
    expect(decodeText(le)).toBe('성명\t부서\n김가온\t총무과');
  });
});

describe('빠진 부품 (kordoc MISSING_DEPENDENCY)', () => {
  it('"npm install …" 대신 할 일을 적은 한국어, npm 은 보이지 않는다', async () => {
    const { toUserError, parseFailure, MISSING_PART } = await import('../src/core/errors.js');
    const a = text(toUserError(new Error('PDF 파싱에 pdfjs-dist가 필요합니다. 설치: npm install pdfjs-dist')));
    const b = text(parseFailure({ code: 'MISSING_DEPENDENCY', error: 'PDF 파싱에 pdfjs-dist가 필요합니다. 설치: npm install pdfjs-dist' }));
    const c = text(parseFailure({ error: 'PNG 래스터에는 sharp가 필요합니다 (npm install sharp)' }));
    for (const m of [a, b, c]) {
      expect(m).toBe(MISSING_PART);
      expect(m).not.toMatch(/npm/i);
    }
    expect(MISSING_PART).toMatch(/설정 › 엔진 점검/);
  });
});

describe('깨진 문서 열기 (doc_info)', () => {
  it('한글·PDF 확장자인데 내용을 못 알아보면 형식 탓이 아니라 손상·저장 덜 됨으로 알린다', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { docInfo } = await import('../src/core/files/index.js');
    const dir = await mkdtemp(join(tmpdir(), 'kd-broken-'));
    try {
      const cases: Array<[string, Buffer]> = [
        ['내용이 엉뚱한.hwpx', Buffer.from('저장이 끝나지 않은 파일 '.repeat(20))],
        ['반쯤 저장된.hwpx', Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(300, 7)])],
        ['깨진.pdf', Buffer.from('%PDF-1.7\n깨진 내용')],
      ];
      for (const [name, bytes] of cases) {
        await writeFile(join(dir, name), bytes);
        const msg = await docInfo(join(dir, name)).then(() => '열림', (e: Error) => e.message);
        expect(msg, name).toMatch(/손상됐거나 저장이 끝나지 않은/);
        expect(msg, name).not.toMatch(/지원하지 않는/);
      }
      await writeFile(join(dir, '빈.hwpx'), Buffer.alloc(0));
      expect(await docInfo(join(dir, '빈.hwpx')).then(() => '', (e: Error) => e.message)).toMatch(/빈 파일.*원본을 다시 받아/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
