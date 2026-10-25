/** HWP 저장 보정 (core/hwp-save) — 합성 레코드로 보정 규칙, 실제 엔진으로 열기·저장, 코퍼스가 있으면 한컴 문서 왕복 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as CFB from 'cfb';
import init, { HwpDocument } from '@rhwp/core';
import { TAG, ctrlId, inlineControls, readHwp5, readRecords, writeHwp5, writeRecord, type Hwp5 } from '../src/core/hwp-save/hwp5.js';
import { fillTabWidths, hasZeroWidthTabs, restoreFieldKinds, restoreSectionTails, tailStart } from '../src/core/hwp-save/fixups.js';
import { EDITOR_REOPEN_NEEDED, editorOpen, editorWrite, fixHwp } from '../src/core/hwp-save/index.js';

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) });
});

const rec = (tag: number, level: number, data: Buffer | string = '') => writeRecord(tag, level, Buffer.isBuffer(data) ? data : Buffer.from(data));
/** 컨트롤 ID 4글자를 레코드·글자 바이트로 (거꾸로) */
const id = (s: string) => Buffer.from([...s].reverse().join(''), 'latin1');
/** 확장 컨트롤 글자 하나 (코드 + ID + 8바이트 + 코드 = 16바이트) */
const inlineCtrl = (code: number, idStr: string) => {
  const b = Buffer.alloc(16);
  b.writeUInt16LE(code, 0);
  id(idStr).copy(b, 2);
  b.writeUInt16LE(code, 14);
  return b;
};
const text = (s: string) => Buffer.from(s, 'utf16le');
const fake = (sections: Record<string, Buffer>): Hwp5 => ({ cfb: null as never, compressed: false, sections: new Map(Object.entries(sections)) });

describe('hwp5 레코드', () => {
  it('머리·큰 레코드를 그대로 읽고 쓴다', () => {
    const big = Buffer.alloc(5000, 7);
    const buf = Buffer.concat([rec(TAG.PARA_HEADER, 0, 'ab'), rec(TAG.PARA_TEXT, 1, big)]);
    const rs = readRecords(buf);
    expect(rs.map((r) => [r.tag, r.level, r.data.length])).toEqual([[66, 0, 2], [67, 1, 5000]]);
    expect(Buffer.concat(rs.map((r) => r.raw)).equals(buf)).toBe(true);
    expect(ctrlId(id('secd'))).toBe('secd');
  });

  it('다시 쓴 CFB 의 FAT·미니 FAT 남는 칸은 FREESECT (ENDOFCHAIN 이면 rhwp 재저장 때 스트림을 잃는다)', () => {
    const c = CFB.utils.cfb_new();
    const head = Buffer.alloc(256);
    CFB.utils.cfb_add(c, '/FileHeader', head);
    CFB.utils.cfb_add(c, '/PrvText', Buffer.from('미리보기', 'utf16le'));
    CFB.utils.cfb_add(c, '/BodyText/Section0', Buffer.concat([rec(TAG.PARA_HEADER, 0), rec(TAG.PARA_TEXT, 1, text('본문'))]));
    const h = readHwp5(new Uint8Array(CFB.write(c, { type: 'buffer' }) as Buffer));
    const bytes = Buffer.from(writeHwp5(h, new Map([['BodyText/Section0', Buffer.alloc(6000, 1)]])));
    const size = 2 ** bytes.readUInt16LE(30);
    const sectors = (bytes.length - size) / size;
    const fat = bytes.subarray(size * (bytes.readUInt32LE(76) + 1), size * (bytes.readUInt32LE(76) + 2));
    for (let i = sectors; i < size / 4; i++) expect(fat.readUInt32LE(i * 4)).toBe(0xffffffff);
    expect(readHwp5(bytes).sections.get('BodyText/Section0')!.length).toBe(6000);
  });

  it('문단 글의 확장 컨트롤 글자만 16바이트로 센다', () => {
    const t = Buffer.concat([text('가'), inlineCtrl(9, '\0\0\0\0'), text('나'), inlineCtrl(3, '%%me'), text('\r')]);
    expect(inlineControls(t).map((c) => [c.code, c.at])).toEqual([[9, 2], [3, 20]]);
  });
});

