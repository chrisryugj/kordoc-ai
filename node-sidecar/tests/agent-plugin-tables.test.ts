// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-tables.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
/**
 * The plugin's table tools against the real rhwp engine: listing the tables of a
 * document, reading one cell by cell, and filling cells of a form. The editor's
 * history is modelled by snapshots, as in agent-plugin-engine.test.ts.
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

const FORM =
  '<table>' +
  '<tr><td>성명</td><td></td><td>소속</td><td></td></tr>' +
  '<tr><td>연락처</td><td></td><td>비고</td><td>기존 내용</td></tr>' +
  '<tr><td>활동</td><td></td><td></td><td></td></tr>' +
  '</table>'

/** The table sits in body paragraph 1; its cells count row by row from 0. */
const cellPath = (cell: number) =>
  JSON.stringify([{ controlIndex: 0, cellIndex: cell, cellParaIndex: 0 }])

/**
 * A form built with the engine itself:
 *   신청서 / [3×4 table] / 끝.
 * The last three cells of the third row are one merged cell.
 */
/** A place as the editor's caret names it. */
interface Position {
  sectionIndex: number
  paragraphIndex: number
  charOffset: number
  parentParaIndex?: number
  controlIndex?: number
  cellIndex?: number
  cellParaIndex?: number
  isTextBox?: boolean
}

interface Command {
  id: string
  execute(services: unknown, params?: unknown): void
}

/** a place in the body, and a place in a cell of the form's table */
const inBody = (para: number, offset: number): Position => ({
  sectionIndex: 0,
  paragraphIndex: para,
  charOffset: offset,
})
const inCell = (cell: number, offset: number, cellPara = 0): Position => ({
  sectionIndex: 0,
  paragraphIndex: 1,
  charOffset: offset,
  parentParaIndex: 1,
  controlIndex: 0,
  cellIndex: cell,
  cellParaIndex: cellPara,
})

function openForm(
  prepare?: (doc: HwpDocument) => void,
  /** what the engine's plain-text export answers, given what it really is */
  exported: (flat: string) => string = (flat) => flat,
  /** false: an editor that hands a plugin no commands, hence no caret */
  withCaret = true,
) {
  let doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const lines = ['신청서', '', '끝.']
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  doc.pasteHtml(0, 1, 0, FORM)
  doc.mergeTableCells(0, 1, 0, 2, 1, 2, 3)
  prepare?.(doc)

  const history: Uint8Array[] = []
  const commands = new Map<string, Command>()
  // the editor's caret, as far as the plugin uses it
  const cursor = {
    anchor: null as Position | null,
    position: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 } as Position,
    block: null as null | {
      range: { startRow: number; startCol: number; endRow: number; endCol: number }
      excluded: string[]
    },
    hasSelection() {
      return this.anchor !== null
    },
    getPosition() {
      return { ...this.position }
    },
    isInCellSelectionMode() {
      return this.block !== null
    },
    getSelectedCellRange() {
      return this.block ? this.block.range : null
    },
    getCellTableContext() {
      return this.block ? { sec: 0, ppi: 1, ci: 0 } : null
    },
    getExcludedCells() {
      return new Set(this.block ? this.block.excluded : [])
    },
    getSelectionOrdered() {
      return this.anchor ? { start: this.anchor, end: this.position } : null
    },
    clearSelection() {
      this.anchor = null
    },
    moveTo(position: Position) {
      this.position = { ...position }
    },
    setAnchor() {
      this.anchor = { ...this.position }
    },
  }
  const host = {
    read: (fn: (d: never) => unknown) =>
      fn(
        new Proxy(doc, {
          get(target, key) {
            if (key === 'getTextFileText') {
              return () => JSON.stringify(exported(JSON.parse(target.getTextFileText()) as string))
            }
            const value = Reflect.get(target, key) as unknown
            return typeof value === 'function' ? value.bind(target) : value
          },
        }) as never,
      ),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = doc.exportHwp()
      try {
        const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
        history.push(before)
        return result
      } catch (thrown) {
        doc = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on: () => 0 },
    automation: {
      registerCommand: (command: Command) => {
        if (withCaret) commands.set(command.id, command)
      },
      execute: (id: string, params?: unknown) => {
        const command = commands.get(id)
        if (command) {
          command.execute({ getInputHandler: () => ({ cursor, updateCaret: () => {} }) }, params)
          return { ok: true }
        }
        if (id !== 'edit:undo') return { ok: false }
        const before = history.pop()
        if (!before) return { ok: false }
        doc = new HwpDocument(before)
        return { ok: true }
      },
    },
  } as unknown as AgentPluginHost

  const plugin = agentPlugin.activate(host)
  return {
    plugin,
    steps: () => history.length,
    doc: () => doc,
    /** the user selects from one place to another */
    select: (start: Position, end: Position) => {
      cursor.anchor = start
      cursor.position = end
    },
    selected: () => (cursor.anchor ? { start: cursor.anchor, end: cursor.position } : null),
    /** the user picks a block of cells of the form's table (zero-based rows and columns) */
    selectCells: (
      range: { startRow: number; startCol: number; endRow: number; endCol: number },
      excluded: string[] = [],
    ) => {
      cursor.block = { range, excluded }
    },
    /** the user double-clicks at a place: the caret goes there, then the word command runs */
    doubleClick: (at: Position) => {
      cursor.anchor = null
      cursor.position = at
      host.automation.execute('ext:kordoc-select-word')
    },
    /** the text of every cell of the first table, by "row.col" */
    cells: () => {
      const read = plugin.readTable(1)
      if (!read.ok) throw new Error('no table')
      return Object.fromEntries(read.cells.map((cell) => [`${cell.row}.${cell.col}`, cell.text]))
    },
  }
}

