/**
 * FillWizard — 양식 자동 채우기 작업대 (KorDoc Studio Phase B).
 *
 * 좌: form_schema 기반 자동 생성 폼 (타입별 위젯 + 필수 표시 + 출처 배지)
 * 우: rhwp WASM SVG 미리보기 (프론트 WASM 실패 시 사이드카 render_preview 폴백)
 *
 * 채움은 사이드카 form_fill(kordoc fillHwpx — 원본 바이트 보존) 경유.
 * 값을 고치면 잠시 뒤(0.7초) dry_run 으로 미저장 채움 바이트를 받아 미리보기를 다시 그린다.
 * 값이 들어간 곳(filled[].target 표 칸)을 칸 목록에 적고, 칸을 고르면 미리보기에서 그 값을 짚는다.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  X, ClipboardList, Save, FolderOpen, ShieldCheck, AlertTriangle,
  Table2, CalendarDays, Phone, Mail, Banknote, CheckSquare, Type, IdCard,
  ChevronLeft, ChevronRight, Loader2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { useDialogKeys } from "../ui/useDialogKeys";
import { b64ToBytes } from "../../lib/rhwp";
import { RhwpPreview } from "../../lib/rhwp-preview";
import { annotateLabels, annotateValues } from "../../lib/svg-annotate";
import type { ImportedFile } from "../../types/pipeline";
import { dirName, joinPath } from "../../lib/format";
import { pickSavePath } from "../../lib/native";
import { errorText } from "../../lib/rpc";

// ── 사이드카 응답 타입 (node-sidecar/src/core/fill과 동기) ──

type FieldType = "text" | "date" | "phone" | "email" | "amount" | "checkbox" | "idnum";

interface SchemaField {
  label: string;
  value: string;
  type: FieldType;
  required?: boolean;
  empty: boolean;
}

interface FormSchemaRes {
  success: boolean;
  fields: SchemaField[];
  confidence: number;
  fillable: boolean;
  fillable_reason?: string;
  doc_b64?: string;
  error?: string;
}

interface FormFillRes {
  success: boolean;
  /** target: 값을 쓴 표 칸(0부터) · source clickhere: 누름틀 */
  filled: Array<{ label: string; value: string; target?: { table: number; row: number; col: number }; source?: "clickhere" }>;
  unmatched: string[];
  /** 같은 이름 칸이 여러 곳이라 넣지 않은 이름 */
  rejected?: string[];
  output_path: string;
  verification: { reparse_ok: boolean; changed_blocks: number };
  doc_b64?: string;
}

/** 값의 출처 — 출처 배지 표시용 */
interface ValueSource {
  kind: "manual" | "roster" | "existing";
  /** roster: "명부.xlsx · 성명 열 2행" */
  detail?: string;
}

const TYPE_META: Record<FieldType, { icon: React.ReactNode; hint: string }> = {
  text: { icon: <Type size={12} />, hint: "텍스트" },
  date: { icon: <CalendarDays size={12} />, hint: "날짜" },
  phone: { icon: <Phone size={12} />, hint: "전화번호" },
  email: { icon: <Mail size={12} />, hint: "이메일" },
  amount: { icon: <Banknote size={12} />, hint: "금액/수량" },
  checkbox: { icon: <CheckSquare size={12} />, hint: "체크" },
  idnum: { icon: <IdCard size={12} />, hint: "주민등록번호" },
};

