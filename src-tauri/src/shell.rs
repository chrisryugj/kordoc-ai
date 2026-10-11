//! 우클릭 메뉴(Windows 탐색기·macOS Finder) + 밖에서 들어온 파일 묶기.
//!
//! - Windows: HKCU\Software\Classes\SystemFileAssociations\<확장자>\shell\KorDoc 계단식 메뉴.
//!   관리자 권한·인증서 불필요, 기본 연결 프로그램(한컴 등)은 건드리지 않는다.
//!   (Win11 상단 메뉴가 필요하면 shell/windows 의 MSIX 패키지를 따로 쓴다.)
//! - macOS: ~/Library/Services 에 Finder 빠른 동작(.workflow) — kordoc:// 주소를 연다.
//! - 실행 인자(`--shell <동작> <파일…>`)·kordoc:// 주소·Finder "다음으로 열기"는 전부
//!   ShellCollector 로 모아, 같은 동작으로 0.4초 안에 들어온 파일을 한 묶음으로 프론트에 넘긴다.
//!   (탐색기는 여러 파일 선택 시 명령을 파일마다 따로 부른다. 화면이 아직 구독 전이면 쌓아 두었다가
//!   화면이 shell_take_pending 으로 받아 간다)

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

pub const ACTIONS: &[(&str, &str)] = &[
    ("open", "앱에서 열기"),
    ("convert", "글(마크다운)로 바꾸기"),
    ("pdf", "PDF로 내보내기"),
    ("redact", "개인정보 가리기"),
    ("summarize", "AI로 요약하기"),
];

#[cfg_attr(not(windows), allow(dead_code))]
const EXTS: &[&str] = &[
    ".hwp", ".hwpx", ".hwpml", ".pdf", ".docx", ".xls", ".xlsx", ".pptx", ".png", ".jpg", ".jpeg",
];

/// 확장자별 메뉴 키. 설치 프로그램의 제거 훅(windows/hooks.nsh)도 같은 키를 지운다 (테스트가 맞춰 본다)
#[cfg_attr(not(windows), allow(dead_code))]
fn key(ext: &str) -> String {
    format!(r"HKCU\Software\Classes\SystemFileAssociations\{}\shell\KorDoc", ext)
}

fn is_action(a: &str) -> bool {
    ACTIONS.iter().any(|(id, _)| *id == a)
}

// ── 들어온 파일 묶기 ──

#[derive(Default)]
pub struct ShellCollector {
    queue: Mutex<Vec<(String, String)>>,
    armed: Mutex<bool>,
    inbox: Mutex<Inbox>,
}

/// Tauri 이벤트는 화면이 구독하기 전에 나가면 그대로 사라진다. 앱이 꺼져 있다 우클릭·더블클릭·kordoc:// 로
/// 켜지면 첫 동작이 화면보다 먼저 와서 없어졌다 → 화면이 shell_take_pending 을 부를 때까지 여기 모아 둔다
#[derive(Default)]
struct Inbox {
    ready: bool,
    pending: Vec<Delivery>,
}

/// 화면으로 보낼 이벤트 하나 (이름·내용은 실시간 이벤트와 같다: deep-link 는 주소, open-files 는 경로 목록)
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Delivery {
    event: &'static str,
    payload: serde_json::Value,
}

impl ShellCollector {
    pub fn push(&self, app: &AppHandle, action: &str, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        {
            let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
            q.extend(paths.into_iter().map(|p| (action.to_string(), p)));
        }
        let mut armed = self.armed.lock().unwrap_or_else(|e| e.into_inner());
        if *armed {
            return;
        }
        *armed = true;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            use tauri::Manager;
            let me = app.state::<ShellCollector>();
            let items = std::mem::take(&mut *me.queue.lock().unwrap_or_else(|e| e.into_inner()));
            *me.armed.lock().unwrap_or_else(|e| e.into_inner()) = false;
            flush(&app, items);
        });
    }

    /// 화면이 준비 전이면 쌓고 None, 준비됐으면 그대로 돌려준다 (보내기는 부른 쪽)
    fn hold(&self, d: Delivery) -> Option<Delivery> {
        let mut inbox = self.inbox.lock().unwrap_or_else(|e| e.into_inner());
        if inbox.ready {
            return Some(d);
        }
        inbox.pending.push(d);
        None
    }

    /// 화면이 구독을 마친 뒤 한 번 부른다: 쌓인 것을 넘기고, 그 뒤로는 바로 보낸다
    fn take_pending(&self) -> Vec<Delivery> {
        let mut inbox = self.inbox.lock().unwrap_or_else(|e| e.into_inner());
        inbox.ready = true;
        std::mem::take(&mut inbox.pending)
    }
}

