// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/hwp-skill.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCall } from '../../src/lib/hwp-agent/types'
import type { AgentBridge } from '../../src/lib/hwp-agent/bridge'
import {
  CONTEXT_MAX_CHARS,
  READ_PAGE_CHARS,
  createHwpSkill,
  type HwpChange,
} from '../../src/lib/hwp-agent/skill'

/** where a change is, as the editor hands it back */
const PLACE = { sec: 0, para: 1, offset: 0, length: 3 }

/** two paragraphs the user selected, the second from its start to the middle */
const SELECTED = [
  { sec: 0, para: 4, offset: 0, length: 9, text: '첫 문단입니다.' },
  { sec: 0, para: 5, offset: 0, length: 5, text: '둘째 문단' },
]

/** the same, as the stretch of two paragraphs it is */
const STRETCH = { segments: SELECTED, inTable: false, contiguous: true }

function setup(overrides: Partial<AgentBridge> = {}) {
  const bridge: AgentBridge = {
    foreignChanges: vi.fn(async () => 0),
    readText: vi.fn(async () => '제목\n본문입니다'),
    findText: vi.fn(async () => ({ count: 0, matches: [] })),
    replaceText: vi.fn(async () => ({ ok: true as const, count: 1, inTable: false })),
    replaceAllText: vi.fn(async () => ({ ok: true as const, count: 3 })),
    insertParagraphs: vi.fn(async () => ({ ok: true as const, count: 2, inTable: false })),
    deleteParagraph: vi.fn(async () => ({
      ok: true as const,
      text: '지울 문단입니다.',
      emptied: false,
      inTable: false,
    })),
    insertTable: vi.fn(async () => ({ ok: true as const, rows: 2, cols: 3, inTable: false })),
    formatText: vi.fn(async () => ({ ok: true as const, count: 1 })),
    formatParagraph: vi.fn(async () => ({ ok: true as const, inTable: false })),
    listTables: vi.fn(async () => ({ count: 0, partial: false, tables: [] })),
    readTable: vi.fn(async () => ({
      ok: true as const,
      table: 1,
      rows: 2,
      cols: 2,
      cells: [
        { row: 1, col: 1, text: '성명' },
        { row: 1, col: 2, text: '' },
        { row: 2, col: 1, colSpan: 2, text: '첫 줄\n둘째 줄', fields: [3] },
        { row: 3, col: 1, text: '', object: true as const },
      ],
    })),
    fillCells: vi.fn(async () => ({ ok: true as const, table: 1, count: 2, place: PLACE })),
    addTableLines: vi.fn(async () => ({
      ok: true as const,
      table: 1,
      rows: 5,
      cols: 4,
      first: 3,
      count: 2,
      place: PLACE,
    })),
    removeTableLines: vi.fn(async () => ({
      ok: true as const,
      table: 1,
      rows: 2,
      cols: 4,
      count: 1,
      text: '연락처 | 비고',
      place: PLACE,
    })),
    deleteTable: vi.fn(async () => ({
      ok: true as const,
      table: 3,
      rows: 4,
      cols: 2,
      inner: 0,
      text: '성취율 | 성취도 | 80% 이상 ~ 100% | A',
      place: PLACE,
    })),
    reveal: vi.fn(async () => ({ ok: true })),
    selection: vi.fn(async () => ({ ok: false as const, reason: 'none' as const })),
    // one run per text, as the editor answers: a rewrite may change how many there are
    replaceSelection: vi.fn(async (segments: typeof SELECTED, texts: string[]) => ({
      ok: true as const,
      segments: texts.map((text, index) => ({
        ...(segments[index] ?? segments[segments.length - 1]!),
        length: text.length,
        text,
      })),
      place: PLACE,
    })),
    formatSelection: vi.fn(async () => ({ ok: true as const, count: 2, place: PLACE })),
    listFields: vi.fn(async () => []),
    fillField: vi.fn(async () => ({ ok: true as const, name: '성명' })),
    insertToc: vi.fn(async () => ({
      ok: true as const,
      count: 2,
      pages: [1, 3],
      place: PLACE,
    })),
    refreshToc: vi.fn(async () => ({
      ok: true as const,
      lines: 2,
      changed: 1,
      place: PLACE,
    })),
    listNotes: vi.fn(async () => ({ count: 0, elsewhere: 0, notes: [] })),
    listStyles: vi.fn(async () => ['바탕글', '본문', '개요 1']),
    formatCells: vi.fn(async () => ({
      ok: true,
      count: 1,
      place: { sec: 0, para: 0, offset: 0, length: 0 },
    })),
    mergeCells: vi.fn(async () => ({
      ok: true as const,
      merged: 4,
      place: { sec: 0, para: 0, offset: 0, length: 0 },
    })),
    splitCell: vi.fn(async () => ({
      ok: true as const,
      unmerged: false,
      place: { sec: 0, para: 0, offset: 0, length: 0 },
    })),
    insertNote: vi.fn(async () => ({
      ok: true as const,
      kind: 'footnote' as const,
      number: 2,
      place: PLACE,
    })),
    editNote: vi.fn(async () => ({
      ok: true as const,
      kind: 'endnote' as const,
      number: 1,
      was: '옛 설명',
      place: PLACE,
    })),
    deleteNote: vi.fn(async () => ({
      ok: true as const,
      kind: 'footnote' as const,
      number: 3,
      text: '지운 각주',
      place: PLACE,
    })),
    undo: vi.fn(async () => ({ ok: true, undone: 1 })),
    ...overrides,
  }
  const changes: HwpChange[] = []
  const { skill, refreshContext, setSelection } = createHwpSkill({
    bridge,
    // the key and its parameters, so a test can tell which label was asked for
    label: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    onChange: (change) => changes.push(change),
  })
  const call = (name: string, input: Record<string, unknown> = {}) =>
    skill.executeTool({ id: '1', name, input } satisfies AgentToolCall)
  return { bridge, skill, refreshContext, setSelection, changes, call }
}

