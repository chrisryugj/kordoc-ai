/**
 * useFillForm — 워크벤치 채우기 폼 상태 훅 (KorDoc Studio Phase R / W2).
 *
 * FillWizard 좌측 폼의 상태·로직을 워크벤치로 이식한다. 미리보기는 더 이상
 * 자체 보유하지 않고 DocumentSession에 위임한다:
 *  - 문서에 적용(미저장): form_fill(dry_run) → reopenSession (편집 세션에 수렴)
 *  - HWPX 저장:          form_fill 저장 → reopenSession (편집 세션에 수렴)
 *
 * 두 경로 모두 채움 결과를 편집 세션에 반영해 미리보기·편집 블록·변환이 한
 * 바이트를 공유한다(채우기↔편집↔변환 일관성). 적용은 미저장(dirty), 저장은
 * 추가로 _채움.hwpx 파일까지 만든다.
 *
 * 채우기/AI 탭이 한 폼 상태를 공유하도록 워크벤치 셸에서 1회 생성해 내려준다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useDocumentSession } from "../../contexts/DocumentSession";

export type FieldType = "text" | "date" | "phone" | "email" | "amount" | "checkbox" | "idnum";

export interface SchemaField {
  label: string;
  value: string;
  type: FieldType;
  required?: boolean;
  empty: boolean;
}

/** 값의 출처 — 출처 배지 표시용 */
export interface ValueSource {
  kind: "manual" | "roster" | "existing" | "ai";
  /** roster: "명부.xlsx B2", ai: "참고자료 추론" */
  detail?: string;
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

export interface FormFillRes {
  success: boolean;
  filled: Array<{ label: string; value: string }>;
  unmatched: string[];
  output_path: string;
  verification: { reparse_ok: boolean; changed_blocks: number };
  doc_b64?: string;
}

export const norm = (s: string) => s.replace(/[\s:：()（）·*※★]/g, "");

/** <input type=date> ISO → 한국 공문서 날짜 표기 */
export function isoToKoreanDate(iso: string): string {
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

export interface FillForm {
  loading: boolean;
  loadError: string;
  fields: SchemaField[];
  labels: string[];
  values: Record<string, string>;
  sources: Record<string, ValueSource>;
  fillResult: FormFillRes | null;
  busy: "" | "preview" | "save";
  filledSet: Set<string>;
  setValue: (label: string, value: string, source?: ValueSource) => void;
  applySuggestions: (suggestions: Array<{ label: string; value: string }>, detail: string) => number;
  importRoster: () => Promise<void>;
  doFill: (dryRun: boolean) => Promise<void>;
}

/**
 * @param enabled 채우기/AI 탭이 활성화됐을 때만 true — false면 form_schema를 fetch하지 않는다
 *   (편집만 할 문서에 양식 분석 비용을 물리지 않도록 지연 로딩).
 */
export function useFillForm(enabled: boolean): FillForm {
  const { file, sidecarCall, outputDir, showToast, reopenSession } = useDocumentSession();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, ValueSource>>({});
  const [fillResult, setFillResult] = useState<FormFillRes | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "save">("");

  const labels = useMemo(() => fields.map((f) => f.label), [fields]);

  // 초기 로드: form_schema (미리보기 바이트는 워크벤치가 edit_open으로 이미 보유 → include_doc 불필요)
  // 채우기/AI 탭이 처음 활성화될 때까지 지연 — 편집 전용 흐름엔 양식 분석을 돌리지 않는다.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await sidecarCall("form_schema", { input_path: file.path }) as FormSchemaRes;
        if (cancelled) return;
        if (!res.success) { setLoadError(res.error || "양식 인식 실패"); return; }
        if (!res.fillable) { setLoadError(res.fillable_reason || "채우기를 지원하지 않는 형식입니다"); return; }
        setFields(res.fields);
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
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, enabled]);

  const setValue = useCallback((label: string, value: string, source: ValueSource = { kind: "manual" }) => {
    setValues((v) => ({ ...v, [label]: value }));
    setSources((s) => ({ ...s, [label]: source }));
  }, []);

