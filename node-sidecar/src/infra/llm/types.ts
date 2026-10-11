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

/** HTTP 오류를 사람이 읽을 문장으로 */
export async function httpError(res: Response, who: string): Promise<Error> {
  const body = (await res.text().catch(() => '')).slice(0, 300);
  if (res.status === 401 || res.status === 403) return new Error(`${who}: 인증에 실패했습니다 (${res.status}). 설정 > AI 연결에서 API 키를 확인하세요.`);
  if (res.status === 404) return new Error(`${who}: 모델이나 주소를 찾을 수 없습니다 (404). 설정 > AI 연결에서 주소와 모델 이름을 확인하세요. ${body}`);
  if (res.status === 429) return new Error(`${who}: 요청 한도를 넘었습니다 (429). 잠시 후 다시 시도하세요.`);
  return new Error(`${who}: 오류 ${res.status} ${body}`);
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
