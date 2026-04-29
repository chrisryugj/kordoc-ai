# KorDoc Suite 구현 로드맵 (체크리스트)

> Phase별 상세 체크리스트. PRD.md와 함께 참조.
> **상태 표기**: ⬜ 대기 / 🟡 진행 / ✅ 완료 / ❌ 보류

---

## 🚀 Phase 1: 코어 갭 메우기 (kordoc v2.7.0)

**기간**: 2주 | **레포**: `d:/AI_Project/kordoc` | **브랜치**: `feat/xls-and-print`

### W1 D1-2: 사전 준비
- ⬜ 공공데이터포털에서 XLS 샘플 5건 다운로드
  - 위치: `tests/fixtures/xls/`
  - 후보: 인구통계, 예산서, 시설현황, 인사명단, 회의록
- ⬜ MS-XLS BIFF8 스펙 요약 문서 작성
  - 파일: `docs/biff8-spec.md`
  - 내용: 레코드 종류, SST, BoundSheet, Cell records, EOF
- ⬜ 기존 `src/hwp5/cfb-lenient.ts` 재사용 가능성 검토
- ⬜ SheetJS 소스에서 BIFF 디코더 부분 참고 (라이선스 확인)

### W1 D3-5: BIFF8 레코드 리더
- ⬜ `src/xls/record.ts` 작성
  - OLE2 → "Workbook" 또는 "Book" 스트림 추출
  - 레코드 헤더(opcode 2byte + length 2byte) 파싱
  - SST 디코딩 (CONTINUE 레코드 처리)
- ⬜ 한글 인코딩 디코더
  - CP949 / UTF-16LE / Compressed Unicode (1byte/char) 분기
- ⬜ 단위 테스트 `tests/xls-record.test.ts`

### W2 D1-3: XLS Parser → IRBlock
- ⬜ `src/xls/parser.ts` 작성
  - 시트별 셀 → `IRTable` (XLSX와 동일 구조)
  - 병합 셀 (MERGEDCELLS 레코드)
  - 날짜 직렬값 → ISO 문자열
- ⬜ `src/types.ts`에 `FileType` 'xls' 추가
- ⬜ `src/detect.ts`
  - OLE2 + Workbook 스트림 존재 → 'xls'
  - HWP5 OLE2와 구분 (FileHeader 스트림 vs Workbook)
- ⬜ `src/index.ts` `parse()` 분기 추가

### W2 D4: 통합
- ⬜ 5건 샘플 변환 검증 (시각 비교)
- ⬜ CLI 테스트: `kordoc convert sample.xls`
- ⬜ MCP 도구에서도 동작 확인

### W2 D5: Print Renderer
- ⬜ `src/print/renderer.ts` 작성
  - `mdToPdf(markdown, preset)` 함수
  - puppeteer-core 또는 markdown-it + html2pdf 검토
- ⬜ 프리셋 3종 (`default`, `gov-formal`, `compact`)
- ⬜ CSS 임베딩 (Pretendard / 휴먼명조 시뮬)

### Phase 1 완료 기준
- ⬜ 5건 XLS 모두 정상 변환 (수치/한글/병합)
- ⬜ `parse()` 자동 라우팅 (XLS↔HWP5 OLE2 구분 정확)
- ⬜ MD→PDF 1초 이내
- ⬜ npm publish v2.7.0
- ⬜ kordoc-ai에서 신버전 통합 테스트

---

## 🪟 Phase 2: MSIX Shell Extension (2주)

**기간**: 2주 | **레포**: `d:/AI_Project/kordoc-shell` (신규) + `kordoc-ai`

### W1 D1: 프로젝트 셋업
- ⬜ `kordoc-shell` 신규 레포 생성
- ⬜ Windows SDK / MSIX Packaging Tool 설치
- ⬜ 디렉토리 구조
  ```
  kordoc-shell/
  ├── manifest/AppxManifest.xml
  ├── manifest/Microsoft.Registry.xml
  ├── assets/icons/
  ├── scripts/build.ps1
  ├── scripts/sign.ps1
  └── scripts/install-dev.ps1
  ```

### W1 D2: AppxManifest 작성
- ⬜ Identity (Name, Publisher, Version)
- ⬜ Application 노드 (DisplayName, Description)
- ⬜ Extensions
  - `windows.fileTypeAssociation` (.hwp/.hwpx/.pdf/.xlsx/.docx/.xls/.doc)
  - `desktop:FileExplorerContextMenus`
  - `windows.protocol` (`kordoc://`)

### W1 D3-4: 컨텍스트 메뉴 4개 (단일 파일)
- ⬜ "마크다운으로 변환" → `kordoc://convert?path=%1&action=md`
- ⬜ "PDF로 변환" → `kordoc://convert?path=%1&action=pdf`
- ⬜ "AI 요약" → `kordoc://summarize?path=%1`
- ⬜ "KorDoc 앱 열기" → `kordoc://open?path=%1`

