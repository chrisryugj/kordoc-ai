//! 우클릭 메뉴(Windows 탐색기·macOS Finder) + 밖에서 들어온 파일 묶기.
//!
//! - Windows: HKCU\Software\Classes\SystemFileAssociations\<확장자>\shell\KorDoc 계단식 메뉴(확장자마다 맞는 항목만),
//!   폴더는 Directory\shell·Directory\Background\shell. 관리자 권한·인증서 불필요, 기본 연결 프로그램(한컴 등)은 건드리지 않는다.
//!   (Win11 상단 메뉴가 필요하면 shell/windows 의 MSIX 패키지를 따로 쓴다.)
//! - macOS: ~/Library/Services 에 Finder 빠른 동작(.workflow) — kordoc:// 주소를 연다. 메뉴가 길어지지 않게 자주 쓰는 것만.
//! - 실행 인자(`--shell <동작> <파일…>`)·kordoc:// 주소·Finder "다음으로 열기"는 전부
//!   ShellCollector 로 모아, 같은 동작으로 0.4초 안에 들어온 파일을 한 묶음으로 프론트에 넘긴다.
//!   (탐색기는 여러 파일 선택 시 명령을 파일마다 따로 부른다. 화면이 아직 구독 전이면 쌓아 두었다가
//!   화면이 shell_take_pending 으로 받아 간다)
//! - 빠른 동작(quick)은 창을 띄우지 않는다: 화면이 숨은 채로 돌리고 알림만 낸다(src/lib/quick-actions.ts).
//!   꺼진 앱이 빠른 동작으로 켜졌으면 다 끝난 뒤 화면이 shell_quick_done 을 불러 앱을 끈다. 실패하면 화면이 shell_show 로 창을 연다.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

/// 우클릭 메뉴 동작 하나
pub struct Action {
    pub id: &'static str,
    /// 파일 메뉴 이름
    pub label: &'static str,
    /// 창 없이 돌고 알림만 (화면 src/lib/quick-actions.ts 의 QUICK_ACTIONS 와 같아야 한다: 시험이 맞춰 본다)
    pub quick: bool,
    /// 보일 확장자 (비면 EXTS 전부)
    only: &'static [&'static str],
    /// 안 보일 확장자
    skip: &'static [&'static str],
    /// 파일 메뉴에 (false 면 폴더 메뉴에만)
    files: bool,
    /// 폴더 메뉴 이름 (없으면 폴더 메뉴에 안 넣음)
    folder: Option<&'static str>,
    /// 앞에 구분선
    sep: bool,
    /// macOS 빠른 동작으로도 (Finder 메뉴가 길어지지 않게 자주 쓰는 것만)
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    mac: bool,
}

const HANGUL: &[&str] = &[".hwp", ".hwpx"];
const DOCS: &[&str] = &[".hwp", ".hwpx", ".hml", ".hwpml", ".docx", ".pdf"];
const IMAGES: &[&str] = &[".png", ".jpg", ".jpeg"];
const NONE: &[&str] = &[];

const fn act(id: &'static str, label: &'static str, quick: bool) -> Action {
    Action { id, label, quick, only: NONE, skip: NONE, files: true, folder: None, sep: false, mac: false }
}

pub const ACTIONS: &[Action] = &[
    Action { mac: true, ..act("open", "앱에서 열기", false) },
    Action { files: false, folder: Some("서무 도구에서 열기"), ..act("tools", "서무 도구에서 열기", false) },
    Action { only: HANGUL, ..act("edit", "한글 편집기로 고치기", false) },
    Action { only: DOCS, ..act("precheck", "결재 전 점검", false) },
    Action { folder: Some("PDF 하나로 합치기 (이름 차례)"), sep: true, mac: true, ..act("pdfmerge", "PDF 하나로 합치기", true) },
    Action { skip: &[".pdf"], folder: Some("모두 PDF로 저장"), mac: true, ..act("pdf", "PDF로 저장", true) },
    Action { mac: true, ..act("pdfwork", "PDF 쪽 정리 (나누기·뽑기·돌리기)", false) },
    Action { only: &[".pdf"], ..act("pdfsplit", "PDF 쪽마다 나누기", true) },
    Action { only: &[".pdf", ".hwp", ".hwpx", ".docx"], mac: true, ..act("shrink", "PDF 용량 줄이기", true) },
    Action { only: &[".pdf", ".hwp", ".hwpx"], ..act("pdfimages", "쪽마다 그림으로 저장", true) },
    Action { skip: &[".hwpx"], folder: Some("모두 한글 문서(HWPX)로"), sep: true, mac: true, ..act("hwpx", "한글 문서(HWPX)로 바꾸기", true) },
    Action { folder: Some("개인정보 모두 가리기"), mac: true, ..act("redact", "개인정보 가리기", true) },
    Action { skip: IMAGES, ..act("tables", "표를 엑셀로 뽑기", true) },
    Action { ..act("convert", "글(마크다운)로 바꾸기", true) },
    Action { sep: true, mac: true, ..act("summarize", "AI로 요약하기", false) },
    Action { only: &[".hwp", ".hwpx", ".docx", ".pdf"], ..act("compare", "두 문서 비교 (신구대조표)", false) },
    Action { files: false, folder: Some("문서 수합 (엑셀 한 장)"), sep: true, ..act("collect", "문서 수합", false) },
];

