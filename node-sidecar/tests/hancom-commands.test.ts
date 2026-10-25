// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/hancom-commands.test.ts(커밋 63e2a636)에서 옮겼다. 바꾼 것: 가져오기 경로, 명령 이름(ieum → kordoc), Alt+V,T 글자를 지우지 않음.
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHORDS,
  EASY_FORMULAS,
  MENU_ITEMS,
  NORMAL_SHAPE,
  PAGE_NUMBER_DEFAULT,
  PAGE_NUMBER_FORMATS,
  PAGE_NUMBER_POSITIONS,
  applyPageNumber,
  currentPageNumber,
  dateString,
  findBackward,
  hancomCommands,
  hancomContextKey,
  hancomCtrlKey,
  installHancomMainKeys,
  installHancomMenuItems,
  runEasyFormula,
  withHancomLabel,
} from '../studio-plugin/hancom-keys.mjs'

const key = (init: Partial<KeyboardEvent>) => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  keyCode: 0,
  preventDefault: vi.fn(),
  ...init,
})

const command = (id: string, studio = {}) => hancomCommands('ko', studio).find((c) => c.id === id)!

describe("the easy formulas' keys (Ctrl+Shift+H/V/J/B/K/N in a table)", () => {
  const handler = (inTable: boolean) => ({
    dispatcher: { dispatch: vi.fn(), isEnabled: vi.fn(() => inTable) },
  })

  it('run the formula of the letter when the caret is in a table', () => {
    const ih = handler(true)
    const e = key({ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true })
    expect(hancomContextKey(ih, e)).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('kordoc:easy-sum-left')
  })

  it('leave the key to the studio outside a table (document history, plain paste)', () => {
    const ih = handler(false)
    const e = key({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true })
    expect(hancomContextKey(ih, e)).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(ih.dispatcher.dispatch).not.toHaveBeenCalled()
  })

  it('want Ctrl and Shift and no Alt', () => {
    const ih = handler(true)
    expect(hancomContextKey(ih, key({ key: 'h', code: 'KeyH', ctrlKey: true }))).toBe(false)
    expect(
      hancomContextKey(
        ih,
        key({ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true, altKey: true }),
      ),
    ).toBe(false)
  })

  it('work while the IME composes (Process, 229)', () => {
    const ih = handler(true)
    const e = key({ key: 'Process', code: 'KeyN', keyCode: 229, ctrlKey: true, shiftKey: true })
    expect(hancomCtrlKey({ ...ih, _hancomChord: null }, e)).toBe(true)
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('kordoc:easy-product-above')
  })

  it('cover what Hancom Hangul 2024 does: sum, average and product, left and above', () => {
    const got = Object.fromEntries(
      Object.entries(EASY_FORMULAS).map(([k, f]) => [k, `=${f.func}(${f.range})`]),
    )
    expect(got).toEqual({
      h: '=SUM(LEFT)',
      v: '=SUM(ABOVE)',
      j: '=AVG(LEFT)',
      b: '=AVG(ABOVE)',
      k: '=PRODUCT(LEFT)',
      n: '=PRODUCT(ABOVE)',
    })
  })
})

