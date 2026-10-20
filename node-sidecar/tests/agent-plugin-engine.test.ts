// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-engine.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
/**
 * The plugin against the real rhwp engine (the same WASM the editor runs), not a
 * stand-in: these fail when an engine call the plugin relies on changes its name,
 * its arguments or what it does. The editor's history is modelled by snapshots,
 * which is also how the editor records a plugin transaction.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const GUIDE = '이곳을 마우스로 누르고 내용을 입력하세요.'

/**
 * A small document built with the engine itself:
 *   제목 / 첫째 문단입니다. / 둘째 문단입니다. / [2×2 table: 구분 내용 대상 업체] / 끝 문단입니다.
 */
function openEditor(options: { fields?: boolean; endsWithTable?: boolean } = {}) {
  let doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  // the empty fourth paragraph is where the table goes
  const lines = ['제목', '첫째 문단입니다.', '둘째 문단입니다.', '']
  if (!options.endsWithTable) lines.push('끝 문단입니다.')
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  doc.pasteHtml(
    0,
    3,
    0,
    '<table><tr><td>구분</td><td>내용</td></tr><tr><td>대상</td><td>업체</td></tr></table>',
  )
  if (options.fields) {
    // two fields nobody named, each inside a line of a form: both carry the guide text as
    // their name. A third line ends in a field.
    const at = doc.getParagraphCount(0) - 1
    for (let n = 0; n < 2; n++) {
      doc.splitParagraph(0, at + n, doc.getParagraphLength(0, at + n))
      doc.insertText(0, at + n + 1, 0, n === 0 ? '성명:  (인)' : '소속:  (과)')
      doc.insertClickHereField(0, at + n + 1, 4, GUIDE, '', '', true)
    }
    doc.splitParagraph(0, at + 2, doc.getParagraphLength(0, at + 2))
    doc.insertText(0, at + 3, 0, '연락처: ')
    doc.insertClickHereField(0, at + 3, 5, GUIDE, '', '', true)
  }

  const history: Uint8Array[] = []
  const listeners: (() => void)[] = []
  const emit = () => listeners.forEach((listener) => listener())
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = doc.exportHwp()
      try {
        const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
        history.push(before)
        emit()
        return result
      } catch (thrown) {
        doc = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on: (_name: string, handler: () => void) => listeners.push(handler) },
    automation: {
      // the editor's undo; other commands (the plugin's own) do nothing here
      execute: (command: string) => {
        if (command !== 'edit:undo') return null
        const before = history.pop()
        if (!before) return { ok: false }
        doc = new HwpDocument(before)
        emit()
        return { ok: true }
      },
    },
  } as unknown as AgentPluginHost

  const plugin = agentPlugin.activate(host)
  return {
    plugin,
    /** the paragraphs of the document as the AI reads them, empty ones dropped */
    lines: () =>
      plugin
        .readText()
        .split(/\r?\n/)
        .filter((line) => line.length > 0),
    tables: () =>
      (JSON.parse(doc.getControls()) as { ctrlId: string }[]).filter((c) => c.ctrlId === 'tbl')
        .length,
    steps: () => history.length,
    /** the engine's document, for what the plugin does not report */
    doc: () => doc,
    /** character formatting at a place in a body paragraph */
    chars: (para: number, offset: number) =>
      JSON.parse(doc.getCharPropertiesAt(0, para, offset)) as Record<string, unknown>,
    /** character formatting at the start of a cell of the table (paragraph 3) */
    cellChars: (cell: number, offset = 0) =>
      JSON.parse(doc.getCellCharPropertiesAt(0, 3, 0, cell, 0, offset)) as Record<string, unknown>,
    alignment: (para: number) =>
      (JSON.parse(doc.getParaPropertiesAt(0, para)) as { alignment: string }).alignment,
    cellAlignment: (cell: number) =>
      (JSON.parse(doc.getCellParaPropertiesAt(0, 3, 0, cell, 0)) as { alignment: string })
        .alignment,
    /** what a save and a reopen leave of the text */
    reopened: () => {
      const again = new HwpDocument(doc.exportHwp())
      return (JSON.parse(again.getTextFileText()) as string).split(/\r?\n/).filter(Boolean)
    },
  }
}

