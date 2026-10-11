/** Anthropic Claude 공급자 (공식 SDK, 스트리밍)
 *
 * Opus 5.5 계열은 temperature·thinking 끄기가 400 이라 보내지 않는다.
 * 정책 거절(stop_reason "refusal") 시 서버 측 대체 모델로 이어 받도록 fallbacks:"default" 를 켠다.
 */

import Anthropic from '@anthropic-ai/sdk';
import { assertAllowed } from '../net-guard.js';
import type { ChatRequest, LlmProvider } from './types.js';

const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export function createAnthropicProvider(cfg: { api_key: string; model: string }, timeoutMs: number): LlmProvider {
  const model = cfg.model || 'claude-opus-5-5';
  return {
    id: 'anthropic',
    isCloud: true,
    supportsVision: true,
    async chat(req: ChatRequest) {
      if (!cfg.api_key) throw new Error('Claude API 키가 없습니다. 설정 > AI 연결에서 입력하세요.');
      await assertAllowed('https://api.anthropic.com/v1/messages');
      const client = new Anthropic({ apiKey: cfg.api_key, timeout: timeoutMs, maxRetries: 2 });

      const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m) => ({
        role: m.role,
        content: [
          ...(m.images ?? []).map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mime as ImageMime, data: img.base64 },
          })),
          { type: 'text' as const, text: req.json && m === req.messages.at(-1) ? `${m.content}\n\nJSON 객체 하나만 출력하세요.` : m.content },
        ],
      }));

      const useFallback = FALLBACK_MODELS.has(model);
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: req.maxTokens ?? 16_000,
          ...(req.system ? { system: req.system } : {}),
          messages,
          ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        } as Anthropic.Beta.MessageCreateParamsStreaming,
        { signal: req.signal },
      );

      let out = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          out += event.delta.text;
          req.onToken?.(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new Error('Claude가 이 요청을 거절했습니다. 내용을 바꿔 다시 시도하세요.');
      return out;
    },
  };
}
