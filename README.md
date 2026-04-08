# KorDoc AI

**다 파싱해버리겠다. AI도 붙여버리겠다.**

> *HWP, HWPX, PDF, XLSX, DOCX — 관공서에서 쏟아지는 모든 문서를 AI로 변환하고, 요약하고, 비교하고, 병합하는 데스크톱 도구.*

---

## 💡 KorDoc AI로 무엇을 할 수 있나요?

*   **📄 어떤 문서든 마크다운으로**: `HWP`, `HWPX`, `PDF`, `XLSX`, `DOCX`를 즉시 변환. 배포용(열람 제한) HWP도 파싱됩니다.
*   **📦 배치 변환**: 폴더째 던지면 한번에 변환. 진행률 실시간 표시.
*   **🤖 AI 요약**: 4가지 스타일(일반·보고·검토·조치 추출) × 3가지 분량. 공문서에 최적화된 프롬프트.
*   **👁️ AI OCR**: 스캔 PDF도 Gemini Vision으로 텍스트 추출. 원본 레이아웃 최대 보존.
*   **🔍 문서 비교**: 두 문서의 차이점을 신구대조표로. HWP↔HWPX 크로스 포맷도 가능.
*   **📊 표 추출**: 선 없는 PDF, 복잡한 병합 HWP 표도 정확한 마크다운 테이블로 복원.
*   **🔗 문서 병합**: HWPX/DOCX/XLSX/PDF를 서식 유지한 채 하나로. 마크다운 합치기도 가능.
*   **📝 HWPX 역변환**: AI가 작성한 마크다운을 다시 보고서 양식(`.hwpx`)으로 되돌리기.
*   **🧾 영수증 스캔**: 영수증 사진 → 항목·금액·합계 JSON 자동 추출.

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
| HWP/HWPX 파싱 | 라이브러리 없음 | [kordoc](https://github.com/chrisryugj/kordoc) — 순수 JS, 한컴오피스 불필요 |
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
| **백엔드** | Node.js · [kordoc](https://github.com/chrisryugj/kordoc) v2.0 · Gemini API |
| **AI** | gemini-3-flash-preview |
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

## 문서 병합

| 포맷 | 방식 | 서식 보존 |
|------|------|-----------|
| **XLSX** | ZIP+XML 네이티브 스타일 병합 | 완벽 (폰트·색상·테두리·조건부서식) |
| **DOCX** | ZIP+XML 스타일+넘버링 리매핑 | 완벽 (스타일·번호매기기·미디어) |
| **PDF** | pdf-lib 페이지 복사 | 완벽 (원본 그대로) |
| **HWPX** | pyhwpx COM 자동화 → 실패 시 kordoc 마크다운 폴백 | COM: 우수 / 폴백: 텍스트만 |

> HWPX 서식 유지 수합은 한컴오피스+Python 필요. 설치 안 되어 있으면 자동으로 마크다운 병합으로 전환됩니다.

---

## 폴더 구조

```
kordoc-ai/
├── src/                          # React 프론트엔드
│   ├── components/
│   │   ├── pipeline/             # Workspace, OcrProgress, ResultStep
│   │   ├── settings/             # API 키, 모델 설정
│   │   └── ui/                   # Button, Badge, Modal, Toast
│   └── hooks/                    # useSidecar, usePipeline, useWindowSize
├── src-tauri/                    # Tauri 데스크톱 앱 (Rust)
│   └── src/commands/             # IPC 커맨드
└── node-sidecar/                 # Node.js 백엔드
    ├── src/core/                 # 10개 비즈니스 모듈
    │   ├── merge/                # 문서 병합 (HWPX/DOCX/XLSX/PDF)
    │   ├── summary/              # AI 요약 (4스타일 × 3분량)
    │   └── ocr/                  # AI OCR (Gemini Vision)
    └── src/rpc/                  # JSON-RPC 라우터 + 17개 메서드
```

## 테스트

```bash
cd node-sidecar && pnpm test    # vitest 35개
```

## 주의사항

- kordoc이 HWP/HWPX/PDF/XLSX/DOCX를 순수 JS로 파싱 — **한컴오피스/MS Office 불필요**
- **배포용(열람 제한) HWP도 파싱** — kordoc v2.0+
- stdout은 **JSON-RPC 전용** — 로깅은 반드시 stderr로
- Gemini 기본 모델: `gemini-3-flash-preview`

## 라이선스

[MIT](./LICENSE)
