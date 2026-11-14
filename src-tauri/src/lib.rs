mod commands;
mod error;
mod secrets;
mod shell;
mod sidecar;

use shell::ShellCollector;
use sidecar::manager::SidecarManager;
use std::sync::Arc;

/** 완전 종료(트레이 "완전 종료"·맥 ⌘Q)를 마지막으로 누른 때(초). 화면이 답하면(quit_app·quit_cancelled) 끝난다 */
static QUIT_ASKED_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/** 화면에 묻는 상자가 떠 있는지 본 차례와, 떠 있다고 답한 차례 */
static QUIT_PROBE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static QUIT_STILL_ASKING: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

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

/// force_quit_unless_asking 이 화면에 돌린 글이 부른다: 아직 묻는 중이다 (묻는 상자가 떠 있거나, 상자 없이 저장하는 중).
/// 가장 큰 차례만 남긴다: 연달아 누르면 뒤 차례의 답이 앞 차례의 답을 덮는데, 앞 차례의 시계가 그것을 "답 없음"으로 읽고 껐다
#[tauri::command]
fn quit_still_asking(app: tauri::AppHandle, n: u64) {
    QUIT_STILL_ASKING.fetch_max(n, std::sync::atomic::Ordering::SeqCst);
    show_main(&app);
}

/// n 번째로 본 것에 화면이 "묻는 중"이라고 답했나 — 그 뒤 차례에 답했어도 묻는 중이다
fn answered_asking(answered: u64, n: u64) -> bool {
    answered >= n
}

/// 완전 종료 요청 (트레이 "완전 종료"·맥 앱 메뉴의 종료 ⌘Q): 화면에 먼저 묻는다(저장 안 한 문서).
/// 화면이 답하기 전에 10초 안에 또 누르면 화면이 멈춘 것일 수 있다: 묻는 상자가 떠 있으면 끄지 않고 창만 앞으로, 아니면 끈다
fn request_quit(app: &tauri::AppHandle) {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let last = QUIT_ASKED_AT.swap(now, std::sync::atomic::Ordering::SeqCst);
    if last != 0 && now.saturating_sub(last) < 10 {
        force_quit_unless_asking(app);
    } else {
        show_main(app);
        let _ = app.emit("quit-requested", ());
    }
}

/// 묻는 상자: 화면 `Modal`(src/components/ui/Modal.tsx)의 단추 줄. 종료 전 묻기(useAsk·편집 세션)는 모두 이 상자다 (시험이 맞춰 본다)
const ASKING: &str = r#"[aria-modal="true"] [data-modal-foot]"#;
/// 화면이 종료 전 묻기를 도는 동안 <html> 에 다는 표지 (src/hooks/useDeepLink.ts). 편집기는 상자 없이 저장부터 하고,
/// 묻는 상자에서 "저장"을 고른 뒤에도 저장이 돈다: 그사이 또 누른 완전 종료가 저장 중인 엔진을 끄지 않게
const QUIT_BUSY: &str = "data-quit-asking";

/// 화면이 아직 답하지 않았다: 사용자가 고르는 중인지(묻는 상자가 떠 있나), 상자 없이 저장하는 중인지(QUIT_BUSY) 본다.
/// 본창에 짧은 글을 돌려, 그렇다면 quit_still_asking 을 부르게 한다. 1.5초 안에 그 답이 없으면(오류 화면·화면 멈춤) 끈다
fn force_quit_unless_asking(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering::SeqCst;
    let n = QUIT_PROBE.fetch_add(1, SeqCst) + 1;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(format!(
            "(document.querySelector('{ASKING}')||document.documentElement.hasAttribute('{QUIT_BUSY}'))&&window.__TAURI_INTERNALS__.invoke('quit_still_asking',{{n:{n}}})"
        ));
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        // 묻는 중이라고 답했거나, 그사이 사용자가 취소했으면(시계 0) 끄지 않는다
        if !answered_asking(QUIT_STILL_ASKING.load(SeqCst), n) && QUIT_ASKED_AT.load(SeqCst) != 0 {
            app.exit(0);
        }
    });
}