describe('listing and reading tables', () => {
  it('lists a table with its size, the line above it and its first cells', () => {
    const { plugin } = openForm()
    const listed = plugin.listTables()
    expect(listed.count).toBe(1)
    expect(listed.partial).toBe(false)
    expect(listed.tables[0]).toMatchObject({ table: 1, rows: 3, cols: 4, near: '신청서' })
    expect(listed.tables[0]!.preview.slice(0, 2)).toEqual(['성명', '소속'])
    expect(listed.tables[0]!.inTable).toBeUndefined()
  })

  it('reads the cells row by row, a merged cell once with its span', () => {
    const { plugin } = openForm()
    const read = plugin.readTable(1)
    if (!read.ok) throw new Error('expected a table')
    expect(read).toMatchObject({ table: 1, rows: 3, cols: 4 })
    expect(read.nextRow).toBeUndefined()
    expect(read.cells.map((cell) => `${cell.row}.${cell.col}`)).toEqual([
      '1.1',
      '1.2',
      '1.3',
      '1.4',
      '2.1',
      '2.2',
      '2.3',
      '2.4',
      '3.1',
      '3.2',
    ])
    expect(read.cells[0]).toEqual({ row: 1, col: 1, text: '성명' })
    expect(read.cells[1]).toEqual({ row: 1, col: 2, text: '' })
    expect(read.cells[9]).toEqual({ row: 3, col: 2, colSpan: 3, text: '' })
  })

  it('reads on from a row', () => {
    const { plugin } = openForm()
    const read = plugin.readTable(1, 3)
    if (!read.ok) throw new Error('expected a table')
    expect(read.cells.map((cell) => cell.text)).toEqual(['활동', ''])
  })

  it('says how many tables there are when the number names none', () => {
    const { plugin } = openForm()
    expect(plugin.readTable(2)).toEqual({ ok: false, reason: 'no_such_table', count: 1 })
    expect(plugin.fillCells(0, [{ row: 1, col: 1, text: 'x' }], false)).toEqual({
      ok: false,
      reason: 'no_such_table',
      count: 1,
    })
  })

  // A table inside a table cell is listed and filled the same way (it is found by asking the
  // engine for a table at each cell paragraph). The engine has no call that makes one, and a
  // table pasted into a cell comes out as text, so that case is checked on real documents.
})

