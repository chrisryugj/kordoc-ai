// 이음오피스(IeumOffice, https://github.com/pblsketch/openoffice, Apache-2.0, Copyright 2026 Mainfunc, Inc.)의
// apps/hwp/studio-plugin/hancom-keys.mjs(커밋 63e2a636)에서 옮겼다. 바꾼 것: 명령 이름(ieum → kordoc), 모듈 이름,
// 앱이 Alt+V 를 가로채지 않으니 Alt+V,T 단축키 글자를 지우지 않는다(LABELS_GONE_OFF_MAC 빔).
/**
 * Hancom Hangul's default keys in the rhwp-studio editor (decision 0060).
 *
 * rhwp moved some of Hangul's keys away from ones a web browser keeps for itself (the Ctrl+N
 * sequences to Ctrl+M, the Ctrl+Shift+C/R/T alignments to Alt+Shift+C/H/D) and left others
 * out. The app is not a browser tab, so a Hangul tab takes Hangul's keys as Hancom Hangul 2024
 * has them: the sequences under Ctrl+N, K, Q, M and G, the alignments, Ctrl+Y for deleting a
 * line, Ctrl+1..0 for the document's first ten styles, Ctrl+F10 and Ctrl+H, the Alt+Shift character
 * keys, and in a table the easy formulas. The commands rhwp has no counterpart for (deleting a
 * line, the text colours, the styles, the normal shape, today's date, finding backwards, the easy
 * formulas and page numbering) are here too.
 *
 * Bundled into the studio build like the agent plugin (build-studio.mjs aliases it), and called
 * from the studio's own key handling by the studio-hancom-* patches in scripts/rhwp-patches.mjs.
 * It imports nothing from the studio; what it uses of the studio's insides is listed there
 * (hancomHooks), and a release that renames one fails the build.
 */

export const HANCOM_KEYS_MODULE = '@/kordoc-hancom-keys.mjs'

/**
 * Sequential shortcuts: hold Ctrl, press the first letter, then press the second letter (with or
 * without Ctrl). A list tries its commands in order and runs the first one that can run, the way
 * Hangul's "고치기" (Ctrl+N,K) opens what the caret is on.
 */
export const CHORDS = {
  n: {
    t: 'table:create',
    n: 'insert:footnote',
    e: 'insert:endnote',
    h: 'page:header-create',
    i: 'insert:image',
    b: 'insert:textbox',
    m: 'insert:equation',
    c: ['insert:caption-toggle', 'table:caption-toggle'],
    s: 'page:hide',
    g: 'page:section-settings',
    a: 'table:split',
    z: 'table:attach',
    f: 'table:formula',
    k: ['field:edit', 'format:object-properties', 'table:cell-props'],
    p: 'kordoc:page-number',
  },
  k: {
    h: 'insert:hyperlink',
    b: 'insert:bookmark',
    n: 'format:para-num-shape',
    e: 'insert:field',
    d: 'kordoc:insert-date',
  },
  q: {
    f: 'edit:find',
    a: 'edit:find-replace',
    l: 'kordoc:find-backward',
  },
  // Hangul's Ctrl+M sequences colour the text
  m: {
    k: 'kordoc:text-color-k',
    r: 'kordoc:text-color-r',
    b: 'kordoc:text-color-b',
    d: 'kordoc:text-color-d',
    g: 'kordoc:text-color-g',
    y: 'kordoc:text-color-y',
    c: 'kordoc:text-color-c',
    w: 'kordoc:text-color-w',
  },
  g: {
    c: 'view:ctrl-mark',
    t: 'view:para-mark',
    p: 'view:zoom-fit-page',
    w: 'view:zoom-fit-width',
    q: 'view:zoom-100',
  },
}

/**
 * Chords Cmd starts on a Mac as well, as rhwp's own did. Ctrl+Q stays Ctrl alone: Cmd+Q quits.
 */
const META_CHORDS = new Set(['n', 'k', 'm', 'g'])

/** The colours of Hangul's Ctrl+M sequences, read from Hancom Hangul 2024. */
export const TEXT_COLORS = {
  k: { color: '#000000', ko: '검정 글자색', en: 'Black Text' },
  r: { color: '#FF0000', ko: '빨강 글자색', en: 'Red Text' },
  b: { color: '#0000FF', ko: '파랑 글자색', en: 'Blue Text' },
  d: { color: '#993366', ko: '자주 글자색', en: 'Plum Text' },
  g: { color: '#008000', ko: '초록 글자색', en: 'Green Text' },
  y: { color: '#FFFF00', ko: '노랑 글자색', en: 'Yellow Text' },
  c: { color: '#008080', ko: '청록 글자색', en: 'Teal Text' },
  w: { color: '#FFFFFF', ko: '흰색 글자색', en: 'White Text' },
}

