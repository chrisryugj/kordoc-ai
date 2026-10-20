// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-notes.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
/**
 * The plugin's footnote and endnote tools against the real rhwp engine. The editor's
 * history is modelled by snapshots, as in agent-plugin-tables.test.ts.
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

const LINES = ['보고서 제목', '국가인권위원회는 조사를 마쳤다. 위원회는 권고를 냈다.', '맺음말.']

/** A document of three paragraphs, the second followed by a one-cell table. */
function open(prepare?: (doc: HwpDocument) => void) {
  let doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  LINES.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    doc.insertText(0, index, 0, line)
  })
  doc.pasteHtml(0, 2, 0, '<table><tr><td>칸 안의 글</td></tr></table>')
  prepare?.(doc)

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
  return { plugin: agentPlugin.activate(host), doc: () => doc, steps: () => history.length }
}

const bodyText = (doc: HwpDocument) =>
  Array.from({ length: doc.getParagraphCount(0) }, (_, k) =>
    doc.getTextRange(0, k, 0, doc.getParagraphLength(0, k)),
  )

describe('adding a note', () => {
  it('puts a footnote mark right after the words, with the text after its number', () => {
    const { plugin, doc, steps } = open()
    const result = plugin.insertNote(
      'footnote',
      '국가인권위원회',
      null,
      '「국가인권위원회법」 제1조',
    )
    expect(result).toMatchObject({ ok: true, kind: 'footnote', number: 1 })
    expect(steps()).toBe(1)
    const listed = plugin.listNotes()
    expect(listed).toMatchObject({ count: 1, elsewhere: 0 })
    expect(listed.notes[0]).toEqual({
      note: 1,
      kind: 'footnote',
      number: 1,
      after: '국가인권위원회',
      text: '「국가인권위원회법」 제1조',
    })
    // the body text itself is unchanged: the mark is a control, not text
    expect(bodyText(doc())[1]).toBe(LINES[1])
  })

  it('writes a note of several paragraphs, and an endnote numbered on its own', () => {
    const { plugin } = open()
    plugin.insertNote('footnote', '조사를 마쳤다.', null, '첫째 설명')
    const end = plugin.insertNote('endnote', '권고를 냈다.', null, '출처: 연례보고서\n2025년 판')
    expect(end).toMatchObject({ ok: true, kind: 'endnote', number: 1 })
    const notes = plugin.listNotes().notes
    expect(notes.map((note) => [note.kind, note.number, note.text])).toEqual([
      ['footnote', 1, '첫째 설명'],
      ['endnote', 1, '출처: 연례보고서\n2025년 판'],
    ])
  })

  it('numbers a footnote by its place among the others', () => {
    const { plugin } = open()
    plugin.insertNote('footnote', '권고를 냈다.', null, '뒤의 것')
    plugin.insertNote('footnote', '조사를', null, '앞의 것')
    expect(plugin.listNotes().notes.map((note) => [note.number, note.text])).toEqual([
      [1, '앞의 것'],
      [2, '뒤의 것'],
    ])
  })

  it('does not guess between several places, and changes nothing', () => {
    const { plugin, steps } = open()
    const result = plugin.insertNote('footnote', '위원회', null, '설명')
    expect(result).toMatchObject({ ok: false, reason: 'ambiguous', count: 2 })
    expect(plugin.insertNote('footnote', '위원회', 2, '설명')).toMatchObject({ ok: true })
    expect(plugin.listNotes().notes[0]!.after).toBe('국가인권위원회는 조사를 마쳤다. 위원회')
    expect(steps()).toBe(1)
  })

  it('refuses words inside a table cell, where the engine cannot put a note', () => {
    const { plugin, steps } = open()
    expect(plugin.insertNote('footnote', '칸 안의 글', null, '설명')).toMatchObject({
      ok: false,
      reason: 'unsupported_place',
    })
    expect(plugin.insertNote('footnote', '없는 말', null, '설명')).toMatchObject({
      ok: false,
      reason: 'not_found',
    })
    expect(steps()).toBe(0)
  })

  it('refuses a note without text, an unknown kind and a control character', () => {
    const { plugin } = open()
    expect(() => plugin.insertNote('footnote', '조사를', null, '  ')).toThrow()
    expect(() => plugin.insertNote('sidenote' as never, '조사를', null, '설명')).toThrow()
    expect(() => plugin.insertNote('footnote', '조사를', null, '설명\u0007')).toThrow()
  })

  it('is one step the editor takes back whole', () => {
    const { plugin } = open()
    plugin.insertNote('footnote', '조사를', null, '첫 줄\n둘째 줄')
    expect(plugin.undo(1, plugin.foreignChanges())).toMatchObject({ ok: true, undone: 1 })
    expect(plugin.listNotes().count).toBe(0)
  })
})

describe('changing and removing a note', () => {
  it('replaces the whole text of a note, paragraphs included, and keeps its number', () => {
    const { plugin } = open()
    plugin.insertNote('footnote', '조사를', null, '옛 설명\n옛 둘째 줄\n옛 셋째 줄')
    const result = plugin.editNote(1, '새 설명')
    expect(result).toMatchObject({ ok: true, kind: 'footnote', number: 1 })
    expect(result.ok && result.was).toBe('옛 설명\n옛 둘째 줄\n옛 셋째 줄')
    expect(plugin.listNotes().notes[0]).toMatchObject({
      number: 1,
      text: '새 설명',
      after: '국가인권위원회는 조사를',
    })
    expect(plugin.editNote(1, '둘로\n나뉜 설명')).toMatchObject({ ok: true })
    expect(plugin.listNotes().notes[0]!.text).toBe('둘로\n나뉜 설명')
  })

  it('removes a note, and the document numbers the rest again', () => {
    const { plugin, doc } = open()
    plugin.insertNote('footnote', '조사를', null, '첫째')
    plugin.insertNote('footnote', '권고를', null, '둘째')
    const result = plugin.deleteNote(1)
    expect(result).toMatchObject({ ok: true, kind: 'footnote', number: 1, text: '첫째' })
    expect(plugin.listNotes().notes.map((note) => [note.number, note.text])).toEqual([[1, '둘째']])
    expect(bodyText(doc())[1]).toBe(LINES[1])
  })

  it('says when there is no such note', () => {
    const { plugin, steps } = open()
    expect(plugin.editNote(1, '설명')).toEqual({ ok: false, reason: 'no_such_note', count: 0 })
    expect(plugin.deleteNote(1)).toEqual({ ok: false, reason: 'no_such_note', count: 0 })
    expect(steps()).toBe(0)
  })
})

describe('notes in a saved file', () => {
  it('come back from the file as they were written', () => {
    const { plugin, doc } = open()
    plugin.insertNote('footnote', '조사를', null, '각주 설명')
    plugin.insertNote('endnote', '맺음말.', null, '미주 설명\n둘째 줄')
    for (const bytes of [doc().exportHwp(), doc().exportHwpx()]) {
      const reopened = open(() => {}).plugin
      // a fresh plugin over the saved bytes
      const again = agentPlugin.activate({
        read: (fn: (d: never) => unknown) => fn(new HwpDocument(bytes) as never),
        transaction: () => {
          throw new Error('read only')
        },
        events: { on: () => 0 },
        automation: { registerCommand: () => {}, execute: () => ({ ok: false }) },
      } as unknown as AgentPluginHost)
      expect(reopened.listNotes().count).toBe(0)
      expect(again.listNotes().notes.map((note) => [note.kind, note.text])).toEqual([
        ['footnote', '각주 설명'],
        ['endnote', '미주 설명\n둘째 줄'],
      ])
    }
  })
})
