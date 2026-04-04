# KorDoc AI — 한국 문서 변환 AI 데스크톱 도구

> 교육시설안전원 사전기획팀 AI 전환 자문
> 자문위원 류승인 (서울 광진구청)

**Tauri + React + Node.js** 데스크톱 앱으로, HWP/HWPX/PDF/XLSX/DOCX 문서 변환부터 AI OCR·요약·비교까지 원스톱으로 처리합니다.

---

## 아키텍처

```
┌───────────────────────────────────────────┐
│  React 프론트엔드 (TypeScript + Tailwind) │
│  10개 액션 UI + 설정/도움말               │
└─────────────── ↕ Tauri IPC ───────────────┘
┌───────────────────────────────────────────┐
│  Tauri 데스크톱 앱 (Rust)                 │
│  SidecarManager · JSON-RPC · Whitelist    │
└──────────── ↕ stdin/stdout ───────────────┘
┌───────────────────────────────────────────┐
│  Node.js Sidecar (JSON-RPC 2.0 서버)     │
│  17개 RPC 메서드 (whitelist 기반 보안)    │
│  kordoc (로컬 파싱) + Gemini API (AI)     │
└───────────────────────────────────────────┘
```

### 왜 Node.js Sidecar인가?

| 기능 | Rust 생태계 | Node.js (kordoc) |
|------|-------------|-------------------|
| HWP/HWPX 파싱 | 라이브러리 없음 | kordoc — 순수 JS, 한컴오피스 불필요 |
| PDF 텍스트 추출 | 한글 깨짐 빈번 | kordoc — pdfjs 기반 |
| XLSX/DOCX 파싱 | 미성숙 | kordoc — 직접 구현 |
| Gemini API | 공식 SDK 없음 | `@google/generative-ai` 공식 SDK |

---

## 기술 스택

| 계층 | 기술 |
|------|------|
| **UI** | React 19 · TypeScript 5.9 · Tailwind CSS 4 · Vite 7 |
| **데스크톱** | Tauri 2.10 (Rust) |
| **백엔드** | Node.js · kordoc v1.8+ · Gemini API |
| **AI 모델** | gemini-3-flash-preview |
| **빌드** | pnpm · tsc → Tauri MSI 인스톨러 |

## 핵심 기능 (10개)

| 기능 | 엔진 | API |
|------|------|-----|
| 마크다운 변환 (배치 포함) | kordoc parse() | 로컬 |
| AI OCR (이미지 PDF) | Gemini Vision | API |
| AI 요약 | Gemini text | API |
| 문서 비교 (신구대조표) | kordoc compare() | 로컬 |
| 표 추출 | kordoc parse → table | 로컬 |
| 양식 필드 추출 | kordoc extractFormFields() | 로컬 |
| HWPX 역변환 | kordoc markdownToHwpx() | 로컬 |
| 문서 병합 | 다중 parse + 병합 | 로컬 |
| 영수증 스캔 | Gemini Vision + JSON | API |

---

## 빠른 시작

### 사전 요구사항

- **Windows 10/11**
- **Node.js 20+** / **pnpm 10+**
- **Rust** (stable) + Tauri CLI
- **Gemini API 키** ([Google AI Studio](https://aistudio.google.com/)에서 발급)

> 한컴오피스, MS Office 등 **별도 프로그램 설치 불필요**

### 개발 모드

```bash
# 1. 프론트엔드 의존성 설치
pnpm install

# 2. Node.js sidecar 의존성 설치 + 빌드
cd node-sidecar
pnpm install && pnpm build
cd ..

# 3. 개발 앱 실행 (Vite + Tauri)
pnpm tauri:dev
```

### 프로덕션 빌드

```bash
# Node.js sidecar + Tauri 앱 + MSI 인스톨러 한번에 빌드
pnpm tauri:build
# → src-tauri/target/release/bundle/msi/*.msi
```

---

## 폴더 구조

```
kordoc-ai/
├── src/                          # React 프론트엔드
│   ├── App.tsx                   # 메인 앱 (파이프라인 상태 관리)
│   ├── components/               # UI 컴포넌트
│   │   ├── layout/               # Sidebar, StatusBar
│   │   ├── pipeline/             # 파이프라인 단계별 UI
│   │   ├── settings/             # 설정 모달 (API 키, 모델)
│   │   ├── help/                 # 도움말 모달
│   │   └── ui/                   # 공통 위젯 (Button, Badge, Modal, Toast)
│   ├── hooks/                    # useSidecar, usePipeline, useToast
│   └── types/                    # TypeScript 타입 정의
├── src-tauri/                    # Tauri 데스크톱 앱 (Rust)
│   ├── src/
│   │   ├── lib.rs                # 앱 빌더
│   │   ├── commands/             # IPC 커맨드 (React ↔ Rust)
│   │   └── sidecar/              # Node.js 프로세스 관리 + JSON-RPC
│   └── tauri.conf.json           # Tauri 설정
├── node-sidecar/                 # Node.js 백엔드
│   ├── src/
│   │   ├── main.ts               # JSON-RPC 2.0 서버 (stdin/stdout)
│   │   ├── rpc/                  # 라우터 + 메서드 등록
│   │   ├── core/                 # 10개 핵심 비즈니스 모듈
│   │   ├── infra/                # config, gemini, logger, progress
│   │   └── types/                # 공유 타입
│   ├── config/settings.yaml      # 설정 파일
│   └── tests/                    # vitest 테스트 (31개)
└── docs/                         # 의견서·계획·참고자료
```

## 테스트

```bash
# Node.js sidecar 테스트 (vitest 31개)
cd node-sidecar && pnpm test
```

## 주의사항

- kordoc이 HWP/HWPX/PDF/XLSX/DOCX를 순수 JS로 파싱 — **한컴오피스/MS Office 불필요**
- stdout은 **JSON-RPC 전용** — 로깅은 반드시 stderr로
- Gemini 기본 모델: `gemini-3-flash-preview`

---

## 일정

- 서면자문 마감: 2026.03.27
- 대면자문: ~2026.04.17
- 최종 결과보고: ~2026.04.30
