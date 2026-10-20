// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-merge.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
/**
 * Merging and splitting table cells through the plugin, against the real rhwp engine, and
 * in the HWP the engine writes.
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

/** A paragraph, then a three-by-three table of 가 to 자. */
function open() {
  let doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '표 시험')
  doc.splitParagraph(0, 0, doc.getParagraphLength(0, 0))
  const row = (texts: string[]) => `<tr>${texts.map((text) => `<td>${text}</td>`).join('')}</tr>`
  doc.pasteHtml(
    0,
    1,
    0,
    `<table>${row(['가', '나', '다'])}${row(['라', '마', '바'])}${row(['사', '아', '자'])}</table>`,
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

/** The table as the plugin reads it: each cell's place, spans and text. */
function grid(plugin: ReturnType<typeof open>['plugin']) {
  const read = plugin.readTable(1, null)
  if (!read.ok) throw new Error('no table')
  return {
    rows: read.rows,
    cols: read.cols,
    cells: read.cells.map((cell) => ({
      at: `${cell.row}.${cell.col}`,
      span: `${cell.rowSpan ?? 1}x${cell.colSpan ?? 1}`,
      text: cell.text,
    })),
  }
}

describe('merging cells', () => {
  it('makes one cell of a range, its text one cell after another, in the saved file too', () => {
    const { plugin, doc } = open()
    const result = plugin.mergeCells(1, { row: 1, col: 1 }, { row: 2, col: 2 })
    expect(result).toMatchObject({ ok: true, merged: 4 })
    const after = grid(plugin)
    expect(after.cells[0]).toEqual({ at: '1.1', span: '2x2', text: '가\n나\n라\n마' })
    expect(after.cells).toHaveLength(6)
    // the engine reads back what it wrote
    const back = new HwpDocument(doc().exportHwp())
    const dims = JSON.parse(
      back.getTableDimensionsByPath(
        0,
        1,
        JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]),
      ),
    ) as { cellCount: number }
    expect(dims.cellCount).toBe(6)
  })

  it('takes the corners in any order', () => {
    const { plugin } = open()
    expect(plugin.mergeCells(1, { row: 3, col: 3 }, { row: 3, col: 2 }).ok).toBe(true)
    expect(grid(plugin).cells.at(-1)).toEqual({ at: '3.2', span: '1x2', text: '아\n자' })
  })

  it('refuses a range a merged cell lies partly inside, and leaves the table as it was', () => {
    const { plugin } = open()
    plugin.mergeCells(1, { row: 1, col: 1 }, { row: 1, col: 2 })
    const before = grid(plugin)
    const result = plugin.mergeCells(1, { row: 1, col: 2 }, { row: 2, col: 3 })
    expect(result).toMatchObject({
      ok: false,
      reason: 'crosses_merged',
      cells: [{ row: 1, col: 1 }],
    })
    expect(grid(plugin)).toEqual(before)
  })

  it('refuses places outside the table, a table that is not there, and a single cell', () => {
    const { plugin } = open()
    expect(plugin.mergeCells(1, { row: 1, col: 1 }, { row: 4, col: 1 })).toMatchObject({
      ok: false,
      reason: 'no_such_cell',
      rows: 3,
      cols: 3,
    })
    expect(plugin.mergeCells(2, { row: 1, col: 1 }, { row: 1, col: 2 })).toMatchObject({
      ok: false,
      reason: 'no_such_table',
    })
    expect(() => plugin.mergeCells(1, { row: 2, col: 2 }, { row: 2, col: 2 })).toThrow(/one cell/)
  })
})

describe('splitting a cell', () => {
  it('splits a cell into rows and columns, the text staying in the first', () => {
    const { plugin } = open()
    const result = plugin.splitCell(1, 2, 2, 2, 2)
    expect(result).toMatchObject({ ok: true, unmerged: false })
    const after = grid(plugin)
    expect(after.rows).toBe(4)
    expect(after.cols).toBe(4)
    expect(after.cells.filter((cell) => cell.text === '마')).toHaveLength(1)
    expect(after.cells).toHaveLength(12)
  })

  it('splits a merged cell back into the cells it covers', () => {
    const { plugin } = open()
    plugin.mergeCells(1, { row: 1, col: 1 }, { row: 2, col: 2 })
    // any place the merged cell covers names it
    const result = plugin.splitCell(1, 2, 2, null, null)
    expect(result).toMatchObject({ ok: true, unmerged: true })
    const after = grid(plugin)
    expect(after.cells).toHaveLength(9)
    expect(after.cells[0]).toEqual({ at: '1.1', span: '1x1', text: '가\n나\n라\n마' })
  })

  it('leaves a cell whole that has a picture on it, which would be cut off in the first part', () => {
    const { plugin, doc } = open()
    // a one-pixel picture, placed on the middle cell the way the engine places a picture in a cell
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    doc().insertPictureEx(
      JSON.stringify({
        sectionIdx: 0,
        paraIdx: 1,
        charOffset: 0,
        cellPath: JSON.stringify([{ controlIndex: 0, cellIndex: 4, cellParaIndex: 0 }]),
        width: 2000,
        height: 600,
        naturalWidthPx: 20,
        naturalHeightPx: 6,
        extension: 'png',
      }),
      png,
    )
    expect(plugin.splitCell(1, 2, 2, 2, 2)).toEqual({ ok: false, reason: 'holds_object' })
    expect(grid(plugin).rows).toBe(3)
  })

  it('says a cell that is not merged has nothing to split back, and checks the counts', () => {
    const { plugin } = open()
    expect(plugin.splitCell(1, 1, 1, null, null)).toEqual({ ok: false, reason: 'not_merged' })
    expect(() => plugin.splitCell(1, 1, 1, 11, 1)).toThrow(/1 to 10/)
  })
})
