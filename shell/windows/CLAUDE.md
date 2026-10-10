# CLAUDE.md — kordoc-shell

This file provides guidance to Claude Code when working with code in this repository.

## 프로젝트 개요

**kordoc-shell** — KorDoc Suite의 Layer 3. Windows Shell Extension (MSIX Sparse Package).
탐색기 우클릭 컨텍스트 메뉴 → `kordoc://` deep-link → kordoc-ai (Tauri 앱) 호출.

## KorDoc Suite 3-Layer

| Layer | 레포 | 역할 |
|-------|------|------|
| 1 | [kordoc](https://github.com/chrisryugj/kordoc) | Pure JS 문서 파서 (HWP/HWPX/PDF/XLS/XLSX/DOCX → MD) |
| 2 | [kordoc-ai](https://github.com/chrisryugj/kordoc-ai) | Tauri 데스크톱 앱 + Node sidecar (JSON-RPC) |
| **3** | **kordoc-shell (이 레포)** | **Windows Shell Extension** |

## 빌드 & 개발

```powershell
# 한방 설치 (관리자 PowerShell)
.\scripts\install-dev.ps1

# 단계별
cd kordoc-launcher
cargo build --release          # 런처 exe
cd ..
.\scripts\build.ps1            # MSIX 패키지
.\scripts\sign.ps1             # 자체서명
```

## 아키텍처

### 흐름
```
탐색기 우클릭 (.hwp 등)
  ↓ Microsoft.Registry.xml 의 verb 호출
kordoc-launcher.exe convert "C:\file.hwp" md
  ↓ Win32 ShellExecuteW
kordoc://convert?path=<encoded>&action=md
  ↓ Windows protocol handler
kordoc-ai (Tauri single-instance)
  ↓ deep-link 이벤트
프론트엔드 라우팅 → kordoc 호출
```

### 파일 구조
- `manifest/AppxManifest.xml` — 패키지 식별자, 파일 연결 (.hwp 등 7종), `kordoc://` 프로토콜 등록
- `manifest/Microsoft.Registry.xml` — 7개 확장자에 동일한 `KorDoc` 서브메뉴 + 4개 verb 정의
- `kordoc-launcher/src/main.rs` — Rust 단일 exe. args 파싱 → URL 빌드 → ShellExecuteW
  - 단일 파일: `kordoc://<action>?path=<encoded>`
  - 다중 파일: `%TEMP%/kordoc-batch-*.json` manifest 생성 → `kordoc://batch?manifest=<path>`
- `scripts/*.ps1` — build (cargo + MakeAppx) → sign (New-SelfSignedCertificate + SignTool) → install-dev (Add-AppxPackage)

## 의사결정 (PRD §6)

1. **Sparse Package** 선택 — registry 오염 없음, 언인스톨 깔끔
2. **Rust 런처** — 50KB 단일 exe, Tauri와 동일 스택
3. **자체서명** (개발), **EV 코드사인** (배포) — 결정은 Phase 2 종료
4. **다중선택 manifest 파일** 방식 — verb N번 반복 호출 회피

## 코드 작성 시 주의

- `kordoc-launcher/src/main.rs` 변경 시: Cargo.lock 갱신, release 빌드 후 MSIX 재패키징
- `Microsoft.Registry.xml`의 7개 확장자 각각에 동일한 `KorDoc` MUIVerb 등록 — 서브메뉴 정의는 `KorDoc\Submenu` 한 곳에 통합
- AppxManifest의 `MinVersion="10.0.17763.0"` (Windows 10 1809) 미만은 Sparse Package 미지원
- Sparse Package 설치 시 `-ExternalLocation` 절대 경로 필요 (스크립트 자동 처리)

## Phase 2 작업 체크리스트 (ROADMAP.md)

- [x] W1 D1: 레포 셋업 + 디렉토리 구조
- [x] W1 D2: AppxManifest.xml + Microsoft.Registry.xml
- [x] W1 D3-4: 단일 파일 메뉴 4개 (변환·PDF·요약·앱열기) + Rust 런처
- [x] W1 D5: 빌드/서명/설치 스크립트
- [ ] W2 D1-2: kordoc-ai에 deep-link 핸들러 (Tauri single-instance + tauri-plugin-deep-link)
- [ ] W2 D3-4: `print_files` / `list_printers` RPC (kordoc-ai sidecar)
- [ ] W2 D5: tray 아이콘 + 진행률 토스트

## 보안

- Sparse Package — 시스템 권한 불필요
- 사용자 영역 (HKCU) registry만 수정
- 자체서명 인증서는 LocalMachine\Root + TrustedPeople 에 등록 (관리자 권한 필요, Phase 2 한정)
- 배포 시 EV 코드사인 인증서 사용 (PRD §6 D4)
