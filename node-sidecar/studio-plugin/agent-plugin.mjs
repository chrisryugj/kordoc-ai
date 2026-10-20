// 이음오피스(IeumOffice, https://github.com/pblsketch/openoffice, Apache-2.0, Copyright 2026 Mainfunc, Inc.)의
// apps/hwp/studio-plugin/agent-plugin.mjs(커밋 a907a88c)에서 옮겼다. 바꾼 것: 플러그인·명령 이름(ieum → kordoc).
// 판단 근거는 그 저장소의 결정 기록 0022(AI 편집은 편집기 안 플러그인으로, 개체를 잃는 변경은 하지 않는다)·0026(탭 폭).
/**
 * The app's own plugin inside the rhwp-studio editor: the document operations
 * the AI panel needs, done on the editor's live document.
 *
 * It runs in the studio's realm, not in the app renderer, and is bundled into
 * the studio build (scripts/build-studio.mjs; the studio-plugin-allow patch
 * lets the studio load it). It imports nothing from the studio and knows only
 * the shape of the plugin host: `read` for lookups, `transaction` for every
 * change. One transaction is one undo step in the editor's own history and is
 * rolled back whole when it throws, so a change the AI makes is undone like a
 * change the user makes.
 *
 * Everything returned crosses to the app renderer by structured clone.
 */

export const AGENT_PLUGIN_ID = 'kordoc-agent'

/** Matches listed back to the caller when a search is ambiguous. */
const MAX_LISTED_MATCHES = 20
/** Characters of surrounding text shown with each listed match. */
const CONTEXT_CHARS = 30
/** Most history steps one undo call takes back. */
const MAX_UNDO_STEPS = 200
/** Most paragraphs one insert call adds. */
const MAX_INSERTED_PARAGRAPHS = 100
/** Most cells a new table holds. */
const MAX_TABLE_CELLS = 400
/** Characters of a removed paragraph handed back, for the panel's list of changes. */
const MAX_REPORTED_CHARS = 200
/** Tables one listTables call lists. */
const MAX_LISTED_TABLES = 200
/** Cells one readTable call returns; a longer table is read on from the row it names. */
const MAX_READ_CELLS = 600
/** Characters of one cell handed back by readTable. */
const MAX_CELL_CHARS = 300
/** Cells one fillCells call sets. */
const MAX_FILLED_CELLS = 400
/** Lines of text one cell is given. */
const MAX_CELL_LINES = 50
/** Most rows or columns one cell is split into. */
const MAX_SPLIT = 10
/** Cells one call gives a background colour. */
const MAX_FORMATTED_CELLS = 500
/** Rows or columns one call adds to or removes from a table. */
const MAX_TABLE_LINES = 50
/** What sits on the page as an object and can lie over a table cell without being in it. */
const FLOATING_KINDS = new Set(['image', 'picture', 'shape', 'group', 'ole', 'textbox'])
/** The command this plugin registers with the editor to move its caret to a place. */
const REVEAL_COMMAND = 'ext:kordoc-reveal'

/**
 * The event the File menu items this plugin adds fire on the editor's window, with the
 * command as its detail: the app hears it and saves or prints the way Ctrl+S and Ctrl+P do.
 */
export const FILE_COMMAND_EVENT = 'kordoc:file-command'
/** The File menu items, top to bottom: the command the app runs, and the shortcut shown. */
const FILE_MENU = [
  { command: 'save', id: 'ext:kordoc-save', shortcut: 'Ctrl+S' },
  { command: 'saveAs', id: 'ext:kordoc-save-as', shortcut: 'Ctrl+Shift+S' },
  { command: 'pdf', id: 'ext:kordoc-export-pdf' },
  { command: 'print', id: 'ext:kordoc-print', shortcut: 'Ctrl+P' },
]
/** The command that reads what the user has selected in the editor. */
const SELECTION_COMMAND = 'ext:kordoc-selection'
/** The command that selects the word under the caret (a double click in the page). */
const WORD_COMMAND = 'ext:kordoc-select-word'
/** The command that draws the marks of this plugin's changes on the pages. */
const MARK_COMMAND = 'ext:kordoc-mark-changes'
/** Most places marked at once: a replace-all over a long document stops here. */
const MAX_MARKS = 500
/** How long one call of printPages draws pages for; the bridge gives a call ten seconds. */
const PRINT_BATCH_MS = 2000
/**
 * How a mark looks: a light fill over the changed text and a line under it, warm so it is
 * not taken for the editor's blue selection. The page is paper white in every theme.
 */
const MARK_FILL = 'rgba(255, 193, 7, 0.24)'
const MARK_LINE = 'rgba(214, 140, 0, 0.85)'
/** Under the editor's selection (5) and caret. */
const MARK_LAYER_Z = 4
/** The editor lays pages out again after a change, in its own time: the marks follow then. */
const MARK_SETTLE_MS = 350
/** Changes that leave nothing to mark: what they removed is gone. */
const UNMARKED_CHANGES = new Set(['delete-paragraph', 'remove-table-lines', 'delete-note'])
/** The most runs and characters of one selection: a sanity limit, far above real use. */
const MAX_SELECTED_RUNS = 5000
const MAX_SELECTED_CHARS = 400000
/** Lookups one walk over the document spends on finding tables inside table cells. */
const MAX_NESTED_LOOKUPS = 20000
/** Objects tried in one cell paragraph when looking for a table inside it. */
const NESTED_CONTROLS_TRIED = 3
/** How deep tables inside tables are followed. */
const MAX_TABLE_DEPTH = 3
/** Cells and characters of a table shown in the list of tables. */
const PREVIEW_CELLS = 5
const PREVIEW_CHARS = 24
/** Lines one readText looks for inside other lines of the plain-text export before adding them. */
const MAX_CONTAINMENT_CHECKS = 2000
/** Font sizes a format request may ask for, in points. */
const MIN_FONT_PT = 4
const MAX_FONT_PT = 200
/** Line spacings a format request may ask for, in percent of the font height. */
const MIN_LINE_SPACING = 50
const MAX_LINE_SPACING = 500

/** What the engine says when a paragraph has no object at the place asked for. */
const NO_OBJECT_THERE = '범위 초과'

const parse = (json) => JSON.parse(json)

/** A replacement stays inside one paragraph: no line breaks or other control characters. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** The engine throws plain strings; give every failure a message the bridge can carry. */
function asError(thrown) {
  if (thrown instanceof Error) return thrown
  return fail('ENGINE_ERROR', String(thrown))
}

/**
 * The cell a match sits in, as the engine's by-path calls want it: one entry
 * per nesting level, outermost first. Null for a match in the body.
 */
function cellPathOf(hit) {
  if (Array.isArray(hit.cellPath) && hit.cellPath.length > 0) {
    return hit.cellPath.map((entry) => ({
      controlIndex: entry.controlIndex,
      cellIndex: entry.cellIndex,
      cellParaIndex: entry.cellParaIndex,
    }))
  }
  const cell = hit.cellContext
  if (!cell) return null
  return [{ controlIndex: cell.ctrlIdx, cellIndex: cell.cellIdx, cellParaIndex: cell.cellPara }]
}

/**
 * Where a change is, so the editor can show it: the paragraph (for a cell, the body
 * paragraph its table sits in and the path to the cell paragraph), and a run of characters.
 */
function placeOf(hit, length) {
  const path = cellPathOf(hit)
  return {
    sec: hit.sec,
    para: hit.para,
    ...(path ? { path } : {}),
    offset: hit.charOffset ?? 0,
    length,
  }
}

/** Where a form field is; null for a field in a text box or a note, which has no such address. */
function fieldPlace(field) {
  const where = field.location
  if (!where) return null
  const path = Array.isArray(where.path) ? where.path : []
  if (path.some((entry) => entry.type !== 'cell')) return null
  return {
    sec: where.sectionIndex,
    para: where.paraIndex,
    ...(path.length > 0
      ? {
          path: path.map((entry) => ({
            controlIndex: entry.controlIndex,
            cellIndex: entry.cellIndex,
            cellParaIndex: entry.paraIndex,
          })),
        }
      : {}),
    offset: field.startCharIdx ?? 0,
    length: 0,
  }
}

/**
 * Move the editor's caret to a place and select the run there; the editor scrolls to its
 * caret. The caret is not part of the plugin host: this runs as a command of the editor,
 * which is handed the editor's own services. The focus stays where it is.
 */
function showPlace(services, place) {
  const input = services && services.getInputHandler ? services.getInputHandler() : null
  const cursor = input ? input.cursor : null
  if (!cursor || !place || !Number.isInteger(place.sec) || !Number.isInteger(place.para)) {
    return false
  }
  const path = Array.isArray(place.path) ? place.path : []
  const offset = Number.isInteger(place.offset) ? place.offset : 0
  const start =
    path.length > 0
      ? {
          sectionIndex: place.sec,
          paragraphIndex: place.para,
          charOffset: offset,
          parentParaIndex: place.para,
          controlIndex: path[0].controlIndex,
          cellIndex: path[0].cellIndex,
          cellParaIndex: path[0].cellParaIndex,
          // a cell of a table inside a cell is named by the whole path
          ...(path.length > 1 ? { cellPath: path } : {}),
        }
      : { sectionIndex: place.sec, paragraphIndex: place.para, charOffset: offset }
  cursor.clearSelection()
  cursor.moveTo(start)
  if (Number.isInteger(place.length) && place.length > 0) {
    cursor.setAnchor()
    cursor.moveTo({ ...start, charOffset: offset + place.length })
  }
  if (input.updateCaret) input.updateCaret()
  return true
}

/**
 * What is selected in the editor: the two ends of a run of text in document order, or a
 * block of table cells (dragged across cells, or picked with F5). Null when nothing is.
 */
function cursorSelection(services) {
  const input = services && services.getInputHandler ? services.getInputHandler() : null
  const cursor = input ? input.cursor : null
  if (!cursor) return null
  if (cursor.isInCellSelectionMode && cursor.isInCellSelectionMode()) {
    const range = cursor.getSelectedCellRange ? cursor.getSelectedCellRange() : null
    const table = cursor.getCellTableContext ? cursor.getCellTableContext() : null
    if (range && table) {
      const excluded = cursor.getExcludedCells ? [...cursor.getExcludedCells()] : []
      return { block: { table, range, excluded } }
    }
  }
  if (!cursor.hasSelection()) return null
  const ordered = cursor.getSelectionOrdered()
  return ordered ? { start: ordered.start, end: ordered.end } : null
}

const asCellPath = (entries) =>
  entries.map((entry) => ({
    controlIndex: entry.controlIndex,
    // a text box is addressed like a table of one cell
    cellIndex: Number.isInteger(entry.cellIndex) ? entry.cellIndex : 0,
    cellParaIndex: entry.cellParaIndex,
  }))

/**
 * One end of a selection in the terms of this plugin: the paragraph it is in (for a cell or
 * a text box, the body paragraph that holds it and the path to the paragraph inside) and
 * the offset. Null for a place this plugin has no address for (a note, a header).
 */
function endOf(position) {
  if (!position) return null
  if (!Number.isInteger(position.sectionIndex) || !Number.isInteger(position.charOffset)) {
    return null
  }
  const cells =
    Array.isArray(position.cellPath) && position.cellPath.length > 0
      ? position.cellPath
      : Number.isInteger(position.cellIndex) || position.isTextBox
        ? [position]
        : null
  if (!cells) {
    return {
      sec: position.sectionIndex,
      para: position.paragraphIndex,
      path: null,
      k: position.paragraphIndex,
      offset: position.charOffset,
    }
  }
  const path = asCellPath(cells)
  if (
    path.some(
      (entry) => !Number.isInteger(entry.controlIndex) || !Number.isInteger(entry.cellParaIndex),
    )
  ) {
    return null
  }
  return {
    sec: position.sectionIndex,
    para: Number.isInteger(position.parentParaIndex)
      ? position.parentParaIndex
      : position.paragraphIndex,
    path,
    k: path[path.length - 1].cellParaIndex,
    offset: position.charOffset,
  }
}

/** Whether two ends in cells lie in the same table, and with `cell` in the same cell of it. */
function sameTable(a, b, cell) {
  if (a.sec !== b.sec || a.para !== b.para || a.path.length !== b.path.length) return false
  return a.path.every((entry, index) => {
    const other = b.path[index]
    const last = index === a.path.length - 1
    return (
      entry.controlIndex === other.controlIndex &&
      (last
        ? !cell || entry.cellIndex === other.cellIndex
        : entry.cellIndex === other.cellIndex && entry.cellParaIndex === other.cellParaIndex)
    )
  })
}

/** The runs of a selection as they are gathered, with what they add up to. */
function runCollector() {
  const segments = []
  let chars = 0
  return {
    segments,
    /** the characters from..to of paragraph k of a box, when there are any */
    add(box, k, from, to) {
      const length = box.length(k)
      const start = Math.min(Math.max(from, 0), length)
      const end = Math.min(to, length)
      if (end <= start) return
      chars += end - start
      segments.push({
        ...box.place(k, end - start),
        offset: start,
        text: box.text(k, length).slice(start, end),
      })
    },
    tooLong: () => segments.length > MAX_SELECTED_RUNS || chars > MAX_SELECTED_CHARS,
  }
}

/**
 * The text of a table's cells as runs, in reading order: each paragraph of each cell that
 * `wanted` picks (all of them without it), followed by the tables that sit in it.
 */
function collectTable(doc, tables, index, out, wanted) {
  const table = tables[index]
  const inside = tables
    .map((child, at) => ({ child, at }))
    .filter(({ child }) => child.parent === index)
  const grid = wanted ? gridOf(doc, table) : null
  for (let cell = 0; cell < table.cells; cell++) {
    if (grid && !wanted(grid[cell])) continue
    const box = cellBox(doc, table, cell)
    const count = box.count()
    for (let k = 0; k < count; k++) {
      out.add(box, k, 0, Infinity)
      for (const { child, at } of inside) {
        const holder = child.path[child.path.length - 2]
        if (holder.cellIndex === cell && holder.cellParaIndex === k) {
          collectTable(doc, tables, at, out, null)
        }
      }
      if (out.tooLong()) return
    }
  }
}

/**
 * The text between two places of the body as runs, across sections when need be. A table
 * goes in whole when the paragraph it sits in is wholly inside the selection.
 */
function collectBody(doc, tablesNow, start, end, out) {
  for (let sec = start.sec; sec <= end.sec; sec++) {
    const box = containerOf(doc, { sec, para: 0 })
    const last = box.count() - 1
    const first = sec === start.sec ? start.k : 0
    const stop = sec === end.sec ? Math.min(end.k, last) : last
    for (let k = first; k <= stop; k++) {
      const length = box.length(k)
      const from = sec === start.sec && k === start.k ? start.offset : 0
      const to = sec === end.sec && k === end.k ? end.offset : length
      out.add(box, k, from, to)
      if (from <= 0 && to >= length && box.objectPositions(k).length > 0) {
        const tables = tablesNow()
        tables.forEach((table, index) => {
          if (table.parent === null && table.sec === sec && table.para === k) {
            collectTable(doc, tables, index, out, null)
          }
        })
      }
      if (out.tooLong()) return
    }
  }
}

/**
 * Whether the runs are paragraphs of one stretch: in order in the body of a section or in
 * one cell (a paragraph without text between two of them has no run, and does not break
 * the stretch). Only such a selection can be rewritten into more or fewer paragraphs than
 * it has.
 */
