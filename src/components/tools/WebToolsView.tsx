import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Globe, School, Building2, MapPin, Users, Landmark,
  Calculator, Map, Play, Loader2, CheckCircle, AlertTriangle,
  ExternalLink, Copy, FolderOpen, FileText,
  LogIn, RefreshCw, Download, ClipboardList, Terminal,
  BookOpen, Layers, BarChart2, XCircle, Trash2,
} from "lucide-react";
import { Button } from "../ui/Button";
import { ToolResult, getDataOnly } from "./renderers";
import { ReportView, generateReport } from "./ReportView";
import type { ToolDef, ToolState, CollectionEntry, CollectionStatus, MetaInfo, SiteContext } from "./types";

// ─── Props ───

interface WebToolsViewProps {
  sidecarReady: boolean;
  onRunTool: (tool: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
}

// ─── Tool Definitions ───

function toolBg(color: string): string {
  return `color-mix(in srgb, ${color} 8%, var(--color-bg-secondary))`;
}

const TOOLS: ToolDef[] = [
  {
    id: "schoolinfo", name: "학교알리미", desc: "학교 공시정보 자동 수집",
    icon: <School size={18} />, color: "#2563EB", bg: toolBg("#2563EB"),
    site: "schoolinfo.go.kr", group: "school",
    fields: [{ key: "school_name", label: "학교명", placeholder: "예: 광남고등학교", required: true, contextKey: "schoolName" }],
  },
  {
    id: "school_zone", name: "학구도", desc: "학구도 + 지도 캡처",
    icon: <Map size={18} />, color: "#6D28D9", bg: toolBg("#6D28D9"),
    site: "schoolzone.emac.kr", group: "school",
    fields: [{ key: "address", label: "학교명/주소", placeholder: "예: 광남고등학교", required: true, contextKey: "schoolName" }],
  },
  {
    id: "building_info", name: "세움터", desc: "건축물대장 정보 조회",
    icon: <Building2 size={18} />, color: "#7C3AED", bg: toolBg("#7C3AED"),
    site: "eais.go.kr", needsAuth: true, group: "site",
    fields: [{ key: "query", label: "주소/건물명", placeholder: "예: 서울 광진구 아차산로 200", required: true, contextKey: "address" }],
  },
  {
    id: "land_info", name: "토지이음", desc: "토지 이용계획 조회",
    icon: <MapPin size={18} />, color: "#059669", bg: toolBg("#059669"),
    site: "eum.go.kr", group: "site",
    fields: [{ key: "address", label: "주소", placeholder: "예: 서울 광진구 군자동 98", required: true, contextKey: "address" }],
  },
  {
    id: "population", name: "학령인구", desc: "지역별 연령별 인구현황",
    icon: <Users size={18} />, color: "#D97706", bg: toolBg("#D97706"),
    site: "jumin.mois.go.kr", group: "region",
    fields: [{ key: "region", label: "지역", placeholder: "예: 서울특별시 광진구", required: true, contextKey: "region" }],
  },
  {
    id: "heritage", name: "국가유산", desc: "국가유산 존재여부 확인",
    icon: <Landmark size={18} />, color: "#DC2626", bg: toolBg("#DC2626"),
    site: "gis-heritage.go.kr", group: "region",
    fields: [{ key: "location", label: "위치", placeholder: "예: 서울특별시 광진구", required: true, contextKey: "region" }],
  },
  {
    id: "design_fee", name: "설계대가", desc: "건축사 설계대가 산출",
    icon: <Calculator size={18} />, color: "#0284C7", bg: toolBg("#0284C7"),
    site: "kirahub.kira.or.kr", needsAuth: true, group: "calc",
    fields: [{ key: "pay", label: "공사비 (원)", placeholder: "예: 5000000000", required: true }],
  },
];

type GroupId = "school" | "site" | "region" | "calc";
const GROUPS: { id: GroupId; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "school", label: "학교 정보", icon: <BookOpen size={14} />, color: "#2563EB" },
  { id: "site",   label: "부지 분석", icon: <Layers size={14} />,   color: "#7C3AED" },
  { id: "region", label: "지역 현황", icon: <BarChart2 size={14} />, color: "#D97706" },
  { id: "calc",   label: "산출",     icon: <Calculator size={14} />, color: "#0284C7" },
];

