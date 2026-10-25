/**
 * 브라우저 미리보기용 목 사이드카 — window.__TAURI_INTERNALS__ 가 없을 때만 rpc.ts 가 불러온다.
 * 응답은 계약(rpc-contract.ts) 타입에 묶여 있어 모양이 어긋나면 tsc 가 잡는다.
 */

import type { DeepPartial, DocFormat, DocInfo, PagePreview, RpcMethod, RpcParams, RpcResult, Settings } from "./contract";
import type { Notify } from "./rpc";
import { baseName, dirName, formatOf, joinPath, stem } from "./format";
import { layoutPages, markdownBlocks, pageDataUrl } from "./mock-pages";
import {
  CHAT_ANSWER, COMPARE_ROWS, DOCS_DIR, DRAFT_MD, GONGMUN_META, LLM_CATALOG, SAMPLE_FILES, SUMMARY_TEXT,
  TEMPLATES, docBlocks, fakeLint, hashOf, sampleMarkdown,
} from "./mock-data";

/** 엔진 org.ts headTitle 과 같은 규칙 (광진구 → 광진구청장, 수원시청 → 수원시장) */
const headTitle = (name: string) => {
  let n = name.trim();
  if (!n || /(장|지사|군수|교육감|장관|총장)$/.test(n)) return n;
  if (n.endsWith("교육지원청")) return `${n}교육장`;
  if (n.endsWith("교육청")) return `${n.slice(0, -1)}감`;
  if (n.endsWith("위원회")) return `${n.slice(0, -1)}장`;
  if (n.endsWith("대학교")) return `${n}총장`;
  if (/(시|군|구|도)청$/.test(n)) n = n.slice(0, -1);
  if (n.endsWith("도")) return `${n}지사`;
  if (n.endsWith("구")) return `${n}청장`;
  if (n.endsWith("군")) return `${n}수`;
  if (n.endsWith("부") && !/(본부|지부|분부)$/.test(n)) return `${n}장관`;
  return `${n}장`;
};

interface Emit {
  progress: (current: number, total: number, message: string) => void;
  token: (text: string) => void;
  notify: (method: string, params: Record<string, unknown>) => void;
}

/** 우리 서식으로 맞추기 목 — 가온시 기안문 서식 */
function mockStyle(name: string): RpcResult<"style_extract">["format"] {
  return {
    version: 1, preset: "official", paper: { size: "A4", width_mm: 210, height_mm: 297, landscape: false },
    margins: { top: 20, bottom: 15, left: 20, right: 15, header: 0, footer: 0 }, body: { font: "굴림체", pt: 12, line_spacing: 160, gothic: true },
    numbering: { scheme: "standard", markers: ["1.", "가."] },
    levels: [{ depth: 0, marker: "1.", font: "굴림체", pt: 12, bold: false, count: 3 }, { depth: 1, marker: "가.", font: "굴림체", pt: 12, bold: false, count: 4 }],
    title: { kind: "head" }, page_numbers: false, head: { org: "가온시" },
    summary: `기안문 서식 · A4 · 여백 위 20 아래 15 왼쪽 20 오른쪽 15 mm · 본문 굴림체 12pt · 줄 간격 160% · 항목 1. 가. · 수신·제목 머리 표 · 쪽 번호 없음 (${name})`,
    stats: { paragraphs: 8, chars: 400 },
  };
}
const savedStyles: RpcResult<"style_list">["styles"] = [];

const mockIsCloud = () => ["gemini", "anthropic", "claude-code", "codex"].includes(settings.ai.provider);

type Handlers = { [M in RpcMethod]?:(p: RpcParams<M>, emit: Emit) => RpcResult<M> | Promise<RpcResult<M>> };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const settings: Settings = {
  version: 2,
  ai: {
    provider: "embedded",
    embedded: { model_path: "/Users/kim/Library/Application Support/com.kordoc-ai.app/models/qwen3-4b-instruct-q4_k_m.gguf", context_size: 8192, gpu: "auto" },
    openai: { base_url: "http://127.0.0.1:11434/v1", api_key: "", model: "", vision_model: "" },
    gemini: { api_key: "", model: "gemini-3.8-flash" },
    anthropic: { api_key: "", model: "claude-opus-5-5" },
    local: { base_url: "http://127.0.0.1:11434/v1", api_key: "", model: "" },
    claude_code: { model: "", cli_path: "" },
    codex: { model: "", cli_path: "" },
    allow_subscription: false,
    redact_before_cloud: true,
    timeout_ms: 180000,
  },
  privacy: { offline: true },
  org: {
    name: "가온시", dept: "총무과", position: "주무관", person: "김민지", phone: "000-123-4567", fax: "000-123-4599",
    email: "minji@gaon.example", address: "가온시 한빛로 100", homepage: "www.gaon.example",
    approval_line: ["담당", "팀장", "과장"], agency: "", seal_image: "", doc_number_prefix: "총무과-",
  },
  convert: { output_dir: "", ocr: "auto" },
  general: { log_level: "info" },
  impact: { baselines: {} },
  law: { oc: "" },
};

// ?fresh=1 이면 처음 켠 PC 처럼 (첫 실행 마법사 확인용)
if (new URLSearchParams(location.search).has("fresh")) {
  settings.org = { ...settings.org, name: "", dept: "", position: "", person: "", phone: "", fax: "", email: "", address: "", homepage: "", agency: "" };
}

const USAGE = [
  { key: "convert", label: "문서를 글·PDF 로 바꾸기", unit: "건", count: 64, baseline_min: 6 },
  { key: "gongmun", label: "공문서 만들기", unit: "건", count: 18, baseline_min: 40 },
  { key: "collect", label: "취합해서 엑셀로", unit: "문서", count: 45, baseline_min: 5 },
  { key: "redact", label: "개인정보 가리기", unit: "건", count: 23, baseline_min: 15 },
  { key: "review", label: "표기법·K팀장 검토", unit: "건", count: 31, baseline_min: 10 },
  { key: "compare", label: "신구대조표", unit: "건", count: 4, baseline_min: 60 },
];

function merge<T>(target: T, patch: DeepPartial<T>): T {
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = (target as Record<string, unknown>)[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object") merge(cur, v as DeepPartial<typeof cur>);
    else if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  }
  return target;
}

const LAYOUT: DocFormat[] = ["hwp", "hwp3", "hwpx", "hwpml", "pdf", "image"];

