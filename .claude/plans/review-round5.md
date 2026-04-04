# 5차 프로덕션 리뷰 계획서

> 목표: 4차에서 미수정 8건 + 신규 발견 5건 = **총 13건 완벽 수정**
> 검증: vitest 31/31 + tsc --noEmit + cargo check + `pnpm tauri:dev` 실제 실행

---

## Phase A — 릴리스 차단 (빌드/배포)

### A-1. node_modules 번들링 (CRITICAL)
- **문제**: MSI 빌드 시 `node_modules/` 미포함 → crash
- **해결**: esbuild로 `node-sidecar/dist/main.js`를 단일 파일 번들링
  - `node-sidecar/esbuild.config.mjs` 생성 (platform: node, bundle: true, external 없음)
  - `package.json`에 `"build:bundle": "esbuild ..."` 스크립트 추가
  - `tauri.conf.json`의 `beforeBuildCommand`에 번들링 단계 추가
  - `manager.rs`에서 `node_modules` 존재 체크 불필요해짐
- **검증**: 번들된 `dist/main.js` 단독 실행 확인 (`node dist/main.js`)

### A-2. Node.js PATH 하드코딩 (CRITICAL)
- **문제**: `manager.rs:68`에서 `let node = "node"` 하드코딩
- **해결**:
  - 개발 환경: `which node` 또는 `where node`로 탐색
  - 프로덕션: Tauri resources에 Node.js 바이너리 번들 또는 시작 시 경로 검증 + 사용자 안내
  - 최소한: `get_node_path()` 함수로 분리 + 실패 시 명확한 에러 메시지
- **검증**: PATH에서 node 제거 후 에러 메시지 확인

---

## Phase B — UX 핵심 (사용자 직접 영향)

### B-1. sidecar 시작 실패 시 프론트엔드 즉각 알림
- **파일**: `src-tauri/src/lib.rs:41-43`
- **문제**: `tracing::error!`만 하고 프론트엔드에 안 알림 → 3초 폴링까지 지연
- **해결**: `sidecar_start` 실패 시 `app.emit("sidecar:error", msg)` 추가
- **검증**: 의도적으로 sidecar crash 후 에러 표시 시간 측정

### B-2. ResultStep 액션별 결과 미리보기
- **파일**: `src/components/pipeline/ResultStep.tsx`
- **문제**: `result.data`가 있어도 "변환 완료" + 카운트만 표시
- **해결**: 액션별 분기
  - `summarize` → 요약 텍스트 인라인 표시 (접기/펼치기)
  - `diff` → 변경 통계 (추가/삭제/수정 건수) 표시
  - `scan_receipt` → 항목 테이블
  - 기타 → 기존 동작 유지
- **검증**: 각 액션 실행 후 ResultStep UI 확인

### B-3. cancel 시 파일 목록 보존
- **파일**: `src/hooks/usePipeline.ts:220-221`
- **문제**: cancel → `setStep("idle")` → WelcomeHero → 파일 목록 안 보임
- **해결**: `cancel()`에서 `setStep("import")`으로 변경
- **검증**: 변환 중 취소 후 파일 목록 유지 확인

---

## Phase C — 버그/안정성

### C-1. `.md` 타입 누락
- **파일**: `src/utils/fileType.ts`, `src/types/pipeline.ts`
- **문제**: SUPPORTED_EXT_RE에 `.md` 포함되지만 detectFileType은 "unknown" 반환
- **해결**:
  - `pipeline.ts` FileType 유니온에 `"md"` 추가
  - `detectFileType`에 `.md → "md"` 분기 추가
  - Badge에 md 표시 추가
- **검증**: .md 파일 드롭 후 타입 표시 확인

### C-2. summarize 입력 길이 무제한
- **파일**: `node-sidecar/src/core/summary/index.ts:46`
- **문제**: 수십만 자 문서가 그대로 프롬프트에 들어감 → Gemini 토큰 초과
- **해결**: 입력 길이 상한 검증 (예: 100,000자). 초과 시 에러 반환 + 메시지
- **검증**: 100KB 텍스트 파일로 테스트

### C-3. dispatchSingle의 success 미검증
- **파일**: `src/hooks/usePipeline.ts:84-92`
- **문제**: RPC가 `{success: false}`를 반환해도 `successCount: 1`로 잘못 집계
- **해결**: `raw.success === false`일 때 `failCount: 1` 반영
- **검증**: OCR 실패 시나리오에서 카운트 확인

### C-4. open_folder Windows 에러 무시
- **파일**: `node-sidecar/src/rpc/methods/index.ts:59`
- **문제**: Windows explorer는 종종 exit code 1 반환하므로 에러 무시가 의도적이지만, 진짜 에러도 무시됨
- **해결**: exit code 1은 허용, 그 외 에러는 로깅 (reject까지는 불필요)
- **검증**: 존재하지 않는 경로로 open_folder 호출 시 로그 확인

---

## Phase D — 품질/유지보수

### D-1. App.tsx 상태 비대 → useSettings 훅 분리
- **문제**: useState 12개가 App에 집중
- **해결**: `src/hooks/useSettings.ts` 생성
  - `apiKey`, `apiKeyMasked`, `ocrModel`, `analysisModel`, `aiMode`, `outputDir`, `theme` 7개 상태
  - sidecar 연동 useEffect도 함께 이동
  - App은 `const settings = useSettings(sidecar)` 한 줄로 사용
- **검증**: 기존 기능 동작 + App.tsx 줄 수 40% 감소

### D-2. 경과 타이머 중복 → useElapsed 공통 훅
- **문제**: OcrProgressStep과 StatusBar가 독립 타이머로 1초 불일치
- **해결**: `src/hooks/useElapsed.ts` 생성 → pipeline.step 기반 공유 타이머
- **검증**: 두 곳의 경과 시간 동기화 확인

### D-3. ActionSelector 반응형
- **파일**: `src/components/pipeline/ActionSelector.tsx:93`
- **해결**: `grid grid-cols-2 lg:grid-cols-3` 적용
- **검증**: 창 크기 조절 시 레이아웃 확인

---

## 검증 체크리스트

```
[ ] vitest 31/31 통과
[ ] tsc --noEmit 에러 없음
[ ] cargo check 빌드 성공
[ ] pnpm tauri:dev 실행 → WelcomeHero 정상 렌더링
[ ] .md 파일 드래그 → 타입 정상 표시
[ ] 변환 실행 → progress 표시 → 완료 → ResultStep 표시
[ ] 변환 중 취소 → import step으로 복귀 + 파일 목록 유지
[ ] 설정 모달 → 저장 → 모달 닫힘 → 이전 포커스 복원
[ ] 더블클릭 시도 → 중복 실행 없음
[ ] 긴 에러 메시지 → Toast 3줄 제한
```

## 작업 순서

1. Phase A (번들링/PATH) — 가장 먼저, 프로덕션 빌드 동작 보장
2. Phase B (UX 핵심) — 사용자 체감 개선
3. Phase C (버그/안정성) — 엣지 케이스 방어
4. Phase D (품질) — 코드 건강성

예상 수정 파일: ~15개 | 예상 신규 파일: 3개 (esbuild.config, useSettings, useElapsed)
