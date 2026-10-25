// 이음오피스(IeumOffice, https://github.com/pblsketch/openoffice, Apache-2.0, Copyright 2026 Mainfunc, Inc.)의
// apps/hwp/studio-plugin/agent-plugin.d.mts(커밋 a907a88c, 스타일·저장 안 됨 알림·스타일 목록은 63e2a636)에서 옮겼다. 바꾼 것: 플러그인·명령 이름(ieum → kordoc).
// 판단 근거는 그 저장소의 결정 기록 0022(AI 편집은 편집기 안 플러그인으로, 개체를 잃는 변경은 하지 않는다)·0026(탭 폭).
export declare const AGENT_PLUGIN_ID: 'kordoc-agent'

/** One place a searched text occurs. */
export interface AgentMatch {
  /** 1-based position among all matches, in reading order */
  occurrence: number
  inTable: boolean
  /** the match with some text around it; absent when it could not be read */
  context?: string
  /** false for text inside an equation, which has no replace path */
  replaceable?: false
}

export interface AgentFindResult {
  count: number
  /** the first matches only; `count` is the real total */
  matches: AgentMatch[]
}

/**
 * Where a change is, for the editor to show: the paragraph (for a cell, the body paragraph
 * its table sits in and the path to the cell paragraph), and a run of characters in it.
 */
export interface AgentPlace {
  sec: number
  para: number
  path?: { controlIndex: number; cellIndex: number; cellParaIndex: number }[]
  offset: number
  length: number
}

export type AgentReplaceResult =
  | { ok: true; count: number; inTable: boolean; place: AgentPlace }
  | {
      ok: false
      reason: 'not_found' | 'ambiguous' | 'no_such_occurrence' | 'unsupported_place'
      count: number
      matches?: AgentMatch[]
    }

export type AgentReplaceAllResult =
  { ok: true; count: number; place: AgentPlace } | { ok: false; reason: 'not_found'; count: 0 }

/** Why a paragraph edit did nothing: the anchor could not be decided, or an object is in the way. */
export interface AgentPlaceRefusal {
  ok: false
  reason: 'not_found' | 'ambiguous' | 'no_such_occurrence' | 'unsupported_place' | 'has_objects'
  count: number
  matches?: AgentMatch[]
}

/** Where a paragraph edit goes relative to the anchor paragraph; "end" is the end of the document. */
export type AgentWhere = 'after' | 'before' | 'end'

export type AgentInsertResult =
  { ok: true; count: number; inTable: boolean; place: AgentPlace } | AgentPlaceRefusal

export type AgentDeleteResult =
  | {
      ok: true
      /** the removed text, cut to a few hundred characters */
      text: string
      /** the paragraph kept its place as an empty line (the first of its cell or section) */
      emptied: boolean
      inTable: boolean
      place: AgentPlace
    }
  | AgentPlaceRefusal

export type AgentTableResult =
  | { ok: true; rows: number; cols: number; inTable: boolean; place: AgentPlace }
  | AgentPlaceRefusal
  /** the anchor is inside a table cell, where a table cannot be made */
  | { ok: false; reason: 'in_table'; count: number }

/** Character formatting to change; what is left out stays as it is. */
export interface AgentTextFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  /** font size in points */
  size?: number
  /** text colour, #RRGGBB */
  color?: string
  /** highlight colour, #RRGGBB, or "none" to take it away */
  highlight?: string
  /** font name; one the document lacks is added to its fonts */
  font?: string
  /** a character style of the document, by its name (listStyles); set before the rest */
  charStyle?: string
}

/** Formatting of a whole paragraph: its own properties, and character formatting for all its text. */
export interface AgentParagraphFormat extends AgentTextFormat {
  align?: 'left' | 'center' | 'right' | 'justify'
  /** line spacing in percent of the font height */
  lineSpacing?: number
  /** first-line indent in points; negative hangs the first line out */
  indent?: number
  /** left and right margins of the paragraph, in points */
  marginLeft?: number
  marginRight?: number
  /** space above and below the paragraph, in points */
  spacingBefore?: number
  spacingAfter?: number
  /** a paragraph style of the document, by its name (listStyles) */
  style?: string
}

/** A call named a style the document does not have; `styles` are the ones of that kind it has. */
export interface AgentNoSuchStyle {
  ok: false
  reason: 'no_such_style'
  /** the kind of style that was looked for; any: a style of either kind */
  kind: 'paragraph' | 'character' | 'any'
  styles: string[]
}

/** The styles of the document by name. */
export interface AgentStyleNames {
  paragraph: string[]
  character: string[]
}

export type AgentStyleKind = 'paragraph' | 'character'

