# 문서 파서 전수조사 보고서

> **작성일**: 2026-03-28
> **대상**: lexdiff, korean-law-mcp, hwp2html, meari-contents, edu-facility-ai
> **목적**: 5개 프로젝트에 산재한 문서 파서들을 전수조사하여, 포맷별 최상 버전을 선정하고 개선 방향을 제시

---

## 1. 요약 (Executive Summary)

5개 프로젝트에서 총 **38개 파서** (약 12,300 LOC)를 발견했다. 포맷별로 2~5개의 독립 구현이 존재하며, **코드 복제·기능 격차·품질 편차**가 상당하다.

### 포맷별 구현 현황

| 포맷 | 구현 수 | 최상 버전 | 비고 |
|------|---------|-----------|------|
| **HWPX** | 5개 | lexdiff/korean-law-mcp (TS) | 테이블 처리 최고, edu-facility-ai에 손상ZIP 복구 |
| **HWP5 (binary)** | 4개 | lexdiff/korean-law-mcp (TS) | 유일한 크로스플랫폼 바이너리 파서 |
| **PDF (텍스트)** | 5개 | edu-facility-ai (Python) | PyMuPDF find_tables()가 pdfjs-dist보다 우수 |
| **PDF (OCR)** | 2개 | edu-facility-ai (Python) | Gemini Vision 정확도↑, meari-contents PaddleOCR 오프라인↑ |
| **XML (법률)** | 6개 | lexdiff (TS) | 809줄 모놀리스 → 리팩토링 필요 |
| **Markdown** | 3개 | edu-facility-ai (Python) | DOCX 변환까지 포함 |

### 핵심 발견

1. **lexdiff ↔ korean-law-mcp**: HWPX/HWP5/PDF/테이블빌더 **4개 파일이 100% 동일 코드 복제**
2. **edu-facility-ai ← meari-contents**: HWPX 파서가 meari-contents 기반 (주석에 명시)이나, 손상ZIP 복구만 가져옴
3. **hwp2html**: 가장 단순한 HWPX 파서 (35줄), 하이퍼링크 추출이 유일한 장점
4. **테이블 처리**: TS 프로젝트의 2-pass colSpan/rowSpan이 Python 프로젝트보다 월등히 정교

---

## 2. 포맷별 상세 비교

### 2.1 HWPX 파서

#### 구현 비교표

| 프로젝트 | 언어 | LOC | 매니페스트 | 테이블 | 중첩테이블 | colSpan/rowSpan | 손상ZIP 복구 | 하이퍼링크 |
|----------|------|-----|-----------|--------|-----------|----------------|-------------|-----------|
| **lexdiff** | TS | 197 | ✅ OPF spine | ✅ Markdown | ✅ stack | ✅ 2-pass grid | ❌ | ❌ |
| **korean-law-mcp** | TS | 197 | ✅ OPF spine | ✅ Markdown | ✅ stack | ✅ 2-pass grid | ❌ | ❌ |
| **hwp2html** | TS | 35 | ❌ glob only | ❌ | ❌ | ❌ | ❌ | ✅ HYPERLINK |
| **meari-contents** | Python | 765 | ❌ prefix only | ✅ Markdown | ❌ | ❌ | ✅ Local Header | ❌ |
| **edu-facility-ai** | Python | 274 | ❌ prefix+fallback | ✅ Markdown | ❌ | ❌ | ✅ Local Header | ❌ |

#### 최상 버전: **lexdiff/korean-law-mcp** (+ edu-facility-ai 손상ZIP 복구)

**이유:**
- **OPF manifest → spine 순서 해석**으로 정확한 섹션 순서 보장
- **2-pass colSpan/rowSpan 알고리즘**이 병합 셀 처리에서 유일하게 올바른 결과
- **중첩 테이블 스택**으로 표 안의 표까지 처리
- **namespace 스트리핑** (`hp:p` → `p`)이 견고

**부족한 점 (타 프로젝트에서 가져올 것):**
- edu-facility-ai의 **손상 ZIP 복구** (Local File Header 바이너리 스캔)
- hwp2html의 **하이퍼링크 추출** (fieldBegin/fieldEnd 상태머신)

#### 이상적 합성 코드 (TypeScript)

