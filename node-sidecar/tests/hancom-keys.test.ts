// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/hancom-keys.test.ts(커밋 63e2a636)에서 옮겼다. 바꾼 것: 가져오기 경로, 명령 이름(ieum → kordoc).
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ADDED_SHORTCUTS,
  CHORDS,
  LABELS,
  REMOVED_SHORTCUTS,
  STYLE_KEYS,
  TEXT_COLORS,
  adaptToHancom,
  deleteLine,
  hancomChordKey,
  hancomChordStart,
  hancomCommands,
  letterOf,
  studioCommandIds,
  withHancomLabel,
} from '../studio-plugin/hancom-keys.mjs'

type Key = Partial<KeyboardEvent> & { preventDefault: () => void }

const key = (init: Partial<KeyboardEvent>): Key => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 0,
  preventDefault: vi.fn(),
  ...init,
})

/** What a Korean IME hands the page for a letter it is about to compose. */
const imeKey = (code: string, init: Partial<KeyboardEvent> = {}) =>
  key({ key: 'Process', code, keyCode: 229, ...init })

function handler(enabled: string[] = []) {
  return {
    _hancomChord: null as string | null,
    _cellBlockLetterImeGuard: { arm: vi.fn() },
    dispatcher: {
      dispatch: vi.fn(() => true),
      isEnabled: vi.fn((id: string) => enabled.includes(id)),
    },
  }
}

describe('the key a letter sits on', () => {
  it('reads the physical key first, so the input language does not matter', () => {
    expect(letterOf(key({ key: 'Process', code: 'KeyT' }))).toBe('t')
    expect(letterOf(key({ key: 'ㅅ', code: 'KeyT' }))).toBe('t')
    expect(letterOf(key({ key: '!', code: 'Digit1' }))).toBe('1')
  })

  it('falls back to the key, and to the jamo of the Dubeolsik layout', () => {
    expect(letterOf(key({ key: 'T' }))).toBe('t')
    expect(letterOf(key({ key: 'ㅅ' }))).toBe('t')
    expect(letterOf(key({ key: 'Enter', code: 'Enter' }))).toBeNull()
  })
})

