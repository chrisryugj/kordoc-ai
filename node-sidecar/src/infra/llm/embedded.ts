/** 내장 엔진 — node-llama-cpp 로 GGUF 모델을 이 PC 안에서 돌린다 (설치·인터넷 불필요)
 *
 * 모델은 한 번 올리면 메모리에 두고, 설정(경로·컨텍스트·GPU)이 바뀌거나 10분 동안 쓰지 않으면 내린다.
 * 동시에 한 요청만 — 시퀀스 1개를 순서대로 쓴다.
 * JSON 은 문법(grammar)으로 강제한다 — 스키마가 있으면 그 모양 그대로, 없으면 아무 JSON.
 * 사고(thinking) 모델은 사고 예산 0 — 소형 모델이 CPU 에서 수십 초씩 생각하는 것 방지.
 */

import { existsSync, statSync } from 'node:fs';
import { logger } from '../logger.js';
import { sendProgress } from '../progress.js';
import type { ChatRequest, LlmProvider } from './types.js';

export interface EmbeddedConfig {
  model_path: string;
  context_size: number;
  gpu: 'auto' | 'off';
}

import type { ChatHistoryItem } from 'node-llama-cpp';

type NlcModule = typeof import('node-llama-cpp');
type Loaded = {
  key: string;
  nlc: NlcModule;
  llama: Awaited<ReturnType<NlcModule['getLlama']>>;
  model: Awaited<ReturnType<Awaited<ReturnType<NlcModule['getLlama']>>['loadModel']>>;
  context: Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<NlcModule['getLlama']>>['loadModel']>>['createContext']>>;
};

let loaded: Loaded | null = null;
/** 적재·해제·생성을 한 줄로 세운다 — 답을 쓰는 중에 설정 변경·모델 삭제가 문맥을 해제하지 않게 */
let queue: Promise<unknown> = Promise.resolve();
/** 읽지 못한 모델 — 같은 파일이면 다시 시도하지 않는다(실패한 적재 시도가 한 번에 20초씩 걸림) */
let failed: { key: string; error: Error } | null = null;

/** 4B 모델이 메모리 4GB 넘게 붙잡고(실측) 앱은 창을 닫아도 트레이에 남아서, 쓰지 않으면 내린다 */
const IDLE_UNLOAD_MS = 10 * 60_000;
let idleTimer: NodeJS.Timeout | undefined;
let waiting = 0;

const keyOf = (c: EmbeddedConfig) => `${c.model_path}|${c.context_size}|${c.gpu}`;

function serial<T>(fn: () => Promise<T>): Promise<T> {
  waiting++;
  clearTimeout(idleTimer);
  const p = queue.then(fn, fn);
  queue = p.catch(() => {}).finally(() => {
    if (--waiting === 0 && loaded) idleTimer = setTimeout(() => void serial(disposeLoaded), IDLE_UNLOAD_MS).unref();
  });
  return p;
}

async function disposeLoaded(): Promise<void> {
  const l = loaded;
  loaded = null;
  if (!l) return;
  await l.context.dispose().catch(() => {});
  await l.model.dispose().catch(() => {});
  await l.llama.dispose().catch(() => {});
}

