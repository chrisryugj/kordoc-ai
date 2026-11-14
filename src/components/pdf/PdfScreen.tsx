/**
 * PDF 작업 — PDF·그림·한글·워드 문서를 넣으면 쪽이 한 줄로 놓인다. 쪽을 골라 옮기고, 돌리고, 지우고, 나눌 곳을 정한 뒤 저장한다.
 * 합치기·나누기·쪽 뽑기·쪽 지우기·순서 바꾸기·돌리기·빈 쪽·복제·그림으로·그림을 PDF로·용량 줄이기·쪽 번호·워터마크가 한 화면.
 * 원본 파일은 바꾸지 않는다. 바꾸기는 모두 되돌리기(Ctrl+Z) 한 단계씩.
 */

import "./pdf.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDownToLine, ArrowUpToLine, ArrowLeftRight, Combine, Copy, Ellipsis, FilePlus2, FileStack, ImageDown, ListChecks, Maximize2,
  Keyboard, Redo2, RotateCcw, RotateCw, Save, Scissors, Shrink, Split, Trash2, Undo2, X, FileOutput, Hash,
} from "lucide-react";
import { useFileMenu } from "../common/file-menu";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { DOC_EXTENSIONS, notifySystem, pickFiles } from "../../lib/native";
import { dirName, joinPath, num } from "../../lib/format";
import { readPref, writePref } from "../../lib/recent";
import { useTask } from "../../hooks/useTask";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";
import { askQuit, useAsk } from "../ui/useAsk";
import { onQuitGuard } from "../../lib/quit";
import {
  EMPTY, NO_SELECTION, addFile, duplicate, fileOf, imageItems, insertBlank, interleave, invert, keysFromSpec, looksBlank, move, nudge, oddEven,
  planAll, planCuts, planEvery, planSelected, positionsOf, pruneSelection, remove, removeFile, reverse, rotate, selectKeys, selectedName, toggleCut,
  baseName as boardName, type Board, type Selection,
} from "./model";
import { useThumbs } from "./useThumbs";
import { PageGrid } from "./PageGrid";
import { PagePreview } from "./PagePreview";
import { SavePanel, type SaveKind, type SaveOpts, type SaveResult } from "./SavePanel";

const ZOOM = { s: 112, m: 156, l: 216 } as const;
type Zoom = keyof typeof ZOOM;
const DEFAULT_SAVE: SaveOpts = { name: "", outDir: "", pageNumbers: false, watermark: "대외비", useWatermark: false, shrink: false, fitA4: false, split: "cuts", every: 2, imageFormat: "png", dpi: 150 };
const SEP: ContextMenuEntry = { type: "separator" };

/** 책상에 놓인 차례로 앞의 두 파일 (번갈아 섞기 대상). 없으면 빈 목록 */
function twoFiles(b: Board): Array<[string, string]> {
  const ids = [...new Set(b.items.map((it) => it.file).filter(Boolean))];
  return ids.length >= 2 ? [[ids[0], ids[1]]] : [];
}

