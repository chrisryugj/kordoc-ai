/** 한글 편집기 복구 사본 — 경로마다 하나, 이 실행에서 쓴 것은 "꺼진 문서" 목록에서 빠지고, 되살리면 사본 바이트에 원본의 저장 보정 정보 */
import { readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import init, { HwpDocument } from '@rhwp/core';
import { tempDir } from './tmp-dirs.js';

const require = createRequire(import.meta.url);
let data = '';
let work = '';

beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) });
});

beforeEach(() => {
  data = tempDir('kordoc-recovery-data-');
  work = tempDir('kordoc-recovery-doc-');
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
    expect((await (await mod()).recoveryList()).entries).toEqual([]);
    vi.resetModules(); // 앱이 꺼졌다 다시 켜짐
    const [e] = (await (await mod()).recoveryList()).entries;
    expect(e).toMatchObject({ path, name: '공문.hwp', format: 'hwp', title: '공문', exists: true, size: Buffer.byteLength('고친 것') });
  });

  it('경로로 찾을 때 한글 이름의 조합 방식이 달라도 같은 파일', async () => {
    const nfc = join(work, '한글 문서.hwpx');
    await (await mod()).recoveryWrite({ path: nfc, data_b64: b64('a') });
    vi.resetModules();
    const r = await mod();
    expect((await r.recoveryList(nfc.normalize('NFD'))).entries.map((e) => e.path)).toEqual([nfc]);
    expect((await r.recoveryList(join(work, '다른 문서.hwpx'))).entries).toEqual([]);
    expect(r.recoveryBytes(nfc.normalize('NFD'))?.toString()).toBe('a');
  });

  it('14일은 처음 보여 준 때부터 센다: 2주 넘게 앱을 안 켰어도 한 번은 보이고, 보여 준 뒤 14일 지나면 지운다', async () => {
    const path = join(work, '옛.hwpx');
    await (await mod()).recoveryWrite({ path, data_b64: b64('a') });
    vi.resetModules();
    const r = await mod();
    const rec = join(data, 'recovery');
    const bin = readdirSync(rec).find((f) => f.endsWith('.bin'))!;
    const old = (Date.now() - 15 * 24 * 3600 * 1000) / 1000;
    utimesSync(join(rec, bin), old, old);
    expect((await r.recoveryList()).entries.map((e) => e.path)).toEqual([path]);
    expect((await r.recoveryList()).entries).toHaveLength(1);
    // 보여 준 지 15일
    const meta = join(rec, bin.replace(/\.bin$/, '.json'));
    const m = JSON.parse(readFileSync(meta, 'utf-8'));
    expect(typeof m.shown_at).toBe('number');
    writeFileSync(meta, JSON.stringify({ ...m, shown_at: m.shown_at - 15 * 24 * 3600 * 1000 }));
    expect((await r.recoveryList()).entries).toEqual([]);
    expect(readdirSync(rec)).toEqual([]);
  });

  it('쓰다 끊긴 임시 파일·메타 없이 남은 사본은 하루 지나면 치우고, 막 쓴 것은 둔다', async () => {
    const rec = join(data, 'recovery');
    await (await mod()).recoveryWrite({ path: join(work, '지금.hwpx'), data_b64: b64('a') });
    const old = (Date.now() - 2 * 24 * 3600 * 1000) / 1000;
    for (const f of ['aaaa.bin', 'bbbb.json.kordoc-tmp', '.kordoc-1-1.tmp', 'cccc.bin']) writeFileSync(join(rec, f), 'x');
    for (const f of ['aaaa.bin', 'bbbb.json.kordoc-tmp', '.kordoc-1-1.tmp']) utimesSync(join(rec, f), old, old);
    vi.resetModules();
    await (await mod()).recoveryList();
    expect(readdirSync(rec).filter((f) => !/^[0-9a-f]{24}\./.test(f))).toEqual(['cccc.bin']);
    expect(readdirSync(rec).filter((f) => /^[0-9a-f]{24}\./.test(f))).toHaveLength(2);
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
