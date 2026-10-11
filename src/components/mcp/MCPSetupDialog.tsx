/** MCP 설치 다이얼로그 — AI 도구에 kordoc MCP 원클릭 등록 */

import { useState, useEffect, useCallback } from "react";
import {
  Download, Check, X, FolderOpen,
  Settings2, Zap, RefreshCw, ChevronRight,
} from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import type { McpEnv } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { pickFolder } from "../../lib/native";

// ── Types ────────────────────────────────────────────────────────

interface InstallResult {
  clientId: string;
  clientName: string;
  ok: boolean;
  error?: string;
}

type Tab = "auto" | "manual";

interface MCPSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (msg: string, type: "success" | "error" | "info" | "loading") => void;
}

// ── Constants ────────────────────────────────────────────────────

// npx·npm 안내는 두지 않는다: 폐쇄망·Node 없는 PC 에서 안 되고, 앱과 다른 판의 kordoc 을 받아 온다.
// 등록은 늘 앱에 든 Node 와 kordoc 경로로 (install_mcp_config)
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "auto", label: "자동 설치", icon: <Zap size={13} /> },
  { id: "manual", label: "설정 파일 위치", icon: <Settings2 size={13} /> },
];

// ── Component ────────────────────────────────────────────────────

export function MCPSetupDialog({ isOpen, onClose, showToast }: MCPSetupDialogProps) {
  const [tab, setTab] = useState<Tab>("auto");
  const [env, setEnv] = useState<McpEnv | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);
  const [installResults, setInstallResults] = useState<InstallResult[] | null>(null);
  const [rootDir, setRootDir] = useState("");

  // 환경 감지 — 앱이 깔린 AI 도구 중 아직 연결 안 된 것을 미리 고른다
  const detect = useCallback(async () => {
    setLoading(true);
    setInstallResults(null);
    try {
      const result = await rpc("detect_mcp_env", {});
      setEnv(result);
      setSelected(new Set(result.clients.filter((c) => c.installed && !c.configured).map((c) => c.id)));
    } catch {
      setEnv(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTab("auto");
      setInstallResults(null);
      detect();
    }
  }, [isOpen, detect]);

  // 클라이언트 선택 토글
  const toggleClient = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // MCP 설치 (앱에 든 Node 와 kordoc 으로 등록 — npx 불필요)
  const handleInstall = async () => {
    if (selected.size === 0 || !env) return;
    setInstalling(true);
    setInstallResults(null);
    try {
      const result = await rpc("install_mcp_config", { clients: [...selected], ...(rootDir ? { root_dir: rootDir } : {}) });
      const name = (id: string) => env.clients.find((c) => c.id === id)?.name ?? id;
      setInstallResults([
        ...result.installed.map((id) => ({ clientId: id, clientName: name(id), ok: true })),
        ...result.failed.map((f) => ({ clientId: f.client, clientName: name(f.client), ok: false, error: f.error })),
      ]);
      if (result.installed.length > 0) {
        showToast(`AI 도구 ${result.installed.length}개에 kordoc MCP를 등록했습니다`, "success");
        detect();
      }
      if (result.failed.length > 0) {
        showToast(`${result.failed.length}개 실패: ${result.failed.map((f) => name(f.client)).join(", ")}`, "error");
      }
    } catch (e) {
      showToast(`설치 실패: ${errorText(e)}`, "error");
    } finally {
      setInstalling(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI 도구에 kordoc 연결" size="lg">
      <div className="flex flex-col gap-0">
        {/* Hero */}
        <p className="ts-xs mb-3" style={{ color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
          kordoc MCP를 설치하면 <strong>Claude, Cursor, VS Code</strong> 등에서
          HWP · HWPX · PDF · XLSX · DOCX를 직접 읽고 분석할 수 있습니다.
        </p>

        {/* Tabs */}
        <div className="flex gap-0 mb-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-2 ts-xs font-medium transition-colors"
              style={{
                color: tab === t.id ? "var(--color-accent)" : "var(--color-text-muted)",
                borderBottom: `2px solid ${tab === t.id ? "var(--color-accent)" : "transparent"}`,
                marginBottom: "-1px",
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ minHeight: 200 }}>
          {/* ── 자동 설치 ── */}
          {tab === "auto" && (
            <div className="space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-8 gap-2 ts-xs" style={{ color: "var(--color-text-muted)" }}>
                  <RefreshCw size={16} className="animate-spin" />
                  AI 도구 감지 중...
                </div>
              ) : env ? (
                <>
                  <div className="space-y-1">
                    {env.clients.map((client) => {
                      const isSelected = selected.has(client.id);
                      return (
                        <label
                          key={client.id}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                          style={{
                            backgroundColor: isSelected ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)",
                            border: `1px solid ${isSelected ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
                            opacity: client.installed ? 1 : 0.6,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleClient(client.id)}
                            className="accent-[var(--color-accent)] w-3.5 h-3.5"
                          />
                          <span className="ts-xs font-medium flex-1" style={{ color: "var(--color-text-primary)" }}>
                            {client.name}
                          </span>
                          {client.configured ? (
                            <span className="flex items-center gap-1 ts-2xs font-medium" style={{ color: "var(--color-success)" }}>
                              <Check size={11} /> 연결됨
                            </span>
                          ) : client.installed ? (
                            <span className="ts-2xs" style={{ color: "var(--color-accent)" }}>깔려 있음</span>
                          ) : (
                            <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>이 PC에 없음</span>
                          )}
                        </label>
                      );
                    })}
                  </div>

                  {/* 설치 결과 */}
                  {installResults && (
                    <div className="space-y-1">
                      {installResults.map((r) => (
                        <div
                          key={r.clientId}
                          className="flex items-center gap-2 px-3 py-1.5 rounded ts-2xs"
                          style={{
                            backgroundColor: r.ok ? "var(--color-success-subtle)" : "var(--color-error-subtle)",
                            color: r.ok ? "var(--color-success)" : "var(--color-error)",
                          }}
                        >
                          {r.ok ? <Check size={11} /> : <X size={11} />}
                          <span>{r.clientName}</span>
                          {r.error && <span className="flex-1 text-right">{r.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    <FolderOpen size={12} />
                    <span className="flex-1" style={{ wordBreak: "break-all" }}>
                      {rootDir ? `읽을 수 있는 폴더: ${rootDir}` : "읽을 수 있는 폴더: 제한 없음"}
                    </span>
                    <button type="button" className="kd-link" onClick={() => void pickFolder().then((d) => d && setRootDir(d))}>폴더 제한</button>
                    {rootDir && <button type="button" className="kd-link" onClick={() => setRootDir("")}>제한 풀기</button>}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleInstall}
                      disabled={installing || selected.size === 0}
                    >
                      {installing ? (
                        <span className="flex items-center gap-1.5"><RefreshCw size={13} className="animate-spin" /> 설치 중...</span>
                      ) : (
                        <span className="flex items-center gap-1.5"><Download size={13} /> {selected.size}개 도구에 설치</span>
                      )}
                    </Button>
                    <button
                      onClick={detect}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg ts-2xs font-medium transition-colors"
                      style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)" }}
                    >
                      <RefreshCw size={11} /> 새로고침
                    </button>
                  </div>

                  <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    설치 후 그 AI 도구를 <strong>재시작</strong>하면 kordoc MCP가 켜집니다.
                  </p>
                </>
              ) : (
                <div className="py-8 text-center ts-xs" style={{ color: "var(--color-error)" }}>
                  환경 감지에 실패했습니다. 다시 시도하세요.
                </div>
              )}
            </div>
          )}

          {/* ── 설정 파일 위치 ── */}
          {tab === "manual" && (
            <div className="space-y-3">
              <p className="ts-xs" style={{ color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                자동 설치는 이 앱에 든 문서 엔진 경로를 아래 설정 파일의 kordoc 항목에 써 넣습니다.
                인터넷이나 따로 깐 Node 없이 돌아갑니다.
              </p>
              <p className="ts-xs" style={{ color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                손으로 고칠 때도 kordoc 항목(command·args·env)은 바꾸지 마세요.
                목록에 없는 AI 도구는 한 도구에 자동 설치한 뒤 그 kordoc 항목과 같은 값을 넣으면 됩니다.
              </p>

              {env ? (
                <div className="space-y-1.5 ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                  <p className="font-semibold" style={{ color: "var(--color-text-secondary)" }}>이 PC의 설정 파일:</p>
                  {env.clients.map((c) => <PathRow key={c.id} label={c.name} path={c.config_path} />)}
                </div>
              ) : !loading && (
                <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>설정 파일 위치를 찾지 못했습니다. 자동 설치 탭에서 새로고침을 눌러 보세요.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="flex items-start gap-2">
      <ChevronRight size={10} className="mt-1 flex-none" style={{ color: "var(--color-text-muted)" }} />
      <span className="font-medium flex-none" style={{ color: "var(--color-text-secondary)", minWidth: 90 }}>{label}</span>
      <code className="font-mono min-w-0" style={{ color: "var(--color-text-muted)", wordBreak: "break-all" }}>{path}</code>
    </div>
  );
}
