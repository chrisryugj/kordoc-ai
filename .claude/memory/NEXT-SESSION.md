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

작업 디렉토리: `D:\AI_Project\kordoc-ai` (또는 본인 경로)

```
KorDoc Suite Phase 2 W2 — kordoc-ai deep-link 핸들러 + 인쇄 RPC.

브랜치/레포 상태 (직전 세션에서 푸시됨):
- kordoc 본체: feat/xls-and-print 브랜치, v2.7.0 커밋 완료 (npm publish 대기)
- kordoc-shell: main 브랜치, init 커밋 완료 (Phase 2 W1 골격)
- kordoc-ai: main 브랜치, docs(PRD/ROADMAP/SPEC) 커밋 완료

먼저 .claude/memory/activeContext.md 읽고
docs/SPEC.md §2.1~2.2 (print_files / list_printers) 와 §3.4 (Tauri deep-link) 확인.

W2 D1-2: kordoc-ai에 tauri-plugin-deep-link + tauri-plugin-single-instance 추가,
src-tauri/src/lib.rs deep-link 수신 핸들러,
프론트엔드 useDeepLink 훅 + 라우팅 (convert / summarize / open / batch).

W2 D3-4: node-sidecar/src/core/print/index.ts 신규 → print_files / list_printers RPC.
- markdownToPdf(kordoc) → 임시 PDF
- Start-Process -Verb PrintTo

W2 D5: Tauri tray 아이콘 + 진행률 토스트.

Phase 1 publish 진행 여부도 확인 (npm publish kordoc@2.7.0).
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

### Phase 2 W2 작업 흐름
```
탐색기 우클릭 → kordoc-launcher.exe → kordoc:// URL
                                       ↓
                            Tauri (single-instance + deep-link 플러그인)
                                       ↓ emit
                            React (useDeepLink 훅 → 라우팅)
                                       ↓ invoke
                            Node sidecar (kordoc parse + markdownToPdf + PrintTo)
```

### 알려진 함정
- BoundSheet8.dt (1B) ≠ BOF.dt (2B). 비교 금지.
- KordocError(message)만, code는 classifyError가 키워드로 분류.
- tsup OPTIONAL_EXTERNAL에 puppeteer-core 추가 필수.
- MSIX SparsePackage `MinVersion="10.0.17763.0"` 미만 미지원.
- Add-AppxPackage Sparse는 -ExternalLocation 절대경로 필요.
- 자체서명 cert는 LocalMachine\Root + TrustedPeople 양쪽 (관리자 권한).
