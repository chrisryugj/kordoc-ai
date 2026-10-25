// 이음오피스(IeumOffice, https://github.com/pblsketch/openoffice, Apache-2.0, Copyright 2026 Mainfunc, Inc.)의
// apps/hwp/src/renderer/ai/hwp-skill.ts(커밋 a907a88c, 스타일·저장 안 됨 알림·스타일 목록은 63e2a636)에서 옮겼다. 바꾼 것: 가져오기 경로, 다국어 키 → 한국어 문구(labels.ts),
// 웹 페이지 읽기 도구(read_url)와 그 지시 삭제(폐쇄망 앱이라 밖으로 나가는 도구를 두지 않는다), 앱 이름.
import type { AgentSkill, AgentToolCall, AgentToolDef, ToolExecution } from './types'
import type {
  AgentCellText,
  AgentMatch,
  AgentNoSuchStyle,
  AgentParagraphFormat,
  AgentPlace,
  AgentPlaceRefusal,
  AgentSegment,
  AgentStyleKind,
  AgentTableCell,
  AgentTableLinesRefusal,
  AgentTableSummary,
  AgentTocEntry,
  AgentWhere,
} from '../../../node-sidecar/studio-plugin/agent-plugin.mjs'
import type { AgentBridge } from './bridge'
import type { LabelKey, Params } from './labels'

/** Document text attached to every user message; longer documents are read on demand. */
export const CONTEXT_MAX_CHARS = 8000
/** Most text one read_document call returns. */
export const READ_PAGE_CHARS = 24000
const CONTEXT_MAX_FIELDS = 40
/** Selected text attached to a user message; a longer selection is read on demand. */
export const SELECTION_CONTEXT_CHARS = 6000
/** Longest quote of document text inside an activity label. */
const LABEL_QUOTE_CHARS = 24
/** Longest text of an added or removed paragraph kept for the panel's list of changes. */
const CHANGE_TEXT_CHARS = 200

/** One change a run made to the document, as the panel lists it. */
export interface HwpChange {
  kind:
    | 'replace'
    | 'replaceAll'
    | 'field'
    | 'insert'
    | 'delete'
    | 'table'
    | 'format'
    | 'cells'
    | 'lines'
    | 'note'
  /** the replaced, removed or formatted text, the field name, or the table whose cells were filled; empty for something added */
  from: string
  /** the new text (for a table its first row, for a format what was set, for cells what went into them); empty for something removed */
  to: string
  /** places changed (more than one for replaceAll, filled cells, and rows or columns) */
  count: number
  /** where the change is (the first place of several), for the editor to show */
  place?: AgentPlace
}

/** What the user selected in the editor, as the selection tools work on it. */
export interface HwpSelection {
  /** one run per selected paragraph, as the editor handed them out */
  segments: AgentSegment[]
  inTable: boolean
  /** the runs are one stretch of paragraphs: it can become more or fewer paragraphs */
  contiguous: boolean
}

export interface HwpSkillDeps {
  bridge: AgentBridge
  /** activity labels, in the UI language */
  label(key: LabelKey, params?: Params): string
  /** called once for every change that went into the document (one undo step each) */
  onChange(change: HwpChange): void
}

export interface HwpSkill {
  skill: AgentSkill
  /**
   * Read the document state the next user message is sent with. The loop
   * builds its context synchronously, so the panel awaits this before a run.
   */
  refreshContext(): Promise<void>
  /**
   * What the user has selected in the editor, for the run about to start: the runs the
   * selection tools act on. Null when nothing is selected.
   */
  setSelection(scope: HwpSelection | null): void
}

const SYSTEM_PROMPT = [
  'You are the assistant inside the KorDoc AI editor for Hangul word processor documents (HWP / HWPX), the format most Korean public offices write in.',
  'You work on the document that is open in the editor, through tools.',
  '',
  '## What the tools can do',
  '- Read the text of the document, table cells included (read_document, find_text).',
  '- Replace a piece of text with another (replace_text, replace_all). The new text takes the formatting of the text it replaces.',
  '- Add new paragraphs next to an existing one, in the body or inside a table cell, or at the end of the document (insert_paragraphs). Remove a paragraph (delete_paragraph).',
  '- Add a table of plain-text cells, with a header row when the first row names the columns (insert_table).',
  '- Work on the tables that are already there: list them (list_tables), read one cell by cell (read_table), write text into its cells, many at once (fill_cells), add or remove rows and columns (add_to_table, remove_from_table), and remove a whole table (delete_table).',
  '- Change formatting: bold, italic, underline, strikethrough, font, font size, text colour, highlight and the character style of a piece of text (format_text); alignment, line spacing, first-line indent, margins, space above and below and the paragraph style of a paragraph, and the character formatting of a whole paragraph (format_paragraph); the background colour of table cells (format_cells).',
  '- Work with the styles of the document: see what one looks like (read_style), add a paragraph or character style (create_style), and change a style: its name, the style that follows it and its look (edit_style).',
  '- Merge table cells into one (merge_cells; their text goes into it, one cell after another) or split a cell into several, or a merged cell back (split_cell). Read the table first: rows and columns count as read_table shows them.',
  '- Fill the form fields of the document (list_fields, fill_field). In Hangul these are called 누름틀. A field is picked by its number in list_fields, because several fields often share one name.',
  '- Make a table of contents (차례, 목차) from the headings you pick, with their page numbers, and write its page numbers again after the document changed (insert_toc, refresh_toc).',
  '- Add footnotes and endnotes (각주, 미주) with their mark right after a piece of body text (insert_note), list the notes with their text (list_notes), and rewrite or remove one (edit_note, delete_note). The text of the document does not show the notes; list_notes does.',
  '',
  '## What they cannot do',
  '- You cannot change numbering, borders or the page layout, and you cannot add or change pictures. A note cannot be put inside a table cell.',
  '- A table inside a cell of another table can be read, filled and removed, but its cells cannot be coloured, merged or split, it cannot get or lose rows and columns, and the alignment, spacing and paragraph style of its paragraphs cannot be changed. Its text can still be formatted, character styles included.',
  '- You cannot remove a style. The user can do that in the style dialog of the editor (F6).',
  '- One piece of text is always one line: a line break inside a text argument is refused. Several paragraphs are several strings in one insert_paragraphs call.',
  '- When the user asks for something the tools cannot do, say so plainly instead of approximating it.',
  '',
  '## How new paragraphs look',
  '- A new paragraph is made the way pressing Enter makes one: it takes the formatting of the paragraph you anchor it to. So anchor it to a paragraph that looks the way the new one should: body text next to body text, a list item next to list items, never next to a title unless a title is what you are adding.',
  '- This is not markdown. Write the text exactly as it should appear, with no #, **, or markdown bullets. Korean official documents mark their levels with characters such as □, ㅇ, -, * or 1. / 가. at the start of the line: continue the scheme the document already uses, including its leading spaces.',
  '- Write a longer addition as several paragraphs in one insert_paragraphs call, in order. An empty string is an empty line.',
  '',
  '## Filling in forms',
  '- A Korean form is mostly tables: a cell that names an item (성명, 소속, 연락처) and an empty cell beside or below it for the answer. The text of the document shows the names but not the empty cells, so read the table with read_table before filling it.',
  '- Tables are numbered in reading order; a table inside a cell of another table has its own number. Cells are named row.col, counted from 1. A merged cell is listed once, with the places it spans.',
  '- Fill every cell you have an answer for in one fill_cells call per table. The text takes the formatting the cell already has, so do not format it afterwards.',
  '- fill_cells only writes into empty cells. A cell that holds text is left alone, and so is the whole call, unless you pass overwrite: do that only when the user asked to change what is there. Never write into the cells that name the items.',
  '- An empty cell cannot be reached with replace_text or insert_paragraphs, which need text to find: use fill_cells.',
  '- A cell marked as holding a picture or another object is not empty even without text (a logo, a seal, a photo): never fill it.',
  '- Leave a cell empty when you do not know its answer, and tell the user which ones are left.',
  '- When a list in a form has too few rows for what the user gave you, add rows after the last row of that list with add_to_table (they come out shaped like that row), read the table again for the new row numbers, then fill them. Do not add rows or columns the user has no content for.',
  '- Remove rows or columns only when the user asks for it: what is in them goes too.',
  '- Remove a whole table only when the user asks for it, for example the tables of a form that offers several to choose from. Text between the tables, such as an "or" line, is a paragraph of its own: remove it with delete_paragraph.',
  '',
  '## Table of contents',
  '- Make one only when the user asks. Pick the headings from the text: the lines that open the parts of the document, in order (for example Ⅰ./1./가. or □ at the start, or short title lines). Level 1 for the top parts, 2 and 3 for the parts inside them; leave out body lines.',
  '- Name each heading by text it contains, as short as is unambiguous (pass occurrence when it occurs more than once). The table shows the whole heading line and finds its page itself: never type page numbers.',
  '- Put it where the user says; otherwise after the title or cover of the document. Give it the title the user uses, or 차 례 for a Korean document.',
  '- After changes that move text between pages, or when the user asks, call refresh_toc with the title of the table of contents.',
  '',
  '## Footnotes and endnotes',
  '- A footnote explains or gives the source of the words it follows and shows at the foot of the page; an endnote does the same at the end of the document. Use the kind the user asks for; when they do not say, use a footnote, and use endnotes where the document already has them.',
  '- The mark goes right after the words the note is about: pass those words as after, as short as is unambiguous. The document numbers the notes itself; never type a number into the text or the note.',
  '- Write the note text plainly: no number, no leading mark, no markdown. A source is written the way the document already cites (author, title, year, page).',
  '- To change a note, call list_notes and rewrite it with edit_note by its number there; edit_note replaces its whole text. Remove a note only when the user asks.',
  '',
  '## When the user has selected text',
  '- When the context has a "Selected text" block, the user selected that part in the editor and the request is about it: "this", "here", "이 부분", "선택한 부분" mean the selection.',
  '- Change it with replace_selection and format_selection, which act on exactly the selected text. Do not use replace_text or format_text for it: the same words may occur elsewhere in the document.',
  '- replace_selection takes the new text of the selected paragraphs, one string each, in order; pass a paragraph as it is to keep it. When the selection is one stretch of text you may pass more or fewer strings than it has paragraphs: further strings become new paragraphs after it, and paragraphs left without a string are removed. A selection of table cells or of separate places takes exactly one string for each listed paragraph.',
  '- A long selection is worked on in parts: read_selection shows the paragraphs the context left out, and replace_selection with first replaces a run of paragraphs starting at that number.',
  '- Leave the rest of the document alone unless the request clearly asks for more.',
  '- Without that block nothing is selected. If the user then speaks of "the selected part", ask them to select the text in the document first.',
  '',
  '## Formatting rules',
  '- Format only what the user asked for. Do not restyle text on your own: a new paragraph already looks like its neighbour, and official documents keep one look throughout.',
  '- When new content needs a look of its own (a heading, an emphasised line), insert the text first, then format it with a second call.',
  '- For emphasis prefer bold. Use colour and highlight only when the user asks for them.',
  '- To take formatting away, pass false (bold, italic, underline, strikethrough) or "none" (highlight, cell background).',
  '- For a font prefer one the document already uses, or one every Korean Windows PC has (맑은 고딕, 바탕, 돋움, 굴림, 궁서); a font the PC lacks is shown in another one.',
  '- A paragraph style (the "Paragraph styles" line of the context) sets the look the document defines for that kind of paragraph; prefer it to setting the same things one by one. A character style (the "Character styles" line) does the same for a piece of text, for example a term or an emphasis; apply it with char_style.',
  '',
  '## Styles',
  '- Add or change a style only when the user asks for one, or asks for a look to use again across the document. Then make the style and apply it with format_paragraph or format_selection (style), or format_text (char_style).',
  '- A new style starts from the look of based_on (바탕글 when not given): pass only what should differ. Base it on the style of the paragraphs it is for. Give it the name the user uses; a paragraph style is followed by itself unless next_style says otherwise.',
  '- read_style shows what a style looks like before you change it, in the units the format tools take.',
  '- Changing a style changes every paragraph that uses it, in tables, text boxes, headers, footers and notes too. What a paragraph has set differently from its style (for example its alignment) stays, and the rest follows the style, as in Hangul. Changing a character style changes the text it was applied to; that text keeps its look when the style of its paragraph changes.',
  '- When a tool says a paragraph kept formatting of its own under a style, the properties it had set differently from its former style stayed and the rest follows the new style. If the user wants the plain look of the style, read it with read_style and pass those properties in the same call.',
  '',
  '## Editing rules',
  '- Text you pass to find or anchor must match the document exactly: letters, spaces and punctuation. Copy it from what you read; never retype it from memory.',
  '- Change as little as possible: find the shortest piece that says what must change and is still unambiguous. When it occurs more than once, call find_text and pass the occurrence you mean, or use replace_all when every occurrence should change.',
  '- To reword part of a paragraph use replace_text. Do not delete a paragraph and insert a new one for that: the paragraph would lose formatting that differs inside it.',
  '- Leave numbers, dates, names, amounts and legal references as they are unless the user asks to change them.',
  '- Never invent a fact to fill a field or a blank. Fill what the user gave you and ask for the rest in one question.',
  '- Where the text shows the guide of an empty form field (for example "이곳을 마우스로 누르고 내용을 입력하세요."), that is not document text: fill it with fill_field, not with replace_text.',
  '- For proofreading or rewording requests, read the text first, then fix each place with its own replace_text call.',
  '- If a tool says the text was not found, read that part of the document again before trying anything else.',
  '- If a tool says an object is in the way (a table, a picture or a form field sits in that paragraph), pick the paragraph before or after it as the anchor, or tell the user.',
  '',
  '## Conversation',
  '- Answer questions about the document directly, without changing it.',
  '- Keep replies short. After editing, say in a sentence or two what you changed. The panel lists every change and lets the user take the whole run back.',
  '- Say that you changed the document only for changes a tool reported done. Do not describe edits you are about to make instead of making them: call the tool. When a tool refused or failed, say what was not done and why.',
  '- Write every reply in the language the user writes in, the summary after edits included, even though tool results come back in English.',
].join('\n')