describe('an easy formula in a cell', () => {
  function cellServices({ empty = true, nested = false } = {}) {
    const bridge = { evaluateTableFormula: vi.fn(() => JSON.stringify({ ok: true, result: 5 })) }
    const ih = {
      getCursorPosition: () => ({
        sectionIndex: 0,
        paragraphIndex: 0,
        charOffset: 0,
        parentParaIndex: 3,
        controlIndex: 1,
        cellIndex: 2,
        cellPath: nested ? [{}, {}] : [{}],
      }),
      executeOperation: vi.fn((op: { operation: (b: typeof bridge) => unknown }) =>
        op.operation(bridge),
      ),
    }
    const wasm = {
      getCellParagraphCount: () => 1,
      getCellParagraphLength: () => (empty ? 0 : 3),
      getCellInfo: () => ({ row: 0, col: 2, rowSpan: 1, colSpan: 1 }),
      evaluateTableFormula: vi.fn(() => JSON.stringify({ ok: true, result: 5 })),
    }
    return { ih, wasm, bridge, services: { getInputHandler: () => ih, wasm } }
  }

  it('writes the result into the empty cell the caret is in, as one undo step', () => {
    const { ih, wasm, bridge, services } = cellServices()
    expect(runEasyFormula(services, EASY_FORMULAS.h)).toBe(true)
    // a dry run first, then the write inside one snapshot operation
    expect(wasm.evaluateTableFormula).toHaveBeenCalledWith(0, 3, 1, 0, 2, '=SUM(LEFT)', false)
    expect(ih.executeOperation).toHaveBeenCalledTimes(1)
    expect(ih.executeOperation.mock.calls[0][0]).toMatchObject({ kind: 'snapshot' })
    expect(bridge.evaluateTableFormula).toHaveBeenCalledWith(0, 3, 1, 0, 2, '=SUM(LEFT)', true)
  })

  it('leaves a cell with text alone', () => {
    const { ih, services } = cellServices({ empty: false })
    expect(runEasyFormula(services, EASY_FORMULAS.h)).toBe(false)
    expect(ih.executeOperation).not.toHaveBeenCalled()
  })

  it('leaves a table in a cell alone', () => {
    const { ih, services } = cellServices({ nested: true })
    expect(runEasyFormula(services, EASY_FORMULAS.v)).toBe(false)
    expect(ih.executeOperation).not.toHaveBeenCalled()
  })

  it('writes nothing when the formula does not evaluate', () => {
    const { ih, wasm, services } = cellServices()
    wasm.evaluateTableFormula.mockReturnValue(JSON.stringify({ ok: false }))
    expect(runEasyFormula(services, EASY_FORMULAS.j)).toBe(false)
    expect(ih.executeOperation).not.toHaveBeenCalled()
  })
})

describe('보통 모양 (Alt+Shift+C)', () => {
  it('takes off what Hancom Hangul 2024 takes off, and keeps size, font, ratio and spacing', () => {
    const emit = vi.fn()
    command('kordoc:normal-shape').execute({ eventBus: { emit } })
    expect(emit).toHaveBeenCalledWith('format-char', NORMAL_SHAPE)
    expect(NORMAL_SHAPE).toMatchObject({
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      superscript: false,
      subscript: false,
      textColor: '#000000',
    })
    for (const kept of ['fontSize', 'fontFamily', 'ratios', 'spacings', 'shadeColor']) {
      expect(NORMAL_SHAPE).not.toHaveProperty(kept)
    }
  })
})

describe('날짜/시간 문자열 (Ctrl+K,D)', () => {
  it('writes the date the way Hancom Hangul 2024 does by default', () => {
    expect(dateString(new Date(2026, 9, 23))).toBe('2026년 10월 23일')
    expect(dateString(new Date(2027, 0, 5))).toBe('2027년 1월 5일')
  })

  it('types it at the caret through the studio text command, replacing a selection', () => {
    class InsertTextCommand {
      constructor(
        public position: unknown,
        public text: string,
      ) {}
    }
    const ih = {
      cursor: { hasSelection: () => true },
      deleteSelection: vi.fn(),
      getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 1, charOffset: 2 }),
      executeOperation: vi.fn(),
      focus: vi.fn(),
    }
    const emit = vi.fn()
    command('kordoc:insert-date', { InsertTextCommand }).execute({
      getInputHandler: () => ih,
      eventBus: { emit },
    })
    expect(ih.deleteSelection).toHaveBeenCalled()
    const op = ih.executeOperation.mock.calls[0][0]
    expect(op.kind).toBe('command')
    expect(op.command).toBeInstanceOf(InsertTextCommand)
    expect(op.command.text).toBe(dateString())
  })
})

describe('거꾸로 찾기 (Ctrl+Q,L)', () => {
  const setup = (lastQuery: string, selection: unknown = null) => {
    const ih = {
      cursor: { getSelection: () => selection },
      getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 4, charOffset: 9 }),
      dispatcher: { dispatch: vi.fn() },
    }
    const wasm = { searchText: vi.fn(() => ({ found: true })) }
    const studio = {
      FindDialog: { lastQuery, lastCaseSensitive: true },
      navigateToSearchHit: vi.fn(),
    }
    return { ih, wasm, studio, services: { getInputHandler: () => ih, wasm } }
  }

  it('searches the last query towards the start, from the start of the last match', () => {
    const { wasm, studio, services } = setup('계획', {
      anchor: { sectionIndex: 0, paragraphIndex: 2, charOffset: 5 },
      focus: { sectionIndex: 0, paragraphIndex: 2, charOffset: 7 },
    })
    expect(findBackward(services, studio)).toBe(true)
    expect(wasm.searchText).toHaveBeenCalledWith('계획', 0, 2, 5, false, true, true)
    expect(studio.navigateToSearchHit).toHaveBeenCalled()
  })

  it('opens the find box when nothing was searched yet', () => {
    const { ih, wasm, studio, services } = setup('')
    expect(findBackward(services, studio)).toBe(false)
    expect(wasm.searchText).not.toHaveBeenCalled()
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('edit:find')
  })
})

