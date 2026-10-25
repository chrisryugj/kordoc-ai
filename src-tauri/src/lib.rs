mod commands;
mod error;
mod secrets;
mod shell;
mod sidecar;

use shell::ShellCollector;
use sidecar::manager::SidecarManager;
use std::sync::Arc;

/** 트레이 "완전 종료"를 마지막으로 누른 때(초) — 화면이 답하지 않을 때 두 번째 누름은 바로 끈다 */
static QUIT_ASKED_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 화면이 저장 안 한 것을 다 물은 뒤 부르는 완전 종료
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 화면이 종료를 묻고 사용자가 취소했다 — 다음 "완전 종료"도 다시 묻게 시계를 되돌린다
#[tauri::command]
fn quit_cancelled() {
    QUIT_ASKED_AT.store(0, std::sync::atomic::Ordering::SeqCst);
}
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;

use shell::show_main;

/// kordoc:// 주소 하나 처리 — 동작 주소(우클릭 메뉴 동작)는 묶음 수집기로, 그 밖(batch 매니페스트 등)은 그대로 프론트로
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
            } else if !args.iter().any(|a| a.starts_with("kordoc:")) {
                // kordoc:// 주소는 deep-link 플러그인이 따로 넘긴다 (빠른 동작이면 창을 띄우지 않게 여기서 열지 않는다)
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        // 창 보이기는 앱이 정한다 (플러그인이 띄우면 우클릭 빠른 동작으로 켤 때도 창이 뜬다)
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE)
                .build(),
        )
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
            shell::shell_show,
            shell::shell_quick_done,
            quit_app,
            quit_cancelled,
        ])
        .setup(move |app| {
            let window = app.get_webview_window("main").ok_or("main 윈도우를 찾을 수 없습니다")?;
            #[cfg(debug_assertions)]
            window.open_devtools();

            let handle = app.handle().clone();

            // 비-MSIX 설치본·개발 실행은 OS 에 kordoc:// 가 등록돼 있지 않을 수 있어 런타임 등록
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            if let Err(e) = app.deep_link().register_all() {
                tracing::warn!("deep-link register_all 실패 (무시 가능): {}", e);
            }

            // 첫 실행 인자 (우클릭 메뉴 `--shell <동작> <파일>` · 파일을 앱으로 열기).
            // 빠른 동작(창 없이 돌고 알림만)으로 켜졌으면 창을 띄우지 않는다
            let args: Vec<String> = std::env::args().collect();
            let first = shell::parse_args(&args);
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            let first_urls: Vec<String> = app.deep_link().get_current().ok().flatten().unwrap_or_default().iter().map(|u| u.to_string()).collect();
            #[cfg(not(any(target_os = "linux", target_os = "windows")))]
            let first_urls: Vec<String> = Vec::new();
            let quick_start = first.as_ref().map(|(a, _)| shell::is_quick(a)).unwrap_or(false)
                || (!first_urls.is_empty() && first_urls.iter().all(|u| shell::parse_action_url(u).map(|(a, _)| shell::is_quick(&a)).unwrap_or(false)));
            if quick_start {
                shell::mark_cold_quick();
            } else if cfg!(target_os = "macos") {
                // macOS Finder 빠른 동작은 주소가 켜진 뒤(RunEvent::Opened)에 온다 → 잠깐 기다려 빠른 동작이 아니면 연다
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(450)).await;
                    if !shell::cold_quick() {
                        show_main(&h);
                    }
                });
            } else {
                show_main(&handle);
            }
            if let Some((action, paths)) = first {
                app.state::<ShellCollector>().push(&handle, &action, paths);
            }
            // 깔린 우클릭 메뉴가 옛 판이면 새 항목으로 (뒤에서)
            shell::refresh_menu_if_stale();

            let handle_for_deep = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    tracing::info!("deep-link 수신: {}", url);
                    route_url(&handle_for_deep, url.as_str());
                }
            });

            // 꺼진 앱이 kordoc:// 로 켜졌을 때: 플러그인은 실행 인자의 주소를 위 구독보다 먼저 알려서 그 알림은 사라진다 → 직접 꺼낸다.
            // (macOS 는 같은 주소가 RunEvent::Opened 로 따로 와서 아래 run 에서 받는다. 여기서도 꺼내면 두 번 처리된다)
            for url in first_urls {
                tracing::info!("deep-link 첫 실행: {}", url);
                route_url(&handle, &url);
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
                    // 화면에 먼저 묻는다(저장 안 한 문서). 화면이 답하지 못하는 경우를 위해 10초 안에 한 번 더 누르면 바로 끈다
                    "tray-quit" => {
                        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                        let last = QUIT_ASKED_AT.swap(now, std::sync::atomic::Ordering::SeqCst);
                        if last != 0 && now.saturating_sub(last) < 10 {
                            app.exit(0);
                        } else {
                            show_main(app);
                            let _ = app.emit("quit-requested", ());
                        }
                    }
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
            // 창이 초점을 받았다 = 사용자가 보고 있다 (빠른 동작 뒤 끄지 않는다)
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Focused(true), .. } if label == "main" => shell::mark_shown(),
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
