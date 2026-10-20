// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/tab-widths.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로.
/**
 * Writing the width of the tabs the engine saves without one. The files come from the real
 * engine; the measures stand in for what the editor reports.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { inflateRawSync } from 'node:zlib'
import * as CFB from 'cfb'
import { newTabsOf, writeTabWidths } from '../src/core/hwp-save/tab-widths.js'
import type { MeasuredTab, TabSpot } from '../src/core/hwp-save/tab-widths.js'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** A document with tabs in two body paragraphs, then a table (in paragraph 2). */
function document(): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '제목\t3')
  doc.splitParagraph(0, 0, doc.getParagraphLength(0, 0))
  doc.insertText(0, 1, 0, '하나\t둘\t셋')
  doc.splitParagraph(0, 1, doc.getParagraphLength(0, 1))
  doc.pasteHtml(0, 2, 0, '<table><tr><td>칸</td><td>둘</td></tr></table>')
  return doc
}

function sectionText(file: Uint8Array): Buffer {
  const cfb = CFB.read(Buffer.from(file), { type: 'buffer' })
  return inflateRawSync(Buffer.from(CFB.find(cfb, '/BodyText/Section0')!.content as Uint8Array))
}

/** Where the engine put the table: the body paragraph and its place among that paragraph's objects. */
function tableOf(doc: HwpDocument): { para: number; control: number } {
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

function withCellTab(doc: HwpDocument): void {
  const { para, control } = tableOf(doc)
  doc.insertTextInCell(0, para, control, 1, 0, 0, '가\t나')
}

/** Left tabs (which the engine lays out as wide as written) with a dot leader. */
const measure = (spots: TabSpot[], width = 6000, type = 0): MeasuredTab[] =>
  spots.map((spot, index) => ({ ...spot, width: width + index, type, fill: 3 }))

describe('newTabsOf', () => {
  it('finds the tabs the engine wrote without values, in body paragraphs and cells', () => {
    const doc = document()
    withCellTab(doc)
    const { para } = tableOf(doc)
    for (const format of ['hwp', 'hwpx'] as const) {
      const bytes = format === 'hwp' ? doc.exportHwp() : doc.exportHwpx()
      const spots = newTabsOf(bytes, format)
      expect(spots).toEqual([
        { sec: 0, para: 0, cells: [], tab: 0, tabs: 1 },
        { sec: 0, para: 1, cells: [], tab: 0, tabs: 2 },
        { sec: 0, para: 1, cells: [], tab: 1, tabs: 2 },
        { sec: 0, para, cells: [{ table: 0, cell: 1, para: 0 }], tab: 0, tabs: 1 },
      ])
    }
  })

  it('finds nothing in a file that is not one', () => {
    expect(newTabsOf(new Uint8Array([1, 2, 3]), 'hwp')).toEqual([])
    expect(newTabsOf(new Uint8Array([1, 2, 3]), 'hwpx')).toEqual([])
  })
})

describe('writeTabWidths', () => {
  for (const format of ['hwp', 'hwpx'] as const) {
    it(`writes the measures into those tabs, and the engine reads them back (${format})`, () => {
      const doc = document()
      withCellTab(doc)
      const bytes = format === 'hwp' ? doc.exportHwp() : doc.exportHwpx()
      const spots = newTabsOf(bytes, format)
      const result = writeTabWidths(bytes, format, measure(spots))
      expect(result.written).toBe(spots.length)
      // none is without values any more
      expect(newTabsOf(result.bytes, format)).toEqual([])
      // the engine opens the result with the same text
      const back = new HwpDocument(result.bytes)
      for (let para = 0; para < doc.getParagraphCount(0); para++) {
        const length = doc.getParagraphLength(0, para)
        expect(back.getParagraphLength(0, para)).toBe(length)
        if (length > 0) {
          expect(back.getTextRange(0, para, 0, length)).toBe(doc.getTextRange(0, para, 0, length))
        }
      }
      // and lays the first tab out as wide as written
      const before = JSON.parse(back.getCursorRect(0, 0, 2)) as { x: number }
      const after = JSON.parse(back.getCursorRect(0, 0, 3)) as { x: number }
      expect(Math.round((after.x - before.x) * 75)).toBe(6000)
    })
  }

  it('writes the kind and the leader the way Hangul keeps them', () => {
    const doc = document()
    const hwpx = doc.exportHwpx()
    const result = writeTabWidths(hwpx, 'hwpx', measure(newTabsOf(hwpx, 'hwpx'), 6000, 1))
    // read back through the engine, then written as HWP: the values are the engine's now
    const hwp = new HwpDocument(result.bytes).exportHwp()
    expect(newTabsOf(hwp, 'hwp')).toEqual([])
    // the first tab as HWP keeps it: the width (6000 = 0x1770), then the kind one above the
    // tab stop's number in the high byte and the leader in the low one (right, dots)
    const tab = Buffer.alloc(16)
    tab.writeUInt16LE(9, 0)
    tab.writeUInt32LE(6000, 2)
    tab.writeUInt16LE(0x0203, 6)
    tab.writeUInt16LE(9, 14)
    expect(sectionText(hwp).includes(tab)).toBe(true)
  })

  it('leaves out a measure whose place holds no such tab, or whose paragraph has other tabs', () => {
    const doc = document()
    const bytes = doc.exportHwp()
    const spots = newTabsOf(bytes, 'hwp')
    const wrong: MeasuredTab[] = [
      { ...spots[0]!, tab: 5, width: 6000, type: 0, fill: 0 },
      { ...spots[1]!, tabs: 3, width: 6000, type: 0, fill: 0 },
      { ...spots[2]!, width: 0, type: 0, fill: 0 },
      { ...spots[2]!, width: 6000, type: 9, fill: 0 },
    ]
    const result = writeTabWidths(bytes, 'hwp', wrong)
    expect(result.written).toBe(0)
    expect(result.bytes).toBe(bytes)
  })

  it('leaves the other streams and entries as the engine wrote them', () => {
    const doc = document()
    for (const format of ['hwp', 'hwpx'] as const) {
      const bytes = format === 'hwp' ? doc.exportHwp() : doc.exportHwpx()
      const spots = newTabsOf(bytes, format)
      const result = writeTabWidths(bytes, format, measure(spots.slice(0, 1)))
      expect(result.written).toBe(1)
      // only the measured tab was written
      expect(newTabsOf(result.bytes, format)).toEqual(spots.slice(1))
    }
  })
})
