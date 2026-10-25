# kordoc-ai

한글 문서 작성·편집·검토·변환 데스크톱 앱 (v2). Windows·macOS, 폐쇄망 동작.
계획·결정 정본: `.claude/plans/v2-refactor.md`

## 0. 최우선 규칙: 독자 구현

다른 모든 지침보다 앞섬 (2026-10-25 확정).

1. 경쟁 제품(다른 한글 문서 편집기·오피스 앱) 저장소의 코드·패치·시험·문구·빌드 결과를 옮기지 않음. 라이선스가 허락해도 금지.
2. 경쟁 제품은 기능 비교(무엇이 있나)까지만 봄. 구현을 보고 따라 짜지 않음. 구현 근거는 공개 명세(한컴 공식 도움말·HWP 공개 문서), rhwp 원본(MIT), kordoc 뿐.
3. 엔진은 kordoc + npm rhwp 원본. rhwp 결함은 rhwp 에 PR 로 고침. 남의 패치 묶음을 들고 있지 않음.
4. 예전에 옮겨 온 코드(NOTICE 에 적힌 것)는 우리 코드로 차례로 다시 짜고, 다 바꾸면 NOTICE 에서 뺌.
5. 커밋 메시지·README·화면 문구에 경쟁 제품 이름 금지. 우리 프로젝트 이야기만 짧게.

## 구조

```
src/            React 19 + TS + Tailwind 4 (화면)
src-tauri/      Tauri 2 (Rust): 사이드카 관리(다중 호출), 우클릭 메뉴, 트레이, kordoc:// 주소
node-sidecar/   Node 문서 엔진 (JSON-RPC over stdin/stdout)
  src/infra/      설정(config)·폐쇄망 관문(net-guard)·진행률(progress)·효과 집계(usage)·AI 공급자(llm/)
  src/core/       기능 모듈 (kordoc 호출)
  src/rpc/methods 영역별 등록: system·documents·ai·editor·insight
  editor-host/    내장 한글 편집기 중계 페이지 (소스)
  editor/         ← build-rhwp-studio.mjs 산출물 (gitignore)
  models/         ← 내장 OCR 모델 (gitignore)
  samples/        예제 문서 (가상의 가온시, 커밋)
shell/windows/  MSIX 우클릭 메뉴 패키지 (선택, Win11 상단 메뉴용. 기본은 앱의 HKCU 등록)
scripts/        빌드: fetch-node · build-sidecar · build-rhwp-studio · sync-rpc-whitelist
```

## 정본 (어긋나면 CI 가 잡는다)

| 사실 | 정본 | 따라가는 곳 |
| --- | --- | --- |
| RPC 메서드·모양 | `node-sidecar/src/types/rpc-contract.ts` | 프론트 `import type`, Rust 허용 목록(`node scripts/sync-rpc-whitelist.mjs` 로 생성, CI `--check`) |
| 편집기 프로토콜 | `node-sidecar/src/types/editor-bridge.ts` | `editor-host/host.js`, `src/lib/hwp-editor.ts` |
| kordoc 버전 | `node-sidecar/package.json` 정확 버전 | lockfile |
| rhwp 버전 | `scripts/build-rhwp-studio.mjs` 의 `RHWP_VERSION` | studio·@rhwp/core·@rhwp/editor 같은 버전 |
| 동봉 Node 버전 | `scripts/fetch-node.mjs` 의 `NODE_VERSION` | |

## 빌드·검증

```bash
node scripts/fetch-node.mjs && node scripts/build-sidecar.mjs && node scripts/build-rhwp-studio.mjs
node node-sidecar/scripts/smoke-bundle.mjs     # 설치본 조건: node_modules 없는 임시 폴더 + 동봉 Node 로 셀프테스트
cd node-sidecar && node node_modules/vitest/vitest.mjs run
pnpm exec tsc --noEmit && pnpm exec vite build
cd src-tauri && cargo test --lib
```

## 함정 (실측)

