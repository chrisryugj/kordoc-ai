use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};
use tokio::time::timeout;

use tauri::Emitter;

use super::protocol::{JsonRpcRequest, JsonRpcResponse};
use crate::error::{AppError, AppResult};

/// Blocking stdout/stdin via std::process + std::thread.
/// tokio::process의 async pipe reader는 Windows에서 몇 회 read 후 wake-up이
/// 안 되는 문제가 있어, OS 스레드 기반 blocking IO로 완전 교체.
pub struct SidecarManager {
    child: std::sync::Mutex<Option<std::process::Child>>,
    stdin: std::sync::Mutex<Option<std::process::ChildStdin>>,
    /// Dedicated OS thread sends stdout lines through this channel.
    stdout_rx: Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<String>>>,
    /// Serializes RPC calls to prevent stdin/stdout interleaving
    call_lock: Mutex<()>,
    status: RwLock<SidecarStatus>,
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

impl SidecarManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            child: std::sync::Mutex::new(None),
            stdin: std::sync::Mutex::new(None),
            stdout_rx: Mutex::new(None),
            call_lock: Mutex::new(()),
            status: RwLock::new(SidecarStatus::Stopped),
            next_id: AtomicU64::new(1),
            app_handle: RwLock::new(None),
        })
    }

    pub async fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.write().await = Some(handle);
    }

    pub async fn start(&self, python_path: &str) -> AppResult<()> {
        // Clean up any existing state before starting
        if let Some(mut old_child) = self.child.lock().unwrap().take() {
            let _ = old_child.kill();
        }
        *self.stdin.lock().unwrap() = None;
        *self.stdout_rx.lock().await = None;

        *self.status.write().await = SidecarStatus::Starting;

        let sidecar_dir = self.get_sidecar_dir();
        tracing::info!("Starting sidecar from: {:?}", sidecar_dir);

        // Check for PyInstaller-bundled exe first (MZ 헤더로 실제 PE 여부 검증, placeholder 제외)
        let sidecar_exe = sidecar_dir.join("eduplan-sidecar.exe");
        let is_real_exe = sidecar_exe.exists() && {
            let mut buf = [0u8; 2];
            std::fs::File::open(&sidecar_exe)
                .and_then(|mut f| {
                    use std::io::Read;
                    f.read_exact(&mut buf)
                })
                .map(|_| buf == *b"MZ")
                .unwrap_or(false)
        };

        let mut cmd = if is_real_exe {
            tracing::info!("Using bundled sidecar exe: {:?}", sidecar_exe);
            let mut cmd = std::process::Command::new(&sidecar_exe);
            cmd.current_dir(&sidecar_dir)
                .env("PYTHONUNBUFFERED", "1");
            cmd
        } else {
            let mut cmd = std::process::Command::new(python_path);
            cmd.args(["-u", "main.py"])
                .current_dir(&sidecar_dir);
            cmd
        };

        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // Suppress console window on Windows
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            AppError::Sidecar(format!("Failed to spawn sidecar in {:?}: {}", sidecar_dir, e))
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Sidecar("Failed to capture stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Sidecar("Failed to capture stdout".into()))?;

        // Drain stderr in background OS thread and forward to frontend as events
        if let Some(stderr) = child.stderr.take() {
            let handle_for_stderr = self.app_handle.read().await.clone();
            std::thread::Builder::new()
                .name("sidecar-stderr".into())
                .spawn(move || {
                    use std::io::BufRead;
                    let reader = std::io::BufReader::new(stderr);
                    for line_result in reader.lines() {
                        match line_result {
                            Ok(line) => {
                                tracing::info!(target: "sidecar::stderr", "{}", line);
                                if let Some(ref handle) = handle_for_stderr {
                                    let _ = handle.emit("sidecar:log", &line);
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    tracing::info!("stderr reader thread exiting");
                })
                .map_err(|e| {
                    AppError::Sidecar(format!("Failed to spawn stderr reader: {}", e))
                })?;
        }

        // Dedicated stdout reader: blocking OS thread → channel.
        // tokio async pipe reader on Windows loses wake-up after a few reads.
        // Blocking std::io::BufReader is 100% reliable on Windows pipes.
        let (stdout_tx, stdout_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let handle_for_stdout = self.app_handle.read().await.clone();
        std::thread::Builder::new()
            .name("sidecar-stdout".into())
            .spawn(move || {
                use std::io::BufRead;
                let reader = std::io::BufReader::new(stdout);
                for line_result in reader.lines() {
                    match line_result {
                        Ok(line) => {
                            let trimmed = line.trim().to_string();
                            if trimmed.is_empty() {
                                continue;
                            }
                            // 진단: 매 라인 수신 로그
                            let preview_len = trimmed.len().min(120);
                            let mut safe_end = preview_len;
                            while safe_end > 0 && !trimmed.is_char_boundary(safe_end) {
                                safe_end -= 1;
                            }
                            tracing::info!(
                                "[reader] got {}B: {}{}",
                                trimmed.len(),
                                &trimmed[..safe_end],
                                if trimmed.len() > 120 { "..." } else { "" }
                            );
                            if let Some(ref handle) = handle_for_stdout {
                                let _ = handle.emit("sidecar:log", &format!(
                                    "[reader] got {}B line",
                                    trimmed.len()
                                ));
                            }

                            // Handle progress notifications directly in the reader
                            // so they are forwarded immediately without waiting for call_inner
                            if let Ok(resp) =
                                serde_json::from_str::<JsonRpcResponse>(&trimmed)
                            {
                                if resp.is_notification() {
                                    if resp.method.as_deref() == Some("progress") {
                                        if let Some(ref handle) = handle_for_stdout {
                                            let payload =
                                                resp.params.clone().unwrap_or_default();
                                            let _ =
                                                handle.emit("pipeline:progress", payload);
                                        }
                                    }
                                    tracing::debug!("Notification: {:?}", resp.method);
                                    continue; // Don't forward notifications to channel
                                }
                            }
                            // Forward response lines (and unparseable lines) to channel
                            tracing::info!("[reader] sending to channel...");
                            if stdout_tx.send(trimmed).is_err() {
                                tracing::info!("stdout reader: channel closed, exiting");
                                break;
                            }
                            tracing::info!("[reader] sent to channel OK");
                        }
                        Err(e) => {
                            tracing::warn!("stdout reader: error: {}", e);
                            break;
                        }
                    }
                }
                tracing::info!("stdout reader thread exiting");
            })
            .map_err(|e| {
                AppError::Sidecar(format!("Failed to spawn stdout reader: {}", e))
            })?;

        *self.stdin.lock().unwrap() = Some(stdin);
        *self.stdout_rx.lock().await = Some(stdout_rx);
        *self.child.lock().unwrap() = Some(child);

        // Send ping to verify sidecar is ready
        match self.call("ping", None).await {
            Ok(resp) => {
                if let Some(result) = resp.result {
                    if result.as_str() == Some("pong") {
                        *self.status.write().await = SidecarStatus::Ready;
                        tracing::info!("Sidecar ready");
                        return Ok(());
                    }
                }
                let msg = "Unexpected ping response";
                *self.status.write().await = SidecarStatus::Error(msg.into());
                Err(AppError::Sidecar(msg.into()))
            }
            Err(e) => {
                *self.status.write().await = SidecarStatus::Error(e.to_string());
                Err(e)
            }
        }
    }

    pub async fn call(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> AppResult<JsonRpcResponse> {
        // Cancel is fire-and-forget: write to stdin, don't wait for response
        // This avoids deadlock when a long-running call holds call_lock
        if method == "cancel" {
            return self.send_fire_and_forget(method, params);
        }

        // Long-running methods: pipeline tasks 10min, browser tools 3min, others 60s
        let timeout_secs = match method {
            "ocr_files" | "extract_pages" | "summarize" | "integrate"
            | "tag_pages" => 600,
            "browser_tool" => 180,
            _ => 60,
        };
        let params_preview = summarize_value(params.as_ref());
        let started = Instant::now();
        self.emit_runtime_log(format!(
            "[sidecar.call] -> method={} timeout={}s params={}",
            method, timeout_secs, params_preview
        ))
        .await;

        // Serialize all calls to prevent stdin/stdout interleaving
        let _call_guard = self.call_lock.lock().await;

        match timeout(
            Duration::from_secs(timeout_secs),
            self.call_inner(method, params),
        )
        .await
        {
            Ok(Ok(resp)) => {
                self.emit_runtime_log(format!(
                    "[sidecar.call] <- method={} elapsed={:.1}s result={}",
                    method,
                    started.elapsed().as_secs_f32(),
                    summarize_response(&resp)
                ))
                .await;
                Ok(resp)
            }
            Ok(Err(err)) => {
                self.emit_runtime_log(format!(
                    "[sidecar.call] !! method={} elapsed={:.1}s error={}",
                    method,
                    started.elapsed().as_secs_f32(),
                    err
                ))
                .await;
                Err(err)
            }
            Err(_) => {
                let err = AppError::Sidecar(format!(
                    "Timeout after {}s for method '{}'",
                    timeout_secs, method
                ));
                self.emit_runtime_log(format!(
                    "[sidecar.call] !! method={} elapsed={:.1}s error={}",
                    method,
                    started.elapsed().as_secs_f32(),
                    err
                ))
                .await;
                Err(err)
            }
        }
    }

    /// Send a request without waiting for a response (for cancel).
    /// Uses blocking stdin write (fast — small payload, large pipe buffer).
    fn send_fire_and_forget(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> AppResult<JsonRpcResponse> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let request = JsonRpcRequest::new(id, method, params);
        let mut request_str = serde_json::to_string(&request)?;
        request_str.push('\n');

        let mut stdin_guard = self
            .stdin
            .lock()
            .map_err(|e| AppError::Sidecar(format!("stdin lock poisoned: {}", e)))?;
        let stdin = stdin_guard
            .as_mut()
            .ok_or_else(|| AppError::Sidecar("Sidecar not started".into()))?;
        use std::io::Write;
        stdin
            .write_all(request_str.as_bytes())
            .map_err(|e| AppError::Sidecar(format!("Write failed: {}", e)))?;
        stdin
            .flush()
            .map_err(|e| AppError::Sidecar(format!("Flush failed: {}", e)))?;

        Ok(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(id),
            result: Some(serde_json::json!({"cancelled": true})),
            error: None,
            method: None,
            params: None,
        })
    }

    async fn call_inner(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> AppResult<JsonRpcResponse> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let request = JsonRpcRequest::new(id, method, params);
        let mut request_str = serde_json::to_string(&request)?;
        request_str.push('\n');

        // Clone app_handle upfront to avoid holding RwLock inside response loop
        let app_handle = self.app_handle.read().await.clone();

        // Write request to stdin (blocking but fast — small payload, large pipe buffer)
        tracing::info!("[call_inner] writing request id={} method={}", id, method);
        {
            let mut stdin_guard = self
                .stdin
                .lock()
                .map_err(|e| AppError::Sidecar(format!("stdin lock poisoned: {}", e)))?;
            let stdin = stdin_guard
                .as_mut()
                .ok_or_else(|| AppError::Sidecar("Sidecar not started".into()))?;
            use std::io::Write;
            stdin
                .write_all(request_str.as_bytes())
                .map_err(|e| AppError::Sidecar(format!("Write failed: {}", e)))?;
            stdin
                .flush()
                .map_err(|e| AppError::Sidecar(format!("Flush failed: {}", e)))?;
        }
        tracing::info!("[call_inner] request sent, waiting for response id={}", id);

        // Read responses from channel (fed by dedicated OS thread reader)
        let mut rx_guard = self.stdout_rx.lock().await;
        let rx = rx_guard
            .as_mut()
            .ok_or_else(|| AppError::Sidecar("No stdout channel".into()))?;

        let mut read_count: u32 = 0;
        loop {
            // Per-message timeout: 120s without any response from channel
            let trimmed = match timeout(Duration::from_secs(120), rx.recv()).await {
                Ok(Some(line)) => line,
                Ok(None) => {
                    return Err(AppError::Sidecar("Sidecar process closed".into()));
                }
                Err(_) => {
                    let timeout_msg = format!(
                        "[sidecar] channel timeout: no response for 120s, method={}, id={}, reads={}",
                        method, id, read_count
                    );
                    tracing::warn!("{}", timeout_msg);
                    if let Some(handle) = app_handle.as_ref() {
                        let _ = handle.emit("sidecar:log", &timeout_msg);
                    }
                    return Err(AppError::Sidecar(format!(
                        "Sidecar response timeout 120s (method={}, reads={})",
                        method, read_count
                    )));
                }
            };

            read_count += 1;
            match serde_json::from_str::<JsonRpcResponse>(&trimmed) {
                Ok(resp) => {
                    if resp.id == Some(id) {
                        return Ok(resp);
                    }
                    // Orphan response — log visibly for debugging
                    let orphan_msg = format!(
                        "[sidecar] orphan response: got id={:?}, expected id={}, reads={}",
                        resp.id, id, read_count
                    );
                    tracing::warn!("{}", orphan_msg);
                    if let Some(handle) = app_handle.as_ref() {
                        let _ = handle.emit("sidecar:log", &orphan_msg);
                    }
                }
                Err(e) => {
                    let preview = if trimmed.len() > 200 {
                        format!("{}...({}B)", &trimmed[..200], trimmed.len())
                    } else {
                        trimmed.clone()
                    };
                    let err_msg = format!(
                        "[sidecar] parse error (id={}, reads={}): {} — {}",
                        id, read_count, e, preview
                    );
                    tracing::warn!("{}", err_msg);
                    if let Some(handle) = app_handle.as_ref() {
                        let _ = handle.emit("sidecar:log", &err_msg);
                    }
                    // JSON 객체인데 파싱 실패 = 응답이 깨진 것 → 무한 대기 대신 에러 반환
                    if trimmed.starts_with('{') && trimmed.ends_with('}') {
                        return Err(AppError::Sidecar(format!(
                            "JSON-RPC 응답 파싱 실패: {}",
                            e
                        )));
                    }
                }
            }
        }
    }

    pub async fn status(&self) -> SidecarStatus {
        // Use write lock for atomic check-and-update (prevents TOCTOU race)
        let mut status_guard = self.status.write().await;
        if *status_guard == SidecarStatus::Ready {
            let crashed = {
                let mut guard = self.child.lock().unwrap();
                if let Some(child) = guard.as_mut() {
                    matches!(child.try_wait(), Ok(Some(_)))
                } else {
                    false
                }
            };
            if crashed {
                *status_guard = SidecarStatus::Error("프로세스 종료됨".into());
            }
        }
        status_guard.clone()
    }

    /// Restart sidecar if it has crashed
    pub async fn restart_if_crashed(&self) -> AppResult<()> {
        let status = self.status().await;
        match status {
            SidecarStatus::Error(_) | SidecarStatus::Stopped => {
                tracing::info!("Sidecar crashed or stopped, restarting...");
                let python = if cfg!(windows) { "python" } else { "python3" };
                self.start(python).await
            }
            _ => Ok(()),
        }
    }

    #[allow(dead_code)]
    pub async fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        *self.stdin.lock().unwrap() = None;
        *self.stdout_rx.lock().await = None;
        *self.status.write().await = SidecarStatus::Stopped;
    }

    fn get_sidecar_dir(&self) -> std::path::PathBuf {
        if let Ok(dir) = std::env::var("EDUPLAN_SIDECAR_DIR") {
            return std::path::PathBuf::from(dir);
        }

        // 개발 환경 우선: 소스 main.py가 있으면 source 디렉토리 사용 (최신 코드 반영)
        // Tauri dev 빌드는 리소스를 target/debug/python-sidecar/에 복사하므로
        // 소스 경로를 먼저 확인해야 번들 exe 대신 python main.py를 사용함
        let dev_candidates = [
            std::path::PathBuf::from("../python-sidecar"),
            std::path::PathBuf::from("python-sidecar"),
        ];

        for c in &dev_candidates {
            if c.join("main.py").exists() {
                return c.clone();
            }
        }

        // 프로덕션: exe 옆 python-sidecar/ (MSI 설치 후 경로)
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                let prod_dir = exe_dir.join("python-sidecar");
                if prod_dir.join("eduplan-sidecar.exe").exists()
                    || prod_dir.join("main.py").exists()
                {
                    return prod_dir;
                }
            }
        }

        std::path::PathBuf::from("python-sidecar")
    }

    async fn emit_runtime_log(&self, line: String) {
        tracing::info!(target: "sidecar::rpc", "{}", line);
        if let Some(handle) = self.app_handle.read().await.clone() {
            let _ = handle.emit("sidecar:log", &line);
        }
    }
}

fn summarize_value(value: Option<&serde_json::Value>) -> String {
    fn shorten_path(value: &str) -> String {
        std::path::Path::new(value)
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or(value)
            .to_string()
    }

    fn preview(value: &serde_json::Value, depth: usize) -> serde_json::Value {
        use serde_json::{Map, Value};

        if depth >= 3 {
            return Value::String("<...>".into());
        }

        match value {
            Value::Object(map) => {
                let mut out = Map::new();
                for (idx, (key, item)) in map.iter().enumerate() {
                    if idx >= 10 {
                        out.insert(
                            "...".into(),
                            Value::String(format!("+{} more", map.len() - idx)),
                        );
                        break;
                    }
                    let lowered = key.to_ascii_lowercase();
                    let summarized = if lowered.contains("api_key")
                        || lowered.contains("token")
                        || lowered.contains("authorization")
                    {
                        Value::String("***redacted***".into())
                    } else if lowered == "files" {
                        match item {
                            Value::Array(items) => {
                                let mut arr = items
                                    .iter()
                                    .take(5)
                                    .map(|entry| match entry {
                                        Value::String(text) => Value::String(shorten_path(text)),
                                        other => preview(other, depth + 1),
                                    })
                                    .collect::<Vec<_>>();
                                if items.len() > 5 {
                                    arr.push(Value::String(format!("... +{}", items.len() - 5)));
                                }
                                Value::Array(arr)
                            }
                            other => preview(other, depth + 1),
                        }
                    } else if lowered.ends_with("_dir")
                        || lowered.ends_with("_path")
                        || lowered.ends_with("_file")
                        || lowered.ends_with("_folder")
                    {
                        match item {
                            Value::String(text) => Value::String(shorten_path(text)),
                            other => preview(other, depth + 1),
                        }
                    } else if lowered == "tags"
                        || lowered == "warnings"
                        || lowered == "steps"
                        || lowered == "thumbnails"
                    {
                        match item {
                            Value::Array(items) => Value::String(format!("{} items", items.len())),
                            other => preview(other, depth + 1),
                        }
                    } else {
                        preview(item, depth + 1)
                    };
                    out.insert(key.clone(), summarized);
                }
                Value::Object(out)
            }
            Value::Array(items) => {
                let mut arr = items
                    .iter()
                    .take(5)
                    .map(|item| preview(item, depth + 1))
                    .collect::<Vec<_>>();
                if items.len() > 5 {
                    arr.push(Value::String(format!("... +{}", items.len() - 5)));
                }
                Value::Array(arr)
            }
            Value::String(text) => {
                let compact = text.replace('\n', "\\n");
                if compact.len() > 200 {
                    // UTF-8 char boundary 안전 슬라이싱 (한글 3바이트 중간 방지)
                    let mut end = 197;
                    while end > 0 && !compact.is_char_boundary(end) {
                        end -= 1;
                    }
                    Value::String(format!("{}...", &compact[..end]))
                } else {
                    Value::String(compact)
                }
            }
            other => other.clone(),
        }
    }

    match value {
        Some(v) => {
            serde_json::to_string(&preview(v, 0)).unwrap_or_else(|_| "<unserializable>".into())
        }
        None => "null".into(),
    }
}

fn summarize_response(resp: &JsonRpcResponse) -> String {
    if let Some(result) = resp.result.as_ref() {
        return summarize_value(Some(result));
    }
    if let Some(err) = resp.error.as_ref() {
        return err.message.clone();
    }
    "null".into()
}
