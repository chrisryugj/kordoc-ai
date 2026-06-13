# KorDoc Suite — Active Context

> 이 파일은 세션 시작 시 자동 로드됨. 다음 세션 컨텍스트 인계용.

---

## 📌 최신: KorDoc Studio Phase C 클릭-편집 구현 완료 (2026-06-13)

- 브랜치 `feat/doc-editor-phase-c` (Phase B 브랜치에서 분기 — PR #1 머지 후 자동 리타겟)
- 사이드카 RPC 6종: `edit_open`(HEAVY)/`edit_patch`/`edit_undo`/`edit_redo`/`edit_save`/`edit_close` — `node-sidecar/src/core/edit/`, kordoc v3.1 `HwpxSession` 상태 유지(세션 4개 상한 LRU, undo 깊이 50, 바이트 스냅샷)
- DocEditor (`src/components/edit/DocEditor.tsx`): 미리보기 클릭→문단/셀 인라인 편집 팝오버, capability 잠금 시각화(잠금=흐림+사유 토스트, 편집가능=점선 밑줄 토글), Ctrl+Z/Y undo/redo, 30초 자동저장(`{stem}_편집.hwpx`), 닫기 시 미저장분 자동 저장
- `svg-annotate.ts`에 `annotateBlocks` 추가 — 여러 줄 문단 허용(같은 줄 x증가 또는 다음 줄), 긴 텍스트 우선 매칭, data-kd-block/-cell/-locked
- Workspace 액션 `doc_edit` (hwpx 1개) + Rust 화이트리스트 동기화
- 검증: vitest **64/64** (edit-session 8개 신규, 실문서 포함), tsc 프론트/사이드카 0, vite/cargo/esbuild 번들 그린, 프로덕션 번들 stdin RPC 스모크(edit 6종 왕복) 통과
- 함정: kordoc dist stale이면 `HwpxSession` 미노출 → `cd kordoc && npm run build` 필수 (이 PC에서 재현됨). 실문서 PUA 글리프(`󰏅`) 문단은 capability=text라도 패처가 "공백 정규화 불안정"으로 graceful-skip — 정상 동작
- v1 제약: 텍스트 있는 문단/셀만 클릭 가능(빈 셀 채우기는 FillWizard), 페이지 경계 걸친 문단은 매칭 실패로 클릭 불가 가능

---

## KorDoc Studio Phase B 구현 완료 (2026-06-12)

- 브랜치 `feat/fill-wizard-phase-b`, **PR #1 머지 대기**
- RPC 4종: form_schema / form_fill / patch_blocks (HEAVY) + render_preview (HEAVY 제외) — `node-sidecar/src/core/{fill,preview}/`, Rust 화이트리스트 동기화
- @rhwp/core@0.7.15 듀얼 임베드: 프론트 Vite wasm 번들 (`src/lib/rhwp.ts`, CSP `wasm-unsafe-eval` 추가) + 사이드카 Node WASM 폴백 (esbuild external + dist/node_modules 복사 — MSI 동봉)
- FillWizard (`src/components/fill/FillWizard.tsx`): 좌 자동 폼 / 우 rhwp SVG, 필드↔미리보기 하이라이트+역점프(`src/lib/svg-annotate.ts`), 출처 배지(명부 xlsx), dry_run 미리보기, 재파싱 검증 배지
- 검증: vitest fill-e2e **9/9** (실양식 2종), 프로덕션 번들 stdin RPC 실구동, tsc/vite/cargo 그린
- 주의: pnpm 전역 minimum-release-age(7일) → `.npmrc`에 @rhwp/core 예외 추가됨. concat.test.ts 실패 1건은 기존 픽스처 부재(무관)
- 수동 확인 필요: tauri:dev 웹뷰 WASM 초기화, 한/글 육안 검증, 실양식 3종째
- 코어: kordoc v3.1.0 머지+태그 완료 (npm publish만 토큰 만료 보류 — `npm login` 필요)

---

## 📌 현재 상태 (2026-04-29 21:55, 집 PC)

### Phase 1 완료 ✅ (kordoc v2.7.0)
- `feat/xls-and-print` 브랜치, 마지막 커밋 `ede40d6` (집 PC에서 package-lock 동기화 추가)
- v2.7.0 release 본커밋: `f41da76`
- XLS (BIFF8) 파서 + Print Renderer (`markdownToPdf`/`PrintPreset` 노출)
- 318 tests pass
- **publish 미진행** — kordoc-ai sidecar 가 `link:../../kordoc` 로 v2.7.0 dist 직접 사용 중. 통합 검증 끝난 다음에 publish.

### Phase 2 W1 완료 ✅ (kordoc-shell v0.1)
- `c:/github_project/kordoc-shell`, 커밋 `41d4f34` (변경 없음)
- AppxManifest, Microsoft.Registry.xml, Rust 런처, build/sign/install-dev 스크립트

### Phase 2 W2 **완료** ✅ (kordoc-ai)
- main 브랜치, 커밋 `20dd679` (W2 D1-D4) + `f32cb1f` (W2 D5)
- 모두 origin/main 푸시 완료

**구현 내용:**
- W2 D1-2: Tauri deep-link + single-instance 플러그인, `lib.rs` 핸들러, `useDeepLink` 훅, `App.tsx` 라우팅
- W2 D3-4: `node-sidecar/src/core/print/index.ts` (print_files + list_printers), `read_batch_manifest` RPC, vitest 7건
- W2 D5: System tray (Show/Hide/Quit + 좌클릭 토글), 윈도우 X → hide, `tauri-plugin-notification` 으로 Win11 native toast (창 비포커스 시만)

**검증 통과:**
- TypeScript 0 error
- cargo check 0 error
- Vitest 53 pass / 1 skip

---

## 🎯 다음 세션 — Phase 2 통합 검증 (사람 손 필요)

코드 작업은 모두 끝났음. 다음 세션은 **실제 탐색기에서 동작 확인**.

### 1. kordoc-shell MSIX 설치 + 우클릭 메뉴 확인
```powershell
# 관리자 PowerShell
cd c:\github_project\kordoc-shell
.\scripts\install-dev.ps1
# 탐색기에서 .hwp/.pdf/.xlsx 등 우클릭 → KorDoc 메뉴 4개 표시되는지 확인
```

**기대:**
- "마크다운으로 변환", "PDF로 변환", "AI 요약", "KorDoc 앱 열기..." 4개 메뉴
- 빌드 실패 시 함정: `assets/icons/` 의 `StoreLogo.png` / `Square150.png` / `Square44.png` placeholder 누락 가능성. README.md 의 PowerShell 스니펫으로 임시 PNG 생성.

### 2. kordoc-ai 빌드 + 단일 deep-link 동작
```powershell
cd c:\github_project\kordoc-ai
pnpm build:node-sidecar    # sidecar bundle (puppeteer-core external)
pnpm tauri:dev              # dev 모드. deep-link register_all 로 OS registry 자동 등록
```
- 다른 셸에서: `kordoc-launcher.exe convert "C:\path\to\test.hwp" md`
  → kordoc-ai 윈도우 깨어남, 파일이 import 되는지 확인
- 이미 실행 중일 때 우클릭 → single-instance 가 두 번째 args 첫 인스턴스로 전달

### 3. 다중 선택 batch 흐름
- 탐색기에서 `.hwp` 5개 선택 후 우클릭 → KorDoc → 마크다운으로 변환
- `%TEMP%/kordoc-batch-<ts>.json` manifest 생성 확인
- kordoc-ai 가 read_batch_manifest 호출 → files 일괄 추가 확인
- 토스트: "일괄 처리: 5개 파일 추가됨 (convert_md)"

### 4. 인쇄 RPC 검증
- "Microsoft Print to PDF" 가상 프린터로 무해 검증 권장
- DevTools Console: `await invoke('sidecar_call', { method: 'list_printers' })`
- 그 다음: `await invoke('sidecar_call', { method: 'print_files', params: { files: ['C:\\test.hwp'], printer: 'Microsoft Print to PDF' } })`
- `%TEMP%/kordoc-print/*.pdf` 생성 + 60초 후 정리되는지

### 5. Tray + 알림
- 윈도우 X 클릭 → 종료 안 되고 tray 로 hide
- tray 좌클릭 → 복귀
- tray 우클릭 → 메뉴 (창 열기 / 창 숨기기 / 완전 종료)
- 변환 실행 후 즉시 다른 창으로 포커스 이동 → 완료 시 Win11 native toast

### 검증 통과 후
- ROADMAP §Phase 2 종료 4개 체크박스 체크
- `npm publish kordoc@2.7.0` 진행 (사용자 승인)
- Phase 3 (다중선택 + 일괄 처리 UX) 진입

---

## 🗺️ 전체 로드맵

| Phase | 기간 | 주제 | 산출물 | 상태 |
|-------|------|------|--------|------|
| 1 | 2주 | 코어 갭 (XLS + Print Renderer) | kordoc v2.7.0 | ✅ (publish 대기) |
| 2 | 2주 | MSIX Shell Extension PoC | kordoc-shell v0.1 + kordoc-ai 통합 | ✅ (실동작 검증 대기) |
| 3 | 3주 | 다중선택 + 일괄 처리 UX | kordoc-ai v2.0 | ⬜ |
| 4 | 3주 | 공공기관 특화 (PII/템플릿/DOC) | v2.1 | ⬜ |

---

## ⚠️ 알려진 함정

### Phase 1 (kordoc)
- `BoundSheet8.dt` (1B) ≠ `BOF.dt` (2B). 비교 금지.
- SST CONTINUE 분할: 단순 concat 안 됨. 경계마다 새 flags 재해석 필요.
- `KordocError(message)` 만 받음. ErrorCode 는 `classifyError` 가 message 키워드로 자동.
- tsup `OPTIONAL_EXTERNAL`: optional dep 안 추가하면 dist 폭증.
- ESM 에서 `require` 금지. `import { existsSync } from "fs"` 정적 import.

### Phase 2 W1 (kordoc-shell)
- MSIX SparsePackage `MinVersion="10.0.17763.0"` 미만 미지원.
- `Add-AppxPackage -ExternalLocation`: Sparse 는 절대 경로 필요.
- 자체서명 cert: LocalMachine\Root + TrustedPeople 양쪽 (관리자 권한).

### Phase 2 W2 (kordoc-ai) — 신규 함정 ★
- **`tauri-plugin-deep-link@2.4.8` yanked**. single-instance 2.4.1 이 이걸 강제 의존하므로 single-instance 2.4.0 으로 다운그레이드 + deep-link 2.4.7 핀 필수.
- **`PrintTo` verb 는 copies/duplex/color 제어 불가**. 드라이버 기본값 사용. 옵션 UI 표시 시 "드라이버 기본값" 명시 필요. 세부 제어 필요하면 SumatraPDF 또는 Win32 EnumPrintProcessors.
- **임시 PDF 즉시 unlink 금지**. PrintTo 가 spool 시작하기 전에 OS 가 파일 못 읽음. 60초 setTimeout(unref) 으로 지연.
- **kordoc-ai 의 `tauri-plugin-window-state`** 와 single-instance 호환 OK (단일 인스턴스 가정이라 충돌 없음).
- **`tauri features = ["tray-icon"]`** 명시 필요. default 에 포함 안 됨.
- **`on_tray_icon_event` 클로저 타입 추론 실패** → `|tray: &tauri::tray::TrayIcon<tauri::Wry>, event: TrayIconEvent|` 명시.
- **kordoc dist v2.7 빌드 누락**: link:../../kordoc 사용 시 dist 가 옛 버전이면 `markdownToPdf`/`PrintPreset` 미노출. 본 레포 작업 전 `cd c:\github_project\kordoc && npm install && npm run build` 권장.

---

## 🔑 핵심 의사결정 (PRD §6)

1. **Shell 통합**: MSIX Sparse Package (Win10 1809+)
2. **DOC 파싱**: LibreOffice headless 폴백 (Phase 4)
3. **인쇄 엔진**: PDF 변환 → ShellExecute "print"
4. **AI 격리**: 기본 비활성, 옵트인
5. **Print Renderer**: markdown-it → puppeteer-core HTML ✅
6. **XLS OLE2 파서**: 기존 `cfb-lenient.ts` 재사용 ✅
7. **Shell 런처 언어**: Rust ✅
8. **다중선택 처리**: `%TEMP%/kordoc-batch-*.json` manifest 파일 방식 ✅
9. **개발 서명**: 자체서명 (Phase 2), 배포 EV (미정)

---

## 💬 다음 세션 시작 프롬프트

```
KorDoc Suite Phase 2 통합 검증 — 코드는 끝났고 실제 동작 확인.

브랜치/레포 (이미 푸시):
- kordoc: feat/xls-and-print, ede40d6 (v2.7.0 + package-lock)
- kordoc-ai: main, f32cb1f (W2 D5 tray + notification)
- kordoc-shell: main, 41d4f34 (W1 변경 없음)

먼저 .claude/memory/activeContext.md 읽고
"다음 세션 — Phase 2 통합 검증" 섹션의 5단계를 순서대로 실행해줘.

검증 기록은 docs/phase2-integration-test.md 에 새로 작성:
- 각 단계 PASS/FAIL + 실제 명령어와 결과 로그
- FAIL 발생 시 원인 분석 + 수정 PR
- 통과하면 ROADMAP Phase 2 체크박스 체크 + npm publish kordoc@2.7.0 안내
```

---

## 📝 변경 이력
- 2026-04-29: Phase 1 완료, kordoc v2.7.0 (`f41da76`)
- 2026-04-29: Phase 2 W1 완료, kordoc-shell init (`41d4f34`)
- 2026-04-29: 회사 PC → 집 PC 인계용 메모리 백업 커밋 (kordoc-ai `3cb1001`, kordoc `d307c11`)
- 2026-04-29: 집 PC, Phase 2 W2 D1-D4 완료 (`20dd679`)
- 2026-04-29: 집 PC, Phase 2 W2 D5 완료 (`f32cb1f`) — **현재**
