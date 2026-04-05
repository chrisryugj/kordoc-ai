# KorDoc AI

**다 파싱해버리겠다. AI도 붙여버리겠다.**

> *관공서에서 쏟아지는 HWP/HWPX/PDF/XLSX/DOCX를 AI로 변환·요약·비교·병합하는 데스크톱 도구.*
> *교육시설안전원 사전기획팀 AI 전환 자문 — 자문위원 류승인 (서울 광진구청)*

---

## 💡 무엇을 할 수 있나요?

| 기능 | 설명 | 엔진 |
|------|------|------|
| **마크다운 변환** | HWP/HWPX/PDF/XLSX/DOCX → Markdown 즉시 변환 | kordoc (로컬) |
| **배치 변환** | 폴더 내 문서 일괄 변환 + 진행률 표시 | kordoc (로컬) |
| **AI OCR** | 이미지 PDF를 Gemini Vision으로 텍스트 추출 | Gemini API |
| **AI 요약** | 4가지 스타일(일반/보고/검토/조치) × 3가지 분량 | Gemini API |
| **문서 비교** | 두 문서 신구대조표 자동 생성 (HWP↔HWPX도 가능) | kordoc (로컬) |
| **표 추출** | 복잡한 병합 표도 정확한 마크다운 테이블로 | kordoc (로컬) |
| **양식 추출** | 공문서 양식 필드(라벨-값 쌍) 자동 인식 | kordoc (로컬) |
| **HWPX 역변환** | 마크다운 → HWPX 보고서 파일 생성 | kordoc (로컬) |
| **문서 병합** | 서식 유지 수합 (HWPX/DOCX/XLSX/PDF) + 마크다운 병합 | kordoc + 네이티브 |
| **영수증 스캔** | 영수증 이미지 → 항목·금액 JSON 추출 | Gemini Vision |

### 배포용(열람 제한) HWP도 파싱

