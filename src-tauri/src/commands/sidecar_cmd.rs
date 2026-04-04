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
    "generate_hwpx",
    "extract_tables",
    "merge_files",
    "ocr",
    "summarize",
    "scan_receipt",
];

#[tauri::command]
pub async fn sidecar_status(
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<SidecarStatus, AppError> {
    Ok(manager.status().await)
}

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