function isContiguous(segments) {
  return segments.every((segment, index) => {
    if (index === 0) return true
    const before = segments[index - 1]
    if (segment.sec !== before.sec) return false
    const path = segment.path ?? null
    const pathBefore = before.path ?? null
    if (!path || !pathBefore) return !path && !pathBefore && segment.para > before.para
    const a = { sec: segment.sec, para: segment.para, path }
    const b = { sec: before.sec, para: before.para, path: pathBefore }
    return (
      sameTable(a, b, true) &&
      path[path.length - 1].cellParaIndex > pathBefore[pathBefore.length - 1].cellParaIndex
    )
  })
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u

/** The word around an offset of a text: a run of letters and digits. Null on a blank or a mark. */
function wordAt(text, offset) {
  let at = Math.min(offset, text.length - 1)
  if (at < 0) return null
  // a click behind the last letter of a word still means that word
  if (!WORD_CHARACTER.test(text[at]) && at > 0 && WORD_CHARACTER.test(text[at - 1])) at -= 1
  if (!WORD_CHARACTER.test(text[at])) return null
  let start = at
  let end = at + 1
  while (start > 0 && WORD_CHARACTER.test(text[start - 1])) start -= 1
  while (end < text.length && WORD_CHARACTER.test(text[end])) end += 1
  return { start, end }
}

/**
 * Select the word the caret is in, the way a double click does in Hangul and every other
 * editor; the studio's own double click only opens headers, text boxes and objects. Leaves
 * the editor alone while it is in one of those modes.
 */
function selectWord(services, readText) {
  const input = services && services.getInputHandler ? services.getInputHandler() : null
  const cursor = input ? input.cursor : null
  if (!cursor || !cursor.getPosition) return false
  const elsewhere = [
    'isInPictureObjectSelection',
    'isInHeaderFooter',
    'isInCellSelectionMode',
    'isInFootnote',
  ].some((mode) => typeof cursor[mode] === 'function' && cursor[mode]())
  if (elsewhere) return false
  const position = cursor.getPosition()
  const at = endOf(position)
  if (!at) return false
  const word = wordAt(readText(at), at.offset)
  if (!word) return false
  cursor.clearSelection()
  cursor.moveTo({ ...position, charOffset: word.start })
  cursor.setAnchor()
  cursor.moveTo({ ...position, charOffset: word.end })
  if (input.updateCaret) input.updateCaret()
  return true
}

const placeKey = (place) =>
  [
    place.sec,
    place.para,
    (place.path ?? []).map((e) => `${e.controlIndex}.${e.cellIndex}.${e.cellParaIndex}`).join('/'),
    place.offset,
    place.length,
  ].join(':')

/** The paragraph of the box a segment of a selection is in. */
const segmentBox = (doc, segment) => {
  const box = containerOf(doc, { sec: segment.sec, para: segment.para, cellPath: segment.path })
  return { box, k: box.index }
}

/** A selection as the panel handed it back: a list of runs, one per paragraph. */
function checkSegments(segments) {
  const ok =
    Array.isArray(segments) &&
    segments.length > 0 &&
    segments.length <= MAX_SELECTED_RUNS &&
    segments.every(
      (segment) =>
        segment &&
        Number.isInteger(segment.sec) &&
        Number.isInteger(segment.para) &&
        Number.isInteger(segment.offset) &&
        Number.isInteger(segment.length) &&
        segment.offset >= 0 &&
        segment.length >= 0 &&
        typeof segment.text === 'string',
    )
  if (!ok) throw fail('BAD_ARGUMENT', 'the selection is not one this editor handed out')
}

/** Whether every run still holds the text it held when the selection was read. */
function segmentsStand(doc, segments) {
  return segments.every((segment) => {
    try {
      const { box, k } = segmentBox(doc, segment)
      const whole = box.text(k, box.length(k))
      return whole.slice(segment.offset, segment.offset + segment.length) === segment.text
    } catch {
      return false
    }
  })
}

/** Text inside an equation is a script, not prose: it has no replace path here. */
const isReplaceable = (hit) => hit.equationControl === undefined

function contextOf(doc, hit) {
  const start = Math.max(0, hit.charOffset - CONTEXT_CHARS)
  const path = cellPathOf(hit)
  if (path) {
    const json = JSON.stringify(path)
    const length = doc.getCellParagraphLengthByPath(hit.sec, hit.para, json)
    const count = Math.min(length - start, hit.length + CONTEXT_CHARS * 2)
    return count > 0 ? doc.getTextInCellByPath(hit.sec, hit.para, json, start, count) : ''
  }
  const length = doc.getParagraphLength(hit.sec, hit.para)
  const count = Math.min(length - start, hit.length + CONTEXT_CHARS * 2)
  return count > 0 ? doc.getTextRange(hit.sec, hit.para, start, count) : ''
}

function describe(doc, hit, index) {
  const row = { occurrence: index + 1, inTable: Boolean(hit.cellContext) }
  if (!isReplaceable(hit)) return { ...row, replaceable: false }
  try {
    return { ...row, context: contextOf(doc, hit) }
  } catch {
    // the surrounding text is a courtesy; the match itself is still valid
    return row
  }
}

function searchAll(doc, find) {
  if (typeof find !== 'string' || find.length === 0) {
    throw fail('BAD_ARGUMENT', 'find must be a non-empty string')
  }
  return parse(doc.searchAllText(find, true, true))
}

function checkReplacement(replacement) {
  if (typeof replacement !== 'string' || CONTROL_CHARS.test(replacement)) {
    throw fail('BAD_ARGUMENT', 'replacement must be one line of plain text')
  }
}

function expectOk(json, what) {
  const result = parse(json)
  if (result && result.ok === false) throw fail('ENGINE_REFUSED', `the editor refused to ${what}`)
}

function replaceHit(doc, hit, replacement) {
  const path = cellPathOf(hit)
  if (!path) {
    expectOk(doc.replaceText(hit.sec, hit.para, hit.charOffset, hit.length, replacement), 'replace')
    return
  }
  // the engine's one-call cell replace only takes very short text (it serves typing), so a
  // cell is rewritten as delete + insert; inside one transaction that is still one undo step
  const json = JSON.stringify(path)
  expectOk(
    doc.deleteTextInCellByPath(hit.sec, hit.para, json, hit.charOffset, hit.length),
    'delete',
  )
  if (replacement.length > 0) {
    expectOk(
      doc.insertTextInCellByPath(hit.sec, hit.para, json, hit.charOffset, replacement),
      'insert',
    )
  }
}

/**
 * The run of paragraphs a match sits in (the body of a section, or one table cell) with the
 * engine calls that address a paragraph of it by index. `index` is the matched paragraph.
 */
function containerOf(doc, hit) {
  const { sec, para } = hit
  const path = cellPathOf(hit)
  if (!path) {
    return {
      index: para,
      inTable: false,
      place: (k, length) => ({ sec, para: k, offset: 0, length }),
      count: () => doc.getParagraphCount(sec),
      length: (k) => doc.getParagraphLength(sec, k),
      text: (k, count) => (count > 0 ? doc.getTextRange(sec, k, 0, count) : ''),
      // tables, pictures and the like sit in a paragraph without being its text; each one
      // has a place among the characters (the first paragraph of a document always holds
      // some: its section and column definitions)
      objectPositions: (k) => parse(doc.getControlTextPositions(sec, k)),
      split: (k, offset) => expectOk(doc.splitParagraph(sec, k, offset), 'split the paragraph'),
      font: (k) => fontOf(() => doc.getCharPropertiesAt(sec, k, 0)),
      // an empty paragraph after k without splitting k: it takes k's paragraph formatting
      addAfter: (k) => expectOk(doc.insertParagraph(sec, k + 1), 'add a paragraph'),
      insert: (k, text) => expectOk(doc.insertText(sec, k, 0, text), 'insert'),
      deleteText: (k, count) => expectOk(doc.deleteText(sec, k, 0, count), 'delete'),
      deleteRange: (k1, o1, k2, o2) => expectOk(doc.deleteRange(sec, k1, o1, k2, o2), 'delete'),
      pasteHtml: (k, html) => expectOk(doc.pasteHtml(sec, k, 0, html), 'insert the table'),
      formatChars: (k, start, end, json) =>
        expectOk(doc.applyCharFormat(sec, k, start, end, json), 'format the text'),
      formatParagraph: (k, json) =>
        expectOk(doc.applyParaFormat(sec, k, json), 'format the paragraph'),
      applyStyle: (k, id) => expectOk(doc.applyStyle(sec, k, id), 'apply the style'),
    }
  }
  const last = path[path.length - 1]
  const at = (k) => JSON.stringify([...path.slice(0, -1), { ...last, cellParaIndex: k }])
  return {
    index: last.cellParaIndex,
    inTable: true,
    place: (k, length) => ({ sec, para, path: parse(at(k)), offset: 0, length }),
    count: () => doc.getCellParagraphCountByPath(sec, para, at(0)),
    length: (k) => doc.getCellParagraphLengthByPath(sec, para, at(k)),
    text: (k, count) => (count > 0 ? doc.getTextInCellByPath(sec, para, at(k), 0, count) : ''),
    // the engine cannot be asked this for a cell paragraph; the before/after check of the
    // callers (keepingObjects) is what protects an object there
    objectPositions: () => [],
    font: (k) => fontOf(() => doc.getCellCharPropertiesAtByPath(sec, para, at(k), 0)),
    split: (k, offset) =>
      expectOk(doc.splitParagraphInCellByPath(sec, para, at(k), offset), 'split the paragraph'),
    insert: (k, text) => expectOk(doc.insertTextInCellByPath(sec, para, at(k), 0, text), 'insert'),
    deleteText: (k, count) =>
      expectOk(doc.deleteTextInCellByPath(sec, para, at(k), 0, count), 'delete'),
    deleteRange: (k1, o1, k2, o2) =>
      expectOk(doc.deleteRangeInCellByPath(sec, para, at(k1), k1, o1, k2, o2), 'delete'),
    pasteHtml: (k, html) =>
      expectOk(doc.pasteHtmlInCellByPath(sec, para, at(k), 0, html), 'insert the table'),
    formatChars: (k, start, end, json) =>
      expectOk(
        doc.applyCharFormatInCellByPath(sec, para, at(k), start, end, json),
        'format the text',
      ),
    // the engine formats a cell paragraph by table and cell number only, which cannot name
    // a cell of a table inside another table's cell
    formatParagraph:
      path.length === 1
        ? (k, json) =>
            expectOk(
              doc.applyParaFormatInCell(sec, para, last.controlIndex, last.cellIndex, k, json),
              'format the paragraph',
            )
        : null,
    applyStyle:
      path.length === 1
        ? (k, id) =>
            expectOk(
              doc.applyCellStyle(sec, para, last.controlIndex, last.cellIndex, k, id),
              'apply the style',
            )
        : null,
  }
}

/**
 * What an edit must leave alone: the objects of the document and the field values. An edit
 * that fills cells names the fields it sets itself (`ignore`, by field id); the value of a
 * named cell is its text, so those are not watched then either.
 */
function objectsOf(doc, ignore = null) {
  const fields = parse(doc.getFieldList())
  const watched = ignore
    ? fields.filter((field) => field.cellField !== true && !ignore.has(field.fieldId))
    : fields
  return {
    controls: parse(doc.getControls()).length,
    fields: JSON.stringify(watched.map((field) => field.value ?? '')),
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const ALIGNMENTS = ['left', 'center', 'right', 'justify']
const TOGGLES = ['bold', 'italic', 'underline', 'strikethrough']

/** Longest font name taken; real names are far shorter. */
const MAX_FONT_NAME = 64
/** The font languages of a character shape: Hangul, Latin, Hanja, Japanese, other, symbol, user. */
const FONT_LANGUAGES = 7
/** Paragraph indents, margins and spacing come to the engine at twice their HWPUNIT, 100 to a point. */
const PARA_UNITS_PER_PT = 200
/** What a paragraph's indent, margins and spacing may be set to, in points. */
const PARA_LENGTHS = {
  indent: { min: -100, max: 100, key: 'indent' },
  marginLeft: { min: 0, max: 300, key: 'marginLeft' },
  marginRight: { min: 0, max: 300, key: 'marginRight' },
  spacingBefore: { min: 0, max: 200, key: 'spacingBefore' },
  spacingAfter: { min: 0, max: 200, key: 'spacingAfter' },
}
/** Style kinds as the engine lists them: paragraph styles are 0. */
const PARAGRAPH_STYLE = 0

/**
 * A format request, checked. `chars` and `paragraph` hold what was asked for, null when
 * nothing of that kind was; `font` and `style` are names the document resolves when the
 * change is made (resolveFormat). Only what was asked for is set, so everything else about
 * the text stays as it is.
 */
function formatOf(format, allowParagraph) {
  if (!format || typeof format !== 'object' || Array.isArray(format)) {
    throw fail('BAD_ARGUMENT', 'format must be an object')
  }
  const given = (key) => format[key] !== undefined && format[key] !== null
  const chars = {}
  for (const key of TOGGLES) {
    if (!given(key)) continue
    if (typeof format[key] !== 'boolean') throw fail('BAD_ARGUMENT', `${key} must be true or false`)
    chars[key] = format[key]
  }
  if (given('size')) {
    if (
      typeof format.size !== 'number' ||
      !(format.size >= MIN_FONT_PT && format.size <= MAX_FONT_PT)
    ) {
      throw fail('BAD_ARGUMENT', `size must be ${MIN_FONT_PT} to ${MAX_FONT_PT} points`)
    }
    // the engine counts in hundredths of a point
    chars.fontSize = Math.round(format.size * 100)
  }
  if (given('color')) {
    if (typeof format.color !== 'string' || !HEX_COLOR.test(format.color)) {
      throw fail('BAD_ARGUMENT', 'color must look like #RRGGBB')
    }
    chars.textColor = format.color.toLowerCase()
  }
  if (given('highlight')) {
    const none = format.highlight === 'none'
    if (!none && (typeof format.highlight !== 'string' || !HEX_COLOR.test(format.highlight))) {
      throw fail('BAD_ARGUMENT', 'highlight must look like #RRGGBB, or be "none"')
    }
    // no highlight is a white one: the engine has no other way to say it here
    chars.shadeColor = none ? '#ffffff' : format.highlight.toLowerCase()
  }
  let font = null
  if (given('font')) {
    const name = typeof format.font === 'string' ? format.font.trim() : ''
    if (!name || name.length > MAX_FONT_NAME || CONTROL_CHARS.test(name)) {
      throw fail('BAD_ARGUMENT', `font must be a font name of 1 to ${MAX_FONT_NAME} characters`)
    }
    font = name
  }
  const paragraph = {}
  if (given('align')) {
    if (!ALIGNMENTS.includes(format.align)) {
      throw fail('BAD_ARGUMENT', `align must be one of ${ALIGNMENTS.join(', ')}`)
    }
    paragraph.alignment = format.align
  }
  if (given('lineSpacing')) {
    const percent = format.lineSpacing
    if (
      typeof percent !== 'number' ||
      !(percent >= MIN_LINE_SPACING && percent <= MAX_LINE_SPACING)
    ) {
      throw fail(
        'BAD_ARGUMENT',
        `lineSpacing must be ${MIN_LINE_SPACING} to ${MAX_LINE_SPACING} percent`,
      )
    }
    paragraph.lineSpacing = Math.round(percent)
    paragraph.lineSpacingType = 'Percent'
  }
  for (const [name, { min, max, key }] of Object.entries(PARA_LENGTHS)) {
    if (!given(name)) continue
    const points = format[name]
    if (typeof points !== 'number' || !(points >= min && points <= max)) {
      throw fail('BAD_ARGUMENT', `${name} must be ${min} to ${max} points`)
    }
    paragraph[key] = Math.round(points * PARA_UNITS_PER_PT)
  }
  let style = null
  if (given('style')) {
    const name = typeof format.style === 'string' ? format.style.trim() : ''
    if (!name || CONTROL_CHARS.test(name)) throw fail('BAD_ARGUMENT', 'style must be a style name')
    style = name
  }
  const hasChars = Object.keys(chars).length > 0 || font !== null
  const hasParagraph = Object.keys(paragraph).length > 0 || style !== null
  if (hasParagraph && !allowParagraph) {
    throw fail(
      'BAD_ARGUMENT',
      'align, lineSpacing, indents, margins, spacing and style belong to a whole paragraph',
    )
  }
  if (!hasChars && !hasParagraph) throw fail('BAD_ARGUMENT', 'format names nothing to change')
  return {
    chars: hasChars ? chars : null,
    font,
    paragraph: Object.keys(paragraph).length > 0 ? paragraph : null,
    style,
  }
}

/** The paragraph styles of the document, by number, with their names. */
const paragraphStylesOf = (doc) =>
  parse(doc.getStyleList()).filter((style) => style.type === PARAGRAPH_STYLE)

/** The number of the paragraph style called `name` (its own or its English name), or null. */
function styleIdOf(doc, name) {
  const wanted = name.toLowerCase()
  const style = paragraphStylesOf(doc).find(
    (candidate) =>
      String(candidate.name ?? '').toLowerCase() === wanted ||
      String(candidate.englishName ?? '').toLowerCase() === wanted,
  )
  return style ? style.id : null
}

/** A refusal for a style the document does not have, with the ones it has. */
const noSuchStyle = (doc) => ({
  ok: false,
  reason: 'no_such_style',
  styles: paragraphStylesOf(doc).map((style) => style.name),
})

/**
 * A checked format as the engine takes it, in a change: a font is looked up in the
 * document's font lists, one per language, and added to them where it is missing.
 */
function resolveFormat(doc, spec) {
  let chars = null
  if (spec.chars) {
    const out = { ...spec.chars }
    if (spec.font) {
      const ids = []
      for (let lang = 0; lang < FONT_LANGUAGES; lang++) {
        const id = doc.findOrCreateFontIdForLang(lang, spec.font)
        if (!Number.isInteger(id) || id < 0) throw fail('ENGINE', 'the font could not be set')
        ids.push(id)
      }
      out.fontIds = ids
    }
    chars = JSON.stringify(out)
  }
  let style = null
  if (spec.style) {
    style = styleIdOf(doc, spec.style)
    if (style === null) throw fail('CHANGED', 'the style is gone')
  }
  return { chars, paragraph: spec.paragraph ? JSON.stringify(spec.paragraph) : null, style }
}

function checkWhere(where) {
  if (where !== 'after' && where !== 'before' && where !== 'end') {
    throw fail('BAD_ARGUMENT', 'where must be "after", "before" or "end"')
  }
}

function checkParagraphs(paragraphs) {
  const valid =
    Array.isArray(paragraphs) &&
    paragraphs.length > 0 &&
    paragraphs.length <= MAX_INSERTED_PARAGRAPHS &&
    paragraphs.every((text) => typeof text === 'string' && !CONTROL_CHARS.test(text))
  if (!valid) {
    throw fail(
      'BAD_ARGUMENT',
      `paragraphs must be 1 to ${MAX_INSERTED_PARAGRAPHS} strings, each one line of plain text`,
    )
  }
}

/** The rows as a rectangle of one-line strings, short rows padded with empty cells. */
function tableOf(rows) {
  const valid =
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows.every(
      (row) =>
        Array.isArray(row) &&
        row.length > 0 &&
        row.every((cell) => typeof cell === 'string' && !CONTROL_CHARS.test(cell)),
    )
  const cols = valid ? Math.max(...rows.map((row) => row.length)) : 0
  if (!valid || rows.length * cols > MAX_TABLE_CELLS) {
    throw fail(
      'BAD_ARGUMENT',
      `rows must be a non-empty list of rows of one-line strings, at most ${MAX_TABLE_CELLS} cells`,
    )
  }
  return rows.map((row) => [...row, ...Array(cols - row.length).fill('')])
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The look of a new table's cells: a thin black line all round and the inner margins Hangul
 * gives a new table. Left out, the engine makes a table with no lines and no margins.
 * These are document content, not app chrome: the same in the light and the dark theme.
 */
const TABLE_CELL_STYLE = 'border:0.4pt solid #000000;padding:1.41pt 5.1pt'
/** Fill of a header row. Document content as well. */
const TABLE_HEADER_FILL = '#e5e5e5'
/** Top plus bottom cell margin of TABLE_CELL_STYLE, in points. */
const TABLE_CELL_MARGIN_PT = 2.82
/** Line height of a table cell relative to its font size (the engine's default line spacing). */
const TABLE_LINE_SPACING = 1.6
/** Font size assumed for a table when the paragraph next to it does not tell. */
const DEFAULT_FONT_PT = 10

/** The font of the text at the start of a paragraph, for a table that should match it. */
function fontOf(read) {
  try {
    const props = parse(read())
    // the name goes into a style attribute: nothing that could end it
    const family =
      typeof props.fontFamily === 'string' ? props.fontFamily.replace(/["';<>]/g, '') : ''
    const points = Number(props.fontSize) / 100
    return { family, points: points > 0 ? points : DEFAULT_FONT_PT }
  } catch {
    // the table is still made, in the document's default font
    return { family: '', points: DEFAULT_FONT_PT }
  }
}

/**
 * The engine builds a table from pasted HTML, the way it does for a paste from the
 * clipboard. Left to itself it uses the document's default font and a row too low for
 * one line, so each cell carries the font of the paragraph the table is put next to and a
 * height that fits a line of it (a cell whose text wraps still grows).
 */
function tableHtml(table, font, header, shadeHeader) {
  const height = Math.round((font.points * TABLE_LINE_SPACING + TABLE_CELL_MARGIN_PT) * 10) / 10
  const text = [
    font.family ? `font-family:${font.family};mso-fareast-font-family:${font.family}` : '',
    `font-size:${font.points}pt`,
  ]
    .filter(Boolean)
    .join(';')
  const box = `${TABLE_CELL_STYLE};height:${height}pt`
  const cell = (value) =>
    `<td style="${box}"><span style="${text}">${escapeHtml(value)}</span></td>`
  // a header cell the way Hangul documents usually have it: bold, centred, on light grey;
  // as <th> the engine also marks it as a title cell, which repeats on the next page. The
  // grey is left out where it is put on afterwards (shadeHeaderCells)
  const head = (value) =>
    `<th style="${box}${shadeHeader ? `;background-color:${TABLE_HEADER_FILL}` : ''}"><p style="text-align:center">` +
    `<span style="${text};font-weight:bold">${escapeHtml(value)}</span></p></th>`
  const rows = table.map(
    (row, index) => `<tr>${row.map(header && index === 0 ? head : cell).join('')}</tr>`,
  )
  return `<table>${rows.join('')}</table>`
}

/**
 * Give the header row of a table just pasted in body paragraph `place` its grey, cell by
 * cell. Pasted with the grey, the engine takes the first cell's border and fill for the
 * table's own, and Hancom Hangul paints a table's own fill behind every cell: the whole
 * table came out grey. Pasted without it, the table's own has no fill, and the engine
 * colours each cell on its own. No table there leaves the paste as it is.
 */
function shadeHeaderCells(doc, place, cols) {
  const controls = parse(doc.getControlTextPositions(place.sec, place.para)).length
  for (let control = controls - 1; control >= 0; control--) {
    try {
      doc.getTableDimensionsByPath(
        place.sec,
        place.para,
        JSON.stringify([{ controlIndex: control, cellIndex: 0, cellParaIndex: 0 }]),
      )
    } catch {
      continue
    }
    // pattern -1 is none: left out, the engine puts in 0, which Hangul draws as horizontal lines
    const fill = JSON.stringify({
      fillType: 'solid',
      fillColor: TABLE_HEADER_FILL,
      patternType: -1,
    })
    for (let cell = 0; cell < cols; cell++) {
      expectOk(
        doc.setCellProperties(place.sec, place.para, control, cell, fill),
        'shade the header',
      )
    }
    return
  }
}

/** Which match a replace call means, or the reason it cannot be decided. */
const ENTITY = /&#(\d+);|&#x([0-9a-fA-F]+);/g

/** The engine's plain-text export writes some characters as numeric references. */
const decodeEntities = (text) =>
  text.replace(ENTITY, (_match, dec, hex) =>
    String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)),
  )

const squash = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * The document as plain text in reading order, one paragraph a line. The base is the
 * engine's own export, which reaches everything that holds text (text boxes, tables inside
 * cells, notes) and shows an empty form field by its guide text. That export leaves out
 * whole tables in some documents, though, and now and then a body paragraph. So the
 * paragraphs of the body and of its tables are walked as well, and each one the export does
 * not have is put in after the last line that it does have.
 *
 * A paragraph that holds a click-here field is not compared: the export writes the field's
 * guide into it, so the two never match and the line would come out twice.
 */
function textOf(doc) {
  const flat = decodeEntities(parse(doc.getTextFileText()))
  const lines = flat.split(/\r?\n/)
  // where each line of the export is: its places in order, one per occurrence
  const places = new Map()
  lines.forEach((line, index) => {
    const key = squash(line)
    if (!key) return
    const list = places.get(key)
    if (list) list.push(index)
    else places.set(key, [index])
  })
  const fielded = new Set()
  for (const field of parse(doc.getFieldList())) {
    const where = field.location
    // only a click-here field has a guide; a cross-reference or a link is ordinary text
    if (field.fieldType !== 'clickhere' || field.cellField === true || !where) continue
    const path = Array.isArray(where.path) ? where.path : []
    const cell = path[0]
    fielded.add(
      cell && cell.type === 'cell'
        ? `${where.sectionIndex}/${where.paraIndex}/${cell.controlIndex}.${cell.cellIndex}.${cell.paraIndex}`
        : `${where.sectionIndex}/${where.paraIndex}`,
    )
  }

  /** occurrences of a line already matched */
  const taken = new Map()
  /** lines put in, by the line of the export they follow (-1: in front of everything) */
  const extras = new Map()
  let pointer = -1
  let checks = MAX_CONTAINMENT_CHECKS
  let bare = null
  const match = (key) => {
    const list = places.get(key)
    const used = taken.get(key) ?? 0
    if (!list || used >= list.length) return false
    taken.set(key, used + 1)
    pointer = Math.max(pointer, list[used])
    return true
  }
  const add = (text) => {
    const bucket = extras.get(pointer)
    if (bucket) bucket.push(text)
    else extras.set(pointer, [text])
  }
  /** One walked paragraph: found in the export, or put in. */
  const see = (text) => {
    const key = squash(text)
    if (!key || match(key)) return
    // part of a longer line of the export (a paragraph with an equation or a note in it)
    if (checks > 0) {
      checks -= 1
      bare ??= flat.replace(/\s+/g, '')
      if (bare.includes(key.replace(/\s+/g, ''))) return
    }
    add(text.trim())
  }

  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) {
    const paragraphs = doc.getParagraphCount(sec)
    for (let para = 0; para < paragraphs; para++) {
      const length = doc.getParagraphLength(sec, para)
      if (length > 0 && !fielded.has(`${sec}/${para}`)) see(doc.getTextRange(sec, para, 0, length))
      const controls = parse(doc.getControlTextPositions(sec, para)).length
      for (let ctrl = 0; ctrl < controls; ctrl++) {
        let dims
        try {
          dims = parse(doc.getTableDimensions(sec, para, ctrl))
        } catch {
          continue
        }
        const texts = []
        for (let cell = 0; cell < dims.cellCount; cell++) {
          const count = doc.getCellParagraphCount(sec, para, ctrl, cell)
          for (let k = 0; k < count; k++) {
            if (fielded.has(`${sec}/${para}/${ctrl}.${cell}.${k}`)) continue
            const size = doc.getCellParagraphLength(sec, para, ctrl, cell, k)
            if (size > 0) texts.push(doc.getTextInCell(sec, para, ctrl, cell, k, 0, size))
          }
        }
        // a table the export skipped whole goes in whole: a short cell ("1", "예") would
        // otherwise count as found wherever those characters occur in the document
        const known = texts.some((text) => {
          const list = places.get(squash(text))
          return Boolean(list) && (taken.get(squash(text)) ?? 0) < list.length
        })
        for (const text of texts) {
          if (known) see(text)
          else if (squash(text)) add(text.trim())
        }
      }
    }
  }
  if (extras.size === 0) return lines.join('\n')
  const out = [...(extras.get(-1) ?? [])]
  lines.forEach((line, index) => {
    out.push(line)
    const more = extras.get(index)
    if (more) out.push(...more)
  })
  return out.join('\n')
}

/**
 * A table is named by a path like a cell is: one entry per nesting level, the last one
 * holding the table's place among the objects of its paragraph. This is the address of
 * paragraph `k` of cell `cell` of that table.
 */
const cellAt = (path, cell, k) => [
  ...path.slice(0, -1),
  { controlIndex: path[path.length - 1].controlIndex, cellIndex: cell, cellParaIndex: k },
]

const tableKey = (sec, para, path) =>
  [
    sec,
    para,
    ...path.slice(0, -1).map((e) => `${e.controlIndex}.${e.cellIndex}.${e.cellParaIndex}`),
    path[path.length - 1].controlIndex,
  ].join('/')

/**
 * Every table of the document in reading order, a table inside a cell right after the table
 * it sits in. The engine lists the objects of a body paragraph but not those of a cell
 * paragraph, so a table inside a cell is found by asking for it; `partial` says the budget
 * for that ran out and tables inside cells may be missing from the end of the list.
 */
function tablesOf(doc) {
  const tables = []
  let lookups = MAX_NESTED_LOOKUPS
  const dimensions = (sec, para, path) => {
    try {
      return parse(doc.getTableDimensionsByPath(sec, para, JSON.stringify(path)))
    } catch {
      // not a table: a picture, a text box, a section definition
      return null
    }
  }
  const add = (sec, para, path, dims, parent, depth) => {
    const index = tables.length
    tables.push({
      sec,
      para,
      path,
      rows: dims.rowCount,
      cols: dims.colCount,
      cells: dims.cellCount,
      parent,
    })
    if (depth >= MAX_TABLE_DEPTH) return
    for (let cell = 0; cell < dims.cellCount && lookups > 0; cell++) {
      const paragraphs = doc.getCellParagraphCountByPath(
        sec,
        para,
        JSON.stringify(cellAt(path, cell, 0)),
      )
      for (let k = 0; k < paragraphs && lookups > 0; k++) {
        for (let inner = 0; inner < NESTED_CONTROLS_TRIED; inner++) {
          lookups -= 1
          const innerPath = [
            ...cellAt(path, cell, k),
            { controlIndex: inner, cellIndex: 0, cellParaIndex: 0 },
          ]
          const innerDims = dimensions(sec, para, innerPath)
          if (innerDims) add(sec, para, innerPath, innerDims, index, depth + 1)
        }
      }
    }
  }
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) {
    const paragraphs = doc.getParagraphCount(sec)
    for (let para = 0; para < paragraphs; para++) {
      const controls = parse(doc.getControlTextPositions(sec, para)).length
      for (let ctrl = 0; ctrl < controls; ctrl++) {
        const path = [{ controlIndex: ctrl, cellIndex: 0, cellParaIndex: 0 }]
        const dims = dimensions(sec, para, path)
        if (dims) add(sec, para, path, dims, null, 1)
      }
    }
  }
  return { tables, partial: lookups <= 0 }
}

/**
 * Table `number` (as listTables numbers them) when it sits in a body paragraph, with its
 * cells; otherwise a refusal. The engine merges and splits cells by table and cell number,
 * which cannot name a table inside another table's cell.
 */
function bodyTable(doc, number) {
  const { tables } = tablesOf(doc)
  const table = Number.isInteger(number) ? tables[number - 1] : undefined
  if (!table) return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
  if (table.path.length > 1) return { refusal: { ok: false, reason: 'unsupported_place' } }
  return { table, grid: gridOf(doc, table) }
}

/** The cells of a table with the place each takes: zero-based row and column, and its spans. */
function gridOf(doc, table) {
  const cells = []
  for (let cell = 0; cell < table.cells; cell++) {
    const info = parse(
      doc.getCellInfoByPath(table.sec, table.para, JSON.stringify(cellAt(table.path, cell, 0))),
    )
    cells.push({
      cell,
      row: info.row,
      col: info.col,
      rowSpan: info.rowSpan || 1,
      colSpan: info.colSpan || 1,
    })
  }
  return cells
}

/** The paragraphs of one cell, addressed like the paragraphs a match sits in. */
const cellBox = (doc, table, cell) =>
  containerOf(doc, { sec: table.sec, para: table.para, cellPath: cellAt(table.path, cell, 0) })

function paragraphsOf(box) {
  const texts = []
  const count = box.count()
  for (let k = 0; k < count; k++) texts.push(box.text(k, box.length(k)))
  return texts
}

/**
 * Whether a cell holds an object: a picture, a shape, a table of its own. Such a cell can
 * be without a single character and still not be empty, and text written into it lands on
 * top of the picture. The engine does not list the objects of a cell paragraph, but asked
 * for a table there it answers "out of range" only when the paragraph holds no object at
 * all. Should that wording change, every cell reads as holding one and nothing is written:
 * the safe side, and the engine tests fail.
 */
function cellHoldsObject(doc, table, cell) {
  const paragraphs = doc.getCellParagraphCountByPath(
    table.sec,
    table.para,
    JSON.stringify(cellAt(table.path, cell, 0)),
  )
  for (let k = 0; k < paragraphs; k++) {
    const first = [
      ...cellAt(table.path, cell, k),
      { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
    ]
    try {
      doc.getTableDimensionsByPath(table.sec, table.para, JSON.stringify(first))
      return true
    } catch (thrown) {
      if (!String(thrown).includes(NO_OBJECT_THERE)) return true
    }
  }
  return false
}

/**
 * Whether a cell holds an object other than a table: a picture, a shape. Asked for a table
 * there, the engine answers with its size, "out of range" when the paragraph has no more
 * objects, and another error for an object that is not a table. Only the first few objects
 * of a paragraph are asked about, as tablesOf does; a caller that removes the cell checks
 * the object count afterwards.
 */
function cellHoldsOtherObject(doc, table, cell) {
  const paragraphs = doc.getCellParagraphCountByPath(
    table.sec,
    table.para,
    JSON.stringify(cellAt(table.path, cell, 0)),
  )
  for (let k = 0; k < paragraphs; k++) {
    for (let inner = 0; inner < NESTED_CONTROLS_TRIED; inner++) {
      const path = [
        ...cellAt(table.path, cell, k),
        { controlIndex: inner, cellIndex: 0, cellParaIndex: 0 },
      ]
      try {
        doc.getTableDimensionsByPath(table.sec, table.para, JSON.stringify(path))
      } catch (thrown) {
        if (String(thrown).includes(NO_OBJECT_THERE)) break
        return true
      }
    }
  }
  return false
}

/** Whether the cell paragraph at `cellPath` (its last entry naming the paragraph) holds an object. */
function paragraphHoldsObject(doc, sec, para, cellPath) {
  const first = [...cellPath, { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]
  try {
    doc.getTableDimensionsByPath(sec, para, JSON.stringify(first))
    return true
  } catch (thrown) {
    return !String(thrown).includes(NO_OBJECT_THERE)
  }
}

/**
 * The cells of a table that an object of the page lies on: a seal or a logo that belongs to
 * the body text and floats over the cell. It is not in the cell, so cellHoldsObject does not
 * see it, but text written there lands under it all the same. An object counts for the cell
 * its middle is in; one placed behind the text (a watermark) does not count.
 */
function coveredCells(doc, table) {
  const covered = new Set()
  let boxes
  try {
    boxes = parse(doc.getTableCellBboxesByPath(table.sec, table.para, JSON.stringify(table.path)))
  } catch {
    return covered
  }
  const pages = new Map()
  for (const box of boxes) {
    if (!Number.isInteger(box.pageIndex)) continue
    const list = pages.get(box.pageIndex)
    if (list) list.push(box)
    else pages.set(box.pageIndex, [box])
  }
  for (const [page, cells] of pages) {
    let controls
    try {
      controls = parse(doc.getPageControlLayout(page)).controls ?? []
    } catch {
      continue
    }
    for (const control of controls) {
      if (!FLOATING_KINDS.has(control.type) || control.wrap === 'behindText') continue
      const x = control.x + control.w / 2
      const y = control.y + control.h / 2
      const under = cells.find(
        (cell) => x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h,
      )
      if (under) covered.add(under.cellIdx)
    }
  }
  return covered
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text)

/**
 * The click-here fields that sit directly in a table cell, by table and cell. A cell that
 * holds one is filled through the field: text typed beside an empty field would leave its
 * guide text standing next to the answer.
 */
function fieldsByCell(doc) {
  const byCell = new Map()
  parse(doc.getFieldList()).forEach((field, index) => {
    if (field.cellField === true) return
    const where = field.location
    const path = where && Array.isArray(where.path) ? where.path : []
    if (path.length === 0 || path.some((entry) => entry.type !== 'cell')) return
    const cells = path.map((entry) => ({
      controlIndex: entry.controlIndex,
      cellIndex: entry.cellIndex,
      cellParaIndex: entry.paraIndex,
    }))
    const key = `${tableKey(where.sectionIndex, where.paraIndex, cells)}:${cells[cells.length - 1].cellIndex}`
    const entry = {
      number: index + 1,
      fieldId: field.fieldId,
      value: field.value ?? '',
      guide: field.guide ?? '',
    }
    const list = byCell.get(key)
    if (list) list.push(entry)
    else byCell.set(key, [entry])
  })
  return byCell
}

/** An empty field shows its guide text, which the engine also reports as its value. */
const fieldIsEmpty = (field) => field.value === '' || field.value === field.guide

/** What fillCells was asked to write: 1-based places, and the text of each as lines. */
function checkCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > MAX_FILLED_CELLS) {
    throw fail('BAD_ARGUMENT', `cells must be a list of 1 to ${MAX_FILLED_CELLS} entries`)
  }
  return cells.map((entry) => {
    const { row, col, text } = entry ?? {}
    if (!Number.isInteger(row) || row < 1 || !Number.isInteger(col) || col < 1) {
      throw fail('BAD_ARGUMENT', 'row and col count from 1 and are whole numbers')
    }
    if (typeof text !== 'string') throw fail('BAD_ARGUMENT', 'the text of a cell must be a string')
    const lines = text.split(/\r?\n/)
    if (lines.length > MAX_CELL_LINES || lines.some((line) => CONTROL_CHARS.test(line))) {
      throw fail('BAD_ARGUMENT', `a cell takes plain text of at most ${MAX_CELL_LINES} lines`)
    }
    return { row, col, lines }
  })
}

/** What a row or column call names: true for rows, false for columns. */
function checkLines(what, at, count) {
  if (what !== 'rows' && what !== 'columns') {
    throw fail('BAD_ARGUMENT', 'what must be "rows" or "columns"')
  }
  if (!Number.isInteger(at) || at < 1) {
    throw fail('BAD_ARGUMENT', 'at counts from 1 and is a whole number')
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_TABLE_LINES) {
    throw fail('BAD_ARGUMENT', `count must be between 1 and ${MAX_TABLE_LINES}`)
  }
  return what === 'rows'
}

function pickHit(hits, occurrence) {
  if (hits.length === 0) return { reason: 'not_found' }
  if (occurrence === undefined || occurrence === null) {
    return hits.length === 1 ? { hit: hits[0] } : { reason: 'ambiguous' }
  }
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > hits.length) {
    return { reason: 'no_such_occurrence' }
  }
  return { hit: hits[occurrence - 1] }
}

