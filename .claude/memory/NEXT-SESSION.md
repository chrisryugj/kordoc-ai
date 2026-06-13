# 다음 세션 시작 가이드 — KorDoc Studio UI 개편 (Phase R)

> 2026-06-13 갱신. 아래 프롬프트를 새 세션에 복붙.

---

## 복붙용 시작 프롬프트

```
KorDoc Studio UI 개편(Phase R) W1 착수 — 3-pane 문서 워크벤치.

먼저 다음 파일을 Read 도구로 실제로 읽고, 문서의 주장을 코드와 대조해 검증해줘
(브랜치/PR 상태는 gh로 확인 — 머지가 진행됐을 수 있음):

1. c:\github_project\kordoc-ai\.claude\memory\studio-redesign-plan.md  ← 플랜 (단일 진실 소스)
2. c:\github_project\kordoc-ai\.claude\memory\activeContext.md         ← 직전 세션 상태
3. src/components/edit/DocEditor.tsx + src/components/fill/FillWizard.tsx ← 이식 대상
4. node-sidecar/src/core/edit/index.ts                                  ← edit 세션 RPC 6종

전제 조건 체크 (어긋나면 먼저 처리):
- kordoc dist가 v3.1 + 들여쓰기 픽스(PR #35) 포함인지: cd c:\github_project\kordoc && git log --oneline -3 && npm run build
- 머지 스택: kordoc #35 → kordoc-ai #1 → #2. 미머지면 사용자에게 머지 여부 확인
- npm publish 보류 상태 (npm login 필요, 3.1.1로 픽스 포함 배포 권장)

W1 범위 (플랜 참조): 워크벤치 셸 3-pane 레이아웃 + DocumentSession 컨텍스트
+ DocEditor를 중앙 미리보기 패널로 이식. frontend-design 스킬 사용.
기존 모달은 삭제하지 말고 점진 이식.
```

---

## 상태 스냅샷 (2026-06-13)

| 항목 | 상태 |
|------|------|
| kordoc | v3.1.0 태그됨, **publish 보류** (npm 토큰 만료). PR #35(들여쓰기 픽스) 오픈 |
| kordoc-ai PR #1 | Phase B FillWizard — 머지 대기 |
| kordoc-ai PR #2 | Phase C DocEditor (base=#1 브랜치) — 머지 대기 |
| 검증 | Phase C: vitest 64/64, fresh-context 5/5, 앱 실사용 OK. 들여쓰기 픽스 후 육안 재확인 미완 |
| 다음 개발 | **Phase R W1** (워크벤치 셸) → W4에서 Phase D(AI 채움/시험지) 연결 |

## 최종 목표 (사용자)

1. 시험지 자동완성 (AI 문항 생성/수정 + 서식 보존)
2. 양식 자동 채움으로 공문서 쉽게 완성

## 함정 요약

- **kordoc dist stale** → HwpxSession 미노출. 본 레포 작업 전 kordoc 빌드 필수
- kordoc 수정 후 사이드카 반영 = `pnpm build:node-sidecar` + 앱 재시작 (esbuild 번들)
- PUA 글리프 문단 graceful-skip = 정상. 빈 셀 클릭 불가 = 의도 (채우기 패널 담당)
- pnpm minimum-release-age 7일 / `.claude/plans/`는 gitignore — 플랜은 `.claude/memory/`에