const ORIGINAL = [
  '제목',
  '첫째 문단입니다.',
  '둘째 문단입니다.',
  '구분',
  '내용',
  '대상',
  '업체',
  '끝 문단입니다.',
]

describe('the document the tests work on', () => {
  it('reads as its paragraphs and table cells in order', () => {
    const editor = openEditor()
    expect(editor.lines()).toEqual(ORIGINAL)
    expect(editor.tables()).toBe(1)
  })
})

describe('replacing text in the real engine', () => {
  it('replaces in the body and in a table cell, with text longer than what it replaces', () => {
    const editor = openEditor()
    expect(editor.plugin.replaceText('첫째 문단', '첫 번째로 오는 긴 문단')).toMatchObject({
      ok: true,
      inTable: false,
    })
    expect(editor.plugin.replaceText('업체', '구매 대행 업체와 그 대리인')).toMatchObject({
      ok: true,
      inTable: true,
    })
    expect(editor.lines()).toEqual([
      '제목',
      '첫 번째로 오는 긴 문단입니다.',
      '둘째 문단입니다.',
      '구분',
      '내용',
      '대상',
      '구매 대행 업체와 그 대리인',
      '끝 문단입니다.',
    ])
  })

  it('replaces every occurrence and takes the run back', () => {
    const editor = openEditor()
    const before = editor.plugin.foreignChanges()
    expect(editor.plugin.replaceAllText('문단', '단락')).toMatchObject({ ok: true, count: 3 })
    expect(editor.lines().filter((line) => line.includes('단락'))).toHaveLength(3)
    expect(editor.plugin.undo(1, before)).toMatchObject({ ok: true, undone: 1 })
    expect(editor.lines()).toEqual(ORIGINAL)
  })
})

describe('adding paragraphs', () => {
  it('adds them after the paragraph the anchor is in, in order', () => {
    const editor = openEditor()
    expect(
      editor.plugin.insertParagraphs('첫째 문단', null, 'after', ['새 하나', '새 둘']),
    ).toMatchObject({ ok: true, count: 2, inTable: false })
    expect(editor.lines().slice(0, 5)).toEqual([
      '제목',
      '첫째 문단입니다.',
      '새 하나',
      '새 둘',
      '둘째 문단입니다.',
    ])
    expect(editor.steps()).toBe(1)
    expect(editor.reopened().slice(1, 4)).toEqual(['첫째 문단입니다.', '새 하나', '새 둘'])
  })

  it('adds them in front of the paragraph', () => {
    const editor = openEditor()
    editor.plugin.insertParagraphs('첫째 문단', null, 'before', ['앞 하나', '앞 둘'])
    expect(editor.lines().slice(0, 4)).toEqual(['제목', '앞 하나', '앞 둘', '첫째 문단입니다.'])
  })

  it('adds them inside a table cell', () => {
    const editor = openEditor()
    expect(editor.plugin.insertParagraphs('대상', null, 'after', ['담당 부서'])).toMatchObject({
      ok: true,
      count: 1,
      inTable: true,
    })
    expect(editor.lines().slice(3, 8)).toEqual(['구분', '내용', '대상', '담당 부서', '업체'])
    expect(editor.tables()).toBe(1)
  })

  it('adds them at the end of the document', () => {
    const editor = openEditor()
    editor.plugin.insertParagraphs('', null, 'end', ['붙임 1부.', '끝.'])
    expect(editor.lines().slice(-3)).toEqual(['끝 문단입니다.', '붙임 1부.', '끝.'])
  })

  it('adds them after a table that ends the document, and leaves the table whole', () => {
    // the last paragraph holds nothing but the table: splitting it would move the table
    const editor = openEditor({ endsWithTable: true })
    expect(editor.plugin.insertParagraphs('', null, 'end', ['붙임 1부.', '끝.'])).toMatchObject({
      ok: true,
      count: 2,
    })
    expect(editor.lines()).toEqual([
      '제목',
      '첫째 문단입니다.',
      '둘째 문단입니다.',
      '구분',
      '내용',
      '대상',
      '업체',
      '붙임 1부.',
      '끝.',
    ])
    expect(editor.tables()).toBe(1)
    expect(editor.reopened().slice(-3)).toEqual(['업체', '붙임 1부.', '끝.'])
  })

  it('keeps an empty string as an empty line', () => {
    const editor = openEditor()
    editor.plugin.insertParagraphs('첫째 문단', null, 'after', ['', '빈 줄 다음'])
    const text = editor.plugin.readText()
    expect(text).toMatch(/첫째 문단입니다\.\r?\n\r?\n빈 줄 다음\r?\n둘째/)
  })

  it('changes nothing when the anchor is ambiguous or missing', () => {
    const editor = openEditor()
    expect(editor.plugin.insertParagraphs('문단', null, 'after', ['x'])).toMatchObject({
      ok: false,
      reason: 'ambiguous',
      count: 3,
    })
    expect(editor.plugin.insertParagraphs('없는 말', null, 'after', ['x'])).toMatchObject({
      ok: false,
      reason: 'not_found',
    })
    expect(editor.lines()).toEqual(ORIGINAL)
    expect(editor.steps()).toBe(0)
  })

  it('is taken back as one step', () => {
    const editor = openEditor()
    const before = editor.plugin.foreignChanges()
    editor.plugin.insertParagraphs('둘째 문단', null, 'after', ['하나', '둘', '셋'])
    expect(editor.plugin.undo(1, before)).toMatchObject({ ok: true, undone: 1 })
    expect(editor.lines()).toEqual(ORIGINAL)
  })
})