```typescript
// 최상 HWPX 파서 = lexdiff 기반 + 손상ZIP 복구

// [1] lexdiff/korean-law-mcp의 manifest + 테이블 처리 그대로 사용
export async function parseHwpxDocument(buffer: ArrayBuffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer)
    const sectionPaths = await resolveSectionPaths(zip)
    // ... (기존 lexdiff 코드)
  } catch (e) {
    // [2] edu-facility-ai에서 가져온 손상 ZIP 복구
    return extractFromBrokenZip(buffer)
  }
}

// [3] hwp2html에서 가져온 하이퍼링크 추출 (extractParagraphText에 통합)
function extractParagraphText(para: any): string {
  // ... 기존 t/tab/br/fwSpace 처리 +
  // case "fieldBegin": if HYPERLINK → 링크 시작
  // case "fieldEnd": 링크 종료 → [text](url)
}
```

---

### 2.2 HWP5 (바이너리) 파서

#### 구현 비교표

| 프로젝트 | 언어 | LOC | 접근법 | UTF-16LE | 암호화 감지 | 압축 해제 | 테이블 | 크로스플랫폼 |
|----------|------|-----|--------|----------|-----------|----------|--------|-------------|
| **lexdiff** | TS | 315 | CFB + Record | ✅ 21 ctrl codes | ✅ DRM 감지 | ✅ zlib+raw | ✅ rowSpan/colSpan | ✅ |
| **korean-law-mcp** | TS | 320 | CFB + Record | ✅ 21 ctrl codes | ✅ DRM 감지 | ✅ zlib+raw | ✅ rowSpan/colSpan | ✅ |
| **meari-contents** | Python | ~150 | olefile + struct | ✅ 14 ctrl codes | ✅ flag 0x02 | ✅ zlib | ❌ | ✅ |
| **edu-facility-ai** | Python | 235 | **pyhwpx COM** | N/A (COM) | N/A | N/A | COM 의존 | ❌ Windows |

#### 최상 버전: **lexdiff/korean-law-mcp** (TypeScript)

**이유:**
- CFB 라이브러리로 **OLE2 컨테이너를 직접 파싱** (COM 불필요)
- **21가지 제어 문자** 완전 처리 (meari-contents는 14가지만)
- **DRM/암호화 사전 감지**로 무한 루프 방지
- zlib 헤더(0x78) 검사 + **raw deflate 폴백** = 압축 해제 성공률 높음
- **크로스플랫폼**: Node.js/Bun/Deno 어디서든 동작 (pyhwpx는 Windows+한컴 필수)

**Python 프로젝트 교훈:**
- edu-facility-ai의 COM 방식은 **Windows 전용이라 배포에 치명적 제약**
- meari-contents의 Python 바이너리 파서가 유일한 크로스플랫폼 Python 구현이나, 제어 문자 처리가 불완전

#### 핵심 코드 스니펫 (UTF-16LE 텍스트 추출)

```typescript
// lexdiff/korean-law-mcp: hwp5-record.ts
export function extractText(data: Buffer): string {
  let result = ""
  let i = 0
  while (i + 1 < data.length) {
    const ch = data.readUInt16LE(i)
    i += 2
    switch (ch) {
      case 0x0000: result += "\n"; break    // 줄바꿈
      case 0x000d: break                     // 문단 끝 (무시)
      case 0x0009: result += "\t"; break     // 탭
      case 0x001e: result += "-"; break      // 하이픈
      case 0x001f: case 0x0018: result += " "; break  // NBSP
      default:
        if (ch >= 0x0001 && ch <= 0x001f) {
          // 확장/인라인 제어 문자: 14바이트 스킵
          const isExt = (ch >= 1 && ch <= 3) || (ch >= 11 && ch <= 18) || (ch >= 21 && ch <= 23)
          const isInline = (ch >= 4 && ch <= 9) || (ch >= 19 && ch <= 20)
          if ((isExt || isInline) && i + 14 <= data.length) i += 14
        } else if (ch >= 0x0020) {
          result += String.fromCharCode(ch)
        }
    }
  }
  return result
}
```

---

### 2.3 PDF 텍스트 파서

#### 구현 비교표

