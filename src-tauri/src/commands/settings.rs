use std::sync::Arc;
use tauri::State;

use crate::error::AppError;
use crate::sidecar::manager::SidecarManager;

#[tauri::command]
pub async fn get_settings(
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<serde_json::Value, AppError> {
    manager.call("get_settings", None).await?.extract_result()
}

#[tauri::command]
pub async fn update_settings(
    settings: serde_json::Value,
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<serde_json::Value, AppError> {
    manager
        .call("update_settings", Some(settings))
        .await?
        .extract_result()
}