describe('보정 규칙', () => {
  const para = (level = 0, body = '본문') => [rec(TAG.PARA_HEADER, level), rec(TAG.PARA_TEXT, level + 1, text(body))];
  const memoTail = [rec(TAG.MEMO_LIST, 1, 'm'), rec(TAG.LIST_HEADER, 1, 'l'), ...para(1, '메모')];

  it('구역 끝 묶음: 원본에만 있으면 끝에 되붙이고, 엔진이 지켰으면 그대로', () => {
    const orig = fake({ 'BodyText/Section0': Buffer.concat([...para(), ...para(), ...memoTail]) });
    const lost = Buffer.concat([...para(), ...para()]);
    expect(tailStart(readRecords(orig.sections.get('BodyText/Section0')!))).toBe(4);
    const changed = new Map<string, Buffer>();
    expect(restoreSectionTails(orig, fake({ 'BodyText/Section0': lost }), changed)).toEqual({ restored: 1, lost: false });
    expect(changed.get('BodyText/Section0')!.equals(orig.sections.get('BodyText/Section0')!)).toBe(true);
    const kept = new Map<string, Buffer>();
    expect(restoreSectionTails(orig, orig, kept).restored).toBe(0);
    // 묶음 여럿 중 일부만 남았으면 원본 묶음 전체로 바꾼다
    const part = new Map<string, Buffer>();
    expect(restoreSectionTails(orig, fake({ 'BodyText/Section0': Buffer.concat([...para(), ...para(), memoTail[0]]) }), part).restored).toBe(1);
    expect(part.get('BodyText/Section0')!.equals(orig.sections.get('BodyText/Section0')!)).toBe(true);
    // 문단 자기 아래의 수준 1 레코드(글·글자 모양)는 묶음이 아니다
    expect(tailStart(readRecords(Buffer.concat(para())))).toBe(-1);
    // 구역이 사라졌으면 되붙이지 못했다고 알린다
    expect(restoreSectionTails(orig, fake({}), new Map()).lost).toBe(true);
  });

  it('필드 글자 종류: 컨트롤 레코드 내용이 같은 짝의 원본 글자 ID 로 되돌린다', () => {
    const header = Buffer.concat([id('%unk'), Buffer.from([1, 2, 3, 4, 5, 6])]);
    const section = (inlineId: string) => Buffer.concat([
      rec(TAG.PARA_HEADER, 0),
      rec(TAG.PARA_TEXT, 1, Buffer.concat([text('앞'), inlineCtrl(3, inlineId), text('뒤'), inlineCtrl(4, '\0\0\0\0'), text('\r')])),
      rec(TAG.CTRL_HEADER, 1, header),
    ]);
    const changed = new Map<string, Buffer>();
    expect(restoreFieldKinds(fake({ 'BodyText/Section0': section('%%me') }), fake({ 'BodyText/Section0': section('%unk') }), changed)).toBe(1);
    expect(changed.get('BodyText/Section0')!.equals(section('%%me'))).toBe(true);
    // 원본도 글자와 레코드가 같으면 할 일이 없다
    expect(restoreFieldKinds(fake({ 'BodyText/Section0': section('%unk') }), fake({ 'BodyText/Section0': section('%unk') }), new Map())).toBe(0);
  });

  it('새 탭 폭: 폭 0 탭이 든 문단은 탭 폭을 모두 다시 잰다(밀린 폭 포함), 새 탭 종류는 왼쪽 탭', () => {
    const stored = inlineCtrl(9, '\0\0\0\0');
    stored.writeUInt32LE(2500, 2); // 앞 탭에서 밀려 온 폭
    stored.writeUInt16LE(0x0100, 6);
    const t = Buffer.concat([text('A'), inlineCtrl(9, '\0\0\0\0'), text('B'), stored, text('C\r')]);
    const out = fake({ 'BodyText/Section0': Buffer.concat([rec(TAG.PARA_HEADER, 0), rec(TAG.PARA_TEXT, 1, t)]) });
    expect(hasZeroWidthTabs(out, new Map())).toBe(true);
    const changed = new Map<string, Buffer>();
    // 탭 글자 자리 1·3: 1 → 2 는 20px, 3 → 4 는 10px
    const x: Record<number, number> = { 1: 20, 2: 40, 3: 50, 4: 60 };
    expect(fillTabWidths(out, changed, (_s, _p, o) => ({ pageIndex: 0, y: 10, x: x[o] }), () => 'A\tB\tC')).toBe(2);
    const data = readRecords(changed.get('BodyText/Section0')!)[1].data;
    const tabs = inlineControls(data);
    expect(tabs.map((c) => data.readUInt32LE(c.at + 2))).toEqual([1500, 750]); // px × 75
    expect(tabs.map((c) => data.subarray(c.at + 6, c.at + 8).toString('hex'))).toEqual(['0001', '0001']);
    // 다음 줄로 넘어가는 탭은 재지 않는다
    expect(fillTabWidths(out, new Map(), (_s, _p, o) => ({ pageIndex: 0, y: o === 1 ? 10 : 30, x: 5 }), () => 'A\tB\tC')).toBe(0);
    // 엔진은 코드 포인트로 센다 (보조 평면 글자 뒤 탭)
    const t2 = Buffer.concat([text('A😀'), inlineCtrl(9, '\0\0\0\0'), text('B\r')]);
    const asked: number[] = [];
    fillTabWidths(fake({ 'BodyText/Section0': Buffer.concat([rec(TAG.PARA_HEADER, 0), rec(TAG.PARA_TEXT, 1, t2)]) }), new Map(), (_s, _p, o) => { asked.push(o); return { pageIndex: 0, y: 0, x: o * 10 }; }, () => 'A😀\tB');
    expect(asked).toEqual([2, 3]);
    // 폭 0 탭이 없으면 엔진을 열 필요가 없다
    expect(hasZeroWidthTabs(fake({ 'BodyText/Section0': Buffer.concat([rec(TAG.PARA_HEADER, 0), rec(TAG.PARA_TEXT, 1, Buffer.concat([text('A'), stored, text('\r')]))]) }), new Map())).toBe(false);
  });
});

