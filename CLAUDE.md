# kordoc-ai

한국 문서 변환 AI 데스크톱 도구.

## 프로젝트 개요

- **목적**: HWP/HWPX/PDF/XLSX/DOCX 문서를 마크다운으로 변환하는 데스크톱 앱
- **핵심 엔진**: [kordoc](https://github.com/chrisryugj/kordoc) — 순수 JS 한국 문서 파서

## 아키텍처

```
React 19 (TypeScript + Tailwind) ─── Tauri IPC ─── Rust (Tauri 2.10)
                                                        │
                                               stdin/stdout JSON-RPC 2.0
                                                        │
                                              Node.js Sidecar (tsc 빌드)
                                                        │
                                              kordoc (로컬) + Gemini API (AI)
```

## 폴더 구조

| 폴더 | 내용 |
|------|------|
| `src/` | React 프론트엔드 (components, hooks, types, styles) |
| `src-tauri/` | Tauri/Rust 백엔드 (sidecar manager, commands) |
| `node-sidecar/` | Node.js 백엔드 (JSON-RPC 서버, kordoc 연동, Gemini API) |
| `node-sidecar/src/core/` | 핵심 비즈니스 모듈 |
| `node-sidecar/config/` | YAML 설정 (settings.yaml) |
| `assets/fonts/` | Pretendard 폰트 |

## 기술 스택

- **프론트엔드**: React 19, TypeScript 5.9, Tailwind CSS 4, Vite 7
- **데스크톱**: Tauri 2.10 (Rust)
- **백엔드**: Node.js (JSON-RPC 2.0 sidecar)
- **문서 파싱**: kordoc v4.2+ (순수 JS — HWP/HWPX/PDF/XLSX/DOCX, 배포용 HWP 복호화, 한컴오피스 불필요)
- **AI**: Google Gemini (gemini-3-flash-preview)
- **빌드**: tsc (sidecar) → Tauri MSI 인스톨러

## 핵심 기능

| 기능 | RPC 메서드 | 엔진 | API |
|------|-----------|------|-----|
| 마크다운 변환 | `convert` | kordoc parse() | 로컬 |
| 배치 변환 | `convert_batch` | convert 반복 + progress | 로컬 |
| 문서 비교 | `diff` | kordoc compare() | 로컬 |
| 양식 추출 | `form_extract` | kordoc extractFormFields() | 로컬 |
| 양식 후보 추출 | `form_extract_candidates` | kordoc extractFormFields() | 로컬 |
| 양식 배치 추출 | `form_extract_batch` | 다중 form_extract + 필드 선택 | 로컬 |
| HWPX 생성 | `generate_hwpx` | kordoc markdownToHwpx() | 로컬 |
| 표 추출 | `extract_tables` | kordoc parse → table 필터 | 로컬 |
| 파일 병합 | `merge_files` | 다중 parse + 병합 | 로컬 |
| PDF 분리 | `split_pdf` | pdf-lib | 로컬 |
| PDF 페이지 추출 | `pdf_extract_pages` | pdf-lib | 로컬 |
| PDF 페이지 수 | `pdf_page_count` | pdfjs-dist | 로컬 |
| 문서 정합성 검사 | `inspect_document` | kordoc parse + 규칙 검사 | 로컬 |
| AI OCR | `ocr` | Gemini Vision (PDF 직접 전송) | API |
| AI 요약 | `summarize` | Gemini text | API |
| MCP 환경 감지 | `detect_mcp_env` | process/fs | 로컬 |
| MCP 설정 설치 | `install_mcp_config` | fs writeFile | 로컬 |
| Node.js 설치 | `install_node` | spawn winget/browser | 로컬 |
| 유틸리티 | `ping`, `get_settings`, `update_settings` | — | 로컬 |
| 파일 관리 | `open_folder`, `open_file`, `list_files` | explorer/fs | 로컬 |

## kordoc 버전 핀

**정본은 레포 루트 `.kordoc-version` 파일 하나.** CI·릴리스 워크플로가 이 값을 읽어
`node-sidecar/package.json` 의 `link:../../kordoc` 를 `^<버전>` 으로 치환한다.

- 로컬 개발은 `link:` 그대로 — 형제 체크아웃(`../kordoc`)을 자동으로 쓴다
- **kordoc 을 올릴 땐 `.kordoc-version` 만 고친다.** 워크플로에 버전을 직접 쓰지 말 것
- CI 가 매 실행마다 핀과 npm 최신을 대조해 뒤처지면 경고 어노테이션을 남긴다

> v1.5.0 이전엔 이 값이 세 군데(로컬 link·`ci.yml` `^3.1.1`·`release.yml` `^2.2.1`)로
> 흩어져 있어서, **CI 는 3.x 로 통과 도장을 찍고 배포본엔 2.x 가 실려 나갔다.**
> kordoc 메이저 두 번(4.0 공문서 생산로직, 4.2 내장 OCR)이 앱에 반영되지 않았다.

## 빌드

```bash
# 프론트엔드 개발
pnpm tauri:dev

# Node.js sidecar 빌드
cd node-sidecar && pnpm build

# 프로덕션 빌드 (MSI 인스톨러)
pnpm tauri:build
```

## 테스트

```bash
# Node.js sidecar 테스트
cd node-sidecar && pnpm test

# 전체 (vitest 45개)
cd node-sidecar && npx vitest run
```

## IPC 프로토콜

- JSON-RPC 2.0 over stdin/stdout
- 24개 RPC 메서드 (whitelist 기반 보안)
- progress notification (비동기)
- Semaphore 동시성 제한 (max 2)
- cancel 지원 (fire-and-forget)

## UI 기능

- 폴더 드래그드롭 — 폴더 드래그 시 지원 파일 자동 스캔, 클립보드 붙여넣기 지원
- 출력 폴더 선택 — 전역/작업별 출력 디렉토리 커스터마이징
- MCP 원클릭 설치 — Claude Desktop, Cursor, VS Code, Zed 등에 kordoc MCP 자동 등록
- 접힘 사이드바 — 토글 버튼으로 사이드바 축소/확대

## 마크다운 렌더링

- ReactMarkdown + remark-gfm + rehype-raw + rehype-sanitize
- HTML 테이블 렌더링 지원 (colspan, rowspan, br 등 — kordoc의 복잡한 표 출력 대응)
- sanitize 스키마: table/thead/tbody/tr/th/td/caption/col/colgroup/br + colspan/rowspan 속성 허용

## 주의사항

- kordoc이 HWP/HWPX/PDF를 순수 JS로 파싱 — **한컴오피스 불필요**
- stdout은 JSON-RPC 전용 — 로깅은 반드시 stderr로
- Gemini 기본 모델: `gemini-3-flash-preview` (3.x가 최신)

