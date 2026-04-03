import { useState } from "react";
import {
  ClipboardList, Trash2, Clock, CheckCircle, Copy, FileDown, AlertTriangle, LogIn,
} from "lucide-react";
import { Button } from "../ui/Button";
import { flattenForDisplay } from "./shared";
import { getDataOnly } from "./renderers";
import type { CollectionEntry, CollectionStatus, ToolDef } from "./types";

function resolveCollectionStatus(entry: CollectionEntry): CollectionStatus {
  if (entry.status) return entry.status;
  const data = getDataOnly(entry.result);
  if (data.로그인_필요) return "auth_required";
  if (data.성공 === false) return "failure";
  return "success";
}

// ─── Report View Component ───

export function ReportView({ collections, tools, reportMarkdown, onCopyReport, reportCopied, onSaveReport, reportSaving, onClear }: {
  collections: CollectionEntry[];
  tools: ToolDef[];
  reportMarkdown: string;
  onCopyReport: () => void;
  reportCopied: boolean;
  onSaveReport: () => void;
  reportSaving: boolean;
  onClear: () => void;
}) {
  const [tab, setTab] = useState<"history" | "report">("history");
  const successCount = collections.filter((entry) => resolveCollectionStatus(entry) === "success").length;
  const failureCount = collections.filter((entry) => resolveCollectionStatus(entry) === "failure").length;
  const authCount = collections.filter((entry) => resolveCollectionStatus(entry) === "auth_required").length;

  return (
    <div className="animate-fade-in max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, var(--color-bg-secondary))", color: "var(--color-accent)" }}
        >
          <ClipboardList size={20} />
        </div>
        <div className="flex-1">
          <h3 className="ts-md font-bold" style={{ color: "var(--color-text-primary)" }}>수집 내역</h3>
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
            {collections.length}건 기록
            {` · 성공 ${successCount}건`}
            {failureCount > 0 ? ` · 실패 ${failureCount}건` : ""}
            {authCount > 0 ? ` · 로그인 필요 ${authCount}건` : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} title="전체 삭제">
          <span className="flex items-center gap-1"><Trash2 size={13} /> 초기화</span>
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
        <button
          onClick={() => setTab("history")}
          className="flex-1 py-1.5 rounded-md ts-xs font-semibold transition-colors"
          style={{
            backgroundColor: tab === "history" ? "var(--color-bg-primary)" : "transparent",
            color: tab === "history" ? "var(--color-text-primary)" : "var(--color-text-muted)",
            boxShadow: tab === "history" ? "var(--shadow-card)" : "none",
          }}
        >
          수집 이력
        </button>
        <button
          onClick={() => setTab("report")}
          className="flex-1 py-1.5 rounded-md ts-xs font-semibold transition-colors"
          style={{
            backgroundColor: tab === "report" ? "var(--color-bg-primary)" : "transparent",
            color: tab === "report" ? "var(--color-text-primary)" : "var(--color-text-muted)",
            boxShadow: tab === "report" ? "var(--shadow-card)" : "none",
          }}
        >
          통합 리포트
        </button>
      </div>

      {tab === "history" ? (
        <div className="space-y-2">
          {collections.map((entry, i) => {
            const toolDef = tools.find((t) => t.id === entry.toolId);
            const time = new Date(entry.completedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
            const inputSummary = Object.values(entry.inputs).filter((v) => v && v !== "true" && v !== "false").join(", ");
            const status = resolveCollectionStatus(entry);
            const statusLabel = status === "success" ? "수집 완료" : status === "failure" ? "수집 실패" : "로그인 필요";
            const statusColor = status === "success"
              ? "var(--color-success)"
              : status === "failure"
                ? "var(--color-error)"
                : "var(--color-warning, #D97706)";
            const StatusIcon = status === "success" ? CheckCircle : status === "failure" ? AlertTriangle : LogIn;
            return (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: toolDef?.bg, color: toolDef?.color }}
                >
                  {toolDef?.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
                      {entry.toolName}
                    </span>
                    <span className="ts-2xs flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
                      <Clock size={10} /> {time}
                    </span>
                  </div>
                  {inputSummary && (
                    <p className="ts-2xs mt-0.5 truncate" style={{ color: "var(--color-text-secondary)" }}>
                      {inputSummary}
                    </p>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    <StatusIcon size={11} style={{ color: statusColor }} />
                    <span className="ts-2xs" style={{ color: statusColor }}>{statusLabel}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" onClick={onCopyReport}>
              <span className="flex items-center gap-1.5">
                <Copy size={13} /> {reportCopied ? "복사됨!" : "리포트 복사"}
              </span>
            </Button>
            <Button variant="secondary" size="sm" onClick={onSaveReport} disabled={reportSaving}>
              <span className="flex items-center gap-1.5">
                <FileDown size={13} /> {reportSaving ? "저장 중..." : "파일 저장"}
              </span>
            </Button>
          </div>

          <div
            className="p-4 rounded-lg max-h-[500px] overflow-y-auto"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <pre
              className="ts-2xs whitespace-pre-wrap leading-relaxed"
              style={{ color: "var(--color-text-secondary)", fontFamily: "var(--font-sans, system-ui)" }}
            >
              {reportMarkdown || "수집된 데이터가 없습니다."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Report Generation ───

export function generateReport(collections: CollectionEntry[], tools: ToolDef[]): string {
  if (collections.length === 0) return "";

  const date = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const toolNames = [...new Set(collections.map(c => {
    const def = tools.find(t => t.id === c.toolId);
    return def?.name ?? c.toolId;
  }))];

  // 입력값에서 대상 정보 추출
  const allInputs = collections.map(c => Object.values(c.inputs).filter(Boolean).join(", ")).filter(Boolean);
  const targetSummary = [...new Set(allInputs)].slice(0, 3).join(" / ");

  const lines: string[] = [
    `# 사전기획 적정성 검토 자료 수집 리포트`,
    ``,
    `| 항목 | 내용 |`,
    `|------|------|`,
    `| 생성일시 | ${date} ${time} |`,
    `| 조사대상 | ${targetSummary || "-"} |`,
    `| 수집 항목 | ${collections.length}건 (${toolNames.join(", ")}) |`,
    `| 용도 | 사전기획 적정성 검토 참고자료 |`,
    ``,
    `---`,
    ``,
  ];

  const byTool: Record<string, CollectionEntry[]> = {};
  for (const entry of collections) {
    if (!byTool[entry.toolId]) byTool[entry.toolId] = [];
    byTool[entry.toolId].push(entry);
  }

  for (const [toolId, entries] of Object.entries(byTool)) {
    const toolDef = tools.find((t) => t.id === toolId);
    const toolName = toolDef?.name ?? toolId;
    lines.push(`## ${toolName}`);
    lines.push(``);

    for (const entry of entries) {
      const data = getDataOnly(entry.result);
      const inputSummary = Object.values(entry.inputs).filter(Boolean).join(", ");
      if (inputSummary) {
        lines.push(`### ${inputSummary}`);
        lines.push(``);
      }

      // 실패/로그인필요 상태 처리
      if (data.성공 === false || data.로그인_필요) {
        if (data.로그인_필요) {
          lines.push(`- **상태**: 로그인 필요 (headed 모드로 재실행 필요)`);
        } else if (data.오류) {
          lines.push(`- **상태**: 수집 실패 — ${data.오류}`);
        }
        if (data.안내) {
          lines.push(`- **안내**: ${String(data.안내).split("\n")[0]}`);
        }
        lines.push(``);
        continue;
      }

      switch (toolId) {
        case "schoolinfo": {
          const name = data.학교명 as string || inputSummary;
          lines.push(`- **학교명**: ${name}`);
          for (const [k, v] of Object.entries(data)) {
            if (["학교명", "검색결과수", "공시_카테고리", "본문"].includes(k)) continue;
            if (k.startsWith("테이블_") || k.startsWith("_")) continue;
            if (v !== null && v !== undefined && v !== "") {
              lines.push(`- **${k}**: ${v}`);
            }
          }
          break;
        }
        case "building_info": {
          const detail = data.상세정보 as Record<string, unknown> | undefined;
          if (detail && Object.keys(detail).length > 0) {
            for (const [k, v] of Object.entries(detail)) {
              lines.push(`- **${k}**: ${v}`);
            }
          } else {
            lines.push(`- 검색 결과만 확인됨 (상세정보 없음)`);
          }
          break;
        }
        case "land_info": {
          for (const [k, v] of Object.entries(data)) {
            if (k === "정보패널" || k.startsWith("_")) continue;
            if (v !== null && v !== undefined && v !== "") {
              lines.push(`- **${k}**: ${v}`);
            }
          }
          break;
        }
        case "population": {
          const totalPop = Number(data.총인구 || 0);
          const regionName = String(data.지역명 || data.지역 || "");
          const scope = String(data.조회범위 || "");
          const agePop = data.연령별_인구 as Record<string, number> | undefined;

          if (regionName) lines.push(`- **조회지역**: ${regionName} (${scope})`);
          if (totalPop > 0) lines.push(`- **총인구**: ${totalPop.toLocaleString()}명`);

          // 전국 데이터 경고
          if (data.경고) lines.push(`- > ⚠️ ${data.경고}`);

          if (agePop) {
            let elem = 0, mid = 0, high = 0;
            for (let age = 6; age <= 11; age++) elem += agePop[`${age}세`] || 0;
            for (let age = 12; age <= 14; age++) mid += agePop[`${age}세`] || 0;
            for (let age = 15; age <= 17; age++) high += agePop[`${age}세`] || 0;
            const total = elem + mid + high;
            lines.push(`- **학령인구 합계**: ${total.toLocaleString()}명`);
            lines.push(`  - 초등(6~11세): ${elem.toLocaleString()}명`);
            lines.push(`  - 중등(12~14세): ${mid.toLocaleString()}명`);
            lines.push(`  - 고등(15~17세): ${high.toLocaleString()}명`);
            if (totalPop > 0) {
              lines.push(`- **학령인구 비율**: ${(total / totalPop * 100).toFixed(1)}%`);
            }
          }
          break;
        }
        case "heritage": {
          const count = Number(data.발견수 || 0);
          if (count === 0) {
            lines.push(`- **결과**: 해당 지역 국가유산 없음`);
            lines.push(`- **판정**: 문화유산 영향 없음 (검토의견서 기재 가능)`);
          } else {
            lines.push(`- **발견**: ${count}건`);
            const list = data.유산목록 as { 명칭?: string; 종목?: string; 소재지?: string; 시대?: string; 내용?: string; 유형?: string }[] | undefined;
            if (list) {
              // 종목별 그룹핑
              const byKind: Record<string, typeof list> = {};
              for (const item of list) {
                const kind = item.종목 || item.유형 || "기타";
                if (!byKind[kind]) byKind[kind] = [];
                byKind[kind]!.push(item);
              }
              for (const [kind, items] of Object.entries(byKind)) {
                lines.push(`- **${kind}** (${items!.length}건)`);
                for (const item of items!.slice(0, 10)) {
                  const name = item.명칭 || item.내용 || "";
                  const loc = item.소재지 ? ` — ${item.소재지}` : "";
                  lines.push(`  - ${name}${loc}`);
                }
                if (items!.length > 10) {
                  lines.push(`  - ... 외 ${items!.length - 10}건`);
                }
              }
            }
            lines.push(`- **판정**: 문화유산 영향 확인 필요 (부지 반경 내 유산 존재)`);
          }
          break;
        }
        case "design_fee": {
          const input = data.입력 as Record<string, string> | undefined;
          if (input) {
            lines.push(`- 방식: ${input.방식}, 종별: ${input.종별}, 급수: ${input.급수}`);
            lines.push(`- 공사비: ${Number(input.공사비 || 0).toLocaleString()}원`);
          }
          const amounts = data.산출금액 as string[] | undefined;
          if (amounts) {
            for (const amt of amounts) lines.push(`- **${amt}**`);
          } else if (data.결과_원본) {
            lines.push(`- ${data.결과_원본}`);
          }
          break;
        }
        case "school_zone": {
          const schools = data.학교목록 as Record<string, string>[] | undefined;
          if (schools && schools.length > 0) {
            for (const school of schools) {
              lines.push(`- ${Object.entries(school).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
            }
          } else {
            lines.push(`- 검색 결과 없음`);
          }
          break;
        }
        default: {
          const flat = flattenForDisplay(data);
          for (const { label, value } of flat) {
            lines.push(`- **${label}**: ${value}`);
          }
        }
      }
      lines.push(``);
    }
    lines.push(`---`);
    lines.push(``);
  }

  lines.push(`*EduPlan AI 자동 생성*`);
  return lines.join("\n");
}
