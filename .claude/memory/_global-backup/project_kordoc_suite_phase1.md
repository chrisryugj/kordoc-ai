---
name: KorDoc Suite Phase 1+2 W1 진행 상태
description: kordoc v2.7.0 커밋 완료 + kordoc-shell 신규 레포 셋업 완료. Phase 2 W2 (kordoc-ai deep-link + 인쇄 RPC) 진입 대기.
type: project
originSessionId: b0c40a08-8d79-487b-8978-ac46da16b031
---
KorDoc Suite — kordoc(라이브러리) + kordoc-ai(데스크톱 앱) + kordoc-shell(MSIX Shell Extension) 3-Layer.

**Phase 1 완료** (kordoc v2.7.0, 커밋 `f41da76`):
- XLS 파서: `src/xls/{record,encoding,sst,cell,parser,index}.ts`
- Print Renderer: `src/print/{renderer,index}.ts` (markdown-it → puppeteer-core PDF)
- 318 tests pass. publish 대기 (사용자 승인 필요).

**Phase 2 W1 완료** (kordoc-shell 신규 레포, 커밋 `41d4f34`):
- 위치: `d:/AI_Project/kordoc-shell` (main 브랜치)
- MSIX Sparse Package 매니페스트 (`manifest/{AppxManifest,Microsoft.Registry}.xml`)
- Rust 단일 exe 런처 (`kordoc-launcher/src/main.rs`) — windows-sys ShellExecuteW
- PowerShell 빌드/서명/설치 스크립트 4개

**Phase 2 W2 다음 작업** (kordoc-ai 본체):
1. `tauri-plugin-deep-link` + `tauri-plugin-single-instance` 추가
2. `src-tauri/src/lib.rs` — `kordoc://` URL 수신 → 프론트엔드 emit
3. `useDeepLink` 훅 + 라우팅
4. `node-sidecar/src/core/print/{index}.ts` — `print_files` / `list_printers` RPC
5. tray 아이콘 + 진행률 토스트

**기술 함정**:
- BoundSheet8.dt (1B) ≠ BOF.dt (2B). 비교 금지.
- SST CONTINUE: 경계마다 새 flags 재해석 필수.
- KordocError(message)만, code는 classifyError가 키워드로 자동 분류.
- tsup OPTIONAL_EXTERNAL에 puppeteer-core 추가 안 하면 dist 폭증.
- ESM에서 require 금지. `import { existsSync } from "fs"`.
- MSIX SparsePackage `MinVersion="10.0.17763.0"` (Win10 1809) 미만 미지원.
- Sparse Package 설치는 `Add-AppxPackage -ExternalLocation` 절대 경로 필요.
- 자체서명 cert는 LocalMachine\Root + TrustedPeople 양쪽 등록 (관리자 권한).