/** Number of styles Ctrl+1..0 reach: the document's first ten, in their order. */
export const STYLE_KEYS = 10

const digitOf = (n) => String(n % 10)

/**
 * The studio's entries Hangul gives another meaning, or that only stood in for a key a browser
 * keeps. Each is found by its key and command; adaptToHancom drops them.
 */
export const REMOVED_SHORTCUTS = [
  // Hangul's Ctrl+Y deletes the line; redo stays on Ctrl+Shift+Z, as in Hangul
  [{ key: 'y', ctrl: true }, 'edit:redo'],
  // stand-ins for Ctrl+Shift+R/C/T; Hangul's Alt+Shift+C is "normal shape", Alt+Shift+H a macro
  [{ key: 'h', alt: true, shift: true }, 'format:align-right'],
  [{ key: 'ㅗ', alt: true, shift: true }, 'format:align-right'],
  [{ key: 'c', alt: true, shift: true }, 'format:align-center'],
  [{ key: 'ㅊ', alt: true, shift: true }, 'format:align-center'],
  [{ key: 'd', alt: true, shift: true }, 'format:align-distribute'],
  [{ key: 'ㅇ', alt: true, shift: true }, 'format:align-distribute'],
  // Hangul's Ctrl+0 is the tenth style; 100% stays on Ctrl+G,Q, as in Hangul
  [{ key: '0', ctrl: true }, 'view:zoom-100'],
]

/** Hangul's keys the studio lacks, ahead of its own so they win a tie. */
export const ADDED_SHORTCUTS = [
  [{ key: 'y', code: 'KeyY', ctrl: true }, 'kordoc:delete-line'],
  [{ key: 'c', code: 'KeyC', ctrl: true, shift: true }, 'format:align-center'],
  [{ key: 'r', code: 'KeyR', ctrl: true, shift: true }, 'format:align-right'],
  [{ key: 't', code: 'KeyT', ctrl: true, shift: true }, 'format:align-distribute'],
  [{ key: 'f10', ctrl: true }, 'insert:symbols'],
  [{ key: 'insert', code: 'Insert', alt: true }, 'table:insert-row-col'],
  // the character keys of a selection (Hangul: 보통 모양, 위 첨자, 아래 첨자, 진하게, 기울임, 밑줄)
  [{ key: 'c', code: 'KeyC', alt: true, shift: true }, 'kordoc:normal-shape'],
  [{ key: 'p', code: 'KeyP', alt: true, shift: true }, 'format:superscript'],
  [{ key: 's', code: 'KeyS', alt: true, shift: true }, 'format:subscript'],
  [{ key: 'b', code: 'KeyB', alt: true, shift: true }, 'format:bold'],
  [{ key: 'i', code: 'KeyI', alt: true, shift: true }, 'format:italic'],
  [{ key: 'u', code: 'KeyU', alt: true, shift: true }, 'format:underline'],
  // as in the app's other editors; on a Mac, Cmd+H (hide) never reaches the page
  [{ key: 'h', code: 'KeyH', ctrl: true }, 'edit:find-replace'],
  ...Array.from({ length: STYLE_KEYS }, (_, i) => [
    { key: digitOf(i + 1), code: `Digit${digitOf(i + 1)}`, ctrl: true },
    `kordoc:style-${i + 1}`,
  ]),
  ...Array.from({ length: STYLE_KEYS }, (_, i) => [
    { key: digitOf(i + 1), code: `Digit${digitOf(i + 1)}`, ctrl: true, alt: true },
    `kordoc:style-${i + 1}`,
  ]),
]

const sameDef = (a, b) =>
  a.key === b.key &&
  (a.code ?? null) === (b.code ?? null) &&
  !!a.ctrl === !!b.ctrl &&
  !!a.shift === !!b.shift &&
  !!a.alt === !!b.alt &&
  (a.platform ?? null) === (b.platform ?? null)

/** Turns the studio's shortcut table (in place: the studio holds the one array) into Hangul's. */
export function adaptToHancom(shortcuts) {
  for (const [def, id] of REMOVED_SHORTCUTS) {
    const at = shortcuts.findIndex(([d, c]) => c === id && sameDef(d, def))
    if (at !== -1) shortcuts.splice(at, 1)
  }
  shortcuts.unshift(...ADDED_SHORTCUTS)
  return shortcuts
}

