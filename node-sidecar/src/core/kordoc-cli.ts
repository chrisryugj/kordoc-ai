/** kordoc CLI 자식 프로세스 — 공개 API 에 없는 기능(서식 보존 마스킹·단계 서식·수치 대조·모델 반입)용
 *
 * 설치본은 process.execPath 가 동봉 Node, cli 는 스테이징된 dist/node_modules/kordoc/dist/cli.js.
 * 환경변수(KORDOC_MODEL_CACHE·KORDOC_OFFLINE)는 그대로 물려준다.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { cleanMessage } from './errors.js';

export function kordocDistDir(): string {
  return dirname(createRequire(import.meta.url).resolve('kordoc'));
}

export const kordocCliPath = (): string => join(kordocDistDir(), 'cli.js');
export const kordocMcpPath = (): string => join(kordocDistDir(), 'mcp.js');

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runKordocCli(args: string[], opts: { input?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CliResult> {
  opts.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [kordocCliPath(), ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 600_000);
    const onAbort = () => child.kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) return reject(opts.signal.reason);
      resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString('utf-8'), stderr: Buffer.concat(err).toString('utf-8') });
    });
    // 취소로 자식이 먼저 끝나면 stdin 쓰기가 EPIPE 를 낸다: 처리 안 하면 엔진 전체가 끝난다
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input ?? '');
  });
}

/** CLI stderr 의 마지막 오류 줄 → 사람이 읽을 문장 */
export function cliErrorMessage(r: CliResult, fallback: string): string {
  const lines = r.stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = [...lines].reverse().find((l) => /오류|ERROR|실패|알 수 없는/.test(l)) ?? lines.at(-1);
  if (!last) return fallback;
  return cleanMessage(last.replace(/^\[kordoc[^\]]*\]\s*/, '').replace(/^(오류|ERROR):\s*/, ''));
}

/** --json 출력 읽기 — 오류 종료여도 JSON 이 있으면 그것을 쓴다 (lint 는 위반이 있으면 exit 1) */
export function parseCliJson<T>(r: CliResult, fallback: string): T {
  const text = r.stdout.trim();
  if (text) {
    try {
      const v = JSON.parse(text) as T | null;
      if (v !== null) return v;
    } catch {
      /* 아래에서 stderr 로 */
    }
  }
  throw new Error(cliErrorMessage(r, fallback));
}
