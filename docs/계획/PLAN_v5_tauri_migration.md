# Implementation Plan: 사전기획 검토 통합 도구 v5 (Tauri Migration)

**Status**: 🔄 Planning
**Started**: 2026-03-22 | **Last Updated**: 2026-03-22
**Plan Size**: Large (7 phases, 20-30 hours)

---

**⚠️ CRITICAL INSTRUCTIONS**: After completing each phase:
1. ✅ Check off completed task checkboxes
2. 🧪 Run all quality gate validation commands
3. ⚠️ Verify ALL quality gate items pass
4. 📅 Update "Last Updated" date above
5. 📝 Document learnings in Notes section
6. ➡️ Only then proceed to next phase

⛔ **DO NOT skip quality gates or proceed with failing checks**

---

## 📋 Overview

### Feature Description
기존 edu-facility-ai의 Python Tkinter GUI를 **Tauri v2 + React** 웹 기반 UI로 전환한다.
기존 Python 핵심 로직(MVP 1~3, shared 모듈, config)은 **전량 보존**하고 Python sidecar로 실행한다.
3개 MVP를 **통합 파이프라인**으로 재설계하고, AI 테마 자동 분류·browser_tools·검토의견서 자동 생성을 추가한다.

### 핵심 원칙
- **기존 Python 코드 재활용 극대화** — 8차 리뷰 완료된 프로덕션 코드, 수정 최소화
- **Docufinder(Anything) 아키텍처 답습** — Tauri v2 + React 19 + Tailwind CSS 4
- **Python sidecar 패턴** — Tauri가 Python subprocess를 spawn, stdin/stdout JSON-RPC 통신

### Success Criteria
- [ ] 기존 MVP 1~3 기능이 새 UI에서 동일하게 작동
- [ ] "전체 실행" 1버튼으로 Phase 1→2 파이프라인 실행 가능
- [ ] AI 테마 자동 분류로 수동 엑셀 작성 제거
- [ ] browser_tools UI 통합
- [ ] 검토의견서 초안 자동 생성
- [ ] MSI 설치 파일 빌드 성공

### User Impact
- 사전기획 검토 업무자가 3개 도구를 개별 실행 → **1개 통합 도구**로 전 과정 처리
- 수동 엑셀 인덱스 작성 → AI가 초안 생성, 사람은 검수만
- 공공데이터 수집 자동화 → 검토 시간 대폭 단축

---

## 🏗️ Architecture Decisions

| Decision | Rationale | Trade-offs |
|----------|-----------|------------|
| **Tauri v2 (Docufinder 동일)** | 검증된 스택, ~5MB 경량, MSI 배포 | Python sidecar 번들링 복잡도 |
| **Python sidecar (subprocess)** | 기존 1,100줄 코드 수정 0, Gemini SDK 그대로 | IPC 오버헤드 (미미) |
| **stdin/stdout JSON-RPC** | HTTP 서버보다 단순, 포트 충돌 없음 | 디버깅 시 로그 분리 필요 |
| **Docufinder 디자인 시스템 기반** | Pretendard 폰트, warm palette 재활용 | 교육 도메인 색상 커스터마이징 필요 |
| **React hooks (no Redux)** | Docufinder 패턴 답습, 상태 단순 | 기능 확장 시 context 분리 필요할 수 있음 |

---

## 📦 Dependencies

### 재활용 (기존 코드 — 수정 최소화)
- `src/shared/` — config.py, env_loader.py, logger.py, result.py
- `src/mvp1_converter/` — pipeline.py, ocr_engine.py, text_cleaner.py, hwp_to_pdf.py, text_extractor.py
- `src/mvp2_extractor/` — extractor.py
- `src/mvp3_analyzer/` — summarizer.py, integrator.py
- `src/browser_tools/` — base.py + 개별 크롤러들
- `config/` — settings.yaml, ocr-rules.yaml

### 폐기 (Tkinter GUI 관련)
- `src/gui.py`, `src/gui_executor.py`, `src/gui_settings.py`
- `src/gui_mvp2.py`, `src/gui_theme.py`, `src/gui_widgets.py`, `src/gui_utils.py`
- `src/cli.py` (sidecar entry point로 대체)

### 신규 External Dependencies

**Frontend (npm)**:
- `react` 19, `react-dom` 19
- `@tauri-apps/api` ^2.9
- `tailwindcss` ^4
- `lucide-react` (아이콘)
- `typescript` ^5.9