describe('filling cells', () => {
  it('fills several empty cells in one undo step', () => {
    const { plugin, steps, cells } = openForm()
    const result = plugin.fillCells(
      1,
      [
        { row: 1, col: 2, text: '홍길동' },
        { row: 1, col: 4, text: '교무기획부' },
        { row: 2, col: 2, text: '041-000-0000' },
      ],
      false,
    )
    expect(result).toMatchObject({ ok: true, table: 1, count: 3 })
    expect(steps()).toBe(1)
    expect(cells()).toMatchObject({
      '1.1': '성명',
      '1.2': '홍길동',
      '1.4': '교무기획부',
      '2.2': '041-000-0000',
      '2.4': '기존 내용',
    })
  })

  it('takes a place inside a merged cell as that cell, and a line break as a new paragraph', () => {
    const { plugin, cells, doc } = openForm()
    const result = plugin.fillCells(1, [{ row: 3, col: 4, text: '첫 줄\n둘째 줄' }], false)
    expect(result).toMatchObject({ ok: true, count: 1 })
    expect(cells()['3.2']).toBe('첫 줄\n둘째 줄')
    expect(doc().getCellParagraphCountByPath(0, 1, cellPath(9))).toBe(2)
  })

  it('gives the text the formatting the cell already has', () => {
    const { plugin, doc } = openForm((d) => {
      // the empty cell beside 성명 is set up bold, the way a form designer leaves it
      d.insertTextInCellByPath(0, 1, cellPath(1), 0, 'x')
      d.applyCharFormatInCellByPath(0, 1, cellPath(1), 0, 1, JSON.stringify({ bold: true }))
      d.deleteTextInCellByPath(0, 1, cellPath(1), 0, 1)
    })
    plugin.fillCells(1, [{ row: 1, col: 2, text: '홍길동' }], false)
    const props = JSON.parse(doc().getCellCharPropertiesAtByPath(0, 1, cellPath(1), 1)) as {
      bold: boolean
    }
    expect(props.bold).toBe(true)
  })

  it('leaves a cell that holds text alone, and with it every other cell of the call', () => {
    const { plugin, steps, cells } = openForm()
    const result = plugin.fillCells(
      1,
      [
        { row: 1, col: 2, text: '홍길동' },
        { row: 2, col: 4, text: '새 내용' },
      ],
      false,
    )
    expect(result).toEqual({
      ok: false,
      reason: 'occupied',
      cells: [{ row: 2, col: 4, text: '기존 내용' }],
      rows: 3,
      cols: 4,
    })
    expect(steps()).toBe(0)
    expect(cells()).toMatchObject({ '1.2': '', '2.4': '기존 내용' })
  })

  it('writes over a cell when told to', () => {
    const { plugin, cells } = openForm()
    expect(plugin.fillCells(1, [{ row: 2, col: 4, text: '새 내용' }], true)).toMatchObject({
      ok: true,
    })
    expect(cells()['2.4']).toBe('새 내용')
  })

  it('writes over a cell of several paragraphs, leaving one', () => {
    const { plugin, cells, doc } = openForm((d) => {
      d.splitParagraphInCellByPath(0, 1, cellPath(7), 2)
    })
    expect(cells()['2.4']).toBe('기존\n 내용')
    plugin.fillCells(1, [{ row: 2, col: 4, text: '한 줄' }], true)
    expect(cells()['2.4']).toBe('한 줄')
    expect(doc().getCellParagraphCountByPath(0, 1, cellPath(7))).toBe(1)
  })

  it('treats blanks left in a cell as an empty cell', () => {
    const { plugin, cells } = openForm((d) => {
      d.insertTextInCellByPath(0, 1, cellPath(5), 0, '      ')
    })
    expect(plugin.fillCells(1, [{ row: 2, col: 2, text: '041-000-0000' }], false)).toMatchObject({
      ok: true,
    })
    expect(cells()['2.2']).toBe('041-000-0000')
  })

  it('names the places that are not in the table', () => {
    const { plugin, steps } = openForm()
    expect(plugin.fillCells(1, [{ row: 4, col: 1, text: 'x' }], false)).toEqual({
      ok: false,
      reason: 'no_such_cell',
      cells: [{ row: 4, col: 1 }],
      rows: 3,
      cols: 4,
    })
    expect(steps()).toBe(0)
  })

  it('refuses a call that names one cell twice, and bad places or text', () => {
    const { plugin } = openForm()
    const twice = [
      { row: 3, col: 2, text: 'a' },
      { row: 3, col: 3, text: 'b' },
    ]
    expect(() => plugin.fillCells(1, twice, false)).toThrow(/same cell/)
    expect(() => plugin.fillCells(1, [{ row: 0, col: 1, text: 'a' }], false)).toThrow(/from 1/)
    expect(() => plugin.fillCells(1, [], false)).toThrow(/1 to/)
    expect(() => plugin.fillCells(1, [{ row: 1, col: 2, text: 'a\tb' }], false)).toThrow(
      /plain text/,
    )
  })

  it('is taken back by one undo', () => {
    const { plugin, cells } = openForm()
    const foreign = plugin.foreignChanges()
    plugin.fillCells(
      1,
      [
        { row: 1, col: 2, text: '홍길동' },
        { row: 3, col: 2, text: '활동 내용' },
      ],
      false,
    )
    expect(plugin.undo(1, foreign)).toMatchObject({ ok: true, undone: 1 })
    expect(cells()).toMatchObject({ '1.2': '', '3.2': '' })
  })
})

describe('cells that hold a form field', () => {
  const withField = () =>
    openForm((doc) => {
      doc.insertClickHereFieldByPath(0, 1, cellPath(1), 0, GUIDE, '', '', true)
    })

  it('shows the field number on the cell', () => {
    const { plugin } = withField()
    const read = plugin.readTable(1)
    if (!read.ok) throw new Error('expected a table')
    expect(read.cells[1]).toMatchObject({ row: 1, col: 2, fields: [1] })
  })

  it('fills the cell through its field, so the guide text does not stay', () => {
    const { plugin, steps } = withField()
    const result = plugin.fillCells(
      1,
      [
        { row: 1, col: 2, text: '홍길동' },
        { row: 1, col: 4, text: '교무기획부' },
      ],
      false,
    )
    expect(result).toMatchObject({ ok: true, table: 1, count: 2 })
    expect(steps()).toBe(1)
    expect(plugin.listFields()[0]).toMatchObject({ field: 1, value: '홍길동' })
    expect(plugin.readText()).not.toContain(GUIDE)
  })

  it('does not write over a field that was already filled', () => {
    const { plugin } = withField()
    plugin.fillField(1, '홍길동')
    expect(plugin.fillCells(1, [{ row: 1, col: 2, text: '김철수' }], false)).toMatchObject({
      ok: false,
      reason: 'occupied',
      cells: [{ row: 1, col: 2, text: '홍길동' }],
    })
    expect(plugin.fillCells(1, [{ row: 1, col: 2, text: '김철수' }], true)).toMatchObject({
      ok: true,
    })
    expect(plugin.listFields()[0]!.value).toBe('김철수')
  })
})

