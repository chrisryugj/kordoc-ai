# KorDoc Suite — 공공기관 특화 문서처리 솔루션 PRD

> **작성일**: 2026-04-29
> **대상 버전**: kordoc v3.0 / kordoc-ai v2.0 / kordoc-shell v1.0 (신규)
> **상태**: 기획 확정, Phase 1 착수 대기

---

## 1. 비전 (Vision)

**"한컴오피스도 MS Office도 없이, 우클릭 한 번으로 모든 한국 공문서를 다룬다."**

공공기관 실무자가 받은 HWP/HWPX/PDF/XLSX/DOCX/XLS/DOC 파일을 **윈도우 탐색기에서 우클릭만으로** 변환·요약·비교·병합·인쇄할 수 있는 데스크톱 솔루션.

### 1.1 타깃 사용자
- **1차**: 중앙·지방 공공기관 사무관·주무관 (일평균 30+ 문서 처리)
- **2차**: 공공기관 연계 민간(법무·세무·노무사), 학교 행정실
- **3차**: 일반 직장인 한국 문서 변환 수요자

### 1.2 핵심 차별점
1. **OS 통합** — 앱 실행 없이 탐색기 우클릭만으로 작업
2. **레거시 완전 지원** — XLS/DOC/HWP 구형 포맷도 순수 JS 파싱
3. **공공기관 특화** — 결재·시행문·개인정보 마스킹·직인 워크플로우 내장
4. **로컬 우선** — 민감 문서는 외부 API 차단, AI 기능만 선택적 클라우드

---

## 2. 제품 구성 (3-Layer Architecture)

```
┌─────────────────────────────────────────────────────┐
│ Layer 3: kordoc-shell (신규)                         │
│   Windows Shell Extension (MSIX Sparse Package)      │
│   - 우클릭 컨텍스트 메뉴                              │
│   - 다중선택 핸들러                                   │
│   - 인쇄 큐 디스패처                                  │
└──────────────────┬──────────────────────────────────┘
                   │ deep-link / IPC
┌──────────────────▼──────────────────────────────────┐
│ Layer 2: kordoc-ai (확장)                            │
│   Tauri Desktop App + Node Sidecar                   │
│   - 22개 기존 RPC + 신규 6개                          │
│   - 인쇄·템플릿·마스킹 기능                           │
│   - 진행률 토스트 / 트레이                            │
└──────────────────┬──────────────────────────────────┘
                   │ npm dep
┌──────────────────▼──────────────────────────────────┐
│ Layer 1: kordoc (확장)                               │
│   Pure JS Document Parser Library                    │
│   - 기존: HWP5/HWPX/HWPML/PDF/XLSX/DOCX              │
│   - 신규: XLS(BIFF8), DOC(Word OLE2)                 │
│   - 신규: Print-ready PDF/HTML 출력                  │
└─────────────────────────────────────────────────────┘
```

---

## 3. 기능 명세 (Functional Specification)

### 3.1 Layer 1 — kordoc 코어 확장

#### F1-1. XLS (BIFF8) 파서 ⭐ 필수
- **모듈 경로**: `src/xls/parser.ts`
- **포맷**: Excel 97-2003 (.xls), BIFF8 binary, OLE2 컨테이너
- **의존**: 기존 `cfb-lenient.ts` 재사용 + BIFF 레코드 디코더 신규
- **출력**: `IRBlock[]` (XLSX 파서와 동일 구조)
- **지원 범위**:
  - SST(Shared String Table), 시트별 셀, 병합 영역
  - 숫자/날짜/문자열/수식 결과값
  - 한글 인코딩 (CP949, UTF-16LE)
- **제외**: 차트, 매크로(VBA), 그림 (텍스트만)
- **테스트**: 공공데이터포털 .xls 샘플 5건

