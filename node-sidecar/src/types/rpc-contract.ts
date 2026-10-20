/**
 * KorDoc AI v2 — 사이드카 RPC 계약 (정본)
 *
 * 프론트(src/)는 이 파일을 `import type` 으로 읽고, 사이드카 핸들러는 이 모양대로 돌려준다.
 * 메서드를 추가·변경하면 여기부터 고친다. Rust 화이트리스트(src-tauri/src/commands/sidecar_cmd.rs)도 같이.
 *
 * 공통 규칙
 * - 경로는 전부 절대 경로 문자열. 사이드카가 validatePath 로 검사한다.
 * - 오래 걸리는 호출은 params 에 `__stream: string`(프론트가 만든 고유 표지)을 붙이면
 *   진행률(`progress`)·AI 토큰(`ai_token`) 알림에 같은 `stream` 이 실려 온다.
 *   Rust 는 모든 알림을 Tauri 이벤트 `sidecar:notify` { method, params } 로 넘긴다.
 *   취소: `cancel` { stream }.
 * - 저장하는 호출은 `output_path`(파일) 또는 `output_dir`(폴더)를 받는다. 없으면
 *   설정의 출력 폴더 → 그것도 없으면 원본 옆(원본이 없으면 문서 폴더). 같은 이름이 있으면 `이름 (2).확장자` 로 피한다
 *   — output_path 를 줘도 기존 파일·원본은 덮어쓰지 않는다 (예외: 폴더 감시 결과는 같은 원본마다 갱신, write_file 은 overwrite).
 * - 실패는 JSON-RPC 오류(사람이 읽을 한국어 문장). 일부만 실패하는 일괄 작업은 결과 안에 담는다.
 */

import type { Settings } from './index.js';

// ── 공통 ──

export type DocFormat = 'hwp' | 'hwp3' | 'hwpx' | 'hwpml' | 'pdf' | 'xls' | 'xlsx' | 'docx' | 'pptx' | 'image' | 'md' | 'txt' | 'csv' | 'unknown';

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  format: DocFormat;
}

export interface PagePreview {
  page: number;
  /** pt 단위 원본 크기 */
  width: number;
  height: number;
  /** data:image/png;base64,... */
  data_url: string;
}

export interface LintFinding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  excerpt?: string;
  suggestion?: string;
  /** 바꿀 말이 정해진 지적(쉬운 말·순화어·날짜 띄어쓰기) — lint_fix 로 서식 그대로 고칠 수 있다 */
  fix?: { from: string; to: string };
  /** 화면에 보일 갈래 이름 (규칙 코드 대신, 예: 날짜 표기·금액 표기) */
  category?: string;
  /** 걸린 곳을 감싼 낱말들 (마크다운 표지를 걷어 낸 화면용 발췌) */
  context?: string;
  /** 걸린 곳이 있는 쪽 (알 때만, 1부터) */
  page?: number;
}

export type RedactRule = 'rrn' | 'phone' | 'email' | 'card' | 'account' | 'passport' | 'driver' | 'brn' | 'crn' | 'ip' | 'name' | 'address';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Citation {
  n: number;
  /** 빈 문자열이면 답이 없는 조각 번호를 단 것 (verified false) */
  path: string;
  page?: number;
  heading?: string;
  excerpt: string;
  /** 인용 검증: 이 번호를 단 문장들의 숫자·날짜·금액·비율이 근거 조각 원문에 모두 있음 (표기 차이는 정규화해 비교) */
  verified: boolean;
  /** 근거 조각에 없는 숫자 표현 (답에 적힌 그대로) */
  mismatch?: string[];
}

export interface BatchItemResult {
  path: string;
  ok: boolean;
  output_path?: string;
  error?: string;
  /** 결과 한 줄 (예: 한글로 바꾸기에서 고른 서식) */
  note?: string;
}

// ── 메서드 표: 이름 → [params, result] ──

export interface RpcMethods {
  // ── 시스템 (methods/system.ts) ──
  ping: [Record<string, never>, 'pong'];
  system_info: [Record<string, never>, SystemInfo];
  engine_selftest: [{ ocr?: boolean; llama?: boolean }, { ok: boolean; steps: Array<{ name: string; ok: boolean; ms: number; detail?: string }> }];
  get_settings: [Record<string, never>, Settings];
  update_settings: [{ settings: DeepPartial<Settings> }, Settings];
  open_folder: [{ path: string }, boolean];
  open_file: [{ path: string }, boolean];
  /** 탐색기·Finder 에서 파일을 선택한 채로 폴더 열기 */
  reveal_file: [{ path: string }, boolean];
  list_files: [{ path: string }, Array<{ name: string; is_dir: boolean; size: number }>];
  /** 파일·폴더 섞인 목록 → 지원 문서만 펼친 목록 (폴더는 하위까지, 최대 2,000개) */
  scan_paths: [{ paths: string[] }, { files: FileEntry[]; skipped: number }];
  read_batch_manifest: [{ path: string }, { action: string; files: string[]; created_at?: string }];
  detect_mcp_env: [Record<string, never>, McpEnv];
  /** 동봉 Node + 동봉 kordoc/dist/mcp.js 경로로 등록 (npx 불필요). env: 폐쇄망 모드면 KORDOC_OFFLINE=1, root_dir 이면 KORDOC_ROOT, 늘 KORDOC_MODEL_CACHE(앱의 OCR 모델) */
  install_mcp_config: [{ clients: string[]; root_dir?: string }, { installed: string[]; failed: Array<{ client: string; error: string }> }];
  models_status: [Record<string, never>, { ocr: { ready: boolean; dir: string }; formula: { ready: boolean; dir: string } }];
  /** 폐쇄망 반입: 폴더에서 OCR 모델 파일(det.onnx·rec_korean.onnx·rec_korean.yml) 가져오기 */
  models_import: [{ dir: string }, { imported: string[] }];