/** 쪽 그림(data URL) → 거의 빈 쪽인가 (64px 폭으로 줄여 밝기를 본다) */
function blankImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = 64;
      const h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) { resolve(false); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const luma = new Uint8Array(w * h);
      for (let i = 0; i < luma.length; i++) luma[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
      resolve(looksBlank(luma));
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export function PdfScreen({ active }: { active: boolean }) {
  const { registerDrop, dragTarget, toast, pdfIntent, settings, setBadge, uiMode } = useApp();
  const [board, setBoardState] = useState<Board>(EMPTY);
  const boardRef = useRef(board);
  const past = useRef<Board[]>([]);
  const future = useRef<Board[]>([]);
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const [focus, setFocus] = useState<string | null>(null);
  const [zoom, setZoomState] = useState<Zoom>(() => readPref<Zoom>("kordoc-pdf-zoom", "l"));
  const [opening, setOpening] = useState<{ done: number; total: number; name: string } | null>(null);
  const [finding, setFinding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[]; label?: string; header?: string; keyboard?: boolean; from?: "pick" | "more" } | null>(null);
  const fileMenu = useFileMenu();
  const [preview, setPreview] = useState<string | null>(null);
  const [spec, setSpec] = useState<string | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [opts, setOpts] = useState<SaveOpts>(DEFAULT_SAVE);
  const thumbs = useThumbs(ZOOM[zoom]);
  const save = useTask<SaveResult>();
  const resetSave = save.reset;
  const queue = useRef(Promise.resolve());
  /** 파일 여는 차례 번호: 멈추기를 누르면 올려, 돌던 넣기가 다음 파일에서 그만둔다 */
  const openRound = useRef(0);
  const handled = useRef(0);
  const selRef = useRef(sel);
  selRef.current = sel;
  /** 책상 전체를 마지막으로 저장한 때의 책상 — 그 뒤로 바꾼 게 없으면 앱을 꺼도 잃을 것이 없다 */
  const savedBoard = useRef<Board>(EMPTY);
  const { ask, dialog } = useAsk();
  // 트레이 "완전 종료" 전: 놓은 쪽·차례·돌리기는 이 화면에만 있다 (원본 파일은 그대로)
  useEffect(() => onQuitGuard(async () => {
    const b = boardRef.current;
    return !b.items.length || b === savedBoard.current
      || askQuit(ask, "저장하지 않은 PDF 작업", "PDF 작업 책상을 아직 저장하지 않았습니다. 앱을 끄면 놓은 쪽과 바꾼 차례·돌리기·나눌 곳이 사라집니다. 원본 파일은 그대로입니다.");
  }), [ask]);

  // ── 바꾸기·되돌리기 (StrictMode 에서 두 번 돌지 않게 상태 함수 밖에서 쌓는다) ──
  const commit = useCallback((next: Board, o?: { merge?: boolean }) => {
    const cur = boardRef.current;
    if (next === cur) return;
    if (!o?.merge) {
      past.current.push(cur);
      if (past.current.length > 200) past.current.shift();
    }
    future.current = [];
    boardRef.current = next;
    setBoardState(next);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(boardRef.current);
    boardRef.current = prev;
    setBoardState(prev);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(boardRef.current);
    boardRef.current = next;
    setBoardState(next);
  }, []);
  useEffect(() => {
    setSel((s) => pruneSelection(board.items, s));
    // 크게 보던 쪽이 밖에서 없어지면(다른 화면이 새 파일을 넘김 등) 닫는다: 남아 있으면 키가 막힌다
    setPreview((k) => (k && !board.items.some((it) => it.key === k) ? null : k));
  }, [board]);

  // ── 파일 넣기 (차례대로 하나씩 열고, 여러 개면 이름 차례로) ──
  const add = useCallback((paths: string[], replace = false) => {
    if (!paths.length) return;
    // 앞 넣기가 뜻밖에 실패해도 다음 넣기가 멈추지 않게 (catch 로 줄을 이어 둔다)
    queue.current = queue.current.catch(() => undefined).then(async () => {
      let list;
      try {
        const r = await rpc("scan_paths", { paths });
        list = r.files.filter((f) => f.format !== "unknown");
        if (r.skipped) toast(`PDF 작업에 넣을 수 없는 파일 ${num(r.skipped)}개는 뺐습니다.`, "info");
        if (r.truncated) toast("문서가 2,000개를 넘어 앞의 2,000개만 넣습니다. 나머지는 폴더를 나눠 다시 넣으세요.", "error");
      } catch (e) {
        toast(`파일 목록을 만들지 못했습니다: ${errorText(e)}`, "error");
        return;
      }
      if (list.length > 1) list.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
      const failed: string[] = [];
      let first = true;
      // 새 책상에 놓는 것이면 앞 책상의 저장 결과("저장했습니다"·열기)는 지운다
      if (replace) resetSave();
      const round = ++openRound.current;
      for (const [i, f] of list.entries()) {
        // 여는 중에 멈추기를 눌렀다 (문서가 많은 폴더를 잘못 놓았을 때: 안 멈추면 책상을 비워도 다음 파일이 계속 쌓인다)
        if (openRound.current !== round) break;
        setOpening({ done: i, total: list.length, name: f.name });
        try {
          const s = await rpc("pdf_open", { path: f.path });
          const base = first && replace ? EMPTY : boardRef.current;
          commit(addFile(base, { path: f.path, name: f.name, source: s.source, converted: s.converted, secured: s.secured, sizes: s.pages }), { merge: !first });
          first = false;
        } catch (e) {
          failed.push(`${f.name}: ${errorText(e)}`);
        }
      }
      setOpening(null);
      if (failed.length) toast(failed.length === 1 ? `넣지 못했습니다. ${failed[0]}` : `${num(failed.length)}개를 넣지 못했습니다. ${failed[0]}`, "error");
    });
  }, [commit, toast, resetSave]);
  const stopOpening = useCallback(() => { openRound.current++; }, []);

  useEffect(() => registerDrop("pdf", (p) => add(p)), [registerDrop, add]);
  // 다른 화면·우클릭에서 넘어온 파일: 책상을 비우고 그 파일만 (앞 책상은 되돌리기로)
  useEffect(() => {
    if (!pdfIntent || pdfIntent.nonce === handled.current) return;
    handled.current = pdfIntent.nonce;
    add(pdfIntent.value.paths, true);
  }, [pdfIntent, add]);
  useEffect(() => setBadge("pdf", save.busy ? "저장" : opening ? "여는 중" : undefined), [save.busy, opening, setBadge]);

  const items = board.items;
  const all = () => new Set(boardRef.current.items.map((it) => it.key));
  const pickedOr = (fallback: () => Set<string>) => (selRef.current.keys.size ? selRef.current.keys : fallback());
  const one = (key: string | null) => (key ? new Set([key]) : new Set<string>());

  const doRemove = useCallback((keys: Set<string>) => {
    if (!keys.size) return;
    const b = boardRef.current;
    const at = b.items.findIndex((it) => keys.has(it.key));
    const next = remove(b, keys);
    commit(next);
    // 지운 자리의 다음 쪽을 골라 둔다 (Delete 를 거듭 누르면 차례로 지운다)
    const k = next.items[Math.min(at, next.items.length - 1)]?.key ?? null;
    setFocus(k);
    setSel(k ? { keys: new Set([k]), anchor: k } : NO_SELECTION);
  }, [commit]);

  const selectBlank = useCallback(async () => {
    const b = boardRef.current;
    const pages = b.items.filter((it) => !it.blank).map((it) => ({ source: fileOf(b, it)!.source, page: it.page }));
    setFinding(true);
    try {
      await thumbs.ensure(pages);
      const found: string[] = [];
      for (const it of b.items) {
        const f = fileOf(b, it);
        const url = f && thumbs.get(f.source, it.page);
        if (it.blank || (url && (await blankImage(url)))) found.push(it.key);
      }
      setSel(selectKeys(found, found[0] ?? null));
      toast(found.length ? `빈 쪽 ${num(found.length)}개를 골랐습니다. 지우려면 Delete를 누르세요.` : "빈 쪽이 없습니다.", "info");
    } finally {
      setFinding(false);
    }
  }, [thumbs, toast]);

  // ── 저장 ──
  const names = useMemo(() => {
    const typed = opts.name.trim().replace(/\.pdf$/i, "");
    const base = typed || boardName(board);
    // _합본 은 쪽이 실제로 두 파일 이상에서 왔을 때만 (넣었다가 쪽을 다 지운 파일은 세지 않는다)
    const used = new Set(board.items.map((it) => it.file).filter(Boolean)).size;
    return {
      all: typed || (board.files.length ? `${base}${used > 1 ? "_합본" : "_정리"}` : ""),
      selected: selectedName(base, board.items, sel.keys),
      split: base,
    };
  }, [opts.name, board, sel.keys]);

  const doSave = useCallback((kind: SaveKind) => {
    const b = boardRef.current;
    // 저장 중에 Ctrl+S 를 또 누르면 앞 저장을 끊고 같은 파일을 (2) 로 또 만든다 → 무시
    if (!b.items.length || save.busy) return;
    const keys = selRef.current.keys;
    void save.run(async ({ signal, onProgress }) => {
      const common = { source: b.files[0]?.path, ...(opts.outDir ? { output_dir: opts.outDir } : {}) };
      if (kind === "images") {
        // 이름 칸에 적은 이름이 있으면 그 이름으로 (<이름>_그림 폴더). 엔진은 source 의 이름·폴더를 쓴다
        const typed = opts.name.trim().replace(/\.pdf$/i, "");
        const source = typed && b.files[0] ? joinPath(dirName(b.files[0].path), `${typed}.pdf`) : common.source;
        const r = await rpc("pdf_to_images", { ...common, source, items: imageItems(b, keys), format: opts.imageFormat, dpi: opts.dpi }, { signal, onProgress });
        void notifySystem("KorDoc AI: PDF 작업 끝", `그림 ${r.files.length}장을 저장했습니다`);
        return { kind: "images", dir: r.output_dir, count: r.files.length };
      }
      // 고른 쪽 이름은 지금 고른 것으로 다시 짓는다: 우클릭 메뉴는 고르기를 바꾼 그 자리에서 저장을 불러, 미리 지어 둔 이름은 바뀌기 전 것이다
      const typedName = opts.name.trim().replace(/\.pdf$/i, "");
      const outputs = kind === "all" ? planAll(b, names.all)
        : kind === "selected" ? planSelected(b, keys, selectedName(typedName || boardName(b), b.items, keys))
        : opts.split === "cuts" ? planCuts(b, names.split)
        : planEvery(b, opts.split === "each" ? 1 : opts.every, names.split);
      const r = await rpc("pdf_compose", {
        ...common, outputs,
        ...(opts.pageNumbers ? { page_numbers: true } : {}),
        ...(opts.useWatermark && opts.watermark.trim() ? { watermark: opts.watermark.trim() } : {}),
        ...(opts.shrink ? { shrink: "normal" as const } : {}),
        ...(opts.fitA4 ? { fit_a4: true } : {}),
      }, { signal, onProgress });
      void notifySystem("KorDoc AI: PDF 작업 끝", r.outputs.length > 1 ? `PDF ${r.outputs.length}개를 저장했습니다` : `${r.outputs[0].page_count}쪽짜리 PDF를 저장했습니다`);
      return { kind: "pdf", outputs: r.outputs, secured: r.secured };
    }).then((r) => {
      // 책상 전체를 PDF 로 낸 저장(하나로·나누어)만 책상을 저장한 것으로 본다 (고른 쪽만·그림으로 낸 것이면 끌 때 묻는다)
      if (r && (kind === "all" || kind === "split")) savedBoard.current = b;
    });
  }, [save, opts, names]);

  // 다른 화면으로 넘어가면(우클릭 동작 등) 크게 보기·메뉴를 닫는다: 숨은 채로 남으면 그 화면의 키를 가로챈다
  useEffect(() => {
    if (!active) { setPreview(null); setMenu(null); }
  }, [active]);

  // ── 키 ──
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (preview || menu) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.code === "KeyS") { e.preventDefault(); doSave("all"); return; }
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
      if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.code === "KeyY") { e.preventDefault(); redo(); return; }
      // 고른 쪽 지우기: 초점이 쪽 격자 밖(메뉴를 닫은 뒤의 단추 등)에 있어도 받는다. "빈 쪽을 골랐습니다. Delete를 누르세요" 안내대로 되게.
      // 격자 안에서 누른 것은 격자가 이미 처리했다(defaultPrevented)
      if (e.key === "Delete" && !mod && !e.defaultPrevented && selRef.current.keys.size) { e.preventDefault(); doRemove(selRef.current.keys); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, preview, menu, doSave, undo, redo, doRemove]);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>, key: string | null) => {
    const mod = e.ctrlKey || e.metaKey;
    const b = boardRef.current;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); doRemove(sel.keys); }
    else if (e.code === "KeyR" && !mod && !e.altKey) { e.preventDefault(); commit(rotate(b, pickedOr(() => one(key)), e.shiftKey ? -90 : 90)); }
    else if (mod && e.code === "KeyA") { e.preventDefault(); setSel(selectKeys(all(), b.items[0]?.key ?? null)); }
    else if (mod && e.code === "KeyD") { e.preventDefault(); commit(duplicate(b, pickedOr(() => one(key)))); }
    else if (e.key === "Escape" && sel.keys.size) { e.preventDefault(); setSel(NO_SELECTION); }
    else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowUp")) { e.preventDefault(); commit(nudge(b, pickedOr(() => one(key)), -1)); }
    else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowDown")) { e.preventDefault(); commit(nudge(b, pickedOr(() => one(key)), 1)); }
  };

  const lastPicked = () => {
    const b = boardRef.current;
    const keys = pickedOr(() => one(focus));
    return [...b.items].reverse().find((it) => keys.has(it.key))?.key ?? null;
  };

  const cardMenu = (key: string, x: number, y: number) => {
    const keys = sel.keys.has(key) ? sel.keys : new Set([key]);
    if (!sel.keys.has(key)) setSel({ keys, anchor: key });
    setFocus(key);
    const b = boardRef.current;
    const n = keys.size;
    const first = b.items[0]?.key === key;
    const at = b.items.findIndex((it) => it.key === key) + 1;
    setMenu({
      x, y, label: n > 1 ? `고른 ${n}쪽 메뉴` : `${at}쪽 메뉴`,
      // 여러 쪽을 골랐으면 아래 일이 몇 쪽에 미치는지 먼저 밝힌다 (크게 보기·나누기만 누른 쪽 하나)
      ...(n > 1 ? { header: `${num(n)}쪽 고름` } : {}),
      items: [
        { label: "크게 보기", shortcut: "Enter", icon: <Maximize2 size={14} />, onClick: () => setPreview(key) },
        SEP,
        { label: "오른쪽으로 돌리기", shortcut: "R", icon: <RotateCw size={14} />, onClick: () => commit(rotate(boardRef.current, keys, 90)) },
        { label: "왼쪽으로 돌리기", shortcut: "Shift+R", icon: <RotateCcw size={14} />, onClick: () => commit(rotate(boardRef.current, keys, -90)) },
        { label: "복제", shortcut: "Ctrl+D", icon: <Copy size={14} />, onClick: () => commit(duplicate(boardRef.current, keys)) },
        { label: "뒤에 빈 쪽 넣기", icon: <FilePlus2 size={14} />, onClick: () => commit(insertBlank(boardRef.current, [...boardRef.current.items].reverse().find((it) => keys.has(it.key))?.key ?? key)) },
        { label: b.cuts.includes(key) ? "나누기 풀기" : "이 쪽부터 새 파일로 나누기", icon: <Scissors size={14} />, disabled: first, onClick: () => commit(toggleCut(boardRef.current, key)) },
        SEP,
        { label: "맨 앞으로", icon: <ArrowUpToLine size={14} />, onClick: () => commit(move(boardRef.current, keys, 0)) },
        { label: "맨 뒤로", icon: <ArrowDownToLine size={14} />, onClick: () => commit(move(boardRef.current, keys, boardRef.current.items.length)) },
        ...(n > 1 ? [{ label: "고른 쪽 차례 거꾸로", icon: <ArrowLeftRight size={14} />, onClick: () => commit(reverse(boardRef.current, keys)) }] : []),
        SEP,
        { label: n > 1 ? `고른 ${num(n)}쪽만 PDF로 저장` : "이 쪽만 PDF로 저장", icon: <Save size={14} />, disabled: save.busy, hint: save.busy ? "앞 저장이 끝난 뒤 할 수 있습니다" : undefined, onClick: () => doSave("selected") },
        SEP,
        { label: n > 1 ? `${num(n)}쪽 지우기` : "지우기", shortcut: "Delete", icon: <Trash2 size={14} />, danger: true, onClick: () => doRemove(keys) },
      ],
    });
  };

  /** 쪽이 없는 빈 바탕 */
  const deskMenu = (x: number, y: number) => {
    const b = boardRef.current;
    setMenu({
      x, y, label: "PDF 책상 메뉴", items: [
        { label: "파일 추가", icon: <FilePlus2 size={14} />, shortcut: "Ctrl+O", onClick: pick },
        { label: "맨 뒤에 빈 쪽 넣기", icon: <FilePlus2 size={14} />, onClick: () => commit(insertBlank(boardRef.current, null)) },
        SEP,
        { label: "모두 고르기", shortcut: "Ctrl+A", onClick: () => setSel(selectKeys(all(), b.items[0]?.key ?? null)) },
        { label: "고르기 풀기", shortcut: "Esc", disabled: !sel.keys.size, onClick: () => setSel(NO_SELECTION) },
        SEP,
        { label: "되돌리기", shortcut: "Ctrl+Z", icon: <Undo2 size={14} />, disabled: !past.current.length, onClick: undo },
        { label: "다시 실행", shortcut: "Ctrl+Y", icon: <Redo2 size={14} />, disabled: !future.current.length, onClick: redo },
      ],
    });
  };

  /** 넣은 파일 칩 */
  const chipMenu = (e: React.MouseEvent, f: Board["files"][number]) => {
    e.preventDefault();
    const keys = () => boardRef.current.items.filter((it) => it.file === f.id).map((it) => it.key);
    setMenu({
      x: e.clientX, y: e.clientY, label: `${f.name} 메뉴`, items: fileMenu.items(f.path, {
        before: [
          { label: "이 파일 쪽 모두 고르기", icon: <ListChecks size={14} />, onClick: () => { const k = keys(); setSel(selectKeys(k, k[0] ?? null)); } },
          { label: "이 파일 쪽 맨 앞으로", icon: <ArrowUpToLine size={14} />, onClick: () => commit(move(boardRef.current, new Set(keys()), 0)) },
          { label: "이 파일 쪽 맨 뒤로", icon: <ArrowDownToLine size={14} />, onClick: () => commit(move(boardRef.current, new Set(keys()), boardRef.current.items.length)) },
        ],
        after: [{ label: "책상에서 빼기", icon: <X size={14} />, hint: "되돌리기(Ctrl+Z)로 다시 놓을 수 있습니다", onClick: () => commit(removeFile(boardRef.current, f.id)) }],
      }),
    });
  };

  const pickMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 4, label: "고르기", from: "pick", keyboard: e.detail === 0, items: [
        { label: "모두 고르기", shortcut: "Ctrl+A", onClick: () => setSel(selectKeys(all(), boardRef.current.items[0]?.key ?? null)) },
        { label: "고르기 풀기", shortcut: "Esc", disabled: !sel.keys.size, onClick: () => setSel(NO_SELECTION) },
        SEP,
        // 메뉴가 열려 있는 사이 파일이 더 들어올 수 있다 → 누르는 때의 책상으로
        { label: "홀수 쪽", onClick: () => setSel(selectKeys(oddEven(boardRef.current.items, true))) },
        { label: "짝수 쪽", onClick: () => setSel(selectKeys(oddEven(boardRef.current.items, false))) },
        { label: "빈 쪽 찾아 고르기", onClick: () => void selectBlank() },
        { label: "고른 것과 반대로", onClick: () => setSel(selectKeys(invert(boardRef.current.items, selRef.current))) },
        SEP,
        { label: "쪽 번호로 고르기", icon: <Hash size={14} />, onClick: () => setSpec(positionsOf(boardRef.current.items, selRef.current.keys)) },
      ],
    });
  };

  const moreMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const keys = pickedOr(() => one(focus));
    setMenu({
      x: r.left, y: r.bottom + 4, label: "더 보기", from: "more", keyboard: e.detail === 0, items: [
        { label: "맨 앞으로", icon: <ArrowUpToLine size={14} />, disabled: !keys.size, onClick: () => commit(move(boardRef.current, keys, 0)) },
        { label: "맨 뒤로", icon: <ArrowDownToLine size={14} />, disabled: !keys.size, onClick: () => commit(move(boardRef.current, keys, boardRef.current.items.length)) },
        { label: "고른 쪽 차례 거꾸로", icon: <ArrowLeftRight size={14} />, disabled: keys.size < 2, onClick: () => commit(reverse(boardRef.current, keys)) },
        SEP,
        // 양면 스캔: 앞면만 스캔한 파일 + 뒷면만 스캔한 파일 (앞에 놓인 두 파일)
        ...twoFiles(boardRef.current).flatMap(([a, c]) => [
          { label: "두 파일 쪽 번갈아 섞기 (양면 스캔)", icon: <ArrowLeftRight size={14} />, onClick: () => commit(interleave(boardRef.current, a, c, false)) },
          { label: "번갈아 섞기, 뒤 파일은 거꾸로", icon: <ArrowLeftRight size={14} />, onClick: () => commit(interleave(boardRef.current, a, c, true)) },
        ]),
        { label: "자른 곳 모두 풀기", icon: <Scissors size={14} />, disabled: !boardRef.current.cuts.length, onClick: () => commit({ ...boardRef.current, cuts: [] }) },
        // 다른 일과 떼어 놓는다 (잘못 눌러도 되돌릴 수 있음을 밝힌다)
        SEP,
        { label: "책상 비우기", icon: <X size={14} />, danger: true, hint: "되돌리기(Ctrl+Z)로 다시 놓을 수 있습니다", onClick: () => { stopOpening(); commit(EMPTY); setSel(NO_SELECTION); setFocus(null); save.reset(); } },
      ],
    });
  };

  const groups = useMemo(() => {
    if (!board.cuts.length) return null;
    const m = new Map<string, number>();
    let g = 1;
    board.items.forEach((it, i) => { if (i === 0 || board.cuts.includes(it.key)) m.set(it.key, g++); });
    return m;
  }, [board]);

  const setZoom = (z: Zoom) => { setZoomState(z); writePref("kordoc-pdf-zoom", z); };
  const pick = () => void pickFiles({ filters: [{ name: "PDF·그림·문서", extensions: DOC_EXTENSIONS }] }).then((p) => add(p));
  const picked = sel.keys.size;
  const outSetting = settings?.convert.output_dir ?? "";
  const defaultDir = outSetting || dirName(board.files[0]?.path ?? "");
  const usedFiles = board.files.filter((f) => items.some((it) => it.file === f.id));
  const applySpec = () => {
    if (spec == null) return;
    const keys = keysFromSpec(boardRef.current.items, spec);
    if (!keys) { toast('쪽 번호를 "1-3, 5"처럼 적으세요.', "error"); return; }
    setSel(selectKeys(keys, keys[0] ?? null));
    setSpec(null);
  };

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="PDF 합치기·나누기" sub="쪽을 고르고 옮긴 뒤 새 PDF로 저장합니다. 원본은 그대로 둡니다."
        actions={!opening && items.length > 0 && <Button variant="secondary" onClick={pick} data-tip="파일을 더 넣으면 쪽이 맨 뒤에 이어 붙습니다"><FilePlus2 size={15} /> 파일 추가</Button>} />
      <div className="kd-pdf" data-side={items.length > 0}>
        <div className="kd-pdf-main">
          {board.files.length > 0 && (
            <div className="kd-pdf-top">
            <div className="kd-pdf-files" role="list" aria-label="넣은 파일">
              {board.files.map((f) => {
                const n = items.filter((it) => it.file === f.id).length;
                return (
                  <div key={f.id} role="listitem" className="kd-pdf-chip" onContextMenu={(e) => chipMenu(e, f)}>
                    {/* 키보드로도 고르게 단추로 (빼기 X 와 나란히) */}
                    <button type="button" className="kd-pdf-chip-pick" data-tip={`${f.path}\n누르면 이 파일 쪽을 모두 고릅니다`}
                      onClick={() => { const keys = items.filter((it) => it.file === f.id).map((it) => it.key); setSel(selectKeys(keys, keys[0] ?? null)); }}>
                      <span className="kd-pg-dot" data-c={f.color} aria-hidden="true" />
                      <span className="kd-pdf-chip-name">{f.name}</span>
                      <span className="kd-pdf-chip-n">{n === f.sizes.length ? `${num(n)}쪽` : `${num(n)}/${num(f.sizes.length)}쪽`}</span>
                      {f.converted && <span className="kd-pdf-chip-tag">PDF로 바꿈</span>}
                      {f.secured && <span className="kd-pdf-chip-tag" data-tone="warn">보안 PDF</span>}
                    </button>
                    <button type="button" className="kd-icon-btn" aria-label={`${f.name} 빼기`} onClick={(e) => { e.stopPropagation(); commit(removeFile(boardRef.current, f.id)); }}><X size={13} /></button>
                  </div>
                );
              })}
              {opening && <Opening {...opening} onStop={stopOpening} />}
            </div>
            <div className="kd-seg" role="group" aria-label="쪽 크기">
              {(["s", "m", "l"] as const).map((z) => <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z === "s" ? "작게" : z === "m" ? "보통" : "크게"}</button>)}
            </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="kd-pdf-tools" role="toolbar" aria-label="쪽 다루기">
              <span className="kd-pdf-count" aria-live="polite">{picked ? <><b>{num(picked)}</b> / {num(items.length)}쪽 고름</> : <><b>{num(items.length)}</b>쪽 · 파일 {num(usedFiles.length)}개</>}</span>
              <button type="button" className="kd-pdf-tool" onClick={pickMenu} aria-haspopup="menu" aria-expanded={menu?.from === "pick"} aria-label={finding ? "빈 쪽 찾는 중" : "고르기"}><ListChecks size={16} /><span className="kd-pdf-tool-label">{finding ? "빈 쪽 찾는 중" : "고르기"}</span></button>
              {spec != null && (
                <form className="kd-pdf-row" onSubmit={(e) => { e.preventDefault(); applySpec(); }}>
                  <input className="kd-input" style={{ width: 120, height: 32 }} autoFocus value={spec} placeholder="1-3, 5" aria-label="고를 쪽 번호" onChange={(e) => setSpec(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setSpec(null); }} />
                  <Button size="sm" type="submit">고르기</Button>
                </form>
              )}
              <span className="kd-sep" />
              <button type="button" className="kd-pdf-tool" title={picked ? "고른 쪽을 왼쪽으로 (Shift+R)" : "모든 쪽을 왼쪽으로"} aria-label={picked ? "왼쪽으로" : "모두 왼쪽"} onClick={() => commit(rotate(boardRef.current, pickedOr(all), -90))}><RotateCcw size={16} /><span className="kd-pdf-tool-label">{picked ? "왼쪽으로" : "모두 왼쪽"}</span></button>
              <button type="button" className="kd-pdf-tool" title={picked ? "고른 쪽을 오른쪽으로 (R)" : "모든 쪽을 오른쪽으로"} aria-label={picked ? "오른쪽으로" : "모두 오른쪽"} onClick={() => commit(rotate(boardRef.current, pickedOr(all), 90))}><RotateCw size={16} /><span className="kd-pdf-tool-label">{picked ? "오른쪽으로" : "모두 오른쪽"}</span></button>
              <button type="button" className="kd-pdf-tool" data-danger="true" disabled={!picked} title="고른 쪽 지우기 (Delete)" aria-label="지우기" onClick={() => doRemove(sel.keys)}><Trash2 size={16} /><span className="kd-pdf-tool-label">지우기</span></button>
              <button type="button" className="kd-pdf-tool" disabled={!picked} title="고른 쪽 복제 (Ctrl+D)" aria-label="복제" onClick={() => commit(duplicate(boardRef.current, sel.keys))}><Copy size={16} /><span className="kd-pdf-tool-label">복제</span></button>
              <button type="button" className="kd-pdf-tool" data-tip="고른 쪽 뒤에 빈 쪽을 넣습니다. 고른 쪽이 없으면 지금 쪽 뒤, 지금 쪽도 없으면 맨 뒤에 넣습니다." aria-label="빈 쪽" onClick={() => commit(insertBlank(boardRef.current, lastPicked()))}><FilePlus2 size={16} /><span className="kd-pdf-tool-label">빈 쪽</span></button>
              <button type="button" className="kd-pdf-tool" onClick={moreMenu} aria-haspopup="menu" aria-expanded={menu?.from === "more"} aria-label="더 보기"><Ellipsis size={16} /></button>
              <span className="kd-sep" />
              <button type="button" className="kd-pdf-tool" disabled={!past.current.length} title="되돌리기 (Ctrl+Z)" aria-label="되돌리기" onClick={undo}><Undo2 size={16} /><span className="kd-pdf-tool-label">되돌리기</span></button>
              <button type="button" className="kd-pdf-tool" disabled={!future.current.length} title="다시 실행 (Ctrl+Y)" aria-label="다시 실행" onClick={redo}><Redo2 size={16} /></button>
            </div>
          )}

          {items.length ? (
            <PageGrid board={board} sel={sel} focus={focus} size={ZOOM[zoom]} thumbs={thumbs} groups={groups} dropOver={dragTarget === "pdf"} keysOff={!!preview || !!menu}
              onSelect={setSel} onFocus={setFocus} onMove={(keys, to) => commit(move(boardRef.current, keys, to))}
              onCut={(key) => commit(toggleCut(boardRef.current, key))} onMenu={cardMenu} onDeskMenu={deskMenu} onOpen={setPreview} onKey={onGridKey} />
          ) : (
            <div className="kd-pdf-desk" data-drop="pdf" data-over={dragTarget === "pdf"}>
              <EmptyDesk onPick={pick} opening={opening} onStop={stopOpening} />
            </div>
          )}
          {items.length > 0 && (
            <div className="kd-pdf-foot">
              <button type="button" className="kd-pdf-keys" aria-expanded={keysOpen} aria-controls="pdf-keys" onClick={() => setKeysOpen((o) => !o)}>
                <Keyboard size={14} /> 단축키
              </button>
              {keysOpen && (
                <div id="pdf-keys" className="kd-pdf-keylist">
                  <span><kbd>끌기</kbd> 옮기기</span><span><kbd>Shift·Ctrl</kbd>+누르기 여러 쪽</span><span><kbd>R</kbd> 돌리기</span>
                  <span><kbd>Delete</kbd> 지우기</span><span><kbd>Alt+화살표</kbd> 한 칸 옮기기</span><span><kbd>두 번 누르기</kbd> 크게 보기</span><span><kbd>쪽 사이 가위</kbd> 나눌 곳</span>
                  <span><kbd>Ctrl+S</kbd> PDF 하나로 저장</span><span><kbd>Ctrl+Z</kbd> 되돌리기</span>
                </div>
              )}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <SavePanel board={board} sel={sel} opts={opts} set={(p) => setOpts((o) => ({ ...o, ...p }))} names={names} defaultDir={defaultDir} configuredDir={!!outSetting}
            full={uiMode === "full"} busy={save.busy} progress={save.progress} error={save.error} result={save.result} onSave={doSave} onCancel={save.cancel} />
        )}
      </div>

      {menu && <ContextMenu key={`${menu.x}:${menu.y}`} items={menu.items} position={menu} label={menu.label} header={menu.header} keyboard={menu.keyboard}
        // 메뉴가 열린 채 다른 쪽을 우클릭하면 새 메뉴가 먼저 서고 앞 메뉴의 닫기가 뒤따라 온다 → 제 메뉴일 때만 닫는다
        onClose={() => setMenu((cur) => (cur === menu ? null : cur))} />}
      {preview && (
        <PagePreview board={board} pageKey={preview} onGo={(k) => { setPreview(k); setFocus(k); setSel({ keys: new Set([k]), anchor: k }); }}
          onRotate={(k, d) => commit(rotate(boardRef.current, new Set([k]), d))}
          onRemove={(k) => {
            const b = boardRef.current;
            const at = b.items.findIndex((it) => it.key === k);
            doRemove(new Set([k]));
            const next = boardRef.current.items[Math.min(at, boardRef.current.items.length - 1)]?.key;
            setPreview(next ?? null);
          }}
          onClose={() => setPreview(null)} />
      )}
      {dialog}
    </div>
  );
}

