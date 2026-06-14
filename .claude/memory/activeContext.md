# KorDoc Suite — Active Context

> 이 파일은 세션 시작 시 자동 로드됨. 다음 세션 컨텍스트 인계용.

---

## 📌 최신: rhwp-studio 편집기 임베드 진행 중 — **NEXT-SESSION.md 참조** (2026-06-14 밤)

- 편집기를 **rhwp studio(공식 WYSIWYG 에디터) iframe 임베드**로 대전환. kordoc-ai 안에서 studio가
  문서 로드·렌더까지 성공(12페이지). 파란 세로바·단독앱 팝업 제거 완료.
- **미해결**: 글머리(□,◦) 찌그러짐(폰트), same-origin CSP 충돌(저장/연계 선결), 양방향 통신 미완.
- 전부 미커밋. 상세 핸드오프 = `.claude/memory/NEXT-SESSION.md` (7섹션 + 시작 프롬프트).
- ⚠️ 이 아래 "프로덕션 리뷰" 섹션의 수정(보안/UX)도 **미커밋 상태로 남아있음**.

---

## Phase R 워크벤치 통합·gap 수정 완료 — 프로덕션 리뷰 (2026-06-14)

- **검증 세션 수행**: gap-detector로 플랜 vs 구현 대조(초기 Match Rate ~62%) → 의심
  지점 8건 전부 처리. 사용자 결정(최대 범위): 채우기 워크벤치 완전 흡수 / hwpx 열기
  시 워크벤치 진입 / 편집 세션 바이트 근본 연결.
- **수정 내역**:
  - 항목1: `DocEditor` 데드코드 제거 (Workspace docEditorOpen 분기)
  - 항목2+3: `form_fill`·`doc_edit` 모두 워크벤치 진입(initialTab fill/edit), hwpx
    파일 **더블클릭 진입**, 구 `FillWizard`/`DocEditor` 모달 **파일 삭제**(edit/·fill/ 디렉토리)
  - 항목4: 사이드카 `convert`/`extract_tables`에 `doc_b64`(+`source_name`) 옵션 →
    `ConvertPanel`이 `getDocB64`로 **편집 세션 현재 바이트 변환**(클릭편집·채움 반영)
  - 항목5: 채우기 `dry_run`→`reopenSession` **일원화**("미리보기"→"문서에 적용",
    setPreviewDoc 제거) → 미리보기·편집 blocks·변환 한 바이트 공유
  - 항목6: `annotateLabels` 배선(죽은 유틸) → 채우기 필드 focus→미리보기 라벨 강조+스크롤
  - 항목8: AI 추론 성공 → 채우기 탭 자동 전환(onApplied)
  - 구조: `tab`/`fillForm`/`focusedLabel`을 `WorkbenchShell`로 lift(항목6·8 토대)
- **빌드 그린**: 프론트 tsc / vite 1928 modules / 사이드카 tsc / vitest **64 passed** / esbuild 번들.
- **미커밋 상태**. 사이드카 소스 수정함 → 본 세션 재빌드 필요(`pnpm build && pnpm build:bundle`).

### 다음 세션 = 프로덕션 리뷰
진입점: `.claude/memory/NEXT-SESSION.md` (리뷰 관점 4종 + 실동작 체크리스트).
- 코드 품질(useFillForm 셸 호출 비용, annotateLabels 2중 적용), 보안(convert doc_b64
  크기 가드 부재 — edit/fill은 30MB 가드 있음), 개편 일관성(액션카드 2개 유지 검토),
  실동작(tauri:dev 6항목). 리뷰 후 커밋·배포.

### ⚠️ 보류/한계 (리뷰가 판단)
- 항목7(다중파일 전환 시 폼 값 손실): key 재마운트는 세션 정합성 위한 의도 — 플랜 필수 아님, 보류.
- 항목5 트레이드오프: 채움을 `reopenSession`(새 세션)으로 수렴 → 채움 직전으로 undo 불가(토스트 안내).

---

## Phase R(문서 워크벤치) 구현 완료 — 검증 완료(gap 8건 수정됨) (2026-06-14 이른 시각)