describe('reading a document whose plain-text export leaves things out', () => {
  const lines = (text: string) => text.split('\n').filter((line) => line.trim() !== '')

  it('reads the same as the export when that is complete', () => {
    const { plugin, doc } = openForm()
    expect(lines(plugin.readText())).toEqual(
      lines((JSON.parse(doc().getTextFileText()) as string).replace(/\r/g, '')),
    )
  })

  it('puts a table the export skipped back where it stands', () => {
    // the export without any of the table: only the two lines of the body
    const { plugin } = openForm(undefined, () => '신청서\r\n\r\n끝.')
    expect(lines(plugin.readText())).toEqual([
      '신청서',
      '성명',
      '소속',
      '연락처',
      '비고',
      '기존 내용',
      '활동',
      '끝.',
    ])
  })

  it('puts back single cells and body paragraphs the export lost', () => {
    const { plugin } = openForm(undefined, (flat) =>
      flat
        .split(/\r?\n/)
        .filter((line) => !['소속', '끝.'].includes(line.trim()))
        .join('\r\n'),
    )
    const text = lines(plugin.readText())
    expect(text.filter((line) => line === '소속')).toHaveLength(1)
    expect(text.indexOf('소속')).toBe(text.indexOf('성명') + 1)
    expect(text[text.length - 1]).toBe('끝.')
  })

  it('does not repeat a line that holds a form field, which the export shows by its guide', () => {
    const { plugin } = openForm((d) => {
      d.insertClickHereFieldByPath(0, 1, cellPath(1), 0, GUIDE, '', '', true)
      d.insertText(0, 2, 0, '성명: ')
      d.insertClickHereField(0, 2, 4, GUIDE, '', '', true)
    })
    const text = lines(plugin.readText())
    expect(text.filter((line) => line.includes(GUIDE))).toHaveLength(2)
    expect(text.filter((line) => line.startsWith('성명:'))).toHaveLength(1)
  })

  it('writes the characters the export gives as numeric references', () => {
    const { plugin } = openForm(undefined, (flat) => flat.replace('신청서', '신청&#8199;서'))
    expect(plugin.readText()).toContain('신청\u2007서')
    expect(plugin.readText()).not.toContain('&#')
  })

  it('reads again after the document changed', () => {
    const { plugin } = openForm()
    expect(plugin.readText()).not.toContain('홍길동')
    plugin.fillCells(1, [{ row: 1, col: 2, text: '홍길동' }], false)
    expect(plugin.readText()).toContain('홍길동')
  })
})

describe('a picture that floats over a cell', () => {
  // the engine puts a picture "in a cell" beside the table in the body paragraph and
  // floats it over the cell: the cell itself holds nothing
  const withSeal = () =>
    openForm((doc) => {
      const png = Uint8Array.from(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      )
      doc.insertPictureEx(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 1,
          charOffset: 0,
          cellPath: cellPath(3),
          width: 2000,
          height: 600,
          naturalWidthPx: 20,
          naturalHeightPx: 6,
          extension: 'png',
        }),
        png,
      )
    })

  it('marks the cell as not empty', () => {
    const { plugin } = withSeal()
    const read = plugin.readTable(1)
    if (!read.ok) throw new Error('expected a table')
    expect(read.cells[3]).toEqual({ row: 1, col: 4, text: '', object: true })
    expect(read.cells[1]).toEqual({ row: 1, col: 2, text: '' })
  })

  it('does not write under it', () => {
    const { plugin, steps } = withSeal()
    expect(plugin.fillCells(1, [{ row: 1, col: 4, text: '교무기획부' }], true)).toEqual({
      ok: false,
      reason: 'holds_object',
      cells: [{ row: 1, col: 4 }],
      rows: 3,
      cols: 4,
    })
    expect(steps()).toBe(0)
    expect(plugin.fillCells(1, [{ row: 1, col: 2, text: '홍길동' }], false)).toMatchObject({
      ok: true,
    })
  })
})

