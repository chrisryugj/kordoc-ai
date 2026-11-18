//! 웹뷰 저장소 지우기 (설정 › 보안 › 작업 흔적 모두 지우기)
//!
//! 내장 편집기는 고치던 문서를 자동 저장(IndexedDB)에 두는데, 옛 판은 켤 때마다 다른 포트로 떠서
//! 그 출처의 저장소를 앱이 다시 열 수 없었다. 웹뷰 프로필의 IndexedDB·캐시를 모든 출처에서 지운다.
//! 본창은 IndexedDB 를 쓰지 않고(설정·대화는 localStorage) 화면 설정이 지워지지 않게 localStorage 는 건드리지 않는다.

#[tauri::command]
pub fn wipe_web_storage(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS, COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
            COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, COREWEBVIEW2_BROWSING_DATA_KINDS_INDEXED_DB,
        };
        use webview2_com::ClearBrowsingDataCompletedHandler;
        use windows_core::Interface;

        let kinds = COREWEBVIEW2_BROWSING_DATA_KINDS(
            COREWEBVIEW2_BROWSING_DATA_KINDS_INDEXED_DB.0 | COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE.0 | COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE.0,
        );
        window
            .with_webview(move |wv| unsafe {
                let done = (|| -> windows_core::Result<()> {
                    let core = wv.controller().CoreWebView2()?;
                    let profile = core.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile2>()?;
                    profile.ClearBrowsingData(kinds, &ClearBrowsingDataCompletedHandler::create(Box::new(|_| Ok(()))))
                })();
                if let Err(e) = done {
                    tracing::warn!("웹뷰 저장소 지우기 실패: {e}");
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}
