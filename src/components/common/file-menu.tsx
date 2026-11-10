/**
 * 파일 하나의 우클릭 메뉴 — 어느 화면에서 파일을 만나든 같은 순서·같은 말로 나온다:
 * 여기서 여는 일(문서 화면·편집기·AI) → 밖에서 여는 일(기본 프로그램·폴더) → 복사 → 그 화면만의 일(목록에서 빼기 등).
 */

import { useCallback } from "react";
import { Copy, ExternalLink, FilePen, FileText, FolderOpen, Sparkles } from "lucide-react";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { baseName, formatOf, isHangul } from "../../lib/format";
import { showMenu, tidyMenu } from "../ui/menu";
import type { ContextMenuEntry } from "../ui/ContextMenu";

export const MENU_SEP: ContextMenuEntry = { type: "separator" };

/** 문서 카드 창(탐색기 우클릭)에는 문서 화면·편집기가 없다 */
const inCard = () => new URLSearchParams(window.location.search).has("card");

interface Options {
  /** 맨 위에 놓을 그 화면의 주된 일 */
  before?: ContextMenuEntry[];
  /** 맨 아래에 놓을 일 (목록에서 빼기 등) */
  after?: ContextMenuEntry[];
  /** 이미 문서 화면이면 "문서 화면에서 열기"를 뺀다 */
  inWorkbench?: boolean;
  /** 폴더 경로 (열기·편집 없이 폴더 열기만) */
  folder?: boolean;
}

export function useFileMenu() {
  const { openDocs, startCreate, askWork, toast } = useApp();

  const items = useCallback((path: string, o: Options = {}): ContextMenuEntry[] => {
    const fmt = formatOf(path);
    const fail = (e: unknown) => toast(errorText(e), "error");
    const copy = (text: string, done: string) => void navigator.clipboard.writeText(text).then(() => toast(done, "success"), () => toast("복사하지 못했습니다", "error"));
    const here: ContextMenuEntry[] = inCard() || o.folder || fmt === "unknown" ? [] : [
      ...(o.inWorkbench ? [] : [{ label: "문서 화면에서 열기", icon: <FileText size={14} />, onClick: () => openDocs([path]) }]),
      ...(isHangul(fmt) ? [{ label: "편집기에서 고치기", icon: <FilePen size={14} />, onClick: () => startCreate({ path }) }] : []),
      { label: "AI에게 시키기", icon: <Sparkles size={14} />, onClick: () => askWork({ paths: [path] }) },
    ];
    const outside: ContextMenuEntry[] = o.folder
      ? [{ label: "폴더 열기", icon: <FolderOpen size={14} />, onClick: () => void rpc("open_folder", { path }).catch(fail) }]
      : [
        { label: "기본 프로그램으로 열기", icon: <ExternalLink size={14} />, onClick: () => void rpc("open_file", { path }).catch(fail) },
        { label: "폴더에서 보기", icon: <FolderOpen size={14} />, onClick: () => void rpc("reveal_file", { path }).catch(fail) },
      ];
    return tidyMenu([
      ...(o.before ?? []), MENU_SEP,
      ...here, MENU_SEP,
      ...outside, MENU_SEP,
      { label: "경로 복사", icon: <Copy size={14} />, onClick: () => copy(path, "경로를 복사했습니다") },
      ...(o.folder ? [] : [{ label: "파일 이름 복사", onClick: () => copy(baseName(path), "파일 이름을 복사했습니다") }]),
      MENU_SEP, ...(o.after ?? []),
    ]);
  }, [openDocs, startCreate, askWork, toast]);

  /** onContextMenu 에 바로 꽂는다 */
  const open = useCallback((e: React.MouseEvent, path: string, o: Options = {}) => {
    showMenu(e, items(path, o), { label: `${baseName(path)} 메뉴` });
  }, [items]);

  return { items, open };
}
