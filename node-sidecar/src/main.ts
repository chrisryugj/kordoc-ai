/**
 * KorDoc AI — Node.js Sidecar
 * JSON-RPC 2.0 server over stdin/stdout
 */

import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { RpcRouter } from './rpc/router.js';
import { RPC_ERRORS, type JsonRpcRequest, type JsonRpcResponse } from './rpc/protocol.js';
import { registerAllMethods } from './rpc/methods/index.js';
import { logger, setLogLevel } from './infra/logger.js';
import { getSettings } from './infra/config.js';
import { hasSecretKey } from './infra/secret-box.js';
import { syncOfflineEnv } from './infra/net-guard.js';
import { APP_VERSION, seedBundledModels } from './core/system/index.js';
import { runMcpServer } from './mcp/server.js';
import { setWorkerEntry } from './infra/worker.js';
import { sweepStaleTempDirs } from './infra/llm/subscription/program.js';
import { sweepAgyLeftovers } from './infra/llm/gemini-cli.js';

/** 짝 없는 서로게이트(글을 글자 중간에서 자른 확장 한자·이모지)를 U+FFFD 로 — Rust(serde_json)가 그 응답을 버려 호출이 시간 초과까지 멈춘다 */
const wellFormed = (_k: string, v: unknown): unknown => (typeof v === 'string' ? (v as string & { toWellFormed(): string }).toWellFormed() : v);

/** stdout에 JSON-RPC 응답 쓰기 */
function writeResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response, wellFormed) + '\n');
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
  // MCP 서버로 뜨면 현재 폴더는 AI 프로그램이 정한 작업 폴더다(받은 압축 파일을 푼 폴더일 수 있다). 이름만으로 프로그램·DLL 을
  // 찾는 길이 그 폴더를 먼저 보지 않게, 앱이 엔진을 띄울 때처럼 엔진 폴더로 옮긴다. 도구는 절대 경로만 받으므로 뜻이 달라지지 않는다
  if (process.argv.includes('--mcp')) {
    try { process.chdir(dirname(fileURLToPath(import.meta.url))); } catch { /* 옮기지 못해도 계속 */ }
  }
  // 앱이 넘긴 설정 암호화 키를 먼저 꺼내 환경에서 지운다. API 키를 한 번도 저장하지 않은 PC 에서는 이 키를 읽을 일이 없어
  // 환경에 그대로 남았고, 엔진이 띄우는 다른 프로그램(문서 변환 도구·인쇄용 브라우저)이 물려받았다
  hasSecretKey();
  // 설정 로드 + 로그 레벨 적용
  try {
    const settings = getSettings();
    setLogLevel(settings.general.log_level);
    syncOfflineEnv();
  } catch {
    // 설정 파일 없어도 기본값으로 계속
    logger.warn('[main] settings load failed, using defaults');
  }

  try { seedBundledModels(); } catch (err) { logger.warn(`[main] OCR 모델 시드 실패: ${err}`); }
  // 지난 실행에서 못 지운 구독 프로그램 임시 폴더(문서 그림이 남았을 수 있음)
  void sweepStaleTempDirs().then((n) => { if (n) logger.info(`[main] 남은 구독 프로그램 임시 폴더 ${n}개를 지웠습니다`); });
  // 지난 실행이 꺼지며 못 지운 Antigravity CLI 대화 기록(보낸 문서 전문)
  void sweepAgyLeftovers().catch(() => {});

  const router = new RpcRouter();
  registerAllMethods(router);

  // 바깥 AI 에이전트용 MCP 서버로 뜬 경우 (install_mcp_config 가 등록한 명령: 동봉 Node + 이 번들 + --mcp)
  if (process.argv.includes('--mcp')) { runMcpServer(router, APP_VERSION); return; }

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

// 무거운 작업은 이 파일을 작업자 스레드로 한 번 더 띄워 돌린다 (infra/worker). 작업자에서는 JSON-RPC 서버를 열지 않는다
setWorkerEntry(new URL(import.meta.url));
if (isMainThread) {
  main().catch((err) => {
    logger.error(`[main] fatal: ${err}`);
    process.exit(1);
  });
}
