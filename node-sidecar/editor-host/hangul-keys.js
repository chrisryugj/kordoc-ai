/**
 * 한글 편집기의 한컴 한글 단축키.
 *
 * 근거: 한컴 공식 도움말 "단축키 일람" (help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut(table).htm).
 * 글자색 값은 rhwp hwpctrl(MIT)이 한컴에서 잰 값.
 *
 * 스튜디오 소스는 고치지 않는다. 편집기 창의 키를 가장 먼저(capture) 받아 스튜디오 공개 자동화
 * (window.rhwpStudio.automation)의 명령으로 넘긴다. 스튜디오에 없는 명령(한 줄 지우기·날짜·글자색·
 * 보통 모양·스타일 번호)은 같은 자동화에 ext:kordoc-* 로 등록해 같은 길로 부른다.
 *
 * 겹글쇠(Ctrl+N,T 처럼 Ctrl+첫 글쇠를 뗀 뒤 둘째 글쇠)는 물리 키(e.code)로 읽어 한글 입력 상태와 상관없다.
 * 맥에서 겹글쇠는 Control 만 받는다(⌘+N·Q 는 앱 메뉴 몫).
 */

/** 겹글쇠: 첫 글쇠 → 둘째 글쇠 → 명령. 배열이면 지금 쓸 수 있는 첫 명령 */
export const CHORDS = {
  n: {
    t: 'table:create', // 표 만들기
    n: 'insert:footnote', // 각주
    e: 'insert:endnote', // 미주
    i: 'insert:image', // 그림
    b: 'insert:textbox', // 글상자
    m: 'insert:equation', // 수식
    c: ['table:caption-toggle', 'insert:caption-toggle'], // 캡션 넣기
    h: 'page:header-create', // 머리말/꼬리말
    s: 'page:hide', // 감추기
    g: 'page:section-settings', // 구역
    a: 'table:split', // 표 나누기
    z: 'table:attach', // 표 붙이기
    f: 'table:formula', // 계산식
    k: ['format:object-properties', 'table:cell-props', 'hyperlink:edit', 'field:edit'], // 고치기
  },
  k: {
    d: 'ext:kordoc-date', // 날짜/시간 문자열
    h: 'insert:hyperlink', // 하이퍼링크
    b: 'insert:bookmark', // 책갈피
    e: 'insert:field', // 필드 입력
  },
  q: {
    f: 'edit:find', // 찾기
    a: 'edit:find-replace', // 찾아 바꾸기
  },
  m: Object.fromEntries('krbdgycw'.split('').map((c) => [c, `ext:kordoc-color-${c}`])), // 글자 색
  g: {
    t: 'view:para-mark', // 문단 부호
    c: 'view:ctrl-mark', // 조판 부호
    p: 'view:zoom-fit-page', // 쪽 맞춤
    w: 'view:zoom-fit-width', // 폭 맞춤
    q: 'view:zoom-100', // 100%
  },
};

/** 글자 색 (Ctrl+M,x): 검정·빨강·파랑·자주·초록·노랑·청록·흰색 */
export const TEXT_COLORS = {
  k: ['검정', '#000000'], r: ['빨강', '#FF0000'], b: ['파랑', '#0000FF'], d: ['자주', '#993366'],
  g: ['초록', '#008000'], y: ['노랑', '#FFFF00'], c: ['청록', '#008080'], w: ['흰색', '#FFFFFF'],
};

/** 보통 모양 (Alt+Shift+C): 진하게·기울임·밑줄·취소선·첨자·외곽선·그림자를 끄고 검정 글자 */
export const NORMAL_SHAPE = {
  bold: false, italic: false, underline: false, strikethrough: false, superscript: false, subscript: false,
  outlineType: 0, shadowType: 0, textColor: '#000000',
};

/** 한 글쇠 단축키: [Ctrl, Shift, Alt, 글쇠(e.code 의 글자·숫자 또는 key 이름)] → 명령 */
export const SINGLES = [
  [true, false, false, 'y', 'ext:kordoc-delete-line'], // 한 줄 지우기 (다시 실행은 Ctrl+Shift+Z)
  [false, false, true, 'y', 'ext:kordoc-delete-line-end'], // 줄 뒤 지우기
  [true, true, false, 'c', 'format:align-center'],
  [true, true, false, 'r', 'format:align-right'],
  [true, true, false, 't', 'format:align-distribute'],
  [true, false, false, 'h', 'edit:find-replace'],
  [false, false, false, 'f2', 'edit:find'],
  [true, false, false, 'f10', 'insert:symbols'], // 문자표
  [false, true, true, 'b', 'format:bold'],
  [false, true, true, 'i', 'format:italic'],
  [false, true, true, 'u', 'format:underline'],
  [false, true, true, 'p', 'format:superscript'],
  [false, true, true, 's', 'format:subscript'],
  [false, true, true, 'c', 'ext:kordoc-normal-shape'],
];