describe('removing a paragraph', () => {
  it('removes it and leaves the ones around it', () => {
    const editor = openEditor()
    expect(editor.plugin.deleteParagraph('둘째 문단', null)).toMatchObject({
      ok: true,
      text: '둘째 문단입니다.',
      emptied: false,
      inTable: false,
    })
    expect(editor.lines()).toEqual(ORIGINAL.filter((line) => line !== '둘째 문단입니다.'))
    expect(editor.tables()).toBe(1)
  })

  it('empties the only paragraph of a table cell and keeps the table', () => {
    const editor = openEditor()
    expect(editor.plugin.deleteParagraph('업체', null)).toMatchObject({
      ok: true,
      emptied: true,
      inTable: true,
    })
    expect(editor.lines()).toEqual(ORIGINAL.filter((line) => line !== '업체'))
    expect(editor.tables()).toBe(1)
  })

  it('removes a paragraph added to a cell without touching the cell', () => {
    const editor = openEditor()
    editor.plugin.insertParagraphs('대상', null, 'after', ['지울 줄'])
    expect(editor.plugin.deleteParagraph('지울 줄', null)).toMatchObject({
      ok: true,
      emptied: false,
    })
    expect(editor.lines()).toEqual(ORIGINAL)
  })

  it('leaves a paragraph that holds a form field alone', () => {
    const editor = openEditor({ fields: true })
    editor.plugin.fillField(1, '홍길동')
    const lines = editor.lines()
    const steps = editor.steps()
    expect(editor.plugin.deleteParagraph('홍길동', null)).toMatchObject({
      ok: false,
      reason: 'has_objects',
    })
    expect(editor.lines()).toEqual(lines)
    expect(editor.plugin.listFields().map((field) => field.value)).toEqual(['홍길동', '', ''])
    expect(editor.steps()).toBe(steps)
  })
})

