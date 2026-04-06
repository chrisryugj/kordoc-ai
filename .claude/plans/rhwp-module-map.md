# rhwp 모듈 맵 (kordoc 파서 개선 참조용)

> 분석 대상: https://github.com/edwardkim/rhwp (Rust, v0.6.0)
> 분석 일시: 2026-04-05
> 총 코드량: ~22,000줄 (parser/serializer/model)

---

## 1. 전체 아키텍처 요약

```
[바이너리 데이터]
     │
     ├─── detect_format() ─── CFB 시그니처(D0 CF 11 E0) → HWP 파서
     │                        ZIP 시그니처(50 4B 03 04) → HWPX 파서
     │
     ├─── HWP 파서 ──────────────────────────────────────────────────
     │    1. CfbReader.open()      → CFB 컨테이너 열기
     │    2. parse_file_header()   → FileHeader(256바이트) 파싱
     │    3. parse_doc_info()      → DocInfo 참조 테이블 구축
     │    4. parse_body_text()     → 섹션별 문단/컨트롤 파싱
     │    5. load_bin_data()       → 이미지/OLE 바이너리 로드
     │    ↓
     │    [Document IR] ← 통합 데이터 모델
     │    ↓
     │    serialize_hwp()          → CFB 컨테이너 재생성 (라운드트립)
     │
     └─── HWPX 파서 ─────────────────────────────────────────────────
          1. HwpxReader.open()     → ZIP 열기
          2. parse_content_hpf()   → 매니페스트(섹션/BinData 목록)
          3. parse_hwpx_header()   → header.xml → DocInfo
          4. parse_hwpx_section()  → section*.xml → Section
          5. BinData 로드          → 이미지 바이너리
          ↓
          [Document IR] (HWP와 동일한 모델)
```

---

## 2. HWP 바이너리 파서 모듈

### 2.1 CFB 컨테이너 읽기

| 파일 | 줄 수 | 핵심 기능 | kordoc 참조 포인트 |
|------|-------|----------|-------------------|
| `src/parser/cfb_reader.rs` | 988 | CFB/OLE 컨테이너 열기, 스트림 추출, 압축 해제 | Lenient 모드 폴백 전략 |

**CfbReader** (strict 모드):
- `cfb` 크레이트 기반 표준 CFB 파서
- 스트림 경로: `/FileHeader`, `/DocInfo`, `/BodyText/Section{N}`, `/ViewText/Section{N}`, `/BinData/BIN{XXXX}.{ext}`, `/PrvImage`, `/PrvText`
- `read_doc_info(compressed)` — compressed 플래그에 따라 자동 deflate 해제
- `read_body_text_section(index, compressed, distribution)` — 배포용 문서 시 ViewText 경로 사용
- `list_streams()`, `list_bin_data()` — 스트림 목록 열거

**LenientCfbReader** (FAT 검증 무시 모드):
- strict CfbReader 실패 시 자동 폴백
- 수동 CFB 헤더 파싱: 섹터 크기, DIFAT, FAT, Directory 직접 파싱
- 순환 방지 HashSet, 미니 스트림/미니 FAT 직접 처리
- **kordoc 참조**: 손상된 HWP 파일에 대한 관용적 파싱 전략

**decompress_stream()**:
- raw deflate (wbits=-15) 먼저 시도 → 실패 시 표준 zlib 재시도
- **kordoc 참조**: HWP는 raw deflate를 사용하므로 zlib 헤더 없이 파싱해야 함

---

### 2.2 FileHeader 파싱

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/parser/header.rs` | 270 | 256바이트 FileHeader 파싱, 버전/플래그 추출 |

**구조 (256바이트)**:
```
[0..31]   시그니처 "HWP Document File" + NULL 패딩
[32..35]  버전: revision(u8), build(u8), minor(u8), major(u8) — LE
[36..39]  속성 플래그 (u32 LE)
[40..255] 예약
```

**FileHeaderFlags 비트맵**:
| 비트 | 플래그 | 설명 |
|------|--------|------|
| 0 | compressed | 바디텍스트/DocInfo 압축 |
| 1 | encrypted | 암호 설정 |
| 2 | distribution | 배포용 문서 |
| 3 | script | 스크립트 저장 |
| 4 | drm | DRM |
| 5 | xml_template | XML 템플릿 |
| 6 | document_history | 이력 관리 |
| 7 | digital_signature | 전자 서명 |
| 8 | public_key_encrypted | 공개키 암호 |
| 9 | modified_certificate | 수정 인증서 |
| 10 | prepare_distribution | 배포 준비 |

---

### 2.3 레코드 파싱

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/parser/record.rs` | 224 | HWP 레코드 헤더(4바이트) 파싱, 레코드 스트림 순차 읽기 |

**레코드 헤더 (4바이트 u32 LE)**:
```
bits [0..9]   태그 ID (0~1023)
bits [10..19] 레벨 (트리 깊이, 0~1023)
bits [20..31] 크기 (0~4094)
크기 == 0xFFF → 확장 크기: 다음 4바이트(u32 LE)가 실제 크기
```