- **W1~W4 한 세션에 구현**: `doc_edit` → 3-pane 문서 워크벤치. **빌드 검증만 그린**
  (프론트 tsc/vite 1930 modules, 사이드카 tsc/vitest 64 passed, cargo check, esbuild 번들).
  **실동작·UX·개편 일관성은 미검증**.
- **신규 파일**: `src/contexts/DocumentSession.tsx`(세션 edit_* + 미리보기 rhwp 단일 소스,
  setPreviewDoc/reopenSession), `src/components/workbench/` 8개(DocumentWorkbench/PreviewPanel/
  ToolTabs/FileRail/FillPanel/ConvertPanel/AiPanel/useFillForm). 사이드카 신규 RPC `form_infer`
  (methods/index.ts + router HEAVY + Rust 화이트리스트 동기화 — aiExtractFields 재사용).
- **변경**: Workspace `doc_edit`→워크벤치 라우팅(기존 DocEditor 모달 **보존=죽은 분기**),
  `doc_edit` maxFiles 0(다중 hwpx)·"문서 작업대"로 개명.
- **디자인**: Figma 3-pane 공간 + Linear 정제미(기존 var(--color-*)/ts-* 토큰 유지).
  frontend-design 스킬 대신 상용앱 패턴 차용(사용자 피드백 — 도구앱엔 대담함보다 신뢰감).

### ⚠️ 다음 세션이 검증할 의심 지점 (구현자가 인지한 gap)
- **개편 미완**: ①`form_fill` 액션은 아직 구 FillWizard 풀스크린 모달 → 워크벤치 채우기 탭과
  기능 중복(채우기 경로 2개) ②DocEditor 모달 죽은 분기 잔존 ③워크벤치 진입점이 `doc_edit`
  단일 — 플랜의 "문서 열기 시 워크벤치 진입" 일반화 안 됨.
- **UI/UX 미연계**: ①변환 탭(ConvertPanel)이 원본 file.path 기준 → 클릭-편집 결과 미반영
  ②채우기 dry_run 미리보기는 setPreviewDoc로 미리보기만 교체 → 편집 탭 blocks와 불일치
  ③채우기 탭에 필드 포커스→미리보기 라벨 하이라이트/역점프 없음(annotateLabels 미연동,
  PreviewPanel은 annotateBlocks만) ④다중파일 전환 시 Provider key 재마운트로 폼 값 초기화
  ⑤AI applySuggestions 후 채우기 탭 자동전환 없음.
- **실호출 미검증(tauri:dev 육안 필요)**: form_infer Gemini(API 키), 채우기 저장→reopenSession
  수렴, rhwp WASM 웹뷰 SVG 렌더, 저장 폴더 열기.

