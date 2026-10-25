/**
 * 편집기 AI 의 도구 — 모델이 보는 도구 정의·지시문·문서 문맥과, 도구 호출을 편집기 플러그인 연산으로 옮기는 실행부.
 * 연산은 node-sidecar/studio-plugin/kordoc-ai-ops.mjs, 다리는 bridge.ts.
 */

import { isErr, type AgentBridge } from "./bridge";
import type { AgentSkill, AgentToolCall, AgentToolDef, ExecutedToolCall, ToolExecution } from "./types";

/** 문맥에 싣는 문단 수와 문단 글 길이 (로컬 모델의 짧은 맥락을 넘지 않게) */
const CONTEXT_PARAS = 80;
const CONTEXT_CHARS = 160;

const SYSTEM = [
  "당신은 한글 문서(HWP·HWPX) 편집기 안의 도우미입니다. 사용자는 공공기관 직원이고 문서는 주로 공문·보고서·서식입니다.",
  "문서는 도구로만 읽고 고칩니다. 도구 없이 '고쳤습니다'라고 말하지 마세요.",
  "",
  "자리 표기:",
  "- 문단은 \"구역.문단\" (예: 0.12). 문서 문맥과 read_document 결과의 [ ] 안 값을 그대로 씁니다.",
  "- 표는 \"구역.문단.번호\" (예: 0.5.0). 칸 안의 표는 read_table 이 알려 주는 \"0.5.0>3.0.0\" 꼴. 칸은 행·열 번호(0부터)로 가리킵니다.",
  "",
  "일하는 순서:",
  "1. 고칠 곳이 문맥에 없으면 read_document·find_text·read_table 로 먼저 확인합니다.",
  "2. 글자 몇 개를 바꿀 땐 replace_text, 문단 전체를 다시 쓸 땐 rewrite_paragraph, 새 문단은 insert_paragraphs.",
  "3. 표 칸은 fill_cells, 줄은 add_rows·remove_rows, 새 표는 insert_table.",
  "4. 모양은 format_text·format_paragraphs, 문서에 같은 모양이 여러 번 필요하면 스타일(create_style·apply_style).",
  "5. 서식의 빈칸(누름틀)은 list_fields 로 이름을 보고 fill_field 로 채웁니다.",
  "6. 근거·출처를 달 땐 insert_footnote 로 그 낱말 뒤에 각주를 넣습니다.",
  "",
  "지킬 것:",
  "- 사용자가 주지 않은 사실(날짜·금액·이름·번호)을 지어내지 마세요. 모르면 물어봅니다.",
  "- 공문 표기: 날짜는 2026. 10. 25. 꼴, 금액은 숫자에 쉼표, 항목 기호는 1. 가. 1) 가) 차례.",
  "- 도구가 거절하면 그 이유를 읽고 고쳐서 다시 시도하거나, 할 수 없으면 사용자에게 그대로 알립니다.",
  "- 끝나면 무엇을 바꿨는지 짧게 한국어로 말합니다.",
].join("\n");

const id = { type: "string", description: "문단 자리 \"구역.문단\" (예: 0.12)" };
const ids = { type: "array", items: id, description: "문단 자리 목록" };
const table = { type: "string", description: "표 자리 \"구역.문단.번호\" (예: 0.5.0). 칸 안의 표는 \"0.5.0>3.0.0\"" };
const charFmt = {
  bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, strikethrough: { type: "boolean" },
  color: { type: "string", description: "#RRGGBB" }, size_pt: { type: "number", description: "글자 크기(포인트)" }, font: { type: "string", description: "글꼴 이름" },
};
const paraFmt = {
  align: { type: "string", enum: ["left", "right", "center", "justify", "distribute"] },
  line_spacing: { type: "number", description: "줄 간격(퍼센트, 예: 160)" },
  indent_pt: { type: "number", description: "첫 줄 들여쓰기(pt, 음수는 내어쓰기)" },
  left_pt: { type: "number", description: "왼쪽 여백(pt)" }, right_pt: { type: "number", description: "오른쪽 여백(pt)" },
  before_pt: { type: "number", description: "문단 위 간격(pt)" }, after_pt: { type: "number", description: "문단 아래 간격(pt)" },
};
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