  // ── 문서 (methods/documents.ts, 전부 로컬) ──
  doc_info: [{ path: string; password?: string }, DocInfo];
  convert: [ConvertParams & { path: string; save?: boolean }, ConvertResult];
  convert_batch: [ConvertParams & { paths: string[] }, { results: BatchItemResult[]; output_dir: string }];
  /** 쪽 미리보기 — HWP·HWPX(kordoc 렌더), PDF(pdfium), 이미지. 그 밖은 오류 'NO_LAYOUT:' 로 시작 → 프론트는 글 보기로.
   *  pages 없으면 앞 5쪽, 한 번에 20쪽까지. 이미지는 width·height 가 원본 px */
  render_pages: [{ path: string; pages?: string; max_width?: number; password?: string }, { page_count: number; pages: PagePreview[] }];
  /** HWP·HWPX 는 조판 그대로(rhwp 쪽 SVG → Chromium 인쇄, 실패 시 kordoc 렌더), 그 밖은 글 변환 후 인쇄용 PDF. Chromium(Edge·Chrome) 필요 — 없으면 안내 오류 */
  /** overwrite: 저장 창에서 고른 경로라 있는 파일을 바꾼다. 없으면 같은 이름이 있을 때 (2) 를 붙인다 */
  export_pdf: [{ path: string; output_path?: string; overwrite?: boolean }, { output_path: string }];
  ocr: [{ input_path: string; output_path?: string; pages?: string; engine?: 'local' | 'ai'; force?: boolean }, { success: boolean; output_path: string; markdown: string; page_count?: number; engine: 'local' | 'ai'; warnings?: string[]; error?: string }];
  compare: [{ old_path: string; new_path: string; export?: 'html' | 'md' | 'xlsx'; output_path?: string }, CompareResult];
  /** allow_empty: 표가 없으면 오류 대신 빈 결과(일괄 처리에서 "뽑을 것 없음"으로) */
  tables_extract: [{ path: string; format: 'xlsx' | 'csv' | 'md'; pages?: string; only_data?: boolean; output_path?: string; allow_empty?: boolean }, TablesResult];
  /** 공문서 작성 메타 — 프리셋·기관·내장 서식 */
  gongmun_meta: [Record<string, never>, GongmunMeta];
  generate_hwpx: [GenerateParams, { output_path?: string; warnings: string[]; lint: LintFinding[]; preview?: PagePreview[]; preview_hwpx_b64?: string }];
  template_fields: [{ template?: string; path?: string }, { fields: Array<{ name: string; label?: string; multiline?: boolean }> }];
  template_fill: [{ template?: string; path?: string; values: Record<string, string>; output_path?: string }, { output_path: string; filled: string[]; unmatched: string[] }];
  /** 명부(xlsx·csv) 한 줄 = 문서 한 장 */
  /** org(기본 true): 명부에 없는 칸은 내 기관 정보로. 날짜·전화 열은 같은 모양으로. output_dir 는 한 장이라도 만들었을 때만(아니면 ''). 파일 번호는 1부터.
   *  rejected: 같은 이름 칸이 양식 여러 곳에 있어 넣지 않은 열 */
  mail_merge: [{ template_path?: string; template?: string; data_path: string; name_column?: string; output_dir?: string; org?: boolean }, { outputs: string[]; failed: Array<{ row: number; error: string }>; output_dir: string; rejected?: string[] }];
  /** 명부를 돌리기 전에 짝 보기 — 명부 열마다 들어갈 양식 칸, 양식 칸마다 채울 열(없으면 내 기관 정보 값) */
  mail_merge_plan: [{ template_path?: string; template?: string; data_path: string; org?: boolean }, MailMergePlan];
  /** 새로 쓰기 작업 사본 경로 — 앱 데이터 폴더의 '작업 사본'(문서 폴더에 초안이 쌓이지 않게). 같은 이름이 있으면 (2) */
  working_path: [{ name: string }, { path: string; dir: string }];
  /** 공문서 표기법 검사 (kordoc 표기 규칙) — text 또는 path */
  lint: [{ text?: string; path?: string; numbers?: boolean; styles?: boolean; munche?: boolean }, { findings: LintFinding[]; counts: { error: number; warning: number; info: number } }];
  /** 개인정보 마스킹 — HWPX·HWP 는 서식 그대로(+잔존 재검사), 그 밖은 가린 .md */
  /** keep: 가리지 않고 남길 글(기관 대표번호·담당 공무원 이름 등). PDF·스캔·그림은 검은 상자를 칠한 쪽 그림 PDF(글자층 없음). also_pdf: 한글 문서를 가린 뒤 PDF 로도 */
  redact: [{ path: string; rules?: RedactRule[]; mask_char?: string; dry_run?: boolean; output_path?: string; keep?: string[]; also_pdf?: boolean }, RedactResult];
  redact_batch: [{ paths: string[]; rules?: RedactRule[]; mask_char?: string; output_dir?: string; keep?: string[] }, { results: Array<BatchItemResult & { total?: number; residual?: number }>; output_dir: string }];
  seal: [{ path: string; image_path: string; anchor: string; output_path?: string }, { output_path: string; placed: number }];
  /** 고친 글(md)을 원본 HWPX·HWP 에 서식 그대로 반영. 글은 convert(keep_layout:true) 로 뽑은 것 */
  /** 고른 표기 지적(fix)만 문서에 반영한 사본 — 서식 그대로(kordoc 패치·무결성 검사). HWPX·HWP */
  lint_fix: [{ path: string; fixes: Array<{ from: string; to: string }>; output_path?: string }, { output_path: string; replaced: number; applied: number; skipped: Array<{ reason: string; excerpt?: string }> }];
  patch_document: [{ path: string; markdown: string; output_path?: string }, { output_path: string; applied: number; skipped: Array<{ reason: string; excerpt?: string }> }];
  validate_hwpx: [{ path: string }, { ok: boolean; issues: Array<{ severity: string; message: string; part?: string }> }];
  /** 폴더 감시 — 새 문서가 들어오면 자동 변환. 알림 `watch_event` { id, path, ok, output_path?, error? }.
   *  out_dir 없으면 설정 출력 폴더 → 감시 폴더 안 '변환 결과'. 하위 폴더 구조 그대로, 같은 원본은 덮어씀 */
  watch_start: [{ dir: string; out_dir?: string; format?: 'md' | 'html' | 'txt' }, { id: string }];
  watch_stop: [{ id: string }, boolean];
  watch_list: [Record<string, never>, Array<{ id: string; dir: string; out_dir: string; format: string; processed: number; started_at: string }>];
  merge_files: [{ files: string[]; output_path?: string; mode?: 'native' | 'markdown' }, unknown];
  split_pdf: [{ input_path: string; output_dir?: string; mode?: 'each' | 'range'; ranges?: string }, unknown];
  pdf_page_count: [{ input_path: string }, { page_count: number }];
  pdf_extract_pages: [{ input_path: string; pages: string; mode?: 'include' | 'exclude'; output_path?: string }, unknown];
  /** 고른 프린터(없으면 기본)로 바로 보낸다 — 인쇄 대화상자 없음. HWP·HWPX 는 rhwp 조판 PDF 로 바꿔 보낸다 */
  print_files: [{ files: string[]; printer?: string }, { queued: number; jobIds: string[]; failed: Array<{ file: string; reason: string }> }];
  list_printers: [Record<string, never>, Array<{ name: string; isDefault: boolean; status: 'ready' | 'offline' | 'error'; driver?: string }>];
  // 기존 양식·편집 세션 (FillWizard·DocEditor 그대로) — form_schema·form_fill·patch_blocks·render_preview·edit_* 는 v1 모양 유지

