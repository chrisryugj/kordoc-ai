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
    /// 묶음. 메뉴에 실제로 넣은 바로 앞 항목과 묶음이 다르면 그 앞에 구분선 (확장자마다 빠지는 항목이 있어도 구분선이 남게)
    group: Group,
    /// macOS 빠른 동작으로도 (Finder 메뉴가 길어지지 않게 자주 쓰는 것만)
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    mac: bool,
}

/// 메뉴 묶음 (차례대로, 묶음 사이에 구분선)
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Group {
    /// 맡기기·요약
    Ai,
    /// 앱·편집기·여러 파일 한꺼번에 열기
    Open,
    /// 다른 형식으로 바꾸기·저장
    Change,
    /// 합치기·나누기
    Join,
    /// 점검·가리기·찾기
    Check,
}
use Group::*;

const HANGUL: &[&str] = &[".hwp", ".hwpx"];
const DOCS: &[&str] = &[".hwp", ".hwpx", ".hml", ".hwpml", ".docx", ".pdf"];
const IMAGES: &[&str] = &[".png", ".jpg", ".jpeg", ".webp"];
/// 영수증으로 지출조서: 그림·PDF (사진·스캔·전자영수증)
const RECEIPTS: &[&str] = &[".png", ".jpg", ".jpeg", ".webp", ".pdf"];
const NONE: &[&str] = &[];

const fn act(group: Group, id: &'static str, label: &'static str, quick: bool) -> Action {
    Action { id, label, quick, only: NONE, skip: NONE, files: true, folder: None, group, mac: false }
}

pub const ACTIONS: &[Action] = &[
    // 맨 앞은 맡기기 (macOS 는 ACTIONS[0].label 의 빠른 동작으로 깔렸는지 본다: 자리를 바꾸지 말 것, 이름을 바꾸면 옛 이름을 macOS LEGACY_ASK 에)
    // 문서 카드(작은 창): 이 문서로 무엇을 할지 말로 시키기
    Action { folder: Some("KorDoc AI에게 맡기기…"), mac: true, ..act(Ai, "ask", "KorDoc AI에게 맡기기…", false) },
    Action { mac: true, ..act(Ai, "summarize", "AI로 요약하기", false) },
    // 열기
    Action { mac: true, ..act(Open, "open", "앱에서 열기", false) },
    Action { files: false, folder: Some("여러 파일 한꺼번에 열기"), ..act(Open, "tools", "여러 파일 한꺼번에 열기", false) },
    Action { only: HANGUL, ..act(Open, "edit", "한글 편집기로 고치기", false) },
    // 바꾸기 (언제나 새 파일)
    Action { skip: &[".pdf"], folder: Some("모두 PDF로 저장"), mac: true, ..act(Change, "pdf", "PDF로 저장", true) },
    Action { skip: &[".hwpx"], folder: Some("모두 한글 문서로 바꾸기"), mac: true, ..act(Change, "hwpx", "한글 문서로 바꾸기", true) },
    Action { only: &[".pdf", ".hwp", ".hwpx", ".docx"], mac: true, ..act(Change, "shrink", "PDF 용량 줄이기", true) },
    Action { only: &[".pdf"], ..act(Change, "pagenum", "쪽 번호 넣기", true) },
    Action { only: &[".pdf", ".hwp", ".hwpx"], ..act(Change, "pdfimages", "쪽마다 그림으로 저장", true) },
    Action { skip: &[".png", ".jpg", ".jpeg", ".webp", ".xls", ".xlsx"], ..act(Change, "tables", "표를 엑셀로 뽑기", true) },
    Action { ..act(Change, "convert", "글로 바꾸기", true) },
    // 문서 카드(작은 창)에서 읽은 값을 고치고 지출조서·클립보드 표로. macOS 빠른 동작은 Finder 메뉴가 길어져 넣지 않는다
    Action { only: RECEIPTS, ..act(Change, "receipt", "영수증으로 지출조서 만들기", false) },
    // 합치기·나누기: 형식은 화면이 고른 파일을 보고 정한다 (src/lib/quick-actions.ts)
    //   하나로 합치기: 전부 한글 문서면 서식 그대로 HWPX 하나, 하나라도 다른 형식이 섞이면 PDF 한 권
    //   나누기: 한글 문서는 구역·쪽 나눔마다, PDF 는 쪽마다
    Action { folder: Some("하나로 합치기 (이름 차례)"), mac: true, ..act(Join, "join", "하나로 합치기", true) },
    // 엑셀은 파일마다 시트 하나 (.xls 는 엔진의 서식 유지 합치기가 받지 않는다)
    Action { only: &[".xlsx"], folder: Some("엑셀 하나로 합치기 (이름 차례)"), ..act(Join, "xlsxmerge", "엑셀 하나로 합치기", true) },
    Action { only: &[".pdf", ".hwp", ".hwpx"], ..act(Join, "split", "나누기", true) },
    Action { mac: true, ..act(Join, "pdfwork", "PDF 쪽 편집하기", false) },
    Action { files: false, folder: Some("문서 수합하기"), ..act(Join, "collect", "문서 수합하기", false) },
    // 옛 판 동작: 메뉴에는 없고 kordoc:// 주소·실행 인자로만 (예전에 만든 바로 가기·링크가 계속 되게)
    Action { files: false, ..act(Join, "pdfmerge", "PDF 하나로 합치기", true) },
    Action { files: false, ..act(Join, "hwpmerge", "한글 문서 하나로 합치기", true) },
    Action { files: false, ..act(Join, "pdfsplit", "PDF 쪽마다 나누기", true) },
    Action { files: false, ..act(Join, "hwpsplit", "한글 문서 나누기", true) },
    // 점검·가리기 · 같은 문서의 판들과 최종본(문서 카드) · 접수함에 넣기
    Action { only: DOCS, ..act(Check, "precheck", "결재 전 점검하기", false) },
    Action { folder: Some("개인정보 모두 가리기"), mac: true, ..act(Check, "redact", "개인정보 가리기", true) },
    Action { only: &[".hwp", ".hwpx", ".docx", ".pdf"], ..act(Check, "compare", "신구대조표 만들기", false) },
    Action { skip: IMAGES, mac: true, ..act(Check, "versions", "최종본 찾기", false) },
    Action { only: &[".hwp", ".hwpx", ".pdf"], ..act(Check, "inbox", "받은 공문 접수하기", true) },
];

/// 메뉴 판. 항목을 바꾸면 올린다 → 켤 때 깔려 있으면 다시 깐다 (옛 항목이 남지 않게)
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
const MENU_VERSION: &str = "10";

