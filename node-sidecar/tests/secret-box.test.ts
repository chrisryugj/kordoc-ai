/** 설정 파일 API 키 암호화 — Windows 앱이 넘기는 KORDOC_SECRET_KEY 가 있으면 enc:v1 로 쓰고, 없으면 평문(0600) */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { reload, updateSettings, getSettings } from '../src/infra/config.js';
import { resetSecretKey, seal, unseal } from '../src/infra/secret-box.js';

const KEY = randomBytes(32).toString('base64');
let dir: string;
const file = () => readFileSync(join(dir, 'settings.json'), 'utf8');
const useKey = (k?: string) => {
  if (k) process.env.KORDOC_SECRET_KEY = k; else delete process.env.KORDOC_SECRET_KEY;
  resetSecretKey();
};
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kordoc-ai-secret-'));
  process.env.KORDOC_AI_DATA_DIR = dir;
});

describe('secret-box', () => {
  it('키가 있으면 settings.json 에 암호문, 읽으면 평문', async () => {
    useKey(KEY);
    reload();
    await updateSettings({ ai: { gemini: { api_key: 'AIza-secret-123' } } });
    expect(file()).not.toContain('AIza-secret-123');
    expect(file()).toContain('enc:v1:');
    reload();
    expect(getSettings().ai.gemini.api_key).toBe('AIza-secret-123');
    // 키는 환경 변수에서 지워 자식 프로그램에 넘어가지 않는다
    expect(process.env.KORDOC_SECRET_KEY).toBeUndefined();
  });

  it('예전 평문 키는 읽을 때 한 번 다시 써서 암호화', async () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ version: 2, ai: { anthropic: { api_key: 'sk-ant-old' } } }));
    useKey(KEY);
    reload();
    await settle();
    expect(getSettings().ai.anthropic.api_key).toBe('sk-ant-old');
    expect(file()).not.toContain('sk-ant-old');
  });

  it('키가 바뀌어 못 풀면 빈 칸으로 쓰되 파일의 암호문은 지우지 않는다', async () => {
    useKey(KEY);
    reload();
    await updateSettings({ ai: { openai: { api_key: 'org-key' } } });
    const sealed = JSON.parse(file()).ai.openai.api_key as string;
    useKey(randomBytes(32).toString('base64'));
    reload();
    expect(getSettings().ai.openai.api_key).toBe('');
    await updateSettings({ org: { dept: '총무과' } });
    expect(JSON.parse(file()).ai.openai.api_key).toBe(sealed);
  });

  it('키가 없으면 평문 그대로 (macOS·개발)', async () => {
    useKey();
    reload();
    await updateSettings({ ai: { local: { api_key: 'local-key' } } });
    expect(JSON.parse(file()).ai.local.api_key).toBe('local-key');
    expect(seal('x')).toBe('x');
    expect(unseal('enc:v1:AAAA')).toBeNull();
  });
});
