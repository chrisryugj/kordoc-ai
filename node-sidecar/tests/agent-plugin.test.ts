// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
import { describe, expect, it } from 'vitest'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'

interface Cell {
  /** body paragraph the table sits in */
  para: number
  text: string
}

/**
 * A stand-in for the editor: body paragraphs, table cells addressed the way the
 * engine addresses them, and a history that takes one snapshot per transaction.
 */
function fakeEditor(
  body: string[],
  cells: Cell[] = [],
  fields: [name: string, value: string][] = [],
) {
  let state = {
    body: [...body],
    cells: cells.map((cell) => ({ ...cell })),
    fields: fields.map(([name, value]) => ({ name, value })),
  }
  const history: (typeof state)[] = []
  const listeners: (() => void)[] = []
  const emit = () => listeners.forEach((listener) => listener())
  const copy = () => structuredClone(state)
  const cellOf = (json: string) => state.cells[JSON.parse(json)[0].cellIndex]!
  const splice = (text: string, offset: number, length: number, insert: string) =>
    text.slice(0, offset) + insert + text.slice(offset + length)

  const doc = {
    getTextFileText: () =>
      JSON.stringify([...state.body, ...state.cells.map((c) => c.text)].join('\n')),
    searchAllText: (query: string) => {
      const hits: unknown[] = []
      const scan = (text: string, extra: object) => {
        for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) {
          hits.push({ sec: 0, charOffset: at, length: query.length, ...extra })
        }
      }
      state.body.forEach((text, para) => scan(text, { para }))
      state.cells.forEach((cell, cellIdx) =>
        scan(cell.text, { para: cell.para, cellContext: { ctrlIdx: 0, cellIdx, cellPara: 0 } }),
      )
      return JSON.stringify(hits)
    },
    replaceText: (_sec: number, para: number, offset: number, length: number, text: string) => {
      state.body[para] = splice(state.body[para]!, offset, length, text)
      return JSON.stringify({ ok: true })
    },
    deleteTextInCellByPath: (
      _s: number,
      _p: number,
      path: string,
      offset: number,
      length: number,
    ) => {
      const cell = cellOf(path)
      cell.text = splice(cell.text, offset, length, '')
      return JSON.stringify({ ok: true })
    },
    insertTextInCellByPath: (
      _s: number,
      _p: number,
      path: string,
      offset: number,
      text: string,
    ) => {
      const cell = cellOf(path)
      cell.text = splice(cell.text, offset, 0, text)
      return JSON.stringify({ ok: true })
    },
    // reading also walks the body; this stand-in has no table objects to walk into
    getSectionCount: () => 1,
    getParagraphCount: () => state.body.length,
    getControlTextPositions: () => '[]',
    getParagraphLength: (_sec: number, para: number) => state.body[para]!.length,
    getTextRange: (_sec: number, para: number, start: number, count: number) =>
      state.body[para]!.slice(start, start + count),
    getCellParagraphLengthByPath: (_s: number, _p: number, path: string) =>
      cellOf(path).text.length,
    getTextInCellByPath: (_s: number, _p: number, path: string, start: number, count: number) =>
      cellOf(path).text.slice(start, start + count),
    // the engine's ids are its own; they are not the position in the list
    getFieldList: () =>
      JSON.stringify(state.fields.map((field, index) => ({ fieldId: 100 + index, ...field }))),
    setFieldValue: (fieldId: number, value: string) => {
      state.fields[fieldId - 100]!.value = value
      return JSON.stringify({ ok: true })
    },
  }

  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = copy()
      try {
        const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
        history.push(before)
        emit()
        return result
      } catch (thrown) {
        state = before
        throw thrown
      }
    },
    events: { on: (_name: string, handler: () => void) => listeners.push(handler) },
    automation: {
      // the editor's undo; other commands (the plugin's own) do nothing here
      execute: (command: string) => {
        if (command !== 'edit:undo') return null
        const before = history.pop()
        if (!before) return { ok: false }
        state = before
        emit()
        return { ok: true }
      },
    },
  } as unknown as AgentPluginHost

  return {
    plugin: agentPlugin.activate(host),
    text: () => JSON.parse(doc.getTextFileText()) as string,
    fieldValues: () => state.fields.map((field) => field.value),
    /** a change the plugin did not make, as typing in the editor is */
    userTypes: (para: number, text: string) => {
      history.push(copy())
      state.body[para] += text
      emit()
    },
    steps: () => history.length,
  }
}