| 프로젝트 | 언어 | LOC | 라이브러리 | 테이블 감지 | OCR 감지 | 페이지번호 제거 | 한국어 줄 연결 |
|----------|------|-----|-----------|-----------|---------|---------------|-------------|
| **lexdiff** | TS | 237 | pdfjs-dist | ❌ gap 기반 추정 | ✅ 10자/page | ❌ | ✅ |
| **korean-law-mcp** | TS | 262 | pdfjs-dist | ❌ gap 기반 추정 | ✅ 10자/page | ❌ | ✅ |
| **meari-contents** (PyMuPDF) | Python | 319 | PyMuPDF | ✅ find_tables() | ✅ 30% ratio | ❌ | ❌ |
| **meari-contents** (pdfplumber) | Python | 92 | pdfplumber | ❌ | ❌ | ❌ | ❌ |
| **edu-facility-ai** | Python | 262 | PyMuPDF | ✅ find_tables() | ✅ 30% ratio | ✅ "- N -" | ❌ |

#### 최상 버전: **edu-facility-ai** (Python)

**이유:**
- PyMuPDF의 `find_tables()` API가 **구조적 테이블을 정확히 감지** (pdfjs-dist의 gap 기반 추정보다 우월)
- **비-테이블 영역 분리**: 테이블 bbox와 겹치는 텍스트를 필터링하여 중복 방지
- **페이지 번호 제거**: `"- 1 -"`, `"— 83 —"` 등 한국 문서 관례 처리
- **sparse 텍스트 경고**: 50자 미만 페이지를 경고 → OCR 필요 신호

**TS 프로젝트 교훈:**
- pdfjs-dist의 Y좌표 기반 라인 그룹핑은 **단순 텍스트에는 충분**하나, 테이블이 있으면 셀 경계 오인
- lexdiff의 **한국어 줄 연결 로직** (조사로 끝나는 줄)은 edu-facility-ai에 없음 → 통합 대상

#### 핵심 코드 스니펫 (테이블 분리 추출)

```python
# edu-facility-ai: pdf_text_extractor.py
def _extract_page(page, page_num: int) -> str:
    parts = []

    # 1) 표 추출 (PyMuPDF find_tables)
    try:
        tables = page.find_tables().tables
    except Exception:
        tables = []

    table_rects = set()
    for table in tables:
        table_rects.add(tuple(table.bbox))
        md_table = _table_to_markdown(table)
        if md_table:
            parts.append(md_table)

    # 2) 표 영역 제외한 텍스트
    if not tables:
        parts.append(_clean_extracted_text(page.get_text()))
    else:
        non_table_text = _get_non_table_text(page, table_rects)
        if non_table_text.strip():
            parts.append(_clean_extracted_text(non_table_text))

    return "\n\n".join(parts)
```

---

### 2.4 PDF OCR 파서

#### 구현 비교표

| 프로젝트 | 엔진 | LOC | 오프라인 | 한국어 품질 | 병렬 처리 | 재시도 | 이어하기 |
|----------|------|-----|---------|-----------|----------|--------|---------|
| **meari-contents** | PaddleOCR | 249 | ✅ 로컬 | 보통 | ❌ | ❌ | ❌ |
| **edu-facility-ai** | Gemini Vision | 510 | ❌ API | 우수 | ✅ ThreadPool | ✅ 지수 백오프 | ✅ 완료 페이지 스킵 |

#### 최상 버전: **edu-facility-ai** (품질), **meari-contents** (오프라인)

**edu-facility-ai 장점:**
- Gemini Vision의 한국어 OCR 정확도가 PaddleOCR 대비 **월등히 높음**
- **지수 백오프 재시도** (5회, 10초 base) + 취소 이벤트 지원
- **이어하기**: 완료된 페이지 txt 파일 확인 후 스킵
- **청크 처리**: 20페이지 단위로 메모리 관리
- **Safety filter 처리**: 안전 필터 차단 시 graceful fallback

**meari-contents 장점:**
- **인터넷 불필요** (PaddleOCR 모델 로컬 실행)
- **비용 0원** (API 호출 없음)
- **바운딩 박스 + 신뢰도** 메타데이터 제공

**이상적 조합:**
```
1차: edu-facility-ai Gemini Vision (고품질, API 가용 시)
2차: meari-contents PaddleOCR (오프라인 폴백)
```

---