// ─── Utility ───

function getMeta(result: Record<string, unknown>): MetaInfo {
  return (result._meta as MetaInfo) ?? {};
}

async function openFile(path: string) {
  try {
    await invoke("sidecar_call", { method: "open_file", params: { path } });
  } catch { /* non-critical */ }
}

async function openFolder(path: string) {
  try {
    await invoke("sidecar_call", { method: "open_folder", params: { path } });
  } catch { /* non-critical */ }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function formatResultAsText(data: Record<string, unknown>, indent = ""): string {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (key.startsWith("_")) continue;
    if (val === null || val === undefined || val === "") continue;
    // base64 이미지 등 대형 데이터 제외 (복사에 불필요)
    if (typeof val === "string" && val.startsWith("data:")) continue;
    if (Array.isArray(val)) {
      lines.push(`${indent}${key}:`);
      for (const item of val) {
        if (typeof item === "object" && item !== null) {
          lines.push(formatResultAsText(item as Record<string, unknown>, indent + "  "));
        } else {
          lines.push(`${indent}  - ${item}`);
        }
      }
    } else if (typeof val === "object") {
      lines.push(`${indent}${key}:`);
      lines.push(formatResultAsText(val as Record<string, unknown>, indent + "  "));
    } else {
      lines.push(`${indent}${key}: ${val}`);
    }
  }
  return lines.join("\n");
}

function getResultStatus(result?: Record<string, unknown>): CollectionStatus {
  if (!result) return "success";
  if (result.로그인_필요) return "auth_required";
  if (result.성공 === false) return "failure";
  return "success";
}

// ─── LocalStorage 영속성 ───

const STORAGE_KEY = "eduplan-tool-collections";

function loadCollections(): CollectionEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCollections(entries: CollectionEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* quota exceeded — non-critical */ }
}

// ─── Main Component ───