  // AI/명부 제안 일괄 머지 — 라벨 일치하는 필드에만, 기존 값은 덮어쓰기
  const applySuggestions = useCallback((suggestions: Array<{ label: string; value: string }>, detail: string): number => {
    let applied = 0;
    setValues((prevV) => {
      const nextV = { ...prevV };
      setSources((prevS) => {
        const nextS = { ...prevS };
        for (const s of suggestions) {
          const val = s.value?.trim();
          if (!val) continue;
          const field = fields.find((f) => norm(f.label) === norm(s.label));
          if (!field) continue;
          nextV[field.label] = val;
          nextS[field.label] = { kind: "ai", detail };
          applied++;
        }
        return nextS;
      });
      return nextV;
    });
    return suggestions.filter((s) => s.value?.trim() && fields.some((f) => norm(f.label) === norm(s.label))).length;
  }, [fields]);

  // 채울 값만 추출 (빈 값·기존 값 제외 — 코어가 빈 값 비우기 미지원)
  const fillValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim() && sources[k]?.kind !== "existing") out[k] = v;
    }
    return out;
  }, [values, sources]);

  // 명부(xlsx) 가져오기 — 헤더 매칭 + 첫 데이터 행
  const importRoster = useCallback(async () => {
    try {
      const selected = await open({ multiple: false, filters: [{ name: "명부/데이터", extensions: ["xlsx", "xls", "csv"] }] });
      if (!selected) return;
      const rosterPath = Array.isArray(selected) ? selected[0] : selected;
      const rosterName = rosterPath.split(/[/\\]/).pop() ?? rosterPath;
      const res = await sidecarCall("extract_tables", { input_path: rosterPath, as_markdown: false }) as {
        success: boolean;
        tables: Array<{ table: { rows: number; cols: number; cells: Array<Array<{ text: string }>> } }>;
      };
      if (!res.success || res.tables.length === 0) { showToast("명부에서 표를 찾지 못했습니다", "error"); return; }
      const t = res.tables[0].table;
      if (t.rows < 2) { showToast("명부에 데이터 행이 없습니다 (헤더 + 1행 이상 필요)", "error"); return; }

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
        setValue(field.label, val, { kind: "roster", detail: `${rosterName} ${colLetter(c)}2` });
        mapped++;
      }
      showToast(mapped > 0 ? `명부에서 ${mapped}개 필드 자동 매핑` : "라벨이 일치하는 열이 없습니다", mapped > 0 ? "success" : "info");
    } catch (e) {
      showToast(`명부 가져오기 실패: ${e}`, "error");
    }
  }, [fields, setValue, sidecarCall, showToast]);

  // 미리보기 반영(dry_run) / 저장
  const doFill = useCallback(async (dryRun: boolean) => {
    if (Object.keys(fillValues).length === 0) { showToast("채울 값을 입력하세요", "info"); return; }
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
      // dry_run/저장 모두 편집 세션에 수렴 → 미리보기·편집 블록·변환이 한 바이트 공유
      if (res.doc_b64) await reopenSession(res.doc_b64);
      if (res.success) {
        showToast(
          dryRun
            ? `${res.filled.length}개 필드 적용 (미저장) · 채움은 되돌리기 불가 — 값을 비우고 다시 적용하세요`
            : `저장 완료: ${res.filled.length}개 필드 채움${res.verification.reparse_ok ? " · 재파싱 검증 통과" : ""}`,
          "success",
        );
      }
    } catch (e) {
      showToast(`채우기 실패: ${e}`, "error");
    } finally {
      setBusy("");
    }
  }, [fillValues, file, outputDir, sidecarCall, showToast, reopenSession]);

  const filledSet = useMemo(() => new Set(fillResult?.filled.map((f) => norm(f.label)) ?? []), [fillResult]);

  return {
    loading, loadError, fields, labels, values, sources, fillResult, busy, filledSet,
    setValue, applySuggestions, importRoster, doFill,
  };
}
