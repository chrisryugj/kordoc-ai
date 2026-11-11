/** 목록 파일(저장한 서식·서식함) — 잠깐 못 읽은 것을 빈 목록으로 받아 저장하면 저장해 둔 것이 다 지워진다 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reload } from '../src/infra/config.js';
import { readListFile } from '../src/infra/list-file.js';
import { styleDelete, styleList } from '../src/core/style/index.js';
import { templateRemove } from '../src/core/template/library.js';

const dir = mkdtempSync(join(tmpdir(), 'kordoc-list-'));
process.env.KORDOC_AI_DATA_DIR = dir;
reload();

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('readListFile', () => {
  it('없으면 null, 못 읽으면 볼 때는 null·고칠 때는 던진다, 깨졌으면 고칠 때 옆으로 옮긴다', async () => {
    const file = join(dir, 'list.json');
    expect(await readListFile(file, '서식', true)).toBeNull();
    mkdirSync(file);
    expect(await readListFile(file, '서식', false)).toBeNull();
    await expect(readListFile(file, '서식', true)).rejects.toThrow('서식 목록을 지금 읽을 수 없어 바꾸지 않았습니다');
    rmSync(file, { recursive: true });
    writeFileSync(file, '{ "styles": [');
    expect(await readListFile(file, '서식', false)).toBeNull();
    expect(readdirSync(dir).filter((n) => n.startsWith('list.json'))).toEqual(['list.json']);
    expect(await readListFile(file, '서식', true)).toBeNull();
    const left = readdirSync(dir).filter((n) => n.startsWith('list.json'));
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^list\.json\.broken-/);
    expect(readFileSync(join(dir, left[0]), 'utf-8')).toBe('{ "styles": [');
  });
});

describe('저장한 서식·서식함', () => {
  it('목록 파일을 못 읽는 동안 지우기는 실패하고(파일은 그대로), 보기는 빈 목록', async () => {
    for (const [folder, run] of [['styles', () => styleDelete('없음')], ['templates', () => templateRemove('user:없음')]] as const) {
      const index = join(dir, folder, 'index.json');
      const aside = join(dir, folder, 'index.aside');
      mkdirSync(join(dir, folder), { recursive: true });
      writeFileSync(aside, '{"version":1}');
      mkdirSync(index);
      await expect(run(), folder).rejects.toThrow('읽을 수 없어');
      rmSync(index, { recursive: true });
      renameSync(aside, index);
      expect(await run(), folder).toBe(false);
      expect(readFileSync(index, 'utf-8')).toBe('{"version":1}');
    }
    const index = join(dir, 'styles', 'index.json');
    rmSync(index);
    mkdirSync(index);
    expect((await styleList()).styles).toEqual([]);
    rmSync(index, { recursive: true });
  });
});
