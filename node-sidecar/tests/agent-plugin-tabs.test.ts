// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-tabs.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
/**
 * Measuring the tabs a save found without a width, against the real rhwp engine, and
 * writing what was measured into the saved file.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'
import { newTabsOf, writeTabWidths } from '../src/core/hwp-save/tab-widths.js'
import type { MeasuredTab } from '../src/core/hwp-save/tab-widths.js'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** Where a right tab stop with a dot leader sits, as the engine takes tab stop positions. */
const RIGHT_STOP = 60000

/**
 * A heading line with a right, dotted tab stop; a line on the default stops; a table whose
 * second cell holds a tab.
 */
function open() {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '제목\t3')
  doc.applyParaFormat(
    0,
    0,
    JSON.stringify({ tabStops: [{ position: RIGHT_STOP, type: 1, fill: 3 }] }),
  )
  doc.splitParagraph(0, 0, doc.getParagraphLength(0, 0))
  doc.applyParaFormat(0, 1, JSON.stringify({ tabStops: [] }))
  doc.insertText(0, 1, 0, '하나\t둘\t셋')
  doc.splitParagraph(0, 1, doc.getParagraphLength(0, 1))
  doc.pasteHtml(0, 2, 0, '<table><tr><td>칸</td><td>둘</td></tr></table>')
  doc.insertTextInCell(0, 2, 0, 1, 0, 0, '가\t나')
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: () => {
      throw new Error('measuring changes nothing')
    },
    events: { on: () => 0 },
    automation: { registerCommand: () => {}, execute: () => ({ ok: false }) },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc }
}

const tabWidth = (doc: HwpDocument, para: number, offset: number): number => {
  const before = JSON.parse(doc.getCursorRect(0, para, offset)) as { x: number }
  const after = JSON.parse(doc.getCursorRect(0, para, offset + 1)) as { x: number }
  return Math.round((after.x - before.x) * 75)
}

describe('measureTabs', () => {
  it('measures each tab as the editor lays it out, with the kind and leader of its stop', () => {
    const { plugin, doc } = open()
    const spots = newTabsOf(doc.exportHwp(), 'hwp')
    expect(spots).toHaveLength(4)
    const { tabs } = plugin.measureTabs(spots)
    expect(tabs[0]).toEqual({ width: tabWidth(doc, 0, 2), type: 1, fill: 3 })
    expect(tabs[1]).toEqual({ width: tabWidth(doc, 1, 2), type: 0, fill: 0 })
    expect(tabs[2]).toEqual({ width: tabWidth(doc, 1, 4), type: 0, fill: 0 })
    // the tab in the cell
    expect(tabs[3]?.width).toBeGreaterThan(0)
    for (const tab of tabs) expect(tab?.width).toBeGreaterThan(0)
  })

  it('measures nothing for a place that does not hold the tab the file says', () => {
    const { plugin } = open()
    const { tabs } = plugin.measureTabs([
      { sec: 0, para: 0, cells: [], tab: 0, tabs: 2 },
      { sec: 0, para: 1, cells: [], tab: 5, tabs: 2 },
      { sec: 0, para: 2, cells: [{ table: 1, cell: 0, para: 0 }], tab: 0, tabs: 1 },
      { sec: 0, para: 2, cells: [{ table: 0, cell: 9, para: 0 }], tab: 0, tabs: 1 },
      { sec: 0, para: 40, cells: [], tab: 0, tabs: 1 },
    ])
    expect(tabs).toEqual([null, null, null, null, null])
  })

  it('refuses what is not a list of places', () => {
    const { plugin } = open()
    expect(() => plugin.measureTabs('tabs' as never)).toThrow()
  })

  for (const format of ['hwp', 'hwpx'] as const) {
    it(`gives a saved file whose tabs the engine lays out as before (${format})`, () => {
      const { plugin, doc } = open()
      const bytes = format === 'hwp' ? doc.exportHwp() : doc.exportHwpx()
      const spots = newTabsOf(bytes, format)
      const { tabs } = plugin.measureTabs(spots)
      const measured = spots.flatMap((spot, index) =>
        tabs[index] ? [{ ...spot, ...tabs[index] } as MeasuredTab] : [],
      )
      const result = writeTabWidths(bytes, format, measured)
      expect(result.written).toBe(spots.length)
      expect(newTabsOf(result.bytes, format)).toEqual([])
      const back = new HwpDocument(result.bytes)
      expect(tabWidth(back, 0, 2)).toBe(tabWidth(doc, 0, 2))
      expect(tabWidth(back, 1, 2)).toBe(tabWidth(doc, 1, 2))
      expect(tabWidth(back, 1, 4)).toBe(tabWidth(doc, 1, 4))
    })
  }
})