export function WebToolsView({ sidecarReady, onRunTool }: WebToolsViewProps) {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [toolStates, setToolStates] = useState<Record<string, ToolState>>({});
  const [copiedTools, setCopiedTools] = useState<Record<string, boolean>>({});
  const [collections, setCollections] = useState<CollectionEntry[]>(loadCollections);
  const [showReport, setShowReport] = useState(false);
  useEffect(() => { saveCollections(collections); }, [collections]);
  const [reportCopied, setReportCopied] = useState(false);
  const [reportSaving, setReportSaving] = useState(false);
  const [runningLog, setRunningLog] = useState<string>("");
  const [siteContext, setSiteContext] = useState<SiteContext>({ schoolName: "", address: "", region: "" });
  const toolStatesRef = useRef(toolStates);
  toolStatesRef.current = toolStates;

  // Listen for sidecar log and progress events
  useEffect(() => {
    const u1 = listen<string>("sidecar:log", (e) => {
      const line = e.payload ?? "";
      if (line.includes("[browser.") || line.includes("[sidecar]") || line.includes("[sidecar.")) {
        setRunningLog(line.replace(/^\d{2}:\d{2}:\d{2}\s*/, "").trim());
      }
    });
    const u2 = listen<{ message?: string }>("pipeline:progress", (e) => {
      if (e.payload?.message) setRunningLog(e.payload.message);
    });
    return () => { u1.then((f) => f()); u2.then((f) => f()); };
  }, []);

  const getState = (id: string): ToolState =>
    toolStates[id] ?? { status: "idle", inputs: {} };

  const updateInput = useCallback((toolId: string, key: string, value: string) => {
    setToolStates((prev) => ({
      ...prev,
      [toolId]: {
        ...prev[toolId] ?? { status: "idle", inputs: {} },
        inputs: { ...(prev[toolId]?.inputs ?? {}), [key]: value },
      },
    }));
  }, []);

  // SiteContext 변경 → 해당 contextKey를 가진 도구 입력들 자동 채움
  const updateSiteContext = useCallback((field: keyof SiteContext, value: string) => {
    setSiteContext((prev) => ({ ...prev, [field]: value }));
    setToolStates((prev) => {
      const next = { ...prev };
      for (const tool of TOOLS) {
        for (const f of tool.fields) {
          if (f.contextKey === field) {
            const cur = next[tool.id] ?? { status: "idle" as const, inputs: {} };
            next[tool.id] = { ...cur, inputs: { ...cur.inputs, [f.key]: value } };
          }
        }
      }
      return next;
    });
  }, []);

  const runTool = useCallback(async (toolId: string, extraParams?: Record<string, string>) => {
    // 이미 실행 중이면 중복 호출 방지 (call_lock 대기로 인한 hang 예방)
    if (toolStatesRef.current[toolId]?.status === "running") return;
    // Ref를 즉시 "running"으로 마킹 — setToolStates는 비동기라 리렌더 전까지
    // ref가 업데이트 안 되어 레이스 컨디션으로 중복 호출 발생하는 것을 방지
    const prevState = toolStatesRef.current[toolId] ?? { status: "idle", inputs: {} };
    toolStatesRef.current = {
      ...toolStatesRef.current,
      [toolId]: { ...prevState, status: "running", error: undefined, result: undefined },
    };
    setRunningLog("수집 준비 중...");
    setToolStates((prev) => {
      const state = prev[toolId] ?? { status: "idle", inputs: {} };
      return {
        ...prev,
        [toolId]: { ...state, status: "running", error: undefined, result: undefined },
      };
    });

    try {
      const currentInputs = { ...(toolStatesRef.current[toolId]?.inputs ?? {}), ...extraParams };
      const result = await onRunTool(toolId, currentInputs);
      const now = new Date().toISOString();
      const resultStatus = getResultStatus(result);
      setToolStates((prev) => ({
        ...prev,
        [toolId]: { ...prev[toolId]!, status: "done", result, completedAt: now },
      }));
      const toolDef = TOOLS.find((t) => t.id === toolId);
      if (toolDef) {
        setCollections((prev) => [...prev, {
          toolId,
          toolName: toolDef.name,
          inputs: { ...currentInputs },
          result,
          completedAt: now,
          status: resultStatus,
        }]);
      }
    } catch (e) {
      setToolStates((prev) => ({
        ...prev,
        [toolId]: { ...prev[toolId]!, status: "error", error: String(e) },
      }));
    }
  }, [onRunTool]);

  const handleCopy = useCallback(async (toolId: string, data: Record<string, unknown>) => {
    const text = formatResultAsText(getDataOnly(data));
    await copyToClipboard(text);
    setCopiedTools((prev) => ({ ...prev, [toolId]: true }));
    setTimeout(() => setCopiedTools((prev) => ({ ...prev, [toolId]: false })), 2000);
  }, []);

  const reportMarkdown = useMemo(() => generateReport(collections, TOOLS), [collections]);

  const handleCopyReport = useCallback(async () => {
    await copyToClipboard(reportMarkdown);
    setReportCopied(true);
    setTimeout(() => setReportCopied(false), 2000);
  }, [reportMarkdown]);

  const handleSaveReport = useCallback(async () => {
    setReportSaving(true);
    try {
      await invoke("sidecar_call", {
        method: "save_report",
        params: { content: reportMarkdown, filename: `수집리포트_${new Date().toISOString().slice(0, 10)}.md` },
      });
    } catch {
      await copyToClipboard(reportMarkdown);
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    } finally {
      setReportSaving(false);
    }
  }, [reportMarkdown]);

  const resetAll = useCallback(() => {
    setToolStates({});
    setCollections([]);
    setCopiedTools({});
    setSiteContext({ schoolName: "", address: "", region: "" });
    setShowReport(false);
    setRunningLog("");
    setSelectedTool(null);
  }, []);

  const completedCount = collections.length;
  const activeTool = TOOLS.find((t) => t.id === selectedTool);
  const activeState = selectedTool ? getState(selectedTool) : null;
  const isCopied = selectedTool ? copiedTools[selectedTool] ?? false : false;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header + SiteContext 패널 */}
      <div className="px-6 pt-5 pb-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Globe size={18} style={{ color: "var(--color-accent)" }} />
          <h2 className="ts-md font-bold" style={{ color: "var(--color-text-primary)" }}>자료 수집 도구</h2>
        </div>
        {/* 현장 입력 패널 */}
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { field: "schoolName" as const, label: "학교명", placeholder: "예: 광장중학교" },
              { field: "address" as const,    label: "부지 주소", placeholder: "예: 광진구 광장로1길 1" },
              { field: "region" as const,     label: "지역", placeholder: "예: 서울특별시 광진구" },
            ] as const
          ).map(({ field, label, placeholder }) => (
            <div key={field}>
              <label className="ts-2xs font-medium mb-0.5 block" style={{ color: "var(--color-text-muted)" }}>
                {label}
              </label>
              <input
                type="text"
                value={siteContext[field]}
                onChange={(e) => updateSiteContext(field, e.target.value)}
                placeholder={placeholder}
                className="input-modern w-full rounded-md px-2.5 py-1.5 ts-2xs"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden tools-layout">
        {/* Tool List — 그룹화 */}
        <GroupedToolList
          tools={TOOLS}
          groups={GROUPS}
          getState={getState}
          selectedTool={selectedTool}
          showReport={showReport}
          completedCount={completedCount}
          onSelectTool={(id) => { setSelectedTool(id); setShowReport(false); }}
          onShowReport={() => setShowReport(true)}
          onResetAll={resetAll}
          onRunGroup={(groupId) => {
            const groupTools = TOOLS.filter((t) => t.group === groupId);
            groupTools.forEach((t) => {
              if (getState(t.id).status !== "running") runTool(t.id);
            });
          }}
        />

        {/* Detail Panel */}
        <div
          className="flex-1 overflow-y-auto border-l px-6 py-4 tools-detail"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-secondary)" }}
        >
          {showReport ? (
            <ReportView
              collections={collections}
              tools={TOOLS}
              reportMarkdown={reportMarkdown}
              onCopyReport={handleCopyReport}
              reportCopied={reportCopied}
              onSaveReport={handleSaveReport}
              reportSaving={reportSaving}
              onClear={() => { setCollections([]); setShowReport(false); }}
            />
          ) : !activeTool ? (
            <EmptyState />
          ) : (
            <ToolDetail
              tool={activeTool}
              state={activeState ?? { status: "idle", inputs: {} }}
              sidecarReady={sidecarReady}
              copied={isCopied}
              runningLog={runningLog}
              onRun={(extra) => runTool(activeTool.id, extra)}
              onCancel={async () => {
                try {
                  await invoke("sidecar_call", { method: "cancel", params: {} });
                } catch { /* non-critical */ }
                setToolStates((prev) => ({
                  ...prev,
                  [activeTool.id]: { ...prev[activeTool.id]!, status: "error", error: "사용자에 의해 취소되었습니다" },
                }));
              }}
              onUpdateInput={(key, value) => updateInput(activeTool.id, key, value)}
              onCopy={() => { if (activeState?.result) handleCopy(activeTool.id, activeState.result); }}
              onRerun={(params) => runTool(activeTool.id, params)}
              onReset={() => {
                setToolStates((prev) => {
                  const next = { ...prev };
                  delete next[activeTool.id];
                  return next;
                });
                // collections에서도 제거
                setCollections((prev) => prev.filter((c) => c.toolId !== activeTool.id));
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Grouped Tool List (Left Panel) ───

function ToolButton({ tool, state, isSelected, onSelect }: {
  tool: ToolDef; state: ToolState; isSelected: boolean; onSelect: () => void;
}) {
  const resultStatus = state.status === "done" ? getResultStatus(state.result) : null;
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
      style={{
        backgroundColor: isSelected ? "var(--color-bg-secondary)" : "transparent",
        border: `1.5px solid ${isSelected ? "var(--color-border-hover)" : "var(--color-border)"}`,
        boxShadow: isSelected ? "var(--shadow-card)" : "none",
      }}
    >
      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: tool.bg, color: tool.color }}>
        {tool.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>{tool.name}</span>
          {tool.needsAuth && <LogIn size={10} style={{ color: "var(--color-warning, #D97706)" }} />}
          {state.status === "done" && resultStatus === "success" && (
            <CheckCircle size={11} style={{ color: "var(--color-success)" }} />
          )}
          {state.status === "done" && resultStatus === "auth_required" && (
            <LogIn size={11} style={{ color: "var(--color-warning, #D97706)" }} />
          )}
          {state.status === "done" && resultStatus === "failure" && (
            <AlertTriangle size={11} style={{ color: "var(--color-error)" }} />
          )}
          {state.status === "running" && <Loader2 size={11} className="animate-spin" style={{ color: "var(--color-accent)" }} />}
          {state.status === "error" && <AlertTriangle size={11} style={{ color: "var(--color-error)" }} />}
        </div>
        <span className="ts-2xs truncate block" style={{ color: "var(--color-text-muted)" }}>{tool.desc}</span>
      </div>
    </button>
  );
}

function GroupedToolList({ tools, groups, getState, selectedTool, showReport, completedCount, onSelectTool, onShowReport, onResetAll, onRunGroup }: {
  tools: ToolDef[];
  groups: typeof GROUPS;
  getState: (id: string) => ToolState;
  selectedTool: string | null;
  showReport: boolean;
  completedCount: number;
  onSelectTool: (id: string) => void;
  onShowReport: () => void;
  onResetAll: () => void;
  onRunGroup: (groupId: GroupId) => void;
}) {
  return (
    <div className="w-[280px] shrink-0 overflow-y-auto px-4 py-3 tools-list space-y-3">
      {groups.map((group) => {
        const groupTools = tools.filter((t) => t.group === group.id);
        const anyRunning = groupTools.some((t) => getState(t.id).status === "running");
        const doneCount = groupTools.filter((t) => getState(t.id).status === "done").length;
        return (
          <div key={group.id}>
            {/* 그룹 헤더 */}
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <div className="flex items-center gap-1.5">
                <span style={{ color: group.color }}>{group.icon}</span>
                <span className="ts-2xs font-bold" style={{ color: "var(--color-text-secondary)" }}>
                  {group.label}
                </span>
                {doneCount > 0 && (
                  <span className="ts-2xs px-1 rounded-sm font-bold"
                    style={{ backgroundColor: "var(--color-success-bg, #D1FAE5)", color: "var(--color-success)" }}>
                    {doneCount}/{groupTools.length}
                  </span>
                )}
              </div>
              <button
                onClick={() => onRunGroup(group.id)}
                disabled={anyRunning}
                className="flex items-center gap-1 px-2 py-0.5 rounded ts-2xs font-medium transition-opacity disabled:opacity-40"
                style={{ backgroundColor: `color-mix(in srgb, ${group.color} 12%, var(--color-bg-secondary))`, color: group.color }}
                title="그룹 전체 실행"
              >
                {anyRunning ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                전체
              </button>
            </div>
            {/* 도구 목록 */}
            <div className="space-y-1">
              {groupTools.map((tool) => (
                <ToolButton
                  key={tool.id}
                  tool={tool}
                  state={getState(tool.id)}
                  isSelected={selectedTool === tool.id && !showReport}
                  onSelect={() => onSelectTool(tool.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* 수집 내역 + 초기화 */}
      {completedCount > 0 && (
        <div className="pt-3 space-y-1.5" style={{ borderTop: "1px solid var(--color-border)" }}>
          <button
            onClick={onShowReport}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left"
            style={{
              backgroundColor: showReport ? "var(--color-bg-secondary)" : "transparent",
              border: `1.5px solid ${showReport ? "var(--color-accent)" : "var(--color-border)"}`,
            }}
          >
            <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, var(--color-bg-secondary))", color: "var(--color-accent)" }}>
              <ClipboardList size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>수집 내역</span>
                <span className="px-1.5 py-0.5 rounded-full ts-2xs font-bold"
                  style={{ backgroundColor: "var(--color-accent)", color: "white" }}>
                  {completedCount}
                </span>
              </div>
              <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>통합 리포트 생성</span>
            </div>
          </button>
          <button
            onClick={onResetAll}
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg ts-2xs font-medium transition-colors"
            style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-error)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--color-error)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"; }}
          >
            <Trash2 size={11} /> 전체 초기화
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Empty State ───

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 select-none">
      <div className="relative">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: "var(--color-accent-subtle)" }}
        >
          <Globe size={36} style={{ color: "var(--color-accent)", opacity: 0.6 }} />
        </div>
        <div
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center ts-2xs font-bold"
          style={{ backgroundColor: "var(--color-accent)", color: "white" }}
        >
          {TOOLS.length}
        </div>
      </div>
      <div className="text-center">
        <p className="ts-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
          도구를 선택하세요
        </p>
        <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)", maxWidth: 240, wordBreak: "keep-all" }}>
          좌측 목록에서 수집할 자료 유형을 선택하면 자동으로 공공데이터를 가져옵니다
        </p>
      </div>
    </div>
  );
}

// ─── Tool Detail (Right Panel) ───

function ToolDetail({ tool, state, sidecarReady, copied, runningLog, onRun, onCancel, onUpdateInput, onCopy, onRerun, onReset }: {
  tool: ToolDef;
  state: ToolState;
  sidecarReady: boolean;
  copied: boolean;
  runningLog: string;
  onRun: (extra?: Record<string, string>) => void;
  onCancel: () => void;
  onUpdateInput: (key: string, value: string) => void;
  onCopy: () => void;
  onRerun?: (params: Record<string, string>) => void;
  onReset: () => void;
}) {
  const resultStatus = state.result ? getResultStatus(state.result) : null;
  return (
    <div className="animate-fade-in max-w-2xl">
      {/* Tool Header */}
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: tool.bg, color: tool.color }}
        >
          {tool.icon}
        </div>
        <div>
          <h3 className="ts-md font-bold" style={{ color: "var(--color-text-primary)" }}>
            {tool.name}
          </h3>
          <p className="ts-2xs flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
            <ExternalLink size={10} /> {tool.site}
            {tool.needsAuth && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ backgroundColor: "var(--color-warning-bg, #FEF3C7)", color: "var(--color-warning, #92400E)" }}>
                로그인 필요
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Input Fields */}
      <div className="space-y-3 mb-5">
        {tool.fields.map((field) => (
          <div key={field.key}>
            <label className="ts-xs font-medium mb-1 block" style={{ color: "var(--color-text-secondary)" }}>
              {field.label} {field.required && <span style={{ color: "var(--color-error)" }}>*</span>}
            </label>
            <input
              type="text"
              value={state.inputs[field.key] ?? ""}
              onChange={(e) => onUpdateInput(field.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && state.status !== "running") {
                  onRun();
                }
              }}
              placeholder={field.placeholder}
              className="input-modern w-full rounded-lg px-3 py-2.5 ts-sm"
              disabled={state.status === "running"}
            />
          </div>
        ))}
      </div>

      {/* Run / Cancel Buttons */}
      <div className="flex items-center gap-2">
        <Button
          size="lg"
          onClick={() => onRun()}
          disabled={!sidecarReady || state.status === "running"}
          isLoading={state.status === "running"}
        >
          <span className="flex items-center gap-2">
            <Play size={15} /> 수집 시작
          </span>
        </Button>
        {state.status === "running" && (
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg ts-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-error-bg)",
              color: "var(--color-error)",
              border: "1.5px solid var(--color-error)",
            }}
          >
            <XCircle size={15} /> 취소
          </button>
        )}
      </div>

      {/* Running log */}
      {state.status === "running" && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
          <Terminal size={13} style={{ color: "var(--color-accent)", marginTop: 1, flexShrink: 0 }} />
          <span className="ts-2xs font-mono" style={{ color: "var(--color-text-secondary)", wordBreak: "break-all" }}>
            {runningLog || "수집 중..."}
          </span>
        </div>
      )}

      {/* Result */}
      {state.status === "done" && state.result && (
        <div className="mt-6">
          {resultStatus === "auth_required" ? (
            <LoginRequiredCard
              result={state.result}
              onRetryWithLogin={() => onRun({ headed: "true" })}
            />
          ) : resultStatus === "failure" ? (
            <>
              <FailedResultCard
                result={state.result}
                onRetry={() => onRun()}
              />
              <SavedFiles meta={getMeta(state.result)} />
            </>
          ) : (
            <>
              <ResultHeader
                result={state.result}
                onCopy={onCopy}
                copied={copied}
                onReset={onReset}
              />
              <ToolResult toolId={tool.id} data={state.result} onRerun={onRerun} />
              <SavedFiles meta={getMeta(state.result)} />
            </>
          )}
        </div>
      )}

      {/* Error */}
      {state.status === "error" && (
        <div className="mt-5 p-3 rounded-lg" style={{ backgroundColor: "var(--color-error-bg)" }}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} style={{ color: "var(--color-error)" }} />
            <span className="ts-sm font-semibold" style={{ color: "var(--color-error)" }}>오류 발생</span>
          </div>
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>{state.error}</p>
          <Button size="sm" onClick={() => onRun()} className="mt-2">
            <span className="flex items-center gap-1"><RefreshCw size={12} /> 다시 시도</span>
          </Button>
        </div>
      )}
    </div>
  );
}