/** Most notes listNotes lists. */
const MAX_LISTED_NOTES = 200
/** Longest note text listNotes shows. */
const MAX_LISTED_NOTE_CHARS = 500
/** Most paragraphs one note is written with. */
const MAX_NOTE_LINES = 20
/** Text shown before a note's mark, so the model can tell where it sits. */
const NOTE_CONTEXT_CHARS = 30
const NOTE_KINDS = ['footnote', 'endnote']
const NOTE_CONTROL_IDS = new Set(['fn', 'en'])
/** What comes before the text in the first paragraph of a note: its number and a space. */
const NOTE_NUMBER_CHARS = 2

/**
 * The engine answers a note with its text as JSON, but leaves a tab in that text unescaped,
 * which JSON does not allow. Its answers carry no whitespace between tokens, so every control
 * character in one is inside a string and can be escaped.
 */
const parseNoteInfo = (json) =>
  JSON.parse(
    // eslint-disable-next-line no-control-regex
    json.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
  )

/**
 * The footnotes and endnotes of the body, in reading order. A note is addressed by the
 * body paragraph its mark sits in and its index among that paragraph's controls. The
 * engine has no such address for a note inside a table cell or a text box: `elsewhere`
 * counts those.
 *
 * The first paragraph of a note starts with its number and a space (`prefix` characters);
 * `lines` is the text after them. A note that holds anything but text (an equation, a
 * picture) is not `plain`: its text is shown but not rewritten.
 */
