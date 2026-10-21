/** AI 연결 상태·시험·모델 목록·내장 모델 미리 올리기 */

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { AiStatus } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { ask, getProvider } from '../../infra/llm/index.js';
import { isEmbeddedLoaded, warmupEmbedded } from '../../infra/llm/embedded.js';
import { createOpenAiProvider } from '../../infra/llm/openai.js';
import { normalizeLocalBase } from '../../infra/llm/local-servers.js';

/** 설정만 보고 빠진 것을 알려 준다 (네트워크·모델 로드 없음) */
export function aiStatus(): AiStatus {
  const s = getSettings();
  const { ai } = s;
  const base: AiStatus = {
    provider: ai.provider,
    configured: false,
    is_cloud: false,
    supports_vision: false,
    offline: s.privacy.offline,
    embedded_loaded: isEmbeddedLoaded(),
  };
  let model: string | undefined;
  let missing: string | undefined;
  switch (ai.provider) {
    case 'embedded':
      model = ai.embedded.model_path ? basename(ai.embedded.model_path) : undefined;
      if (!ai.embedded.model_path || !existsSync(ai.embedded.model_path)) missing = '내장 AI 모델 파일이 없습니다. 설정 > AI 연결에서 추천 모델을 받거나 가져오세요.';
      break;
    case 'openai':
      model = ai.openai.model || undefined;
      if (!ai.openai.base_url) missing = 'AI 서버 주소가 비어 있습니다. 설정 > AI 연결에서 주소를 넣으세요.';
      else if (!ai.openai.model) missing = 'AI 모델을 고르지 않았습니다. 설정 > AI 연결에서 모델을 고르세요.';
      break;
    case 'local':
      model = ai.local.model || undefined;
      if (!ai.local.base_url) missing = '로컬 모델 서버 주소가 비어 있습니다. 설정 > AI 연결에서 이 PC에서 찾기를 누르거나 주소를 넣으세요.';
      else if (!ai.local.model) missing = '로컬 모델 서버의 모델을 고르지 않았습니다. 설정 > AI 연결에서 모델을 고르세요.';
      break;
    case 'gemini':
    case 'anthropic':
      model = ai[ai.provider].model || undefined;
      if (!ai[ai.provider].api_key) missing = 'API 키가 없습니다. 설정 > AI 연결에서 키를 넣으세요.';
      break;
    case 'claude-code':
    case 'codex':
      // 설치·로그인은 프로그램을 띄워야 알 수 있어 여기서는 보지 않는다 (ai_subscription_status, 실행 직전 확인)
      model = ai[ai.provider === 'codex' ? 'codex' : 'claude_code'].model || '기본 모델';
      break;
    default:
      missing = 'AI가 아직 연결되지 않았습니다. 설정 > AI 연결에서 내장 모델이나 AI 서버를 고르세요.';
  }
  try {
    const p = getProvider();
    Object.assign(base, { is_cloud: p.isCloud, supports_vision: p.supportsVision });
  } catch (err) {
    missing ??= err instanceof Error ? err.message : String(err);
  }
  return { ...base, configured: !missing, ...(model ? { model } : {}), ...(missing ? { error: missing } : {}) };
}

/** 연결 시험 — 짧은 질문 한 번, 실패해도 오류 대신 결과로 */
export async function aiTest(signal: AbortSignal): Promise<{ ok: boolean; latency_ms: number; sample?: string; error?: string }> {
  const t = Date.now();
  try {
    const { text } = await ask({
      messages: [{ role: 'user', content: '연결 확인입니다. "연결되었습니다"라고만 답하세요.' }],
      maxTokens: 32,
      signal,
      stream: false,
    });
    const sample = text.trim().slice(0, 100);
    if (!sample) return { ok: false, latency_ms: Date.now() - t, error: 'AI가 빈 답을 보냈습니다. 모델을 제대로 불러왔는지 확인하세요.' };
    return { ok: true, latency_ms: Date.now() - t, sample };
  } catch (err) {
    if (signal.aborted) throw err;
    return { ok: false, latency_ms: Date.now() - t, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 저장 전 주소·키로 모델 목록 — 화면에 가려진 키(****)가 오면 저장된 키를 쓴다. slot: 기관 서버(openai)·이 PC 서버(local) 중 어느 칸의 키인지 */
export async function listServerModels(params: { base_url?: string; api_key?: string; slot?: 'openai' | 'local' }, signal: AbortSignal): Promise<{ models: string[] }> {
  const saved = getSettings().ai[params.slot === 'local' ? 'local' : 'openai'];
  const raw = params.base_url?.trim() || saved.base_url;
  const baseUrl = params.slot === 'local' ? normalizeLocalBase(raw) : raw;
  if (!baseUrl) throw new Error('AI 서버 주소를 넣으세요. 예: http://127.0.0.1:11434/v1');
  try { new URL(baseUrl); } catch { throw new Error(`AI 서버 주소 형식이 아닙니다: ${baseUrl}. 예: http://127.0.0.1:11434/v1`); }
  // 저장된 키는 저장된 주소에만 — 다른 주소를 시험할 때 키가 그쪽으로 새지 않게
  const norm = (u: string) => u.trim().replace(/\/+$/, '');
  const typed = params.api_key && !params.api_key.includes('****') ? params.api_key.trim() : '';
  const key = typed || (norm(baseUrl) === norm(saved.base_url) ? saved.api_key : '');
  // 폐쇄망 모드면 listModels 안의 관문(assertAllowed)이 외부 주소를 막는다
  const p = createOpenAiProvider({ base_url: baseUrl, api_key: key, model: '', vision_model: '' }, getSettings().ai.timeout_ms);
  try {
    return { models: await p.listModels!(AbortSignal.any([signal, AbortSignal.timeout(15_000)])) };
  } catch (err) {
    if (signal.aborted) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|timeout|aborted/i.test(msg)) {
      throw new Error(`AI 서버에 연결하지 못했습니다(${baseUrl}). 서버가 켜져 있는지, 주소·포트가 맞는지 확인하세요.`);
    }
    throw err;
  }
}

/** 내장 모델을 미리 메모리에 올림 */
export async function aiWarmup(): Promise<{ gpu: string | false; context_size: number }> {
  const { ai } = getSettings();
  if (ai.provider !== 'embedded') throw new Error('내장 AI를 고른 경우에만 미리 올릴 수 있습니다. 설정 > AI 연결에서 내장 모델을 고르세요.');
  const r = await warmupEmbedded(ai.embedded);
  return { gpu: r.gpu, context_size: r.contextSize };
}