/** What a style looks like, in the units the format calls take; paragraph properties for a paragraph style only. */
export interface AgentStyleLook {
  font: string
  size: number
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  color: string
  align?: string
  lineSpacing?: number
  indent?: number
  marginLeft?: number
  marginRight?: number
  spacingBefore?: number
  spacingAfter?: number
}

export type AgentReadStyleResult =
  | {
      ok: true
      name: string
      englishName: string
      kind: AgentStyleKind
      /** the paragraph style that follows a paragraph of this one (paragraph styles) */
      nextStyle?: string
      look: AgentStyleLook
    }
  | AgentNoSuchStyle

/** The look of a style: formatting without styles. */
export type AgentStyleFormat = Omit<AgentParagraphFormat, 'style' | 'charStyle'>

export interface AgentNewStyle {
  name: string
  englishName?: string | null
  /** paragraph when not given */
  kind?: AgentStyleKind | null
  /** the style whose look it starts from; 바탕글 when not given */
  basedOn?: string | null
  /** the paragraph style that follows; the new style itself when not given */
  nextStyle?: string | null
  format?: AgentStyleFormat | null
}

export interface AgentStyleChanges {
  /** a new name */
  name?: string | null
  englishName?: string | null
  nextStyle?: string | null
  format?: AgentStyleFormat | null
}

export type AgentStyleResult =
  | { ok: true; name: string; kind: AgentStyleKind }
  /** another style already has the name */
  | { ok: false; reason: 'style_exists' }
  | AgentNoSuchStyle

/** A place in a table, rows and columns from 1. */
export interface AgentCellPlace {
  row: number
  col: number
}

export type AgentMergeCellsResult =
  | { ok: true; merged: number; place: AgentPlace }
  | { ok: false; reason: 'no_such_table'; count: number }
  | { ok: false; reason: 'unsupported_place' }
  | { ok: false; reason: 'no_such_cell'; rows: number; cols: number }
  | { ok: false; reason: 'crosses_merged' | 'named_cells'; cells: AgentCellPlace[] }

export type AgentSplitCellResult =
  | { ok: true; unmerged: boolean; place: AgentPlace }
  | { ok: false; reason: 'no_such_table'; count: number }
  | { ok: false; reason: 'unsupported_place' | 'not_merged' | 'holds_object' }
  | { ok: false; reason: 'no_such_cell'; rows: number; cols: number }

export type AgentFormatCellsResult =
  | { ok: true; count: number; place: AgentPlace }
  | { ok: false; reason: 'no_such_table'; count: number }
  | { ok: false; reason: 'unsupported_place'; count: number }
  | {
      ok: false
      reason: 'no_such_cell'
      cells: { row: number; col: number }[]
      rows: number
      cols: number
    }

export type AgentFormatTextResult =
  | { ok: true; count: number; place: AgentPlace }
  | {
      ok: false
      reason: 'not_found' | 'ambiguous' | 'no_such_occurrence' | 'unsupported_place' | 'has_objects'
      count: number
      matches?: AgentMatch[]
    }
  | AgentNoSuchStyle

export type AgentFormatParagraphResult =
  | {
      ok: true
      inTable: boolean
      place: AgentPlace
      /** 1 when the paragraph took the style's name but kept its own look (as in formatSelection) */
      keptOwnLook?: number
    }
  | AgentPlaceRefusal
  | AgentNoSuchStyle

/** One table of the document, as listTables lists it. */
export interface AgentTableSummary {
  /** 1-based position among all tables in reading order; what readTable and fillCells take */
  table: number
  rows: number
  cols: number
  /** the number of the table whose cell this one sits in; absent for a table of the body */
  inTable?: number
  /** the line of text the table follows, cut short; empty when there is none close by */
  near: string
  /** the text of its first cells that hold any, each cut short */
  preview: string[]
}

export interface AgentTableList {
  /** all tables found; `tables` holds the first ones only */
  count: number
  /** the search for tables inside table cells ran out of budget: some may be missing */
  partial: boolean
  tables: AgentTableSummary[]
}

/** One cell of a table. A merged cell is listed once, at its first row and column. */
export interface AgentTableCell {
  /** 1-based */
  row: number
  col: number
  rowSpan?: number
  colSpan?: number
  /** the paragraphs of the cell joined by line breaks, cut when long */
  text: string
  /** numbers (as in listFields) of the click-here fields that sit in the cell */
  fields?: number[]
  /** a picture, a shape or a table sits in the cell or floats over it: not empty, whatever its text */
  object?: true
}

