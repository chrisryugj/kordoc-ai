mod commands;
mod error;
mod sidecar;

use sidecar::manager::SidecarManager;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = SidecarManager::new();
    let mgr_for_setup = Arc::clone(&manager);
    let mgr_for_exit = Arc::clone(&manager);

    tauri::Builder::default()
        // single-instance: 두 번째 실행 → 첫 인스턴스로 args 전달.
        // features=["deep-link"] 활성화 시 plugin 내부에서 kordoc:// args를 deep-link plugin의
        // on_open_url 콜백으로 자동 전달함. 여기서는 윈도우 포커스 복귀만 처리.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
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
        ])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .ok_or("main 윈도우를 찾을 수 없습니다")?;
            #[cfg(debug_assertions)]
            window.open_devtools();
            let _ = window.show();

            let handle = app.handle().clone();

            // dev/Linux 빌드는 OS 등록이 안 돼 있으므로 런타임에 register.
            // 프로덕션 Windows는 MSIX Sparse Package(kordoc-shell)가 처리하지만,
            // 비-MSIX 직접 설치 빌드를 위해 release Windows에서도 한 번 호출.
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            {
                if let Err(e) = app.deep_link().register_all() {
                    tracing::warn!("deep-link register_all 실패 (무시 가능): {}", e);
                }
            }

            // deep-link 수신 → 프론트엔드 emit.
            // cold-start (앱이 deep-link로 처음 깨어남) + warm (single-instance 경로) 모두 처리.
            let handle_for_deep = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let url_str = url.to_string();
                    tracing::info!("deep-link 수신: {}", url_str);
                    if let Err(e) = handle_for_deep.emit("deep-link", url_str) {
                        tracing::error!("deep-link emit 실패: {}", e);
                    }
                }
                // deep-link 수신 시 윈도우 복귀
                if let Some(window) = handle_for_deep.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });

            // System tray — 윈도우 닫아도 백그라운드 sidecar 유지.
            //   좌클릭: 윈도우 토글 (없으면 표시)
            //   메뉴: Show / Hide / Quit
            let show_item = MenuItem::with_id(app, "tray-show", "창 열기", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "tray-hide", "창 숨기기", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray-quit", "완전 종료", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _ = TrayIconBuilder::with_id("kordoc-ai-tray")
                .tooltip("KorDoc AI")
                .icon(app.default_window_icon().cloned().ok_or("default icon 없음")?)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app: &tauri::AppHandle, event| match event.id.as_ref() {
                    "tray-show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "tray-hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "tray-quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon<tauri::Wry>, event: TrayIconEvent| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let visible = w.is_visible().unwrap_or(false);
                            if visible {
                                let _ = w.hide();
                            } else {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Auto-start Node.js sidecar in background
            tauri::async_runtime::spawn(async move {
                mgr_for_setup.set_app_handle(handle.clone()).await;
                if let Err(e) = mgr_for_setup.start().await {
                    tracing::error!("Failed to start sidecar: {}", e);
                    let _ = handle.emit("sidecar:error", e.to_string());
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building KorDoc AI")
        .run(move |app, event| {
            match event {
                tauri::RunEvent::Exit => {
                    // Graceful sidecar shutdown — orphan process 방지
                    let mgr = mgr_for_exit.clone();
                    tauri::async_runtime::block_on(async move {
                        mgr.stop().await;
                    });
                }
                // 윈도우 X 클릭 시 종료 대신 tray 로 hide (sidecar 백그라운드 유지).
                // 완전 종료는 tray 메뉴 "완전 종료" 또는 OS exit 신호.
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                } if label == "main" => {
                    api.prevent_close();
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
                _ => {}
            }
        });
}