#### F1-2. DOC (Word OLE2) 파서 — 선택
- **모듈 경로**: `src/doc/parser.ts`
- **포맷**: Word 97-2003 (.doc), CFB+FIB+CHP/PAP
- **두 가지 전략**:
  - A) 순수 JS 파싱 (FIB·PieceTable·CharStream 직접 디코딩) — 정확도 낮음
  - B) **LibreOffice headless 폴백** (`soffice --headless --convert-to docx`) — 정확도 높음, 외부 의존
- **결정**: B 채택, A는 v3.1+ 검토
- **A 미채택 사유**: ROI 낮음 (DOC 사용률 < 5%)

#### F1-3. Print-Ready 출력
- **모듈 경로**: `src/print/renderer.ts`
- **출력 옵션**:
  - PDF (puppeteer-core 또는 기존 markdown→pdf 파이프)
  - HTML (인쇄 대화상자용 임시 파일)
- **프리셋**:
  - `default` — A4, 여백 2cm, 본문 11pt
  - `gov-formal` — 휴먼명조 시뮬레이션, 머리글/바닥글, 페이지번호
  - `compact` — 여백 1cm, 9pt (참고자료용)

---

### 3.2 Layer 2 — kordoc-ai RPC 확장

#### F2-1. 신규 RPC 메서드 (6개)
| 메서드 | 파라미터 | 반환 | 설명 |
|--------|----------|------|------|
| `print_files` | `files: string[], printer?: string, preset?: string, copies?: number` | `{queued: number, jobIds: string[]}` | 다중 파일 인쇄 큐잉 |
| `list_printers` | `-` | `Printer[]` | 시스템 프린터 목록 |
| `convert_to_pdf` | `input_path, output_path, preset?` | `{path, pages}` | MD/HWP/HWPX → PDF |
| `mask_pii` | `input_path, output_path, types[]` | `{maskedCount, fields[]}` | 주민번호·전화·계좌 마스킹 |
| `apply_template` | `template_id, fields, output_path` | `{path}` | 시행문/보고서 템플릿 채우기 |
| `add_watermark` | `input_path, output_path, text, opacity` | `{path}` | 워터마크 PDF 생성 |

#### F2-2. 진행률 토스트
- **요구**: 우클릭 → 백그라운드 작업 시 시스템 트레이 토스트로 진행률 표시
- **구현**: Tauri tray + notification + progress notification(JSON-RPC)

#### F2-3. 공공기관 템플릿 라이브러리
- 시행문 (제목/수신/참조/본문/붙임)
- 회의록 (일시/장소/참석자/안건/결정사항)
- 출장보고서, 기안문, 공고문 — 총 6종

---

### 3.3 Layer 3 — kordoc-shell (신규 프로젝트)

#### F3-1. MSIX Sparse Package
- **목적**: registry 직접 수정 없이 컨텍스트 메뉴 등록
- **요건**: Windows 10 1809+ (지방관공서 대다수 충족)
- **구성**:
  - `AppxManifest.xml` — Identity, Application, Extensions
  - `Microsoft.Registry.xml` — `desktop:FileExplorerContextMenus`
- **서명**: 자체 서명(개발) / EV 코드사인(배포)

#### F3-2. 컨텍스트 메뉴 구조
**단일 파일 (확장자별)**:
```
HWP/HWPX/DOCX/PDF/XLSX/XLS/DOC 우클릭
└─ KorDoc ▶
   ├─ 📄 마크다운으로 변환
   ├─ 📕 PDF로 변환
   ├─ 📘 HWPX로 변환 (역변환)        ← MD/HTML 입력 시
   ├─ 🤖 AI 요약
   ├─ 🔍 정합성 검사
   ├─ 📊 표만 추출 (XLSX)
   ├─ 🔒 개인정보 마스킹
   └─ ⚙️ KorDoc 앱 열기...
```

**다중 선택 (2개+)**:
```
다중선택 우클릭
└─ KorDoc ▶
   ├─ 📦 일괄 변환 → MD/PDF/HWPX...
   ├─ 🖨️ 일괄 인쇄
   ├─ 🔗 하나로 병합
   ├─ 📋 양식 일괄 추출
   └─ ⚖️ 두 파일 비교 (정확히 2개 선택 시)
```