/** The menu labels that follow the keys; the studio shows these next to its menu items. */
export const LABELS = {
  'format:align-center': 'Ctrl+Shift+C',
  'format:align-right': 'Ctrl+Shift+R',
  'format:align-distribute': 'Ctrl+Shift+T',
  'insert:symbols': 'Ctrl+F10',
  'table:create': 'Ctrl+N,T',
  'insert:footnote': 'Ctrl+N,N',
  'insert:endnote': 'Ctrl+N,E',
  'page:header-create': 'Ctrl+N,H',
  'insert:image': 'Ctrl+N,I',
  'insert:textbox': 'Ctrl+N,B',
  'insert:equation': 'Ctrl+N,M',
  'insert:caption-toggle': 'Ctrl+N,C',
  'table:caption-toggle': 'Ctrl+N,C',
  'page:hide': 'Ctrl+N,S',
  'page:section-settings': 'Ctrl+N,G',
  'table:split': 'Ctrl+N,A',
  'table:attach': 'Ctrl+N,Z',
  'table:formula': 'Ctrl+N,F',
  'field:edit': 'Ctrl+N,K',
  'insert:hyperlink': 'Ctrl+K,H',
  'insert:field': 'Ctrl+K,E',
}

/**
 * Labels for keys the app takes before the editor outside a Mac: Alt+V is Hangul's "save as"
 * there (the main process takes it), so rhwp's Alt+V,T for transparent lines no longer starts.
 */
export const LABELS_GONE_OFF_MAC = []

const onMac = () => /Mac/.test(globalThis.navigator?.platform ?? '')

/** The command definition with Hangul's key next to it, when its key changed. */
export function withHancomLabel(def, mac = onMac()) {
  if (!mac && LABELS_GONE_OFF_MAC.includes(def.id) && def.shortcutLabel) {
    return { ...def, shortcutLabel: undefined }
  }
  const label = LABELS[def.id]
  return label && def.shortcutLabel !== label ? { ...def, shortcutLabel: label } : def
}

/**
 * The keys the main process takes before the editor and hands back when the caret says they are
 * Hangul's table keys (decision 0060): Ctrl+Shift+S in a cell block is the block sum (elsewhere
 * "save as"), Ctrl+Shift+H in a table cell is the horizontal sum (elsewhere "home"). The main
 * process calls `window.__kordocHancomKey(name)` in the editor frame; true means it was done here.
 */
export const MAIN_PROCESS_KEYS = {
  'ctrl-shift-s': (ih, dispatcher) =>
    !!ih?.cursor?.isInCellSelectionMode?.() && dispatcher.isEnabled('table:block-sum')
      ? dispatcher.dispatch('table:block-sum')
      : false,
  'ctrl-shift-h': (ih, dispatcher) =>
    dispatcher.isEnabled(EASY_FORMULAS.h.id) ? dispatcher.dispatch(EASY_FORMULAS.h.id) : false,
}

/** Opens the window function the main process asks; see MAIN_PROCESS_KEYS. */
export function installHancomMainKeys(win, getInputHandler, dispatcher) {
  win.__kordocHancomKey = (name) => {
    const take = MAIN_PROCESS_KEYS[name]
    if (!take) return false
    try {
      return take(getInputHandler(), dispatcher) === true
    } catch {
      return false
    }
  }
}

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'HangulMode',
  'HanjaMode',
])

// Dubeolsik jamo to the latin key they sit on, for a key reported by its letter alone
const JAMO = {
  ㅂ: 'q',
  ㅈ: 'w',
  ㄷ: 'e',
  ㄱ: 'r',
  ㅅ: 't',
  ㅛ: 'y',
  ㅕ: 'u',
  ㅑ: 'i',
  ㅐ: 'o',
  ㅔ: 'p',
  ㅁ: 'a',
  ㄴ: 's',
  ㅇ: 'd',
  ㄹ: 'f',
  ㅎ: 'g',
  ㅗ: 'h',
  ㅓ: 'j',
  ㅏ: 'k',
  ㅣ: 'l',
  ㅋ: 'z',
  ㅌ: 'x',
  ㅊ: 'c',
  ㅍ: 'v',
  ㅠ: 'b',
  ㅜ: 'n',
  ㅡ: 'm',
}

