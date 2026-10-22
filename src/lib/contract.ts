/** 사이드카 RPC 계약 타입 모음. 정본은 node-sidecar/src/types/rpc-contract.ts */

export type {
  RpcMethod, RpcParams, RpcResult, DeepPartial,
  DocFormat, FileEntry, PagePreview, LintFinding, RedactRule, ChatMessage, Citation, BatchItemResult,
  SystemInfo, McpEnv, DocInfo, ConvertParams, ConvertResult, CompareResult, TablesResult, GongmunMeta,
  GenerateParams, RedactResult, AiStatus, LlmCatalogItem, ReviewIssue, TemplateEntry, TemplateAnalysis,
  UsageReport, SecurityStatus, LocalModelServer, SubscriptionStatus,
  StyleFormat, StyleEntry, PdfShrinkLevel, PdfShrinkResult,
} from "../../node-sidecar/src/types/rpc-contract";
export type { Settings, AiProviderId } from "../../node-sidecar/src/types/index";
