// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-styles.test.ts(커밋 63e2a636)에서 옮겼다. 바꾼 것: 가져오기 경로, 명령 이름(ieum → kordoc).
/**
 * Styles through the plugin against the real rhwp engine: character styles on a piece of
 * text, paragraph styles on a paragraph that has formatting of its own, and styles made
 * and changed. What is set must also be in the HWP and HWPX the engine writes. The form
 * with tables in a cell (fixtures/nested-form.hwp) was made in Hancom Hangul 2024, as in
 * agent-plugin-delete-table.test.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, syncStyleList, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const NESTED_FORM = readFileSync(join(__dirname, 'fixtures', 'nested-form.hwp'))

/** Two paragraphs of the body. */
function blank(): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '첫 문단은 서식을 바꿀 글입니다')
  doc.splitParagraph(0, 0, doc.getParagraphLength(0, 0))
  doc.insertText(0, 1, 0, '둘째 문단')
  return doc
}

function open(start: HwpDocument = blank()) {
  let doc = start
  let steps = 0
  const host = {
    read: (fn: (d: HwpDocument) => unknown) => fn(doc),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = doc.exportHwp()
      try {
        const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
        steps += 1
        return result
      } catch (thrown) {
        doc = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on: () => 0 },
    automation: { registerCommand: () => {}, execute: () => null },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc: () => doc, steps: () => steps }
}

/** The document as the engine reads back the HWP and the HWPX it writes. */
const saved = (doc: HwpDocument) => [
  new HwpDocument(doc.exportHwp()),
  new HwpDocument(doc.exportHwpx()),
]

interface Chars {
  bold: boolean
  italic: boolean
  textColor: string
  fontSize: number
  charShapeId: number
}
const charsAt = (doc: HwpDocument, para: number, offset: number) =>
  JSON.parse(doc.getCharPropertiesAt(0, para, offset)) as Chars

/** A paragraph's properties; lengths come back in page pixels, a point being 4/3. */
const paraAt = (doc: HwpDocument, para: number) =>
  JSON.parse(doc.getParaPropertiesAt(0, para)) as Record<string, number | string>

const PX_PER_PT = 4 / 3

interface Style {
  id: number
  name: string
  englishName: string
  type: number
  nextStyleId: number
  paraShapeId: number
  charShapeId: number
}
const stylesOf = (doc: HwpDocument) => JSON.parse(doc.getStyleList()) as Style[]
const styleNamed = (doc: HwpDocument, name: string) =>
  stylesOf(doc).find((style) => style.name === name)

/** The paragraph of the nested form's inner table that holds only "정기시험". */
const INNER_CELL = JSON.stringify([
  { controlIndex: 0, cellIndex: 9, cellParaIndex: 3 },
  { controlIndex: 0, cellIndex: 1, cellParaIndex: 0 },
])
/** The paragraph style of that paragraph. */
const INNER_STYLE = '바탕글'
const innerCharsAt = (doc: HwpDocument, offset: number) =>
  JSON.parse(doc.getCellCharPropertiesAtByPath(0, 2, INNER_CELL, offset)) as Chars

