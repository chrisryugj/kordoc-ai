/** RPC 파라미터 꺼내기 + 오류 문장 정리 — system·documents 등록 파일 공용 */

import type { RpcRouter } from '../router.js';
import type { RpcHandler } from '../protocol.js';
import { validatePath } from '../../infra/pathGuard.js';
import { toUserError } from '../../core/errors.js';

/** router.register 와 같되, 던진 오류를 사람이 읽을 문장으로 바꾼다 */
export function registrar(router: RpcRouter) {
  return (name: string, handler: RpcHandler, opts?: { heavy?: boolean }): void => {
    router.register(name, async (params, signal) => {
      try {
        return await handler(params, signal);
      } catch (err) {
        throw toUserError(err);
      }
    }, opts);
  };
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
export const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** 필수 경로 */
export function reqPath(v: unknown): string {
  return validatePath(v as string);
}

/** 선택 경로 */
export function optPath(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? validatePath(v) : undefined;
}

/** 경로 목록 (하나 이상) */
export function reqPaths(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new Error('파일을 하나 이상 고르세요.');
  return v.map((p) => validatePath(p as string));
}

export function strList(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : undefined;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}