describe('the document context sent with a message', () => {
  it('is empty until it has been read', () => {
    expect(setup().skill.buildContext!()).toBe('')
  })

  it('carries a short document whole, with its field names', async () => {
    const { skill, refreshContext } = setup({
      listFields: async () => [
        { field: 1, name: '성명', guide: '', value: '', inCell: false },
        { field: 2, name: '', guide: '날짜를 쓰세요', value: '', inCell: false },
      ],
    })
    await refreshContext()
    const context = skill.buildContext!()
    expect(context).toContain('Text (complete):\n제목\n본문입니다')
    // numbered, because the number is what fill_field takes
    expect(context).toContain('Form fields (2): 1. 성명, 2. 날짜를 쓰세요')
    expect(context).toContain('Tables: none.')
    // the names a format's style takes
    expect(context).toContain('Paragraph styles: 바탕글, 본문, 개요 1')
  })

  it('says how many tables there are, and that their empty cells are not in the text', async () => {
    const { skill, refreshContext } = setup({
      listTables: async () => ({ count: 4, partial: false, tables: [] }),
    })
    await refreshContext()
    expect(skill.buildContext!()).toContain('Tables: 4 (list_tables lists them')
  })

  it('carries only the opening of a long document and points at read_document', async () => {
    const long = '가'.repeat(CONTEXT_MAX_CHARS + 500)
    const { skill, refreshContext } = setup({ readText: async () => long })
    await refreshContext()
    const context = skill.buildContext!()
    expect(context).toContain(`Length: ${long.length} characters.`)
    expect(context).toContain('read_document returns the rest')
    expect(context.length).toBeLessThan(CONTEXT_MAX_CHARS + 500)
  })

  it('says so when the document cannot be read, instead of failing the send', async () => {
    const { skill, refreshContext } = setup({
      readText: async () => {
        throw new Error('gone')
      },
    })
    await expect(refreshContext()).resolves.toBeUndefined()
    expect(skill.buildContext!()).toContain('could not be read')
  })
})

describe('read_document', () => {
  it('pages through a long document', async () => {
    const long = 'a'.repeat(READ_PAGE_CHARS) + 'TAIL'
    const { call } = setup({ readText: async () => long })
    const first = await call('read_document')
    expect(first.output).toContain(`[more: call read_document with offset ${READ_PAGE_CHARS}]`)
    expect(first.mutated).toBeUndefined()
    const second = await call('read_document', { offset: READ_PAGE_CHARS })
    expect(second.output.endsWith('TAIL')).toBe(true)
  })
})

describe('find_text', () => {
  it('lists the occurrences with their surroundings', async () => {
    const { call } = setup({
      findText: async () => ({
        count: 25,
        matches: [
          { occurrence: 1, inTable: false, context: '제1조 구매대행 계약' },
          { occurrence: 2, inTable: true, context: '구매대행 수수료' },
          { occurrence: 3, inTable: false, replaceable: false },
        ],
      }),
    })
    const result = await call('find_text', { text: '구매대행' })
    expect(result.output).toContain('25 occurrence(s).')
    expect(result.output).toContain('#1: …제1조 구매대행 계약…')
    expect(result.output).toContain('#2 (in a table): …구매대행 수수료…')
    expect(result.output).toContain('#3: inside an equation')
    expect(result.output).toContain('only the first 3 are listed')
    expect(result.summary).toBe('aiToolFind:{"text":"구매대행","count":25}')
  })
})

describe('replace_text', () => {
  it('reports the change to the panel and marks the run as having edited', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('replace_text', { find: '본문', replace: '내용' })
    expect(bridge.replaceText).toHaveBeenCalledWith('본문', '내용', null)
    expect(result).toMatchObject({ mutated: true, summary: '“본문” → “내용”' })
    expect(changes).toEqual([{ kind: 'replace', from: '본문', to: '내용', count: 1 }])
  })

  it('passes the occurrence on', async () => {
    const { call, bridge } = setup()
    await call('replace_text', { find: '본문', replace: '내용', occurrence: 2 })
    expect(bridge.replaceText).toHaveBeenCalledWith('본문', '내용', 2)
  })

  it('tells the model how to disambiguate, and records no change', async () => {
    const { call, changes } = setup({
      replaceText: async () => ({
        ok: false,
        reason: 'ambiguous',
        count: 2,
        matches: [
          { occurrence: 1, inTable: false, context: '앞 가격 뒤' },
          { occurrence: 2, inTable: false, context: '또 가격 끝' },
        ],
      }),
    })
    const result = await call('replace_text', { find: '가격', replace: '금액' })
    expect(result.isError).toBe(true)
    expect(result.mutated).toBeUndefined()
    expect(result.output).toContain('occurs 2 times')
    expect(result.output).toContain('#2: …또 가격 끝…')
    expect(result.summary).toBe('aiToolNotDone:{"what":"가격"}')
    expect(changes).toEqual([])
  })

  it('never sends text with a line break to the editor', async () => {
    const { call, bridge } = setup()
    const result = await call('replace_text', { find: '본문', replace: '첫 줄\n둘째 줄' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('line break')
    expect(bridge.replaceText).not.toHaveBeenCalled()
  })

  it('accepts an empty replacement as a deletion', async () => {
    const { call, bridge } = setup()
    expect((await call('replace_text', { find: '본문', replace: '' })).mutated).toBe(true)
    expect(bridge.replaceText).toHaveBeenCalledWith('본문', '', null)
  })

  it('turns a refusal of the editor into an error result the model can read', async () => {
    const { call, changes } = setup({
      replaceText: async () => {
        throw new Error('the editor refused to replace')
      },
    })
    const result = await call('replace_text', { find: '본문', replace: '내용' })
    expect(result).toMatchObject({ isError: true, output: 'the editor refused to replace' })
    expect(changes).toEqual([])
  })
})

describe('replace_all', () => {
  it('reports one change covering every place', async () => {
    const { call, changes } = setup()
    const result = await call('replace_all', { find: '갑', replace: '발주처' })
    expect(result).toMatchObject({ mutated: true, summary: '“갑” → “발주처” ×3' })
    expect(changes).toEqual([{ kind: 'replaceAll', from: '갑', to: '발주처', count: 3 }])
  })

  it('reports a text that is not there', async () => {
    const { call, changes } = setup({
      replaceAllText: async () => ({ ok: false, reason: 'not_found', count: 0 }),
    })
    expect((await call('replace_all', { find: '없음', replace: 'x' })).isError).toBe(true)
    expect(changes).toEqual([])
  })
})

describe('insert_paragraphs', () => {
  it('adds the paragraphs next to the anchor and reports one change', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('insert_paragraphs', {
      where: 'after',
      anchor: '본문입니다',
      paragraphs: ['ㅇ 첫째 항목', '', 'ㅇ 둘째 항목'],
    })
    expect(bridge.insertParagraphs).toHaveBeenCalledWith('본문입니다', null, 'after', [
      'ㅇ 첫째 항목',
      '',
      'ㅇ 둘째 항목',
    ])
    expect(result).toMatchObject({ mutated: true, summary: 'aiToolInsert:{"count":2}' })
    // empty lines are layout, not content: the list shows the text that came in
    expect(changes).toEqual([
      { kind: 'insert', from: '', to: 'ㅇ 첫째 항목 ⏎ ㅇ 둘째 항목', count: 1 },
    ])
  })

  it('needs no anchor for the end of the document', async () => {
    const { call, bridge } = setup()
    expect((await call('insert_paragraphs', { where: 'end', paragraphs: ['끝.'] })).mutated).toBe(
      true,
    )
    expect(bridge.insertParagraphs).toHaveBeenCalledWith('', null, 'end', ['끝.'])
  })

  it('asks for an anchor otherwise, and for one-line paragraphs', async () => {
    const { call, bridge } = setup()
    expect((await call('insert_paragraphs', { where: 'after', paragraphs: ['x'] })).isError).toBe(
      true,
    )
    expect(
      (await call('insert_paragraphs', { where: 'beside', anchor: 'a', paragraphs: ['x'] }))
        .isError,
    ).toBe(true)
    const broken = await call('insert_paragraphs', {
      where: 'after',
      anchor: '본문',
      paragraphs: ['한 줄\n두 줄'],
    })
    expect(broken.output).toContain('line break')
    expect(bridge.insertParagraphs).not.toHaveBeenCalled()
  })

  it('tells the model when an object is in the way', async () => {
    const { call, changes } = setup({
      insertParagraphs: async () => ({ ok: false, reason: 'has_objects', count: 1 }),
    })
    const result = await call('insert_paragraphs', {
      where: 'before',
      anchor: '제목',
      paragraphs: ['x'],
    })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('a table, a picture or a form field')
    expect(result.summary).toBe('aiToolNotDone:{"what":"제목"}')
    expect(changes).toEqual([])
  })

  it('lists the places when the anchor is ambiguous', async () => {
    const { call } = setup({
      insertParagraphs: async () => ({
        ok: false,
        reason: 'ambiguous',
        count: 2,
        matches: [
          { occurrence: 1, inTable: false, context: '첫 문단' },
          { occurrence: 2, inTable: true, context: '표 안 문단' },
        ],
      }),
    })
    const result = await call('insert_paragraphs', {
      where: 'after',
      anchor: '문단',
      paragraphs: ['x'],
    })
    expect(result.output).toContain('occurs 2 times')
    expect(result.output).toContain('#2 (in a table): …표 안 문단…')
  })
})

