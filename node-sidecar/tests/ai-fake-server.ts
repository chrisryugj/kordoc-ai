/** AI 테스트용 가짜 서버 — OpenAI 호환 SSE(/v1/chat/completions·/v1/models), 선택적으로 Ollama 흉내(/api/version·/api/ps) */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  max_tokens?: number;
  response_format?: { type: string; json_schema?: { schema: Record<string, unknown> } };
  reasoning_effort?: string;
}

export interface Recorded {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body?: ChatBody;
}

export interface FakeOptions {
  /** 답 글 (요청을 보고 정함) */
  reply?: (body: ChatBody, n: number) => string;
  /** response_format 이 있으면 400 으로 거부 */
  rejectResponseFormat?: boolean;
  /** 답 앞에 reasoning 필드 조각을 섞어 보냄 (무시돼야 함) */
  reasoning?: string;
  /** /api/version·/api/ps 를 열어 Ollama 처럼 보임 */
  ollama?: { contextLength: number };
  models?: string[];
  /** 첫 글자 전에 기다릴 ms */
  delayMs?: number;
  /** 첫 조각을 보낸 뒤 멈출 ms (토큰 사이 멈춤) */
  stallMs?: number;
  /** 채팅 요청을 이 주소로 넘겨 보냄 (307) */
  redirectChatTo?: string;
}

export interface FakeServer {
  url: string;
  requests: Recorded[];
  chats: () => ChatBody[];
  close: () => Promise<void>;
}

const readBody = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => resolve(s));
});

async function sse(res: ServerResponse, text: string, reasoning?: string, stallMs?: number) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta: Record<string, unknown>) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
  if (reasoning) for (const part of reasoning.match(/.{1,4}/gs) ?? []) send({ reasoning: part });
  // 3글자씩 잘라 보내 조각 경계를 흉내
  for (const [i, part] of (text.match(/.{1,3}/gs) ?? []).entries()) {
    send({ content: part });
    if (i === 0 && stallMs) await new Promise((r) => setTimeout(r, stallMs));
  }
  if (res.destroyed) return;
  res.write('data: [DONE]\n\n');
  res.end();
}

export async function startFakeOpenAi(opts: FakeOptions = {}): Promise<FakeServer> {
  const requests: Recorded[] = [];
  let n = 0;
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as ChatBody) : undefined;
    requests.push({ method: req.method ?? '', path, headers: req.headers, body });

    if (path === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: (opts.models ?? ['test-model', 'alpha']).map((id) => ({ id, object: 'model' })) }));
      return;
    }
    if (opts.ollama && path === '/api/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: '0.31.2' }));
      return;
    }
    if (opts.ollama && path === '/api/ps') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'test-model', model: 'test-model', context_length: opts.ollama.contextLength }] }));
      return;
    }
    if (path === '/v1/chat/completions' && body) {
      if (opts.redirectChatTo) {
        res.writeHead(307, { location: opts.redirectChatTo });
        res.end();
        return;
      }
      if (opts.rejectResponseFormat && body.response_format) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'response_format not supported' } }));
        return;
      }
      const text = opts.reply ? opts.reply(body, n++) : '안녕하세요';
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      await sse(res, text, opts.reasoning, opts.stallMs);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    chats: () => requests.filter((r) => r.path === '/v1/chat/completions' && r.body).map((r) => r.body!),
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** 마지막 사용자 메시지 */
export const lastUser = (b: ChatBody) => [...b.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
export const systemOf = (b: ChatBody) => b.messages.find((m) => m.role === 'system')?.content ?? '';