describe('쪽 번호 매기기 (Ctrl+N,P)', () => {
  it('lists the positions and number shapes both HWP and HWPX can hold', () => {
    expect(PAGE_NUMBER_POSITIONS.map((p) => p.code).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
    expect(PAGE_NUMBER_FORMATS.map((f) => f.code)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // Hancom Hangul 2024 puts 1, 2, 3 at the bottom center with dashes
    expect(PAGE_NUMBER_DEFAULT).toEqual({ format: 0, position: 5, dash: true })
    expect(CHORDS.n.p).toBe('kordoc:page-number')
  })

  it('sets the section page number through the bridge, as one undo step', () => {
    const bridge = { setPageNumberPos: vi.fn(() => JSON.stringify({ ok: true, replaced: false })) }
    const ih = {
      getCursorPosition: () => ({ sectionIndex: 1, paragraphIndex: 0, charOffset: 0 }),
      executeOperation: vi.fn((op: { operation: (b: typeof bridge) => unknown }) =>
        op.operation(bridge),
      ),
    }
    expect(
      applyPageNumber({ getInputHandler: () => ih }, { format: 2, position: 6, dash: false }),
    ).toBe(true)
    expect(ih.executeOperation.mock.calls[0][0]).toMatchObject({ kind: 'snapshot' })
    expect(bridge.setPageNumberPos).toHaveBeenCalledWith(1, 2, 6, false)
  })

  it("starts the dialog from the section's page number, or from Hangul's default", () => {
    const found = {
      wasm: {
        getPageNumberPos: () =>
          JSON.stringify({ ok: true, pageNumber: { format: 3, position: 2, dash: false } }),
      },
    }
    expect(currentPageNumber(found, 0)).toEqual({ format: 3, position: 2, dash: false })
    const none = {
      wasm: { getPageNumberPos: () => JSON.stringify({ ok: true, pageNumber: null }) },
    }
    expect(currentPageNumber(none, 0)).toEqual(PAGE_NUMBER_DEFAULT)
    const old = { wasm: {} }
    expect(currentPageNumber(old, 0)).toEqual(PAGE_NUMBER_DEFAULT)
  })

  describe('the dialog', () => {
    const dom = new JSDOM('<!doctype html><body></body>')
    const realDocument = globalThis.document
    afterEach(() => {
      globalThis.document = realDocument
    })

    it('shows the positions, the number shape and the dashes, and applies what is chosen', () => {
      globalThis.document = dom.window.document
      let body: HTMLElement | null = null
      let confirm: (() => boolean | void) | null = null
      class ModalDialog {
        constructor(
          public title: string,
          public width: number,
        ) {}
        show() {
          // what the studio's base does with a subclass
          const self = this as unknown as { createBody(): HTMLElement; onConfirm(): boolean | void }
          body = self.createBody()
          confirm = () => self.onConfirm()
        }
      }
      const bridge = { setPageNumberPos: vi.fn(() => JSON.stringify({ ok: true })) }
      const ih = {
        getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }),
        executeOperation: vi.fn((op: { operation: (b: typeof bridge) => unknown }) =>
          op.operation(bridge),
        ),
        focus: vi.fn(),
      }
      const services = {
        getInputHandler: () => ih,
        wasm: { getPageNumberPos: () => JSON.stringify({ ok: true, pageNumber: null }) },
      }
      command('kordoc:page-number', { ModalDialog }).execute(services)
      const radios = [...body!.querySelectorAll('input[type=radio]')] as HTMLInputElement[]
      expect(radios).toHaveLength(PAGE_NUMBER_POSITIONS.length)
      expect(radios.find((r) => r.checked)?.value).toBe('5')
      const select = body!.querySelector('select') as HTMLSelectElement
      expect(select.options).toHaveLength(PAGE_NUMBER_FORMATS.length)
      const dash = body!.querySelector('input[type=checkbox]') as HTMLInputElement
      expect(dash.checked).toBe(true)
      // choose the top right, roman capitals, no dashes
      const topRight = radios.find((r) => r.value === '3')!
      topRight.checked = true
      topRight.dispatchEvent(new dom.window.Event('change'))
      select.value = '2'
      select.dispatchEvent(new dom.window.Event('change'))
      dash.checked = false
      dash.dispatchEvent(new dom.window.Event('change'))
      expect(confirm!()).toBe(true)
      expect(bridge.setPageNumberPos).toHaveBeenCalledWith(0, 2, 3, false)
    })
  })
})