describe('delete_paragraph', () => {
  it('reports the removed text as a change', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('delete_paragraph', { find: '지울 문단', occurrence: 2 })
    expect(bridge.deleteParagraph).toHaveBeenCalledWith('지울 문단', 2)
    expect(result).toMatchObject({ mutated: true, output: 'Removed the paragraph.' })
    expect(changes).toEqual([{ kind: 'delete', from: '지울 문단입니다.', to: '', count: 1 }])
  })

  it('says so when the paragraph could only be emptied', async () => {
    const { call } = setup({
      deleteParagraph: async () => ({ ok: true, text: '첫 줄', emptied: true, inTable: true }),
    })
    expect((await call('delete_paragraph', { find: '첫 줄' })).output).toContain('emptied')
  })
})

describe('insert_table', () => {
  it('adds the table and lists it by its first row', async () => {
    const { call, changes, bridge } = setup()
    const rows = [
      ['항목', '기한', '비고'],
      ['신청서', '3월 2일'],
    ]
    const result = await call('insert_table', { where: 'after', anchor: '본문입니다', rows })
    expect(bridge.insertTable).toHaveBeenCalledWith('본문입니다', null, 'after', rows, false)
    expect(result).toMatchObject({ mutated: true, summary: 'aiToolTable:{"rows":2,"cols":3}' })
    expect(changes).toEqual([{ kind: 'table', from: '', to: '항목 | 기한 | 비고', count: 1 }])
  })

  it('passes the header option on', async () => {
    const { call, bridge } = setup()
    await call('insert_table', { where: 'end', rows: [['이름', '소속']], header: true })
    expect(bridge.insertTable).toHaveBeenCalledWith('', null, 'end', [['이름', '소속']], true)
  })

  it('tells the model that a table cannot go inside a table', async () => {
    const { call, changes } = setup({
      insertTable: async () => ({ ok: false, reason: 'in_table', count: 1 }),
    })
    const result = await call('insert_table', { where: 'after', anchor: '대상', rows: [['가']] })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('inside another table')
    expect(changes).toEqual([])
  })

  it('refuses rows that are not lists of one-line text', async () => {
    const { call, bridge } = setup()
    expect((await call('insert_table', { where: 'end', rows: [] })).isError).toBe(true)
    expect((await call('insert_table', { where: 'end', rows: [['가\n나']] })).isError).toBe(true)
    expect((await call('insert_table', { where: 'end', rows: ['가', '나'] })).isError).toBe(true)
    expect(bridge.insertTable).not.toHaveBeenCalled()
  })
})