/** The character formatting a format tool takes, as schema properties. */
const TEXT_FORMAT_SCHEMA = {
  bold: { type: 'boolean' },
  italic: { type: 'boolean' },
  underline: { type: 'boolean' },
  strikethrough: { type: 'boolean' },
  size: { type: 'number', description: 'font size in points' },
  color: { type: 'string', description: 'text colour as #RRGGBB' },
  highlight: {
    type: 'string',
    description: 'highlight colour as #RRGGBB, or "none" to remove a highlight',
  },
  font: { type: 'string', description: 'font name, for example 맑은 고딕' },
  char_style: {
    type: 'string',
    description: 'name of a character style of the document; set before the other properties',
  },
}

/** The paragraph formatting a format tool takes, as schema properties. */
const PARAGRAPH_FORMAT_SCHEMA = {
  align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
  line_spacing: { type: 'number', description: 'line spacing in percent, for example 160' },
  indent: {
    type: 'number',
    description: 'first-line indent in points; negative hangs the first line out (-100 to 100)',
  },
  margin_left: { type: 'number', description: 'left margin of the paragraph in points (0 to 300)' },
  margin_right: { type: 'number', description: 'right margin in points (0 to 300)' },
  space_before: { type: 'number', description: 'space above the paragraph in points (0 to 200)' },
  space_after: { type: 'number', description: 'space below the paragraph in points (0 to 200)' },
  style: { type: 'string', description: 'name of a paragraph style of the document' },
}

/** Paragraph styles named in the context at most. */
const CONTEXT_MAX_STYLES = 40

/** The look a style is made or changed with: the format properties without styles. */
const STYLE_LOOK_SCHEMA = (() => {
  const { char_style: _char, ...text } = TEXT_FORMAT_SCHEMA
  const { style: _style, ...paragraph } = PARAGRAPH_FORMAT_SCHEMA
  return { ...paragraph, ...text }
})()

/** Cells one read_table answer holds at most (the editor's own limit), as the model is told. */
const READ_TABLE_HINT = 600

const TOC_ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    find: { type: 'string', description: 'text of the heading, enough to tell it apart' },
    occurrence: {
      type: 'integer',
      minimum: 1,
      description: 'which occurrence of find, when it occurs more than once',
    },
    level: { type: 'integer', minimum: 1, maximum: 3 },
  },
  required: ['find', 'level'],
}

const NOTE_TEXT_SCHEMA = {
  type: 'string',
  description:
    'the text of the note, without its number; a line break starts a new paragraph of the note',
}

