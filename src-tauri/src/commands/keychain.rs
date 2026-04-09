//! OS keychain을 통한 API 키 보안 저장 (Windows Credential Manager)

const SERVICE: &str = "kordoc-ai";
const USER: &str = "gemini-api-key";

/// API 키를 OS keychain에 저장
#[tauri::command]
pub async fn store_api_key(api_key: String) -> Result<(), crate::error::AppError> {
    if api_key.is_empty() {
        // 빈 키면 삭제
        let entry = keyring::Entry::new(SERVICE, USER)
            .map_err(|e| crate::error::AppError::Sidecar(format!("Keychain 초기화 실패: {e}")))?;
        let _ = entry.delete_credential(); // 없으면 무시
        return Ok(());
    }

    let entry = keyring::Entry::new(SERVICE, USER)
        .map_err(|e| crate::error::AppError::Sidecar(format!("Keychain 초기화 실패: {e}")))?;
    entry
        .set_password(&api_key)
        .map_err(|e| crate::error::AppError::Sidecar(format!("API 키 저장 실패: {e}")))?;
    Ok(())
}

/// OS keychain에서 API 키 로드 (마스킹된 값 반환)
#[tauri::command]
pub async fn load_api_key() -> Result<serde_json::Value, crate::error::AppError> {
    let entry = keyring::Entry::new(SERVICE, USER)
        .map_err(|e| crate::error::AppError::Sidecar(format!("Keychain 초기화 실패: {e}")))?;

    match entry.get_password() {
        Ok(key) if !key.is_empty() => {
            let masked = if key.len() > 4 {
                format!("{}****", &key[..4])
            } else {
                "****".to_string()
            };
            Ok(serde_json::json!({ "exists": true, "masked": masked }))
        }
        _ => Ok(serde_json::json!({ "exists": false, "masked": "" })),
    }
}

/// OS keychain에서 API 키 원본 로드 (sidecar 전달용 — 프론트엔드에 노출 안 됨)
pub fn load_api_key_raw() -> Option<String> {
    let entry = keyring::Entry::new(SERVICE, USER).ok()?;
    entry.get_password().ok().filter(|k| !k.is_empty())
}

/// Keychain에서 API 키를 읽어 sidecar에 전달 (프론트엔드 호출용)
#[tauri::command]
pub async fn sync_api_key_to_sidecar(
    manager: tauri::State<'_, std::sync::Arc<crate::sidecar::manager::SidecarManager>>,
) -> Result<bool, crate::error::AppError> {
    match load_api_key_raw() {
        Some(api_key) => {
            let params = serde_json::json!({
                "settings": { "gemini": { "api_key": api_key } }
            });
            manager.call("update_settings", Some(params)).await?;
            tracing::info!("API key synced from keychain to sidecar");
            Ok(true)
        }
        None => Ok(false),
    }
}

/// API 키 삭제
#[tauri::command]
pub async fn delete_api_key() -> Result<(), crate::error::AppError> {
    let entry = keyring::Entry::new(SERVICE, USER)
        .map_err(|e| crate::error::AppError::Sidecar(format!("Keychain 초기화 실패: {e}")))?;
    let _ = entry.delete_credential();
    Ok(())
}