/// 메뉴 판. 항목을 바꾸면 올린다 → 켤 때 깔려 있으면 다시 깐다 (옛 항목이 남지 않게)
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
const MENU_VERSION: &str = "2";

#[cfg_attr(not(windows), allow(dead_code))]
const EXTS: &[&str] = &[
    ".hwp", ".hwpx", ".hml", ".hwpml", ".pdf", ".docx", ".xls", ".xlsx", ".pptx", ".png", ".jpg", ".jpeg",
];

/// 확장자별 메뉴 키. 설치 프로그램의 제거 훅(windows/hooks.nsh)도 같은 키를 지운다 (테스트가 맞춰 본다)
#[cfg_attr(not(windows), allow(dead_code))]
fn key(ext: &str) -> String {
    format!(r"HKCU\Software\Classes\SystemFileAssociations\{}\shell\KorDoc", ext)
}

/// 폴더 메뉴 키: 폴더 아이콘 우클릭(%1)·폴더 안 빈 곳 우클릭(%V)
#[cfg_attr(not(windows), allow(dead_code))]
const FOLDER_KEYS: &[(&str, &str)] = &[
    (r"HKCU\Software\Classes\Directory\shell\KorDoc", "%1"),
    (r"HKCU\Software\Classes\Directory\Background\shell\KorDoc", "%V"),
];

