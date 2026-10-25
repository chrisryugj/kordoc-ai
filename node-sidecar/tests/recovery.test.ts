/** 한글 편집기 복구 사본 — 경로마다 하나, 이 실행에서 쓴 것은 "꺼진 문서" 목록에서 빠지고, 되살리면 사본 바이트에 원본의 저장 보정 정보 */
import { mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import init, { HwpDocument } from '@rhwp/core';

const require = createRequire(import.meta.url);
let data = '';
let work = '';

beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) });
});

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'kordoc-recovery-data-'));
  work = mkdtempSync(join(tmpdir(), 'kordoc-recovery-doc-'));
  process.env.KORDOC_AI_DATA_DIR = data;
  vi.resetModules(); // 이 실행에서 쓴 사본 표(live)를 새로
});

const mod = () => import('../src/core/recovery/index.js');
const b64 = (s: string) => Buffer.from(s).toString('base64');

function hwp(text: string): Uint8Array {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  doc.insertText(0, 0, 0, text);
  const bytes = doc.exportHwp();
  doc.free();
  return bytes;
}

describe('recovery', () => {
  it('경로마다 사본 하나를 덮어 쓰고, 지우면 사라진다', async () => {
    const r = await mod();
    const path = join(work, '보고서.hwpx');
    await r.recoveryWrite({ path, data_b64: b64('하나') });
    await r.recoveryWrite({ path, data_b64: b64('둘'), title: '보고서' });
    expect(readdirSync(join(data, 'recovery')).sort().map((f) => f.split('.')[1])).toEqual(['bin', 'json']);
    expect(r.recoveryBytes(path)?.toString()).toBe('둘');
    expect(r.recoveryDiscard(path)).toBe(true);
    expect(r.recoveryBytes(path)).toBeNull();
    expect(r.recoveryDiscard(path)).toBe(false);
  });

  it('이 실행에서 쓴 사본은 목록에 없고, 다음 실행에선 보인다', async () => {
    const path = join(work, '공문.hwp');
    writeFileSync(path, 'x');
    await (await mod()).recoveryWrite({ path, data_b64: b64('고친 것'), title: '공문' });
    expect((await mod()).recoveryList().entries).toEqual([]);
    vi.resetModules(); // 앱이 꺼졌다 다시 켜짐
    const [e] = (await mod()).recoveryList().entries;
    expect(e).toMatchObject({ path, name: '공문.hwp', format: 'hwp', title: '공문', exists: true, size: Buffer.byteLength('고친 것') });
  });

  it('경로로 찾을 때 한글 이름의 조합 방식이 달라도 같은 파일', async () => {
    const nfc = join(work, '한글 문서.hwpx');
    await (await mod()).recoveryWrite({ path: nfc, data_b64: b64('a') });
    vi.resetModules();
    const r = await mod();
    expect(r.recoveryList(nfc.normalize('NFD')).entries.map((e) => e.path)).toEqual([nfc]);
    expect(r.recoveryList(join(work, '다른 문서.hwpx')).entries).toEqual([]);
    expect(r.recoveryBytes(nfc.normalize('NFD'))?.toString()).toBe('a');
  });

  it('14일 지난 사본은 목록을 볼 때 지운다', async () => {
    const path = join(work, '옛.hwpx');
    await (await mod()).recoveryWrite({ path, data_b64: b64('a') });
    vi.resetModules();
    const r = await mod();
    const bin = readdirSync(join(data, 'recovery')).find((f) => f.endsWith('.bin'))!;
    const old = (Date.now() - 15 * 24 * 3600 * 1000) / 1000;
    utimesSync(join(data, 'recovery', bin), old, old);
    expect(r.recoveryList().entries).toEqual([]);
    expect(readdirSync(join(data, 'recovery'))).toEqual([]);
  });

  it('되살리기는 사본 바이트를 열고, 저장은 원본의 보정 정보로 한다', async () => {
    const path = join(work, '원본.hwp');
    writeFileSync(path, hwp('원래 글'));
    await (await mod()).recoveryWrite({ path, data_b64: Buffer.from(hwp('고친 글')).toString('base64') });
    const { editorOpen, editorWrite, RECOVERY_GONE } = await import('../src/core/hwp-save/index.js');
    const opened = await editorOpen(path, true);
    const doc = new HwpDocument(new Uint8Array(Buffer.from(opened.data_b64, 'base64')));
    expect(doc.getTextRange(0, 0, 0, 100)).toContain('고친 글');
    doc.free();
    // 원본에서 읽은 표(token)가 있으니 HWP 저장 보정이 걸리고, 처음 덮어쓰면 .bak 이 남는다
    const w = await editorWrite({ path, data_b64: opened.data_b64, token: opened.token, overwrite: true });
    expect(w.backup_path).toBe(`${path}.bak`);
    (await mod()).recoveryDiscard(path);
    await expect(editorOpen(path, true)).rejects.toThrow(RECOVERY_GONE);
  });

  it('원본이 사라졌어도 사본으로 연다', async () => {
    const path = join(work, '지운 파일.hwpx');
    await (await mod()).recoveryWrite({ path, data_b64: b64('PK사본') });
    const { editorOpen } = await import('../src/core/hwp-save/index.js');
    const opened = await editorOpen(path, true);
    expect(Buffer.from(opened.data_b64, 'base64').toString()).toBe('PK사본');
    expect(opened.name).toBe('지운 파일.hwpx');
  });
});
