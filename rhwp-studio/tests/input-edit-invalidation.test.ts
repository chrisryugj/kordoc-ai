import test from 'node:test';
import assert from 'node:assert/strict';

import { isPageLocalTextEditCommand } from '../src/engine/input-edit-invalidation.ts';
import type { DocumentPosition } from '../src/core/types.ts';

const baseCellPos: DocumentPosition = {
  sectionIndex: 0,
  paragraphIndex: 2,
  charOffset: 3,
  parentParaIndex: 2,
  controlIndex: 0,
  cellIndex: 1,
  cellParaIndex: 0,
  cellPath: [{ controlIndex: 0, cellIndex: 1, cellParaIndex: 0 }],
};

test('isPageLocalTextEditCommand는 같은 셀 내부 insert/delete만 허용한다', () => {
  assert.equal(
    isPageLocalTextEditCommand('insertText', baseCellPos, { ...baseCellPos, charOffset: 4 }),
    true,
  );
  assert.equal(
    isPageLocalTextEditCommand('deleteText', baseCellPos, baseCellPos),
    true,
  );
});

test('isPageLocalTextEditCommand는 본문 텍스트와 구조 변경 명령을 full refresh로 남긴다', () => {
  const bodyPos: DocumentPosition = {
    sectionIndex: 0,
    paragraphIndex: 2,
    charOffset: 3,
  };

  assert.equal(isPageLocalTextEditCommand('insertText', bodyPos, { ...bodyPos, charOffset: 4 }), false);
  assert.equal(isPageLocalTextEditCommand('splitParagraphInCell', baseCellPos, baseCellPos), false);
  assert.equal(isPageLocalTextEditCommand('deleteSelection', baseCellPos, baseCellPos), false);
});

test('isPageLocalTextEditCommand는 셀 경로가 바뀌면 full refresh를 요구한다', () => {
  assert.equal(
    isPageLocalTextEditCommand('insertText', baseCellPos, {
      ...baseCellPos,
      cellPath: [{ controlIndex: 0, cellIndex: 2, cellParaIndex: 0 }],
      charOffset: 4,
    }),
    false,
  );
  assert.equal(
    isPageLocalTextEditCommand('insertText', baseCellPos, { ...baseCellPos, cellParaIndex: 1, charOffset: 4 }),
    false,
  );
});