/**
 * 표 단축키 (도움말 "표 내부에 커서를 둔 상태"·"셀 블록 상태"): [자리, Ctrl, Shift, Alt, 글쇠, 명령].
 * 자리 cell = 표 칸 안(셀 블록 포함), block = F5 셀 블록에서만, object = 표를 개체로 고른 상태(칸 안에서 Esc).
 * 표 밖에서는 같은 키가 원래 일을 한다(Ctrl+Enter 쪽 나누기 등).
 */
export const TABLE_KEYS = [
  // 쉬운 계산식: 지금 칸에 맨 왼쪽(맨 위)부터 바로 앞(위) 칸까지의 합·평균·곱
  ...[['h', 'row-sum'], ['v', 'col-sum'], ['j', 'row-avg'], ['b', 'col-avg'], ['k', 'row-product'], ['n', 'col-product']]
    .map(([k, id]) => ['cell', true, true, false, k, `ext:kordoc-easy-${id}`]),
  ['block', true, true, false, 'a', 'table:block-avg'], // 블록 평균
  ['block', true, true, false, 'p', 'table:block-product'], // 블록 곱
  ['object', false, false, false, 'p', 'format:object-properties'], // 개체 속성
  ['object', false, false, false, 'l', 'format:object-properties'], // 선 모양
  ['object', false, false, false, 'c', 'format:object-properties'], // 배경
  ['object', true, false, false, 'e', 'edit:delete'], // 지우기
  ['cell', true, false, false, 'enter', 'table:insert-row-below'], // 줄 추가
  ['cell', true, false, false, 'backspace', 'table:delete-row'], // 줄 지우기
  ['cell', false, false, true, 'insert', 'table:insert-row-col'], // 줄/칸 추가하기
  ['cell', true, false, false, 'tab', 'ext:kordoc-cell-tab'], // 표 안에서 탭
  ['block', false, false, false, 'enter', 'ext:kordoc-cell-edit'], // 편집 상태로
  ['block', false, true, false, 'escape', 'ext:kordoc-table-exit'], // 표 빠져나가기
  ['block', true, false, false, 'e', 'ext:kordoc-cell-clear'], // 셀 내용 지우기
  ['block', false, false, false, 'f7', 'ext:kordoc-select-col'], // 칸 전체
  ['block', false, false, false, 'f8', 'ext:kordoc-select-row'], // 줄 전체
  // 셀 높이를 같게: rhwp 0.8.7 조판은 한 줄 높이를 바꾸면 다른 줄 높이도 따라 변해 맞출 수 없다.
  // 스튜디오 명령 자리(지금은 꺼짐)로 보내 글자가 칸에 들어가지 않게만 한다
  ['block', false, false, false, 'h', 'table:cell-height-equal'],
  ['block', false, false, false, 'w', 'ext:kordoc-cell-width-equal'], // 셀 너비를 같게
  ['block', false, false, false, 'p', 'table:cell-props'], // 표/셀 속성
  ['block', false, false, false, 'l', 'table:border-each'], // 각 셀마다 적용: 테두리
  ['block', false, false, false, 'c', 'ext:kordoc-bg-each'], // 각 셀마다 적용: 배경
  ['block', false, false, false, 'b', 'table:border-one'], // 하나의 셀처럼 적용: 테두리
  ['block', false, false, false, 'f', 'ext:kordoc-bg-one'], // 하나의 셀처럼 적용: 배경
];

