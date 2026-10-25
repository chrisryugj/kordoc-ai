/** 파일 고르기·저장 대화상자·끌어다 놓기·시스템 알림 (브라우저 미리보기에서는 목으로) */

import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { isTauri, loadMock } from "./rpc";

export const DOC_EXTENSIONS = [
  "hwp", "hwpx", "hml", "pdf", "xls", "xlsx", "docx", "pptx",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "md", "txt", "csv",
];

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const FILTERS: Record<string, FileFilter[]> = {
  docs: [{ name: "문서", extensions: DOC_EXTENSIONS }],
  hangul: [{ name: "한글 문서", extensions: ["hwp", "hwpx"] }],
  hwpx: [{ name: "HWPX 문서", extensions: ["hwpx"] }],
  roster: [{ name: "명부 (엑셀·CSV)", extensions: ["xlsx", "xls", "csv"] }],
  image: [{ name: "그림", extensions: ["png", "jpg", "jpeg"] }],
  gguf: [{ name: "AI 모델 (GGUF)", extensions: ["gguf"] }],
  pdf: [{ name: "PDF", extensions: ["pdf"] }],
};

export async function pickFiles(opts: { multiple?: boolean; filters?: FileFilter[] } = {}): Promise<string[]> {
  const multiple = opts.multiple ?? true;
  const filters = opts.filters ?? FILTERS.docs;
  if (!isTauri) return (await loadMock()).mockPickFiles(multiple, filters);
  const picked = await open({ multiple, filters });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return (await loadMock()).mockPickFolder();
  const picked = await open({ directory: true, multiple: false });
  if (!picked) return null;
  return Array.isArray(picked) ? picked[0] ?? null : picked;
}

export async function pickSavePath(defaultPath: string, filters?: FileFilter[]): Promise<string | null> {
  if (!isTauri) return defaultPath.includes("/") ? defaultPath : `/Users/kim/Documents/${defaultPath}`;
  // 맥 우클릭·끌어 놓기로 연 문서는 이름이 자소 분리(NFD)라, 그대로 제안하면 윈도에서 저장한 이름이 깨진다
  const cut = Math.max(defaultPath.lastIndexOf("/"), defaultPath.lastIndexOf("\\")) + 1;
  const picked = await save({ defaultPath: defaultPath.slice(0, cut) + defaultPath.slice(cut).normalize("NFC"), filters });
  if (!picked) return null;
  // 저장 창이 확장자를 안 붙여 주거나 다른 확장자(회신.pdf)를 친 그대로 돌려줄 때, 내용과 이름이 어긋나지 않게 고른 형식의 확장자를 붙인다
  const exts = (filters ?? []).flatMap((f) => f.extensions);
  return exts.length && !exts.some((e) => picked.toLowerCase().endsWith(`.${e.toLowerCase()}`)) ? `${picked}.${exts[0]}` : picked;
}

/** 창이 가려져 있을 때만 시스템 알림 (보이는 동안은 화면 안 알림으로 충분) */
export async function notifySystem(title: string, body: string) {
  if (!isTauri) return;
  try {
    if (await getCurrentWindow().isFocused()) return;
    if (!(await isPermissionGranted())) return;
    sendNotification({ title, body });
  } catch {
    /* 알림 실패는 무시 */
  }
}

/** 창 없이 돈 일(우클릭 빠른 동작)의 알림. 권한이 없으면 한 번 묻고, 못 보냈으면 false (그러면 화면이 창을 열어 알린다) */
export async function notifyQuick(title: string, body: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (!ok) return false;
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

export interface DropCallbacks {
  /** x·y 는 창 안 CSS 픽셀 */
  onHover: (x: number, y: number) => void;
  onLeave: () => void;
  onDrop: (paths: string[], x: number, y: number) => void;
}

/** 창 전체 끌어다 놓기 감시. 해제 함수를 돌려준다 */
export function watchFileDrop(cb: DropCallbacks): () => void {
  if (isTauri) {
    let off: (() => void) | null = null;
    let disposed = false;
    const dpr = () => window.devicePixelRatio || 1;
    void getCurrentWindow().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "leave") { cb.onLeave(); return; }
      const x = p.position.x / dpr();
      const y = p.position.y / dpr();
      if (p.type === "drop") cb.onDrop(p.paths, x, y);
      else cb.onHover(x, y);
    }).then((fn) => { if (disposed) fn(); else off = fn; });
    return () => { disposed = true; off?.(); };
  }

  // 브라우저 미리보기: 실제 경로를 모르므로 목 폴더 아래 같은 이름으로 만든다
  const over = (e: DragEvent) => { e.preventDefault(); cb.onHover(e.clientX, e.clientY); };
  const leave = (e: DragEvent) => { if (!e.relatedTarget) cb.onLeave(); };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    const names = Array.from(e.dataTransfer?.files ?? []).map((f) => f.name);
    cb.onLeave();
    if (names.length) cb.onDrop(names.map((n) => `/Users/kim/Documents/${n}`), e.clientX, e.clientY);
  };
  window.addEventListener("dragover", over);
  window.addEventListener("dragleave", leave);
  window.addEventListener("drop", drop);
  return () => {
    window.removeEventListener("dragover", over);
    window.removeEventListener("dragleave", leave);
    window.removeEventListener("drop", drop);
  };
}

/** 바이트 ↔ base64 (편집기 내보내기·불러오기) */
export function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** 문서·AI 답 속 링크는 앱 창을 넘기지 않고 기본 브라우저로 (http·https·mailto 만) */
export async function openExternal(href: string | undefined) {
  if (!href || !/^(https?:|mailto:)/i.test(href)) return;
  if (!isTauri) { window.open(href, "_blank", "noopener"); return; }
  const { open: openUrl } = await import("@tauri-apps/plugin-shell");
  await openUrl(href).catch(() => {});
}
