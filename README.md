# EduPlan AI v2 — 사전기획 적정성 검토 AI 통합 도구

> 교육시설안전원 사전기획팀 AI 전환 자문
> 자문위원 류승인 (서울 광진구청)

**Tauri + React + Python** 데스크톱 앱으로, HWP/PDF 문서 OCR부터 AI 태깅·분류·분석까지 원스톱으로 처리합니다.

---

## 아키텍처

```
┌───────────────────────────────────────────┐
│  React 프론트엔드 (TypeScript + Tailwind) │
│  컴포넌트: Pipeline · Tools · Settings    │
└─────────────── ↕ Tauri IPC ───────────────┘
┌───────────────────────────────────────────┐
│  Tauri 데스크톱 앱 (Rust)                 │
│  커맨드 5개 · SidecarManager · JSON-RPC   │
└──────────── ↕ stdin/stdout ───────────────┘
┌───────────────────────────────────────────┐
│  Python 사이드카 (JSON-RPC 2.0 서버)      │
│  18개 RPC 메서드 (whitelist 기반 보안)    │
│  MVP 1: OCR  │  MVP 2: 추출  │  MVP 3: 분석 │
│  + 웹 자동수집 도구 7종 (Playwright)      │
└───────────────────────────────────────────┘
```

### 왜 Python Sidecar인가?

핵심 기능들이 Python 생태계에만 존재하기 때문입니다.

| 기능 | Rust 생태계 | Python 생태계 |
|------|-------------|---------------|
| HWP/HWPX 파싱 | 라이브러리 없음 | pyhwpx (COM 기반) |
| Gemini Vision OCR | 공식 SDK 없음 | `google-genai` 공식 SDK |
| PDF 페이지 조작 | 한글 깨짐 빈번 | PyMuPDF, pypdf (성숙) |
| 브라우저 자동화 | 비공식 바인딩만 | Playwright 공식 지원 |

**검토한 대안들:**

| 대안 | 문제점 |
|------|--------|
| PyO3 (Rust에 Python 임베딩) | HWP 처리의 COM 객체(pyhwpx)가 STA 스레딩 요구 → Rust async와 충돌 |
| 순수 Python 앱 (Electron 등) | 데스크톱 배포 복잡. Tauri는 MSI 원클릭 인스톨러 제공 |
| REST API 서버 | 로컬 앱인데 HTTP 서버를 띄우면 포트 충돌, 방화벽 문제 |

**Sidecar 방식의 이점:**

- **프로세스 격리** — Python 크래시가 UI에 영향 없음. `kill_on_drop(true)`로 고아 프로세스 방지
- **프로토콜 단순성** — JSON-RPC 2.0은 요청/응답이 명확하고 디버깅이 쉬움 (stderr 로그)
- **이중 보안** — Rust 측 18개 메서드 화이트리스트 + Python 측 메서드 딕셔너리 검증
- **독립 빌드** — PyInstaller exe와 Tauri를 별도로 빌드/테스트 가능

---

## 기술 스택

| 계층 | 기술 |
|------|------|
| **UI** | React 19 · TypeScript 5.9 · Tailwind CSS 4 · Vite 7 |
| **데스크톱** | Tauri 2.10 (Rust) |
| **백엔드** | Python 3.10+ · Gemini API (google.genai) |
| **AI 모델** | gemini-3-flash-preview (OCR) · gemini-3.1-flash-lite-preview (분석) |
| **브라우저** | Playwright (7종 공공데이터 자동수집) |
| **빌드** | pnpm · PyInstaller → Tauri MSI 인스톨러 |

## MVP 구성

| MVP | 기능 | API |
|-----|------|-----|
| MVP 1 | HWPX/HWP/PDF → 텍스트 직접추출(우선) → OCR 폴백 → AI 태깅 | Gemini (이미지 PDF만) |
| MVP 2 | AI 태그 기반 PDF 페이지 추출 + 9개 테마별 라벨링 | 불필요 |
| MVP 3 | 교육과정 2단계 요약 (Step1 개별 → Step2 통합 분석 리포트) | Gemini (필수) |
| 도구 | 7종 웹 자동수집 (학교알리미·인구통계·설계대가·세움터·토지이음·문화유산·학구도) | Playwright |

---

## 빠른 시작

### 사전 요구사항

