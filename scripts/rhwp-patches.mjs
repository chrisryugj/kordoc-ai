/**
 * 내장 편집기 빌드 때 rhwp-studio 소스에 거는 패치와, 앱 플러그인이 기대는 스튜디오 내부 이름 점검.
 *
 * - 플러그인 허용: 스튜디오는 빌드에 박힌 이름의 플러그인만 올린다(배포판은 hwpctrl 하나). 편집기 AI 의 도구는
 *   앱 플러그인(node-sidecar/studio-plugin/agent-plugin.mjs, 'kordoc-agent')이라 그 이름 하나를 더한다.
 * - 플러그인은 커서·선택·쪽 위치·확대율을 스튜디오 내부 이름으로 쓴다(계약이 아님). 판이 바뀌어 이름이 사라지면
 *   기능이 조용히 꺼지지 않게 빌드를 멈춘다.
 * 정확한 글 바꾸기라 원본이 바뀌면 큰 소리로 실패한다. 목록은 이음오피스(Apache-2.0) apps/hwp/scripts/rhwp-patches.mjs 에서 옮겼다.
 */

export const AGENT_PLUGIN_ID = 'kordoc-agent';
/** 스튜디오 src 안에 복사해 둘 플러그인 파일 이름 */
export const AGENT_PLUGIN_FILE = 'kordoc-agent-plugin.mjs';

const PLUGIN_ALLOW = {
  file: 'src/main.ts',
  find: "  if (import.meta.env.DEV && id === 'dev-probe') {",
  replace:
    `  if (id === '${AGENT_PLUGIN_ID}') {\n` +
    `    return (await import('./${AGENT_PLUGIN_FILE}')).agentPlugin as StudioPlugin;\n` +
    '  }\n' +
    "  if (import.meta.env.DEV && id === 'dev-probe') {",
};

/** 한 번만 나오는 글을 바꾼다 — 없거나 둘 이상이면 실패 */
export function applyPluginAllow(code) {
  const first = code.indexOf(PLUGIN_ALLOW.find);
  if (first === -1 || code.indexOf(PLUGIN_ALLOW.find, first + 1) !== -1) {
    throw new Error('[rhwp-studio] 플러그인 허용 패치 자리를 찾지 못했습니다 — rhwp 판이 바뀌었으면 scripts/rhwp-patches.mjs 를 살피세요');
  }
  return code.replace(PLUGIN_ALLOW.find, PLUGIN_ALLOW.replace);
}
export const PLUGIN_ALLOW_FILE = PLUGIN_ALLOW.file;

/** 플러그인이 쓰는 스튜디오 내부 이름 (rhwp-studio 기준 경로) */
const PLUGIN_HOOKS = [
  {
    file: 'src/engine/cursor.ts',
    needles: [
      'hasSelection(): boolean', 'getSelectionOrdered()', 'clearSelection(): void', 'moveTo(pos: DocumentPosition): void',
      'setAnchor(): void', 'getPosition(): DocumentPosition', 'isInCellSelectionMode(): boolean', 'getSelectedCellRange()',
      'getCellTableContext()', 'getExcludedCells()',
    ],
  },
  { file: 'src/engine/input-handler.ts', needles: ['private cursor: CursorState', 'updateCaret(', 'private virtualScroll: VirtualScroll'] },
  {
    file: 'src/command/types.ts',
    needles: [
      'getInputHandler: () => InputHandler | null', 'getViewportManager: () => ViewportManager | null',
      'execute: (services: CommandServices, params?: Record<string, unknown>) => void',
    ],
  },
  { file: 'src/view/virtual-scroll.ts', needles: ['getPageOffset(pageIdx: number): number', 'getPageLeftResolved(pageIdx: number, containerWidth: number): number'] },
  { file: 'src/view/viewport-manager.ts', needles: ['getZoom(): number'] },
  { file: 'index.html', needles: ['<div id="scroll-content"></div>'] },
  { file: 'src/automation/types.ts', needles: ['registerCommand(def: ExtCommandDef): void'] },
];

/** 소스에 없는 이름들. read(file) 은 rhwp-studio 기준 파일 글(없으면 null) */
export function missingPluginHooks(read) {
  const missing = [];
  for (const { file, needles } of PLUGIN_HOOKS) {
    const text = read(file);
    for (const needle of needles) if (text === null || !text.includes(needle)) missing.push(`${file}: ${needle}`);
  }
  return missing;
}