/// .reg 글의 키 이름 (HKCU 줄임 → 전체 이름)
#[cfg_attr(not(windows), allow(dead_code))]
fn reg_root(k: &str) -> String {
    k.replacen(r"HKCU\", r"HKEY_CURRENT_USER\", 1)
}

/// .reg 글의 따옴표 안 값
#[cfg_attr(not(windows), allow(dead_code))]
fn reg_q(s: &str) -> String {
    s.replace('\\', r"\\").replace('"', r#"\""#)
}

/// 메뉴를 지우고 새로 넣는 .reg 글. reg add 를 항목마다 부르면 수백 번이라 10초 넘게 걸려 reg import 한 번으로 깐다.
/// 계단식 메뉴: 부모(이름·아이콘·여러 개 골라도 보이게·판) + 항목마다 하위 키 (이름 앞 두 자리 숫자로 차례, 구분선은 CommandFlags)
#[cfg_attr(not(windows), allow(dead_code))]
fn reg_script(exe: &str) -> String {
    let mut out = String::from("Windows Registry Editor Version 5.00\r\n\r\n");
    let mut menu = |base: &str, items: Vec<(&Action, &str)>, arg: &str| {
        let root = reg_root(base);
        out += &format!("[-{root}]\r\n\r\n[{root}]\r\n\"MUIVerb\"=\"KorDoc AI\"\r\n\"Icon\"=\"{}\"\r\n\"SubCommands\"=\"\"\r\n", reg_q(&format!("\"{exe}\",0")));
        // 기본(Document)은 15개 넘게 고르면 메뉴를 숨긴다
        out += &format!("\"MultiSelectModel\"=\"Player\"\r\n\"KorDocMenu\"=\"{MENU_VERSION}\"\r\n\r\n");
        for (i, (a, label)) in items.iter().enumerate() {
            let sub = format!(r"{root}\shell\{:02}{}", i + 1, a.id);
            out += &format!("[{sub}]\r\n@=\"{}\"\r\n\"MultiSelectModel\"=\"Player\"\r\n", reg_q(label));
            if a.sep && i > 0 {
                // ECF_SEPARATORBEFORE
                out += "\"CommandFlags\"=dword:00000020\r\n";
            }
            out += &format!("\r\n[{sub}\\command]\r\n@=\"{}\"\r\n\r\n", reg_q(&format!("\"{exe}\" --shell {} \"{arg}\"", a.id)));
        }
    };
    for ext in EXTS {
        menu(&key(ext), file_actions(ext).map(|a| (a, a.label)).collect(), "%1");
    }
    for (k, arg) in FOLDER_KEYS {
        menu(k, ACTIONS.iter().filter_map(|a| a.folder.map(|l| (a, l))).collect(), arg);
    }
    out
}

/// 메뉴 키만 지우는 .reg 글
#[cfg_attr(not(windows), allow(dead_code))]
fn reg_remove_script() -> String {
    let keys = EXTS.iter().map(|e| key(e)).chain(FOLDER_KEYS.iter().map(|(k, _)| k.to_string()));
    let mut out = String::from("Windows Registry Editor Version 5.00\r\n\r\n");
    for k in keys {
        out += &format!("[-{}]\r\n\r\n", reg_root(&k));
    }
    out
}

/// 이 확장자 파일 메뉴에 넣을 동작 (차례대로)
#[cfg_attr(not(windows), allow(dead_code))]
fn file_actions(ext: &str) -> impl Iterator<Item = &'static Action> + '_ {
    ACTIONS.iter().filter(move |a| a.files && (a.only.is_empty() || a.only.contains(&ext)) && !a.skip.contains(&ext))
}

pub fn is_action(a: &str) -> bool {
    ACTIONS.iter().any(|x| x.id == a)
}

pub fn is_quick(a: &str) -> bool {
    ACTIONS.iter().any(|x| x.id == a && x.quick)
}

// ── 창 없이 돌기 ──

/// 창을 한 번이라도 띄웠는가 (트레이·Dock·우클릭 화면 동작 포함)
static SHOWN: AtomicBool = AtomicBool::new(false);
/// 창을 띄우기 전에 빠른 동작이 먼저 왔다 (꺼진 앱이 빠른 동작으로 켜짐) → 끝나면 앱을 끈다
static COLD_QUICK: AtomicBool = AtomicBool::new(false);
/// 우클릭·주소 동작이 들어올 때마다 오른다: 끄기 타이머는 그사이 새 동작이 왔으면 끄지 않는다
static QUICK_GEN: AtomicU64 = AtomicU64::new(0);

/// 창이 보이거나 초점을 받았다 (창 상태 플러그인·OS 가 직접 띄운 경우까지)
pub fn mark_shown() {
    SHOWN.store(true, Ordering::SeqCst);
}

/// 주 창 열기. 창을 여는 곳은 모두 이것을 쓴다 (빠른 동작 뒤 끄기 판단)
pub fn show_main(app: &AppHandle) {
    use tauri::Manager;
    SHOWN.store(true, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// 첫 실행이 빠른 동작으로 시작했다 (창을 띄우지 않는다)
pub fn mark_cold_quick() {
    if !SHOWN.load(Ordering::SeqCst) {
        COLD_QUICK.store(true, Ordering::SeqCst);
    }
}

pub fn cold_quick() -> bool {
    COLD_QUICK.load(Ordering::SeqCst)
}

/// 화면: 빠른 동작이 실패했거나 결과를 창으로 보여야 할 때
#[tauri::command]
pub fn shell_show(app: AppHandle) {
    show_main(&app);
}

/// 화면: 빠른 동작을 다 마쳤다. 꺼진 앱이 빠른 동작으로 켜졌고 그 사이 창을 열지 않았으면 끈다 (알림이 뜰 틈을 두고)
#[tauri::command]
pub fn shell_quick_done(app: AppHandle) {
    if !COLD_QUICK.load(Ordering::SeqCst) || SHOWN.load(Ordering::SeqCst) {
        return;
    }
    let gen = QUICK_GEN.load(Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        // 그사이 새 우클릭 동작이 왔거나 창을 열었으면 그대로 둔다 (그 동작이 끝나면 화면이 다시 부른다)
        if !SHOWN.load(Ordering::SeqCst) && QUICK_GEN.load(Ordering::SeqCst) == gen {
            app.exit(0);
        }
    });
}

// ── 들어온 파일 묶기 ──

#[derive(Default)]
pub struct ShellCollector {
    queue: Mutex<Vec<(String, String)>>,
    /// 이번 묶음의 첫 도착·마지막 도착 (묶는 중이면 Some)
    timing: Mutex<Option<(Instant, Instant)>>,
    inbox: Mutex<Inbox>,
}

/// 마지막 파일이 온 뒤 이만큼 더 오지 않으면 한 묶음으로 넘긴다 (탐색기는 파일마다 프로그램을 따로 띄워 수십 개면 0.4초를 넘긴다)
const GATHER_QUIET: Duration = Duration::from_millis(400);
/// 아무리 계속 와도 첫 도착 뒤 이만큼이면 넘긴다
const GATHER_MAX: Duration = Duration::from_secs(4);

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
        // 새 동작이 오면 앞 빠른 동작 뒤의 끄기를 미룬다. 꺼진 앱이 빠른 동작으로 켜졌으면 창 타이머보다 먼저 표시
        QUICK_GEN.fetch_add(1, Ordering::SeqCst);
        if is_quick(action) {
            mark_cold_quick();
        }
        {
            let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
            q.extend(paths.into_iter().map(|p| (action.to_string(), p)));
        }
        let now = Instant::now();
        let mut timing = self.timing.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, last)) = timing.as_mut() {
            *last = now;
            return;
        }
        *timing = Some((now, now));
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            use tauri::Manager;
            let me = app.state::<ShellCollector>();
            loop {
                let wait = {
                    let t = me.timing.lock().unwrap_or_else(|e| e.into_inner());
                    let (first, last) = t.unwrap_or((Instant::now(), Instant::now()));
                    gather_wait(first, last, Instant::now())
                };
                match wait {
                    Some(d) => tokio::time::sleep(d).await,
                    None => break,
                }
            }
            let items = {
                let mut t = me.timing.lock().unwrap_or_else(|e| e.into_inner());
                *t = None;
                std::mem::take(&mut *me.queue.lock().unwrap_or_else(|e| e.into_inner()))
            };
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

/// 묶음을 더 기다릴 시간 (None 이면 지금 넘긴다): 마지막 도착 뒤 GATHER_QUIET, 첫 도착 뒤 GATHER_MAX 까지
fn gather_wait(first: Instant, last: Instant, now: Instant) -> Option<Duration> {
    let until = (last + GATHER_QUIET).min(first + GATHER_MAX);
    (until > now).then(|| until - now)
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

/// 한 묶음이 모두 빠른 동작인가 (그러면 창을 띄우지 않는다)
fn all_quick(items: &[(String, String)]) -> bool {
    !items.is_empty() && items.iter().all(|(a, _)| is_quick(a))
}

fn flush(app: &AppHandle, items: Vec<(String, String)>) {
    let quick_only = all_quick(&items);
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
    // 빠른 동작뿐이면 창을 띄우지 않는다 (화면이 숨은 채 돌리고 알림만). 꺼진 앱이 이것으로 켜졌으면 표시해 둔다
    if quick_only {
        mark_cold_quick();
    } else {
        show_main(app);
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

/// 넣기·빼기·켤 때 다시 깔기를 하나씩 (켤 때 다시 깔기가 사용자가 막 뺀 메뉴를 되살리지 않게)
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
static MENU_LOCK: Mutex<()> = Mutex::new(());

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

    /// 깔린 메뉴가 옛 판이면 다시 깐다 (켤 때 한 번, 뒤에서). 사용자의 넣기·빼기와 겹치지 않게 잠근 뒤 다시 본다
    pub fn refresh_if_stale() {
        let _lock = MENU_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let base = key(".hwpx");
        let Ok(out) = reg_out(&["query", &base]) else { return };
        let current = out.lines().any(|l| l.contains("KorDocMenu") && l.split_whitespace().last() == Some(MENU_VERSION));
        if !current {
            if let Err(e) = install_unlocked() {
                tracing::warn!("우클릭 메뉴 다시 깔기 실패: {}", e);
            }
        }
    }

    fn reg_out(args: &[&str]) -> Result<String, String> {
        let out = std::process::Command::new("reg").args(args).creation_flags(CREATE_NO_WINDOW).output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }

    /// .reg 글을 UTF-16(BOM)으로 써서 reg import 한 번 (reg import 는 다 되어도 안내 글을 stderr 로 내서 종료 코드만 본다)
    fn import(script: &str) -> Result<(), String> {
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!("kordoc-menu-{}-{}.reg", std::process::id(), SEQ.fetch_add(1, Ordering::SeqCst)));
        let mut bytes = vec![0xFF, 0xFE];
        for u in script.encode_utf16() {
            bytes.extend(u.to_le_bytes());
        }
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        let r = reg(&["import", &path.to_string_lossy()]);
        let _ = std::fs::remove_file(&path);
        r
    }

    pub fn install() -> Result<(), String> {
        let _lock = MENU_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        install_unlocked()
    }

    fn install_unlocked() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe.to_string_lossy().trim_start_matches(r"\\?\").to_string();
        import(&reg_script(&exe))
    }

    pub fn uninstall() -> Result<(), String> {
        let _lock = MENU_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        import(&reg_remove_script())
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

    /// 예전 판의 빠른 동작 이름 (다시 깔 때 지운다)
    const LEGACY: &[&str] = &["PDF로 내보내기", "글(마크다운)로 바꾸기"];

    fn mac_actions() -> impl Iterator<Item = &'static Action> {
        ACTIONS.iter().filter(|a| a.mac)
    }

    /// 판 표시 파일: "앱에서 열기" 묶음 안
    fn version_file(dir: &std::path::Path) -> PathBuf {
        dir.join(bundle_name(ACTIONS[0].label)).join("Contents").join("kordoc-menu-version")
    }

    pub fn status() -> MenuStatus {
        let installed = services_dir()
            .map(|d| d.join(bundle_name(ACTIONS[0].label)).exists())
            .unwrap_or(false);
        MenuStatus { supported: true, installed, kind: "quick-action" }
    }

    pub fn refresh_if_stale() {
        let _lock = MENU_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let Some(dir) = services_dir() else { return };
        if !dir.join(bundle_name(ACTIONS[0].label)).exists() {
            return;
        }
        if std::fs::read_to_string(version_file(&dir)).map(|v| v.trim() == MENU_VERSION).unwrap_or(false) {
            return;
        }
        if let Err(e) = install_unlocked() {
            tracing::warn!("Finder 빠른 동작 다시 깔기 실패: {}", e);
        }
    }

    pub fn install() -> Result<(), String> {
        let _lock = MENU_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        install_unlocked()
    }

    fn install_unlocked() -> Result<(), String> {
        let dir = services_dir().ok_or("사용자 폴더를 찾을 수 없습니다")?;
        remove_all(&dir);
        for a in mac_actions() {
            let root = dir.join(bundle_name(a.label)).join("Contents");
            std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            let script = format!(
                r#"/usr/bin/osascript -l JavaScript -e 'function run(argv){{var a=Application.currentApplication();a.includeStandardAdditions=true;argv.forEach(function(p){{a.openLocation("kordoc://{}?path="+encodeURIComponent(p))}})}}' "$@""#,
                a.id
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
                xml_escape(a.label)
            );
            std::fs::write(root.join("Info.plist"), plist).map_err(|e| e.to_string())?;
        }
        std::fs::write(version_file(&dir), MENU_VERSION).map_err(|e| e.to_string())?;
        let _ = std::process::Command::new("/System/Library/CoreServices/pbs").arg("-flush").status();
        Ok(())
    }

    fn remove_all(dir: &std::path::Path) {
        for label in ACTIONS.iter().map(|a| a.label).chain(LEGACY.iter().copied()) {
            let _ = std::fs::remove_dir_all(dir.join(bundle_name(label)));
        }
    }

    pub fn uninstall() -> Result<(), String> {
        let _lock = MENU_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = services_dir().ok_or("사용자 폴더를 찾을 수 없습니다")?;
        remove_all(&dir);
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
    pub fn refresh_if_stale() {}
}

/// 켤 때: 깔린 메뉴가 옛 판이면 새 항목으로 다시 깐다 (뒤에서)
pub fn refresh_menu_if_stale() {
    std::thread::spawn(platform::refresh_if_stale);
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
        // NSIS 제거 훅이 shell.rs 가 만드는 키를 빠짐없이 지우는지 (확장자·폴더 메뉴를 늘리면 hooks.nsh 도 같이)
        let nsh = include_str!("../windows/hooks.nsh");
        for k in EXTS.iter().map(|e| key(e)).chain(FOLDER_KEYS.iter().map(|(k, _)| k.to_string())) {
            let sub = k.strip_prefix(r"HKCU\").unwrap().to_string();
            assert!(nsh.contains(&format!(r#"DeleteRegKey HKCU "{}""#, sub)), "hooks.nsh 에 {} 지우기가 없습니다", k);
        }
        // 앱의 메뉴 빼기도 같은 키를 다 지운다
        let rm = reg_remove_script();
        for k in EXTS.iter().map(|e| key(e)).chain(FOLDER_KEYS.iter().map(|(k, _)| k.to_string())) {
            assert!(rm.contains(&format!("[-{}]", reg_root(&k))), "{} 빼기가 없습니다", k);
        }
    }

    #[test]
    fn menu_items_fit_each_extension() {
        let ids = |ext: &str| file_actions(ext).map(|a| a.id).collect::<Vec<_>>();
        assert_eq!(
            ids(".hwp"),
            ["open", "edit", "precheck", "pdfmerge", "pdf", "pdfwork", "shrink", "pdfimages", "hwpx", "redact", "tables", "convert", "summarize", "compare"]
        );
        // PDF 는 PDF로 저장 없이 나누기, 한글 문서에는 HWPX 로 바꾸기 없음, 그림은 표·비교·편집기 없음
        assert!(!ids(".pdf").contains(&"pdf") && ids(".pdf").contains(&"pdfsplit") && !ids(".pdf").contains(&"edit"));
        assert!(!ids(".hwpx").contains(&"hwpx"));
        let png = ids(".png");
        assert!(png.contains(&"pdfmerge") && png.contains(&"pdfwork") && !png.contains(&"tables") && !png.contains(&"compare") && !png.contains(&"pdfsplit"));
        // 폴더에만 있는 것은 파일 메뉴에 없다
        assert!(EXTS.iter().all(|e| !ids(e).contains(&"collect") && !ids(e).contains(&"tools")));
        // 하위 키 이름은 두 자리 숫자로 차례 (10번째 넘어도 탐색기가 차례를 바꾸지 않게)
        assert!(file_actions(".hwp").count() > 9);
    }

    #[test]
    fn reg_script_builds_menus_in_one_import() {
        let exe = r"C:\Users\홍 길동\AppData\Local\KorDoc AI\kordoc-ai.exe";
        let s = reg_script(exe);
        assert!(s.starts_with("Windows Registry Editor Version 5.00\r\n"));
        let pdf = reg_root(&key(".pdf"));
        // 옛 항목이 남지 않게 지우고 다시
        assert!(s.contains(&format!("[-{pdf}]\r\n\r\n[{pdf}]\r\n\"MUIVerb\"=\"KorDoc AI\"")));
        assert!(s.contains(&format!("[{pdf}\\shell\\01open]\r\n@=\"앱에서 열기\"\r\n\"MultiSelectModel\"=\"Player\"")));
        assert!(!s.contains(&format!("{pdf}\\shell\\04pdf]")));
        // 실행 줄: 경로 역슬래시·따옴표를 .reg 규칙대로
        assert!(s.contains(r#"@="\"C:\\Users\\홍 길동\\AppData\\Local\\KorDoc AI\\kordoc-ai.exe\" --shell pdfmerge \"%1\"""#));
        assert!(s.contains(&format!("\"KorDocMenu\"=\"{MENU_VERSION}\"")));
        // 무리 첫 항목 앞에 구분선 (맨 앞 항목에는 없음)
        let hwp = reg_root(&key(".hwp"));
        assert!(s.contains(&format!("[{hwp}\\shell\\04pdfmerge]\r\n@=\"PDF 하나로 합치기\"\r\n\"MultiSelectModel\"=\"Player\"\r\n\"CommandFlags\"=dword:00000020")));
        assert!(!s.contains(&format!("[{hwp}\\shell\\01open]\r\n@=\"앱에서 열기\"\r\n\"MultiSelectModel\"=\"Player\"\r\n\"CommandFlags\"")));
        // 폴더: 아이콘 우클릭은 %1, 빈 곳 우클릭은 %V, 폴더 이름으로
        let bg = reg_root(FOLDER_KEYS[1].0);
        assert!(s.contains(&format!("[{bg}\\shell\\01tools]\r\n@=\"서무 도구에서 열기\"")));
        assert!(s.contains("--shell pdfmerge \\\"%V\\\""));
        assert!(s.contains("@=\"PDF 하나로 합치기 (이름 차례)\""));
    }

    #[test]
    fn front_lists_match_menu() {
        // 화면이 아는 동작(useDeepLink LINK_ACTIONS)과 창 없이 도는 동작(quick-actions QUICK_ACTIONS)이 이 표와 같은지
        let list = |src: &'static str, name: &str| -> Vec<String> {
            let at = src.find(name).unwrap_or_else(|| panic!("{name} 를 못 찾음"));
            let body = &src[at..];
            let body = &body[body.find('[').unwrap() + 1..body.find(']').unwrap()];
            body.split(',').map(|x| x.trim().trim_matches('"').to_string()).filter(|x| !x.is_empty()).collect()
        };
        let mut link = list(include_str!("../../src/hooks/useDeepLink.ts"), "LINK_ACTIONS = [");
        let mut quick = list(include_str!("../../src/lib/quick-actions.ts"), "QUICK_ACTIONS = [");
        let mut ids: Vec<String> = ACTIONS.iter().map(|a| a.id.to_string()).collect();
        let mut q: Vec<String> = ACTIONS.iter().filter(|a| a.quick).map(|a| a.id.to_string()).collect();
        for v in [&mut link, &mut quick, &mut ids, &mut q] {
            v.sort();
        }
        assert_eq!(link, ids, "useDeepLink.ts LINK_ACTIONS 와 shell.rs ACTIONS 가 다릅니다");
        assert_eq!(quick, q, "quick-actions.ts QUICK_ACTIONS 와 shell.rs 의 quick 동작이 다릅니다");
        assert!(ACTIONS.iter().all(|a| !a.label.contains('—') && !a.label.contains('–')));
    }

    #[test]
    fn gathers_until_arrivals_stop() {
        let t0 = Instant::now();
        let ms = Duration::from_millis;
        // 마지막 도착 뒤 0.4초 기다린다 (계속 오면 미룬다)
        assert_eq!(gather_wait(t0, t0, t0), Some(ms(400)));
        assert_eq!(gather_wait(t0, t0 + ms(300), t0 + ms(500)), Some(ms(200)));
        assert_eq!(gather_wait(t0, t0 + ms(300), t0 + ms(700)), None);
        // 끝없이 와도 첫 도착 뒤 4초에는 넘긴다
        assert_eq!(gather_wait(t0, t0 + ms(3900), t0 + ms(3950)), Some(ms(50)));
        assert_eq!(gather_wait(t0, t0 + ms(3990), t0 + ms(4000)), None);
    }

    #[test]
    fn window_stays_hidden_only_for_quick_batches() {
        let it = |a: &str| (a.to_string(), "C:\\a.pdf".to_string());
        assert!(all_quick(&[it("pdfmerge"), it("pdfmerge"), it("shrink")]));
        // 화면 동작이 하나라도 섞이면 창을 연다 (열기·쪽 정리·요약 …)
        assert!(!all_quick(&[it("pdfmerge"), it("pdfwork")]));
        assert!(!all_quick(&[it("open")]));
        assert!(!all_quick(&[]));
    }

    #[test]
    fn parses_new_actions() {
        let a = vec!["app".into(), "--shell".into(), "pdfmerge".into(), "C:\\a.pdf".into(), "C:\\b.pdf".into()];
        assert_eq!(parse_args(&a), Some(("pdfmerge".into(), vec!["C:\\a.pdf".into(), "C:\\b.pdf".into()])));
        assert!(is_quick("pdfsplit") && is_quick("shrink") && !is_quick("pdfwork") && !is_quick("open") && !is_quick("evil"));
        assert_eq!(parse_action_url("kordoc://pdfwork?path=%2Fa.pdf"), Some(("pdfwork".into(), "/a.pdf".into())));
    }
}