describe('adding and removing rows and columns', () => {
  const rowTexts = (cells: Record<string, string>, row: number) =>
    Object.entries(cells)
      .filter(([place]) => place.startsWith(`${row}.`))
      .map(([, text]) => text)

  it('adds empty rows after a row, in one undo step', () => {
    const { plugin, steps, cells } = openForm()
    const result = plugin.addTableLines(1, 'rows', 2, 'after', 2)
    expect(result).toMatchObject({ ok: true, table: 1, rows: 5, cols: 4, first: 3, count: 2 })
    expect(steps()).toBe(1)
    const now = cells()
    expect(rowTexts(now, 2)).toEqual(['연락처', '', '비고', '기존 내용'])
    expect(rowTexts(now, 3)).toEqual(['', '', '', ''])
    expect(rowTexts(now, 4)).toEqual(['', '', '', ''])
    expect(now['5.1']).toBe('활동')
  })

  it('adds a row before the first one, and the new cells can be filled', () => {
    const { plugin, cells } = openForm()
    expect(plugin.addTableLines(1, 'rows', 1, 'before', 1)).toMatchObject({
      ok: true,
      rows: 4,
      first: 1,
    })
    expect(cells()['2.1']).toBe('성명')
    expect(plugin.fillCells(1, [{ row: 1, col: 1, text: '구분' }], false)).toMatchObject({
      ok: true,
    })
    expect(cells()['1.1']).toBe('구분')
  })

  it('gives a new row the alignment of the row it is added next to', () => {
    const { plugin, doc } = openForm((d) => {
      for (const cell of [4, 5, 6, 7]) {
        d.applyParaFormatInCell(0, 1, 0, cell, 0, JSON.stringify({ alignment: 'center' }))
      }
    })
    plugin.addTableLines(1, 'rows', 2, 'after', 1)
    for (const cell of [8, 9, 10, 11]) {
      const props = JSON.parse(doc().getCellParaPropertiesAt(0, 1, 0, cell, 0)) as {
        alignment: string
      }
      expect(props.alignment).toBe('center')
    }
  })

  it('adds a column', () => {
    const { plugin, cells } = openForm()
    expect(plugin.addTableLines(1, 'columns', 1, 'after', 1)).toMatchObject({
      ok: true,
      rows: 3,
      cols: 5,
      first: 2,
    })
    expect(cells()).toMatchObject({ '1.1': '성명', '1.2': '', '1.4': '소속' })
  })

  it('removes rows with what is in them and says what went', () => {
    const { plugin, steps, cells } = openForm()
    const result = plugin.removeTableLines(1, 'rows', 2, 1)
    expect(result).toMatchObject({ ok: true, table: 1, rows: 2, cols: 4, count: 1 })
    if (!result.ok) throw new Error('expected a removal')
    expect(result.text).toBe('연락처 | 비고 | 기존 내용')
    expect(steps()).toBe(1)
    expect(cells()).toMatchObject({ '1.1': '성명', '2.1': '활동' })
  })

  it('removes a column', () => {
    const { plugin, cells } = openForm()
    expect(plugin.removeTableLines(1, 'columns', 1, 1)).toMatchObject({
      ok: true,
      rows: 3,
      cols: 3,
    })
    expect(cells()['1.2']).toBe('소속')
  })

  it('is taken back by one undo', () => {
    const { plugin, cells } = openForm()
    const foreign = plugin.foreignChanges()
    plugin.addTableLines(1, 'rows', 3, 'after', 3)
    expect(plugin.undo(1, foreign)).toEqual({ ok: true, undone: 1 })
    const read = plugin.readTable(1)
    expect(read).toMatchObject({ ok: true, rows: 3, cols: 4 })
    expect(cells()['2.4']).toBe('기존 내용')
  })

  it('refuses lines that are not there, a table left without rows, and bad arguments', () => {
    const { plugin, steps } = openForm()
    expect(plugin.addTableLines(1, 'rows', 4, 'after', 1)).toEqual({
      ok: false,
      reason: 'no_such_line',
      rows: 3,
      cols: 4,
    })
    expect(plugin.removeTableLines(1, 'rows', 3, 2)).toMatchObject({
      ok: false,
      reason: 'no_such_line',
    })
    expect(plugin.removeTableLines(1, 'rows', 1, 3)).toMatchObject({
      ok: false,
      reason: 'would_empty',
    })
    expect(plugin.addTableLines(2, 'rows', 1, 'after', 1)).toEqual({
      ok: false,
      reason: 'no_such_table',
      count: 1,
    })
    expect(() => plugin.addTableLines(1, 'rows', 1, 'after', 0)).toThrow(/between 1 and/)
    expect(() => plugin.addTableLines(1, 'cells' as 'rows', 1, 'after', 1)).toThrow(/rows/)
    expect(() => plugin.addTableLines(1, 'rows', 1, 'below' as 'after', 1)).toThrow(/after/)
    expect(steps()).toBe(0)
  })

  it('does not remove a row with a picture floating over one of its cells', () => {
    const { plugin } = openForm((doc) => {
      const png = Uint8Array.from(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      )
      doc.insertPictureEx(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 1,
          charOffset: 0,
          cellPath: cellPath(3),
          width: 2000,
          height: 600,
          naturalWidthPx: 20,
          naturalHeightPx: 6,
          extension: 'png',
        }),
        png,
      )
    })
    expect(plugin.removeTableLines(1, 'rows', 1, 1)).toMatchObject({
      ok: false,
      reason: 'holds_object',
      cells: [{ row: 1, col: 4 }],
    })
  })
})

