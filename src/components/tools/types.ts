export interface ToolDef {
  id: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  site: string;
  fields: { key: string; label: string; placeholder: string; required?: boolean; contextKey?: keyof SiteContext }[];
  needsAuth?: boolean;
  group: "school" | "site" | "region" | "calc";
}

/** 검토 현장 공통 입력 — 도구 그룹별 자동 채움 */
export interface SiteContext {
  schoolName: string;   // 학교 정보 그룹
  address: string;      // 부지 분석 그룹
  region: string;       // 지역 현황 그룹
}

export type ToolStatus = "idle" | "running" | "done" | "error";
export type CollectionStatus = "success" | "failure" | "auth_required";

export interface ToolState {
  status: ToolStatus;
  inputs: Record<string, string>;
  result?: Record<string, unknown>;
  error?: string;
  completedAt?: string;
}

export interface CollectionEntry {
  toolId: string;
  toolName: string;
  inputs: Record<string, string>;
  result: Record<string, unknown>;
  completedAt: string;
  status?: CollectionStatus;
}

export interface MetaInfo {
  saved_files?: string[];
  output_dir?: string;
}
