/**
 * FillWizard — 양식 자동 채우기 작업대 (KorDoc Studio Phase B).
 *
 * 좌: form_schema 기반 자동 생성 폼 (타입별 위젯 + 필수 표시 + 출처 배지)
 * 우: rhwp WASM SVG 미리보기 (프론트 WASM 실패 시 사이드카 render_preview 폴백)
 *
 * 채움은 사이드카 form_fill(kordoc fillHwpx — 원본 바이트 보존) 경유.
 * "미리보기 반영"은 dry_run으로 미저장 채움 바이트를 받아 즉시 재렌더.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, ClipboardList, Save, Eye, FolderOpen, ShieldCheck, AlertTriangle,
  Table2, CalendarDays, Phone, Mail, Banknote, CheckSquare, Type, IdCard,
  ChevronLeft, ChevronRight, Loader2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { initRhwp, openRhwpDocument, b64ToBytes, type RhwpDoc } from "../../lib/rhwp";
import { annotateLabels } from "../../lib/svg-annotate";
import type { ImportedFile } from "../../types/pipeline";

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
  filled: Array<{ label: string; value: string }>;
  unmatched: string[];
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

interface FillWizardProps {
  file: ImportedFile;
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  outputDir: string;
  showToast: (msg: string, type: "success" | "error" | "info" | "loading") => void;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
}

export function FillWizard({ file, sidecarCall, outputDir, showToast, onClose, onOpenFolder }: FillWizardProps) {
  // ── 스키마/값 상태 ──
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, ValueSource>>({});
  const [fillResult, setFillResult] = useState<FormFillRes | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "save">("");

  // ── 미리보기 상태 ──
  const docBytesRef = useRef<Uint8Array | null>(null);   // 현재 미리보기 문서 (원본 또는 dry_run 결과)
  const docB64Ref = useRef<string | null>(null);          // 사이드카 폴백용
  const rhwpDocRef = useRef<RhwpDoc | null>(null);
  const [wasmOk, setWasmOk] = useState<boolean | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(0);
  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const [focusedLabel, setFocusedLabel] = useState("");

  const labels = useMemo(() => fields.map((f) => f.label), [fields]);

  // ── 렌더 (프론트 WASM 우선, 실패 시 사이드카 RPC) ──
  const renderPage = useCallback(async (pageNum: number) => {
    setRenderError("");
    try {
      if (rhwpDocRef.current) {
        const raw = rhwpDocRef.current.renderPageSvg(pageNum);
        setSvg(annotateLabels(raw, labels));
        return;
      }
      // 사이드카 폴백
      const res = await sidecarCall("render_preview", {
        ...(docB64Ref.current ? { doc_b64: docB64Ref.current } : { input_path: file.path }),
        pages: [pageNum],
      }) as { success: boolean; page_count: number; pages: Array<{ page: number; svg: string }> };
      if (res.success && res.pages[0]) {
        setPageCount(res.page_count);
        setSvg(annotateLabels(res.pages[0].svg, labels));
      }
    } catch (e) {
      setRenderError(`미리보기 렌더 실패: ${e}`);
    }
  }, [labels, sidecarCall, file.path]);

  /** 새 문서 바이트로 미리보기 교체 (초기 로드 + dry_run 갱신) */
  const loadPreviewDoc = useCallback(async (b64: string) => {
    docB64Ref.current = b64;
    const ok = wasmOk ?? await initRhwp();
    if (wasmOk === null) setWasmOk(ok);
    if (ok) {
      try {
        rhwpDocRef.current?.free();
        rhwpDocRef.current = null;
        const bytes = b64ToBytes(b64);
        docBytesRef.current = bytes;
        const doc = openRhwpDocument(bytes);
        rhwpDocRef.current = doc;
        setPageCount(doc.pageCount);
      } catch (e) {
        console.warn("[FillWizard] rhwp 문서 열기 실패 — 사이드카 폴백:", e);
        rhwpDocRef.current = null;
      }
    }
  }, [wasmOk]);

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
        if (res.doc_b64) await loadPreviewDoc(res.doc_b64);
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      rhwpDocRef.current?.free();
      rhwpDocRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  // 페이지/문서 변경 시 렌더
  useEffect(() => {
    if (!loading && (rhwpDocRef.current || docB64Ref.current || file.path)) void renderPage(page);
  }, [page, loading, renderPage]);

  // ── 필드 포커스 → 미리보기 하이라이트 + 스크롤 ──
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    const els = root.querySelectorAll<SVGTextElement>("text[data-kd-label]");
    let scrolled = false;
    els.forEach((el) => {
      const hit = el.getAttribute("data-kd-label") === focusedLabel;
      el.style.fill = hit ? "var(--color-accent)" : "";
      el.style.fontWeight = hit ? "700" : "";
      if (hit && !scrolled) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        scrolled = true;
      }
    });
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
      const res = await sidecarCall("extract_tables", { input_path: rosterPath, as_markdown: false }) as {
        success: boolean;
        tables: Array<{ table: { rows: number; cols: number; cells: Array<Array<{ text: string }>> } }>;
      };
      if (!res.success || res.tables.length === 0) {
        showToast("명부에서 표를 찾지 못했습니다", "error");
        return;
      }
      const t = res.tables[0].table;
      if (t.rows < 2) { showToast("명부에 데이터 행이 없습니다 (헤더 + 1행 이상 필요)", "error"); return; }

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
      showToast(mapped > 0 ? `명부에서 ${mapped}개 필드 자동 매핑` : "라벨이 일치하는 열이 없습니다", mapped > 0 ? "success" : "info");
    } catch (e) {
      showToast(`명부 가져오기 실패: ${e}`, "error");
    }
  }, [fields, setValue, sidecarCall, showToast]);

  // ── 미리보기 반영 (dry_run) / 저장 ──
  const doFill = useCallback(async (dryRun: boolean) => {
    if (Object.keys(fillValues).length === 0) {
      showToast("채울 값을 입력하세요", "info");
      return;
    }
    setBusy(dryRun ? "preview" : "save");
    try {
      const stem = file.name.replace(/\.[^.]+$/, "");
      const res = await sidecarCall("form_fill", {
        input_path: file.path,
        values: fillValues,
        dry_run: dryRun,
        ...(dryRun ? {} : outputDir ? { output_path: `${outputDir}\\${stem}_채움.hwpx` } : {}),
      }) as FormFillRes;
      setFillResult(res);
      if (res.doc_b64) {
        await loadPreviewDoc(res.doc_b64);
        await renderPage(page);
      }
      if (!dryRun && res.success) {
        showToast(`저장 완료: ${res.filled.length}개 필드 채움${res.verification.reparse_ok ? " · 재파싱 검증 통과" : ""}`, "success");
      }
    } catch (e) {
      showToast(`채우기 실패: ${e}`, "error");
    } finally {
      setBusy("");
    }
  }, [fillValues, file, outputDir, sidecarCall, showToast, loadPreviewDoc, renderPage, page]);

  const filledSet = useMemo(() => new Set(fillResult?.filled.map((f) => norm(f.label)) ?? []), [fillResult]);

  // ── 렌더 ──
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: "color-mix(in srgb, #2563EB 12%, transparent)", color: "#2563EB" }}>
          <ClipboardList size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="ts-sm font-bold truncate" style={{ color: "var(--color-text-primary)" }}>양식 채우기 — {file.name}</h2>
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
            원본 서식 1바이트도 변경 없이 값만 채웁니다
            {wasmOk === false && " · 미리보기: 엔진 렌더 (WASM 폴백)"}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md hover-bg-tertiary" aria-label="닫기">
          <X size={16} style={{ color: "var(--color-text-muted)" }} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2" style={{ color: "var(--color-text-muted)" }}>
          <Loader2 size={18} className="animate-spin" /> <span className="ts-sm">양식 분석 중...</span>
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
                  인식된 양식 필드가 없습니다. 라벨-값 구조(표 또는 "라벨:")가 있는 양식인지 확인하세요.
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

                    {/* 출처 배지 — "성명=홍길동 ← 명부.xlsx B2" */}
                    {src && values[f.label]?.trim() && (
                      <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                        {src.kind === "roster" && `← ${src.detail}`}
                        {src.kind === "existing" && "← 양식 기존 값"}
                        {src.kind === "manual" && "← 직접 입력"}
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
                      ? `재파싱 검증 통과 · ${fillResult.filled.length}개 채움 · 변경 ${fillResult.verification.changed_blocks}블록`
                      : "검증 경고 — 결과를 확인하세요"}
                  </div>
                  {fillResult.unmatched.length > 0 && (
                    <p className="ts-2xs" style={{ color: "var(--color-warning)" }}>
                      매칭 실패: {fillResult.unmatched.join(", ")}
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
            <div className="flex gap-2 px-4 py-3 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
              <Button variant="secondary" size="sm" onClick={() => doFill(true)} disabled={busy !== ""}>
                <span className="flex items-center gap-1.5">
                  {busy === "preview" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} 미리보기 반영
                </span>
              </Button>
              <Button size="sm" onClick={() => doFill(false)} disabled={busy !== ""} className="flex-1">
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
                {pageCount > 0 ? `${page + 1} / ${pageCount}` : "—"}
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
                  <Loader2 size={16} className="animate-spin" /> <span className="ts-2xs">렌더링 중...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