### 다음 세션 시작 프롬프트
```
KorDoc Studio Phase R 검증 세션 — 구현 완료도 + UI/UX 연계 + 개편 일관성 점검.

직전 세션에서 Phase R(문서 워크벤치) W1~W4를 한 번에 구현했고 빌드 검증만 끝난
상태야(tsc/vite/사이드카 vitest 64 passed/cargo check 전부 그린). 단 실동작·UX·
개편 일관성은 미검증. 이 세션의 임무는 "코드가 플랜대로이고 UI/UX가 실제로 연결돼
있으며 KorDoc Studio로 제대로 개편됐는가"를 검증하고, 발견한 gap을 수정하는 것.

■ 먼저 Read로 실제 코드를 읽고 아래 주장을 코드와 대조 검증해 (추측 금지):
  - .claude/memory/studio-redesign-plan.md             ← 플랜(단일 진실 소스)
  - src/contexts/DocumentSession.tsx                    ← 세션+미리보기 단일 소스
  - src/components/workbench/ 전체 8개
    (DocumentWorkbench, PreviewPanel, ToolTabs, FileRail,
     FillPanel, ConvertPanel, AiPanel, useFillForm)
  - src/components/pipeline/Workspace.tsx               ← doc_edit 라우팅
  - node-sidecar/src/rpc/methods/index.ts (form_infer), rpc/router.ts
  - src-tauri/src/commands/sidecar_cmd.rs               ← form_infer 화이트리스트

■ KorDoc Studio 개편 완료도 — 반드시 확인할 의심 지점:
  1. doc_edit는 워크벤치로 진입하지만 기존 DocEditor 모달(docEditorOpen)이 죽은
     분기로 잔존한다(보존 지시였음). 개편 관점에서 정리할지/언제 제거할지 판단.
  2. form_fill 액션은 아직 구 FillWizard 풀스크린 모달을 쓴다 → 워크벤치 "채우기
     탭"과 기능 중복. 사용자에게 채우기 경로가 둘. 개편 미완 — form_fill도
     워크벤치로 흡수할지 결정 필요(플랜 의도는 단일 작업대).
  3. 워크벤치 진입점이 doc_edit 카드 하나뿐. 플랜의 "문서 열기 시 워크벤치 진입"
     일반화가 안 됐다. 액션카드 홈과 워크벤치의 관계가 정리됐는지.

■ UI/UX 미연계 의심 지점 — 실제로 끊겼는지 확인:
  4. 변환 탭(ConvertPanel)이 원본 file.path 기준 → 클릭-편집 결과 미반영(dirty
     안내만 있음). 편집→변환 흐름이 끊김. 편집 세션 바이트를 변환에 넘길 방법 검토.
  5. 채우기 dry_run "미리보기 반영"은 setPreviewDoc로 미리보기만 바꾼다 → 편집 탭
     blocks/캡션은 원본 세션 그대로라 불일치. 사용자가 미리보기↔편집 탭 오가면 어긋남.
  6. 채우기 탭에 "필드 포커스→미리보기 라벨 하이라이트/역점프"가 없다(구 FillWizard
     엔 있던 핵심 UX). PreviewPanel은 annotateBlocks(편집)만 쓰고 annotateLabels
     (채우기)는 미연동. 라벨 어노테이션을 탭에 따라 전환할지 검토.
  7. 다중 파일 전환 시 Provider가 key로 재마운트되어 ToolTabs/useFillForm도 초기화
     → 채우던 폼 값 손실. 의도인지(파일별 폼) 사용자 흐름상 문제인지 판단.
  8. AI 추론(applySuggestions) 후 채우기 탭으로 자동 전환이 없다 → 사용자가 수동
     이동해야 제안을 봄. 탭 자동 전환/배지 필요한지.

■ 실동작 검증(헤드리스 불가 — pnpm tauri:dev 필요):
  9. form_infer Gemini 실호출(API 키 필요) — RPC 등록·화이트리스트는 코드 확인됨,
     실응답 파싱은 미검증.
  10. 채우기 저장 → reopenSession이 실제로 편집 세션에 수렴해 이어서 클릭-편집 되는지.
  11. rhwp WASM 미리보기가 Tauri WebView에서 실제 SVG를 그리는지(3-pane 진입).
  12. 저장 후 "저장 위치 열기" 등 경로 동작.

■ 진행 방식:
  - 먼저 코드 대조로 1~8을 PASS/GAP 판정(gap-detector 에이전트 활용 가능 —
    플랜 vs 구현 Match Rate). 그다음 사용자가 tauri:dev 띄워 9~12 육안.
  - 명확한 버그/끊긴 연계는 질문 없이 수정 후 보고. 개편 방향 결정(2,3번 같은
    제품 판단)은 선택지 제시하고 확인.
  - 사이드카는 link:../../kordoc 로컬 dist 사용 — kordoc 소스 안 건드리면 재빌드
    불필요. 프론트만 고쳤으면 vite로 충분.
  - 검증/수정 끝나면 그때 커밋·배포(사용자가 "모든 작업 끝나고" 지시).

산출: 검증 리포트(각 항목 PASS/GAP + 근거 파일:라인) + 발견 gap 수정.
```

---

## 머지 스택 + npm publish 완료 (2026-06-13 저녁)

