/** 쪽 크게 보기 — 화살표로 앞뒤 쪽, R 돌리기, Delete 지우기, Esc 닫기. 그림은 이 쪽만 크게 다시 받는다 */

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, RotateCw, Trash2, X } from "lucide-react";
import { rpc } from "../../lib/rpc";
import { useDialogKeys } from "../ui/useDialogKeys";
import { fileOf, shownSize, type Board } from "./model";

interface Props {
  board: Board;
  pageKey: string;
  onGo: (key: string) => void;
  onRotate: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
}

export function PagePreview({ board, pageKey, onGo, onRotate, onRemove, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
  const [room, setRoom] = useState({ w: 800, h: 600 });
  useDialogKeys(boxRef, true, onClose);

  const i = board.items.findIndex((it) => it.key === pageKey);
  const it = board.items[i];
  const f = it && fileOf(board, it);

  // 열 때 초점을 이 창으로 (격자 카드에 남아 있으면 키를 격자도 받는다)
  useEffect(() => { boxRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth - 48, h: el.clientHeight - 32 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 이 쪽 그림을 크게 (폭은 보이는 크기 × 화면 배율, 1600px 까지)
  const source = f?.source;
  const page = it?.page;
  useEffect(() => {
    if (!source || !page) return;
    let gone = false;
    const width = Math.min(1600, Math.round(Math.max(room.w, room.h) * (window.devicePixelRatio || 1)));
    void rpc("pdf_thumbs", { path: source, pages: String(page), width })
      .then((r) => { if (!gone && r.pages[0]) setUrl({ key: `${source}#${page}`, url: r.pages[0].data_url }); })
      .catch(() => undefined);
    return () => { gone = true; };
  }, [source, page, room.w, room.h]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!it) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); if (i > 0) onGo(board.items[i - 1].key); }
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); if (i < board.items.length - 1) onGo(board.items[i + 1].key); }
      else if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onRotate(it.key, e.shiftKey ? -90 : 90); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onRemove(it.key); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, i, it, onGo, onRotate, onRemove]);

  if (!it) return null;
  const base = it.blank ?? f?.sizes[it.page - 1] ?? { width: 595, height: 842 };
  const shown = shownSize(board, it);
  const s = Math.min(room.w / shown.width, room.h / shown.height);
  const here = url?.key === `${source}#${page}` ? url.url : undefined;

  return (
    <div ref={boxRef} className="kd-pdf-view" role="dialog" aria-modal="true" tabIndex={-1} aria-label={`${i + 1}번째 쪽 크게 보기`}>
      <div className="kd-pdf-view-head">
        <strong className="kd-num">{i + 1} / {board.items.length}</strong>
        <span className="min-w-0 flex-1 truncate">{it.blank ? "빈 쪽" : `${f?.name} ${it.page}쪽`}{it.rotate ? ` · ${it.rotate}도 돌림` : ""}</span>
        <button type="button" className="kd-icon-btn" aria-label="앞 쪽" disabled={i === 0} onClick={() => onGo(board.items[i - 1].key)}><ChevronLeft size={18} /></button>
        <button type="button" className="kd-icon-btn" aria-label="다음 쪽" disabled={i === board.items.length - 1} onClick={() => onGo(board.items[i + 1].key)}><ChevronRight size={18} /></button>
        <button type="button" className="kd-icon-btn" aria-label="왼쪽으로 돌리기 (Shift+R)" onClick={() => onRotate(it.key, -90)}><RotateCcw size={17} /></button>
        <button type="button" className="kd-icon-btn" aria-label="오른쪽으로 돌리기 (R)" onClick={() => onRotate(it.key, 90)}><RotateCw size={17} /></button>
        <button type="button" className="kd-icon-btn" aria-label="이 쪽 지우기 (Delete)" onClick={() => onRemove(it.key)}><Trash2 size={17} /></button>
        <button type="button" className="kd-icon-btn" aria-label="닫기 (Esc)" onClick={onClose}><X size={18} /></button>
      </div>
      <div ref={bodyRef} className="kd-pdf-view-body" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className={`kd-pg-sheet${it.blank ? " kd-pg-blank" : ""}`} style={{ width: base.width * s, height: base.height * s, transform: `rotate(${it.rotate}deg)` }}>
          {here ? <img src={here} alt={`${i + 1}번째 쪽`} draggable={false} /> : !it.blank && <span className="kd-pg-wait">불러오는 중</span>}
        </div>
      </div>
    </div>
  );
}
