// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-format.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
/**
 * The wider formatting of the plugin against the real rhwp engine: fonts, a paragraph's
 * indent, margins and spacing, paragraph styles, and the background of table cells. What
 * is set must also be in the HWP the engine writes.
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

/** Two paragraphs, then a two-by-two table, then a table inside its first cell. */
function open() {
  let doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '첫 문단은 서식을 바꿀 글입니다')
  doc.splitParagraph(0, 0, doc.getParagraphLength(0, 0))
  doc.insertText(0, 1, 0, '둘째 문단')
  doc.splitParagraph(0, 1, doc.getParagraphLength(0, 1))
  doc.pasteHtml(
    0,
    2,
    0,
    '<table><tr><td>가</td><td>나</td></tr><tr><td>다</td><td>라</td></tr></table>',
  )
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = doc.exportHwp()
      try {
        return fn({ doc: () => doc, deferPagination: () => {} } as never)
      } catch (thrown) {
        doc = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on: () => 0 },
    automation: { registerCommand: () => {}, execute: () => null },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc: () => doc }
}

/** The document as the engine reads back the HWP it writes. */
const saved = (doc: HwpDocument) => new HwpDocument(doc.exportHwp())

const charsAt = (doc: HwpDocument, para: number, offset: number) =>
  JSON.parse(doc.getCharPropertiesAt(0, para, offset)) as { fontFamily: string; bold: boolean }

/** A paragraph's properties; lengths come back in page pixels of 75 HWPUNIT, a point being 4/3. */
const paraAt = (doc: HwpDocument, para: number) =>
  JSON.parse(doc.getParaPropertiesAt(0, para)) as Record<string, number | string>

const PX_PER_PT = 4 / 3

/** Where the table is: its paragraph and its place among that paragraph's objects. */
function tableOf(doc: HwpDocument) {
  for (let para = 0; para < doc.getParagraphCount(0); para++) {
    const controls = JSON.parse(doc.getControlTextPositions(0, para)) as unknown[]
    for (let control = 0; control < controls.length; control++) {
      try {
        doc.getTableDimensionsByPath(
          0,
          para,
          JSON.stringify([{ controlIndex: control, cellIndex: 0, cellParaIndex: 0 }]),
        )
        return { para, control }
      } catch {
        // not a table
      }
    }
  }
  throw new Error('no table')
}

describe('fonts', () => {
  it('sets a font the document did not have, for that text only', () => {
    const { plugin, doc } = open()
    const result = plugin.formatText('서식을', null, false, { font: '맑은 고딕' })
    expect(result.ok).toBe(true)
    for (const d of [doc(), saved(doc())]) {
      expect(charsAt(d, 0, 7).fontFamily).toBe('맑은 고딕')
      expect(charsAt(d, 0, 0).fontFamily).not.toBe('맑은 고딕')
    }
  })

  it('takes a font with other formatting, and refuses an empty name', () => {
    const { plugin, doc } = open()
    plugin.formatParagraph('둘째', null, { font: '바탕', bold: true })
    expect(charsAt(doc(), 1, 0)).toMatchObject({ fontFamily: '바탕', bold: true })
    expect(() => plugin.formatText('둘째', null, false, { font: '  ' })).toThrow(/font/)
  })
})

describe('indents, margins and spacing', () => {
  it('sets them in points, and the engine writes them', () => {
    const { plugin, doc } = open()
    const result = plugin.formatParagraph('첫 문단', null, {
      indent: 10,
      marginLeft: 20,
      marginRight: 5,
      spacingBefore: 6,
      spacingAfter: 12,
    })
    expect(result.ok).toBe(true)
    for (const d of [doc(), saved(doc())]) {
      const props = paraAt(d, 0)
      expect(props.indent).toBeCloseTo(10 * PX_PER_PT, 0)
      expect(props.marginLeft).toBeCloseTo(20 * PX_PER_PT, 0)
      expect(props.marginRight).toBeCloseTo(5 * PX_PER_PT, 0)
      // the engine reports spacing at twice what it lays out (margins and indents it halves)
      expect(props.spacingBefore).toBeCloseTo(2 * 6 * PX_PER_PT, 0)
      expect(props.spacingAfter).toBeCloseTo(2 * 12 * PX_PER_PT, 0)
    }
    // the other paragraph keeps its own
    expect(paraAt(doc(), 1).marginLeft).toBe(0)
  })

  it('hangs the first line out with a negative indent, and refuses lengths out of range', () => {
    const { plugin, doc } = open()
    plugin.formatParagraph('첫 문단', null, { indent: -12, marginLeft: 12 })
    expect(paraAt(doc(), 0).indent).toBeCloseTo(-12 * PX_PER_PT, 0)
    expect(() => plugin.formatParagraph('첫 문단', null, { marginLeft: -3 })).toThrow(/marginLeft/)
    expect(() => plugin.formatParagraph('첫 문단', null, { indent: 500 })).toThrow(/indent/)
  })

  it('belongs to paragraphs: a piece of text cannot take it', () => {
    const { plugin } = open()
    expect(() => plugin.formatText('서식을', null, false, { marginLeft: 10 })).toThrow(
      /whole paragraph/,
    )
  })
})