describe('editor_open·editor_write (실제 엔진)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kordoc-hwp-save-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  function blankHwp(t: string): Uint8Array {
    const doc = HwpDocument.createEmpty();
    doc.createBlankDocument();
    doc.insertText(0, 0, 0, t);
    const b = doc.exportHwp();
    doc.free();
    return b;
  }

  it('처음 덮어쓸 때만 .bak, 형식이 다른 바이트·사라진 표는 거절', async () => {
    const path = join(dir, '공문.hwp');
    writeFileSync(path, blankHwp('원래'));
    const o = await editorOpen(path);
    expect(o.tracked).toBe(false);
    const w1 = await editorWrite({ path, data_b64: Buffer.from(blankHwp('고침 1')).toString('base64'), token: o.token, overwrite: true });
    expect(w1.backup_path).toBe(`${path}.bak`);
    const w2 = await editorWrite({ path, data_b64: Buffer.from(blankHwp('고침 2')).toString('base64'), token: o.token, overwrite: true });
    expect(w2.backup_path).toBeUndefined();
    await expect(editorWrite({ path, data_b64: Buffer.from('PK..').toString('base64'), token: o.token, overwrite: true })).rejects.toThrow(/HWP 형식이 아닌/);
    await expect(editorWrite({ path, data_b64: Buffer.from(blankHwp('x')).toString('base64'), token: 'gone', overwrite: true })).rejects.toThrow(EDITOR_REOPEN_NEEDED);
  });
});

// 코퍼스(kordoc bench, rhwp 저장소 샘플)가 있는 PC 에서만: 한컴 문서를 편집기처럼 고쳐 저장하면 손실이 메워진다
const CORPUS = process.env.KORDOC_CORPUS ?? join(homedir(), 'workspace', 'kordoc', 'bench', 'corpus');
const sample = (p: string) => join(CORPUS, p);
function edited(path: string): Uint8Array {
  const doc = new HwpDocument(new Uint8Array(readFileSync(path)));
  for (let s = 0; s < doc.getSectionCount(); s++) { doc.insertText(s, 0, 0, 'X'); doc.deleteText(s, 0, 0, 1); }
  const b = doc.exportHwp();
  doc.free();
  return b;
}
const count = (bytes: Uint8Array, tag: number) => [...readHwp5(bytes).sections.values()].reduce((n, b) => n + readRecords(b).filter((r) => r.tag === tag).length, 0);