function notesOf(doc) {
  const controls = parse(doc.getControls()).filter((control) =>
    NOTE_CONTROL_IDS.has(control.ctrlId),
  )
  const notes = []
  if (controls.length === 0) return { notes, elsewhere: 0 }
  // the notes of the body, in document order: their kind, when the engine cannot say it
  // here (a new endnote has no place on a page until the editor lays the pages out again)
  const bodyNotes = controls.filter((control) => control.list === 0)
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) {
    const paragraphs = doc.getParagraphCount(sec)
    for (let para = 0; para < paragraphs && notes.length < controls.length; para++) {
      const positions = parse(doc.getControlTextPositions(sec, para))
      positions.forEach((offset, control) => {
        let info
        try {
          info = parseNoteInfo(doc.getFootnoteInfo(sec, para, control))
        } catch {
          return // not a note: a table, a picture, a section definition
        }
        if (!info.ok) return
        let kind = null
        let prefix = NOTE_NUMBER_CHARS
        try {
          const edit = parse(doc.getNoteEditInfo(sec, para, control))
          kind = edit.kind
          if (Number.isInteger(edit.charOffset)) prefix = edit.charOffset
        } catch {
          const listed = bodyNotes[notes.length]
          if (listed && listed.para === para && listed.controlIndex === control) {
            kind = listed.ctrlId === 'en' ? 'endnote' : 'footnote'
          }
        }
        const texts = Array.isArray(info.texts) ? info.texts : []
        notes.push({
          sec,
          para,
          control,
          offset,
          kind: kind === 'endnote' ? 'endnote' : 'footnote',
          number: info.number,
          prefix,
          lines: texts.map((line, index) => (index === 0 ? line.slice(prefix) : line)),
          plain: texts.reduce((sum, line) => sum + line.length, 0) === info.totalTextLen,
        })
      })
    }
  }
  return { notes, elsewhere: Math.max(0, controls.length - notes.length) }
}

/** The text in front of a note's mark, cut to a few words. */
function noteContext(doc, note) {
  const start = Math.max(0, note.offset - NOTE_CONTEXT_CHARS)
  return note.offset > start
    ? doc.getTextRange(note.sec, note.para, start, note.offset - start)
    : ''
}

function checkNoteText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw fail('BAD_ARGUMENT', 'the note text must be a non-empty string')
  }
  const lines = text.split('\n')
  if (lines.length > MAX_NOTE_LINES) {
    throw fail('BAD_ARGUMENT', `a note takes at most ${MAX_NOTE_LINES} paragraphs`)
  }
  for (const line of lines) {
    if (CONTROL_CHARS.test(line))
      throw fail('BAD_ARGUMENT', 'the note text holds a control character')
  }
  return lines
}

/**
 * Write `lines` into a note whose first paragraph holds only its number (`prefix`
 * characters): the first line after the number, each further line as a paragraph of its own.
 */
function writeNote(doc, at, prefix, lines) {
  const { sec, para, control } = at
  let end = prefix
  lines.forEach((line, index) => {
    if (index > 0) {
      // the engine counts a split in the first paragraph one place further than an insert (the
      // number in front); past the end it splits at the end, so the extra place is safe
      const at = index - 1 === 0 ? end + 1 : end
      expectOk(doc.splitParagraphInFootnote(sec, para, control, index - 1, at), 'split the note')
      end = 0
    }
    if (line) {
      expectOk(doc.insertTextInFootnote(sec, para, control, index, end, line), 'write the note')
    }
    end += line.length
  })
}

const noteSummary = (note) => ({ kind: note.kind, number: note.number })

/** Most entries one table of contents takes. */
const MAX_TOC_ENTRIES = 100
const MAX_TOC_LEVEL = 3
/** Longest heading a table of contents shows. */
const MAX_TOC_TEXT = 120
/** How far a heading is indented, per level below the first. */
const TOC_INDENT_PT = 14
/** Width of the page-number column; the heading column takes the rest of the text width. */
const TOC_PAGE_COLUMN_PT = 45
/** The cells of a contents table: no lines, Hangul's usual cell margins. */
const TOC_CELL_STYLE = 'border:none;padding:1.41pt 5.1pt'
/** Room a heading cell keeps free: its margins, and a little for a font wider than guessed. */
const TOC_CELL_SLACK_PT = 24
/** How much of a heading is looked up when the page numbers are written again. */
const TOC_KEY_CHARS = 40
const PAGE_NUMBER = /^\s*(\d+)\s*$/

/** The text of a body paragraph. */
const bodyText = (doc, sec, k) => {
  const length = doc.getParagraphLength(sec, k)
  return length > 0 ? doc.getTextRange(sec, k, 0, length) : ''
}

/** The page number a reader sees for a body paragraph (the section may number its pages its own way). */
function pageNumberOf(doc, sec, para) {
  const at = parse(doc.getPageOfPosition(sec, para))
  if (!at.ok || !Number.isInteger(at.page))
    throw fail('ENGINE', 'could not find the page of a heading')
  const info = parse(doc.getPageInfo(at.page))
  return Number.isInteger(info.pageNumber) ? info.pageNumber : at.page + 1
}

/** The width of the text of a section's page, in points. */
function textWidthPt(doc, sec) {
  const page = parse(doc.getPageDef(sec))
  const width = (page.landscape ? page.height : page.width) - page.marginLeft - page.marginRight
  return Math.max(100, Math.round((width - (page.marginGutter ?? 0)) / 100))
}

function checkTocEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_TOC_ENTRIES) {
    throw fail('BAD_ARGUMENT', `entries must list 1 to ${MAX_TOC_ENTRIES} headings`)
  }
  for (const entry of entries) {
    if (!entry || typeof entry.find !== 'string' || entry.find.length === 0) {
      throw fail('BAD_ARGUMENT', 'each entry needs the text of its heading')
    }
    if (!Number.isInteger(entry.level) || entry.level < 1 || entry.level > MAX_TOC_LEVEL) {
      throw fail('BAD_ARGUMENT', `each entry needs a level from 1 to ${MAX_TOC_LEVEL}`)
    }
  }
}

/**
 * A table of contents as a table the engine pastes: a row per heading, the heading in the
 * first column (indented by level), its page number right-aligned in the second. No lines:
 * it reads as a list. Not lines with a right tab, as Hangul makes them: rhwp writes a new
 * tab without the width Hangul keeps in it, and Hangul then shows the tab as nothing.
 */
function tocHtml(rows, font, widthPt) {
  const text = [
    font.family ? `font-family:${font.family};mso-fareast-font-family:${font.family}` : '',
    `font-size:${font.points}pt`,
  ]
    .filter(Boolean)
    .join(';')
  const headingWidth = Math.max(50, widthPt - TOC_PAGE_COLUMN_PT)
  const cellStyle = TOC_CELL_STYLE
  const row = ({ text: heading, level, page }) =>
    '<tr>' +
    `<td style="${cellStyle};width:${headingWidth}pt">` +
    `<p style="margin-left:${(level - 1) * TOC_INDENT_PT}pt"><span style="${text}">${escapeHtml(heading)}</span></p></td>` +
    `<td style="${cellStyle};width:${TOC_PAGE_COLUMN_PT}pt">` +
    `<p style="text-align:right"><span style="${text}">${page}</span></p></td>` +
    '</tr>'
  return `<table>${rows.map(row).join('')}</table>`
}

/** Width of a character in ems, roughly: full width for Hangul and CJK, about half for the rest. */
const emsOf = (ch) => (ch.codePointAt(0) > 0x2e7f ? 1 : 0.55)

/**
 * A heading cut to what fits on one line of the contents table. A row whose text wraps is
 * laid out taller by rhwp but drawn at its stored height by Hangul, the lines on top of one
 * another, and the two then also count different pages. Headings are short; a whole
 * paragraph taken for one is not, and is cut.
 */
function oneLine(text, level, font, widthPt) {
  const room =
    (widthPt - TOC_PAGE_COLUMN_PT - (level - 1) * TOC_INDENT_PT - TOC_CELL_SLACK_PT) / font.points
  let used = 0
  let out = ''
  for (const ch of text) {
    used += emsOf(ch)
    if (used > room - 1) return `${out.trimEnd()}…`
    out += ch
  }
  return out
}

/** The cell at a row and column of a table (zero-based), as gridOf lists it. */
const cellOf = (grid, row, col) => grid.find((cell) => cell.row === row && cell.col === col)

/** Replace the text of the first paragraph of a cell. */
function setCellText(doc, table, cell, value) {
  const box = cellBox(doc, table, cell)
  const length = box.length(0)
  if (length > 0) box.deleteText(0, length)
  box.insert(0, value)
}

// ---- tab widths ----

/** Page positions are in pixels of 75 HWPUNIT each. */
const HWPUNIT_PER_PX = 75
/** Tab stop positions and paragraph margins come from the engine at twice their HWPUNIT. */
const PARA_UNIT_SCALE = 2
/** A tab stop counts as passed when the tab starts this close to it, as the engine lays it out. */
const TAB_STOP_SLACK_PX = 0.5
/** Most tabs measured in one call. */
const MAX_MEASURED_TABS = 5000
/** Kinds of tab stop as the engine numbers them. */
const TAB_LEFT = 0
const TAB_RIGHT = 1

/**
 * The table at `ordinal` among the tables of a paragraph, as a path: in a body paragraph
 * (`outer` empty) its objects are listed, in a cell paragraph (`outer` its address) the
 * first few objects are tried, as tablesOf does.
 */
function tableAt(doc, sec, para, outer, ordinal) {
  const tried =
    outer.length === 0
      ? parse(doc.getControlTextPositions(sec, para)).length
      : NESTED_CONTROLS_TRIED
  let seen = 0
  for (let control = 0; control < tried; control++) {
    const path = [...outer, { controlIndex: control, cellIndex: 0, cellParaIndex: 0 }]
    let dims = null
    try {
      dims = parse(doc.getTableDimensionsByPath(sec, para, JSON.stringify(path)))
    } catch {
      // not a table
    }
    if (dims && seen++ === ordinal) return { control, cells: dims.cellCount }
  }
  return null
}

/** The paragraph a tab sits in, with the engine calls that read it; null when it is not there. */
function tabParagraph(doc, spot) {
  const { sec, para } = spot
  if (spot.cells.length === 0) {
    return {
      length: doc.getParagraphLength(sec, para),
      text: (length) => doc.getTextRange(sec, para, 0, length),
      rect: (offset) => parse(doc.getCursorRect(sec, para, offset)),
      props: () => parse(doc.getParaPropertiesAt(sec, para)),
    }
  }
  let outer = []
  for (const step of spot.cells) {
    const table = tableAt(doc, sec, para, outer, step.table)
    if (!table || step.cell >= table.cells) return null
    outer = [...outer, { controlIndex: table.control, cellIndex: step.cell, cellParaIndex: 0 }]
    const count = doc.getCellParagraphCountByPath(sec, para, JSON.stringify(outer))
    if (step.para >= count) return null
    outer[outer.length - 1].cellParaIndex = step.para
  }
  const json = JSON.stringify(outer)
  const last = outer[outer.length - 1]
  return {
    length: doc.getCellParagraphLengthByPath(sec, para, json),
    text: (length) => doc.getTextInCellByPath(sec, para, json, 0, length),
    rect: (offset) => parse(doc.getCursorRectByPath(sec, para, json, offset)),
    // the engine reads a cell paragraph's formatting by table and cell number only
    props: () =>
      outer.length === 1
        ? parse(
            doc.getCellParaPropertiesAt(
              sec,
              para,
              last.controlIndex,
              last.cellIndex,
              last.cellParaIndex,
            ),
          )
        : null,
  }
}

/**
 * The kind and leader of the tab stop a tab goes to: the first stop past where the tab
 * starts, as the engine looks it up; past the last stop, the right edge when the paragraph
 * says so, and otherwise the plain left tab every so often. Tab stops are measured from
 * where the paragraph's margin starts: the start of the first line less its indent.
 */
function tabStopOf(props, firstX, startX) {
  if (!props) return { type: TAB_LEFT, fill: 0 }
  const toPx = (value) => (Number(value) || 0) / PARA_UNIT_SCALE / HWPUNIT_PER_PX
  const indent = toPx(props.indent)
  const origin = firstX - toPx(props.marginLeft) - Math.max(indent, 0)
  const at = startX - origin
  for (const stop of props.tabStops ?? []) {
    if (toPx(stop.position) > at + TAB_STOP_SLACK_PX) {
      return { type: Number(stop.type) || 0, fill: Number(stop.fill) || 0 }
    }
  }
  return props.tabAutoRight ? { type: TAB_RIGHT, fill: 0 } : { type: TAB_LEFT, fill: 0 }
}

/**
 * How wide the editor lays a tab out, in HWPUNIT, and the kind and leader of its stop; null
 * when the tab is not where the file says (another paragraph, another number of tabs), or
 * cannot be measured (it ends a line, its caret positions are not on one line).
 */
function measureTab(doc, spot) {
  const paragraph = tabParagraph(doc, spot)
  if (!paragraph || paragraph.length <= 0) return null
  const text = paragraph.text(paragraph.length)
  const offsets = []
  for (let i = text.indexOf('\t'); i >= 0; i = text.indexOf('\t', i + 1)) offsets.push(i)
  if (offsets.length !== spot.tabs || spot.tab >= offsets.length) return null
  const offset = offsets[spot.tab]
  const before = paragraph.rect(offset)
  const after = paragraph.rect(offset + 1)
  if (before.pageIndex !== after.pageIndex || Math.abs(before.y - after.y) > 1) return null
  const width = Math.round((after.x - before.x) * HWPUNIT_PER_PX)
  if (!(width > 0)) return null
  const first = paragraph.rect(0)
  const { type, fill } = tabStopOf(paragraph.props(), first.x, before.x)
  return { width, type, fill }
}

// ---- marks of changes ----

/** The run of a mark within a paragraph of `length` characters: its own, or the whole paragraph. */
function spanOf(mark, length) {
  const offset = Math.min(Math.max(0, Number.isInteger(mark.offset) ? mark.offset : 0), length)
  const want = Number.isInteger(mark.length) ? mark.length : 0
  return want > 0 ? [offset, Math.min(length, offset + want)] : [0, length]
}

/**
 * Where a marked place is on the pages: rectangles in page pixels with their page. A place
 * without text of its own (a table on a line of its own) is the tables of its paragraph.
 * Nothing for a place that is no longer there.
 */
function markRects(doc, mark) {
  const { sec, para } = mark
  if (sec >= doc.getSectionCount()) return []
  const path = Array.isArray(mark.path) && mark.path.length > 0 ? mark.path : null
  if (!path) {
    if (para >= doc.getParagraphCount(sec)) return []
    const [start, end] = spanOf(mark, doc.getParagraphLength(sec, para))
    const rects = end > start ? parse(doc.getSelectionRects(sec, para, start, para, end)) : []
    if (rects.length > 0) return rects
    const tables = []
    const controls = parse(doc.getControlTextPositions(sec, para)).length
    for (let control = 0; control < controls; control++) {
      try {
        tables.push(parse(doc.getTableBBox(sec, para, control)))
      } catch {
        // not a table
      }
    }
    return tables
  }
  const json = JSON.stringify(path)
  const cellPara = path[path.length - 1].cellParaIndex
  const [start, end] = spanOf(mark, doc.getCellParagraphLengthByPath(sec, para, json))
  return end > start
    ? parse(doc.getSelectionRectsInCellByPath(sec, para, json, cellPara, start, cellPara, end))
    : []
}

