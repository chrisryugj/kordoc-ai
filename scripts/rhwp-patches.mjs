/**
 * 내장 편집기 빌드 때 rhwp-studio 소스에 거는 패치와, 앱 플러그인·한컴 키가 기대는 스튜디오 내부 이름 점검.
 * 모두 글자 그대로 찾아 바꾸고, 못 찾거나 두 번 나오면 빌드를 멈춘다(rhwp 를 올려도 조용히 빠지지 않게).
 *
 * - studio-plugin-allow: 스튜디오는 빌드에 박힌 이름의 플러그인만 올린다(배포판은 hwpctrl 하나). 편집기 AI 의 도구인
 *   앱 플러그인(node-sidecar/studio-plugin/agent-plugin.mjs, 'kordoc-agent') 이름 하나를 더한다.
 * - studio-table-delete-at·nested-table-*: 표 칸 안의 표(칸마다 표가 든 서식)를 고르고 Delete·잘라내기를 누르면
 *   아무 일도 없고, 칸 메뉴의 "표 지우기"는 바깥 표를 통째로 지웠다. 브리지에 deleteTableAt 하나를 더하고 세 길이 그걸 부른다.
 * - studio-hancom-*: 한글 편집기 단축키를 한컴 한글 2024 기본 키로(node-sidecar/studio-plugin/hancom-keys.mjs).
 *   단축키 표를 그 자리에서 고치고, 메뉴에 새 키를 보이고, 새 명령(한 줄 지우기·글자색·스타일 1~10·보통 모양·날짜·
 *   거꾸로 찾기·표 쉬운 계산식·쪽 번호 매기기)을 등록하고, 연속키(Ctrl+N·K·Q·M·G)를 넘긴다. 쪽 번호 매기기는
 *   패치한 엔진(vendor/rhwp-core 0014)의 호출 둘을 브리지에 더한다.
 * - studio-font-memo-*: 스튜디오는 캔버스 font 를 설정할 때마다 대체 글꼴 목록을 새로 만든다. 쪽 하나를 그릴 때 같은
 *   글꼴 이름이 수천 번 와서 글자 하나 칠 때 드는 시간 대부분이 여기였다. 다음 마이크로태스크까지만 답을 기억한다.
 *
 * 패치 목록·한컴 키·내부 이름 목록은 이음오피스(Apache-2.0) apps/hwp/scripts/rhwp-patches.mjs(커밋 63e2a636)에서 옮겼다.
 * 그쪽의 사용자 정의 스킴·암호 문서 표시 패치는 뺐다(편집기를 127.0.0.1 HTTP 로 띄우고, 저장은 앱이 쥔다).
 */

import { studioCommandIds } from '../node-sidecar/studio-plugin/hancom-keys.mjs';

export const AGENT_PLUGIN_ID = 'kordoc-agent';
/** 스튜디오 src 안에 복사해 둘 파일 이름 */
export const AGENT_PLUGIN_FILE = 'kordoc-agent-plugin.mjs';
export const HANCOM_KEYS_FILE = 'kordoc-hancom-keys.mjs';
/** 패치가 가져오는 한컴 키 모듈 (스튜디오 vite 설정의 '@' = src). hancom-keys.mjs 의 HANCOM_KEYS_MODULE 과 같아야 한다 */
const HANCOM = `@/${HANCOM_KEYS_FILE}`;

