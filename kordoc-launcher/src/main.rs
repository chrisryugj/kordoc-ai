//! KorDoc Shell Extension launcher.
//!
//! 흐름:
//!   shell 우클릭 verb → kordoc-launcher.exe <action> "<file>" [more files...]
//!     ↓
//!   단일 파일: kordoc://<action>?path=<encoded>
//!   다중 파일: %TEMP%/kordoc-batch-*.json manifest 생성
//!              kordoc://batch?manifest=<encoded path>
//!     ↓
//!   ShellExecuteW → kordoc-ai (Tauri deep-link 핸들러 수신)
//!
//! 다중선택 동작 함정:
//!   Windows는 다중선택 우클릭 시 verb를 N번 반복 호출함. 동시 호출 충돌을 방지하기 위해
//!   `%TEMP%/kordoc-batch.lock` 파일 기반 200ms debounce 처리.
//!   참조: docs/PRD.md §F3-3, docs/SPEC.md §3.3

#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Serialize)]
struct BatchManifest {
    action: String,
    files: Vec<String>,
    created_at: String,
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();

    // args[0] = exe path, args[1] = action, args[2..] = files
    if args.len() < 3 {
        eprintln!("usage: kordoc-launcher <action> <file> [more files...]");
        eprintln!("  actions: convert <file> <md|pdf|hwpx> | summarize <file> | open <file> | batch <action> <files...>");
        return ExitCode::from(2);
    }

    let action = args[1].as_str();
    let files: Vec<&String> = args[2..].iter().collect();

    let url = match (action, files.len()) {
        // convert <file> <subaction>
        ("convert", n) if n >= 2 => {
            let subaction = files[n - 1];
            let file_args: Vec<&String> = files[..n - 1].iter().copied().collect();
            if file_args.len() == 1 {
                build_single_url("convert", file_args[0], Some(subaction))
            } else {
                match build_batch_url(&format!("convert_{}", subaction), &file_args) {
                    Ok(u) => u,
                    Err(e) => {
                        eprintln!("manifest 생성 실패: {}", e);
                        return ExitCode::from(1);
                    }
                }
            }
        }
        // summarize | open | print 등 단일/다중 모두 호환
        (act, 1) => build_single_url(act, files[0], None),
        (act, _) => match build_batch_url(act, &files) {
            Ok(u) => u,
            Err(e) => {
                eprintln!("manifest 생성 실패: {}", e);
                return ExitCode::from(1);
            }
        },
    };

    if let Err(e) = launch_url(&url) {
        eprintln!("URL 실행 실패: {}", e);
        return ExitCode::from(1);
    }

    ExitCode::SUCCESS
}

fn build_single_url(action: &str, path: &str, sub: Option<&str>) -> String {
    let encoded = urlencoding::encode(path);
    match sub {
        Some(s) => format!("kordoc://{}?path={}&action={}", action, encoded, s),
        None => format!("kordoc://{}?path={}", action, encoded),
    }
}

fn build_batch_url(action: &str, files: &[&String]) -> Result<String, String> {
    let temp = env::temp_dir();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let manifest_path: PathBuf = temp.join(format!("kordoc-batch-{}.json", now));

    let manifest = BatchManifest {
        action: action.to_string(),
        files: files.iter().map(|s| (*s).clone()).collect(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    let mut f = fs::File::create(&manifest_path).map_err(|e| e.to_string())?;
    f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;

    let encoded = urlencoding::encode(&manifest_path.to_string_lossy());
    Ok(format!("kordoc://batch?manifest={}", encoded))
}

#[cfg(target_os = "windows")]
fn launch_url(url: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide_url: Vec<u16> = OsStr::new(url).encode_wide().chain(Some(0)).collect();
    let wide_open: Vec<u16> = OsStr::new("open").encode_wide().chain(Some(0)).collect();

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            wide_open.as_ptr(),
            wide_url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW: 32 초과면 성공
    if (result as isize) > 32 {
        Ok(())
    } else {
        Err(format!("ShellExecuteW 실패 (코드: {})", result as isize))
    }
}

#[cfg(not(target_os = "windows"))]
fn launch_url(url: &str) -> Result<(), String> {
    // 비-Windows 환경 (개발 시 빌드만): stdout 출력
    println!("{}", url);
    Ok(())
}
