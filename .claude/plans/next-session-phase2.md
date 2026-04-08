# 다음 세션 프롬프트 — Phase 2: Node.js Sidecar 뼈대 구축

## 컨텍스트
kordoc-ai 프로젝트 Phase 1 완료 (커밋 `4729950`).
edu-facility-ai → kordoc-ai 리팩토링 중. 8개 Phase 중 Phase 1(정리 & 브랜딩) 완료.

## 현재 상태
- **프론트엔드**: React 19 + Tailwind, 파이프라인 4단계 (idle→import→converting→complete)
- **Rust**: Tauri 2.10, SidecarManager가 Python sidecar를 JSON-RPC 2.0으로 관리
- **Python sidecar**: 아직 존재 (mvp1_converter, mvp3_analyzer/summarizer, shared)
- **빌드**: tsc 에러 0, Vite 성공

## Phase 2 목표
Python sidecar를 대체할 **Node.js sidecar** 기본 구조 생성.

## 상세 구현 계획

### 2.1 프로젝트 초기화
```
node-sidecar/
├── package.json          # kordoc, @google/generative-ai, exceljs, yaml
├── tsconfig.json         # strict TypeScript, ES2022, NodeNext
├── src/
│   ├── main.ts           # stdin/stdout JSON-RPC 2.0 서버
│   ├── rpc/
│   │   ├── router.ts     # 메서드 라우팅 + 화이트리스트
│   │   ├── protocol.ts   # JSON-RPC 타입 정의 (Request, Response, Notification, Error)
│   │   └── methods/
│   │       └── index.ts  # 스텁 메서드 등록 (Phase 4~5에서 구현)
│   ├── core/             # 비즈니스 로직 폴더 (빈 폴더, Phase 4에서 채움)
│   │   ├── converter/
│   │   ├── comparator/
│   │   ├── form/
│   │   ├── generator/
│   │   ├── excel/
│   │   ├── batch/
│   │   ├── merge/
│   │   ├── ocr/
│   │   ├── summary/
│   │   └── receipt/
│   ├── infra/
│   │   ├── gemini.ts     # Gemini API 클라이언트 (재시도, 타임아웃, AbortController)
│   │   ├── config.ts     # YAML 설정 로더 (settings.yaml)
│   │   ├── logger.ts     # stderr 로거
│   │   └── progress.ts   # JSON-RPC notification 발송
│   └── types/
│       └── index.ts      # 공유 타입
├── tests/                # vitest 테스트
│   ├── rpc.test.ts       # JSON-RPC 프로토콜 테스트
│   └── gemini.test.ts    # Gemini 클라이언트 테스트
└── build.config.ts       # 빌드 설정 (추후)
```

### 2.2 JSON-RPC 2.0 서버 구현 (main.ts)
핵심 구현 사항:
- `process.stdin`에서 라인 단위 읽기 (`readline` 모듈)
- 각 라인을 JSON 파싱 → `router.dispatch(method, params, id)`
- 결과를 `process.stdout.write(JSON.stringify(response) + '\n')` 로 응답
- **progress notification**: id 없는 `{"jsonrpc":"2.0","method":"progress","params":{...}}`
- **cancel**: `AbortController` 기반, 활성 작업에 signal 전달
- **graceful shutdown**: SIGTERM/SIGINT 핸들링
- **에러 코드**: -32600(Invalid Request), -32601(Method not found), -32603(Internal error)
- stdout은 JSON-RPC 전용 — 모든 로깅은 stderr로

