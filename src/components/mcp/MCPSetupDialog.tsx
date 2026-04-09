/** MCP 설치 다이얼로그 — AI 도구에 kordoc MCP 원클릭 등록 */

import { useState, useEffect, useCallback } from "react";
import {
  Download, Check, X, AlertTriangle, Copy,
  Terminal, Settings2, Zap, RefreshCw, ChevronRight,
} from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

// ── Types ────────────────────────────────────────────────────────

interface McpClient {
  id: string;
  name: string;
  configPath: string;
  format: string;
  detected: boolean;
  installed: boolean;
}

interface McpEnvInfo {
  nodeInstalled: boolean;
  nodeVersion: string | null;
  npxAvailable: boolean;
  clients: McpClient[];
}

interface InstallResult {
  clientId: string;
  clientName: string;
  ok: boolean;
  error?: string;
}

type Tab = "auto" | "cli" | "manual";

interface MCPSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  showToast: (msg: string, type: "success" | "error" | "info" | "loading") => void;
}

// ── Constants ────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "auto", label: "자동 설치", icon: <Zap size={13} /> },
  { id: "cli", label: "CLI", icon: <Terminal size={13} /> },
  { id: "manual", label: "수동 설정", icon: <Settings2 size={13} /> },
];

const MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "kordoc": {
      "command": "npx",
      "args": ["-y", "kordoc@latest"]
    }
  }
}`;

const ZED_CONFIG_SNIPPET = `{
  "context_servers": {
    "kordoc": {
      "command": {
        "path": "npx",
        "args": ["-y", "kordoc@latest"]
      }
    }
  }
}`;

// ── Component ────────────────────────────────────────────────────

export function MCPSetupDialog({ isOpen, onClose, sidecarCall, showToast }: MCPSetupDialogProps) {
  const [tab, setTab] = useState<Tab>("auto");
  const [env, setEnv] = useState<McpEnvInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);
  const [installResults, setInstallResults] = useState<InstallResult[] | null>(null);
  const [nodeInstalling, setNodeInstalling] = useState(false);

  // 환경 감지
  const detect = useCallback(async () => {
    setLoading(true);
    setInstallResults(null);
    try {
      const result = await sidecarCall("detect_mcp_env") as McpEnvInfo;
      setEnv(result);
      // 감지된 클라이언트 중 미설치인 것 자동 선택
      const autoSelect = new Set(
        result.clients
          .filter((c) => c.detected && !c.installed)
          .map((c) => c.id),
      );
      setSelected(autoSelect);
    } catch (err) {
      // detect_mcp_env failed — env remains null, UI shows error state
      setEnv(null);
    } finally {
      setLoading(false);
    }
  }, [sidecarCall]);

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

  // MCP 설치
  const handleInstall = async () => {
    if (selected.size === 0) return;
    setInstalling(true);
    setInstallResults(null);
    try {
      const result = await sidecarCall("install_mcp_config", {
        client_ids: [...selected],
      }) as { success: boolean; results: InstallResult[] };
      setInstallResults(result.results);
      const okCount = result.results.filter((r) => r.ok).length;
      if (okCount > 0) {
        showToast(`${okCount}개 AI 도구에 kordoc MCP 등록 완료`, "success");
        // 환경 재감지
        detect();
      }
      if (!result.success) {
        const fails = result.results.filter((r) => !r.ok);
        showToast(`${fails.length}개 실패: ${fails.map((f) => f.clientName).join(", ")}`, "error");
      }
    } catch (e) {
      showToast(`설치 실패: ${e}`, "error");
    } finally {
      setInstalling(false);
    }
  };

  // Node.js 설치
  const handleInstallNode = async () => {
    setNodeInstalling(true);
    try {
      const result = await sidecarCall("install_node") as { started: boolean; method: string; error?: string };
      if (result.started) {
        if (result.method === "winget") {
          showToast("winget으로 Node.js 설치 시작됨. 완료 후 새로고침하세요.", "info");
        } else {
          showToast("Node.js 다운로드 페이지가 열렸습니다.", "info");
        }
      } else {
        showToast(result.error ?? "수동 설치: nodejs.org", "info");
      }
    } catch (e) {
      showToast(`Node.js 설치 실패: ${e}`, "error");
    } finally {
      setNodeInstalling(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => showToast("클립보드에 복사됨", "success"));
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

        {/* Node.js 상태 */}
        {!loading && env && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3 ts-2xs"
            style={{
              backgroundColor: env.npxAvailable ? "var(--color-success-subtle)" : "var(--color-warning-subtle)",
              color: env.npxAvailable ? "var(--color-success)" : "var(--color-warning)",
            }}
          >
            {env.npxAvailable ? (
              <>
                <Check size={13} />
                <span>Node.js {env.nodeVersion} 감지됨</span>
              </>
            ) : (
              <>
                <AlertTriangle size={13} />
                <span className="flex-1">Node.js 미설치 — MCP 서버 실행에 필요합니다</span>
                <button
                  onClick={handleInstallNode}
                  disabled={nodeInstalling}
                  className="flex items-center gap-1 px-2 py-0.5 rounded font-semibold transition-colors"
                  style={{
                    backgroundColor: "var(--color-warning)",
                    color: "white",
                    opacity: nodeInstalling ? 0.6 : 1,
                  }}
                >
                  {nodeInstalling ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />}
                  설치하기
                </button>
              </>
            )}
          </div>
        )}

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
                            opacity: client.installed ? 0.6 : 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleClient(client.id)}
                            disabled={client.installed}
                            className="accent-[var(--color-accent)] w-3.5 h-3.5"
                          />
                          <span className="ts-xs font-medium flex-1" style={{ color: "var(--color-text-primary)" }}>
                            {client.name}
                          </span>
                          {client.installed ? (
                            <span className="flex items-center gap-1 ts-2xs font-medium" style={{ color: "var(--color-success)" }}>
                              <Check size={11} /> 설치됨
                            </span>
                          ) : client.detected ? (
                            <span className="ts-2xs" style={{ color: "var(--color-accent)" }}>감지됨</span>
                          ) : (
                            <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>미감지</span>
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

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleInstall}
                      disabled={installing || selected.size === 0 || !env.npxAvailable}
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

                  {!env.npxAvailable && (
                    <p className="ts-2xs" style={{ color: "var(--color-warning)" }}>
                      Node.js를 먼저 설치해야 자동 설치를 사용할 수 있습니다.
                    </p>
                  )}

                  <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    설치 후 해당 AI 도구를 <strong>재시작</strong>하면 kordoc MCP가 활성화됩니다.
                  </p>
                </>
              ) : (
                <div className="py-8 text-center ts-xs" style={{ color: "var(--color-error)" }}>
                  환경 감지 실패. 다시 시도해주세요.
                </div>
              )}
            </div>
          )}

          {/* ── CLI ── */}
          {tab === "cli" && (
            <div className="space-y-3">
              <p className="ts-xs" style={{ color: "var(--color-text-secondary)" }}>
                터미널에서 직접 kordoc MCP를 실행하거나 설치할 수 있습니다.
              </p>

              <div className="space-y-2">
                <CliBlock
                  label="MCP 서버 실행 (1회성)"
                  command="npx -y kordoc@latest"
                  desc="Claude Desktop 등에서 자동 실행됩니다. 수동 실행은 테스트용."
                  onCopy={copyToClipboard}
                />
                <CliBlock
                  label="전역 설치"
                  command="npm install -g kordoc"
                  desc="설치 후 kordoc-mcp 명령으로 서버를 실행할 수 있습니다."
                  onCopy={copyToClipboard}
                />
                <CliBlock
                  label="CLI 파서 사용"
                  command="kordoc parse document.hwp"
                  desc="터미널에서 직접 문서를 마크다운으로 변환합니다."
                  onCopy={copyToClipboard}
                />
              </div>
            </div>
          )}

          {/* ── 수동 설정 ── */}
          {tab === "manual" && (
            <div className="space-y-3">
              <p className="ts-xs" style={{ color: "var(--color-text-secondary)" }}>
                AI 도구의 설정 파일에 아래 JSON을 추가하세요.
              </p>

              <ConfigBlock
                label="Claude Desktop / Cursor / Windsurf / Gemini CLI"
                config={MCP_CONFIG_SNIPPET}
                onCopy={copyToClipboard}
              />

              <ConfigBlock
                label="Zed"
                config={ZED_CONFIG_SNIPPET}
                onCopy={copyToClipboard}
              />

              <div className="space-y-1.5 ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                <p className="font-semibold" style={{ color: "var(--color-text-secondary)" }}>설정 파일 위치:</p>
                <PathRow label="Claude Desktop" path="~/AppData/Roaming/Claude/claude_desktop_config.json" />
                <PathRow label="Cursor" path="~/.cursor/mcp.json" />
                <PathRow label="Windsurf" path="~/.codeium/windsurf/mcp_config.json" />
                <PathRow label="Gemini CLI" path="~/.gemini/settings.json" />
                <PathRow label="Zed" path="~/.zed/settings.json" />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function CliBlock({ label, command, desc, onCopy }: {
  label: string; command: string; desc: string; onCopy: (t: string) => void;
}) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
        <span className="ts-2xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: "var(--color-bg-primary)" }}>
        <code className="ts-xs flex-1 font-mono" style={{ color: "var(--color-accent)" }}>{command}</code>
        <button
          onClick={() => onCopy(command)}
          className="p-1 rounded hover-bg-tertiary shrink-0"
          title="복사"
        >
          <Copy size={13} style={{ color: "var(--color-text-muted)" }} />
        </button>
      </div>
      <div className="px-3 py-1.5 ts-2xs" style={{ color: "var(--color-text-muted)", borderTop: "1px solid var(--color-border-subtle)" }}>
        {desc}
      </div>
    </div>
  );
}

function ConfigBlock({ label, config, onCopy }: {
  label: string; config: string; onCopy: (t: string) => void;
}) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
        <span className="ts-2xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>{label}</span>
        <button
          onClick={() => onCopy(config)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded ts-2xs font-medium hover-bg-tertiary"
          style={{ color: "var(--color-text-muted)" }}
        >
          <Copy size={11} /> 복사
        </button>
      </div>
      <pre
        className="px-3 py-2 ts-2xs font-mono overflow-x-auto"
        style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-text-primary)", margin: 0 }}
      >
        {config}
      </pre>
    </div>
  );
}

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="flex items-center gap-2">
      <ChevronRight size={10} style={{ color: "var(--color-text-muted)" }} />
      <span className="font-medium" style={{ color: "var(--color-text-secondary)", minWidth: 90 }}>{label}</span>
      <code className="font-mono" style={{ color: "var(--color-text-muted)" }}>{path}</code>
    </div>
  );
}