- **Windows 10/11**
- **Node.js 20+** / **pnpm 10+**
- **Rust** (stable) + Tauri CLI
- **Python 3.10+**
- **한컴오피스** (HWP → PDF 변환 시)
- **Gemini API 키** ([Google AI Studio](https://aistudio.google.com/)에서 발급)

### 개발 모드

```bash
# 1. 프론트엔드 의존성 설치
pnpm install

# 2. Python 사이드카 의존성 설치
cd python-sidecar
pip install -e ".[hwp,browser]"
cd ..

# 3. 개발 앱 실행 (Vite + Tauri)
pnpm tauri:dev
```

### 프로덕션 빌드

```bash
# 1. Python 사이드카 exe 빌드
cd python-sidecar
pyinstaller sidecar.spec
cd ..

# 2. Tauri 앱 + MSI 인스톨러 빌드
pnpm tauri:build
# → src-tauri/target/release/bundle/msi/*.msi
```

---

## 폴더 구조

```
edu-facility-ai/
├── src/                          # React 프론트엔드
│   ├── App.tsx                   # 메인 앱 (파이프라인 상태 관리)
│   ├── components/               # UI 컴포넌트
│   │   ├── layout/               # Sidebar, StatusBar
│   │   ├── pipeline/             # 파이프라인 단계별 UI (6단계)
│   │   ├── settings/             # 설정 모달 (API 키, 모델, 출력 폴더)
│   │   ├── tools/                # 웹 도구 뷰 + 결과 렌더링
│   │   ├── help/                 # 도움말 모달
│   │   └── ui/                   # 공통 위젯 (Button, Badge, Modal, Toast)
│   ├── hooks/                    # useSidecar, usePipeline, useToast
│   └── types/                    # TypeScript 타입 정의
├── src-tauri/                    # Tauri 데스크톱 앱 (Rust)
│   ├── src/
│   │   ├── lib.rs                # 앱 빌더 (5개 커맨드 노출)
│   │   ├── main.rs               # 진입점 (Sidecar 자동 시작)
│   │   ├── commands/             # IPC 커맨드 (React ↔ Rust)
│   │   └── sidecar/              # Python 프로세스 관리 + JSON-RPC 프로토콜
│   ├── tauri.conf.json           # Tauri 설정
│   └── capabilities/default.json # ACL 권한 (최소 권한 원칙)
├── python-sidecar/               # Python 백엔드
│   ├── main.py                   # JSON-RPC 2.0 서버 (stdin/stdout)
│   ├── rpc_handler.py            # 18개 RPC 메서드 디스패처
│   ├── sidecar.spec              # PyInstaller 설정
│   ├── config/                   # YAML 설정 파일
│   │   ├── settings.yaml         # MVP 1/2/3 + 브라우저 도구 설정
│   │   └── ocr-rules.yaml        # OCR 프롬프트 + 텍스트 정제 규칙
│   └── src/                      # MVP 모듈
│       ├── mvp1_converter/       # OCR 파이프라인 (8개 모듈)
│       ├── mvp2_extractor/       # 페이지 추출
│       ├── mvp3_analyzer/        # 교육과정 2단계 분석
│       ├── browser_tools/        # 웹 자동수집 도구 (7종)
│       └── shared/               # 공통 유틸리티
├── tests/                        # pytest 테스트 + 테스트 데이터
└── docs/                         # 의견서·계획·참고자료·원본자료
```

## IPC 프로토콜

- **JSON-RPC 2.0** over stdin/stdout
- **18개 RPC 메서드** (whitelist 기반 보안)
- progress notification (비동기 진행률 전송)
- ThreadPoolExecutor (max 2 workers)
- cancel 지원 (fire-and-forget)

## 테스트

```bash
# 오프라인 테스트 (API 불필요)
python -m pytest tests/ -v -m "not online"

# 전체 (API 포함)
python -m pytest tests/ -v

# 테스트 데이터 생성
python tests/create_test_data.py
```

## 설정

| 파일 | 내용 |
|------|------|
| `python-sidecar/config/settings.yaml` | MVP 1/2/3 + 브라우저 도구 설정 (모델, 온도, 타임아웃, 테마) |
| `python-sidecar/config/ocr-rules.yaml` | OCR 프롬프트 + 텍스트 정제 규칙 |
| `.env` | API 키 (앱 설정 탭에서 자동 저장) |

## 주의사항

- HWP 처리는 **Windows + 한컴오피스** 필수 (pyhwpx COM 사용)
- Gemini SDK는 `google.genai`로 마이그레이션 완료 (langchain 제거)
- stdout은 **JSON-RPC 전용** — Python에서 `print()` 사용 시 반드시 `file=sys.stderr`
- PyInstaller 빌드 시 hidden import 경고(`fitz.fitz`, `pypdf._readers` 등)는 무해함 — 구버전/내부 모듈로 런타임에 불필요
- 프로덕션 설정은 `~/.eduplan-ai/`에 저장됨 (Program Files 쓰기 권한 문제 대응)

---

## 일정

- 서면자문 마감: 2026.03.27
- 대면자문: ~2026.04.17
- 최종 결과보고: ~2026.04.30