export const TOOLS: AgentToolDef[] = [
  { name: "read_document", description: "문서의 본문 문단(자리와 글)과 표 목록을 읽습니다. 긴 문서는 from 으로 이어 읽습니다.", inputSchema: obj({ from: { type: "integer", description: "몇 번째 문단부터(0부터)" } }) },
  { name: "read_table", description: "표 하나의 칸 글을 행·열 격자로 읽습니다. 병합 칸은 왼쪽 위 자리에 글, 나머지 자리는 null. 칸 안에 표가 있으면 그 표 자리도 알려 줍니다.", inputSchema: obj({ table }, ["table"]) },
  { name: "find_text", description: "본문과 표 칸에서 글을 찾아 자리를 돌려줍니다. 표 칸이면 at 은 표 자리(칸 안의 표 포함), cell 은 칸 번호(행·열이 아님: 행·열은 read_table 로 확인).", inputSchema: obj({ text: { type: "string" } }, ["text"]) },
  { name: "list_styles", description: "문서의 스타일 목록 (문단 스타일·글자 스타일).", inputSchema: obj({}) },
  { name: "read_style", description: "스타일 하나의 모양(글꼴·크기·정렬 등).", inputSchema: obj({ name: { type: "string" } }, ["name"]) },
  { name: "list_fields", description: "서식의 빈칸(누름틀) 이름과 지금 값.", inputSchema: obj({}) },
  {
    name: "replace_text",
    description: "글을 찾아 바꿉니다(본문·표 칸). 여러 곳에 있으면 occurrence(1부터)로 하나를 고르거나 all 로 모두 바꿉니다. 빈 replace 는 지우기.",
    inputSchema: obj({ find: { type: "string" }, replace: { type: "string" }, occurrence: { type: "integer" }, all: { type: "boolean" } }, ["find", "replace"]),
  },
  { name: "rewrite_paragraph", description: "본문 문단 하나의 글을 통째로 바꿉니다(문단 모양은 그대로). 표·그림이 든 문단은 안 됩니다.", inputSchema: obj({ id, text: { type: "string" } }, ["id", "text"]) },
  { name: "insert_paragraphs", description: "문단 뒤에 새 문단들을 넣습니다(앞 문단 모양을 따름). 배열 항목 하나가 문단 하나.", inputSchema: obj({ after: id, texts: { type: "array", items: { type: "string" } } }, ["after", "texts"]) },
  { name: "delete_paragraphs", description: "본문 문단을 지웁니다. 표·그림이 든 문단은 지우지 않습니다.", inputSchema: obj({ ids }, ["ids"]) },
  {
    name: "fill_cells",
    description: "표 칸의 글을 바꿉니다. 칸 글의 줄바꿈(\\n)은 칸 안 문단이 됩니다.",
    inputSchema: obj({ table, cells: { type: "array", items: obj({ row: { type: "integer" }, col: { type: "integer" }, text: { type: "string" } }, ["row", "col", "text"]) } }, ["table", "cells"]),
  },
  { name: "add_rows", description: "표에 줄을 넣습니다. after_row 줄 아래에(맨 위는 -1).", inputSchema: obj({ table, after_row: { type: "integer" }, count: { type: "integer" } }, ["table", "after_row"]) },
  { name: "remove_rows", description: "표의 줄을 지웁니다(0부터).", inputSchema: obj({ table, rows: { type: "array", items: { type: "integer" } } }, ["table", "rows"]) },
  {
    name: "insert_table",
    description: "문단 뒤에 새 표를 넣습니다. rows 는 줄마다 칸 글 배열, 첫 줄은 머리줄(진하게).",
    inputSchema: obj({ after: id, rows: { type: "array", items: { type: "array", items: { type: "string" } } } }, ["after", "rows"]),
  },
  { name: "format_text", description: "본문 문단 하나의 글자 모양을 바꿉니다. find 를 주면 그 문단 안의 그 글만.", inputSchema: obj({ id, find: { type: "string" }, ...charFmt }, ["id"]) },
  { name: "format_paragraphs", description: "문단 모양(정렬·줄 간격·들여쓰기·여백·간격)을 바꿉니다.", inputSchema: obj({ ids, ...paraFmt }, ["ids"]) },
  { name: "apply_style", description: "문단들에 문단 스타일을 겁니다(이름은 list_styles).", inputSchema: obj({ ids, style: { type: "string" } }, ["ids", "style"]) },
  {
    name: "create_style",
    description: "새 스타일을 만듭니다. based_on 스타일 모양에서 시작해 준 속성만 바꿉니다.",
    inputSchema: obj({ name: { type: "string" }, kind: { type: "string", enum: ["para", "char"] }, based_on: { type: "string" }, ...charFmt, ...paraFmt }, ["name"]),
  },
  {
    name: "edit_style",
    description: "스타일의 이름이나 모양을 바꿉니다. 그 스타일을 쓰는 문단이 함께 바뀝니다.",
    inputSchema: obj({ name: { type: "string" }, new_name: { type: "string" }, ...charFmt, ...paraFmt }, ["name"]),
  },
  { name: "fill_field", description: "서식의 빈칸(누름틀) 하나를 채웁니다.", inputSchema: obj({ name: { type: "string" }, value: { type: "string" } }, ["name", "value"]) },
  {
    name: "insert_footnote",
    description: "본문 문단에 각주를 넣습니다. after 는 문단 안의 글(그 바로 뒤에 각주 번호가 붙음, 문단 안에서 한 곳이어야 함). 비우면 문단 끝. text 는 각주 글 한 문단.",
    inputSchema: obj({ id, after: { type: "string" }, text: { type: "string" } }, ["id", "text"]),
  },
];