**Backend (Cargo)**:
- `tauri` ^2.10 (shell, dialog, fs 플러그인)
- `serde`, `serde_json` (IPC 직렬화)
- `tokio` (async subprocess 관리)

**Python (기존 pyproject.toml 유지)**:
- google-generativeai, pyhwpx, pypdf, reportlab, openpyxl, PyMuPDF, pyyaml

---

## 🗂️ 프로젝트 구조 (목표)

```
edu-facility-ai/
├── src/                          # React Frontend
│   ├── App.tsx                   # Root component
│   ├── components/
│   │   ├── ui/                   # Button, Modal, Badge, Toast, Card...
│   │   ├── layout/               # Header, Sidebar, StatusBar
│   │   ├── pipeline/             # PipelineView, StepCard, ProgressBar
│   │   ├── classify/             # ThemeClassifier, ThemeTable (검수 UI)
│   │   ├── browser/              # BrowserToolsPanel
│   │   └── review/               # ReviewDocGenerator, ReviewEditor
│   ├── hooks/                    # useProgress, usePipeline, useSettings...
│   ├── types/                    # TypeScript interfaces
│   ├── styles/                   # variables.css, components.css
│   └── utils/                    # IPC helpers, formatters
│
├── src-tauri/                    # Rust Backend (Tauri shell)
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # App setup, plugin registration
│   │   ├── commands/             # Tauri IPC commands
│   │   │   ├── pipeline.rs       # MVP 1~3 파이프라인 실행
│   │   │   ├── settings.rs       # 설정 관리
│   │   │   ├── file.rs           # 파일/폴더 선택
│   │   │   └── browser.rs        # browser_tools 실행
│   │   ├── sidecar/
│   │   │   ├── manager.rs        # Python subprocess 생명주기
│   │   │   ├── protocol.rs       # JSON-RPC 메시지 정의
│   │   │   └── progress.rs       # 진행률 이벤트 브릿지
│   │   └── state.rs              # AppState (settings cache)
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── python/                       # Python Sidecar (기존 코드 이전)
│   ├── main.py                   # JSON-RPC stdin/stdout entry point (신규)
│   ├── shared/                   # ← src/shared/ 이전
│   ├── mvp1_converter/           # ← src/mvp1_converter/ 이전
│   ├── mvp2_extractor/           # ← src/mvp2_extractor/ 이전
│   ├── mvp3_analyzer/            # ← src/mvp3_analyzer/ 이전
│   ├── browser_tools/            # ← src/browser_tools/ 이전
│   ├── classifier/               # AI 테마 분류 (신규)
│   │   └── theme_classifier.py
│   ├── review_generator/         # 검토의견서 생성 (신규)
│   │   └── generator.py
│   └── requirements.txt
│
├── config/                       # YAML 설정 (기존 유지)
│   ├── settings.yaml
│   └── ocr-rules.yaml
│
├── assets/fonts/                 # Pretendard (기존 유지)
├── tests/                        # 테스트 (기존 유지 + 신규 추가)
└── docs/plans/                   # 이 문서
```

---

## 🔌 IPC Protocol: Python Sidecar

### 통신 방식: stdin/stdout JSON-RPC 2.0

**Rust → Python (요청)**:
```json
{"jsonrpc": "2.0", "id": 1, "method": "mvp1.run", "params": {...}}
```

**Python → Rust (진행률 — notification, id 없음)**:
```json
{"jsonrpc": "2.0", "method": "progress", "params": {"current": 5, "total": 20, "message": "OCR: page_15.png"}}
```

**Python → Rust (결과)**:
```json
{"jsonrpc": "2.0", "id": 1, "result": {"status": "success", "total": 10, "success_count": 9, ...}}
```

### 지원 메서드

| Method | 설명 | 기존 코드 |
|--------|------|----------|
| `mvp1.run` | HWP/PDF → OCR → 마크다운 | pipeline.py |
| `mvp2.run` | 엑셀 기반 페이지 추출 + 라벨링 | extractor.py |
| `mvp3.run` | 2단계 요약 + 통합 리포트 | summarizer.py + integrator.py |
| `classify.themes` | AI 테마 자동 분류 | **신규** |
| `classify.generate_index` | 분류 결과 → 엑셀 생성 | **신규** |
| `browser.run` | 공공데이터 자동 수집 | browser_tools/ |
| `review.generate` | 검토의견서 초안 생성 | **신규** |
| `pipeline.run_all` | 전체 파이프라인 실행 | **신규** (orchestrator) |
| `settings.get` | 현재 설정 조회 | config.py |
| `settings.update` | 설정 변경 | config.py |
| `cancel` | 현재 작업 취소 | threading.Event |