const TOOLS: AgentToolDef[] = [
  {
    name: 'read_document',
    description:
      'Read the text of the open document in reading order, table cells included. Returns up to ' +
      `${READ_PAGE_CHARS} characters from offset; call again with the next offset for a longer document.`,
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'integer', minimum: 0, description: 'character to start from (default 0)' },
      },
    },
  },
  {
    name: 'find_text',
    description:
      'List where a piece of text occurs: how many times, and each occurrence with the text around it. Exact and case-sensitive.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'the text to look for' } },
      required: ['text'],
    },
  },
  {
    name: 'replace_text',
    description:
      'Replace one occurrence of a piece of text. Without occurrence the text must occur exactly once; with it, that occurrence (1-based, as listed by find_text) is replaced. An empty replacement deletes the text.',
    inputSchema: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'the exact text to replace, within one paragraph' },
        replace: { type: 'string', description: 'the new text, one line' },
        occurrence: { type: 'integer', minimum: 1 },
      },
      required: ['find', 'replace'],
    },
  },
  {
    name: 'replace_all',
    description: 'Replace every occurrence of a piece of text in the whole document.',
    inputSchema: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'the exact text to replace, within one paragraph' },
        replace: { type: 'string', description: 'the new text, one line' },
      },
      required: ['find', 'replace'],
    },
  },
  {
    name: 'insert_paragraphs',
    description:
      'Add new paragraphs after or before the paragraph that contains the anchor text, or at the end of the document. They take the formatting of that paragraph. Works inside table cells too: the new paragraphs go into the same cell.',
    inputSchema: {
      type: 'object',
      properties: {
        where: {
          type: 'string',
          enum: ['after', 'before', 'end'],
          description: '"end" is the end of the document and needs no anchor',
        },
        anchor: {
          type: 'string',
          description: 'exact text found in the paragraph to add next to (not needed for "end")',
        },
        occurrence: { type: 'integer', minimum: 1 },
        paragraphs: {
          type: 'array',
          items: { type: 'string' },
          description: 'the new paragraphs in order, each one line; "" is an empty line',
        },
      },
      required: ['where', 'paragraphs'],
    },
  },
  {
    name: 'delete_paragraph',
    description:
      'Remove the whole paragraph that contains a piece of text. A paragraph that holds a table, a picture or a form field is not removed.',
    inputSchema: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'exact text found in the paragraph to remove' },
        occurrence: { type: 'integer', minimum: 1 },
      },
      required: ['find'],
    },
  },
  {
    name: 'insert_table',
    description:
      'Add a table after or before the paragraph that contains the anchor text, or at the end of the document. Cells are plain one-line text; short rows are padded with empty cells. The table takes the font of that paragraph. It cannot be put inside a cell of another table.',
    inputSchema: {
      type: 'object',
      properties: {
        where: { type: 'string', enum: ['after', 'before', 'end'] },
        anchor: { type: 'string', description: 'exact text found in the paragraph to add next to' },
        occurrence: { type: 'integer', minimum: 1 },
        rows: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'the rows from top to bottom, each a list of cell texts',
        },
        header: {
          type: 'boolean',
          description: 'the first row names the columns: it is made bold, centred and shaded',
        },
      },
      required: ['where', 'rows'],
    },
  },
  {
    name: 'format_text',
    description:
      'Change the character formatting of a piece of text: one occurrence, or every occurrence with all. Only the properties you pass change.',
    inputSchema: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'the exact text to format, within one paragraph' },
        occurrence: { type: 'integer', minimum: 1 },
        all: { type: 'boolean', description: 'format every occurrence of the text' },
        ...TEXT_FORMAT_SCHEMA,
      },
      required: ['find'],
    },
  },
  {
    name: 'format_paragraph',
    description:
      'Change the formatting of the whole paragraph that contains a piece of text: its alignment, line spacing, indent, margins, spacing and style, and character formatting for all of its text. Only the properties you pass change; a style is applied first and the rest goes over it.',
    inputSchema: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'exact text found in the paragraph to format' },
        occurrence: { type: 'integer', minimum: 1 },
        ...PARAGRAPH_FORMAT_SCHEMA,
        ...TEXT_FORMAT_SCHEMA,
      },
      required: ['find'],
    },
  },
  {
    name: 'replace_selection',
    description:
      'Replace the text the user selected in the editor (the "Selected text" block of the context). One string per selected paragraph, in the same order; each takes the place of that paragraph\'s selected text and keeps its formatting. Without first the strings stand for the whole selection, and for a selection that is one stretch of text they may be more or fewer than its paragraphs. With first they replace that many paragraphs starting at that number.',
    inputSchema: {
      type: 'object',
      properties: {
        paragraphs: {
          type: 'array',
          items: { type: 'string' },
          description: 'the new text of the selected paragraphs, in order, each one line',
        },
        first: {
          type: 'integer',
          minimum: 1,
          description: 'replace only the paragraphs from this number of the selection on',
        },
      },
      required: ['paragraphs'],
    },
  },
  {
    name: 'read_selection',
    description:
      'Read the paragraphs of the selected text by number, for a selection too long to be shown whole in the context.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'integer', minimum: 1, description: 'paragraph to start from (default 1)' },
      },
    },
  },
  {
    name: 'format_selection',
    description:
      'Change the formatting of the text the user selected in the editor. Only the properties you pass change; the paragraph properties (align, line_spacing, indent, margins, spacing, style) apply to the whole paragraphs the selection is in.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PARAGRAPH_FORMAT_SCHEMA,
        ...TEXT_FORMAT_SCHEMA,
      },
    },
  },
  {
    name: 'read_style',
    description:
      'Show one style of the document: whether it is a paragraph or a character style, its English name, the style that follows it, and its look in the units the format tools take.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'the style name, or its English name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_style',
    description:
      'Add a style to the document. It starts from the look of based_on and takes the properties you pass over that. A character style takes character properties only. The new style is not applied to anything: apply it with the format tools.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'name of the new style' },
        english_name: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['paragraph', 'character'],
          description: 'default paragraph',
        },
        based_on: {
          type: 'string',
          description: 'a style whose look it starts from; default 바탕글',
        },
        next_style: {
          type: 'string',
          description:
            'paragraph style of the paragraph after one of this style (Enter); default the new style itself',
        },
        ...STYLE_LOOK_SCHEMA,
      },
      required: ['name'],
    },
  },
  {
    name: 'edit_style',
    description:
      'Change a style of the document: its name, English name, next style, and its look (only the properties you pass). Paragraphs that use it change with it, as the Styles rules say.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'the style to change, by name or English name' },
        new_name: { type: 'string' },
        english_name: { type: 'string' },
        next_style: { type: 'string', description: 'a paragraph style; paragraph styles only' },
        ...STYLE_LOOK_SCHEMA,
      },
      required: ['name'],
    },
  },
  {
    name: 'merge_cells',
    description:
      'Merge the cells of a table between two corners (both included) into one cell. Their text is kept, one cell after another. A merged cell must lie wholly inside the range. Not for a table inside another table.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'integer', minimum: 1, description: 'table number from list_tables' },
        from_row: { type: 'integer', minimum: 1 },
        from_col: { type: 'integer', minimum: 1 },
        to_row: { type: 'integer', minimum: 1 },
        to_col: { type: 'integer', minimum: 1 },
      },
      required: ['table', 'from_row', 'from_col', 'to_row', 'to_col'],
    },
  },
  {
    name: 'split_cell',
    description:
      'Split one cell of a table into rows × cols cells, or, without rows and cols, split a merged cell back into the cells it covers. The text stays in the first cell. Not for a table inside another table.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'integer', minimum: 1, description: 'table number from list_tables' },
        row: { type: 'integer', minimum: 1 },
        col: { type: 'integer', minimum: 1 },
        rows: { type: 'integer', minimum: 1, maximum: 10 },
        cols: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['table', 'row', 'col'],
    },
  },
  {
    name: 'format_cells',
    description:
      'Give cells of a table a background colour, or take it away with "none". Cells are named by row and column from 1, as read_table shows them; a merged cell by any place it covers. Not for a table inside another table.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'integer', minimum: 1, description: 'table number from list_tables' },
        cells: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              row: { type: 'integer', minimum: 1 },
              col: { type: 'integer', minimum: 1 },
            },
            required: ['row', 'col'],
          },
        },
        background: { type: 'string', description: 'colour as #RRGGBB, or "none"' },
      },
      required: ['table', 'cells', 'background'],
    },
  },
  {
    name: 'list_tables',
    description:
      'List the tables of the document in reading order: number, rows and columns, the line of text above it, and its first cells. A table inside a cell of another table is listed too, with the number of that table.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_table',
    description: `Read one table cell by cell: each cell as row.col with its text, empty cells included. A merged cell is listed once with the places it spans. A long table comes in parts of about ${READ_TABLE_HINT} cells; call again with from_row to go on.`,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'integer', minimum: 1, description: 'the table number from list_tables' },
        from_row: { type: 'integer', minimum: 1, description: 'row to start from (default 1)' },
      },
      required: ['table'],
    },
  },
  {
    name: 'fill_cells',
    description:
      'Write text into cells of one table, all of them at once (one step for the user to undo). The text takes the formatting the cell already has; a line break starts a new paragraph inside the cell. Only empty cells are written unless overwrite is true: if any named cell holds text, nothing is changed and those cells are listed.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'integer', minimum: 1, description: 'the table number from list_tables' },
        cells: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              row: { type: 'integer', minimum: 1 },
              col: { type: 'integer', minimum: 1 },
              text: { type: 'string' },
            },
            required: ['row', 'col', 'text'],
          },
          description: 'the cells to write, each by its row and column as read_table lists them',
        },
        overwrite: {
          type: 'boolean',
          description: 'replace the text of cells that already hold some (default false)',
        },
      },
      required: ['table', 'cells'],
    },
  },
  {
    name: 'add_to_table',
    description:
      'Add empty rows or columns to a table, after or before one of its rows or columns. The new ones are shaped and formatted like that one. Row and column numbers after them shift: read the table again before filling. Not for a table that sits inside a cell of another table.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'integer', minimum: 1, description: 'the table number from list_tables' },
        what: { type: 'string', enum: ['rows', 'columns'] },
        at: { type: 'integer', minimum: 1, description: 'the row or column to add next to' },
        where: { type: 'string', enum: ['after', 'before'], description: 'default "after"' },
        count: { type: 'integer', minimum: 1, description: 'how many to add (default 1)' },
      },
      required: ['table', 'what', 'at'],
    },
  },
  {
    name: 'remove_from_table',
    description:
      'Remove rows or columns of a table, with what is in them. Use it only when the user asked for it. A table keeps at least one row and one column; a row or column with a picture in it is not removed.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'integer', minimum: 1, description: 'the table number from list_tables' },
        what: { type: 'string', enum: ['rows', 'columns'] },
        at: { type: 'integer', minimum: 1, description: 'the first row or column to remove' },
        count: { type: 'integer', minimum: 1, description: 'how many to remove (default 1)' },
      },
      required: ['table', 'what', 'at'],
    },
  },
  {
    name: 'delete_table',
    description:
      'Remove a whole table with what is in it, the tables inside its cells included. Use it only when the user asked for it. A table with a picture in a cell is not removed. The table numbers after it go down by one and more: call list_tables again before the next table call.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'integer', minimum: 1, description: 'the table number from list_tables' },
      },
      required: ['table'],
    },
  },
  {
    name: 'list_fields',
    description:
      'List the form fields (누름틀) of the document in document order: number, name, the guide text shown while empty, and the current value.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'fill_field',
    description:
      'Set the value of one form field, picked by its number from list_fields. The value is one line of text.',
    inputSchema: {
      type: 'object',
      properties: {
        field: { type: 'integer', minimum: 1, description: 'the field number from list_fields' },
        value: { type: 'string' },
      },
      required: ['field', 'value'],
    },
  },
  {
    name: 'insert_toc',
    description:
      'Add a table of contents: an optional title line, then a row per heading with its page number, next to the paragraph anchor occurs in (where after or before), or at the end of the document.',
    inputSchema: {
      type: 'object',
      properties: {
        anchor: { type: 'string', description: 'text of the paragraph it goes next to' },
        occurrence: { type: 'integer', minimum: 1 },
        where: { type: 'string', enum: ['after', 'before', 'end'] },
        title: { type: 'string', description: 'the title line, for example 차 례; empty for none' },
        entries: { type: 'array', items: TOC_ENTRY_SCHEMA, minItems: 1, maxItems: 100 },
      },
      required: ['where', 'entries'],
    },
  },
  {
    name: 'refresh_toc',
    description:
      'Write the page numbers of a table of contents again, after the document changed. Pass the text of its title line.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'the title line of the table of contents' },
        occurrence: { type: 'integer', minimum: 1 },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_notes',
    description:
      'List the footnotes and endnotes of the body in reading order: their number in this list (what edit_note and delete_note take), kind, the number the document shows, the words in front of the mark, and the text.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'insert_note',
    description:
      'Add a footnote or an endnote. Its mark goes right after the given body text, which must occur once (or pass occurrence); the document numbers it. Not inside table cells.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['footnote', 'endnote'] },
        after: { type: 'string', description: 'the body text the mark goes right after' },
        occurrence: {
          type: 'integer',
          minimum: 1,
          description: 'which occurrence of after, when it occurs more than once',
        },
        text: NOTE_TEXT_SCHEMA,
      },
      required: ['kind', 'after', 'text'],
    },
  },
  {
    name: 'edit_note',
    description: 'Replace the whole text of a note, picked by its number from list_notes.',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'integer', minimum: 1, description: 'the note number from list_notes' },
        text: NOTE_TEXT_SCHEMA,
      },
      required: ['note', 'text'],
    },
  },
  {
    name: 'delete_note',
    description:
      'Remove a note, its mark and its text, picked by its number from list_notes. Only when the user asks.',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'integer', minimum: 1, description: 'the note number from list_notes' },
      },
      required: ['note'],
    },
  },
]

const NO_NOTE_HELP = (count: number) =>
  count === 0
    ? 'This document has no footnotes or endnotes in its body text.'
    : `There is no such note: the body has ${count}. Call list_notes for the numbers.`

const NOT_FOUND_HELP =
  'Not found; nothing was changed. The text must match exactly (letters, spaces, punctuation) and lie inside one paragraph or one table cell. Read that part of the document again. The guide text of an empty form field is not document text: use fill_field for it.'
const IN_TABLE_HELP =
  'Nothing was changed: that paragraph is inside a table cell, and a table cannot be put inside another table here. Anchor the new table to a paragraph of the body text, or add the content to the cell as paragraphs.'
const HAS_OBJECTS_HELP =
  'Nothing was changed: a table, a picture or a form field sits in that paragraph, and the change would have moved or removed it. Use the paragraph before or after it as the anchor, or tell the user.'
const ONE_LINE_HELP =
  'Text with a line break cannot be searched or inserted: a replacement stays inside one paragraph or table cell. Split the change into one call per paragraph.'

const hasLineBreak = (text: string) => /[\r\n]/.test(text)

const NO_SELECTION_HELP =
  'Nothing is selected in the editor, so there is nothing for this tool to act on. Use the tools that find text, or ask the user to select the part they mean.'
const SELECTION_COUNT_HELP = (count: number) =>
  `Nothing was changed: the selected paragraphs are not one stretch of text (they are table cells, or separate places), so the selection cannot become more or fewer paragraphs. Pass exactly ${count} string(s), one for each listed paragraph, or use first to replace some of them.`