describe('where a change is', () => {
  it('names the cell a fill started in and the run written there', () => {
    const { plugin } = openForm()
    const result = plugin.fillCells(1, [{ row: 2, col: 2, text: '041-000-0000' }], false)
    expect(result).toMatchObject({
      ok: true,
      place: {
        sec: 0,
        para: 1,
        path: [{ controlIndex: 0, cellIndex: 5, cellParaIndex: 0 }],
        offset: 0,
        length: 12,
      },
    })
  })

  it('names the replaced run in the body and in a cell', () => {
    const { plugin } = openForm()
    expect(plugin.replaceText('신청서', '참가 신청서')).toMatchObject({
      place: { sec: 0, para: 0, offset: 0, length: 6 },
    })
    const inCell = plugin.replaceText('기존 내용', '새 내용')
    expect(inCell).toMatchObject({
      place: { sec: 0, para: 1, path: [{ cellIndex: 7, cellParaIndex: 0 }], offset: 0, length: 4 },
    })
  })

  it('names the first new paragraph and the first new row', () => {
    const { plugin } = openForm()
    expect(plugin.insertParagraphs('끝.', null, 'after', ['붙임 1부.'])).toMatchObject({
      place: { sec: 0, para: 3, offset: 0, length: 6 },
    })
    expect(plugin.addTableLines(1, 'rows', 3, 'after', 1)).toMatchObject({
      place: { sec: 0, para: 1, path: [{ controlIndex: 0, cellIndex: 10, cellParaIndex: 0 }] },
    })
  })

  it('answers false to reveal when the editor has no caret to move', () => {
    const { plugin } = openForm(undefined, undefined, false)
    expect(plugin.reveal({ sec: 0, para: 0, offset: 0, length: 3 })).toEqual({ ok: false })
    expect(plugin.selection()).toEqual({ ok: false, reason: 'none' })
  })

  it('moves the caret to the place and selects the run', () => {
    const { plugin, selected } = openForm()
    const result = plugin.fillCells(1, [{ row: 2, col: 2, text: '041-000-0000' }], false)
    if (!result.ok) throw new Error('expected a fill')
    expect(plugin.reveal(result.place)).toEqual({ ok: true })
    expect(selected()).toEqual({
      start: {
        sectionIndex: 0,
        paragraphIndex: 1,
        charOffset: 0,
        parentParaIndex: 1,
        controlIndex: 0,
        cellIndex: 5,
        cellParaIndex: 0,
      },
      end: {
        sectionIndex: 0,
        paragraphIndex: 1,
        charOffset: 12,
        parentParaIndex: 1,
        controlIndex: 0,
        cellIndex: 5,
        cellParaIndex: 0,
      },
    })
  })
})