/**
 * The letter or digit a key sits on, whatever the input language. A Korean IME reports the key as
 * "Process" (keyCode 229) while it composes, so the physical key comes first.
 */
export function letterOf(e) {
  const code = e.code ?? ''
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  const key = (e.key ?? '').toLowerCase()
  if (/^[a-z0-9]$/.test(key)) return key
  return JAMO[e.key] ?? null
}

/**
 * The first key of a sequence: Ctrl (or Cmd, see META_CHORDS) with a chord letter, no Shift or
 * Alt. Takes the key and waits for the second one. Works while the IME composes.
 */
export function hancomChordStart(ih, e) {
  if (e.shiftKey || e.altKey) return false
  const first = letterOf(e)
  if (!first || !CHORDS[first]) return false
  if (!(e.ctrlKey || (e.metaKey && META_CHORDS.has(first)))) return false
  e.preventDefault()
  ih._hancomChord = first
  // a Korean IME that was composing hands the same press over twice: as "Process" (229) while
  // it composes, and again as the plain key once it has committed (Windows, 2026-10-22)
  ih._hancomChordIme = imeReported(e) ? { code: e.code, at: e.timeStamp ?? 0 } : null
  return true
}

/** How long after the IME's first report its repeat of the same press may come. */
const IME_REPEAT_MS = 500

const imeReported = (e) => e.key === 'Process' || e.keyCode === 229

// a modifier the IME reports as "Process" while it composes still names itself in the code
const isModifier = (e) =>
  MODIFIER_KEYS.has(e.key) || /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code ?? '')

/**
 * The second key of a sequence, when one is waiting. A key the sequence has no command for drops
 * it and goes on as a key of its own, as the studio's sequences did. A letter the IME was about
 * to compose is kept out of the document.
 */
export function hancomChordKey(ih, e) {
  const first = ih._hancomChord
  if (!first || isModifier(e)) return false
  const ime = ih._hancomChordIme
  ih._hancomChordIme = null
  if (
    ime &&
    e.code === ime.code &&
    (e.ctrlKey || e.metaKey) &&
    !imeReported(e) &&
    (e.timeStamp ?? 0) - ime.at < IME_REPEAT_MS
  ) {
    // the IME's second report of the first key: still waiting for the second key
    e.preventDefault()
    return true
  }
  ih._hancomChord = null
  const second = letterOf(e)
  const target = second ? CHORDS[first][second] : undefined
  const dispatcher = ih.dispatcher
  if (!target || !dispatcher) return false
  e.preventDefault()
  ih._cellBlockLetterImeGuard?.arm(e)
  const ids = Array.isArray(target) ? target : [target]
  dispatcher.dispatch(ids.find((id) => dispatcher.isEnabled(id)) ?? ids[0])
  return true
}

/**
 * Hangul's easy formulas (쉬운 계산식): Ctrl+Shift+letter with the caret in a table cell puts the
 * sum, average or product of the cells to its left or above it in that cell.
 */
export const EASY_FORMULAS = {
  h: { id: 'kordoc:easy-sum-left', func: 'SUM', range: 'LEFT', ko: '가로 합계', en: 'Sum Left' },
  v: { id: 'kordoc:easy-sum-above', func: 'SUM', range: 'ABOVE', ko: '세로 합계', en: 'Sum Above' },
  j: { id: 'kordoc:easy-avg-left', func: 'AVG', range: 'LEFT', ko: '가로 평균', en: 'Average Left' },
  b: {
    id: 'kordoc:easy-avg-above',
    func: 'AVG',
    range: 'ABOVE',
    ko: '세로 평균',
    en: 'Average Above',
  },
  k: {
    id: 'kordoc:easy-product-left',
    func: 'PRODUCT',
    range: 'LEFT',
    ko: '가로 곱',
    en: 'Product Left',
  },
  n: {
    id: 'kordoc:easy-product-above',
    func: 'PRODUCT',
    range: 'ABOVE',
    ko: '세로 곱',
    en: 'Product Above',
  },
}

/**
 * Keys whose meaning depends on where the caret is: the easy formulas take Ctrl+Shift+H/V/J/B/K/N
 * in a table cell only. Elsewhere the key goes on to the studio (Ctrl+Shift+H, document history;
 * Ctrl+Shift+V, the plain paste). Called ahead of the studio's shortcut table.
 */