export type AgentReadTableResult =
  | {
      ok: true
      table: number
      rows: number
      cols: number
      cells: AgentTableCell[]
      /** the table goes on: the row to read from next */
      nextRow?: number
    }
  | { ok: false; reason: 'no_such_table'; count: number }

/** Text for one cell: 1-based place, and the text (a line break starts a new paragraph). */
export interface AgentCellText {
  row: number
  col: number
  text: string
}

export type AgentFillCellsResult =
  | { ok: true; table: number; count: number; place: AgentPlace }
  | { ok: false; reason: 'no_such_table'; count: number }
  | {
      ok: false
      /**
       * no_such_cell: the places are outside the table. occupied: the cells hold text and
       * overwrite was not given. has_fields: the cells hold several form fields each.
       * holds_object: the cells hold a picture or another object.
       */
      reason: 'no_such_cell' | 'occupied' | 'has_fields' | 'holds_object'
      cells: { row: number; col: number; text?: string; fields?: number[] }[]
      rows: number
      cols: number
    }
  /** the change would have removed an object of the document, and was rolled back */
  | { ok: false; reason: 'has_objects'; count: number }

export interface AgentField {
  /** 1-based position in the document; what fillField takes */
  field: number
  /** not unique: a field nobody named carries its guide text */
  name: string
  guide: string
  value: string
  /** a named table cell rather than a click-here field */
  inCell: boolean
}

export type AgentFillResult =
  | { ok: true; name: string; place?: AgentPlace }
  | { ok: false; reason: 'no_such_field'; count: number }

/** One run of a selection: the text selected in one paragraph, and where it is. */
export interface AgentSegment extends AgentPlace {
  text: string
}

export type AgentSelectionResult =
  | {
      ok: true
      inTable: boolean
      /**
       * the runs are the paragraphs of one stretch (the body, or one cell), so the selection
       * can be rewritten into more or fewer paragraphs; false for table cells and the like
       */
      contiguous: boolean
      /** the plugin made this selection itself when it showed a change; the user did not */
      own: boolean
      /** one run per paragraph touched, in reading order */
      segments: AgentSegment[]
    }
  | {
      ok: false
      /**
       * none: nothing is selected. unsupported: the selection is at a place without an
       * address here (a note, a header). too_long: beyond the sanity limit of a selection.
       */
      reason: 'none' | 'unsupported' | 'too_long'
    }

export type AgentReplaceSelectionResult =
  | { ok: true; segments: AgentSegment[]; place: AgentPlace }
  /** a run no longer holds the text it held when the selection was read */
  | { ok: false; reason: 'changed' }
  /** the texts are not as many as the runs, and the runs are not one stretch of paragraphs */
  | { ok: false; reason: 'count'; count: number }
  | { ok: false; reason: 'has_objects'; count: number }

export type AgentFormatSelectionResult =
  | {
      ok: true
      count: number
      place: AgentPlace
      /**
       * paragraphs that took the style's name but kept their own look: the editor keeps a
       * paragraph's own paragraph formatting whole when it differs from its former style's
       */
      keptOwnLook?: number
    }
  | { ok: false; reason: 'changed' | 'unsupported_place' }
  | { ok: false; reason: 'has_objects'; count: number }
  | AgentNoSuchStyle

/** Rows or columns of a table. */
export type AgentTableLines = 'rows' | 'columns'

/** Why a row or column call did nothing. */
export type AgentTableLinesRefusal =
  | { ok: false; reason: 'no_such_table'; count: number }
  | {
      ok: false
      /**
       * nested: the table sits inside a cell of another table, where the engine cannot add
       * or remove lines. no_such_line: the row or column is outside the table.
       * would_empty: nothing would be left of the table.
       */
      reason: 'nested' | 'no_such_line' | 'would_empty'
      rows: number
      cols: number
    }
  | {
      ok: false
      /** cells of those lines hold a picture or another object */
      reason: 'holds_object'
      cells: { row: number; col: number }[]
      rows: number
      cols: number
    }
  | { ok: false; reason: 'has_objects'; count: number }

export type AgentAddLinesResult =
  | {
      ok: true
      table: number
      /** the size of the table now */
      rows: number
      cols: number
      /** 1-based number of the first new row or column */
      first: number
      count: number
      place?: AgentPlace
    }
  | AgentTableLinesRefusal

export type AgentRemoveLinesResult =
  | {
      ok: true
      table: number
      rows: number
      cols: number
      count: number
      /** the text that went with them, cut to a few hundred characters */
      text: string
      place: AgentPlace
    }
  | AgentTableLinesRefusal

