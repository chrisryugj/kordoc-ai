/** 설정 저장 — 동시에 여러 구획을 저장해도 하나도 사라지지 않는다 (차례로 저장) */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reload, updateSettings, getSettings } from '../src/infra/config.js';

const dir = mkdtempSync(join(tmpdir(), 'kordoc-config-'));
process.env.KORDOC_AI_DATA_DIR = dir;
reload();

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('updateSettings 동시 호출', () => {
  it('구획 셋을 한꺼번에 저장해도 모두 남는다 (메모리·파일)', async () => {
    await Promise.all([
      updateSettings({ org: { name: '가온시', dept: '총무과' } }),
      updateSettings({ convert: { output_dir: join(dir, '결과') } }),
      updateSettings({ law: { oc: 'gaon' } }),
      updateSettings({ privacy: { offline: true } }),
    ]);
    const s = getSettings();
    expect(s.org.name).toBe('가온시');
    expect(s.convert.output_dir).toBe(join(dir, '결과'));
    expect(s.law.oc).toBe('gaon');
    expect(s.privacy.offline).toBe(true);
    const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'));
    expect(saved).toMatchObject({ org: { name: '가온시', dept: '총무과' }, convert: { output_dir: join(dir, '결과') }, law: { oc: 'gaon' }, privacy: { offline: true } });
  });

  it('앞 저장이 실패해도 뒤 저장은 이어진다', async () => {
    const file = join(dir, 'settings.json');
    rmSync(file);
    mkdirSync(join(file, '막음'), { recursive: true }); // 파일 자리에 폴더: 바꿔 넣기가 실패한다
    const bad = updateSettings({ org: { name: '가온구' } });
    const after = bad.catch(() => 'failed').then((r) => { rmSync(file, { recursive: true, force: true }); return r; });
    const good = updateSettings({ law: { oc: 'gaon2' } });
    expect(await after).toBe('failed');
    await good;
    expect(getSettings().org.name).toBe('가온시'); // 실패한 저장은 반영하지 않는다
    expect(JSON.parse(readFileSync(file, 'utf-8')).law.oc).toBe('gaon2');
  });
});

describe('설정 파일 바꿔 넣기: Windows 잠깐 잠김(EPERM·EBUSY)은 다시 해 본다', () => {
  it('두 번 EPERM 뒤 성공하면 성공, 다른 오류는 바로 던진다', async () => {
    const { renameRetry } = await import('../src/infra/config.js');
    let n = 0;
    const flaky = async () => { n++; if (n < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' }); };
    await renameRetry('a', 'b', 6, flaky);
    expect(n).toBe(3);
    const bad = async () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); };
    await expect(renameRetry('a', 'b', 6, bad)).rejects.toThrow('nope');
    let m = 0;
    const always = async () => { m++; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
    await expect(renameRetry('a', 'b', 3, always)).rejects.toThrow('busy');
    expect(m).toBe(3);
  });
});
