/** MCP 설치 다이얼로그 — PC 의 AI 도구에 KorDoc AI MCP(엔진 번들 --mcp, 도구는 '일 시키기'와 같은 목록) 원클릭 등록 */

import { useState, useEffect, useCallback } from "react";
import { Link2, Check, X, FolderOpen, RefreshCw, ChevronRight } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import type { McpEnv } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { pickFolder } from "../../lib/native";
import "./mcp.css";

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
const TABS: { id: Tab; label: string }[] = [
  { id: "auto", label: "자동 연결" },
  { id: "manual", label: "설정 파일 위치" },
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

  // 환경 감지 — 미리 고르지 않는다 (사람이 고른 도구에만 연결). 설치 결과는 지우지 않는다: 실패 까닭이 남아야 한다
  const detect = useCallback(async () => {
    setLoading(true);
    try {
      const result = await rpc("detect_mcp_env", {});
      setEnv(result);
      setSelected((prev) => new Set([...prev].filter((id) => result.clients.some((c) => c.id === id && !c.configured))));
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
      setSelected(new Set());
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
        showToast(`AI 도구 ${result.installed.length}개에 KorDoc AI를 연결했습니다`, "success");
        detect();
      }
      if (result.failed.length > 0) {
        showToast(`${result.failed.length}개 실패: ${result.failed.map((f) => name(f.client)).join(", ")}`, "error");
      }
    } catch (e) {
      showToast(`연결하지 못했습니다: ${errorText(e)}`, "error");
    } finally {
      setInstalling(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────

  // 연결 단추 줄은 대화상자 바닥에 붙여 둔다 (창이 낮아도 본문만 스크롤되고 단추는 늘 보이게)
  const footer = tab === "auto" && env ? (
    <div className="kd-mcp-foot">
      <div className="kd-mcp-acts">
        <Button size="sm" onClick={handleInstall} disabled={installing || selected.size === 0}
          data-tip="고른 AI 도구의 설정 파일에 KorDoc AI 항목을 넣습니다">
          {installing ? <><RefreshCw size={13} className="kd-spin" /> 연결하는 중</> : <><Link2 size={13} /> 선택한 도구에 연결{selected.size ? ` (${selected.size})` : ""}</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setInstallResults(null); void detect(); }} disabled={loading}
          data-tip="이 PC에 깔린 AI 도구와 연결 상태를 다시 찾습니다">
          <RefreshCw size={13} className={loading ? "kd-spin" : undefined} /> 다시 찾기
        </Button>
      </div>
      <p className="kd-mcp-hint">연결한 뒤 그 AI 도구를 <strong>껐다 켜야</strong> 쓸 수 있습니다.</p>
    </div>
  ) : undefined;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI 도구에 KorDoc AI 연결" size="lg" footer={footer}>
      <div className="kd-mcp">
        <p className="kd-mcp-lead">
          Claude Code·Codex·Claude·Cursor·VS Code 같은 AI 도구에서 이 앱의 문서 도구(읽기·공문 쓰기·서식 채우기·점검·가리기·PDF)를 씁니다. 결과는 늘 새 파일이고 원본은 그대로입니다.
        </p>

        <div className="kd-tabs" role="tablist" aria-label="연결 방법">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="kd-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <div className="kd-mcp-body">
          {/* ── 자동 연결 ── */}
          {tab === "auto" && (
            loading && !env ? (
              <div className="kd-mcp-wait"><RefreshCw size={16} className="kd-spin" /> AI 도구를 찾는 중</div>
            ) : env ? (
              <>
                <p className="kd-mcp-hint">연결할 도구를 고르세요.</p>
                <div className="kd-mcp-list">
                  {env.clients.map((client) => {
                    const isSelected = selected.has(client.id);
                    return (
                      <label key={client.id} className="kd-mcp-row" data-on={isSelected} data-absent={!client.installed}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleClient(client.id)} />
                        <span className="kd-mcp-name">{client.name}</span>
                        {client.configured ? (
                          <span className="kd-mcp-state" data-tone="ok"><Check size={12} /> 연결됨</span>
                        ) : client.installed ? (
                          <span className="kd-mcp-state" data-tone="accent">깔려 있음</span>
                        ) : (
                          <span className="kd-mcp-state">이 PC에 없음</span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* 설치 결과 (다시 감지해도 남긴다) */}
                {installResults && (
                  <div className="kd-mcp-list">
                    {installResults.map((r) => (
                      <div key={r.clientId} className="kd-mcp-result" data-ok={r.ok}>
                        {r.ok ? <Check size={12} /> : <X size={12} />}
                        <span>{r.clientName}</span>
                        <span className="kd-mcp-result-msg">{r.ok ? "연결함" : r.error}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="kd-mcp-folder">
                  <FolderOpen size={13} />
                  <span>{rootDir ? `읽을 수 있는 폴더: ${rootDir}` : "읽을 수 있는 폴더: 제한 없음"}</span>
                  <button type="button" className="kd-link kd-small" onClick={() => void pickFolder().then((d) => d && setRootDir(d))}
                    data-tip="AI 도구가 이 폴더 안의 문서만 읽고 쓰게 합니다">폴더 제한</button>
                  {rootDir && <button type="button" className="kd-link kd-small" onClick={() => setRootDir("")}>제한 풀기</button>}
                </div>

              </>
            ) : (
              <div className="kd-mcp-wait" data-tone="err">
                이 PC의 AI 도구를 찾지 못했습니다.
                <Button size="sm" variant="secondary" onClick={() => void detect()} disabled={loading}><RefreshCw size={13} className={loading ? "kd-spin" : undefined} /> 다시 찾기</Button>
              </div>
            )
          )}

          {/* ── 설정 파일 위치 ── */}
          {tab === "manual" && (
            <>
              <p className="kd-mcp-lead">
                자동 연결은 이 앱에 든 문서 엔진 경로를 아래 설정 파일의 kordoc-ai 항목에 써 넣습니다. 인터넷이나 따로 깐 Node 없이 돌아갑니다.
                손으로 고칠 때도 kordoc-ai 항목(command·args·env)은 바꾸지 마세요. 목록에 없는 AI 도구는 한 도구에 자동 연결한 뒤 그 항목과 같은 값을 넣으면 됩니다.
              </p>
              {env ? (
                <div className="kd-mcp-paths">
                  <p className="kd-mcp-paths-title">이 PC의 설정 파일</p>
                  {env.clients.map((c) => <PathRow key={c.id} label={c.name} path={c.config_path} />)}
                </div>
              ) : !loading && (
                <p className="kd-mcp-hint">설정 파일 위치를 찾지 못했습니다. 자동 연결 탭에서 다시 찾기를 누르세요.</p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="kd-mcp-path">
      <ChevronRight size={12} />
      <span className="kd-mcp-path-name">{label}</span>
      <code>{path}</code>
    </div>
  );
}