- **머지 스택 3개 완료**: kordoc #35(들여쓰기 픽스) → kordoc-ai #1(Phase B) → kordoc-ai #3(Phase C) 전부 main 머지. ⚠️ 구 PR #2는 #1 머지 시 base 브랜치 삭제로 GitHub이 자동 닫음(reopen 거부) → 동일 head 브랜치로 **#3 재생성**해 해결
- **kordoc 3.1.1 npm publish 완료** (3.0.1 → 3.1.1, 3.1.0은 미배포였고 기능 전부 3.1.1에 포함). git 태그 `v3.1.1` + GitHub release 생성. 토큰은 `sm`(ssh)으로 원격 `~/.npmrc`에서 가져옴
- **사이드카 CI 근본 수정** (`1ce1ce5`): CI가 kordoc 빈 스텁을 깔아 실함수 호출 E2E(fill-e2e/edit-session)가 전부 `is not a function`으로 죽던 것 → `link:../../kordoc`를 npm `^3.1.1`로 치환 설치. 이제 CI 3개 그린, 진짜 통합 검증
- kordoc-ai main 최신 = `cd82c54` (Phase B+C 통합). 미검증 잔여: 들여쓰기 픽스 앱 육안 재확인(사용자 몫)

## Phase C 검증 + 들여쓰기 버그픽스 + Studio 개편 플랜 (2026-06-13 오후)

- **앱 실사용 검증**: tauri:dev에서 DocEditor 클릭-편집 동작 확인 (사용자). 편집된 문단의 **들여쓰기 소실 버그 발견** → kordoc 코어 수정
- **kordoc PR #35** (`fix/patch-indent-preserve`): `buildParagraphSplices`가 통째 교체 시 원본 선행/후행 공백(들여쓰기·전각공백)을 버리던 것 복원. session/patchHwpx/fillHwpx/표셀 공통 경로 — 동등성 유지. kordoc 517/517 + 회귀 테스트 추가
- **Studio UI 개편 플랜 신규 작성**: `.claude/memory/studio-redesign-plan.md` (**git 추적** — 회사 PC 로컬에 갇혔던 구 플랜 대체). 핵심: 3-pane 문서 워크벤치 + DocumentSession 컨텍스트 + 도구 탭(채우기/편집/AI/변환), W1~W4
- **머지 대기 스택 (순서대로)**: kordoc #35 → kordoc-ai #1 (Phase B) → kordoc-ai #2 (Phase C, base가 #1 브랜치라 자동 리타겟). 이후 `npm login` + kordoc 3.1.1 publish (3.1.0 publish도 아직 보류 상태였음 — 픽스 포함해 3.1.1로 올리는 게 깔끔)
- 미검증 잔여: 들여쓰기 픽스 후 앱 재시작했으나 사용자 육안 재확인 전. 한/글에서 저장본 열어보기, 실양식 3종째도 그대로 남음

## KorDoc Studio Phase C 클릭-편집 구현 완료 (2026-06-13)

