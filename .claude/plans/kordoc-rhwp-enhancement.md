# kordoc HWP/HWPX 파싱 강화 계획

rhwp(Rust+WASM HWP 뷰어/에디터)의 역공학 결과를 참조하여 kordoc의 HWP/HWPX 파싱 품질을 100%로 끌어올림.

**참조**: https://github.com/edwardkim/rhwp (MIT, 별 188, 100K+ LOC)
**kordoc**: v2.0.2 (npm 배포 완료)

---

## Phase 1~4: 완료 (kordoc v2.0.2)

### Phase 1: 배포용 문서 복호화 ✅
- `src/hwp5/aes.ts` — AES-128 ECB 순수 JS (NIST 벡터 검증)
- `src/hwp5/crypto.ts` — MSVC LCG + XOR → AES 키 추출 → ViewText 복호화
- `src/hwp5/parser.ts` — FLAG_DISTRIBUTION(bit 2) 감지 → ViewText 자동 전환
- **E2E 검증**: 광진구청 배포용 HWP (587KB) → 4,186자 마크다운 완벽 변환
- **핵심 교훈**: XOR 루프는 i=0부터 시작해야 함 (i<4에서도 n 카운터 소비, XOR만 스킵)

### Phase 2: Lenient CFB 파서 ✅
- `src/hwp5/cfb-lenient.ts` — 손상 CFB 수동 파싱 (FAT/미니스트림/순환감지)
- strict `cfb` npm 실패 시 자동 폴백 + `LENIENT_CFB_RECOVERY` 워닝

### Phase 3: PARA_TEXT 제어문자 정밀화 ✅
- rhwp 기준 3-카테고리 분류: char(2B) / inline(16B) / extended(16B)
- 0x000A → extended (기존 char 잘못 분류 수정)
- 0x0018 → U+00A0, 0x0019 → 고정폭 공백

### Phase 4: HWP5 각주/미주/하이퍼링크 ✅
- fn/en CTRL_HEADER → 각주/미주 본문 텍스트 추출
- %tok/klnk → 하이퍼링크 URL 추출 (UTF-16LE 패턴 스캔)

**실적**: +1,227줄 신규, 테스트 20개 추가, 전체 66/66 통과

---

## 소규모 개선: 완료 (kordoc-ai)

### kordoc 의존성 npm 전환 ✅
- `"kordoc": "link:..."` → `"kordoc": "^2.0.2"` (npm 배포판)

### HWPX COM 폴백 ✅
- COM(pyhwpx) 실패 시 kordoc 마크다운 병합으로 자동 전환
- `concatHwpxWithFallback()` in `node-sidecar/src/core/merge/index.ts`
- 사용자에게 `warnings` 필드로 폴백 사실 + 서식 미보존 안내

---

## Phase 5: HWPX 네이티브 병합 (미착수)

**목표**: COM 자동화 대신 ZIP+XML 직접 병합으로 전환 — 크로스플랫폼, 의존성 제로
**참조**: rhwp `src/serializer/` (라운드트립 보존 패턴), concat-xlsx.ts/concat-docx.ts (기존 패턴)
**작업 위치**: `kordoc-ai/node-sidecar/src/core/merge/concat-hwpx-native.ts` (신규)

### 현재 HWPX 병합 문제
1. **COM 의존성**: Windows + 한컴오피스 + Python + pyhwpx 필요
2. **페이지 손실**: 대형 멀티섹션 문서에서 insert_file 한계
3. **스타일 깨짐**: charPrIDRef 범위 밖 (header.xml 미통합)

### 구현 계획

#### 5-1. HWPX ZIP 구조 분석
HWPX는 OPC(ZIP) 포맷:
```
mimetype
META-INF/container.xml
Contents/
  content.hpf          ← EPUB 스타일 manifest (section 순서)
  header.xml           ← 스타일 정의 (charPr, paraPr, borderFill 등)
  section0.xml         ← 본문 페이지
  section1.xml
  ...
BinData/               ← 이미지 등 바이너리
```

#### 5-2. header.xml 스타일 통합
- 두 문서의 charPr/paraPr/borderFill 배열을 통합
- **정규화 후 중복 제거** (concat-xlsx.ts `mergeXlsxStyles()` 패턴 차용)
- 충돌 시 두 번째 문서의 ID를 재할당
- 리매핑 테이블 생성: `{ charPr: Map<old, new>, paraPr: Map<old, new>, ... }`

#### 5-3. section XML 참조 리매핑
- 모든 `charPrIDRef`, `paraPrIDRef`, `borderFillIDRef` 등을 리매핑
- 정규식 기반 속성값 치환 (concat-docx.ts 패턴)

#### 5-4. content.hpf manifest 통합
- 두 문서의 section 목록을 순서대로 합침
- `secCnt` 속성 갱신

#### 5-5. BinData 통합
- 파일명 충돌 시 리네임 (`image001.png` → `image001_2.png`)
- section XML 내 이미지 참조 경로 갱신
- 내용 해시로 중복 제거 (선택)

#### 5-6. 미지원 요소 보존
- 파싱 대상이 아닌 XML 요소/속성은 원본 그대로 유지
- rhwp 철학: "모르는 건 건드리지 않음"

#### 5-7. 출력 + 검증
- 병합된 ZIP을 .hwpx로 저장
- 한컴에서 열리는지 수동 검증
- 자동: 스타일 ID 범위 검증 + section 수 일치 확인

### 기술 참고
- **XLSX 스타일 병합** (`concat-xlsx.ts:125-338`): 정규화+중복제거+리매핑 패턴의 모범 구현
- **DOCX 스타일 병합** (`concat-docx.ts:68-136`): 충돌 시 rename+crossref 업데이트
- **rhwp serializer**: raw_stream 보존으로 미지원 데이터 무손실 통과

### 예상 규모
| 항목 | 줄 수 |
|------|-------|
| concat-hwpx-native.ts (신규) | ~400줄 |
| index.ts 라우터 수정 | ~20줄 |
| 테스트 | ~150줄 |
| **합계** | **~570줄** |

### 우선순위: 중간
- COM 폴백이 작동하므로 긴급하지 않음
- 크로스플랫폼 배포 시 필수 (macOS/Linux 지원)
- 대형 문서 병합 품질 개선에 필요

---

## Phase 6: 추가 개선 (여유 시)

| 항목 | 영향도 | 난이도 | 참조 |
|------|--------|--------|------|
| DocInfo 추가 태그 (BorderFill, TabDef 등) | 중 | 중 | rhwp `doc_info.rs` |
| WMF → PNG/SVG 변환 | 낮 | 높 | rhwp `wmf.rs` |
| 표 계산식 엔진 (22개 함수) | 낮 | 중 | rhwp 표 엔진 |
| 수식 텍스트 추출 (한컴 → LaTeX) | 낮 | 높 | rhwp `equation.rs` |

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-05 | 최초 계획 수립 (Phase 1-6) |
| 2026-04-05 | Phase 1-4 구현 완료, kordoc v2.0.2 배포 |
| 2026-04-05 | 소규모 개선: npm 전환 + HWPX COM 폴백 |
| 2026-04-05 | Phase 5 상세 계획 업데이트 (XLSX/DOCX 패턴 참조) |
