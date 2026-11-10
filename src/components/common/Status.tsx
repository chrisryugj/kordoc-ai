/** 상태 부품 — 글로도 알리는 상태 줄, 알림 상자, 비어 있음, 작업 진행, 저장한 파일 */

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, ExternalLink, FolderOpen, Info, Loader2, Square, XCircle } from "lucide-react";
import { Button } from "../ui/Button";
import type { Progress } from "../../lib/rpc";
import { rpc, errorText } from "../../lib/rpc";
import { baseName } from "../../lib/format";
import { useApp } from "../../state/app";
import { useFileMenu } from "./file-menu";

type Tone = "ok" | "warn" | "err" | "busy" | "info" | "muted";

export function StatusLine({ tone, children }: { tone: Tone; children: ReactNode }) {
  const icon = tone === "ok" ? <CheckCircle2 size={14} />
    : tone === "warn" ? <AlertTriangle size={14} />
    : tone === "err" ? <XCircle size={14} />
    : tone === "busy" ? <Loader2 size={14} className="kd-spin" />
    : <Info size={14} />;
  return <span className="kd-status" data-tone={tone}>{icon}<span>{children}</span></span>;
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn" | "err" | "ok"; children: ReactNode }) {
  const icon = tone === "warn" ? <AlertTriangle size={15} /> : tone === "err" ? <CircleAlert size={15} /> : tone === "ok" ? <CheckCircle2 size={15} /> : <Info size={15} />;
  return <div className="kd-note" data-tone={tone} role={tone === "err" ? "alert" : undefined}>{icon}<div className="min-w-0 flex-1">{children}</div></div>;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="kd-empty">
      {icon && <div className="kd-empty-icon" aria-hidden="true">{icon}</div>}
      <p className="kd-empty-title">{title}</p>
      {children && <p>{children}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** 진행 중 표시 + 멈추기 */
export function Working({ label, progress, onCancel }: { label: string; progress?: Progress | null; onCancel?: () => void }) {
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null;
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <StatusLine tone="busy">{progress?.message || label}{pct != null ? ` (${pct}%)` : ""}</StatusLine>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <Square size={12} /> 멈추기
          </Button>
        )}
      </div>
      <div className="kd-progress" data-indeterminate={pct == null} role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <div style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
    </div>
  );
}

export function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return <Note tone={message === "멈췄습니다" ? "info" : "err"}>{message}</Note>;
}

/** 저장한 파일 한 줄 — 파일 열기·폴더에서 보기 */
export function SavedFile({ path, label = "저장했습니다", folder }: { path: string; label?: string; folder?: boolean }) {
  const { toast } = useApp();
  const menu = useFileMenu();
  // 파일을 옮겼거나 지웠으면 열리지 않는다 → 아무 일도 안 일어나는 것처럼 보이지 않게 알린다
  const fail = (e: unknown) => toast(errorText(e), "error");
  return (
    <div className="kd-note" data-tone="ok" onContextMenu={(e) => menu.open(e, path, { folder })}>
      <CheckCircle2 size={15} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{label}</div>
        <div className="kd-path mt-0.5" title={path}>{folder ? path : baseName(path)}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!folder && (
            <Button variant="secondary" size="sm" onClick={() => void rpc("open_file", { path }).catch(fail)}>
              <ExternalLink size={13} /> 열기
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => void (folder ? rpc("open_folder", { path }) : rpc("reveal_file", { path })).catch(fail)}>
            <FolderOpen size={13} /> 폴더에서 보기
          </Button>
        </div>
      </div>
    </div>
  );
}
