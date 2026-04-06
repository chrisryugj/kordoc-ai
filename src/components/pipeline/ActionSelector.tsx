import {
  FileText, Scan, Sparkles, GitCompareArrows,
  Table, ClipboardList, FileOutput, Merge, ShieldCheck,
} from "lucide-react";
import type { PipelineAction, ImportedFile } from "../../types/pipeline";

interface ActionSelectorProps {
  files: ImportedFile[];
  onSelect: (action: PipelineAction) => void;
  apiKeySet: boolean;
}

interface ActionDef {
  action: PipelineAction;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  needsApi: boolean;
  /** 최소 파일 수 */
  minFiles: number;
  /** 최대 파일 수 (0 = 무제한) */
  maxFiles: number;
  /** 지원 파일 확장자 (빈 배열 = 전부) */
  fileTypes: string[];
}

const ACTIONS: ActionDef[] = [
  {
    action: "convert", label: "마크다운 변환", desc: "HWP/HWPX/PDF → 마크다운",
    icon: <FileText size={18} />, color: "var(--color-accent)",
    needsApi: false, minFiles: 1, maxFiles: 0, fileTypes: ["hwp", "hwpx", "pdf"],
  },
  {
    action: "ocr", label: "AI OCR", desc: "이미지/PDF 텍스트 인식",
    icon: <Scan size={18} />, color: "#7C3AED",
    needsApi: true, minFiles: 1, maxFiles: 1, fileTypes: ["pdf", "png", "jpg", "gif", "webp"],
  },
  {
    action: "summarize", label: "AI 요약", desc: "문서 핵심 내용 요약",
    icon: <Sparkles size={18} />, color: "#2563EB",
    needsApi: true, minFiles: 1, maxFiles: 1, fileTypes: [],
  },
  {
    action: "diff", label: "문서 비교", desc: "두 문서 차이점 비교",
    icon: <GitCompareArrows size={18} />, color: "#059669",
    needsApi: false, minFiles: 2, maxFiles: 2, fileTypes: [],
  },
  {
    action: "extract_tables", label: "표 추출", desc: "문서에서 표만 추출",
    icon: <Table size={18} />, color: "#7C3AED",
    needsApi: false, minFiles: 1, maxFiles: 1, fileTypes: [],
  },
  {
    action: "form_extract", label: "양식 추출", desc: "문서에서 필드 배치 추출",
    icon: <ClipboardList size={18} />, color: "#2563EB",
    needsApi: false, minFiles: 1, maxFiles: 0, fileTypes: [],
  },
  {
    action: "merge_files", label: "문서 병합", desc: "여러 문서를 하나로 합침",
    icon: <Merge size={18} />, color: "#D97706",
    needsApi: false, minFiles: 2, maxFiles: 0, fileTypes: [],
  },
  {
    action: "generate_hwpx", label: "HWPX 생성", desc: "마크다운 → 한글 문서",
    icon: <FileOutput size={18} />, color: "#059669",
    needsApi: false, minFiles: 1, maxFiles: 1, fileTypes: ["txt"],
  },
  {
    action: "inspect_document", label: "K팀장 검토", desc: "논리 구조·숫자·날짜·오탈자 전체 정합성 검사",
    icon: <ShieldCheck size={18} />, color: "#DC2626",
    needsApi: true, minFiles: 1, maxFiles: 1, fileTypes: [],
  },
];

function isActionAvailable(a: ActionDef, files: ImportedFile[], apiKeySet: boolean): { ok: boolean; reason?: string } {
  if (a.needsApi && !apiKeySet) return { ok: false, reason: "API 키 필요" };
  if (files.length < a.minFiles) return { ok: false, reason: `파일 ${a.minFiles}개 이상 필요` };
  if (a.maxFiles > 0 && files.length > a.maxFiles) return { ok: false, reason: `파일 ${a.maxFiles}개만 선택` };
  if (a.fileTypes.length > 0) {
    const supported = files.every((f) => a.fileTypes.includes(f.type));
    if (!supported) return { ok: false, reason: `${a.fileTypes.join("/")} 파일만` };
  }
  return { ok: true };
}

export function ActionSelector({ files, onSelect, apiKeySet }: ActionSelectorProps) {
  return (
    <div className="px-6 pb-2">
      <h3 className="ts-sm font-semibold mb-3" style={{ color: "var(--color-text-primary)" }}>
        어떤 작업을 할까요?
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {ACTIONS.map((a) => {
          const { ok, reason } = isActionAvailable(a, files, apiKeySet);
          return (
            <button
              key={a.action}
              onClick={() => ok && onSelect(a.action)}
              disabled={!ok}
              className="flex items-start gap-3 p-3 rounded-lg text-left transition-all"
              style={{
                backgroundColor: ok ? "var(--color-bg-tertiary)" : "var(--color-bg-secondary)",
                opacity: ok ? 1 : 0.45,
                border: "1px solid var(--color-border)",
                cursor: ok ? "pointer" : "not-allowed",
              }}
              title={reason}
              onMouseEnter={(e) => { if (ok) (e.currentTarget.style.borderColor = a.color); }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: `color-mix(in srgb, ${a.color} 10%, transparent)`, color: a.color }}
              >
                {a.icon}
              </div>
              <div className="min-w-0">
                <div className="ts-xs font-semibold truncate" style={{ color: "var(--color-text-primary)" }}>
                  {a.label}
                </div>
                <div className="ts-2xs mt-0.5" style={{ color: ok ? "var(--color-text-muted)" : "var(--color-error)" }}>
                  {ok ? a.desc : reason}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
