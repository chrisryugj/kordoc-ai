mod commands;
mod error;
mod sidecar;

use sidecar::manager::SidecarManager;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = SidecarManager::new();
    let mgr_for_setup = Arc::clone(&manager);
    let mgr_for_exit = Arc::clone(&manager);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .manage(manager)
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_cmd::sidecar_status,
            commands::sidecar_cmd::sidecar_call,
            commands::sidecar_cmd::sidecar_start,
            commands::settings::get_settings,
            commands::settings::update_settings,
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
                mgr_for_setup.set_app_handle(handle).await;
                if let Err(e) = mgr_for_setup.start().await {
                    tracing::error!("Failed to start sidecar: {}", e);
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
            }
        });
}
