/** 사용자에게 보일 오류 문장
 *
 * - 파일 시스템 오류(ENOENT 등 영어)는 무엇을 하면 되는지까지 적은 한국어로
 * - kordoc 이 내는 문장의 줄표(—·–)는 쌍점으로 (화면 문장에 줄표 금지)
 * - 취소(AbortError)는 그대로 둔다 — 라우터가 취소로 처리
 */

import { basename } from 'node:path';
import { NO_BROWSER } from './export/chromium.js';

const FS_HINTS: Record<string, string> = {
  ENOENT: '파일이나 폴더를 찾을 수 없습니다. 경로가 맞는지 확인하세요.',
  EACCES: '이 위치에 접근할 권한이 없습니다. 다른 폴더를 고르거나 설정 > 저장 위치를 바꾸세요.',
  EPERM: '이 위치에 접근할 권한이 없습니다. 다른 폴더를 고르거나 설정 > 저장 위치를 바꾸세요.',
  EROFS: '읽기 전용 위치라 저장할 수 없습니다. 설정 > 저장 위치를 바꾸세요.',
  EBUSY: '다른 프로그램이 파일을 쓰고 있습니다. 한글·엑셀 등에서 파일을 닫고 다시 시도하세요.',
  ENOSPC: '디스크 공간이 부족합니다. 공간을 비우고 다시 시도하세요.',
  EISDIR: '파일 자리에 폴더가 지정됐습니다. 파일을 고르세요.',
  ENOTDIR: '폴더 자리에 파일이 지정됐습니다. 폴더를 고르세요.',
};

/** 줄표 → 쌍점, 앞뒤 공백 정리 */
export function cleanMessage(msg: string): string {
  return msg.replace(/\s*[—–]\s*/g, ': ').replace(/\s+\n/g, '\n').trim();
}

/** kordoc 이 선택 부품(pdfjs-dist·sharp·puppeteer-core 등)을 못 찾았을 때 — 개발자용 "npm install …" 안내 대신 */
export const MISSING_PART = '문서를 읽는 데 필요한 부품이 없습니다. 설정 › 엔진 점검을 눌러 보고, 계속되면 앱을 다시 설치하세요.';
const MISSING_DEP = /MISSING_DEPENDENCY|\bnpm (install|i)\b|Cannot find (module|package)|ERR_MODULE_NOT_FOUND/i;

const CHROMIUM_MISSING = /Chromium 실행 파일을 찾을 수 없습니다|Could not find (Chrome|browser)|Failed to launch the browser/i;

