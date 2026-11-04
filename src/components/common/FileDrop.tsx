/**
 * 파일 넣는 칸 — 끌어다 놓기(data-drop) + [파일 고르기] + 고른 파일 목록. 한 모양으로 여러 화면에서 쓴다.
 * 끌어다 놓은 파일은 그 화면이 registerDrop(drop, …) 으로 받는다.
 * size="sm" 은 한 줄짜리(이미 고를 것이 있는 자리에서 "다른 파일" 넣기).
 */

import type { ReactNode } from "react";
import { FileUp, X } from "lucide-react";
import { useApp } from "../../state/app";
import { pickFiles, type FileFilter } from "../../lib/native";
import { baseName, formatOf } from "../../lib/format";
import { Button } from "../ui/Button";
import { FormatBadge } from "./FormatBadge";
import "./FileDrop.css";

export function FileDrop({ drop, files, onAdd, onRemove, multiple = false, filters, title, hint, pickLabel = "파일 고르기", againLabel, pickTip, size = "lg", busy, children }: {
  /** data-drop 이름 (registerDrop 과 같게) */
  drop: string;
  files: string[];
  onAdd: (paths: string[]) => void;
  onRemove?: (path: string) => void;
  multiple?: boolean;
  filters?: FileFilter[];
  /** 비어 있을 때 큰 글 */
  title: string;
  /** 비어 있을 때 작은 글 (어떤 파일을 넣는지) */
  hint?: string;
  pickLabel?: string;
  /** 파일이 있을 때 단추 글 (기본: 여러 개면 "파일 더 넣기", 하나면 "다른 파일 고르기") */
  againLabel?: string;
  pickTip?: string;
  size?: "lg" | "sm";
  busy?: ReactNode;
  /** 파일 목록 아래 덧붙일 것 */
  children?: ReactNode;
}) {
  const { dragTarget } = useApp();
  const pick = () => void pickFiles({ multiple, ...(filters ? { filters } : {}) }).then((p) => { if (p.length) onAdd(p); });
  const empty = files.length === 0;

  return (
    <div className="kd-filedrop" data-drop={drop} data-size={size} data-empty={empty || undefined} data-over={dragTarget === drop || undefined}>
      {empty ? (
        <div className="kd-filedrop-empty">
          <span className="kd-filedrop-icon" aria-hidden="true"><FileUp size={size === "sm" ? 16 : 22} /></span>
          <span className="kd-filedrop-text">
            <span className="kd-row-title block">{title}</span>
            {hint && <span className="kd-row-desc block">{hint}</span>}
          </span>
          {busy || <Button variant="secondary" size={size === "sm" ? "sm" : "md"} onClick={pick} data-tip={pickTip}><FileUp size={14} /> {pickLabel}</Button>}
        </div>
      ) : (
        <>
          <ul className="kd-filedrop-list">
            {files.map((f) => (
              <li key={f} className="kd-filedrop-item">
                <FormatBadge format={formatOf(f)} />
                <span className="kd-filedrop-name" title={f}>{baseName(f)}</span>
                {onRemove && <button type="button" className="kd-icon-btn" aria-label={`${baseName(f)} 빼기`} onClick={() => onRemove(f)}><X size={14} /></button>}
              </li>
            ))}
          </ul>
          <div className="kd-filedrop-foot">
            {busy || <Button variant="ghost" size="sm" onClick={pick} data-tip={pickTip}><FileUp size={13} /> {againLabel ?? (multiple ? "파일 더 넣기" : "다른 파일 고르기")}</Button>}
            <span className="kd-small kd-muted">여기로 끌어다 놓아도 됩니다</span>
          </div>
        </>
      )}
      {children}
    </div>
  );
}