/** Body paragraphs per section. */
function paragraphCounts(doc) {
  const counts = []
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) counts.push(doc.getParagraphCount(sec))
  return counts
}

/**
 * The marks of earlier changes, moved for a change that added or removed body paragraphs:
 * `at` is where it did (the first paragraph it made, or the one it removed). Marks inside
 * table cells keep their place: a change in a cell does not move the body.
 */
function shiftMarks(marks, before, after, at) {
  return marks.flatMap((mark) => {
    const delta = (after[mark.sec] ?? 0) - (before[mark.sec] ?? 0)
    if (delta === 0 || !at || at.sec !== mark.sec) return [mark]
    if (delta > 0) return [mark.para >= at.para ? { ...mark, para: mark.para + delta } : mark]
    if (mark.para < at.para) return [mark]
    if (mark.para < at.para - delta) return []
    return [{ ...mark, para: mark.para + delta }]
  })
}

/** Takes the plugin's double-click listener off the page again. */
let stopListening = null
/** Takes the marks off the page again, with what keeps them in place. */
let stopMarking = null

/**
 * Run `fn` with the text widths every PC lays out the same (the editor's print and export
 * do so): with the widths measured on this screen on, pages could break differently. They
 * are put back afterwards.
 */
function withPortableWidths(doc, fn) {
  const measured = doc.canvasMetricsActive?.() ?? false
  if (measured) doc.selectCanvasMetrics(false)
  try {
    return fn()
  } finally {
    if (measured) doc.selectCanvasMetrics(true)
  }
}