const PATCHES = {
  'studio-plugin-allow': {
    file: 'src/main.ts',
    find: "  if (import.meta.env.DEV && id === 'dev-probe') {",
    replace:
      `  if (id === '${AGENT_PLUGIN_ID}') {\n` +
      `    return (await import('./${AGENT_PLUGIN_FILE}')).agentPlugin as StudioPlugin;\n` +
      '  }\n' +
      "  if (import.meta.env.DEV && id === 'dev-probe') {",
  },
  'studio-table-delete-at': {
    file: 'src/core/wasm-bridge.ts',
    find: [
      '  deleteTableControl(sec: number, parentPara: number, controlIdx: number): { ok: boolean } {',
      "    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');",
      '    return JSON.parse(this.doc.deleteTableControl(sec, parentPara, controlIdx));',
      '  }',
      '',
    ].join('\n'),
    replace: [
      '  deleteTableControl(sec: number, parentPara: number, controlIdx: number): { ok: boolean } {',
      "    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');",
      '    return JSON.parse(this.doc.deleteTableControl(sec, parentPara, controlIdx));',
      '  }',
      '',
      '  /** 선택·커서가 가리키는 표: 본문 표, 또는 (경로가 둘 이상이면) 칸 안의 가장 안쪽 표 */',
      '  deleteTableAt(ref: { sec: number; ppi: number; ci: number; cellPath?: CellPathEntry[] }): { ok: boolean } {',
      '    const path = ref.cellPath ?? [];',
      '    if (path.length < 2) return this.deleteTableControl(ref.sec, ref.ppi, ref.ci);',
      "    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');",
      '    return JSON.parse(this.doc.deleteCellTableControlByPath(',
      '      ref.sec, ref.ppi, JSON.stringify(path.slice(0, -1)), path[path.length - 1].controlIndex,',
      '    ));',
      '  }',
      '',
    ].join('\n'),
  },
  'studio-nested-table-delete': {
    file: 'src/engine/input-handler.ts',
    find: [
      '      if (ref.cellPath && ref.cellPath.length > 1) {',
      '        this.cursor.moveOutOfSelectedTable();',
      "        this.eventBus.emit('table-object-selection-changed', false);",
      '        this.updateCaret();',
      '        return;',
      '      }',
      '      this.cursor.moveOutOfSelectedTable();',
      "      this.eventBus.emit('table-object-selection-changed', false);",
      "      this.executeOperation({ kind: 'snapshot', operationType: 'deleteTable', operation: (wasm: WasmBridge) => {",
      '        wasm.deleteTableControl(ref.sec, ref.ppi, ref.ci);',
    ].join('\n'),
    replace: [
      '      this.cursor.moveOutOfSelectedTable();',
      "      this.eventBus.emit('table-object-selection-changed', false);",
      "      this.executeOperation({ kind: 'snapshot', operationType: 'deleteTable', operation: (wasm: WasmBridge) => {",
      '        wasm.deleteTableAt(ref);',
    ].join('\n'),
  },
  'studio-nested-table-cut': {
    file: 'src/engine/input-handler.ts',
    find: [
      '        // 중첩 표 잘라내기는 지원하지 않는다. keydown 경로도 같은 선택 상태를 유지한다.',
      '        if (ref.cellPath && ref.cellPath.length > 1) return;',
      '        this.performCopy();',
      '        this.cursor.moveOutOfSelectedTable();',
      "        this.eventBus.emit('table-object-selection-changed', false);",
      "        this.executeOperation({ kind: 'snapshot', operationType: 'cutTable', operation: (wasm: WasmBridge) => {",
      '          wasm.deleteTableControl(ref.sec, ref.ppi, ref.ci);',
    ].join('\n'),
    replace: [
      '        this.performCopy();',
      '        this.cursor.moveOutOfSelectedTable();',
      "        this.eventBus.emit('table-object-selection-changed', false);",
      "        this.executeOperation({ kind: 'snapshot', operationType: 'cutTable', operation: (wasm: WasmBridge) => {",
      '          wasm.deleteTableAt(ref);',
    ].join('\n'),
  },
  'studio-nested-table-command': {
    file: 'src/command/commands/table.ts',
    find: [
      '      const ref = ih.getSelectedTableRef();',
      '      if (ref) {',
      '        safeTableOp(() => ih.executeOperation({',
      "          kind: 'snapshot',",
      "          operationType: 'deleteTable',",
    ].join('\n'),
    replace: [
      '      const ref = ih.getSelectedTableRef();',
      '      // 칸 안의 표: 고른 표는 Delete 와 같은 길로, 커서에서는 바깥 표가 아니라 커서가 든 표를 지운다',
      '      if ((ref?.cellPath?.length ?? 0) > 1) {',
      '        ih.performDelete();',
      '        return;',
      '      }',
      '      const at = ih.getCursorPosition();',
      '      if (!ref && at.parentParaIndex !== undefined && at.controlIndex !== undefined && (at.cellPath?.length ?? 0) > 1) {',
      '        const outer = at.cellPath!.slice(0, -1);',
      '        const cell = outer[outer.length - 1];',
      '        safeTableOp(() => ih.executeOperation({',
      "          kind: 'snapshot',",
      "          operationType: 'deleteTable',",
      '          operation: (wasm) => {',
      '            wasm.deleteTableAt({ sec: at.sectionIndex, ppi: at.parentParaIndex!, ci: at.controlIndex!, cellPath: at.cellPath });',
      '            return {',
      '              sectionIndex: at.sectionIndex,',
      '              paragraphIndex: cell.cellParaIndex,',
      '              charOffset: 0,',
      '              parentParaIndex: at.parentParaIndex,',
      '              controlIndex: outer[0].controlIndex,',
      '              cellIndex: cell.cellIndex,',
      '              cellParaIndex: cell.cellParaIndex,',
      '              cellPath: outer,',
      '              isTextBox: at.isTextBox && outer.length === 1 ? true : undefined,',
      '            };',
      '          },',
      "        }), '표 지우기');",
      '        return;',
      '      }',
      '      if (ref) {',
      '        safeTableOp(() => ih.executeOperation({',
      "          kind: 'snapshot',",
      "          operationType: 'deleteTable',",
    ].join('\n'),
  },
  'studio-hancom-shortcuts': {
    file: 'src/command/shortcut-map.ts',
    // 표의 마지막 항목 뒤 (import 는 모듈 최상위 어디에 있어도 된다)
    find: "  [{ key: 'p', ctrl: true, shift: true }, 'table:block-product'],\n];",
    replace:
      "  [{ key: 'p', ctrl: true, shift: true }, 'table:block-product'],\n];\n\n" +
      `import { adaptToHancom } from '${HANCOM}';\n` +
      'adaptToHancom(defaultShortcuts);',
  },
  'studio-hancom-labels': {
    file: 'src/command/registry.ts',
    edits: [
      {
        find: "import type { CommandDef } from './types';",
        replace: "import type { CommandDef } from './types';\n" + `import { withHancomLabel } from '${HANCOM}';`,
      },
      { find: '    this.commands.set(def.id, def);', replace: '    this.commands.set(def.id, withHancomLabel(def));' },
    ],
  },
  'studio-hancom-commands': {
    file: 'src/main.ts',
    edits: [
      {
        find: "import { initI18n, t } from '@/i18n/index.ts';",
        replace:
          "import { initI18n, t } from '@/i18n/index.ts';\n" +
          "import { getLocale } from '@/i18n/core.ts';\n" +
          "import { InsertTextCommand } from '@/engine/command';\n" +
          "import { ModalDialog } from '@/ui/dialog';\n" +
          "import { FindDialog, navigateToSearchHit } from '@/ui/find-dialog';\n" +
          `import { hancomCommands, installHancomMainKeys, installHancomMenuItems } from '${HANCOM}';`,
      },
      {
        find: 'registry.registerAll(toolCommands);',
        replace:
          'registry.registerAll(toolCommands);\n' +
          'registry.registerAll(hancomCommands(getLocale(), {\n' +
          '  InsertTextCommand, ModalDialog, FindDialog, navigateToSearchHit,\n' +
          '}));\n' +
          'installHancomMenuItems(document, getLocale());\n' +
          'installHancomMainKeys(window, () => inputHandler, dispatcher);',
      },
    ],
  },
  'studio-hancom-page-number': {
    file: 'src/core/wasm-bridge.ts',
    find: '  applyStyle(sec: number, para: number, styleId: number): { ok: boolean } {',
    replace: [
      '  /** 구역의 쪽 번호 (한글: 쪽 번호 매기기). 구역에 있던 것을 바꾼다 */',
      '  setPageNumberPos(sec: number, format: number, position: number, dash: boolean): string {',
      "    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');",
      '    return (this.doc as any).setPageNumberPos(sec, format, position, dash);',
      '  }',
      '',
      '  getPageNumberPos(sec: number): string {',
      "    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');",
      '    return (this.doc as any).getPageNumberPos(sec);',
      '  }',
      '',
      '  applyStyle(sec: number, para: number, styleId: number): { ok: boolean } {',
    ].join('\n'),
  },
  'studio-hancom-chords': {
    file: 'src/engine/input-handler-keyboard.ts',
    edits: [
      {
        find: "import { matchShortcut, defaultShortcuts } from '@/command/shortcut-map';",
        replace:
          "import { matchShortcut, defaultShortcuts } from '@/command/shortcut-map';\n" +
          `import { hancomChordKey, hancomChordStart, hancomContextKey, hancomCtrlKey } from '${HANCOM}';`,
      },
      // 연속키의 둘째 키를 가장 먼저 (스튜디오의 Ctrl+K/M/G 표지는 다시 서지 않는다)
      { find: '  this._cellBlockLetterImeGuard?.reset();', replace: '  this._cellBlockLetterImeGuard?.reset();\n  if (hancomChordKey(this, e)) return;' },
      // 입력기 조합 중의 첫 키·커서 자리에 따라 뜻이 바뀌는 키 (스튜디오는 여기서 Ctrl+M 만 받았다)
      {
        find: [
          "    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyM') {",
          '      e.preventDefault();',
          '      this._pendingChordM = true;',
          '      return;',
          '    }',
        ].join('\n'),
        replace: '    if (hancomCtrlKey(this, e)) return;',
      },
      // 커서 자리에 따라 뜻이 바뀌는 키를 스튜디오 단축키 표보다 먼저
      {
        find: ['    this.commandPalette?.open();', '    return;', '  }'].join('\n'),
        replace: ['    this.commandPalette?.open();', '    return;', '  }', '  if (hancomContextKey(this, e)) return;'].join('\n'),
      },
      // 그 밖의 첫 키를 스튜디오의 Ctrl+K/M/G 보다 먼저
      {
        find: "  if ((e.key === 'k' || e.key === 'K' || e.key === 'ㅏ') && !e.shiftKey && !e.altKey) {",
        replace: "  if (hancomChordStart(this, e)) return;\n  if ((e.key === 'k' || e.key === 'K' || e.key === 'ㅏ') && !e.shiftKey && !e.altKey) {",
      },
    ],
  },
  'studio-font-memo-state': {
    file: 'src/core/wasm-bridge.ts',
    find: 'let canvasFontSubstitutionInstalled = false;',
    replace: [
      'let canvasFontSubstitutionInstalled = false;',
      '',
      '// 글꼴 이름마다 답 하나를 다음 마이크로태스크까지: 쪽 하나를 그릴 때 같은 이름이 수천 번 오고,',
      '// 답이 기대는 것(찾은 PC 글꼴·문서의 글꼴 대체 표)은 비동기 단계 사이에만 바뀐다',
      'let canvasFontMemo: Map<string, string> | null = null;',
      'function memoSubstituteCssFontFamily(cssFont: string): string {',
      '  if (!canvasFontMemo) {',
      '    canvasFontMemo = new Map();',
      '    queueMicrotask(() => { canvasFontMemo = null; });',
      '  }',
      '  let out = canvasFontMemo.get(cssFont);',
      '  if (out === undefined) {',
      '    out = substituteCssFontFamily(cssFont);',
      '    canvasFontMemo.set(cssFont, out);',
      '  }',
      '  return out;',
      '}',
    ].join('\n'),
  },
  'studio-font-memo-use': {
    file: 'src/core/wasm-bridge.ts',
    find: 'descriptor.set!.call(this, scopedHostCanvasFont(String(value)) ?? substituteCssFontFamily(String(value)));',
    replace: 'descriptor.set!.call(this, scopedHostCanvasFont(String(value)) ?? memoSubstituteCssFontFamily(String(value)));',
  },
};