---

## 🚀 Implementation Phases

### Phase 1: Tauri + React 프로젝트 스캐폴딩
**Goal**: Tauri v2 프로젝트 생성, 빈 React 앱이 Tauri 윈도우에서 렌더링 | **Time**: 2-3h | **Status**: ⏳ Pending

#### Tasks

**🟢 GREEN: 프로젝트 생성**
- [ ] **Task 1.1**: `pnpm create tauri-app` 으로 React + TypeScript 템플릿 생성
  - Docufinder의 package.json, tsconfig.json, vite.config.ts 참고
  - pnpm workspace 설정
- [ ] **Task 1.2**: Tauri 설정 (tauri.conf.json)
  - 앱 이름: "사전기획 검토 도구" / identifier: com.edu-facility.review
  - 윈도우: 1280x800, minWidth 960, minHeight 640
  - CSP, 번들 설정 (MSI)
  - shell 플러그인 (Python sidecar 실행용)
- [ ] **Task 1.3**: Tailwind CSS 4 + 디자인 토큰 설정
  - Docufinder variables.css 기반, 교육 도메인 색상 커스터마이징
  - Pretendard 폰트 번들
- [ ] **Task 1.4**: 기본 레이아웃 컴포넌트 (Header, Sidebar, StatusBar)
  - Docufinder 레이아웃 패턴 답습
  - 사이드바 네비게이션: 대시보드, 문서처리, 데이터수집, 검토의견서, 설정

**🔵 REFACTOR**
- [ ] **Task 1.5**: dev/build 스크립트 검증
  - `pnpm tauri:dev` 정상 실행 확인
  - HMR 동작 확인

#### Quality Gate ✋
- [ ] `pnpm tauri:dev` 실행 시 Tauri 윈도우에 React 앱 렌더링
- [ ] 사이드바 네비게이션 클릭 시 화면 전환
- [ ] 다크/라이트 모드 토글 동작
- [ ] `pnpm tauri:build` MSI 생성 성공

---

### Phase 2: Python Sidecar 인프라
**Goal**: Rust가 Python subprocess를 spawn하고 JSON-RPC 통신 성공 | **Time**: 3-4h | **Status**: ⏳ Pending

#### Tasks

**🟢 GREEN: Sidecar Entry Point**
- [ ] **Task 2.1**: `python/main.py` — JSON-RPC stdin/stdout 루프
  - 기존 코드 import 경로만 조정 (src/ → python/)
  - 요청 파싱 → 메서드 라우팅 → 결과 반환
  - progress notification 발송 (기존 callback → stdout JSON)
  - cancel 지원 (threading.Event)
- [ ] **Task 2.2**: 기존 Python 코드 `python/` 디렉토리로 복사
  - shared/, mvp1_converter/, mvp2_extractor/, mvp3_analyzer/ 그대로
  - import 경로 최소 조정 (상대 import → 패키지 import)
  - **기존 로직 수정 0건** 목표

**🟢 GREEN: Rust Sidecar Manager**
- [ ] **Task 2.3**: `src-tauri/src/sidecar/manager.rs`
  - Python subprocess spawn (embedded Python or system Python)
  - stdin write / stdout read (async, tokio)
  - 생명주기 관리 (start, stop, restart, health check)
- [ ] **Task 2.4**: `src-tauri/src/sidecar/protocol.rs`
  - JSON-RPC 2.0 메시지 타입 (serde)
  - Request, Response, Notification 구조체
- [ ] **Task 2.5**: `src-tauri/src/sidecar/progress.rs`
  - Python progress notification → Tauri event emit
  - Frontend에서 `listen("progress", callback)` 으로 수신

**🔴 RED: 통신 테스트**
- [ ] **Test 2.6**: Rust ↔ Python ping/pong 테스트
- [ ] **Test 2.7**: settings.get 호출 → YAML 설정 반환 검증
- [ ] **Test 2.8**: progress notification 수신 검증

#### Quality Gate ✋
- [ ] Tauri 앱 실행 시 Python sidecar 자동 시작
- [ ] `settings.get` 호출 → 설정값 JSON 반환
- [ ] Python 에러 시 Rust가 에러 메시지 수신 (crash 안 함)
- [ ] 앱 종료 시 Python 프로세스 정상 종료

---

### Phase 3: MVP 1~3 UI + 개별 실행
**Goal**: 기존 3개 MVP 기능이 새 UI에서 개별 실행 가능 | **Time**: 4-5h | **Status**: ⏳ Pending

