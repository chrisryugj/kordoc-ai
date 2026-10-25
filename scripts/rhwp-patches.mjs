/**
 * 내장 편집기 빌드 때 rhwp-studio 소스에 거는 패치 — 플러그인 허용 목록에 편집기 AI 플러그인('kordoc-ai') 하나를 더한다.
 *
 * 스튜디오는 빌드에 박힌 이름의 플러그인만 올린다(배포판은 hwpctrl 하나, 개발판은 dev-probe 도). 편집기 AI 는
 * 공개 플러그인 계약(src/plugin/types.ts 의 PluginHost: read·transaction·automation·events)만 쓰므로
 * 스튜디오 내부 이름에 기대지 않는다. 고치는 곳은 main.ts 의 개발용 dev-probe 분기 바로 앞 한 줄뿐이다.
 * 글자 그대로 찾아 바꾸고, 자리가 없거나 둘이면 빌드를 멈춘다 (rhwp 를 올려 자리가 바뀌면 여기부터 본다).
 */

export const AI_PLUGIN_ID = 'kordoc-ai';
/** 스튜디오 src 에 복사하는 플러그인 파일 (node-sidecar/studio-plugin) */
export const AI_PLUGIN_FILES = ['kordoc-ai-plugin.mjs', 'kordoc-ai-ops.mjs'];
export const ALLOW_FILE = 'src/main.ts';

const ANCHOR = "  if (import.meta.env.DEV && id === 'dev-probe') {";

export function allowAiPlugin(code) {
  const first = code.indexOf(ANCHOR);
  if (first === -1 || code.indexOf(ANCHOR, first + 1) !== -1) {
    throw new Error(`[rhwp-studio] ${ALLOW_FILE} 에서 플러그인 허용 자리를 찾지 못했습니다. rhwp 판이 바뀌었으면 scripts/rhwp-patches.mjs 를 살피세요`);
  }
  const allow = `  if (id === '${AI_PLUGIN_ID}') {\n    return (await import('./${AI_PLUGIN_FILES[0]}')).aiPlugin as StudioPlugin;\n  }\n`;
  return code.replace(ANCHOR, () => allow + ANCHOR);
}