  // ── 받은 공문 (methods/inbox.ts) ──
  /** 받은 공문을 읽어 보낸 곳·문서번호·제목·요청 사항·기한을 뽑아 목록에 넣는다 (AI 없이, 같은 파일은 다시 읽어 갱신) */
  inbox_add: [{ paths: string[] }, { items: InboxItem[]; failed: Array<{ path: string; error: string }> }];
  inbox_list: [Record<string, never>, { items: InboxItem[] }];
  /** 사람이 고친 기한·상태·메모 (due null 이면 뽑은 기한으로 되돌림) */
  inbox_update: [{ id: string; status?: 'todo' | 'done'; due?: string | null; note?: string }, InboxItem];
  inbox_remove: [{ id: string }, boolean];
  /** 접수대장 엑셀 — 접수일·보낸 곳·문서번호·시행일·제목·요청 사항·기한·상태·메모·파일 (할 일 먼저 기한 순) */
  inbox_export: [{ output_path?: string }, { output_path: string; count: number }];

  // ── 법령 근거 확인 (methods/law.ts) ──
  /** 글·문서 속 「법령명」 제N조(제N항제N호가목) 인용을 찾아 법제처 현행 법령과 대조 (인터넷·OC 필요, 폐쇄망이면 찾기만).
   *  인용 문장과 조문 내용 맞춰 보기(낱말 겹침, ai 가 false 가 아니고 AI 가 연결돼 있으면 앞의 몇 건은 AI 판단),
   *  문서 날짜(as_of, 없으면 글의 시행일·날짜 줄) 당시 조문과 현행 비교 */
  law_check: [{ text?: string; path?: string; ai?: boolean; as_of?: string }, LawCheckResult];
  /** 설정의 OC 로 법제처에 한 번 물어 연결 확인 */
  law_test: [Record<string, never>, { ok: boolean; error?: string }];

  // ── 결재 전 점검 (methods/review.ts) ──
  /** AI 없이 빠른 검사를 한 목록으로 — 표기법·날짜와 요일·표 합계·끝. 표시·빈칸 안내 글자·남은 개인정보(정보공개 기준, keep 제외). 쪽은 알 때만 */
  precheck: [{ path: string; munche?: boolean; keep?: string[] }, PrecheckResult];
  /** 글이 처음 나오는 쪽 (한글은 rhwp 조판, PDF 는 쪽 글. 못 찾거나 쪽이 없는 형식은 null) */
  find_pages: [{ path: string; texts: string[] }, { pages: Array<number | null> }];

