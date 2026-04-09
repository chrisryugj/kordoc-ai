# KorDoc AI

**다 파싱해버리겠다. AI도 붙여버리겠다.**

> *HWP, HWPX, PDF, XLSX, DOCX — 관공서에서 쏟아지는 모든 문서를 AI로 변환하고, 요약하고, 비교하고, 병합하는 데스크톱 도구.*

> 7년차 공무원이 만든, 공무원을 위한 문서 도구.
> 한컴오피스도, MS Office도 필요 없다. [kordoc](https://github.com/chrisryugj/kordoc)이 순수 JS로 전부 파싱한다.

---

## 무엇을 할 수 있나요?

| 기능 | 설명 |
|------|------|
| 📄 **마크다운 변환** | HWP · HWPX · PDF · XLSX · DOCX → 마크다운. 배포용(열람 제한) HWP도 파싱. |
| 📦 **배치 변환** | 폴더째 던지면 한번에. 진행률 실시간 표시. |
| 🤖 **AI 요약** | 4가지 스타일(일반·보고·검토·조치 추출) × 3가지 분량. 공문서 최적화 프롬프트. |
| 👁️ **AI OCR** | 스캔 PDF도 Gemini Vision으로 텍스트 추출. 원본 레이아웃 최대 보존. |
| 🔍 **문서 비교** | 두 문서의 차이점을 신구대조표로. HWP↔HWPX 크로스 포맷 가능. |
| 📊 **표 추출** | 선 없는 PDF, 복잡한 병합 HWP 표도 정확한 마크다운 테이블로. |
| 🔗 **문서 병합** | HWPX · DOCX · XLSX · PDF 서식 유지 수합. 마크다운 합치기도 가능. |
| ✂️ **PDF 도구** | 페이지 분리, 추출, 제외. 필요한 페이지만 뽑아내기. |
| 📝 **HWPX 역변환** | AI가 작성한 마크다운을 다시 보고서 양식(`.hwpx`)으로 되돌리기. |
| 📋 **양식 추출** | 문서에서 양식 필드 자동 인식 → 다수 문서 일괄 추출. |
| 🔬 **문서 정합성 검사** | 목차·페이지·메타데이터 일관성 자동 점검. |
| 🔌 **MCP 원클릭 설치** | Claude · Cursor · VS Code · Zed 등 AI 도구에 kordoc MCP 자동 등록. |
| 📂 **폴더 드래그드롭** | 폴더째 드래그하면 지원 파일 자동 인식. 클립보드 붙여넣기도 지원. |
| 📁 **출력 폴더 선택** | 처리 결과 저장 위치 자유 선택. 전역 또는 작업별 개별 지정. |

---

## 아키텍처

```
┌──────────────────────────────────────────────┐
│  React 19 (TypeScript + Tailwind CSS 4)      │
│  15개 액션 UI · MCP 설치 · 폴더 드래그 · 설정  │
└──────────────── ↕ Tauri IPC ─────────────────┘
┌──────────────────────────────────────────────┐
│  Tauri 2.10 (Rust)                           │
│  SidecarManager · JSON-RPC 라우터 · Whitelist │
└────────────── ↕ stdin/stdout ────────────────┘
┌──────────────────────────────────────────────┐
│  Node.js Sidecar (JSON-RPC 2.0)             │
│  kordoc v2.2.3 (로컬 파싱) + Gemini API (AI)   │
│  22개 RPC 메서드 · 동시성 제한 · cancel 지원  │
└──────────────────────────────────────────────┘
```

### 왜 Node.js Sidecar?

| 기능 | Rust 생태계 | Node.js (kordoc) |
|------|-------------|-------------------|
| HWP/HWPX 파싱 | 라이브러리 없음 | [kordoc](https://github.com/chrisryugj/kordoc) — 순수 JS, 한컴오피스 불필요 |
| 배포용 HWP 복호화 | — | kordoc v2.2.3 — AES-128 ECB + LCG |
| PDF 텍스트 추출 | 한글 깨짐 빈번 | kordoc — pdfjs 기반, 이중 표 감지 |
| XLSX/DOCX 파싱 | 미성숙 | kordoc — 직접 구현 |
| Gemini API | 공식 SDK 없음 | `@google/generative-ai` 공식 SDK |

---

## 기술 스택

| 계층 | 기술 |
|------|------|
| **UI** | React 19 · TypeScript 5.9 · Tailwind CSS 4 · Vite 7 |
| **데스크톱** | Tauri 2.10 (Rust) · window-state 플러그인 |
| **백엔드** | Node.js · [kordoc](https://github.com/chrisryugj/kordoc) v2.2.3 · Gemini API |
| **AI** | gemini-3-flash-preview |
| **빌드** | pnpm · tsc → Tauri NSIS 인스톨러 |

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
# → src-tauri/target/release/bundle/nsis/*.exe
```

---

## 문서 병합

| 포맷 | 방식 | 서식 보존 |
|------|------|-----------|
| **XLSX** | ZIP+XML 네이티브 스타일 병합 | 완벽 (폰트·색상·테두리·조건부서식) |
| **DOCX** | ZIP+XML 스타일+넘버링 리매핑 | 완벽 (스타일·번호매기기·미디어) |
| **PDF** | pdf-lib 페이지 복사 | 완벽 (원본 그대로) |
| **HWPX** | pyhwpx COM 자동화 → 실패 시 kordoc 마크다운 폴백 | COM: 우수 / 폴백: 텍스트만 |

> HWPX 서식 유지 수합은 한컴오피스 + Python + pyhwpx 필요. 미설치 시 자동으로 마크다운 병합으로 전환.

---

## 보안

- **RPC 화이트리스트 이중 검증** — Rust 측 + Node.js 측
- **경로 검증** — UNC 차단, 시스템 디렉토리 차단, 확장자 화이트리스트
- **API 키 마스킹** — 프론트엔드 전달 시 `AIza****` 형태로 마스킹
- **XSS 방지** — rehype-sanitize로 마크다운 렌더링 시 HTML 태그 차단
- **동시성 제한** — 세마포어(max 2) + 큐 크기 제한(max 10)
- **프로토타입 오염 방지** — `__proto__`, `constructor`, `prototype` 키 차단

---

## 테스트

```bash
cd node-sidecar && pnpm test    # vitest 45개
```

---

## 라이선스

[MIT](./LICENSE)