/** 여는 중: "2개 중 1개 여는 중" + 진행 막대 (파일 하나면 움직이는 막대) */
function Opening({ done, total, name, big, onStop }: { done: number; total: number; name: string; big?: boolean; onStop?: () => void }) {
  const pct = total > 1 ? Math.round((done / total) * 100) : null;
  return (
    <div className="kd-pdf-opening" data-big={big} role="status" aria-live="polite">
      <span className="kd-pdf-opening-t">{total > 1 ? `${total}개 중 ${done + 1}개 여는 중` : "파일 여는 중"}</span>
      <span className="kd-pdf-opening-name" title={name}>{name}</span>
      <div className="kd-progress" data-indeterminate={pct == null} role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <div style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
      {/* 여러 개를 여는 중이면 멈출 수 있게 (지금 여는 파일까지만 넣고 그만둔다) */}
      {onStop && total > 1 && <Button size="sm" variant="secondary" onClick={onStop}>멈추기</Button>}
    </div>
  );
}

function EmptyDesk({ onPick, opening, onStop }: { onPick: () => void; opening: { done: number; total: number; name: string } | null; onStop: () => void }) {
  const can: Array<[React.ReactNode, string, string]> = [
    [<Combine size={15} />, "합치기", "파일을 여러 개 넣고 PDF 하나로 저장"],
    [<Split size={15} />, "나누기", "쪽 사이 가위로 자르거나 쪽마다·몇 쪽씩"],
    [<FileOutput size={15} />, "쪽 뽑기·지우기", "쪽을 골라 그것만 저장하거나 Delete"],
    [<FileStack size={15} />, "순서·돌리기", "끌어서 옮기고 R로 90도씩 돌리기"],
    [<ImageDown size={15} />, "그림으로 저장", "쪽마다 PNG·JPG, 그림 파일은 PDF로"],
    [<Shrink size={15} />, "용량 줄이기", "쪽 번호·워터마크와 함께 저장할 때"],
  ];
  return (
    <div className="kd-pdf-empty">
      <div className="kd-pdf-empty-sheets" aria-hidden="true"><span /><span /><span /></div>
      {opening ? <Opening {...opening} big onStop={onStop} /> : (
        <>
          <div>
            <h2>PDF·그림·한글 문서를 끌어다 놓기</h2>
            <p className="mt-1.5">한글·워드·엑셀은 PDF로 바꿔 넣습니다.</p>
          </div>
          <Button size="lg" onClick={onPick} data-tip="여러 개를 고르면 이름 차례로 쪽이 이어집니다"><FilePlus2 size={15} /> 파일 고르기</Button>
        </>
      )}
      <div className="kd-pdf-can">
        {can.map(([icon, t, d]) => <div key={t}><b>{icon}{t}</b><span>{d}</span></div>)}
      </div>
    </div>
  );
}