**kordoc 참조 포인트**:
- 확장 크기(0xFFF) 처리 필수 — 4095바이트 이상 레코드
- `Record::read_all()` — 데이터 부족 시 `UnexpectedEof` 에러로 개별 섹션 실패 허용

---

### 2.4 태그 상수 및 컨트롤 ID

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/parser/tags.rs` | 357 | 모든 HWP 태그 ID, 컨트롤 ID, 인라인 컨트롤 코드 정의 |

**DocInfo 태그 (HWPTAG_BEGIN=0x010 기준)**:

| 태그 | 오프셋 | 이름 | 설명 |
|------|--------|------|------|
| 0x010 | +0 | DOCUMENT_PROPERTIES | 섹션 수, 시작 번호 |
| 0x011 | +1 | ID_MAPPINGS | 각 타입별 개수 |
| 0x012 | +2 | BIN_DATA | 바이너리 참조 |
| 0x013 | +3 | FACE_NAME | 글꼴 이름 |
| 0x014 | +4 | BORDER_FILL | 테두리/채우기 |
| 0x015 | +5 | CHAR_SHAPE | 글자 모양 |
| 0x016 | +6 | TAB_DEF | 탭 정의 |
| 0x017 | +7 | NUMBERING | 번호 매기기 |
| 0x018 | +8 | BULLET | 글머리표 |
| 0x019 | +9 | PARA_SHAPE | 문단 모양 |
| 0x01A | +10 | STYLE | 스타일 |
| 0x01B | +11 | DOC_DATA | 문서 데이터 |
| 0x01C | +12 | DISTRIBUTE_DOC_DATA | 배포용 복호화 시드 |
| 0x01E | +14 | COMPATIBLE_DOCUMENT | 호환 문서 |
| 0x01F | +15 | LAYOUT_COMPATIBILITY | 레이아웃 호환성 |
| 0x020 | +16 | TRACKCHANGE | 변경 추적 |

**BodyText 태그**:

| 태그 | 오프셋 | 이름 | 설명 |
|------|--------|------|------|
| 0x042 | +50 | PARA_HEADER | 문단 헤더 |
| 0x043 | +51 | PARA_TEXT | 텍스트 (UTF-16LE) |
| 0x044 | +52 | PARA_CHAR_SHAPE | 글자모양 참조 |
| 0x045 | +53 | PARA_LINE_SEG | 줄 세그먼트 |
| 0x046 | +54 | PARA_RANGE_TAG | 범위 태그 |
| 0x047 | +55 | CTRL_HEADER | 컨트롤 헤더 |
| 0x048 | +56 | LIST_HEADER | 리스트 헤더 |
| 0x049 | +57 | PAGE_DEF | 용지 설정 |
| 0x04A | +58 | FOOTNOTE_SHAPE | 각주/미주 모양 |
| 0x04B | +59 | PAGE_BORDER_FILL | 쪽 테두리 |
| 0x04C | +60 | SHAPE_COMPONENT | 도형 속성 |
| 0x04D | +61 | TABLE | 표 속성 |
| 0x04E~0x055 | +62~69 | SHAPE_* | 직선/사각/타원/호/다각/곡선/OLE/그림 |
| 0x056 | +70 | SHAPE_CONTAINER | 묶음 개체 |
| 0x057 | +71 | CTRL_DATA | 컨트롤 데이터 |
| 0x058 | +72 | EQEDIT | 수식 |
| 0x05A | +74 | SHAPE_TEXTART | 글맵시 |
| 0x05B | +75 | FORM_OBJECT | 양식 개체 |
| 0x05C | +76 | MEMO_SHAPE | 메모 모양 |
| 0x05D | +77 | MEMO_LIST | 메모 리스트 |
| 0x05E | +78 | FORBIDDEN_CHAR | 금칙 문자 |
| 0x05F | +79 | CHART_DATA | 차트 데이터 |

**인라인 컨트롤 코드 (PARA_TEXT 내 특수 문자)**:

| 코드 | 크기 | 설명 | 처리 방식 |
|------|------|------|----------|
| 0x0002 | 16바이트(8 code unit) | 구역/단 정의 | extended ctrl |
| 0x0003 | 16바이트 | 필드 시작 | extended ctrl (FIELD_BEGIN) |
| 0x0004 | 16바이트 | 필드 끝 | extended ctrl (FIELD_END) |
| 0x0008 | 16바이트 | 인라인 비텍스트 | inline ctrl |
| 0x0009 | 16바이트 | 탭 | 탭 확장 데이터 7 code unit 포함 |
| 0x000A | 2바이트(1 code unit) | 줄 끝 | char ctrl |
| 0x000B | 16바이트 | 확장 컨트롤 삽입 | extended ctrl (표, 도형, 그림) |
| 0x000D | 2바이트 | 문단 끝 | 파싱 종료 |
| 0x0012 | 16바이트 | 자동번호 | extended ctrl (공백 placeholder) |
| 0x0018 | 2바이트 | 묶음 빈칸 | → U+00A0 (NBSP) |
| 0x0019 | 2바이트 | 고정폭 빈칸 | → 공백 |
| 0x001E | 2바이트 | 하이픈 | → '-' |
| 0x001F | 2바이트 | 고정폭 빈칸 31 | → U+2007 (FIGURE SPACE) |

**컨트롤 ID (4바이트 ASCII, big-endian)**:

| ID | 문자열 | 설명 |
|----|--------|------|
| 0x73656364 | `secd` | 구역 정의 |
| 0x636F6C64 | `cold` | 단 정의 |
| 0x74626C20 | `tbl ` | 표 |
| 0x65716564 | `eqed` | 수식 |
| 0x67736F20 | `gso ` | 그리기 개체 |
| 0x68656164 | `head` | 머리말 |
| 0x666F6F74 | `foot` | 꼬리말 |
| 0x666E2020 | `fn  ` | 각주 |
| 0x656E2020 | `en  ` | 미주 |
| 0x61746E6F | `atno` | 자동번호 |
| 0x6E776E6F | `nwno` | 새번호 |
| 0x70676E70 | `pgnp` | 쪽번호 위치 |
| 0x626F6B6D | `bokm` | 책갈피 |
| 0x74637073 | `tcps` | 글자겹침 |
| 0x666F726D | `form` | 양식 개체 |
| 0x74636D74 | `tcmt` | 숨은 설명 |
| `%clk` | 필드: 누름틀 | |
| `%hlk` | 필드: 하이퍼링크 | |
| `%bmk` | 필드: 책갈피 | |
| `%dte` | 필드: 날짜 | |
| `%fmu` | 필드: 수식 | |
| `%toc` | 필드: 차례 | |
| `%%me` | 필드: 메모 | |

**kordoc 참조**: 필드 컨트롤은 첫 바이트가 `%`(0x25)로 시작 — `is_field_ctrl_id(id)` 함수로 판별

---

### 2.5 DocInfo 파싱

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/parser/doc_info.rs` | 1,129 | 참조 테이블(글꼴, 글자모양, 문단모양, 스타일, 테두리 등) 구축 |

