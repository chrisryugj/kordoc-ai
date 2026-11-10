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

// 끝의 형식별 합치기·나누기는 메뉴의 하나로 합치기(join)·나누기(split)가 파일을 보고 고르는 동작 (옛 판 주소로도 온다).
// 목록 안에 주석을 넣지 말 것: Rust 시험이 대괄호 안을 쉼표로 잘라 읽는다
export const QUICK_ACTIONS = [
  "pdf", "hwpx", "shrink", "pagenum", "pdfimages", "tables", "convert",
  "join", "xlsxmerge", "split", "redact", "inbox",
  "pdfmerge", "hwpmerge", "pdfsplit", "hwpsplit",
] as const;
export type QuickAction = (typeof QUICK_ACTIONS)[number];
export const isQuick = (a: string): a is QuickAction => (QUICK_ACTIONS as readonly string[]).includes(a);

export const QUICK_LABEL: Record<QuickAction, string> = {
  pdfmerge: "PDF 하나로 합치기", pdf: "PDF로 저장", pdfsplit: "PDF 쪽마다 나누기", shrink: "PDF 용량 줄이기", pdfimages: "쪽마다 그림으로 저장",
  hwpx: "한글 문서로 바꾸기", hwpmerge: "한글 문서 하나로 합치기", hwpsplit: "한글 문서 나누기", redact: "개인정보 가리기", tables: "표를 엑셀로 뽑기", convert: "글로 바꾸기",
  pagenum: "쪽 번호 넣기", xlsxmerge: "엑셀 하나로 합치기", inbox: "받은 공문 접수하기", join: "하나로 합치기", split: "나누기",
};

type Fallback = { screen: "pdf" } | { screen: "inbox" } | { screen: "batch"; task: BatchTaskId };

/** 실패했을 때 창에서 이어 할 곳 (하나로 합치기·나누기는 quickFallback 이 파일을 보고 고른다) */
export const QUICK_FALLBACK: Record<QuickAction, Fallback> = {
  pdfmerge: { screen: "pdf" }, pdfsplit: { screen: "pdf" }, pdfimages: { screen: "pdf" }, pagenum: { screen: "pdf" },
  hwpmerge: { screen: "batch", task: "merge" }, xlsxmerge: { screen: "batch", task: "merge" }, hwpsplit: { screen: "batch", task: "split" },
  inbox: { screen: "inbox" }, join: { screen: "pdf" }, split: { screen: "pdf" },
  pdf: { screen: "batch", task: "pdf" }, shrink: { screen: "batch", task: "shrink" }, hwpx: { screen: "batch", task: "hwpx" },
  redact: { screen: "batch", task: "redact" }, tables: { screen: "batch", task: "tables" }, convert: { screen: "batch", task: "convert" },
};

const PAGE_FORMATS = new Set(["pdf", "hwp", "hwpx", "docx"]);
const HANGUL_FORMATS = new Set(["hwp", "hwpx"]);
const isHangulPath = (p: string) => /\.hwpx?$/i.test(p);