describe('character styles', () => {
  it('go on the text that was found and nowhere else, and are saved', () => {
    const { plugin, doc } = open()
    expect(
      plugin.createStyle({
        name: '강조',
        kind: 'character',
        format: { bold: true, color: '#C00000' },
      }),
    ).toEqual({ ok: true, name: '강조', kind: 'character' })
    expect(plugin.formatText('서식을', null, false, { charStyle: '강조' }).ok).toBe(true)
    const shape = styleNamed(doc(), '강조')!.charShapeId
    for (const d of [doc(), ...saved(doc())]) {
      // "서식을" is characters 6 to 8
      expect(charsAt(d, 0, 6)).toMatchObject({ bold: true, textColor: '#c00000' })
      expect(charsAt(d, 0, 8).charShapeId).toBe(shape)
      expect(charsAt(d, 0, 5).bold).toBe(false)
      expect(charsAt(d, 0, 9).bold).toBe(false)
      // the paragraph keeps its paragraph style: a character style is not one
      expect(JSON.parse(d.getStyleAt(0, 0)).name).toBe('바탕글')
    }
  })

  it('go on the whole paragraph with formatParagraph, and what else was asked goes over them', () => {
    const { plugin, doc } = open()
    plugin.createStyle({ name: '강조', kind: 'character', format: { bold: true } })
    expect(plugin.formatParagraph('둘째', null, { charStyle: '강조', italic: true }).ok).toBe(true)
    expect(charsAt(doc(), 1, 0)).toMatchObject({ bold: true, italic: true })
    expect(charsAt(doc(), 1, 4)).toMatchObject({ bold: true, italic: true })
    expect(charsAt(doc(), 0, 0).bold).toBe(false)
  })

  it('go on the selected run only', () => {
    const { plugin, doc } = open()
    plugin.createStyle({ name: '강조', kind: 'character', format: { bold: true } })
    const segment = { sec: 0, para: 0, offset: 2, length: 3, text: '문단은' }
    expect(plugin.formatSelection([segment], { charStyle: '강조' }).ok).toBe(true)
    expect(charsAt(doc(), 0, 2).bold).toBe(true)
    expect(charsAt(doc(), 0, 4).bold).toBe(true)
    expect(charsAt(doc(), 0, 1).bold).toBe(false)
    expect(charsAt(doc(), 0, 5).bold).toBe(false)
  })

  it('reach the text of a table inside a table, where a paragraph style cannot', () => {
    const { plugin, doc } = open(new HwpDocument(new Uint8Array(NESTED_FORM)))
    const pageNumber = styleNamed(doc(), '쪽 번호')!
    expect(innerCharsAt(doc(), 0).charShapeId).not.toBe(pageNumber.charShapeId)
    // occurrence 2 is the inner table's cell; 1 is a heading of the outer table
    expect(plugin.formatText('정기시험', 2, false, { charStyle: '쪽 번호' }).ok).toBe(true)
    for (const d of [doc(), ...saved(doc())]) {
      expect(innerCharsAt(d, 0).charShapeId).toBe(pageNumber.charShapeId)
      expect(innerCharsAt(d, 3).charShapeId).toBe(pageNumber.charShapeId)
    }
    expect(plugin.formatParagraph('정기시험', 2, { style: '본문' })).toMatchObject({
      ok: false,
      reason: 'unsupported_place',
    })
  })

  it('are refused by name when the document has none by it, with the ones it has', () => {
    const { plugin, doc, steps } = open()
    const before = charsAt(doc(), 0, 6).charShapeId
    expect(plugin.formatText('서식을', null, false, { charStyle: '없는 스타일' })).toEqual({
      ok: false,
      reason: 'no_such_style',
      kind: 'character',
      styles: ['쪽 번호'],
    })
    // a paragraph style is not a character style
    expect(plugin.formatText('서식을', null, false, { charStyle: '본문' })).toMatchObject({
      reason: 'no_such_style',
    })
    expect(charsAt(doc(), 0, 6).charShapeId).toBe(before)
    expect(steps()).toBe(0)
  })
})

describe('a paragraph style on a paragraph with formatting of its own', () => {
  it('says it kept what the paragraph set itself, and the rest follows the style', () => {
    const { plugin, doc } = open()
    plugin.formatParagraph('첫 문단', null, { marginLeft: 10 })
    const own = plugin.formatParagraph('첫 문단', null, { style: '개요 1' })
    expect(own).toMatchObject({ ok: true, keptOwnLook: 1 })
    expect(paraAt(doc(), 0).marginLeft).toBeCloseTo(10 * PX_PER_PT, 0)
    expect(JSON.parse(doc().getStyleAt(0, 0)).name).toBe('개요 1')
    // a paragraph that looks as its style says takes the new style's look, and is not reported
    const clean = plugin.formatParagraph('둘째', null, { style: '개요 1' })
    expect(clean.ok && 'keptOwnLook' in clean).toBe(false)
    expect(paraAt(doc(), 1).paraShapeId).toBe(styleNamed(doc(), '개요 1')!.paraShapeId)
    // as in Hangul, everything but the margin it set is the style's (engine patch 0013);
    // whether the numbering starts anew depends on where the paragraph is, not on its look
    const look = (k: number) => {
      const {
        marginLeft: _margin,
        paraShapeId: _id,
        numberingRestartMode: _restart,
        ...rest
      } = paraAt(doc(), k)
      return rest
    }
    expect(look(0)).toEqual(look(1))
  })
})

