use std::sync::Arc;
use tauri::State;

use crate::error::AppError;
use crate::sidecar::manager::{SidecarManager, SidecarStatus};

use super::rpc_methods::ALLOWED_METHODS;

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