- **설치본엔 레포 node_modules 가 없다.** 순수 JS 는 `dist/bundle.mjs`(ESM), 네이티브·WASM·kordoc 은 `scripts/stage-natives.mjs` 가 전이 의존까지 `dist/node_modules` 에 깐다. 새 네이티브 패키지를 직접 import 하면 `scripts/externals.mjs` 에 추가. 스모크가 못 통과하면 릴리스 금지 (v1.5.0 은 ping 만 보고 기능이 죽은 번들을 배포했다).
- kordoc 은 번들에 녹이지 않고 패키지째 싣는다. 공개 API 에 없는 서식 보존 마스킹·폴더 감시는 kordoc CLI(`process.execPath` + kordoc/dist/cli.js), MCP 연결은 동봉 Node + kordoc/dist/mcp.js.
- 수식 OCR(@huggingface/transformers) 은 onnxruntime-web 140MB 를 끌고 와서 설치본에서 뺐다.
- **rhwp SDK 는 호스트·studioUrl 모두 HTTP(S) 출처만** → 사이드카가 127.0.0.1 임시 포트로 편집기를 서빙(`editor_server`), 앱 창은 중계 페이지를 iframe 으로. CSP `frame-src http://127.0.0.1:*`.
- **편집기 AI(편집 보조 'AI 대화')** 는 스튜디오 공개 플러그인 계약(PluginHost: read·transaction) 위의 우리 플러그인 'kordoc-ai'(`node-sidecar/studio-plugin/kordoc-ai-plugin.mjs`). 문서 연산은 `kordoc-ai-ops.mjs`(rhwp 공개 WASM API 만, Node 시험이 실제 엔진으로 돈다), 고치기 하나 = 트랜잭션 하나 = 실행 취소 한 단계, 거절은 `{ error }`. 빌드는 허용 목록에 이름 하나만 넣는다(`scripts/rhwp-patches.mjs`). 도구 정의·지시문·문맥은 `src/lib/hwp-agent/tools.ts`, 모델 한 차례는 `ai_agent_step`(답 JSON `{say, calls}`, `core/ai/agent-step.ts`), 루프는 `loop.ts`. 자리 표기: 문단 "구역.문단", 표 "구역.문단.번호".
- **한컴 단축키** 는 `node-sidecar/editor-host/hangul-keys.js` (근거: 한컴 공식 도움말 "단축키 일람"). 스튜디오 소스를 고치지 않고, 중계 페이지가 편집기 창 키를 capture 로 먼저 받아 스튜디오 공개 자동화(`window.rhwpStudio.automation`)의 명령으로 넘긴다. 스튜디오에 없는 것(한 줄 지우기·날짜·글자색·보통 모양·스타일 번호)은 같은 자동화에 `ext:kordoc-*` 로 등록. Ctrl+Y 는 한 줄 지우기, 다시 실행은 Ctrl+Shift+Z. hwpctrl 동작(Run)은 자기 커서를 따로 들고 있어 키에 쓰지 않는다.
- **복구 사본**: 한글 편집기에서 저장 안 한 문서는 30초마다(입력이 2초 멈췄을 때만) 내보내 앱 데이터 `recovery/` 에 둔다(`core/recovery`, `session.tsx`). 저장·버리기 때만 지우고, 이 실행에서 쓴 것은 홈 "저장하지 않고 꺼진 문서" 에 안 보인다. 되살리기는 `editor_open recover` (바이트는 사본, 저장 보정 정보는 원본에서).
- **구독 계정(Claude Code·Codex)**: 근거는 두 프로그램의 공식 CLI 뿐(`infra/llm/claude-code.ts`·`codex.ts`·`subscription/{program,login,errors}.ts`). PC 에 깐 프로그램을 셸 없이·고정 인자로 띄우고(JS 입구는 동봉 Node, Windows npm `.cmd` 껍데기는 그 뒤 파일), 자식 환경은 허용 목록만, 글은 stdin·작업 폴더 파일로만(명령줄 금지). Claude: `-p` stream-json, `--tools ""`·`--strict-mcp-config`·`--setting-sources ""`·`--restricted`·`--permission-mode dontAsk`, 지시문은 `--system-prompt-file`, init 보고의 도구·MCP 가 0개가 아니거나 `apiKeySource` 가 none 이 아니면 답 전에 끝냄(`--json-schema` 금지: 도구가 하나 생김), 모델 목록은 공식 별칭. Codex: `exec --json --ignore-user-config`(사용자 MCP·알림 프로그램 안 읽음)·read-only·approval never, 도구 기능을 `--disable` 로 끄고 `features list` 로 확인(못 끄면 안 보냄, 실측: read-only 샌드박스는 셸 명령을 막지 않고 `unified_exec` 은 꺼지지 않아 `shell_tool` 로 봄), 실행 중 글·생각 밖 항목이 보이면 끝냄, 모델 목록은 `debug models`. 로그인은 `claude auth status --json`·`codex login status` 의 답만(계정 정보 안 옮김). 시험은 `tests/fixtures/fake-{claude,codex}.mjs` 로만(실제 프로그램은 구독 사용량). `ai.allow_subscription` 기본 false(허용 전엔 상태 확인도 프로그램을 띄우지 않음)·폐쇄망 차단·자동 마스킹·`assertProgramEgress` 로 통신 기록. 프로그램 위치(`cli_path`)는 기관 배포 설정으로만.
- **HWP 저장 보정(editor_open·editor_write, `core/hwp-save`)**: 근거는 HWP 5.0 공개 문서 + 한컴 HWP 1,641개 실측(`scripts/hwp-save-audit.mjs`). 열 때 원본 바이트를 표(token)로 간직했다가, rhwp 0.8.7 저장본에서 빠진 구역 끝 묶음(바탕쪽·메모 목록, 일부만 빠져도)을 원본에서 채우고, 메모 필드 글자 ID('%%me')와 새 탭 폭(저장본을 엔진으로 열어 커서 자리로 잼)을 되돌린다. 처음 덮어쓸 때 `.bak`. 표가 없어진(엔진 재시작) HWP 저장은 거절. 변경 추적 문서(0x4000)는 rhwp 가 ViewText(검토 기록이 섞인 화면용 본문)를 읽으므로 보정하지 않고 알리기만. cfb 라이브러리는 FAT 남는 칸을 ENDOFCHAIN 으로 채워 다시 저장 때 요약 정보·미리보기가 빠진다 → `freeUnusedSectors` 로 FREESECT. 남은 손실은 gso CTRL_DATA(rhwp 이슈 #8225). 저장은 `write_file` 말고 `editor_write` 로.
- 편집기 안 문단 바꿔 넣기는 스튜디오 문서 에이전트 계약(applyTextCommand). 해시는 현재 문서를 HWPX 로 내보내 중계 페이지의 별도 rhwp WASM 으로 다시 읽어 계산한다. 글자 모양이 섞인 문단·개체·누름틀 문단은 계약이 거부 → 그 문단을 선택해 두고 붙여 넣기 안내. HwpCtrl 선택 블록은 화면 선택과 따로 논다(쓰지 말 것).
- **API 키 암호화(Windows)**: Rust `secrets.rs` 가 자격 증명 관리자에 앱 전용 키를 두고 `KORDOC_SECRET_KEY` 로 넘기면 엔진이 settings.json 의 `ai.*.api_key` 를 `enc:v1:`(AES-256-GCM)로 쓴다(`infra/secret-box.ts`). macOS·중계기·시험은 키가 없어 평문(0600). 키가 바뀌어 못 푼 암호문은 빈 칸으로 쓰되 파일에서 지우지 않는다.
- 비워 둔 누름틀의 안내 글자는 rhwp 인쇄·PDF 에 찍힌다 → 출력 전에 공백으로 채운다.
- kordoc 렌더(renderDocument)는 칸 안 줄바꿈(hp:lineBreak)을 아직 무시한다. 누름틀로 채운 여러 줄 본문 PDF 는 rhwp 로.
- 사이드카 stdout 은 JSON-RPC 전용, 로그는 stderr. Rust 는 응답 id 로 oneshot 을 갈라 받는다(v1 은 전 호출 직렬화로 AI 하나에 미리보기까지 막혔다).
- Windows NSIS 는 사용자 단위 설치(관리자 불필요). WebView2 백그라운드 통신·SmartScreen 은 창 설정에서 끈다(`tauri.windows.conf.json`). WebView2 는 `offlineInstaller` 로 설치 파일에 넣는다(기본 내려받기 방식은 폐쇄망에서 설치가 막힌다).
- **Node 가 없는 PC 조건.** 설치본은 동봉 Node 만 쓴다(`locate_node` 의 시스템 Node 탐색은 개발 빌드 전용). 스모크는 PATH 에서 node·npm·npx 폴더와 `NODE_OPTIONS` 를 빼고 돌린다. 엔진 안에서 Node 를 부를 땐 `process.execPath`(kordoc CLI·MCP).
- **Windows VC++ 런타임.** onnxruntime·node-llama-cpp 의 .node·.dll 은 MSVCP140·VCRUNTIME140 을 불러오는데, Node 는 모듈을 `LOAD_WITH_ALTERED_SEARCH_PATH`(모듈 폴더 먼저)로 불러서 node.exe 옆 DLL 은 안 잡힌다 → `stage-natives.mjs` 가 PE 가져오기 표를 읽어 필요한 모듈 폴더마다 VS 재배포 CRT 를 복사(CI 에서 못 찾으면 실패). node-llama-cpp CUDA 판(519MB)·onnxruntime DirectML(38MB, kordoc 은 CPU EP 만)은 뺀다.
- 셸 훅: `npm`/`npx` 를 직접 치면 pnpm 으로 바뀌어 node_modules 가 깨진다 → `/opt/homebrew/bin/npm`, 도구는 `node node_modules/...` 직접.

## 문구 규칙

사용자에게 보이는 한국어에 줄표(—·–) 금지(`:`·`·`·괄호). 오류 문장은 무엇을 하면 되는지까지. 숫자는 지어내지 않는다. 효과 집계의 기준 시간은 가정치로 밝히고 설정에서 바꾸게 한다.