export type AgentDeleteTableResult =
  | {
      ok: true
      table: number
      rows: number
      cols: number
      /** the tables inside its cells that went with it */
      inner: number
      /** the text that went with it, cut to a few hundred characters */
      text: string
      place: AgentPlace
    }
  | { ok: false; reason: 'no_such_table'; count: number }
  | { ok: false; reason: 'holds_object'; cells: { row: number; col: number }[] }
  | { ok: false; reason: 'has_objects'; count: number }

/** What a File menu item of the editor asks the app to do. */
export type AgentFileCommand = 'save' | 'saveAs' | 'pdf' | 'print'

/** The event those items fire on the editor's window; `detail` is the AgentFileCommand. */
export declare const FILE_COMMAND_EVENT: 'kordoc:file-command'

/** The parts of the editor toolbar's style list (a select element) syncStyleList uses. */
export interface StyleListElement {
  readonly options: ArrayLike<{ value: string; textContent: string | null }>
  selectedIndex: number
  value: string
  replaceChildren(...nodes: unknown[]): void
  readonly ownerDocument: {
    createElement(name: 'option'): { value: string; textContent: string | null }
  }
}

/**
 * Fill the editor toolbar's style list with the document's styles when they differ from what
 * it shows, keeping the number shown where a style still has it. True when it was refilled.
 */
export declare function syncStyleList(
  select: StyleListElement,
  styles: { id: number; name: string }[],
): boolean

/** The event the plugin fires on the editor's window when the unsaved state changes; `detail` is the new state. */
export declare const DIRTY_EVENT: 'kordoc:dirty-changed'

export type AgentNoteKind = 'footnote' | 'endnote'

/** One footnote or endnote of the body, as listNotes lists it. */
export interface AgentNote {
  /** 1-based position among the notes of the body in reading order; what editNote and deleteNote take */
  note: number
  kind: AgentNoteKind
  /** the number the document shows (footnotes and endnotes are counted apart) */
  number: number
  /** the text in front of the note's mark */
  after: string
  /** the note's text, a line per paragraph, cut when long */
  text: string
  /** it holds something besides text (an equation, a picture): it is not rewritten */
  objects?: true
}

export interface AgentNoteList {
  count: number
  /** notes inside table cells or text boxes, which have no address here */
  elsewhere: number
  notes: AgentNote[]
}

export type AgentInsertNoteResult =
  { ok: true; kind: AgentNoteKind; number: number | null; place: AgentPlace } | AgentPlaceRefusal

export type AgentEditNoteResult =
  | { ok: true; kind: AgentNoteKind; number: number; was: string; place: AgentPlace }
  | { ok: false; reason: 'no_such_note'; count: number }
  | { ok: false; reason: 'has_objects'; count: number }

export type AgentDeleteNoteResult =
  | { ok: true; kind: AgentNoteKind; number: number; text: string; place: AgentPlace }
  | { ok: false; reason: 'no_such_note'; count: number }
  | { ok: false; reason: 'has_objects'; count: number }

/** One heading of a table of contents: text it contains, and its level (1 to 3). */
export interface AgentTocEntry {
  find: string
  /** which occurrence of find, when it occurs more than once */
  occurrence?: number | null
  level: number
}

/** A tab a save found without a width: see TabSpot in src/main/tab-widths.ts. */
export interface AgentTabSpot {
  sec: number
  para: number
  cells: { table: number; cell: number; para: number }[]
  tab: number
  tabs: number
}

/** Width in HWPUNIT; kind (0 left, 1 right, 2 centre, 3 decimal) and leader of its tab stop. */
export interface AgentTabMeasure {
  width: number
  type: number
  fill: number
}

export type AgentInsertTocResult =
  | { ok: true; count: number; pages: number[]; place: AgentPlace }
  | AgentPlaceRefusal
  | { ok: false; reason: 'in_table'; count: number }
  /** a heading could not be decided: `why` is not_found, ambiguous, no_such_occurrence or unsupported_place */
  | {
      ok: false
      reason: 'no_heading'
      heading: string
      why: string
      count: number
      matches?: AgentMatch[]
    }

export type AgentRefreshTocResult =
  | {
      ok: true
      /** rows that hold a page number */
      lines: number
      changed: number
      /** headings no longer found in the body */
      missing?: string[]
      place: AgentPlace
    }
  | AgentPlaceRefusal
  | { ok: false; reason: 'in_table'; count: number }
  | { ok: false; reason: 'no_toc'; count: number }

export type AgentUndoResult =
  { ok: boolean; undone: number } | { ok: false; reason: 'changed'; undone: 0 }