describe('making a style', () => {
  it('makes a paragraph style followed by itself, with the look passed, and saves it', () => {
    const { plugin, doc, steps } = open()
    const result = plugin.createStyle({
      name: '보고서 제목',
      englishName: 'Report Title',
      format: {
        bold: true,
        size: 16,
        font: '맑은 고딕',
        align: 'center',
        lineSpacing: 180,
        marginLeft: 10,
        indent: -5,
        spacingBefore: 4,
        spacingAfter: 6,
      },
    })
    expect(result).toEqual({ ok: true, name: '보고서 제목', kind: 'paragraph' })
    expect(steps()).toBe(1)
    expect(plugin.readStyle('report title')).toEqual({
      ok: true,
      name: '보고서 제목',
      englishName: 'Report Title',
      kind: 'paragraph',
      nextStyle: '보고서 제목',
      look: {
        font: '맑은 고딕',
        size: 16,
        bold: true,
        italic: false,
        underline: false,
        strikethrough: false,
        color: '#000000',
        align: 'center',
        lineSpacing: 180,
        indent: -5,
        marginLeft: 10,
        marginRight: 0,
        spacingBefore: 4,
        spacingAfter: 6,
      },
    })
    for (const d of saved(doc())) {
      const style = styleNamed(d, '보고서 제목')!
      expect(style).toMatchObject({ englishName: 'Report Title', type: 0 })
      expect(style.nextStyleId).toBe(style.id)
    }
    expect(plugin.listStyles().paragraph).toContain('보고서 제목')
    // applied, a paragraph without formatting of its own takes the look
    expect(plugin.formatParagraph('둘째', null, { style: '보고서 제목' }).ok).toBe(true)
    expect(paraAt(doc(), 1).alignment).toBe('center')
    expect(charsAt(doc(), 1, 0)).toMatchObject({ bold: true })
  })

  it('starts from the style it is based on, and takes a next style', () => {
    const { plugin } = open()
    plugin.createStyle({
      name: '소제목',
      basedOn: '개요 2',
      nextStyle: '본문',
      format: { bold: true },
    })
    const made = plugin.readStyle('소제목')
    const base = plugin.readStyle('개요 2')
    if (!made.ok || !base.ok) throw new Error('styles missing')
    expect(made.nextStyle).toBe('본문')
    expect(made.look.marginLeft).toBe(base.look.marginLeft)
    expect(made.look.bold).toBe(true)
    expect(base.look.bold).toBe(false)
  })

  it('makes a character style, listed with the character styles', () => {
    const { plugin } = open()
    expect(
      plugin.createStyle({ name: '용어', kind: 'character', format: { italic: true } }).ok,
    ).toBe(true)
    expect(plugin.listStyles().character).toEqual(['쪽 번호', '용어'])
    const read = plugin.readStyle('용어')
    expect(read).toMatchObject({ ok: true, kind: 'character', look: { italic: true } })
    expect(read.ok && 'nextStyle' in read).toBe(false)
    expect(read.ok && 'align' in read.look).toBe(false)
  })

  it('refuses a name that is taken, and styles the document does not have, changing nothing', () => {
    const { plugin, doc, steps } = open()
    const count = stylesOf(doc()).length
    expect(plugin.createStyle({ name: '바탕글' })).toEqual({ ok: false, reason: 'style_exists' })
    // the English name of a style, in any case
    expect(plugin.createStyle({ name: 'normal' })).toEqual({ ok: false, reason: 'style_exists' })
    expect(plugin.createStyle({ name: '새것', englishName: 'Body' })).toEqual({
      ok: false,
      reason: 'style_exists',
    })
    expect(plugin.createStyle({ name: '새것', basedOn: '없음' })).toMatchObject({
      reason: 'no_such_style',
      kind: 'any',
    })
    // the next style is a paragraph style
    expect(plugin.createStyle({ name: '새것', nextStyle: '쪽 번호' })).toMatchObject({
      reason: 'no_such_style',
      kind: 'paragraph',
    })
    expect(stylesOf(doc()).length).toBe(count)
    expect(steps()).toBe(0)
  })

  it('throws on what cannot be a style', () => {
    const { plugin } = open()
    expect(() => plugin.createStyle({ name: '  ' })).toThrow(/name/)
    expect(() => plugin.createStyle({ name: '따옴표"이름' })).toThrow(/quotes/)
    expect(() => plugin.createStyle({ name: '새것', kind: 'table' as never })).toThrow(/kind/)
    expect(() =>
      plugin.createStyle({ name: '새것', kind: 'character', format: { align: 'center' } }),
    ).toThrow(/character formatting only/)
    expect(() =>
      plugin.createStyle({ name: '새것', kind: 'character', nextStyle: '본문' }),
    ).toThrow(/next style/)
    expect(() => plugin.createStyle({ name: '새것', format: { style: '본문' } as never })).toThrow(
      /other styles/,
    )
  })
})

