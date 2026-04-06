/** Gemini API 클라이언트 — 재시도, 취소, 타임아웃, 프록시 지원 */

import { GoogleGenerativeAI, type SingleRequestOptions } from '@google/generative-ai';
import { getConfig } from './config.js';
import { logger } from './logger.js';

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (client) return client;
  const cfg = getConfig('gemini');
  if (!cfg.api_key) {
    throw new Error('Gemini API key not configured');
  }
  client = new GoogleGenerativeAI(cfg.api_key);
  return client;
}

/** 프록시 URL + 타임아웃 + signal을 반영한 RequestOptions 생성 */
function getRequestOptions(signal?: AbortSignal): SingleRequestOptions {
  const cfg = getConfig('gemini');
  const opts: SingleRequestOptions = {};

  // proxy_url이 설정되어 있으면 baseUrl로 적용 (CF Workers 프록시 등)
  if (cfg.proxy_url) {
    opts.baseUrl = cfg.proxy_url;
    logger.info(`[gemini] using proxy: ${cfg.proxy_url}`);
  }

  // SDK 내장 timeout 활용 (milliseconds)
  opts.timeout = cfg.timeout_ms || 60_000;

  // 외부 AbortSignal 전달 (cancel 연동)
  if (signal) {
    opts.signal = signal;
  }

  return opts;
}

/** 클라이언트 재초기화 (API key 변경 시) */
export function resetClient(): void {
  client = null;
}

/** 재시도 가능한 에러인지 확인 */
function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('503') || msg.includes('rate') || msg.includes('overloaded');
  }
  return false;
}

/** 지수 백오프 대기 (AbortSignal 연동) */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface GeminiCallOptions {
  prompt: string;
  model?: string;
  signal?: AbortSignal;
  systemInstruction?: string;
}

export interface GeminiVisionOptions {
  prompt: string;
  /** base64 인코딩된 이미지 데이터 */
  imageBase64: string;
  /** MIME 타입 (기본: image/png) */
  mimeType?: string;
  model?: string;
  signal?: AbortSignal;
  systemInstruction?: string;
  /** true면 응답을 JSON으로 강제 (responseMimeType: application/json) */
  jsonMode?: boolean;
}

/** 재시도 + 지수 백오프 헬퍼 (1s 시작, 최대 30s 캡) */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  const cfg = getConfig('gemini');
  const maxRetries = cfg.max_retries;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxRetries) break;

      const delay = Math.min(1_000 * Math.pow(2, attempt), 30_000); // 1s, 2s, 4s, 8s, ... cap 30s
      logger.warn(`[${label}] retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay, signal);
    }
  }

  throw lastError;
}

/** Gemini API 호출 (재시도 + 취소) */
export async function callGemini(options: GeminiCallOptions): Promise<string> {
  const cfg = getConfig('gemini');

  if (cfg.mode === 'offline') {
    throw new Error('Gemini is in offline mode');
  }

  const modelName = options.model ?? cfg.model;
  const ai = getClient();
  const model = ai.getGenerativeModel({
    model: modelName,
    ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
  });

  const requestOptions = getRequestOptions(options.signal);

  return withRetry(
    async () => {
      const result = await model.generateContent(options.prompt, requestOptions);
      return result.response.text();
    },
    'gemini',
    options.signal,
  );
}

/** Gemini Vision API 호출 — 이미지 + 텍스트 멀티모달 (재시도 + 취소) */
export async function callGeminiVision(options: GeminiVisionOptions): Promise<string> {
  const cfg = getConfig('gemini');

  if (cfg.mode === 'offline') {
    throw new Error('Gemini is in offline mode');
  }

  const modelName = options.model ?? cfg.model;
  const ai = getClient();
  const model = ai.getGenerativeModel({
    model: modelName,
    ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
    ...(options.jsonMode ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
  });

  const imagePart = {
    inlineData: {
      data: options.imageBase64,
      mimeType: options.mimeType ?? 'image/png',
    },
  };

  const requestOptions = getRequestOptions(options.signal);

  return withRetry(
    async () => {
      const result = await model.generateContent([options.prompt, imagePart], requestOptions);
      return result.response.text();
    },
    'gemini-vision',
    options.signal,
  );
}