/// 화면으로 이벤트 보내기. 화면이 아직 구독 전이면 쌓아 두고 shell_take_pending 으로 넘긴다
pub fn deliver(app: &AppHandle, event: &'static str, payload: serde_json::Value) {
    use tauri::Manager;
    if let Some(d) = app.state::<ShellCollector>().hold(Delivery { event, payload }) {
        let _ = app.emit(d.event, d.payload);
    }
}

/// 화면(useDeepLink)이 deep-link·open-files 구독을 마친 뒤 한 번 부른다
#[tauri::command]
pub fn shell_take_pending(collector: tauri::State<'_, ShellCollector>) -> Vec<Delivery> {
    collector.take_pending()
}

fn flush(app: &AppHandle, items: Vec<(String, String)>) {
    // 동작별로 묶되 들어온 순서 유지
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for (action, path) in items {
        match groups.iter_mut().find(|(a, _)| *a == action) {
            Some((_, v)) => {
                if !v.contains(&path) {
                    v.push(path)
                }
            }
            None => groups.push((action, vec![path])),
        }
    }
    for (action, paths) in groups {
        if action == "open" {
            deliver(app, "open-files", paths.into());
        } else if paths.len() == 1 {
            let url = format!("kordoc://{}?path={}", action, urlencoding::encode(&paths[0]));
            deliver(app, "deep-link", url.into());
        } else {
            match write_manifest(&action, &paths) {
                Ok(m) => {
                    let url = format!("kordoc://batch?manifest={}", urlencoding::encode(&m.to_string_lossy()));
                    deliver(app, "deep-link", url.into());
                }
                Err(e) => tracing::error!("batch manifest 쓰기 실패: {}", e),
            }
        }
    }
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// 사이드카 read_batch_manifest 가 읽는 형식: 임시 폴더의 kordoc-batch-<ms>.json
fn write_manifest(action: &str, files: &[String]) -> std::io::Result<PathBuf> {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("kordoc-batch-{}.json", ms));
    let body = serde_json::json!({ "action": action, "files": files, "created_at": ms.to_string() });
    std::fs::write(&path, serde_json::to_vec_pretty(&body)?)?;
    Ok(path)
}

/// 실행 인자 → (동작, 파일들). `--shell <동작> <파일…>` 또는 파일만(= open)
pub fn parse_args(args: &[String]) -> Option<(String, Vec<String>)> {
    let rest: Vec<&String> = args.iter().skip(1).collect();
    if rest.is_empty() {
        return None;
    }
    if rest[0] == "--shell" && rest.len() >= 3 && is_action(rest[1]) {
        return Some((rest[1].clone(), rest[2..].iter().map(|s| s.to_string()).collect()));
    }
    let files: Vec<String> = rest
        .iter()
        .filter(|a| !a.starts_with("-") && !a.starts_with("kordoc:") && std::path::Path::new(a.as_str()).is_file())
        .map(|s| s.to_string())
        .collect();
    (!files.is_empty()).then(|| ("open".to_string(), files))
}

/// kordoc://<동작>?path=… 이면 (동작, 경로). batch 등 그 밖은 None(그대로 프론트로)
pub fn parse_action_url(url: &str) -> Option<(String, String)> {
    let u = tauri::Url::parse(url).ok()?;
    if u.scheme() != "kordoc" {
        return None;
    }
    let action = u.host_str().unwrap_or_default().to_string();
    if !is_action(&action) {
        return None;
    }
    let path = u.query_pairs().find(|(k, _)| k == "path").map(|(_, v)| v.into_owned())?;
    Some((action, path))
}

