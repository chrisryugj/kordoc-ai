/** 서무 도구 — 할 일별 실행 (일괄 메서드가 있으면 한 번에, 없으면 파일마다 차례로) */

import type { BatchItemResult, FileEntry, RpcResult } from "../../lib/contract";
import type { BatchTaskId } from "../../state/app";
import type { TaskCtx } from "../../hooks/useTask";
import { rpc, errorText, isAbort } from "../../lib/rpc";
import { dirName, joinPath, stem } from "../../lib/format";
import type { BatchOpts } from "./tasks";

export interface RowState {
  status: "wait" | "run" | "ok" | "fail";
  output?: string;
  error?: string;
  note?: string;
}

export type Outcome =
  | { kind: "files"; message: string; dir?: string }
  | { kind: "single"; message: string; path: string; folder?: boolean }
  | { kind: "extract"; message: string; path: string; columns: string[]; rows: Array<Record<string, string>> }
  | { kind: "search"; message: string; query: string; results: RpcResult<"search_files">["results"] }
  | { kind: "gather"; message: string; result: RpcResult<"collect_gather"> }
  | { kind: "mailmerge"; message: string; result: RpcResult<"mail_merge"> };

export interface RunEnv extends TaskCtx {
  files: FileEntry[];
  opts: BatchOpts;
  setRow: (path: string, s: RowState) => void;
  /** 문서 수합: AI 연결 여부, 다시 만들 때 앞서 만든 엑셀 경로와 바꾸기 여부 */
  gather?: { ai: boolean; previous?: string; overwrite?: boolean };
  /** 정보공개 공개본: 가리지 않고 남길 것 (설정의 대표번호·팩스·담당자) */
  keep?: string[];
}

const outDirOf = (o: BatchOpts) => (o.outDir ? { output_dir: o.outDir } : {});

function applyBatch(env: RunEnv, results: BatchItemResult[]) {
  for (const r of results) env.setRow(r.path, r.ok ? { status: "ok", output: r.output_path, note: r.note } : { status: "fail", error: r.error });
  const ok = results.filter((r) => r.ok).length;
  return `${ok}개 완료${results.length - ok ? `, ${results.length - ok}개 실패` : ""}`;
}

/** 파일마다 차례로 — 하나가 실패해도 다음으로. 저장한 폴더(고른 곳, 없으면 첫 결과가 놓인 곳)도 돌려준다 */
async function eachFile(env: RunEnv, work: (f: FileEntry) => Promise<{ output?: string; note?: string; empty?: boolean }>) {
  let ok = 0;
  let empty = 0;
  let first = "";
  for (const f of env.files) {
    if (env.signal.aborted) break;
    env.setRow(f.path, { status: "run" });
    try {
      const r = await work(f);
      if (r.empty) { env.setRow(f.path, { status: "wait", note: r.note }); empty++; continue; }
      env.setRow(f.path, { status: "ok", output: r.output, note: r.note });
      if (!first && r.output) first = r.output;
      ok++;
    } catch (e) {
      if (isAbort(e)) { env.setRow(f.path, { status: "wait" }); break; }
      env.setRow(f.path, { status: "fail", error: errorText(e) });
    }
  }
  const fail = env.files.length - ok - empty;
  const message = `${ok}개 완료${empty ? `, ${empty}개는 뽑을 것 없음` : ""}${fail ? `, ${fail}개 실패 또는 멈춤` : ""}`;
  const dir = ok ? env.opts.outDir || dirName(first) : "";
  return { message, ...(dir ? { dir } : {}) };
}

