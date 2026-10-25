/**
 * PDF 작업 — PDF·그림·한글·워드 문서를 넣으면 쪽이 한 줄로 놓인다. 쪽을 골라 옮기고, 돌리고, 지우고, 나눌 곳을 정한 뒤 저장한다.
 * 합치기·나누기·쪽 뽑기·쪽 지우기·순서 바꾸기·돌리기·빈 쪽·복제·그림으로·그림을 PDF로·용량 줄이기·쪽 번호·워터마크가 한 화면.
 * 원본 파일은 바꾸지 않는다. 바꾸기는 모두 되돌리기(Ctrl+Z) 한 단계씩.
 */

import "./pdf.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDownToLine, ArrowUpToLine, ArrowLeftRight, Combine, Copy, Ellipsis, FilePlus2, FileStack, ImageDown, ListChecks, Maximize2,
  Redo2, RotateCcw, RotateCw, Scissors, Shrink, Split, Trash2, Undo2, X, FileOutput, Hash,
} from "lucide-react";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { DOC_EXTENSIONS, notifySystem, pickFiles } from "../../lib/native";
import { dirName, num } from "../../lib/format";
import { readPref, writePref } from "../../lib/recent";
import { useTask } from "../../hooks/useTask";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";
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
  const { registerDrop, dragTarget, toast, pdfIntent, settings, setBadge } = useApp();
  const [board, setBoardState] = useState<Board>(EMPTY);
  const boardRef = useRef(board);
  const past = useRef<Board[]>([]);
  const future = useRef<Board[]>([]);
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const [focus, setFocus] = useState<string | null>(null);
  const [zoom, setZoomState] = useState<Zoom>(() => readPref<Zoom>("kordoc-pdf-zoom", "m"));
  const [opening, setOpening] = useState<{ done: number; total: number; name: string } | null>(null);
  const [finding, setFinding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [spec, setSpec] = useState<string | null>(null);
  const [opts, setOpts] = useState<SaveOpts>(DEFAULT_SAVE);
  const thumbs = useThumbs(ZOOM[zoom]);
  const save = useTask<SaveResult>();
  const queue = useRef(Promise.resolve());
  const handled = useRef(0);
  const selRef = useRef(sel);
  selRef.current = sel;

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
      } catch (e) {
        toast(`파일 목록을 만들지 못했습니다: ${errorText(e)}`, "error");
        return;
      }
      if (list.length > 1) list.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
      const failed: string[] = [];
      let first = true;
      for (const [i, f] of list.entries()) {
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
  }, [commit, toast]);

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
      toast(found.length ? `빈 쪽 ${num(found.length)}개를 골랐습니다. 지우려면 Delete 를 누르세요.` : "빈 쪽이 없습니다.", "info");
    } finally {
      setFinding(false);
    }
  }, [thumbs, toast]);

  // ── 저장 ──
  const names = useMemo(() => {
    const typed = opts.name.trim().replace(/\.pdf$/i, "");
    const base = typed || boardName(board);
    return {
      all: typed || (board.files.length ? `${base}${board.files.length > 1 ? "_합본" : "_정리"}` : ""),
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
        const r = await rpc("pdf_to_images", { ...common, items: imageItems(b, keys), format: opts.imageFormat, dpi: opts.dpi }, { signal, onProgress });
        void notifySystem("KorDoc AI: PDF 작업 끝", `그림 ${r.files.length}장을 저장했습니다`);
        return { kind: "images", dir: r.output_dir, count: r.files.length };
      }
      const outputs = kind === "all" ? planAll(b, names.all)
        : kind === "selected" ? planSelected(b, keys, names.selected)
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
    });
  }, [save, opts, names]);

  // ── 키 ──
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (preview || menu) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.code === "KeyS") { e.preventDefault(); doSave("all"); return; }
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
      if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.code === "KeyY") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, preview, menu, doSave, undo, redo]);

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
    setMenu({
      x, y, items: [
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
        { label: n > 1 ? `${n}쪽 지우기` : "지우기", shortcut: "Delete", icon: <Trash2 size={14} />, danger: true, onClick: () => doRemove(keys) },
      ],
    });
  };

  const pickMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const b = boardRef.current;
    setMenu({
      x: r.left, y: r.bottom + 4, items: [
        { label: "모두 고르기", shortcut: "Ctrl+A", onClick: () => setSel(selectKeys(all(), b.items[0]?.key ?? null)) },
        { label: "고르기 풀기", shortcut: "Esc", disabled: !sel.keys.size, onClick: () => setSel(NO_SELECTION) },
        SEP,
        { label: "홀수 쪽", onClick: () => setSel(selectKeys(oddEven(b.items, true))) },
        { label: "짝수 쪽", onClick: () => setSel(selectKeys(oddEven(b.items, false))) },
        { label: "빈 쪽 찾아 고르기", onClick: () => void selectBlank() },
        { label: "고른 것과 반대로", onClick: () => setSel(selectKeys(invert(b.items, selRef.current))) },
        SEP,
        { label: "쪽 번호로 고르기", icon: <Hash size={14} />, onClick: () => setSpec(positionsOf(b.items, selRef.current.keys)) },
      ],
    });
  };

  const moreMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const keys = pickedOr(() => one(focus));
    setMenu({
      x: r.left, y: r.bottom + 4, items: [
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
        { label: "책상 비우기", icon: <X size={14} />, danger: true, onClick: () => { commit(EMPTY); setSel(NO_SELECTION); setFocus(null); } },
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
      <ScreenHeader title="PDF 작업" sub="파일을 넣고 쪽을 고르거나 옮긴 뒤 저장합니다. 원본 파일은 그대로 둡니다."
        actions={<Button variant="secondary" onClick={pick}><FilePlus2 size={15} /> 파일 추가</Button>} />
      <div className="kd-pdf">
        <div className="kd-pdf-main">
          {(board.files.length > 0 || opening) && (
            <div className="kd-pdf-top">
            <div className="kd-pdf-files" role="list" aria-label="넣은 파일">
              {board.files.map((f) => {
                const n = items.filter((it) => it.file === f.id).length;
                return (
                  <div key={f.id} role="listitem" className="kd-pdf-chip" title={`${f.path}\n누르면 이 파일 쪽을 모두 고릅니다`}
                    onClick={() => { const keys = items.filter((it) => it.file === f.id).map((it) => it.key); setSel(selectKeys(keys, keys[0] ?? null)); }}>
                    <span className="kd-pg-dot" data-c={f.color} aria-hidden="true" />
                    <span className="kd-pdf-chip-name">{f.name}</span>
                    <span className="kd-pdf-chip-n">{n === f.sizes.length ? `${num(n)}쪽` : `${num(n)}/${num(f.sizes.length)}쪽`}</span>
                    {f.converted && <span className="kd-pdf-chip-tag">PDF로 바꿈</span>}
                    {f.secured && <span className="kd-pdf-chip-tag" data-tone="warn">보안 PDF</span>}
                    <button type="button" className="kd-icon-btn" aria-label={`${f.name} 빼기`} onClick={(e) => { e.stopPropagation(); commit(removeFile(boardRef.current, f.id)); }}><X size={13} /></button>
                  </div>
                );
              })}
              {opening && <div className="kd-pdf-chip kd-pdf-chip-wait" role="status">여는 중 ({opening.done + 1}/{opening.total}) {opening.name}</div>}
            </div>
            <div className="kd-seg" role="group" aria-label="쪽 크기">
              {(["s", "m", "l"] as const).map((z) => <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z === "s" ? "작게" : z === "m" ? "보통" : "크게"}</button>)}
            </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="kd-pdf-tools" role="toolbar" aria-label="쪽 다루기">
              <span className="kd-pdf-count" aria-live="polite">{picked ? <><b>{num(picked)}</b> / {num(items.length)}쪽 고름</> : <><b>{num(items.length)}</b>쪽 · 파일 {num(usedFiles.length)}개</>}</span>
              <button type="button" className="kd-pdf-tool" onClick={pickMenu} aria-haspopup="menu"><ListChecks size={16} /><span className="kd-pdf-tool-label">{finding ? "빈 쪽 찾는 중" : "고르기"}</span></button>
              {spec != null && (
                <form className="kd-pdf-row" onSubmit={(e) => { e.preventDefault(); applySpec(); }}>
                  <input className="kd-input" style={{ width: 120, height: 32 }} autoFocus value={spec} placeholder="1-3, 5" aria-label="고를 쪽 번호" onChange={(e) => setSpec(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setSpec(null); }} />
                  <Button size="sm" type="submit">고르기</Button>
                </form>
              )}
              <span className="kd-sep" />
              <button type="button" className="kd-pdf-tool" title={picked ? "고른 쪽을 왼쪽으로 (Shift+R)" : "모든 쪽을 왼쪽으로"} onClick={() => commit(rotate(boardRef.current, pickedOr(all), -90))}><RotateCcw size={16} /><span className="kd-pdf-tool-label">{picked ? "왼쪽으로" : "모두 왼쪽"}</span></button>
              <button type="button" className="kd-pdf-tool" title={picked ? "고른 쪽을 오른쪽으로 (R)" : "모든 쪽을 오른쪽으로"} onClick={() => commit(rotate(boardRef.current, pickedOr(all), 90))}><RotateCw size={16} /><span className="kd-pdf-tool-label">{picked ? "오른쪽으로" : "모두 오른쪽"}</span></button>
              <button type="button" className="kd-pdf-tool" data-danger="true" disabled={!picked} title="고른 쪽 지우기 (Delete)" onClick={() => doRemove(sel.keys)}><Trash2 size={16} /><span className="kd-pdf-tool-label">지우기</span></button>
              <button type="button" className="kd-pdf-tool" disabled={!picked} title="고른 쪽 복제 (Ctrl+D)" onClick={() => commit(duplicate(boardRef.current, sel.keys))}><Copy size={16} /><span className="kd-pdf-tool-label">복제</span></button>
              <button type="button" className="kd-pdf-tool" title="고른 쪽 뒤에(없으면 맨 뒤에) 빈 쪽" onClick={() => commit(insertBlank(boardRef.current, lastPicked()))}><FilePlus2 size={16} /><span className="kd-pdf-tool-label">빈 쪽</span></button>
              <button type="button" className="kd-pdf-tool" onClick={moreMenu} aria-haspopup="menu" aria-label="더 보기"><Ellipsis size={16} /></button>
              <span className="kd-sep" />
              <button type="button" className="kd-pdf-tool" disabled={!past.current.length} title="되돌리기 (Ctrl+Z)" onClick={undo}><Undo2 size={16} /><span className="kd-pdf-tool-label">되돌리기</span></button>
              <button type="button" className="kd-pdf-tool" disabled={!future.current.length} title="다시 하기 (Ctrl+Shift+Z)" aria-label="다시 하기" onClick={redo}><Redo2 size={16} /></button>
            </div>
          )}

          {items.length ? (
            <PageGrid board={board} sel={sel} focus={focus} size={ZOOM[zoom]} thumbs={thumbs} groups={groups} dropOver={dragTarget === "pdf"} keysOff={!!preview || !!menu}
              onSelect={setSel} onFocus={setFocus} onMove={(keys, to) => commit(move(boardRef.current, keys, to))}
              onCut={(key) => commit(toggleCut(boardRef.current, key))} onMenu={cardMenu} onOpen={setPreview} onKey={onGridKey} />
          ) : (
            <div className="kd-pdf-desk" data-drop="pdf" data-over={dragTarget === "pdf"}>
              <EmptyDesk onPick={pick} opening={!!opening} />
            </div>
          )}
          {items.length > 0 && (
            <div className="kd-pdf-foot" aria-hidden="true">
              <span><kbd>끌기</kbd> 옮기기</span><span><kbd>Shift·Ctrl</kbd>+누르기 여러 쪽</span><span><kbd>R</kbd> 돌리기</span>
              <span><kbd>Delete</kbd> 지우기</span><span><kbd>Alt+화살표</kbd> 한 칸 옮기기</span><span><kbd>두 번 누르기</kbd> 크게 보기</span><span><kbd>쪽 사이 가위</kbd> 나눌 곳</span>
            </div>
          )}
        </div>

        <SavePanel board={board} sel={sel} opts={opts} set={(p) => setOpts((o) => ({ ...o, ...p }))} names={names} defaultDir={defaultDir} configuredDir={!!outSetting}
          busy={save.busy} progress={save.progress} error={save.error} result={save.result} onSave={doSave} onCancel={save.cancel} />
      </div>

      {menu && <ContextMenu items={menu.items} position={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
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
    </div>
  );
}

function EmptyDesk({ onPick, opening }: { onPick: () => void; opening: boolean }) {
  const can: Array<[React.ReactNode, string, string]> = [
    [<Combine size={15} />, "합치기", "파일을 여러 개 넣고 PDF 하나로 저장"],
    [<Split size={15} />, "나누기", "쪽 사이 가위로 자르거나 쪽마다·몇 쪽씩"],
    [<FileOutput size={15} />, "쪽 뽑기·지우기", "쪽을 골라 그것만 저장하거나 Delete"],
    [<FileStack size={15} />, "순서·돌리기", "끌어서 옮기고 R 로 90도씩 돌리기"],
    [<ImageDown size={15} />, "그림으로 저장", "쪽마다 PNG·JPG, 그림 파일은 PDF로"],
    [<Shrink size={15} />, "용량 줄이기", "쪽 번호·워터마크와 함께 저장할 때"],
  ];
  return (
    <div className="kd-pdf-empty">
      <div className="kd-pdf-empty-sheets" aria-hidden="true"><span /><span /><span /></div>
      <div>
        <h2>{opening ? "파일을 여는 중입니다" : "PDF·그림·한글 문서를 끌어다 놓으세요"}</h2>
        <p className="mt-1.5">한글·워드·엑셀은 PDF로 바꿔서 넣습니다. 여러 파일을 넣으면 쪽이 한 줄로 이어집니다.</p>
      </div>
      <Button size="lg" onClick={onPick}><FilePlus2 size={15} /> 파일 고르기</Button>
      <div className="kd-pdf-can">
        {can.map(([icon, t, d]) => <div key={t}><b>{icon}{t}</b><span>{d}</span></div>)}
      </div>
    </div>
  );
}