  // ── AI (methods/ai.ts) ──
  ai_status: [Record<string, never>, AiStatus];
  /** 연결 시험 — 짧은 질문 한 번 */
  ai_test: [Record<string, never>, { ok: boolean; latency_ms: number; sample?: string; error?: string }];
  /** 저장 전 설정값으로 모델 목록 (OpenAI 호환 서버) */
  ai_list_models: [{ base_url?: string; api_key?: string }, { models: string[] }];
  ai_warmup: [Record<string, never>, { gpu: string | false; context_size: number }];
  llm_catalog: [Record<string, never>, LlmCatalogItem[]];
  llm_list: [Record<string, never>, Array<{ path: string; name: string; size: number }>];
  /** 추천 모델 받기 (인터넷 필요, 이어받기). 진행률은 progress 알림 */
  llm_download: [{ id: string }, { path: string }];
  /** 폐쇄망 반입: 가진 .gguf 파일을 앱 모델 폴더로 복사 */
  llm_import: [{ path: string }, { path: string }];
  llm_delete: [{ path: string }, boolean];
  ai_summarize: [{ path?: string; text?: string; style?: 'standard' | 'briefing' | 'review' | 'action'; length?: 'short' | 'medium' | 'long' }, { summary: string; redacted: number }];
  /** 문서와 대화 — 근거 조각 번호 [n] 인용 + 인용 검증. unsupported = 숫자가 있는데 [n] 을 달지 않은 문장 */
  ai_chat: [{ paths: string[]; question: string; history?: ChatMessage[] }, { answer: string; citations: Citation[]; redacted: number; unsupported?: string[] }];
  /** 공문서 초안 — 결과 markdown 은 generate_hwpx 로 바로 넣을 수 있는 모양.
   *  kind: 'reply'(받은 공문에 회신 — references[0] 이 받은 공문) · 'complaint'(민원 답변) · 'minutes'(메모 → 회의록) · 'onepage'(긴 문서 → 한 장 보고) · 'press'(보도자료). 없으면 preset 을 따른 일반 초안 */
  ai_draft: [{ instruction: string; preset?: string; kind?: 'reply' | 'complaint' | 'minutes' | 'onepage' | 'press' | 'memo'; references?: string[]; length?: 'short' | 'medium' | 'long' }, { markdown: string; redacted: number }];
  /** gaejosik: 개조식으로 · narrative: 서술문으로 · public: 쉬운 공공언어로(행정 용어 순화) · press: 보도자료 문체 */
  ai_rewrite: [{ text: string; mode: 'polish' | 'concise' | 'formal' | 'plain' | 'expand' | 'english' | 'gaejosik' | 'narrative' | 'public' | 'press' | 'custom'; instruction?: string }, { text: string; redacted: number }];
  /** K팀장 검토 — AI 논리·숫자·날짜 검토 + 표기법 검사 결과를 함께 */
  ai_review: [{ path: string }, { summary: string; issues: ReviewIssue[]; lint: LintFinding[]; redacted: number }];
  /** 참고 문서·지시를 읽고 서식 칸에 넣을 값 제안. guides = 칸별 안내문(누름틀 안내 글자), instruction = 무슨 문서를 쓰는지(예: "체육대회 개최 안내 공문") */
  /** 서식대로 새로 쓰기 — 견본·양식의 서식은 두고 내용만 AI 가 지시·참고 문서대로 (kordoc 서식 베끼기 + 공문서 게이트). HWP 견본은 HWPX 로 낸다 */
  ai_template_write: [{ path: string; instruction: string; references?: string[]; output_path?: string }, {
    output_path: string; applied: number; skipped: string[]; redacted: number; converted: boolean;
    findings: Array<{ axis: '표기법' | '문체' | '윤문' | '구성'; rule: string; line: number; match: string; message: string; severity: 'error' | 'warning' | 'info'; suggest?: string }>;
  }];
  ai_fill_suggest: [{ fields: string[]; references: string[]; note?: string; instruction?: string; guides?: Record<string, string> }, { values: Record<string, string>; redacted: number }];
  /** 여러 문서에서 같은 항목을 뽑아 표(xlsx, output_path 가 .csv 면 csv)로. rows 맨 앞에 "파일"(문서 이름) 칸이 붙는다 */
  ai_extract: [{ paths: string[]; columns: string[]; output_path?: string }, { rows: Array<Record<string, string>>; output_path: string; failed: BatchItemResult[] }];
  /** 장평·자간으로도 마지막 줄이 몇 글자 넘치는 문단만 AI 가 줄여 쓴다 — generate_hwpx 와 같은 옵션 */
  ai_fit_lines: [GenerateParams, { markdown: string; changes: Array<{ before: string; after: string }>; remaining: number }];

  // ── 직장인 문서 작업 묶음 (methods/documents.ts — A) ──
  /** PDF·워드·스캔본·엑셀 → 고칠 수 있는 한글(HWPX). 레이아웃 그대로가 아니라 글·표를 다시 조판 */
  /** preset: 'auto' 면 문서 모양을 보고 갈래를 고른다(확실하지 않으면 꾸밈 없이). style = 실제로 쓴 서식 */
  to_hwpx: [{ path: string; preset?: string; ocr?: 'auto' | 'force' | 'off'; output_path?: string }, { output_path: string; warnings: string[]; style: string }];
  to_hwpx_batch: [{ paths: string[]; preset?: string; output_dir?: string }, { results: BatchItemResult[]; output_dir: string }];
  /** 신구대조표를 한글 표(현행 | 개정안)로 — 규정·조례 개정 */
  compare_hwpx: [{ old_path: string; new_path: string; title?: string; output_path?: string }, { output_path: string; stats: CompareResult['stats'] }];
  /** 결재·공개용 합본 PDF — 본문 + 붙임 순서대로, 워터마크("대외비"·"사본" 등)·쪽번호 선택 */
  bundle_pdf: [{ paths: string[]; output_path?: string; watermark?: string; page_numbers?: boolean }, { output_path: string; page_count: number; failed: BatchItemResult[] }];
  pdf_stamp: [{ path: string; watermark?: string; page_numbers?: boolean; output_path?: string }, { output_path: string }];
  /** 문서 속 그림만 폴더로 */
  /** allow_empty: 그림이 없으면 오류 대신 { count: 0, output_dir: '' } */
  extract_images: [{ path: string; output_dir?: string; allow_empty?: boolean }, { output_dir: string; count: number }];
  /** 여러 문서에서 낱말 찾기 (파싱 결과 캐시) */
  search_files: [{ paths: string[]; query: string; max_hits?: number }, { results: Array<{ path: string; hits: Array<{ page?: number; excerpt: string }> }>; searched: number; failed: number }];
  /** 취합 — 같은 서식으로 받은 문서 여러 개 → 칸 이름 후보 */
  collect_fields: [{ paths: string[] }, { fields: Array<{ label: string; count: number }> }];
  /** 취합 — 고른 칸들을 문서마다 한 줄로 엑셀 */
  collect_run: [{ paths: string[]; fields: string[]; output_path?: string }, { output_path: string; rows: number; failed: BatchItemResult[] }];
  /** 문서 수합 — 부서 명단 읽기: 붙여 넣은 글(줄·쉼표마다 하나) 또는 명단 파일(엑셀·CSV 의 부서 열, 한글·워드·PDF 의 첫 표나 줄) */
  collect_roster: [{ text?: string; path?: string }, { names: string[] }];
  /** 문서 수합 — 부서 제출물(HWPX·HWP·엑셀·CSV·PDF·워드 섞임) → 엑셀 한 장(제출물마다 한 줄·합계 행·빈 필수 칸 노란 표시 + "제출 현황" 시트)
   *  + 미제출 부서·독촉 글. 같은 서식은 칸(누름틀·라벨 표)으로, 엑셀은 열 이름을 맞춰 행으로 잇고, 다른 서식은 use_ai 면 AI 로 뽑고 아니면 separate 로.
   *  overwrite: 늦게 온 파일을 더 넣어 같은 파일을 다시 만들 때(사용자가 바꾸기를 확인함) */
  collect_gather: [CollectGatherParams, CollectGatherResult];
  /** 사용자가 고른 경로에 바이트 저장 (편집기 내보내기 등). 허용 확장자: hwp·hwpx·hml·pdf·md·txt·html·csv·xlsx·png */
  write_file: [{ path: string; data_b64: string; overwrite?: boolean }, { path: string }];
  /** preview: HWPX 의 빈 누름틀 안내문을 글로 넣은 미리보기 사본 (rhwp 가 안내문 폭을 0으로 잡아 뒤 글자가 겹치는 것 우회) */
  read_file_b64: [{ path: string; preview?: boolean }, { data_b64: string; name: string; size: number }];
  /** 내장 편집기로 열 바이트 — 변경 추적 HWP 는 지금 내용으로(tracking_dropped), token 은 editor_write 에 넘겨 rhwp 가 빠뜨린 것을 되붙인다.
   *  save_blocked: 추적 기록을 뺄 수 없어 HWP 로 저장하면 안 되는 문서 (사용자 문장) */
  editor_open: [{ path: string }, { data_b64: string; name: string; size: number; token: string; tracking_dropped: boolean; save_blocked?: string }];
  /** 편집기 내보내기 저장 — token 의 원본에서 바탕쪽·메모·수식 캡션·필드 종류를 되붙이고(HWP), 처음 덮어쓰는 파일은 `.bak` 을 남긴다.
   *  tails_lost: 되붙이지 못한 목록이 있다 (한글에서 열어 확인하라고 알린다). backup: false 면 .bak 을 만들지 않는다 (앱 작업 사본) */
  editor_write: [{ path: string; data_b64: string; token?: string; overwrite?: boolean; backup?: boolean }, { path: string; backup_path?: string; tails_lost?: boolean }];
  /** 편집기에서 내보낸 HWPX 의 미리보기 사본 (read_file_b64 preview 와 같은 처리) */
  preview_bytes: [{ data_b64: string }, { data_b64: string }];