describe('format_text', () => {
  it('sends only the properties the model named, and lists what was set', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('format_text', {
      find: '본문',
      occurrence: 2,
      bold: true,
      underline: false,
      size: 14,
      color: '#C00000',
    })
    expect(bridge.formatText).toHaveBeenCalledWith('본문', 2, false, {
      bold: true,
      underline: false,
      size: 14,
      color: '#C00000',
    })
    expect(result).toMatchObject({ mutated: true, summary: 'aiToolFormat:{"text":"본문"}' })
    expect(changes).toEqual([
      {
        kind: 'format',
        from: '본문',
        to: 'aiFmtBold · aiFmtOff:{"name":"aiFmtUnderline"} · 14pt · aiFmtColor #C00000',
        count: 1,
      },
    ])
  })

  it('formats every occurrence with all, and counts them', async () => {
    const { call, changes } = setup({ formatText: async () => ({ ok: true, count: 5 }) })
    const result = await call('format_text', { find: '갑', all: true, highlight: 'none' })
    expect(result.output).toBe('Formatted 5 occurrence(s).')
    expect(changes[0]).toMatchObject({ count: 5, to: 'aiFmtOff:{"name":"aiFmtHighlight"}' })
  })

  it('asks for a property when none was named', async () => {
    const { call, bridge } = setup()
    const result = await call('format_text', { find: '본문' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('at least one property')
    expect(bridge.formatText).not.toHaveBeenCalled()
  })

  it('offers both ways out when the text is ambiguous', async () => {
    const { call, changes } = setup({
      formatText: async () => ({
        ok: false,
        reason: 'ambiguous',
        count: 2,
        matches: [
          { occurrence: 1, inTable: false, context: '첫 문단' },
          { occurrence: 2, inTable: false, context: '둘째 문단' },
        ],
      }),
    })
    const result = await call('format_text', { find: '문단', bold: true })
    expect(result.output).toContain('Pass occurrence to pick one, or all')
    expect(result.output).toContain('#2: …둘째 문단…')
    expect(changes).toEqual([])
  })

  it('hands a value the editor refuses back to the model', async () => {
    const { call } = setup({
      formatText: async () => {
        throw new Error('color must look like #RRGGBB')
      },
    })
    const result = await call('format_text', { find: '본문', color: 'red' })
    expect(result).toMatchObject({ isError: true, output: 'color must look like #RRGGBB' })
  })
})

describe('format_paragraph', () => {
  it('sends alignment and line spacing with the character formatting', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('format_paragraph', {
      find: '제목',
      align: 'center',
      line_spacing: 180,
      bold: true,
    })
    expect(bridge.formatParagraph).toHaveBeenCalledWith('제목', null, {
      bold: true,
      align: 'center',
      lineSpacing: 180,
    })
    expect(result.mutated).toBe(true)
    expect(changes).toEqual([
      {
        kind: 'format',
        from: '제목',
        to: 'aiFmtAlignCenter · aiFmtBold · aiFmtLineSpacing 180%',
        count: 1,
      },
    ])
  })

  it('sends indents, margins, spacing, a style and a font under the editor’s names', async () => {
    const { call, changes, bridge } = setup()
    await call('format_paragraph', {
      find: '제목',
      indent: -10,
      margin_left: 20,
      margin_right: 5,
      space_before: 6,
      space_after: 12,
      style: '개요 1',
      font: '맑은 고딕',
    })
    expect(bridge.formatParagraph).toHaveBeenCalledWith('제목', null, {
      font: '맑은 고딕',
      indent: -10,
      style: '개요 1',
      marginLeft: 20,
      marginRight: 5,
      spacingBefore: 6,
      spacingAfter: 12,
    })
    expect(changes[0]!.to).toBe(
      'aiFmtFont 맑은 고딕 · aiFmtStyle 개요 1 · aiFmtIndent -10pt · aiFmtMarginLeft 20pt · aiFmtMarginRight 5pt · aiFmtSpaceBefore 6pt · aiFmtSpaceAfter 12pt',
    )
  })

  it('names the styles there are when the model asks for one that is not', async () => {
    const { call, changes } = setup({
      formatParagraph: async () => ({
        ok: false,
        reason: 'no_such_style',
        styles: ['바탕글', '본문'],
      }),
    })
    const result = await call('format_paragraph', { find: '제목', style: '제목 1' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('바탕글, 본문')
    expect(changes).toEqual([])
  })

  it('says what can still be done where a paragraph cannot be aligned', async () => {
    const { call, changes } = setup({
      formatParagraph: async () => ({ ok: false, reason: 'unsupported_place', count: 1 }),
    })
    const result = await call('format_paragraph', { find: '안쪽 표', align: 'center' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('format_text')
    expect(changes).toEqual([])
  })
})

describe('merge_cells and split_cell', () => {
  it('merges a range and lists the change on the table', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('merge_cells', {
      table: 1,
      from_row: 1,
      from_col: 1,
      to_row: 2,
      to_col: 2,
    })
    expect(bridge.mergeCells).toHaveBeenCalledWith(1, { row: 1, col: 1 }, { row: 2, col: 2 })
    expect(result).toMatchObject({ mutated: true, output: 'Merged 4 cell(s) into one.' })
    expect(changes[0]).toMatchObject({ kind: 'lines', to: 'aiCellsMerged:{"range":"1.1–2.2"}' })
  })

  it('says which merged cells cut through the range', async () => {
    const { call, changes } = setup({
      mergeCells: async () => ({
        ok: false,
        reason: 'crosses_merged',
        cells: [{ row: 1, col: 1 }],
      }),
    })
    const result = await call('merge_cells', {
      table: 1,
      from_row: 1,
      from_col: 2,
      to_row: 2,
      to_col: 3,
    })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('1.1')
    expect(changes).toEqual([])
  })

  it('refuses a range of one cell before asking the editor', async () => {
    const { call, bridge } = setup()
    const result = await call('merge_cells', {
      table: 1,
      from_row: 2,
      from_col: 2,
      to_row: 2,
      to_col: 2,
    })
    expect(result.isError).toBe(true)
    expect(bridge.mergeCells).not.toHaveBeenCalled()
  })

  it('splits a cell into rows and columns, or a merged cell back', async () => {
    const { call, changes, bridge } = setup()
    await call('split_cell', { table: 1, row: 2, col: 2, rows: 2, cols: 3 })
    expect(bridge.splitCell).toHaveBeenCalledWith(1, 2, 2, 2, 3)
    expect(changes[0]!.to).toBe('aiCellSplit:{"cell":"2.2","rows":2,"cols":3}')
    await call('split_cell', { table: 1, row: 1, col: 1 })
    expect(bridge.splitCell).toHaveBeenLastCalledWith(1, 1, 1, null, null)
  })

  it('tells the model a cell that is not merged needs rows and cols', async () => {
    const { call } = setup({ splitCell: async () => ({ ok: false, reason: 'not_merged' }) })
    const result = await call('split_cell', { table: 1, row: 1, col: 1 })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('rows and cols')
  })
})

describe('format_cells', () => {
  it('colours the cells and lists the change on the table', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('format_cells', {
      table: 2,
      cells: [{ row: 1, col: 1 }],
      background: '#ffe08a',
    })
    expect(bridge.formatCells).toHaveBeenCalledWith(2, [{ row: 1, col: 1 }], '#ffe08a')
    expect(result.mutated).toBe(true)
    expect(changes[0]).toMatchObject({
      kind: 'format',
      from: 'aiTableName:{"table":2}',
      to: 'aiFmtCellFill #ffe08a',
      count: 1,
    })
  })

  it('tells the model which places are not in the table', async () => {
    const { call, changes } = setup({
      formatCells: async () => ({
        ok: false,
        reason: 'no_such_cell',
        cells: [{ row: 5, col: 1 }],
        rows: 2,
        cols: 2,
      }),
    })
    const result = await call('format_cells', {
      table: 1,
      cells: [{ row: 5, col: 1 }],
      background: 'none',
    })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('2 row(s) and 2 column(s)')
    expect(result.output).toContain('5.1')
    expect(changes).toEqual([])
  })

  it('refuses a call without cells before asking the editor', async () => {
    const { call, bridge } = setup()
    const result = await call('format_cells', { table: 1, cells: [], background: '#000000' })
    expect(result.isError).toBe(true)
    expect(bridge.formatCells).not.toHaveBeenCalled()
  })
})

describe('tables that are already in the document', () => {
  it('lists them with size, place and first cells', async () => {
    const { call } = setup({
      listTables: async () => ({
        count: 3,
        partial: false,
        tables: [
          { table: 1, rows: 3, cols: 4, near: '참여 인력', preview: ['성명', '소속'] },
          { table: 2, rows: 1, cols: 2, inTable: 1, near: '', preview: [] },
        ],
      }),
    })
    const result = await call('list_tables')
    expect(result.output.split('\n')).toEqual([
      'Table 1: 3 row(s) × 4 column(s), after the line “참여 인력”. Starts: 성명 | 소속',
      'Table 2: 1 row(s) × 2 column(s), inside a cell of table 1. No text.',
      '(only the first 2 of 3 are listed)',
    ])
    expect(result.summary).toBe('aiToolTables:{"count":3}')
  })

  it('says so when there are none', async () => {
    expect((await setup().call('list_tables')).output).toBe('This document has no tables.')
  })

  it('reads a table as one line per cell, empty cells and merged cells marked', async () => {
    const { call, bridge } = setup()
    const result = await call('read_table', { table: 1 })
    expect(bridge.readTable).toHaveBeenCalledWith(1, null)
    expect(result.output.split('\n')).toEqual([
      'Table 1: 2 row(s) × 2 column(s). Cells as row.col:',
      '1.1: 성명',
      '1.2: (empty)',
      '2.1 (merged up to 2.2) [form field #3]: 첫 줄 ⏎ 둘째 줄',
      '3.1 [holds a picture or another object: not empty]: (no text)',
    ])
    expect(result.summary).toBe('aiToolReadTable:{"table":1}')
  })

  it('names the row to go on from when the table is long', async () => {
    const { call, bridge } = setup({
      readTable: vi.fn(async () => ({
        ok: true as const,
        table: 2,
        rows: 900,
        cols: 3,
        cells: [{ row: 201, col: 1, text: 'x' }],
        nextRow: 401,
      })),
    })
    const result = await call('read_table', { table: 2, from_row: 201 })
    expect(bridge.readTable).toHaveBeenCalledWith(2, 201)
    expect(result.output).toContain('[more rows: call read_table with from_row 401]')
  })

  it('points at list_tables for a number that is not there', async () => {
    const { call } = setup({
      readTable: async () => ({ ok: false, reason: 'no_such_table', count: 2 }),
    })
    const result = await call('read_table', { table: 5 })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('the document has 2')
    expect(result.summary).toBe('aiToolNotDone:{"what":"aiTableName:{\\"table\\":5}"}')
  })

  it('fills cells in one call and reports one change', async () => {
    const { call, changes, bridge } = setup()
    const cells = [
      { row: 1, col: 2, text: '홍길동' },
      { row: 2, col: 2, text: '교무기획부' },
    ]
    const result = await call('fill_cells', { table: 1, cells })
    expect(bridge.fillCells).toHaveBeenCalledWith(1, cells, false)
    expect(result.mutated).toBe(true)
    expect(result.summary).toBe('aiToolFillCells:{"table":1,"count":2}')
    expect(changes).toEqual([
      {
        kind: 'cells',
        from: 'aiTableName:{"table":1}',
        to: '홍길동 | 교무기획부',
        count: 2,
        // the place travels with the change, for the panel to show it in the document
        place: PLACE,
      },
    ])
  })

  it('passes overwrite only when the model asked for it', async () => {
    const { call, bridge } = setup()
    const cells = [{ row: 1, col: 2, text: 'x' }]
    await call('fill_cells', { table: 1, cells, overwrite: true })
    expect(bridge.fillCells).toHaveBeenCalledWith(1, cells, true)
  })

  it('lists the cells that hold text when nothing was written', async () => {
    const { call, changes } = setup({
      fillCells: async () => ({
        ok: false,
        reason: 'occupied',
        cells: [{ row: 2, col: 4, text: '기존 내용' }],
        rows: 3,
        cols: 4,
      }),
    })
    const result = await call('fill_cells', { table: 1, cells: [{ row: 2, col: 4, text: 'x' }] })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('2.4: 기존 내용')
    expect(result.output).toContain('overwrite')
    expect(changes).toEqual([])
  })

  it('names the places that are outside the table, and cells with several fields', async () => {
    const outside = setup({
      fillCells: async () => ({
        ok: false,
        reason: 'no_such_cell',
        cells: [{ row: 9, col: 1 }],
        rows: 3,
        cols: 4,
      }),
    })
    const cells = [{ row: 9, col: 1, text: 'x' }]
    expect((await outside.call('fill_cells', { table: 1, cells })).output).toContain(
      '3 row(s) and 4 column(s), and these places are not in it: 9.1',
    )
    const fielded = setup({
      fillCells: async () => ({
        ok: false,
        reason: 'has_fields',
        cells: [{ row: 1, col: 2, fields: [1, 2] }],
        rows: 3,
        cols: 4,
      }),
    })
    expect((await fielded.call('fill_cells', { table: 1, cells })).output).toContain('fill_field')
    const picture = setup({
      fillCells: async () => ({
        ok: false,
        reason: 'holds_object',
        cells: [{ row: 1, col: 1 }],
        rows: 3,
        cols: 4,
      }),
    })
    expect((await picture.call('fill_cells', { table: 1, cells })).output).toContain(
      'hold a picture or another object, so they are not empty and text would land on top of it: 1.1',
    )
  })

  it('never sends cells it cannot read to the editor', async () => {
    const { call, bridge } = setup()
    expect((await call('fill_cells', { table: 1, cells: [] })).isError).toBe(true)
    expect((await call('fill_cells', { table: 1, cells: [{ row: 1, text: 'x' }] })).isError).toBe(
      true,
    )
    expect((await call('fill_cells', { cells: [{ row: 1, col: 1, text: 'x' }] })).isError).toBe(
      true,
    )
    expect(bridge.fillCells).not.toHaveBeenCalled()
  })
})

describe('the part the user selected', () => {
  it('is put in front of the model with one line per selected paragraph', async () => {
    const { skill, refreshContext, setSelection } = setup()
    await refreshContext()
    expect(skill.buildContext!()).not.toContain('Selected text')
    setSelection({ segments: SELECTED, inTable: true, contiguous: true })
    expect(skill.buildContext!().split('\n').slice(-4)).toEqual([
      '## Selected text',
      'The user selected 2 paragraph(s), inside a table in the editor. The request is about this part:',
      '1. 첫 문단입니다.',
      '2. 둘째 문단',
    ])
    setSelection(null)
    expect(skill.buildContext!()).not.toContain('Selected text')
  })

  it('replaces the selection with one text per paragraph and lists one change', async () => {
    const { call, changes, bridge, setSelection } = setup()
    setSelection(STRETCH)
    const result = await call('replace_selection', {
      paragraphs: ['첫째 단락입니다.', '둘째 단락'],
    })
    expect(bridge.replaceSelection).toHaveBeenCalledWith(SELECTED, [
      '첫째 단락입니다.',
      '둘째 단락',
    ])
    expect(result.mutated).toBe(true)
    expect(changes).toEqual([
      {
        kind: 'replace',
        from: '첫 문단입니다. ⏎ 둘째 문단',
        to: '첫째 단락입니다. ⏎ 둘째 단락',
        count: 1,
        place: PLACE,
      },
    ])
  })

  it('goes on from the text it just wrote', async () => {
    const { call, bridge, setSelection, skill } = setup()
    setSelection(STRETCH)
    await call('replace_selection', { paragraphs: ['가', '나'] })
    await call('format_selection', { bold: true })
    const sent = vi.mocked(bridge.formatSelection).mock.calls[0]![0]
    expect(sent.map((segment) => segment.text)).toEqual(['가', '나'])
    expect(sent.map((segment) => segment.length)).toEqual([1, 1])
    expect(skill.buildContext!()).toContain('1. 가')
  })

  it('formats the selection and lists what was set', async () => {
    const { call, changes, setSelection } = setup()
    setSelection(STRETCH)
    const result = await call('format_selection', { bold: true, align: 'center' })
    expect(result.summary).toBe('aiToolFormat:{"text":"첫 문단입니다. ⏎ 둘째 문단"}')
    expect(changes[0]).toMatchObject({
      kind: 'format',
      count: 2,
      to: 'aiFmtAlignCenter · aiFmtBold',
    })
  })

  it('lets a stretch of text become more or fewer paragraphs', async () => {
    const { call, bridge, setSelection, skill } = setup()
    setSelection(STRETCH)
    const result = await call('replace_selection', { paragraphs: ['가', '나', '다'] })
    expect(bridge.replaceSelection).toHaveBeenCalledWith(SELECTED, ['가', '나', '다'])
    expect(result.output).toBe('Replaced the selected text: its 2 paragraph(s) are now 3.')
    expect(skill.buildContext!()).toContain('The user selected 3 paragraph(s)')
  })

  it('wants one text per paragraph when the selection is table cells or separate places', async () => {
    const { call, bridge, setSelection, skill } = setup()
    setSelection({ segments: SELECTED, inTable: true, contiguous: false })
    expect(skill.buildContext!()).toContain('They are not one stretch of text')
    const result = await call('replace_selection', { paragraphs: ['하나만'] })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Pass exactly 2 string(s)')
    expect(bridge.replaceSelection).not.toHaveBeenCalled()
    // as many texts as paragraphs go through
    await call('replace_selection', { paragraphs: ['가', '나'] })
    expect(bridge.replaceSelection).toHaveBeenCalledTimes(1)
  })

  it('replaces a part of the selection from a paragraph number on', async () => {
    const { call, bridge, setSelection, skill } = setup()
    setSelection(STRETCH)
    await call('replace_selection', { paragraphs: ['새 둘째'], first: 2 })
    expect(bridge.replaceSelection).toHaveBeenCalledWith([SELECTED[1]], ['새 둘째'])
    const context = skill.buildContext!()
    expect(context).toContain('1. 첫 문단입니다.')
    expect(context).toContain('2. 새 둘째')
    const outside = await call('replace_selection', { paragraphs: ['a', 'b'], first: 2 })
    expect(outside.isError).toBe(true)
    expect(outside.output).toContain('paragraphs 2–3 are not all in it')
  })

  it('shows a long selection in part and reads on by number', async () => {
    const { call, setSelection, skill } = setup()
    const many = Array.from({ length: 400 }, (_unused, index) => ({
      sec: 0,
      para: index,
      offset: 0,
      length: 30,
      text: `${String(index + 1).padStart(3, '0')}번째 문단입니다. 스물여섯 글자를 채웁니다.`,
    }))
    setSelection({ segments: many, inTable: false, contiguous: true })
    const context = skill.buildContext!()
    expect(context).toContain('The user selected 400 paragraph(s)')
    const shown = context.split('\n').filter((line) => /^\d+\. /.test(line)).length
    expect(shown).toBeGreaterThan(50)
    expect(shown).toBeLessThan(400)
    expect(context).toContain(
      `[paragraphs ${shown + 1}–400 are not shown: read_selection with from ${shown + 1} returns them]`,
    )
    const rest = await call('read_selection', { from: shown + 1 })
    expect(rest.output.split('\n')[0]).toBe(`Paragraphs ${shown + 1}–400 of 400 selected.`)
    expect(rest.output).toContain('400. 400번째 문단입니다.')
    expect((await call('read_selection', { from: 401 })).isError).toBe(true)
  })

  it('refuses a text of several lines', async () => {
    const { call, bridge, setSelection } = setup()
    setSelection(STRETCH)
    expect((await call('replace_selection', { paragraphs: ['a\nb', 'c'] })).isError).toBe(true)
    expect(bridge.replaceSelection).not.toHaveBeenCalled()
  })

  it('says so when nothing is selected, and when the selected text is gone', async () => {
    const none = setup()
    const result = await none.call('replace_selection', { paragraphs: ['x'] })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Nothing is selected')
    expect((await none.call('format_selection', { bold: true })).output).toContain(
      'Nothing is selected',
    )
    const gone = setup({ replaceSelection: async () => ({ ok: false, reason: 'changed' }) })
    gone.setSelection(STRETCH)
    const stale = await gone.call('replace_selection', { paragraphs: ['a', 'b'] })
    expect(stale.isError).toBe(true)
    expect(stale.output).toContain('no longer what it was')
    expect(gone.changes).toEqual([])
  })
})

describe('rows and columns of a table', () => {
  it('adds rows after a row by default and tells the model the new numbers', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('add_to_table', { table: 1, what: 'rows', at: 2, count: 2 })
    expect(bridge.addTableLines).toHaveBeenCalledWith(1, 'rows', 2, 'after', 2)
    expect(result.mutated).toBe(true)
    expect(result.output).toBe(
      'Added 2 of the rows: number 3 to 4, empty. Table 1 now has 5 row(s) and 4 column(s).',
    )
    expect(result.summary).toBe('aiTableName:{"table":1} · aiTableRowsAdded:{"count":2}')
    expect(changes).toEqual([
      {
        kind: 'lines',
        from: 'aiTableName:{"table":1}',
        to: 'aiTableRowsAdded:{"count":2}',
        count: 2,
        place: PLACE,
      },
    ])
  })

  it('adds one column before a column when asked', async () => {
    const { call, bridge } = setup()
    await call('add_to_table', { table: 1, what: 'columns', at: 1, where: 'before' })
    expect(bridge.addTableLines).toHaveBeenCalledWith(1, 'columns', 1, 'before', 1)
  })

  it('removes rows and lists what went with them', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('remove_from_table', { table: 1, what: 'rows', at: 2 })
    expect(bridge.removeTableLines).toHaveBeenCalledWith(1, 'rows', 2, 1)
    expect(result.summary).toBe('aiTableName:{"table":1} · aiTableRowsRemoved:{"count":1}')
    expect(changes[0]).toMatchObject({
      kind: 'lines',
      to: 'aiTableRowsRemoved:{"count":1} · 연락처 | 비고',
    })
  })

  it('tells the model why nothing was changed', async () => {
    const cases = [
      [{ ok: false, reason: 'nested', rows: 2, cols: 2 }, 'inside a cell of another table'],
      [{ ok: false, reason: 'no_such_line', rows: 3, cols: 4 }, '3 row(s) and 4 column(s)'],
      [{ ok: false, reason: 'would_empty', rows: 3, cols: 4 }, 'at least one row'],
      [
        { ok: false, reason: 'holds_object', cells: [{ row: 1, col: 4 }], rows: 3, cols: 4 },
        'picture or another object, which would be removed with them: 1.4',
      ],
      [{ ok: false, reason: 'no_such_table', count: 2 }, 'the document has 2'],
    ] as const
    for (const [refusal, said] of cases) {
      const { call, changes } = setup({ removeTableLines: async () => refusal })
      const result = await call('remove_from_table', { table: 1, what: 'rows', at: 1 })
      expect(result.isError).toBe(true)
      expect(result.output).toContain(said)
      expect(changes).toEqual([])
    }
  })

  it('removes a whole table and lists what went with it', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('delete_table', { table: 3 })
    expect(bridge.deleteTable).toHaveBeenCalledWith(3)
    expect(result.isError).toBeFalsy()
    expect(result.output).toContain('list_tables')
    expect(result.summary).toBe('aiTableName:{"table":3} · aiTableRemoved')
    expect(changes[0]).toMatchObject({
      kind: 'lines',
      to: 'aiTableRemoved · 성취율 | 성취도 | 80% 이상 ~ 100% | A',
    })
  })

  it('tells the model why a table was not removed', async () => {
    const cases = [
      [{ ok: false, reason: 'no_such_table', count: 2 }, 'the document has 2'],
      [
        { ok: false, reason: 'holds_object', cells: [{ row: 2, col: 1 }] },
        'removed with the table: 2.1',
      ],
      [{ ok: false, reason: 'has_objects', count: 1 }, 'Nothing was changed'],
    ] as const
    for (const [refusal, said] of cases) {
      const { call, changes } = setup({ deleteTable: async () => refusal })
      const result = await call('delete_table', { table: 1 })
      expect(result.isError).toBe(true)
      expect(result.output).toContain(said)
      expect(changes).toEqual([])
    }
    const { call, bridge } = setup()
    expect((await call('delete_table', { table: '1' })).isError).toBe(true)
    expect(bridge.deleteTable).not.toHaveBeenCalled()
  })

  it('never sends a call it cannot read to the editor', async () => {
    const { call, bridge } = setup()
    expect((await call('add_to_table', { table: 1, what: 'cells', at: 1 })).isError).toBe(true)
    expect((await call('add_to_table', { table: 1, what: 'rows' })).isError).toBe(true)
    expect(
      (await call('add_to_table', { table: 1, what: 'rows', at: 1, where: 'below' })).isError,
    ).toBe(true)
    expect(bridge.addTableLines).not.toHaveBeenCalled()
  })
})