#### Tasks

**🟢 GREEN: Tauri Commands**
- [ ] **Task 3.1**: `commands/pipeline.rs` — MVP 실행 명령
  - `run_mvp1(config)`, `run_mvp2(config)`, `run_mvp3(config)`
  - Python sidecar에 JSON-RPC 전달 + 결과 반환
  - progress 이벤트 브릿지
- [ ] **Task 3.2**: `commands/file.rs` — 파일/폴더 선택
  - Tauri dialog 플러그인 (open_folder, open_file)
  - 파일 목록 조회 (확장자 필터링)
- [ ] **Task 3.3**: `commands/settings.rs` — 설정 CRUD
  - API 키 저장/조회, 모델 선택, 경로 관리

**🟢 GREEN: React UI 컴포넌트**
- [ ] **Task 3.4**: 공통 UI 컴포넌트 (Docufinder 포팅)
  - Button, Modal, Badge, Toast, Card, Input
  - PathValidationEntry (폴더 선택 + 검증)
  - ProgressBar (실시간 진행률)
  - ResultCard (성공/실패 요약)
- [ ] **Task 3.5**: MVP1 화면 — 문서 변환
  - 폴더 선택 → 파일 목록 → 실행 → 진행률 → 결과
  - 기존 gui_executor.py의 UX 로직 React로 재구현
- [ ] **Task 3.6**: MVP2 화면 — 페이지 추출
  - 기존 gui_mvp2.py의 듀얼 모드 (엑셀 인덱스 + 수동 선택)
  - PDF 파일 정보 표시, 라벨 설정
- [ ] **Task 3.7**: MVP3 화면 — 교육과정 분석
  - 입력 폴더 → 실행 → 2단계 진행률 → 결과 리포트
- [ ] **Task 3.8**: 설정 화면
  - API 키, 모델 선택, DPI, 워커 수 등
  - 기존 settings.yaml 값 표시/수정

**🟢 GREEN: React Hooks**
- [ ] **Task 3.9**: `usePipeline` — MVP 실행 상태 관리
  - isRunning, progress, result, cancel
  - Tauri event listener (progress)
- [ ] **Task 3.10**: `useSettings` — 설정 상태 관리
  - load/save, API 키 마스킹
- [ ] **Task 3.11**: `useToast` — 알림 큐

#### Quality Gate ✋
- [ ] MVP1: HWP/PDF 폴더 선택 → OCR 실행 → 마크다운 생성 확인
- [ ] MVP2: 엑셀 인덱스 → 페이지 추출 + 라벨링 확인
- [ ] MVP3: 텍스트 파일 → 2단계 요약 → 리포트 생성 확인
- [ ] 진행률 바 실시간 업데이트
- [ ] 작업 취소 동작
- [ ] 설정 변경 → 저장 → 재실행 시 반영

---

### Phase 4: 통합 파이프라인 + AI 테마 분류
**Goal**: MVP 1→2→3 자동 연결 + AI 테마 분류로 수동 엑셀 제거 | **Time**: 4-5h | **Status**: ⏳ Pending

#### Tasks

**🟢 GREEN: AI 테마 분류기 (Python 신규)**
- [ ] **Task 4.1**: `python/classifier/theme_classifier.py`
  - OCR 결과(마크다운)를 Gemini에게 전달
  - settings.yaml의 topic_folders 테마 정의를 프롬프트에 포함
  - 각 페이지가 어떤 테마에 해당하는지 JSON 분류 결과 반환
  - OCR 호출 시 같은 API 콜에서 분류까지 수행 (비용 절약 옵션)
- [ ] **Task 4.2**: `classify.generate_index` 메서드
  - 분류 결과 → 엑셀(pages.xlsx) 자동 생성
  - openpyxl로 기존 MVP2 형식에 맞게 출력
- [ ] **Task 4.3**: `pipeline.run_all` 오케스트레이터
  - Step 1: MVP1 실행 (OCR)
  - Step 2: AI 테마 분류 → 엑셀 생성
  - Step 3: 사용자 검수 대기 (UI에서 수정 가능)
  - Step 4: MVP2 실행 (페이지 추출)
  - Step 5: MVP3 실행 (분석)

**🟢 GREEN: 검수 UI (React 신규)**
- [ ] **Task 4.4**: ThemeClassifier 컴포넌트
  - AI 분류 결과를 편집 가능한 테이블로 표시
  - 페이지 번호 추가/삭제, 테마 변경
  - "확인" 버튼 → 수정된 분류로 진행