  // ── 서식함·내 기관 정보 (methods/documents.ts — A) ──
  /** 서식함: 내장(표준 기안문 2종 + 프리셋·기관별 시작 서식) + 사용자 등록(앱 데이터 폴더 templates/) */
  template_library: [Record<string, never>, { templates: TemplateEntry[] }];
  /** 내 기관 서식 등록 — HWP·HWPX 복사 + 분석 결과 저장 */
  template_add: [{ path: string; name?: string; category?: string }, TemplateEntry];
  template_remove: [{ id: string }, boolean];
  /** 서식 분석: 누름틀 칸(HWPX 는 kordoc, HWP 는 편집기에서 GetFieldList) · 라벨 표 칸 · 항목부호 단계 서식 */
  template_analyze: [{ path: string }, TemplateAnalysis];
  /** 내장 시작 서식 HWPX 만들기 (프리셋 + 기관 서식 + 내 기관 정보로 머리·끝 채움) */
  template_starter: [{ preset: string; agency?: string; output_path?: string }, { output_path: string }];
  /** 칸 이름 → 내 기관 정보·오늘 날짜로 채울 값 (기관명·부서·담당자·전화·시행일·결재직위1… 동의어 대응) */
  org_autofill: [{ fields: string[] }, { values: Record<string, string>; matched: string[] }];

  // ── 효과·보안 (methods/insight.ts — 리드) ──
  /** 효과 집계: 일 종류별 건수 × 기준 시간(가정치, 설정 impact.baselines 로 바꿈) — 이 PC 에만 기록 */
  usage_report: [{ range?: 'month' | 'all' }, UsageReport];
  usage_reset: [Record<string, never>, boolean];
  /** 보안 상태: 폐쇄망 모드·AI 공급자·자동 마스킹·이번 실행에서 인터넷으로 나간 횟수·최근 통신 기록 */
  security_status: [Record<string, never>, SecurityStatus];
  /** 예제로 해 보기 — 합성 예제 문서(가상의 가온시)를 앱 데이터 폴더로 복사하고 시연 흐름별 경로를 돌려준다 */
  samples_list: [Record<string, never>, { dir: string; note: string; scenarios: Array<{ id: 'reply' | 'collect' | 'redact' | 'summary'; title: string; description: string; files: string[] }> }];

  // ── 한글 편집기(rhwp) (methods/editor.ts — 리드) ──
  /** 내장 rhwp-studio 를 127.0.0.1 임시 포트로 띄움. 프론트는 host_url 을 iframe 으로 (프로토콜: types/editor-bridge.ts) */
  editor_server: [Record<string, never>, { host_url: string; studio_version: string }];

  // ── 우리 서식으로 맞추기 (methods/style.ts — E) ──
  /** 견본 HWPX·HWP 에서 서식(용지·여백·본문 글꼴·줄 간격·항목 기호·단계별 글꼴·제목 모양·쪽 번호·표 모양) 읽기 */
  style_extract: [{ path: string }, { format: StyleFormat; warnings: string[] }];
  /** 서식 미리보기 — 가상의 짧은 글을 그 서식으로 만든 HWPX (rhwp 로 그린다) */
  style_preview: [{ style_id?: string; format?: StyleFormat }, { preview_hwpx_b64: string }];
  /** 읽은 서식을 이름 붙여 저장 (앱 데이터 폴더 styles/index.json) */
  style_save: [{ name: string; format: StyleFormat }, StyleEntry];
  style_list: [Record<string, never>, { styles: StyleEntry[] }];
  style_delete: [{ id: string }, boolean];
  /** 내용 문서(HWPX·HWP·PDF·워드·마크다운·글)를 그 서식으로 새 HWPX. "<원래 이름>_우리서식.hwpx" (덮어쓰지 않음) */
  style_apply: [{ source_paths: string[]; style_id?: string; sample_path?: string; output_dir?: string }, { results: BatchItemResult[]; output_dir: string; summary: string }];
}