describe('reading', () => {
  it('returns the document text and where a piece of it occurs', () => {
    const { plugin } = fakeEditor(
      ['구매대행 계약서', '을은 구매대행 업무를 한다'],
      [{ para: 1, text: '구매대행 수수료' }],
    )
    expect(plugin.readText()).toBe('구매대행 계약서\n을은 구매대행 업무를 한다\n구매대행 수수료')
    const found = plugin.findText('구매대행')
    expect(found.count).toBe(3)
    expect(found.matches.map((m) => [m.occurrence, m.inTable])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ])
    expect(found.matches[1]!.context).toContain('을은 구매대행 업무')
  })

  it('refuses an empty search', () => {
    const { plugin } = fakeEditor(['a'])
    expect(() => plugin.findText('')).toThrow(/non-empty/)
  })
})

describe('replacing one occurrence', () => {
  it('replaces a text that occurs once, in the body or in a table cell', () => {
    const editor = fakeEditor(['제출 기한은 3월 2일'], [{ para: 0, text: '담당자: 홍길동' }])
    expect(editor.plugin.replaceText('3월 2일', '3월 9일')).toMatchObject({
      ok: true,
      count: 1,
      inTable: false,
    })
    expect(editor.plugin.replaceText('홍길동', '김철수')).toMatchObject({ ok: true, inTable: true })
    expect(editor.text()).toBe('제출 기한은 3월 9일\n담당자: 김철수')
    expect(editor.steps()).toBe(2)
  })

  it('changes nothing when the text is ambiguous, and lists the places', () => {
    const editor = fakeEditor(['가격 가격'])
    const result = editor.plugin.replaceText('가격', '금액')
    expect(result).toMatchObject({ ok: false, reason: 'ambiguous', count: 2 })
    expect(result.ok === false && result.matches).toHaveLength(2)
    expect(editor.text()).toBe('가격 가격')
    expect(editor.steps()).toBe(0)
  })

  it('replaces the occurrence that was asked for', () => {
    const editor = fakeEditor(['가격 가격 가격'])
    expect(editor.plugin.replaceText('가격', '금액', 2)).toMatchObject({ ok: true })
    expect(editor.text()).toBe('가격 금액 가격')
    expect(editor.plugin.replaceText('가격', '금액', 5)).toMatchObject({
      ok: false,
      reason: 'no_such_occurrence',
    })
  })

  it('reports a text that is not there', () => {
    const editor = fakeEditor(['본문'])
    expect(editor.plugin.replaceText('없는 말', 'x')).toEqual({
      ok: false,
      reason: 'not_found',
      count: 0,
    })
  })

  it('refuses a replacement that would break the paragraph', () => {
    const editor = fakeEditor(['본문'])
    expect(() => editor.plugin.replaceText('본문', '본\n문')).toThrow(/one line/)
    expect(editor.text()).toBe('본문')
  })

  it('deletes with an empty replacement', () => {
    const editor = fakeEditor(['아주 좋은 글'], [{ para: 0, text: '아주 좋은 표' }])
    editor.plugin.replaceText('아주 좋은 글', '좋은 글')
    editor.plugin.replaceText('아주 ', '')
    expect(editor.text()).toBe('좋은 글\n좋은 표')
  })
})

describe('replacing every occurrence', () => {
  it('is one undo step, however many places change', () => {
    const editor = fakeEditor(['갑 갑 갑', '갑'], [{ para: 1, text: '갑과 을' }])
    expect(editor.plugin.replaceAllText('갑', '발주처')).toMatchObject({ ok: true, count: 5 })
    expect(editor.text()).toBe('발주처 발주처 발주처\n발주처\n발주처과 을')
    expect(editor.steps()).toBe(1)
  })

  it('reports when there is nothing to replace', () => {
    const editor = fakeEditor(['본문'])
    expect(editor.plugin.replaceAllText('없음', 'x')).toEqual({
      ok: false,
      reason: 'not_found',
      count: 0,
    })
    expect(editor.steps()).toBe(0)
  })
})

