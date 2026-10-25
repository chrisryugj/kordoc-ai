/**
 * 우클릭 메뉴의 빠른 동작 — 창을 띄우지 않고 돌린 뒤 시스템 알림만 낸다.
 * 목록은 src-tauri/src/shell.rs 의 quick 동작과 같아야 한다 (Rust 시험이 이 파일의 QUICK_ACTIONS 를 맞춰 본다).
 * 결과는 설정의 저장 폴더, 없으면 원본 옆에 쓴다. 고친 원본은 없다(언제나 새 파일).
 */

import type { FileEntry } from "./contract";
import type { BatchTaskId } from "../state/app";
import { rpc, errorText, isAbort } from "./rpc";
import { baseName, dirName, joinPath, stem } from "./format";
import { TASKS, DEFAULT_OPTS, accepts } from "../components/batch/tasks";
import { runTask, type RowState } from "../components/batch/runners";

export const QUICK_ACTIONS = ["pdfmerge", "pdf", "pdfsplit", "shrink", "pdfimages", "hwpx", "redact", "tables", "convert"] as const;
export type QuickAction = (typeof QUICK_ACTIONS)[number];
export const isQuick = (a: string): a is QuickAction => (QUICK_ACTIONS as readonly string[]).includes(a);

export const QUICK_LABEL: Record<QuickAction, string> = {
  pdfmerge: "PDF 하나로 합치기", pdf: "PDF로 저장", pdfsplit: "PDF 쪽마다 나누기", shrink: "PDF 용량 줄이기", pdfimages: "쪽마다 그림으로 저장",
  hwpx: "한글 문서로 바꾸기", redact: "개인정보 가리기", tables: "표를 엑셀로 뽑기", convert: "글로 바꾸기",
};

/** 실패했을 때 창에서 이어 할 곳 */
export const QUICK_FALLBACK: Record<QuickAction, { screen: "pdf" } | { screen: "batch"; task: BatchTaskId }> = {
  pdfmerge: { screen: "pdf" }, pdfsplit: { screen: "pdf" }, pdfimages: { screen: "pdf" },
  pdf: { screen: "batch", task: "pdf" }, shrink: { screen: "batch", task: "shrink" }, hwpx: { screen: "batch", task: "hwpx" },
  redact: { screen: "batch", task: "redact" }, tables: { screen: "batch", task: "tables" }, convert: { screen: "batch", task: "convert" },
};

const PAGE_FORMATS = new Set(["pdf", "hwp", "hwpx", "docx"]);
const TASK_OF: Partial<Record<QuickAction, BatchTaskId>> = { pdf: "pdf", shrink: "shrink", hwpx: "hwpx", redact: "redact", tables: "tables", convert: "convert" };

export interface QuickResult {
  ok: number;
  failed: Array<{ path: string; error: string }>;
  /** 알림 본문 */
  message: string;
  /** 창에서 이어 할 일 (합칠 PDF 가 하나뿐 → PDF 작업 화면) */
  open?: "pdf";
}

const byName = (a: FileEntry, b: FileEntry) => a.name.localeCompare(b.name, "ko", { numeric: true });

/** 일 하나. paths 는 우클릭한 파일·폴더 (폴더는 안의 문서 전부) */
export async function runQuick(action: QuickAction, paths: string[], env: { signal: AbortSignal; keep: string[]; outDir: string }): Promise<QuickResult> {
  const scan = await rpc("scan_paths", { paths });
  const def = TASK_OF[action] ? TASKS.find((t) => t.id === TASK_OF[action]) : undefined;
  const files = scan.files.filter((f) => f.format !== "unknown"
    && (action === "pdfsplit" ? f.format === "pdf" : action === "pdfimages" ? PAGE_FORMATS.has(f.format) : def ? accepts(def, f.format) : true));
  if (!files.length) throw new Error(`${QUICK_LABEL[action]}에 쓸 수 있는 파일이 없습니다.`);
  const folder = paths.length === 1 && !scan.files.some((f) => f.path === paths[0]) ? paths[0] : "";

  if (action === "pdfmerge") {
    const list = [...files].sort(byName);
    if (list.length === 1 && list[0].format === "pdf") return { ok: 0, failed: [], message: "", open: "pdf" };
    // 폴더를 합치면 결과는 폴더 밖(옆)에: 다시 합칠 때 결과가 섞이지 않게
    const dir = env.outDir || (folder ? dirName(folder) : dirName(list[0].path));
    const name = folder ? `${baseName(folder)}_합본.pdf` : `${stem(list[0].name)}${list.length > 1 ? `_외${list.length - 1}건` : ""}_합본.pdf`;
    const r = await rpc("bundle_pdf", { paths: list.map((f) => f.path), page_numbers: false, output_path: joinPath(dir, name) }, { signal: env.signal });
    return {
      ok: list.length - r.failed.length,
      failed: r.failed.map((x) => ({ path: x.path, error: x.error ?? "" })),
      message: `${baseName(r.output_path)} (${r.page_count}쪽)${r.failed.length ? `. ${r.failed.length}개는 넣지 못했습니다` : ""}`,
    };
  }

  if (action === "pdfsplit" || action === "pdfimages") {
    let ok = 0;
    let last = "";
    const failed: QuickResult["failed"] = [];
    for (const f of files) {
      env.signal.throwIfAborted();
      try {
        if (action === "pdfsplit") {
          const r = await rpc("split_pdf", { input_path: f.path, mode: "each", ...(env.outDir ? { output_dir: joinPath(env.outDir, `${stem(f.name)}_분리`) } : {}) }, { signal: env.signal }) as { output_files?: string[] };
          last = r.output_files?.[0] ? dirName(r.output_files[0]) : last;
        } else {
          last = (await rpc("pdf_to_images", { path: f.path, dpi: 150, format: "png", ...(env.outDir ? { output_dir: env.outDir } : {}) }, { signal: env.signal })).output_dir;
        }
        ok++;
      } catch (e) {
        if (isAbort(e)) throw e;
        failed.push({ path: f.path, error: errorText(e) });
      }
    }
    return { ok, failed, message: `${ok}개 완료${failed.length ? `, ${failed.length}개 실패` : ""}${last ? `. ${baseName(last)} 폴더` : ""}` };
  }

  // 서무 도구와 같은 실행 (일괄 메서드·파일마다)
  const rows: Record<string, RowState> = {};
  const outcome = await runTask(TASK_OF[action]!, {
    signal: env.signal, onProgress: () => undefined, files, opts: { ...DEFAULT_OPTS, outDir: env.outDir }, keep: env.keep,
    setRow: (p, s) => { rows[p] = s; },
  });
  const failed = files.filter((f) => rows[f.path]?.status === "fail").map((f) => ({ path: f.path, error: rows[f.path]?.error ?? "" }));
  const outputs = files.map((f) => rows[f.path]?.output).filter((x): x is string => !!x);
  const where = outputs.length === 1 ? baseName(outputs[0]) : outputs.length && outcome && "dir" in outcome && outcome.dir ? `${baseName(outcome.dir)} 폴더` : "";
  // 파일 하나면 그 줄의 안내(줄인 크기·줄일 것 없음·표 수)를 그대로. 한글로 바꾸기의 안내(쓴 꾸밈)는 알림에 뜻이 없어 뺀다
  const note = files.length === 1 && (action === "shrink" || action === "tables" || !outputs.length) ? rows[files[0].path]?.note?.replace(/[.\s]+$/, "") : "";
  return { ok: files.length - failed.length, failed, message: [note || outcome?.message || "", where].filter(Boolean).join(". ") };
}
