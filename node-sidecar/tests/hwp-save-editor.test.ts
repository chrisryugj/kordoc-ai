/** 편집기 열기·저장(editor_open·editor_write) — 변경 추적 문서는 지금 내용으로, 처음 덮어쓸 때만 .bak, 형식이 다른 바이트는 거절 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as CFB from 'cfb';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { HwpDocument } from '@rhwp/core';
import { editorOpen, editorWrite } from '../src/core/hwp-save/index.js';

const require = createRequire(import.meta.url);

beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) });
});

function hwp(text: string): Uint8Array {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  doc.insertText(0, 0, 0, text);
  const bytes = doc.exportHwp();
  doc.free();
  return bytes;
}

/** 한글이 쓰는 변경 추적 문서처럼: 머리 속성 14번 비트 + 지운 글까지 든 두 번째 본문 */
function tracked(text: string, viewText: string): Uint8Array {
  const cfb = CFB.read(Buffer.from(hwp(text)), { type: 'buffer' });
  const header = Buffer.from(CFB.find(cfb, '/FileHeader')!.content as Uint8Array);
  header.writeUInt32LE(header.readUInt32LE(36) | 0x4000, 36);
  CFB.utils.cfb_add(cfb, '/FileHeader', header);
  const view = CFB.read(Buffer.from(hwp(viewText)), { type: 'buffer' });
  CFB.utils.cfb_add(cfb, '/ViewText/Section0', Buffer.from(CFB.find(view, '/BodyText/Section0')!.content as Uint8Array));
  return new Uint8Array(CFB.write(cfb, { type: 'buffer' }) as Buffer);
}

const firstPara = (bytes: Uint8Array) => {
  const doc = new HwpDocument(bytes);
  const n = doc.getParagraphLength(0, 0);
  const t = doc.getTextRange(0, 0, 0, n);
  doc.free();
  return t;
};

describe('editor_open', () => {
  it('변경 추적 문서는 지운 글 사본 없이 지금 내용으로 준다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-hwpsave-'));
    const path = join(dir, '추적.hwp');
    writeFileSync(path, tracked('지금 내용', '지운 글까지 든 사본'));
    expect(firstPara(readFileSync(path))).toBe('지운 글까지 든 사본'); // 엔진은 그대로 주면 사본을 읽는다
    const r = await editorOpen(path);
    expect(r.tracking_dropped).toBe(true);
    expect(r.save_blocked).toBeUndefined();
    expect(firstPara(Buffer.from(r.data_b64, 'base64'))).toBe('지금 내용');
  });

  it('보통 문서는 바이트 그대로', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-hwpsave-'));
    const path = join(dir, '보통.hwp');
    writeFileSync(path, hwp('본문'));
    const r = await editorOpen(path);
    expect(r.tracking_dropped).toBe(false);
    expect(Buffer.from(r.data_b64, 'base64').equals(readFileSync(path))).toBe(true);
  });
});

describe('editor_write', () => {
  it('처음 덮어쓸 때만 .bak 을 남긴다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-hwpsave-'));
    const path = join(dir, '문서.hwp');
    const original = hwp('원본');
    writeFileSync(path, original);
    const { token } = await editorOpen(path);
    const first = await editorWrite({ path, data_b64: Buffer.from(hwp('한 번')).toString('base64'), token, overwrite: true });
    expect(first.backup_path).toBe(`${path}.bak`);
    expect(Buffer.from(readFileSync(`${path}.bak`)).equals(Buffer.from(original))).toBe(true);
    const second = await editorWrite({ path, data_b64: Buffer.from(hwp('두 번')).toString('base64'), token, overwrite: true });
    expect(second.backup_path).toBeUndefined();
    expect(Buffer.from(readFileSync(`${path}.bak`)).equals(Buffer.from(original))).toBe(true);
    expect(firstPara(readFileSync(path))).toBe('두 번');
  });

  it('새 파일에는 .bak 이 없다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-hwpsave-'));
    const src = join(dir, '원본.hwp');
    writeFileSync(src, hwp('원본'));
    const { token } = await editorOpen(src);
    const target = join(dir, '새 이름.hwp');
    const r = await editorWrite({ path: target, data_b64: Buffer.from(hwp('새')).toString('base64'), token, overwrite: true });
    expect(r.backup_path).toBeUndefined();
    expect(existsSync(`${target}.bak`)).toBe(false);
  });

  it('엔진이 다시 켜져 모르는 표(token)면 HWP 를 덮지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-hwpsave-'));
    const path = join(dir, '문서.hwp');
    writeFileSync(path, hwp('원본'));
    await expect(editorWrite({ path, data_b64: Buffer.from(hwp('고침')).toString('base64'), token: 'gone', overwrite: true })).rejects.toThrow(/다시 시작/);
    expect(firstPara(readFileSync(path))).toBe('원본');
  });

  it('이미 있는 .bak 은 다시 열어 저장해도 덮지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-hwpsave-'));
    const path = join(dir, '문서.hwp');
    writeFileSync(path, hwp('처음'));
    const a = await editorOpen(path);
    await editorWrite({ path, data_b64: Buffer.from(hwp('한 번')).toString('base64'), token: a.token, overwrite: true });
    const b = await editorOpen(path);
    const r = await editorWrite({ path, data_b64: Buffer.from(hwp('두 번')).toString('base64'), token: b.token, overwrite: true });
    expect(r.backup_path).toBeUndefined();
    expect(firstPara(readFileSync(`${path}.bak`))).toBe('처음');
  });

  it('확장자와 다른 형식의 바이트는 쓰지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-hwpsave-'));
    const path = join(dir, '문서.hwpx');
    await expect(editorWrite({ path, data_b64: Buffer.from(hwp('HWP 바이트')).toString('base64'), overwrite: true })).rejects.toThrow(/HWPX 형식이 아닌/);
    expect(existsSync(path)).toBe(false);
  });
});
