//! 설정 파일 속 API 키 암호화 키 — Windows 자격 증명 관리자(DPAPI, 이 사용자만 풂)에 앱 전용 32바이트 키를 두고
//! 엔진(사이드카)에 KORDOC_SECRET_KEY 로 넘긴다. 엔진은 settings.json 의 키를 AES-256-GCM 으로 쓴다(node-sidecar/src/infra/secret-box.ts).
//! macOS 는 넘기지 않는다: 설정 파일은 0600 이고, 키체인은 서명이 바뀌는 업데이트마다 접근 허용 창을 띄운다.

#[cfg(windows)]
pub fn settings_key() -> Option<String> {
    use base64::Engine;
    let entry = match keyring::Entry::new("KorDoc AI", "settings-key") {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("자격 증명 관리자를 열지 못해 설정 키를 암호화하지 않습니다: {}", e);
            return None;
        }
    };
    match entry.get_password() {
        Ok(k) if !k.is_empty() => Some(k),
        // 처음 실행: 새로 만든다. 다른 오류(잠깐 못 읽음)에서 새로 만들면 앞서 암호화한 키를 못 풀게 되니 만들지 않는다
        Err(keyring::Error::NoEntry) | Ok(_) => {
            let mut buf = [0u8; 32];
            if let Err(e) = getrandom::fill(&mut buf) {
                tracing::warn!("설정 키를 만들지 못했습니다: {}", e);
                return None;
            }
            let k = base64::engine::general_purpose::STANDARD.encode(buf);
            match entry.set_password(&k) {
                Ok(()) => Some(k),
                Err(e) => {
                    tracing::warn!("설정 키를 저장하지 못했습니다: {}", e);
                    None
                }
            }
        }
        Err(e) => {
            tracing::warn!("설정 키를 읽지 못했습니다(이번 실행은 암호화하지 않음): {}", e);
            None
        }
    }
}

#[cfg(not(windows))]
pub fn settings_key() -> Option<String> {
    None
}
