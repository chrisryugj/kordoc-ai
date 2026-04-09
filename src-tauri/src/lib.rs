mod commands;
mod error;
mod sidecar;

use sidecar::manager::SidecarManager;
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = SidecarManager::new();
    let mgr_for_setup = Arc::clone(&manager);
    let mgr_for_exit = Arc::clone(&manager);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(manager)
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_cmd::sidecar_status,
            commands::sidecar_cmd::sidecar_call,
            commands::sidecar_cmd::sidecar_start,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::clipboard::save_clipboard_image,
            commands::clipboard::save_clipboard_text,
            commands::keychain::store_api_key,
            commands::keychain::load_api_key,
            commands::keychain::delete_api_key,
            commands::keychain::sync_api_key_to_sidecar,
        ])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .ok_or("main 윈도우를 찾을 수 없습니다")?;
            // Debug 빌드: F12 DevTools 자동 열기
            #[cfg(debug_assertions)]
            window.open_devtools();
            let _ = window.show();

            let handle = app.handle().clone();

            // Auto-start Node.js sidecar in background
            tauri::async_runtime::spawn(async move {
                mgr_for_setup.set_app_handle(handle.clone()).await;
                if let Err(e) = mgr_for_setup.start().await {
                    tracing::error!("Failed to start sidecar: {}", e);
                    let _ = handle.emit("sidecar:error", e.to_string());
                    return;
                }

                // Keychain에서 API 키 로드 → sidecar에 전달
                match commands::keychain::load_api_key_raw() {
                    Some(api_key) => {
                        let params = serde_json::json!({
                            "settings": { "gemini": { "api_key": api_key } }
                        });
                        if let Err(e) = mgr_for_setup.call("update_settings", Some(params)).await {
                            tracing::warn!("Failed to send API key to sidecar: {}", e);
                        } else {
                            tracing::info!("API key loaded from keychain and sent to sidecar");
                        }
                    }
                    None => {
                        // 마이그레이션: settings.yaml에 api_key가 있으면 keychain으로 이전
                        if let Ok(resp) = mgr_for_setup.call("get_settings", None).await {
                            if let Some(result) = resp.result.as_ref() {
                                if let Some(key) = result.pointer("/gemini/api_key")
                                    .and_then(|v| v.as_str())
                                    .filter(|k| !k.is_empty() && !k.contains("****"))
                                {
                                    let key_owned = key.to_string();
                                    if let Ok(entry) = keyring::Entry::new("kordoc-ai", "gemini-api-key") {
                                        if entry.set_password(&key_owned).is_ok() {
                                            tracing::info!("API key migrated from settings.yaml to keychain");
                                            // sidecar에도 다시 전달 (메모리에 유지)
                                            let params = serde_json::json!({
                                                "settings": { "gemini": { "api_key": key_owned } }
                                            });
                                            let _ = mgr_for_setup.call("update_settings", Some(params)).await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building KorDoc AI")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                // Graceful sidecar shutdown — orphan process 방지
                let mgr = mgr_for_exit.clone();
                tauri::async_runtime::block_on(async move {
                    mgr.stop().await;
                });

                // 클립보드 임시 파일 정리
                let temp_dir = std::env::temp_dir().join("kordoc-ai");
                if temp_dir.exists() {
                    let _ = std::fs::remove_dir_all(&temp_dir);
                }
            }
        });
}
