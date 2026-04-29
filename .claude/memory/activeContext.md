# KorDoc Suite — Active Context

> 이 파일은 세션 시작 시 자동 로드됨. 다음 세션 컨텍스트 인계용.

---

## 📌 현재 상태 (2026-04-29)

### Phase 1 완료 ✅ (kordoc v2.7.0)
- `feat/xls-and-print` 브랜치, 커밋 `f41da76`
- XLS (BIFF8) 파서: `src/xls/{record,encoding,sst,cell,parser,index}.ts`
- Print Renderer: `src/print/{renderer,index}.ts` — markdown-it → puppeteer-core PDF
- 합성 픽스처 5건 (xlwt 생성)
- 318 tests pass (기존 296 + XLS 12 + Print 10)
- `package.json` 2.6.2 → 2.7.0 bump
- `CHANGELOG.md` v2.7.0 항목 정리
- **publish 대기**: 사용자 승인 필요 (`npm publish`)

### Phase 2 W1 완료 ✅ (kordoc-shell v0.1)
**신규 레포**: `d:/AI_Project/kordoc-shell`, 커밋 `41d4f34`

- `manifest/AppxManifest.xml` — 7개 확장자 연결 + `kordoc://` 프로토콜
- `manifest/Microsoft.Registry.xml` — 7개 확장자 × `KorDoc` 서브메뉴 + 4개 verb
- `kordoc-launcher/` (Rust) — verb → kordoc:// deep-link 변환 (단일/다중 모두)
  - 단일: `kordoc://<action>?path=<encoded>`
  - 다중: `%TEMP%/kordoc-batch-*.json` manifest → `kordoc://batch?manifest=<path>`
- `scripts/{build,sign,install-dev,uninstall-dev}.ps1` 4개
- `README.md`, `CLAUDE.md`, `docs/README.md`

### 다음 작업 — **Phase 2 W2 시작**
**작업 위치**: 주로 `d:/AI_Project/kordoc-ai` (Tauri sidecar) + 일부 `d:/AI_Project/kordoc-shell` (테스트)

#### W2 D1-2: kordoc-ai deep-link 핸들러
1. `pnpm tauri add deep-link` (또는 `tauri-plugin-deep-link` Cargo.toml 추가)
2. `pnpm tauri add single-instance`
3. `src-tauri/src/lib.rs` — single-instance 핸들러에서 args 파싱 → `kordoc://` URL 추출 → 프론트엔드에 emit
4. `src/App.tsx` 또는 신규 `src/hooks/useDeepLink.ts` — `listen('deep-link')` → URL 파싱 → 라우팅
   - `convert?path=<file>&action=md|pdf|hwpx`: 변환 작업 시작
   - `summarize?path=<file>`: 요약 패널
   - `open?path=<file>`: 폴더 열기 + 파일 선택
   - `batch?manifest=<path>`: manifest 읽고 BatchPanel로

#### W2 D3-4: 인쇄 RPC
1. `node-sidecar/src/core/print/index.ts` 신규
2. `print_files(files, printer?, preset?, copies?, duplex?, color?)` RPC
   - kordoc 라이브러리의 `parseFile(file)` → `markdownToPdf(md, {preset})` → 임시 PDF
   - `Start-Process -FilePath $pdf -Verb PrintTo -ArgumentList "$printer"`
3. `list_printers()` RPC — `Get-Printer | ConvertTo-Json`
4. Vitest 테스트

#### W2 D5: UX 마무리
- Tauri tray 아이콘 + 메뉴
- 변환 진행률 토스트 (시스템 알림)
- 에러 알림

### Phase 2 완료 기준 (ROADMAP)
- [ ] 탐색기 .hwp 우클릭 → KorDoc 메뉴 < 100ms
- [ ] 4개 메뉴 deep-link 통해 kordoc-ai 호출 성공
- [ ] 5개 파일 동시 인쇄 큐잉
- [ ] MSIX 자체서명 + 로컬 설치 가능

---

## 🗺️ 전체 로드맵 요약

| Phase | 기간 | 주제 | 산출물 | 상태 |
|-------|------|------|--------|------|
| **1** | 2주 | 코어 갭 (XLS + Print Renderer) | kordoc v2.7.0 | ✅ 완료 (publish 대기) |
| **2** | 2주 | MSIX Shell Extension PoC | kordoc-shell v0.1 + kordoc-ai 통합 | 🟡 W1 완료 |
| 3 | 3주 | 다중선택 + 일괄 처리 | kordoc-ai v2.0 | ⬜ |
| 4 | 3주 | 공공기관 특화 (PII/템플릿/DOC) | v2.1 | ⬜ |

---

## 📚 참고 문서

### kordoc-ai (이 레포)
- [docs/PRD.md](../../docs/PRD.md) — 제품 요구사항
- [docs/ROADMAP.md](../../docs/ROADMAP.md) — 체크리스트
- [docs/SPEC.md](../../docs/SPEC.md) — 기술 명세 (특히 §2 Layer 2 RPC, §3 Layer 3 Shell)