describe.skipIf(!existsSync(sample('rhwp/basic/english.hwp')))('한컴 문서 왕복 (코퍼스)', () => {
  it('메모 목록과 메모 필드 종류가 돌아온다', async () => {
    const orig = readFileSync(sample('rhwp/basic/english.hwp'));
    const saved = edited(sample('rhwp/basic/english.hwp'));
    expect(count(saved, TAG.MEMO_LIST)).toBeLessThan(count(orig, TAG.MEMO_LIST));
    const fixed = (await fixHwp(saved, orig)).bytes;
    expect(count(fixed, TAG.MEMO_LIST)).toBe(count(orig, TAG.MEMO_LIST));
    const memoChars = (b: Uint8Array) => [...readHwp5(b).sections.values()].flatMap((s) => readRecords(s).filter((r) => r.tag === TAG.PARA_TEXT).flatMap((r) => inlineControls(r.data).filter((c) => c.code === 3).map((c) => ctrlId(r.data, c.at + 2)))).filter((x) => x === '%%me').length;
    expect(memoChars(fixed)).toBe(memoChars(orig));
    // 다시 열린다
    const again = new HwpDocument(fixed);
    expect(again.pageCount()).toBe(new HwpDocument(new Uint8Array(orig)).pageCount());
  });

  it.skipIf(!existsSync(sample('rhwp/exam_math_8.hwp')))('구역 끝 묶음(표·번호 개체)이 돌아온다', async () => {
    const orig = readFileSync(sample('rhwp/exam_math_8.hwp'));
    const fixed = (await fixHwp(edited(sample('rhwp/exam_math_8.hwp')), orig)).bytes;
    expect(count(fixed, TAG.LIST_HEADER)).toBe(count(orig, TAG.LIST_HEADER));
    expect(count(fixed, TAG.CTRL_HEADER)).toBe(count(orig, TAG.CTRL_HEADER));
    // 보정본을 다시 열어 저장해도 스트림(요약 정보·미리보기 등)이 남는다: FAT 의 남는 칸이 FREESECT 여야 한다
    const streams = (b: Uint8Array) => { const c = CFB.read(Buffer.from(b), { type: 'buffer' }); return c.FullPaths.filter((_p, i) => c.FileIndex[i].type === 2).length; };
    const resaved = new HwpDocument(fixed);
    const again = resaved.exportHwp();
    resaved.free();
    expect(streams(again)).toBe(streams(fixed));
  });

  it.skipIf(!existsSync(sample('rhwp/issue5169_viewtext_changetracking.hwp')))('변경 추적 문서는 알리기만 하고 보정하지 않는다 (.bak 은 남김)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kordoc-hwp-tracked-'));
    try {
      const path = join(dir, '추적.hwp');
      writeFileSync(path, readFileSync(sample('rhwp/issue5169_viewtext_changetracking.hwp')));
      const o = await editorOpen(path);
      expect(o.tracked).toBe(true);
      const saved = edited(path);
      const w = await editorWrite({ path, data_b64: Buffer.from(saved).toString('base64'), token: o.token, overwrite: true });
      expect(w.backup_path).toBe(`${path}.bak`);
      expect(Buffer.from(readFileSync(path)).equals(Buffer.from(saved))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(sample('rhwp/exam_science.hwp')))('바탕쪽 묶음이 일부만 빠져도 모두 돌아온다', async () => {
    const orig = readFileSync(sample('rhwp/exam_science.hwp'));
    const saved = edited(sample('rhwp/exam_science.hwp'));
    expect(count(saved, TAG.LIST_HEADER)).toBeLessThan(count(orig, TAG.LIST_HEADER));
    const fixed = (await fixHwp(saved, orig)).bytes;
    for (const tag of [TAG.PARA_HEADER, TAG.LIST_HEADER, TAG.CTRL_HEADER]) expect(count(fixed, tag)).toBe(count(orig, tag));
    // 쪽수는 엔진 저장본 그대로 (이 문서는 엔진 저장에서 이미 4쪽 → 5쪽)
    expect(new HwpDocument(fixed).pageCount()).toBe(new HwpDocument(saved).pageCount());
  });
});
