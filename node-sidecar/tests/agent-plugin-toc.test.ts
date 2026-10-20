// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-toc.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
/**
 * The plugin's table-of-contents tools against the real rhwp engine, on a report long
 * enough to run over several pages.
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

const CHAPTERS = 4
const BODY_LINES = 30

/** 보고서 제목, then chapters of a heading, a sub-heading and body lines. */
function open() {
  let doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const lines = ['보고서 제목']
  for (let i = 1; i <= CHAPTERS; i++) {
    lines.push(`${i}. 장 제목 ${i}`, `${i}.1 절 제목 ${i}`)
    for (let j = 0; j < BODY_LINES; j++) lines.push(`본문 ${i}-${j} 문장입니다. 줄을 채웁니다.`)
  }
  lines.forEach((line, k) => {
    if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
    doc.insertText(0, k, 0, line)
  })
  const history: Uint8Array[] = []
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
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
    automation: { registerCommand: () => {}, execute: () => ({ ok: false }) },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc: () => doc, steps: () => history.length }
}

const ENTRIES = Array.from({ length: CHAPTERS }, (_, i) => [
  { find: `장 제목 ${i + 1}`, level: 1 },
  { find: `절 제목 ${i + 1}`, level: 2 },
]).flat()

/** The page the engine lays a body paragraph that starts with `text` out on. */
function pageOf(doc: HwpDocument, text: string): number {
  for (let k = 0; k < doc.getParagraphCount(0); k++) {
    if (doc.getTextRange(0, k, 0, doc.getParagraphLength(0, k)).startsWith(text)) {
      const at = JSON.parse(doc.getPageOfPosition(0, k)) as { page: number }
      return at.page + 1
    }
  }
  throw new Error(`no paragraph starts with ${text}`)
}

describe('making a table of contents', () => {
  it('lists the headings with the pages they are on once the contents are in place', () => {
    const { plugin, doc, steps } = open()
    const result = plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES)
    expect(result).toMatchObject({ ok: true, count: ENTRIES.length })
    expect(steps()).toBe(1)
    const table = plugin.readTable(1)
    if (!table.ok) throw new Error('no table')
    expect(table.rows).toBe(ENTRIES.length)
    expect(table.cols).toBe(2)
    const rows = Array.from({ length: table.rows }, (_, r) =>
      table.cells.filter((cell) => cell.row === r + 1).map((cell) => cell.text),
    )
    expect(rows[0]).toEqual(['1. 장 제목 1', String(pageOf(doc(), '1. 장 제목 1'))])
    expect(rows[ENTRIES.length - 1]).toEqual([
      `${CHAPTERS}.1 절 제목 ${CHAPTERS}`,
      String(pageOf(doc(), `${CHAPTERS}.1 절 제목 ${CHAPTERS}`)),
    ])
    expect(result.ok && result.pages.at(-1)).toBeGreaterThan(1)
    // the title line, then the table, right after the anchor
    expect(doc().getTextRange(0, 1, 0, doc().getParagraphLength(0, 1))).toBe('차 례')
  })

  it('goes before the anchor too, and without a title', () => {
    const { plugin } = open()
    const result = plugin.insertToc('1. 장 제목 1', null, 'before', null, ENTRIES.slice(0, 2))
    expect(result).toMatchObject({ ok: true, count: 2 })
    const table = plugin.readTable(1)
    expect(table.ok && table.cells.map((cell) => cell.text)).toEqual([
      '1. 장 제목 1',
      '1',
      '1.1 절 제목 1',
      '1',
    ])
  })

  it('names the heading it cannot use and changes nothing', () => {
    const { plugin, steps } = open()
    expect(
      plugin.insertToc('보고서 제목', null, 'after', '차 례', [{ find: '제목', level: 1 }]),
    ).toMatchObject({ ok: false, reason: 'no_heading', heading: '제목', why: 'ambiguous' })
    expect(
      plugin.insertToc('보고서 제목', null, 'after', '차 례', [{ find: '없는 제목', level: 1 }]),
    ).toMatchObject({ ok: false, reason: 'no_heading', why: 'not_found' })
    expect(steps()).toBe(0)
  })

  it('refuses entries without a level and too many of them', () => {
    const { plugin } = open()
    expect(() =>
      plugin.insertToc('보고서 제목', null, 'after', null, [{ find: '장 제목 1', level: 4 }]),
    ).toThrow()
    expect(() => plugin.insertToc('보고서 제목', null, 'after', null, [])).toThrow()
  })
})

describe('writing the page numbers again', () => {
  it('follows the headings after the document moved them, and touches nothing else', () => {
    const { plugin, doc } = open()
    plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES)
    // a page and more of text pushed in before the first chapter
    const at = 3
    for (let i = 0; i < 45; i++) doc().splitParagraph(0, at, doc().getParagraphLength(0, at))
    const result = plugin.refreshToc('차 례', null)
    expect(result).toMatchObject({ ok: true, lines: ENTRIES.length })
    expect(result.ok && result.changed).toBeGreaterThan(0)
    const table = plugin.readTable(1)
    if (!table.ok) throw new Error('no table')
    const pages = table.cells.filter((cell) => cell.col === 2).map((cell) => Number(cell.text))
    expect(pages[0]).toBe(pageOf(doc(), '1. 장 제목 1'))
    expect(pages.at(-1)).toBe(pageOf(doc(), `${CHAPTERS}.1 절 제목 ${CHAPTERS}`))
    // nothing more to change the second time
    expect(plugin.refreshToc('차 례', null)).toMatchObject({ ok: true, changed: 0 })
  })

  it('says when no table of contents follows the line', () => {
    const { plugin } = open()
    expect(plugin.refreshToc('보고서 제목', null)).toMatchObject({ ok: false, reason: 'no_toc' })
  })
})
