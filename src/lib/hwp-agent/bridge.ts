/** 편집기 안 앱 플러그인(node-sidecar/studio-plugin/agent-plugin.mjs)을 부르는 다리 — 메서드마다 중계 페이지의 agent 동작 하나 */

import type { AgentPluginSurface } from "../../../node-sidecar/studio-plugin/agent-plugin.mjs";
import type { HwpEditorClient } from "../hwp-editor";

export type AgentBridge = {
  [K in keyof AgentPluginSurface]: (...args: Parameters<AgentPluginSurface[K]>) => Promise<Awaited<ReturnType<AgentPluginSurface[K]>>>;
};

export function createAgentBridge(call: HwpEditorClient["call"]): AgentBridge {
  return new Proxy({} as AgentBridge, {
    get: (_t, method) => typeof method === "string"
      ? async (...args: unknown[]) => (await call("agent", { method, args })).result
      : undefined,
  });
}