**파싱 순서**:
1. `DOCUMENT_PROPERTIES` — 섹션 수, 시작 번호
2. `ID_MAPPINGS` — 각 타입별 개수 (u32 x 15+): bin_data, font(7종), border_fill, char_shape, tab_def, numbering, bullet, para_shape, style, memo_shape
3. `BIN_DATA` — 바이너리 참조 (Link/Embedding/Storage)
4. `FACE_NAME` — 글꼴 이름 (7개 언어 카테고리 순서: 한글→영문→한자→일어→기타→기호→사용자)
5. `BORDER_FILL` — 테두리(좌우상하 각 1+1+4바이트) + 대각선 + 채우기(Fill)
6. `CHAR_SHAPE` — 글자 모양 (7언어별 font_id, ratio, spacing, relative_size, char_offset + base_size + attr)
7. `TAB_DEF` — 탭 정의
8. `NUMBERING` — 번호 매기기 (7수준)
9. `BULLET` — 글머리표
10. `PARA_SHAPE` — 문단 모양
11. `STYLE` — 스타일

**Fill 파싱 (`parse_fill`)** — 매우 중요한 알고리즘:
```
fill_type_val (u32 비트마스크):
  bit 0 = Solid, bit 1 = Image, bit 2 = Gradient

if 0: 채우기 없음 → 4바이트 skip 후 반환

Solid (bit 0): background_color(4) + pattern_color(4) + pattern_type(4)
Gradient (bit 2): kind(1) + angle(4) + cx(4) + cy(4) + blur(4) + count(4)
                  + [positions: count>2이면 i32 x count] + [colors: u32 x count]
Image (bit 1): mode(1) + brightness(1) + contrast(1) + effect(1) + bin_data_id(2)

Additional: u32 size → 그라데이션이면 blurring_center(1), 아니면 skip
Unknown bytes: 각 채우기 종류별 1바이트씩 (투명도/alpha)
```

**kordoc 참조 포인트**:
- FACE_NAME의 7개 언어 카테고리 순서가 ID_MAPPINGS의 font_counts와 1:1 대응
- BORDER_FILL은 **인터리브** 형식 — 각 테두리별 `종류(1)+굵기(1)+색상(4)` 반복
- Gradient의 필드 크기가 HWP 스펙 문서와 실제 바이너리가 다름 (kind=u8, angle/cx/cy/blur/count=u32)
- Fill의 additional_size와 unknown_bytes 처리가 핵심 (스펙 미문서화)

---

