# KorDoc Suite Documentation

공공기관 특화 문서처리 솔루션 — 3-Layer 아키텍처 (kordoc / kordoc-ai / kordoc-shell)

## 📖 문서 목록

| 문서 | 용도 |
|------|------|
| [PRD.md](./PRD.md) | 제품 요구사항 — 비전, 기능 명세, 의사결정 |
| [ROADMAP.md](./ROADMAP.md) | 4-Phase 구현 체크리스트 |
| [SPEC.md](./SPEC.md) | 코드 레벨 기술 명세 (API, 시그니처, 에러) |

## 🚀 빠른 시작

**다음 작업 — Phase 1**:
```bash
cd d:/AI_Project/kordoc
git checkout -b feat/xls-and-print
# ROADMAP.md의 Phase 1 W1 D1-2부터 진행
```

**세션 컨텍스트**: [.claude/memory/activeContext.md](../.claude/memory/activeContext.md)

## 🏗️ 아키텍처 개요

```
탐색기 우클릭
    ↓
kordoc-shell (MSIX) → kordoc-launcher.exe
    ↓ kordoc:// deep-link
kordoc-ai (Tauri) → Node Sidecar (JSON-RPC)
    ↓
kordoc (npm) — XLS/HWP/HWPX/PDF/XLSX/DOCX 파싱
```

## 📊 Phase 진행 상태

- [ ] Phase 1: 코어 갭 (XLS + Print) — **다음 시작**
- [ ] Phase 2: MSIX Shell Extension
- [ ] Phase 3: 다중선택 + 일괄 처리
- [ ] Phase 4: 공공기관 특화 (선택)