/** 도구 이름 → 플러그인 연산·문서를 바꾸는가·활동 줄 */
const RUN: Record<string, { op: keyof AgentBridge; mutates?: boolean; say: (a: Record<string, unknown>, r: Record<string, unknown>) => string }> = {
  read_document: { op: "outline", say: () => "문서 읽음" },
  read_table: { op: "readTable", say: (a) => `표 ${a.table} 읽음` },
  find_text: { op: "find", say: (a, r) => `"${a.text}" 찾음 · ${r.count}곳` },
  list_styles: { op: "styles", say: () => "스타일 목록 확인" },
  read_style: { op: "readStyle", say: (a) => `스타일 "${a.name}" 확인` },
  list_fields: { op: "fields", say: () => "빈칸 목록 확인" },
  replace_text: { op: "replace", mutates: true, say: (a, r) => `"${a.find}" → "${a.replace}" · ${r.replaced}곳` },
  rewrite_paragraph: { op: "setParagraph", mutates: true, say: (a) => `문단 ${a.id} 고침` },
  insert_paragraphs: { op: "insertParagraphs", mutates: true, say: (_a, r) => `문단 ${r.count}개 넣음` },
  delete_paragraphs: { op: "deleteParagraphs", mutates: true, say: (_a, r) => `문단 ${r.deleted}개 지움` },
  fill_cells: { op: "fillCells", mutates: true, say: (a, r) => `표 ${a.table} · 칸 ${r.filled}개 채움` },
  add_rows: { op: "addRows", mutates: true, say: (a) => `표 ${a.table} · 줄 ${a.count ?? 1}개 넣음` },
  remove_rows: { op: "removeRows", mutates: true, say: (a) => `표 ${a.table} · 줄 ${(a.rows as unknown[])?.length ?? 0}개 지움` },
  insert_table: { op: "insertTable", mutates: true, say: (_a, r) => `표 넣음 · ${r.rows}줄 ${r.cols}칸` },
  format_text: { op: "formatText", mutates: true, say: (a) => `문단 ${a.id} 글자 모양` },
  format_paragraphs: { op: "formatParagraphs", mutates: true, say: (_a, r) => `문단 ${r.count}개 모양` },
  apply_style: { op: "applyStyle", mutates: true, say: (_a, r) => `스타일 "${r.style}" · 문단 ${r.count}개` },
  create_style: { op: "createStyle", mutates: true, say: (a) => `스타일 "${a.name}" 만듦` },
  edit_style: { op: "editStyle", mutates: true, say: (a) => `스타일 "${a.name}" 고침` },
  fill_field: { op: "fillField", mutates: true, say: (a) => `빈칸 "${a.name}" 채움` },
  insert_footnote: { op: "insertFootnote", mutates: true, say: (a, r) => `문단 ${a.id} 각주 ${r.number ?? ""} 넣음` },
};

/** 결과 글: 모델이 읽기 쉬운 짧은 꼴 */
function render(tool: string, r: unknown): string {
  if (tool === "read_document") {
    const o = r as { total: number; from: number; blocks: Array<{ id: string; text: string; tables?: Array<{ id: string; rows: number; cols: number }> }> };
    const blocks = o.blocks ?? [];
    const lines = blocks.map((b) => `[${b.id}] ${b.text}${b.tables?.length ? `  (표 ${b.tables.map((t) => `${t.id}: ${t.rows}줄×${t.cols}칸`).join(", ")})` : ""}`);
    const end = (o.from ?? 0) + blocks.length;
    return `${lines.join("\n")}\n${end < o.total ? `(문단 ${o.total}개 가운데 ${o.from}~${end - 1}. 이어 읽으려면 from=${end})` : "(끝)"}`;
  }
  return JSON.stringify(r);
}