### 2.6 BodyText / 문단 파싱

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/parser/body_text.rs` | 876 | 섹션/문단/텍스트/컨트롤 파싱 |

**레코드 트리 구조**:
```
PARA_HEADER (level 0)
  PARA_TEXT (level 1)         ← UTF-16LE 텍스트
  PARA_CHAR_SHAPE (level 1)   ← 글자모양 참조 배열
  PARA_LINE_SEG (level 1)     ← 줄 세그먼트 배열
  PARA_RANGE_TAG (level 1)    ← 범위 태그 배열
  CTRL_HEADER (level 1)       ← secd, cold, tbl 등
    PAGE_DEF (level 2)
    FOOTNOTE_SHAPE (level 2)
    TABLE (level 2)
    LIST_HEADER (level 2)     ← 셀, 캡션
      PARA_HEADER (level 3)   ← 재귀
```

**PARA_HEADER (최소 12바이트)**:
```
u32: nChars (bit 31 = MSB 플래그: 현재 스코프의 마지막 문단이면 1)
u32: controlMask (각 비트가 제어문자 존재 여부)
u16: paraShapeId
u8:  styleId
u8:  breakType (0x01=구역, 0x02=다단, 0x04=쪽, 0x08=단)
[이후]: numCharShapes(2) + numRangeTags(2) + numLineSegs(2) + instanceId(4) ...
```

**PARA_TEXT 파싱 알고리즘** (핵심 로직):
```
pos=0, UTF-16LE 순회:
  0x0000      → skip
  0x0009 (탭) → '\t' + 확장 데이터(7 code unit) 보존, pos+=16
  0x000A      → '\n', pos+=2
  0x000D      → 문단 끝, break
  extended ctrl (1-8, 11-12, 14-23) → pos+=16 (8 code unit)
    0x0003: FIELD_BEGIN → field_stack push (ctrl_idx 증가)
    0x0004: FIELD_END   → field_stack pop → FieldRange 생성
    0x000B: 확장 컨트롤 → ctrl_idx 증가
    0x0012: 자동번호    → 공백 placeholder + ctrl_idx 증가
  char ctrl (24-31):
    0x0018 → U+00A0 (NBSP, 묶음 빈칸)
    0x0019 → 공백 (고정폭)
    0x001E → '-' (하이픈)
    0x001F → U+2007 (FIGURE SPACE)
  서로게이트 페어 (0xD800~0xDBFF + 0xDC00~0xDFFF) → 코드 포인트 계산
  일반 문자 → String에 추가
```

**kordoc 참조 포인트**:
- `is_extended_ctrl_char(ch)`: 1~8, 11~12, 14~23 → 16바이트 차지
- `is_extended_only_ctrl_char(ch)`: 1~3, 11~12, 14~18, 21~23 → CTRL_HEADER 있음
- 필드 범위(FieldRange): FIELD_BEGIN~FIELD_END 중첩 스택으로 추적
- 탭 확장 데이터: 8 code unit 중 code_unit[1~7]에 탭 너비, 종류 등 저장
- MSB(bit 31 of nChars): 현재 스코프의 마지막 문단이면 1 — 직렬화 시 위치 기반으로 재결정

---

### 2.7 컨트롤 파싱

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/parser/control.rs` | 937 | 표, 머리말/꼬리말, 각주/미주, 필드, 자동번호, 양식 등 |
| `src/parser/control/shape.rs` | 917 | 그리기 개체(GSO), 그림, 도형 서브타입 |

**표 파싱 (`parse_table_control`)**:
1. CTRL_HEADER → CommonObjAttr (배치/위치/크기)
2. 캡션: TABLE 레코드 이전의 LIST_HEADER
3. HWPTAG_TABLE 레코드:
   - attr(4): bit 0-1=쪽나눔, bit 2=제목행반복
   - row_count(2), col_count(2), cell_spacing(2)
   - padding: left(2), right(2), top(2), bottom(2)
   - row_sizes: u16 x row_count
   - border_fill_id(2)
   - zones: count(2) + TableZone(10) x count
4. 셀: TABLE 이후의 LIST_HEADER 각각
   - LIST_HEADER: n_paragraphs(2) + list_attr(4) + width_ref(2) + 셀속성(26바이트)
   - 셀속성: col(2), row(2), col_span(2), row_span(2), width(4), height(4), padding(8), border_fill_id(2)
   - list_attr bit 16: 안 여백 지정 여부
   - list_attr bit 18: 제목 셀
   - list_attr bit 21-22: 세로 정렬

**kordoc 참조 포인트**:
- 셀의 `apply_inner_margin` (list_attr bit 16)이 0이면 셀 패딩 대신 표 기본 패딩 사용
- `rebuild_grid()` — 셀 목록에서 2D 그리드(cell_grid) 재구성, 병합 셀 span 반영
- 셀 필드 이름: raw_list_extra[14..16]=name_len, [16..]=UTF-16LE