/** 메뉴에 보일 한컴 키 글자 (스튜디오가 다른 키를 적어 둔 명령) */
export const MENU_LABELS = {
  'format:align-center': 'Ctrl+Shift+C',
  'format:align-right': 'Ctrl+Shift+R',
  'format:align-distribute': 'Ctrl+Shift+T',
  'insert:symbols': 'Ctrl+F10',
  'table:create': 'Ctrl+N,T',
  'insert:footnote': 'Ctrl+N,N',
  'insert:endnote': 'Ctrl+N,E',
  'insert:image': 'Ctrl+N,I',
  'insert:textbox': 'Ctrl+N,B',
  'insert:equation': 'Ctrl+N,M',
  'page:header-create': 'Ctrl+N,H',
  'page:hide': 'Ctrl+N,S',
  'page:section-settings': 'Ctrl+N,G',
  'table:split': 'Ctrl+N,A',
  'table:attach': 'Ctrl+N,Z',
  'table:formula': 'Ctrl+N,F',
  'insert:hyperlink': 'Ctrl+K,H',
  'insert:bookmark': 'Ctrl+K,B',
  'insert:field': 'Ctrl+K,E',
  'edit:redo': 'Ctrl+Shift+Z',
  'table:insert-row-below': 'Ctrl+Enter',
  'table:delete-row': 'Ctrl+Backspace',
  'table:insert-row-col': 'Alt+Insert',
};

/** 겹글쇠를 기다리는 동안 눌려도 무시하는 글쇠 (Process 는 입력기가 받은 진짜 글쇠라 여기 없다) */
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'HangulMode', 'HanjaMode', 'KanaMode']);

/** 물리 키 이름: KeyN → n, Digit3 → 3, 그 밖엔 key 소문자(f2·escape) */
export function keyName(e) {
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return String(e.key || '').toLowerCase();
}

/**
 * 키 하나를 판정한다 (순수 함수, 시험용). state.chord 는 기다리는 겹글쇠의 첫 글쇠.
 * 돌려주는 것: { chord } 첫 글쇠를 받음 · { commands, params? } 실행할 명령(앞에서부터 되는 것) ·
 * { swallow: true } 겹글쇠 둘째 자리의 모르는 글쇠(문서에 들어가지 않게 삼킴) · null 스튜디오에 맡김.
 * where: 커서 자리 { cell: 표 칸 안, block: F5 셀 블록, object: 표 선택, nested: 중첩 표 칸 안 }
 */
export function resolveKey(e, state, mac = false, where = {}) {
  const name = keyName(e);
  const ctrl = e.ctrlKey || (mac && e.metaKey);
  // 중첩 표 칸의 Ctrl+Enter: 스튜디오의 줄 명령은 바깥 표만 움직이고 그냥 두면 쪽 나누기가 돼 바깥 문단이 갈린다. 삼킨다
  if (!state.chord && where.nested && name === 'enter' && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) return { swallow: true };
  if (!state.chord && (where.cell || where.block || where.object)) {
    for (const [at, c, s, a, key, command] of TABLE_KEYS) {
      if (!where[at]) continue;
      // 표 키의 Ctrl 은 맥에서도 Control 만 (⌘+Backspace 줄 시작까지 지우기 같은 맥 키를 지킨다)
      if (key === name && !!c === (e.ctrlKey && !e.metaKey) && !!s === e.shiftKey && !!a === e.altKey) return { commands: [command] };
    }
  }
  if (state.chord) {
    // 첫 글쇠를 누른 채 반복된 것·Ctrl 따위는 둘째 글쇠가 아니다
    if (MODIFIERS.has(e.key) || e.repeat) return { wait: true };
    const table = CHORDS[state.chord];
    state.chord = null;
    if (name === 'escape') return { swallow: true };
    const target = table[name];
    return target ? { commands: [target].flat() } : { swallow: true };
  }
  // 겹글쇠 첫 글쇠: Control(맥도 Control 만) + 글자, Shift·Alt 없이
  if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.repeat && CHORDS[name]) {
    state.chord = name;
    return { chord: name };
  }
  // 스타일 적용: Ctrl+1~0 · Ctrl+Alt+1~0
  if (ctrl && !e.shiftKey && /^[0-9]$/.test(name)) {
    return { commands: ['ext:kordoc-style'], params: { n: name === '0' ? 10 : Number(name) } };
  }
  for (const [c, s, a, key, command] of SINGLES) {
    if (key === name && !!c === !!ctrl && !!s === e.shiftKey && !!a === e.altKey) return { commands: [command] };
  }
  return null;
}