const SELECTION_CHANGED_HELP =
  'Nothing was changed: the selected text is no longer what it was when the request was sent (it was edited, or changed by an earlier call). Read the document again and use the tools that find text.'

/** A table in the list of tables, as the model reads it. */
function tableLine(table: AgentTableSummary): string {
  const where = table.inTable ? `, inside a cell of table ${table.inTable}` : ''
  const near = table.near ? `, after the line “${table.near}”` : ''
  const cells = table.preview.length > 0 ? `. Starts: ${table.preview.join(' | ')}` : '. No text.'
  return `Table ${table.table}: ${table.rows} row(s) × ${table.cols} column(s)${where}${near}${cells}`
}

/** A cell as the model reads it: its place, the places a merged cell spans, and its text. */
function cellLine(cell: AgentTableCell): string {
  const rowSpan = cell.rowSpan ?? 1
  const colSpan = cell.colSpan ?? 1
  const spans =
    rowSpan > 1 || colSpan > 1
      ? ` (merged up to ${cell.row + rowSpan - 1}.${cell.col + colSpan - 1})`
      : ''
  const field = cell.fields ? ` [form field ${cell.fields.map((n) => `#${n}`).join(', ')}]` : ''
  const object = cell.object ? ' [holds a picture or another object: not empty]' : ''
  const text =
    cell.text === '' ? (cell.object ? '(no text)' : '(empty)') : cell.text.replace(/\r?\n/g, ' ⏎ ')
  return `${cell.row}.${cell.col}${spans}${field}${object}: ${text}`
}

/** The cells a fill_cells call names, or null when it names none that can be read. */
function cellArgs(call: AgentToolCall): AgentCellText[] | null {
  const raw = call.input.cells
  if (!Array.isArray(raw) || raw.length === 0) return null
  const cells: AgentCellText[] = []
  for (const entry of raw) {
    const { row, col, text } = (entry ?? {}) as Record<string, unknown>
    if (typeof row !== 'number' || typeof col !== 'number' || typeof text !== 'string') return null
    cells.push({ row, col, text })
  }
  return cells
}

const isWhere = (value: unknown): value is AgentWhere =>
  value === 'after' || value === 'before' || value === 'end'

const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')

/** Text of a change as the panel lists it: one line, cut when long. */
function changeText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > CHANGE_TEXT_CHARS ? `${flat.slice(0, CHANGE_TEXT_CHARS)}…` : flat
}

const TOGGLE_LABELS = {
  bold: 'aiFmtBold',
  italic: 'aiFmtItalic',
  underline: 'aiFmtUnderline',
  strikethrough: 'aiFmtStrike',
} as const satisfies Record<string, LabelKey>

const ALIGN_LABELS = {
  left: 'aiFmtAlignLeft',
  center: 'aiFmtAlignCenter',
  right: 'aiFmtAlignRight',
  justify: 'aiFmtAlignJustify',
} as const satisfies Record<string, LabelKey>

/**
 * The format a call asks for: the properties the model actually sent. What they may hold
 * is checked by the editor, which answers a bad value with a message the model can act on.
 */
function formatArgs(call: AgentToolCall): AgentParagraphFormat {
  const format: Record<string, unknown> = {}
  for (const key of [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'size',
    'color',
    'highlight',
    'font',
    'align',
    'indent',
    'style',
  ]) {
    const value = call.input[key]
    if (value !== undefined && value !== null) format[key] = value
  }
  // the model's names, the editor's names
  for (const [from, to] of [
    ['line_spacing', 'lineSpacing'],
    ['margin_left', 'marginLeft'],
    ['margin_right', 'marginRight'],
    ['space_before', 'spacingBefore'],
    ['space_after', 'spacingAfter'],
    ['char_style', 'charStyle'],
  ] as const) {
    const value = call.input[from]
    if (value !== undefined && value !== null) format[to] = value
  }
  return format as AgentParagraphFormat
}

/** A format as the panel lists it: what was set, in the UI language. */
function describeFormat(
  format: AgentParagraphFormat,
  label: (key: LabelKey, params?: Params) => string,
): string {
  const parts: string[] = []
  if (format.align) parts.push(label(ALIGN_LABELS[format.align]))
  for (const key of Object.keys(TOGGLE_LABELS) as (keyof typeof TOGGLE_LABELS)[]) {
    if (format[key] === undefined) continue
    const name = label(TOGGLE_LABELS[key])
    parts.push(format[key] ? name : label('aiFmtOff', { name }))
  }
  if (format.size !== undefined) parts.push(`${format.size}pt`)
  if (format.color !== undefined) parts.push(`${label('aiFmtColor')} ${format.color}`)
  if (format.highlight !== undefined) {
    const name = label('aiFmtHighlight')
    parts.push(
      format.highlight === 'none' ? label('aiFmtOff', { name }) : `${name} ${format.highlight}`,
    )
  }
  if (format.lineSpacing !== undefined) {
    parts.push(`${label('aiFmtLineSpacing')} ${format.lineSpacing}%`)
  }
  if (format.font !== undefined) parts.push(`${label('aiFmtFont')} ${format.font}`)
  if (format.style !== undefined) parts.push(`${label('aiFmtStyle')} ${format.style}`)
  if (format.charStyle !== undefined) {
    parts.push(`${label('aiFmtCharStyle')} ${format.charStyle}`)
  }
  for (const [key, name] of [
    ['indent', 'aiFmtIndent'],
    ['marginLeft', 'aiFmtMarginLeft'],
    ['marginRight', 'aiFmtMarginRight'],
    ['spacingBefore', 'aiFmtSpaceBefore'],
    ['spacingAfter', 'aiFmtSpaceAfter'],
  ] as const) {
    if (format[key] !== undefined) parts.push(`${label(name)} ${format[key]}pt`)
  }
  return parts.join(' · ')
}

/** Why a paragraph edit did nothing, as the model reads it. */
function placeRefusal(result: AgentPlaceRefusal): string {
  switch (result.reason) {
    case 'ambiguous':
      return (
        `The text occurs ${result.count} times; nothing was changed. Pass occurrence to say which paragraph you mean.\n` +
        matchLines(result.matches ?? [], result.count)
      )
    case 'no_such_occurrence':
      return `occurrence must be between 1 and ${result.count}; nothing was changed.`
    case 'unsupported_place':
      return 'That text is inside an equation, which is not a paragraph that can be edited here.'
    case 'has_objects':
      return HAS_OBJECTS_HELP
    default:
      return NOT_FOUND_HELP
  }
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > LABEL_QUOTE_CHARS ? `${flat.slice(0, LABEL_QUOTE_CHARS)}…` : flat
}

function matchLine(match: AgentMatch): string {
  const place = match.inTable ? ' (in a table)' : ''
  if (match.replaceable === false) return `#${match.occurrence}${place}: inside an equation`
  return `#${match.occurrence}${place}: …${match.context ?? ''}…`
}

function matchLines(matches: AgentMatch[], count: number): string {
  const lines = matches.map(matchLine)
  if (count > matches.length) lines.push(`(only the first ${matches.length} are listed)`)
  return lines.join('\n')
}

/** Why rows or columns were not added or removed, as the model reads it. */
function linesRefusal(table: number, what: string, result: AgentTableLinesRefusal): string {
  switch (result.reason) {
    case 'no_such_table':
      return noSuchTable(table, result.count)
    case 'nested':
      return 'Nothing was changed: that table sits inside a cell of another table, and rows and columns can only be added to or removed from a table of the body text.'
    case 'no_such_line':
      return `Nothing was changed: the table has ${result.rows} row(s) and ${result.cols} column(s), so those ${what} are not all in it.`
    case 'would_empty':
      return `Nothing was changed: that would remove every one of the ${what}. A table keeps at least one row and one column.`
    case 'holds_object':
      return `Nothing was changed: these cells hold a picture or another object, which would be removed with them: ${result.cells.map((cell) => `${cell.row}.${cell.col}`).join(', ')}.`
    default:
      return HAS_OBJECTS_HELP
  }
}

/** The table, the kind of line, the place and the count of a row or column call. */
function linesArgs(
  call: AgentToolCall,
): { table: number; what: 'rows' | 'columns'; at: number; count: number } | null {
  const { table, what, at, count } = call.input
  if (typeof table !== 'number' || typeof at !== 'number') return null
  if (what !== 'rows' && what !== 'columns') return null
  if (count !== undefined && count !== null && typeof count !== 'number') return null
  return { table, what, at, count: typeof count === 'number' ? count : 1 }
}

const LINES_HELP =
  'table and at must be numbers (from list_tables and read_table), and what "rows" or "columns".'

function noSuchTable(table: number, count: number): string {
  return count === 0
    ? 'This document has no tables.'
    : `There is no table ${table}: the document has ${count}. Call list_tables for the numbers.`
}

/** A replacement as an activity label; it reads the same in every language. */
const arrow = (from: string, to: string) => `“${quote(from)}” → “${quote(to)}”`

const NO_FORMAT_HELP =
  'Name at least one property to change: bold, italic, underline, strikethrough, font, size, color, highlight, and for a paragraph align, line_spacing, indent, margin_left, margin_right, space_before, space_after or style.'

/** Table places as the model names them: row.col. */
const cellList = (cells: { row: number; col: number }[]): string =>
  cells.map((cell) => `${cell.row}.${cell.col}`).join(', ')

/** Why a call found no style by the name it was given, with the styles of that kind there are. */
function noSuchStyle(result: AgentNoSuchStyle): string {
  const kind = result.kind === 'any' ? '' : `${result.kind} `
  if (result.styles.length === 0) {
    return `Nothing was changed: the document has no ${kind}styles. Make one with create_style if the user wants one.`
  }
  return `Nothing was changed: the document has no ${kind}style by that name. Its ${kind}styles: ${result.styles.join(', ')}.`
}

const STYLE_EXISTS_HELP =
  'Nothing was changed: a style already has that name (or that English name). Use edit_style to change that style, or pick another name.'
const STYLE_STRINGS_HELP =
  'english_name, new_name, kind, based_on and next_style must be strings when given; kind is "paragraph" or "character".'

/** The optional string arguments `keys` of a style call, null for the absent ones; null when one is not a string. */
function styleStrings<K extends string>(
  call: AgentToolCall,
  keys: readonly K[],
): Record<K, string | null> | null {
  const out = {} as Record<K, string | null>
  for (const key of keys) {
    const value = call.input[key]
    if (value === undefined || value === null) out[key] = null
    else if (typeof value === 'string') out[key] = value
    else return null
  }
  return out
}

