# kordoc-shell — Active Context

> KorDoc Suite Layer 3 (Windows Shell Extension). Phase 2 W1 완료, W2 진입 대기.

---

## 📌 현재 상태 (2026-04-29)

### W1 완료 ✅
- 레포 init (커밋 `41d4f34`, main 브랜치)
- `manifest/AppxManifest.xml` — 7개 확장자 + `kordoc://` 프로토콜
- `manifest/Microsoft.Registry.xml` — 우클릭 메뉴 4개 verb
- `kordoc-launcher/` Rust 단일 exe — verb → kordoc:// URL 변환
- `scripts/{build,sign,install-dev,uninstall-dev}.ps1`
- README, CLAUDE.md

### 미완료 (다음 세션)
1. 아이콘 PNG (placeholder만 있음 — `assets/icons/StoreLogo.png`, `Square150.png`, `Square44.png`)
2. **kordoc-ai 측 deep-link 핸들러** (Phase 2 W2 작업의 본체 — 이 레포 자체는 거의 완성)
3. 실제 빌드 검증 — Windows SDK + cargo 환경에서 `.\scripts\install-dev.ps1` 실행

---

## 🔑 통합 동작 흐름

```
탐색기 .hwp 우클릭 → KorDoc → 마크다운으로 변환
    ↓ Microsoft.Registry.xml verb
kordoc-launcher.exe convert "C:\file.hwp" md
    ↓ Win32 ShellExecuteW
kordoc://convert?path=C%3A%5Cfile.hwp&action=md
    ↓ Windows protocol handler
kordoc-ai (Tauri single-instance)
    ↓ deep-link 이벤트
프론트엔드 → kordoc 라이브러리 호출 → 결과 출력
```

---

## 📚 참고

- 마스터 컨텍스트: [d:/AI_Project/kordoc-ai/.claude/memory/activeContext.md](../../../kordoc-ai/.claude/memory/activeContext.md)
- PRD/ROADMAP/SPEC: [d:/AI_Project/kordoc-ai/docs/](../../../kordoc-ai/docs/)
- Phase 1 결과: kordoc 본체 `feat/xls-and-print` 브랜치 (v2.7.0)

---

## 💬 다음 세션 시작 프롬프트 (이 레포 작업 시)

```
KorDoc Suite Phase 2 W2 — kordoc-shell 빌드 검증 + 아이콘 추가.

먼저 .claude/memory/activeContext.md, README.md, CLAUDE.md 읽고:
1. assets/icons/Square150.png 등 placeholder 생성 (PowerShell System.Drawing)
2. .\scripts\install-dev.ps1 실행 검증 — 관리자 PS, Windows SDK 필요
3. 우클릭 메뉴 표시 확인 (.hwp 임의 파일)
4. kordoc-ai 측 deep-link 수신 동작 — kordoc-ai 작업 완료 후 통합 테스트

빌드 실패 시 cargo build 단독 → manifest 검증 → MakeAppx 단계별 디버깅.
```
