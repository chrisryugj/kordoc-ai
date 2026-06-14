# 다음 세션 시작 가이드 — rhwp studio 편집기 통합 (진행 중, 미커밋)

> 2026-06-14 갱신. 이번 세션: ①Phase R 프로덕션 리뷰 수정(완료) → ②편집기를 **rhwp studio 통째 임베드로 대전환**(진행 중).
> **전부 미커밋.** dev 서버 2개 떠 있음(studio 7700, tauri 5173+앱).

---

## 1. Summary

- **전반부**: Phase R 워크벤치(채우기/편집/AI/변환)의 프로덕션 리뷰 → 보안·성능·UX 버그 P0 2건+P1 5건 수정 완료(빌드 그린, vitest 64). 상세는 아래 §리뷰수정.
- **후반부(대전환)**: 사용자가 "편집이 메모장 수준" 지적 → **rhwp가 풀 WYSIWYG 편집 엔진**임을 스모크로 확인 → 기존 SVG 인라인 편집/사이드카 텍스트패치를 버리고 **rhwp-studio(공식 에디터)를 iframe으로 통째 임베드**하는 방향으로 전환. studio가 kordoc-ai 안에서 문서를 로드·렌더하는 데까지 성공(12페이지 표시).

## 2. Key Decisions

- **편집기 = rhwp studio 통째 이식** (직접 서식툴바 구현 안 함). 사용자 결정: "studio 그대로 이식". "rhwp가 편집, kordoc이 본문 공급"하는 유기적 한 앱 지향.
- **iframe 임베드** 방식 (main.ts 함수화/src통합 대신). 이유: studio가 **postMessage API 내장** — `{type:'rhwp-request', id, method, params}` → `{type:'rhwp-response', id, result, error}`. 메서드: `ready`/`loadFile`/`exportHwpx`/`exportHwp`/`pageCount`/`getPageSvg`. (studio src/main.ts L865~)
- **@rhwp/core(0.7.15) = rhwp-studio의 ../pkg와 동일 산출물** → studio `@wasm` alias를 우리 `@rhwp/core`로 연결해 WASM 공유.
- 임베드 시 studio 단독앱 팝업(validation 모달, HWP변환 안내)은 `window.parent !== window` 분기로 자동보정/생략.

## 3. ⚠️ Traps to Avoid

- **글머리(□,◦) 찌그러짐 — 미해결(이번 세션 마지막 이슈).** studio `public/fonts`가 깨진 심볼릭("../../web/fonts" 15B 텍스트)이었음 → `_rhwp-upstream/web/fonts`의 woff2 36개를 `kordoc-ai/rhwp-studio/public/fonts/`로 복사함(NotoSansKR/NotoSerifKR/Pretendard 등). dev에서 `/rhwp-studio/fonts/NotoSansKR-Bold.woff2` → **200 확인**. 그런데도 **여전히 찌그러짐**. 다음 조사 포인트: ⓐ한컴 글머리표(bullet) 글리프가 특정 폰트인데 NotoSans 폴백 시 메트릭 안 맞음 ⓑcanvaskit 글리프 렌더 ⓒiframe 폰트 캐시 ⓓfont-substitution.ts 매핑 누락. (studio src/core/font-loader.ts, font-substitution.ts)
- **same-origin CSP 충돌(중요).** same-origin(`/rhwp-studio/`)으로 하면 부모 Tauri CSP(`script-src 'self' wasm-unsafe-eval`, `connect-src 'self'`)가 iframe studio에 **상속**돼 canvaskit(eval)·CDN폰트 차단 → studio **부팅 실패(메뉴 텍스트만 세로로 나열)**. cross-origin(7700)은 부모 CSP를 안 받아 정상. **현재 dev는 7700 cross-origin 유지 중**. prod same-origin은 CSP에 `unsafe-eval` + 폰트 CDN 허용 추가 필요(보안 트레이드오프).
- **studio→부모 응답(rhwp-response)이 cross-origin Tauri webview에서 안 닿음**(추정 — ready 핸드셰이크 timeout). 그래서 loadFile은 **fire-and-forget**(재전송). `exportHwpx`(저장)·좌우 연계는 양방향 필요 → same-origin(CSP완화) 선결.
- studio는 pnpm workspace 충돌 → `pnpm install --ignore-workspace` 필수.
- `rhwp-studio/vite.config.ts`에 `base: '/rhwp-studio/'` + `build.outDir: ../public/rhwp-studio` 추가됨 → dev 7700도 폰트 등이 `/rhwp-studio/` 경로.
- studio `src/main.ts` 2곳 수정함(임베드 분기): L559 validation `embedded ? 'auto-fix' : 모달`, L623 `notifyHwpxSaveModeIfNeeded` early return. upstream 카피라 재빌드해도 유지됨.
- PWA SW: 빌드본(public/rhwp-studio)에 sw.js/registerSW.js 생성됨 — same-origin iframe에서 SW 문제 소지. same-origin 전환 시 VitePWA 제거 검토.

