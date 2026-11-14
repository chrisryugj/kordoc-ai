/** 설정 저장 — 동시에 여러 구획을 저장해도 하나도 사라지지 않는다 (차례로 저장) */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

describe('설정 파일을 못 읽는 동안', () => {
  it('저장하지 않는다 (앞서 읽은 값·기본값으로 파일을 덮지 않는다). 다시 읽히면 저장되고 앞의 값도 남는다', async () => {
    const { renameSync } = await import('node:fs');
    const file = join(dir, 'settings.json');
    const aside = join(dir, 'settings.aside');
    await updateSettings({ org: { name: '가온시' } });
    renameSync(file, aside);
    mkdirSync(file); // 파일 자리에 폴더: 읽기가 실패한다 (다른 프로그램이 쥔 것과 같은 길)
    reload();
    await expect(updateSettings({ law: { oc: 'lost' } })).rejects.toThrow('읽을 수 없어');
    rmSync(file, { recursive: true, force: true });
    renameSync(aside, file);
    await updateSettings({ law: { oc: 'gaon3' } });
    const saved = JSON.parse(readFileSync(file, 'utf-8'));
    expect(saved.org.name).toBe('가온시');
    expect(saved.law.oc).toBe('gaon3');
  });
});

describe('설정 파일 바꿔 넣기: Windows 잠깐 잠김(EPERM·EBUSY)은 다시 해 본다', () => {
  it('두 번 EPERM 뒤 성공하면 성공, 다른 오류는 바로 던진다', async () => {
    const { renameRetry } = await import('../src/infra/rename.js');
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

describe('reloadIfChanged — 다른 프로세스가 바꾼 설정', () => {
  it('내가 저장한 것은 다시 읽지 않고, 밖에서 바뀐 파일은 다시 읽는다', async () => {
    const { reloadIfChanged } = await import('../src/infra/config.js');
    const { utimesSync, writeFileSync } = await import('node:fs');
    const file = join(dir, 'settings.json');
    await updateSettings({ privacy: { offline: false }, org: { name: '가온시' } });
    expect(reloadIfChanged()).toBe(false);
    // 앱(다른 프로세스)이 폐쇄망 모드를 켰다
    const saved = JSON.parse(readFileSync(file, 'utf-8'));
    writeFileSync(file, JSON.stringify({ ...saved, privacy: { offline: true } }));
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(reloadIfChanged()).toBe(true);
    expect(getSettings().privacy.offline).toBe(true);
    expect(getSettings().org.name).toBe('가온시');
    expect(reloadIfChanged()).toBe(false);
  });
});

describe('설정 파일 앞머리의 BOM', () => {
  it('메모장·PowerShell 로 손본 파일(BOM 붙음)도 그대로 읽는다 (깨진 파일로 치우지 않는다)', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, String.fromCharCode(0xfeff) + JSON.stringify({ org: { name: '가온군' }, law: { oc: 'bom' } }));
    reload();
    expect(getSettings().org.name).toBe('가온군');
    expect(getSettings().law.oc).toBe('bom');
    expect(readdirSync(dir).filter((f) => f.includes('.broken-'))).toEqual([]);
  });
});