function wantedPages(path: string): number {
  const f = formatOf(path);
  if (!LAYOUT.includes(f)) return 1;
  return f === "image" ? 1 : 2 + (hashOf(path) % 6);
}
const pageCountOf = (path: string) => (LAYOUT.includes(formatOf(path)) ? pagesOf(path).length : 1);

function infoOf(path: string): DocInfo {
  const format = formatOf(path);
  return {
    path, name: baseName(path), size: 40_000 + (hashOf(path) % 900) * 1000, format,
    page_count: pageCountOf(path), title: stem(path), author: "김민지", created: "2026-09-30T09:12:00", modified: "2026-10-08T17:40:00",
    encrypted: path.includes("암호"), needs_ocr: path.includes("스캔") || format === "image",
    has_layout: LAYOUT.includes(format), editable: format === "hwpx", warnings: [],
  };
}

const pageCache = new Map<string, string[][]>();
function pagesOf(path: string): string[][] {
  let p = pageCache.get(path);
  if (!p) {
    p = layoutPages(docBlocks(stem(path), wantedPages(path))).slice(0, wantedPages(path));
    pageCache.set(path, p);
  }
  return p;
}

function parseRange(spec: string | undefined, max: number): number[] {
  if (!spec) return Array.from({ length: Math.min(max, 3) }, (_, i) => i + 1);
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map((x) => parseInt(x, 10));
    for (let n = a; n <= (b || a); n++) if (n >= 1 && n <= max) out.push(n);
  }
  return out;
}

function previews(bodies: string[][], nums: number[]): PagePreview[] {
  return nums.map((n) => ({ page: n, width: 595, height: 842, data_url: pageDataUrl(bodies[n - 1] ?? [], n, bodies.length) }));
}

async function streamText(text: string, emit: Emit, ms = 16) {
  for (let i = 0; i < text.length; i += 3) {
    emit.token(text.slice(i, i + 3));
    await wait(ms);
  }
}

const out = (path: string, ext: string, suffix = "") => joinPath(settings.convert.output_dir || dirName(path) || DOCS_DIR, `${stem(path)}${suffix}.${ext}`);
const watchers: Array<{ id: string; dir: string; out_dir: string; format: string; processed: number; started_at: string }> = [];
const userTemplates = [...TEMPLATES];
let shellInstalled = false;

const mockInbox: RpcResult<"inbox_list">["items"] = [
  {
    id: "m1", path: "/Users/kim/Documents/받은 공문/도민체육대회 참가 협조 요청.hwpx", name: "도민체육대회 참가 협조 요청.hwpx", added_at: "2026-10-06T09:12:00.000Z",
    sender: "가온도", doc_number: "가온도 체육진흥과-2203", sent_date: "2026-10-02", title: "2026년 가온도민 한마음 체육대회 참가 협조 요청",
    requests: [{ text: "참가 신청서와 선수 명단을 공문으로 제출", due: "2026-10-23" }], due: "2026-10-23", status: "todo",
  },
  {
    id: "m2", path: "/Users/kim/Documents/받은 공문/하반기 직무교육 수요조사.hwpx", name: "하반기 직무교육 수요조사.hwpx", added_at: "2026-10-07T10:30:00.000Z",
    sender: "가온시 행정지원과", doc_number: "행정지원과-1180", sent_date: "2026-10-07", title: "2026년 하반기 직무교육 수요조사",
    requests: [{ text: "부서별 교육 수요조사서 제출", due: "2026-10-15" }], due: "2026-10-15", status: "todo",
  },
];