**그리기 개체 파싱 (`parse_gso_control`)**:
1. CTRL_HEADER → CommonObjAttr
2. SHAPE_COMPONENT → ShapeComponentAttr + Border + Fill + Shadow
   - ctrl_id 2회 출력 여부 판별: `data[0..4] == data[4..8]`이면 2회
   - 렌더링 행렬: cnt(2) + translation(48) + [scale(48)+rotation(48)] x cnt
   - 아핀 변환 합성: `compose(A, B) = [a0*b0+a1*b3, ...]`
3. 서브타입 태그: LINE/RECTANGLE/ELLIPSE/ARC/POLYGON/CURVE/PICTURE
4. 텍스트 박스: SHAPE_COMPONENT 이후의 LIST_HEADER + 문단들
5. 캡션: SHAPE_COMPONENT 이전의 LIST_HEADER
6. 그룹(Container): 자식 SHAPE_COMPONENT 재귀

**그림 파싱 (`parse_picture`)**:
- border_x[4], border_y[4] — 4꼭짓점 좌표
- CropInfo: left(4), top(4), right(4), bottom(4)
- padding: left(2), right(2), top(2), bottom(2)
- ImageAttr: brightness(1), contrast(1), effect(1), bin_data_id(2)
- border_opacity(1), instance_id(4)

**필드 파싱 (`parse_field_control`)**:
- ctrl_data = 속성(4) + 기타속성(1) + command_len(2) + command(UTF-16LE) + field_id(4)
- 필드 타입은 ctrl_id에서 결정: `%clk`=ClickHere, `%hlk`=Hyperlink 등

**양식 개체 파싱 (`parse_form_control`)**:
- FORM_OBJECT 레코드: type_id(4바이트 ASCII) + 속성 문자열
- type_id: `tbp+`=PushButton, `tbc+`=CheckBox, `boc+`=ComboBox, `tbr+`=RadioButton, `tde+`=Edit
- 속성 문자열 포맷: `Key:type:value` (type=wstring/int/bool/set)

---

### 2.8 배포용 문서 복호화

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/parser/crypto.rs` | 537 | ViewText 복호화 (LCG + AES-128 ECB), 순수 Rust 구현 |

**복호화 흐름**:
```
ViewText/Section{N}
  ├── 첫 번째 레코드: DISTRIBUTE_DOC_DATA (256바이트 페이로드)
  │     ├── decrypt_distribute_doc_data(): LCG(MSVC srand/rand) + XOR
  │     │     seed = first 4 bytes (LE)
  │     │     LCG: seed = seed * 214013 + 2531011, rand = (seed >> 16) & 0x7FFF
  │     │     XOR: key = lcg.rand() & 0xFF, repeat n = (lcg.rand() & 0xF) + 1
  │     │     byte[4..] XOR key (가변 길이 블록)
  │     └── extract_aes_key(): offset = 4 + (decrypted[0] & 0xF), key = decrypted[offset..offset+16]
  └── 나머지 데이터: AES-128 ECB 복호화
        └── zlib/deflate 압축 해제
```

**AES-128 ECB 순수 구현**:
- S_BOX, INV_S_BOX (256바이트 테이블)
- key_expansion: 16바이트 → 176바이트 (44 words)
- decrypt_block: AddRoundKey(10) → 9회 InvShiftRows+InvSubBytes+AddRoundKey+InvMixColumns → InvShiftRows+InvSubBytes+AddRoundKey(0)
- GF(2^8) 곱셈: xtime + multiply

**kordoc 참조 포인트**:
- 외부 AES 라이브러리 없이 순수 구현 가능 (~200줄)
- MSVC LCG 호환 필수 (시드 계산 공식이 정확히 일치해야 함)
- NIST 테스트 벡터로 검증 가능
- `read_first_record()` — 암호화된 섹션에서 `Record::read_all()` 사용 불가 (암호문이 레코드 형식이 아님)

---

### 2.9 바이트 리더 유틸리티

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/parser/byte_reader.rs` | 255 | 커서 기반 LE 바이너리 리더, HWP 문자열 읽기 |

**주요 메서드**:
- `read_u8/u16/u32/i8/i16/i32/i64` — LE 정수
- `read_hwp_string()` — `[u16 길이] + [UTF-16LE 바이트 x 길이]`
- `read_color_ref()` — `0x00BBGGRR` 형식 (4바이트)
- `skip(n)`, `position()`, `remaining()`

---

## 3. HWPX 파서 모듈

