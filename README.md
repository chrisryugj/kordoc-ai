# kordoc-shell

> KorDoc Suite — Windows Shell Extension (MSIX Sparse Package)
>
> 탐색기 우클릭만으로 한국 공문서 (HWP/HWPX/PDF/XLS/XLSX/DOC/DOCX) 변환·요약·인쇄.

---

## 구조

```
kordoc-shell/
├── manifest/                  # MSIX 패키지 매니페스트
│   ├── AppxManifest.xml       # 앱 식별자 + 파일 연결 + kordoc:// 프로토콜
│   └── Microsoft.Registry.xml # 컨텍스트 메뉴 RegistryData
├── kordoc-launcher/           # Rust 단일 exe 런처
│   ├── Cargo.toml
│   └── src/main.rs            # verb → kordoc:// deep-link 변환
├── assets/icons/              # MSIX 요구 PNG (placeholder)
├── scripts/                   # 빌드/서명/설치 PowerShell
│   ├── build.ps1              # cargo build + MakeAppx pack
│   ├── sign.ps1               # 자체서명 인증서 + SignTool
│   ├── install-dev.ps1        # build → sign → Add-AppxPackage
│   └── uninstall-dev.ps1
└── docs/                      # (참조: kordoc-ai/docs/{PRD,ROADMAP,SPEC}.md)
```

## 빌드 & 설치 (개발 환경)

### 요구 사항
- Windows 10 1809+ (Build 17763)
- Rust toolchain (`cargo`) — https://rustup.rs
- Windows SDK 10.0.17763+ — `MakeAppx.exe`, `SignTool.exe`
- 관리자 PowerShell (자체서명 cert 설치용)

### 단계
```powershell
# 한방에 — 관리자 PowerShell
.\scripts\install-dev.ps1

# 또는 단계별
.\scripts\build.ps1          # 1) Rust + MSIX
.\scripts\sign.ps1           # 2) 자체서명
Add-AppxPackage build\KorDocShell.msix -ExternalLocation .
```

### 제거
```powershell
.\scripts\uninstall-dev.ps1
```

## 컨텍스트 메뉴 동작

탐색기에서 지원 확장자 우클릭 → **KorDoc** 서브메뉴:

| 메뉴 | 동작 | 호출 URL |
|------|------|----------|
| 마크다운으로 변환 | `convert` action, `md` subaction | `kordoc://convert?path=<file>&action=md` |
| PDF로 변환 | `convert` action, `pdf` subaction | `kordoc://convert?path=<file>&action=pdf` |
| AI 요약 | `summarize` | `kordoc://summarize?path=<file>` |
| KorDoc 앱 열기... | `open` | `kordoc://open?path=<file>` |

다중 선택 시 `%TEMP%\kordoc-batch-<ts>.json` manifest 파일 생성 후 `kordoc://batch?manifest=<path>` 호출.

## kordoc-ai (Layer 2) 연동

이 패키지가 호출하는 `kordoc://` URL은 **kordoc-ai (Tauri 데스크톱 앱)** 의 deep-link 핸들러가 수신.
kordoc-ai 설치 + 실행 중이어야 함.

- kordoc-ai: https://github.com/chrisryugj/kordoc-ai
- kordoc 라이브러리: https://github.com/chrisryugj/kordoc

## 라이선스

MIT
