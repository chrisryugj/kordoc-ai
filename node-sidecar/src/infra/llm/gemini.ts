/** Google Gemini 공급자 (REST, SSE 스트림)
 *
 * gemini-3.x 는 temperature·thinkingBudget 이 오류라 보내지 않고 thinkingLevel "low" 만 건다.
 * (3.8-flash 는 minimal 을 400 으로 거부, low 는 사고 0·첫 글자 ~2초 — 2026-10 실측)
 */

import { assertAllowed } from '../net-guard.js';
import { httpError, sendRetrying, sseData, type ChatRequest, type LlmProvider } from './types.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function createGeminiProvider(cfg: { api_key: string; model: string }, timeoutMs: number): LlmProvider {
  const model = cfg.model || 'gemini-3.8-flash';
  return {
    id: 'gemini',
    isCloud: true,
    supportsVision: true,
    async chat(req: ChatRequest) {
      if (!cfg.api_key) throw new Error('Gemini API 키가 없습니다. 설정 › AI 연결에서 넣으세요.');
      const url = `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      await assertAllowed(url);

      const contents = req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(m.images ?? []).map((img) => ({ inline_data: { mime_type: img.mime, data: img.base64 } })),
          { text: m.content },
        ],
      }));
      // 시간 제한은 응답이 멈춘 시간 기준 (전체 시간으로 재면 긴 초안이 받는 도중에 끊긴다)
      const idle = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(new Error('idle')), timeoutMs);
      };
      const signal = AbortSignal.any([req.signal, idle.signal]);
      const body = JSON.stringify({
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents,
        generationConfig: {
          ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
          ...(req.json ? { responseMimeType: 'application/json' } : {}),
          ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      });
      try {
        touch();
        const res = await sendRetrying(() => {
          touch();
          return fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.api_key },
            signal,
            redirect: 'error', // 문서가 든 요청을 관문 없이 다른 주소로 다시 보내지 않게
            body,
          });
        }, signal);
        if (!res.ok) throw await httpError(res, 'Gemini');

        let out = '';
        for await (const data of sseData(res, signal)) {
          touch();
          let chunk: { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>; error?: { message?: string } };
          try { chunk = JSON.parse(data); } catch { continue; }
          if (chunk.error) throw new Error(`Gemini: ${chunk.error.message ?? '오류'}`);
          if (chunk.candidates?.[0]?.finishReason === 'MAX_TOKENS') req.onTruncated?.();
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.thought || !part.text) continue;
            out += part.text;
            req.onToken?.(part.text);
          }
        }
        return out;
      } catch (err) {
        if (idle.signal.aborted && !req.signal.aborted) {
          throw new Error(`Gemini가 ${Math.round(timeoutMs / 1000)}초 동안 응답하지 않습니다. 잠시 뒤 다시 시도하고, 계속되면 문서를 나눠 보내세요.`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    /** 이 키로 쓸 수 있는 글 생성 모델 (공식 models.list, 이름 앞 "models/" 는 뗀다) */
    async listModels(signal) {
      if (!cfg.api_key) throw new Error('Gemini API 키를 넣은 뒤 모델을 불러오세요.');
      const url = `${BASE}/models?pageSize=1000`;
      await assertAllowed(url);
      const res = await fetch(url, { headers: { 'x-goog-api-key': cfg.api_key }, signal: signal ?? AbortSignal.timeout(15_000), redirect: 'manual' });
      if (!res.ok) throw await httpError(res, 'Gemini');
      const body = (await res.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
      return (body.models ?? [])
        .filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => m.name!.replace(/^models\//, ''));
    },
  };
}
