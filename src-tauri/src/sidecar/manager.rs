use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio::time::timeout;

use tauri::{Emitter, Manager};

use super::diagnostics::{summarize_response, summarize_value};
use super::protocol::{JsonRpcRequest, JsonRpcResponse};
use crate::error::{AppError, AppResult};

type Pending = Arc<std::sync::Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>;

/// Node 사이드카 프로세스 관리 + JSON-RPC 다중 호출.
///
/// v1 은 호출을 한 줄로 직렬화해서(AI 답 하나 기다리는 동안 미리보기·변환이 다 막힘)
/// v2 는 응답 id 로 갈라 받는다: 요청마다 oneshot 을 pending 표에 걸고,
/// stdout 읽는 OS 스레드가 id 를 보고 해당 oneshot 으로 넘긴다.
/// 알림(id 없음: progress·ai_token·watch_event)은 Tauri 이벤트 `sidecar:notify` 로 그대로.
///
/// stdout 은 tokio async pipe 대신 OS 스레드 blocking 읽기 — Windows 에서 async reader 가
/// 몇 번 읽은 뒤 깨어나지 않던 문제(v1 실측) 때문에 유지.
pub struct SidecarManager {
    child: std::sync::Mutex<Option<std::process::Child>>,
    stdin: Arc<std::sync::Mutex<Option<std::process::ChildStdin>>>,
    pending: Pending,
    start_lock: Mutex<()>,
    status: Arc<RwLock<SidecarStatus>>,
    next_id: AtomicU64,
    app_handle: RwLock<Option<tauri::AppHandle>>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SidecarStatus {
    Stopped,
    Starting,
    Ready,
    Error(String),
}

/// 응답 대기 상한(초). 묶음 변환·검색·수합처럼 파일 수만큼 늘어나는 작업이 거짓으로 끊기지 않게 기본을 넉넉히 둔다.
/// AI·모델 내려받기·셀프테스트는 내장 모델이 CPU 에서 수 분이라 더 길게, 엔진 켜짐 확인(ping)만 짧게.
fn timeout_for(method: &str) -> u64 {
    if method.starts_with("ai_") || method == "llm_download" || method == "engine_selftest" {
        return 3600;
    }
    if method == "ping" {
        return 120;
    }
    1800
}

/// 엔진이 죽었거나 아직 안 켜졌을 때. 프론트(src/lib/rpc.ts DEAD)가 "프로세스 종료" 글자를 보고 엔진을 다시 켜서 한 번 더 부른다
const ENGINE_STOPPED: &str = "문서 엔진이 멈췄습니다(프로세스 종료). 잠시 뒤 다시 시도하세요. 계속되면 앱을 다시 켜세요.";

/// 시간 초과된 호출을 엔진에서도 멈추는 요청. id 를 꼭 싣는다 (없으면 router 가 돌던 작업을 전부 취소한다)
fn cancel_request(id: u64, target: u64) -> JsonRpcRequest {
    JsonRpcRequest::new(id, "cancel", Some(serde_json::json!({ "id": target })))
}

/// 줄 하나 읽기. UTF-8 이 아닌 줄(한국어 Windows 에서 네이티브 모듈이 CP949 로 쓴 로그 등)은 깨진 글자로 바꿔 넘기고
/// 계속 읽는다. 끝(EOF)·읽기 오류에서만 None: 읽기를 멈추면 파이프가 차서 Node 가 쓰다가 멈춘다.
fn read_line_lossy(reader: &mut impl std::io::BufRead) -> Option<String> {
    let mut buf = Vec::new();
    match reader.read_until(b'\n', &mut buf) {
        Ok(0) | Err(_) => None,
        Ok(_) => {
            while matches!(buf.last(), Some(b'\n' | b'\r')) {
                buf.pop();
            }
            Some(String::from_utf8(buf).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()))
        }
    }
}

/// Windows resource_dir 이 `\\?\C:\…` 로 오면 Node 가 import.meta.url 을 이상하게 만든다 — 접두어만 뗀다
fn plain_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        if !rest.starts_with("UNC\\") {
            return PathBuf::from(rest);
        }
    }
    p
}