/// macOS 앱 메뉴: Tauri 기본 메뉴와 같되 "종료"(⌘Q)만 우리 것. 기본 메뉴의 종료는 바로 앱을 꺼서 저장 안 한 것을 묻지 않았다.
/// 편집 메뉴(실행 취소·오려두기·복사·붙여넣기·모두 선택)는 그대로 둔다: 빠지면 맥에서 ⌘C·⌘V 가 안 된다
#[cfg(target_os = "macos")]
fn app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
    let info = app.package_info();
    let about = AboutMetadata { name: Some(info.name.clone()), version: Some(info.version.to_string()), copyright: app.config().bundle.copyright.clone(), ..Default::default() };
    let name = info.name.clone();
    let quit = MenuItem::with_id(app, "app-quit", format!("{name} 종료"), true, Some("CmdOrCtrl+Q"))?;
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                &name,
                true,
                &[
                    &PredefinedMenuItem::about(app, Some(&format!("{name}에 관하여")), Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, Some("서비스"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some(&format!("{name} 가리기")))?,
                    &PredefinedMenuItem::hide_others(app, Some("기타 가리기"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?,
            &Submenu::with_items(app, "파일", true, &[&PredefinedMenuItem::close_window(app, Some("윈도우 닫기"))?])?,
            &Submenu::with_items(
                app,
                "편집",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("실행 취소"))?,
                    &PredefinedMenuItem::redo(app, Some("실행 복귀"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some("오려두기"))?,
                    &PredefinedMenuItem::copy(app, Some("복사하기"))?,
                    &PredefinedMenuItem::paste(app, Some("붙여넣기"))?,
                    &PredefinedMenuItem::select_all(app, Some("모두 선택"))?,
                ],
            )?,
            &Submenu::with_items(app, "보기", true, &[&PredefinedMenuItem::fullscreen(app, Some("전체 화면"))?])?,
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                "윈도우",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some("최소화"))?,
                    &PredefinedMenuItem::maximize(app, Some("확대/축소"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, Some("윈도우 닫기"))?,
                ],
            )?,
        ],
    )
}
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;

use shell::show_main;

