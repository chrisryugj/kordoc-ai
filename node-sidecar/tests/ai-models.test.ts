/** 내장 모델 관리 — 추천 목록·받기(넘겨주기·이어받기·검사값)·가져오기·지우기 (가짜 다운로드 서버) */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { catalog, deleteModel, downloadModel, importModel, listModels, llmDir, type CatalogEntry } from '../src/core/ai/models.js';

const dir = mkdtempSync(join(tmpdir(), 'kordoc-ai-models-'));
process.env.KORDOC_AI_DATA_DIR = dir;
const signal = () => new AbortController().signal;

const blob = Buffer.concat([Buffer.from('GGUF'), randomBytes(600 * 1024)]);
const sha = createHash('sha256').update(blob).digest('hex');
const ranges: Array<string | undefined> = [];
let stall: (() => void) | null = null;
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/model.gguf') {
      res.writeHead(302, { location: '/blob/model.gguf' });
      res.end();
      return;
    }
    if (req.url === '/blob/model.gguf') {
      const range = req.headers.range;
      ranges.push(range);
      const start = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
      res.writeHead(range ? 206 : 200, {
        'content-length': String(blob.length - start),
        ...(range ? { 'content-range': `bytes ${start}-${blob.length - 1}/${blob.length}` } : {}),
      });
      if (stall) {
        // 앞부분만 보내고 멈춤 → 테스트가 취소
        res.write(blob.subarray(start, start + 128 * 1024), () => setTimeout(() => stall?.(), 50));
        return;
      }
      res.end(blob.subarray(start));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await updateSettings({ privacy: { offline: false } });
});
afterAll(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });

const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: 'test', name: '테스트 모델', file: 'test-model.gguf', size: blob.length, sha256: sha, ram_gb: 1,
  url: `${base}/model.gguf`, license: 'MIT', description: '', ...over,
});

describe('llm_catalog', () => {
  it('한국어 소형 GGUF 3종, 커밋 고정 HF 주소, 추천 1개, 비상업 라이선스 없음', () => {
    const c = catalog();
    expect(c).toHaveLength(3);
    for (const m of c) {
      expect(m.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/.+\.gguf$/);
      expect(m.url.endsWith(m.file)).toBe(true);
      expect(m.size_gb).toBeGreaterThan(0.5);
      expect(m.downloaded).toBe(false);
      expect(m.license).toBeTruthy();
    }
    expect(c.filter((m) => m.recommended)).toHaveLength(1);
    expect(c.some((m) => /NC|비상업/.test(m.license))).toBe(false);
  });
});

describe('llm_download', () => {
  it('넘겨주기를 따라가고, 취소하면 .part 를 남긴 뒤 Range 로 이어 받는다 + sha256 확인', async () => {
    const e = entry();
    const part = join(llmDir(), `${e.file}.part`);
    const ac = new AbortController();
    stall = () => ac.abort();
    await expect(downloadModel(e, ac.signal)).rejects.toThrow();
    stall = null;
    expect(existsSync(part)).toBe(true);
    const got = statSync(part).size;
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThan(blob.length);

    const path = await downloadModel(e, signal());
    expect(path).toBe(join(llmDir(), e.file));
    expect(readFileSync(path).equals(blob)).toBe(true);
    expect(existsSync(part)).toBe(false);
    expect(ranges.at(-1)).toBe(`bytes=${got}-`);
    expect(catalog().length).toBe(3);

    // 이미 있으면 다시 받지 않는다
    const n = ranges.length;
    expect(await downloadModel(e, signal())).toBe(path);
    expect(ranges.length).toBe(n);
  });

  it('검사값이 다르면 지우고 오류', async () => {
    const e = entry({ id: 'bad', file: 'bad.gguf', sha256: '0'.repeat(64) });
    await expect(downloadModel(e, signal())).rejects.toThrow(/손상/);
    expect(existsSync(join(llmDir(), 'bad.gguf.part'))).toBe(false);
    expect(existsSync(join(llmDir(), 'bad.gguf'))).toBe(false);
  });

  it('폐쇄망 모드면 받지 않고 가져오기를 안내', async () => {
    await updateSettings({ privacy: { offline: true } });
    try {
      await expect(downloadModel(entry({ id: 'x', file: 'x.gguf' }), signal())).rejects.toThrow(/폐쇄망.*가져오기/);
    } finally {
      await updateSettings({ privacy: { offline: false } });
    }
  });
});

describe('llm_import · llm_list · llm_delete', () => {
  it('GGUF 머리가 아니면 거부, 확장자 없는 GGUF(Ollama blob 등)는 .gguf 로 복사', async () => {
    const outside = join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'note.gguf'), 'not a model');
    await expect(importModel(join(outside, 'note.gguf'), signal())).rejects.toThrow(/GGUF/);
    writeFileSync(join(outside, 'sha256-abc'), blob);
    const p = await importModel(join(outside, 'sha256-abc'), signal());
    expect(p).toBe(join(llmDir(), 'sha256-abc.gguf'));
    expect(readFileSync(p).equals(blob)).toBe(true);
    expect(listModels().map((m) => m.name)).toContain('sha256-abc.gguf');
    // 같은 파일을 다시 가져오면 그대로
    expect(await importModel(join(outside, 'sha256-abc'), signal())).toBe(p);
  });

  it('앱 모델 폴더 안의 .gguf 만 지운다', async () => {
    await expect(deleteModel(join(dir, 'outside', 'sha256-abc'))).rejects.toThrow(/모델 폴더/);
    await expect(deleteModel(join(llmDir(), '..', 'settings.json'))).rejects.toThrow(/모델 폴더/);
    writeFileSync(join(llmDir(), 'memo.txt'), 'x');
    await expect(deleteModel(join(llmDir(), 'memo.txt'))).rejects.toThrow(/\.gguf/);
    expect(await deleteModel(join(llmDir(), 'sha256-abc.gguf'))).toBe(true);
    expect(existsSync(join(llmDir(), 'sha256-abc.gguf'))).toBe(false);
    expect(await deleteModel(join(llmDir(), 'sha256-abc.gguf'))).toBe(false);
  });
});