impl SidecarManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            child: std::sync::Mutex::new(None),
            stdin: Arc::new(std::sync::Mutex::new(None)),
            pending: Arc::new(std::sync::Mutex::new(HashMap::new())),
            start_lock: Mutex::new(()),
            status: Arc::new(RwLock::new(SidecarStatus::Stopped)),
            next_id: AtomicU64::new(1),
            app_handle: RwLock::new(None),
        })
    }

    pub async fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.write().await = Some(handle);
    }

    pub async fn start(&self) -> AppResult<()> {
        let _guard = self.start_lock.lock().await;
        self.kill_child();
        *self.status.write().await = SidecarStatus::Starting;

        let handle = self.app_handle.read().await.clone();
        let (sidecar_dir, entry) = self.locate_sidecar(handle.as_ref())?;
        let node = Self::locate_node(handle.as_ref())?;
        tracing::info!("Starting sidecar: {:?} {:?} (cwd {:?})", node, entry, sidecar_dir);

        let mut cmd = std::process::Command::new(&node);
        cmd.arg(&entry)
            .current_dir(&sidecar_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH");
        if let Some(h) = handle.as_ref() {
            if let Ok(dir) = h.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
                cmd.env("KORDOC_AI_DATA_DIR", plain_path(dir));
            }
        }
        if let Some(key) = crate::secrets::settings_key() {
            cmd.env("KORDOC_SECRET_KEY", key);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            tracing::error!("사이드카 실행 실패 {:?} (cwd {:?}): {}", node, sidecar_dir, e);
            AppError::Sidecar(format!("문서 엔진을 켜지 못했습니다. 백신 프로그램이 막았는지 확인하고, 계속되면 앱을 다시 설치하세요. ({})", e))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| AppError::Sidecar("문서 엔진을 켜지 못했습니다. 앱을 다시 켜세요.".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| AppError::Sidecar("문서 엔진을 켜지 못했습니다. 앱을 다시 켜세요.".into()))?;

        if let Some(stderr) = child.stderr.take() {
            let h = handle.clone();
            std::thread::Builder::new()
                .name("sidecar-stderr".into())
                .spawn(move || {
                    let mut reader = std::io::BufReader::new(stderr);
                    while let Some(line) = read_line_lossy(&mut reader) {
                        tracing::info!(target: "sidecar::stderr", "{}", line);
                        if let Some(h) = h.as_ref() {
                            let _ = h.emit("sidecar:log", &line);
                        }
                    }
                })?;
        }

        let pending = Arc::clone(&self.pending);
        let status = Arc::clone(&self.status);
        let h = handle.clone();
        std::thread::Builder::new()
            .name("sidecar-stdout".into())
            .spawn(move || {
                let mut reader = std::io::BufReader::new(stdout);
                while let Some(line) = read_line_lossy(&mut reader) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let resp = match serde_json::from_str::<JsonRpcResponse>(trimmed) {
                        Ok(r) => r,
                        Err(e) => {
                            tracing::warn!("[sidecar] stdout 파싱 실패: {} ({}B)", e, trimmed.len());
                            continue;
                        }
                    };
                    if resp.is_notification() {
                        if let Some(h) = h.as_ref() {
                            let method = resp.method.clone().unwrap_or_default();
                            let params = resp.params.clone().unwrap_or_default();
                            if method == "progress" {
                                let _ = h.emit("pipeline:progress", params.clone()); // v1 화면 호환
                            }
                            let _ = h.emit("sidecar:notify", serde_json::json!({ "method": method, "params": params }));
                        }
                        continue;
                    }
                    if let Some(id) = resp.id {
                        let tx = pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                        match tx {
                            Some(tx) => {
                                let _ = tx.send(resp);
                            }
                            None => tracing::warn!("[sidecar] 주인 없는 응답 id={}", id),
                        }
                    }
                }
                // 프로세스 종료: 기다리던 호출을 전부 깨운다 (sender drop → 수신 측 오류)
                pending.lock().unwrap_or_else(|e| e.into_inner()).clear();
                if let Ok(mut s) = status.try_write() {
                    if *s == SidecarStatus::Ready || *s == SidecarStatus::Starting {
                        *s = SidecarStatus::Error("프로세스 종료됨".into());
                    }
                }
                tracing::info!("stdout reader thread exiting");
            })?;

        *self.stdin.lock().unwrap_or_else(|e| e.into_inner()) = Some(stdin);
        *self.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);

        match self.call("ping", None).await {
            Ok(resp) if resp.result.as_ref().and_then(|v| v.as_str()) == Some("pong") => {
                *self.status.write().await = SidecarStatus::Ready;
                tracing::info!("Sidecar ready");
                Ok(())
            }
            Ok(_) => {
                let msg = "문서 엔진이 켜졌지만 응답이 맞지 않습니다. 앱을 다시 켜고, 계속되면 앱을 다시 설치하세요.";
                *self.status.write().await = SidecarStatus::Error(msg.into());
                Err(AppError::Sidecar(msg.into()))
            }
            Err(e) => {
                *self.status.write().await = SidecarStatus::Error(e.to_string());
                Err(e)
            }
        }
    }

    fn write_line(&self, request: &JsonRpcRequest) -> AppResult<()> {
        let mut line = serde_json::to_string(request)?;
        line.push('\n');
        let mut guard = self.stdin.lock().map_err(|e| {
            tracing::warn!("[sidecar] stdin lock poisoned: {}", e);
            AppError::Sidecar(ENGINE_STOPPED.into())
        })?;
        let stdin = guard.as_mut().ok_or_else(|| AppError::Sidecar(ENGINE_STOPPED.into()))?;
        stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()).map_err(|e| {
            tracing::warn!("[sidecar] stdin 쓰기 실패: {}", e);
            AppError::Sidecar(ENGINE_STOPPED.into())
        })?;
        Ok(())
    }

    pub async fn call(&self, method: &str, params: Option<serde_json::Value>) -> AppResult<JsonRpcResponse> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let request = JsonRpcRequest::new(id, method, params);

        // cancel 은 응답을 기다리지 않는다 (취소 대상이 끝나길 기다리면 의미가 없다)
        if method == "cancel" {
            self.write_line(&request)?;
            return Ok(JsonRpcResponse::synthetic(id, serde_json::json!({ "cancelled": true })));
        }

        let secs = timeout_for(method);
        let started = Instant::now();
        self.emit_runtime_log(format!("[sidecar.call] -> {} id={} params={}", method, id, summarize_value(request.params.as_ref())))
            .await;

        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).insert(id, tx);
        if let Err(e) = self.write_line(&request) {
            self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            return Err(e);
        }

        let result = match timeout(Duration::from_secs(secs), rx).await {
            Ok(Ok(resp)) => Ok(resp),
            Ok(Err(_)) => Err(AppError::Sidecar(ENGINE_STOPPED.into())),
            Err(_) => {
                self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                // 엔진 쪽 작업도 멈춘다 (받을 곳이 없는데 계속 돌며 차선을 막지 않게). 못 보내도 그만
                let _ = self.write_line(&cancel_request(self.next_id.fetch_add(1, Ordering::SeqCst), id));
                tracing::warn!("[sidecar] {} id={} {}초 시간 초과, 취소 요청", method, id, secs);
                Err(AppError::Sidecar(if method == "ping" {
                    "문서 엔진이 제때 켜지지 않았습니다. 앱을 다시 켜세요.".into()
                } else {
                    "작업이 너무 오래 걸려 멈췄습니다. 파일 수를 줄이거나 다시 시도하세요.".into()
                }))
            }
        };
        let elapsed = started.elapsed().as_secs_f32();
        match &result {
            Ok(resp) => self.emit_runtime_log(format!("[sidecar.call] <- {} {:.1}s {}", method, elapsed, summarize_response(resp))).await,
            Err(e) => self.emit_runtime_log(format!("[sidecar.call] !! {} {:.1}s {}", method, elapsed, e)).await,
        }
        result
    }

    pub async fn status(&self) -> SidecarStatus {
        let mut status_guard = self.status.write().await;
        if *status_guard == SidecarStatus::Ready {
            let crashed = {
                let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
                guard.as_mut().map(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(false)
            };
            if crashed {
                *status_guard = SidecarStatus::Error("프로세스 종료됨".into());
            }
        }
        status_guard.clone()
    }

    pub async fn restart_if_crashed(&self) -> AppResult<()> {
        match self.status().await {
            SidecarStatus::Error(_) | SidecarStatus::Stopped => {
                tracing::info!("Sidecar crashed or stopped, restarting...");
                self.start().await
            }
            _ => Ok(()),
        }
    }

    fn kill_child(&self) {
        if let Some(mut child) = self.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *self.stdin.lock().unwrap_or_else(|e| e.into_inner()) = None;
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    pub async fn stop(&self) {
        // stdin 을 닫으면 사이드카가 스스로 종료한다 (rl close → exit). 3초 안에 안 끝나면 kill.
        *self.stdin.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let exited = {
                let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
                guard.as_mut().map(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(true)
            };
            if exited || Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        self.kill_child();
        *self.status.write().await = SidecarStatus::Stopped;
    }

    /// Node 런타임: 설치본은 리소스 폴더의 동봉 node, 개발은 src-tauri/resources/node → 시스템 node
    fn locate_node(handle: Option<&tauri::AppHandle>) -> AppResult<PathBuf> {
        let exe = if cfg!(windows) { "node.exe" } else { "node" };
        #[cfg(debug_assertions)]
        if let Ok(p) = std::env::var("KORDOC_NODE_PATH") {
            let p = PathBuf::from(p);
            if p.exists() {
                return Ok(p);
            }
        }
        if let Some(dir) = handle.and_then(|h| h.path().resource_dir().ok()) {
            let bundled = plain_path(dir).join("node").join(exe);
            if bundled.exists() {
                return Ok(bundled);
            }
        }
        #[cfg(debug_assertions)]
        for c in ["resources/node", "src-tauri/resources/node"] {
            let p = PathBuf::from(c).join(exe);
            if p.exists() {
                return Ok(p);
            }
        }
        // 시스템 Node 는 개발 실행에서만 — 설치본이 몰래 시스템 Node 로 돌면 묶음이 깨져도 개발 PC 에선 멀쩡해 보이고,
        // Node 가 없는 PC 에서만 터진다 (버전이 다른 Node 로 도는 것도 막는다)
        #[cfg(debug_assertions)]
        let which = if cfg!(windows) { "where" } else { "which" };
        #[cfg(debug_assertions)]
        if let Ok(out) = std::process::Command::new(which).arg("node").output() {
            if out.status.success() {
                if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().next() {
                    let p = PathBuf::from(line.trim());
                    if p.exists() {
                        return Ok(p);
                    }
                }
            }
        }
        Err(AppError::Sidecar("문서 엔진 실행 파일(Node)이 없습니다. 앱을 다시 설치하세요.".into()))
    }

    /// (작업 폴더, 진입 파일). 설치본: <resources>/node-sidecar/dist/bundle.mjs.
    /// 개발: ../node-sidecar 의 tsc 출력(dist/main.js, node_modules 사용).
    fn locate_sidecar(&self, handle: Option<&tauri::AppHandle>) -> AppResult<(PathBuf, PathBuf)> {
        #[cfg(debug_assertions)]
        {
            let mut candidates: Vec<PathBuf> = vec![PathBuf::from("../node-sidecar"), PathBuf::from("node-sidecar")];
            if let Ok(dir) = std::env::var("KORDOC_SIDECAR_DIR") {
                candidates.insert(0, PathBuf::from(dir));
            }
            for c in candidates {
                if c.join("dist/main.js").exists() && c.join("node_modules").exists() {
                    return Ok((c, PathBuf::from("dist/main.js")));
                }
            }
        }
        if let Some(dir) = handle.and_then(|h| h.path().resource_dir().ok()) {
            let prod = plain_path(dir).join("node-sidecar");
            if prod.join("dist/bundle.mjs").exists() {
                return Ok((prod, PathBuf::from("dist/bundle.mjs")));
            }
        }
        Err(AppError::Sidecar("문서 엔진 파일이 없습니다. 앱을 다시 설치하세요.".into()))
    }

    async fn emit_runtime_log(&self, line: String) {
        tracing::info!(target: "sidecar::rpc", "{}", line);
        if let Some(handle) = self.app_handle.read().await.clone() {
            let _ = handle.emit("sidecar:log", &line);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reader_keeps_going_after_non_utf8_line() {
        // 한국어 Windows 네이티브 모듈이 stderr 에 CP949 로 쓴 "한글"(CRLF) 다음 줄도 읽혀야 한다
        let mut r = std::io::Cursor::new(b"{\"id\":1}\n\xc7\xd1\xb1\xdb\r\n{\"id\":2}\r\nlast".to_vec());
        assert_eq!(read_line_lossy(&mut r).as_deref(), Some("{\"id\":1}"));
        assert!(read_line_lossy(&mut r).unwrap().contains('\u{FFFD}'));
        assert_eq!(read_line_lossy(&mut r).as_deref(), Some("{\"id\":2}"));
        assert_eq!(read_line_lossy(&mut r).as_deref(), Some("last"));
        assert_eq!(read_line_lossy(&mut r), None);
    }

    #[test]
    fn long_jobs_do_not_time_out_at_two_minutes() {
        for m in [
            "to_hwpx", "to_hwpx_batch", "compare_hwpx", "bundle_pdf", "pdf_stamp", "extract_images", "search_files",
            "collect_fields", "collect_run", "template_add", "template_analyze", "inbox_add", "law_check", "convert_batch",
        ] {
            assert_eq!(timeout_for(m), 1800, "{m}");
        }
        for m in ["ai_summarize", "ai_fit_lines", "llm_download", "engine_selftest"] {
            assert_eq!(timeout_for(m), 3600, "{m}");
        }
        assert_eq!(timeout_for("ping"), 120);
    }

    #[test]
    fn timeout_cancel_names_only_that_call() {
        let v = serde_json::to_value(cancel_request(8, 7)).unwrap();
        assert_eq!(v, serde_json::json!({ "jsonrpc": "2.0", "id": 8, "method": "cancel", "params": { "id": 7 } }));
    }

    #[test]
    fn engine_stopped_keeps_frontend_retry_marker() {
        // src/lib/rpc.ts 의 DEAD = /not started|closed|write failed|프로세스 종료/i
        assert!(ENGINE_STOPPED.contains("프로세스 종료"));
    }
}