/// kordoc:// 주소 하나 처리 — 동작 주소(우클릭 메뉴 동작)·묶음 주소는 묶음 수집기로, 그 밖은 창만 연다
fn route_url(app: &tauri::AppHandle, url: &str) {
    // 이 PC 의 Finder 빠른 동작(표지)이 아니면 링크일 수 있다: 문서 카드는 띄우기만 하고 일은 누를 때 시작
    let push = |action: &str, paths: Vec<String>| {
        let c = app.state::<ShellCollector>();
        if shell::from_quick_action(url) {
            c.push(app, action, paths)
        } else {
            c.push_link(app, action, paths)
        }
    };
    if let Some((action, path)) = shell::routed_action(url) {
        push(&action, vec![path]);
        return;
    }
    // 묶음 주소는 목록을 여기서 읽어 한 파일 주소와 같은 규칙으로 돌린다. 화면에 주소를 그대로 넘기면 목록의 빠른 동작이 확인 없이 돈다.
    // 동작으로 읽지 못한 주소를 화면에 넘기지 않는 것도 같은 까닭 (Rust 와 화면의 풀이가 어긋나는 꼴이 곧 확인 없이 도는 길이 된다)
    match shell::is_batch_url(url).then(|| shell::routed_batch(url)).flatten() {
        Some((action, files)) if !files.is_empty() => push(&action, files),
        _ => show_main(app),
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

    let builder = tauri::Builder::default();
    // macOS 는 앱 메뉴를 정하지 않으면 Tauri 기본 메뉴가 깔리고, 그 "종료"(⌘Q)는 묻지 않고 바로 끈다
    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu).on_menu_event(|app, event| {
        if event.id().as_ref() == "app-quit" {
            request_quit(app);
        }
    });
    builder
        // 두 번째 실행(우클릭 메뉴·파일 더블클릭) → 첫 인스턴스로 인자 전달.
        // features=["deep-link"] 라 kordoc:// 인자는 deep-link 플러그인 on_open_url 로 간다.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some((action, paths)) = shell::parse_args(&args, std::path::Path::new(&cwd)) {
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
                // 카드 창(card-0, card-1 …)은 이름이 켤 때마다 다시 쓰이고 갈래마다 크기가 다르다: 앞 카드의 크기·자리를 물려받지 않게
                .with_filter(|label| !label.starts_with("card-"))
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
            shell::shell_toast_ok,
            shell::card_handoff,
            shell::card_close,
            quit_app,
            quit_cancelled,
            quit_still_asking,
        ])
        .setup(move |app| {
            let window = app.get_webview_window("main").ok_or("main 윈도우를 찾을 수 없습니다")?;
            #[cfg(debug_assertions)]
            window.open_devtools();

            let handle = app.handle().clone();

            // 붙여 넣은 글·그림의 임시 파일 가운데 오래된 것을 치운다
            commands::clipboard::sweep_old();

            // 비-MSIX 설치본·개발 실행은 OS 에 kordoc:// 가 등록돼 있지 않을 수 있어 런타임 등록.
            // 더 새 판이 걸어 둔 것이면 덮지 않는다 (남아 있던 옛 판 exe 를 한 번 켜면 주소가 그 exe 로 다시 걸렸다). 레지스트리 조회는 뒤에서
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            {
                let h = handle.clone();
                std::thread::spawn(move || {
                    if !shell::may_claim_links() {
                        return;
                    }
                    match h.deep_link().register_all() {
                        Ok(()) => shell::mark_links_claimed(),
                        Err(e) => tracing::warn!("deep-link register_all 실패 (무시 가능): {}", e),
                    }
                });
            }

            // 첫 실행 인자 (우클릭 메뉴 `--shell <동작> <파일>` · 파일을 앱으로 열기).
            // 빠른 동작(창 없이 돌고 알림만)으로 켜졌으면 창을 띄우지 않는다
            let args: Vec<String> = std::env::args().collect();
            let first = shell::parse_args(&args, &std::env::current_dir().unwrap_or_default());
            // macOS: 주소는 RunEvent::Opened 로 오고 플러그인이 그것을 아래 on_open_url 로 다시 쏜다. 구독을 걸기 전에 Opened 가 먼저 왔으면
            // 그 알림은 사라지고 get_current 에만 남는다 → 여기서 꺼낸다 (구독 뒤에 온 것은 여기서 비어 있어 두 번 돌지 않는다. 파일은 Opened 가 맡는다)
            let first_urls: Vec<String> =
                app.deep_link().get_current().ok().flatten().unwrap_or_default().iter().filter(|u| u.scheme() == "kordoc").map(|u| u.to_string()).collect();
            let quick_start = first.as_ref().map(|(a, _)| shell::is_quick(a)).unwrap_or(false)
                || (!first_urls.is_empty() && first_urls.iter().all(|u| shell::routed_action(u).map(|(a, _)| shell::is_quick(&a)).unwrap_or(false)));
            // 문서 카드(우클릭 "KorDoc AI에게 맡기기…"·"최종본 찾기")로 켜졌으면 본창은 띄우지 않고 작은 창만
            let card_start = first.as_ref().map(|(a, _)| shell::is_card(a)).unwrap_or(false);
            if quick_start {
                shell::mark_cold_quick();
            } else if card_start {
                // 카드 창은 묶음 뒤 open_card 가 띄운다. 마지막 카드를 닫으면 card_closed 가 앱을 끈다
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
            // 내 실행 인자를 넣었다: 그새 다른 프로세스가 넘긴 파일과 한 묶음으로 넘어간다
            shell::mark_primed();
            // 깔린 우클릭 메뉴가 옛 판이면 새 항목으로 (뒤에서)
            shell::refresh_menu_if_stale();

            let handle_for_deep = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    tracing::info!("deep-link 수신: {}", url);
                    route_url(&handle_for_deep, url.as_str());
                }
            });

            // 꺼진 앱이 kordoc:// 로 켜졌을 때: 플러그인은 실행 인자의 주소를 위 구독보다 먼저 알려서 그 알림은 사라진다 → 직접 꺼낸다
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
                    // 화면에 먼저 묻는다(저장 안 한 문서)
                    "tray-quit" => request_quit(app),
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

            // 엔진 주 스레드가 막히면 다시 켠다 (호출이 걸려 있을 때만 본다)
            mgr_for_setup.spawn_watchdog();
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
            // 문서 카드 창을 닫음 → 앱이 카드로 켜졌고 본창을 안 띄웠으면 끈다
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label.starts_with("card-") => shell::card_closed(app),
            // 창 X → 트레이로 숨김 (완전 종료는 트레이 메뉴)
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
                api.prevent_close();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            // 카드 창 X(맥 ⌘W): 그 창에 먼저 묻는다 (영수증 카드에서 고치던 표)
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label.starts_with("card-") => {
                if !shell::card_close_requested(app, &label) {
                    api.prevent_close();
                }
            }
            // macOS Finder "다음으로 열기"·Dock 끌어다 놓기. kordoc:// 주소는 여기서 다루지 않는다: deep-link 플러그인이 같은 Opened 를
            // on_open_url 로 다시 쏘아서, 여기서도 받으면 한 주소가 두 번 돌았다(카드가 [p, p], 묶음 동작이 두 번)
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if !paths.is_empty() {
                    app.state::<ShellCollector>().push(app, "open", paths);
                }
            }
            // macOS Dock 아이콘 누름: 창을 X 로 닫아(숨겨) 둔 뒤에도 다시 연다
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::{answered_asking, ASKING, QUIT_BUSY};

    #[test]
    fn quit_probe_finds_the_ask_boxes() {
        // 종료 전 묻기 상자(useAsk·편집 세션)는 Modal 이고, Modal 은 대화상자 안에 단추 줄(data-modal-foot)을 그린다
        let modal = include_str!("../../src/components/ui/Modal.tsx");
        let dialog = modal.find(r#"role="dialog" aria-modal="true""#).expect("Modal 대화상자");
        assert!(modal[dialog..].contains("data-modal-foot"), "Modal 단추 줄 표지가 바뀌면 lib.rs ASKING 도");
        for src in [include_str!("../../src/components/ui/useAsk.tsx"), include_str!("../../src/components/create/session.tsx")] {
            let at = src.find("<Modal").expect("묻기 상자가 Modal 이 아니다");
            assert!(src[at..].contains("footer="), "묻기 상자에 단추 줄이 없다");
        }
        assert!(ASKING.contains("aria-modal") && ASKING.contains("data-modal-foot") && !ASKING.contains('\''));
    }

    #[test]
    fn quit_probe_sees_the_screen_still_settling() {
        // 상자 없이 저장하는 중에도 화면이 표지를 단다 — 화면이 다는 이름과 여기서 보는 이름이 같아야 한다
        let hook = include_str!("../../src/hooks/useDeepLink.ts");
        assert!(hook.contains(&format!(r#"toggleAttribute("{QUIT_BUSY}""#)), "종료 전 묻는 중 표지가 바뀌면 lib.rs QUIT_BUSY 도");
        assert!(!QUIT_BUSY.contains('\''));
    }

    #[test]
    fn a_later_answer_still_counts_for_an_earlier_probe() {
        // 세 번 연달아 누름: 1번째 확인에 답한 뒤 2번째 확인에도 답했다 — 1번째 시계가 깨어 2를 보고 껐었다
        assert!(answered_asking(2, 1));
        assert!(answered_asking(2, 2));
        // 답한 뒤 상자가 닫혀 다음 확인에는 답이 없다 → 끈다
        assert!(!answered_asking(2, 3));
        assert!(!answered_asking(0, 1));
    }
}