// ── 메뉴 설치 ──

#[derive(serde::Serialize)]
pub struct MenuStatus {
    supported: bool,
    installed: bool,
    /// "registry"(Windows) · "quick-action"(macOS) · "none"
    kind: &'static str,
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn reg(args: &[&str]) -> Result<(), String> {
        let out = std::process::Command::new("reg")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }

    pub fn status() -> MenuStatus {
        MenuStatus { supported: true, installed: reg(&["query", &key(".hwpx")]).is_ok(), kind: "registry" }
    }

    pub fn install() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe.to_string_lossy().trim_start_matches(r"\\?\").to_string();
        for ext in EXTS {
            let base = key(ext);
            reg(&["add", &base, "/v", "MUIVerb", "/d", "KorDoc AI", "/f"])?;
            reg(&["add", &base, "/v", "Icon", "/d", &format!("\"{}\",0", exe), "/f"])?;
            reg(&["add", &base, "/v", "SubCommands", "/d", "", "/f"])?;
            for (i, (id, label)) in ACTIONS.iter().enumerate() {
                if *id == "pdf" && *ext == ".pdf" {
                    continue;
                }
                let sub = format!(r"{}\shell\{}{}", base, i + 1, id);
                reg(&["add", &sub, "/ve", "/d", label, "/f"])?;
                let cmd = format!("\"{}\" --shell {} \"%1\"", exe, id);
                reg(&["add", &format!(r"{}\command", sub), "/ve", "/d", &cmd, "/f"])?;
            }
        }
        Ok(())
    }

    pub fn uninstall() -> Result<(), String> {
        for ext in EXTS {
            let _ = reg(&["delete", &key(ext), "/f"]);
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    const WFLOW: &str = include_str!("../resources/quick-action/document.wflow");

    fn services_dir() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Services"))
    }

    fn bundle_name(label: &str) -> String {
        format!("KorDoc - {}.workflow", label)
    }

    fn xml_escape(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    }

    pub fn status() -> MenuStatus {
        let installed = services_dir()
            .map(|d| d.join(bundle_name(ACTIONS[1].1)).exists())
            .unwrap_or(false);
        MenuStatus { supported: true, installed, kind: "quick-action" }
    }

    pub fn install() -> Result<(), String> {
        let dir = services_dir().ok_or("사용자 폴더를 찾을 수 없습니다")?;
        for (id, label) in ACTIONS {
            let root = dir.join(bundle_name(label)).join("Contents");
            std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            let script = format!(
                r#"/usr/bin/osascript -l JavaScript -e 'function run(argv){{var a=Application.currentApplication();a.includeStandardAdditions=true;argv.forEach(function(p){{a.openLocation("kordoc://{}?path="+encodeURIComponent(p))}})}}' "$@""#,
                id
            );
            std::fs::write(root.join("document.wflow"), WFLOW.replace("__COMMAND__", &xml_escape(&script)))
                .map_err(|e| e.to_string())?;
            let plist = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict><key>default</key><string>KorDoc AI: {}</string></dict>
			<key>NSMessage</key><string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict>
			<key>NSSendFileTypes</key>
			<array><string>public.item</string></array>
		</dict>
	</array>
</dict>
</plist>
"#,
                xml_escape(label)
            );
            std::fs::write(root.join("Info.plist"), plist).map_err(|e| e.to_string())?;
        }
        let _ = std::process::Command::new("/System/Library/CoreServices/pbs").arg("-flush").status();
        Ok(())
    }