describe('the menu items of the new commands', () => {
  it('go right after their studio neighbours, once', () => {
    const { document } = new JSDOM(
      [
        '<div class="md-item" data-cmd="page:new-page-num"></div><div class="md-item" data-cmd="page:x"></div>',
        '<div class="md-item" data-cmd="edit:find-again"></div>',
        '<div class="md-item" data-cmd="insert:symbols"></div>',
      ].join(''),
    ).window
    installHancomMenuItems(document, 'ko')
    installHancomMenuItems(document, 'ko')
    for (const [id, after, name] of MENU_ITEMS) {
      const items = document.querySelectorAll(`.md-item[data-cmd="${id}"]`)
      expect(items, id).toHaveLength(1)
      expect((items[0].previousElementSibling as HTMLElement).dataset.cmd).toBe(after)
      expect(items[0].querySelector('.md-label')?.textContent).toBe(name)
    }
  })

  it('name only commands there are', () => {
    const ids = new Set(hancomCommands('en').map((c) => c.id))
    for (const [id] of MENU_ITEMS) expect(ids).toContain(id)
  })
})

describe('keys the main process takes first and hands back (Ctrl+Shift+S, Ctrl+Shift+H)', () => {
  const studio = (enabled: string[], cellBlock: boolean) => {
    const win: { __kordocHancomKey?: (name: string) => boolean } = {}
    const dispatcher = {
      isEnabled: vi.fn((id: string) => enabled.includes(id)),
      dispatch: vi.fn(() => true),
    }
    const ih = { cursor: { isInCellSelectionMode: () => cellBlock } }
    installHancomMainKeys(win, () => ih, dispatcher)
    return { win, dispatcher }
  }

  it('runs the block sum for Ctrl+Shift+S in a block of cells', () => {
    const { win, dispatcher } = studio(['table:block-sum'], true)
    expect(win.__kordocHancomKey!('ctrl-shift-s')).toBe(true)
    expect(dispatcher.dispatch).toHaveBeenCalledWith('table:block-sum')
  })

  it('leaves Ctrl+Shift+S to "save as" outside a block of cells', () => {
    const { win, dispatcher } = studio(['table:block-sum'], false)
    expect(win.__kordocHancomKey!('ctrl-shift-s')).toBe(false)
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
  })

  it('runs the horizontal sum for Ctrl+Shift+H in a table cell, and leaves it to "home" elsewhere', () => {
    const inCell = studio([EASY_FORMULAS.h.id], false)
    expect(inCell.win.__kordocHancomKey!('ctrl-shift-h')).toBe(true)
    expect(inCell.dispatcher.dispatch).toHaveBeenCalledWith('kordoc:easy-sum-left')
    const outside = studio([], false)
    expect(outside.win.__kordocHancomKey!('ctrl-shift-h')).toBe(false)
  })

  it('says no to a key it does not know and to an editor that throws', () => {
    const { win } = studio([], false)
    expect(win.__kordocHancomKey!('ctrl-shift-x')).toBe(false)
    const broken: { __kordocHancomKey?: (name: string) => boolean } = {}
    installHancomMainKeys(
      broken,
      () => {
        throw new Error('no editor')
      },
      { isEnabled: () => true, dispatch: () => true },
    )
    expect(broken.__kordocHancomKey!('ctrl-shift-s')).toBe(false)
  })
})

// 우리 앱은 Alt+V 를 가로채지 않는다(한컴의 "다른 이름으로 저장"은 앱 저장 창) → rhwp 의 Alt+V,T 글자를 그대로 둔다
describe("rhwp's Alt+V,T", () => {
  it('keeps its label on every platform', () => {
    const def = { id: 'view:border-transparent', shortcutLabel: 'Alt+V,T' }
    expect(withHancomLabel(def, false)).toBe(def)
    expect(withHancomLabel(def, true)).toBe(def)
  })

  it('keeps the label the page wrote into its menu', () => {
    const { document } = new JSDOM(
      '<div class="md-item" data-cmd="view:border-transparent"><span class="md-shortcut">Alt+V,T</span></div>',
    ).window
    installHancomMenuItems(document, 'ko', false)
    expect(document.querySelector('.md-shortcut')!.textContent).toBe('Alt+V,T')
  })
})