- 브랜치 `feat/doc-editor-phase-c` (Phase B 브랜치에서 분기 — PR #1 머지 후 자동 리타겟)
- 사이드카 RPC 6종: `edit_open`(HEAVY)/`edit_patch`/`edit_undo`/`edit_redo`/`edit_save`/`edit_close` — `node-sidecar/src/core/edit/`, kordoc v3.1 `HwpxSession` 상태 유지(세션 4개 상한 LRU, undo 깊이 50, 바이트 스냅샷)
- DocEditor (`src/components/edit/DocEditor.tsx`): 미리보기 클릭→문단/셀 인라인 편집 팝오버, capability 잠금 시각화(잠금=흐림+사유 토스트, 편집가능=점선 밑줄 토글), Ctrl+Z/Y undo/redo, 30초 자동저장(`{stem}_편집.hwpx`), 닫기 시 미저장분 자동 저장
- `svg-annotate.ts`에 `annotateBlocks` 추가 — 여러 줄 문단 허용(같은 줄 x증가 또는 다음 줄), 긴 텍스트 우선 매칭, data-kd-block/-cell/-locked
- Workspace 액션 `doc_edit` (hwpx 1개) + Rust 화이트리스트 동기화
- 검증: vitest **64/64** (edit-session 8개 신규, 실문서 포함), tsc 프론트/사이드카 0, vite/cargo/esbuild 번들 그린, 프로덕션 번들 stdin RPC 스모크(edit 6종 왕복) 통과
- 함정: kordoc dist stale이면 `HwpxSession` 미노출 → `cd kordoc && npm run build` 필수 (이 PC에서 재현됨). 실문서 PUA 글리프(`󰏅`) 문단은 capability=text라도 패처가 "공백 정규화 불안정"으로 graceful-skip — 정상 동작
- v1 제약: 텍스트 있는 문단/셀만 클릭 가능(빈 셀 채우기는 FillWizard), 페이지 경계 걸친 문단은 매칭 실패로 클릭 불가 가능

---

## KorDoc Studio Phase B 구현 완료 (2026-06-12)

- 브랜치 `feat/fill-wizard-phase-b`, **PR #1 머지 대기**
- RPC 4종: form_schema / form_fill / patch_blocks (HEAVY) + render_preview (HEAVY 제외) — `node-sidecar/src/core/{fill,preview}/`, Rust 화이트리스트 동기화
- @rhwp/core@0.7.15 듀얼 임베드: 프론트 Vite wasm 번들 (`src/lib/rhwp.ts`, CSP `wasm-unsafe-eval` 추가) + 사이드카 Node WASM 폴백 (esbuild external + dist/node_modules 복사 — MSI 동봉)
- FillWizard (`src/components/fill/FillWizard.tsx`): 좌 자동 폼 / 우 rhwp SVG, 필드↔미리보기 하이라이트+역점프(`src/lib/svg-annotate.ts`), 출처 배지(명부 xlsx), dry_run 미리보기, 재파싱 검증 배지
- 검증: vitest fill-e2e **9/9** (실양식 2종), 프로덕션 번들 stdin RPC 실구동, tsc/vite/cargo 그린
- 주의: pnpm 전역 minimum-release-age(7일) → `.npmrc`에 @rhwp/core 예외 추가됨. concat.test.ts 실패 1건은 기존 픽스처 부재(무관)
- 수동 확인 필요: tauri:dev 웹뷰 WASM 초기화, 한/글 육안 검증, 실양식 3종째
- 코어: kordoc v3.1.0 머지+태그 완료 (npm publish만 토큰 만료 보류 — `npm login` 필요)

---

## 📌 현재 상태 (2026-04-29 21:55, 집 PC)

### Phase 1 완료 ✅ (kordoc v2.7.0)
- `feat/xls-and-print` 브랜치, 마지막 커밋 `ede40d6` (집 PC에서 package-lock 동기화 추가)
- v2.7.0 release 본커밋: `f41da76`
- XLS (BIFF8) 파서 + Print Renderer (`markdownToPdf`/`PrintPreset` 노출)
- 318 tests pass
- **publish 미진행** — kordoc-ai sidecar 가 `link:../../kordoc` 로 v2.7.0 dist 직접 사용 중. 통합 검증 끝난 다음에 publish.

### Phase 2 W1 완료 ✅ (kordoc-shell v0.1)
- `c:/github_project/kordoc-shell`, 커밋 `41d4f34` (변경 없음)
- AppxManifest, Microsoft.Registry.xml, Rust 런처, build/sign/install-dev 스크립트

### Phase 2 W2 **완료** ✅ (kordoc-ai)
- main 브랜치, 커밋 `20dd679` (W2 D1-D4) + `f32cb1f` (W2 D5)
- 모두 origin/main 푸시 완료

**구현 내용:**
- W2 D1-2: Tauri deep-link + single-instance 플러그인, `lib.rs` 핸들러, `useDeepLink` 훅, `App.tsx` 라우팅
- W2 D3-4: `node-sidecar/src/core/print/index.ts` (print_files + list_printers), `read_batch_manifest` RPC, vitest 7건
- W2 D5: System tray (Show/Hide/Quit + 좌클릭 토글), 윈도우 X → hide, `tauri-plugin-notification` 으로 Win11 native toast (창 비포커스 시만)

**검증 통과:**
- TypeScript 0 error
- cargo check 0 error
- Vitest 53 pass / 1 skip

---

## 🎯 다음 세션 — Phase 2 통합 검증 (사람 손 필요)

코드 작업은 모두 끝났음. 다음 세션은 **실제 탐색기에서 동작 확인**.

### 1. kordoc-shell MSIX 설치 + 우클릭 메뉴 확인
```powershell
# 관리자 PowerShell
cd c:\github_project\kordoc-shell
.\scripts\install-dev.ps1
# 탐색기에서 .hwp/.pdf/.xlsx 등 우클릭 → KorDoc 메뉴 4개 표시되는지 확인
```

**기대:**
- "마크다운으로 변환", "PDF로 변환", "AI 요약", "KorDoc 앱 열기..." 4개 메뉴
- 빌드 실패 시 함정: `assets/icons/` 의 `StoreLogo.png` / `Square150.png` / `Square44.png` placeholder 누락 가능성. README.md 의 PowerShell 스니펫으로 임시 PNG 생성.

### 2. kordoc-ai 빌드 + 단일 deep-link 동작
```powershell
cd c:\github_project\kordoc-ai
pnpm build:node-sidecar    # sidecar bundle (puppeteer-core external)
pnpm tauri:dev              # dev 모드. deep-link register_all 로 OS registry 자동 등록
```
- 다른 셸에서: `kordoc-launcher.exe convert "C:\path\to\test.hwp" md`
  → kordoc-ai 윈도우 깨어남, 파일이 import 되는지 확인
- 이미 실행 중일 때 우클릭 → single-instance 가 두 번째 args 첫 인스턴스로 전달

### 3. 다중 선택 batch 흐름
- 탐색기에서 `.hwp` 5개 선택 후 우클릭 → KorDoc → 마크다운으로 변환
- `%TEMP%/kordoc-batch-<ts>.json` manifest 생성 확인
- kordoc-ai 가 read_batch_manifest 호출 → files 일괄 추가 확인
- 토스트: "일괄 처리: 5개 파일 추가됨 (convert_md)"

### 4. 인쇄 RPC 검증
- "Microsoft Print to PDF" 가상 프린터로 무해 검증 권장
- DevTools Console: `await invoke('sidecar_call', { method: 'list_printers' })`
- 그 다음: `await invoke('sidecar_call', { method: 'print_files', params: { files: ['C:\\test.hwp'], printer: 'Microsoft Print to PDF' } })`
- `%TEMP%/kordoc-print/*.pdf` 생성 + 60초 후 정리되는지

### 5. Tray + 알림
- 윈도우 X 클릭 → 종료 안 되고 tray 로 hide
- tray 좌클릭 → 복귀
- tray 우클릭 → 메뉴 (창 열기 / 창 숨기기 / 완전 종료)
- 변환 실행 후 즉시 다른 창으로 포커스 이동 → 완료 시 Win11 native toast

### 검증 통과 후
- ROADMAP §Phase 2 종료 4개 체크박스 체크
- `npm publish kordoc@2.7.0` 진행 (사용자 승인)
- Phase 3 (다중선택 + 일괄 처리 UX) 진입

---

## 🗺️ 전체 로드맵

| Phase | 기간 | 주제 | 산출물 | 상태 |
|-------|------|------|--------|------|
| 1 | 2주 | 코어 갭 (XLS + Print Renderer) | kordoc v2.7.0 | ✅ (publish 대기) |
| 2 | 2주 | MSIX Shell Extension PoC | kordoc-shell v0.1 + kordoc-ai 통합 | ✅ (실동작 검증 대기) |
| 3 | 3주 | 다중선택 + 일괄 처리 UX | kordoc-ai v2.0 | ⬜ |
| 4 | 3주 | 공공기관 특화 (PII/템플릿/DOC) | v2.1 | ⬜ |

---

## ⚠️ 알려진 함정

### Phase 1 (kordoc)
- `BoundSheet8.dt` (1B) ≠ `BOF.dt` (2B). 비교 금지.
- SST CONTINUE 분할: 단순 concat 안 됨. 경계마다 새 flags 재해석 필요.
- `KordocError(message)` 만 받음. ErrorCode 는 `classifyError` 가 message 키워드로 자동.
- tsup `OPTIONAL_EXTERNAL`: optional dep 안 추가하면 dist 폭증.
- ESM 에서 `require` 금지. `import { existsSync } from "fs"` 정적 import.

### Phase 2 W1 (kordoc-shell)
- MSIX SparsePackage `MinVersion="10.0.17763.0"` 미만 미지원.
- `Add-AppxPackage -ExternalLocation`: Sparse 는 절대 경로 필요.
- 자체서명 cert: LocalMachine\Root + TrustedPeople 양쪽 (관리자 권한).

### Phase 2 W2 (kordoc-ai) — 신규 함정 ★
- **`tauri-plugin-deep-link@2.4.8` yanked**. single-instance 2.4.1 이 이걸 강제 의존하므로 single-instance 2.4.0 으로 다운그레이드 + deep-link 2.4.7 핀 필수.
- **`PrintTo` verb 는 copies/duplex/color 제어 불가**. 드라이버 기본값 사용. 옵션 UI 표시 시 "드라이버 기본값" 명시 필요. 세부 제어 필요하면 SumatraPDF 또는 Win32 EnumPrintProcessors.
- **임시 PDF 즉시 unlink 금지**. PrintTo 가 spool 시작하기 전에 OS 가 파일 못 읽음. 60초 setTimeout(unref) 으로 지연.
- **kordoc-ai 의 `tauri-plugin-window-state`** 와 single-instance 호환 OK (단일 인스턴스 가정이라 충돌 없음).
- **`tauri features = ["tray-icon"]`** 명시 필요. default 에 포함 안 됨.
- **`on_tray_icon_event` 클로저 타입 추론 실패** → `|tray: &tauri::tray::TrayIcon<tauri::Wry>, event: TrayIconEvent|` 명시.
- **kordoc dist v2.7 빌드 누락**: link:../../kordoc 사용 시 dist 가 옛 버전이면 `markdownToPdf`/`PrintPreset` 미노출. 본 레포 작업 전 `cd c:\github_project\kordoc && npm install && npm run build` 권장.

---

## 🔑 핵심 의사결정 (PRD §6)

1. **Shell 통합**: MSIX Sparse Package (Win10 1809+)
2. **DOC 파싱**: LibreOffice headless 폴백 (Phase 4)
3. **인쇄 엔진**: PDF 변환 → ShellExecute "print"
4. **AI 격리**: 기본 비활성, 옵트인
5. **Print Renderer**: markdown-it → puppeteer-core HTML ✅
6. **XLS OLE2 파서**: 기존 `cfb-lenient.ts` 재사용 ✅
7. **Shell 런처 언어**: Rust ✅
8. **다중선택 처리**: `%TEMP%/kordoc-batch-*.json` manifest 파일 방식 ✅
9. **개발 서명**: 자체서명 (Phase 2), 배포 EV (미정)

---

## 💬 다음 세션 시작 프롬프트

```
KorDoc Suite Phase 2 통합 검증 — 코드는 끝났고 실제 동작 확인.

브랜치/레포 (이미 푸시):
- kordoc: feat/xls-and-print, ede40d6 (v2.7.0 + package-lock)
- kordoc-ai: main, f32cb1f (W2 D5 tray + notification)
- kordoc-shell: main, 41d4f34 (W1 변경 없음)

먼저 .claude/memory/activeContext.md 읽고
"다음 세션 — Phase 2 통합 검증" 섹션의 5단계를 순서대로 실행해줘.

검증 기록은 docs/phase2-integration-test.md 에 새로 작성:
- 각 단계 PASS/FAIL + 실제 명령어와 결과 로그
- FAIL 발생 시 원인 분석 + 수정 PR
- 통과하면 ROADMAP Phase 2 체크박스 체크 + npm publish kordoc@2.7.0 안내
```

---

## 📝 변경 이력
- 2026-04-29: Phase 1 완료, kordoc v2.7.0 (`f41da76`)
- 2026-04-29: Phase 2 W1 완료, kordoc-shell init (`41d4f34`)
- 2026-04-29: 회사 PC → 집 PC 인계용 메모리 백업 커밋 (kordoc-ai `3cb1001`, kordoc `d307c11`)
- 2026-04-29: 집 PC, Phase 2 W2 D1-D4 완료 (`20dd679`)
- 2026-04-29: 집 PC, Phase 2 W2 D5 완료 (`f32cb1f`) — **현재**
