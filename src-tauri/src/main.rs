// Prevents additional console window on Windows in release, v2
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Release: %APPDATA%/kordoc-ai/engine.log 파일 로깅
    // Debug: stderr 출력
    #[cfg(not(debug_assertions))]
    {
        use tracing_subscriber::layer::SubscriberExt;
        use tracing_subscriber::util::SubscriberInitExt;

        let log_dir = dirs_next_log_dir();
        let file_appender = tracing_appender::rolling::daily(&log_dir, "engine.log");
        let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

        tracing_subscriber::registry()
            .with(
                tracing_subscriber::fmt::layer()
                    .with_writer(non_blocking)
                    .with_ansi(false),
            )
            .init();

        // _guard must live until app exits — leak it intentionally
        std::mem::forget(_guard);
    }

    #[cfg(debug_assertions)]
    tracing_subscriber::fmt::init();

    kordoc_ai_lib::run();
}

/// %APPDATA%/kordoc-ai (Windows) or ~/.local/share/kordoc-ai (Linux/macOS)
#[cfg(not(debug_assertions))]
fn dirs_next_log_dir() -> std::path::PathBuf {
    let base = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."))
        });
    let dir = base.join("kordoc-ai");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