export function toUserError(err: unknown): unknown {
  if (err instanceof DOMException && err.name === 'AbortError') return err;
  const e = err as NodeJS.ErrnoException;
  if (e && typeof e.code === 'string' && FS_HINTS[e.code]) {
    return new Error(e.path ? `${FS_HINTS[e.code]} (${basename(e.path)})` : FS_HINTS[e.code]);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (CHROMIUM_MISSING.test(msg)) {
    return new Error(NO_BROWSER);
  }
  if (MISSING_DEP.test(msg) || (err as { code?: unknown })?.code === 'MISSING_DEPENDENCY') {
    return new Error(MISSING_PART);
  }
  if (/Password required or incorrect password|PDFDocument\.load` is encrypted|is encrypted/i.test(msg)) {
    return new Error('암호가 걸린 PDF입니다. 암호를 넣고 다시 시도하세요.');
  }
  if (/end of central directory|Corrupted zip|invalid zip|is this a zip file/i.test(msg)) {
    return new Error('파일이 손상됐거나 이 형식의 파일이 아닙니다. 원본을 다시 받아 보거나 한글에서 다시 저장해 보세요.');
  }
  if (/unsupported image format/i.test(msg)) {
    return new Error('지원하지 않는 그림 형식입니다. PNG·JPG 로 바꿔 다시 시도하세요.');
  }
  return new Error(cleanMessage(msg));
}

/** AI 공급자·네트워크 오류 → 할 일을 적은 한국어 (영어 원문 "fetch failed"·"401 {...}"·JSON 오류가 화면에 뜨지 않게) */
const AI_HINTS: Array<[RegExp, string]> = [
  [/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket hang up|other side closed/i, 'AI 서버에 연결하지 못했습니다. 설정 › AI 연결에서 주소를 확인하고, 기관 AI 서버나 Ollama가 켜져 있는지 보세요.'],
  [/TimeoutError|timed? ?out|ETIMEDOUT/i, 'AI 답이 너무 오래 걸려 멈췄습니다. 잠시 뒤 다시 시도하거나 더 짧은 문서로 해 보세요.'],
  [/\b401\b|\b403\b|authentication_error|invalid[_ ]api[_ ]key|unauthorized|permission_denied/i, 'AI 키가 맞지 않거나 권한이 없습니다. 설정 › AI 연결에서 키를 다시 넣으세요.'],
  [/\b429\b|rate[_ ]limit|quota/i, 'AI 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.'],
  [/\b5\d\d\b|internal server error|bad gateway|service unavailable|overloaded/i, 'AI 서버가 오류를 냈습니다. 잠시 뒤 다시 시도하세요. 계속되면 기관 AI 서버 담당자에게 알리세요.'],
  [/SyntaxError|Unexpected token|in JSON at position|JSON을 찾지 못했습니다/i, 'AI 답을 읽지 못했습니다. 다시 시도하세요. 계속되면 설정에서 다른 모델을 고르세요.'],
];

export function toAiError(err: unknown): unknown {
  if (err instanceof DOMException && err.name === 'AbortError') return err;
  const msg = err instanceof Error ? `${err.name}: ${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err);
  // 이미 한국어로 다듬은 안내(예: "AI가 아직 연결되지 않았습니다")는 그대로
  if (!/[a-zA-Z]{4,}/.test(err instanceof Error ? err.message : String(err))) return toUserError(err);
  const hint = AI_HINTS.find(([re]) => re.test(msg));
  return hint ? new Error(hint[1]) : toUserError(err);
}

/** 일괄 작업 결과에 담을 오류 문장 */
export function errorText(err: unknown): string {
  const e = toUserError(err);
  return e instanceof Error ? e.message : String(e);
}

/** kordoc parse 실패 → 사람이 읽을 문장 */
export function parseFailure(r: { code?: string; error: string }, hadPassword = false): Error {
  switch (r.code) {
    case 'ENCRYPTED':
      return new Error(hadPassword ? '암호가 맞지 않습니다. 다시 확인하세요.' : '암호가 걸린 문서입니다. 암호를 넣고 다시 시도하세요.');
    case 'DRM_PROTECTED':
      return new Error('한컴 문서보안(DRM)이 걸린 문서라 열 수 없습니다. 보안을 푼 사본으로 다시 시도하세요.');
    case 'UNSUPPORTED_FORMAT':
      return new Error('지원하지 않는 파일 형식입니다. HWP·HWPX·PDF·워드·엑셀·파워포인트·이미지 파일을 넣으세요.');
    case 'IMAGE_BASED_PDF':
      return new Error('글자 층이 없는 스캔 PDF입니다. OCR을 켜고 다시 시도하세요.');
    case 'CORRUPTED':
      return new Error('파일이 손상되어 열 수 없습니다. 원본을 다시 받아 시도하세요.');
    case 'FILE_NOT_FOUND':
      return new Error('파일을 찾을 수 없습니다. 경로가 맞는지 확인하세요.');
    case 'EMPTY_INPUT':
      return new Error('빈 파일입니다.');
    case 'MISSING_DEPENDENCY':
      return new Error(MISSING_PART);
    default:
      return new Error(MISSING_DEP.test(r.error ?? '') ? MISSING_PART : cleanMessage(r.error || '문서를 읽지 못했습니다.'));
  }
}