#### F3-3. Verb Handler 동작
- **단일 파일**: `kordoc://convert?path=<file>&action=md`
- **다중**: 임시 manifest 파일 생성 → `kordoc://batch?manifest=<path>`
- **수신**: kordoc-ai Tauri 앱 deep-link 핸들러 (`single-instance` 플러그인 활용)

#### F3-4. 인쇄 큐 디스패처
- **흐름**: 다중파일 → 각각 PDF 변환 → `ShellExecuteW(verb="print")` 큐잉
- **옵션**: 프린터 선택, 부수, 양면, 흑백
- **에러 핸들링**: 변환 실패 파일 스킵 + 토스트 알림

---

## 4. 비기능 요구사항 (Non-Functional)

| 항목 | 목표 | 측정 |
|------|------|------|
| **응답성** | 우클릭 메뉴 표시 < 50ms | shell ext init 시간 |
| **변환 속도** | XLS 1MB < 2s, PDF 50p < 5s | 벤치마크 |
| **메모리** | sidecar idle < 200MB | 모니터링 |
| **호환성** | Windows 10 1809+ / 11 | MSIX 요구사항 |
| **보안** | 로컬 처리 기본, AI는 옵트인 | 설정 UI |
| **개인정보** | PII 자동 검출 + 동의 후 전송 | 로깅 |

---

## 5. 구현 로드맵 (Implementation Roadmap)

### 📌 Phase 1: 코어 갭 메우기 (2주, kordoc 본체)
**목표**: XLS 파싱 + 인쇄용 PDF 출력 기반 마련

| Week | Task | 산출물 |
|------|------|--------|
| W1 D1-2 | BIFF8 레코드 명세 조사, 테스트 샘플 수집 | `docs/biff8-spec.md` |
| W1 D3-5 | `src/xls/record.ts` (BIFF 레코드 리더) | 단위 테스트 통과 |
| W2 D1-3 | `src/xls/parser.ts` (시트→IRBlock) | 5건 샘플 변환 검증 |
| W2 D4 | `src/detect.ts` 분기 추가, `parse()` 자동 라우팅 | 통합 테스트 |
| W2 D5 | `src/print/renderer.ts` PDF 출력 | MD→PDF 검증 |

**완료 기준**:
- [ ] 공공데이터포털 XLS 5건 정상 변환
- [ ] `parse(buffer)` 자동 감지 동작
- [ ] MD → PDF 변환 1초 내
- [ ] kordoc v2.7.0 npm 배포

### 📌 Phase 2: MSIX Shell Extension PoC (2주, 신규 프로젝트)
**목표**: 우클릭 메뉴 등록 + deep-link 호출

| Week | Task | 산출물 |
|------|------|--------|
| W1 D1-2 | `kordoc-shell` 레포 생성, AppxManifest 작성 | 빌드 가능 패키지 |
| W1 D3-4 | 단일 파일 메뉴 4개 (변환·요약·인쇄·앱열기) | 우클릭 동작 |
| W1 D5 | 자체서명 + 로컬 설치 스크립트 | `install.ps1` |
| W2 D1-2 | kordoc-ai에 deep-link 핸들러 추가 | `kordoc://` 수신 |
| W2 D3-4 | `print_files` / `list_printers` RPC 구현 | 인쇄 동작 |
| W2 D5 | 토스트 진행률 + tray 아이콘 | UX 검증 |

**완료 기준**:
- [ ] 탐색기에서 .hwp 우클릭 → 변환 메뉴 표시 < 100ms
- [ ] deep-link로 kordoc-ai 호출 + 변환 완료
- [ ] 인쇄 큐잉 5개 파일 동시 처리

### 📌 Phase 3: 다중선택 + 일괄 처리 (3주)
| Week | Task | 산출물 |
|------|------|--------|
| W1 | 다중선택 verb handler (manifest 파일 방식) | N개 파일 처리 |
| W2 | 일괄 변환 UI (출력 형식 선택, 진행률) | UI 완성 |
| W3 | 일괄 인쇄 + 병합 + 양식추출 | 통합 테스트 |