describe('what the user selected', () => {
  const texts = (read: ReturnType<ReturnType<typeof openForm>['plugin']['selection']>) => {
    if (!read.ok) throw new Error(`expected a selection, got ${read.reason}`)
    return read.segments.map((segment) => segment.text)
  }

  it('says so when nothing is selected', () => {
    expect(openForm().plugin.selection()).toEqual({ ok: false, reason: 'none' })
  })

  it('hands out a run inside one paragraph', () => {
    const { plugin, select } = openForm()
    select(inBody(0, 0), inBody(0, 2))
    expect(plugin.selection()).toEqual({
      ok: true,
      inTable: false,
      contiguous: true,
      own: false,
      segments: [{ sec: 0, para: 0, offset: 0, length: 2, text: '신청' }],
    })
  })

  it('hands out a run inside a table cell with the path to it', () => {
    const { plugin, select } = openForm()
    select(inCell(7, 0), inCell(7, 2))
    expect(plugin.selection()).toEqual({
      ok: true,
      inTable: true,
      contiguous: true,
      own: false,
      segments: [
        {
          sec: 0,
          para: 1,
          path: [{ controlIndex: 0, cellIndex: 7, cellParaIndex: 0 }],
          offset: 0,
          length: 2,
          text: '기존',
        },
      ],
    })
  })

  it('takes a table whole when the selection runs over the paragraph it sits in', () => {
    const { plugin, select } = openForm()
    // from inside the title, over the table, into the last line
    select(inBody(0, 1), inBody(2, 1))
    const read = plugin.selection()
    expect(texts(read)).toEqual([
      '청서',
      '성명',
      '소속',
      '연락처',
      '비고',
      '기존 내용',
      '활동',
      '끝',
    ])
    expect(read).toMatchObject({ contiguous: false })
  })

  it('takes the block of cells between two cells of one table', () => {
    const { plugin, select } = openForm()
    // from the first cell of row 1 to the last cell of row 2
    select(inCell(0, 0), inCell(7, 2))
    expect(texts(plugin.selection())).toEqual(['성명', '소속', '연락처', '비고', '기존 내용'])
  })

  it('takes the cells of a block picked in the table, minus the ones left out', () => {
    const { plugin, selectCells } = openForm()
    selectCells({ startRow: 0, startCol: 0, endRow: 1, endCol: 0 })
    expect(texts(plugin.selection())).toEqual(['성명', '연락처'])
    selectCells({ startRow: 0, startCol: 0, endRow: 1, endCol: 3 }, ['1,3'])
    expect(texts(plugin.selection())).toEqual(['성명', '소속', '연락처', '비고'])
  })

  it('takes the table whole when the selection starts in the body and ends in a cell', () => {
    const { plugin, select } = openForm()
    select(inBody(0, 0), inCell(0, 1))
    expect(texts(plugin.selection())).toEqual([
      '신청서',
      '성명',
      '소속',
      '연락처',
      '비고',
      '기존 내용',
      '활동',
    ])
  })

  it('does not hand out a selection at a place it has no address for', () => {
    const { plugin, select } = openForm()
    // a text box position without the object it belongs to
    select({ ...inBody(0, 0), isTextBox: true }, { ...inBody(0, 2), isTextBox: true })
    expect(plugin.selection()).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('treats a selection of no characters as none', () => {
    const { plugin, select } = openForm()
    select(inBody(0, 2), inBody(0, 2))
    expect(plugin.selection()).toEqual({ ok: false, reason: 'none' })
  })

  it('marks the selection it made itself when it showed a change', () => {
    const { plugin, select } = openForm()
    const result = plugin.replaceText('신청서', '참가 신청서')
    if (!result.ok) throw new Error('expected a replacement')
    plugin.reveal(result.place)
    expect(plugin.selection()).toMatchObject({ ok: true, own: true })
    // the user then selects something else
    select(inBody(0, 0), inBody(0, 2))
    expect(plugin.selection()).toMatchObject({ ok: true, own: false })
  })
})

describe('a double click on a word', () => {
  it('selects the word in the body and in a table cell', () => {
    const { plugin, doubleClick } = openForm()
    doubleClick(inBody(0, 1))
    expect(plugin.selection()).toMatchObject({
      ok: true,
      own: false,
      segments: [{ para: 0, offset: 0, length: 3, text: '신청서' }],
    })
    // the click lands in the second word of the cell
    doubleClick(inCell(7, 4))
    expect(plugin.selection()).toMatchObject({
      ok: true,
      segments: [{ offset: 3, length: 2, text: '내용' }],
    })
  })

  it('takes a click right behind a word as that word, and selects nothing on a blank', () => {
    const { plugin, doubleClick } = openForm()
    doubleClick(inCell(7, 2))
    expect(plugin.selection()).toMatchObject({ ok: true, segments: [{ text: '기존' }] })
    doubleClick(inCell(1, 0))
    expect(plugin.selection()).toEqual({ ok: false, reason: 'none' })
  })
})

describe('changing the selected part', () => {
  /** 신청서 / [table] / 끝. / 붙임 1부. — with the last two paragraphs selected whole */
  const selectTwo = () => {
    const editor = openForm((d) => {
      d.splitParagraph(0, 2, 2)
      d.insertText(0, 3, 0, '붙임 1부.')
    })
    editor.select(inBody(2, 0), inBody(3, 6))
    const read = editor.plugin.selection()
    if (!read.ok) throw new Error('expected a selection')
    return { ...editor, segments: read.segments, read }
  }
  const body = (editor: { doc: () => HwpDocument }) => {
    const d = editor.doc()
    return Array.from({ length: d.getParagraphCount(0) }, (_unused, k) => {
      const length = d.getParagraphLength(0, k)
      return length > 0 ? d.getTextRange(0, k, 0, length) : ''
    })
  }

  it('replaces each run with its text, in one undo step, and hands the runs back', () => {
    const editor = selectTwo()
    expect(editor.read).toMatchObject({ contiguous: true })
    expect(editor.segments.map((segment) => segment.text)).toEqual(['끝.', '붙임 1부.'])
    const result = editor.plugin.replaceSelection(editor.segments, ['이상.', '붙임 2부.'])
    expect(result).toMatchObject({
      ok: true,
      segments: [
        { sec: 0, para: 2, offset: 0, length: 3, text: '이상.' },
        { sec: 0, para: 3, offset: 0, length: 6, text: '붙임 2부.' },
      ],
      place: { sec: 0, para: 2, offset: 0, length: 3 },
    })
    expect(editor.steps()).toBe(1)
    expect(body(editor)).toEqual(['신청서', '', '이상.', '붙임 2부.'])
  })

  it('replaces only the selected run of a paragraph, here in a cell', () => {
    const { plugin, select, cells } = openForm()
    select(inCell(7, 0), inCell(7, 2))
    const read = plugin.selection()
    if (!read.ok) throw new Error('expected a selection')
    expect(plugin.replaceSelection(read.segments, ['새'])).toMatchObject({ ok: true })
    expect(cells()['2.4']).toBe('새 내용')
  })

  it('writes one text into each cell of a block', () => {
    const { plugin, selectCells, cells } = openForm()
    selectCells({ startRow: 0, startCol: 0, endRow: 1, endCol: 0 })
    const read = plugin.selection()
    if (!read.ok) throw new Error('expected a selection')
    expect(plugin.replaceSelection(read.segments, ['이름', '전화'])).toMatchObject({ ok: true })
    expect(cells()).toMatchObject({ '1.1': '이름', '2.1': '전화', '1.3': '소속' })
  })

  it('goes on from the runs it handed back', () => {
    const editor = selectTwo()
    const first = editor.plugin.replaceSelection(editor.segments, ['이상.', '붙임 2부.'])
    if (!first.ok) throw new Error('expected a replacement')
    expect(editor.plugin.formatSelection(first.segments, { bold: true })).toMatchObject({
      ok: true,
      count: 2,
    })
    const bold = (para: number, offset: number) =>
      (JSON.parse(editor.doc().getCharPropertiesAt(0, para, offset)) as { bold: boolean }).bold
    expect(bold(2, 1)).toBe(true)
    expect(bold(3, 1)).toBe(true)
    // the runs as they were before the replacement no longer stand
    expect(editor.plugin.replaceSelection(editor.segments, ['a', 'b'])).toEqual({
      ok: false,
      reason: 'changed',
    })
  })

  it('changes nothing when the selected text is no longer there', () => {
    const editor = selectTwo()
    editor.doc().insertText(0, 2, 0, '[대외비] ')
    expect(editor.plugin.replaceSelection(editor.segments, ['a', 'b'])).toEqual({
      ok: false,
      reason: 'changed',
    })
    expect(editor.plugin.formatSelection(editor.segments, { bold: true })).toEqual({
      ok: false,
      reason: 'changed',
    })
    expect(editor.steps()).toBe(0)
  })

  it('aligns the paragraphs of the selection', () => {
    const editor = selectTwo()
    expect(editor.plugin.formatSelection(editor.segments, { align: 'center' })).toMatchObject({
      ok: true,
    })
    const alignment = (para: number) =>
      (JSON.parse(editor.doc().getParaPropertiesAt(0, para)) as { alignment: string }).alignment
    expect(alignment(2)).toBe('center')
    expect(alignment(3)).toBe('center')
  })

  it('rewrites the selection into more paragraphs, made like Enter makes them', () => {
    const editor = selectTwo()
    const result = editor.plugin.replaceSelection(editor.segments, [
      '이상.',
      '붙임 1부.',
      '붙임 2부.',
    ])
    expect(result).toMatchObject({
      ok: true,
      segments: [{ para: 2 }, { para: 3 }, { para: 4, offset: 0, length: 6, text: '붙임 2부.' }],
    })
    expect(editor.steps()).toBe(1)
    expect(body(editor)).toEqual(['신청서', '', '이상.', '붙임 1부.', '붙임 2부.'])
  })

  it('keeps what stood behind the selection behind the last new paragraph', () => {
    const editor = openForm()
    editor.select(inBody(0, 0), inBody(0, 2))
    const read = editor.plugin.selection()
    if (!read.ok) throw new Error('expected a selection')
    // "신청" of "신청서" becomes two paragraphs; the "서" that followed it follows them
    expect(editor.plugin.replaceSelection(read.segments, ['참가', '신청'])).toMatchObject({
      ok: true,
    })
    expect(body(editor).slice(0, 2)).toEqual(['참가', '신청서'])
  })

  it('rewrites the selection into fewer paragraphs, removing the ones left over', () => {
    const editor = selectTwo()
    const result = editor.plugin.replaceSelection(editor.segments, ['이상.'])
    expect(result).toMatchObject({ ok: true, segments: [{ para: 2, text: '이상.' }] })
    if (!result.ok) throw new Error('expected a replacement')
    expect(result.segments).toHaveLength(1)
    expect(editor.steps()).toBe(1)
    expect(body(editor)).toEqual(['신청서', '', '이상.'])
  })

  it('takes paragraphs with an empty line between them as one stretch', () => {
    const editor = openForm((d) => {
      // 끝. / (empty line) / 붙임 1부.
      d.splitParagraph(0, 2, 2)
      d.splitParagraph(0, 3, 0)
      d.insertText(0, 4, 0, '붙임 1부.')
    })
    editor.select(inBody(2, 0), inBody(4, 6))
    const read = editor.plugin.selection()
    if (!read.ok) throw new Error('expected a selection')
    expect(read.segments.map((segment) => segment.para)).toEqual([2, 4])
    expect(read.contiguous).toBe(true)
    editor.plugin.replaceSelection(read.segments, ['이상.', '붙임 1부.', '붙임 2부.'])
    expect(body(editor)).toEqual(['신청서', '', '이상.', '', '붙임 1부.', '붙임 2부.'])
  })

  it('only empties a run that was part of its paragraph', () => {
    const editor = openForm((d) => {
      d.splitParagraph(0, 2, 2)
      d.insertText(0, 3, 0, '붙임 1부.')
    })
    // the last paragraph is selected only up to "붙임"
    editor.select(inBody(2, 0), inBody(3, 2))
    const read = editor.plugin.selection()
    if (!read.ok) throw new Error('expected a selection')
    editor.plugin.replaceSelection(read.segments, ['이상.'])
    expect(body(editor)).toEqual(['신청서', '', '이상.', ' 1부.'])
  })

  it('wants one text per run when the runs are not one stretch of paragraphs', () => {
    const { plugin, selectCells, steps } = openForm()
    selectCells({ startRow: 0, startCol: 0, endRow: 1, endCol: 0 })
    const read = plugin.selection()
    if (!read.ok) throw new Error('expected a selection')
    expect(read.contiguous).toBe(false)
    expect(plugin.replaceSelection(read.segments, ['하나'])).toEqual({
      ok: false,
      reason: 'count',
      count: 2,
    })
    expect(steps()).toBe(0)
  })

  it('refuses a text of several lines and a call without texts', () => {
    const editor = selectTwo()
    expect(() => editor.plugin.replaceSelection(editor.segments, ['a\nb', 'c'])).toThrow(/one line/)
    expect(() => editor.plugin.replaceSelection(editor.segments, [])).toThrow(/one or more/)
    expect(() => editor.plugin.replaceSelection([], ['a'])).toThrow(/selection/)
  })
})