## 4. 🤝 Working Agreements

- 검증된 엔진(studio) 이식 > 직접 구현. "rhwp 본문을 kordoc이 써준다" 유기적 한 앱.
- 빠른 행동 선호 — 분석/질문 길어지면 답답해함. 추측 말고 코드로 확인.

## 5. Relevant Files

- `src/components/workbench/StudioEditor.tsx` — iframe(7700) + postMessage 브릿지. `STUDIO_URL`, boot(핸드셰이크+fire-and-forget 폴백), exportHwpx 핸들.
- `src/components/workbench/DocumentWorkbench.tsx` — PreviewPanel을 StudioEditor로 대체, `getDocB64()`로 hwpx 주입.
- `src/components/workbench/FileRail.tsx` — 파란 세로바·파란강조 제거(중성 회색)됨.
- `rhwp-studio/` — studio 카피. `src/main.ts`(임베드 분기), `vite.config.ts`(base/outDir/@wasm), `public/fonts/`(woff2 36개 복사).
- `public/rhwp-studio/` — same-origin 빌드본(CSP 미완으로 보류).
- `src-tauri/tauri.conf.json` — CSP `frame-src 'self' http://127.0.0.1:7700` 추가됨.
- `src/lib/rhwp.ts`, `src/contexts/DocumentSession.tsx`, `src/components/workbench/PreviewPanel.tsx` — SVG 인라인 편집 경로(studio 전환으로 **대부분 미사용**, 정리 대상).

### §리뷰수정 (전반부, 미커밋)
- `node-sidecar/src/core/excel/index.ts` — source_name `basename()` traversal 차단
- `node-sidecar/src/main.ts` — `MAX_RPC_MESSAGE_CHARS` 입력 크기 가드
- `src/lib/svg-annotate.ts`(svgHasLabel), `DocumentSession`(findLabelPage), `PreviewPanel`(교차페이지 라벨점프·hover O(1)·충돌정리), `useFillForm`(지연로딩·undo안내), `Workspace.tsx`(액션카드 설명), `DocumentWorkbench`(fillActivated)

## 6. Open Work (상태 서술형)

- 글머리 찌그러짐: 폰트 복사했으나 미해결 — 폰트 경로/글리프 매핑 추가 조사 필요.
- same-origin CSP 완화: 미적용 — prod 저장/연계의 선결 조건.
- 저장(exportHwpx)·좌우 연계(채우기/AI/변환↔studio, 파일전환): 미구현 — 양방향 통신(same-origin) 의존.
- SVG 인라인 편집 잔존 코드(PreviewPanel/DocumentSession rhwp액션/rhwp.ts 편집래퍼): studio로 대체됐으나 파일 잔존 — 정리 필요.
- 전부 미커밋. dev 서버 2개 떠 있음(studio 7700, tauri 앱).

## 7. 📌 Prompt for New Chat

```
kordoc-ai에 rhwp-studio 편집기를 임베드하는 작업 이어서. 먼저
.claude/memory/NEXT-SESSION.md를 읽고, 아래를 Read 도구로 코드와 대조 검증해
(추측 금지 — 이 문서 주장이 현재 코드와 맞는지 확인):
- src/components/workbench/StudioEditor.tsx (iframe 브릿지, STUDIO_URL=7700)
- src/components/workbench/DocumentWorkbench.tsx (StudioEditor 통합)
- rhwp-studio/src/main.ts L865~ (postMessage API), L555·L623 (임베드 분기)
- rhwp-studio/src/core/font-loader.ts + font-substitution.ts (글머리 폰트)
- rhwp-studio/vite.config.ts (base/@wasm), public/fonts/ (woff2 36개)
- src-tauri/tauri.conf.json (CSP)

최우선 이슈: **글머리 기호(□,◦) 찌그러짐.** 폰트 36개 복사했고 dev에서 폰트
200인데도 안 됨. studio를 7700 단독(브라우저)에서도 같은 문서 열어 찌그러지는지
먼저 격리(임베드 문제 vs studio 자체). font-substitution.ts의 글머리/기호 폰트
매핑, canvaskit 글리프 렌더를 의심.

그 다음 same-origin 전환(저장·좌우 연계 위해): Tauri CSP에 unsafe-eval+CDN폰트
허용 → /rhwp-studio/ same-origin → exportHwpx 양방향 → 우측 탭(채우기/AI/변환)·
좌측 파일전환을 studio에 연계.

dev 서버 살아있는지 먼저 확인(studio 7700, tauri 앱). 죽었으면:
cd rhwp-studio && pnpm dev  /  pnpm tauri:dev
```
