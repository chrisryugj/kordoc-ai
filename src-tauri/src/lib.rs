mod commands;
mod error;
mod shell;
mod sidecar;

use shell::ShellCollector;
use sidecar::manager::SidecarManager;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// kordoc:// 주소 하나 처리 — 동작 주소(open·convert·pdf·redact·summarize)는 묶음 수집기로,
/// 그 밖(batch 매니페스트 등)은 그대로 프론트로
fn route_url(app: &tauri::AppHandle, url: &str) {
    match shell::parse_action_url(url) {
        Some((action, path)) => app.state::<ShellCollector>().push(app, &action, vec![path]),
        None => {
            shell::deliver(app, "deep-link", url.into());
            show_main(app);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(code) = shell::cli_shell_menu(&std::env::args().collect::<Vec<_>>()) {
        std::process::exit(code);
    }
    let manager = SidecarManager::new();
    let mgr_for_setup = Arc::clone(&manager);
    let mgr_for_exit = Arc::clone(&manager);

    tauri::Builder::default()
        // 두 번째 실행(우클릭 메뉴·파일 더블클릭) → 첫 인스턴스로 인자 전달.
        // features=["deep-link"] 라 kordoc:// 인자는 deep-link 플러그인 on_open_url 로 간다.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some((action, paths)) = shell::parse_args(&args) {
                app.state::<ShellCollector>().push(app, &action, paths);
            } else {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(manager)
        .manage(ShellCollector::default())
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_cmd::sidecar_status,
            commands::sidecar_cmd::sidecar_call,
            commands::sidecar_cmd::sidecar_start,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::clipboard::save_clipboard_image,
            commands::clipboard::save_clipboard_text,
            shell::shell_menu_status,
            shell::shell_menu_install,
            shell::shell_menu_uninstall,
            shell::shell_take_pending,
        ])
        .setup(move |app| {
            let window = app.get_webview_window("main").ok_or("main 윈도우를 찾을 수 없습니다")?;
            #[cfg(debug_assertions)]
            window.open_devtools();
            let _ = window.show();

            let handle = app.handle().clone();

            // 비-MSIX 설치본·개발 실행은 OS 에 kordoc:// 가 등록돼 있지 않을 수 있어 런타임 등록
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            if let Err(e) = app.deep_link().register_all() {
                tracing::warn!("deep-link register_all 실패 (무시 가능): {}", e);
            }

            // 첫 실행 인자 (우클릭 메뉴 `--shell <동작> <파일>` · 파일을 앱으로 열기)
            let args: Vec<String> = std::env::args().collect();
            if let Some((action, paths)) = shell::parse_args(&args) {
                app.state::<ShellCollector>().push(&handle, &action, paths);
            }

            let handle_for_deep = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    tracing::info!("deep-link 수신: {}", url);
                    route_url(&handle_for_deep, url.as_str());
                }
            });

            // 꺼진 앱이 kordoc:// 로 켜졌을 때: 플러그인은 실행 인자의 주소를 위 구독보다 먼저 알려서 그 알림은 사라진다 → 직접 꺼낸다.
            // (macOS 는 같은 주소가 RunEvent::Opened 로 따로 와서 아래 run 에서 받는다. 여기서도 꺼내면 두 번 처리된다)
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    tracing::info!("deep-link 첫 실행: {}", url);
                    route_url(&handle, url.as_str());
                }
            }

            // 트레이 — 창을 닫아도 엔진(사이드카)은 살아 있다 (폴더 감시·일괄 작업)
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
                    "tray-show" => show_main(app),
                    "tray-hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon<tauri::Wry>, event: TrayIconEvent| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                show_main(app);
                            }
                        }
                    }
                })
                .build(app)?;

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
        .run(move |app, event| match event {
            tauri::RunEvent::Exit => {
                let mgr = mgr_for_exit.clone();
                tauri::async_runtime::block_on(async move { mgr.stop().await });
            }
            // 창 X → 트레이로 숨김 (완전 종료는 트레이 메뉴)
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
                api.prevent_close();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            // macOS Finder "다음으로 열기"·Dock 끌어다 놓기
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                let others: Vec<String> = urls.iter().filter(|u| u.scheme() == "kordoc").map(|u| u.to_string()).collect();
                if !paths.is_empty() {
                    app.state::<ShellCollector>().push(app, "open", paths);
                }
                for u in others {
                    route_url(app, &u);
                }
            }
            // macOS Dock 아이콘 누름: 창을 X 로 닫아(숨겨) 둔 뒤에도 다시 연다
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main(app),
            _ => {}
        });
}
