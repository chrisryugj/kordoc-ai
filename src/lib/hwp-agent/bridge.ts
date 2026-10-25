/** 편집기 안 AI 플러그인(node-sidecar/studio-plugin/kordoc-ai-plugin.mjs)을 부르는 다리 — 메서드마다 중계 페이지의 agent 동작 하나 */

import type { HwpEditorClient } from "../hwp-editor";

type Place = string;
type Err = { error: string };
type Out<T> = Promise<T | Err>;

/** 플러그인 표면 (연산 인자·결과는 kordoc-ai-ops.mjs) */
export interface AgentBridge {
  outline(a?: { from?: number; count?: number }): Out<{ total: number; from: number; blocks: Array<{ id: Place; text: string; tables?: Array<{ id: Place; rows: number; cols: number }> }> }>;
  readTable(a: { table: Place }): Out<{ table: Place; rows: number; cols: number; cells: Array<Array<string | null>> }>;
  find(a: { text: string }): Out<{ count: number; matches: Array<{ at: Place; cell?: number; offset: number }> }>;
  styles(): Out<Array<{ id: number; name: string; englishName: string; kind: "para" | "char" }>>;
  readStyle(a: { name: string }): Out<Record<string, unknown>>;
  fields(): Out<Array<{ name: string; value: string; guide?: string }>>;
  replace(a: Record<string, unknown>): Out<{ replaced: number }>;
  setParagraph(a: Record<string, unknown>): Out<{ id: Place }>;
  insertParagraphs(a: Record<string, unknown>): Out<{ first: Place; count: number }>;
  deleteParagraphs(a: Record<string, unknown>): Out<{ deleted: number }>;
  fillCells(a: Record<string, unknown>): Out<{ filled: number }>;
  addRows(a: Record<string, unknown>): Out<{ rows: number }>;
  removeRows(a: Record<string, unknown>): Out<{ rows: number }>;
  insertTable(a: Record<string, unknown>): Out<{ table: Place; rows: number; cols: number }>;
  formatText(a: Record<string, unknown>): Out<{ id: Place }>;
  formatParagraphs(a: Record<string, unknown>): Out<{ count: number }>;
  applyStyle(a: Record<string, unknown>): Out<{ count: number; style: string }>;
  createStyle(a: Record<string, unknown>): Out<{ name: string; kind: string }>;
  editStyle(a: Record<string, unknown>): Out<{ name: string }>;
  fillField(a: Record<string, unknown>): Out<{ name: string }>;
  insertFootnote(a: Record<string, unknown>): Out<{ id: Place; number: number }>;
  foreignChanges(): Promise<number>;
  undo(count: number, since: number): Promise<{ ok: boolean; reason?: string }>;
  reveal(place: Place): Promise<boolean>;
}

export function createAgentBridge(call: HwpEditorClient["call"]): AgentBridge {
  return new Proxy({} as AgentBridge, {
    get: (_t, method) => typeof method === "string"
      ? async (...args: unknown[]) => (await call("agent", { method, args })).result
      : undefined,
  });
}

export const isErr = (r: unknown): r is Err => !!r && typeof r === "object" && "error" in r && typeof (r as Err).error === "string";