describe('adding a table', () => {
  it('adds a real table after the paragraph, padded to a rectangle', () => {
    const editor = openEditor()
    expect(
      editor.plugin.insertTable('첫째 문단', null, 'after', [
        ['항목', '기한', '비고'],
        ['신청서 <제출>', '3월 2일'],
      ]),
    ).toMatchObject({ ok: true, rows: 2, cols: 3, inTable: false })
    expect(editor.tables()).toBe(2)
    expect(editor.lines().slice(1, 8)).toEqual([
      '첫째 문단입니다.',
      '항목',
      '기한',
      '비고',
      '신청서 <제출>',
      '3월 2일',
      '둘째 문단입니다.',
    ])
    expect(editor.reopened()).toContain('신청서 <제출>')
  })

  it('gives the cells the font of the paragraph beside it and lines around them', () => {
    const editor = openEditor()
    // the second paragraph in 16pt: the table put after it should not come out in 10pt
    editor
      .doc()
      .applyCharFormat(0, 1, 0, editor.doc().getParagraphLength(0, 1), '{"fontSize":1600}')
    editor.plugin.insertTable('첫째 문단', null, 'after', [['항목', '기한']])
    const cell = JSON.parse(editor.doc().getCellCharPropertiesAt(0, 2, 0, 1, 0, 0))
    expect(cell.fontSize).toBe(1600)
    const props = JSON.parse(editor.doc().getCellProperties(0, 2, 0, 0))
    expect(JSON.stringify(props)).toMatch(/border/i)
    // a row high enough for one line of that size (16pt × 1.6 + margins), in 1/100 pt
    expect(props.height).toBeGreaterThan(2500)
  })

  it('is taken back as one step', () => {
    const editor = openEditor()
    const before = editor.plugin.foreignChanges()
    editor.plugin.insertTable('', null, 'end', [['가', '나']])
    expect(editor.tables()).toBe(2)
    editor.plugin.undo(1, before)
    expect(editor.tables()).toBe(1)
    expect(editor.lines()).toEqual(ORIGINAL)
  })

  it('does not make a table inside the cell of another table', () => {
    const editor = openEditor()
    expect(editor.plugin.insertTable('대상', null, 'after', [['가', '나']])).toEqual({
      ok: false,
      reason: 'in_table',
      count: 1,
    })
    expect(editor.tables()).toBe(1)
    expect(editor.lines()).toEqual(ORIGINAL)
    expect(editor.steps()).toBe(0)
  })

  it('refuses rows that are not one-line text', () => {
    const editor = openEditor()
    expect(() => editor.plugin.insertTable('제목', null, 'after', [['가\n나']])).toThrow(/rows/)
    expect(() => editor.plugin.insertTable('제목', null, 'after', [])).toThrow(/rows/)
  })
})