export type RpcMethod = keyof RpcMethods;
export type RpcParams<M extends RpcMethod> = RpcMethods[M][0];
export type RpcResult<M extends RpcMethod> = RpcMethods[M][1];

// ── 세부 타입 ──

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface SystemInfo {
  app_version: string;
  kordoc_version: string;
  node_version: string;
  platform: string;
  data_dir: string;
  model_cache: string;
  ocr_models_ready: boolean;
  offline: boolean;
  ai_provider: Settings['ai']['provider'];
  llm_models: Array<{ path: string; name: string; size: number }>;
}

export interface McpEnv {
  clients: Array<{ id: string; name: string; installed: boolean; configured: boolean; config_path: string }>;
}

export interface DocInfo {
  path: string;
  name: string;
  size: number;
  format: DocFormat;
  page_count?: number;
  title?: string;
  author?: string;
  created?: string;
  modified?: string;
  encrypted: boolean;
  /** 스캔 쪽이 있어 OCR 이 필요 */
  needs_ocr: boolean;
  /** 쪽 미리보기(render_pages) 가능 */
  has_layout: boolean;
  /** 서식 보존 편집·채우기 가능 (HWPX) */
  editable: boolean;
  warnings: string[];
}

export interface ConvertParams {
  format?: 'md' | 'html' | 'json' | 'chunks' | 'txt';
  pages?: string;
  password?: string;
  ocr?: 'auto' | 'force' | 'off';
  /** 모든 표를 HTML 로 */
  html_tables?: boolean;
  /** 원본 표 구조 그대로 (patch_document 로 되돌릴 편집본) */
  keep_layout?: boolean;
  /** false 면 그림 파일 안 뽑음 */
  images?: boolean;
  output_dir?: string;
}

export interface ConvertResult {
  output_path?: string;
  /** md·html·txt 는 본문, json·chunks 는 JSON 문자열 */
  content: string;
  page_count?: number;
  warnings: string[];
}

export interface CompareResult {
  stats: { added: number; removed: number; modified: number; unchanged: number };
  /** 신구대조표 행 — 바뀐 곳 위주(unchanged 는 앞뒤 문맥 1개씩만) */
  rows: Array<{ type: 'added' | 'removed' | 'modified' | 'unchanged'; old: string; new: string }>;
  output_path?: string;
}

/** 받은 공문 한 건 — 보낸 곳·문서번호·제목·요청 사항·기한 (inbox_*) */
export interface InboxItem {
  id: string;
  path: string;
  name: string;
  added_at: string;
  sender?: string;
  doc_number?: string;
  /** 시행일 YYYY-MM-DD */
  sent_date?: string;
  title?: string;
  /** 요청 문장과 그 기한(YYYY-MM-DD) */
  requests: Array<{ text: string; due?: string }>;
  /** 가장 이른 기한 YYYY-MM-DD — 사람이 고친 값이 우선 */
  due?: string;
  status: 'todo' | 'done';
  note?: string;
}

export interface CollectGatherParams {
  paths: string[];
  /** 부서 명단 (collect_roster 로 읽은 이름). 없으면 부서 칸·파일 이름에서 짐작하고 미제출은 모른다 */
  roster?: string[];
  /** 같은 서식에서 쓸 칸 (없으면 문서 절반 이상에 있는 칸) */
  fields?: string[];
  /** 독촉 글에 넣을 제출 기한 (글 그대로, 예: "10. 20.(화)") */
  deadline?: string;
  /** 서식이 다른 문서를 AI 로 뽑기 (AI 연결이 없으면 무시하고 separate 로) */
  use_ai?: boolean;
  output_path?: string;
  /** output_path 가 없을 때 저장할 폴더 (이름은 "<제목>_수합.xlsx") */
  output_dir?: string;
  overwrite?: boolean;
}

export interface CollectGatherResult {
  output_path: string;
  /** 첫 시트 자료 행 수 (합계 행 빼고) */
  rows: number;
  /** 엑셀 열 (제출 파일·부서 빼고). required 는 빈칸을 세는 열 */
  columns: Array<{ label: string; required: boolean; total?: number }>;
  /** 같은 서식 문서·엑셀·AI 로 뽑은 문서 수 */
  by_kind: { form: number; excel: number; ai: number };
  /** 서식이 달라 따로 봐야 할 문서 */
  separate: Array<{ path: string; dept: string; reason: string }>;
  failed: BatchItemResult[];
  /** 빈 필수 칸 수 */
  blanks: number;
  /** 제출 현황 — 명단 순서, 그 뒤 명단에 없는 부서·부서를 모르는 파일(dept '') */
  status: Array<{ dept: string; in_roster: boolean; submitted: boolean; files: string[]; blanks: number }>;
  missing: string[];
  /** 미제출 부서에 보낼 독촉 글 (미제출이 없으면 '') */
  reminder: string;
  /** 제출물 제목 (가장 많은 서식의 첫 제목, 독촉 글에 씀) */
  title: string;
}