/** 빌드가 거는 패치, 차례대로 */
export const STUDIO_PATCHES = [
  'studio-plugin-allow',
  'studio-table-delete-at',
  'studio-nested-table-delete',
  'studio-nested-table-cut',
  'studio-nested-table-command',
  'studio-hancom-shortcuts',
  'studio-hancom-labels',
  'studio-hancom-commands',
  'studio-hancom-chords',
  'studio-hancom-page-number',
  'studio-font-memo-state',
  'studio-font-memo-use',
];

/** 패치가 고치는 파일들 (rhwp-studio 기준) — 빌드는 캐시된 소스를 이 파일들만 원본으로 되돌린 뒤 건다 */
export const PATCHED_FILES = [...new Set(STUDIO_PATCHES.map((n) => PATCHES[n].file))];

/** 파일 글에 그 파일을 고치는 패치를 차례로 건다. 찾을 글이 없거나 둘 이상이면 실패 */
export function patchFile(file, code) {
  // Windows 에서 받은 소스는 CRLF 일 수 있다. 패치는 LF 로 썼다
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  let next = code;
  for (const name of STUDIO_PATCHES) {
    const patch = PATCHES[name];
    if (patch.file !== file) continue;
    for (const edit of patch.edits ?? [patch]) {
      const find = edit.find.replaceAll('\n', eol);
      const first = next.indexOf(find);
      if (first === -1 || next.indexOf(find, first + 1) !== -1) {
        throw new Error(`[rhwp-studio] 패치 ${name} 자리를 찾지 못했습니다 (${file}). rhwp 판이 바뀌었으면 scripts/rhwp-patches.mjs 를 살피세요`);
      }
      next = next.replace(find, () => edit.replace.replaceAll('\n', eol));
    }
  }
  return next;
}

