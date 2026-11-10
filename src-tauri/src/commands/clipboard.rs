use crate::error::AppError;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// 파일 이름에 붙일 확장자 — 영문·숫자 1~5자만 (그 밖은 png). 화면이 넘긴 값을 그대로 이름에 넣으면 `x\..\..` 꼴로 임시 폴더 밖에 쓸 수 있다
fn safe_ext(ext: Option<&str>) -> String {
    match ext {
        Some(e) if (1..=5).contains(&e.len()) && e.chars().all(|c| c.is_ascii_alphanumeric()) => e.to_ascii_lowercase(),
        _ => "png".to_string(),
    }
}

/// 붙여 넣은 글·그림을 두는 임시 폴더. 붙여 넣을 때마다 파일이 하나씩 생기므로, 올 때마다 7일 지난 것을 치운다
/// (붙여 넣은 문서 내용이 임시 폴더에 영영 남지 않게)
fn clipboard_dir() -> Result<PathBuf, AppError> {
    let dir = std::env::temp_dir().join("kordoc-ai");
    std::fs::create_dir_all(&dir)?;
    let old = SystemTime::now() - std::time::Duration::from_secs(7 * 24 * 3600);
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let stale = e.metadata().and_then(|m| m.modified()).map(|t| t < old).unwrap_or(false);
            if name.starts_with("clipboard_") && stale {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    Ok(dir)
}

/// 클립보드 이미지(base64)를 임시 파일로 저장하고 경로를 반환
#[tauri::command]
pub async fn save_clipboard_image(
    base64_data: String,
    extension: Option<String>,
) -> Result<String, AppError> {
    let ext = safe_ext(extension.as_deref());

    // base64 디코딩 (순수 구현 — 외부 크레이트 불필요)
    use base64_decode::decode;
    let bytes = decode(&base64_data)
        .map_err(|e| AppError::Sidecar(format!("붙여 넣은 그림을 읽지 못했습니다: {}", e)))?;

    let temp_dir = clipboard_dir()?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("clipboard_{}.{}", ts, ext);
    let path: PathBuf = temp_dir.join(&filename);
    std::fs::write(&path, &bytes)?;

    Ok(path.to_string_lossy().to_string())
}

/// 클립보드 텍스트를 임시 .txt 파일로 저장하고 경로를 반환
#[tauri::command]
pub async fn save_clipboard_text(text: String) -> Result<String, AppError> {
    let temp_dir = clipboard_dir()?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("clipboard_{}.txt", ts);
    let path: PathBuf = temp_dir.join(&filename);

    // BOM + UTF-8
    let mut content = Vec::with_capacity(3 + text.len());
    content.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    content.extend_from_slice(text.as_bytes());
    std::fs::write(&path, &content)?;

    Ok(path.to_string_lossy().to_string())
}

/// 간이 base64 디코더 (표준 + padding 지원)
mod base64_decode {
    const TABLE: [u8; 256] = {
        let mut t = [255u8; 256];
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 {
            t[alphabet[i] as usize] = i as u8;
            i += 1;
        }
        t
    };

    pub fn decode(input: &str) -> Result<Vec<u8>, String> {
        let input: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace() && *b != b'=').collect();
        let mut out = Vec::with_capacity(input.len() * 3 / 4);
        let chunks = input.chunks(4);
        for chunk in chunks {
            let mut buf = [0u8; 4];
            for (i, &b) in chunk.iter().enumerate() {
                let val = TABLE[b as usize];
                if val == 255 { return Err(format!("invalid base64 byte: {}", b as char)); }
                buf[i] = val;
            }
            let n = chunk.len();
            if n >= 2 { out.push((buf[0] << 2) | (buf[1] >> 4)); }
            if n >= 3 { out.push((buf[1] << 4) | (buf[2] >> 2)); }
            if n >= 4 { out.push((buf[2] << 6) | buf[3]); }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_never_escapes_the_temp_folder() {
        assert_eq!(safe_ext(Some("JPG")), "jpg");
        assert_eq!(safe_ext(Some("webp")), "webp");
        assert_eq!(safe_ext(None), "png");
        for bad in ["", r"x\..\..\a", "../a", "a.b", "toolong", "p ng"] {
            assert_eq!(safe_ext(Some(bad)), "png", "{bad}");
        }
    }
}
