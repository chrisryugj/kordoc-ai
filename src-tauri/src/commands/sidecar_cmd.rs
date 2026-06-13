use std::sync::Arc;
use tauri::State;

use crate::error::AppError;
use crate::sidecar::manager::{SidecarManager, SidecarStatus};

/// Allowed RPC methods (whitelist for security)
/// Synced with node-sidecar/src/rpc/methods/index.ts
const ALLOWED_METHODS: &[&str] = &[
    // Phase 2 실구현
    "ping",
    "cancel",
    "get_settings",
    "update_settings",
    "open_folder",
    "open_file",
    "list_files",
    // Phase 4~5 스텁
    "convert",
    "convert_batch",
    "diff",
    "form_extract",
    "form_extract_candidates",
    "form_extract_batch",
    "generate_hwpx",
    "extract_tables",
    "merge_files",
    "split_pdf",
    "pdf_extract_pages",
    "pdf_page_count",
    "inspect_document",
    "ocr",
    "summarize",
    // MCP 설치
    "detect_mcp_env",
    "install_mcp_config",
    "install_node",
    // Phase 2 W2: 인쇄 + deep-link batch
    "print_files",
    "list_printers",
    "read_batch_manifest",
    // KorDoc Studio Phase B: 양식 채우기 작업대
    "form_schema",
    "form_fill",
    "patch_blocks",
    "render_preview",
    // KorDoc Studio Phase C: 클릭-편집 세션
    "edit_open",
    "edit_patch",
    "edit_undo",
    "edit_redo",
    "edit_save",
    "edit_close",
];

#[tauri::command]
pub async fn sidecar_status(
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<SidecarStatus, AppError> {
    Ok(manager.status().await)
}

/// 화이트리스트 기반 RPC 호출 — settings.rs에서도 이 함수를 경유
#[tauri::command]
pub async fn sidecar_call(
    method: String,
    params: Option<serde_json::Value>,
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<serde_json::Value, AppError> {
    if !ALLOWED_METHODS.contains(&method.as_str()) {
        return Err(AppError::JsonRpc(format!("Disallowed method: {}", method)));
    }

    manager.call(&method, params).await?.extract_result()
}

#[tauri::command]
pub async fn sidecar_start(manager: State<'_, Arc<SidecarManager>>) -> Result<(), AppError> {
    manager.restart_if_crashed().await
}
