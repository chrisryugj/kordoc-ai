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
    expect(methods).toContain('doc_info');
    expect(methods).toContain('render_pages');
    // cancel은 router 내부 처리이므로 등록 목록에 없음
    expect(methods).not.toContain('cancel');
  });
});

describe('RpcRouter 대기열', () => {
  it('대기열이 차거나 기다리다 취소돼도 응답(error)은 돌려준다', async () => {
    const r = new RpcRouter();
    const gates: Array<() => void> = [];
    r.register('slow_job', () => new Promise((resolve) => gates.push(() => resolve('done'))), { heavy: true });
    const running = [r.dispatch('slow_job', {}, 1), r.dispatch('slow_job', {}, 2)];
    const queued = Array.from({ length: 10 }, (_, i) => r.dispatch('slow_job', {}, 10 + i));
    // 대기열 10개가 찼다 → 다음은 바로 오류 응답 (거부로 끝나면 응답 줄이 안 나간다)
    await expect(r.dispatch('slow_job', {}, 99)).resolves.toMatchObject({ error: { message: expect.stringMatching(/대기열이 가득/) } });
    // 기다리던 것 하나를 취소하면 그것도 오류 응답
    await r.dispatch('cancel', { id: 10 });
    await expect(queued[0]).resolves.toMatchObject({ error: expect.anything() });
    while (gates.length) gates.shift()!();
    await new Promise((res) => setTimeout(res, 0));
    while (gates.length) gates.shift()!();
    await Promise.all(running);
  });
});
