# 다음 세션 시작 가이드 (집 PC용)

> KorDoc Suite 작업을 다른 PC에서 이어갈 때 복붙해서 쓸 가이드.

---

## 0. 사전 준비 (집 PC 처음 1회)

### 모든 레포 clone
```powershell
mkdir D:\AI_Project   # 또는 원하는 위치
cd D:\AI_Project

git clone https://github.com/chrisryugj/kordoc.git
git clone https://github.com/chrisryugj/kordoc-ai.git
git clone https://github.com/chrisryugj/kordoc-shell.git
```

### kordoc은 작업 브랜치 체크아웃
```powershell
cd D:\AI_Project\kordoc
git checkout feat/xls-and-print
```

### 글로벌 user memory 복원 (Claude Code 자동 로드용)
```powershell
$dest = "$env:USERPROFILE\.claude\projects\d--AI-Project-kordoc\memory"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item "D:\AI_Project\kordoc-ai\.claude\memory\_global-backup\*.md" $dest -Exclude "README.md" -Force
```

> 경로가 다르면 `D:\AI_Project` 부분을 본인 환경에 맞게 변경.
> `kordoc-ai` 위치도 변경되면 글로벌 메모리 디렉토리명도 달라짐 (`d--AI-Project-kordoc` 형태).

### 의존성 설치
```powershell
cd D:\AI_Project\kordoc && npm install
cd D:\AI_Project\kordoc-ai && pnpm install   # 또는 npm install
cd D:\AI_Project\kordoc-shell                # Rust는 cargo가 첫 빌드 시 자동
```

---

## 1. Claude Code에 복붙할 시작 프롬프트

작업 디렉토리: `c:\github_project\kordoc-ai` (또는 본인 경로)

```
KorDoc Suite Phase 2 통합 검증 — 코드는 끝났고 실제 동작 확인.

브랜치/레포 (이미 푸시):
- kordoc: feat/xls-and-print, ede40d6 (v2.7.0 + package-lock 동기화)
- kordoc-ai: main, f32cb1f (W2 D5 tray + notification)
- kordoc-shell: main, 41d4f34 (W1 변경 없음)

먼저 .claude/memory/activeContext.md 읽고
"다음 세션 — Phase 2 통합 검증" 섹션의 5단계를 순서대로 실행해줘.

5단계 요약:
  1. kordoc-shell MSIX 설치 + 탐색기 우클릭 메뉴 4개 표시 확인
     (assets/icons placeholder 누락 시 README 스니펫으로 임시 PNG 생성)
  2. kordoc-ai pnpm tauri:dev + 단일 deep-link 동작
     (다른 셸에서 kordoc-launcher.exe 호출 → 깨어남 + import)
  3. 다중 선택 batch 흐름 (%TEMP%/kordoc-batch-*.json + read_batch_manifest)
  4. 인쇄 RPC (Microsoft Print to PDF 가상 프린터로 무해 검증)
  5. Tray 동작 (X 클릭 hide / 좌클릭 토글 / 메뉴) + Win11 native toast

검증 기록은 docs/phase2-integration-test.md 에 새로 작성:
- 각 단계 PASS/FAIL + 실제 명령어와 결과 로그 포함
- FAIL 발생 시 원인 분석 + 수정
- 모두 통과하면 ROADMAP Phase 2 체크박스 체크 + 사용자에게
  `npm publish kordoc@2.7.0` 진행 여부 확인
```

---

## 2. 빠른 상태 확인 명령어

집 PC 도착 후 컨텍스트 복원 확인:

```powershell
# 모든 레포 최신 상태 pull
cd D:\AI_Project\kordoc       && git pull
cd D:\AI_Project\kordoc-ai    && git pull
cd D:\AI_Project\kordoc-shell && git pull

# kordoc은 작업 브랜치
cd D:\AI_Project\kordoc       && git checkout feat/xls-and-print && git pull

# 테스트 통과 확인
cd D:\AI_Project\kordoc       && npm test    # 318 pass 확인

# Claude Code 시작 (kordoc-ai 디렉토리에서)
cd D:\AI_Project\kordoc-ai
claude
```

