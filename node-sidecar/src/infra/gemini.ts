/** Gemini API 클라이언트 — 재시도, 취소, 프록시 지원 */

import { GoogleGenerativeAI } from '@google/generative-ai';
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
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
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

  const maxRetries = cfg.max_retries;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const result = await model.generateContent(options.prompt);
      const text = result.response.text();
      return text;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxRetries) break;

      const delay = 10_000 * Math.pow(2, attempt); // 10s, 20s, 40s, 80s, 160s
      logger.warn(`[gemini] retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay, options.signal);
    }
  }

  throw lastError;
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
  });

  const imagePart = {
    inlineData: {
      data: options.imageBase64,
      mimeType: options.mimeType ?? 'image/png',
    },
  };

  const maxRetries = cfg.max_retries;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const result = await model.generateContent([options.prompt, imagePart]);
      return result.response.text();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxRetries) break;

      const delay = 10_000 * Math.pow(2, attempt);
      logger.warn(`[gemini-vision] retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay, options.signal);
    }
  }

  throw lastError;
}