/** What a run of format calls says about paragraphs that kept their own look under a style. */
const keptOwnLookNote = (count: number | undefined): string =>
  count
    ? ` ${count === 1 ? 'The paragraph' : `${count} paragraphs`} took the style but kept the paragraph formatting ${count === 1 ? 'it' : 'they'} had set differently from ${count === 1 ? 'its' : 'their'} former style; the rest follows the style. Read the style with read_style and pass its properties if the user wants its plain look.`
    : ''
const WHERE_HELP =
  'where must be "after", "before" or "end"; with "after" and "before" an anchor text is needed.'

/** Where a paragraph edit goes, or null when the call does not say so. */
function placeArgs(
  call: AgentToolCall,
): { where: AgentWhere; anchor: string; occurrence: number | null } | null {
  const { where, occurrence } = call.input
  const anchor = textArg(call, 'anchor') ?? ''
  if (!isWhere(where)) return null
  if (where !== 'end' && (!anchor || hasLineBreak(anchor))) return null
  return { where, anchor, occurrence: typeof occurrence === 'number' ? occurrence : null }
}

/** The string argument `key`, or null when the model did not send one. */
function textArg(call: AgentToolCall, key: string): string | null {
  const value = call.input[key]
  return typeof value === 'string' ? value : null
}


export function createHwpSkill(deps: HwpSkillDeps): HwpSkill {
  const { bridge, label } = deps
  let context = ''
  /** the runs the user selected, as they stand now (a replacement moves them on) */
  let selection: AgentSegment[] | null = null
  let selectionInTable = false
  let selectionContiguous = false

  /** The selected paragraphs from number `from` (1-based) as numbered lines, up to `max` characters. */
  const selectionLines = (from: number, max: number): { lines: string[]; next: number } => {
    const lines: string[] = []
    let chars = 0
    let index = from - 1
    for (; selection && index < selection.length; index++) {
      const line = `${index + 1}. ${selection[index]!.text}`
      // always at least one, however long it is
      if (lines.length > 0 && chars + line.length > max) break
      lines.push(line)
      chars += line.length
    }
    return { lines, next: index + 1 }
  }

  const selectionContext = (): string => {
    if (!selection) return ''
    const where = selectionInTable ? ', inside a table' : ''
    const shape = selectionContiguous
      ? ''
      : ' They are not one stretch of text (table cells, or separate places).'
    const { lines, next } = selectionLines(1, SELECTION_CONTEXT_CHARS)
    return [
      '## Selected text',
      `The user selected ${selection.length} paragraph(s)${where} in the editor.${shape} The request is about this part:`,
      ...lines,
      ...(next <= selection.length
        ? [
            `[paragraphs ${next}–${selection.length} are not shown: read_selection with from ${next} returns them]`,
          ]
        : []),
    ].join('\n')
  }

  const bad = (call: AgentToolCall, output: string): ToolExecution => ({
    output,
    isError: true,
    // named by what the call was about, which the user recognizes; the tool name is the fallback
    summary: label('aiToolNotDone', {
      what: quote(
        textArg(call, 'find') ??
          textArg(call, 'text') ??
          textArg(call, 'anchor') ??
          textArg(call, 'name') ??
          (typeof call.input.field === 'number'
            ? `#${call.input.field}`
            : typeof call.input.table === 'number'
              ? label('aiTableName', { table: call.input.table })
              : call.name),
      ),
    }),
  })

  /** A note as the user knows it: "footnote 3", in the UI language. */
  const noteName = (kind: 'footnote' | 'endnote', number: number | null): string =>
    label(kind === 'endnote' ? 'aiNoteEndnote' : 'aiNoteFootnote', { number: number ?? '' }).trim()

  const run = async (call: AgentToolCall): Promise<ToolExecution> => {
    switch (call.name) {
      case 'read_document': {
        const text = await bridge.readText()
        const raw = call.input.offset
        const offset =
          typeof raw === 'number' && Number.isInteger(raw) && raw > 0
            ? Math.min(raw, text.length)
            : 0
        const end = Math.min(text.length, offset + READ_PAGE_CHARS)
        const more = end < text.length ? `\n[more: call read_document with offset ${end}]` : ''
        return {
          output: `Characters ${offset}–${end} of ${text.length}.\n${text.slice(offset, end)}${more}`,
          summary: label('aiToolRead'),
        }
      }
      case 'find_text': {
        const text = textArg(call, 'text')
        if (!text) return bad(call, 'text must be a non-empty string')
        if (hasLineBreak(text)) return bad(call, ONE_LINE_HELP)
        const found = await bridge.findText(text)
        return {
          output:
            found.count === 0
              ? 'No occurrence.'
              : `${found.count} occurrence(s).\n${matchLines(found.matches, found.count)}`,
          summary: label('aiToolFind', { text: quote(text), count: found.count }),
        }
      }
      case 'replace_text': {
        const find = textArg(call, 'find')
        const replace = textArg(call, 'replace')
        if (!find || replace === null) return bad(call, 'find and replace must be strings')
        if (hasLineBreak(find) || hasLineBreak(replace)) return bad(call, ONE_LINE_HELP)
        const occurrence = call.input.occurrence
        const result = await bridge.replaceText(
          find,
          replace,
          typeof occurrence === 'number' ? occurrence : null,
        )
        if (result.ok) {
          deps.onChange({
            kind: 'replace',
            from: find,
            to: replace,
            count: 1,
            place: result.place,
          })
          return {
            output: result.inTable ? 'Replaced (in a table cell).' : 'Replaced.',
            mutated: true,
            summary: arrow(find, replace),
          }
        }
        if (result.reason === 'ambiguous') {
          return bad(
            call,
            `The text occurs ${result.count} times; nothing was changed. Pass occurrence to pick one, or use replace_all.\n` +
              matchLines(result.matches ?? [], result.count),
          )
        }
        if (result.reason === 'no_such_occurrence') {
          return bad(call, `occurrence must be between 1 and ${result.count}; nothing was changed.`)
        }
        if (result.reason === 'unsupported_place') {
          return bad(call, 'That occurrence is inside an equation, which cannot be edited here.')
        }
        return bad(call, NOT_FOUND_HELP)
      }
      case 'replace_all': {
        const find = textArg(call, 'find')
        const replace = textArg(call, 'replace')
        if (!find || replace === null) return bad(call, 'find and replace must be strings')
        if (hasLineBreak(find) || hasLineBreak(replace)) return bad(call, ONE_LINE_HELP)
        const result = await bridge.replaceAllText(find, replace)
        if (!result.ok) return bad(call, NOT_FOUND_HELP)
        deps.onChange({
          kind: 'replaceAll',
          from: find,
          to: replace,
          count: result.count,
          place: result.place,
        })
        return {
          output: `Replaced ${result.count} occurrence(s).`,
          mutated: true,
          summary: `${arrow(find, replace)} ×${result.count}`,
        }
      }
      case 'insert_paragraphs': {
        const place = placeArgs(call)
        const paragraphs = call.input.paragraphs
        if (!place) return bad(call, WHERE_HELP)
        if (!isTextList(paragraphs))
          return bad(call, 'paragraphs must be a non-empty list of strings')
        if (paragraphs.some(hasLineBreak)) return bad(call, ONE_LINE_HELP)
        const result = await bridge.insertParagraphs(
          place.anchor,
          place.occurrence,
          place.where,
          paragraphs,
        )
        if (!result.ok) return bad(call, placeRefusal(result))
        deps.onChange({
          kind: 'insert',
          from: '',
          to: changeText(paragraphs.filter(Boolean).join(' ⏎ ')),
          count: 1,
          place: result.place,
        })
        return {
          output: `Added ${result.count} paragraph(s)${result.inTable ? ' in the table cell' : ''}.`,
          mutated: true,
          summary: label('aiToolInsert', { count: result.count }),
        }
      }
      case 'delete_paragraph': {
        const find = textArg(call, 'find')
        if (!find) return bad(call, 'find must be a non-empty string')
        if (hasLineBreak(find)) return bad(call, ONE_LINE_HELP)
        const occurrence = call.input.occurrence
        const result = await bridge.deleteParagraph(
          find,
          typeof occurrence === 'number' ? occurrence : null,
        )
        if (!result.ok) return bad(call, placeRefusal(result))
        deps.onChange({
          kind: 'delete',
          from: changeText(result.text),
          to: '',
          count: 1,
          place: result.place,
        })
        return {
          output: result.emptied
            ? 'The paragraph was emptied. It is the first paragraph of its cell or section, so its empty line stays.'
            : 'Removed the paragraph.',
          mutated: true,
          summary: label('aiToolDelete', { text: quote(result.text) }),
        }
      }
      case 'insert_table': {
        const place = placeArgs(call)
        const rows = call.input.rows
        if (!place) return bad(call, WHERE_HELP)
        if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isTextList)) {
          return bad(
            call,
            'rows must be a non-empty list of rows, each a non-empty list of strings',
          )
        }
        if (rows.some((row) => row.some(hasLineBreak))) return bad(call, ONE_LINE_HELP)
        const result = await bridge.insertTable(
          place.anchor,
          place.occurrence,
          place.where,
          rows,
          call.input.header === true,
        )
        if (!result.ok) {
          return bad(call, result.reason === 'in_table' ? IN_TABLE_HELP : placeRefusal(result))
        }
        deps.onChange({
          kind: 'table',
          from: '',
          to: changeText(rows[0]!.join(' | ')),
          count: 1,
          place: result.place,
        })
        return {
          output: `Added a table of ${result.rows} row(s) and ${result.cols} column(s).`,
          mutated: true,
          summary: label('aiToolTable', { rows: result.rows, cols: result.cols }),
        }
      }
      case 'format_text': {
        const find = textArg(call, 'find')
        if (!find) return bad(call, 'find must be a non-empty string')
        if (hasLineBreak(find)) return bad(call, ONE_LINE_HELP)
        const format = formatArgs(call)
        if (Object.keys(format).length === 0) return bad(call, NO_FORMAT_HELP)
        const occurrence = call.input.occurrence
        const result = await bridge.formatText(
          find,
          typeof occurrence === 'number' ? occurrence : null,
          call.input.all === true,
          format,
        )
        if (!result.ok) {
          if (result.reason === 'no_such_style') return bad(call, noSuchStyle(result))
          return bad(
            call,
            result.reason === 'ambiguous'
              ? `The text occurs ${result.count} times; nothing was changed. Pass occurrence to pick one, or all to format every one.\n` +
                  matchLines(result.matches ?? [], result.count)
              : placeRefusal(result),
          )
        }
        deps.onChange({
          kind: 'format',
          from: changeText(find),
          to: describeFormat(format, label),
          count: result.count,
          place: result.place,
        })
        return {
          output: `Formatted ${result.count} occurrence(s).`,
          mutated: true,
          summary: label('aiToolFormat', { text: quote(find) }),
        }
      }
      case 'format_paragraph': {
        const find = textArg(call, 'find')
        if (!find) return bad(call, 'find must be a non-empty string')
        if (hasLineBreak(find)) return bad(call, ONE_LINE_HELP)
        const format = formatArgs(call)
        if (Object.keys(format).length === 0) return bad(call, NO_FORMAT_HELP)
        const occurrence = call.input.occurrence
        const result = await bridge.formatParagraph(
          find,
          typeof occurrence === 'number' ? occurrence : null,
          format,
        )
        if (!result.ok) {
          if (result.reason === 'no_such_style') return bad(call, noSuchStyle(result))
          return bad(
            call,
            result.reason === 'unsupported_place'
              ? 'Nothing was changed: the paragraph properties and paragraph style of that paragraph cannot be set here (it is inside an equation, or in a table inside another table). Its character formatting, character styles included, can still be changed with format_text.'
              : placeRefusal(result),
          )
        }
        deps.onChange({
          kind: 'format',
          from: changeText(find),
          to: describeFormat(format, label),
          count: 1,
          place: result.place,
        })
        return {
          output: `Formatted the paragraph${result.inTable ? ' in the table cell' : ''}.${keptOwnLookNote(result.keptOwnLook)}`,
          mutated: true,
          summary: label('aiToolFormat', { text: quote(find) }),
        }
      }
      case 'read_selection': {
        if (!selection) return bad(call, NO_SELECTION_HELP)
        const raw = call.input.from
        const from = typeof raw === 'number' && Number.isInteger(raw) && raw > 1 ? raw : 1
        if (from > selection.length) {
          return bad(call, `The selection has ${selection.length} paragraph(s).`)
        }
        const { lines, next } = selectionLines(from, READ_PAGE_CHARS)
        const more =
          next <= selection.length ? `\n[more: call read_selection with from ${next}]` : ''
        return {
          output: `Paragraphs ${from}–${next - 1} of ${selection.length} selected.\n${lines.join('\n')}${more}`,
          summary: label('aiToolRead'),
        }
      }
      case 'replace_selection': {
        if (!selection) return bad(call, NO_SELECTION_HELP)
        const paragraphs = call.input.paragraphs
        if (!isTextList(paragraphs)) {
          return bad(call, 'paragraphs must be a non-empty list of strings')
        }
        if (paragraphs.some(hasLineBreak)) return bad(call, ONE_LINE_HELP)
        const rawFirst = call.input.first
        const part = typeof rawFirst === 'number'
        const first = part ? rawFirst : 1
        // a part is replaced one for one; the whole may change its number of paragraphs
        const target = part ? selection.slice(first - 1, first - 1 + paragraphs.length) : selection
        if (
          part &&
          (!Number.isInteger(first) || first < 1 || target.length !== paragraphs.length)
        ) {
          return bad(
            call,
            `Nothing was changed: the selection has ${selection.length} paragraph(s), so paragraphs ${first}–${first + paragraphs.length - 1} are not all in it.`,
          )
        }
        if (!part && paragraphs.length !== selection.length && !selectionContiguous) {
          return bad(call, SELECTION_COUNT_HELP(selection.length))
        }
        const before = target.map((segment) => segment.text).join(' ⏎ ')
        const result = await bridge.replaceSelection(target, paragraphs)
        if (!result.ok) {
          return bad(
            call,
            result.reason === 'changed'
              ? SELECTION_CHANGED_HELP
              : result.reason === 'count'
                ? SELECTION_COUNT_HELP(result.count)
                : HAS_OBJECTS_HELP,
          )
        }
        selection = part
          ? [
              ...selection.slice(0, first - 1),
              ...result.segments,
              ...selection.slice(first - 1 + paragraphs.length),
            ]
          : result.segments
        const after = paragraphs.join(' ⏎ ')
        deps.onChange({
          kind: 'replace',
          from: changeText(before),
          to: changeText(after),
          count: 1,
          place: result.place,
        })
        return {
          output:
            target.length === paragraphs.length
              ? `Replaced the selected text (${paragraphs.length} paragraph(s)).`
              : `Replaced the selected text: its ${target.length} paragraph(s) are now ${paragraphs.length}.`,
          mutated: true,
          summary: arrow(before, after),
        }
      }
      case 'format_selection': {
        if (!selection) return bad(call, NO_SELECTION_HELP)
        const format = formatArgs(call)
        if (Object.keys(format).length === 0) return bad(call, NO_FORMAT_HELP)
        const text = selection.map((segment) => segment.text).join(' ⏎ ')
        const result = await bridge.formatSelection(selection, format)
        if (!result.ok) {
          if (result.reason === 'no_such_style') return bad(call, noSuchStyle(result))
          return bad(
            call,
            result.reason === 'changed'
              ? SELECTION_CHANGED_HELP
              : result.reason === 'unsupported_place'
                ? 'Nothing was changed: the paragraph properties and paragraph style of those paragraphs cannot be set here (they are in a table inside another table). Their character formatting, character styles included, can still be changed.'
                : HAS_OBJECTS_HELP,
          )
        }
        deps.onChange({
          kind: 'format',
          from: changeText(text),
          to: describeFormat(format, label),
          count: result.count,
          place: result.place,
        })
        return {
          output: `Formatted the selected text (${result.count} paragraph(s)).${keptOwnLookNote(result.keptOwnLook)}`,
          mutated: true,
          summary: label('aiToolFormat', { text: quote(text) }),
        }
      }
      case 'list_tables': {
        const listed = await bridge.listTables()
        const lines = listed.tables.map(tableLine)
        if (listed.count > listed.tables.length) {
          lines.push(`(only the first ${listed.tables.length} of ${listed.count} are listed)`)
        }
        if (listed.partial) {
          lines.push('(the document is large: some tables inside table cells may not be listed)')
        }
        return {
          output: listed.count === 0 ? 'This document has no tables.' : lines.join('\n'),
          summary: label('aiToolTables', { count: listed.count }),
        }
      }
      case 'read_table': {
        const table = call.input.table
        if (typeof table !== 'number') return bad(call, 'table must be a number from list_tables')
        const fromRow = call.input.from_row
        const read = await bridge.readTable(table, typeof fromRow === 'number' ? fromRow : null)
        if (!read.ok) return bad(call, noSuchTable(table, read.count))
        const more = read.nextRow
          ? `\n[more rows: call read_table with from_row ${read.nextRow}]`
          : ''
        return {
          output:
            `Table ${read.table}: ${read.rows} row(s) × ${read.cols} column(s). Cells as row.col:\n` +
            read.cells.map(cellLine).join('\n') +
            more,
          summary: label('aiToolReadTable', { table }),
        }
      }
      case 'merge_cells': {
        const numbers = ['table', 'from_row', 'from_col', 'to_row', 'to_col'].map(
          (key) => call.input[key],
        )
        if (
          !numbers.every(
            (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1,
          )
        ) {
          return bad(
            call,
            'table, from_row, from_col, to_row and to_col must be whole numbers from 1',
          )
        }
        const [table, fromRow, fromCol, toRow, toCol] = numbers as number[]
        if (fromRow === toRow && fromCol === toCol) {
          return bad(call, 'from and to name the same cell: there is nothing to merge')
        }
        const result = await bridge.mergeCells(
          table!,
          { row: fromRow!, col: fromCol! },
          { row: toRow!, col: toCol! },
        )
        if (!result.ok) {
          switch (result.reason) {
            case 'no_such_table':
              return bad(call, noSuchTable(table!, result.count))
            case 'unsupported_place':
              return bad(
                call,
                'Nothing was changed: that table sits inside a cell of another table, whose cells cannot be merged here.',
              )
            case 'no_such_cell':
              return bad(
                call,
                `Nothing was changed: the table has ${result.rows} row(s) and ${result.cols} column(s). Read the table again.`,
              )
            case 'crosses_merged':
              return bad(
                call,
                `Nothing was changed: these merged cells lie partly inside the range: ${cellList(result.cells)}. Widen the range to take them whole, or leave them out.`,
              )
            default:
              return bad(
                call,
                `Nothing was changed: these cells have names a form fills them by, which merging would lose: ${cellList(result.cells)}.`,
              )
          }
        }
        const range = `${fromRow}.${fromCol}–${toRow}.${toCol}`
        deps.onChange({
          kind: 'lines',
          from: label('aiTableName', { table: table! }),
          to: label('aiCellsMerged', { range }),
          count: 1,
          place: result.place,
        })
        return {
          output: `Merged ${result.merged} cell(s) into one.`,
          mutated: true,
          summary: label('aiToolMergeCells', { table: table! }),
        }
      }
      case 'split_cell': {
        const table = call.input.table
        const row = call.input.row
        const col = call.input.col
        const whole = (value: unknown) =>
          typeof value === 'number' && Number.isInteger(value) && value >= 1
        if (!whole(table) || !whole(row) || !whole(col)) {
          return bad(call, 'table, row and col must be whole numbers from 1')
        }
        const rows = call.input.rows
        const cols = call.input.cols
        const optional = (value: unknown) => value === undefined || value === null || whole(value)
        if (!optional(rows) || !optional(cols)) return bad(call, 'rows and cols must be 1 to 10')
        const result = await bridge.splitCell(
          table as number,
          row as number,
          col as number,
          (rows as number | undefined) ?? null,
          (cols as number | undefined) ?? null,
        )
        if (!result.ok) {
          switch (result.reason) {
            case 'no_such_table':
              return bad(call, noSuchTable(table as number, result.count))
            case 'unsupported_place':
              return bad(
                call,
                'Nothing was changed: that table sits inside a cell of another table, whose cells cannot be split here.',
              )
            case 'no_such_cell':
              return bad(
                call,
                `Nothing was changed: the table has ${result.rows} row(s) and ${result.cols} column(s). Read the table again.`,
              )
            case 'holds_object':
              return bad(
                call,
                'Nothing was changed: that cell holds a picture or a table, which would stay in the first, smaller part and be cut off. Leave it whole.',
              )
            default:
              return bad(
                call,
                'Nothing was changed: that cell is not merged. Pass rows and cols to split it into more cells.',
              )
          }
        }
        const cell = `${row}.${col}`
        deps.onChange({
          kind: 'lines',
          from: label('aiTableName', { table: table as number }),
          to: result.unmerged
            ? label('aiCellUnmerged', { cell })
            : label('aiCellSplit', {
                cell,
                rows: (rows as number | undefined) ?? 1,
                cols: (cols as number | undefined) ?? 1,
              }),
          count: 1,
          place: result.place,
        })
        return {
          output: result.unmerged
            ? 'Split the merged cell back into the cells it covered; the text stays in the first.'
            : 'Split the cell; the text stays in the first of the new cells.',
          mutated: true,
          summary: label('aiToolSplitCell', { table: table as number }),
        }
      }
      case 'read_style': {
        const name = textArg(call, 'name')
        if (!name) return bad(call, 'name must be a style name')
        const result = await bridge.readStyle(name)
        if (!result.ok) return bad(call, noSuchStyle(result))
        const { ok: _ok, name: found, ...style } = result
        return {
          output: `Style "${found}": ${JSON.stringify(style)}`,
          summary: label('aiToolStyleRead', { name: quote(found) }),
        }
      }
      case 'create_style': {
        const name = textArg(call, 'name')
        if (!name) return bad(call, 'name must be the name of the new style')
        const strings = styleStrings(call, ['english_name', 'kind', 'based_on', 'next_style'])
        if (!strings) return bad(call, STYLE_STRINGS_HELP)
        const format = formatArgs(call)
        const result = await bridge.createStyle({
          name,
          englishName: strings.english_name,
          kind: strings.kind as AgentStyleKind | null,
          basedOn: strings.based_on,
          nextStyle: strings.next_style,
          format: Object.keys(format).length > 0 ? format : null,
        })
        if (!result.ok) {
          return bad(
            call,
            result.reason === 'style_exists' ? STYLE_EXISTS_HELP : noSuchStyle(result),
          )
        }
        deps.onChange({
          kind: 'format',
          from: `${label('aiFmtStyle')} ${result.name}`,
          to: [label('aiStyleNew'), describeFormat(format, label)].filter(Boolean).join(' · '),
          count: 1,
        })
        return {
          output: `Added the ${result.kind} style "${result.name}". It is not applied to anything yet: apply it with ${result.kind === 'character' ? 'format_text (char_style)' : 'format_paragraph (style)'}.`,
          mutated: true,
          summary: label('aiToolStyleCreate', { name: quote(result.name) }),
        }
      }
      case 'edit_style': {
        const name = textArg(call, 'name')
        if (!name) return bad(call, 'name must be the name of the style to change')
        const strings = styleStrings(call, ['new_name', 'english_name', 'next_style'])
        if (!strings) return bad(call, STYLE_STRINGS_HELP)
        const format = formatArgs(call)
        if (
          !strings.new_name &&
          !strings.english_name &&
          !strings.next_style &&
          Object.keys(format).length === 0
        ) {
          return bad(
            call,
            'Name at least one thing to change: new_name, english_name, next_style or a property of its look.',
          )
        }
        const result = await bridge.editStyle(name, {
          name: strings.new_name,
          englishName: strings.english_name,
          nextStyle: strings.next_style,
          format: Object.keys(format).length > 0 ? format : null,
        })
        if (!result.ok) {
          return bad(
            call,
            result.reason === 'style_exists' ? STYLE_EXISTS_HELP : noSuchStyle(result),
          )
        }
        const changed = [
          strings.new_name ? `${label('aiStyleRename')} ${strings.new_name}` : '',
          strings.next_style ? `${label('aiFmtNextStyle')} ${strings.next_style}` : '',
          describeFormat(format, label),
        ]
        deps.onChange({
          kind: 'format',
          from: `${label('aiFmtStyle')} ${name}`,
          to: changed.filter(Boolean).join(' · ') || (strings.english_name ?? ''),
          count: 1,
        })
        const reach =
          result.kind === 'character'
            ? ' Text this style was applied to changed with it.'
            : ' Every paragraph that uses it changed with it, in tables, text boxes, headers, footers and notes too; what a paragraph had set differently from the style stayed.'
        return {
          output: `Changed the ${result.kind} style "${result.name}".${Object.keys(format).length > 0 ? reach : ''}`,
          mutated: true,
          summary: label('aiToolStyleEdit', { name: quote(result.name) }),
        }
      }
      case 'format_cells': {
        const table = call.input.table
        if (typeof table !== 'number' || !Number.isInteger(table) || table < 1) {
          return bad(call, 'table must be a table number from list_tables')
        }
        const cells = call.input.cells
        if (!Array.isArray(cells) || cells.length === 0) {
          return bad(call, 'cells must list at least one {row, col}')
        }
        const background = call.input.background
        if (typeof background !== 'string') {
          return bad(call, 'background must be a colour as #RRGGBB, or "none"')
        }
        const result = await bridge.formatCells(
          table,
          cells as { row: number; col: number }[],
          background,
        )
        if (!result.ok) {
          if (result.reason === 'no_such_table') return bad(call, noSuchTable(table, result.count))
          if (result.reason === 'unsupported_place') {
            return bad(
              call,
              'Nothing was changed: that table sits inside a cell of another table, whose cells cannot be coloured here.',
            )
          }
          const places = result.cells.map((cell) => `${cell.row}.${cell.col}`).join(', ')
          return bad(
            call,
            `Nothing was changed: the table has ${result.rows} row(s) and ${result.cols} column(s), and these places are not in it: ${places}. Read the table again.`,
          )
        }
        const name = label('aiFmtCellFill')
        deps.onChange({
          kind: 'format',
          from: label('aiTableName', { table }),
          to: background === 'none' ? label('aiFmtOff', { name }) : `${name} ${background}`,
          count: result.count,
          place: result.place,
        })
        return {
          output: `Coloured ${result.count} cell(s).`,
          mutated: true,
          summary: label('aiToolCellFill', { table, count: result.count }),
        }
      }
      case 'fill_cells': {
        const table = call.input.table
        const cells = cellArgs(call)
        if (typeof table !== 'number') return bad(call, 'table must be a number from list_tables')
        if (!cells) {
          return bad(
            call,
            'cells must be a non-empty list of { row, col, text } with whole numbers',
          )
        }
        const result = await bridge.fillCells(table, cells, call.input.overwrite === true)
        if (result.ok) {
          deps.onChange({
            kind: 'cells',
            from: label('aiTableName', { table }),
            to: changeText(cells.map((cell) => cell.text).join(' | ')),
            count: result.count,
            place: result.place,
          })
          return {
            output: `Filled ${result.count} cell(s) of table ${table}.`,
            mutated: true,
            summary: label('aiToolFillCells', { table, count: result.count }),
          }
        }
        if (result.reason === 'no_such_table') return bad(call, noSuchTable(table, result.count))
        if (result.reason === 'has_objects') {
          return bad(
            call,
            'Nothing was changed: one of those cells holds a table or a picture, which writing over the cell would remove.',
          )
        }
        const places = result.cells.map((cell) => `${cell.row}.${cell.col}`).join(', ')
        if (result.reason === 'no_such_cell') {
          return bad(
            call,
            `Nothing was changed: the table has ${result.rows} row(s) and ${result.cols} column(s), and these places are not in it: ${places}. Read the table again.`,
          )
        }
        if (result.reason === 'holds_object') {
          return bad(
            call,
            `Nothing was changed: these cells hold a picture or another object, so they are not empty and text would land on top of it: ${places}. Leave them out.`,
          )
        }
        if (result.reason === 'has_fields') {
          return bad(
            call,
            `Nothing was changed: these cells hold several form fields each: ${places}. Fill them one by one with fill_field (list_fields shows the numbers).`,
          )
        }
        return bad(
          call,
          'Nothing was changed: these cells already hold text. Leave them out, or pass overwrite when the user asked to replace what is there.\n' +
            result.cells.map((cell) => `${cell.row}.${cell.col}: ${cell.text ?? ''}`).join('\n'),
        )
      }
      case 'add_to_table': {
        const args = linesArgs(call)
        const where = call.input.where ?? 'after'
        if (!args || (where !== 'after' && where !== 'before')) return bad(call, LINES_HELP)
        const result = await bridge.addTableLines(args.table, args.what, args.at, where, args.count)
        if (!result.ok) return bad(call, linesRefusal(args.table, args.what, result))
        const what = label(args.what === 'rows' ? 'aiTableRowsAdded' : 'aiTableColsAdded', {
          count: result.count,
        })
        const name = label('aiTableName', { table: args.table })
        deps.onChange({
          kind: 'lines',
          from: name,
          to: what,
          count: result.count,
          place: result.place,
        })
        const last = result.first + result.count - 1
        return {
          output: `Added ${result.count} of the ${args.what}: number ${result.first}${last > result.first ? ` to ${last}` : ''}, empty. Table ${args.table} now has ${result.rows} row(s) and ${result.cols} column(s).`,
          mutated: true,
          summary: `${name} · ${what}`,
        }
      }
      case 'remove_from_table': {
        const args = linesArgs(call)
        if (!args) return bad(call, LINES_HELP)
        const result = await bridge.removeTableLines(args.table, args.what, args.at, args.count)
        if (!result.ok) return bad(call, linesRefusal(args.table, args.what, result))
        const what = label(args.what === 'rows' ? 'aiTableRowsRemoved' : 'aiTableColsRemoved', {
          count: result.count,
        })
        const name = label('aiTableName', { table: args.table })
        deps.onChange({
          kind: 'lines',
          from: name,
          to: result.text ? `${what} · ${changeText(result.text)}` : what,
          count: result.count,
          place: result.place,
        })
        return {
          output: `Removed ${result.count} of the ${args.what}. Table ${args.table} now has ${result.rows} row(s) and ${result.cols} column(s).`,
          mutated: true,
          summary: `${name} · ${what}`,
        }
      }
      case 'delete_table': {
        const table = call.input.table
        if (typeof table !== 'number') return bad(call, 'table must be a number from list_tables')
        const result = await bridge.deleteTable(table)
        if (!result.ok) {
          if (result.reason === 'no_such_table') return bad(call, noSuchTable(table, result.count))
          if (result.reason === 'holds_object') {
            return bad(
              call,
              `Nothing was changed: these cells hold a picture or another object, which would be removed with the table: ${result.cells.map((cell) => `${cell.row}.${cell.col}`).join(', ')}.`,
            )
          }
          return bad(
            call,
            'Nothing was changed: removing the table would also have removed something that is not part of it, such as a picture or a form field. Tell the user.',
          )
        }
        const name = label('aiTableName', { table })
        const what = label('aiTableRemoved')
        deps.onChange({
          kind: 'lines',
          from: name,
          to: result.text ? `${what} · ${changeText(result.text)}` : what,
          count: 1,
          place: result.place,
        })
        const inner = result.inner > 0 ? `, with the ${result.inner} table(s) inside its cells` : ''
        return {
          output: `Removed table ${table} (${result.rows} row(s) × ${result.cols} column(s))${inner}. The tables after it are numbered anew: call list_tables before the next table call.`,
          mutated: true,
          summary: `${name} · ${what}`,
        }
      }
      case 'list_fields': {
        const fields = await bridge.listFields()
        return {
          output:
            fields.length === 0
              ? 'This document has no form fields.'
              : JSON.stringify(fields, null, 1),
          summary: label('aiToolFields', { count: fields.length }),
        }
      }
      case 'fill_field': {
        const field = call.input.field
        const value = textArg(call, 'value')
        if (typeof field !== 'number' || value === null) {
          return bad(call, 'field must be a number from list_fields and value a string')
        }
        if (hasLineBreak(value)) return bad(call, ONE_LINE_HELP)
        const result = await bridge.fillField(field, value)
        if (!result.ok) {
          return bad(
            call,
            result.count === 0
              ? 'This document has no form fields.'
              : `There is no field ${field}: the document has ${result.count}. Call list_fields for the numbers.`,
          )
        }
        // by number first: names repeat, and a field nobody named has none
        const name = [`#${field}`, result.name.trim()].filter(Boolean).join(' ')
        deps.onChange({ kind: 'field', from: name, to: value, count: 1, place: result.place })
        return {
          output: 'Filled.',
          mutated: true,
          summary: label('aiToolFill', { name: quote(name) }),
        }
      }
      case 'insert_toc': {
        const place = placeArgs(call)
        const entries = call.input.entries
        const title = textArg(call, 'title')
        if (!place) return bad(call, WHERE_HELP)
        if (
          !Array.isArray(entries) ||
          entries.length === 0 ||
          !entries.every(
            (entry) =>
              entry !== null &&
              typeof entry === 'object' &&
              typeof (entry as { find?: unknown }).find === 'string' &&
              typeof (entry as { level?: unknown }).level === 'number',
          )
        ) {
          return bad(call, 'entries must be a list of { find, level } for the headings')
        }
        if (title !== null && hasLineBreak(title)) return bad(call, ONE_LINE_HELP)
        const list = entries as AgentTocEntry[]
        if (list.some((entry) => hasLineBreak(entry.find))) return bad(call, ONE_LINE_HELP)
        const result = await bridge.insertToc(
          place.anchor,
          place.occurrence,
          place.where,
          title,
          list.map((entry) => ({
            find: entry.find,
            level: entry.level,
            ...(typeof entry.occurrence === 'number' ? { occurrence: entry.occurrence } : {}),
          })),
        )
        if (!result.ok) {
          if (result.reason === 'in_table') return bad(call, IN_TABLE_HELP)
          if (result.reason === 'no_heading') {
            const why =
              result.why === 'ambiguous'
                ? `it occurs ${result.count} times; pass occurrence for that entry.\n${matchLines(result.matches ?? [], result.count)}`
                : result.why === 'unsupported_place'
                  ? 'it is inside a table cell or an equation, which is not a heading of the body.'
                  : result.why === 'no_such_occurrence'
                    ? `occurrence must be between 1 and ${result.count}.`
                    : 'it is not in the document. Copy the heading text exactly from what you read.'
            return bad(
              call,
              `Nothing was changed: the heading "${result.heading}" could not be used: ${why}`,
            )
          }
          return bad(call, placeRefusal(result))
        }
        const name = title?.trim() || label('aiTocName')
        deps.onChange({
          kind: 'table',
          from: '',
          to: changeText(`${name} (${result.count})`),
          count: 1,
          place: result.place,
        })
        return {
          output: `Added a table of contents of ${result.count} heading(s), on pages ${result.pages.join(', ')}.`,
          mutated: true,
          summary: label('aiToolToc', { count: result.count }),
        }
      }
      case 'refresh_toc': {
        const title = textArg(call, 'title')
        if (!title)
          return bad(call, 'title must be the text of the title line of the table of contents')
        if (hasLineBreak(title)) return bad(call, ONE_LINE_HELP)
        const occurrence = call.input.occurrence
        const result = await bridge.refreshToc(
          title,
          typeof occurrence === 'number' ? occurrence : null,
        )
        if (!result.ok) {
          if (result.reason === 'no_toc') {
            return bad(
              call,
              'Nothing was changed: no table of contents follows that line. Pass the title line of a table of contents made with insert_toc.',
            )
          }
          if (result.reason === 'in_table') return bad(call, IN_TABLE_HELP)
          return bad(call, placeRefusal(result))
        }
        if (result.changed > 0) {
          deps.onChange({
            kind: 'cells',
            from: title,
            to: label('aiTocPagesChanged', { count: result.changed }),
            count: result.changed,
            place: result.place,
          })
        }
        const missing =
          result.missing && result.missing.length > 0
            ? ` These headings are no longer in the document, so their rows were left alone: ${result.missing.join(' / ')}.`
            : ''
        return {
          output: `${result.changed} of ${result.lines} page number(s) changed.${missing}`,
          mutated: result.changed > 0,
          summary: label('aiToolTocRefresh', { count: result.changed }),
        }
      }
      case 'list_notes': {
        const listed = await bridge.listNotes()
        const elsewhere =
          listed.elsewhere > 0
            ? `\n${listed.elsewhere} more note(s) sit inside table cells or text boxes, which these tools cannot reach.`
            : ''
        return {
          output:
            listed.count === 0
              ? `This document has no footnotes or endnotes in its body text.${elsewhere}`
              : `${JSON.stringify(listed.notes, null, 1)}${listed.count > listed.notes.length ? `\n[${listed.count - listed.notes.length} more not listed]` : ''}${elsewhere}`,
          summary: label('aiToolNotes', { count: listed.count }),
        }
      }
      case 'insert_note': {
        const kind = call.input.kind
        const after = textArg(call, 'after')
        const text = textArg(call, 'text')
        if ((kind !== 'footnote' && kind !== 'endnote') || !after || !text?.trim()) {
          return bad(call, 'kind must be footnote or endnote, and after and text non-empty strings')
        }
        if (hasLineBreak(after)) return bad(call, ONE_LINE_HELP)
        const occurrence = call.input.occurrence
        const result = await bridge.insertNote(
          kind,
          after,
          typeof occurrence === 'number' ? occurrence : null,
          text.replace(/\r\n?/g, '\n'),
        )
        if (!result.ok) {
          return bad(
            call,
            result.reason === 'unsupported_place'
              ? 'Nothing was changed: that text is inside a table cell or an equation, where a note cannot go here. Put the mark after words of the body text, or tell the user.'
              : placeRefusal(result),
          )
        }
        const name = noteName(result.kind, result.number)
        deps.onChange({
          kind: 'note',
          from: name,
          to: changeText(text),
          count: 1,
          place: result.place,
        })
        return {
          output: `Added ${result.kind} ${result.number ?? ''} after the text.`.replace('  ', ' '),
          mutated: true,
          summary: label('aiToolAddNote', { note: name }),
        }
      }
      case 'edit_note': {
        const note = call.input.note
        const text = textArg(call, 'text')
        if (typeof note !== 'number' || !text?.trim()) {
          return bad(call, 'note must be a number from list_notes and text a non-empty string')
        }
        const result = await bridge.editNote(note, text.replace(/\r\n?/g, '\n'))
        if (!result.ok) {
          return bad(
            call,
            result.reason === 'has_objects'
              ? 'Nothing was changed: that note holds an equation or a picture besides text, which would be lost.'
              : NO_NOTE_HELP(result.count),
          )
        }
        const name = noteName(result.kind, result.number)
        deps.onChange({
          kind: 'note',
          from: name,
          to: changeText(text),
          count: 1,
          place: result.place,
        })
        return {
          output: 'Rewrote the note.',
          mutated: true,
          summary: label('aiToolEditNote', { note: name }),
        }
      }
      case 'delete_note': {
        const note = call.input.note
        if (typeof note !== 'number') return bad(call, 'note must be a number from list_notes')
        const result = await bridge.deleteNote(note)
        if (!result.ok) return bad(call, NO_NOTE_HELP(result.count))
        const name = noteName(result.kind, result.number)
        deps.onChange({
          kind: 'delete',
          from: changeText(`${name}: ${result.text}`),
          to: '',
          count: 1,
          place: result.place,
        })
        return {
          output: 'Removed the note. The notes after it are renumbered by the document.',
          mutated: true,
          summary: label('aiToolDeleteNote', { note: name }),
        }
      }
      default:
        return bad(call, `unknown tool: ${call.name}`)
    }
  }

  return {
    skill: {
      id: 'hwp',
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      buildContext: () => [context, selectionContext()].filter(Boolean).join('\n\n'),
      executeTool: async (call) => {
        try {
          return await run(call)
        } catch (error) {
          // the editor refused or is gone: the model gets the cause and can say so
          return bad(call, error instanceof Error ? error.message : String(error))
        }
      },
    },
    setSelection: (scope) => {
      selection = scope && scope.segments.length > 0 ? scope.segments : null
      selectionInTable = scope?.inTable === true
      selectionContiguous = scope?.contiguous === true
    },
    refreshContext: async () => {
      try {
        const [text, fields, tables, notes, styles] = await Promise.all([
          bridge.readText(),
          bridge.listFields(),
          bridge.listTables(),
          // the notes are a line of the context; the document is still worth sending without it
          bridge.listNotes().catch(() => null),
          bridge.listStyles().catch(() => null),
        ])
        const footnotes = notes?.notes.filter((note) => note.kind === 'footnote').length ?? 0
        // numbered: the number is what fill_field takes, and names repeat
        const names = fields
          .slice(0, CONTEXT_MAX_FIELDS)
          .map((field) => `${field.field}. ${field.name || field.guide || '(unnamed)'}`)
        const whole = text.length <= CONTEXT_MAX_CHARS
        context = [
          '## Open document',
          `Length: ${text.length} characters.`,
          fields.length === 0
            ? 'Form fields: none.'
            : `Form fields (${fields.length}): ${names.join(', ')}${fields.length > names.length ? ', …' : ''}`,
          tables.count === 0
            ? 'Tables: none.'
            : `Tables: ${tables.count} (list_tables lists them; the text below shows their words but not their empty cells).`,
          notes === null
            ? 'Footnotes and endnotes: could not be listed (list_notes may still work).'
            : notes.count === 0
              ? 'Footnotes and endnotes: none.'
              : `Footnotes and endnotes: ${footnotes} footnote(s), ${notes.count - footnotes} endnote(s) (list_notes shows them; the text below does not).`,
          ...(styles
            ? (
                [
                  ['Paragraph styles', styles.paragraph],
                  ['Character styles', styles.character],
                ] as const
              )
                .filter(([, names]) => names.length > 0)
                .map(
                  ([title, names]) =>
                    `${title}: ${names.slice(0, CONTEXT_MAX_STYLES).join(', ')}${names.length > CONTEXT_MAX_STYLES ? ', …' : ''}`,
                )
            : []),
          whole
            ? 'Text (complete):'
            : `Text (the first ${CONTEXT_MAX_CHARS} characters; read_document returns the rest):`,
          whole ? text : text.slice(0, CONTEXT_MAX_CHARS),
        ].join('\n')
      } catch {
        // without a readable document the model is told so and can still answer
        context = '## Open document\nThe document could not be read right now.'
      }
    },
  }
}
