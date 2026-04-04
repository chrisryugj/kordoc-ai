use std::sync::Arc;
use tauri::State;

use crate::error::AppError;
use crate::sidecar::manager::{SidecarManager, SidecarStatus};

/// Allowed RPC methods (whitelist for security)
const ALLOWED_METHODS: &[&str] = &[
    "ping",
    "cancel",
    "get_settings",
    "update_settings",
    "set_api_key",
    "set_models",
    "ocr_files",
    "text_extract",
    "summarize",
    "open_folder",
    "open_file",
    "inspect_pipeline_output",
    "save_pipeline_state",
    "list_files",
    "save_report",
    "read_report",
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