/**
 * 한 줄 지우기(Ctrl+Y)·줄 뒤 지우기(Alt+Y).
 * - 본문 문단이 한 줄뿐이면 문단째 지운다: 앞 문단 끝부터 이 문단 끝까지 골라 지워 앞·뒤 문단 서식은 그대로 둔다.
 *   문서 첫 문단이면 글만 지운다(아래 문단을 끌어올리면 아래 문단이 이 문단 서식을 받는다).
 * - 여러 줄 문단이면 그 줄의 글만 지운다(나머지 줄이 다시 흐른다).
 * - 표·그림 같은 개체가 든 본문 줄은 지우지 않는다(개체를 함께 날리지 않게).
 * - 표 칸·글상자 안에서는 문단을 합치지 않고 줄의 글만 지운다.
 */
function deleteLine(ih, wasm, toEnd) {
  const nav = (key, shiftKey = false) => ih.handleDocumentNavigationKey(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
  const p = ih.getCursorPosition();
  const body = p.parentParaIndex === undefined && !p.cellPath?.length && !p.isTextBox;
  if (toEnd || !body) {
    if (!toEnd) nav('Home');
    nav('End', true);
    if (ih.hasSelection()) ih.performDelete();
    return;
  }
  const { sectionIndex: sec, paragraphIndex: para } = p;
  const line = wasm.getLineInfo(sec, para, p.charOffset);
  const objects = wasm.getControlTextPositions(sec, para).filter((x) => x >= line.charStart && x <= line.charEnd).length > 0;
  if (line.lineCount === 1 && para > 0 && !objects) {
    ih.moveCursorTo({ sectionIndex: sec, paragraphIndex: para - 1, charOffset: wasm.getParagraphLength(sec, para - 1) });
    nav('ArrowRight', true);
    nav('End', true);
  } else {
    if (objects) return;
    nav('Home');
    nav('End', true);
  }
  if (ih.hasSelection()) ih.performDelete();
}

/** 편집 입력 칸에 스튜디오 키를 보낸다 (스튜디오가 원래 하는 일을 그대로 시킬 때) */
function sendKey(doc, key, shiftKey = false) {
  doc.querySelector('textarea[aria-label="문서 편집 입력"]')?.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, shiftKey, bubbles: true, cancelable: true }));
}

/** F5 셀 블록을 지금 칸이 든 줄 전체(row)나 칸 전체(col)로 넓힌다 */
function selectLine(s, which) {
  const ih = s.getInputHandler();
  const cur = ih?.cursor;
  const ctx = ih?.getCellTableContext?.();
  const at = cur?.getCellSelectionFocus?.();
  if (!ctx || !at || !cur.setCellSelectionAnchor) return;
  if (which === 'row') { cur.setCellSelectionAnchor(at.row, 0); cur.setCellSelectionFocus(at.row, ctx.colCount - 1); }
  else { cur.setCellSelectionAnchor(0, at.col); cur.setCellSelectionFocus(ctx.rowCount - 1, at.col); }
  ih.updateCellSelection?.();
}

/**
 * 셀 너비를 같게(W). HWP 표는 칸(열)마다 너비가 하나라(스튜디오는 그래서 이 명령을 비워 뒀다)
 * 고른 칸들이 걸친 칸(열) 전체를 그 평균 너비로 맞춘다. 범위 경계를 넘는 합친 셀이 있으면 하지 않는다.
 * cells: { i, col, colSpan, width } (HWPUNIT)
 */
export function equalWidthDeltas(cells, lo, hi) {
  const widths = [];
  for (let k = lo; k <= hi; k++) widths.push(cells.find((c) => c.col === k && c.colSpan === 1)?.width);
  if (hi <= lo || widths.some((v) => !v)) return null;
  const target = widths.reduce((a, b) => a + b, 0) / widths.length;
  const out = [];
  for (const c of cells) {
    const to = c.col + c.colSpan - 1;
    if (to < lo || c.col > hi) continue;
    if (c.col < lo || to > hi) return null; // 경계를 넘는 합친 셀
    const d = Math.round(target * c.colSpan - c.width);
    if (d) out.push({ cellIdx: c.i, widthDelta: d });
  }
  return out;
}

