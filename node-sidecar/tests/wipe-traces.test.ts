/** 이 PC의 작업 흔적 지우기 — 앱이 남긴 사본·임시 파일만 지우고 사용자 자산과 다른 프로그램 파일은 남긴다 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wipeTraces } from '../src/core/privacy/wipe.js';

describe('wipeTraces', () => {
  it('복구·작업 사본과 임시 폴더의 앱 파일을 지우고 서식·설정·남의 임시 파일은 남긴다', () => {
    const root = mkdtempSync(join(tmpdir(), 'kd-wipe-'));
    try {
      const data = join(root, 'data');
      const temp = join(root, 'temp');
      const put = (p: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, 'x'); };
      put(join(data, 'recovery', 'a.bin'));
      put(join(data, 'recovery', 'a.json'));
      put(join(data, '작업 사본', 'draft.hwpx'));
      put(join(data, 'settings.json'));
      put(join(data, 'templates', 't.hwpx'));
      put(join(data, 'inbox.json'));
      put(join(temp, 'kordoc-pdf-work', 'h.pdf'));
      put(join(temp, 'kordoc-print', 'p.pdf'));
      put(join(temp, 'kordoc-gather-abc', 'g.csv'));
      put(join(temp, 'kordoc-ai-chrome-1', 'Default', 'x'));
      put(join(temp, 'kordoc-sub-9', 'prompt.txt'));
      put(join(temp, 'kordoc-agy-cwd', 'x'));
      put(join(temp, 'kordoc-agy-pending', 'conv1'));
      put(join(temp, 'kordoc-batch-123.json'));
      put(join(temp, 'kordoc-ai', 'clipboard_1.txt'));
      put(join(temp, 'kordoc-ai', 'other.log'));
      put(join(temp, 'someone-else.tmp'));
      put(join(temp, 'kordoc-batch-x.json'));

      const r = wipeTraces({ data, temp });
      expect(r.skipped).toBe(0);
      expect(r.removed).toBe(11);
      expect(readdirSync(join(data, 'recovery'))).toEqual([]);
      expect(readdirSync(join(data, '작업 사본'))).toEqual([]);
      for (const keep of ['settings.json', 'templates/t.hwpx', 'inbox.json']) expect(existsSync(join(data, keep)), keep).toBe(true);
      expect(readdirSync(temp).sort()).toEqual(['kordoc-agy-pending', 'kordoc-ai', 'kordoc-batch-x.json', 'someone-else.tmp']);
      expect(readdirSync(join(temp, 'kordoc-ai'))).toEqual(['other.log']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('폴더가 없어도 오류 없이 0', () => {
    const root = mkdtempSync(join(tmpdir(), 'kd-wipe-'));
    try {
      expect(wipeTraces({ data: join(root, 'none'), temp: join(root, 'none2') })).toEqual({ removed: 0, skipped: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