- [ ] **Task 4.5**: PipelineView 컴포넌트
  - 5단계 스텝 카드 (각 단계 상태 표시)
  - "전체 실행" 버튼 + 단계별 개별 실행
  - Step 3(검수)에서 자동 일시정지

**🟢 GREEN: React Hook**
- [ ] **Task 4.6**: `usePipelineOrchestrator`
  - 전체 파이프라인 상태 머신
  - 단계 간 데이터 전달 (OCR 결과 → 분류 → 추출)
  - 검수 대기 상태 관리

#### Quality Gate ✋
- [ ] "전체 실행" → OCR → AI 분류 → 검수 UI 표시 → 확인 → 추출 → 분석 완료
- [ ] AI 분류 결과를 사용자가 수정 후 진행 가능
- [ ] 중간에 취소 시 부분 결과 보존
- [ ] 개별 단계도 독립 실행 가능

---

### Phase 5: Browser Tools UI
**Goal**: 공공데이터 자동 수집 도구를 통합 UI에서 실행 | **Time**: 2-3h | **Status**: ⏳ Pending

#### Tasks

**🟢 GREEN: 구현**
- [ ] **Task 5.1**: browser_tools JSON-RPC 메서드 등록
  - 기존 browser_tools/ 코드에 진행률 callback 추가
  - `browser.run(tool_name, params)` 메서드
- [ ] **Task 5.2**: BrowserToolsPanel 컴포넌트
  - 도구별 카드 (세움터, 학교알리미, 토지이음, 인구통계 등)
  - 각 도구별 파라미터 입력 (학교명, 주소 등)
  - 실행 → 진행률 → 결과 (스크린샷, 다운로드 파일)
- [ ] **Task 5.3**: 결과 뷰어
  - 수집된 스크린샷 미리보기
  - 다운로드 파일 목록 + 폴더 열기

#### Quality Gate ✋
- [ ] 세움터 건축물대장 조회 실행 → 결과 PDF 다운로드
- [ ] 학교알리미 교육과정 자료 다운로드
- [ ] 스크린샷 미리보기 표시

---

### Phase 6: 검토의견서 자동 생성
**Goal**: RAG 기반 과거 검토의견서 참조 + AI 초안 생성 | **Time**: 4-5h | **Status**: ⏳ Pending

#### Tasks

**🟢 GREEN: Python 신규 모듈**
- [ ] **Task 6.1**: `python/review_generator/generator.py`
  - 과거 검토의견서 로드 (마크다운/텍스트)
  - Gemini API에 context로 전달 (간이 RAG)
  - 파이프라인 결과물 (OCR, 테마 분류, 교육과정 분석) 종합
  - 검토의견서 초안 마크다운 생성
- [ ] **Task 6.2**: 검토의견서 템플릿 관리
  - 기관 양식에 맞는 템플릿 (config/review_template.yaml)
  - 섹션별 프롬프트 (학급수, 면적, 교육과정 등)

**🟢 GREEN: React UI**
- [ ] **Task 6.3**: ReviewDocGenerator 컴포넌트
  - 입력: 프로젝트 폴더 (파이프라인 결과물 포함)
  - 참조: 과거 검토의견서 폴더
  - 실행 → AI 초안 생성
- [ ] **Task 6.4**: ReviewEditor 컴포넌트
  - 마크다운 편집기 (섹션별 수정)
  - 미리보기 (렌더링된 의견서)
  - 내보내기 (마크다운, DOCX)

#### Quality Gate ✋
- [ ] 테스트 데이터(사전기획 보고서 샘플)로 검토의견서 초안 생성
- [ ] 생성된 초안을 편집기에서 수정 가능
- [ ] 마크다운 내보내기 동작

---

### Phase 7: 빌드 + 배포 + 마무리
**Goal**: MSI 설치 파일 생성, Python 번들링, 최종 QA | **Time**: 3-4h | **Status**: ⏳ Pending

#### Tasks

**🟢 GREEN: Python 번들링**
- [ ] **Task 7.1**: Python embedded 번들
  - Windows Embedded Python (python-3.10.x-embed-amd64.zip) 활용
  - pip로 의존성 설치 → 폴더째 번들
  - Tauri resources로 포함
- [ ] **Task 7.2**: Tauri sidecar 설정
  - tauri.conf.json resources에 python/ 폴더 등록
  - 실행 경로 해석 (개발 vs 빌드 환경)