describe('Hangul sequences (Ctrl+N,T and the like)', () => {
  it('take Ctrl+N and run the command of the second key', () => {
    const ih = handler()
    const first = key({ key: 'n', code: 'KeyN', ctrlKey: true })
    expect(hancomChordStart(ih, first)).toBe(true)
    expect(first.preventDefault).toHaveBeenCalled()
    const second = key({ key: 't', code: 'KeyT' })
    expect(hancomChordKey(ih, second)).toBe(true)
    expect(second.preventDefault).toHaveBeenCalled()
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('table:create')
    expect(ih._hancomChord).toBeNull()
  })

  it('work while the IME composes, and keep the composed letter out of the document', () => {
    const ih = handler()
    expect(hancomChordStart(ih, imeKey('KeyN', { ctrlKey: true, isComposing: true }))).toBe(true)
    const second = imeKey('KeyN')
    expect(hancomChordKey(ih, second)).toBe(true)
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('insert:footnote')
    expect(ih._cellBlockLetterImeGuard.arm).toHaveBeenCalledWith(second)
  })

  it('take Ctrl+N pressed in the middle of composing, which the Windows IME reports twice', () => {
    // the keydowns the editor saw from the real Korean IME (2026-10-22): 가 composing, Ctrl+N, T
    const ih = handler()
    const run = (e: Key) => hancomChordKey(ih, e) || hancomChordStart(ih, e)
    expect(run(imeKey('ControlLeft', { ctrlKey: true, isComposing: true, timeStamp: 100 }))).toBe(
      false,
    )
    expect(
      run(
        key({ key: 'Control', code: 'ControlLeft', keyCode: 17, ctrlKey: true, isComposing: true }),
      ),
    ).toBe(false)
    expect(run(imeKey('KeyN', { ctrlKey: true, isComposing: true, timeStamp: 110 }))).toBe(true)
    // the IME commits 가 and hands the same press over again, as the plain key
    const again = key({ key: 'n', code: 'KeyN', keyCode: 78, ctrlKey: true, timeStamp: 130 })
    expect(run(again)).toBe(true)
    expect(again.preventDefault).toHaveBeenCalled()
    expect(ih.dispatcher.dispatch).not.toHaveBeenCalled()
    expect(ih._hancomChord).toBe('n')
    // T starts a new composition: "Process", 229, the physical key in the code
    const t = imeKey('KeyT', { timeStamp: 400 })
    expect(run(t)).toBe(true)
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('table:create')
    expect(ih._cellBlockLetterImeGuard.arm).toHaveBeenCalledWith(t)
  })

  it('take Ctrl+N,N typed with Ctrl held after an IME start, when it is a second press', () => {
    const ih = handler()
    hancomChordStart(ih, imeKey('KeyN', { ctrlKey: true, isComposing: true, timeStamp: 0 }))
    // well after the IME's repeat would have come: a press of its own
    hancomChordKey(ih, key({ key: 'n', code: 'KeyN', keyCode: 78, ctrlKey: true, timeStamp: 900 }))
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('insert:footnote')
  })

  it('accept the second key with Ctrl still held', () => {
    const ih = handler()
    hancomChordStart(ih, key({ key: 'n', code: 'KeyN', ctrlKey: true }))
    hancomChordKey(ih, key({ key: 'a', code: 'KeyA', ctrlKey: true }))
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('table:split')
  })

  it('wait through a modifier pressed between the keys', () => {
    const ih = handler()
    hancomChordStart(ih, key({ key: 'n', code: 'KeyN', ctrlKey: true }))
    expect(hancomChordKey(ih, key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBe(false)
    expect(ih._hancomChord).toBe('n')
    expect(hancomChordKey(ih, key({ key: 'E', code: 'KeyE', shiftKey: true }))).toBe(true)
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('insert:endnote')
  })

  it('let a second key they have no command for go on as a key of its own', () => {
    const ih = handler()
    hancomChordStart(ih, key({ key: 'n', code: 'KeyN', ctrlKey: true }))
    const stray = key({ key: 'x', code: 'KeyX' })
    expect(hancomChordKey(ih, stray)).toBe(false)
    expect(stray.preventDefault).not.toHaveBeenCalled()
    expect(ih.dispatcher.dispatch).not.toHaveBeenCalled()
    expect(ih._hancomChord).toBeNull()
  })

  it('open what the caret is on for Ctrl+N,K, as Hangul does', () => {
    const inTable = handler(['table:cell-props'])
    hancomChordStart(inTable, key({ key: 'n', code: 'KeyN', ctrlKey: true }))
    hancomChordKey(inTable, key({ key: 'k', code: 'KeyK' }))
    expect(inTable.dispatcher.dispatch).toHaveBeenCalledWith('table:cell-props')
    const inField = handler(['field:edit', 'table:cell-props'])
    hancomChordStart(inField, key({ key: 'n', code: 'KeyN', ctrlKey: true }))
    hancomChordKey(inField, key({ key: 'k', code: 'KeyK' }))
    expect(inField.dispatcher.dispatch).toHaveBeenCalledWith('field:edit')
  })

  it('give Ctrl+M,<letter> to the text colours, as Hangul does', () => {
    const ih = handler()
    hancomChordStart(ih, key({ key: 'm', code: 'KeyM', ctrlKey: true }))
    hancomChordKey(ih, key({ key: 'r', code: 'KeyR' }))
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('kordoc:text-color-r')
    expect(Object.keys(CHORDS.m).sort()).toEqual(Object.keys(TEXT_COLORS).sort())
  })

  it('do not start on Shift or Alt, or on a letter that has no sequence', () => {
    const ih = handler()
    expect(
      hancomChordStart(ih, key({ key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true })),
    ).toBe(false)
    expect(hancomChordStart(ih, key({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true }))).toBe(
      false,
    )
    expect(hancomChordStart(ih, key({ key: 'x', code: 'KeyX', ctrlKey: true }))).toBe(false)
    expect(ih._hancomChord).toBeNull()
  })

  it('leave Cmd+Q to the Mac, which quits on it', () => {
    const ih = handler()
    const quit = key({ key: 'q', code: 'KeyQ', metaKey: true })
    expect(hancomChordStart(ih, quit)).toBe(false)
    expect(quit.preventDefault).not.toHaveBeenCalled()
    expect(hancomChordStart(ih, key({ key: 'n', code: 'KeyN', metaKey: true }))).toBe(true)
  })
})

describe("the studio's shortcut table, made Hangul's", () => {
  const sample = () =>
    [
      [{ key: 'z', ctrl: true }, 'edit:undo'],
      [{ key: 'y', ctrl: true }, 'edit:redo'],
      [{ key: 'h', alt: true, shift: true }, 'format:align-right'],
      [{ key: 'ㅗ', alt: true, shift: true }, 'format:align-right'],
      [{ key: 'c', alt: true, shift: true }, 'format:align-center'],
      [{ key: '0', ctrl: true }, 'view:zoom-100'],
      [{ key: 'f10', alt: true }, 'insert:symbols'],
    ] as [Record<string, unknown>, string][]

  it('drops the stand-ins and the keys Hangul uses otherwise, and keeps the rest', () => {
    const table = adaptToHancom(sample())
    const ids = table.map(([def, id]) => `${JSON.stringify(def)} ${id}`)
    expect(ids).toContain('{"key":"z","ctrl":true} edit:undo')
    expect(ids).toContain('{"key":"f10","alt":true} insert:symbols')
    expect(ids.some((s) => s.endsWith('edit:redo'))).toBe(false)
    expect(ids.some((s) => s.endsWith('view:zoom-100'))).toBe(false)
    expect(ids.some((s) => s.includes('"alt":true') && s.includes('format:align'))).toBe(false)
  })

  it("puts Hangul's keys first", () => {
    const table = adaptToHancom(sample())
    expect(table.slice(0, ADDED_SHORTCUTS.length)).toEqual(ADDED_SHORTCUTS)
  })

  it('names Ctrl+1..0 and Ctrl+Alt+1..0 for the first ten styles', () => {
    const styles = ADDED_SHORTCUTS.filter(([, id]) => id.startsWith('kordoc:style-'))
    expect(styles).toHaveLength(STYLE_KEYS * 2)
    expect(styles.find(([def]) => def.key === '1' && !def.alt)?.[1]).toBe('kordoc:style-1')
    expect(styles.find(([def]) => def.key === '0' && !def.alt)?.[1]).toBe('kordoc:style-10')
  })
})

describe('the menu labels', () => {
  it('follow the keys', () => {
    expect(
      withHancomLabel({ id: 'format:align-center', shortcutLabel: 'Alt+Shift+C' }).shortcutLabel,
    ).toBe('Ctrl+Shift+C')
    expect(
      withHancomLabel({ id: 'insert:equation', shortcutLabel: 'Ctrl+M,M' }).shortcutLabel,
    ).toBe('Ctrl+N,M')
  })

  it('leave every other command as it is, the same object', () => {
    const def = { id: 'edit:undo', shortcutLabel: 'Ctrl+Z' }
    expect(withHancomLabel(def)).toBe(def)
  })

  it('name only sequences that run the command they label', () => {
    for (const [id, label] of Object.entries(LABELS)) {
      const chord = /^Ctrl\+([A-Z]),([A-Z])$/.exec(label)
      if (!chord) continue
      const target = (CHORDS as Record<string, Record<string, string | string[]>>)[
        chord[1].toLowerCase()
      ][chord[2].toLowerCase()]
      expect([target].flat(), label).toContain(id)
    }
  })
})

describe('the new commands', () => {
  const services = (styles: { id: number; name: string }[] = []) => {
    const ih = { applyStyle: vi.fn() }
    return {
      ih,
      services: {
        getInputHandler: () => ih,
        eventBus: { emit: vi.fn() },
        wasm: { getStyleList: () => styles },
      },
    }
  }
  const command = (id: string) => hancomCommands('ko').find((c) => c.id === id)!

  it('apply the n-th style of the document for Ctrl+n', () => {
    const { ih, services: s } = services([
      { id: 0, name: '바탕글' },
      { id: 1, name: '본문' },
      { id: 2, name: '개요 1' },
    ])
    command('kordoc:style-3').execute(s)
    expect(ih.applyStyle).toHaveBeenCalledWith(2)
    command('kordoc:style-10').execute(s)
    expect(ih.applyStyle).toHaveBeenCalledTimes(1)
  })

  it("colour the text with Hangul's colours", () => {
    const { services: s } = services()
    command('kordoc:text-color-d').execute(s)
    expect(s.eventBus.emit).toHaveBeenCalledWith('format-char', { textColor: '#993366' })
  })

  it('carry labels in the two languages the editor shows', () => {
    expect(command('kordoc:delete-line').label).toBe('한 줄 지우기')
    expect(hancomCommands('en').find((c) => c.id === 'kordoc:delete-line')!.label).toBe('Delete Line')
  })

  it('cover every command the keys name', () => {
    const ids = new Set(hancomCommands('en').map((c) => c.id))
    for (const [, id] of ADDED_SHORTCUTS) if (id.startsWith('kordoc:')) expect(ids, id).toContain(id)
    for (const table of Object.values(CHORDS)) {
      for (const target of Object.values(table)) {
        for (const id of [target].flat()) if (id.startsWith('kordoc:')) expect(ids, id).toContain(id)
      }
    }
    expect(studioCommandIds().some((id) => id.startsWith('kordoc:'))).toBe(false)
  })
})

/**
 * A caret over paragraphs of fixed-width lines, enough of the studio's cursor for deleteLine: a
 * paragraph is split into lines of `width` characters, as the editor wraps it.
 */
function fakeEditor(paragraphs: string[], width = 10) {
  const paras = [...paragraphs]
  let position = { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }
  let anchor: typeof position | null = null
  const lineOf = (p: typeof position) =>
    Math.floor(Math.min(p.charOffset, Math.max(0, paras[p.paragraphIndex].length - 1)) / width)
  const cursor = {
    isInHeaderFooter: () => false,
    isInFootnote: () => false,
    isInPictureObjectSelection: () => false,
    isInTableObjectSelection: () => false,
    isInCellSelectionMode: () => false,
    clearSelection: () => {
      anchor = null
    },
    setAnchor: () => {
      anchor ??= { ...position }
    },
    moveToLineStart: () => {
      position = { ...position, charOffset: lineOf(position) * width }
    },
    moveToLineEnd: () => {
      const len = paras[position.paragraphIndex].length
      position = { ...position, charOffset: Math.min(len, (lineOf(position) + 1) * width) }
    },
    moveHorizontal: (delta: number) => {
      const len = paras[position.paragraphIndex].length
      const at = position.charOffset + delta
      if (at > len) {
        if (position.paragraphIndex + 1 < paras.length) {
          position = { ...position, paragraphIndex: position.paragraphIndex + 1, charOffset: 0 }
        }
      } else if (at >= 0) position = { ...position, charOffset: at }
    },
    moveTo: (p: typeof position) => {
      position = { ...p }
    },
    getPosition: () => ({ ...position }),
    getSelection: () => (anchor ? { anchor: { ...anchor }, focus: { ...position } } : null),
  }
  const ih = {
    cursor,
    isFormMode: () => false,
    updateCaret: vi.fn(),
    deleteSelection: () => {
      const [a, b] = [anchor!, position].sort(
        (x, y) => x.paragraphIndex - y.paragraphIndex || x.charOffset - y.charOffset,
      )
      const head = paras[a.paragraphIndex].slice(0, a.charOffset)
      const tail = paras[b.paragraphIndex].slice(b.charOffset)
      paras.splice(a.paragraphIndex, b.paragraphIndex - a.paragraphIndex + 1, head + tail)
      position = { ...a }
      anchor = null
    },
  }
  return {
    ih,
    paras,
    at: (paragraphIndex: number, charOffset: number) => {
      position = { sectionIndex: 0, paragraphIndex, charOffset }
    },
  }
}

describe("Ctrl+Y, Hangul's line deletion (as Hancom Hangul 2024 does it)", () => {
  it('deletes a one-line paragraph with its break: the next paragraph moves up', () => {
    const doc = fakeEditor(['가나다 라마바', '둘째 줄', '셋째 줄'])
    doc.at(0, 3)
    expect(deleteLine(doc.ih)).toBe(true)
    expect(doc.paras).toEqual(['둘째 줄', '셋째 줄'])
  })

  it('deletes one wrapped line of a long paragraph and nothing past it', () => {
    const doc = fakeEditor(['가'.repeat(25), '다음 문단'], 10)
    doc.at(0, 12)
    deleteLine(doc.ih)
    expect(doc.paras).toEqual(['가'.repeat(15), '다음 문단'])
  })

  it('empties the last line of the document and keeps the paragraph', () => {
    const doc = fakeEditor(['첫 줄', '끝 줄'])
    doc.at(1, 1)
    deleteLine(doc.ih)
    expect(doc.paras).toEqual(['첫 줄', ''])
  })

  it('takes an empty paragraph away', () => {
    const doc = fakeEditor(['첫 줄', '', '셋째'])
    doc.at(1, 0)
    deleteLine(doc.ih)
    expect(doc.paras).toEqual(['첫 줄', '셋째'])
  })

  it('does nothing on an empty last paragraph, and leaves no selection behind', () => {
    const doc = fakeEditor(['첫 줄', ''])
    doc.at(1, 0)
    expect(deleteLine(doc.ih)).toBe(false)
    expect(doc.paras).toEqual(['첫 줄', ''])
    expect(doc.ih.cursor.getSelection()).toBeNull()
  })

  it('does nothing in a header, a note, a selected object or a cell block', () => {
    for (const mode of [
      'isInHeaderFooter',
      'isInFootnote',
      'isInPictureObjectSelection',
      'isInTableObjectSelection',
      'isInCellSelectionMode',
    ] as const) {
      const doc = fakeEditor(['가나다', '라마바'])
      doc.ih.cursor[mode] = () => true
      expect(deleteLine(doc.ih), mode).toBe(false)
      expect(doc.paras).toEqual(['가나다', '라마바'])
    }
  })
})

describe('against the studio source the build fetched', () => {
  // scripts/build-rhwp-studio.mjs 가 받아 두는 자리
  const studio = join(tmpdir(), 'kordoc-rhwp-build-0.8.7', 'rhwp', 'rhwp-studio')
  const map = join(studio, 'src', 'command', 'shortcut-map.ts')

  it.skipIf(!existsSync(map))('finds every entry it takes out', () => {
    const source = readFileSync(map, 'utf8')
    for (const [def, id] of REMOVED_SHORTCUTS) {
      const mods = (['ctrl', 'alt', 'shift'] as const)
        .filter((m) => (def as Record<string, unknown>)[m])
        .map((m) => `${m}: true`)
      // the studio writes alt before shift
      expect(source, `${def.key} ${id}`).toContain(
        `[{ key: '${def.key}', ${mods.join(', ')} }, '${id}']`,
      )
    }
  })

  it.skipIf(!existsSync(map))("turns the studio's own table into Hangul's", async () => {
    const { defaultShortcuts, matchShortcut } = await import(/* @vite-ignore */ map)
    const table = adaptToHancom([...defaultShortcuts])
    const match = (init: Partial<KeyboardEvent>) => matchShortcut(key(init), table, 'other')
    expect(match({ key: 'y', code: 'KeyY', ctrlKey: true })).toBe('kordoc:delete-line')
    expect(match({ key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true })).toBe('edit:redo')
    expect(match({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })).toBe(
      'format:align-center',
    )
    expect(match({ key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true })).toBe(
      'format:align-right',
    )
    expect(match({ key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true })).toBe(
      'format:align-distribute',
    )
    // Alt+Shift+C is Hangul's 보통 모양 now, no longer rhwp's stand-in for centering
    expect(match({ key: 'C', code: 'KeyC', altKey: true, shiftKey: true })).toBe(
      'kordoc:normal-shape',
    )
    expect(match({ key: 'H', code: 'KeyH', altKey: true, shiftKey: true })).toBeNull()
    expect(match({ key: 'P', code: 'KeyP', altKey: true, shiftKey: true })).toBe(
      'format:superscript',
    )
    expect(match({ key: 'S', code: 'KeyS', altKey: true, shiftKey: true })).toBe('format:subscript')
    expect(match({ key: 'B', code: 'KeyB', altKey: true, shiftKey: true })).toBe('format:bold')
    expect(match({ key: 'Insert', code: 'Insert', altKey: true })).toBe('table:insert-row-col')
    expect(match({ key: 'f10', code: 'F10', ctrlKey: true })).toBe('insert:symbols')
    // rhwp's Alt+F10 stays: Hangul gives it nothing to do in the body
    expect(match({ key: 'f10', code: 'F10', altKey: true })).toBe('insert:symbols')
    expect(match({ key: 'h', code: 'KeyH', ctrlKey: true })).toBe('edit:find-replace')
    expect(match({ key: '0', code: 'Digit0', ctrlKey: true })).toBe('kordoc:style-10')
    expect(match({ key: '1', code: 'Digit1', ctrlKey: true })).toBe('kordoc:style-1')
    // the IME reports a Ctrl key as "Process" while it composes; the physical key decides
    expect(match({ key: 'Process', code: 'KeyY', ctrlKey: true, keyCode: 229 })).toBe(
      'kordoc:delete-line',
    )
    expect(
      match({ key: 'Process', code: 'KeyC', ctrlKey: true, shiftKey: true, keyCode: 229 }),
    ).toBe('format:align-center')
    // keys that were and stay: bold, the other alignments, Hangul's own Ctrl+Shift+S in a cell block
    expect(match({ key: 'b', code: 'KeyB', ctrlKey: true })).toBe('format:bold')
    expect(match({ key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true })).toBe(
      'format:align-left',
    )
    expect(match({ key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true })).toBe(
      'format:align-justify',
    )
  })
})