### 2.5 테이블 빌더 (공유 모듈)

#### 구현 비교표

| 프로젝트 | LOC | colSpan/rowSpan | 중첩 테이블 | 단일셀 특수처리 | 행 중복제거 |
|----------|-----|----------------|-----------|---------------|-----------|
| **lexdiff** | 178 | ✅ 2-pass grid | ✅ 텍스트 변환 | ✅ 구조화 | ✅ |
| **korean-law-mcp** | 179 | ✅ 2-pass grid | ✅ 텍스트 변환 | ✅ 구조화 | ✅ |
| **edu-facility-ai** | ~40 | ❌ 단순 열 맞춤 | ❌ | ❌ | ❌ |
| **meari-contents** | ~30 | ❌ 단순 열 맞춤 | ❌ | ❌ | ❌ |

#### 최상 버전: **lexdiff/korean-law-mcp**

이 모듈은 Python 프로젝트들이 가장 크게 뒤처지는 부분. **2-pass 그리드 알고리즘**이 병합 셀 처리의 핵심:

```typescript
// lexdiff: hwpx-table.ts — 2-pass 셀 배치
export function buildTable(rows: CellContext[][]): IRTable {
  // Pass 1: occupied 그리드로 maxCols 계산
  // Pass 2: 실제 셀을 올바른 위치에 배치
  // → rowSpan/colSpan이 있는 복잡한 표도 정확히 렌더링
}
```

---

## 3. 코드 중복 맵

```
lexdiff ═══════════════════ korean-law-mcp
  │  100% 동일:              │
  │  - hwpx-parser.ts        │
  │  - hwp5-parser.ts        │
  │  - hwp5-record.ts        │
  │  - hwpx-table.ts         │
  │  - pdf-parser.ts          │
  └──────────────────────────┘

meari-contents ──(파생)──→ edu-facility-ai
  hwpx_extractor.py           hwpx_parser.py (주석에 "meari-contents 기반" 명시)
  pdf_extractor.py            pdf_text_extractor.py (거의 동일한 PyMuPDF 패턴)

hwp2html
  └── fileParser.ts (독립 구현, 가장 단순)
```

---

## 4. 포맷별 최상 코드 레퍼런스

### 4.1 HWPX → 텍스트/마크다운

| 요소 | 최상 소스 | 파일 |
|------|----------|------|
| 매니페스트 해석 | lexdiff | `lib/annex-parser/hwpx-parser.ts:27-73` |
| 섹션 XML 워킹 | lexdiff | `lib/annex-parser/hwpx-parser.ts:85-170` |
| 문단 텍스트 추출 | lexdiff | `lib/annex-parser/hwpx-parser.ts:172-197` |
| 테이블 빌드 (2-pass) | lexdiff | `lib/annex-parser/hwpx-table.ts` (전체) |
| 손상 ZIP 복구 | edu-facility-ai | `python-sidecar/src/mvp1_converter/hwpx_parser.py:171-208` |
| 하이퍼링크 추출 | hwp2html | `src/services/fileParser.ts:40-78` |

### 4.2 HWP5 → 텍스트/마크다운

| 요소 | 최상 소스 | 파일 |
|------|----------|------|
| OLE2 컨테이너 해석 | lexdiff | `lib/annex-parser/hwp5-parser.ts` |
| 레코드 바이너리 파싱 | lexdiff | `lib/annex-parser/hwp5-record.ts:readRecords()` |
| UTF-16LE 텍스트 추출 | lexdiff | `lib/annex-parser/hwp5-record.ts:extractText()` |
| 암호화/DRM 감지 | lexdiff | `lib/annex-parser/hwp5-parser.ts` (FileHeader flags) |

### 4.3 PDF → 텍스트/마크다운

| 요소 | 최상 소스 | 파일 |
|------|----------|------|
| 테이블 감지+추출 | edu-facility-ai | `python-sidecar/src/mvp1_converter/pdf_text_extractor.py` |
| 비-테이블 영역 분리 | edu-facility-ai | `pdf_text_extractor.py:_get_non_table_text()` |
| 이미지PDF 감지 | edu-facility-ai | `pdf_text_extractor.py` (30% threshold) |
| Y좌표 라인 그룹핑 | lexdiff | `lib/annex-parser/pdf-parser.ts:groupTextItemsByLine()` |
| 한국어 줄 연결 | lexdiff | `lib/annex-parser/pdf-parser.ts` (조사 감지) |