function equalWidths(s) {
  const ih = s.getInputHandler();
  const cur = ih?.cursor;
  const ctx = ih?.getCellTableContext?.();
  const r = ih?.getSelectedCellRange?.();
  // Ctrl+클릭으로 뺀 칸이 있으면 하지 않는다 (스튜디오 블록 계산식과 같게)
  if (!ctx || !r || ih.hasExcludedCellSelection?.() || !ih.executeOperation) return;
  const P = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const w = s.wasm;
  const n = P(w.getTableDimensions(ctx.sec, ctx.ppi, ctx.ci)).cellCount;
  const cells = [];
  for (let i = 0; i < n; i++) cells.push({ i, ...P(w.getCellInfo(ctx.sec, ctx.ppi, ctx.ci, i)), width: P(w.getCellProperties(ctx.sec, ctx.ppi, ctx.ci, i)).width });
  const deltas = equalWidthDeltas(cells, r.startCol, r.endCol);
  if (!deltas?.length) return;
  const pos = ih.getCursorPosition();
  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'cellWidthEqual',
    // 스튜디오의 엔진 다리는 배열을 받아 스스로 JSON 으로 바꾼다
    operation: (wasm) => { wasm.resizeTableCells(ctx.sec, ctx.ppi, ctx.ci, deltas); return pos; },
  });
}