---

## 3. 핵심 컨텍스트 요약 (Claude가 자동 로드 못 했을 때 수동 주입용)

### Phase 1 결과 (kordoc v2.7.0)
- XLS 파서: `src/xls/` 6개 모듈, OLE2 → cfb-lenient 재사용, BIFF8 레코드, SST CONTINUE 분할
- Print Renderer: `src/print/renderer.ts`, markdown-it → puppeteer-core, 프리셋 3종

### Phase 2 W1 결과 (kordoc-shell)
- MSIX Sparse Package, AppxManifest 7개 확장자 + kordoc:// 프로토콜
- Microsoft.Registry.xml: 4개 verb (md/pdf/summarize/open)
- Rust 런처: ShellExecuteW로 deep-link 호출, 다중선택 manifest 파일 방식
- PowerShell 빌드/서명/설치 스크립트

### Phase 2 W2 결과 (kordoc-ai) — 완료 ✅
- Tauri: tauri-plugin-deep-link 2.4.7 + single-instance 2.4.0 (deep-link feature) + notification 2.3.3 + tray-icon
- lib.rs: single-instance 콜백(윈도우 포커스 복귀) + deep_link.on_open_url → emit("deep-link") + System Tray + WindowClose hide
- 프론트엔드: useDeepLink 훅 (URL 파싱), App.tsx (importFiles + batch read_batch_manifest 호출 + 시스템 알림)
- node-sidecar: print_files / list_printers / read_batch_manifest RPC (vitest 7건 통과)
- 화이트리스트: src-tauri/src/commands/sidecar_cmd.rs 동기화
- 검증: TypeScript 0 / cargo check 0 / Vitest 53 pass

### Phase 2 통합 흐름 (검증 대상)
```
탐색기 우클릭 → kordoc-launcher.exe → kordoc:// URL
                                       ↓
                            Tauri (single-instance + deep-link 플러그인)
                                       ↓ emit("deep-link")
                            React useDeepLink → URL 파싱 → importFiles
                                       ↓ batch 면 sidecar.read_batch_manifest
                            사용자 액션 클릭 → handleStartAction
                                       ↓ invoke
                            Node sidecar (kordoc parse + markdownToPdf + PrintTo)
                                       ↓ 완료/실패
                            in-app Toast + (창 비포커스 시) Win11 native toast
```

### 알려진 함정 (Phase 2 W2 신규 ★)
- **tauri-plugin-deep-link 2.4.8 yanked** → 2.4.7 + single-instance 2.4.0 핀 필수
- **PrintTo verb** copies/duplex/color 제어 불가 (드라이버 기본값)
- **임시 PDF 60초 지연 unlink** 필수 (즉시 삭제 시 spool 실패)
- **tauri features = ["tray-icon"]** 명시 필요 (default 미포함)
- **on_tray_icon_event 클로저 타입 추론 실패** → `|tray: &TrayIcon<tauri::Wry>, event: TrayIconEvent|` 명시
- **kordoc dist 빌드 누락** 시 link:../../kordoc 사용해도 v2.7 API 미노출 → `cd kordoc && npm install && npm run build`

### 기존 함정
- BoundSheet8.dt (1B) ≠ BOF.dt (2B). 비교 금지.
- KordocError(message)만, code는 classifyError가 키워드로 분류.
- tsup OPTIONAL_EXTERNAL에 puppeteer-core 추가 필수.
- MSIX SparsePackage `MinVersion="10.0.17763.0"` 미만 미지원.
- Add-AppxPackage Sparse는 -ExternalLocation 절대경로 필요.
- 자체서명 cert는 LocalMachine\Root + TrustedPeople 양쪽 (관리자 권한).
