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
 * { swallow: true } 겹글쇠 둘째 자리의 모르는 글쇠(문서에 들어가지 않게 삼킴) · null 스튜디오에 맡김
 */
export function resolveKey(e, state, mac = false) {
  const name = keyName(e);
  const ctrl = e.ctrlKey || (mac && e.metaKey);
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
    const r = resolveKey(e, state, mac);
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
