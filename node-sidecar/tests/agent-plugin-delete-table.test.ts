// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-delete-table.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
/**
 * The plugin's deleteTable against the real rhwp engine. The engine cannot put a table inside
 * a cell, so the form with tables in a cell (fixtures/nested-form.hwp) was made in Hancom
 * Hangul 2024: a 5×2 table whose last cell holds the text of the meeting, an 8×9 table of
 * the exams, and two tables of achievement levels with an "or" line between them. The
 * editor's history is modelled by snapshots, as in agent-plugin-tables.test.ts.
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

const NESTED_FORM = readFileSync(join(__dirname, 'fixtures', 'nested-form.hwp'))

function open(bytes: Uint8Array) {
  let doc = new HwpDocument(new Uint8Array(bytes))
  const history: Uint8Array[] = []
  const host = {
    read: (fn: (d: HwpDocument) => unknown) => fn(doc),
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
      registerCommand: () => {},
      execute: (id: string) => {
        if (id !== 'edit:undo') return { ok: false }
        const before = history.pop()
        if (!before) return { ok: false }
        doc = new HwpDocument(before)
        return { ok: true }
      },
    },
  } as unknown as AgentPluginHost
  const plugin = agentPlugin.activate(host)
  return { plugin, steps: () => history.length, doc: () => doc }
}

/** The tables as listTables shows them: "rows×cols", with "<n" for the table they sit in. */
const shapes = (plugin: ReturnType<typeof open>['plugin']) =>
  plugin
    .listTables()
    .tables.map((table) => `${table.rows}×${table.cols}${table.inTable ? `<${table.inTable}` : ''}`)

/** The paragraphs of the cell that holds the meeting text (the outer table's last cell). */
const meetingCell = (doc: HwpDocument) => {
  const path = (k: number) => JSON.stringify([{ controlIndex: 0, cellIndex: 9, cellParaIndex: k }])
  const count = doc.getCellParagraphCountByPath(0, 2, path(0))
  const lines: string[] = []
  for (let k = 0; k < count; k++) {
    const length = doc.getCellParagraphLengthByPath(0, 2, path(k))
    lines.push(length > 0 ? doc.getTextInCellByPath(0, 2, path(k), 0, length) : '')
  }
  return lines
}

describe('removing a table', () => {
  it('lists the tables inside the cell after the table they sit in', () => {
    const { plugin } = open(NESTED_FORM)
    expect(shapes(plugin)).toEqual(['5×2', '8×9<1', '6×2<1', '4×2<1'])
  })

  it('removes a table inside a cell with the empty line it stood on, in one undo step', () => {
    const { plugin, steps, doc } = open(NESTED_FORM)
    const before = meetingCell(doc())
    const result = plugin.deleteTable(4)
    expect(result).toMatchObject({ ok: true, table: 4, rows: 4, cols: 2, inner: 0 })
    if (!result.ok) return
    expect(result.text).toContain('80% 이상 ~ 100%')
    expect(steps()).toBe(1)
    expect(shapes(plugin)).toEqual(['5×2', '8×9<1', '6×2<1'])
    // the line under "or" held the table; it is gone, and nothing else of the cell is
    const after = meetingCell(doc())
    expect(after).toHaveLength(before.length - 1)
    const at = before.indexOf('or')
    expect(before[at + 1]).toBe('')
    expect(after).toEqual([...before.slice(0, at + 1), ...before.slice(at + 2)])
    // the outer cell still holds the other two tables
    expect(plugin.readTable(2)).toMatchObject({ ok: true, rows: 8, cols: 9 })
  })

  it('is taken back by one undo', () => {
    const { plugin, doc } = open(NESTED_FORM)
    const original = meetingCell(doc())
    expect(plugin.deleteTable(3)).toMatchObject({ ok: true })
    expect(plugin.undo(1, plugin.foreignChanges())).toMatchObject({ ok: true })
    expect(shapes(plugin)).toEqual(['5×2', '8×9<1', '6×2<1', '4×2<1'])
    expect(meetingCell(doc())).toEqual(original)
  })

  it('takes the tables inside a table with it', () => {
    const { plugin, doc } = open(NESTED_FORM)
    const result = plugin.deleteTable(1)
    expect(result).toMatchObject({ ok: true, table: 1, rows: 5, cols: 2, inner: 3 })
    expect(plugin.listTables().count).toBe(0)
    expect(plugin.readText()).toContain('(과목명) 교과협의록')
    expect(plugin.readText()).not.toContain('회의주제')
    expect(JSON.parse(doc().getControls()) as unknown[]).toHaveLength(2)
  })

  it('names a table that is not there', () => {
    const { plugin, steps } = open(NESTED_FORM)
    expect(plugin.deleteTable(5)).toEqual({ ok: false, reason: 'no_such_table', count: 4 })
    expect(plugin.deleteTable(0)).toEqual({ ok: false, reason: 'no_such_table', count: 4 })
    expect(steps()).toBe(0)
  })

  it('removes a table of the body text with its line, and leaves the first line of a section', () => {
    let doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    doc.insertText(0, 0, 0, '신청서')
    doc.splitParagraph(0, 0, 3)
    doc.splitParagraph(0, 1, 0)
    doc.insertText(0, 2, 0, '끝.')
    doc.pasteHtml(0, 1, 0, '<table><tr><td>성명</td><td></td></tr></table>')
    const bytes = doc.exportHwp()
    doc = new HwpDocument(bytes)
    const paragraphs = doc.getParagraphCount(0)
    const { plugin, doc: now } = open(bytes)
    expect(plugin.deleteTable(1)).toMatchObject({ ok: true, rows: 1, cols: 2 })
    expect(now().getParagraphCount(0)).toBe(paragraphs - 1)
    expect(plugin.readText().split('\n')).toEqual(['신청서', '끝.'])
  })
})