### 2.3 RPC 메서드 17개 (스텁)
| # | 메서드 | 구현 Phase | 비고 |
|---|--------|-----------|------|
| 1 | `ping` | **Phase 2** | `"pong"` 응답 |
| 2 | `cancel` | **Phase 2** | AbortController.abort() |
| 3 | `get_settings` | **Phase 2** | YAML 읽기 |
| 4 | `update_settings` | **Phase 2** | YAML 쓰기 |
| 5 | `convert` | Phase 4 | kordoc 변환 |
| 6 | `convert_batch` | Phase 4 | 병렬 변환 |
| 7 | `diff` | Phase 4 | kordoc diff |
| 8 | `form_extract` | Phase 4 | kordoc form |
| 9 | `generate_hwpx` | Phase 4 | kordoc generator |
| 10 | `extract_tables` | Phase 4 | 표 → xlsx |
| 11 | `merge_files` | Phase 4 | 결과 병합 |
| 12 | `ocr` | Phase 5 | Gemini Vision |
| 13 | `summarize` | Phase 5 | Gemini 요약 |
| 14 | `scan_receipt` | Phase 5 | Gemini Vision |
| 15 | `open_folder` | **Phase 2** | child_process.exec |
| 16 | `open_file` | **Phase 2** | child_process.exec |
| 17 | `list_files` | **Phase 2** | fs.readdir |

Phase 2에서 실제 구현: ping, cancel, get_settings, update_settings, open_folder, open_file, list_files (7개)
나머지 10개: `{ error: { code: -32601, message: "Not implemented yet" } }` 스텁

### 2.4 Gemini API 클라이언트 (infra/gemini.ts)
- `@google/generative-ai` SDK
- 재시도: 503/429 → 지수백오프 (10초, 20초, 40초, max 5회)
- AbortController 취소 지원
- `proxyUrl` 설정 가능 (CF Workers 프록시용)
- 오프라인 모드: `mode === 'offline'`이면 호출 차단

### 2.5 설정 시스템 (infra/config.ts)
- `yaml` 패키지로 `config/settings.yaml` 로드
- 섹션별 조회: `getConfig("mvp1")`
- 원자적 쓰기: 임시파일 → rename
- LRU 캐시 (reload 지원)

### 2.6 테스트
- `vitest`로 단위 테스트
- `rpc.test.ts`: ping/pong, 잘못된 JSON, 미존재 메서드, cancel
- `gemini.test.ts`: 재시도 로직 (mock)

## 완료 기준
- [ ] `node dist/main.js` 실행 → stdin에 `{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}` 보내면 `{"jsonrpc":"2.0","id":1,"result":"pong"}` 응답
- [ ] cancel 동작 (AbortController)
- [ ] progress notification 발송 테스트
- [ ] get_settings/update_settings YAML 읽기/쓰기
- [ ] open_folder/open_file/list_files 동작
- [ ] vitest 테스트 통과
- [ ] TypeScript strict 모드 에러 0

## 참고 파일
- **전체 계획**: `.claude/plans/frolicking-wandering-allen.md`
- **현재 Python 서버 참고**: `python-sidecar/main.py` (JSON-RPC 서버 패턴)
- **현재 Rust 브릿지**: `src-tauri/src/sidecar/manager.rs` (stdout 리더, 타임아웃, notification 처리)
- **kordoc 패키지**: `npm info kordoc` (v1.7.1, HWP/HWPX/PDF 파싱)

## 다음 세션 시작 프롬프트

```
/memory-start 후 Phase 2 시작.

계획 파일: .claude/plans/frolicking-wandering-allen.md
다음 세션 상세 계획: .claude/plans/next-session-phase2.md

Phase 1 완료 (커밋 4729950): 브랜딩 전환, 레거시 코드 9,021줄 제거, 파이프라인 4단계 단순화.

Phase 2 목표: Node.js sidecar 뼈대 구축.
- node-sidecar/ 폴더에 TypeScript 프로젝트 초기화
- JSON-RPC 2.0 서버 (stdin/stdout)
- RPC 메서드 17개 (7개 실구현 + 10개 스텁)
- Gemini API 클라이언트 (재시도, 취소, 프록시)
- 설정 시스템 (YAML)
- vitest 테스트

상세 계획은 next-session-phase2.md 참고. 바로 구현 시작해줘.
```
