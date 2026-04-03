# edu-facility-ai

한국교육시설안전원 사전기획팀 AI 전환 자문 프로젝트.

## 프로젝트 개요

- **배경**: 교육시설안전원의 "사전기획 적정성 검토 업무 AI 전환" 전문가 자문
- **역할**: 12인 자문위원 중 1인 (류승인, 광진구청 주무관)
- **산출물**: 서면자문 의견서 + MVP 개선 구현체(데스크톱 앱)

## 아키텍처

```
React 19 (TypeScript + Tailwind) ─── Tauri IPC ─── Rust (Tauri 2.10)
                                                        │
                                               stdin/stdout JSON-RPC 2.0
                                                        │
                                              Python Sidecar (PyInstaller)
```

## 폴더 구조

| 폴더 | 내용 |
|------|------|
| `src/` | React 프론트엔드 (components, hooks, types, styles) |
| `src-tauri/` | Tauri/Rust 백엔드 (sidecar manager, commands) |
| `python-sidecar/` | Python 백엔드 (JSON-RPC 서버, MVP 파이프라인) |
| `python-sidecar/src/` | MVP 모듈 (shared, mvp1_converter, mvp2_extractor, mvp3_analyzer, browser_tools) |
| `python-sidecar/config/` | YAML 설정 (settings.yaml, ocr-rules.yaml) |
| `tests/` | pytest 테스트 + 더미 데이터 생성 |
| `docs/` | 원본자료, 기존MVP, 의견서, 계획, 참고자료 |
| `assets/fonts/` | Pretendard 폰트 |

## 기술 스택

- **프론트엔드**: React 19, TypeScript 5.9, Tailwind CSS 4, Vite 7
- **데스크톱**: Tauri 2.10 (Rust)
- **백엔드**: Python 3.10+ (JSON-RPC 2.0 sidecar)
- **AI**: Google Gemini (gemini-3-flash-preview, gemini-3.1-flash-lite-preview)
- **브라우저 자동화**: Playwright (7개 공공데이터 수집 도구)
- **빌드**: PyInstaller (sidecar exe) → Tauri MSI 인스톨러

## MVP 구성

| MVP | 기능 | API |
|-----|------|-----|
| MVP 1 | HWPX/HWP/PDF → 텍스트 직접추출 → OCR 폴백 → AI 태깅 | Gemini (이미지 PDF만) |
| MVP 2 | AI 태그 기반 PDF 페이지 추출 + 테마별 라벨링 | 불필요 |
| MVP 3 | 교육과정 2단계 요약 + 통합 분석 리포트 | Gemini (필수) |

## 빌드

```bash
# 프론트엔드 개발
pnpm tauri:dev

# 프로덕션 빌드 (MSI 인스톨러)
pnpm tauri:build

# Python sidecar만 빌드
cd python-sidecar && pyinstaller sidecar.spec
```

## 테스트

```bash
# 오프라인 테스트
python -m pytest tests/ -v -m "not online"

# 전체 (API 포함)
python -m pytest tests/ -v

# 레거시 호환
python tests/test_all.py --online
```

## IPC 프로토콜

- JSON-RPC 2.0 over stdin/stdout
- 18개 RPC 메서드 (whitelist 기반 보안)
- progress notification (비동기)
- ThreadPoolExecutor (max 2 workers)
- cancel 지원 (fire-and-forget)

## 주의사항

- Gemini SDK는 `google.genai`로 마이그레이션 완료
- HWP 처리는 Windows + 한컴오피스 필수 (pyhwpx COM)
- stdout은 JSON-RPC 전용 — 로깅은 반드시 stderr로

## 일정

- 서면자문 마감: 2026.03.27
- 대면자문: ~2026.04.17
- 최종 결과보고: ~2026.04.30