### 3.1 전체 구조

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/parser/hwpx/mod.rs` | 156 | HWPX 파싱 엔트리포인트 |
| `src/parser/hwpx/reader.rs` | 62 | ZIP 아카이브 래퍼 |
| `src/parser/hwpx/content.rs` | 164 | content.hpf 매니페스트 파싱 |
| `src/parser/hwpx/header.rs` | 1,146 | header.xml → DocInfo 변환 |
| `src/parser/hwpx/section.rs` | 2,711 | section*.xml → Section 변환 |
| `src/parser/hwpx/utils.rs` | 141 | XML 파싱 유틸리티 |

**파싱 순서**:
1. ZIP 열기 (`zip` 크레이트)
2. `Contents/content.hpf` → OPF manifest → 섹션 파일 목록 + BinData 목록
3. `Contents/header.xml` → DocInfo (글꼴, 글자모양, 문단모양, 스타일, 테두리)
4. `Contents/section*.xml` → Section (문단, 표, 이미지, 도형)
5. `BinData/*` → 이미지 바이너리

**content.hpf (OPF 매니페스트)**:
```xml
<opf:manifest>
  <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  <opf:item id="image1" href="BinData/image1.png" media-type="image/png"/>
</opf:manifest>
<opf:spine>
  <opf:itemref idref="section0"/>
</opf:spine>
```
- spine 순서로 섹션 정렬 (spine 없으면 파일명 정렬)
- BinData 항목은 `href.starts_with("BinData/")`로 필터

**header.xml 주요 요소**:
- `<hh:fontface lang="HANGUL">` → 언어별 글꼴 그룹 (7종)
- `<hh:charPr>` → CharShape (fontRef, ratio, spacing, relSz, offset, bold, italic, underline, strikeout)
- `<hh:paraPr>` → ParaShape (alignment, lineSpacing, margin)
- `<hh:borderFill>` → BorderFill (border lines + fill)
- `<hh:style>` → Style (name, type, paraPrIDRef, charPrIDRef)

**section*.xml 주요 요소**:
- `<hp:p paraPrIDRef="0" styleIDRef="0">` → 문단
- `<hp:run charPrIDRef="0">` → 텍스트 런 (글자모양 변경점)
- `<hp:t>` → 텍스트 컨텐츠 (lineBreak/tab 인라인 요소 포함)
- `<hp:tbl>` → 표
- `<hp:pic>` → 그림
- `<hp:rect/ellipse/line/arc/polygon/curve>` → 도형
- `<hp:container>` → 묶음 개체
- `<hp:secPr>` → 섹션 정의 (pagePr, margin, colPr, startNum, visibility)
- `<hp:ctrl>` → 머리말/꼬리말/각주/미주/책갈피/하이퍼링크 등

**kordoc 참조 포인트**:
- HWPX의 landscape 처리: width/height가 이미 실제 방향이므로 swap 불필요 (HWP 바이너리와 다른 규약)
- HWPX 탭 = 8 code unit으로 char_offset 계산 (HWP 바이너리와 동일)
- `ctrl_offset` = controls.len() * 8 → char_offsets/char_count에 반영

---

## 4. 직렬화 (HWP Write) 모듈

### 4.1 전체 구조

| 파일 | 줄 수 | 핵심 기능 |
|------|-------|----------|
| `src/serializer/mod.rs` | 58 | 직렬화 엔트리포인트, DocumentSerializer trait |
| `src/serializer/body_text.rs` | 875 | Section/Paragraph → 레코드 바이트 |
| `src/serializer/control.rs` | 1,574 | Control → CTRL_HEADER 레코드 |
| `src/serializer/doc_info.rs` | 839 | DocInfo → 레코드 바이트 |
| `src/serializer/header.rs` | 122 | FileHeader → 256바이트 |
| `src/serializer/cfb_writer.rs` | 196 | CFB 컨테이너 조립, deflate 압축 |
| `src/serializer/mini_cfb.rs` | 606 | 순수 Rust CFB v3 빌더 (WASM 호환) |
| `src/serializer/byte_writer.rs` | 242 | LE 바이너리 라이터 |
| `src/serializer/record_writer.rs` | 189 | Record → 바이트 직렬화 |

### 4.2 라운드트립 전략 (핵심)

**원칙**: "원본 스트림이 있으면 그대로 반환"
```rust
// serialize_section():
if let Some(ref raw) = section.raw_stream {
    return raw.clone();  // 완벽한 라운드트립
}
// raw_stream이 None이면 모델에서 재생성
```

**모든 모델에 `raw_*` 필드가 있음**:
- `Section.raw_stream` — BodyText 스트림 전체
- `DocInfo.raw_stream` — DocInfo 스트림 전체
- `FileHeader.raw_data` — FileHeader 256바이트
- `Paragraph.raw_header_extra` — PARA_HEADER 12바이트 이후
- `SectionDef.raw_ctrl_extra` — secd ctrl_data 24바이트 이후
- `Table.raw_ctrl_data`, `raw_table_record_attr`, `raw_table_record_extra`
- `Cell.raw_list_extra`
- `ShapeComponentAttr.raw_rendering` — 렌더링 행렬
- `CommonObjAttr.raw_extra`
- `BinData.raw_data`, `CharShape.raw_data`, `ParaShape.raw_data` 등

**편집 시 raw_stream = None** → 직렬화 시 모델에서 재생성

### 4.3 PARA_TEXT 직렬화 (역방향)

**핵심 알고리즘**:
```
text_chars + controls → UTF-16LE code_units

1. char_offsets의 갭(8 code unit)에 확장 컨트롤 배치
2. push_extended_ctrl(): [ctrl_code, ctrl_id_lo, ctrl_id_hi, 0, 0, 0, 0, ctrl_code]
3. 필드 범위: FIELD_BEGIN(0x0003) + 텍스트 + FIELD_END(0x0004)
4. 탭: 8 code unit [0x0009, ext[0..7]]
5. 문단 끝: 0x000D 추가

control_mask 재계산: 실제 controls에서 비트마스크 산출
char_count 재계산: PARA_TEXT code unit 수
MSB: 위치 기반 (현재 스코프 마지막 문단이면 1)
```

### 4.4 CFB 컨테이너 생성

**mini_cfb.rs** — 순수 Rust CFB v3 빌더 (WASM 호환):
- `cfb` 크레이트의 `SystemTime::now()` 문제 회피
- 섹터 크기 512, 미니 섹터 64, 미니 스트림 컷오프 4096
- FAT/DIFAT/Mini-FAT/Directory 직접 생성
- Red-Black 트리 대신 balanced binary tree (정렬 기반)

**스트림 압축**:
- `compress_stream()` — raw deflate (flate2)
- BinData: 개별 압축 속성에 따라 재압축 (Default/Compress/NoCompress)

---

## 5. 데이터 모델 (Document IR)

### 5.1 주요 구조체

| 파일 | 줄 수 | 핵심 구조체 |
|------|-------|-----------|
| `src/model/document.rs` | 429 | Document, FileHeader, DocInfo, DocProperties, Section, SectionDef |
| `src/model/paragraph.rs` | 843 | Paragraph, CharShapeRef, LineSeg, RangeTag, FieldRange |
| `src/model/control.rs` | 432 | Control(enum 22종), AutoNumber, Field, FormObject 등 |
| `src/model/table.rs` | 1,007 | Table, Cell, TableZone, rebuild_grid() |
| `src/model/shape.rs` | 601 | ShapeObject(enum 8종), CommonObjAttr, DrawingObjAttr, TextBox |
| `src/model/image.rs` | 121 | Picture, ImageAttr, CropInfo |
| `src/model/style.rs` | 756 | CharShape, ParaShape, Style, BorderFill, Fill, Font |
| `src/model/page.rs` | 235 | PageDef, ColumnDef, PageBorderFill |
| `src/model/footnote.rs` | 127 | FootnoteShape, Footnote, Endnote |
| `src/model/header_footer.rs` | 87 | Header, Footer, MasterPage, HeaderFooterApply |
| `src/model/bin_data.rs` | 98 | BinData, BinDataContent |

### 5.2 Control enum (22개 variant)

```
SectionDef, ColumnDef, Table, Shape, Picture,
Header, Footer, Footnote, Endnote,
AutoNumber, NewNumber, PageNumberPos, Bookmark,
Hyperlink, Ruby, CharOverlap, PageHide,
HiddenComment, Equation, Field, Form, Unknown
```

### 5.3 ShapeObject enum (8개 variant)

```
Line, Rectangle, Ellipse, Arc, Polygon, Curve, Group, Unknown
```

---

## 6. kordoc 개선을 위한 핵심 참조 사항

### 6.1 파싱 정확도 개선

| 영역 | rhwp 접근법 | kordoc 참조 포인트 |
|------|-----------|-------------------|
| PARA_TEXT 제어 문자 | extended(1-8,11-12,14-23)=16바이트, char(0,10,13,24-31)=2바이트 | 정확한 code unit 크기 처리 |
| 필드 범위 | FIELD_BEGIN/END 중첩 스택, FieldRange 생성 | 필드 경계 정확한 추적 |
| 탭 확장 데이터 | 8 code unit 중 [1~7]에 너비/종류 저장 | 탭 렌더링 정보 보존 |
| 서로게이트 페어 | UTF-16LE 서로게이트 명시적 처리 | 이모지 등 BMP 외 문자 |
| 셀 여백 | apply_inner_margin(list_attr bit 16)=0이면 표 기본값 | 셀 패딩 해석 정확도 |
| 바탕쪽 | 확장 바탕쪽 = Section 끝의 level=1 LIST_HEADER | 마지막 문단 이후 재스캔 |

### 6.2 엣지 케이스 처리

| 영역 | rhwp 처리 방식 |
|------|--------------|
| 손상된 CFB | strict 실패 → LenientCfbReader 폴백 (FAT 직접 파싱, 순환 방지) |
| 개별 섹션 실패 | 빈 Section으로 대체, 전체 파싱은 계속 |
| 압축 해제 실패 | raw deflate 먼저 → 표준 zlib 재시도 |
| BinData 실패 | 경고만 출력, 계속 진행 |
| 확장 크기 레코드 | size==0xFFF → 다음 4바이트가 실제 크기 |
| SHAPE_COMPONENT ctrl_id | `data[0..4] == data[4..8]`이면 2회 출력 → 8바이트 skip |
| 각주/미주 모양 | 스펙 26바이트이나 실제 28바이트 (미문서화 2바이트) |

### 6.3 배포용 문서 복호화 구현 체크리스트

1. MSVC LCG 구현: `seed = seed * 214013 + 2531011`, `rand = (seed >> 16) & 0x7FFF`
2. DISTRIBUTE_DOC_DATA XOR 복호화: seed=첫4바이트, key/n 가변 블록
3. AES 키 추출: `offset = 4 + (decrypted[0] & 0xF)`, `key = decrypted[offset..+16]`
4. AES-128 ECB 복호화: 16바이트 블록 단위
5. zlib/deflate 압축 해제

### 6.4 Fill 파싱 구현 체크리스트

```
1. fill_type_val = u32 (비트마스크)
2. if 0: skip 4바이트 → 반환
3. bit 0 (Solid): bg_color(4) + pattern_color(4) + pattern_type(4) = 12바이트
4. bit 2 (Gradient): kind(1) + angle(4) + cx(4) + cy(4) + blur(4) + count(4)
   + [count>2: positions i32 x count] + [colors u32 x count]
5. bit 1 (Image): mode(1) + brightness(1) + contrast(1) + effect(1) + bin_data_id(2)
6. additional_size(4): gradient이면 blurring_center(1), 아니면 skip
7. unknown bytes: 각 채우기 종류별 1바이트 (투명도)
```

### 6.5 라운드트립 보존 전략 (HWP 쓰기 시)

| 전략 | 설명 |
|------|------|
| raw_stream 캐싱 | 변경 없으면 원본 바이트 그대로 반환 |
| raw_*_extra 필드 | 파싱된 필드 이후의 미지원 바이트 보존 |
| control_mask 재계산 | 직렬화 시 실제 controls에서 재산출 |
| char_count 재계산 | PARA_TEXT code unit 수에서 재산출 |
| MSB 위치 기반 결정 | 모델 값이 아닌 현재 스코프 마지막 문단 기준 |

---

## 7. 파일 경로 요약 (빠른 참조)

```
src/parser/
  mod.rs            ← 파싱 엔트리포인트, detect_format(), parse_hwp()
  tags.rs           ← 모든 태그/컨트롤 ID 상수
  record.rs         ← 레코드 헤더(4바이트) 파싱
  header.rs         ← FileHeader(256바이트) 파싱
  cfb_reader.rs     ← CfbReader(strict) + LenientCfbReader + decompress_stream()
  byte_reader.rs    ← LE 바이너리 리더, read_hwp_string()
  doc_info.rs       ← DocInfo 참조 테이블 (글꼴/글자모양/문단모양/스타일/테두리/Fill)
  body_text.rs      ← PARA_TEXT 파싱(핵심), 문단/컨트롤 트리 파싱
  control.rs        ← 표/필드/자동번호/양식/머리말/꼬리말/각주/미주/수식
  control/shape.rs  ← GSO/그림/도형/캡션/텍스트박스/SHAPE_COMPONENT
  crypto.rs         ← 배포용 복호화 (LCG + AES-128 ECB 순수 구현)
  bin_data.rs       ← BinData 스토리지명 생성, 추출

src/parser/hwpx/
  mod.rs            ← HWPX 파싱 엔트리포인트
  reader.rs         ← ZIP 래퍼
  content.rs        ← content.hpf (OPF 매니페스트)
  header.rs         ← header.xml → DocInfo
  section.rs        ← section*.xml → Section (가장 큰 파일, 2,711줄)
  utils.rs          ← XML 유틸리티

src/serializer/
  mod.rs            ← 직렬화 엔트리포인트
  body_text.rs      ← Section/Paragraph → 레코드 (PARA_TEXT 역직렬화 핵심)
  control.rs        ← Control → CTRL_HEADER
  doc_info.rs       ← DocInfo → 레코드
  header.rs         ← FileHeader → 256바이트
  cfb_writer.rs     ← CFB 조립 + deflate 압축
  mini_cfb.rs       ← 순수 Rust CFB v3 빌더
  byte_writer.rs    ← LE 바이너리 라이터
  record_writer.rs  ← Record → 바이트

src/model/
  document.rs       ← Document, Section, DocInfo, FileHeader
  paragraph.rs      ← Paragraph, CharShapeRef, LineSeg
  control.rs        ← Control(enum 22종)
  table.rs          ← Table, Cell, rebuild_grid()
  shape.rs          ← ShapeObject, CommonObjAttr, DrawingObjAttr
  image.rs          ← Picture, ImageAttr
  style.rs          ← CharShape, ParaShape, Style, BorderFill, Fill
  page.rs           ← PageDef, ColumnDef
  footnote.rs       ← FootnoteShape, Footnote, Endnote
  header_footer.rs  ← Header, Footer, MasterPage
  bin_data.rs       ← BinData, BinDataContent
```