/** 글 속 법령 인용 한 건과 법제처 대조 결과 (law_check) */
export interface LawCitation {
  /** 원문 인용 그대로 (예: 「개인정보 보호법」 제17조제1항) */
  text: string;
  law: string;
  article?: string;
  status: 'ok' | 'not_found' | 'article_missing' | 'renamed' | 'unchecked';
  /** 이름이 바뀌었으면 현행 법령명 */
  current_name?: string;
  article_title?: string;
  /** 현행 조문 앞부분 */
  article_text?: string;
  url?: string;
  /** 인용한 항·호·목 (제1항제2호가목 → 1, "2", "가". 제2호의3 → "2의3") */
  paragraph?: number;
  item?: string;
  subitem?: string;
  /** 상태를 쉬운 말로 (예: "제17조에 제3항이 없습니다. 제17조는 제2항까지 있습니다.") */
  reason?: string;
  /** article_missing 일 때 없는 단계 (조·항·호·목) */
  missing?: 'article' | 'paragraph' | 'item' | 'subitem';
  /** 문서에서 이 인용이 든 문장 (내용이 모자라면 다음 문장까지) */
  sentence?: string;
  /** 인용한 항·호·목의 법제처 현행 원문 (항·호를 인용하지 않았으면 조 전체) */
  cited_text?: string;
  /** 조 전체 현행 원문 (줄마다 항·호·목, 길면 앞부분) */
  article_full?: string;
  /** 인용 문장과 조문 내용 맞춰 보기 (문장에 내용 낱말이 모자라면 없음) */
  match?: LawMatch;
  /** 그 당시 조문과 비교한 기준 날짜 YYYY-MM-DD (비교했을 때만) */
  as_of?: string;
  /** 기준 날짜 뒤에 바뀜: amended(개정됨, 현행과 다름) · added_later(그 당시엔 없던 조문·항) · deleted_since(그 당시엔 있었으나 지금은 삭제) */
  changed_since?: {
    kind: 'amended' | 'added_later' | 'deleted_since';
    reason: string;
    /** 그 당시 원문 (인용한 단계) */
    then_text?: string;
    /** 어절 단위 차이 (그 당시에서 빠진 것·현행에 더해진 것) */
    removed?: string[];
    added?: string[];
  };
}

/** 인용 문장과 조문 내용 — match(맞음) · check(확인 필요) · mismatch(안 맞음, AI 만). by: 낱말 겹침(words)·AI */
export interface LawMatch {
  verdict: 'match' | 'check' | 'mismatch';
  by: 'words' | 'ai';
  reason: string;
  /** 문장과 조문에 함께 있는 낱말 (AI 면 이유에 인용한 조문 낱말 중 원문에 실제로 있는 것) */
  overlap: string[];
  /** 낱말 겹침 비율 0~1 (words 일 때) */
  score?: number;
}

export interface LawCheckResult {
  citations: LawCitation[];
  /** 법제처에 실제로 물어봤는가 (폐쇄망·OC 없음이면 false, 인용 찾기만) */
  checked: boolean;
  note?: string;
  /** 그 당시 조문 비교 기준 날짜 YYYY-MM-DD 와 그 출처 */
  as_of?: string;
  as_of_source?: '시행일' | '문서 날짜' | '받은 공문 시행일';
  /** 확인한 것·확인 못 한 것 (까닭까지 쉬운 말로) */
  checks?: { done: string[]; skipped: string[] };
}

export interface TablesResult {
  tables: Array<{ index: number; page?: number; kind: 'data' | 'layout' | 'uncertain'; rows: number; cols: number; preview: string[][] }>;
  output_path?: string;
}

export interface GongmunMeta {
  presets: Array<{ id: string; label: string; description: string }>;
  /** 맨 앞이 '공통'(기관 간 공통값), 그다음 kordoc agencyNames() */
  agencies: string[];
  templates: Array<{ id: string; name: string; description: string; fields: string[] }>;
  /** AI 초안 갈래별 기본 문서 갈래 (정본 core/ai/draft-guides.ts KIND_PRESET) */
  kind_presets: Record<string, string>;
}

export interface GenerateParams {
  markdown: string;
  /** 효과 집계에서 뺀다 (효과 보고서 저장처럼 앱이 자기 기록을 문서로 낼 때) */
  no_usage?: boolean;
  output_path?: string;
  preset?: string;
  agency?: string;
  /** 견본 HWPX — 항목부호 단계별 글꼴·크기 학습 */
  levels_from?: string;
  /** 참조 HWPX — 표 서식 프로필 */
  profile_from?: string;
  cover?: { org?: string; date?: string };
  toc?: boolean;
  approval?: string[];
  page_numbers?: boolean;
  end_mark?: boolean;
  /** true 면 저장하지 않고 앞쪽 미리보기만 (작성실 실시간 미리보기) */
  preview_only?: boolean;
  preview_pages?: number;
  /** preview_only 와 함께: 쪽 그림 대신 만든 HWPX 를 base64 로 (화면이 rhwp 로 그려 출력과 같은 모양으로 보여 준다) */
  preview_hwpx?: boolean;
}

export interface RedactResult {
  output_path?: string;
  /** 룰별 건수 (원본 개인정보는 싣지 않음) */
  hits: Array<{ rule: RedactRule; count: number; samples: string[] }>;
  total: number;
  /** 가린 뒤 다시 검사해서 남은 건수 + 글자를 검사하지 못한 부분 수 — 0 이 아니면 사람이 확인 */
  residual: number;
  /** 서식 보존(HWPX·HWP) 여부 — false 면 .md 로 냈다 */
  preserved: boolean;
  /** also_pdf 로 함께 저장한 PDF */
  pdf_path?: string;
  /** residual 중 글자를 읽지 못한 부분(그림·스캔 쪽) 수 */
  unscanned?: number;
  /** 글자를 읽지 못한 쪽 번호 (PDF·스캔) */
  unscanned_pages?: number[];
  /** 이번에 보지 않은 개인정보 항목 — "남은 곳 없음"과 함께 밝힌다 */
  unchecked_rules?: RedactRule[];
  /** 남길 것(keep)이라 가리지 않은 곳 수 */
  kept?: number;
}

export interface PrecheckResult {
  /** 심각한 것부터 (같은 심각도는 문서 순서). rule 이 PRIVACY_* 면 개인정보, EMPTY_FIELD 는 빈 누름틀, SUM_MISMATCH 는 표 합계 */
  items: LintFinding[];
  counts: { error: number; warning: number; info: number };
  /** 바꿀 값이 정해져 lint_fix 로 서식 그대로 고칠 수 있는 지적 수 (한글 문서만) */
  fixable: number;
  /** 본 것 (화면의 "본 것" 줄) */
  checked: string[];
  /** 보지 못한 것과 까닭 */
  skipped: string[];
  page_count?: number;
}

