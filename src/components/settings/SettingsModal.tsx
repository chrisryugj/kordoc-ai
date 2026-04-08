import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import {
  Key, Cpu, Zap, Info, ChevronDown, ExternalLink,
  Sun, Moon, FolderOutput, Wifi, WifiOff,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────

export interface SettingsSaveValues {
  apiKey: string;          // SAVED_API_KEY_SENTINEL = unchanged; "" = cleared
  ocrModel: string;
  analysisModel: string;
  aiMode: "online" | "offline";
  outputDir: string;
  theme: "light" | "dark";
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Initial values
  apiKey: string;
  apiKeyMasked: string;
  ocrModel: string;
  analysisModel: string;
  aiMode: "online" | "offline";
  sidecarStatus: string;
  sidecarError?: string;
  outputDir: string;
  theme: "light" | "dark";
  // Callbacks
  onThemePreview: (t: "light" | "dark") => void; // live preview
  onSave: (values: SettingsSaveValues) => void;
}

// ── Constants ─────────────────────────────────────────────────────

/** API 키가 저장되어 있음을 나타내는 sentinel 값 (실제 키 아님) */
export const SAVED_API_KEY_SENTINEL = "__saved__" as const;

const DEFAULT_OCR_MODEL = "gemini-3-flash-preview";
const DEFAULT_ANALYSIS_MODEL = "gemini-3-flash-preview";
const MODEL_CATALOG = {
  "gemini-3-flash-preview": { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", desc: "속도·품질 균형 최고, 무료 (Preview)" },
  "gemini-2.5-flash-preview-05-20": { value: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash", desc: "안정적 범용 모델, 무료 (10 RPM · 250 RPD)" },
  "gemini-2.5-pro-preview-06-05": { value: "gemini-2.5-pro-preview-06-05", label: "Gemini 2.5 Pro", desc: "최고 품질, 유료 전용 (무료 티어 미지원)" },
  "gemini-3.1-flash-lite-preview": { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", desc: "가장 빠르고 가벼움, 무료 (Preview)" },
} as const;

const OCR_MODELS: ModelOption[] = [
  MODEL_CATALOG["gemini-3-flash-preview"],
  MODEL_CATALOG["gemini-2.5-flash-preview-05-20"],
  MODEL_CATALOG["gemini-2.5-pro-preview-06-05"],
];

const ANALYSIS_MODELS: ModelOption[] = [
  MODEL_CATALOG["gemini-3.1-flash-lite-preview"],
  MODEL_CATALOG["gemini-3-flash-preview"],
  MODEL_CATALOG["gemini-2.5-pro-preview-06-05"],
];

type Tab = "api" | "models" | "output";
const TABS: { id: Tab; label: string }[] = [
  { id: "api",    label: "API 연결" },
  { id: "models", label: "AI 모델" },
  { id: "output", label: "출력·화면" },
];

type ModelOption = {
  value: string;
  label: string;
  desc: string;
};

// ── Sub-components ────────────────────────────────────────────────

function ModelSelect({ value, onChange, models, label, icon }: {
  value: string;
  onChange: (v: string) => void;
  models: ModelOption[];
  label: string;
  icon: React.ReactNode;
}) {
  const selected = models.find((m) => m.value === value);
  return (
    <div>
      <label className="ts-2xs font-semibold flex items-center gap-1.5 mb-1" style={{ color: "var(--color-text-muted)" }}>
        {icon} {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-modern w-full rounded-lg px-2.5 py-1.5 ts-xs appearance-none cursor-pointer pr-7"
          style={{ color: "var(--color-text-primary)" }}
        >
          {models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--color-text-muted)" }} />
      </div>
      {selected && <p className="ts-2xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>{selected.desc}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

export function SettingsModal({
  isOpen, onClose,
  apiKey, apiKeyMasked, ocrModel, analysisModel, aiMode,
  sidecarStatus, sidecarError, outputDir, theme,
  onThemePreview, onSave,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("api");

  // Local state — written on open, committed on Save
  const [localApiKey, setLocalApiKey] = useState(apiKey);
  const [localOcrModel, setLocalOcrModel] = useState(ocrModel);
  const [localAnalysisModel, setLocalAnalysisModel] = useState(analysisModel);
  const [localAiMode, setLocalAiMode] = useState(aiMode);
  const [localOutputDir, setLocalOutputDir] = useState(outputDir);
  const [localTheme, setLocalTheme] = useState(theme);
  const originalThemeRef = useRef(theme);

  // Sync local state when modal (re-)opens
  useEffect(() => {
    if (isOpen) {
      setTab("api");
      setLocalApiKey(apiKey);
      setLocalOcrModel(ocrModel);
      setLocalAnalysisModel(analysisModel);
      setLocalAiMode(aiMode);
      setLocalOutputDir(outputDir);
      setLocalTheme(theme);
      originalThemeRef.current = theme;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sync from props only on open
  }, [isOpen]);

  const handleThemeChange = (t: "light" | "dark") => {
    setLocalTheme(t);
    onThemePreview(t);
  };

  const handleSave = () => {
    onSave({
      apiKey: localApiKey,
      ocrModel: localOcrModel,
      analysisModel: localAnalysisModel,
      aiMode: localAiMode,
      outputDir: localOutputDir,
      theme: localTheme,
    });
    onClose();
  };

  const handleCancel = () => {
    if (localTheme !== originalThemeRef.current) {
      onThemePreview(originalThemeRef.current);
    }
    onClose();
  };

  const handleReset = () => {
    if (!window.confirm("모델·출력·테마 설정을 기본값으로 되돌립니다.\nAPI 키는 유지됩니다. 계속하시겠습니까?")) return;
    setLocalOcrModel(DEFAULT_OCR_MODEL);
    setLocalAnalysisModel(DEFAULT_ANALYSIS_MODEL);
    setLocalAiMode("online");
    setLocalOutputDir("");
    setLocalTheme("light");
    onThemePreview("light");
  };

  const isSavedKey = localApiKey === SAVED_API_KEY_SENTINEL;

  // ── Tab content ───────────────────────────────────────────────

  const tabContent: Record<Tab, React.ReactNode> = {
    api: (
      <div className="space-y-3">
        <div>
          <label className="ts-2xs font-semibold flex items-center gap-1.5 mb-1.5" style={{ color: "var(--color-text-muted)" }}>
            <Key size={12} /> Gemini API 키
          </label>
          {isSavedKey ? (
            <div className="flex gap-2">
              <div className="input-modern flex-1 rounded-lg px-3 py-2 ts-xs flex items-center gap-2" style={{ color: "var(--color-text-secondary)" }}>
                <span className="font-mono">{apiKeyMasked || "저장된 키"}</span>
                <Badge variant="success">저장됨</Badge>
              </div>
              <button
                onClick={() => setLocalApiKey("")}
                className="px-3 py-2 rounded-lg ts-xs font-medium transition-colors"
                style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              >
                변경
              </button>
            </div>
          ) : (
            <input
              type="password"
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              placeholder="AIza... 형식의 Gemini API 키"
              className="input-modern w-full rounded-lg px-3 py-2 ts-xs"
            />
          )}
          <p className="ts-2xs mt-1.5 flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
            <Info size={10} className="shrink-0" />
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
              className="underline flex items-center gap-0.5" style={{ color: "var(--color-accent)" }}>
              Google AI Studio <ExternalLink size={9} />
            </a>
            에서 무료 발급 (모델별 하루 100~1,000회)
          </p>
        </div>

        {/* AI 모드 토글 */}
        <div>
          <label className="ts-2xs font-semibold flex items-center gap-1.5 mb-1.5" style={{ color: "var(--color-text-muted)" }}>
            {localAiMode === "online" ? <Wifi size={12} /> : <WifiOff size={12} />} AI 동작 모드
          </label>
          <div className="flex gap-2">
            {([["online", "온라인", <Wifi size={13} key="on" />, "Gemini API로 OCR·요약·분석"], ["offline", "오프라인", <WifiOff size={13} key="off" />, "API 없이 로컬 변환만"]] as const).map(([val, label, icon, desc]) => (
              <button key={val} onClick={() => setLocalAiMode(val)}
                className="flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg ts-xs font-medium transition-colors"
                style={{
                  backgroundColor: localAiMode === val ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)",
                  color: localAiMode === val ? "var(--color-accent)" : "var(--color-text-muted)",
                  border: `1.5px solid ${localAiMode === val ? "var(--color-accent)" : "var(--color-border)"}`,
                }}>
                <span className="flex items-center gap-1.5">{icon} {label}</span>
                <span className="ts-2xs font-normal" style={{ color: "var(--color-text-muted)" }}>{desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    ),

    models: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <ModelSelect value={localOcrModel} onChange={setLocalOcrModel} models={OCR_MODELS}
            label="OCR · 태깅 모델" icon={<Cpu size={11} />} />
          <ModelSelect value={localAnalysisModel} onChange={setLocalAnalysisModel} models={ANALYSIS_MODELS}
            label="분석 · 요약 모델" icon={<Zap size={11} />} />
        </div>
        <div className="px-3 py-2 rounded-lg ts-2xs" style={{ backgroundColor: "var(--color-info-bg)", color: "var(--color-info)" }}>
          <strong>팁:</strong> OCR·태깅은 Flash가 속도/비용 최적. 표가 복잡하면 Pro 선택.
          분석은 Lite로도 충분히 정확합니다.
        </div>
      </div>
    ),

    output: (
      <div className="space-y-4">
        <div>
          <label className="ts-2xs font-semibold flex items-center gap-1.5 mb-1.5" style={{ color: "var(--color-text-muted)" }}>
            <FolderOutput size={12} /> 결과 저장 위치
          </label>
          <div className="flex gap-2">
            <div
              className="input-modern flex-1 rounded-lg px-3 py-2 ts-2xs flex items-center truncate"
              style={{ color: localOutputDir ? "var(--color-text-primary)" : "var(--color-text-muted)" }}
              title={localOutputDir || "입력 파일과 같은 폴더/_output/"}
            >
              {localOutputDir || "기본값: 입력 파일 폴더/_output/"}
            </div>
            <button
              onClick={async () => {
                const selected = await open({ directory: true, multiple: false });
                if (selected) {
                  const dir = Array.isArray(selected) ? selected[0] : selected;
                  if (dir) setLocalOutputDir(dir);
                }
              }}
              className="px-3 py-2 rounded-lg ts-xs font-medium transition-colors whitespace-nowrap"
              style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
            >
              변경
            </button>
            {localOutputDir && (
              <button onClick={() => setLocalOutputDir("")}
                className="px-3 py-2 rounded-lg ts-xs font-medium transition-colors"
                style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                초기화
              </button>
            )}
          </div>
          <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            비워두면 입력 파일 폴더 아래 _output/ 에 저장됩니다
          </p>
        </div>

        <div>
          <label className="ts-2xs font-semibold flex items-center gap-1.5 mb-1.5" style={{ color: "var(--color-text-muted)" }}>
            <Sun size={12} /> 화면 테마 (라이브 미리보기)
          </label>
          <div className="flex gap-2">
            {([["light", "라이트", <Sun size={13} key="s" />], ["dark", "다크", <Moon size={13} key="m" />]] as const).map(([val, label, icon]) => (
              <button key={val} onClick={() => handleThemeChange(val)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg ts-xs font-medium transition-colors"
                style={{
                  backgroundColor: localTheme === val ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)",
                  color: localTheme === val ? "var(--color-accent)" : "var(--color-text-muted)",
                  border: `1.5px solid ${localTheme === val ? "var(--color-accent)" : "var(--color-border)"}`,
                }}>
                {icon} {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    ),

  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="설정" size="lg">
      <div className="flex flex-col gap-0">
        {/* Engine + API status bar */}
        <div className="flex items-center gap-4 px-1 pb-3 mb-1 ts-2xs" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{
              backgroundColor: sidecarStatus === "ready" ? "var(--color-success)"
                : sidecarStatus === "error" ? "var(--color-error)" : "var(--color-warning)",
            }} />
            <span style={{ color: sidecarStatus === "ready" ? "var(--color-success)" : sidecarStatus === "error" ? "var(--color-error)" : "var(--color-warning)" }}>
              엔진 {sidecarStatus === "ready" ? "준비됨" : sidecarStatus === "error" ? `오류: ${sidecarError || "알 수 없음"}` : "시작 중..."}
            </span>
          </div>
          <div className="w-px h-3" style={{ backgroundColor: "var(--color-border)" }} />
          <div className="flex items-center gap-1.5">
            <span style={{ color: "var(--color-text-muted)" }}>API 키</span>
            <Badge variant={apiKey.length > 0 ? "success" : "danger"} className="text-[0.675rem]">
              {apiKey.length > 0 ? "설정됨" : "미설정"}
            </Badge>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-4 py-2 ts-xs font-medium transition-colors"
              style={{
                color: tab === t.id ? "var(--color-accent)" : "var(--color-text-muted)",
                borderBottom: `2px solid ${tab === t.id ? "var(--color-accent)" : "transparent"}`,
                marginBottom: "-1px",
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ minHeight: 180 }}>
          {tabContent[tab]}
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-between pt-4 mt-4" style={{ borderTop: "1px solid var(--color-border)" }}>
          <button onClick={handleReset}
            className="px-3 py-1.5 rounded-lg ts-xs font-medium transition-colors"
            style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)" }}>
            모델·출력 초기화
          </button>
          <div className="flex gap-2">
            <button onClick={handleCancel}
              className="px-3 py-1.5 rounded-lg ts-xs font-medium transition-colors"
              style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)" }}>
              취소
            </button>
            <Button size="sm" onClick={handleSave}>저장</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