### 📌 Phase 4: 공공기관 특화 (3주, 선택)
| Week | Task |
|------|------|
| W1 | PII 마스킹 (정규식 + AI 검토) |
| W2 | 6종 템플릿 + 워터마크 |
| W3 | DOC 폴백 (LibreOffice headless) |

---

## 6. 기술 의사결정 로그 (Decision Log)

### D1. Shell 통합 방식
- **선택**: MSIX Sparse Package
- **사유**: registry 오염 없음, 언인스톨 깔끔, Win10 1809+ 호환
- **대안 기각**: COM Shell Extension (복잡), Registry-only (다중선택 약함)

### D2. DOC 파싱 전략
- **선택**: LibreOffice headless 폴백
- **사유**: 순수 JS DOC 파싱 ROI 낮음, DOC 사용률 < 5%
- **재검토**: v3.1+

### D3. 인쇄 엔진
- **선택**: PDF 변환 → ShellExecute "print" 시스템 호출
- **사유**: 드라이버 호환성 보장, 구현 단순
- **대안 기각**: PDFium 직접 인쇄 (드라이버별 이슈)

### D4. 코드사인
- **개발**: 자체서명
- **배포**: EV 코드사인 (연 약 50만원) 또는 Microsoft Store
- **결정 시점**: Phase 2 종료

### D5. AI 기능 격리
- **원칙**: 기본 비활성, 사용자 옵트인 시에만 외부 전송
- **이유**: 공공기관 보안 정책 (대외비 문서 외부 전송 금지)

---

## 7. 리스크 및 완화

| 리스크 | 영향 | 완화 |
|--------|------|------|
| **XLS 한글 인코딩 깨짐** | 중 | CP949+UTF16LE 양쪽 디코딩 시도, fallback 체인 |
| **MSIX 자체서명 경고** | 고 | 배포 전 EV 코드사인 확보 |
| **다중선택 N=수백 처리** | 중 | sidecar Semaphore(max=2) 활용, 큐 기반 |
| **공공기관 보안 정책 거부** | 고 | 100% 로컬 모드 보장, 감사로그 옵션 |
| **deep-link 길이 제한** | 저 | manifest 파일 방식으로 우회 |

---

## 8. 다음 세션 시작 가이드 (Phase 1 착수)

### 8.1 환경 확인
```bash
cd d:/AI_Project/kordoc
git status            # main 브랜치 깨끗한지
npm install
npm run build         # 현재 v2.6.2 빌드 통과 확인
npm test
```

### 8.2 Phase 1 첫 작업
1. **샘플 수집**: 공공데이터포털에서 XLS 5건 다운 → `tests/fixtures/xls/`
2. **BIFF8 명세 정리**: Microsoft MS-XLS 스펙 요약을 `docs/biff8-spec.md`에 기록
3. **레코드 리더 골격**: `src/xls/record.ts` — `cfb-lenient`로 OLE2 → "Workbook" 스트림 추출
4. **테스트 우선**: `tests/xls.test.ts` 작성 (RED) → 구현 → GREEN

### 8.3 참고 레퍼런스
- BIFF8 스펙: [MS-XLS]
- SheetJS 소스: github.com/SheetJS/sheetjs (BIFF 디코더 참고용)
- 기존 cfb 활용: `src/hwp5/cfb-lenient.ts`

### 8.4 컨텍스트 복원
다음 세션 시작 시:
```
"PRD.md 기반 Phase 1 시작. 
먼저 docs/PRD.md 읽고, 
.claude/memory/activeContext.md 확인 후 
W1 D1-2부터 진행해."
```

---

## 9. 변경 이력
| 날짜 | 변경 | 작성자 |
|------|------|--------|
| 2026-04-29 | 초안 작성 (3-Layer 아키텍처, 4 Phase 로드맵) | chris |