describe('formatting text', () => {
  it('changes only the text asked for, and only what was asked', () => {
    const editor = openEditor()
    const size = editor.chars(1, 0).fontSize
    // "첫째 문단입니다." — the word 문단 is characters 3 and 4
    expect(
      editor.plugin.formatText('문단', 1, false, { bold: true, color: '#C00000', size: 14 }),
    ).toMatchObject({ ok: true, count: 1 })
    expect(editor.chars(1, 3)).toMatchObject({
      bold: true,
      textColor: '#c00000',
      fontSize: 1400,
      italic: false,
    })
    // in front of it, behind it, and the next occurrence of the word
    expect(editor.chars(1, 1)).toMatchObject({ bold: false, textColor: '#000000', fontSize: size })
    expect(editor.chars(1, 6)).toMatchObject({ bold: false, fontSize: size })
    expect(editor.chars(2, 3)).toMatchObject({ bold: false })
    expect(editor.lines()).toEqual(ORIGINAL)
    expect(editor.steps()).toBe(1)
  })

  it('formats every occurrence at once, table cells included', () => {
    const editor = openEditor()
    editor.plugin.replaceText('업체', '문단 업체')
    expect(editor.plugin.formatText('문단', null, true, { underline: true })).toMatchObject({
      ok: true,
      count: 4,
    })
    expect(editor.chars(1, 3).underline).toBe(true)
    expect(editor.chars(2, 3).underline).toBe(true)
    expect(editor.chars(4, 2).underline).toBe(true)
    expect(editor.cellChars(3, 0).underline).toBe(true)
    // the rest of that cell is as it was
    expect(editor.cellChars(3, 3).underline).toBe(false)
    expect(editor.steps()).toBe(2)
  })

  it('takes formatting away again, and sets and clears a highlight', () => {
    const editor = openEditor()
    editor.plugin.formatText('제목', null, false, { bold: true, highlight: '#FFFF00' })
    expect(editor.chars(0, 0)).toMatchObject({ bold: true, shadeColor: '#ffff00' })
    editor.plugin.formatText('제목', null, false, { bold: false, highlight: 'none' })
    expect(editor.chars(0, 0)).toMatchObject({ bold: false, shadeColor: '#ffffff' })
  })

  it('survives a save and a reopen', () => {
    const editor = openEditor()
    editor.plugin.formatText('제목', null, false, { bold: true, size: 20 })
    const again = new HwpDocument(editor.doc().exportHwp())
    expect(JSON.parse(again.getCharPropertiesAt(0, 0, 0))).toMatchObject({
      bold: true,
      fontSize: 2000,
    })
    const hwpx = new HwpDocument(editor.doc().exportHwpx())
    expect(JSON.parse(hwpx.getCharPropertiesAt(0, 0, 0))).toMatchObject({ bold: true })
  })

  it('changes nothing when the text is ambiguous or missing', () => {
    const editor = openEditor()
    expect(editor.plugin.formatText('문단', null, false, { bold: true })).toMatchObject({
      ok: false,
      reason: 'ambiguous',
      count: 3,
    })
    expect(editor.plugin.formatText('없는 말', null, true, { bold: true })).toMatchObject({
      ok: false,
      reason: 'not_found',
    })
    expect(editor.chars(1, 3).bold).toBe(false)
    expect(editor.steps()).toBe(0)
  })

  it('refuses a request it cannot read as a format', () => {
    const editor = openEditor()
    const format = (value: object) => () =>
      editor.plugin.formatText('제목', null, false, value as never)
    expect(format({})).toThrow(/nothing to change/)
    expect(format({ color: 'red' })).toThrow(/#RRGGBB/)
    expect(format({ size: 900 })).toThrow(/size/)
    expect(format({ bold: 'yes' })).toThrow(/true or false/)
    // alignment is a property of a paragraph, not of a piece of text
    expect(format({ align: 'center' })).toThrow(/whole paragraph/)
    expect(editor.steps()).toBe(0)
  })

  it('is taken back as one step', () => {
    const editor = openEditor()
    const before = editor.plugin.foreignChanges()
    editor.plugin.formatText('문단', null, true, { bold: true })
    expect(editor.plugin.undo(1, before)).toMatchObject({ ok: true, undone: 1 })
    expect(editor.chars(1, 3).bold).toBe(false)
  })
})

describe('formatting a paragraph', () => {
  it('aligns the paragraph the text is in and leaves the others', () => {
    const editor = openEditor()
    const other = editor.alignment(1)
    expect(editor.plugin.formatParagraph('제목', null, { align: 'center' })).toMatchObject({
      ok: true,
      inTable: false,
    })
    expect(editor.alignment(0)).toBe('center')
    expect(editor.alignment(1)).toBe(other)
    expect(editor.lines()).toEqual(ORIGINAL)
  })

  it('formats all the text of the paragraph together with the paragraph', () => {
    const editor = openEditor()
    editor.plugin.formatParagraph('첫째', null, { align: 'right', bold: true, lineSpacing: 200 })
    expect(editor.alignment(1)).toBe('right')
    expect(editor.chars(1, 0).bold).toBe(true)
    expect(editor.chars(1, 8).bold).toBe(true)
    expect(editor.chars(2, 0).bold).toBe(false)
    expect(JSON.parse(editor.doc().getParaPropertiesAt(0, 1))).toMatchObject({
      lineSpacing: 200,
      lineSpacingType: 'Percent',
    })
    // one request, one step to take back
    expect(editor.steps()).toBe(1)
  })

  it('works on a paragraph inside a table cell', () => {
    const editor = openEditor()
    expect(
      editor.plugin.formatParagraph('대상', null, { align: 'center', bold: true }),
    ).toMatchObject({
      ok: true,
      inTable: true,
    })
    expect(editor.cellAlignment(2)).toBe('center')
    expect(editor.cellChars(2).bold).toBe(true)
    expect(editor.cellAlignment(3)).not.toBe('center')
    expect(editor.cellChars(3).bold).toBe(false)
  })

  it('refuses values outside what a document can hold', () => {
    const editor = openEditor()
    const format = (value: object) => () =>
      editor.plugin.formatParagraph('제목', null, value as never)
    expect(format({ align: 'middle' })).toThrow(/align/)
    expect(format({ lineSpacing: 5 })).toThrow(/lineSpacing/)
    expect(editor.steps()).toBe(0)
  })
})

describe('a table with a header row', () => {
  it('makes the first row bold, centred and a title row, and leaves the others plain', () => {
    const editor = openEditor()
    editor.plugin.insertTable(
      '첫째 문단',
      null,
      'after',
      [
        ['항목', '기한'],
        ['신청서', '3월 2일'],
      ],
      true,
    )
    const doc = editor.doc()
    const chars = (cell: number) => JSON.parse(doc.getCellCharPropertiesAt(0, 2, 0, cell, 0, 0))
    const align = (cell: number) => JSON.parse(doc.getCellParaPropertiesAt(0, 2, 0, cell, 0))
    const props = (cell: number) => JSON.parse(doc.getCellProperties(0, 2, 0, cell))
    expect(chars(0).bold).toBe(true)
    expect(chars(1).bold).toBe(true)
    expect(align(0).alignment).toBe('center')
    expect(props(0).isHeader).toBe(true)
    expect(chars(2).bold).toBe(false)
    expect(align(2).alignment).not.toBe('center')
    expect(props(2).isHeader).toBe(false)
    expect(editor.lines().slice(2, 6)).toEqual(['항목', '기한', '신청서', '3월 2일'])
  })

  it('is plain without the option', () => {
    const editor = openEditor()
    editor.plugin.insertTable('첫째 문단', null, 'after', [['항목', '기한']])
    expect(JSON.parse(editor.doc().getCellCharPropertiesAt(0, 2, 0, 0, 0, 0)).bold).toBe(false)
  })
})

describe('form fields in the real engine', () => {
  it('fills the one asked for among fields that share a name', () => {
    const editor = openEditor({ fields: true })
    const fields = editor.plugin.listFields()
    expect(fields.map((field) => field.name)).toEqual([GUIDE, GUIDE, GUIDE])
    expect(editor.plugin.fillField(2, '둘째 칸')).toMatchObject({ ok: true })
    expect(editor.plugin.listFields().map((field) => field.value)).toEqual(['', '둘째 칸', ''])
    // an empty field reads as its guide text: that is what the AI sees in its place
    expect(editor.lines().slice(-3)).toEqual([
      `성명: ${GUIDE} (인)`,
      '소속: 둘째 칸 (과)',
      `연락처: ${GUIDE}`,
    ])
  })

  it('adds a paragraph after a line that ends in a field without landing inside the field', () => {
    // split at its end, the engine would carry the field into the new paragraph and the
    // new text would become the field's value; the paragraph is added behind it instead
    const editor = openEditor({ fields: true })
    expect(editor.plugin.insertParagraphs('연락처', null, 'after', ['비고'])).toMatchObject({
      ok: true,
    })
    expect(editor.lines().slice(-2)).toEqual([`연락처: ${GUIDE}`, '비고'])
    expect(editor.plugin.listFields().map((field) => field.value)).toEqual(['', '', ''])
    // a line whose field is in the middle is split like any other
    expect(editor.plugin.insertParagraphs('소속', null, 'after', ['참고'])).toMatchObject({
      ok: true,
    })
    expect(editor.plugin.listFields().map((field) => field.value)).toEqual(['', '', ''])
    expect(editor.lines().slice(-4, -2)).toEqual([`소속: ${GUIDE} (과)`, '참고'])
  })

  it('rolls the whole change back when it would cost a field its value', () => {
    // in front of a paragraph is done by splitting at its start; where the paragraph has a
    // field the plugin does not try
    const editor = openEditor({ fields: true })
    editor.plugin.fillField(1, '홍길동')
    const lines = editor.lines()
    const steps = editor.steps()
    expect(editor.plugin.insertParagraphs('홍길동', null, 'before', ['x'])).toMatchObject({
      ok: false,
      reason: 'has_objects',
    })
    expect(editor.lines()).toEqual(lines)
    expect(editor.steps()).toBe(steps)
  })
})