describe('changing a style', () => {
  it('renames it and changes its look, and the paragraphs that use it follow', () => {
    const { plugin, doc, steps } = open()
    plugin.formatParagraph('둘째', null, { style: '본문' })
    const before = steps()
    const result = plugin.editStyle('본문', { name: '본문 고침', format: { marginLeft: 20 } })
    expect(result).toEqual({ ok: true, name: '본문 고침', kind: 'paragraph' })
    expect(steps()).toBe(before + 1)
    expect(plugin.readStyle('본문')).toMatchObject({ ok: false, reason: 'no_such_style' })
    expect(plugin.readStyle('Body')).toMatchObject({ ok: true, name: '본문 고침' })
    for (const d of [doc(), ...saved(doc())]) {
      expect(JSON.parse(d.getStyleAt(0, 1)).name).toBe('본문 고침')
      expect(paraAt(d, 1).marginLeft).toBeCloseTo(20 * PX_PER_PT, 0)
      // the other paragraph does not use it
      expect(paraAt(d, 0).marginLeft).toBe(0)
    }
  })

  it('sets the next style and the English name', () => {
    const { plugin } = open()
    expect(plugin.editStyle('개요 1', { nextStyle: '본문', englishName: 'Heading 1' }).ok).toBe(
      true,
    )
    expect(plugin.readStyle('heading 1')).toMatchObject({ name: '개요 1', nextStyle: '본문' })
  })

  it('changes a character style', () => {
    const { plugin } = open()
    expect(plugin.editStyle('쪽 번호', { format: { color: '#0000FF' } })).toEqual({
      ok: true,
      name: '쪽 번호',
      kind: 'character',
    })
    expect(plugin.readStyle('쪽 번호')).toMatchObject({ look: { color: '#0000ff' } })
  })

  it('refuses a taken name and a style that is not there; throws on nothing to change', () => {
    const { plugin, steps } = open()
    expect(plugin.editStyle('본문', { name: '개요 1' })).toEqual({
      ok: false,
      reason: 'style_exists',
    })
    // its own English name is its own
    expect(plugin.editStyle('본문', { name: 'Body' }).ok).toBe(true)
    const before = steps()
    expect(plugin.editStyle('없음', { format: { bold: true } })).toMatchObject({
      reason: 'no_such_style',
      kind: 'any',
    })
    expect(() => plugin.editStyle('개요 1', {})).toThrow(/nothing to change/)
    expect(() => plugin.editStyle('쪽 번호', { nextStyle: '본문' })).toThrow(/next style/)
    expect(() => plugin.editStyle('쪽 번호', { format: { align: 'left' } })).toThrow(
      /character formatting only/,
    )
    expect(steps()).toBe(before)
  })
})

// As Hancom Hangul 2024 does, checked by editing a style in its F6 dialog (decision 0055).
describe('changing a style reaches every paragraph that uses it', () => {
  it('in a table inside a table too', () => {
    const { plugin, doc } = open(new HwpDocument(new Uint8Array(NESTED_FORM)))
    const before = innerCharsAt(doc(), 0).fontSize
    expect(plugin.editStyle(INNER_STYLE, { format: { size: 17 } }).ok).toBe(true)
    for (const d of [doc(), ...saved(doc())]) {
      expect(innerCharsAt(d, 0).fontSize).toBe(1700)
    }
    expect(before).not.toBe(1700)
  })

  it('keeping what a paragraph set itself, and taking the rest', () => {
    const { plugin, doc } = open()
    plugin.formatParagraph('첫 문단', null, { align: 'center' })
    expect(plugin.editStyle('바탕글', { format: { marginLeft: 20 } }).ok).toBe(true)
    for (const d of [doc(), ...saved(doc())]) {
      expect(paraAt(d, 0).alignment).toBe('center')
      expect(paraAt(d, 0).marginLeft).toBeCloseTo(20 * PX_PER_PT, 0)
      expect(paraAt(d, 1).marginLeft).toBeCloseTo(20 * PX_PER_PT, 0)
    }
  })

  it('and a character style changes the text it is on, which keeps its look under the paragraph style', () => {
    const { plugin, doc } = open()
    expect(plugin.formatText('서식을', null, false, { charStyle: '쪽 번호' }).ok).toBe(true)
    const styled = charsAt(doc(), 0, 6).fontSize
    expect(plugin.editStyle('쪽 번호', { format: { color: '#0000FF' } }).ok).toBe(true)
    expect(plugin.editStyle('바탕글', { format: { size: 17 } }).ok).toBe(true)
    for (const d of [doc(), ...saved(doc())]) {
      expect(charsAt(d, 0, 6).textColor.toLowerCase()).toBe('#0000ff')
      expect(charsAt(d, 0, 6).fontSize).toBe(styled)
      expect(charsAt(d, 0, 0).fontSize).toBe(1700)
      expect(charsAt(d, 0, 0).textColor.toLowerCase()).not.toBe('#0000ff')
    }
  })
})