#[cfg_attr(not(windows), allow(dead_code))]
const EXTS: &[&str] = &[
    ".hwp", ".hwpx", ".hml", ".hwpml", ".pdf", ".docx", ".xls", ".xlsx", ".pptx", ".png", ".jpg", ".jpeg", ".webp",
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

/// 이 메뉴가 가리키는 실행 파일의 표지 — 경로(소문자)의 UTF-8 바이트를 16진수로. 영문·숫자뿐이라 reg 출력의 코드 페이지와 상관없이 견줄 수 있다
#[cfg_attr(not(windows), allow(dead_code))]
fn exe_mark(exe: &str) -> String {
    exe.trim_start_matches(r"\\?\").to_lowercase().bytes().map(|b| format!("{b:02x}")).collect()
}

/// 메뉴를 지우고 새로 넣는 .reg 글. reg add 를 항목마다 부르면 수백 번이라 10초 넘게 걸려 reg import 한 번으로 깐다.
/// 계단식 메뉴: 부모(이름·아이콘·여러 개 골라도 보이게·판) + 항목마다 하위 키 (이름 앞 두 자리 숫자로 차례, 묶음 사이 구분선은 CommandFlags)
#[cfg_attr(not(windows), allow(dead_code))]
fn reg_script(exe: &str) -> String {
    let mut out = String::from("Windows Registry Editor Version 5.00\r\n\r\n");
    let mut menu = |base: &str, items: Vec<(&Action, &str)>, arg: &str| {
        let root = reg_root(base);
        out += &format!("[-{root}]\r\n\r\n[{root}]\r\n\"MUIVerb\"=\"KorDoc AI\"\r\n\"Icon\"=\"{}\"\r\n\"SubCommands\"=\"\"\r\n", reg_q(&format!("\"{exe}\",0")));
        // 기본(Document)은 15개 넘게 고르면 메뉴를 숨긴다
        out += &format!("\"MultiSelectModel\"=\"Player\"\r\n\"KorDocMenu\"=\"{MENU_VERSION}\"\r\n\"KorDocExe\"=\"{}\"\r\n\r\n", exe_mark(exe));
        for (i, (a, label)) in items.iter().enumerate() {
            let sub = format!(r"{root}\shell\{:02}{}", i + 1, a.id);
            out += &format!("[{sub}]\r\n@=\"{}\"\r\n\"MultiSelectModel\"=\"Player\"\r\n", reg_q(label));
            // 이 메뉴에 실제로 넣은 바로 앞 항목과 묶음이 다를 때 (묶음 첫 항목이 이 확장자에서 빠져도 구분선이 남게)
            if i > 0 && items[i - 1].0.group != a.group {
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

/// 숨은 본창에서 빠른 동작이 돌고 있다 (들어온 때부터 화면이 shell_quick_done 을 부를 때까지)
static QUICK_BUSY: AtomicBool = AtomicBool::new(false);
/// 첫 인스턴스가 자기 실행 인자를 묶음에 넣었다 (setup 끝). 그 전에는 묶음을 넘기지 않는다:
/// 꺼진 앱에서 여러 파일을 우클릭하면 둘째 프로세스의 파일이 먼저 들어오고, 첫 인스턴스 자신의 파일은 창을 만든 뒤에야 들어온다.
/// 기다리지 않으면 "하나로 합치기"가 파일 하나짜리 둘로 갈린다
static PRIMED: AtomicBool = AtomicBool::new(false);

pub fn mark_primed() {
    PRIMED.store(true, Ordering::SeqCst);
}

/// 꺼져 있던 앱이 우클릭(빠른 동작·카드)으로 켜졌을 때 끄는 규칙은 하나다:
/// 본창을 한 번도 안 띄웠고, 카드 창이 하나도 없고, 숨은 본창에서 도는 빠른 동작도, 엔진에 걸려 있는 일도 없을 때만 끈다.
/// (카드에서 "PDF로 저장"을 시키고 카드를 닫으면 도는 일이 같이 죽었고, 빠른 동작이 끝나면 열려 있는 카드가 같이 닫혔다)
fn exit_if_idle(app: &AppHandle) {
    use tauri::Manager;
    if SHOWN.load(Ordering::SeqCst) || QUICK_BUSY.load(Ordering::SeqCst) {
        return;
    }
    if !COLD_QUICK.load(Ordering::SeqCst) && !CARD_COLD.load(Ordering::SeqCst) {
        return;
    }
    if app.webview_windows().keys().any(|l| l.starts_with("card-")) {
        return;
    }
    // 엔진이 아직 일하는 중이면(카드에서 시킨 변환, 막 넘어온 다음 묶음) 끝난 뒤 다시 본다. 지금 끄면 반쯤 된 결과만 남는다
    let busy = app.try_state::<std::sync::Arc<crate::sidecar::manager::SidecarManager>>().map(|m| m.busy()).unwrap_or(false);
    if busy {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            exit_if_idle(&app);
        });
        return;
    }
    app.exit(0);
}

/// 화면: 빠른 동작을 다 마쳤다. 꺼진 앱이 우클릭으로 켜졌고 그 사이 창을 열지 않았으면 끈다 (알림이 뜰 틈을 두고)
#[tauri::command]
pub fn shell_quick_done(app: AppHandle, collector: tauri::State<'_, ShellCollector>) {
    // 모으는 중인 다음 빠른 동작이 있으면 아직 일이 남았다 (그 동작이 끝나면 화면이 다시 부른다).
    // 카드 동작만 모으는 중이면 풀어 준다: 안 풀면 그 카드를 닫아도 앱이 숨은 채 남는다
    if !collector.gathering_quick() {
        QUICK_BUSY.store(false, Ordering::SeqCst);
    }
    let gen = QUICK_GEN.load(Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        // 그사이 새 우클릭 동작이 왔으면 그대로 둔다
        if QUICK_GEN.load(Ordering::SeqCst) == gen {
            exit_if_idle(&app);
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
        // 빈 경로(kordoc://pdf?path= 같은 주소)는 버린다: 받으면 화면이 처리할 것이 없어 끝났다는 신호도 오지 않고 숨은 앱이 남는다
        let paths: Vec<String> = paths.into_iter().filter(|p| !p.trim().is_empty()).collect();
        if paths.is_empty() {
            return;
        }
        // 새 동작이 오면 앞 빠른 동작 뒤의 끄기를 미룬다. 꺼진 앱이 빠른 동작으로 켜졌으면 창 타이머보다 먼저 표시
        QUICK_GEN.fetch_add(1, Ordering::SeqCst);
        if is_quick(action) {
            mark_cold_quick();
            QUICK_BUSY.store(true, Ordering::SeqCst);
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
            let began = Instant::now();
            loop {
                // 첫 인스턴스가 자기 파일을 넣기 전이면 기다린다 (넣으면 마지막 도착 시각이 그때로 밀린다). 30초는 안전판
                if !PRIMED.load(Ordering::SeqCst) && began.elapsed() < Duration::from_secs(30) {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    continue;
                }
                let wait = {
                    let t = me.timing.lock().unwrap_or_else(|e| e.into_inner());
                    let (first, last) = t.unwrap_or((Instant::now(), Instant::now()));
                    let q = me.queue.lock().unwrap_or_else(|e| e.into_inner());
                    // 여럿을 골랐다고 드러났거나, 묶어야 뜻이 있는 동작(합치기·비교)이면 넉넉히 기다린다
                    let many = q.len() > 1 || q.iter().any(|(a, _)| batchy(a));
                    gather_wait(first, last, Instant::now(), many)
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

    /// 빠른 동작을 아직 묶는 중인가
    fn gathering_quick(&self) -> bool {
        self.timing.lock().unwrap_or_else(|e| e.into_inner()).is_some() && self.queue.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|(a, _)| is_quick(a))
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

/// 여러 개를 골랐다고 드러난 뒤(둘째 파일이 온 뒤)의 기다림: 보안 프로그램이 프로그램 실행을 늦추는 PC 에서
/// 수십 개가 0.4초 넘는 틈을 두고 오면 "하나로 합치기"가 두 묶음으로 갈려 반쪽 합본 둘이 생겼다
const GATHER_QUIET_MANY: Duration = Duration::from_millis(1200);
/// 여럿일 때는 사실상 조용해질 때까지 기다린다: 탐색기의 실행은 반드시 끝나고, 도착이 이어지는 중에 끊으면 묶음이 갈린다
/// (보안 프로그램이 느린 PC 에서 100개 넘게 고르면 15초를 넘겼다). 5분은 끝없이 기다리지 않게 하는 안전판
const GATHER_MAX_MANY: Duration = Duration::from_secs(300);

/// 파일을 묶어야 뜻이 있는 동작 — 파일 하나만 먼저 와도 짝을 기다린다
fn batchy(action: &str) -> bool {
    matches!(action, "join" | "xlsxmerge" | "pdfmerge" | "hwpmerge" | "compare")
}

/// 묶음을 더 기다릴 시간 (None 이면 지금 넘긴다): 마지막 도착 뒤 조용한 시간, 첫 도착 뒤 최대 시간까지.
/// 파일 하나일 때는 짧게(카드·동작이 바로 뜨게), 둘 이상이면 넉넉히
fn gather_wait(first: Instant, last: Instant, now: Instant, many: bool) -> Option<Duration> {
    let (quiet, max) = if many { (GATHER_QUIET_MANY, GATHER_MAX_MANY) } else { (GATHER_QUIET, GATHER_MAX) };
    let until = (last + quiet).min(first + max);
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

/// 문서 카드로 여는 동작 (본창을 띄우지 않고 작은 창)
pub fn is_card(a: &str) -> bool {
    a == "ask" || a == "versions" || a == "receipt"
}

/// 카드 창이 본창보다 먼저 떴다 (꺼진 앱이 카드로 켜짐) → 마지막 카드를 닫으면 앱을 끈다
static CARD_COLD: AtomicBool = AtomicBool::new(false);
static CARD_SEQ: AtomicU64 = AtomicU64::new(0);

/// 문서 카드 창 — 화면은 같은 index.html 을 ?card=<동작·경로 JSON> 으로 연다 (src/card)
pub fn open_card(app: &AppHandle, action: &str, paths: &[String]) {
    if !SHOWN.load(Ordering::SeqCst) {
        CARD_COLD.store(true, Ordering::SeqCst);
    }
    let label = format!("card-{}", CARD_SEQ.fetch_add(1, Ordering::SeqCst));
    build_card(app.clone(), label, action.to_string(), paths.to_vec(), 0);
}

/// 카드 창 설정: 본창 설정(tauri.conf)을 그대로 복제해 크기·주소·제목만 바꾼다.
/// 웹뷰 옵션이 본창과 하나라도 다르면 WebView2 가 같은 데이터 폴더의 다른 설정 환경으로 보고
/// 0x8007139F("올바른 상태가 아님")로 거부한다 (실측: 2.2.0 설치본에서 카드가 한 번도 안 뜨고 본창으로 넘어감)
fn card_config(app: &AppHandle, label: &str, action: &str, paths: &[String]) -> tauri::utils::config::WindowConfig {
    let q = serde_json::json!({ "action": action, "paths": paths }).to_string();
    let first = paths
        .first()
        .and_then(|p| std::path::Path::new(p).file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let more = if paths.len() > 1 { format!(" 외 {}개", paths.len() - 1) } else { String::new() };
    let mut c = app.config().app.windows.first().cloned().unwrap_or_default();
    c.label = label.to_string();
    c.url = tauri::WebviewUrl::App(format!("index.html?card={}", urlencoding::encode(&q)).into());
    c.title = format!("KorDoc AI · {}{}", first, more);
    // 영수증 카드는 고칠 수 있는 표를 보여서 넓게
    let wide = action == "receipt";
    c.width = if wide { 860.0 } else { 520.0 };
    c.height = if wide { 760.0 } else { 720.0 };
    c.min_width = Some(420.0);
    c.min_height = Some(520.0);
    c.center = true;
    c.focus = true;
    c.visible = true;
    c
}

/// 카드 창 만들기. 웹뷰가 막 뜨는 중이면 잠깐 뒤 다시(최대 4번), 끝내 못 띄우면 본창의 같은 일로 (앱에서 열기)
fn build_card(app: AppHandle, label: String, action: String, paths: Vec<String>, attempt: u64) {
    use tauri::WebviewWindowBuilder;
    let cfg = card_config(&app, &label, &action, &paths);
    match WebviewWindowBuilder::from_config(&app, &cfg).and_then(|b| b.build()) {
        Ok(w) => {
            let _ = w.set_focus();
        }
        Err(e) if attempt < 4 => {
            tracing::warn!("문서 카드 창 다시 시도 {}: {}", attempt + 1, e);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(400 * (attempt + 1))).await;
                build_card(app, label, action, paths, attempt + 1);
            });
        }
        Err(e) => {
            tracing::error!("문서 카드 창을 띄우지 못함: {}", e);
            deliver(&app, "open-files", paths.into());
            show_main(&app);
        }
    }
}

/// 카드 창이 닫혔다: 앱이 우클릭으로 켜졌고 본창을 한 번도 안 띄웠고 남은 카드도 도는 빠른 동작도 없으면 끈다
pub fn card_closed(app: &AppHandle) {
    exit_if_idle(app);
}

/// 카드 → 본창: "앱에서 이어서"·비교·편집기 등 본창의 동작으로 넘긴다 (우클릭 동작과 같은 길)
#[tauri::command]
pub fn card_handoff(app: AppHandle, action: String, paths: Vec<String>) -> Result<(), String> {
    use tauri::Manager;
    if !is_action(&action) || (is_card(&action) && action != "receipt") {
        return Err(format!("모르는 동작입니다: {}", action));
    }
    // 영수증 카드의 "본창에서 열기": 모으기를 거치면 다시 카드가 뜨니 본창(서무 도구)으로 바로
    if action == "receipt" {
        send_to_main(&app, &action, &paths);
        show_main(&app);
        return Ok(());
    }
    app.state::<ShellCollector>().push(&app, &action, paths);
    Ok(())
}

fn flush(app: &AppHandle, items: Vec<(String, String)>) {
    // 문서 카드 동작은 묶음마다 작은 창 하나 (본창은 띄우지 않는다)
    let (cards, items): (Vec<_>, Vec<_>) = items.into_iter().partition(|(a, _)| is_card(a));
    for action in ["ask", "versions", "receipt"] {
        let paths: Vec<String> = cards.iter().filter(|(a, _)| a == action).map(|(_, p)| p.clone()).collect();
        if !paths.is_empty() {
            open_card(app, action, &paths);
        }
    }
    if items.is_empty() {
        return;
    }
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
        send_to_main(app, &action, &paths);
    }
    // 빠른 동작뿐이면 창을 띄우지 않는다 (화면이 숨은 채 돌리고 알림만). 꺼진 앱이 이것으로 켜졌으면 표시해 둔다
    if quick_only {
        mark_cold_quick();
    } else {
        show_main(app);
    }
}

/// 본창 화면으로 동작 하나 넘기기: 열기는 open-files, 파일 하나는 kordoc://<동작>?path=, 여럿은 묶음 목록 파일
fn send_to_main(app: &AppHandle, action: &str, paths: &[String]) {
    if action == "open" {
        deliver(app, "open-files", paths.to_vec().into());
    } else if paths.len() == 1 {
        let url = format!("kordoc://{}?path={}", action, urlencoding::encode(&paths[0]));
        deliver(app, "deep-link", url.into());
    } else {
        match write_manifest(action, paths) {
            Ok(m) => {
                let url = format!("kordoc://batch?manifest={}", urlencoding::encode(&m.to_string_lossy()));
                deliver(app, "deep-link", url.into());
            }
            Err(e) => {
                // 화면이 받을 것이 없으니 끝났다는 신호도 오지 않는다: 숨은 채 남지 않게 창을 띄운다
                tracing::error!("batch manifest 쓰기 실패: {}", e);
                QUICK_BUSY.store(false, Ordering::SeqCst);
                show_main(app);
            }
        }
    }
}

/// 사이드카 read_batch_manifest 가 읽는 형식: 임시 폴더의 kordoc-batch-<ms>.json
fn write_manifest(action: &str, files: &[String]) -> std::io::Result<PathBuf> {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // 한 번에 묶음이 둘 넘어가면 같은 밀리초에 써진다 → 순번을 붙여 이름이 겹치지 않게 (겹치면 앞 동작이 사라지고 뒤 동작이 두 번 돈다).
    // 이름은 엔진이 받는 꼴(kordoc-batch-<숫자>.json) 그대로
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!("kordoc-batch-{}{:03}.json", ms, SEQ.fetch_add(1, Ordering::SeqCst) % 1000));
    let body = serde_json::json!({ "action": action, "files": files, "created_at": ms.to_string() });
    std::fs::write(&path, serde_json::to_vec_pretty(&body)?)?;
    Ok(path)
}

/// 드라이브 맨 위 폴더의 빈 곳을 우클릭하면 명령줄이 `"D:\"` 로 끝나고, Windows 인자 규칙은 `\"` 를 따옴표 글자로 읽어
/// 인자가 `D:"` 가 된다 → 끝의 따옴표를 역슬래시로 되돌린다 (경로에는 따옴표가 올 수 없다)
fn unquote_root(arg: &str) -> String {
    match arg.strip_suffix('"') {
        Some(head) => format!("{head}\\"),
        None => arg.to_string(),
    }
}

/// 네트워크 경로인가 — 앞 두 글자가 빗금·역빗금(`\\서버\…` · `//서버/…` · `/\서버\…`). `\\?\C:\…` 는 긴 경로 표기의 로컬 파일이다
fn is_network_path(a: &str) -> bool {
    let b = a.as_bytes();
    let slash = |c: u8| c == b'/' || c == b'\\';
    if b.len() < 2 || !slash(b[0]) || !slash(b[1]) {
        return false;
    }
    let local = b.len() >= 6 && b[2] == b'?' && slash(b[3]) && b[4].is_ascii_alphabetic() && b[5] == b':';
    !local
}

/// 실행 인자 → (동작, 파일들). `--shell <동작> <파일…>` 또는 파일만(= open)
pub fn parse_args(args: &[String]) -> Option<(String, Vec<String>)> {
    let rest: Vec<&String> = args.iter().skip(1).collect();
    if rest.is_empty() {
        return None;
    }
    if rest[0] == "--shell" && rest.len() >= 3 && is_action(rest[1]) {
        return Some((rest[1].clone(), rest[2..].iter().map(|s| unquote_root(s)).collect()));
    }
    // 주소(kordoc://…)로 켜진 실행은 그 주소 하나만 다룬다. 주소 속 `|` 나 따옴표로 갈라져 나온 나머지 토큰을 파일로 보면
    // 링크 하나로 임의 파일이 "앱에서 열기"로 뜬다 (single-instance 플러그인은 인자를 `|` 로 이어 보내고 다시 `|` 로 자른다)
    // (스킴은 대소문자를 가리지 않는다: "KORDOC://…" 도 같은 주소다)
    if rest.iter().any(|a| a.get(..7).is_some_and(|s| s.eq_ignore_ascii_case("kordoc:"))) {
        return None;
    }
    // 네트워크 경로(\\서버\공유)는 있는지 찔러 보지 않는다: is_file() 만으로 그 서버에 접속이 나가고(계정 인증이 따라간다),
    // 응답 없는 서버면 이 호출이 도는 화면 스레드가 접속 시간 초과까지 멈춘다.
    // 찔러 보지 않고 그대로 넘긴다: 엔진이 열지 않고 "네트워크 경로는 쓸 수 없습니다"로 알린다 (말없이 버리면 빈 창만 뜬다)
    let files: Vec<String> = rest
        .iter()
        .filter(|a| !a.starts_with("-") && (is_network_path(a) || std::path::Path::new(a.as_str()).is_file()))
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
    let action = url_action(&u);
    if !is_action(&action) {
        return None;
    }
    let path = u.query_pairs().find(|(k, _)| k == "path").map(|(_, v)| v.into_owned())?;
    Some((action, path))
}

/// 주소의 동작 이름. host 자리("kordoc://convert?…")에 오고, "//" 없이 쓴 주소("kordoc:convert?…" · "kordoc:/convert?…")는
/// host 가 비고 경로 첫 토막에 온다. 둘 다 같은 동작으로 읽는다: 여기서 못 읽은 주소를 화면이 따로 풀면
/// 주소로 온 빠른 동작이 "여러 파일 화면에 올리기"를 건너뛰고 확인 없이 바로 돈다
fn url_action(u: &tauri::Url) -> String {
    match u.host_str() {
        Some(h) if !h.is_empty() => h.to_ascii_lowercase(),
        _ => u.path().trim_start_matches('/').split('/').next().unwrap_or_default().to_ascii_lowercase(),
    }
}

/// 묶음 주소(kordoc://batch?manifest=…)인가 — 동작 주소가 아닌 것 가운데 화면으로 넘기는 것은 이것뿐이다
pub fn is_batch_url(url: &str) -> bool {
    tauri::Url::parse(url).map(|u| u.scheme() == "kordoc" && url_action(&u) == "batch").unwrap_or(false)
}

/// 주소(kordoc://…)로 온 동작을 어떻게 돌릴지. 윈도에서는 빠른 동작(창 없이 바로 처리)을 그대로 돌리지 않고
/// "여러 파일 한꺼번에" 화면에 파일만 올려 둔다: 주소는 웹·메일·문서 속 링크로도 올 수 있어, 누른 사람이 모르는 사이
/// 폴더 안 문서 수천 개를 바꾸거나 글 사본을 만들 수 있다. 탐색기 우클릭은 실행 인자(--shell)로 오므로 그대로 바로 돈다.
/// macOS 는 Finder 빠른 동작이 주소로 들어오므로 그대로 둔다
pub fn routed_action(url: &str) -> Option<(String, String)> {
    let (action, path) = parse_action_url(url)?;
    if cfg!(not(target_os = "macos")) && is_quick(&action) {
        return Some(("tools".into(), path));
    }
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
            // reg 의 오류 글은 윈도 코드 페이지(CP949)라 그대로 옮기면 깨져 보인다 → 종료 코드와 할 일을 한국어로.
            // 조회(query)는 메뉴가 없을 때도 실패로 끝나니 적지 않는다
            if args.first() != Some(&"query") {
                tracing::warn!("reg {} 실패 (종료 코드 {:?})", args.first().copied().unwrap_or(""), out.status.code());
            }
            Err("레지스트리를 바꾸지 못했습니다. 기관에서 레지스트리 편집을 막았을 수 있습니다. 정보통신 담당자에게 문의하세요.".into())
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
        // 다른 폴더에 다시 깔았거나 설치 방식을 바꿨으면 메뉴가 없어진 옛 실행 파일을 가리킨다. 깔 때 적어 둔 실행 파일 표지(KorDocExe)와 견준다:
        // 경로 글자를 그대로 견주면 reg 출력이 윈도 코드 페이지라 사용자 이름이 한글인 PC 에서 늘 다르다고 나와 켤 때마다 메뉴를 다시 깔았다.
        // 개발 빌드는 깔린 메뉴를 자기 경로로 바꾸지 않는다
        let exe = std::env::current_exe().ok().map(|p| exe_mark(&p.to_string_lossy()));
        let moved = !cfg!(debug_assertions) && exe.map(|e| !out.contains(&e)).unwrap_or(false);
        if !current || moved {
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

    /// 윈도 알림이 켜져 있는가: 알림 전체(ToastEnabled)와 이 앱(Enabled) 스위치. 값이 없으면 켜진 것이다.
    /// 윈도는 알림 권한 물음이 늘 "허용"으로 돌아와, 꺼 둔 PC 에서는 창 없이 한 일의 결과가 아무 데도 안 보인다
    pub fn toasts_enabled() -> bool {
        const BASE: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion";
        let read = |key: String, value: &str| reg_out(&["query", &key, "/v", value]).unwrap_or_default();
        let off = |key: String, value: &str| toast_switch_off(&read(key, value));
        // 기관이 그룹 정책으로 알림을 끈 PC (사용자·컴퓨터 정책)
        const POLICY: &str = r"Software\Policies\Microsoft\Windows\CurrentVersion\PushNotifications";
        let banned = |root: &str| reg_value_is_one(&read(format!(r"{}\{}", root, POLICY), "NoToastApplicationNotification"));
        !off(format!(r"{}\PushNotifications", BASE), "ToastEnabled") && !off(format!(r"{}\Notifications\Settings\{}", BASE, APP_ID), "Enabled") && !banned("HKCU") && !banned("HKLM")
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

    /// 예전 판의 맡기기 이름 (ACTIONS[0] 이름이 바뀌기 전에 깐 PC 도 깔린 것으로 보고 다시 깐다)
    const LEGACY_ASK: &str = "KorDoc AI 에게 맡기기…";
    /// 예전 판의 빠른 동작 이름 (다시 깔 때 지운다)
    const LEGACY: &[&str] = &[LEGACY_ASK, "PDF로 내보내기", "글(마크다운)로 바꾸기", "한글 문서(HWPX)로 바꾸기", "PDF 쪽 정리 (나누기·뽑기·돌리기)"];

    fn mac_actions() -> impl Iterator<Item = &'static Action> {
        ACTIONS.iter().filter(|a| a.mac)
    }

    /// 지금 이름이나 옛 맡기기 이름으로 깔려 있나
    fn installed_in(dir: &std::path::Path) -> bool {
        dir.join(bundle_name(ACTIONS[0].label)).exists() || dir.join(bundle_name(LEGACY_ASK)).exists()
    }

    /// 판 표시 파일: 맨 앞(맡기기) 묶음 안
    fn version_file(dir: &std::path::Path) -> PathBuf {
        dir.join(bundle_name(ACTIONS[0].label)).join("Contents").join("kordoc-menu-version")
    }

    pub fn status() -> MenuStatus {
        let installed = services_dir().map(|d| installed_in(&d)).unwrap_or(false);
        MenuStatus { supported: true, installed, kind: "quick-action" }
    }

    /// 맥은 알림 권한 물음이 실제 상태를 돌려준다 (화면이 그것으로 판단)
    pub fn toasts_enabled() -> bool {
        true
    }

    pub fn refresh_if_stale() {
        let _lock = MENU_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let Some(dir) = services_dir() else { return };
        if !installed_in(&dir) {
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
    pub fn toasts_enabled() -> bool {
        true
    }
}

/// tauri.conf.json 의 identifier (윈도 알림 설정이 이 이름으로 남는다)
#[cfg_attr(not(windows), allow(dead_code))]
const APP_ID: &str = "com.kordoc-ai.app";

/// `reg query … /v 값` 출력에서 스위치가 꺼졌는가 (REG_DWORD 0x0)
#[cfg_attr(not(windows), allow(dead_code))]
fn toast_switch_off(reg_query_out: &str) -> bool {
    reg_query_out.lines().any(|l| l.contains("REG_DWORD") && l.trim_end().ends_with("0x0"))
}

/// `reg query … /v 값` 출력에서 값이 1 인가 (REG_DWORD 0x1 — 정책이 켜짐)
#[cfg_attr(not(windows), allow(dead_code))]
fn reg_value_is_one(reg_query_out: &str) -> bool {
    reg_query_out.lines().any(|l| l.contains("REG_DWORD") && l.trim_end().ends_with("0x1"))
}

/// 창 없이 한 일의 결과를 시스템 알림으로 보여 줄 수 있는가 (못 하면 화면이 창을 열어 알린다)
#[tauri::command]
pub fn shell_toast_ok() -> bool {
    platform::toasts_enabled()
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
    // 첫 인자일 때만 받는다. 어디에 있든 받으면 `kordoc://x" --shell-menu uninstall "` 같은 링크가
    // 따옴표를 그대로 넘기는 프로그램을 거쳐 사용자의 우클릭 메뉴를 빼 버릴 수 있다
    if args.get(1).map(String::as_str) != Some("--shell-menu") {
        return None;
    }
    let result = match args.get(2).map(String::as_str) {
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
    fn deep_link_launch_never_opens_other_tokens_as_files() {
        // 실제로 있는 파일을 인자로 줘도, 주소(kordoc:)가 섞인 실행이면 파일로 열지 않는다
        let me = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        assert_eq!(parse_args(&["app".into(), me.clone()]), Some(("open".into(), vec![me.clone()])));
        assert_eq!(parse_args(&["app".into(), "kordoc://x?".into(), me.clone()]), None);
        assert_eq!(parse_args(&["app".into(), me.clone(), "kordoc://open?path=a".into()]), None);
        assert_eq!(parse_args(&["app".into(), "KORDOC://x?".into(), me.clone()]), None);
        // 네트워크 경로는 있는지 찔러 보지 않고 그대로 넘긴다 (엔진이 열지 않고 까닭을 알린다). 주소가 섞였으면 그것도 버린다
        for unc in ["\\\\192.0.2.1\\share\\a.hwp", "//192.0.2.1/share/a.hwp", "/\\192.0.2.1\\share\\a.hwp", "\\\\?\\UNC\\192.0.2.1\\share\\a.hwp"] {
            assert!(is_network_path(unc), "{unc}");
            assert_eq!(parse_args(&["app".into(), unc.into()]), Some(("open".into(), vec![unc.to_string()])));
            assert_eq!(parse_args(&["app".into(), "kordoc://x?".into(), unc.into()]), None);
        }
        // 긴 경로 표기의 로컬 파일·보통 경로는 네트워크 경로가 아니다
        for local in ["\\\\?\\C:\\a\\b.hwp", "C:\\a\\b.hwp", "/Users/a/b.hwp", "Z:\\share\\a.hwp"] {
            assert!(!is_network_path(local), "{local}");
        }
    }

    #[test]
    fn parses_action_url() {
        let u = "kordoc://convert?path=%2FUsers%2F%ED%99%8D%2Fa.hwpx";
        assert_eq!(parse_action_url(u), Some(("convert".into(), "/Users/홍/a.hwpx".into())));
        assert_eq!(parse_action_url("kordoc://batch?manifest=x"), None);
    }

    #[test]
    fn slashless_action_urls_are_actions_too() {
        // "//" 없이 쓴 주소도 같은 동작으로 읽는다. 못 읽으면 화면이 따로 풀어, 주소로 온 빠른 동작이 확인 없이 바로 돈다
        for u in ["kordoc:convert?path=D%3A%5C", "kordoc:/convert?path=D%3A%5C", "kordoc:///convert?path=D%3A%5C", "kordoc://CONVERT?path=D%3A%5C"] {
            assert_eq!(parse_action_url(u), Some(("convert".into(), "D:\\".into())), "{u}");
            // 윈도·리눅스에서는 빠른 동작을 바로 돌리지 않고 여러 파일 화면에 올린다
            if cfg!(not(target_os = "macos")) {
                assert_eq!(routed_action(u), Some(("tools".into(), "D:\\".into())), "{u}");
            }
        }
        // 동작으로 읽지 못한 주소 가운데 화면으로 넘기는 것은 묶음 주소뿐
        assert!(is_batch_url("kordoc://batch?manifest=x"));
        assert!(is_batch_url("kordoc:batch?manifest=x"));
        for u in ["kordoc://nope?path=x", "kordoc:redactx?path=x", "https://batch/?manifest=x", "kordoc://convert"] {
            assert!(!is_batch_url(u), "{u}");
        }
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
        // 앱 없이 메뉴를 지우는 파일(MSI 로 지운 뒤 남은 메뉴용, docs/remove-explorer-menu.reg)도 앱의 메뉴 빼기와 같은 글이다
        let file = include_str!("../../docs/remove-explorer-menu.reg").replace("\r\n", "\n");
        assert_eq!(file, reg_remove_script().replace("\r\n", "\n"), "docs/remove-explorer-menu.reg 을 EXTS·FOLDER_KEYS 에 맞추세요");
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
            [
                "ask", "summarize", // 맡기기
                "open", "edit", // 열기
                "pdf", "hwpx", "shrink", "pdfimages", "tables", "convert", // 바꾸기
                "join", "split", "pdfwork", // 합치기·나누기
                "precheck", "redact", "compare", "versions", "inbox", // 점검·가리기
            ]
        );
        assert_eq!(
            ids(".pdf"),
            [
                "ask", "summarize", "open", "hwpx", "shrink", "pagenum", "pdfimages", "tables", "convert", "receipt",
                "join", "split", "pdfwork", "precheck", "redact", "compare", "versions", "inbox",
            ]
        );
        // PDF 는 PDF로 저장 없이 나누기·쪽 번호, 한글 문서에는 한글 문서로 바꾸기 없음, 그림은 표·비교·편집기 없음
        assert!(!ids(".pdf").contains(&"pdf") && ids(".pdf").contains(&"split") && !ids(".pdf").contains(&"edit"));
        assert!(!ids(".hwpx").contains(&"hwpx") && !ids(".hwp").contains(&"pagenum"));
        // 엑셀 합치기는 .xlsx 에만 (.xls 는 엔진이 안 받음), 엑셀 파일에는 표를 엑셀로 뽑기 없음
        assert!(ids(".xlsx").contains(&"xlsxmerge") && !ids(".xls").contains(&"xlsxmerge") && !ids(".pdf").contains(&"xlsxmerge"));
        assert!(!ids(".xlsx").contains(&"tables") && !ids(".xls").contains(&"tables"));
        // 접수는 받은 공문 형식(한글·PDF)에만
        assert!(ids(".hwpx").contains(&"inbox") && !ids(".docx").contains(&"inbox") && !ids(".png").contains(&"inbox"));
        // 나누기는 한글 문서·PDF 에만, 합치기는 어디나 하나
        assert!(ids(".hwpx").contains(&"split") && ids(".pdf").contains(&"split") && !ids(".docx").contains(&"split") && ids(".docx").contains(&"join"));
        // 옛 판 동작(형식별 합치기·나누기)은 메뉴에 없고 주소로만
        for old in ["pdfmerge", "hwpmerge", "pdfsplit", "hwpsplit"] {
            assert!(is_action(old) && is_quick(old));
            assert!(EXTS.iter().all(|e| !ids(e).contains(&old)) && ACTIONS.iter().all(|a| a.id != old || a.folder.is_none()), "{old} 가 메뉴에 있습니다");
        }
        // 영수증으로 지출조서는 그림·PDF 에만 (한글·워드·엑셀에는 없다), 문서 카드 창으로 뜬다
        for e in [".png", ".jpg", ".jpeg", ".pdf"] {
            assert!(ids(e).contains(&"receipt"), "{e} 에 영수증 없음");
        }
        assert!(!ids(".hwp").contains(&"receipt") && !ids(".docx").contains(&"receipt") && !ids(".xlsx").contains(&"receipt"));
        assert!(is_card("receipt") && !is_quick("receipt") && ACTIONS.iter().all(|a| a.id != "receipt" || (a.folder.is_none() && !a.mac)));
        let png = ids(".png");
        assert!(png.contains(&"join") && png.contains(&"pdfwork") && !png.contains(&"tables") && !png.contains(&"compare") && !png.contains(&"split"));
        // 폴더에만 있는 것은 파일 메뉴에 없다
        assert!(EXTS.iter().all(|e| !ids(e).contains(&"collect") && !ids(e).contains(&"tools")));
        // 하위 키 이름은 두 자리 숫자로 차례 (10번째 넘어도 탐색기가 차례를 바꾸지 않게)
        assert!(file_actions(".hwp").count() > 9);
    }

    #[test]
    fn toast_switch_reads_reg_query_output() {
        let off = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications\r\n    ToastEnabled    REG_DWORD    0x0\r\n\r\n";
        let on = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications\r\n    ToastEnabled    REG_DWORD    0x1\r\n\r\n";
        assert!(toast_switch_off(off));
        assert!(!toast_switch_off(on));
        // 값이 없으면(reg 가 오류를 내 빈 출력) 켜진 것으로 본다
        assert!(!toast_switch_off(""));
    }

    #[test]
    fn reg_script_builds_menus_in_one_import() {
        let exe = r"C:\Users\홍 길동\AppData\Local\KorDoc AI\kordoc-ai.exe";
        let s = reg_script(exe);
        assert!(s.starts_with("Windows Registry Editor Version 5.00\r\n"));
        let pdf = reg_root(&key(".pdf"));
        // 옛 항목이 남지 않게 지우고 다시
        assert!(s.contains(&format!("[-{pdf}]\r\n\r\n[{pdf}]\r\n\"MUIVerb\"=\"KorDoc AI\"")));
        assert!(s.contains(&format!("[{pdf}\\shell\\01ask]\r\n@=\"KorDoc AI에게 맡기기…\"\r\n\"MultiSelectModel\"=\"Player\"")));
        assert!(s.contains(&format!("[{pdf}\\shell\\10receipt]\r\n@=\"영수증으로 지출조서 만들기\"")));
        assert!(s.contains(&format!("[{pdf}\\shell\\17versions]\r\n@=\"최종본 찾기\"")));
        assert!(!(1..=30).any(|n| s.contains(&format!("[{pdf}\\shell\\{n:02}pdf]"))));
        // 실행 줄: 경로 역슬래시·따옴표를 .reg 규칙대로
        assert!(s.contains(r#"@="\"C:\\Users\\홍 길동\\AppData\\Local\\KorDoc AI\\kordoc-ai.exe\" --shell join \"%1\"""#));
        assert!(s.contains(&format!("\"KorDocMenu\"=\"{MENU_VERSION}\"")));
        // 묶음 첫 항목 앞에 구분선 (맨 앞 항목·묶음 안 항목에는 없음)
        let hwp = reg_root(&key(".hwp"));
        let sep = |root: &str, n: &str, label: &str| format!("[{root}\\shell\\{n}]\r\n@=\"{label}\"\r\n\"MultiSelectModel\"=\"Player\"\r\n\"CommandFlags\"=dword:00000020");
        let plain = |root: &str, n: &str, label: &str| format!("[{root}\\shell\\{n}]\r\n@=\"{label}\"\r\n\"MultiSelectModel\"=\"Player\"\r\n\r\n");
        assert!(s.contains(&sep(&hwp, "03open", "앱에서 열기")));
        assert!(s.contains(&sep(&hwp, "05pdf", "PDF로 저장")));
        assert!(s.contains(&sep(&hwp, "11join", "하나로 합치기")));
        assert!(s.contains(&sep(&hwp, "14precheck", "결재 전 점검하기")));
        assert!(s.contains(&plain(&hwp, "01ask", "KorDoc AI에게 맡기기…")));
        assert!(s.contains(&plain(&hwp, "02summarize", "AI로 요약하기")));
        assert!(s.contains(&plain(&hwp, "12split", "나누기")) && s.contains(&plain(&hwp, "13pdfwork", "PDF 쪽 편집하기")));
        // .pdf 에는 바꾸기 묶음 첫 항목(PDF로 저장)이 빠져도 다음 항목(한글 문서로 바꾸기)에 구분선
        assert!(s.contains(&sep(&pdf, "04hwpx", "한글 문서로 바꾸기")));
        // 폴더: 아이콘 우클릭은 %1, 빈 곳 우클릭은 %V, 폴더 이름으로
        let bg = reg_root(FOLDER_KEYS[1].0);
        assert!(s.contains(&plain(&bg, "01ask", "KorDoc AI에게 맡기기…")));
        assert!(s.contains(&sep(&bg, "02tools", "여러 파일 한꺼번에 열기")));
        assert!(s.contains(&sep(&bg, "03pdf", "모두 PDF로 저장")));
        assert!(s.contains(&plain(&bg, "04hwpx", "모두 한글 문서로 바꾸기")));
        assert!(s.contains(&sep(&bg, "05join", "하나로 합치기 (이름 차례)")));
        assert!(s.contains(&plain(&bg, "06xlsxmerge", "엑셀 하나로 합치기 (이름 차례)")));
        assert!(s.contains(&plain(&bg, "07collect", "문서 수합하기")));
        assert!(s.contains(&sep(&bg, "08redact", "개인정보 모두 가리기")));
        assert!(s.contains("--shell join \\\"%V\\\""));
        assert!(!s.contains("PDF 하나로 합치기") && !s.contains("한글 문서 하나로 합치기"));
    }

    #[test]
    fn every_menu_keeps_separators_between_groups() {
        // 모든 확장자·폴더 메뉴에서: 묶음이 바뀌는 첫 항목에만 구분선, 맨 앞·묶음 안 항목에는 없음
        // (예전에는 구분선이 항목에 붙어 있어, .hwpx 처럼 그 항목이 빠지는 메뉴에서 구분선이 사라졌다)
        let s = reg_script(r"C:\k.exe");
        let menus = EXTS.iter().map(|e| (key(e), file_actions(e).map(|a| (a, a.label)).collect::<Vec<_>>()))
            .chain(FOLDER_KEYS.iter().map(|(k, _)| (k.to_string(), ACTIONS.iter().filter_map(|a| a.folder.map(|l| (a, l))).collect())));
        for (k, items) in menus {
            let root = reg_root(&k);
            let mut groups = 0;
            for (i, (a, label)) in items.iter().enumerate() {
                let head = format!("[{root}\\shell\\{:02}{}]\r\n@=\"{}\"\r\n\"MultiSelectModel\"=\"Player\"\r\n", i + 1, a.id, reg_q(label));
                let at = s.find(&head).unwrap_or_else(|| panic!("{k} 에 {} 가 없습니다", a.id)) + head.len();
                let first = i == 0 || items[i - 1].0.group != a.group;
                groups += first as usize;
                assert_eq!(s[at..].starts_with("\"CommandFlags\"=dword:00000020"), first && i > 0, "{k} 의 {} 구분선", a.id);
            }
            // 묶음이 둘 이상 (구분선이 하나는 있다)
            assert!(groups >= 2, "{k} 의 묶음 {groups}개");
        }
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
        // 파일 하나: 마지막 도착 뒤 0.4초 기다린다 (카드·동작이 바로 뜨게)
        assert_eq!(gather_wait(t0, t0, t0, false), Some(ms(400)));
        assert_eq!(gather_wait(t0, t0 + ms(300), t0 + ms(500), false), Some(ms(200)));
        assert_eq!(gather_wait(t0, t0 + ms(300), t0 + ms(700), false), None);
        // 끝없이 와도 첫 도착 뒤 4초에는 넘긴다
        assert_eq!(gather_wait(t0, t0 + ms(3900), t0 + ms(3950), false), Some(ms(50)));
        assert_eq!(gather_wait(t0, t0 + ms(3990), t0 + ms(4000), false), None);
        // 둘 이상(여러 개 고름): 틈이 1.2초까지 벌어져도 한 묶음. 도착이 이어지는 동안은 끊지 않는다 (15초를 넘겨도)
        assert_eq!(gather_wait(t0, t0 + ms(300), t0 + ms(700), true), Some(ms(800)));
        assert_eq!(gather_wait(t0, t0 + ms(300), t0 + ms(1500), true), None);
        assert_eq!(gather_wait(t0, t0 + ms(4500), t0 + ms(5000), true), Some(ms(700)));
        assert_eq!(gather_wait(t0, t0 + ms(19_500), t0 + ms(20_000), true), Some(ms(700)));
        // 안전판: 5분
        assert_eq!(gather_wait(t0, t0 + ms(299_900), t0 + ms(300_000), true), None);
    }

    #[test]
    fn pairing_actions_wait_for_their_partner() {
        // 합치기·비교는 파일 하나만 먼저 와도 넉넉히 기다린다 (꺼진 앱에서 두 파일을 고르면 하나씩 따로 온다)
        for a in ["join", "xlsxmerge", "compare", "pdfmerge", "hwpmerge"] {
            assert!(batchy(a), "{a}");
            assert!(is_action(a), "{a}");
        }
        for a in ["pdf", "redact", "ask", "open"] {
            assert!(!batchy(a), "{a}");
        }
    }

    #[test]
    fn links_do_not_run_quick_actions_unseen() {
        // 주소로 온 빠른 동작은 윈도에서 바로 돌리지 않고 여러 파일 한꺼번에 화면에 올려 둔다 (맥은 Finder 빠른 동작이 주소로 온다)
        let quick = routed_action("kordoc://convert?path=C%3A%5CUsers").unwrap();
        if cfg!(target_os = "macos") {
            assert_eq!(quick.0, "convert");
        } else {
            assert_eq!(quick, ("tools".to_string(), "C:\\Users".to_string()));
            assert!(!is_quick(&quick.0));
        }
        // 창을 여는 동작은 그대로
        assert_eq!(routed_action("kordoc://pdfwork?path=%2Fa.pdf").unwrap().0, "pdfwork");
        assert_eq!(routed_action("kordoc://batch?manifest=x"), None);
    }

    #[test]
    fn exe_mark_is_ascii_whatever_the_path() {
        let m = exe_mark(r"\\?\C:\Users\홍길동\AppData\Local\KorDoc AI\kordoc-ai.exe");
        assert!(m.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(m, exe_mark(r"c:\users\홍길동\appdata\local\kordoc ai\KORDOC-AI.EXE"));
        assert!(reg_script(r"C:\App\kordoc-ai.exe").contains(&format!("\"KorDocExe\"=\"{}\"", exe_mark(r"C:\App\kordoc-ai.exe"))));
    }

    #[test]
    fn manifest_names_never_collide() {
        let a = write_manifest("join", &["a".into(), "b".into()]).unwrap();
        let b = write_manifest("pdf", &["c".into(), "d".into()]).unwrap();
        assert_ne!(a, b);
        for p in [&a, &b] {
            let name = p.file_name().unwrap().to_string_lossy().to_string();
            assert!(name.starts_with("kordoc-batch-") && name.ends_with(".json"));
            assert!(name["kordoc-batch-".len()..name.len() - 5].chars().all(|c| c.is_ascii_digit()), "{name}");
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn drive_root_background_path_is_repaired() {
        // 드라이브 맨 위 빈 곳 우클릭: 명령줄 "D:\" 가 인자 D:" 로 온다
        let a = vec!["app".into(), "--shell".into(), "join".into(), "D:\"".into()];
        assert_eq!(parse_args(&a), Some(("join".into(), vec!["D:\\".into()])));
        // 보통 경로는 그대로
        let b = vec!["app".into(), "--shell".into(), "join".into(), "D:\\자료 모음".into()];
        assert_eq!(parse_args(&b), Some(("join".into(), vec!["D:\\자료 모음".into()])));
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
        assert!(is_quick("pagenum") && is_quick("xlsxmerge") && is_quick("inbox") && is_quick("join") && is_quick("split"));
        assert!(is_quick("pdfsplit") && is_quick("shrink") && !is_quick("pdfwork") && !is_quick("open") && !is_quick("evil"));
        assert_eq!(parse_action_url("kordoc://pdfwork?path=%2Fa.pdf"), Some(("pdfwork".into(), "/a.pdf".into())));
    }
}
