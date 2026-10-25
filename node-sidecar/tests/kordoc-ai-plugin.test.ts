/** 편집기 AI 플러그인 껍데기 (studio-plugin/kordoc-ai-plugin.mjs) — 고치기는 트랜잭션 하나, 거절은 { error }, 되돌리기는 남이 고친 게 없을 때만 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { HwpDocument } from '@rhwp/core';
import { aiPlugin } from '../studio-plugin/kordoc-ai-plugin.mjs';

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) });
});

/** 스튜디오 PluginHost 를 흉내 낸다: 트랜잭션마다 스냅샷 하나(실행 취소 한 단계), 던지면 되돌림 */
function fakeStudio(lines: string[]) {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  lines.forEach((t, i) => { if (i > 0) doc.splitParagraph(0, i - 1, doc.getParagraphLength(0, i - 1)); doc.insertText(0, i, 0, t); });
  const undo: number[] = [];
  const listeners: Array<() => void> = [];
  const commands = new Map<string, (s: unknown, p: unknown) => void>();
  const moved: unknown[] = [];
  const changed = () => listeners.forEach((f) => f());
  const host = {
    read: <T>(fn: (d: HwpDocument) => T) => fn(doc),
    transaction: <T>(_label: string, fn: (tx: { doc: () => HwpDocument; deferPagination: () => void }) => T) => {
      const snap = doc.saveSnapshot();
      try {
        const r = fn({ doc: () => doc, deferPagination: () => undefined });
        undo.push(snap);
        changed();
        return r;
      } catch (e) { doc.restoreSnapshot(snap); throw e; }
    },
    events: { on: (name: string, cb: () => void) => { if (name === 'document-changed') listeners.push(cb); return () => undefined; } },
    onDocumentSwap: () => () => undefined,
    automation: {
      registerCommand: (def: { id: string; execute: (s: unknown, p: unknown) => void }) => commands.set(def.id, def.execute),
      execute: (id: string, params?: unknown) => {
        if (id === 'edit:undo') { const s = undo.pop(); if (s !== undefined) doc.restoreSnapshot(s); changed(); return { ok: true }; }
        commands.get(id)?.({ getInputHandler: () => ({ moveCursorTo: (p: unknown) => moved.push(p) }) }, params);
        return { ok: true };
      },
    },
  };
  /** 사용자가 직접 고친 것 (플러그인 밖 변경) */
  const userEdit = () => { doc.insertText(0, 0, 0, '!'); changed(); };
  return { doc, surface: aiPlugin.activate(host as never) as Record<string, (...a: unknown[]) => unknown>, userEdit, moved };
}
const texts = (doc: HwpDocument) => Array.from({ length: doc.getParagraphCount(0) }, (_, i) => doc.getTextRange(0, i, 0, doc.getParagraphLength(0, i)));

describe('kordoc-ai plugin', () => {
  it('고치기·읽기를 연산으로 넘긴다', () => {
    const { doc, surface } = fakeStudio(['가', '나']);
    expect(surface.insertParagraphs({ after: '0.0', texts: ['가와 나 사이'] })).toEqual({ first: '0.1', count: 1 });
    expect(texts(doc)).toEqual(['가', '가와 나 사이', '나']);
    expect((surface.outline({}) as { total: number }).total).toBe(3);
  });

  it('거절은 던지지 않고 { error } 로, 문서는 그대로', () => {
    const { doc, surface } = fakeStudio(['가']);
    expect(surface.setParagraph({ id: '0.7', text: 'x' })).toMatchObject({ error: expect.stringContaining('없습니다') });
    expect(texts(doc)).toEqual(['가']);
  });

  it('되돌리기: 남이 고친 게 없을 때만, 요청이 한 변경 수만큼', () => {
    const { doc, surface, userEdit } = fakeStudio(['하나']);
    const since = surface.foreignChanges() as number;
    surface.replace({ find: '하나', replace: '둘' });
    surface.insertParagraphs({ after: '0.0', texts: ['셋'] });
    expect(surface.undo(2, since)).toEqual({ ok: true });
    expect(texts(doc)).toEqual(['하나']);
    const since2 = surface.foreignChanges() as number;
    surface.replace({ find: '하나', replace: '넷' });
    userEdit();
    expect(surface.undo(1, since2)).toMatchObject({ ok: false });
    expect(texts(doc)).toEqual(['!넷']);
  });

  it('바꾼 곳으로 커서를 옮긴다', () => {
    const { surface, moved } = fakeStudio(['가']);
    surface.reveal('0.0');
    expect(moved).toEqual([{ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }]);
  });
});