function FailedResultCard({ result, onRetry }: {
  result: Record<string, unknown>;
  onRetry: () => void;
}) {
  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: "var(--color-error-bg)", border: "1px solid var(--color-error)" }}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={16} style={{ color: "var(--color-error)" }} />
        <span className="ts-sm font-semibold" style={{ color: "var(--color-error)" }}>
          수집 실패
        </span>
      </div>
      <p className="ts-2xs mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
        {String(result.오류 || result.안내 || "수집은 완료되었으나 데이터를 추출하지 못했습니다.")}
      </p>
      <Button size="sm" onClick={onRetry}>
        <span className="flex items-center gap-1">
          <RefreshCw size={12} /> 다시 시도
        </span>
      </Button>
    </div>
  );
}

// ─── Result Header ───

function ResultHeader({ result, onCopy, copied, onReset }: {
  result: Record<string, unknown>;
  onCopy: () => void;
  copied: boolean;
  onReset: () => void;
}) {
  const meta = getMeta(result);
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <CheckCircle size={14} style={{ color: "var(--color-success)" }} />
        <span className="ts-sm font-semibold" style={{ color: "var(--color-success)" }}>수집 완료</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onCopy}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md ts-2xs font-medium transition-colors"
          style={{
            backgroundColor: copied ? "var(--color-success-bg, #D1FAE5)" : "var(--color-bg-tertiary)",
            color: copied ? "var(--color-success)" : "var(--color-text-secondary)",
          }}
          title="결과 복사"
        >
          <Copy size={12} /> {copied ? "복사됨" : "복사"}
        </button>
        {meta.saved_files && meta.saved_files.length > 0 && (
          <button
            onClick={() => {
              const mdFile = meta.saved_files!.find((f) => /\.md$/i.test(f));
              const fallback = meta.saved_files!.find((f) => /\.(txt|csv)$/i.test(f));
              openFile(mdFile ?? fallback ?? meta.saved_files![0]);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md ts-2xs font-medium"
            style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
            title="결과 파일 열기"
          >
            <FileText size={12} /> 파일 열기
          </button>
        )}
        {meta.output_dir && (
          <button
            onClick={() => openFolder(meta.output_dir!)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md ts-2xs font-medium"
            style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
            title="저장 폴더 열기"
          >
            <FolderOpen size={12} /> 폴더
          </button>
        )}
        <button
          onClick={onReset}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md ts-2xs font-medium transition-colors"
          style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)" }}
          title="이 도구 결과 초기화"
        >
          <Trash2 size={12} /> 초기화
        </button>
      </div>
    </div>
  );
}