관공서에서 흔한 "배포용" HWP — 이전엔 한컴오피스로만 열렸던 파일을 **kordoc v2.0**부터 완벽 파싱합니다.
AES-128 ECB + MSVC LCG 복호화를 순수 JS로 구현. [rhwp](https://github.com/edwardkim/rhwp)(MIT) 알고리즘 참조.

---

## 아키텍처

```
┌──────────────────────────────────────────────┐
│  React 19 (TypeScript + Tailwind CSS 4)      │
│  10개 액션 UI · 요약 옵션 다이얼로그 · 설정  │
└──────────────── ↕ Tauri IPC ─────────────────┘
┌──────────────────────────────────────────────┐
│  Tauri 2.10 (Rust)                           │
│  SidecarManager · JSON-RPC 라우터 · Whitelist │
└────────────── ↕ stdin/stdout ────────────────┘
┌──────────────────────────────────────────────┐
│  Node.js Sidecar (JSON-RPC 2.0)             │
│  kordoc v2.0 (로컬 파싱) + Gemini API (AI)  │
│  17개 RPC 메서드 · 동시성 제한 · cancel 지원  │
└──────────────────────────────────────────────┘
```

### 왜 Node.js Sidecar?

| 기능 | Rust 생태계 | Node.js (kordoc) |
|------|-------------|-------------------|
| HWP/HWPX 파싱 | 라이브러리 없음 | kordoc — 순수 JS, 한컴오피스 불필요 |
| 배포용 HWP 복호화 | — | kordoc v2.0 — AES-128 ECB + LCG |
| PDF 텍스트 추출 | 한글 깨짐 빈번 | kordoc — pdfjs 기반, 이중 표 감지 |
| XLSX/DOCX 파싱 | 미성숙 | kordoc — 직접 구현 |
| Gemini API | 공식 SDK 없음 | `@google/generative-ai` 공식 SDK |

---

## 기술 스택

| 계층 | 기술 |
|------|------|
| **UI** | React 19 · TypeScript 5.9 · Tailwind CSS 4 · Vite 7 |
| **데스크톱** | Tauri 2.10 (Rust) · window-state 플러그인 |
| **백엔드** | Node.js · kordoc v2.0.2 · Gemini API |
| **AI** | gemini-3-flash-preview (3.x 최신) |
| **빌드** | pnpm · tsc → Tauri MSI 인스톨러 |

---

## 빠른 시작

### 사전 요구사항

- **Windows 10/11**
- **Node.js 20+** / **pnpm 10+**
- **Rust** (stable) + Tauri CLI
- **Gemini API 키** ([Google AI Studio](https://aistudio.google.com/)에서 발급)

> 한컴오피스, MS Office 등 **별도 프로그램 설치 불필요** — kordoc이 순수 JS로 파싱

### 개발 모드

```bash
# 프론트엔드 의존성
pnpm install

# Node.js sidecar 빌드
cd node-sidecar && pnpm install && pnpm build && cd ..

# 개발 앱 실행
pnpm tauri:dev
```

### 프로덕션 빌드

```bash
pnpm tauri:build
# → src-tauri/target/release/bundle/msi/*.msi
```

---

## 폴더 구조

```
kordoc-ai/
├── src/                          # React 프론트엔드
│   ├── App.tsx                   # 메인 앱 (파이프라인 상태 관리)
│   ├── components/
│   │   ├── layout/               # Sidebar, StatusBar
│   │   ├── pipeline/             # Workspace, OcrProgress, ResultStep
│   │   ├── settings/             # API 키, 모델 설정
│   │   └── ui/                   # Button, Badge, Modal, Toast
│   ├── hooks/                    # useSidecar, usePipeline, useWindowSize
│   └── types/                    # pipeline.ts, nav.ts
├── src-tauri/                    # Tauri 데스크톱 앱 (Rust)
│   ├── src/lib.rs                # 앱 빌더 + 플러그인
│   └── src/commands/             # IPC 커맨드
├── node-sidecar/                 # Node.js 백엔드
│   ├── src/core/                 # 10개 비즈니스 모듈
│   │   ├── merge/                # 문서 병합 (HWPX/DOCX/XLSX/PDF)
│   │   ├── summary/              # AI 요약 (4스타일 × 3분량)
│   │   ├── ocr/                  # AI OCR (Gemini Vision)
│   │   └── ...
│   ├── src/rpc/                  # JSON-RPC 라우터 + 17개 메서드
│   └── config/settings.yaml      # 설정
└── docs/                         # 의견서, 참고자료
```

## 문서 병합 상세

| 포맷 | 방식 | 서식 보존 | 의존성 |
|------|------|-----------|--------|
| **XLSX** | ZIP+XML 네이티브 스타일 병합 | 완벽 (폰트/색상/테두리/조건부서식) | 없음 |
| **DOCX** | ZIP+XML 스타일+넘버링 리매핑 | 완벽 (스타일/번호매기기/미디어) | 없음 |
| **PDF** | pdf-lib 페이지 복사 | 완벽 (원본 그대로) | 없음 |
| **HWPX** | pyhwpx COM 자동화 | 우수 (한컴이 처리) | 한컴오피스+Python |
| **HWPX (폴백)** | kordoc 마크다운 병합 | 텍스트만 (서식 손실) | 없음 |

> HWPX는 COM 실패 시 자동으로 kordoc 마크다운 병합으로 전환됩니다.
> 향후 네이티브 ZIP+XML 병합으로 전환 예정 ([계획](.claude/plans/kordoc-rhwp-enhancement.md)).

---

## 테스트

```bash
cd node-sidecar && pnpm test    # vitest 35개
```

## 주의사항

- kordoc이 HWP/HWPX/PDF/XLSX/DOCX를 순수 JS로 파싱 — **한컴오피스/MS Office 불필요**
- **배포용(열람 제한) HWP도 파싱** — kordoc v2.0+
- stdout은 **JSON-RPC 전용** — 로깅은 반드시 stderr로
- Gemini 기본 모델: `gemini-3-flash-preview`

---

## 일정

| 일정 | 날짜 |
|------|------|
| 서면자문 마감 | 2026.03.27 |
| 대면자문 | ~2026.04.17 |
| 최종 결과보고 | ~2026.04.30 |

---

## 관련 프로젝트

- **[kordoc](https://github.com/chrisryugj/kordoc)** — 순수 JS 한국 문서 파서 (이 앱의 핵심 엔진)
- **[rhwp](https://github.com/edwardkim/rhwp)** — Rust+WASM HWP 뷰어/에디터 (알고리즘 참조, MIT)