/** 실패했을 때 갈 곳: 고른 것이 전부 한글 문서면 서무 도구(합치기·나누기), 아니면 PDF 작업 */
export function quickFallback(action: QuickAction, paths: string[]): Fallback {
  if ((action === "join" || action === "split") && paths.length && paths.every(isHangulPath)) return { screen: "batch", task: action === "join" ? "merge" : "split" };
  return QUICK_FALLBACK[action];
}
/** 동작마다 받는 형식 (없으면 서무 도구 작업의 accepts, 그것도 없으면 다) */
const FORMATS_OF: Partial<Record<QuickAction, Set<string>>> = {
  pdfsplit: new Set(["pdf"]), pagenum: new Set(["pdf"]), split: new Set(["pdf", "hwp", "hwpx"]), hwpmerge: HANGUL_FORMATS, hwpsplit: HANGUL_FORMATS, pdfimages: PAGE_FORMATS,
  // .xls 는 엔진의 서식 유지 합치기가 받지 않는다
  xlsxmerge: new Set(["xlsx"]), inbox: new Set(["hwp", "hwpx", "pdf"]),
};
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
  const only = FORMATS_OF[action];
  const files = scan.files.filter((f) => f.format !== "unknown" && (only ? only.has(f.format) : def ? accepts(def, f.format) : true));
  if (!files.length) throw new Error(`${QUICK_LABEL[action]}에 쓸 수 있는 파일이 없습니다.`);
  const folder = paths.length === 1 && !scan.files.some((f) => f.path === paths[0]) ? paths[0] : "";
  // 하나로 합치기: 전부 한글 문서면 서식 그대로 HWPX 하나, 다른 형식이 하나라도 섞이면 PDF 한 권
  if (action === "join") action = files.every((f) => HANGUL_FORMATS.has(f.format)) ? "hwpmerge" : "pdfmerge";

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

  // 한글은 서식 그대로 HWPX 하나로, 엑셀은 파일마다 시트 하나로 (merge_files native)
  if (action === "hwpmerge" || action === "xlsxmerge") {
    const [ext, what] = action === "hwpmerge" ? ["hwpx", "한글 문서를"] : ["xlsx", "엑셀 파일을"];
    const list = [...files].sort(byName);
    if (list.length < 2) throw new Error(`합칠 ${what} 두 개 이상 고르세요.`);
    // 폴더를 합치면 결과는 폴더 밖(옆)에: 다시 합칠 때 결과가 섞이지 않게
    const dir = env.outDir || (folder ? dirName(folder) : dirName(list[0].path));
    const name = folder ? `${baseName(folder)}_합본.${ext}` : `${stem(list[0].name)}_외${list.length - 1}건_합본.${ext}`;
    const r = await rpc("merge_files", { files: list.map((f) => f.path), mode: "native", output_path: joinPath(dir, name) }, { signal: env.signal }) as { output_path: string; file_count?: number; failed_files?: string[]; warnings?: string[] };
    const failed = (r.failed_files ?? []).map((p) => ({ path: p, error: "읽지 못함" }));
    // 합본으로 옮기지 못한 것(그림·메모·표 서식)이 있으면 알린다 (말없이 빠지면 합본만 보고 내보낸다)
    const notes = r.warnings?.length ? `. ${r.warnings.join(" ")}` : "";
    return { ok: list.length - failed.length, failed, message: `${baseName(r.output_path)} (${list.length - failed.length}개 ${action === "hwpmerge" ? "문서" : "파일"})${failed.length ? `. ${failed.length}개는 넣지 못했습니다` : ""}${notes}` };
  }

  // 받은 공문을 접수함에: 보낸 곳·문서번호·요청 기한을 뽑아 둔다
  if (action === "inbox") {
    const r = await rpc("inbox_add", { paths: files.map((f) => f.path) }, { signal: env.signal });
    const one = r.items.length === 1 ? r.items[0] : undefined;
    const due = r.items.map((x) => x.due).filter((x): x is string => !!x).sort()[0];
    const head = one ? (one.title || one.name) : `공문 ${r.items.length}건을 접수함에 넣었습니다`;
    return { ok: r.items.length, failed: r.failed, message: `${head}${due ? `. ${one ? "기한" : "가장 이른 기한"} ${due}` : ""}` };
  }

  // 쪽 번호 넣은 PDF 를 새 파일로 (원본 옆 "_쪽번호", 이미 있으면 (2))
  if (action === "pagenum") {
    const outputs: string[] = [];
    const failed: QuickResult["failed"] = [];
    for (const f of files) {
      env.signal.throwIfAborted();
      try {
        const r = await rpc("pdf_stamp", { path: f.path, page_numbers: true, ...(env.outDir ? { output_path: joinPath(env.outDir, `${stem(f.name)}_쪽번호.pdf`) } : {}) }, { signal: env.signal });
        outputs.push(r.output_path);
      } catch (e) {
        if (isAbort(e)) throw e;
        failed.push({ path: f.path, error: errorText(e) });
      }
    }
    return { ok: outputs.length, failed, message: outputs.length === 1 ? baseName(outputs[0]) : `${outputs.length}개 완료` };
  }

  // 나누기: 한글 문서는 구역·쪽 나눔마다, PDF 는 쪽마다 (파일마다 고른다)
  if (action === "pdfsplit" || action === "pdfimages" || action === "hwpsplit" || action === "split") {
    let ok = 0;
    let last = "";
    const failed: QuickResult["failed"] = [];
    for (const f of files) {
      env.signal.throwIfAborted();
      const how = action === "split" ? (f.format === "pdf" ? "pdfsplit" : "hwpsplit") : action;
      try {
        if (how === "hwpsplit") {
          const r = await rpc("split_hangul", { path: f.path, ...(env.outDir ? { output_dir: joinPath(env.outDir, `${stem(f.name)}_나누기`) } : {}) }, { signal: env.signal });
          last = r.output_dir;
        } else if (how === "pdfsplit") {
          const r = await rpc("split_pdf", { input_path: f.path, mode: "each", ...(env.outDir ? { output_dir: joinPath(env.outDir, `${stem(f.name)}_나누기`) } : {}) }, { signal: env.signal }) as { output_files?: string[] };
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
