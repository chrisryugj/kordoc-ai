/**
 * KorDoc Studio Phase C — 클릭-편집 세션 RPC 6종 E2E (mock 없음, 실제 kordoc).
 * 문서 열기 → capability → 패치 → undo/redo → 저장 → 종료 흐름 검증.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// progress가 stdout(JSON-RPC 채널)에 쓰는 것 방지
vi.mock('../src/infra/progress.js', () => ({ sendProgress: vi.fn(), sendNotification: vi.fn() }));
vi.mock('../src/infra/config.js', () => ({
  getConfig: () => ({ output_dir: '' }),
  getSettings: () => ({ gemini: {}, convert: {}, general: {} }),
  updateSettings: vi.fn(),
}));

import { markdownToHwpx } from 'kordoc';
import { editOpen, editPatch, editUndo, editRedo, editSave, editClose } from '../src/core/edit/index.js';

const SYNTH_MD = `# 사업 개요

본 사업은 2026년 주민 복지 향상을 위한 시범사업이다.

| 항목 | 담당자 | 비고 |
| --- | --- | --- |
| 예산 | 홍길동 | 1억원 |
| 기간 | 김철수 | 6개월 |

마지막 문단.`;

let tmpDir: string;
let formPath: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'kordoc-edit-'));
  const buf = await markdownToHwpx(SYNTH_MD);
  formPath = join(tmpDir, 'synthetic.hwpx');
  await writeFile(formPath, Buffer.from(buf));
});

describe('edit_open', () => {
  it('blocks + capabilities + doc_b64 노출, undo/redo 비활성', async () => {
    const r = await editOpen({ input_path: formPath });
    expect(r.success).toBe(true);
    expect(r.session_id).toBeTruthy();
    expect(r.blocks.length).toBeGreaterThanOrEqual(4);
    expect(r.capabilities.length).toBe(r.blocks.length);
    expect(r.can_undo).toBe(false);
    expect(r.can_redo).toBe(false);
    expect(r.doc_b64).toBeTruthy();

    const para = r.blocks.find((b) => b.text?.includes('주민 복지'))!;
    expect(r.capabilities[para.index].capability).toBe('text');

    const table = r.blocks.find((b) => b.type === 'table')!;
    expect(table.table?.rows).toBe(3);
    const tcap = r.capabilities[table.index];
    expect(tcap.capability).toBe('cell-text');
    expect(tcap.cells?.[1]?.[1]?.editable).toBe(true);

    await editClose({ session_id: r.session_id });
  });

  it('HWPX 아닌 파일 거부', async () => {
    const p = join(tmpDir, 'not-zip.hwpx');
    await writeFile(p, Buffer.from('이것은 ZIP이 아님'));
    await expect(editOpen({ input_path: p })).rejects.toThrow(/HWPX/);
  });
});

describe('edit_patch + undo/redo', () => {
  it('문단 수정 → undo로 원복 → redo로 재적용', async () => {
    const opened = await editOpen({ input_path: formPath });
    const sid = opened.session_id;
    const paraIdx = opened.blocks.find((b) => b.text?.includes('주민 복지'))!.index;

    // 패치
    const patched = await editPatch({
      session_id: sid,
      edits: [{ blockIndex: paraIdx, newText: '본 사업은 2027년 청년 지원을 위한 본사업이다.' }],
    });
    expect(patched.success).toBe(true);
    expect(patched.applied).toBe(1);
    expect(patched.can_undo).toBe(true);
    expect(patched.blocks.some((b) => b.text?.includes('청년 지원'))).toBe(true);
    expect(patched.blocks.some((b) => b.text?.includes('주민 복지'))).toBe(false);
    expect(patched.doc_b64).not.toBe(opened.doc_b64);

    // undo
    const undone = await editUndo({ session_id: sid });
    expect(undone.blocks.some((b) => b.text?.includes('주민 복지'))).toBe(true);
    expect(undone.can_undo).toBe(false);
    expect(undone.can_redo).toBe(true);
    expect(undone.doc_b64).toBe(opened.doc_b64); // 바이트 스냅샷 복원 = 원본과 동일

    // redo
    const redone = await editRedo({ session_id: sid });
    expect(redone.blocks.some((b) => b.text?.includes('청년 지원'))).toBe(true);
    expect(redone.can_undo).toBe(true);
    expect(redone.can_redo).toBe(false);

    await editClose({ session_id: sid });
  });

  it('표 셀 수정 + 새 패치가 redo 스택 비움', async () => {
    const opened = await editOpen({ input_path: formPath });
    const sid = opened.session_id;
    const tableIdx = opened.blocks.find((b) => b.type === 'table')!.index;
    const paraIdx = opened.blocks.find((b) => b.text?.includes('마지막 문단'))!.index;

    const r1 = await editPatch({
      session_id: sid,
      edits: [{ blockIndex: tableIdx, cells: [{ row: 1, col: 1, text: '이몽룡' }] }],
    });
    expect(r1.applied).toBe(1);
    const table = r1.blocks.find((b) => b.type === 'table')!;
    expect(table.table?.cells[1]?.[1]?.text).toBe('이몽룡');

    await editUndo({ session_id: sid });
    const r2 = await editPatch({
      session_id: sid,
      edits: [{ blockIndex: paraIdx, newText: '갱신된 마지막 문단.' }],
    });
    expect(r2.applied).toBe(1);
    expect(r2.can_redo).toBe(false); // 새 패치 후 redo 무효

    await editClose({ session_id: sid });
  });

  it('지원하지 않는 편집은 applied=0 + skipped 사유', async () => {
    const opened = await editOpen({ input_path: formPath });
    const sid = opened.session_id;
    const tableIdx = opened.blocks.find((b) => b.type === 'table')!.index;

    // 표 블록에 newText (cells 필요) → graceful skip
    const r = await editPatch({
      session_id: sid,
      edits: [{ blockIndex: tableIdx, newText: '표를 텍스트로' }],
    });
    expect(r.success).toBe(true);
    expect(r.applied).toBe(0);
    expect(r.skipped.length).toBe(1);
    expect(r.skipped[0].reason).toBeTruthy();
    expect(r.can_undo).toBe(false); // 무적용 패치는 undo 스냅샷 미기록

    await editClose({ session_id: sid });
  });
});

describe('edit_save + edit_close', () => {
  it('저장본 재열기 시 편집 반영 확인', async () => {
    const opened = await editOpen({ input_path: formPath });
    const sid = opened.session_id;
    const paraIdx = opened.blocks.find((b) => b.text?.includes('마지막 문단'))!.index;
    await editPatch({ session_id: sid, edits: [{ blockIndex: paraIdx, newText: '저장 테스트 문단.' }] });

    const outPath = join(tmpDir, 'saved', 'edited.hwpx');
    const saved = await editSave({ session_id: sid, output_path: outPath });
    expect(saved.success).toBe(true);
    expect((await readFile(outPath)).length).toBeGreaterThan(0);
    await editClose({ session_id: sid });

    const reopened = await editOpen({ input_path: outPath, include_doc: false });
    expect(reopened.blocks.some((b) => b.text?.includes('저장 테스트 문단'))).toBe(true);
    await editClose({ session_id: reopened.session_id });
  });

  it('종료/미존재 세션 접근 시 명확한 에러', async () => {
    const opened = await editOpen({ input_path: formPath, include_doc: false });
    await editClose({ session_id: opened.session_id });
    await expect(editPatch({ session_id: opened.session_id, edits: [{ blockIndex: 0, newText: 'x' }] }))
      .rejects.toThrow(/세션/);
    await expect(editUndo({ session_id: 'no-such-session' })).rejects.toThrow(/세션/);
  });
});

// 실문서 — kordoc 레포 픽스처가 로컬에 있으면 머리말/중첩표 잠금까지 확인
const REAL_HWPX = 'c:/github_project/kordoc/tests/fixtures/real/재활용센터현황.hwpx';

describe.skipIf(!existsSync(REAL_HWPX))('실문서 클릭-편집', () => {
  it('열기 + capability 분포 + 문단 패치 왕복', async () => {
    const opened = await editOpen({ input_path: REAL_HWPX });
    const sid = opened.session_id;
    expect(opened.blocks.length).toBeGreaterThan(0);

    const editable = opened.blocks.filter(
      (b) => (b.type === 'paragraph' || b.type === 'heading') && b.text?.trim()
        && opened.capabilities[b.index].capability === 'text',
    );
    expect(editable.length).toBeGreaterThan(0);

    // capability=text라도 PUA 글리프 등으로 패처가 graceful-skip할 수 있다 —
    // 편집 가능 문단 중 최소 하나는 깨끗하게 적용되는지 확인
    let target: (typeof editable)[number] | undefined;
    for (const cand of editable.slice(0, 5)) {
      const r = await editPatch({
        session_id: sid,
        edits: [{ blockIndex: cand.index, newText: `${cand.text} (수정)` }],
      });
      if (r.applied === 1) { target = cand; break; }
    }
    expect(target, '편집 가능 문단 중 적용 성공 0건').toBeTruthy();

    const undone = await editUndo({ session_id: sid });
    expect(undone.blocks[target!.index].text).toBe(target!.text);
    await editClose({ session_id: sid });
  });
});
