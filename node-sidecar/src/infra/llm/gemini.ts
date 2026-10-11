/** Google Gemini 공급자 (REST, SSE 스트림)
 *
 * gemini-3.x 는 temperature·thinkingBudget 이 오류라 보내지 않고 thinkingLevel "low" 만 건다.
 * (3.8-flash 는 minimal 을 400 으로 거부, low 는 사고 0·첫 글자 ~2초 — 2026-10 실측)
 */

import { assertAllowed } from '../net-guard.js';
import { httpError, sseData, type ChatRequest, type LlmProvider } from './types.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function createGeminiProvider(cfg: { api_key: string; model: string }, timeoutMs: number): LlmProvider {
  const model = cfg.model || 'gemini-3.8-flash';
  return {
    id: 'gemini',
    isCloud: true,
    supportsVision: true,
    async chat(req: ChatRequest) {
      if (!cfg.api_key) throw new Error('Gemini API 키가 없습니다. 설정 > AI 연결에서 입력하세요.');
      const url = `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      await assertAllowed(url);

      const contents = req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(m.images ?? []).map((img) => ({ inline_data: { mime_type: img.mime, data: img.base64 } })),
          { text: m.content },
        ],
      }));
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.api_key },
        signal,
        redirect: 'error', // 문서가 든 요청을 관문 없이 다른 주소로 다시 보내지 않게
        body: JSON.stringify({
          ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
          contents,
          generationConfig: {
            ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
            ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
          },
        }),
      });
      if (!res.ok) throw await httpError(res, 'Gemini');

      let out = '';
      for await (const data of sseData(res, signal)) {
        let chunk: { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>; error?: { message?: string } };
        try { chunk = JSON.parse(data); } catch { continue; }
        if (chunk.error) throw new Error(`Gemini: ${chunk.error.message ?? '오류'}`);
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.thought || !part.text) continue;
          out += part.text;
          req.onToken?.(part.text);
        }
      }
      return out;
    },
  };
}