export function hancomContextKey(ih, e) {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return false
  const letter = letterOf(e)
  const formula = letter ? EASY_FORMULAS[letter] : undefined
  const dispatcher = ih.dispatcher
  if (!formula || !dispatcher || !dispatcher.isEnabled(formula.id)) return false
  e.preventDefault()
  dispatcher.dispatch(formula.id)
  return true
}

/** A Ctrl key the module takes before the studio's table: a sequence's first key, or a context key. */
export function hancomCtrlKey(ih, e) {
  return hancomChordStart(ih, e) || hancomContextKey(ih, e)
}

const samePlace = (a, b) =>
  a.sectionIndex === b.sectionIndex &&
  a.parentParaIndex === b.parentParaIndex &&
  a.controlIndex === b.controlIndex &&
  a.cellIndex === b.cellIndex &&
  JSON.stringify(a.cellPath ?? null) === JSON.stringify(b.cellPath ?? null)

const paraOf = (pos) => (pos.parentParaIndex === undefined ? pos.paragraphIndex : pos.cellParaIndex)

/**
 * Hangul's Ctrl+Y: deletes the line the caret is on. A paragraph's last line takes the paragraph
 * break with it, so the line is gone and the next paragraph moves up; the last paragraph of the
 * body or a cell keeps its (now empty) line. Body text and table cells; elsewhere (header, note,
 * a selected object or cell block) it does nothing.
 */
export function deleteLine(ih) {
  const cursor = ih?.cursor
  if (!cursor || ih.isFormMode?.()) return false
  if (cursor.isInHeaderFooter() || cursor.isInFootnote()) return false
  if (cursor.isInPictureObjectSelection() || cursor.isInTableObjectSelection()) return false
  if (cursor.isInCellSelectionMode()) return false
  cursor.clearSelection()
  cursor.moveToLineStart()
  cursor.setAnchor()
  cursor.moveToLineEnd()
  const end = cursor.getPosition()
  cursor.moveHorizontal(1)
  const next = cursor.getPosition()
  // past the line end lies either the next paragraph's start (take the break) or the next line
  // of the same paragraph, or nothing at all (the last line): go back to the line end then
  const tookBreak =
    samePlace(end, next) && paraOf(next) === paraOf(end) + 1 && next.charOffset === 0
  // moveTo keeps the anchor
  if (!tookBreak) cursor.moveTo(end)
  const selection = cursor.getSelection()
  if (
    !selection ||
    (samePlace(selection.anchor, selection.focus) &&
      paraOf(selection.anchor) === paraOf(selection.focus) &&
      selection.anchor.charOffset === selection.focus.charOffset)
  ) {
    cursor.clearSelection()
    return false
  }
  ih.deleteSelection()
  ih.updateCaret?.()
  return true
}

/** What Hangul's 보통 모양 (Alt+Shift+C) takes off; size, font, ratio, spacing and shade stay. */
export const NORMAL_SHAPE = {
  bold: false,
  italic: false,
  underline: false,
  underlineType: 'None',
  strikethrough: false,
  superscript: false,
  subscript: false,
  outlineType: 0,
  shadowType: 0,
  emboss: false,
  engrave: false,
  textColor: '#000000',
}