describe('form fields', () => {
  it('lists them', async () => {
    const { call } = setup({
      listFields: async () => [
        { field: 1, name: '성명', guide: '이름을 쓰세요', value: '', inCell: false },
      ],
    })
    const result = await call('list_fields')
    expect(JSON.parse(result.output)).toEqual([
      { field: 1, name: '성명', guide: '이름을 쓰세요', value: '', inCell: false },
    ])
    expect(result.summary).toBe('aiToolFields:{"count":1}')
  })

  it('fills one and reports the change', async () => {
    const { call, changes, bridge } = setup()
    const result = await call('fill_field', { field: 1, value: '홍길동' })
    expect(bridge.fillField).toHaveBeenCalledWith(1, '홍길동')
    expect(result.mutated).toBe(true)
    // the change is listed under the number and the name the editor gave back
    expect(changes).toEqual([{ kind: 'field', from: '#1 성명', to: '홍길동', count: 1 }])
  })

  it('lists a field nobody named under its number alone', async () => {
    const { call, changes } = setup({ fillField: async () => ({ ok: true, name: '' }) })
    await call('fill_field', { field: 3, value: '홍길동' })
    expect(changes).toEqual([{ kind: 'field', from: '#3', to: '홍길동', count: 1 }])
  })

  it('points at list_fields for a number that is not there', async () => {
    const { call, changes } = setup({
      fillField: async () => ({ ok: false, reason: 'no_such_field', count: 2 }),
    })
    const result = await call('fill_field', { field: 7, value: 'x' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('the document has 2')
    expect(result.output).toContain('list_fields')
    expect(result.summary).toBe('aiToolNotDone:{"what":"#7"}')
    expect(changes).toEqual([])
  })

  it('never sends a value with a line break to the editor', async () => {
    const { call, bridge } = setup()
    expect((await call('fill_field', { field: 1, value: '홍\n길동' })).isError).toBe(true)
    expect(bridge.fillField).not.toHaveBeenCalled()
  })
})

describe('a table of contents', () => {
  it('passes the headings and their levels, and lists the contents as one change', async () => {
    const { bridge, call, changes } = setup()
    const result = await call('insert_toc', {
      anchor: '보고서',
      where: 'after',
      title: '차 례',
      entries: [
        { find: 'Ⅰ. 추진 배경', level: 1 },
        { find: '1. 현황', level: 2, occurrence: 2 },
      ],
    })
    expect(result.isError).toBeFalsy()
    expect(result.output).toContain('on pages 1, 3')
    expect(bridge.insertToc).toHaveBeenCalledWith('보고서', null, 'after', '차 례', [
      { find: 'Ⅰ. 추진 배경', level: 1 },
      { find: '1. 현황', level: 2, occurrence: 2 },
    ])
    expect(changes).toEqual([{ kind: 'table', from: '', to: '차 례 (2)', count: 1, place: PLACE }])
  })

  it('says which heading could not be used, and why', async () => {
    const { call } = setup({
      insertToc: async () => ({
        ok: false as const,
        reason: 'no_heading' as const,
        heading: '현황',
        why: 'ambiguous',
        count: 2,
        matches: [],
      }),
    })
    const result = await call('insert_toc', { where: 'end', entries: [{ find: '현황', level: 1 }] })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('the heading "현황"')
    expect(result.output).toContain('occurs 2 times')
  })

  it('refuses entries without levels', async () => {
    const { bridge, call } = setup()
    const result = await call('insert_toc', { where: 'end', entries: [{ find: '제목' }] })
    expect(result.isError).toBe(true)
    expect(bridge.insertToc).not.toHaveBeenCalled()
  })

  it('writes the page numbers again and lists the rows that changed', async () => {
    const { bridge, call, changes } = setup()
    const result = await call('refresh_toc', { title: '차 례' })
    expect(bridge.refreshToc).toHaveBeenCalledWith('차 례', null)
    expect(result.output).toBe('1 of 2 page number(s) changed.')
    expect(changes[0]).toMatchObject({ kind: 'cells', from: '차 례', count: 1 })
  })

  it('says when no table of contents follows the line', async () => {
    const { call } = setup({
      refreshToc: async () => ({ ok: false as const, reason: 'no_toc' as const, count: 0 }),
    })
    const result = await call('refresh_toc', { title: '차 례' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('no table of contents follows')
  })
})

describe('footnotes and endnotes', () => {
  it('puts a note after the words it is about and lists it as a change', async () => {
    const { bridge, call, changes } = setup()
    const result = await call('insert_note', {
      kind: 'footnote',
      after: '국가인권위원회',
      text: '「국가인권위원회법」 제1조\r\n둘째 줄',
    })
    expect(result.isError).toBeFalsy()
    expect(result.mutated).toBe(true)
    expect(bridge.insertNote).toHaveBeenCalledWith(
      'footnote',
      '국가인권위원회',
      null,
      '「국가인권위원회법」 제1조\n둘째 줄',
    )
    expect(changes).toEqual([
      {
        kind: 'note',
        from: 'aiNoteFootnote:{"number":2}',
        to: '「국가인권위원회법」 제1조 둘째 줄',
        count: 1,
        place: PLACE,
      },
    ])
    expect(result.summary).toBe('aiToolAddNote:{"note":"aiNoteFootnote:{\\"number\\":2}"}')
  })

  it('says a note cannot go into a table cell', async () => {
    const { call } = setup({
      insertNote: async () => ({
        ok: false as const,
        reason: 'unsupported_place' as const,
        count: 1,
      }),
    })
    const result = await call('insert_note', { kind: 'endnote', after: '칸 글', text: '설명' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('table cell')
  })

  it('refuses a kind it does not know and a note without text', async () => {
    const { bridge, call } = setup()
    expect(
      (await call('insert_note', { kind: 'sidenote', after: '글', text: '설명' })).isError,
    ).toBe(true)
    expect((await call('insert_note', { kind: 'footnote', after: '글', text: '  ' })).isError).toBe(
      true,
    )
    expect(bridge.insertNote).not.toHaveBeenCalled()
  })

  it('rewrites a note by its number and says when there is no such note', async () => {
    const { call, changes } = setup()
    expect((await call('edit_note', { note: 1, text: '새 설명' })).mutated).toBe(true)
    expect(changes[0]).toMatchObject({
      kind: 'note',
      from: 'aiNoteEndnote:{"number":1}',
      to: '새 설명',
    })
    const none = setup({
      editNote: async () => ({ ok: false as const, reason: 'no_such_note' as const, count: 2 }),
    })
    const result = await none.call('edit_note', { note: 9, text: '새 설명' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('the body has 2')
  })

  it('removes a note and lists what went', async () => {
    const { call, changes } = setup()
    expect((await call('delete_note', { note: 3 })).mutated).toBe(true)
    expect(changes[0]).toMatchObject({
      kind: 'delete',
      from: 'aiNoteFootnote:{"number":3}: 지운 각주',
    })
  })

  it('lists the notes, and the ones it cannot reach', async () => {
    const { call } = setup({
      listNotes: async () => ({
        count: 1,
        elsewhere: 2,
        notes: [{ note: 1, kind: 'footnote' as const, number: 1, after: '본문', text: '설명' }],
      }),
    })
    const result = await call('list_notes')
    expect(result.output).toContain('"after": "본문"')
    expect(result.output).toContain('2 more note(s) sit inside table cells')
  })

  it('tells the model how many notes there are, which the text does not show', async () => {
    const { skill, refreshContext } = setup({
      listNotes: async () => ({
        count: 3,
        elsewhere: 0,
        notes: [
          { note: 1, kind: 'footnote' as const, number: 1, after: '', text: '' },
          { note: 2, kind: 'footnote' as const, number: 2, after: '', text: '' },
          { note: 3, kind: 'endnote' as const, number: 1, after: '', text: '' },
        ],
      }),
    })
    await refreshContext()
    expect(skill.buildContext!()).toContain('Footnotes and endnotes: 2 footnote(s), 1 endnote(s)')
  })

  it('still sends the document when the notes cannot be listed', async () => {
    const { skill, refreshContext } = setup({
      listNotes: async () => {
        throw new Error('gone')
      },
    })
    await refreshContext()
    expect(skill.buildContext!()).toContain('Text (complete):')
  })
})

describe('the skill as the model sees it', () => {
  it('offers exactly the tools it can execute', async () => {
    const { skill, call } = setup()
    expect(skill.tools.map((tool) => tool.name)).toEqual([
      'read_document',
      'find_text',
      'replace_text',
      'replace_all',
      'insert_paragraphs',
      'delete_paragraph',
      'insert_table',
      'format_text',
      'format_paragraph',
      'replace_selection',
      'read_selection',
      'format_selection',
      'merge_cells',
      'split_cell',
      'format_cells',
      'list_tables',
      'read_table',
      'fill_cells',
      'add_to_table',
      'remove_from_table',
      'delete_table',
      'list_fields',
      'fill_field',
      'insert_toc',
      'refresh_toc',
      'list_notes',
      'insert_note',
      'edit_note',
      'delete_note',
    ])
    expect((await call('delete_everything')).isError).toBe(true)
  })

  it('names the product, not the upstream project', () => {
    expect(setup().skill.systemPrompt).not.toContain('GenOffice')
  })
})