/** 앱 플러그인이 쓰는 스튜디오 내부 이름 (화면 이동·선택 읽기·낱말 선택·바뀐 곳 표시·도구 줄 스타일 목록) */
const PLUGIN_HOOKS = [
  {
    file: 'src/engine/cursor.ts',
    needles: [
      'hasSelection(): boolean', 'getSelectionOrdered()', 'clearSelection(): void', 'moveTo(pos: DocumentPosition): void',
      'setAnchor(): void', 'getPosition(): DocumentPosition', 'isInCellSelectionMode(): boolean', 'getSelectedCellRange()',
      'getCellTableContext()', 'getExcludedCells()',
    ],
  },
  { file: 'src/engine/input-handler.ts', needles: ['private cursor: CursorState', 'updateCaret(', 'private virtualScroll: VirtualScroll', 'private emitCursorFormatState(): void'] },
  {
    file: 'src/command/types.ts',
    needles: [
      'getInputHandler: () => InputHandler | null', 'getViewportManager: () => ViewportManager | null',
      'execute: (services: CommandServices, params?: Record<string, unknown>) => void',
    ],
  },
  // 플러그인이 스타일이 바뀐 뒤 다시 채우는 도구 줄 스타일 목록: 값은 스타일 번호, 커서 자리의 번호를 보이고, 고르면 번호로 건다
  {
    file: 'src/ui/toolbar.ts',
    needles: ["querySelector('#style-name')", 'opt.value = String(style.id)', 'this.styleName.value = String(info.id)', 'const styleId = parseInt(this.styleName.value)'],
  },
  { file: 'src/view/virtual-scroll.ts', needles: ['getPageOffset(pageIdx: number): number', 'getPageLeftResolved(pageIdx: number, containerWidth: number): number'] },
  { file: 'src/view/viewport-manager.ts', needles: ['getZoom(): number'] },
  { file: 'index.html', needles: ['<div id="scroll-content"></div>'] },
  { file: 'src/automation/types.ts', needles: ['registerCommand(def: ExtCommandDef): void'] },
];