/** Hangul's 날짜/시간 문자열 (Ctrl+K,D) as it writes it by default: 2026년 10월 23일. */
export function dateString(date = new Date()) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`
}

/**
 * The easy formula for the cell the caret is in. The cell must be empty and sit in a table of the
 * body (not a table in a cell), and the formula must evaluate. Writes the result the way the
 * studio's block formulas do (the engine's number, as text), as one undo step.
 */
export function runEasyFormula(services, formula) {
  const ih = services.getInputHandler()
  if (!ih) return false
  const pos = ih.getCursorPosition()
  if (pos.parentParaIndex === undefined || pos.controlIndex === undefined) return false
  if (pos.cellIndex === undefined || (pos.cellPath?.length ?? 0) > 1) return false
  const sec = pos.sectionIndex
  const ppi = pos.parentParaIndex
  const ci = pos.controlIndex
  const wasm = services.wasm
  const paras = wasm.getCellParagraphCount(sec, ppi, ci, pos.cellIndex)
  for (let p = 0; p < paras; p += 1) {
    if (wasm.getCellParagraphLength(sec, ppi, ci, pos.cellIndex, p) > 0) return false
  }
  const { row, col } = wasm.getCellInfo(sec, ppi, ci, pos.cellIndex)
  const text = `=${formula.func}(${formula.range})`
  if (!JSON.parse(wasm.evaluateTableFormula(sec, ppi, ci, row, col, text, false)).ok) return false
  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'tableEasyFormula',
    operation: (bridge) => {
      const done = JSON.parse(bridge.evaluateTableFormula(sec, ppi, ci, row, col, text, true))
      if (!done.ok) throw new Error(`easy formula ${text}`)
      return pos
    },
  })
  return true
}

/** Where a backward search starts: the start of the selection (the last match), or the caret. */
function searchStart(ih) {
  const selection = ih.cursor?.getSelection?.()
  if (!selection) return ih.getCursorPosition()
  const { anchor, focus } = selection
  const anchorFirst =
    anchor.paragraphIndex < focus.paragraphIndex ||
    (anchor.paragraphIndex === focus.paragraphIndex && anchor.charOffset <= focus.charOffset)
  return anchorFirst ? anchor : focus
}

/**
 * Hangul's 거꾸로 찾기 (Ctrl+Q,L): the last search again, towards the start of the document.
 * Without a last search it opens the find box.
 */
export function findBackward(services, studio) {
  const ih = services.getInputHandler()
  const query = studio.FindDialog?.lastQuery
  if (!ih || !query) {
    ih?.dispatcher?.dispatch('edit:find')
    return false
  }
  const at = searchStart(ih)
  const hit = services.wasm.searchText(
    query,
    at.sectionIndex,
    at.paragraphIndex,
    at.charOffset,
    false,
    studio.FindDialog.lastCaseSensitive,
    true,
  )
  studio.navigateToSearchHit(ih, hit)
  return !!hit?.found
}

/** Hangul's page number positions (HWP table 150), in the order the dialog lists them. */
export const PAGE_NUMBER_POSITIONS = [
  { code: 1, ko: '왼쪽 위', en: 'Top left' },
  { code: 2, ko: '가운데 위', en: 'Top center' },
  { code: 3, ko: '오른쪽 위', en: 'Top right' },
  { code: 4, ko: '왼쪽 아래', en: 'Bottom left' },
  { code: 5, ko: '가운데 아래', en: 'Bottom center' },
  { code: 6, ko: '오른쪽 아래', en: 'Bottom right' },
  { code: 7, ko: '바깥쪽 위', en: 'Outside top' },
  { code: 8, ko: '바깥쪽 아래', en: 'Outside bottom' },
  { code: 9, ko: '안쪽 위', en: 'Inside top' },
  { code: 10, ko: '안쪽 아래', en: 'Inside bottom' },
  { code: 0, ko: '없음', en: 'None' },
]

/** The number shapes a page number has in both HWP and HWPX (table 134, codes 0..7). */
export const PAGE_NUMBER_FORMATS = [
  { code: 0, sample: '1, 2, 3' },
  { code: 1, sample: '①, ②, ③' },
  { code: 2, sample: 'I, II, III' },
  { code: 3, sample: 'i, ii, iii' },
  { code: 4, sample: 'A, B, C' },
  { code: 5, sample: 'a, b, c' },
  { code: 6, sample: '가, 나, 다' },
  { code: 7, sample: '一, 二, 三' },
]

/** Hangul's default for a section without one: 1, 2, 3 at the bottom center, with dashes. */
export const PAGE_NUMBER_DEFAULT = { format: 0, position: 5, dash: true }

/**
 * Sets the section's page number (Hangul's 쪽 번호 매기기) through the engine call the
 * studio-hancom-page-number patch hands over: one per section, in its first paragraph, replacing
 * the one there was. One undo step.
 */
export function applyPageNumber(services, setting) {
  const ih = services.getInputHandler()
  if (!ih) return false
  const pos = ih.getCursorPosition()
  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'setPageNumberPos',
    operation: (bridge) => {
      const done = JSON.parse(
        bridge.setPageNumberPos(pos.sectionIndex, setting.format, setting.position, setting.dash),
      )
      if (!done.ok) throw new Error('setPageNumberPos')
      return pos
    },
  })
  return true
}

/** The section's page number as the dialog starts with it: the one it has, or Hangul's default. */
export function currentPageNumber(services, section) {
  try {
    const found = JSON.parse(services.wasm.getPageNumberPos(section))
    if (found?.ok && found.pageNumber) {
      const { format, position, dash } = found.pageNumber
      return { format, position, dash }
    }
  } catch {
    // an engine without the call: the default
  }
  return { ...PAGE_NUMBER_DEFAULT }
}

/** The 쪽 번호 매기기 dialog, built on the studio's own dialog base (handed in, not imported). */
function pageNumberDialog(ModalDialog, ko, start, onApply) {
  class PageNumberDialog extends ModalDialog {
    constructor() {
      super(ko ? '쪽 번호 매기기' : 'Page Numbering', 380)
      this.setting = { ...start }
    }

    createBody() {
      const doc = globalThis.document
      const body = doc.createElement('div')
      body.style.padding = '12px 16px'
      const heading = (text) => {
        const h = doc.createElement('div')
        h.className = 'dialog-section-title'
        h.textContent = text
        return h
      }
      body.appendChild(heading(ko ? '번호 위치' : 'Position'))
      const grid = doc.createElement('div')
      grid.style.cssText =
        'display:grid;grid-template-columns:repeat(3,1fr);gap:4px 12px;margin:6px 0 12px'
      for (const p of PAGE_NUMBER_POSITIONS) {
        const label = doc.createElement('label')
        label.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap'
        const input = doc.createElement('input')
        input.type = 'radio'
        input.name = 'kordoc-page-number-position'
        input.value = String(p.code)
        input.checked = p.code === this.setting.position
        input.addEventListener('change', () => {
          if (input.checked) this.setting.position = p.code
        })
        label.append(input, ko ? p.ko : p.en)
        grid.appendChild(label)
      }
      body.appendChild(grid)
      body.appendChild(heading(ko ? '번호 모양' : 'Number format'))
      const select = doc.createElement('select')
      select.className = 'dialog-select'
      select.style.margin = '6px 0 12px'
      for (const f of PAGE_NUMBER_FORMATS) {
        const option = doc.createElement('option')
        option.value = String(f.code)
        option.textContent = f.sample
        option.selected = f.code === this.setting.format
        select.appendChild(option)
      }
      select.addEventListener('change', () => {
        this.setting.format = Number(select.value)
      })
      body.appendChild(select)
      const dash = doc.createElement('label')
      dash.style.cssText = 'display:flex;align-items:center;gap:4px'
      const box = doc.createElement('input')
      box.type = 'checkbox'
      box.checked = this.setting.dash
      box.addEventListener('change', () => {
        this.setting.dash = box.checked
      })
      dash.append(box, ko ? '줄표 넣기 (- 1 -)' : 'Dashes (- 1 -)')
      body.appendChild(dash)
      return body
    }

    onConfirm() {
      onApply({ ...this.setting })
      return true
    }
  }
  return new PageNumberDialog()
}

/**
 * The commands behind the keys the studio has no command for. `locale` is the studio's, which
 * shows itself in Korean or English only; the labels show in its command palette. `studio` hands
 * over what of the studio a command builds on (the studio-hancom-commands patch passes it):
 * InsertTextCommand, ModalDialog, FindDialog and navigateToSearchHit.
 */
export function hancomCommands(locale, studio = {}) {
  const ko = locale === 'ko'
  const commands = [
    {
      id: 'kordoc:delete-line',
      label: ko ? '한 줄 지우기' : 'Delete Line',
      shortcutLabel: 'Ctrl+Y',
      canExecute: (ctx) => ctx.hasDocument && !ctx.isFormMode,
      execute(services) {
        deleteLine(services.getInputHandler())
      },
    },
  ]
  for (const [letter, { color, ko: nameKo, en }] of Object.entries(TEXT_COLORS)) {
    commands.push({
      id: `kordoc:text-color-${letter}`,
      label: ko ? nameKo : en,
      shortcutLabel: `Ctrl+M,${letter.toUpperCase()}`,
      canExecute: (ctx) => ctx.hasDocument && !ctx.isFormMode,
      execute(services) {
        services.eventBus.emit('format-char', { textColor: color })
      },
    })
  }
  commands.push(
    {
      id: 'kordoc:normal-shape',
      label: ko ? '보통 모양' : 'Normal Shape',
      shortcutLabel: 'Alt+Shift+C',
      canExecute: (ctx) => ctx.hasDocument && !ctx.isFormMode,
      execute(services) {
        services.eventBus.emit('format-char', { ...NORMAL_SHAPE })
      },
    },
    {
      id: 'kordoc:insert-date',
      label: ko ? '날짜/시간 문자열' : 'Date String',
      shortcutLabel: 'Ctrl+K,D',
      canExecute: (ctx) => ctx.hasDocument && !ctx.isFormMode,
      execute(services) {
        const ih = services.getInputHandler()
        if (!ih || !studio.InsertTextCommand) return
        if (ih.cursor?.hasSelection?.()) ih.deleteSelection()
        ih.executeOperation({
          kind: 'command',
          command: new studio.InsertTextCommand(ih.getCursorPosition(), dateString()),
        })
        services.eventBus.emit('document-changed')
        ih.focus?.()
      },
    },
    {
      id: 'kordoc:find-backward',
      label: ko ? '거꾸로 찾기' : 'Find Backward',
      shortcutLabel: 'Ctrl+Q,L',
      canExecute: (ctx) => ctx.hasDocument,
      execute(services) {
        findBackward(services, studio)
      },
    },
    {
      id: 'kordoc:page-number',
      opensDialog: true,
      label: ko ? '쪽 번호 매기기' : 'Page Numbering',
      shortcutLabel: 'Ctrl+N,P',
      canExecute: (ctx) => ctx.hasDocument && !ctx.isFormMode,
      execute(services) {
        const ih = services.getInputHandler()
        if (!ih || !studio.ModalDialog) return
        const start = currentPageNumber(services, ih.getCursorPosition().sectionIndex)
        pageNumberDialog(studio.ModalDialog, ko, start, (setting) => {
          applyPageNumber(services, setting)
          ih.focus?.()
        }).show()
      },
    },
  )
  for (const [letter, formula] of Object.entries(EASY_FORMULAS)) {
    commands.push({
      id: formula.id,
      label: ko ? formula.ko : formula.en,
      shortcutLabel: `Ctrl+Shift+${letter.toUpperCase()}`,
      canExecute: (ctx) => ctx.hasDocument && ctx.inTable && !ctx.isFormMode,
      execute(services) {
        runEasyFormula(services, formula)
      },
    })
  }
  for (let n = 1; n <= STYLE_KEYS; n += 1) {
    commands.push({
      id: `kordoc:style-${n}`,
      label: ko ? `스타일 ${n} 적용` : `Apply Style ${n}`,
      shortcutLabel: `Ctrl+${digitOf(n)}`,
      canExecute: (ctx) => ctx.hasDocument && !ctx.isFormMode,
      execute(services) {
        const style = services.wasm.getStyleList()[n - 1]
        if (style) services.getInputHandler()?.applyStyle(style.id)
      },
    })
  }
  return commands
}

/** Menu items for the new commands, each after a studio item: [command, after, Korean, English]. */
export const MENU_ITEMS = [
  ['kordoc:page-number', 'page:new-page-num', '쪽 번호 매기기', 'Page Numbering'],
  ['kordoc:find-backward', 'edit:find-again', '거꾸로 찾기', 'Find Backward'],
  ['kordoc:insert-date', 'insert:symbols', '날짜/시간 문자열', 'Date String'],
]

/**
 * Puts the new commands into the studio's menus next to their neighbours. Runs before the studio
 * builds its menu bar from the page, so the items work like its own; their keys come from the
 * commands' labels like every other item's.
 */
export function installHancomMenuItems(doc, locale, mac = onMac()) {
  const ko = locale === 'ko'
  // the page writes some keys into its menu itself; clear the ones that no longer start
  if (!mac) {
    for (const id of LABELS_GONE_OFF_MAC) {
      const shortcut = doc.querySelector(`.md-item[data-cmd="${id}"] .md-shortcut`)
      if (shortcut) shortcut.textContent = ''
    }
  }
  for (const [id, after, nameKo, nameEn] of MENU_ITEMS) {
    const anchor = doc.querySelector(`.md-item[data-cmd="${after}"]`)
    if (!anchor || doc.querySelector(`.md-item[data-cmd="${id}"]`)) continue
    const item = doc.createElement('div')
    item.className = 'md-item'
    item.dataset.cmd = id
    const icon = doc.createElement('span')
    icon.className = 'md-icon'
    const label = doc.createElement('span')
    label.className = 'md-label'
    label.textContent = ko ? nameKo : nameEn
    item.append(icon, label)
    anchor.after(item)
  }
}

/** Every studio command the keys above run; the build checks the studio still has each. */
export function studioCommandIds() {
  const ids = new Set()
  for (const table of Object.values(CHORDS)) {
    for (const target of Object.values(table)) {
      for (const id of Array.isArray(target) ? target : [target]) ids.add(id)
    }
  }
  for (const [, id] of ADDED_SHORTCUTS) ids.add(id)
  for (const id of Object.keys(LABELS)) ids.add(id)
  return [...ids].filter((id) => !id.startsWith('kordoc:')).sort()
}