/** 했다고 말하는 말투 (도구 없이 이렇게 답하면 한 번 되묻는다) */
const CLAIMS = /(바꿨|바꾸었|고쳤|넣었|지웠|채웠|적용했|만들었|수정했|추가했|삭제했)습니다/;

export function createHwpSkill(deps: { bridge: AgentBridge; onChange?: (change: { tool: string; place?: string }) => void }) {
  const { bridge } = deps;
  let context = "";
  let selection: { text: string; at?: string } | null = null;

  const skill: AgentSkill = {
    systemPrompt: SYSTEM,
    tools: TOOLS,
    buildContext: () => context,
    verifyResponse(text: string, executed: ExecutedToolCall[]) {
      if (executed.some((e) => e.ok && RUN[e.name]?.mutates)) return null;
      return CLAIMS.test(text) ? "문서를 바꾸는 도구를 실제로 부르지 않았습니다. 말한 변경을 도구로 하거나, 하지 못했다면 하지 못했다고 답하세요." : null;
    },
    async executeTool(call: AgentToolCall): Promise<ToolExecution> {
      const spec = RUN[call.name];
      if (!spec) return { output: `모르는 도구입니다: ${call.name}`, summary: `모르는 도구 ${call.name}`, isError: true };
      const fn = bridge[spec.op] as (a: Record<string, unknown>) => Promise<unknown>;
      const r = await fn(call.input ?? {});
      if (isErr(r)) return { output: r.error, summary: `하지 못함 · ${r.error.slice(0, 40)}`, isError: true };
      const result = (r ?? {}) as Record<string, unknown>;
      if (spec.mutates) {
        const place = (call.input.id ?? call.input.after ?? (Array.isArray(call.input.ids) ? call.input.ids[0] : undefined) ?? call.input.table) as string | undefined;
        deps.onChange?.({ tool: call.name, ...(place ? { place: String(place) } : {}) });
      }
      return { output: render(call.name, result), summary: spec.say(call.input, result), ...(spec.mutates ? { mutated: true } : {}) };
    },
  };

  return {
    skill,
    /** 사용자가 글을 골라 두고 보냈을 때 그 커서가 있는 본문 문단 (보낼 때마다) */
    setSelection(s: { text: string; at?: string } | null) { selection = s?.text ? s : null; },
    /** 요청마다 문서 문맥을 새로 읽는다 (앞부분 문단·스타일·빈칸) */
    async refreshContext() {
      const [o, st, fl] = await Promise.all([
        bridge.outline({ count: CONTEXT_PARAS }).catch(() => null),
        bridge.styles().catch(() => null),
        bridge.fields().catch(() => null),
      ]);
      const parts: string[] = [];
      if (o && !isErr(o)) {
        const lines = o.blocks.map((b) => `[${b.id}] ${b.text.length > CONTEXT_CHARS ? `${b.text.slice(0, CONTEXT_CHARS)}…` : b.text}${b.tables?.length ? `  (표 ${b.tables.map((t) => `${t.id}: ${t.rows}줄×${t.cols}칸`).join(", ")})` : ""}`);
        parts.push(`문서 (문단 ${o.total}개${o.total > o.blocks.length ? `, 앞 ${o.blocks.length}개만. 나머지는 read_document` : ""}):\n${lines.join("\n")}`);
      }
      if (st && !isErr(st)) {
        parts.push(`문단 스타일: ${st.filter((s) => s.kind === "para").map((s) => s.name).join(", ")}`);
        const chars = st.filter((s) => s.kind === "char").map((s) => s.name);
        if (chars.length) parts.push(`글자 스타일: ${chars.join(", ")}`);
      }
      if (fl && !isErr(fl) && fl.length) parts.push(`빈칸(누름틀): ${fl.map((f) => `${f.name}${f.value ? `="${f.value}"` : ""}`).join(", ")}`);
      if (selection) parts.push(`사용자의 커서가 있는 문단${selection.at ? ` ${selection.at}` : ""}: "${selection.text}"\n요청이 어디를 가리키는지 분명하지 않으면 이 문단으로 봅니다.`);
      context = parts.join("\n\n");
    },
  };
}