describe('paragraph styles', () => {
  it('lists the paragraph styles of the document', () => {
    const { plugin } = open()
    const styles = plugin.listStyles()
    expect(styles).toContain('바탕글')
    expect(styles.length).toBeGreaterThan(3)
  })

  it('applies a style by its name or its English name, and what else was asked goes over it', () => {
    const { plugin, doc } = open()
    const styles = JSON.parse(doc().getStyleList()) as {
      name: string
      englishName: string
      paraShapeId: number
      type: number
    }[]
    const outline = styles.find((style) => style.type === 0 && style.name === '개요 1')!
    expect(plugin.formatParagraph('첫 문단', null, { style: '개요 1' }).ok).toBe(true)
    expect(paraAt(doc(), 0).paraShapeId).toBe(outline.paraShapeId)
    expect(
      plugin.formatParagraph('둘째', null, { style: outline.englishName, align: 'right' }).ok,
    ).toBe(true)
    expect(paraAt(doc(), 1).alignment).toBe('right')
  })

  it('names the styles there are when asked for one that is not', () => {
    const { plugin, doc } = open()
    const before = paraAt(doc(), 0).paraShapeId
    const result = plugin.formatParagraph('첫 문단', null, { style: '없는 스타일' })
    expect(result).toMatchObject({ ok: false, reason: 'no_such_style' })
    expect(result.ok === false && 'styles' in result && result.styles).toContain('바탕글')
    expect(paraAt(doc(), 0).paraShapeId).toBe(before)
  })
})

describe('a new table with a header row', () => {
  it('greys the header cells only: the table’s own fill, painted behind every cell, has none', () => {
    const { plugin, doc } = open()
    plugin.insertTable(
      '둘째 문단',
      null,
      'after',
      [
        ['항목', '값'],
        ['가', '1'],
      ],
      true,
    )
    const d = saved(doc())
    // the new table is in the paragraph after "둘째 문단"
    const para = 2
    const table = JSON.parse(d.getTableProperties(0, para, 0)) as { fillType: string }
    expect(table.fillType).toBe('none')
    const cell = (index: number) =>
      JSON.parse(d.getCellProperties(0, para, 0, index)) as {
        fillType: string
        fillColor: string
        patternType: number
      }
    expect(cell(0)).toMatchObject({ fillType: 'solid', fillColor: '#e5e5e5', patternType: -1 })
    expect(cell(1)).toMatchObject({ fillType: 'solid', fillColor: '#e5e5e5' })
    expect(cell(2).fillType).toBe('none')
  })
})

describe('cell background', () => {
  const fillOf = (doc: HwpDocument, cell: number) => {
    const { para, control } = tableOf(doc)
    return JSON.parse(doc.getCellProperties(0, para, control, cell)) as {
      fillType: string
      fillColor: string
    }
  }

  it('colours the cells asked for and leaves the others, in what the engine writes too', () => {
    const { plugin, doc } = open()
    const result = plugin.formatCells(
      1,
      [
        { row: 1, col: 2 },
        { row: 2, col: 1 },
      ],
      '#FFE08A',
    )
    expect(result).toMatchObject({ ok: true, count: 2 })
    for (const d of [doc(), saved(doc())]) {
      expect(fillOf(d, 1)).toMatchObject({ fillType: 'solid', fillColor: '#ffe08a' })
      expect(fillOf(d, 2)).toMatchObject({ fillType: 'solid', fillColor: '#ffe08a' })
      expect(fillOf(d, 0).fillType).toBe('none')
      expect(fillOf(d, 3).fillType).toBe('none')
    }
  })

  it('colours without a pattern, which Hangul would draw as lines', () => {
    const { plugin, doc } = open()
    plugin.formatCells(1, [{ row: 2, col: 2 }], '#ffe08a')
    const { para, control } = tableOf(doc())
    const props = JSON.parse(doc().getCellProperties(0, para, control, 3)) as {
      patternType: number
    }
    expect(props.patternType).toBe(-1)
  })

  it('takes the colour away with "none"', () => {
    const { plugin, doc } = open()
    plugin.formatCells(1, [{ row: 1, col: 1 }], '#cccccc')
    plugin.formatCells(1, [{ row: 1, col: 1 }], 'none')
    expect(fillOf(doc(), 0).fillType).toBe('none')
  })

  it('refuses places that are not in the table, and a table that is not there', () => {
    const { plugin, doc } = open()
    expect(plugin.formatCells(1, [{ row: 3, col: 1 }], '#cccccc')).toMatchObject({
      ok: false,
      reason: 'no_such_cell',
      rows: 2,
      cols: 2,
    })
    expect(plugin.formatCells(5, [{ row: 1, col: 1 }], '#cccccc')).toMatchObject({
      ok: false,
      reason: 'no_such_table',
    })
    expect(fillOf(doc(), 0).fillType).toBe('none')
    expect(() => plugin.formatCells(1, [{ row: 1, col: 1 }], 'yellow')).toThrow(/background/)
  })
})
