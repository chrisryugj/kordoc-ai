/**
 * KorDoc AI — Node.js Sidecar
 * JSON-RPC 2.0 server over stdin/stdout
 */

import { createInterface } from 'node:readline';
import { RpcRouter } from './rpc/router.js';
import { RPC_ERRORS, type JsonRpcRequest, type JsonRpcResponse } from './rpc/protocol.js';
import { registerAllMethods } from './rpc/methods/index.js';
import { logger, setLogLevel } from './infra/logger.js';
import { getSettings } from './infra/config.js';
import { setApiKey } from './infra/apiKeyStore.js';

/** stdout에 JSON-RPC 응답 쓰기 */
function writeResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(id: number | string | null, code: number, message: string): void {
  writeResponse({ jsonrpc: '2.0', id, error: { code, message } });
}

function sendResult(id: number | string | null, result: unknown): void {
  writeResponse({ jsonrpc: '2.0', id, result });
}

// 프로세스 안정성: 미처리 에러 로깅 (사일런트 크래시 방지)
process.on('unhandledRejection', (reason) => {
  logger.error(`[main] unhandledRejection: ${reason}`);
});
process.on('uncaughtException', (err) => {
  logger.error(`[main] uncaughtException: ${err.message}`);
  process.exit(1);
});

/** 메인 서버 루프 */
async function main(): Promise<void> {
  // 설정 로드 + 로그 레벨 적용
  try {
    const settings = getSettings();
    setLogLevel(settings.general.log_level);
  } catch {
    // 설정 파일 없어도 기본값으로 계속
    logger.warn('[main] settings.yaml load failed, using defaults');
  }

  // 환경변수에서 API 키 주입 (Rust sidecar manager가 전달)
  const envKey = process.env.KORDOC_GEMINI_KEY;
  if (envKey) {
    setApiKey(envKey);
    logger.info(`[main] API key loaded from env (${envKey.slice(0, 4)}****)`);
  }

  const router = new RpcRouter();
  registerAllMethods(router);

  logger.info(`[main] KorDoc sidecar started (methods: ${router.listMethods().join(', ')})`);

  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // JSON 파싱
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed);
    } catch {
      sendError(null, RPC_ERRORS.PARSE_ERROR, 'Invalid JSON');
      return;
    }

    // 기본 검증
    if (request.jsonrpc !== '2.0' || !request.method) {
      sendError(request.id ?? null, RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request');
      return;
    }

    const { id, method, params } = request;
    const reqId = id ?? null;
    const startTime = Date.now();

    logger.info(`[rpc.recv] id=${reqId} method=${method}`);

    const { result, error } = await router.dispatch(method, params ?? {}, id);

    const elapsed = Date.now() - startTime;

    if (error) {
      logger.warn(`[rpc.err] id=${reqId} method=${method} ${elapsed}ms: ${error.message}`);
      sendError(reqId, error.code, error.message);
    } else {
      logger.info(`[rpc.ok] id=${reqId} method=${method} ${elapsed}ms`);
      sendResult(reqId, result);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('[main] shutting down');
    rl.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // stdin 닫히면 종료
  rl.on('close', () => {
    logger.info('[main] stdin closed, exiting');
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(`[main] fatal: ${err}`);
  process.exit(1);
});