/** What the plugin answers to, by method name (the studio's `plugins.invoke`). */
export interface AgentPluginSurface {
  foreignChanges(): number
  readText(): string
  findText(find: string): AgentFindResult
  replaceText(find: string, replacement: string, occurrence?: number | null): AgentReplaceResult
  replaceAllText(find: string, replacement: string): AgentReplaceAllResult
  insertParagraphs(
    anchor: string,
    occurrence: number | null,
    where: AgentWhere,
    paragraphs: string[],
  ): AgentInsertResult
  deleteParagraph(find: string, occurrence: number | null): AgentDeleteResult
  insertTable(
    anchor: string,
    occurrence: number | null,
    where: AgentWhere,
    rows: string[][],
    header?: boolean,
  ): AgentTableResult
  formatText(
    find: string,
    occurrence: number | null,
    all: boolean,
    format: AgentTextFormat,
  ): AgentFormatTextResult
  formatParagraph(
    find: string,
    occurrence: number | null,
    format: AgentParagraphFormat,
  ): AgentFormatParagraphResult
  listTables(): AgentTableList
  readTable(table: number, fromRow?: number | null): AgentReadTableResult
  fillCells(table: number, cells: AgentCellText[], overwrite: boolean): AgentFillCellsResult
  addTableLines(
    table: number,
    what: AgentTableLines,
    at: number,
    where: 'after' | 'before',
    count: number,
  ): AgentAddLinesResult
  removeTableLines(
    table: number,
    what: AgentTableLines,
    at: number,
    count: number,
  ): AgentRemoveLinesResult
  deleteTable(table: number): AgentDeleteTableResult
  installFileMenu(labels: Record<AgentFileCommand, string>): { ok: boolean }
  reveal(place: AgentPlace): { ok: boolean }
  selection(): AgentSelectionResult
  replaceSelection(segments: AgentSegment[], texts: string[]): AgentReplaceSelectionResult
  formatSelection(
    segments: AgentSegment[],
    format: AgentParagraphFormat,
  ): AgentFormatSelectionResult
  listFields(): AgentField[]
  fillField(field: number, value: string): AgentFillResult
  insertToc(
    anchor: string,
    occurrence: number | null,
    where: AgentWhere,
    title: string | null,
    entries: AgentTocEntry[],
  ): AgentInsertTocResult
  refreshToc(title: string, occurrence: number | null): AgentRefreshTocResult
  listNotes(): AgentNoteList
  insertNote(
    kind: AgentNoteKind,
    anchor: string,
    occurrence: number | null,
    text: string,
  ): AgentInsertNoteResult
  editNote(note: number, text: string): AgentEditNoteResult
  deleteNote(note: number): AgentDeleteNoteResult
  measureTabs(spots: AgentTabSpot[]): { tabs: (AgentTabMeasure | null)[] }
  listStyles(): AgentStyleNames
  readStyle(name: string): AgentReadStyleResult
  createStyle(spec: AgentNewStyle): AgentStyleResult
  editStyle(name: string, changes: AgentStyleChanges): AgentStyleResult
  /** pages for printing from `from`, as many as are drawn in about two seconds */
  printPages(from: number): AgentPrintPages
  mergeCells(table: number, from: AgentCellPlace, to: AgentCellPlace): AgentMergeCellsResult
  splitCell(
    table: number,
    row: number,
    col: number,
    rows?: number | null,
    cols?: number | null,
  ): AgentSplitCellResult
  formatCells(
    table: number,
    cells: { row: number; col: number }[],
    background: string,
  ): AgentFormatCellsResult
  /** take the marks of the changes made so far off the pages */
  clearMarks(): { ok: true }
  undo(steps: number, expectedForeign: number): AgentUndoResult
}

/** Pages drawn for printing: SVG, and each page's size in CSS pixels. */
export interface AgentPrintPages {
  pageCount: number
  from: number
  pages: { svg: string; width: number; height: number }[]
}

/** The part of the studio's plugin host this plugin uses. */
export interface AgentPluginHost {
  read<T>(fn: (doc: never) => T): T
  transaction<T>(label: string, fn: (tx: { doc(): never; deferPagination(): void }) => T): T
  events: { on(name: 'document-changed', handler: () => void): unknown }
  automation: {
    execute(command: string, params?: unknown): { ok?: boolean } | null | undefined
    registerCommand?(command: {
      id: string
      label: string
      shortcutLabel?: string
      execute(services: never, params?: never): void
    }): void
    addMenuItem?(spec: { menuId: string; commandId: string; position?: 'top' | 'bottom' }): void
  }
}

export declare const agentPlugin: {
  id: typeof AGENT_PLUGIN_ID
  apiVersion: 1
  activate(host: AgentPluginHost): AgentPluginSurface
}

export default agentPlugin
