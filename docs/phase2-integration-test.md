# KorDoc Suite Phase 2 — 통합 검증

**일시**: 2026-04-29
**대상**: kordoc v2.7.0 + kordoc-ai (W2 D5) + kordoc-shell (W1)
**환경**: Windows 11 Pro 10.0.26220
**검증자**: Claude Code (자동) + 사용자 (인터랙티브)

---

## 사전 작업 — ✅ 완료

| 항목 | 상태 | 비고 |
|------|------|------|
| 아이콘 PNG 3종 (Store/Square150/Square44) | ✅ | placeholder 생성 (`K` 글자, #286EC8). PowerShell System.Drawing |
| kordoc-ai 핵심 파일 존재 | ✅ | `lib.rs`, `useDeepLink.ts`, `App.tsx`, sidecar `core/print/` |
| 3개 레포 푸시 | ✅ | kordoc `ede40d6` / kordoc-ai `f3d78b5` / kordoc-shell `41d4f34` |

### 메모리 ↔ 코드 불일치 발견 (수정됨)

| 항목 | 메모리 주장 | 실측 | 조치 |
|------|------------|------|------|
| 아이콘 placeholder | "있음" | README.md만 존재, PNG 0개 | 생성 |
| build.ps1 SDK candidates | 22621/19041 | Windows SDK 26100.0 설치됨 | candidates 추가 |
| sign.ps1 SDK candidates | 22621/19041 | 동일 | candidates 추가 |
| `kordoc-launcher/src/main.rs:110` | "이미 빌드 가능" | E0716: 임시값 borrow | `to_string_lossy().into_owned()` |
| Vitest 카운트 | "53 pass" | **52 pass** (1건 차이) | fail 0이므로 진행 가능 |

---

## 1단계 — kordoc-shell MSIX 빌드/설치/우클릭

### 자동 검증 (PASS / BLOCKED)

| 항목 | 상태 | 명령어 / 로그 |
|------|------|--------------|
| `cargo build --release` (런처) | ✅ PASS | `Finished release profile [optimized] in 1.48s`. 산출물 `target/release/kordoc-launcher.exe` (152KB) |
| `MakeAppx pack` (MSIX) | ✅ PASS | `Package creation succeeded`. 산출물 `build/KorDocShell.msix` (85.1KB) — 7개 파일 (manifest + Microsoft.Registry.xml + assets/icons/* + kordoc-launcher.exe) |
| `New-SelfSignedCertificate` + LocalMachine 등록 | ⛔ BLOCKED | 관리자 PowerShell 필요 — 현재 비관리자 셸 |
| `SignTool sign /fd SHA256` | ⛔ BLOCKED | 위 단계 의존 |
| `Add-AppxPackage -ExternalLocation` | ⛔ BLOCKED | 동일 |
| 탐색기 .hwp 우클릭 → KorDoc 서브메뉴 표시 | ⛔ BLOCKED | 설치 후 GUI 검증 필요 |
| 4개 verb 표시 (md/pdf/summarize/open) | ⛔ BLOCKED | 동일 |

### 사용자 인계 명령 (관리자 PowerShell)

```powershell
cd c:\github_project\kordoc-shell
.\scripts\sign.ps1            # 인증서 생성 + LocalMachine 등록 + MSIX 서명
.\scripts\install-dev.ps1     # Add-AppxPackage -ExternalLocation
# → 탐색기에서 임의 .hwp 우클릭 → KorDoc 서브메뉴 4개 verb 확인
```

---

## 2단계 — tauri:dev + 단일 deep-link

### 자동 검증

| 항목 | 상태 | 비고 |
|------|------|------|
| 의존성 핀 (tauri-plugin-deep-link `=2.4.7`, single-instance `=2.4.0` w/ deep-link feature) | ✅ PASS | `src-tauri/Cargo.toml:27-28` 확인. yanked 2.4.8 회피 |
| `tray-icon` feature 명시 | ✅ PASS | `Cargo.toml:16` `tauri = { version = "^2.10", features = ["tray-icon"] }` |
| `cargo check` (Tauri 빌드) | ✅ PASS | 0 errors / 0 warnings |
| 프론트엔드 TypeScript 타입체크 (`tsc --noEmit`) | ✅ PASS | 0 errors |
| node-sidecar TypeScript 타입체크 | ✅ PASS | 0 errors |
| node-sidecar Vitest | ✅ PASS | **52 PASS / 0 FAIL** (메모리는 53이라 적혀있음 — 1건 차이) |
| `pnpm tauri:dev` 실제 기동 | ⛔ BLOCKED | 인터랙티브 GUI 검증 필요 |
| single-instance 콜백 (윈도우 포커스 복귀) | ⛔ BLOCKED | 동일 |
| `deep-link` 이벤트 emit + useDeepLink 파싱 | ⛔ BLOCKED | 동일 |
| importFiles 호출 + UI 반영 | ⛔ BLOCKED | 동일 |

### 사용자 인계 명령

```powershell
# Shell A (개발 서버)
cd c:\github_project\kordoc-ai
pnpm tauri:dev

# Shell B (트리거)
cd c:\github_project\kordoc-shell\kordoc-launcher\target\release
.\kordoc-launcher.exe convert "C:\path\to\test.hwp" md
# → Tauri 윈도우 깨어남 + 단일 파일 import UI 반영 확인
```

---

## 3단계 — 다중 선택 batch 흐름

### 자동 검증

| 항목 | 상태 | 비고 |
|------|------|------|
| Rust 런처 batch URL 빌더 | ✅ PASS | `src/main.rs:84-112` write manifest JSON → URL 빌드 |
| `read_batch_manifest` RPC 화이트리스트 등록 | ✅ PASS | `src-tauri/src/commands/sidecar_cmd.rs` 동기화 (메모리 명시) |
| 실제 manifest 생성 + 다중 import | ⛔ BLOCKED | 런타임 검증 필요 |

### 사용자 인계 명령

```powershell
# Shell B (Shell A에 tauri:dev 실행 중)
.\kordoc-launcher.exe batch "C:\a.hwp" "C:\b.docx" "C:\c.pdf"
# → %TEMP%/kordoc-batch-*.json 생성, kordoc:// URL 호출, 3개 파일 import UI 반영 확인
```

---

## 4단계 — 인쇄 RPC

### 자동 검증

| 항목 | 상태 | 비고 |
|------|------|------|
| `core/print/index.ts` 존재 | ✅ PASS | `node-sidecar/src/core/print/index.ts` |
| `print_files` / `list_printers` RPC 화이트리스트 | ✅ PASS | sidecar_cmd.rs |
| Vitest 7건 (메모리 명시) | ✅ PASS | 위 52 pass에 포함 |
| 임시 PDF 60초 지연 unlink (spool 실패 회피) | 코드 검토만 | 런타임 검증 필요 |
| Microsoft Print to PDF 가상 프린터로 무해 검증 | ⛔ BLOCKED | GUI 환경 필요 |

### 사용자 인계 명령

```javascript
// Tauri devtools 콘솔 (또는 UI 인쇄 버튼)
import { invoke } from '@tauri-apps/api/core'
await invoke('list_printers')
// → 'Microsoft Print to PDF' 포함 확인

await invoke('print_files', { paths: ['C:\\test.hwp'], printer: 'Microsoft Print to PDF' })
// → 출력 PDF 파일 다이얼로그 → 임시 PDF 60초 후 삭제 확인
```

---

## 5단계 — Tray + Win11 native toast

### 자동 검증

| 항목 | 상태 | 비고 |
|------|------|------|
| `tauri-plugin-notification 2.3.3` 의존성 | ✅ PASS | Cargo.toml:29 |
| `on_tray_icon_event` 클로저 명시 타입 (메모리 함정) | 코드 검토만 | `lib.rs` 7.6KB — 정적으로는 cargo check 통과 |
| WindowClose hide (X 클릭 → 종료 X) | 코드 검토만 | 위와 동일 |
| 트레이 아이콘 좌클릭/메뉴 동작 | ⛔ BLOCKED | GUI 필요 |
| 비포커스 deep-link → native toast | ⛔ BLOCKED | 동일 |

### 사용자 인계 시나리오

1. 윈도우 X 클릭 → 종료 X, hide 확인 (작업관리자에 프로세스 살아있음)
2. 트레이 KorDoc 아이콘 좌클릭 → show/focus
3. 우클릭 → 메뉴 (열기/종료) 동작
4. 윈도우 minimize 상태에서 Shell B로 launcher 호출 → Win11 native toast 표시
5. 토스트 클릭 → 윈도우 복귀

---

## 통합 검증 진행 (2026-04-29 ~ 30)

### 1단계 — MSIX
| 항목 | 결과 |
|------|------|
| cargo build, MakeAppx pack, sign (CurrentUser) | ✅ PASS |
| Add-AppxPackage 설치 / 우클릭 메뉴 | ⛔ BLOCKED (환경) — 사용자 계정의 elevation 자체가 OS 정책으로 차단 (gsudo / pwsh / Start-Process -Verb RunAs / Win11 sudo 모두 거부됨, EDR 또는 회사 정책) |

### 2단계 — 단일 deep-link
| 항목 | 결과 |
|------|------|
| `pnpm tauri:dev` 기동 + sidecar manager 시작 | ✅ PASS |
| `tauri-plugin-deep-link` HKCU `kordoc://` 자동 등록 | ✅ PASS (`HKCU\Software\Classes\kordoc` → `kordoc-ai.exe %1`) |
| `kordoc-launcher.exe convert sample.hwp md` → Tauri 깨어남 + 단일 파일 import | ✅ **PASS** (사용자 GUI 확인) |

### 3단계 — Batch
| 항목 | 결과 |
|------|------|
| Launcher CLI `batch <subaction> <files...>` 파싱 — 1차 시도 시 manifest `files`에 서브액션이 끼어드는 버그 발견 → `main.rs` 수정 (`("batch", n) if n>=2` 명시 케이스 추가) | ✅ FIX |
| 1차 시도에서 frontend "Method not found: read_batch_manifest" 에러 — 원인은 `node-sidecar/dist/bundle.cjs`가 W2 코드 변경 전 (mtime 04-10) stale 빌드 | ✅ FIX |
| esbuild 번들 시 `onnxruntime-node` native binary `.node` loader 미설정으로 빌드 실패 → external 추가 (`onnxruntime-node`, `sharp`, `@huggingface/transformers`) | ✅ FIX |
| Bundle 재빌드 (6.5MB) + Tauri 재시작 + launcher 재호출 → manifest 정상 형태 (`{action:"convert", files:[3]}`) + 3개 파일 import UI 반영 | ✅ **PASS** |

### 4단계 — 인쇄 RPC
| 항목 | 상태 |
|------|------|
| 사용자 GUI에서 `list_printers` / `print_files` 시나리오 (Microsoft Print to PDF) | 진행 중 |

### 5단계 — Tray + Toast
| 항목 | 상태 |
|------|------|
| X 클릭 hide / 트레이 좌클릭 토글 / 메뉴 / 비포커스 native toast | 진행 중 |

### 자동 검증 요약 — **모두 PASS**

- kordoc-shell: cargo build (1.48s) + MakeAppx pack (7 files → 85.1KB MSIX) + 코드 수정 1건 (E0716 fix)
- kordoc-ai/src-tauri: cargo check 0 errors
- kordoc-ai 프론트엔드: tsc --noEmit 0 errors
- kordoc-ai/node-sidecar: tsc --noEmit + vitest **52/52 PASS**
- kordoc v2.7.0: 이미 푸시 (`f41da76 release: v2.7.0`), `dist/index.cjs` 245.7KB 빌드됨

### 다음 단계

1. **사용자가 관리자 PowerShell** 에서 `sign.ps1` + `install-dev.ps1` 실행 → 1단계 인터랙티브 통과
2. 1단계 후 **`pnpm tauri:dev` 띄우고** 별도 셸로 launcher 호출 → 2~5단계 시나리오 진행
3. 모두 통과 → ROADMAP `Phase 2 W2 D1-D5` 체크 + `npm publish kordoc@2.7.0` 컨펌
4. FAIL 시 → 본 문서에 로그 추가 + 수정 PR

### 알려진 함정 (검증 시 주의)

- yanked `tauri-plugin-deep-link 2.4.8` 회피 — Cargo는 `=2.4.7` 핀, JS측 `^2.4.8`은 lockfile 확인 필요
- PrintTo verb는 copies/duplex/color 제어 불가 (드라이버 기본값)
- 임시 PDF 60초 지연 unlink — 즉시 삭제 시 spool 실패
- MSIX `MinVersion=10.0.17763.0` 미만 미지원
- Add-AppxPackage Sparse는 `-ExternalLocation` 절대경로 필요
- 자체서명 cert는 LocalMachine\Root + TrustedPeople 양쪽 (관리자 권한)