export const agentPlugin = {
  id: AGENT_PLUGIN_ID,
  apiVersion: 1,

  deactivate() {
    if (stopListening) stopListening()
    stopListening = null
    if (stopMarking) stopMarking()
    stopMarking = null
  },

  activate(host) {
    // counts the changes this plugin did not make (the user typing, the editor's own undo):
    // the panel takes back a run only while this has not moved since the run ended, because
    // the editor's history is one stack and anything on top of the run would be undone first
    let foreign = 0
    let own = false
    // the text is read for every request; it only changes when the document does
    let text = null
    // the places this plugin changed since the panel last cleared them, as they are now
    let marks = []
    host.events.on('document-changed', () => {
      text = null
      if (!own) {
        foreign += 1
        // an edit of the user's own moves text under the marks: they would point astray
        if (marks.length > 0) {
          marks = []
          refreshMarks()
        }
      }
    })

    let layer = null
    let settle = null
    /** Draw the marks again (a command, for the editor's own services); later once more. */
    const refreshMarks = () => {
      try {
        host.automation.execute(MARK_COMMAND)
      } catch {
        // an editor without commands: no marks
      }
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => {
        settle = null
        try {
          host.automation.execute(MARK_COMMAND)
        } catch {
          // as above
        }
      }, MARK_SETTLE_MS)
    }

    /** Draws the marks where the editor lays their places out, as it draws its selection. */
    const drawMarks = (services) => {
      const page = globalThis.document
      const content = page ? page.querySelector('#scroll-content') : null
      if (!content) return
      if (!layer || layer.parentElement !== content) {
        if (stopMarking) stopMarking()
        layer = page.createElement('div')
        layer.className = 'kordoc-change-marks'
        layer.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:${MARK_LAYER_Z};`
        content.appendChild(layer)
        // the content is resized when the zoom changes: the marks are placed again
        const Observer = globalThis.ResizeObserver
        const observer = Observer ? new Observer(() => refreshMarks()) : null
        if (observer) observer.observe(content)
        const own = layer
        stopMarking = () => {
          if (observer) observer.disconnect()
          own.remove()
          if (layer === own) layer = null
        }
      }
      layer.replaceChildren()
      if (marks.length === 0) return
      const input = services && services.getInputHandler ? services.getInputHandler() : null
      const scroll = input ? input.virtualScroll : null
      const viewport =
        services && services.getViewportManager ? services.getViewportManager() : null
      if (!scroll || !viewport) return
      const zoom = viewport.getZoom()
      const width = content.clientWidth
      const rects = host.read((doc) =>
        marks.flatMap((mark) => {
          try {
            return markRects(doc, mark)
          } catch {
            return []
          }
        }),
      )
      for (const rect of rects) {
        const box = page.createElement('div')
        const left = scroll.getPageLeftResolved(rect.pageIndex, width) + rect.x * zoom
        const top = scroll.getPageOffset(rect.pageIndex) + rect.y * zoom
        // one property at a time: a style string is dropped whole where one part is not understood
        Object.assign(box.style, {
          position: 'absolute',
          left: `${left.toFixed(2)}px`,
          top: `${top.toFixed(2)}px`,
          width: `${(rect.width * zoom).toFixed(2)}px`,
          height: `${(rect.height * zoom).toFixed(2)}px`,
          background: MARK_FILL,
          boxShadow: `inset 0 -2px 0 ${MARK_LINE}`,
          borderRadius: '2px',
        })
        layer.appendChild(box)
      }
    }

    try {
      host.automation.registerCommand({
        id: MARK_COMMAND,
        label: 'Mark the changes',
        execute: (services) => {
          try {
            drawMarks(services)
          } catch {
            // marks are a help; a page that cannot take them stays as it is
          }
        },
      })
    } catch {
      // registered by an earlier activation of this plugin, or a host without commands
    }

    /** What a change leaves to mark, and the earlier marks moved for it. */
    const noteChange = (label, result, before, after) => {
      if (!result || result.ok === false) return
      const places = Array.isArray(result.marks) ? result.marks : result.place ? [result.place] : []
      marks = shiftMarks(marks, before, after, result.shiftAt ?? places[0] ?? result.place ?? null)
      if (!UNMARKED_CHANGES.has(label)) marks = [...marks, ...places].slice(0, MAX_MARKS)
      refreshMarks()
    }

    // the answer of the reveal command: a command of the editor returns nothing itself
    let shown = false
    try {
      host.automation.registerCommand({
        id: REVEAL_COMMAND,
        label: 'Show a change',
        execute: (services, place) => {
          try {
            shown = showPlace(services, place)
          } catch {
            // a place that is no longer there (the change was undone) is not an error
            shown = false
          }
        },
      })
    } catch {
      // registered by an earlier activation of this plugin, or a host without commands
    }

    // what the selection command saw, and the selection this plugin made itself by showing
    // a change: that one is not something the user picked
    let picked = null
    let shownKey = null
    try {
      host.automation.registerCommand({
        id: SELECTION_COMMAND,
        label: 'Read the selection',
        execute: (services) => {
          try {
            picked = cursorSelection(services)
          } catch {
            picked = null
          }
        },
      })
    } catch {
      // as above
    }

    try {
      host.automation.registerCommand({
        id: WORD_COMMAND,
        label: 'Select the word',
        execute: (services) => {
          try {
            selectWord(services, (at) =>
              host.read((doc) => {
                const box = containerOf(doc, { sec: at.sec, para: at.para, cellPath: at.path })
                return box.text(at.k, box.length(at.k))
              }),
            )
          } catch {
            // a place the caret cannot be read at: nothing is selected, as before
          }
        },
      })
    } catch {
      // as above
    }
    const page = globalThis.document
    if (page) {
      const onDoubleClick = (event) => {
        // the studio handled it (a header, a text box, a picture), or it was not in the page
        if (event.defaultPrevented) return
        const target = event.target
        if (!target || !target.closest || !target.closest('#scroll-container')) return
        try {
          host.automation.execute(WORD_COMMAND)
        } catch {
          // no such command in this editor: the double click stays what it was
        }
      }
      if (stopListening) stopListening()
      page.addEventListener('dblclick', onDoubleClick)
      stopListening = () => page.removeEventListener('dblclick', onDoubleClick)
    }

    const guarded =
      (fn) =>
      (...args) => {
        try {
          return fn(...args)
        } catch (thrown) {
          throw asError(thrown)
        }
      }

    /** One change of this plugin: one undo step, not counted as foreign. */
    const change = (label, fn) => {
      own = true
      // not left to the editor's event alone: a stale text would send the model after
      // words that are no longer there
      text = null
      try {
        const done = host.transaction(label, (tx) => {
          tx.deferPagination()
          const doc = tx.doc()
          const before = paragraphCounts(doc)
          const result = fn(doc)
          return { result, before, after: paragraphCounts(doc) }
        })
        noteChange(label, done.result, done.before, done.after)
        if (
          done.result &&
          typeof done.result === 'object' &&
          ('marks' in done.result || 'shiftAt' in done.result)
        ) {
          const { marks: _places, shiftAt: _at, ...rest } = done.result
          return rest
        }
        return done.result
      } finally {
        own = false
      }
    }

    const listMatches = (doc, hits) =>
      hits.slice(0, MAX_LISTED_MATCHES).map((hit, index) => describe(doc, hit, index))

    /**
     * A new paragraph is made by splitting the one next to it, the way Enter does, so that
     * it takes that paragraph's formatting. Where an object sits at the split, though, the
     * engine may carry it into the new paragraph (it depends on the kind of object). So:
     * "before" is only done in a paragraph without objects, and "after" a paragraph whose
     * object sits at its end (a table on a line of its own, typically) adds an empty
     * paragraph behind it instead of splitting (`plain`).
     */
    const guardObjects = (box, where, count) => {
      const positions = box.objectPositions(box.index)
      if (where === 'before') {
        return positions.length > 0
          ? { refusal: { ok: false, reason: 'has_objects', count } }
          : { box }
      }
      const plain = positions.some((position) => position >= box.length(box.index))
      return { box, plain }
    }

    /** Make an empty paragraph after paragraph `k` of `box`; its index is k + 1. */
    const openAfter = (box, k, plain) => {
      if (plain) box.addAfter(k)
      else box.split(k, box.length(k))
    }

    /**
     * The paragraph a paragraph edit works on: the one `anchor` occurs in, or for "end" the
     * last paragraph of the document. `box` addresses it; without one, `refusal` says why.
     */
    const locate = (doc, anchor, occurrence, where) => {
      if (where === 'end') {
        const sec = doc.getSectionCount() - 1
        return guardObjects(
          containerOf(doc, { sec, para: doc.getParagraphCount(sec) - 1 }),
          where,
          1,
        )
      }
      const hits = searchAll(doc, anchor)
      const picked = pickHit(hits, occurrence)
      const reason = !picked.hit
        ? picked.reason
        : !isReplaceable(picked.hit)
          ? 'unsupported_place'
          : null
      if (reason) {
        return {
          refusal: {
            ok: false,
            reason,
            count: hits.length,
            ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
          },
        }
      }
      return guardObjects(containerOf(doc, picked.hit), where, hits.length)
    }

    /**
     * Run a paragraph edit that must not cost the document an object or a field value. The
     * edit calls `mustKeep(before, after)`; when something is gone it throws, the editor
     * rolls the whole change back, and the call answers `has_objects` instead of failing.
     */
    const keepingObjects = (edit) => {
      let lost = false
      const mustKeep = (before, after) => {
        if (before.controls === after.controls && before.fields === after.fields) return
        lost = true
        throw fail('HAS_OBJECTS', 'the change would remove an object of the document')
      }
      try {
        return edit(mustKeep)
      } catch (thrown) {
        if (lost) return { ok: false, reason: 'has_objects', count: 1 }
        throw thrown
      }
    }

    return {
      foreignChanges: () => foreign,

      /** The whole document as plain text, table cells included, in reading order. */
      readText: guarded(() => {
        text ??= host.read(textOf)
        return text
      }),

      /** Where a piece of text occurs. Exact, case-sensitive. */
      findText: guarded((find) =>
        host.read((doc) => {
          const hits = searchAll(doc, find)
          return { count: hits.length, matches: listMatches(doc, hits) }
        }),
      ),

      /**
       * Replace one occurrence of `find`. Without `occurrence` the text must occur exactly
       * once; with it (1-based) that occurrence is replaced. Formatting around the replaced
       * span stays as it was.
       */
      replaceText: guarded((find, replacement, occurrence) => {
        checkReplacement(replacement)
        // decided on a read first: a transaction is only opened for a change that will happen
        const refusal = host.read((doc) => {
          const hits = searchAll(doc, find)
          const picked = pickHit(hits, occurrence)
          if (picked.hit && isReplaceable(picked.hit)) return null
          const reason = picked.hit ? 'unsupported_place' : picked.reason
          return {
            ok: false,
            reason,
            count: hits.length,
            ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
          }
        })
        if (refusal) return refusal
        return change('replace', (doc) => {
          const hits = searchAll(doc, find)
          const { hit } = pickHit(hits, occurrence)
          if (!hit || !isReplaceable(hit)) throw fail('CHANGED', 'the document changed mid-call')
          replaceHit(doc, hit, replacement)
          return {
            ok: true,
            count: hits.length,
            inTable: Boolean(hit.cellContext),
            place: placeOf(hit, replacement.length),
          }
        })
      }),

      /** Replace every occurrence of `find` outside equations, last match first. */
      replaceAllText: guarded((find, replacement) => {
        checkReplacement(replacement)
        const total = host.read((doc) => searchAll(doc, find).filter(isReplaceable).length)
        if (total === 0) return { ok: false, reason: 'not_found', count: 0 }
        return change('replace-all', (doc) => {
          // back to front, so replacing one match never moves the offset of one still to do
          const hits = searchAll(doc, find).filter(isReplaceable).reverse()
          for (const hit of hits) replaceHit(doc, hit, replacement)
          // the first in reading order is the last one done; nothing in front of it moved.
          // A later match in the same paragraph moved by what the earlier ones changed.
          const shifted = new Map()
          const marks = [...hits].reverse().map((hit) => {
            const key = JSON.stringify([hit.sec, hit.para, cellPathOf(hit)])
            const moved = shifted.get(key) ?? 0
            shifted.set(key, moved + replacement.length - hit.length)
            return placeOf({ ...hit, charOffset: hit.charOffset + moved }, replacement.length)
          })
          return {
            ok: true,
            count: hits.length,
            place: placeOf(hits[hits.length - 1], replacement.length),
            marks,
          }
        })
      }),

      /**
       * Add new paragraphs next to the paragraph `anchor` occurs in (`where` "after" or
       * "before"), or after the last paragraph of the document ("end"). They are made the way
       * Enter makes one, so they take the paragraph and character formatting of that paragraph.
       */
      insertParagraphs: guarded((anchor, occurrence, where, paragraphs) => {
        checkWhere(where)
        checkParagraphs(paragraphs)
        const refusal = host.read((doc) => locate(doc, anchor, occurrence, where).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('insert-paragraphs', (doc) => {
            const { box, plain } = locate(doc, anchor, occurrence, where)
            if (!box) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const texts = [...paragraphs]
            let at = box.index
            if (where === 'before') {
              // splitting at the start leaves an empty paragraph in front, formatted like this one
              box.split(at, 0)
              const first = texts.shift()
              if (first) box.insert(at, first)
            }
            for (const text of texts) {
              // only the anchor can hold an object; the paragraphs made here are plain text
              openAfter(box, at, plain && at === box.index)
              at += 1
              if (text) box.insert(at, text)
            }
            mustKeep(before, objectsOf(doc))
            const first = where === 'before' ? box.index : box.index + 1
            return {
              ok: true,
              count: paragraphs.length,
              inTable: box.inTable,
              place: box.place(first, paragraphs[0].length),
              marks: paragraphs.map((text, k) => box.place(first + k, text.length)),
            }
          }),
        )
      }),

      /**
       * Remove the paragraph `find` occurs in. A paragraph that holds a table, a picture or
       * a form field is left alone: removing it would take the object with it.
       */
      deleteParagraph: guarded((find, occurrence) => {
        const refusal = host.read((doc) => {
          const { box, refusal: why } = locate(doc, find, occurrence, 'after')
          if (!box) return why
          // the first paragraph is only emptied, which the check after the change covers
          const removed = box.index > 0 && box.count() > 1
          return removed && box.objectPositions(box.index).length > 0
            ? { ok: false, reason: 'has_objects', count: 1 }
            : null
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('delete-paragraph', (doc) => {
            const { box } = locate(doc, find, occurrence, 'after')
            if (!box) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const k = box.index
            const length = box.length(k)
            const text = box.text(k, Math.min(length, MAX_REPORTED_CHARS))
            // the first paragraph of a cell or section has nothing in front to close up
            // against, and joining it with the next one would hand that one its formatting:
            // it keeps its place as an empty line
            const emptied = k === 0 || box.count() === 1
            if (emptied) box.deleteText(k, length)
            // from the end of the paragraph in front to the end of this one: the paragraph
            // goes, and the ones around it keep their own formatting
            else box.deleteRange(k - 1, box.length(k - 1), k, length)
            mustKeep(before, objectsOf(doc))
            return {
              ok: true,
              text,
              emptied,
              inTable: box.inTable,
              place: box.place(emptied ? k : k - 1, 0),
              // the marks below move up from the paragraph that went
              shiftAt: box.place(k, 0),
            }
          }),
        )
      }),

      /**
       * Add a table of plain-text cells, placed like insertParagraphs places a paragraph,
       * in the body text only: the engine does not lay out a table made inside the cell of
       * another one (its cells come out in one row, without lines).
       */
      insertTable: guarded((anchor, occurrence, where, rows, header) => {
        checkWhere(where)
        const table = tableOf(rows)
        const refusal = host.read((doc) => {
          const { box, refusal: why } = locate(doc, anchor, occurrence, where)
          if (!box) return why
          return box.inTable ? { ok: false, reason: 'in_table', count: 1 } : null
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('insert-table', (doc) => {
            const { box, plain } = locate(doc, anchor, occurrence, where)
            if (!box) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            let at = box.index
            // read before the paragraph is split: the table is to look like the text beside it
            const font = box.font(at)
            if (where === 'before') box.split(at, 0)
            else {
              openAfter(box, at, plain)
              at += 1
            }
            // in the body the header's grey goes on after the paste, cell by cell (shadeHeaderCells)
            box.pasteHtml(at, tableHtml(table, font, header === true, box.inTable))
            if (header === true && !box.inTable)
              shadeHeaderCells(doc, box.place(at, 0), table[0].length)
            const after = objectsOf(doc)
            // the new table is an object of its own; nothing that was there may be gone
            mustKeep(before, { ...after, controls: Math.min(after.controls, before.controls) })
            return {
              ok: true,
              rows: table.length,
              cols: table[0].length,
              inTable: box.inTable,
              place: box.place(at, 0),
            }
          }),
        )
      }),

      /**
       * Change the character formatting of one occurrence of `find`, or with `all` of every
       * occurrence. Only the named properties change; the text itself is not touched.
       */
      formatText: guarded((find, occurrence, all, format) => {
        const spec = formatOf(format, false)
        const targets = (doc) => {
          const hits = searchAll(doc, find)
          if (all === true) {
            const usable = hits.filter(isReplaceable)
            return usable.length > 0
              ? { hits: usable }
              : { refusal: { ok: false, reason: 'not_found', count: 0 } }
          }
          const picked = pickHit(hits, occurrence)
          if (picked.hit && isReplaceable(picked.hit)) return { hits: [picked.hit] }
          const reason = picked.hit ? 'unsupported_place' : picked.reason
          return {
            refusal: {
              ok: false,
              reason,
              count: hits.length,
              ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
            },
          }
        }
        const refusal = host.read((doc) => targets(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('format-text', (doc) => {
            const { hits } = targets(doc)
            if (!hits) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const { chars } = resolveFormat(doc, spec)
            for (const hit of hits) {
              const box = containerOf(doc, hit)
              box.formatChars(box.index, hit.charOffset, hit.charOffset + hit.length, chars)
            }
            mustKeep(before, objectsOf(doc))
            return { ok: true, count: hits.length, place: placeOf(hits[0], hits[0].length) }
          }),
        )
      }),

      /**
       * Change the formatting of the whole paragraph `find` occurs in: its alignment and
       * line spacing, and the character formatting of all its text.
       */
      formatParagraph: guarded((find, occurrence, format) => {
        const spec = formatOf(format, true)
        const plan = (doc) => {
          const hits = searchAll(doc, find)
          const picked = pickHit(hits, occurrence)
          const refuse = (reason) => ({
            refusal: {
              ok: false,
              reason,
              count: hits.length,
              ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
            },
          })
          if (!picked.hit) return refuse(picked.reason)
          if (!isReplaceable(picked.hit)) return refuse('unsupported_place')
          const box = containerOf(doc, picked.hit)
          if ((spec.paragraph && !box.formatParagraph) || (spec.style && !box.applyStyle))
            return refuse('unsupported_place')
          if (spec.style && styleIdOf(doc, spec.style) === null)
            return { refusal: noSuchStyle(doc) }
          return { box }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('format-paragraph', (doc) => {
            const { box } = plan(doc)
            if (!box) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const length = box.length(box.index)
            const { chars, paragraph, style } = resolveFormat(doc, spec)
            // the style first: what was asked for besides goes over it
            if (style !== null) box.applyStyle(box.index, style)
            if (paragraph) box.formatParagraph(box.index, paragraph)
            if (chars && length > 0) box.formatChars(box.index, 0, length, chars)
            mustKeep(before, objectsOf(doc))
            return { ok: true, inTable: box.inTable, place: box.place(box.index, length) }
          }),
        )
      }),

      /**
       * The tables of the document in reading order, numbered from 1; a table inside a cell
       * comes right after the table it sits in. The number is what readTable and fillCells
       * take.
       */
      listTables: guarded(() =>
        host.read((doc) => {
          const { tables, partial } = tablesOf(doc)
          const near = (table) => {
            if (table.parent !== null) return ''
            // the line the table follows usually says what it is
            for (let k = table.para; k >= 0 && k > table.para - 4; k--) {
              const length = doc.getParagraphLength(table.sec, k)
              if (length > 0) {
                return clip(doc.getTextRange(table.sec, k, 0, length).trim(), PREVIEW_CHARS * 2)
              }
            }
            return ''
          }
          const preview = (table) => {
            const texts = []
            for (let cell = 0; cell < table.cells && cell < 12; cell++) {
              const text = paragraphsOf(cellBox(doc, table, cell))
                .join(' ')
                .trim()
              if (text) texts.push(clip(text, PREVIEW_CHARS))
              if (texts.length === PREVIEW_CELLS) break
            }
            return texts
          }
          return {
            count: tables.length,
            partial,
            tables: tables.slice(0, MAX_LISTED_TABLES).map((table, index) => ({
              table: index + 1,
              rows: table.rows,
              cols: table.cols,
              ...(table.parent === null ? {} : { inTable: table.parent + 1 }),
              near: near(table),
              preview: preview(table),
            })),
          }
        }),
      ),

      /**
       * The cells of table `number` row by row, from row `fromRow` (1-based). A merged cell
       * is listed once, at its first place, with its spans. A long table comes in parts:
       * `nextRow` is the row to go on from.
       */
      readTable: guarded((number, fromRow) =>
        host.read((doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table) return { ok: false, reason: 'no_such_table', count: tables.length }
          const first = Number.isInteger(fromRow) && fromRow > 1 ? fromRow - 1 : 0
          const grid = gridOf(doc, table)
            .filter((cell) => cell.row >= first)
            .sort((a, b) => a.row - b.row || a.col - b.col)
          // whole rows only, and always at least one
          let end = grid.length
          if (grid.length > MAX_READ_CELLS) {
            const cut = grid[MAX_READ_CELLS].row
            end = grid.findIndex((cell) => cell.row === cut)
            if (end === 0) end = grid.findIndex((cell) => cell.row !== cut)
            if (end < 0) end = grid.length
          }
          const fields = fieldsByCell(doc)
          const covered = coveredCells(doc, table)
          const key = tableKey(table.sec, table.para, table.path)
          const cells = grid.slice(0, end).map((place) => {
            const held = fields.get(`${key}:${place.cell}`)
            return {
              row: place.row + 1,
              col: place.col + 1,
              ...(place.rowSpan > 1 ? { rowSpan: place.rowSpan } : {}),
              ...(place.colSpan > 1 ? { colSpan: place.colSpan } : {}),
              text: clip(paragraphsOf(cellBox(doc, table, place.cell)).join('\n'), MAX_CELL_CHARS),
              ...(held ? { fields: held.map((field) => field.number) } : {}),
              ...(!held && (covered.has(place.cell) || cellHoldsObject(doc, table, place.cell))
                ? { object: true }
                : {}),
            }
          })
          return {
            ok: true,
            table: number,
            rows: table.rows,
            cols: table.cols,
            cells,
            ...(end < grid.length ? { nextRow: grid[end].row + 1 } : {}),
          }
        }),
      ),

      /**
       * Write text into cells of table `number`, all of them in one undo step or none.
       * `cells` is a list of { row, col, text } with 1-based places; a place inside a merged
       * cell means that cell. A line break in the text starts a new paragraph in the cell.
       * The text takes the formatting the cell already has. A cell that holds text is only
       * written over with `overwrite`; a cell that holds one click-here field is filled
       * through the field; a cell that holds a picture or another object is never written.
       */
      /**
       * The pages as the editor prints them, from page `from` (0-based): SVG drawn for
       * print and each page's size in CSS pixels, as many pages as are drawn in about two
       * seconds (always one). Called again from where it stopped until `pageCount`. Pages
       * are laid out with the portable text widths, as the editor's own print does, and the
       * screen's are put back before the call returns.
       */
      printPages: guarded((from) =>
        host.read((doc) =>
          withPortableWidths(doc, () => {
            const pageCount = doc.pageCount()
            const start = Number.isInteger(from) && from > 0 ? Math.min(from, pageCount) : 0
            const began = Date.now()
            const pages = []
            for (let page = start; page < pageCount; page++) {
              const info = JSON.parse(doc.getPageInfo(page))
              pages.push({
                svg: doc.renderPageSvgWithProfile(page, 'print'),
                width: info.width,
                height: info.height,
              })
              if (Date.now() - began > PRINT_BATCH_MS) break
            }
            return { pageCount, from: start, pages }
          }),
        ),
      ),

      /** The paragraph styles of the document, by name: what a format's style takes. */
      listStyles: guarded(() =>
        host.read((doc) => paragraphStylesOf(doc).map((style) => style.name)),
      ),

      /**
       * Give cells of table `number` (as listTables numbers them) a background colour, or
       * take it away with "none". `cells` name them by row and column, from 1; a merged
       * cell by any of the places it covers. A table inside another table's cell cannot be
       * coloured: the engine sets cell properties by table and cell number only.
       */
      formatCells: guarded((number, cells, background) => {
        if (!Array.isArray(cells) || cells.length === 0 || cells.length > MAX_FORMATTED_CELLS) {
          throw fail('BAD_ARGUMENT', `cells must be 1 to ${MAX_FORMATTED_CELLS} places`)
        }
        for (const cell of cells) {
          if (!cell || !Number.isInteger(cell.row) || !Number.isInteger(cell.col)) {
            throw fail('BAD_ARGUMENT', 'each cell needs a row and a col, counted from 1')
          }
        }
        const none = background === 'none'
        if (!none && (typeof background !== 'string' || !HEX_COLOR.test(background))) {
          throw fail('BAD_ARGUMENT', 'background must look like #RRGGBB, or be "none"')
        }
        const fill = JSON.stringify(
          none
            ? { fillType: 'none' }
            : // pattern -1 is none (see shadeHeaderCells)
              { fillType: 'solid', fillColor: background.toLowerCase(), patternType: -1 },
        )
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table) {
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          }
          if (table.path.length > 1) {
            return { refusal: { ok: false, reason: 'unsupported_place', count: tables.length } }
          }
          const grid = gridOf(doc, table)
          const targets = new Set()
          const missing = []
          for (const want of cells) {
            const place = grid.find(
              (cell) =>
                want.row - 1 >= cell.row &&
                want.row - 1 < cell.row + cell.rowSpan &&
                want.col - 1 >= cell.col &&
                want.col - 1 < cell.col + cell.colSpan,
            )
            if (place) targets.add(place.cell)
            else missing.push({ row: want.row, col: want.col })
          }
          if (missing.length > 0) {
            return {
              refusal: {
                ok: false,
                reason: 'no_such_cell',
                cells: missing,
                rows: table.rows,
                cols: table.cols,
              },
            }
          }
          return { table, targets: [...targets] }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('format-cells', (doc) => {
            const { table, targets } = plan(doc)
            if (!targets) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const control = table.path[0].controlIndex
            for (const cell of targets) {
              expectOk(
                doc.setCellProperties(table.sec, table.para, control, cell, fill),
                'colour the cell',
              )
            }
            mustKeep(before, objectsOf(doc))
            return {
              ok: true,
              count: targets.length,
              place: { sec: table.sec, para: table.para, offset: 0, length: 0 },
            }
          }),
        )
      }),

      /**
       * Merge the cells of table `number` from one corner to the other (rows and columns
       * from 1, both corners included) into one cell; their text goes into it one cell after
       * another, as Hangul merges. A merged cell must lie wholly inside the range or wholly
       * outside it. Cells of a table inside another table's cell cannot be merged here.
       */
      mergeCells: guarded((number, from, to) => {
        const corner = (at) =>
          at && Number.isInteger(at.row) && Number.isInteger(at.col) && at.row >= 1 && at.col >= 1
        if (!corner(from) || !corner(to)) {
          throw fail('BAD_ARGUMENT', 'from and to need a row and a col, counted from 1')
        }
        const top = Math.min(from.row, to.row) - 1
        const bottom = Math.max(from.row, to.row) - 1
        const left = Math.min(from.col, to.col) - 1
        const right = Math.max(from.col, to.col) - 1
        if (top === bottom && left === right) {
          throw fail('BAD_ARGUMENT', 'from and to name one cell: there is nothing to merge')
        }
        const plan = (doc) => {
          const found = bodyTable(doc, number)
          if (found.refusal) return found
          const { table, grid } = found
          if (bottom >= table.rows || right >= table.cols) {
            return {
              refusal: { ok: false, reason: 'no_such_cell', rows: table.rows, cols: table.cols },
            }
          }
          const inside = []
          const crossing = []
          for (const cell of grid) {
            const lastRow = cell.row + cell.rowSpan - 1
            const lastCol = cell.col + cell.colSpan - 1
            const overlaps =
              cell.row <= bottom && lastRow >= top && cell.col <= right && lastCol >= left
            if (!overlaps) continue
            const within =
              cell.row >= top && lastRow <= bottom && cell.col >= left && lastCol <= right
            if (within) inside.push(cell)
            else crossing.push({ row: cell.row + 1, col: cell.col + 1 })
          }
          if (crossing.length > 0) {
            return { refusal: { ok: false, reason: 'crosses_merged', cells: crossing } }
          }
          // a named cell other than the first would lose its name, which a form fills it by
          const control = table.path[0].controlIndex
          const named = inside
            .filter((cell) => !(cell.row === top && cell.col === left))
            .filter((cell) => {
              const props = parse(doc.getCellProperties(table.sec, table.para, control, cell.cell))
              return typeof props.fieldName === 'string' && props.fieldName !== ''
            })
            .map((cell) => ({ row: cell.row + 1, col: cell.col + 1 }))
          if (named.length > 0)
            return { refusal: { ok: false, reason: 'named_cells', cells: named } }
          return { table, control, merged: inside.length }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('merge-cells', (doc) => {
            const { table, control, merged } = plan(doc)
            if (!table) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            expectOk(
              doc.mergeTableCells(table.sec, table.para, control, top, left, bottom, right),
              'merge the cells',
            )
            mustKeep(before, objectsOf(doc))
            return {
              ok: true,
              merged,
              place: { sec: table.sec, para: table.para, offset: 0, length: 0 },
            }
          }),
        )
      }),

      /**
       * Split the cell of table `number` at `row` and `col` (from 1): into `rows` by
       * `cols` cells, or, with neither, a merged cell back into the cells it covers. The
       * text stays in the first of them.
       */
      splitCell: guarded((number, row, col, rows, cols) => {
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) {
          throw fail('BAD_ARGUMENT', 'row and col count from 1')
        }
        const count = (value) => (value === undefined || value === null ? 1 : value)
        const down = count(rows)
        const across = count(cols)
        for (const value of [down, across]) {
          if (!Number.isInteger(value) || value < 1 || value > MAX_SPLIT) {
            throw fail('BAD_ARGUMENT', `rows and cols must be 1 to ${MAX_SPLIT}`)
          }
        }
        const plan = (doc) => {
          const found = bodyTable(doc, number)
          if (found.refusal) return found
          const { table, grid } = found
          const cell = grid.find(
            (candidate) =>
              row - 1 >= candidate.row &&
              row - 1 < candidate.row + candidate.rowSpan &&
              col - 1 >= candidate.col &&
              col - 1 < candidate.col + candidate.colSpan,
          )
          if (!cell) {
            return {
              refusal: { ok: false, reason: 'no_such_cell', rows: table.rows, cols: table.cols },
            }
          }
          // a picture or a table in the cell (or lying on it) would stay in the first, smaller
          // part, cut off
          if (cellHoldsObject(doc, table, cell.cell) || coveredCells(doc, table).has(cell.cell)) {
            return { refusal: { ok: false, reason: 'holds_object' } }
          }
          const merged = cell.rowSpan > 1 || cell.colSpan > 1
          if (down === 1 && across === 1 && !merged) {
            return { refusal: { ok: false, reason: 'not_merged' } }
          }
          return { table, cell, unmerge: down === 1 && across === 1 }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('split-cell', (doc) => {
            const { table, cell, unmerge } = plan(doc)
            if (!table) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const control = table.path[0].controlIndex
            const result = unmerge
              ? doc.splitTableCell(table.sec, table.para, control, cell.row, cell.col)
              : doc.splitTableCellInto(
                  table.sec,
                  table.para,
                  control,
                  cell.row,
                  cell.col,
                  down,
                  across,
                  true,
                  false,
                )
            expectOk(result, 'split the cell')
            mustKeep(before, objectsOf(doc))
            return {
              ok: true,
              unmerged: unmerge,
              place: { sec: table.sec, para: table.para, offset: 0, length: 0 },
            }
          }),
        )
      }),

      fillCells: guarded((number, cells, overwrite) => {
        const wanted = checkCells(cells)
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table)
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          const grid = gridOf(doc, table)
          const fields = fieldsByCell(doc)
          const covered = coveredCells(doc, table)
          const key = tableKey(table.sec, table.para, table.path)
          const targets = []
          const missing = []
          const occupied = []
          const fielded = []
          const holding = []
          const taken = new Set()
          for (const want of wanted) {
            const at = { row: want.row, col: want.col }
            const place = grid.find(
              (cell) =>
                want.row - 1 >= cell.row &&
                want.row - 1 < cell.row + cell.rowSpan &&
                want.col - 1 >= cell.col &&
                want.col - 1 < cell.col + cell.colSpan,
            )
            if (!place) {
              missing.push(at)
              continue
            }
            if (taken.has(place.cell)) {
              throw fail('BAD_ARGUMENT', `two entries name the same cell (${want.row}.${want.col})`)
            }
            taken.add(place.cell)
            const held = fields.get(`${key}:${place.cell}`) ?? []
            if (held.length > 1) {
              fielded.push({ ...at, fields: held.map((field) => field.number) })
              continue
            }
            if (held.length === 1) {
              const field = held[0]
              if (!fieldIsEmpty(field) && overwrite !== true) {
                occupied.push({ ...at, text: clip(field.value, MAX_REPORTED_CHARS) })
              } else targets.push({ ...want, cell: place.cell, field })
              continue
            }
            if (covered.has(place.cell) || cellHoldsObject(doc, table, place.cell)) {
              holding.push(at)
              continue
            }
            const texts = paragraphsOf(cellBox(doc, table, place.cell))
            if (texts.join('').trim() !== '' && overwrite !== true) {
              occupied.push({ ...at, text: clip(texts.join(' ').trim(), MAX_REPORTED_CHARS) })
            } else {
              // blanks typed into a cell to be filled in are written over like an empty cell
              targets.push({ ...want, cell: place.cell, clear: texts.some((text) => text !== '') })
            }
          }
          const refuse = (reason, list) => ({
            refusal: { ok: false, reason, cells: list, rows: table.rows, cols: table.cols },
          })
          if (missing.length > 0) return refuse('no_such_cell', missing)
          if (fielded.length > 0) return refuse('has_fields', fielded)
          if (holding.length > 0) return refuse('holds_object', holding)
          if (occupied.length > 0) return refuse('occupied', occupied)
          return { table, targets }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('fill-cells', (doc) => {
            const { table, targets } = plan(doc)
            if (!targets) throw fail('CHANGED', 'the document changed mid-call')
            const own = new Set(targets.filter((t) => t.field).map((t) => t.field.fieldId))
            const before = objectsOf(doc, own)
            for (const target of targets) {
              if (target.field) {
                // a field holds one line
                expectOk(
                  doc.setFieldValue(target.field.fieldId, target.lines.join(' ')),
                  'fill the field',
                )
                continue
              }
              const box = cellBox(doc, table, target.cell)
              if (target.clear) {
                const last = box.count() - 1
                if (last > 0) box.deleteRange(0, 0, last, box.length(last))
                else box.deleteText(0, box.length(0))
              }
              target.lines.forEach((line, k) => {
                // a further line is a further paragraph, made like Enter makes one
                if (k > 0 && k >= box.count()) box.split(k - 1, box.length(k - 1))
                if (line) box.insert(k, line)
              })
            }
            mustKeep(before, objectsOf(doc, own))
            const first = targets[0]
            return {
              ok: true,
              table: number,
              count: targets.length,
              place: cellBox(doc, table, first.cell).place(
                0,
                first.field ? 0 : first.lines[0].length,
              ),
            }
          }),
        )
      }),

      /**
       * Add `count` empty rows or columns to table `number`, after or before row or column
       * `at` (1-based). The new ones are shaped like the one they are added next to: the
       * engine copies its cells, and the alignment of each new cell is set to match. Only
       * for a table of the body: the engine has no such call for a table inside a cell.
       */
      addTableLines: guarded((number, what, at, where, count) => {
        const rows = checkLines(what, at, count)
        if (where !== 'after' && where !== 'before') {
          throw fail('BAD_ARGUMENT', 'where must be "after" or "before"')
        }
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table)
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          const size = { rows: table.rows, cols: table.cols }
          if (table.parent !== null) return { refusal: { ok: false, reason: 'nested', ...size } }
          if (at > (rows ? table.rows : table.cols)) {
            return { refusal: { ok: false, reason: 'no_such_line', ...size } }
          }
          return { table }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('add-table-lines', (doc) => {
            const { table } = plan(doc)
            if (!table) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const { sec, para } = table
            const ctrl = table.path[0].controlIndex
            const after = where === 'after'
            for (let n = 0; n < count; n++) {
              // "before" pushes the line it copies down by one each time
              const beside = after ? at - 1 : at - 1 + n
              expectOk(
                rows
                  ? doc.insertTableRow(sec, para, ctrl, beside, after)
                  : doc.insertTableColumn(sec, para, ctrl, beside, after),
                rows ? 'add a row' : 'add a column',
              )
            }
            const first = after ? at : at - 1
            const model = after ? at - 1 : at - 1 + count
            const grown = {
              ...table,
              cells: parse(doc.getTableDimensions(sec, para, ctrl)).cellCount,
            }
            const grid = gridOf(doc, grown)
            const line = (cell) => (rows ? cell.row : cell.col)
            const across = (cell) => (rows ? cell.col : cell.row)
            const alignment = (cell) =>
              parse(doc.getCellParaPropertiesAt(sec, para, ctrl, cell.cell, 0)).alignment
            for (const cell of grid) {
              if (line(cell) < first || line(cell) >= first + count) continue
              const like = grid.find((c) => line(c) === model && across(c) === across(cell))
              if (!like) continue
              const wanted = alignment(like)
              if (wanted && wanted !== alignment(cell)) {
                expectOk(
                  doc.applyParaFormatInCell(
                    sec,
                    para,
                    ctrl,
                    cell.cell,
                    0,
                    JSON.stringify({ alignment: wanted }),
                  ),
                  'format the new cell',
                )
              }
            }
            mustKeep(before, objectsOf(doc))
            const dims = parse(doc.getTableDimensions(sec, para, ctrl))
            const shown = grid.find((cell) => line(cell) === first)
            return {
              ok: true,
              table: number,
              rows: dims.rowCount,
              cols: dims.colCount,
              first: first + 1,
              count,
              ...(shown ? { place: cellBox(doc, grown, shown.cell).place(0, 0) } : {}),
            }
          }),
        )
      }),

      /**
       * Remove `count` rows or columns of table `number`, from row or column `at`
       * (1-based), with what is in them. Not all of them: a table keeps one row and one
       * column. A row or column with a cell that holds a picture or another object is left
       * alone, and so is the whole call.
       */
      removeTableLines: guarded((number, what, at, count) => {
        const rows = checkLines(what, at, count)
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table)
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          const size = { rows: table.rows, cols: table.cols }
          if (table.parent !== null) return { refusal: { ok: false, reason: 'nested', ...size } }
          const total = rows ? table.rows : table.cols
          if (at + count - 1 > total)
            return { refusal: { ok: false, reason: 'no_such_line', ...size } }
          if (count >= total) return { refusal: { ok: false, reason: 'would_empty', ...size } }
          const covered = coveredCells(doc, table)
          const going = gridOf(doc, table).filter((cell) => {
            const line = rows ? cell.row : cell.col
            return line >= at - 1 && line < at - 1 + count
          })
          const holding = going
            .filter((cell) => covered.has(cell.cell) || cellHoldsObject(doc, table, cell.cell))
            .map((cell) => ({ row: cell.row + 1, col: cell.col + 1 }))
          if (holding.length > 0) {
            return { refusal: { ok: false, reason: 'holds_object', cells: holding, ...size } }
          }
          return { table, going }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('remove-table-lines', (doc) => {
            const { table, going } = plan(doc)
            if (!table) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc, new Set())
            const { sec, para } = table
            const ctrl = table.path[0].controlIndex
            const text = clip(
              going
                .map((cell) =>
                  paragraphsOf(cellBox(doc, table, cell.cell))
                    .join(' ')
                    .trim(),
                )
                .filter(Boolean)
                .join(' | '),
              MAX_REPORTED_CHARS,
            )
            for (let n = 0; n < count; n++) {
              // the next one moves up into the place of the one just removed
              expectOk(
                rows
                  ? doc.deleteTableRow(sec, para, ctrl, at - 1)
                  : doc.deleteTableColumn(sec, para, ctrl, at - 1),
                rows ? 'remove the row' : 'remove the column',
              )
            }
            // the value of a named cell goes with its cell; nothing else may be lost
            mustKeep(before, objectsOf(doc, new Set()))
            const dims = parse(doc.getTableDimensions(sec, para, ctrl))
            const shrunk = { ...table, cells: dims.cellCount }
            return {
              ok: true,
              table: number,
              rows: dims.rowCount,
              cols: dims.colCount,
              count,
              text,
              place: cellBox(doc, shrunk, 0).place(0, 0),
            }
          }),
        )
      }),

      /**
       * Remove table `number` (as listTables numbers them) with what is in it, the tables
       * inside its cells included. A table with a picture or another object in a cell is left
       * alone: that would go with it unseen. The paragraph the table stood in goes too when
       * nothing is left in it and a paragraph before it takes its place, so that removing a
       * table does not leave an empty line no tool can reach.
       */
      deleteTable: guarded((number) => {
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table)
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          // the tables inside it come right after it in the list, each inside one already seen
          const inside = new Set([number - 1])
          for (let i = number; i < tables.length && inside.has(tables[i].parent); i++) inside.add(i)
          const members = [...inside].map((i) => tables[i])
          const top = gridOf(doc, table)
          const holding = new Set()
          for (const member of members) {
            for (const cell of gridOf(doc, member)) {
              if (!cellHoldsOtherObject(doc, member, cell.cell)) continue
              // named by the cell of this table it lies in
              holding.add(
                member === table ? cell.cell : member.path[table.path.length - 1].cellIndex,
              )
            }
          }
          if (holding.size > 0) {
            const cells = top
              .filter((cell) => holding.has(cell.cell))
              .map((cell) => ({ row: cell.row + 1, col: cell.col + 1 }))
            return { refusal: { ok: false, reason: 'holds_object', cells } }
          }
          // the form fields in its cells go with it
          const keys = members.map((member) => `${tableKey(member.sec, member.para, member.path)}:`)
          const going = new Set()
          for (const [key, fields] of fieldsByCell(doc)) {
            if (keys.some((prefix) => key.startsWith(prefix))) {
              for (const field of fields) going.add(field.fieldId)
            }
          }
          return { table, top, inner: members.length - 1, going }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('delete-table', (doc) => {
            const { table, top, inner, going } = plan(doc)
            if (!table) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc, going)
            const text = clip(
              top
                .map((cell) =>
                  paragraphsOf(cellBox(doc, table, cell.cell))
                    .join(' ')
                    .trim(),
                )
                .filter(Boolean)
                .join(' | '),
              MAX_REPORTED_CHARS,
            )
            const { sec, para, path } = table
            const last = path[path.length - 1]
            const cellPath = path.slice(0, -1)
            expectOk(
              cellPath.length === 0
                ? doc.deleteTableControl(sec, para, last.controlIndex)
                : doc.deleteCellTableControlByPath(
                    sec,
                    para,
                    JSON.stringify(cellPath),
                    last.controlIndex,
                  ),
              'remove the table',
            )
            const box = containerOf(
              doc,
              cellPath.length === 0 ? { sec, para } : { sec, para, cellPath },
            )
            const k = box.index
            const bare =
              box.length(k) === 0 &&
              (cellPath.length === 0
                ? box.objectPositions(k).length === 0
                : !paragraphHoldsObject(doc, sec, para, cellPath))
            if (k > 0 && bare) box.deleteRange(k - 1, box.length(k - 1), k, 0)
            // only this table and the tables inside it may be gone
            mustKeep({ ...before, controls: before.controls - 1 - inner }, objectsOf(doc, going))
            return {
              ok: true,
              table: number,
              rows: table.rows,
              cols: table.cols,
              inner,
              text,
              place: box.place(k > 0 && bare ? k - 1 : k, 0),
            }
          }),
        )
      }),

      /**
       * Put Save, Save As, Export as PDF and Print at the top of the editor's File menu. The
       * embedded editor leaves out its own (the app owns the file), which left the menu with
       * no way to save. Each item fires FILE_COMMAND_EVENT on the editor's window and the app
       * does the rest. `labels` holds the four names in the app's language, by command. A
       * second call puts the items back where they were; the names stay the first ones.
       */
      installFileMenu: guarded((labels) => {
        for (const item of FILE_MENU) {
          if (typeof labels?.[item.command] !== 'string' || !labels[item.command]) {
            throw fail('BAD_ARGUMENT', `labels.${item.command} must be a non-empty string`)
          }
        }
        if (!host.automation.registerCommand || !host.automation.addMenuItem) return { ok: false }
        for (const item of FILE_MENU) {
          try {
            host.automation.registerCommand({
              id: item.id,
              label: labels[item.command],
              ...(item.shortcut ? { shortcutLabel: item.shortcut } : {}),
              execute: () => {
                globalThis.dispatchEvent?.(
                  new CustomEvent(FILE_COMMAND_EVENT, { detail: item.command }),
                )
              },
            })
          } catch {
            // registered by an earlier call
          }
        }
        try {
          // each item goes on top, so the last one put there comes first
          for (const item of [...FILE_MENU].reverse()) {
            host.automation.addMenuItem({ menuId: 'file', commandId: item.id, position: 'top' })
          }
        } catch {
          // an editor without a File menu
          return { ok: false }
        }
        return { ok: true }
      }),

      /**
       * Show a place in the editor: its caret goes there, the run is selected, and the view
       * scrolls to it. `place` is what a change handed back. Answers false when the editor
       * cannot (no caret yet, or the place is gone).
       */
      reveal: guarded((place) => {
        shown = false
        try {
          host.automation.execute(REVEAL_COMMAND, place)
        } catch {
          return { ok: false }
        }
        if (shown) shownKey = placeKey(place)
        return { ok: shown }
      }),

      /**
       * What the user has selected in the editor, as runs of text: one per paragraph
       * touched, in reading order. A selection inside one paragraph or one cell is its
       * text; one that runs over paragraphs takes the tables between them whole; a block
       * of cells is the text of those cells. `contiguous` says the runs are the paragraphs
       * of one stretch (the body, or one cell), which is what a rewrite into more or fewer
       * paragraphs needs. `own` marks the selection this plugin made itself when it
       * showed a change.
       */
      selection: guarded(() => {
        picked = null
        try {
          host.automation.execute(SELECTION_COMMAND)
        } catch {
          return { ok: false, reason: 'none' }
        }
        const seen = picked
        if (!seen) return { ok: false, reason: 'none' }
        return host.read((doc) => {
          const out = runCollector()
          let known = null
          const tablesNow = () => (known ??= tablesOf(doc).tables)
          const tableAt = (sec, para, path) => {
            const key = tableKey(sec, para, path)
            return tablesNow().findIndex(
              (table) => tableKey(table.sec, table.para, table.path) === key,
            )
          }
          /** the cells a block between two corners covers, a merged cell by any of its places */
          const within = (range, skip) => (cell) =>
            cell.row <= range.endRow &&
            cell.row + cell.rowSpan - 1 >= range.startRow &&
            cell.col <= range.endCol &&
            cell.col + cell.colSpan - 1 >= range.startCol &&
            !skip.has(`${cell.row},${cell.col}`)
          let inTable = false
          if (seen.block) {
            const { table, range, excluded } = seen.block
            const path =
              Array.isArray(table.cellPath) && table.cellPath.length > 0
                ? asCellPath(table.cellPath)
                : [{ controlIndex: table.ci, cellIndex: 0, cellParaIndex: 0 }]
            const index = tableAt(table.sec, table.ppi, path)
            if (index < 0) return { ok: false, reason: 'unsupported' }
            collectTable(doc, tablesNow(), index, out, within(range, new Set(excluded)))
            inTable = true
          } else {
            const start = endOf(seen.start)
            const end = endOf(seen.end)
            if (!start || !end) return { ok: false, reason: 'unsupported' }
            if (start.path && end.path && sameTable(start, end, true)) {
              // inside one cell or text box: its paragraphs
              const box = containerOf(doc, {
                sec: start.sec,
                para: start.para,
                cellPath: start.path,
              })
              for (let k = start.k; k <= end.k; k++) {
                out.add(
                  box,
                  k,
                  k === start.k ? start.offset : 0,
                  k === end.k ? end.offset : Infinity,
                )
              }
              inTable = true
            } else if (start.path && end.path && sameTable(start, end, false)) {
              // from one cell to another of the same table: the block of cells between them
              const index = tableAt(start.sec, start.para, start.path)
              if (index < 0) return { ok: false, reason: 'unsupported' }
              const grid = gridOf(doc, tablesNow()[index])
              const a = grid[start.path[start.path.length - 1].cellIndex]
              const b = grid[end.path[end.path.length - 1].cellIndex]
              if (!a || !b) return { ok: false, reason: 'unsupported' }
              const range = {
                startRow: Math.min(a.row, b.row),
                endRow: Math.max(a.row + a.rowSpan - 1, b.row + b.rowSpan - 1),
                startCol: Math.min(a.col, b.col),
                endCol: Math.max(a.col + a.colSpan - 1, b.col + b.colSpan - 1),
              }
              collectTable(doc, tablesNow(), index, out, within(range, new Set()))
              inTable = true
            } else {
              // across the body: an end inside a table takes that table whole
              collectBody(
                doc,
                tablesNow,
                start.path ? { sec: start.sec, k: start.para, offset: 0 } : start,
                end.path ? { sec: end.sec, k: end.para, offset: Infinity } : end,
                out,
              )
            }
          }
          if (out.tooLong()) return { ok: false, reason: 'too_long' }
          if (out.segments.length === 0) return { ok: false, reason: 'none' }
          return {
            ok: true,
            inTable,
            contiguous: isContiguous(out.segments),
            own: out.segments.length === 1 && placeKey(out.segments[0]) === shownKey,
            segments: out.segments,
          }
        })
      }),

      /**
       * Replace the selected runs in one undo step. With as many texts as runs, each text
       * takes the place of its run. With more or fewer (only for a contiguous selection),
       * the selection is rewritten: further texts become new paragraphs after the last
       * run, made like Enter makes them, and runs left without a text are removed, a
       * wholly selected paragraph with them. `segments` is the selection as selection()
       * handed it out; when a run no longer holds its text (the user typed there, or the
       * place moved) nothing changes. The runs come back as they are now, for a further
       * change of the same selection.
       */
      replaceSelection: guarded((segments, texts) => {
        checkSegments(segments)
        if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_SELECTED_RUNS) {
          throw fail('BAD_ARGUMENT', 'texts must be a list of one or more strings')
        }
        texts.forEach(checkReplacement)
        if (texts.length !== segments.length && !isContiguous(segments)) {
          return { ok: false, reason: 'count', count: segments.length }
        }
        if (!host.read((doc) => segmentsStand(doc, segments))) {
          return { ok: false, reason: 'changed' }
        }
        return keepingObjects((mustKeep) =>
          change('replace-selection', (doc) => {
            if (!segmentsStand(doc, segments))
              throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const asHit = (segment) => ({
              sec: segment.sec,
              para: segment.para,
              cellPath: segment.path,
              charOffset: segment.offset,
              length: segment.length,
            })
            const kept = Math.min(segments.length, texts.length)
            // runs left without a text go first, from the end, so that the paragraphs in
            // front of them keep their numbers
            for (let index = segments.length - 1; index >= kept; index--) {
              const segment = segments[index]
              const { box, k } = segmentBox(doc, segment)
              const whole = segment.offset === 0 && segment.length === box.length(k)
              if (whole && k > 0 && box.objectPositions(k).length === 0) {
                box.deleteRange(k - 1, box.length(k - 1), k, box.length(k))
              } else replaceHit(doc, asHit(segment), '')
            }
            // each run is in a paragraph of its own, so one does not move another
            for (let index = 0; index < kept; index++) {
              replaceHit(doc, asHit(segments[index]), texts[index])
            }
            const now = segments.slice(0, kept).map((segment, index) => ({
              ...segment,
              length: texts[index].length,
              text: texts[index],
            }))
            if (texts.length > segments.length) {
              // what stood behind the selection in its last paragraph ends up behind the
              // last new paragraph, as when text of several paragraphs is typed there
              const last = segments[segments.length - 1]
              const { box, k } = segmentBox(doc, last)
              let at = k
              let offset = last.offset + texts[kept - 1].length
              for (let index = kept; index < texts.length; index++) {
                box.split(at, offset)
                at += 1
                if (texts[index]) box.insert(at, texts[index])
                offset = texts[index].length
                now.push({ ...box.place(at, texts[index].length), text: texts[index] })
              }
            }
            mustKeep(before, objectsOf(doc))
            const { text: _text, ...place } = now[0]
            return { ok: true, segments: now, place }
          }),
        )
      }),

      /**
       * Change the formatting of the selected runs: character formatting for the runs, and
       * with align or lineSpacing the paragraphs they are in.
       */
      formatSelection: guarded((segments, format) => {
        checkSegments(segments)
        const spec = formatOf(format, true)
        const plan = (doc) => {
          if (!segmentsStand(doc, segments)) return { refusal: { ok: false, reason: 'changed' } }
          const boxes = segments.map((segment) => segmentBox(doc, segment))
          if (
            boxes.some(
              ({ box }) =>
                (spec.paragraph && !box.formatParagraph) || (spec.style && !box.applyStyle),
            )
          ) {
            return { refusal: { ok: false, reason: 'unsupported_place' } }
          }
          if (spec.style && styleIdOf(doc, spec.style) === null)
            return { refusal: noSuchStyle(doc) }
          return { boxes }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('format-selection', (doc) => {
            const { boxes } = plan(doc)
            if (!boxes) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const { chars, paragraph, style } = resolveFormat(doc, spec)
            segments.forEach((segment, index) => {
              const { box, k } = boxes[index]
              if (style !== null) box.applyStyle(k, style)
              if (paragraph) box.formatParagraph(k, paragraph)
              if (chars && segment.length > 0) {
                box.formatChars(k, segment.offset, segment.offset + segment.length, chars)
              }
            })
            mustKeep(before, objectsOf(doc))
            const { text: _text, ...place } = segments[0]
            return { ok: true, count: segments.length, place }
          }),
        )
      }),

      /**
       * The form fields of the document in document order. Names repeat in real forms (a
       * field nobody named carries its guide text), so a field is addressed by its number.
       */
      listFields: guarded(() =>
        host.read((doc) =>
          parse(doc.getFieldList()).map((field, index) => ({
            field: index + 1,
            name: field.name ?? '',
            guide: field.guide ?? '',
            value: field.value ?? '',
            // a named table cell is filled like a field but is not one the user clicks into
            inCell: field.cellField === true,
          })),
        ),
      ),

      /** Set the value of the field with this number (1-based, as listed by listFields). */
      fillField: guarded((number, value) => {
        checkReplacement(value)
        const count = host.read((doc) => parse(doc.getFieldList()).length)
        if (!Number.isInteger(number) || number < 1 || number > count) {
          return { ok: false, reason: 'no_such_field', count }
        }
        return change('fill-field', (doc) => {
          const field = parse(doc.getFieldList())[number - 1]
          if (!field) throw fail('CHANGED', 'the document changed mid-call')
          expectOk(doc.setFieldValue(field.fieldId, value), 'fill the field')
          const place = fieldPlace(field)
          return { ok: true, name: field.name ?? '', ...(place ? { place } : {}) }
        })
      }),

      /**
       * Add a table of contents next to the paragraph `anchor` occurs in (or at the end): a
       * title line when `title` is given, then a table with a row per heading and its page
       * number. A heading is named by text it contains (`find`, with `occurrence` when
       * that text occurs more than once) and shown as its whole paragraph; headings are body
       * paragraphs. The page numbers are those with the table of contents in place.
       */
      insertToc: guarded((anchor, occurrence, where, title, entries) => {
        checkWhere(where)
        checkTocEntries(entries)
        if (title !== null && title !== undefined) checkReplacement(title)
        const titled = typeof title === 'string' && title.trim() !== ''
        const headingsOf = (doc) =>
          entries.map((entry) => {
            const hits = searchAll(doc, entry.find)
            const picked = pickHit(hits, entry.occurrence ?? null)
            const reason = !picked.hit
              ? picked.reason
              : !isReplaceable(picked.hit) || cellPathOf(picked.hit)
                ? 'unsupported_place'
                : null
            return { entry, hits, hit: reason ? null : picked.hit, reason }
          })
        const refusal = host.read((doc) => {
          const located = locate(doc, anchor, occurrence, where)
          if (located.refusal) return located.refusal
          if (located.box.inTable) return { ok: false, reason: 'in_table', count: 1 }
          const missing = headingsOf(doc).find((heading) => heading.reason)
          if (!missing) return null
          return {
            ok: false,
            reason: 'no_heading',
            heading: missing.entry.find,
            why: missing.reason,
            count: missing.hits.length,
            ...(missing.reason === 'ambiguous' ? { matches: listMatches(doc, missing.hits) } : {}),
          }
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('insert-toc', (doc) => {
            const { box, plain } = locate(doc, anchor, occurrence, where)
            if (!box || box.inTable) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const { sec } = box.place(box.index, 0)
            const headings = headingsOf(doc)
            if (headings.some((heading) => !heading.hit)) {
              throw fail('CHANGED', 'the document changed mid-call')
            }
            // read before a paragraph is split: the contents are to look like the text there
            const font = box.font(box.index)
            const width = textWidthPt(doc, sec)
            const rows = headings.map(({ entry, hit }) => ({
              text: oneLine(
                clip(bodyText(doc, hit.sec, hit.para).replace(/\s+/g, ' ').trim(), MAX_TOC_TEXT),
                entry.level,
                font,
                width,
              ),
              level: entry.level,
              page: 0,
            }))
            let first = box.index
            if (where === 'before') box.split(first, 0)
            else {
              openAfter(box, first, plain)
              first += 1
            }
            let holder = first
            if (titled) {
              box.insert(first, title.trim())
              openAfter(box, first, false)
              holder = first + 1
            }
            box.pasteHtml(holder, tocHtml(rows, font, width))
            const table = tablesOf(doc).tables.find(
              (candidate) =>
                candidate.sec === sec && candidate.para === holder && candidate.path.length === 1,
            )
            if (!table) throw fail('ENGINE', 'the table of contents could not be made')
            // the pages as they are now: every paragraph from the first new one moved down
            const added = holder - first + 1
            const grid = gridOf(doc, table)
            const pages = headings.map(({ hit }, index) => {
              const para = hit.sec === sec && hit.para >= first ? hit.para + added : hit.para
              const page = pageNumberOf(doc, hit.sec, para)
              const cell = cellOf(grid, index, 1)
              if (!cell) throw fail('ENGINE', 'the table of contents came out in another shape')
              setCellText(doc, table, cell.cell, String(page))
              return page
            })
            if (titled) {
              expectOk(
                doc.applyParaFormat(sec, first, JSON.stringify({ alignment: 'center' })),
                'center the title',
              )
            }
            const after = objectsOf(doc)
            // the table is an object of its own; nothing that was there may be gone
            mustKeep(before, { ...after, controls: Math.min(after.controls, before.controls) })
            return {
              ok: true,
              count: entries.length,
              pages,
              place: { sec, para: first, offset: 0, length: titled ? title.trim().length : 0 },
            }
          }),
        )
      }),

      /**
       * Write the page numbers of a table of contents again: the two-column table in the
       * paragraph after the one `title` occurs in. Each row's heading is looked up by its
       * text in the body; a row whose heading is gone, or whose second cell is not a page
       * number, is left alone.
       */
      refreshToc: guarded((title, occurrence) => {
        const find = (doc) => {
          const located = locate(doc, title, occurrence, 'after')
          if (located.refusal) return { refusal: located.refusal }
          if (located.box.inTable) return { refusal: { ok: false, reason: 'in_table', count: 1 } }
          const { sec } = located.box.place(located.box.index, 0)
          const table = tablesOf(doc).tables.find(
            (candidate) =>
              candidate.sec === sec &&
              candidate.para === located.box.index + 1 &&
              candidate.path.length === 1 &&
              candidate.cols === 2,
          )
          return table ? { table } : { refusal: { ok: false, reason: 'no_toc', count: 0 } }
        }
        const refusal = host.read((doc) => find(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('refresh-toc', (doc) => {
            const { table } = find(doc)
            if (!table) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const grid = gridOf(doc, table)
            let rows = 0
            let changed = 0
            const missing = []
            for (let row = 0; row < table.rows; row++) {
              const headingCell = cellOf(grid, row, 0)
              const pageCell = cellOf(grid, row, 1)
              if (!headingCell || !pageCell) continue
              const shown = PAGE_NUMBER.exec(
                paragraphsOf(cellBox(doc, table, pageCell.cell)).join(''),
              )
              if (!shown) continue
              rows += 1
              const heading = paragraphsOf(cellBox(doc, table, headingCell.cell))
                .join(' ')
                .trim()
              // looked up by the start of its text (a long one was cut short in the table); a
              // body paragraph that starts with it is preferred to a mention elsewhere
              const key = heading.replace(/…$/, '').slice(0, TOC_KEY_CHARS)
              const body = key
                ? searchAll(doc, key).filter((hit) => !cellPathOf(hit) && isReplaceable(hit))
                : []
              const hit =
                body.find((candidate) =>
                  bodyText(doc, candidate.sec, candidate.para).trim().startsWith(key),
                ) ?? body[0]
              if (!hit) {
                missing.push(heading)
                continue
              }
              const page = pageNumberOf(doc, hit.sec, hit.para)
              if (page === Number(shown[1])) continue
              setCellText(doc, table, pageCell.cell, String(page))
              changed += 1
            }
            mustKeep(before, objectsOf(doc))
            return {
              ok: true,
              lines: rows,
              changed,
              ...(missing.length > 0 ? { missing } : {}),
              place: { sec: table.sec, para: table.para, offset: 0, length: 0 },
            }
          }),
        )
      }),

      /**
       * The footnotes and endnotes of the body in reading order: number in this list (what
       * editNote and deleteNote take), kind, the document's own number, the text in front of
       * the mark, and the note's text.
       */
      listNotes: guarded(() =>
        host.read((doc) => {
          const { notes, elsewhere } = notesOf(doc)
          return {
            count: notes.length,
            elsewhere,
            notes: notes.slice(0, MAX_LISTED_NOTES).map((note, index) => ({
              note: index + 1,
              ...noteSummary(note),
              after: noteContext(doc, note),
              text: clip(note.lines.join('\n'), MAX_LISTED_NOTE_CHARS),
              ...(note.plain ? {} : { objects: true }),
            })),
          }
        }),
      ),

      /**
       * Add a footnote or an endnote whose mark goes right after `anchor` (the text must
       * occur once, or `occurrence` picks one), with `text` as its content; a line break
       * starts a new paragraph of the note. Notes go in the body text only.
       */
      insertNote: guarded((kind, anchor, occurrence, text) => {
        if (!NOTE_KINDS.includes(kind))
          throw fail('BAD_ARGUMENT', 'kind must be footnote or endnote')
        const lines = checkNoteText(text)
        const pick = (doc) => {
          const hits = searchAll(doc, anchor)
          const picked = pickHit(hits, occurrence)
          const reason = !picked.hit
            ? picked.reason
            : !isReplaceable(picked.hit) || cellPathOf(picked.hit)
              ? 'unsupported_place'
              : null
          return { hits, hit: reason ? null : picked.hit, reason }
        }
        const refusal = host.read((doc) => {
          const { hits, reason } = pick(doc)
          if (!reason) return null
          return {
            ok: false,
            reason,
            count: hits.length,
            ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
          }
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('insert-note', (doc) => {
            const { hit } = pick(doc)
            if (!hit) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            const offset = hit.charOffset + hit.length
            const made = parse(
              kind === 'endnote'
                ? doc.insertEndnote(hit.sec, hit.para, offset)
                : doc.insertFootnote(hit.sec, hit.para, offset),
            )
            if (!made.ok || !Number.isInteger(made.controlIdx)) {
              throw fail('ENGINE', `could not add the ${kind}`)
            }
            const at = { sec: hit.sec, para: made.paraIdx ?? hit.para, control: made.controlIdx }
            // a new note holds its number only: everything in it is the number
            const prefix = parse(doc.getFootnoteInfo(at.sec, at.para, at.control)).totalTextLen
            writeNote(doc, at, prefix, lines)
            // the one control more is the note itself
            mustKeep({ ...before, controls: before.controls + 1 }, objectsOf(doc))
            return {
              ok: true,
              kind,
              number: made.footnoteNumber ?? made.endnoteNumber ?? null,
              place: placeOf(hit, hit.length),
            }
          }),
        )
      }),

      /** Replace the whole text of a note (its number from listNotes); a line break starts a paragraph. */
      editNote: guarded((number, text) => {
        const lines = checkNoteText(text)
        const refusal = host.read((doc) => {
          const { notes } = notesOf(doc)
          const note = notes[number - 1]
          if (!Number.isInteger(number) || !note) {
            return { ok: false, reason: 'no_such_note', count: notes.length }
          }
          return note.plain ? null : { ok: false, reason: 'has_objects', count: 1 }
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('edit-note', (doc) => {
            const note = notesOf(doc).notes[number - 1]
            if (!note || !note.plain) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            // one paragraph holding the number only, then the new text
            for (let k = note.lines.length - 1; k > 0; k--) {
              expectOk(
                doc.mergeParagraphInFootnote(note.sec, note.para, note.control, k),
                'merge the note',
              )
            }
            const first = parse(doc.getFootnoteInfo(note.sec, note.para, note.control)).totalTextLen
            if (first > note.prefix) {
              expectOk(
                doc.deleteTextInFootnote(
                  note.sec,
                  note.para,
                  note.control,
                  0,
                  note.prefix,
                  first - note.prefix,
                ),
                'clear the note',
              )
            }
            writeNote(doc, note, note.prefix, lines)
            mustKeep(before, objectsOf(doc))
            return {
              ok: true,
              ...noteSummary(note),
              was: clip(note.lines.join('\n'), MAX_REPORTED_CHARS),
              place: { sec: note.sec, para: note.para, offset: note.offset, length: 0 },
            }
          }),
        )
      }),

      /** Remove a note (its number from listNotes), mark and text. */
      deleteNote: guarded((number) => {
        const refusal = host.read((doc) => {
          const { notes } = notesOf(doc)
          return Number.isInteger(number) && notes[number - 1]
            ? null
            : { ok: false, reason: 'no_such_note', count: notes.length }
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change('delete-note', (doc) => {
            const note = notesOf(doc).notes[number - 1]
            if (!note) throw fail('CHANGED', 'the document changed mid-call')
            const before = objectsOf(doc)
            expectOk(doc.deleteFootnote(note.sec, note.para, note.control), 'remove the note')
            mustKeep({ ...before, controls: before.controls - 1 }, objectsOf(doc))
            return {
              ok: true,
              ...noteSummary(note),
              text: clip(note.lines.join('\n'), MAX_REPORTED_CHARS),
              place: { sec: note.sec, para: note.para, offset: note.offset, length: 0 },
            }
          }),
        )
      }),

      /** Take the marks of the changes made so far off the pages. */
      clearMarks: guarded(() => {
        marks = []
        refreshMarks()
        return { ok: true }
      }),

      /**
       * How the editor lays out the tabs a save found without a width (`spots`, from the
       * saved file): for each, its width in HWPUNIT and the kind and leader of its tab stop,
       * or null where it cannot tell. Reads only.
       */
      measureTabs: guarded((spots) => {
        if (!Array.isArray(spots) || spots.length > MAX_MEASURED_TABS) {
          throw fail('BAD_ARGUMENT', 'spots must be a list of tab places')
        }
        return host.read((doc) => ({
          tabs: spots.map((spot) => {
            try {
              return measureTab(doc, spot)
            } catch {
              return null
            }
          }),
        }))
      }),

      /**
       * Undo the last `steps` changes through the editor's own history, but only while
       * `expectedForeign` still equals foreignChanges(): the check and the undo happen here,
       * in one go, so nothing can slip in between them.
       */
      undo: guarded((steps, expectedForeign) => {
        if (!Number.isInteger(steps) || steps < 1 || steps > MAX_UNDO_STEPS) {
          throw fail('BAD_ARGUMENT', 'steps must be a small positive integer')
        }
        if (expectedForeign !== foreign) return { ok: false, reason: 'changed', undone: 0 }
        let undone = 0
        own = true
        text = null
        try {
          for (let i = 0; i < steps; i++) {
            const result = host.automation.execute('edit:undo')
            if (!result || result.ok !== true) break
            undone += 1
          }
        } finally {
          own = false
        }
        return { ok: undone === steps, undone }
      }),
    }
  },
}

export default agentPlugin