/** A stand-in for the editor toolbar's style list: a select element's options and selection. */
function fakeSelect(styles: { id: number; name: string }[], shown: number | null) {
  const option = (value: string, textContent: string) => ({ value, textContent })
  const select = {
    options: styles.map((style) => option(String(style.id), style.name)),
    selectedIndex: -1,
    get value() {
      return this.selectedIndex >= 0 ? this.options[this.selectedIndex]!.value : ''
    },
    set value(v: string) {
      this.selectedIndex = this.options.findIndex((o) => o.value === v)
    },
    replaceChildren(...nodes: { value: string; textContent: string }[]) {
      this.options = nodes
      this.selectedIndex = nodes.length > 0 ? 0 : -1
    },
    ownerDocument: { createElement: () => option('', '') },
  }
  if (shown !== null) select.value = String(shown)
  return select
}

const BEFORE = [
  { id: 0, name: '바탕글' },
  { id: 1, name: '개요 3' },
  { id: 2, name: '개요 5' },
]

describe('the toolbar style list', () => {
  it('is refilled when the styles changed, keeping the number the editor shows', () => {
    // 개요 3 was removed; the editor already shows the caret's style by its new number, 1
    const select = fakeSelect(BEFORE, 1)
    const after = [BEFORE[0]!, { id: 1, name: '개요 5' }]
    expect(syncStyleList(select, after)).toBe(true)
    expect(select.options.map((o) => `${o.value}:${o.textContent}`)).toEqual([
      '0:바탕글',
      '1:개요 5',
    ])
    expect(select.value).toBe('1')
  })

  it('leaves a list that matches alone, and shows nothing for a number that is gone', () => {
    const select = fakeSelect(BEFORE, 2)
    const options = select.options
    expect(syncStyleList(select, BEFORE)).toBe(false)
    expect(select.options).toBe(options)
    expect(syncStyleList(select, [BEFORE[0]!, { id: 1, name: '개요 5' }])).toBe(true)
    expect(select.selectedIndex).toBe(-1)
  })

  describe('kept in step by the plugin', () => {
    afterEach(() => {
      vi.useRealTimers()
      delete (globalThis as { document?: unknown }).document
    })

    it('after a change, once the document rests, and has the editor show the caret again', () => {
      vi.useFakeTimers()
      const doc = blank()
      const handlers: (() => void)[] = []
      const commands = new Map<string, (services: unknown) => void>()
      const emitCursorFormatState = vi.fn()
      const services = { getInputHandler: () => ({ emitCursorFormatState }) }
      const host = {
        read: (fn: (d: HwpDocument) => unknown) => fn(doc),
        transaction: (_label: string, fn: (tx: never) => unknown) => {
          const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
          for (const handler of handlers) handler()
          return result
        },
        events: { on: (_name: string, handler: () => void) => handlers.push(handler) },
        automation: {
          registerCommand: (def: { id: string; execute: (s: unknown) => void }) =>
            commands.set(def.id, def.execute),
          execute: (id: string) => commands.get(id)?.(services) ?? null,
        },
      } as unknown as AgentPluginHost
      const select = fakeSelect(stylesOf(doc), 0)
      ;(globalThis as { document?: unknown }).document = {
        querySelector: () => select,
        addEventListener: () => {},
        removeEventListener: () => {},
      }
      const plugin = agentPlugin.activate(host)
      plugin.createStyle({ name: '보고서 제목' })
      // not while typing goes on
      expect(select.options.some((o) => o.textContent === '보고서 제목')).toBe(false)
      vi.advanceTimersByTime(1000)
      expect(select.options.map((o) => o.textContent)).toEqual(stylesOf(doc).map((s) => s.name))
      expect(select.value).toBe('0')
      expect(emitCursorFormatState).toHaveBeenCalledTimes(1)
      // nothing changed in the styles: nothing to do
      for (const handler of handlers) handler()
      vi.advanceTimersByTime(1000)
      expect(emitCursorFormatState).toHaveBeenCalledTimes(1)
    })
  })
})