/** queue 안에서만 부른다 */
async function load(cfg: EmbeddedConfig): Promise<Loaded> {
  const key = keyOf(cfg);
  if (loaded?.key === key) return loaded;
  await disposeLoaded();
  if (!cfg.model_path || !existsSync(cfg.model_path)) {
    throw new Error('내장 AI 모델 파일(.gguf)이 없습니다. 설정 > AI 연결에서 모델을 받거나 가져오세요.');
  }
  const st = statSync(cfg.model_path);
  const fileKey = `${key}|${st.size}|${st.mtimeMs}`;
  if (failed?.key === fileKey) throw failed.error;
  sendProgress({ current: 0, total: 1, message: '내장 AI 모델을 메모리에 올리는 중...' });
  const nlc = await import('node-llama-cpp');
  // 배포본은 미리 빌드된 바이너리만 쓴다 — 사용자 PC 에서 컴파일·다운로드 시도 금지
  const llama = await nlc.getLlama({ gpu: cfg.gpu === 'off' ? false : 'auto', build: 'never', skipDownload: true, progressLogs: false });
  logger.info(`[llm.embedded] 모델 로드: ${cfg.model_path} (gpu=${llama.gpu})`);
  let model: Loaded['model'];
  try {
    model = await llama.loadModel({ modelPath: cfg.model_path });
  } catch (err) {
    await llama.dispose().catch(() => {});
    logger.warn(`[llm.embedded] 모델 로드 실패: ${err instanceof Error ? err.message : String(err)}`);
    failed = { key: fileKey, error: new Error('이 모델 파일은 내장 AI가 읽을 수 없습니다(Ollama 전용 형식이거나 지원하지 않는 구조). 설정 > AI 연결에서 추천 모델을 받으세요.') };
    throw failed.error;
  }
  let context: Loaded['context'];
  try {
    context = await model.createContext({ contextSize: { max: cfg.context_size } });
  } catch (err) {
    // 메모리 부족 등 — 올린 모델을 내려야 다음 시도가 사본을 또 쌓지 않는다
    await model.dispose().catch(() => {});
    await llama.dispose().catch(() => {});
    logger.warn(`[llm.embedded] 문맥 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
    failed = { key: fileKey, error: new Error('메모리가 부족해 내장 AI를 올리지 못했습니다. 설정 > AI 연결에서 한 번에 읽는 길이를 줄이거나 더 작은 모델을 고르세요.') };
    throw failed.error;
  }
  loaded = { key, nlc, llama, model, context };
  return loaded;
}

/** 모델 내리기 — 쓰는 중인 요청이 끝난 뒤에 */
export function unloadEmbedded(): Promise<void> {
  return serial(disposeLoaded);
}

/** 모델이 메모리에 올라 있는지 */
export function isEmbeddedLoaded(): boolean {
  return loaded !== null;
}

/** 모델을 미리 올려 첫 응답 지연을 없앰 + 장치 정보 */
export function warmupEmbedded(cfg: EmbeddedConfig): Promise<{ gpu: string | false; contextSize: number; trainContextSize: number }> {
  return serial(async () => {
    const l = await load(cfg);
    return { gpu: l.llama.gpu, contextSize: l.context.contextSize, trainContextSize: l.model.trainContextSize };
  });
}

export function createEmbeddedProvider(cfg: EmbeddedConfig): LlmProvider {
  return {
    id: 'embedded',
    isCloud: false,
    supportsVision: false,
    chat(req: ChatRequest) {
      const run = async () => {
        const l = await load(cfg);
        const last = req.messages.at(-1);
        if (!last || last.role !== 'user') throw new Error('마지막 메시지는 사용자 질문이어야 합니다');
        const sequence = l.context.getSequence();
        const session = new l.nlc.LlamaChatSession({ contextSequence: sequence, systemPrompt: req.system });
        try {
          if (req.messages.length > 1) {
            const history: ChatHistoryItem[] = session.getChatHistory().filter((h) => h.type === 'system');
            for (const m of req.messages.slice(0, -1)) {
              history.push(m.role === 'user' ? { type: 'user', text: m.content } : { type: 'model', response: [m.content] });
            }
            session.setChatHistory(history);
          }
          const grammar = req.schema
            ? await l.llama.createGrammarForJsonSchema(req.schema as never)
            : req.json ? await l.llama.getGrammarFor('json') : undefined;
          return await session.prompt(last.content, {
            maxTokens: req.maxTokens,
            signal: req.signal,
            grammar,
            onTextChunk: req.onToken,
            budgets: { thoughtTokens: 0 },
          });
        } finally {
          session.dispose({ disposeSequence: true });
        }
      };
      return serial(run);
    },
    contextTokens() {
      return serial(async () => (await load(cfg)).context.contextSize);
    },
  };
}