/** <input type=date> ISO → 한국 공문서 날짜 표기 */
function isoToKoreanDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[1]}. ${parseInt(m[2], 10)}. ${parseInt(m[3], 10)}.`;
}

/** 0-based 열 → 엑셀 열 문자 (0→A) */
function colLetter(c: number): string {
  let s = "";
  let n = c;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

const norm = (s: string) => s.replace(/[\s:：()（）·*※★]/g, "");

type RosterTable = { rows: number; cols: number; cells: Array<Array<{ text: string }>> };

/** 파싱 결과 JSON 에서 처음 나오는 표 (블록 구조가 감싸져 있어도 찾아 들어간다) */
function findFirstTable(node: unknown): RosterTable | null {
  if (!node || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  const t = o.table as RosterTable | undefined;
  if (o.type === "table" && t && Array.isArray(t.cells)) return t;
  for (const v of Object.values(o)) {
    const found = Array.isArray(v) ? v.map(findFirstTable).find(Boolean) : findFirstTable(v);
    if (found) return found;
  }
  return null;
}

/** 값이 들어간 곳을 사람 말로 — 표 칸은 1부터 */
function placeText(f: FormFillRes["filled"][number]): string {
  if (f.target) return `${f.target.table + 1}번 표 ${f.target.row + 1}행 ${f.target.col + 1}열 칸`;
  return f.source === "clickhere" ? "누름틀 칸" : "본문 줄";
}

interface FillWizardProps {
  file: ImportedFile;
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  outputDir: string;
  /** 저장 창이 처음 열릴 폴더 (서식함 서식처럼 원본 옆이 앱 폴더일 때 넘긴다). 없으면 출력 폴더 → 원본 옆 */
  saveDir?: string;
  showToast: (msg: string, type: "success" | "error" | "info" | "loading") => void;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
}

export function FillWizard({ file, sidecarCall, outputDir, saveDir, showToast, onClose, onOpenFolder }: FillWizardProps) {
  // ── 스키마/값 상태 ──
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, ValueSource>>({});
  const [fillResult, setFillResult] = useState<FormFillRes | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "save">("");

  // ── 미리보기 상태 ──
  const docB64Ref = useRef<string | null>(null);          // 사이드카 폴백용
  const originalB64 = useRef<string | null>(null);         // 값을 모두 지우면 원본으로 되돌린다
  const previewSeq = useRef(0);                            // 늦게 온 앞 미리보기가 새 것을 덮지 않게
  // rhwp 일꾼 하나를 계속 쓴다 — 열기·그리기를 화면 스레드 밖에서 (쪽이 많으면 여는 데만 수 초, 화면이 멈추지 않게)
  const rhwpRef = useRef<RhwpPreview | null>(null);
  const rhwpReady = useRef(false);                         // 지금 문서가 일꾼에 열려 있다
  const [wasmOk, setWasmOk] = useState<boolean | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(0);
  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const [focusedLabel, setFocusedLabel] = useState("");

  const labels = useMemo(() => fields.map((f) => f.label), [fields]);
  /** 미리보기에 그려진 값 (칸을 고르면 그 값을 짚는다) */
  const shown = useRef<Array<{ label: string; value: string }>>([]);
  const annotate = useCallback((raw: string) => annotateValues(annotateLabels(raw, labels), shown.current), [labels]);

  // ── 렌더 (프론트 WASM 우선, 실패 시 사이드카 RPC) ──
  const renderPage = useCallback(async (pageNum: number) => {
    setRenderError("");
    try {
      if (rhwpReady.current && rhwpRef.current) {
        const raw = await (await rhwpRef.current.render(pageNum)).text();
        setSvg(annotate(raw));
        return;
      }
      // 사이드카 폴백
      const res = await sidecarCall("render_preview", {
        ...(docB64Ref.current ? { doc_b64: docB64Ref.current } : { input_path: file.path }),
        pages: [pageNum],
      }) as { success: boolean; page_count: number; pages: Array<{ page: number; svg: string }> };
      if (res.success && res.pages[0]) {
        setPageCount(res.page_count);
        setSvg(annotate(res.pages[0].svg));
      }
    } catch (e) {
      setRenderError(`미리보기를 그리지 못했습니다(${errorText(e)}). 값 넣기와 저장은 그대로 됩니다.`);
    }
  }, [annotate, sidecarCall, file.path]);

  /** 새 문서 바이트로 미리보기 교체 (초기 로드 + dry_run 갱신). 일꾼이 제때(8초) 못 열면 사이드카 렌더로 */
  const loadPreviewDoc = useCallback(async (b64: string) => {
    docB64Ref.current = b64;
    const bytes = b64ToBytes(b64);
    // 일꾼은 받은 차례대로 일한다: 여는 사이 들어온 그리기 요청도 새 문서로 그린다
    rhwpRef.current ??= new RhwpPreview();
    try {
      const meta = await rhwpRef.current.open(bytes.slice()); // 일꾼에 넘기는 사본 (넘긴 버퍼는 이쪽에서 못 쓴다)
      rhwpReady.current = true;
      setPageCount(meta.pageCount);
      setWasmOk(true);
    } catch (e) {
      console.warn("[FillWizard] rhwp 문서 열기 실패 — 사이드카 폴백:", e);
      rhwpReady.current = false;
      setWasmOk(false);
    }
  }, []);

  // ── 초기 로드: form_schema ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await sidecarCall("form_schema", { input_path: file.path, include_doc: true }) as FormSchemaRes;
        if (cancelled) return;
        if (!res.success) { setLoadError(res.error || "양식 인식 실패"); return; }
        if (!res.fillable) { setLoadError(res.fillable_reason || "채우기를 지원하지 않는 형식입니다"); return; }
        setFields(res.fields);
        // 기존 값은 초기값 + 출처 '양식 기존 값'
        const init: Record<string, string> = {};
        const src: Record<string, ValueSource> = {};
        for (const f of res.fields) {
          if (!f.empty && f.value.trim()) {
            init[f.label] = f.value.trim();
            src[f.label] = { kind: "existing" };
          }
        }
        setValues(init);
        setSources(src);
        originalB64.current = res.doc_b64 ?? null;
        if (res.doc_b64) await loadPreviewDoc(res.doc_b64);
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      rhwpRef.current?.dispose();
      rhwpRef.current = null;
      rhwpReady.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  // 페이지/문서 변경 시 렌더
  useEffect(() => {
    if (!loading && (rhwpReady.current || docB64Ref.current || file.path)) void renderPage(page);
  }, [page, loading, renderPage]);

  // ── 필드 포커스 → 미리보기 하이라이트 + 스크롤. 값이 들어간 칸이 보이면 그 자리를 상자로 짚는다 ──
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    root.querySelectorAll("[data-kd-hl]").forEach((e) => e.remove());
    const valueEls = [...root.querySelectorAll<SVGTextElement>("text[data-kd-value]")].filter((el) => el.getAttribute("data-kd-value") === focusedLabel);
    const els = root.querySelectorAll<SVGTextElement>("text[data-kd-label]");
    let scrolled = false;
    els.forEach((el) => {
      const hit = el.getAttribute("data-kd-label") === focusedLabel;
      el.style.fill = hit ? "var(--color-accent)" : "";
      el.style.fontWeight = hit ? "700" : "";
      if (hit && !scrolled && !valueEls.length) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        scrolled = true;
      }
    });
    const svgEl = valueEls[0]?.ownerSVGElement;
    if (!svgEl) return;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const el of valueEls) {
      const b = el.getBBox();
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
    }
    if (!Number.isFinite(x1)) return;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("data-kd-hl", "1");
    rect.setAttribute("x", String(x1 - 3)); rect.setAttribute("y", String(y1 - 3));
    rect.setAttribute("width", String(x2 - x1 + 6)); rect.setAttribute("height", String(y2 - y1 + 6));
    rect.setAttribute("rx", "2");
    rect.setAttribute("style", "fill: var(--color-accent); fill-opacity: 0.16; stroke: var(--color-accent); stroke-width: 1.5; pointer-events: none");
    svgEl.appendChild(rect);
    rect.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedLabel, svg]);

  // ── 역방향 점프: 미리보기 라벨 클릭 → 폼 필드 포커스 ──
  const handlePreviewClick = useCallback((e: React.MouseEvent) => {
    const target = (e.target as Element).closest?.("[data-kd-label]");
    const label = target?.getAttribute("data-kd-label");
    if (!label) return;
    setFocusedLabel(label);
    const input = document.querySelector<HTMLElement>(`[data-kd-field="${CSS.escape(label)}"]`);
    input?.focus();
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const setValue = useCallback((label: string, value: string, source: ValueSource = { kind: "manual" }) => {
    setValues((v) => ({ ...v, [label]: value }));
    setSources((s) => ({ ...s, [label]: source }));
  }, []);

  /** 채울 값만 추출 (빈 문자열 제외 — 코어가 빈 값 비우기를 지원하지 않음) */
  const fillValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim() && sources[k]?.kind !== "existing") out[k] = v;
    }
    return out;
  }, [values, sources]);

  // ── 명부(xlsx) 가져오기 — 출처 배지의 핵심 경로 ──
  const handleRosterImport = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "명부/데이터", extensions: ["xlsx", "xls", "csv"] }],
      });
      if (!selected) return;
      const rosterPath = Array.isArray(selected) ? selected[0] : selected;
      const rosterName = rosterPath.split(/[/\\]/).pop() ?? rosterPath;
      // v2: convert(json) 로 읽어 첫 표를 찾는다 (extract_tables 는 계약에서 빠짐)
      // 읽기만 한다: save:false (안 주면 명부 옆에 .json 사본이 생기고 효과 집계에 변환으로 잡힌다)
      const res = await sidecarCall("convert", { path: rosterPath, format: "json", save: false }) as { content: string };
      const t = findFirstTable(JSON.parse(res.content));
      if (!t) {
        showToast("명부에서 표를 찾지 못했습니다", "error");
        return;
      }
      if (t.rows < 2) { showToast("명부에 값이 든 행이 없습니다(제목 행 아래 1행 이상 필요)", "error"); return; }

      // 헤더 → 필드 라벨 매핑, 첫 데이터 행 값 사용
      let mapped = 0;
      const header = t.cells[0];
      const dataRow = t.cells[1];
      for (let c = 0; c < header.length; c++) {
        const h = norm(header[c]?.text ?? "");
        if (!h) continue;
        const field = fields.find((f) => {
          const fl = norm(f.label);
          return fl === h || fl.startsWith(h) || h.startsWith(fl);
        });
        const val = dataRow[c]?.text?.trim();
        if (!field || !val) continue;
        setValue(field.label, val, {
          kind: "roster",
          detail: `${rosterName} ${colLetter(c)}2`,
        });
        mapped++;
      }
      showToast(mapped > 0 ? `명부에서 값 ${mapped}개를 가져왔습니다` : "칸 이름과 같은 열이 없습니다", mapped > 0 ? "success" : "info");
    } catch (e) {
      showToast(`명부 가져오기 실패: ${e}`, "error");
    }
  }, [fields, setValue, sidecarCall, showToast]);

  // ── 미리보기 반영 (dry_run, 값을 고치면 저절로) / 저장 ──
  const preview = useCallback(async () => {
    const seq = ++previewSeq.current;
    if (Object.keys(fillValues).length === 0) {
      // 값을 모두 지우면 원본 그대로 보인다
      setFillResult(null);
      shown.current = [];
      if (originalB64.current && docB64Ref.current !== originalB64.current) {
        await loadPreviewDoc(originalB64.current);
        if (seq === previewSeq.current) await renderPage(page);
      }
      return;
    }
    setBusy((b) => b || "preview");
    try {
      const res = await sidecarCall("form_fill", { input_path: file.path, values: fillValues, dry_run: true }) as FormFillRes;
      if (seq !== previewSeq.current) return;
      setFillResult(res);
      shown.current = res.filled.map((f) => ({ label: f.label, value: f.value }));
      if (res.doc_b64) {
        await loadPreviewDoc(res.doc_b64);
        if (seq === previewSeq.current) await renderPage(page);
      }
    } catch (e) {
      if (seq === previewSeq.current) setRenderError(`미리보기에 반영하지 못했습니다: ${errorText(e)}`);
    } finally {
      setBusy((b) => (b === "preview" ? "" : b));
    }
  }, [fillValues, file.path, sidecarCall, loadPreviewDoc, renderPage, page]);

  // 값을 고치고 0.7초 쉬면 미리보기에 반영
  const firstValues = useRef(true);
  useEffect(() => {
    if (loading || loadError) return;
    if (firstValues.current) { firstValues.current = false; return; }
    const t = setTimeout(() => void preview(), 700);
    return () => clearTimeout(t);
    // 값이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillValues, loading]);

  const save = useCallback(async () => {
    if (Object.keys(fillValues).length === 0) {
      showToast("채울 값을 입력하세요", "info");
      return;
    }
    const name = `${file.name.replace(/\.[^.]+$/, "")}_채움.hwpx`;
    const dir = saveDir ?? (outputDir || dirName(file.path));
    const target = await pickSavePath(dir ? joinPath(dir, name) : name, [{ name: "HWPX 문서", extensions: ["hwpx"] }]);
    if (!target) return;
    setBusy("save");
    previewSeq.current++; // 저장 결과가 미리보기의 주인
    try {
      const res = await sidecarCall("form_fill", { input_path: file.path, values: fillValues, output_path: target }) as FormFillRes;
      setFillResult(res);
      shown.current = res.filled.map((f) => ({ label: f.label, value: f.value }));
      if (res.doc_b64) {
        await loadPreviewDoc(res.doc_b64);
        await renderPage(page);
      }
      if (res.success) showToast(`저장했습니다: 칸 ${res.filled.length}개 채움${res.verification.reparse_ok ? " · 다시 읽어 확인함" : ""}`, "success");
    } catch (e) {
      showToast(`저장하지 못했습니다: ${errorText(e)}`, "error");
    } finally {
      setBusy("");
    }
  }, [fillValues, file, outputDir, saveDir, sidecarCall, showToast, loadPreviewDoc, renderPage, page]);

  /** 칸 이름 → 값이 들어간 곳 */
  const placeOf = useMemo(() => new Map((fillResult?.filled ?? []).map((f) => [norm(f.label), f])), [fillResult]);

  const filledSet = useMemo(() => new Set(fillResult?.filled.map((f) => norm(f.label)) ?? []), [fillResult]);

  // ── 대화상자: Esc 닫기 · Tab 은 안에서만 · 연 단추로 포커스 되돌리기 ──
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  useDialogKeys(boxRef, true, onClose);
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boxRef.current?.focus();
    return () => prev?.focus();
  }, []);

  // ── 렌더 ──
  return (
    <div ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col outline-none" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: "color-mix(in srgb, #2563EB 12%, transparent)", color: "#2563EB" }}>
          <ClipboardList size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id={titleId} className="ts-sm font-bold truncate" style={{ color: "var(--color-text-primary)" }}>양식 채우기: {file.name}</h2>
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
            원본 모양은 그대로 두고 값만 넣습니다
            {wasmOk === false && " · 미리보기는 간단한 그림으로 보입니다"}
          </p>
        </div>
        <button onClick={onClose} type="button" className="kd-icon-btn" aria-label="닫기">
          <X size={16} style={{ color: "var(--color-text-muted)" }} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2" style={{ color: "var(--color-text-muted)" }}>
          <Loader2 size={18} className="animate-spin" /> <span className="ts-sm">양식의 칸을 찾는 중</span>
        </div>
      ) : loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <AlertTriangle size={28} style={{ color: "var(--color-warning)" }} />
          <p className="ts-sm" style={{ color: "var(--color-text-secondary)" }}>{loadError}</p>
          <Button variant="secondary" size="sm" onClick={onClose}>닫기</Button>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* ── 좌: 자동 생성 폼 ── */}
          <div className="flex flex-col overflow-hidden" style={{ width: 380, borderRight: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between px-4 py-2.5 shrink-0">
              <span className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
                입력 항목 ({fields.length})
              </span>
              <Button variant="secondary" size="sm" onClick={handleRosterImport}>
                <span className="flex items-center gap-1.5"><Table2 size={13} /> 명부에서 가져오기</span>
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
              {fields.length === 0 && (
                <p className="ts-2xs px-3 py-2 rounded-md" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)" }}>
                  채울 칸을 찾지 못했습니다. 표에 이름 칸과 값 칸이 있거나 "성명:"처럼 쓴 양식인지 확인하세요.
                </p>
              )}
              {fields.map((f) => {
                const meta = TYPE_META[f.type];
                const src = sources[f.label];
                const wasFilled = filledSet.has(norm(f.label));
                return (
                  <div key={`${f.label}-${f.type}`}>
                    <label className="flex items-center gap-1.5 ts-2xs font-semibold mb-1" style={{ color: "var(--color-text-secondary)" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>{meta.icon}</span>
                      {f.label}
                      {f.required && <span style={{ color: "var(--color-error)" }}>*</span>}
                      {f.empty && !values[f.label]?.trim() && (
                        <span className="px-1 py-0.5 rounded ts-2xs font-normal" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)" }}>빈칸</span>
                      )}
                      {wasFilled && (
                        <span className="px-1 py-0.5 rounded ts-2xs font-normal" style={{ backgroundColor: "var(--color-success-subtle)", color: "var(--color-success)" }}>채움</span>
                      )}
                    </label>

                    {f.type === "checkbox" ? (
                      <label className="flex items-center gap-2 ts-xs px-3 py-2 rounded-md cursor-pointer" style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
                        <input
                          type="checkbox"
                          data-kd-field={f.label}
                          checked={values[f.label] === "☑"}
                          onFocus={() => setFocusedLabel(f.label)}
                          onChange={(e) => setValue(f.label, e.target.checked ? "☑" : "")}
                        />
                        체크 표시
                      </label>
                    ) : f.type === "date" ? (
                      <input
                        type="date"
                        data-kd-field={f.label}
                        className="w-full px-3 py-2 rounded-md ts-xs"
                        style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none" }}
                        onFocus={() => setFocusedLabel(f.label)}
                        onChange={(e) => setValue(f.label, e.target.value ? isoToKoreanDate(e.target.value) : "")}
                      />
                    ) : (
                      <input
                        type="text"
                        data-kd-field={f.label}
                        placeholder={f.value.trim() || meta.hint}
                        value={values[f.label] ?? ""}
                        className="w-full px-3 py-2 rounded-md ts-xs"
                        style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none" }}
                        onFocus={() => setFocusedLabel(f.label)}
                        onChange={(e) => setValue(f.label, e.target.value)}
                      />
                    )}

                    {/* 출처 배지 — "성명=홍길동 ← 명부.xlsx B2" · 값이 들어간 곳 */}
                    {src && values[f.label]?.trim() && (
                      <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                        {src.kind === "roster" && `← ${src.detail}`}
                        {src.kind === "existing" && "← 양식 기존 값"}
                        {src.kind === "manual" && "← 직접 입력"}
                        {placeOf.get(norm(f.label)) && src.kind !== "existing" && (
                          <button type="button" className="ml-2" style={{ color: focusedLabel === f.label ? "var(--color-accent)" : "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}
                            onClick={() => setFocusedLabel(f.label)}>
                            넣은 곳: {placeText(placeOf.get(norm(f.label))!)}
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}

              {/* 채움 결과 리포트 */}
              {fillResult && (
                <div className="rounded-md px-3 py-2.5 space-y-1.5" style={{ backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}>
                  <div className="flex items-center gap-1.5 ts-2xs font-semibold" style={{ color: fillResult.verification.reparse_ok ? "var(--color-success)" : "var(--color-warning)" }}>
                    <ShieldCheck size={13} />
                    {fillResult.verification.reparse_ok
                      ? `다시 읽어 확인함 · 칸 ${fillResult.filled.length}개 채움 · 바뀐 곳 ${fillResult.verification.changed_blocks}곳`
                      : "검증 경고: 결과를 확인하세요"}
                  </div>
                  {fillResult.unmatched.length > 0 && (
                    <p className="ts-2xs" style={{ color: "var(--color-warning)" }}>
                      들어갈 칸을 못 찾음: {fillResult.unmatched.join(", ")}
                    </p>
                  )}
                  {(fillResult.rejected?.length ?? 0) > 0 && (
                    <p className="ts-2xs" style={{ color: "var(--color-warning)" }}>
                      같은 이름 칸이 여러 곳에 있어 넣지 않았습니다: {fillResult.rejected!.join(", ")}. 다른 칸을 덮지 않으려는 것이니 편집기에서 직접 넣으세요.
                    </p>
                  )}
                  {fillResult.output_path && (
                    <button className="flex items-center gap-1 ts-2xs" style={{ color: "var(--color-accent)" }} onClick={() => onOpenFolder(fillResult.output_path)}>
                      <FolderOpen size={12} /> 저장 위치 열기
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 푸터 버튼 */}
            <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
              <span className="ts-2xs flex-1" style={{ color: "var(--color-text-muted)" }} aria-live="polite">
                {busy === "preview" ? "미리보기에 넣는 중" : "고치면 미리보기에 바로 보입니다"}
              </span>
              <Button size="sm" onClick={() => void save()} disabled={busy === "save"}>
                <span className="flex items-center justify-center gap-1.5">
                  {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} HWPX 저장
                </span>
              </Button>
            </div>
          </div>

          {/* ── 우: rhwp SVG 미리보기 ── */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
            <div className="flex items-center justify-center gap-3 py-2 shrink-0">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded hover-bg-tertiary disabled:opacity-30" aria-label="이전 페이지">
                <ChevronLeft size={15} style={{ color: "var(--color-text-secondary)" }} />
              </button>
              <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                {pageCount > 0 ? `${page + 1} / ${pageCount}` : "쪽 읽는 중"}
              </span>
              <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="p-1 rounded hover-bg-tertiary disabled:opacity-30" aria-label="다음 페이지">
                <ChevronRight size={15} style={{ color: "var(--color-text-secondary)" }} />
              </button>
            </div>
            <div ref={previewRef} className="flex-1 overflow-auto px-6 pb-6" onClick={handlePreviewClick}>
              {renderError ? (
                <p className="ts-2xs text-center mt-8" style={{ color: "var(--color-error)" }}>{renderError}</p>
              ) : svg ? (
                <div
                  className="kd-preview mx-auto rounded shadow-lg"
                  style={{ maxWidth: 900, backgroundColor: "white" }}
                  // rhwp WASM이 생성한 SVG (로컬 신뢰 소스) — 라벨 어노테이션만 후처리
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <div className="flex items-center justify-center gap-2 mt-12" style={{ color: "var(--color-text-muted)" }}>
                  <Loader2 size={16} className="animate-spin" /> <span className="ts-2xs">그리는 중...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