export async function runTask(task: BatchTaskId, env: RunEnv): Promise<Outcome | null> {
  const { files, opts, signal, onProgress } = env;
  const paths = files.map((f) => f.path);
  const o = { signal, onProgress };
  files.forEach((f) => env.setRow(f.path, { status: "wait" }));

  switch (task) {
    case "convert": {
      paths.forEach((p) => env.setRow(p, { status: "run" }));
      const r = await rpc("convert_batch", { paths, format: opts.convertFormat, ...outDirOf(opts) }, o);
      return { kind: "files", message: applyBatch(env, r.results), dir: r.output_dir };
    }
    case "hwpx": {
      paths.forEach((p) => env.setRow(p, { status: "run" }));
      const r = await rpc("to_hwpx_batch", { paths, preset: "auto", ...outDirOf(opts) }, o);
      return { kind: "files", message: applyBatch(env, r.results), dir: r.output_dir };
    }
    case "stylecopy": {
      if (!opts.styleId) throw new Error("맞출 서식을 먼저 고르세요. 새로 쓰기 › 우리 서식으로 맞추기에서 서식을 저장할 수 있습니다.");
      paths.forEach((p) => env.setRow(p, { status: "run" }));
      const r = await rpc("style_apply", { source_paths: paths, style_id: opts.styleId, ...outDirOf(opts) }, o);
      return { kind: "files", message: applyBatch(env, r.results), dir: r.output_dir };
    }
    case "redact": {
      paths.forEach((p) => env.setRow(p, { status: "run" }));
      const r = await rpc("redact_batch", { paths, rules: opts.rules, keep: env.keep ?? [], ...outDirOf(opts) }, o);
      for (const it of r.results) {
        env.setRow(it.path, it.ok
          ? { status: "ok", output: it.output_path, note: `${it.total ?? 0}건 가림${it.residual ? `, 남은 의심 ${it.residual}곳 확인 필요` : ""}` }
          : { status: "fail", error: it.error });
      }
      const ok = r.results.filter((x) => x.ok).length;
      return { kind: "files", message: `${ok}개 완료${r.results.length - ok ? `, ${r.results.length - ok}개 실패` : ""}`, dir: r.output_dir };
    }
    case "pdf":
      return { kind: "files", ...(await eachFile(env, async (f) => ({ output: (await rpc("export_pdf", { path: f.path, ...(opts.outDir ? { output_path: joinPath(opts.outDir, `${stem(f.name)}.pdf`) } : {}) }, { signal })).output_path }))) };
    case "ocr":
      return { kind: "files", ...(await eachFile(env, async (f) => {
        const r = await rpc("ocr", { input_path: f.path, ...(opts.outDir ? { output_path: joinPath(opts.outDir, `${stem(f.name)}.md`) } : {}) }, { signal });
        if (!r.success) throw new Error(r.error || "글자를 읽지 못했습니다");
        return { output: r.output_path, note: r.page_count ? `${r.page_count}쪽 읽음` : undefined };
      })) };
    case "tables":
      return { kind: "files", ...(await eachFile(env, async (f) => {
        const r = await rpc("tables_extract", { path: f.path, format: opts.tablesFormat, only_data: true, allow_empty: true, ...(opts.outDir ? { output_path: joinPath(opts.outDir, `${stem(f.name)}_표.${opts.tablesFormat}`) } : {}) }, { signal });
        return r.tables.length ? { output: r.output_path, note: `표 ${r.tables.length}개` } : { empty: true, note: "표 없음" };
      })) };
    case "images":
      return { kind: "files", ...(await eachFile(env, async (f) => {
        const r = await rpc("extract_images", { path: f.path, allow_empty: true, ...(opts.outDir ? { output_dir: joinPath(opts.outDir, `${stem(f.name)}_그림`) } : {}) }, { signal });
        return r.count ? { output: r.output_dir, note: `그림 ${r.count}개` } : { empty: true, note: "그림 없음" };
      })) };
    case "bundle": {
      const r = await rpc("bundle_pdf", { paths, page_numbers: opts.pageNumbers, ...(opts.watermark ? { watermark: opts.watermark } : {}), ...(opts.outDir ? { output_path: joinPath(opts.outDir, "합본.pdf") } : {}) }, o);
      r.failed.forEach((x) => env.setRow(x.path, { status: "fail", error: x.error }));
      files.filter((f) => !r.failed.some((x) => x.path === f.path)).forEach((f) => env.setRow(f.path, { status: "ok" }));
      return { kind: "single", message: `${r.page_count}쪽짜리 합본을 만들었습니다${r.failed.length ? ` (${r.failed.length}개는 넣지 못함)` : ""}`, path: r.output_path };
    }
    case "collect": {
      paths.forEach((p) => env.setRow(p, { status: "run" }));
      const g = env.gather;
      const roster = opts.roster.split("\n").map((x) => x.trim()).filter(Boolean);
      const r = await rpc("collect_gather", {
        paths, roster, use_ai: !!g?.ai && opts.gatherAi,
        ...(opts.deadline.trim() ? { deadline: opts.deadline.trim() } : {}),
        ...(g?.previous ? { output_path: g.previous, overwrite: !!g.overwrite } : opts.outDir ? { output_dir: opts.outDir } : {}),
      }, o);
      const dept = new Map(r.status.flatMap((s) => s.files.map((f) => [f, s.dept] as const)));
      for (const f of files) {
        const bad = r.failed.find((x) => x.path === f.path);
        const sep = r.separate.find((x) => x.path === f.path);
        env.setRow(f.path, bad ? { status: "fail", error: bad.error } : { status: "ok", note: sep ? "따로 확인" : dept.get(f.name) || "모음" });
      }
      return { kind: "gather", message: `${r.rows}줄을 엑셀 한 장으로 모았습니다`, result: r };
    }
    case "print": {
      paths.forEach((p) => env.setRow(p, { status: "run" }));
      const r = await rpc("print_files", { files: paths, ...(opts.printer ? { printer: opts.printer } : {}) }, o);
      for (const f of files) {
        const bad = r.failed.find((x) => x.file === f.path);
        env.setRow(f.path, bad ? { status: "fail", error: bad.reason } : { status: "ok", note: "보냄" });
      }
      return { kind: "files", message: `${r.queued}개를 프린터로 보냈습니다${r.failed.length ? `, ${r.failed.length}개는 보내지 못함` : ""}` };
    }
    case "extract": {
      const columns = opts.columns.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await rpc("ai_extract", { paths, columns, ...(opts.outDir ? { output_path: joinPath(opts.outDir, "항목 뽑기.xlsx") } : {}) }, o);
      r.failed.forEach((x) => env.setRow(x.path, { status: "fail", error: x.error }));
      files.filter((f) => !r.failed.some((x) => x.path === f.path)).forEach((f) => env.setRow(f.path, { status: "ok" }));
      return { kind: "extract", message: `${r.rows.length}개 문서에서 뽑았습니다`, path: r.output_path, columns, rows: r.rows };
    }
    case "search": {
      const r = await rpc("search_files", { paths, query: opts.query.trim(), max_hits: 20 }, o);
      for (const f of files) {
        const hit = r.results.find((x) => x.path === f.path);
        env.setRow(f.path, hit && hit.hits.length ? { status: "ok", note: `${hit.hits.length}곳` } : { status: "wait", note: "없음" });
      }
      return { kind: "search", message: `${r.searched}개 문서 중 ${r.results.filter((x) => x.hits.length).length}개에서 찾았습니다${r.failed ? `, ${r.failed}개는 읽지 못함` : ""}`, query: opts.query.trim(), results: r.results };
    }
    case "mailmerge": {
      const r = await rpc("mail_merge", { data_path: opts.dataPath, ...(opts.templatePath ? { template_path: opts.templatePath } : { template: opts.template }), ...(opts.nameColumn.trim() ? { name_column: opts.nameColumn.trim() } : {}), ...outDirOf(opts) }, o);
      const message = r.outputs.length
        ? `${r.outputs.length}장을 만들었습니다${r.failed.length ? `. ${r.failed.length}줄은 만들지 못했습니다` : ""}`
        : "한 장도 만들지 못했습니다. 아래 줄마다 이유를 보고 명부를 고친 뒤 다시 하세요.";
      return { kind: "mailmerge", message, result: r };
    }
    default:
      return null;
  }
}