// ─── Login Required Card ───

function LoginRequiredCard({ result, onRetryWithLogin }: {
  result: Record<string, unknown>;
  onRetryWithLogin: () => void;
}) {
  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: "var(--color-warning-bg, #FEF3C7)", border: "1px solid var(--color-warning, #F59E0B)" }}>
      <div className="flex items-center gap-2 mb-2">
        <LogIn size={16} style={{ color: "var(--color-warning, #92400E)" }} />
        <span className="ts-sm font-semibold" style={{ color: "var(--color-warning, #92400E)" }}>
          로그인이 필요합니다
        </span>
      </div>
      <p className="ts-2xs mb-3" style={{ color: "var(--color-text-secondary)" }}>
        {String(result.안내 || "이 도구는 로그인이 필요합니다. 아래 버튼을 누르면 브라우저가 열리고, 로그인 후 자동으로 수집됩니다.")}
      </p>
      <Button size="sm" onClick={onRetryWithLogin}>
        <span className="flex items-center gap-2">
          <LogIn size={14} /> 로그인 후 수집
        </span>
      </Button>
    </div>
  );
}

// ─── Saved Files List ───

function SavedFiles({ meta }: { meta: MetaInfo }) {
  if (!meta.saved_files || meta.saved_files.length === 0) return null;

  return (
    <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
      <div className="flex items-center gap-1.5 mb-2">
        <Download size={12} style={{ color: "var(--color-text-muted)" }} />
        <span className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>저장된 파일</span>
      </div>
      <div className="space-y-1">
        {meta.saved_files.map((file, i) => {
          const filename = file.split(/[/\\]/).pop() || file;
          const ext = filename.split(".").pop()?.toUpperCase() || "";
          return (
            <button
              key={i}
              onClick={() => openFile(file)}
              className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors hover:opacity-80"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              title={file}
            >
              <span className="ts-2xs px-1.5 py-0.5 rounded font-mono font-bold"
                style={{
                  backgroundColor: ext === "JSON" ? "#DBEAFE" : ext === "TXT" ? "#D1FAE5" : ext === "CSV" ? "#FEF3C7" : "#F3F4F6",
                  color: ext === "JSON" ? "#1D4ED8" : ext === "TXT" ? "#065F46" : ext === "CSV" ? "#92400E" : "#374151",
                }}>
                {ext}
              </span>
              <span className="ts-2xs flex-1 truncate" style={{ color: "var(--color-text-secondary)" }}>
                {filename}
              </span>
              <ExternalLink size={10} style={{ color: "var(--color-text-muted)" }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