/** 칸(열) 번호 → 계산식 칸 이름 글자 (0 → A, 26 → AA) */
export function colName(n) {
  let s = '';
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

/** 쉬운 계산식의 식: 가로는 같은 줄 맨 왼쪽~바로 앞 칸, 세로는 같은 칸 맨 위~바로 위 칸. 앞 칸이 없으면 null */
export function easyFormula(row, col, kind) {
  const [dir, fn] = kind.split('-');
  const name = { sum: 'SUM', avg: 'AVERAGE', product: 'PRODUCT' }[fn];
  if (dir === 'row') return col > 0 ? `=${name}(A${row + 1}:${colName(col - 1)}${row + 1})` : null;
  return row > 0 ? `=${name}(${colName(col)}1:${colName(col)}${row})` : null;
}

function easyCalc(s, kind) {
  const ih = s.getInputHandler();
  const ctx = ih?.getCellTableContext?.();
  const p = ih?.getCursorPosition?.();
  if (!ctx || !p || p.cellIndex === undefined || (ctx.cellPath?.length ?? 0) > 1 || !ih.executeOperation) return;
  const P = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const { row, col } = P(s.wasm.getCellInfo(ctx.sec, ctx.ppi, ctx.ci, p.cellIndex));
  const formula = easyFormula(row, col, kind);
  if (!formula) return;
  ih.executeOperation({
    kind: 'snapshot',
    operationType: 'easyFormula',
    operation: (wasm) => { wasm.evaluateTableFormula(ctx.sec, ctx.ppi, ctx.ci, row, col, formula, true); return p; },
  });
}

/** 셀 테두리/배경 창을 배경 탭으로 연다 (스튜디오 창은 늘 테두리 탭으로 열린다) */
function openBackground(s, doc, command) {
  doc.defaultView?.rhwpStudio?.automation?.execute(command, undefined, { allowDialog: true });
  const tab = [...doc.querySelectorAll('.dialog-tab[data-tab="background"]')].find((b) => b.offsetParent);
  tab?.click();
}

/** 표 빠져나가기: 셀 블록을 풀고 표 바로 뒤로 커서를 옮긴다 */
function exitTable(s, doc) {
  const ih = s.getInputHandler();
  const ctx = ih?.getCellTableContext?.();
  if (!ctx) return;
  sendKey(doc, 'Escape');
  const at = s.wasm.getControlTextPositions(ctx.sec, ctx.ppi)[ctx.ci];
  if (at === undefined) return;
  ih.cursor.exitCellSelectionMode?.();
  // 글 위치는 개체를 세지 않는다: 표 자리가 곧 표 바로 뒤
  ih.moveCursorTo({ sectionIndex: ctx.sec, paragraphIndex: ctx.ppi, charOffset: at });
}

/** 날짜/시간 문자열: 한컴 기본 꼴 "2026년 10월 25일" */
export const dateText = (d = new Date()) => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;

/** 편집기 입력 칸에 글을 넣는다 (사람이 친 것과 같은 길: 실행 취소 한 단계) */
function typeText(doc, text) {
  const box = doc.querySelector('textarea[aria-label="문서 편집 입력"]');
  if (!box) return;
  box.value = text;
  box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

function extCommands(doc) {
  const editable = (ctx) => ctx.hasDocument && !ctx.isFormMode;
  const out = [
    { id: 'ext:kordoc-delete-line', label: '한 줄 지우기', shortcutLabel: 'Ctrl+Y', canExecute: editable, execute: (s) => { const ih = s.getInputHandler(); if (ih) deleteLine(ih, s.wasm, false); } },
    { id: 'ext:kordoc-delete-line-end', label: '줄 뒤 지우기', shortcutLabel: 'Alt+Y', canExecute: editable, execute: (s) => { const ih = s.getInputHandler(); if (ih) deleteLine(ih, s.wasm, true); } },
    { id: 'ext:kordoc-date', label: '날짜/시간 문자열', shortcutLabel: 'Ctrl+K,D', canExecute: editable, execute: () => typeText(doc, dateText()) },
    { id: 'ext:kordoc-normal-shape', label: '보통 모양', shortcutLabel: 'Alt+Shift+C', canExecute: editable, execute: (s) => s.eventBus.emit('format-char', { ...NORMAL_SHAPE }) },
    {
      id: 'ext:kordoc-style', label: '스타일 적용', shortcutLabel: 'Ctrl+1~0', canExecute: editable,
      execute: (s, params) => {
        const style = s.wasm.getStyleList()[Number(params?.n) - 1];
        if (style) s.getInputHandler()?.applyStyle(style.id);
      },
    },
  ];
  const inCell = (ctx) => editable(ctx);
  out.push(
    { id: 'ext:kordoc-cell-tab', label: '표 안에서 탭', shortcutLabel: 'Ctrl+Tab', canExecute: inCell, execute: () => typeText(doc, '\t') },
    { id: 'ext:kordoc-cell-edit', label: '셀 편집 상태로', shortcutLabel: 'Enter', canExecute: inCell, execute: () => sendKey(doc, 'Escape') },
    { id: 'ext:kordoc-cell-clear', label: '셀 내용 지우기', shortcutLabel: 'Ctrl+E', canExecute: inCell, execute: () => sendKey(doc, 'Delete') },
    { id: 'ext:kordoc-table-exit', label: '표 빠져나가기', shortcutLabel: 'Shift+Esc', canExecute: inCell, execute: (s) => exitTable(s, doc) },
    { id: 'ext:kordoc-select-col', label: '칸 전체 고르기', shortcutLabel: 'F7', canExecute: inCell, execute: (s) => selectLine(s, 'col') },
    { id: 'ext:kordoc-select-row', label: '줄 전체 고르기', shortcutLabel: 'F8', canExecute: inCell, execute: (s) => selectLine(s, 'row') },
    ...['row-sum', 'col-sum', 'row-avg', 'col-avg', 'row-product', 'col-product'].map((kind) => ({
      id: `ext:kordoc-easy-${kind}`,
      label: { 'row-sum': '가로 합계', 'col-sum': '세로 합계', 'row-avg': '가로 평균', 'col-avg': '세로 평균', 'row-product': '가로 곱', 'col-product': '세로 곱' }[kind],
      shortcutLabel: `Ctrl+Shift+${{ 'row-sum': 'H', 'col-sum': 'V', 'row-avg': 'J', 'col-avg': 'B', 'row-product': 'K', 'col-product': 'N' }[kind]}`,
      canExecute: inCell,
      execute: (s) => easyCalc(s, kind),
    })),
    { id: 'ext:kordoc-bg-each', label: '각 셀마다 적용: 배경', shortcutLabel: 'C', canExecute: inCell, execute: (s) => openBackground(s, doc, 'table:border-each') },
    { id: 'ext:kordoc-bg-one', label: '하나의 셀처럼 적용: 배경', shortcutLabel: 'F', canExecute: inCell, execute: (s) => openBackground(s, doc, 'table:border-one') },
    { id: 'ext:kordoc-cell-width-equal', label: '셀 너비를 같게', shortcutLabel: 'W', canExecute: inCell, execute: (s) => equalWidths(s) },
  );
  for (const [c, [name, color]] of Object.entries(TEXT_COLORS)) {
    out.push({ id: `ext:kordoc-color-${c}`, label: `${name} 글자 색`, shortcutLabel: `Ctrl+M,${c.toUpperCase()}`, canExecute: editable, execute: (s) => s.eventBus.emit('format-char', { textColor: color }) });
  }
  return out;
}

/** 편집기 창(스튜디오 iframe 의 window)에 한컴 키를 건다. 자동화가 없는 스튜디오면 아무것도 하지 않는다 */
export function installHangulKeys(win) {
  const auto = win.rhwpStudio?.automation;
  if (!auto) return false;
  const doc = win.document;
  const mac = /Mac/.test(win.navigator.platform);
  for (const def of extCommands(doc)) {
    try { auto.registerCommand(def); } catch { /* 같은 창에 두 번 걸 때 */ }
  }
  for (const [menuId, commandId] of [['edit', 'ext:kordoc-delete-line'], ['insert', 'ext:kordoc-date'], ['format', 'ext:kordoc-normal-shape']]) {
    try { auto.addMenuItem({ menuId, commandId, position: 'bottom' }); } catch { /* 메뉴가 없는 판 */ }
  }
  for (const [id, label] of Object.entries(MENU_LABELS)) {
    for (const s of doc.querySelectorAll(`.md-item[data-cmd="${id}"] .md-shortcut`)) s.textContent = label;
  }

  // 커서가 표 칸·셀 블록에 있는지는 편집기 서비스에 묻는다 (자동화 명령이 받는 서비스를 한 번 받아 둔다)
  let services = null;
  try {
    auto.registerCommand({ id: 'ext:kordoc-where', label: '커서 자리 읽기', execute: (s) => { services = s; } });
    auto.execute('ext:kordoc-where');
  } catch { /* 같은 창에 두 번 걸 때 */ }
  const where = () => {
    const ih = services?.getInputHandler?.();
    if (!ih) return {};
    const cur = ih.cursor;
    // 머리말·꼬리말·각주를 편집하는 동안에도 본문 커서는 칸에 남아 있다: 그때는 표 키를 쓰지 않는다
    if (cur?.isInHeaderFooter?.() || cur?.isInFootnote?.()) return {};
    const p = ih.getCursorPosition();
    const ctx = ih.getCellTableContext?.();
    // 본문의 한 겹 표 칸만. 글상자(cellIndex 0 + isTextBox)·캡션(65534)·중첩 표는 스튜디오 기본 동작을 둔다
    // (스튜디오의 줄·칸 명령은 바깥 표 번호로 움직여 안쪽 표 대신 바깥 표를 바꾼다)
    const nested = !!ctx && (ctx.cellPath?.length ?? 1) > 1;
    const table = !!ctx && !nested && !p.isTextBox && p.cellIndex !== undefined && p.cellIndex < 65534;
    const object = !!ih.isInTableObjectSelection?.();
    return { cell: table && !object, block: table && !!ih.isInCellSelectionMode?.(), object, nested: nested && !object };
  };

  const state = { chord: null };
  /** 문서 편집 입력 칸 (스튜디오의 숨은 textarea). 대화상자·도구 줄 입력 칸의 키는 스튜디오에 맡긴다 */
  const isEditBox = (t) => t?.getAttribute?.('aria-label') === '문서 편집 입력';
  // 겹글쇠 대기는 마우스를 누르거나 편집 칸을 떠나면 푼다
  win.addEventListener('mousedown', () => { state.chord = null; }, true);
  win.addEventListener('blur', () => { state.chord = null; }, true);
  // 겹글쇠 둘째 글쇠를 한글 입력기가 조합으로 받았으면 그 조합 글자는 문서에 넣지 않는다
  let swallowIme = 0;
  const imeGuard = (e) => {
    // 진짜 입력기 이벤트만 (날짜 넣기처럼 우리가 보내는 input 은 통과), 편집 칸에서만
    if (Date.now() > swallowIme || !e.isTrusted || !isEditBox(e.target)) return;
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
    if (e.target && 'value' in e.target) e.target.value = '';
    if (e.type === 'compositionend') swallowIme = 0;
  };
  for (const t of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) win.addEventListener(t, imeGuard, true);

  win.addEventListener('keydown', (e) => {
    if (!isEditBox(e.target)) { state.chord = null; return; }
    const r = resolveKey(e, state, mac, where());
    if (!r || r.wait) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (r.chord) return;
    if (e.key === 'Process' || e.isComposing || e.keyCode === 229) swallowIme = Date.now() + 800;
    if (!r.commands) return;
    for (const id of r.commands) {
      const res = auto.execute(id, r.params, { allowDialog: true });
      // 지금 쓸 수 없거나(disabled) 이 판에 없는(unregistered) 명령이면 다음 후보로
      if (res?.ok || (res?.reason !== 'disabled' && res?.reason !== 'unregistered')) break;
    }
  }, true);
  return true;
}
