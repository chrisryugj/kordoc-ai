use std::sync::Arc;
use tauri::State;

use crate::error::AppError;
use crate::sidecar::manager::SidecarManager;

use super::sidecar_cmd::sidecar_call;

#[tauri::command]
pub async fn get_settings(
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<serde_json::Value, AppError> {
    // whitelist 경유하여 일관된 보안 체크 (sidecar_call 내부에서 ALLOWED_METHODS 검사)
    sidecar_call("get_settings".into(), None, manager).await
}

#[tauri::command]
pub async fn update_settings(
    settings: serde_json::Value,
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<serde_json::Value, AppError> {
    sidecar_call("update_settings".into(), Some(settings), manager).await
}