describe('form fields', () => {
  it('lists them by number and fills the one asked for', () => {
    const editor = fakeEditor(
      [''],
      [],
      [
        ['성명', ''],
        ['소속', '총무과'],
      ],
    )
    expect(editor.plugin.listFields()).toEqual([
      { field: 1, name: '성명', guide: '', value: '', inCell: false },
      { field: 2, name: '소속', guide: '', value: '총무과', inCell: false },
    ])
    expect(editor.plugin.fillField(1, '홍길동')).toMatchObject({ ok: true, name: '성명' })
    expect(editor.fieldValues()).toEqual(['홍길동', '총무과'])
    expect(editor.steps()).toBe(1)
  })

  it('tells fields that share a name apart', () => {
    // a form whose fields were never named: each one carries the same guide text
    const guide = '이곳을 마우스로 누르고 내용을 입력하세요.'
    const editor = fakeEditor(
      [''],
      [],
      [
        [guide, ''],
        [guide, ''],
      ],
    )
    editor.plugin.fillField(2, '둘째 칸')
    expect(editor.fieldValues()).toEqual(['', '둘째 칸'])
  })

  it('changes nothing for a number that is not in the list', () => {
    const editor = fakeEditor([''], [], [['성명', '']])
    for (const number of [0, 2, 1.5]) {
      expect(editor.plugin.fillField(number, 'x')).toEqual({
        ok: false,
        reason: 'no_such_field',
        count: 1,
      })
    }
    expect(editor.fieldValues()).toEqual([''])
    expect(editor.steps()).toBe(0)
  })

  it('refuses a value that would break the paragraph', () => {
    const editor = fakeEditor([''], [], [['성명', '']])
    expect(() => editor.plugin.fillField(1, '홍\n길동')).toThrow(/one line/)
  })
})

describe('taking a run back', () => {
  it('undoes exactly the steps of the run', () => {
    const editor = fakeEditor(['하나 둘 셋'])
    const before = editor.plugin.foreignChanges()
    editor.plugin.replaceText('하나', '1')
    editor.plugin.replaceText('둘', '2')
    // the plugin's own changes are not foreign
    expect(editor.plugin.foreignChanges()).toBe(before)
    expect(editor.plugin.undo(2, before)).toMatchObject({ ok: true, undone: 2 })
    expect(editor.text()).toBe('하나 둘 셋')
    // nor is its own undo: a run under this one can still be taken back
    expect(editor.plugin.foreignChanges()).toBe(before)
  })

  it('does nothing once someone else changed the document', () => {
    const editor = fakeEditor(['하나 둘'])
    const before = editor.plugin.foreignChanges()
    editor.plugin.replaceText('하나', '1')
    editor.userTypes(0, ' 셋')
    expect(editor.plugin.foreignChanges()).toBe(before + 1)
    expect(editor.plugin.undo(1, before)).toEqual({ ok: false, reason: 'changed', undone: 0 })
    expect(editor.text()).toBe('1 둘 셋')
  })

  it('says so when the history holds fewer steps than asked', () => {
    const editor = fakeEditor(['하나'])
    const before = editor.plugin.foreignChanges()
    editor.plugin.replaceText('하나', '1')
    expect(editor.plugin.undo(3, before)).toEqual({ ok: false, undone: 1 })
  })

  it('refuses a step count that is not a small positive integer', () => {
    const editor = fakeEditor(['하나'])
    expect(() => editor.plugin.undo(0, 0)).toThrow(/steps/)
    expect(() => editor.plugin.undo(1.5, 0)).toThrow(/steps/)
  })
})

describe('a failing engine call', () => {
  it('surfaces as an Error and leaves the document as it was', () => {
    const editor = fakeEditor(['본문'])
    const host = {
      read: (fn: (d: never) => unknown) =>
        fn({
          searchAllText: () => {
            throw 'engine said no'
          },
        } as never),
      transaction: () => undefined,
      events: { on: () => undefined },
      automation: { execute: () => null },
    } as unknown as AgentPluginHost
    const broken = agentPlugin.activate(host)
    expect(() => broken.findText('본문')).toThrow(Error)
    expect(() => broken.findText('본문')).toThrow(/engine said no/)
    expect(editor.text()).toBe('본문')
  })
})