### 4.4 PDF OCR

| 요소 | 최상 소스 | 파일 |
|------|----------|------|
| AI Vision OCR | edu-facility-ai | `python-sidecar/src/mvp1_converter/ocr_engine.py` |
| 지수 백오프 재시도 | edu-facility-ai | `ocr_engine.py:_analyze_page()` |
| 오프라인 OCR | meari-contents | `scripts/ocr_extract.py` (PaddleOCR) |

---

## 5. 각 프로젝트별 교훈 및 개선 권고

### 5.1 lexdiff / korean-law-mcp

**현재 상태: 가장 정교한 HWPX/HWP5 파서**

| 교훈 | 상세 |
|------|------|
| ✅ 유지 | OPF manifest 해석, 2-pass 테이블 빌더, 중첩 테이블 스택 |
| ⚠️ 추가 필요 | 손상 ZIP 복구 (edu-facility-ai에서 포팅) |
| ⚠️ 추가 필요 | 이미지 기반 PDF에 대한 OCR 폴백 경로 |
| 🔴 코드 중복 | 두 프로젝트의 5개 파일이 100% 동일 → **npm 패키지로 추출** 필요 |
| 🔴 모놀리스 | law-xml-parser.tsx 809줄 → 400줄 이하로 분리 |

### 5.2 hwp2html

**현재 상태: 가장 단순한 HWPX 파서 (35줄)**

| 교훈 | 상세 |
|------|------|
| ✅ 유지 | 하이퍼링크 추출 상태머신 (유일한 구현) |
| 🔴 테이블 없음 | HWPX 테이블을 완전히 무시 → lexdiff 테이블 로직 도입 필요 |
| 🔴 매니페스트 없음 | section glob만 사용 → 멀티섹션 문서에서 순서 보장 불가 |
| ⚠️ 검토 | URL 추출 regex가 한국어 문자를 URL 종료로 오인 (0xAC00-0xD7AF) |

### 5.3 meari-contents

**현재 상태: 가장 폭넓은 포맷 커버리지 (HWPX/HWP/PDF/OCR/DOCX/HTML)**

| 교훈 | 상세 |
|------|------|
| ✅ 유지 | 다중 인코딩 폴백 (UTF-8→CP949→EUC-KR→UTF-16), PaddleOCR 오프라인 |
| ✅ 유지 | 손상 ZIP 복구 (Local File Header 스캔) |
| 🔴 테이블 열등 | 단순 cell text join → colSpan/rowSpan 무시 → 병합 셀 데이터 손실 |
| 🔴 HWP 불완전 | 14가지 제어 문자만 처리 (lexdiff는 21가지) |
| ⚠️ 중복 HWPX | article-converter (765줄) vs document-extractor (374줄) 두 벌 존재 |

### 5.4 edu-facility-ai

**현재 상태: 가장 강력한 PDF 파이프라인 (텍스트+테이블+OCR)**

| 교훈 | 상세 |
|------|------|
| ✅ 유지 | PyMuPDF find_tables() + 비-테이블 분리, Gemini Vision OCR |
| ✅ 유지 | 페이지 번호 제거, sparse 텍스트 경고, 이어하기 |
| 🔴 HWPX 열등 | colSpan/rowSpan 미지원, 중첩 테이블 미지원 |
| 🔴 HWP Windows | pyhwpx COM 방식은 배포에 치명적 → lexdiff 바이너리 파서 Python 포팅 고려 |
| ⚠️ 레거시 | text_extractor.py (pypdf) 제거 필요 (PyMuPDF로 대체 완료) |

---

## 6. 통합 로드맵

### Phase 1: 즉시 (코드 중복 해소)

```
lexdiff의 annex-parser/ 디렉토리를
→ @chrisryugj/doc-parser npm 패키지로 추출
→ lexdiff, korean-law-mcp, (선택적) hwp2html에서 import
```

포함 파일:
- `hwpx-parser.ts` (+ 손상ZIP 복구 추가)
- `hwp5-parser.ts` + `hwp5-record.ts`
- `hwpx-table.ts`
- `pdf-parser.ts`
- `index.ts` (통합 진입점 + magic byte 감지)

