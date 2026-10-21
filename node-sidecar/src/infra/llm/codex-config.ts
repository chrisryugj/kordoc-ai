/** Codex app-server 를 띄울 때의 설정 — 사용자 config.toml 덮어쓰기, 도구·MCP 가 꺼졌는지 확인, 스레드 권한
 *
 * 이음오피스 packages/ai-provider/src/codex-app-server.ts(Apache-2.0, 커밋 9bda9ac)의 CODEX_CONFIG_OVERRIDES·codexMcpServerOverrides·
 * codexAttachedMcpServers·codexThreadStartParams 에서 옮김. 바꾼 곳: Codex 자신의 도구(features.*)·웹 검색·프로젝트 지침 파일 등을
 * 덮어쓰기에 더하고 그것이 먹었는지 config/read 로 확인(codexToolProblems), MCP 상태 칸이 없으면 붙은 것으로 봄. (codex.ts 에서 나눔)
 */

export const CLIENT_NAME = 'kordoc-ai';
export const PERMISSION_PROFILE = 'kordoc';
export const BASE_INSTRUCTIONS = '당신은 KorDoc AI 에 들어 있는 언어 모델 뒷단입니다. 로컬 파일을 보거나 고치지 않고, 셸 명령을 실행하지 않고, 웹을 보지 않고, MCP·앱·Codex 내장 도구를 부르지 않습니다. 호출하는 앱이 필요한 대화를 모두 주므로 글로만 답합니다.';

/** app-server 가 사용자 config.toml 에서 끌어올 수 있는 것을 하나씩 덮는다. `--disable 모르는이름` 은 시작을 막아 -c features.<이름>=false 로 */
export const CODEX_CONFIG_OVERRIDES: readonly string[] = [
  'features.hooks=false',
  'features.plugins=false',
  'features.apps=false',
  'features.memories=false',
  'notify=[]',
  'history.persistence="none"',
  'model_provider="openai"',
  'openai_base_url=""',
  'skills.include_instructions=false',
  // Codex 자신의 도구를 뿌리에서 끈다 (이름은 codex 0.163 `codex features list` 로 확인).
  // 끄지 않으면 프롬프트 주입된 문서가 셸 명령을 실제로 돌린다(실측: read-only 샌드박스에서 명령 실행, 쓰기만 막힘)
  'features.shell_tool=false',
  'features.unified_exec=false',
  'features.unified_exec_tty=false',
  'features.shell_snapshot=false',
  'features.view_image=false',
  'features.image_generation=false',
  'features.browser_use=false',
  'features.browser_use_external=false',
  'features.in_app_browser=false',
  'features.computer_use=false',
  'features.multi_agent=false',
  'features.multi_agent_v2=false',
  'features.tool_suggest=false',
  'features.skill_search=false',
  'features.skill_mcp_dependency_install=false',
  'features.sleep_tool=false',
  'features.goals=false',
  'features.worktrees=false',
  'features.remote_plugin=false',
  'features.realtime_conversation=false',
  'web_search="disabled"',
  // 사용자 설정이 대화에 끼어들지 않게 (프로젝트 지침 파일·환경 설명·추론 강도·개발자 지시)
  'project_doc_max_bytes=0',
  'project_doc_fallback_filenames=[]',
  'include_environment_context=false',
  'include_permissions_instructions=false',
  'include_apps_instructions=false',
  'include_collaboration_mode_instructions=false',
  'developer_instructions=""',
  'personality="none"',
  'model_reasoning_effort="medium"',
];

/** 이 도구 기능이 config/read 에 켜져 보이면 보내지 않는다. shell_tool 은 꺼졌다고 보여야만(낮은 버전은 이름을 몰라 끌 수 없음) */
export const CODEX_TOOL_FEATURES: readonly string[] = ['shell_tool', 'unified_exec', 'unified_exec_tty', 'view_image', 'image_generation', 'browser_use', 'browser_use_external', 'in_app_browser', 'computer_use', 'multi_agent', 'multi_agent_v2'];

/** 덮어쓰기가 실제로 먹었는지 — Codex가 돌려준 설정(config/read)으로 확인. 문제가 없으면 빈 배열 (실패하면 보내지 않는다) */
export function codexToolProblems(configRead: unknown): string[] {
  const config = obj(obj(configRead)?.config);
  if (!config) return ['설정을 알려 주지 않음'];
  const features = obj(config.features) ?? {};
  const out: string[] = [];
  if (features.shell_tool !== false) out.push('셸 도구를 끌 수 없음');
  for (const f of CODEX_TOOL_FEATURES) if (f !== 'shell_tool' && f in features && features[f] !== false) out.push(`${f} 켜짐`);
  if (config.web_search !== 'disabled') out.push('웹 검색을 끌 수 없음');
  return out;
}

export function codexAppServerArgs(): string[] {
  return ['app-server', ...CODEX_CONFIG_OVERRIDES.flatMap((o) => ['-c', o]), '--listen', 'stdio://'];
}

export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);

export type McpOverrides = Record<string, { enabled: false }>;

/** config/read 가 알려 준 MCP 서버를 이름으로 모두 끄는 스레드 설정 (이름만 읽고 명령·환경은 보지 않는다) */
export function codexMcpServerOverrides(configRead: unknown): McpOverrides {
  const config = obj(obj(configRead)?.config);
  if (!config) throw new Error('no config');
  return Object.fromEntries(Object.keys(obj(config.mcp_servers) ?? {}).map((n) => [n, { enabled: false as const }]));
}

/** mcpServerStatus/list 에서 이 스레드가 쓸 수 있는 서버 (disabled 아닌 것, 도구가 있는 것). 목록 모양이 아니면 throw */
export function codexAttachedMcpServers(statusList: unknown): string[] {
  const data = obj(statusList)?.data;
  if (!Array.isArray(data)) throw new Error('no list');
  return data.flatMap((v) => {
    const e = obj(v);
    if (!e) throw new Error('bad entry');
    // disabled 라고 밝힌 것만 꺼진 것으로 본다 (상태 칸이 없으면 붙은 것으로)
    const enabled = e.runtimeStatus !== 'disabled';
    return enabled || Object.keys(obj(e.tools) ?? {}).length ? [typeof e.name === 'string' ? e.name : ''] : [];
  });
}

/** 권한 프로필(읽기는 플랫폼 경로 + 이번 임시 폴더) 또는 그게 안 될 때의 read-only 샌드박스 */
export function codexThreadStartParams(model: string, tempDir: string, mode: 'profile' | 'read-only', mcp: McpOverrides = {}): Obj {
  const base = { model, cwd: tempDir, approvalPolicy: 'never', serviceName: CLIENT_NAME, baseInstructions: BASE_INSTRUCTIONS, ephemeral: true };
  const mcpCfg = Object.keys(mcp).length ? { mcp_servers: mcp } : undefined;
  if (mode === 'read-only') return { ...base, sandbox: 'read-only', ...(mcpCfg ? { config: mcpCfg } : {}) };
  return { ...base, config: { default_permissions: PERMISSION_PROFILE, permissions: { [PERMISSION_PROFILE]: { filesystem: { ':minimal': 'read', [tempDir]: 'read' } } }, ...mcpCfg } };
}