/** 한컴 키 모듈(hancom-keys.mjs)이 쓰는 스튜디오 내부 이름 */
const HANCOM_HOOKS = [
  {
    file: 'src/engine/cursor.ts',
    needles: [
      'moveToLineStart(): void', 'moveToLineEnd(): void', 'moveHorizontal(delta: number): void',
      'getSelection(): { anchor: DocumentPosition; focus: DocumentPosition } | null', 'isInHeaderFooter(): boolean',
      'isInFootnote(): boolean', 'isInPictureObjectSelection(): boolean', 'isInTableObjectSelection(): boolean',
    ],
  },
  {
    file: 'src/engine/input-handler.ts',
    needles: [
      'private dispatcher: CommandDispatcher | null', 'private _cellBlockLetterImeGuard = new CellBlockLetterImeGuard()',
      'private deleteSelection(', 'applyStyle(styleId: number): void', 'executeOperation(desc: OperationDescriptor): void',
      'isFormMode(): boolean', "eventBus.on('format-char'",
    ],
  },
  { file: 'src/command/dispatcher.ts', needles: ['dispatch(commandId: string', 'isEnabled(commandId: string): boolean'] },
  { file: 'src/command/contextual-shortcut.ts', needles: ['arm('] },
  {
    file: 'src/core/wasm-bridge.ts',
    needles: [
      'getStyleList(): Array<{ id: number', 'evaluateTableFormula(sec: number, parentPara: number, controlIdx: number,',
      'getCellParagraphCount(sec: number, parentPara: number, controlIdx: number, cellIdx: number)',
      'getCellParagraphLength(sec: number, parentPara: number, controlIdx: number, cellIdx: number, cellParaIdx: number)',
      'getCellInfo(sec: number, parentPara: number, controlIdx: number, cellIdx: number): CellInfo',
      'searchText(query: string, fromSec: number, fromPara: number, fromChar: number, forward: boolean',
    ],
  },
  { file: 'src/ui/dialog.ts', needles: ['export abstract class ModalDialog', 'protected abstract createBody(): HTMLElement;', 'protected abstract onConfirm(): void | boolean;'] },
  { file: 'src/ui/find-dialog.ts', needles: ["static lastQuery = '';", 'static lastCaseSensitive = false;', 'export function navigateToSearchHit('] },
  { file: 'src/engine/command.ts', needles: ['export class InsertTextCommand'] },
  { file: 'src/main.ts', needles: ['let inputHandler: InputHandler | null = null;', 'const dispatcher = new CommandDispatcher('] },
  {
    // adaptToHancom 이 빼는 항목(REMOVED_SHORTCUTS), 스튜디오가 쓴 그대로
    file: 'src/command/shortcut-map.ts',
    needles: [
      "[{ key: 'y', ctrl: true }, 'edit:redo']", "[{ key: 'h', alt: true, shift: true }, 'format:align-right']",
      "[{ key: 'ㅗ', alt: true, shift: true }, 'format:align-right']", "[{ key: 'c', alt: true, shift: true }, 'format:align-center']",
      "[{ key: 'ㅊ', alt: true, shift: true }, 'format:align-center']", "[{ key: 'd', alt: true, shift: true }, 'format:align-distribute']",
      "[{ key: 'ㅇ', alt: true, shift: true }, 'format:align-distribute']", "[{ key: '0', ctrl: true }, 'view:zoom-100']",
    ],
  },
];

/** 소스에 없는 이름들. read(file) 은 rhwp-studio 기준 파일 글(없으면 null) */
export function missingPluginHooks(read) {
  const missing = [];
  for (const { file, needles } of [...PLUGIN_HOOKS, ...HANCOM_HOOKS]) {
    const text = read(file);
    for (const needle of needles) if (text === null || !text.includes(needle)) missing.push(`${file}: ${needle}`);
  }
  return missing;
}

/** 한컴 키가 부르는데 스튜디오 명령 소스(src/command/commands 전체 글)에 없는 명령 */
export function missingHancomCommands(sources) {
  // 번호 붙은 명령은 `view:zoom-${pct}` 처럼 틀로 만들 수 있다
  const named = (id) => sources.includes(`'${id}'`) || (/-\d+$/.test(id) && sources.includes('`' + id.replace(/\d+$/, '${')));
  return studioCommandIds().filter((id) => !named(id));
}