### Phase 2: 단기 (기능 격차 해소)

| 작업 | 소스 | 대상 |
|------|------|------|
| 손상 ZIP 복구 | edu-facility-ai | npm 패키지 |
| 하이퍼링크 추출 | hwp2html | npm 패키지 |
| 한국어 줄 연결 | lexdiff PDF | edu-facility-ai PDF |
| HWP5 제어문자 21종 | lexdiff | meari-contents |
| colSpan/rowSpan 테이블 | lexdiff | edu-facility-ai HWPX |

### Phase 3: 중기 (품질 향상)

- TS PDF 파서에 find_tables() 수준의 테이블 감지 추가 (현재 gap 기반)
- 듀얼 OCR 전략: Gemini Vision (1차) → PaddleOCR (오프라인 폴백)
- HWP5 Python 크로스플랫폼 파서 작성 (COM 탈피)

---

## 7. 매직 바이트 감지 코드 (통합 진입점)

모든 프로젝트에서 사용할 수 있는 포맷 자동 감지:

```typescript
// lexdiff annex-parser/index.ts에 이미 구현
export function isHwpxFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0x50 && bytes[1] === 0x4b  // PK (ZIP)
         && bytes[2] === 0x03 && bytes[3] === 0x04
}

export function isOldHwpFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0xd0 && bytes[1] === 0xcf  // OLE2
         && bytes[2] === 0x11 && bytes[3] === 0xe0
}

export function isPdfFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0x25 && bytes[1] === 0x50  // %PDF
         && bytes[2] === 0x44 && bytes[3] === 0x46
}

// Python 동등 구현
def detect_format(filepath: str) -> str:
    with open(filepath, "rb") as f:
        magic = f.read(4)
    if magic == b"PK\x03\x04": return "hwpx"
    if magic == b"\xd0\xcf\x11\xe0": return "hwp5"
    if magic == b"%PDF": return "pdf"
    return "unknown"
```

---

## 8. 의존성 정리

### TypeScript 프로젝트 (lexdiff, korean-law-mcp, hwp2html)

| 라이브러리 | 용도 | 사용 프로젝트 |
|-----------|------|-------------|
| `jszip` | HWPX ZIP 해제 | lexdiff, mcp, hwp2html |
| `@xmldom/xmldom` | XML DOM 파싱 | lexdiff, mcp |
| `cfb` | HWP5 OLE2 컨테이너 | lexdiff, mcp |
| `pdfjs-dist` | PDF 텍스트 추출 | lexdiff, mcp |
| `mammoth` | DOCX → HTML | hwp2html |
| `hwp.js` | HWP 유틸 (미사용?) | lexdiff |

### Python 프로젝트 (meari-contents, edu-facility-ai)

| 라이브러리 | 용도 | 사용 프로젝트 |
|-----------|------|-------------|
| `PyMuPDF (fitz)` | PDF 텍스트+테이블+렌더링 | meari, edu |
| `pdfplumber` | PDF 텍스트 (단순) | meari |
| `pypdf` | PDF 텍스트 (레거시) | edu |
| `pyhwpx` | HWP COM 자동화 | edu (Windows) |
| `olefile` | HWP5 OLE2 (부분) | meari |
| `python-docx` | DOCX 생성 | meari, edu |
| `PaddleOCR` | 오프라인 OCR | meari |
| `google-genai` | Gemini Vision OCR | edu |
| `openpyxl` | Excel 읽기/쓰기 | edu |

---

## 9. 결론

5개 프로젝트를 횡단 분석한 결과, **가장 발전된 파서들은 이미 존재**하나 프로젝트별로 파편화되어 있다.

**즉시 실행 가능한 최고의 투자 대비 효과:**

1. **lexdiff의 annex-parser/를 npm 패키지로 추출** → 3개 TS 프로젝트 코드 중복 해소
2. **edu-facility-ai의 손상ZIP 복구를 TS 패키지에 통합** → HWPX 견고성 대폭 향상
3. **Python 프로젝트에 lexdiff 테이블 빌더 로직 포팅** → 병합 셀 처리 정상화

이 세 작업만으로 전체 파서 생태계의 품질이 한 단계 올라간다.