const handlers: Handlers = {
  ping: () => "pong",
  system_info: () => ({
    app_version: "2.1.2", kordoc_version: "4.22.18", node_version: "v24.11.0", platform: "macOS 27 (arm64)",
    data_dir: "/Users/kim/Library/Application Support/com.kordoc-ai.app", model_cache: "/Users/kim/Library/Application Support/com.kordoc-ai.app/models",
    ocr_models_ready: true, offline: settings.privacy.offline, ai_provider: settings.ai.provider,
    llm_models: [{ path: settings.ai.embedded.model_path, name: "qwen3-4b-instruct-q4_k_m.gguf", size: 2_497_000_000 }],
  }),
  engine_selftest: async (p, emit) => {
    // 실제 엔진과 같은 단계 식별자 (화면이 한국어 이름으로 바꿔 보여 준다)
    const names = ["hwpx_generate_parse", "pdf_parse", "worker_parse", "render_png", "kordoc_cli", ...(p.ocr ? ["ocr_image"] : []), ...(p.llama ? ["llama_binding"] : [])];
    const steps = [];
    for (let i = 0; i < names.length; i++) {
      emit.progress(i + 1, names.length, `엔진 점검 중 (${i + 1}/${names.length})`);
      await wait(260);
      steps.push({ name: names[i], ok: true, ms: 80 + i * 47 });
    }
    return { ok: true, steps };
  },
  get_settings: () => structuredClone(settings),
  update_settings: (p) => structuredClone(merge(settings, p.settings)),
  open_folder: () => true,
  open_file: () => true,
  reveal_file: () => true,
  // 받은 공문·법령 확인 (미리보기용 목 — 실제 동작은 엔진)
  inbox_list: () => ({ items: mockInbox }),
  inbox_add: async (p) => {
    await wait(300);
    const added = p.paths.map((path, i) => ({
      id: `m${Date.now()}-${i}`, path, name: baseName(path), added_at: new Date().toISOString(), sender: "가온도", doc_number: "가온도 체육진흥과-2203",
      sent_date: "2026-10-02", title: baseName(path).replace(/\.[^.]+$/, ""), requests: [{ text: "참가 신청서와 선수 명단을 공문으로 제출", due: "2026-10-23" }],
      due: "2026-10-23", status: "todo" as const,
    }));
    mockInbox.push(...added);
    return { items: added, failed: [] };
  },
  inbox_update: (p) => {
    const it = mockInbox.find((x) => x.id === p.id);
    if (!it) throw new Error("목록에 없는 공문입니다.");
    if (p.status) it.status = p.status;
    if (p.note != null) it.note = p.note;
    if (p.due !== undefined) it.due = p.due ?? it.requests.find((r) => r.due)?.due;
    return { ...it };
  },
  inbox_remove: (p) => { const i = mockInbox.findIndex((x) => x.id === p.id); if (i >= 0) mockInbox.splice(i, 1); return i >= 0; },
  inbox_export: async () => { await wait(300); return { output_path: joinPath(DOCS_DIR, "접수대장.xlsx"), count: mockInbox.length }; },
  law_check: async () => {
    await wait(400);
    return {
      checked: true,
      as_of: "2026-03-02",
      as_of_source: "시행일" as const,
      checks: {
        done: ["법령 이름", "조·항·호·목이 현행 법령에 있는지", "인용 문장과 조문 내용(낱말 비교)", "공문 시행일(2026. 3. 2.) 당시 조문과 현행 비교"],
        skipped: ["AI 판단: AI가 연결되어 있지 않아 낱말 비교만 했습니다"],
      },
      citations: [
        {
          text: "「개인정보 보호법」 제17조제1항제1호", law: "개인정보 보호법", article: "제17조제1항제1호", paragraph: 1, item: "1", status: "ok" as const,
          article_title: "개인정보의 제공", article_text: "① 개인정보처리자는 다음 각 호의 어느 하나에 해당되는 경우에는 정보주체의 개인정보를 제3자에게 제공할 수 있다.",
          cited_text: "1. 정보주체의 동의를 받은 경우", sentence: "「개인정보 보호법」 제17조제1항제1호에 따라 정보주체의 동의를 받아 개인정보를 제공합니다.",
          match: { verdict: "match" as const, by: "words" as const, reason: "인용 문장과 조문에 같은 낱말이 있습니다(정보주체·동의).", overlap: ["정보주체", "동의"], score: 0.5 },
          as_of: "2026-03-02", url: "https://www.law.go.kr/법령/개인정보보호법/제17조",
        },
        {
          text: "같은 법 제17조제5항", law: "개인정보 보호법", article: "제17조제5항", paragraph: 5, status: "article_missing" as const, missing: "paragraph" as const,
          reason: "제17조에 제5항이 없습니다. 제17조는 제4항까지 있습니다.", sentence: "같은 법 제17조제5항에 따른 동의서 서식을 보냅니다.", url: "https://www.law.go.kr/법령/개인정보보호법/제17조",
        },
        { text: "「전자정부법」 제99조", law: "전자정부법", article: "제99조", status: "article_missing" as const, missing: "article" as const },
      ],
    };
  },
  law_test: () => ({ ok: true }),
  list_printers: () => [{ name: "사무실 복합기", isDefault: true, status: "ready" }, { name: "3층 프린터", isDefault: false, status: "ready" }],
  print_files: async (p) => { await wait(400); return { queued: p.files.length, jobIds: p.files.map((_, i) => `mock-${i + 1}`), failed: [] }; },
  list_files: () => SAMPLE_FILES.map((f) => ({ name: baseName(f), is_dir: false, size: 120_000 })),
  scan_paths: async (p) => {
    await wait(200);
    const files = p.paths.flatMap((x) => (formatOf(x) === "unknown" ? SAMPLE_FILES.map((f) => joinPath(x, baseName(f))) : [x]));
    return { files: files.map((f) => ({ path: f, name: baseName(f), size: infoOf(f).size, format: formatOf(f) })), skipped: 0 };
  },
  read_batch_manifest: () => ({ action: "convert", files: SAMPLE_FILES.slice(0, 3) }),
  detect_mcp_env: () => ({
    clients: [
      { id: "claude", name: "Claude Desktop", installed: true, configured: false, config_path: "~/Library/Application Support/Claude/claude_desktop_config.json" },
      { id: "cursor", name: "Cursor", installed: true, configured: true, config_path: "~/.cursor/mcp.json" },
      { id: "vscode", name: "VS Code", installed: false, configured: false, config_path: "~/.vscode/mcp.json" },
    ],
  }),
  install_mcp_config: async (p) => { await wait(400); return { installed: p.clients, failed: [] }; },
  models_status: () => ({ ocr: { ready: true, dir: "/Users/kim/Library/Application Support/com.kordoc-ai.app/models/ocr" }, formula: { ready: false, dir: "" } }),
  models_import: async () => { await wait(300); return { imported: ["det.onnx", "rec_korean.onnx", "rec_korean.yml"] }; },

  doc_info: async (p) => { await wait(120); return infoOf(p.path); },
  convert: async (p) => {
    await wait(250);
    const md = sampleMarkdown(stem(p.path));
    return { content: p.format === "txt" ? md.replace(/[#*|]/g, "") : md, page_count: pageCountOf(p.path), warnings: [], ...(p.save ? { output_path: out(p.path, p.format ?? "md") } : {}) };
  },
  convert_batch: async (p, emit) => {
    for (let i = 0; i < p.paths.length; i++) { emit.progress(i + 1, p.paths.length, `${baseName(p.paths[i])} 바꾸는 중`); await wait(320); }
    return { results: p.paths.map((x, i) => ({ path: x, ok: i !== 2, ...(i !== 2 ? { output_path: out(x, p.format ?? "md") } : { error: "암호가 걸려 있습니다. 작업대에서 암호를 넣고 여세요." }) })), output_dir: DOCS_DIR };
  },
  render_pages: async (p) => {
    const f = formatOf(p.path);
    if (!LAYOUT.includes(f)) throw new Error("NO_LAYOUT: 쪽 배치가 없는 형식입니다");
    await wait(180);
    const bodies = pagesOf(p.path);
    return { page_count: bodies.length, pages: previews(bodies, parseRange(p.pages, bodies.length)) };
  },
  export_pdf: async (p) => { await wait(500); return { output_path: p.output_path ?? out(p.path, "pdf") }; },
  ocr: async (p) => { await wait(700); return { success: true, output_path: out(p.input_path, "md"), markdown: sampleMarkdown(stem(p.input_path)), page_count: 1, engine: "local" }; },
  compare: async (p) => {
    await wait(400);
    return { stats: { added: 1, removed: 1, modified: 3, unchanged: 2 }, rows: COMPARE_ROWS, ...(p.export ? { output_path: out(p.new_path, p.export, "_신구대조") } : {}) };
  },
  tables_extract: async (p) => {
    await wait(350);
    return {
      tables: [
        { index: 1, page: 1, kind: "data", rows: 4, cols: 4, preview: [["구분", "과제", "담당 부서", "완료 시기"], ["1", "청사 안전점검", "총무과", "10월"], ["2", "민원 응대 개선", "민원봉사과", "11월"]] },
        { index: 2, page: 2, kind: "layout", rows: 2, cols: 2, preview: [["결재", "담당"], ["", "김민지"]] },
      ],
      output_path: out(p.path, p.format, "_표"),
    };
  },
  gongmun_meta: () => GONGMUN_META,
  generate_hwpx: async (p) => {
    await wait(p.preview_only ? 220 : 500);
    // ?editor= 가 있으면 편집기 서버의 견본 HWPX 를 rhwp 미리보기용으로 (글 내용과 무관한 견본). 없으면 옛 엔진처럼 PNG
    const editor = new URLSearchParams(location.search).get("editor");
    if (p.preview_only && p.preview_hwpx && editor) {
      const buf = new Uint8Array(await (await fetch(new URL("sample.hwpx", editor))).arrayBuffer());
      let bin = "";
      buf.forEach((x) => { bin += String.fromCharCode(x); });
      return { warnings: [], lint: fakeLint(p.markdown), preview_hwpx_b64: btoa(bin) };
    }
    const bodies = layoutPages(markdownBlocks(p.markdown));
    const n = Math.min(bodies.length, p.preview_pages ?? 2);
    return {
      warnings: [], lint: fakeLint(p.markdown),
      ...(p.preview_only ? { preview: previews(bodies, Array.from({ length: n }, (_, i) => i + 1)) } : { output_path: p.output_path ?? joinPath(DOCS_DIR, "새 공문서.hwpx") }),
    };
  },
  template_fields: () => ({ fields: [
    { name: "행정기관명", label: "행정기관명" }, { name: "수신자", label: "수신자(참조)" }, { name: "경유", label: "경유 기관" },
    { name: "제목", label: "제목을 입력하세요" }, { name: "본문", label: "내용을 입력하세요", multiline: true }, { name: "붙임", label: "붙임을 입력하세요" },
    { name: "기안자", label: "직위(직급) 서명" }, { name: "시행일", label: "시행일" }, { name: "전화번호", label: "전화번호" },
  ] }),
  template_fill: async (p) => { await wait(400); return { output_path: p.output_path ?? joinPath(DOCS_DIR, "기안문.hwpx"), filled: Object.keys(p.values), unmatched: [] }; },
  mail_merge: async (p) => { await wait(600); return { outputs: ["김민지", "이서준", "박하은"].map((n) => joinPath(p.output_dir ?? DOCS_DIR, `${n}.hwpx`)), failed: [], output_dir: p.output_dir ?? DOCS_DIR }; },
  mail_merge_plan: async () => {
    await wait(300);
    return {
      rows: 3,
      columns: [{ name: "제목", fields: ["제목"], sample: "체육대회 참가 안내" }, { name: "성명", fields: [], sample: "김민지" }],
      fields: [{ name: "행정기관명", org: settings.org.name || "가온시" }, { name: "수신자" }, { name: "제목", column: "제목" }, { name: "본문" }],
      rejected: [],
    };
  },
  working_path: async (p) => ({ path: joinPath("/Users/kim/Library/Application Support/com.kordoc-ai.app/작업 사본", p.name || "새 문서.hwpx"), dir: "/Users/kim/Library/Application Support/com.kordoc-ai.app/작업 사본" }),
  lint: async (p) => {
    await wait(200);
    const findings = fakeLint(p.text ?? "2026.10.10 점검을 실시하였음\n14시 30분 회의 및 및 보고");
    return { findings, counts: { error: findings.filter((f) => f.severity === "error").length, warning: findings.filter((f) => f.severity === "warning").length, info: findings.filter((f) => f.severity === "info").length } };
  },
  precheck: async (p) => {
    await wait(400);
    const items: RpcResult<"precheck">["items"] = [
      { rule: "WEEKDAY_MISMATCH", severity: "error", category: "날짜와 요일", message: "11월 6일은 금요일입니다.", page: 1, context: "일시: 2026. 11. 6.(목) 10:00∼12:00", excerpt: "2026. 11. 6.(목)", fix: { from: "2026. 11. 6.(목)", to: "2026. 11. 6.(금)" } },
      { rule: "SUM_MISMATCH", severity: "error", category: "표 합계", message: "표 1의 합계 행(금액(원))이 1,500,000인데, 위 칸을 더하면 1,450,000입니다.", page: 1, context: "합계 1,500,000", excerpt: "1,500,000", fix: { from: "1,500,000", to: "1,450,000" } },
      { rule: "PRIVACY_PHONE", severity: "warning", category: "개인정보", message: "전화번호로 보이는 글이 있습니다: 010-●●●●-6789. 밖으로 보내거나 공개할 문서라면 가리세요.", page: 1, context: "주무관(010-●●●●-6789)" },
      { rule: "EMPTY_FIELD", severity: "warning", category: "빈칸 안내 글자", message: "'시행일' 칸을 채우지 않았습니다. 그대로 PDF로 저장하거나 인쇄하면 안내 글자 '시행일'이 찍힐 수 있습니다." },
    ];
    const fixed = p.path.includes("_수정");
    const list = fixed ? items.filter((f) => !f.fix) : items;
    const c = (s: string) => list.filter((f) => f.severity === s).length;
    return { items: list, counts: { error: c("error"), warning: c("warning"), info: c("info") }, fixable: list.filter((f) => f.fix).length, checked: ["표기법", "날짜와 요일", "표 합계", "끝. 표시", "빈칸 안내 글자", "개인정보"], skipped: [], page_count: 2 };
  },
  find_pages: async (p) => ({ pages: p.texts.map(() => 1) }),
  redact: async (p) => {
    await wait(350);
    const hits = [{ rule: "rrn" as const, count: 3, samples: ["900101-1******"] }, { rule: "phone" as const, count: 5, samples: ["010-****-5678"] }, { rule: "email" as const, count: 2, samples: ["m****@gwangjin.go.kr"] }];
    const fmt = formatOf(p.path);
    const ext = fmt === "hwpx" || fmt === "hwp" ? fmt : fmt === "pdf" || fmt === "image" ? "pdf" : "md";
    return { hits, total: 10, residual: p.dry_run ? 0 : 1, preserved: fmt === "hwpx" || fmt === "hwp", unchecked_rules: (["name", "address"] as const).filter((r) => !p.rules?.includes(r)), ...(p.dry_run ? {} : { output_path: out(p.path, ext, "_가림") }) };
  },
  redact_batch: async (p, emit) => {
    for (let i = 0; i < p.paths.length; i++) { emit.progress(i + 1, p.paths.length, `${baseName(p.paths[i])} 가리는 중`); await wait(300); }
    return { results: p.paths.map((x) => ({ path: x, ok: true, output_path: out(x, "md", "_가림"), total: 4, residual: 0 })), output_dir: DOCS_DIR };
  },
  seal: async (p) => { await wait(400); return { output_path: p.output_path ?? out(p.path, "hwpx", "_날인"), placed: 1 }; },
  lint_fix: async (p) => ({ output_path: p.output_path ?? out(p.path, "hwpx", "_수정"), replaced: p.fixes.length, applied: p.fixes.length, skipped: [] }),
  patch_document: async (p) => ({ output_path: p.output_path ?? out(p.path, "hwpx", "_수정"), applied: 3, skipped: [] }),
  validate_hwpx: async () => ({ ok: true, issues: [] }),
  watch_start: (p, emit) => {
    const w = { id: `w${watchers.length + 1}`, dir: p.dir, out_dir: p.out_dir ?? joinPath(p.dir, "변환"), format: p.format ?? "md", processed: 0, started_at: new Date().toISOString() };
    watchers.push(w);
    setTimeout(() => { w.processed++; emit.notify("watch_event", { id: w.id, path: joinPath(p.dir, "회신_협조요청.hwp"), ok: true, output_path: joinPath(w.out_dir, "회신_협조요청.md") }); }, 2500);
    return { id: w.id };
  },
  watch_stop: (p) => { const i = watchers.findIndex((w) => w.id === p.id); if (i >= 0) watchers.splice(i, 1); return true; },
  watch_list: () => watchers.map((w) => ({ ...w })),
  merge_files: async (p) => { await wait(600); return { output_path: p.output_path, file_count: p.files.length }; },
  split_pdf: async (p) => { await wait(500); return { output_files: [1, 2, 3].map((n) => joinPath(p.output_dir ?? DOCS_DIR, `${stem(p.input_path)}_${n}.pdf`)), output_dir: p.output_dir }; },
  pdf_page_count: () => ({ page_count: 12 }),
  pdf_extract_pages: async (p) => { await wait(400); return { output_path: p.output_path, extracted_pages: 3, total_pages: 12 }; },
  pdf_open: async (p) => {
    await wait(200);
    const n = pagesOf(p.path).length;
    return { source: p.path, converted: formatOf(p.path) !== "pdf", secured: false, page_count: n, pages: Array.from({ length: n }, () => ({ width: 595, height: 842 })) };
  },
  pdf_thumbs: async (p) => {
    await wait(120);
    const bodies = pagesOf(p.path);
    return { page_count: bodies.length, pages: previews(bodies, parseRange(p.pages, bodies.length)).map((x) => ({ page: x.page, data_url: x.data_url })) };
  },
  pdf_compose: async (p) => {
    await wait(500);
    const dir = p.output_dir ?? dirName(p.source ?? joinPath(DOCS_DIR, "x.pdf"));
    return { outputs: p.outputs.map((o) => ({ output_path: joinPath(dir, `${o.name ?? "PDF"}.pdf`), page_count: o.pages.length, bytes: 48_000 * o.pages.length })), secured: [] };
  },
  pdf_to_images: async (p) => {
    await wait(500);
    const src = p.source ?? p.path ?? joinPath(DOCS_DIR, "문서.pdf");
    const dir = joinPath(p.output_dir ?? dirName(src), `${stem(src)}_그림`);
    const n = p.items?.length ?? 3;
    return { output_dir: dir, files: Array.from({ length: n }, (_, i) => joinPath(dir, `${stem(src)}_${String(i + 1).padStart(2, "0")}.${p.format ?? "png"}`)) };
  },

  ai_status: () => ({ provider: settings.ai.provider, configured: settings.ai.provider !== "none", is_cloud: mockIsCloud(), supports_vision: false, model: "Qwen3 4B Instruct", offline: settings.privacy.offline, embedded_loaded: true }),
  ai_local_servers: async () => { await wait(500); return { servers: [{ name: "Ollama", base_url: "http://127.0.0.1:11434/v1", models: ["gemma4:latest", "qwen3:8b"] }, { name: "LM Studio", base_url: "http://127.0.0.1:1234/v1", models: ["exaone-4.0-32b"] }] }; },
  ai_subscription_status: async (p) => {
    await wait(600);
    const list = p.provider ? [p.provider] : (["claude-code", "codex"] as const);
    if (settings.privacy.offline) return { statuses: list.map((provider) => ({ provider, state: "offline" as const, message: "폐쇄망 모드에서는 구독 계정을 쓸 수 없습니다. 이 PC의 로컬 모델 서버나 내장 모델을 고르세요.", login_command: provider === "codex" ? "codex login" : "claude" })) };
    return { statuses: list.map((provider) => provider === "codex"
      ? { provider, state: "signed-out" as const, message: "Codex에 로그인되어 있지 않습니다. 터미널에서 codex login 을 실행해 ChatGPT 계정으로 로그인한 뒤 다시 시도하세요.", login_command: "codex login" }
      : { provider, state: "ready" as const, version: "2.1.300", plan: "max", login_command: "claude" }) };
  },
  ai_subscription_models: async () => { await wait(400); return { models: [{ id: "", label: "Default (recommended)" }, { id: "sonnet", label: "Sonnet" }, { id: "opus", label: "Opus" }] }; },
  ai_test: async () => { await wait(800); return { ok: true, latency_ms: 840, sample: "네, 연결되었습니다. 문서 작업을 도와드릴게요." }; },
  ai_list_models: async () => { await wait(300); return { models: ["gemma4:latest", "qwen3:8b", "exaone3.5:7.8b"] }; },
  ai_warmup: async () => { await wait(900); return { gpu: "Apple M5", context_size: settings.ai.embedded.context_size }; },
  llm_catalog: () => LLM_CATALOG,
  llm_list: () => [{ path: settings.ai.embedded.model_path, name: "qwen3-4b-instruct-q4_k_m.gguf", size: 2_497_000_000 }],
  llm_download: async (p, emit) => {
    for (let i = 1; i <= 10; i++) { emit.progress(i, 10, `${(i * 0.73).toFixed(1)}GB / 7.3GB`); await wait(220); }
    return { path: `/Users/kim/Library/Application Support/com.kordoc-ai.app/models/${p.id}.gguf` };
  },
  llm_import: async (p) => { await wait(400); return { path: p.path }; },
  llm_delete: () => true,
  ai_summarize: async (_p, emit) => { await streamText(SUMMARY_TEXT, emit); return { summary: SUMMARY_TEXT, redacted: 0 }; },
  ai_chat: async (p, emit) => {
    await wait(300);
    await streamText(CHAT_ANSWER, emit, 20);
    const path = p.paths[0] ?? SAMPLE_FILES[0];
    return { answer: CHAT_ANSWER, redacted: 0, citations: [
      { n: 1, path, page: 1, heading: "2. 추진 개요", excerpt: "청사 안전점검, 총무과, 10월", verified: true },
      { n: 2, path, page: 2, heading: "4. 세부 추진 내용", excerpt: "11월 승강기 보완, 부품 교체", verified: true },
    ] };
  },
  ai_draft: async (_p, emit) => { await wait(300); await streamText(DRAFT_MD, emit, 10); return { markdown: DRAFT_MD, redacted: 0 }; },
  ai_rewrite: async (p, emit) => {
    const text = p.mode === "gaejosik" ? `○ ${p.text.replace(/[.。]\s*/g, "\n○ ").replace(/\n○ $/, "")}` : `${p.text.replace(/하였음/g, "함").replace(/\s+/g, " ").trim()}`;
    await streamText(text, emit, 14);
    return { text, redacted: 0 };
  },
  ai_review: async () => {
    await wait(900);
    return {
      summary: "전체 흐름은 자연스럽습니다. 일정표의 날짜 하나와 예산 합계가 본문과 맞지 않습니다.",
      issues: [
        { severity: "error", category: "숫자", location: "2. 추진 개요", message: "대상 부서 수가 본문(12개)과 표(11개)에서 다릅니다.", suggestion: "표에 빠진 부서를 넣거나 본문 숫자를 고치세요." },
        { severity: "warning", category: "날짜", location: "3. 행정 사항", message: "10. 20.은 월요일이 아니라 화요일입니다.", suggestion: "요일을 (화)로 고치세요." },
      ],
      lint: fakeLint("2026.10.10 점검을 실시하였음"), redacted: 0,
    };
  },
  ai_fill_suggest: async (p) => {
    await wait(700);
    const guess: Record<string, string> = { 제목: "2026년 직원 체육대회 개최 안내", 본문: "직원 화합을 위한 체육대회를 아래와 같이 엽니다.", 수신: "각 부서장", 붙임: "체육대회 세부 일정 1부." };
    return { values: Object.fromEntries(p.fields.map((f) => [f, guess[f] ?? `${f} 예시 값`])), redacted: 0 };
  },
  ai_template_write: async (p) => {
    await wait(1200);
    return {
      output_path: p.output_path ?? out(p.path, "hwpx", "_새로쓰기"), applied: 9, skipped: [], redacted: 0, converted: p.path.endsWith(".hwp"),
      findings: [{ axis: "구성", rule: "LOGIC_EFFECT_VAGUE", line: 18, match: "## 기대효과", message: "기대효과에 목표치가 없습니다", severity: "warning", suggest: "민원 연 14건 → 5건처럼 문제점에서 든 지표의 목표치" }],
    };
  },
  ai_fit_lines: async (p) => {
    // 미리보기: 끝이 "필요"로 끝나는 첫 개조식 줄 하나를 줄여 쓴 것처럼
    await wait(900);
    const line = p.markdown.split("\n").find((l) => /^\s*[ㅇ○-]\s.{20,}필요$/.test(l));
    if (!line) return { markdown: p.markdown, changes: [], remaining: 0 };
    const before = line.replace(/^\s*[ㅇ○-]\s/, "");
    const after = before.replace(/\s*검토 필요$/, " 검토");
    return { markdown: p.markdown.replace(line, line.replace(before, after)), changes: [{ before, after }], remaining: 0 };
  },
  ai_extract: async (p) => {
    await wait(900);
    return { rows: p.paths.map((x, i) => Object.fromEntries([["문서", baseName(x)], ...p.columns.map((c) => [c, `${c} ${i + 1}`])])), output_path: joinPath(DOCS_DIR, "항목 뽑기.xlsx"), failed: [] };
  },

  to_hwpx: async (p) => { await wait(700); return { output_path: p.output_path ?? out(p.path, "hwpx"), warnings: [], style: p.path.endsWith(".hwp") ? "서식 그대로" : "기안문 서식" }; },
  to_hwpx_batch: async (p) => { await wait(800); return { results: p.paths.map((x) => ({ path: x, ok: true, output_path: out(x, "hwpx"), note: x.endsWith(".hwp") ? "서식 그대로" : "보고서 서식" })), output_dir: DOCS_DIR }; },
  compare_hwpx: async (p) => { await wait(600); return { output_path: p.output_path ?? out(p.new_path, "hwpx", "_신구대조표"), stats: { added: 1, removed: 1, modified: 3, unchanged: 2 } }; },
  bundle_pdf: async (p) => { await wait(800); return { output_path: p.output_path ?? joinPath(DOCS_DIR, "합본.pdf"), page_count: 9 * p.paths.length, failed: [] }; },
  pdf_stamp: async (p) => ({ output_path: p.output_path ?? out(p.path, "pdf", "_사본") }),
  pdf_shrink: async (p) => ({
    output_path: p.output_path ?? out(p.path, "pdf", "_용량줄임"), before_bytes: 12_600_000, after_bytes: 2_100_000,
    level_used: p.level ?? "normal", images: 39, images_shrunk: 39, under_target: p.target_mb ? true : null, text_kept: true, note: "12MB → 2.0MB",
  }),
  extract_images: async (p) => { await wait(300); return { output_dir: p.output_dir ?? joinPath(DOCS_DIR, `${stem(p.path)}_그림`), count: 1 + (hashOf(p.path) % 7) }; },
  search_files: async (p) => {
    await wait(500);
    return { results: p.paths.slice(0, 3).map((x, i) => ({ path: x, hits: [{ page: i + 1, excerpt: `각 부서는 ${p.query} 관련 실적을 매월 말까지 제출한다.` }] })), searched: p.paths.length, failed: 0 };
  },
  collect_fields: async () => { await wait(400); return { fields: [{ label: "성명", count: 5 }, { label: "소속", count: 5 }, { label: "연락처", count: 4 }, { label: "참가 종목", count: 3 }] }; },
  collect_run: async (p) => { await wait(600); return { output_path: p.output_path ?? joinPath(DOCS_DIR, "취합.xlsx"), rows: p.paths.length, failed: [] }; },
  collect_roster: (p) => ({ names: (p.text ?? "총무과\n기획예산과\n민원봉사과\n복지정책과\n도시계획과\n세무과\n환경위생과\n문화체육과").split(/\n|,/).map((x) => x.trim()).filter(Boolean) }),
  collect_gather: async (p) => {
    await wait(700);
    const roster = (p.roster ?? []).map((x) => x.trim()).filter(Boolean);
    const depts = p.paths.map((x) => roster.find((d) => baseName(x).includes(d)) ?? "");
    const status = roster.map((d) => ({ dept: d, in_roster: true, submitted: depts.includes(d), files: p.paths.filter((_, i) => depts[i] === d).map(baseName), blanks: 0 }));
    const missing = status.filter((s) => !s.submitted).map((s) => s.dept);
    return {
      output_path: p.output_path ?? joinPath(p.output_dir ?? DOCS_DIR, "교육수요조사서_수합.xlsx"), rows: p.paths.length,
      columns: [{ label: "부서명", required: true }, { label: "담당자", required: true }, { label: "희망 인원", required: true, total: 31 }],
      by_kind: { form: p.paths.length, excel: 0, ai: 0 }, separate: [], failed: [], blanks: 1, status, missing, title: "교육수요조사서",
      reminder: missing.length ? `「교육수요조사서」 제출을 다시 부탁드립니다.\n\n아직 받지 못한 부서: ${missing.join(", ")}\n제출 기한: ${p.deadline || "○○. ○○.(○)"}까지` : "",
    };
  },
  write_file: (p) => ({ path: p.path }),
  read_file_b64: async (p) => {
    const editor = new URLSearchParams(location.search).get("editor");
    if (editor && /\.(hwpx?|hml)$/i.test(p.path)) {
      const buf = await (await fetch(new URL("sample.hwpx", editor))).arrayBuffer();
      let bin = "";
      new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
      return { data_b64: btoa(bin), name: baseName(p.path), size: buf.byteLength };
    }
    return { data_b64: PNG_1PX, name: baseName(p.path), size: 68 };
  },
  editor_open: async (p, emit) => ({ ...(await handlers.read_file_b64!({ path: p.path }, emit)), token: "mock", tracked: false }),
  recovery_write: async () => ({ ok: true }),
  recovery_list: async () => ({ entries: [] }),
  recovery_discard: async () => true,
  editor_write: (p) => ({ path: p.path }),
  ai_agent_step: async () => { await wait(600); return { text: "미리보기에서는 문서를 고치지 않습니다. 앱에서 AI 연결을 고른 뒤 써 보세요.", calls: [], redacted: 0 }; },
  preview_bytes: async (p) => ({ data_b64: p.data_b64 }),
  template_library: () => ({ templates: userTemplates }),
  template_add: async (p) => {
    await wait(400);
    const t = { id: `user-${userTemplates.length + 1}`, name: p.name ?? stem(p.path), category: p.category ?? "서식", source: "user" as const, path: p.path, format: formatOf(p.path) === "hwp" ? "hwp" as const : "hwpx" as const, has_fields: true, field_count: 5, description: "누름틀 5칸", added_at: "2026-10-10" };
    userTemplates.push(t);
    return t;
  },
  template_remove: (p) => { const i = userTemplates.findIndex((t) => t.id === p.id); if (i >= 0) userTemplates.splice(i, 1); return true; },
  template_analyze: async (p) => {
    await wait(300);
    if (p.path.includes("출장")) return { format: "hwp", fields: [], label_fields: [{ label: "성명" }, { label: "출장지" }, { label: "기간", type: "date" }], has_levels: false, strategy: "fill_labels" };
    return { format: "hwpx", fields: [{ name: "기관명" }, { name: "수신" }, { name: "제목", guide: "무엇을 요청하는지 한 줄로" }, { name: "본문", guide: "요청 내용과 기한", multiline: true }, { name: "담당자" }, { name: "전화" }], label_fields: [], has_levels: true, page_count: 1, strategy: "fill_fields" };
  },
  template_starter: async (p) => { await wait(400); return { output_path: joinPath(DOCS_DIR, `${p.preset} 시작 서식.hwpx`) }; },
  style_extract: async (p) => { await wait(500); return { format: mockStyle(stem(p.path)), warnings: [] }; },
  style_preview: async () => {
    // ?editor= 가 있으면 편집기 서버의 견본 HWPX 로 (서식과 무관한 견본), 없으면 빈 값 → 화면은 "그리지 못했습니다"
    const editor = new URLSearchParams(location.search).get("editor");
    if (!editor) return { preview_hwpx_b64: "" };
    const buf = new Uint8Array(await (await fetch(new URL("sample.hwpx", editor))).arrayBuffer());
    let bin = "";
    buf.forEach((x) => { bin += String.fromCharCode(x); });
    return { preview_hwpx_b64: btoa(bin) };
  },
  style_save: (p) => { const e = { id: `s${savedStyles.length + 1}`, name: p.name, summary: p.format.summary, created_at: "2026-10-13T09:00:00Z", format: p.format }; savedStyles.unshift(e); return e; },
  style_list: () => ({ styles: savedStyles }),
  style_delete: (p) => { const i = savedStyles.findIndex((s) => s.id === p.id); if (i >= 0) savedStyles.splice(i, 1); return i >= 0; },
  style_apply: async (p, emit) => {
    const results = [];
    for (const [i, path] of p.source_paths.entries()) {
      emit.progress(i + 1, p.source_paths.length, `${baseName(path)} 서식 맞추는 중 (${i + 1}/${p.source_paths.length})`);
      await wait(400);
      results.push({ path, ok: true, output_path: joinPath(p.output_dir ?? dirName(path), `${stem(path)}_우리서식.hwpx`) });
    }
    return { results, output_dir: p.output_dir ?? dirName(p.source_paths[0]), summary: "기안문 서식" };
  },
  org_autofill: (p) => {
    const o = settings.org;
    const map: Record<string, string> = {
      기관명: o.name, 행정기관명: o.name, 발신명의: headTitle(o.name), 부서: o.dept, 담당자: o.person, 기안자: `${o.position} ${o.person}`.trim(),
      전화: o.phone, 전화번호: o.phone, 팩스: o.fax, 팩스번호: o.fax, 이메일: o.email, 전자우편: o.email, 주소: o.address, 홈페이지: o.homepage, 시행일: "2026. 10. 10.",
    };
    const values = Object.fromEntries(p.fields.filter((f) => map[f]).map((f) => [f, map[f]]));
    return { values, matched: Object.keys(values) };
  },
  editor_server: () => ({ host_url: new URLSearchParams(location.search).get("editor") ?? "", studio_version: "목" }),
  usage_report: (p) => {
    const k = p.range === "all" ? 3 : 1;
    const items = USAGE.map((u) => {
      const baseline = settings.impact.baselines[u.key] ?? u.baseline_min;
      return { ...u, count: u.count * k, baseline_min: baseline, saved_min: u.count * k * baseline };
    });
    return { range: p.range ?? "month", since: p.range === "all" ? "2026-08-01" : "2026-10-01", items,
      total_count: items.reduce((a, b) => a + b.count, 0), total_saved_min: items.reduce((a, b) => a + b.saved_min, 0) };
  },
  usage_reset: () => true,
  samples_list: () => {
    const dir = "/Applications/KorDoc AI.app/Contents/Resources/samples";
    return {
      dir, note: "예제 문서는 가상의 가온시와 지어낸 개인정보로 만든 합성 문서입니다.",
      scenarios: [
        { id: "reply" as const, title: "받은 공문에 회신하기", description: "받은 공문 PDF 로 회신 공문을 작성, 편집, 출력까지", files: [`${dir}/가온시 협조 요청 공문.pdf`] },
        { id: "collect" as const, title: "부서 제출 양식 취합", description: "부서에서 낸 양식 5개를 엑셀 한 장으로", files: [1, 2, 3, 4, 5].map((n) => `${dir}/취합/행사 참가 신청서_${n}.hwpx`) },
        { id: "redact" as const, title: "민원 서류 공개용 사본", description: "개인정보를 가린 사본을 만들고 남은 곳 다시 검사", files: [`${dir}/민원 접수 서류.hwpx`] },
        { id: "summary" as const, title: "긴 보고서 요약하고 묻기", description: "보고서를 열어 요약하고 궁금한 곳을 바로 묻기", files: [`${dir}/가온시 하반기 업무보고.hwpx`] },
      ],
    };
  },
  security_status: () => ({
    offline: settings.privacy.offline, ai_provider: settings.ai.provider,
    ai_is_cloud: mockIsCloud(),
    redact_before_cloud: settings.ai.redact_before_cloud, external_sent: 0,
    recent: [
      { at: "2026-10-10T09:02:11", host: "127.0.0.1:52144 (한글 편집기)", external: false, allowed: true },
      { at: "2026-10-10T09:01:40", host: "127.0.0.1:11434 (Ollama)", external: false, allowed: true },
      { at: "2026-10-10T08:58:03", host: "generativelanguage.googleapis.com", external: true, allowed: false },
    ],
    data_dir: "/Users/kim/Library/Application Support/com.kordoc-ai.app", telemetry: false,
  }),
};

/** v1 모양 메서드 (FillWizard·DocEditor) — 화면 확인용 최소 응답 */
function legacy(method: string, params: Record<string, unknown>): unknown {
  const svg = pageDataUrl(layoutPages(docBlocks("출장 신청서", 1))[0], 1, 1);
  if (method === "form_schema") return { success: true, confidence: 0.9, fillable: true, fields: [{ label: "성명", value: "", type: "text", empty: true }, { label: "출장지", value: "", type: "text", empty: true }, { label: "기간", value: "", type: "date", empty: true }] };
  if (method === "render_preview") return { success: true, page_count: 1, pages: [{ page: 0, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842"><image href="${svg}" width="595" height="842"/></svg>` }] };
  if (method === "form_fill") return { success: true, filled: Object.entries((params.values as Record<string, string>) ?? {}).map(([label, value]) => ({ label, value })), unmatched: [], output_path: joinPath(DOCS_DIR, "채움.hwpx"), verification: { reparse_ok: true, changed_blocks: 2 } };
  if (method === "edit_open") return { success: true, session_id: "m1", blocks: [{ index: 0, type: "paragraph", text: "출장 신청서" }], capabilities: [{ capability: "text" }], can_undo: false, can_redo: false };
  if (method === "cancel") return { cancelled: params.stream ?? null };
  throw new Error(`목 사이드카에 없는 메서드입니다: ${method}`);
}

export async function mockCall(method: string, params: Record<string, unknown>, dispatch: (n: Notify) => void): Promise<unknown> {
  const stream = typeof params.__stream === "string" ? params.__stream : undefined;
  const { __stream: _ignored, ...rest } = params;
  void _ignored;
  const emit: Emit = {
    progress: (current, total, message) => dispatch({ method: "progress", params: { current, total, message, stream } }),
    token: (text) => dispatch({ method: "ai_token", params: { text, stream } }),
    notify: (m, p) => dispatch({ method: m, params: p }),
  };
  const h = (handlers as Record<string, ((p: unknown, e: Emit) => unknown) | undefined>)[method];
  await wait(40);
  return h ? h(rest, emit) : legacy(method, rest);
}

export function mockCommand(cmd: string, _args: Record<string, unknown>): unknown {
  void _args;
  if (cmd === "sidecar_status") return "ready";
  if (cmd === "shell_menu_status") return { supported: true, installed: shellInstalled, kind: "quick-action" };
  if (cmd === "shell_menu_install") { shellInstalled = true; return null; }
  if (cmd === "shell_menu_uninstall") { shellInstalled = false; return null; }
  if (cmd === "save_clipboard_text" || cmd === "save_clipboard_image") return joinPath(DOCS_DIR, "붙여넣은 글.txt");
  return null;
}

export function mockPickFiles(multiple: boolean, filters: Array<{ extensions: string[] }>): string[] {
  const exts = filters.flatMap((f) => f.extensions);
  if (exts.includes("png") && !exts.includes("pdf")) return [joinPath(DOCS_DIR, "관인.png")];
  if (exts.includes("gguf")) return ["/Volumes/USB/models/gemma-3-12b-it-q4_k_m.gguf"];
  if (exts.includes("csv") && !exts.includes("hwp")) return [joinPath(DOCS_DIR, "참가자 명부.xlsx")];
  const pool = SAMPLE_FILES.filter((f) => exts.includes(f.split(".").pop() ?? ""));
  return multiple ? pool.slice(0, 3) : pool.slice(0, 1);
}

export function mockPickFolder(): string {
  return joinPath(DOCS_DIR, "받은 문서");
}
