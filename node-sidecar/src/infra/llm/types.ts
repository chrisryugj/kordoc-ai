/** AI 공급자 공통 인터페이스 */

export interface ChatImage {
  mime: string;
  base64: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
}

/** JSON 스키마 (object·array·string·enum 정도의 단순한 모양만 쓴다) */
export type JsonSchema = Record<string, unknown>;

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** JSON 객체 하나만 내도록 강제 (지원하는 공급자에서) */
  json?: boolean;
  /** 이 모양의 JSON 만 내도록 강제 — 내장 엔진은 문법(grammar), OpenAI 호환은 json_schema. json 을 함께 켠다 */
  schema?: JsonSchema;
  signal: AbortSignal;
  onToken?: (text: string) => void;
}

export interface LlmProvider {
  id: string;
  /** 문서가 PC 밖(인터넷)으로 나가는 공급자인지 — 자동 마스킹·폐쇄망 차단 기준 */
  isCloud: boolean;
  supportsVision: boolean;
  chat(req: ChatRequest): Promise<string>;
  listModels?(signal?: AbortSignal): Promise<string[]>;
  /** 실제로 쓰는 컨텍스트 크기(토큰). 모르면 undefined */
  contextTokens?(signal?: AbortSignal): Promise<number | undefined>;
}

/** fetch 응답 본문을 SSE `data:` 줄 단위로 */
export async function* sseData(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    if (buf.startsWith('data:')) yield buf.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

/** 하루 단위 한도에 걸린 거절인가 (기다려도 오늘은 안 풀린다) — 서버가 본문에 적는 한도 이름으로 가린다 */
const dailyQuota = (body: string) => /per[\s_-]?day|daily|free[\s_-]?tier.*(day|limit: 0)|limit: 0\b/i.test(body);

/** HTTP 오류를 사람이 읽을 문장으로 */
export async function httpError(res: Response, who: string): Promise<Error> {
  const full = await res.text().catch(() => '');
  const body = full.slice(0, 300);
  if (res.status === 401 || res.status === 403) return new Error(`${who}: 인증에 실패했습니다 (${res.status}). 설정 › AI 연결에서 API 키를 확인하세요.`);
  if (res.status === 404) return new Error(`${who}: 모델이나 주소를 찾을 수 없습니다 (404). 설정 › AI 연결에서 주소와 모델 이름을 확인하세요. ${body}`);
  if (res.status === 429 && dailyQuota(full)) return new Error(`${who}: 오늘 쓸 수 있는 사용량을 다 썼습니다. 내일 다시 쓰거나, 설정 › AI 연결에서 다른 모델이나 다른 AI를 고르세요.`);
  if (res.status === 429) return new Error(`${who}: 요청 한도를 넘었습니다 (429). 잠시 후 다시 시도하세요.`);
  return new Error(`${who}: 오류 ${res.status} ${body}`);
}

/** 잠깐 붐벼서 온 거절을 다시 보낼 때 기다리는 시간(ms). 시험은 짧게 바꿔 쓴다 */
export const retryPolicy = { waits: [2000, 5000] };
/** 다시 보내 볼 만한 거절: 서버가 붐빔·잠깐 못 받음 (게이트웨이 502·504, 503, 529) 과 분당 한도(429) */
const RETRY_STATUS = new Set([429, 502, 503, 504, 529]);

/** 요청을 보내고, 잠깐 붐벼서 온 거절이면 조금 기다렸다 다시 보낸다 (두 번까지). 아직 답을 한 글자도 받지 않은 때라
 *  두 번 보내도 결과가 겹치지 않는다. 하루 한도 거절·그 밖의 오류는 그대로 돌려줘 부른 쪽이 알린다 */
export async function sendRetrying(send: () => Promise<Response>, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await send();
    if (res.ok || !RETRY_STATUS.has(res.status) || attempt >= retryPolicy.waits.length) return res;
    if (res.status === 429 && dailyQuota(await res.clone().text().catch(() => ''))) return res;
    // 서버가 기다릴 시간을 알려 주면 그만큼 (너무 길면 기다리지 않고 알린다)
    const after = Number(res.headers.get('retry-after'));
    if (Number.isFinite(after) && after > 15) return res;
    await res.body?.cancel().catch(() => undefined);
    const ms = Math.max(retryPolicy.waits[attempt], Number.isFinite(after) && after > 0 ? after * 1000 : 0);
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('취소했습니다.', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    });
  }
}

/** 사고 과정 태그(<think>…</think>)를 걷어 내는 스트림 거름망 — 본문에 사고를 섞어 보내는 서버(llama-server·LM Studio 일부) 대비
 *
 * push(조각) 은 새로 보여 줄 글만 돌려준다. 태그가 조각 경계에 걸려도 깨지지 않게 끝의 `<…` 는 잠시 붙잡아 둔다.
 */
export function createThinkFilter(): { push(chunk: string): string; flush(): string } {
  let raw = '';
  let emitted = 0;
  const visible = (final: boolean) => {
    let v = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
    const open = v.indexOf('<think>');
    if (open >= 0) v = v.slice(0, open);
    if (!final) {
      const lt = v.lastIndexOf('<');
      if (lt >= 0 && '<think>'.startsWith(v.slice(lt))) v = v.slice(0, lt);
    }
    return v;
  };
  return {
    push(chunk) {
      raw += chunk;
      const v = visible(false);
      const out = v.slice(emitted);
      emitted = Math.max(emitted, v.length);
      return out;
    },
    flush() {
      const v = visible(true);
      const out = v.slice(emitted);
      emitted = v.length;
      return out;
    },
  };
}