**🟢 GREEN: 빌드 파이프라인**
- [ ] **Task 7.3**: `pnpm tauri:build` 스크립트
  - Python 번들 → Vite 빌드 → Cargo 빌드 → MSI 생성
  - 폰트, config 파일 번들 확인
- [ ] **Task 7.4**: CI/CD (GitHub Actions)
  - Docufinder CI 패턴 답습
  - Frontend check → Backend check → Build artifact

**🔵 REFACTOR: 최종 QA**
- [ ] **Task 7.5**: 전체 기능 통합 테스트
  - 테스트 데이터로 전 파이프라인 실행
  - 각 MVP 개별 실행 검증
  - 설정 변경 → 재실행 검증
- [ ] **Task 7.6**: 성능/UX 최적화
  - 초기 로딩 시간 (<3초)
  - 대용량 파일 처리 (84페이지 PDF)
  - 메모리 사용량 점검

#### Quality Gate ✋
- [ ] MSI 설치 → 앱 실행 → 전 기능 동작 (clean PC)
- [ ] Python sidecar 번들 정상 작동 (시스템 Python 없이)
- [ ] 테스트 데이터 전체 파이프라인 성공

---

## ⚠️ Risk Assessment

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| Python embedded 번들링 복잡도 | Medium | High | Phase 2에서 조기 검증, fallback으로 시스템 Python 활용 |
| Gemini API 변경/제한 | Low | Medium | 기존 코드의 retry 로직 그대로 활용, 모델명만 config |
| Tauri v2 + Python sidecar 통신 안정성 | Low | High | Docufinder의 subprocess 패턴 답습, keepalive 구현 |
| HWP 변환 (pyhwpx COM) 번들 문제 | Medium | Medium | 한컴오피스 설치 필수 전제, HwpxConverter fallback |
| browser_tools 웹사이트 구조 변경 | Medium | Low | 크롤러별 독립 모듈, 실패 시 graceful degradation |

---

## 🔄 Rollback Strategy

### Phase 단위 롤백
- 각 Phase는 git branch에서 작업, 실패 시 branch 삭제
- 기존 Tkinter 앱(src/gui.py)은 Phase 7 완료까지 보존
- Python 코드는 복사(move 아님)하므로 원본 항상 존재

### 전체 롤백
- 기존 edu-facility-ai 앱은 그대로 동작 가능
- 새 Tauri 앱은 별도 디렉토리(또는 monorepo 내 app/ 폴더)에서 작업

---

## 📊 Progress Tracking

| Phase | Estimated | Actual | Status |
|-------|-----------|--------|--------|
| Phase 1: 스캐폴딩 | 2-3h | - | ⏳ |
| Phase 2: Python Sidecar | 3-4h | - | ⏳ |
| Phase 3: MVP 1~3 UI | 4-5h | - | ⏳ |
| Phase 4: 통합 파이프라인 | 4-5h | - | ⏳ |
| Phase 5: Browser Tools | 2-3h | - | ⏳ |
| Phase 6: 검토의견서 | 4-5h | - | ⏳ |
| Phase 7: 빌드/배포 | 3-4h | - | ⏳ |
| **Total** | **22-29h** | - | **0%** |

---

## 📚 References
- Docufinder(Anything) 소스: `C:\github_project\Docufinder\`
- 기존 MVP 구현체: `c:\github_project\edu-facility-ai\src\`
- 테스트 데이터: `C:\Users\Chris\Downloads\자문\MVP1~3 테스트용 자료\`
- 서면자문 의견서: `docs/산출물/의견서/서면자문_의견서_류승인_v6.md`
- 업무 URL 목록: 에듀체크, 학교알리미, 세움터, 토지이음, 인구통계, 유산정보, 학구도

---

## 📝 Notes & Learnings

### Implementation Notes
- (작업 시작 후 기록)

### Blockers Encountered
- (작업 시작 후 기록)

---

## ✅ Final Checklist

**Before marking plan as COMPLETE**:
- [ ] All phases completed with quality gates passed
- [ ] Full integration testing with test data
- [ ] 기존 Tkinter GUI 코드 정리 (폐기 확인)
- [ ] MSI 설치 파일 clean PC 검증
- [ ] Performance: 초기 로딩 <3초, 84p PDF OCR 정상 완료
- [ ] Plan document archived for future reference

---

**Plan Status**: 🔄 Planning — 사용자 승인 대기
**Next Action**: 사용자 승인 후 Phase 1 시작
**Blocked By**: None