### kordoc 본체
- [d:/AI_Project/kordoc](../../../kordoc/)
- [docs/biff8-spec.md](../../../kordoc/docs/biff8-spec.md) — XLS 파서 명세

### kordoc-shell (신규)
- [d:/AI_Project/kordoc-shell](../../../kordoc-shell/)
- [README.md](../../../kordoc-shell/README.md)
- [CLAUDE.md](../../../kordoc-shell/CLAUDE.md)

---

## 🔑 핵심 의사결정 (PRD §6)

1. **Shell 통합**: MSIX Sparse Package (Win10 1809+)
2. **DOC 파싱**: LibreOffice headless 폴백 (Phase 4)
3. **인쇄 엔진**: PDF 변환 → ShellExecute "print"
4. **AI 격리**: 기본 비활성, 옵트인
5. **Print Renderer**: markdown-it → puppeteer-core HTML ✅ kordoc v2.7.0
6. **XLS OLE2 파서**: 기존 `cfb-lenient.ts` 재사용 ✅ kordoc v2.7.0
7. **Shell 런처 언어**: Rust (Tauri와 동일 스택, 50KB 단일 exe)
8. **다중선택 처리**: `%TEMP%/kordoc-batch-*.json` manifest 파일 방식 (verb N번 호출 회피)
9. **개발 서명**: 자체서명 (CN=KorDoc), 배포 EV 코드사인 — Phase 2 종료 후 결정

---

## ⚠️ 알려진 함정 (학습)

- **BoundSheet8.dt (1바이트)** vs **BOF.dt (2바이트)** 별개. 비교 금지.
- **SST CONTINUE 분할**: 단순 concat 안 됨. 경계마다 새 flags 재해석 필요.
- **KordocError 생성자**: `(message: string)`만 받음. ErrorCode는 message 키워드로 `classifyError`가 자동 분류.
- **tsup external**: optional dep은 반드시 `OPTIONAL_EXTERNAL`에 추가. 안 그러면 dist 폭증.
- **ESM에서 require 금지**: `import { existsSync } from "fs"` 정적 import.
- **MSIX SparsePackage**: `MinVersion="10.0.17763.0"` 미만 미지원.
- **Add-AppxPackage -ExternalLocation**: Sparse Package는 절대 경로 필요.
- **자체서명 cert**: LocalMachine\Root + TrustedPeople 양쪽 등록 필수 (관리자 권한).

---

## 🎯 Phase 2 W2 진입 명령어

```bash
# 환경 확인
cd d:/AI_Project/kordoc-ai
git status
pnpm install

# kordoc 의존성을 v2.7.0으로 — npm publish 후
# pnpm update kordoc

# Tauri 플러그인 추가
cd src-tauri
cargo add tauri-plugin-deep-link tauri-plugin-single-instance
cd ..
pnpm add @tauri-apps/plugin-deep-link

# kordoc-shell 빌드 검증 (선택)
cd d:/AI_Project/kordoc-shell
.\scripts\build.ps1 -SkipPackage  # cargo build만
```

---

## 💬 다음 세션 시작 프롬프트

```
KorDoc Suite Phase 2 W2 — kordoc-ai deep-link 핸들러 + 인쇄 RPC.

브랜치/레포 상태:
- kordoc 본체: feat/xls-and-print 브랜치, v2.7.0 커밋 완료 (publish 대기)
- kordoc-shell: main 브랜치, init 커밋 완료 (Phase 2 W1 골격)
- kordoc-ai: 작업 미착수

먼저 .claude/memory/activeContext.md 읽고
docs/SPEC.md §2.1~2.2 (print_files / list_printers) 와 §3.4 (Tauri deep-link) 확인.

W2 D1-2 작업: kordoc-ai에 tauri-plugin-deep-link + tauri-plugin-single-instance 추가,
src-tauri/src/lib.rs deep-link 수신 핸들러,
프론트엔드 useDeepLink 훅 + 라우팅.

W2 D3-4: node-sidecar/src/core/print/index.ts → print_files / list_printers RPC.

W2 D5: tray 아이콘 + 진행률 토스트.

Phase 1 publish 진행 여부도 확인 (npm publish kordoc@2.7.0).
```

---

## 📝 변경 이력
- 2026-04-29: 초기 작성, Phase 1 진입 준비
- 2026-04-29: Phase 1 W1 D1-2 완료 — biff8-spec, fixtures README, 디렉토리, 브랜치
- 2026-04-29: Phase 1 W1 D3 ~ W2 D4 완료 — XLS 파서 모듈 6개 + 합성 픽스처 5건 + 12개 테스트
- 2026-04-29: **Phase 1 전체 완료** — Print Renderer 추가, 318 tests pass, v2.7.0 커밋 (`f41da76`)
- 2026-04-29: **Phase 2 W1 완료** — kordoc-shell 신규 레포 init 커밋 (`41d4f34`), MSIX 매니페스트 + Rust 런처 + 빌드/서명 스크립트