export interface AiStatus {
  provider: Settings['ai']['provider'];
  configured: boolean;
  is_cloud: boolean;
  supports_vision: boolean;
  model?: string;
  offline: boolean;
  /** 내장 모델이 메모리에 올라 있음 */
  embedded_loaded: boolean;
  error?: string;
}

export interface LlmCatalogItem {
  id: string;
  name: string;
  file: string;
  size_gb: number;
  /** 권장 메모리 */
  ram_gb: number;
  url: string;
  license: string;
  description: string;
  recommended?: boolean;
  downloaded: boolean;
}

export interface ReviewIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  location?: string;
  message: string;
  suggestion?: string;
}

export interface MailMergePlan {
  rows: number;
  columns: Array<{ name: string; fields: string[]; sample?: string }>;
  fields: Array<{ name: string; column?: string; org?: string }>;
  rejected: string[];
}

export interface TemplateEntry {
  id: string;
  name: string;
  /** 보고서·기안문·보도자료·회의록·공고·서식 등 (사용자 분류 자유) */
  category: string;
  source: 'builtin' | 'starter' | 'user';
  /** 내장 표준 기안문은 kordoc 이름(gian·gian-simple), 시작 서식은 프리셋 id(template_starter 의 preset) */
  template?: string;
  path?: string;
  format: 'hwp' | 'hwpx';
  /** 누름틀 칸이 있어 칸 채우기로 완성 */
  has_fields: boolean;
  field_count: number;
  description: string;
  added_at?: string;
  /** 사용자 등록 서식만 — 등록할 때 분석한 결과 */
  analysis?: TemplateAnalysis;
}

export interface TemplateAnalysis {
  format: 'hwp' | 'hwpx';
  /** 누름틀(이름 있는 칸). HWP 는 비어 있을 수 있음 — 프론트가 편집기 GetFieldList 로 보충 */
  fields: Array<{ name: string; guide?: string; multiline?: boolean }>;
  /** 라벨-값 표 칸 (누름틀 없는 서식) — FillWizard 방식 */
  label_fields: Array<{ label: string; type?: string }>;
  /** 견본에서 읽은 항목부호 단계 서식 유무 → generate_hwpx levels_from 으로 쓸 수 있음 */
  has_levels: boolean;
  page_count?: number;
  /** 추천 작성 방식 */
  strategy: 'fill_fields' | 'fill_labels' | 'style_sample';
}

export interface UsageReport {
  range: string;
  /** 집계 시작일 (YYYY-MM-DD) */
  since: string;
  items: Array<{ key: string; label: string; unit: string; count: number; baseline_min: number; saved_min: number }>;
  total_count: number;
  total_saved_min: number;
}

export interface SecurityStatus {
  offline: boolean;
  ai_provider: Settings['ai']['provider'];
  ai_is_cloud: boolean;
  redact_before_cloud: boolean;
  /** 이번 실행에서 실제로 인터넷(사설·루프백 밖)으로 나간 요청 수 */
  external_sent: number;
  recent: Array<{ at: string; host: string; external: boolean; allowed: boolean }>;
  data_dir: string;
  /** 사용 통계 전송 — 없음 */
  telemetry: false;
}

/** 견본에서 읽은 서식 (우리 서식으로 맞추기). 길이는 mm, 글자 크기는 pt */
export interface StyleFormat {
  version: 1;
  /** 문서 갈래 (kordoc 공문서 프리셋 id) */
  preset: string;
  paper: { size: 'A4' | 'A3' | 'B4' | 'B5' | 'Letter' | 'custom'; width_mm: number; height_mm: number; landscape: boolean };
  /** header·footer 는 머리말·꼬리말 영역 */
  margins: { top: number; bottom: number; left: number; right: number; header: number; footer: number };
  body: { font: string; pt: number; line_spacing: number; gothic: boolean };
  /** standard = 1. 가. 1) / report = □ ○ - ㆍ / none = 항목 기호 없음. markers 는 단계 차례의 실제 기호 */
  numbering: { scheme: 'standard' | 'report' | 'none'; markers: string[]; bullet2?: string };
  levels: Array<{ depth: number; marker: string; font: string; pt: number; bold: boolean; count: number }>;
  /** box = 맨 위 제목 상자, center·left = 제목 줄, head = 기안문 두문(수신·제목 표) */
  title: { kind: 'box' | 'center' | 'left' | 'head' | 'none'; font?: string; pt?: number; bold?: boolean };
  /** ※ 참고 줄 */
  ref?: { glyph: string; font: string; pt: number };
  page_numbers: boolean;
  /** 표지·목차 쪽 (org = 표지의 기관 이름) */
  front?: { cover: boolean; toc: boolean; org?: string };
  /** 장(Ⅰ. Ⅱ.) — band = 장 띠 표, roman = 글 줄. 없으면 내용 문서의 장 제목을 첫 단계 항목으로 */
  chapters?: { count: number; style: 'band' | 'roman' };
  /** 표 모양 — 머리 줄·본문 칸의 글꼴·크기·굵기·음영·선 */
  table?: StyleTable;
  /** 기안문 두문의 기관 이름·표어 */
  head?: { org?: string; slogan?: string };
  /** 사람이 읽는 한 줄 요약 */
  summary: string;
  /** plain_chars = 기호 없는 서술 문단 글자 수 */
  stats: { paragraphs: number; chars: number; plain_chars?: number };
}

export interface StyleTableCell {
  font?: string;
  pt?: number;
  bold?: boolean;
  fill?: string;
  border?: { type: string; width: string; color: string };
}

export interface StyleTable {
  header: StyleTableCell;
  body: StyleTableCell;
  /** 표 바깥 선 */
  outer?: StyleTableCell['border'];
}

export interface StyleEntry {
  id: string;
  name: string;
  summary: string;
  created_at: string;
  format: StyleFormat;
}