### W1 D5: 빌드 & 자체서명
- ⬜ `MakeAppx.exe pack` 빌드
- ⬜ PowerShell `New-SelfSignedCertificate`
- ⬜ `SignTool sign` 적용
- ⬜ 로컬 PC `Add-AppxPackage` 설치 검증

### W2 D1-2: kordoc-ai deep-link 핸들러
- ⬜ Tauri `single-instance` 플러그인 추가
- ⬜ `src-tauri/src/lib.rs` deep-link 수신
- ⬜ 프론트엔드 라우팅: `kordoc://convert?...` → 변환 작업 시작
- ⬜ manifest 파일 방식 (다중 파일용) 프로토콜 정의

### W2 D3-4: 인쇄 RPC 구현
- ⬜ `node-sidecar/src/core/print/index.ts` 신규
- ⬜ `print_files` RPC
  - 입력 파일 → PDF 변환 (kordoc print renderer)
  - `child_process.execFile('rundll32', ['shell32.dll,ShellExec_RunDLL', '/p', pdfPath])`
- ⬜ `list_printers` RPC
  - WMIC 또는 PowerShell `Get-Printer`
- ⬜ Vitest 테스트 추가

### W2 D5: UX 마무리
- ⬜ Tauri tray 아이콘
- ⬜ 변환 진행률 토스트 (시스템 알림)
- ⬜ 에러 알림 (변환 실패 파일명 표시)

### Phase 2 완료 기준
- ⬜ 탐색기 우클릭 → KorDoc 메뉴 표시 < 100ms
- ⬜ 4개 메뉴 모두 deep-link 통해 kordoc-ai 호출
- ⬜ 5개 파일 동시 인쇄 큐잉
- ⬜ MSIX 패키지 자체서명 + 로컬 설치 가능

---

## 📦 Phase 3: 다중선택 + 일괄 처리 (3주)

### W1: 다중선택 Verb Handler
- ⬜ Windows 다중선택 동작 조사 (verb 호출이 N번 반복됨)
- ⬜ 회피 전략: 첫 호출에서 lock 파일 + 200ms debounce → manifest 생성
- ⬜ manifest JSON 포맷 정의
  ```json
  { "action": "batch_convert", "files": ["..."], "options": {...} }
  ```
- ⬜ kordoc-ai `kordoc://batch?manifest=<path>` 핸들러

### W2: 일괄 변환 UI
- ⬜ React 컴포넌트 `BatchPanel.tsx`
- ⬜ 출력 형식 선택 (MD/PDF/HWPX)
- ⬜ 진행률 바 (파일별 + 전체)
- ⬜ 실패 항목 별도 리스트

### W3: 일괄 인쇄 + 병합 + 양식
- ⬜ 일괄 인쇄: 프린터 선택, 부수, 양면 옵션
- ⬜ 일괄 병합: 기존 `merge_files` RPC 재활용
- ⬜ 일괄 양식 추출: 기존 `form_extract_batch` 재활용
- ⬜ 두 파일 비교 메뉴 (정확히 2개 선택 시)

### Phase 3 완료 기준
- ⬜ 50개 파일 다중선택 → 일괄 변환 성공
- ⬜ 인쇄 큐 정상 동작
- ⬜ 진행률 토스트 정확

---

## 🏛️ Phase 4: 공공기관 특화 (3주, 선택)

### W1: PII 마스킹
- ⬜ 정규식 라이브러리: 주민번호/전화/계좌/이메일/카드번호
- ⬜ `src/pii/detector.ts` (kordoc 본체)
- ⬜ AI 검토 옵션 (Gemini로 false positive 제거)
- ⬜ `mask_pii` RPC

### W2: 템플릿 + 워터마크
- ⬜ 6종 템플릿 (시행문/회의록/출장보고서/기안문/공고문/계획서)
- ⬜ HWPX 템플릿 파일 + 필드 매핑
- ⬜ `apply_template` RPC
- ⬜ 워터마크: PDF에 텍스트 오버레이 (대외비/사본금지)

### W3: DOC 폴백
- ⬜ LibreOffice headless 감지 + 설치 가이드
- ⬜ `src/doc/parser.ts` (soffice 래핑)
- ⬜ 변환 실패 시 fallback 체인

---

## 📊 진행 상태 추적

각 Phase 완료 시:
1. 본 파일 체크박스 업데이트
2. `.claude/memory/activeContext.md` 갱신
3. PRD.md 변경 이력 추가
4. 태그 + npm publish

---

## 🔗 관련 문서
- [PRD.md](./PRD.md) — 제품 요구사항
- [biff8-spec.md](./biff8-spec.md) — Phase 1 작업 시 작성
- [.claude/memory/activeContext.md](../.claude/memory/activeContext.md) — 세션 컨텍스트
