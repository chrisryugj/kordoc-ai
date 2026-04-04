import { describe, it, expect, beforeEach } from 'vitest';
import { RpcRouter } from '../src/rpc/router.js';
import { RPC_ERRORS } from '../src/rpc/protocol.js';
import { registerAllMethods } from '../src/rpc/methods/index.js';

describe('RpcRouter', () => {
  let router: RpcRouter;

  beforeEach(() => {
    router = new RpcRouter();
    registerAllMethods(router);
  });

  it('ping → pong', async () => {
    const res = await router.dispatch('ping', {}, 1);
    expect(res.result).toBe('pong');
    expect(res.error).toBeUndefined();
  });

  it('존재하지 않는 메서드 → METHOD_NOT_FOUND', async () => {
    const res = await router.dispatch('nonexistent', {}, 2);
    expect(res.error?.code).toBe(RPC_ERRORS.METHOD_NOT_FOUND);
  });

  it('convert — 누락 파라미터 에러', async () => {
    const res = await router.dispatch('convert', {}, 3);
    expect(res.error).toBeDefined();
    expect(res.error!.message).toMatch(/input_path|경로가 비어/);
  });

  it('cancel — 활성 요청 없음', async () => {
    const res = await router.dispatch('cancel', { id: 999 }, 4);
    expect(res.result).toBeDefined();
  });

  it('cancel — 전체 취소', async () => {
    const res = await router.dispatch('cancel', {}, 5);
    expect(res.result).toHaveProperty('cancelled_all');
  });

  it('list_files — 누락 파라미터 에러', async () => {
    const res = await router.dispatch('list_files', {}, 6);
    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain('경로');
  });

  it('list_files — 실제 디렉토리 읽기', async () => {
    const res = await router.dispatch('list_files', { path: '.' }, 7);
    expect(res.error).toBeUndefined();
    expect(Array.isArray(res.result)).toBe(true);
  });

  it('등록된 메서드 목록 확인', () => {
    const methods = router.listMethods();
    expect(methods).toContain('ping');
    expect(methods).toContain('convert');
    expect(methods).toContain('scan_receipt');
    // cancel은 router 내부 처리이므로 등록 목록에 없음
    expect(methods).not.toContain('cancel');
  });
});