    pub fn uninstall() -> Result<(), String> {
        let dir = services_dir().ok_or("사용자 폴더를 찾을 수 없습니다")?;
        for (_, label) in ACTIONS {
            let _ = std::fs::remove_dir_all(dir.join(bundle_name(label)));
        }
        let _ = std::process::Command::new("/System/Library/CoreServices/pbs").arg("-flush").status();
        Ok(())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::*;
    pub fn status() -> MenuStatus {
        MenuStatus { supported: false, installed: false, kind: "none" }
    }
    pub fn install() -> Result<(), String> {
        Err("이 운영체제에서는 우클릭 메뉴를 쓸 수 없습니다".into())
    }
    pub fn uninstall() -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn shell_menu_status() -> MenuStatus {
    platform::status()
}

#[tauri::command]
pub fn shell_menu_install() -> Result<MenuStatus, String> {
    platform::install()?;
    Ok(platform::status())
}

#[tauri::command]
pub fn shell_menu_uninstall() -> Result<MenuStatus, String> {
    platform::uninstall()?;
    Ok(platform::status())
}

/// 화면 없이 우클릭 메뉴 넣기·빼기·상태 — 기관 배포 스크립트용 (`kordoc-ai.exe --shell-menu install`).
/// 창을 띄우기 전에 처리하고 종료 코드를 돌려준다. 해당 인자가 없으면 None.
pub fn cli_shell_menu(args: &[String]) -> Option<i32> {
    let i = args.iter().position(|a| a == "--shell-menu")?;
    let result = match args.get(i + 1).map(String::as_str) {
        Some("install") => platform::install().map(|_| "우클릭 메뉴를 넣었습니다."),
        Some("uninstall") => platform::uninstall().map(|_| "우클릭 메뉴를 뺐습니다."),
        Some("status") => Ok(if platform::status().installed { "우클릭 메뉴가 들어 있습니다." } else { "우클릭 메뉴가 없습니다." }),
        _ => Err("사용법: --shell-menu install | uninstall | status".to_string()),
    };
    Some(match result {
        Ok(msg) => {
            println!("{msg}");
            0
        }
        Err(e) => {
            eprintln!("{e}");
            1
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_shell_args() {
        let a = vec!["app".into(), "--shell".into(), "redact".into(), "C:\\a.hwp".into()];
        assert_eq!(parse_args(&a), Some(("redact".into(), vec!["C:\\a.hwp".into()])));
        assert_eq!(parse_args(&["app".into(), "--shell".into(), "evil".into(), "x".into()]), None);
    }

    #[test]
    fn parses_action_url() {
        let u = "kordoc://convert?path=%2FUsers%2F%ED%99%8D%2Fa.hwpx";
        assert_eq!(parse_action_url(u), Some(("convert".into(), "/Users/홍/a.hwpx".into())));
        assert_eq!(parse_action_url("kordoc://batch?manifest=x"), None);
    }

    #[test]
    fn holds_events_until_screen_takes_them() {
        let c = ShellCollector::default();
        let link = |u: &str| Delivery { event: "deep-link", payload: u.into() };
        let files = Delivery { event: "open-files", payload: serde_json::json!(["C:\\a.hwp"]) };
        // 화면 구독 전(꺼진 앱이 우클릭으로 켜진 직후): 보내지 않고 쌓는다
        assert_eq!(c.hold(link("kordoc://convert?path=a")), None);
        assert_eq!(c.hold(files.clone()), None);
        // 화면이 한 번 받아 간다: 들어온 순서대로, 실시간 이벤트와 같은 모양
        let taken = c.take_pending();
        assert_eq!(taken, vec![link("kordoc://convert?path=a"), files]);
        assert_eq!(
            serde_json::to_value(&taken[0]).unwrap(),
            serde_json::json!({ "event": "deep-link", "payload": "kordoc://convert?path=a" })
        );
        // 그 뒤로는 바로 보낸다 (다시 받아 가도 빈 목록)
        assert_eq!(c.hold(link("kordoc://pdf?path=b")), Some(link("kordoc://pdf?path=b")));
        assert!(c.take_pending().is_empty());
    }

    #[test]
    fn uninstaller_removes_every_menu_key() {
        // NSIS 제거 훅이 shell.rs 가 만드는 키를 빠짐없이 지우는지 (확장자를 늘리면 hooks.nsh 도 같이)
        let nsh = include_str!("../windows/hooks.nsh");
        for ext in EXTS {
            let sub = key(ext).strip_prefix(r"HKCU\").unwrap().to_string();
            assert!(nsh.contains(&format!(r#"DeleteRegKey HKCU "{}""#, sub)), "hooks.nsh 에 {} 메뉴 지우기가 없습니다", ext);
        }
    }
}
