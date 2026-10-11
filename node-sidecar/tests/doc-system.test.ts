/** 시스템·감시·OCR 등록 — models_status/import·detect/install_mcp_config(가짜 HOME)·watch_*·ocr·메서드 목록 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, makePng, sample, setupEnv } from './doc-helpers.js';
import { sendNotification } from '../src/infra/progress.js';
import { ocrModelsReady } from '../src/core/system/index.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const BUNDLED_MODELS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'models', 'ppocr');
let env: ReturnType<typeof setupEnv>;

beforeAll(() => {
  env = setupEnv();
});

describe('models_status·models_import', () => {
  it.skipIf(!existsSync(join(BUNDLED_MODELS, 'det.onnx')))('파일만 모아 둔 폴더에서 가져오기 (SHA-256 검증) → 준비됨', async () => {
    const prev = process.env.KORDOC_MODEL_CACHE;
    process.env.KORDOC_MODEL_CACHE = join(env.base, 'models');
    try {
      expect((await call('models_status')).ocr.ready).toBe(false);
      const r = await call('models_import', { dir: BUNDLED_MODELS });
      expect(r.imported).toEqual(expect.arrayContaining(['ppocr/det.onnx', 'ppocr/rec_korean.onnx', 'ppocr/rec_korean.yml']));
      const s = await call('models_status');
      expect(s.ocr).toEqual({ ready: true, dir: join(env.base, 'models', 'ppocr') });
      expect(s.formula.ready).toBe(false);
      await expect(call('models_import', { dir: env.work })).rejects.toThrow(/가져올 모델 파일이 없습니다/);
    } finally {
      // undefined 를 넣으면 문자열 "undefined" 가 되어 레포에 undefined/ 폴더가 생긴다
      if (prev === undefined) delete process.env.KORDOC_MODEL_CACHE; else process.env.KORDOC_MODEL_CACHE = prev;
    }
  }, 60_000);
});

describe('detect_mcp_env·install_mcp_config (가짜 HOME)', () => {
  it('동봉 Node + kordoc/dist/mcp.js 절대 경로, npx 없음, 주석 설정은 백업, 못 읽는 설정은 그대로', async () => {
    const home = join(env.base, 'home');
    mkdirSync(join(home, '.zed'), { recursive: true });
    mkdirSync(join(home, '.gemini'), { recursive: true });
    writeFileSync(join(home, '.zed', 'settings.json'), '// Zed 설정\n{\n  "theme": "One Dark", // 주석\n  "vim_mode": true,\n}\n');
    writeFileSync(join(home, '.gemini', 'settings.json'), '{ 이건 JSON 이 아님');
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA };
    Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming') });
    try {
      const before = await call('detect_mcp_env');
      expect(before.clients.find((c: { id: string }) => c.id === 'cursor')).toMatchObject({ configured: false });
      const r = await call('install_mcp_config', { clients: ['cursor', 'zed', 'gemini-cli', 'nope'], root_dir: env.work });
      expect(r.installed.sort()).toEqual(['cursor', 'zed']);
      expect(r.failed.map((f: { client: string }) => f.client).sort()).toEqual(['gemini-cli', 'nope']);
      const cursor = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf-8')).mcpServers.kordoc;
      expect(cursor.command).toBe(process.execPath);
      expect(cursor.args[0]).toMatch(/kordoc[\\/]dist[\\/]mcp\.js$/);
      expect(existsSync(cursor.args[0])).toBe(true);
      expect(cursor.env.KORDOC_ROOT).toBe(env.work);
      expect(JSON.stringify(cursor)).not.toContain('npx');
      const zed = JSON.parse(readFileSync(join(home, '.zed', 'settings.json'), 'utf-8'));
      expect(zed.theme).toBe('One Dark');
      expect(zed.context_servers.kordoc.command.path).toBe(process.execPath);
      expect(existsSync(join(home, '.zed', 'settings.json.kordoc-backup'))).toBe(true);
      expect(readFileSync(join(home, '.gemini', 'settings.json'), 'utf-8')).toBe('{ 이건 JSON 이 아님');
      const after = await call('detect_mcp_env');
      expect(after.clients.find((c: { id: string }) => c.id === 'cursor')).toMatchObject({ configured: true });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('watch_start·watch_stop·watch_list', () => {
  it('새 문서가 들어오면 변환하고 watch_event 알림', async () => {
    const dir = join(env.base, 'inbox');
    const out = join(env.base, 'inbox-out');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const { id } = await call('watch_start', { dir, out_dir: out, format: 'md' });
    try {
      expect((await call('watch_list')).map((w: { id: string }) => w.id)).toContain(id);
      await expect(call('watch_start', { dir })).rejects.toThrow(/이미 감시 중/);
      copyFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'), join(dir, 'sub', '공문.hwpx'));
      writeFileSync(join(dir, '메모.txt'), '무시되는 글자 파일');
      const mock = vi.mocked(sendNotification);
      const deadline = Date.now() + 40_000; // 보통 2초, 전체 테스트 병렬 실행(Chromium·OCR)으로 CPU 가 바쁘면 15초를 넘는다
      while (!mock.mock.calls.some(([m]) => m === 'watch_event') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      const event = mock.mock.calls.find(([m]) => m === 'watch_event')?.[1] as { id: string; ok: boolean; output_path: string };
      expect(event).toMatchObject({ id, ok: true });
      expect(event.output_path).toBe(join(out, 'sub', '공문.md'));
      expect(readFileSync(event.output_path, 'utf-8')).toContain('체육대회');
      expect((await call('watch_list')).find((w: { id: string }) => w.id === id).processed).toBe(1);
    } finally {
      expect(await call('watch_stop', { id })).toBe(true);
    }
    expect(await call('watch_stop', { id })).toBe(false);
  }, 60_000);
});

describe('ocr (리드 구현) — 계약 모양으로 등록', () => {
  it.skipIf(!ocrModelsReady())('이미지 글자 읽기 (내장 OCR)', async () => {
    const img = join(env.work, '글자.png');
    writeFileSync(img, await makePng(640, 160, 'KORDOC 2026'));
    const r = await call('ocr', { input_path: img, engine: 'local' });
    expect(r).toMatchObject({ success: true, engine: 'local' });
    expect(r.markdown).toMatch(/KORDOC|2026/);
    expect(existsSync(r.output_path)).toBe(true);
  }, 60_000);
});

describe('메서드 목록', () => {
  it('v2 문서·시스템 메서드 등록, v1 이름(diff·extract_tables·install_node·form_extract*) 없음', async () => {
    const { RpcRouter } = await import('../src/rpc/router.js');
    const { registerAllMethods } = await import('../src/rpc/methods/index.js');
    const router = new RpcRouter();
    registerAllMethods(router);
    const names = router.listMethods();
    for (const m of ['reveal_file', 'scan_paths', 'models_status', 'models_import', 'doc_info', 'convert', 'convert_batch', 'render_pages', 'export_pdf', 'ocr',
      'compare', 'tables_extract', 'gongmun_meta', 'generate_hwpx', 'template_fields', 'template_fill', 'mail_merge', 'lint', 'redact', 'redact_batch', 'seal',
      'patch_document', 'validate_hwpx', 'watch_start', 'watch_stop', 'watch_list', 'to_hwpx', 'to_hwpx_batch', 'compare_hwpx', 'bundle_pdf', 'pdf_stamp',
      'extract_images', 'search_files', 'collect_fields', 'collect_run', 'write_file', 'read_file_b64', 'template_library', 'template_add', 'template_remove',
      'template_analyze', 'template_starter', 'org_autofill', 'form_schema', 'form_fill', 'render_preview', 'edit_open']) {
      expect(names).toContain(m);
    }
    for (const m of ['diff', 'extract_tables', 'install_node', 'form_extract', 'form_extract_candidates', 'form_extract_batch']) expect(names).not.toContain(m);
  });

  it('파일 시스템 오류는 할 일까지 적은 한국어', async () => {
    await expect(call('list_files', { path: join(env.base, '없는폴더') })).rejects.toThrow(/찾을 수 없습니다.*확인하세요/);
  });
});
