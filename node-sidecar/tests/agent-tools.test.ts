/** 작업 에이전트 도구 (core/agent-tools) + MCP 서버 (mcp/server) — 실제 라우터·합성 예제로 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { call, sample, setupEnv, SAMPLES } from './doc-helpers.js';
import { WORK_TOOLS, runWorkTool, workToolDefs, type Dispatch } from '../src/core/agent-tools/index.js';
import { createMcpHandler } from '../src/mcp/server.js';
import { RpcRouter } from '../src/rpc/router.js';
import { registerAllMethods } from '../src/rpc/methods/index.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const dispatch: Dispatch = (m, p) => call(m, p as Record<string, unknown>);
let env: ReturnType<typeof setupEnv>;
const REPORT = sample('4-보고서_디지털 행정 혁신 추진계획.hwpx');

beforeAll(() => {
  env = setupEnv();
});

describe('도구 정의', () => {
  it('이름이 겹치지 않고, 필수 인자는 모두 properties 에 있다', () => {
    const names = WORK_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of WORK_TOOLS) {
      const sc = t.inputSchema as { properties: Record<string, unknown>; required: string[] };
      for (const r of sc.required) expect(sc.properties, `${t.name}.${r}`).toHaveProperty(r);
    }
  });

  it('MCP 목록에는 앱 전용 도구(open_result)가 없다', () => {
    expect(workToolDefs().map((t) => t.name)).not.toContain('open_result');
    expect(workToolDefs({ app: true }).map((t) => t.name)).toContain('open_result');
  });

  it('agent_tool_run 은 손으로 할 때 걸릴 분(효과 집계 기준)을 함께 준다', async () => {
    const r = await call('agent_tool_run', { name: 'write_document', input: { markdown: '# 시험 공문\n\n1. 시험입니다.  끝.', preset: 'official' } });
    expect(r.isError).toBeFalsy();
    expect(r.saved_min).toBe(30);
    const read = await call('agent_tool_run', { name: 'document_guide', input: { preset: 'official' } });
    expect(read.saved_min).toBeUndefined();
  }, 60_000);

  it('agent_tools RPC 가 지시문과 앱용 목록을 준다', async () => {
    const r = await call('agent_tools');
    expect(r.system).toMatch(/원본 파일은 고치지 않습니다/);
    expect(r.tools.length).toBe(WORK_TOOLS.length);
  });
});

describe('도구 실행 (합성 예제)', () => {
  it('list_documents: 폴더 안 한글 문서를 찾는다', async () => {
    const r = await runWorkTool('list_documents', { paths: [SAMPLES] }, dispatch);
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('4-보고서_디지털 행정 혁신 추진계획.hwpx');
  });

  it('read_document: 본문을 글로 읽는다', async () => {
    const r = await runWorkTool('read_document', { path: REPORT }, dispatch);
    expect(r.isError).toBeFalsy();
    expect(r.output).toMatch(/디지털/);
  }, 60_000);

  it('write_document: 산출 폴더에 새 HWPX, 표기 검사 결과를 함께', async () => {
    const r = await runWorkTool('write_document', { markdown: '# 직원 체육대회 개최 계획\n\n## 추진 배경\n\n□ 직원 간 소통 기회 부족\n  ㅇ 단체 행사 미개최', preset: 'report' }, dispatch);
    expect(r.isError, r.output).toBeFalsy();
    expect(r.files).toHaveLength(1);
    expect(dirname(r.files![0])).toBe(env.out);
    expect(readFileSync(r.files![0]).subarray(0, 2).toString()).toBe('PK');
    expect(r.output).toMatch(/표기 검사/);
  }, 60_000);

  it('precheck → 원본은 바뀌지 않는다', async () => {
    const before = statSync(REPORT).mtimeMs;
    const r = await runWorkTool('precheck', { path: REPORT }, dispatch);
    expect(r.isError, r.output).toBeFalsy();
    expect(r.output).toMatch(/오류 \d+ · 경고 \d+/);
    expect(statSync(REPORT).mtimeMs).toBe(before);
  }, 60_000);

  it('document_guide: 갈래 규칙, 모르는 갈래는 오류', async () => {
    expect((await runWorkTool('document_guide', { preset: 'official' }, dispatch)).output).toMatch(/기안문 형식/);
    expect((await runWorkTool('document_guide', { preset: 'x' }, dispatch)).isError).toBe(true);
  });

  it('허용 폴더 밖 파일·모르는 도구·실패는 isError 로 (던지지 않음)', async () => {
    const out = await runWorkTool('read_document', { path: REPORT }, dispatch, { root: env.work });
    expect(out.isError).toBe(true);
    expect(out.output).toMatch(/허용한 폴더/);
    expect((await runWorkTool('list_documents', { paths: [SAMPLES] }, dispatch, { root: dirname(SAMPLES) })).isError).toBeFalsy();
    expect((await runWorkTool('nope', {}, dispatch)).isError).toBe(true);
    expect((await runWorkTool('open_result', { path: REPORT }, dispatch)).isError).toBe(true); // MCP(앱 아님)에선 없음
    const fail = await runWorkTool('read_document', { path: `${env.work}/없는 파일.hwpx` }, dispatch);
    expect(fail.isError).toBe(true);
  }, 60_000);
});

describe('보안·취소 (검증에서 나온 것)', () => {
  it('허용 폴더 검사는 .. 를 풀어서 본다', async () => {
    const sneaky = `${SAMPLES}/../samples/../package.json`;
    const r = await runWorkTool('read_document', { path: sneaky }, dispatch, { root: SAMPLES });
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/허용한 폴더/);
    const inside = await runWorkTool('list_documents', { paths: [`${SAMPLES}/취합/..`] }, dispatch, { root: SAMPLES });
    expect(inside.isError).toBeFalsy();
  });

  it('앱 안 대화: 사용자가 맡긴 파일만 연다 (붙인 것·그 폴더 안·요청에 적은 것·만든 것)', async () => {
    const LETTER = sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx');
    const read = (path: string, scope: { files: string[]; said: string[] }) => runWorkTool('read_document', { path }, dispatch, { app: true, scope });
    // 붙인 파일, 붙인 폴더 안
    expect((await read(REPORT, { files: [REPORT], said: [] })).isError).toBeFalsy();
    expect((await read(REPORT, { files: [SAMPLES], said: [] })).isError).toBeFalsy();
    // 붙이지 않은 파일: 문서 속 글이 시켜도 열지 않는다
    const stray = await read(LETTER, { files: [REPORT], said: ['이 문서 요약해 줘'] });
    expect(stray.isError).toBe(true);
    expect(stray.output).toMatch(/맡기지 않은 파일/);
    // 요청에 경로·파일 이름·폴더를 적었으면 연다
    expect((await read(LETTER, { files: [], said: [`${LETTER} 요약해 줘`] })).isError).toBeFalsy();
    expect((await read(LETTER, { files: [], said: ['1-받은공문_도민체육대회 참가 협조 요청.hwpx 를 요약해 줘'] })).isError).toBeFalsy();
    expect((await read(LETTER, { files: [], said: [`${SAMPLES} 폴더의 공문을 요약해 줘`] })).isError).toBeFalsy();
    // 다른 파일의 경로를 적은 것으로 그 폴더 전체가 열리지는 않는다
    expect((await read(LETTER, { files: [], said: [`${REPORT} 요약해 줘`] })).isError).toBe(true);
    // 폴더 이름이 거기서 끝난 것만 폴더로 본다: 더 긴 경로의 앞부분(이름에 빈칸·점이 든 폴더)은 그 폴더를 적은 것이 아니다
    expect((await read(LETTER, { files: [], said: [`${SAMPLES} 예산\\계획.hwp 를 요약해 줘`] })).isError).toBe(true);
    expect((await read(LETTER, { files: [], said: [`${SAMPLES}.2\\계획.hwp 를 요약해 줘`] })).isError).toBe(true);
    expect((await read(LETTER, { files: [], said: [`"${SAMPLES}" 안의 공문을 요약해 줘`] })).isError).toBeFalsy();
    expect((await read(LETTER, { files: [], said: [`공문은 ${SAMPLES}. 요약해 줘`] })).isError).toBeFalsy();
    expect((await read(LETTER, { files: [], said: [`${SAMPLES}\\ 에서 찾아 줘`] })).isError).toBeFalsy();
    expect((await read(LETTER, { files: [], said: [`${SAMPLES} 예산 최종\\계획.hwp 를 요약해 줘`] })).isError).toBe(true);
    expect((await read(LETTER, { files: [], said: [`${SAMPLES} 폴더와 D:\\다른\\파일.hwp 를 비교해 줘`] })).isError).toBeFalsy();
    expect((await read(LETTER, { files: [], said: [`${SAMPLES} 예산 계획.hwp 를 요약해 줘`] })).isError).toBe(true);
    // 적은 글이 거기서 끝나야 한다 (확장자가 더 이어지면 다른 파일이다). 뒤에 조사는 와도 된다
    expect((await read(LETTER, { files: [], said: [`${LETTER}x 요약해 줘`] })).isError).toBe(true);
    expect((await read(LETTER, { files: [], said: ['1-받은공문_도민체육대회 참가 협조 요청.hwpx2 요약해 줘'] })).isError).toBe(true);
    expect((await read(LETTER, { files: [], said: [`${LETTER}를 요약해 줘`] })).isError).toBeFalsy();
    // 다른 폴더의 같은 이름 파일을 경로로 적은 것은 이 파일을 맡긴 것이 아니다
    expect((await read(LETTER, { files: [], said: ['D:\\비밀\\1-받은공문_도민체육대회 참가 협조 요청.hwpx 요약해 줘'] })).isError).toBe(true);
    // 파일 이름도 낱말로 적혔을 때만 (다른 이름의 뒷부분으로 들어 있는 것은 아니다)
    expect((await read(LETTER, { files: [], said: ['최종1-받은공문_도민체육대회 참가 협조 요청.hwpx 를 요약해 줘'] })).isError).toBe(true);
    // 여러 파일을 받는 도구도 하나라도 밖이면 막는다. 경로가 없는 도구는 그대로
    expect((await runWorkTool('list_documents', { paths: [REPORT, LETTER] }, dispatch, { app: true, scope: { files: [REPORT], said: [] } })).isError).toBe(true);
    expect((await runWorkTool('document_guide', { preset: 'official' }, dispatch, { app: true, scope: { files: [], said: [] } })).isError).toBeFalsy();
  }, 60_000);

  it('agent_tool_run: scope 를 주면 막고, find_versions 는 찾은 판을 seen 으로 알려 준다', async () => {
    const LETTER = sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx');
    const blocked = await call('agent_tool_run', { name: 'read_document', input: { path: LETTER }, scope: { files: [REPORT], said: [] } });
    expect(blocked.isError).toBe(true);
    const vers = await call('agent_tool_run', { name: 'find_versions', input: { path: REPORT }, scope: { files: [REPORT], said: [] } });
    expect(vers.isError).toBeFalsy();
    expect(vers.seen).toContain(REPORT);
  }, 60_000);

  it('MCP 허용 폴더가 있으면 결과도 그 안에 둔다 (설정의 저장 폴더가 밖이어도)', async () => {
    const { confineOutputs, outputDir } = await import('../src/core/output/index.js');
    const { join } = await import('node:path');
    const outside = outputDir({ source: REPORT });
    try {
      confineOutputs(env.work);
      const fenced = outputDir({ source: REPORT });
      expect(fenced.startsWith(env.work)).toBe(true);
      // 이미 안쪽인 폴더는 그대로
      expect(outputDir({ output_dir: join(env.work, '안쪽') })).toBe(join(env.work, '안쪽'));
    } finally {
      confineOutputs(null);
    }
    expect(outputDir({ source: REPORT })).toBe(outside);
  });

  it('부른 쪽이 멈추면 엔진 안 호출도 멈춘다 (router.dispatch parent)', async () => {
    const router = new RpcRouter();
    router.register('wait_abort', (_p, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new DOMException('멈춤', 'AbortError')), { once: true })));
    const ac = new AbortController();
    const pending = router.dispatch('wait_abort', {}, undefined, ac.signal);
    ac.abort();
    expect((await pending).error?.message).toBe('Request cancelled');
  });
});

describe('MCP 서버', () => {
  const router = new RpcRouter();
  registerAllMethods(router);
  const handle = createMcpHandler(router, { version: 'test' });

  it('initialize: 아는 판은 그대로, 모르는 판은 최신', async () => {
    const a = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(a?.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'kordoc-ai' } });
    const b = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect((b?.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
  });

  it('알림엔 답하지 않고, 모르는 메서드는 -32601', async () => {
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect((await handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' }))?.error?.code).toBe(-32601);
  });

  it('tools/list → tools/call', async () => {
    const l = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    const tools = (l?.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
    expect(tools.find((t) => t.name === 'precheck')?.inputSchema).toBeTruthy();
    const c = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_documents', arguments: { paths: [SAMPLES] } } });
    const res = c?.result as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toContain('.hwpx');
  });
});
