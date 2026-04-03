# Browser Tools 구현 상세 및 사용법

> 구현일: 2026-03-22 (최종 업데이트: 2026-03-25)
> 기반: Playwright >=1.40.0 (Python, sync API)
> 위치: `python-sidecar/src/browser_tools/`

---

## 1. 개요

사전기획 적정성 검토 업무에 필요한 **7개 공공 사이트**를 자동화하는 Playwright 기반 브라우저 도구 모음.
각 도구는 CLI로 독립 실행 가능하며, Tauri 데스크톱 앱에서는 JSON-RPC 2.0 `browser_tool` 메서드를 통해 호출된다.
결과는 JSON/CSV/TXT 형식으로 저장된다.

### 동작 현황

| # | 도구 | 사이트 | 동작 상태 | 로그인 | MVP 연계 |
|---|------|--------|----------|--------|----------|
| 1 | schoolinfo | 학교알리미 | **정상** | 불필요 | MVP3 입력자료 |
| 2 | population | 인구통계 | **정상** | 불필요 | 검토의견서 근거자료 |
| 3 | design_fee | 설계대가 | **로그인 필요** | 필수 | 검토의견서 사업비 검증 |
| 4 | building_info | 세움터 | **부분 동작** | 상세 조회 시 필수 | 검토의견서 기초자료 |
| 5 | land_info | 토지이음 | **정상** | 불필요 | 검토의견서 부지분석 |
| 6 | heritage | 유산정보 | **정상** | 불필요 | 검토의견서 부지분석 |
| 7 | school_zone | 학구도안내 | **정상** | 불필요 | 학구도 확인 |

---

## 2. 공통 사항

### 2.1 모듈 구조

```
python-sidecar/src/browser_tools/
├── __init__.py        # 패키지 초기화 + 전체 import
├── base.py            # BrowserTool 베이스 클래스 (설정은 settings.yaml에서 로드)
├── schoolinfo.py      # 학교알리미
├── population.py      # 인구통계
├── design_fee.py      # 설계대가
├── building_info.py   # 세움터
├── land_info.py       # 토지이음
├── heritage.py        # 유산정보
└── school_zone.py     # 학구도안내
```

### 2.2 공통 CLI 옵션

모든 도구에 공통으로 적용되는 옵션:

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--headed` | 브라우저 창을 표시 (디버깅용) | headless |
| `--debug` | 각 단계마다 스크린샷 저장 | off |
| `--output`, `-o` | 출력 디렉토리 지정 | `./output/browser_tools/` |
| `--timeout` | 타임아웃 (ms) | 30000 |

### 2.3 출력 위치

```
output/browser_tools/
├── schoolinfo_광남고등학교.json
├── schoolinfo_광남고등학교.txt
├── population_서울특별시_광진구.json
├── population_서울특별시_광진구.csv
├── population_서울특별시_광진구_summary.txt
├── land_광진구_군자동_98.json
├── ...
└── debug/                              # --debug 시 생성
    ├── schoolinfo_01_main.png
    ├── schoolinfo_02_search_result.png
    └── ...
```

### 2.4 베이스 클래스 (`BrowserTool`)

모든 도구가 상속하는 공통 클래스:

- **브라우저 관리**: Chromium headless/headed 자동 실행/종료
- **스크린샷**: `--debug` 모드에서 각 단계별 PNG 저장
- **파일 저장**: `save_json()`, `save_csv()`, `save_text()`
- **에러 핸들링**: 실패 시 에러 스크린샷 자동 저장
- **인코딩**: Windows cp949 환경에서도 UTF-8 출력 보장

---

## 3. 도구별 상세

### 3.1 학교알리미 (`schoolinfo`)

**공시정보 자동 수집** — MVP3 입력자료 생성용

```bash
python -m browser_tools.schoolinfo "광남고등학교"
python -m browser_tools.schoolinfo "서울과학고등학교" --headed --debug
```

| 항목 | 내용 |
|------|------|
| URL | `https://www.schoolinfo.go.kr` |
| 입력 | `school_name` — 학교명 (필수) |
| 출력 | JSON (공시정보) + TXT (MVP3 입력용) |
| 수집 항목 | 학생수, 학급수, 교원수, 교육과정, 학교특색사업 |

**구현 핵심**:
1. 검색 폼(`#headerSearchForm`)의 `fnSearchChk()` 검증을 우회하기 위해 `SEARCH_SCHUL_NM` hidden 값을 JS로 직접 설정
2. 검색 결과 링크가 `javascript:searchSchul('uuid')` 형식 — Playwright로 클릭하여 상세 이동
3. 상세 페이지에서 th-td 쌍, 테이블 본문, 공시 카테고리 메뉴를 자동 파싱

**출력 예시** (JSON):
```json
{
  "학교명": "광남고등학교",
  "검색결과수": 2,
  "테이블_1": "1학년도 학생수\t학급당학생수\t전체학생수\n12.8\n25.7\n975"
}
```

---

### 3.2 인구통계 (`population`)

**학령인구 추이 자동 수집** — 검토의견서 근거자료

```bash
python -m browser_tools.population "서울특별시 광진구"
python -m browser_tools.population "경기도 수원시" --debug
```

| 항목 | 내용 |
|------|------|
| URL | `https://jumin.mois.go.kr` |
| 입력 | `region` — 지역명 (필수, 예: "서울특별시 광진구") |
| 출력 | JSON (전 연령) + CSV (연령별) + TXT (학령인구 요약) |
| 수집 항목 | 0~100세 1세 단위 인구수, 학령인구(6~17세) 요약 |

**구현 핵심**:
1. 사이트가 **iframe 기반** — `page.frame(url=lambda u: "ageStatMonth" in u)` 으로 접근
2. 메뉴 전환은 JS 함수 직접 호출: `fnMenuSel('admm','ageStatMonth.do','admmAge')`
3. iframe 안에서 `#sltOrgLvl1` (시도), `#sltOrgLvl2` (시군구) 드롭다운 선택
4. 연령 범위를 **0~100세 1세 단위**로 설정 → 311개 열 테이블 파싱
5. 데이터 오프셋: `data[0]=코드, [1]=지역명, [2]=총인구, [3]=합계, [4]=0세, [5]=1세, ...`

**시도 코드 매핑** (내장):
```
서울=1100000000, 부산=2600000000, 대구=2700000000, 인천=2800000000,
광주=2900000000, 대전=3000000000, 울산=3100000000, 세종=3611000000,
경기=4100000000, 강원=5100000000, 충북=4300000000, 충남=4400000000,
전북=5200000000, 전남=4600000000, 경북=4700000000, 경남=4800000000,
제주=5000000000
```

**출력 예시** (요약 TXT):
```
# 서울특별시 광진구 학령인구 현황

## 학령인구 합계: 23,729명
- 초등학교 (6~11세): 10,252명
- 중학교 (12~14세): 6,718명
- 고등학교 (15~17세): 6,759명

총인구 (331,095명) 대비 학령인구 비율: 7.2%
```

---

### 3.3 설계대가 (`design_fee`)

**건축사 설계대가 자동 산출** — 사업비 검증

```bash
python -m browser_tools.design_fee --pay 5000000000
python -m browser_tools.design_fee --bangsik 1 --jongbyeol 1 --geubsu 1 --pay 10000000000 --headed
```

| 항목 | 내용 |
|------|------|
| URL | `https://kirahub.kira.or.kr/kira/kiraFrame.do?...` |
| 입력 | `--bangsik` (1=도급/2=직영/3=감리), `--jongbyeol` (1=건축/2=토목/3=기계설비), `--geubsu` (1급/2급/3급), `--pay` (공사비, 필수) |
| 출력 | JSON + TXT |
| 제약 | **로그인 필수** — headless에서는 graceful 에러 반환 |

**구현 핵심**:
1. 페이지 접속 후 **로그인 리다이렉트 감지** → URL에 `login` 또는 `main.do` 포함 시 경고
2. 로그인된 상태에서는 radio 3개 + text 1개 폼 자동 입력
3. `--headed` 모드로 실행 → 수동 로그인 후 자동화 진행 가능

---

### 3.4 세움터 (`building_info`)

**건축물대장 정보 조회** — 기초자료

```bash
python -m browser_tools.building_info "서울특별시 광진구 아차산로 200"
python -m browser_tools.building_info "OO초등학교" --headed
```

| 항목 | 내용 |
|------|------|
| URL | `https://www.eais.go.kr` |
| 입력 | `query` — 주소 또는 건물명 (필수) |
| 출력 | JSON + TXT |
| 제약 | 검색은 가능하나, **건축물대장 열람은 로그인 필수** |
| 추출 대상 | 대지위치, 건물명칭, 주용도, 구조, 연면적, 건폐율, 용적률, 허가일 등 |

---

### 3.5 토지이음 (`land_info`)

**토지 이용계획 확인** — 부지분석

```bash
python -m browser_tools.land_info "광진구 군자동 98"
python -m browser_tools.land_info "서울특별시 광진구 아차산로 200" --debug
```

| 항목 | 내용 |
|------|------|
| URL | `https://www.eum.go.kr` |
| 입력 | `address` — 주소 (필수, 지번 또는 도로명) |
| 출력 | JSON + TXT |
| 추출 항목 | 소재지, 지목, 면적, 개별공시지가, 용도지역/지구/구역, 규제 정보 |

**구현 핵심**:
1. 메인 페이지 상단 검색창(`input.addrTxt_back`) 사용 — `ui-autocomplete` 지원
2. 자동완성 드롭다운 선택 또는 검색 버튼 클릭
3. 결과 페이지에서 th-td 쌍 + target field 매칭 추출
4. 규제 정보는 body 텍스트에서 키워드 매칭으로 추출

**출력 예시** (JSON):
```json
{
  "주소": "광진구 군자동 98",
  "소재지": "서울특별시 광진구 군자동 98번지",
  "지목": "학교용지",
  "개별공시지가(㎡당)": "4,484,000원 (2026/01)",
  "지역지구등 지정여부": "도시지역, 제1종일반주거지역, 제2종일반주거지역, ..."
}
```

---

### 3.6 유산정보 (`heritage`)

**국가유산 존재여부 확인** — 부지분석

```bash
python -m browser_tools.heritage "서울특별시 광진구"
python -m browser_tools.heritage "경기도 수원시 팔달구" --debug
```

| 항목 | 내용 |
|------|------|
| URL | `https://gis-heritage.go.kr` |
| 입력 | `location` — 위치명 (필수) |
| 출력 | JSON + TXT |
| 유형 분류 | 국보, 보물, 사적, 천연기념물, 명승, 중요민속문화유산, 시도유형, 시도기념물, 등록문화유산 |

**구현 핵심**:
1. 검색 입력 → 검색 버튼 클릭
2. 결과 목록 파싱 — 각 항목에서 유형 키워드 자동 분류
3. 발견 수 0건 → 의견서에 "문화유산 영향 없음" 기재 근거 제공
4. 첫 번째 가시적 링크 클릭 → 상세 정보(th-td) 추출

**출력 예시** (요약 TXT):
```
# 국가유산 현황 - 서울특별시 광진구

발견된 유산: 17건

## 유산 목록
1. [사적] 아차산성 ...
2. [보물] 광진구 소재 보물 ...
```

---

### 3.7 학구도안내 (`school_zone`)

**학구도 정보 조회** — 학교 배정 확인

```bash
python -m browser_tools.school_zone "광남고등학교"
python -m browser_tools.school_zone "서울특별시 광진구 군자동" --headed
```

| 항목 | 내용 |
|------|------|
| URL | `https://schoolzone.emac.kr/search/schoolSearch.do` |
| 입력 | `address` — 주소 또는 학교명 (필수) |
| 출력 | JSON + TXT |
| 수집 항목 | 학교명, 지역, 학교급(초/중/고), 지도보기 링크 |

**구현 핵심**:
1. 메인 페이지가 아닌 **학교 검색 페이지 직접 이동** (`/search/schoolSearch.do`)
2. 팝업/공지 다수 → JS로 강제 닫기 (`display:none`, `btn.click()`)
3. 테이블 기반 검색 결과 파싱 → 리스트 fallback → 페이지 본문 fallback

**출력 예시** (JSON):
```json
{
  "검색어": "광남고등학교",
  "학교목록": [
    {"NO": "3", "지역": "서울 광진구", "학교급": "고등학교", "학교명": "광남고등학교"},
    {"NO": "2", "지역": "경기 광주시", "학교급": "고등학교", "학교명": "광남고등학교"},
    {"NO": "1", "지역": "전남 나주시", "학교급": "고등학교", "학교명": "광남고등학교"}
  ],
  "결과수": 3
}
```

---

## 4. Python 코드에서 사용

### CLI에서 직접 실행

```bash
# python-sidecar/ 디렉토리에서 실행
cd python-sidecar
python -m browser_tools.population "서울특별시 광진구"
python -m browser_tools.land_info "광진구 군자동 98"
```

### Tauri 앱에서 RPC 호출

```json
{
  "jsonrpc": "2.0",
  "method": "browser_tool",
  "params": {
    "tool": "population",
    "params": { "region": "서울특별시 광진구" }
  },
  "id": 1
}
```

### Python 코드에서 사용

```python
from browser_tools import PopulationTool, LandInfoTool

# 인구통계 조회
pop = PopulationTool(headed=False, debug=True)
result = pop.run(region="서울특별시 광진구")
print(f"학령인구: {result['학령인구_요약']}")

# 토지이음 조회
land = LandInfoTool()
result = land.run(address="광진구 군자동 98")
print(f"용도지역: {result.get('용도지역', 'N/A')}")
```

---

## 5. 테스트 결과 (2026-03-22)

| 도구 | 테스트 입력 | 결과 | 비고 |
|------|-----------|------|------|
| schoolinfo | "광남고등학교" | 2건 검색, 상세 추출 성공 | 학생수/학급수 테이블 |
| population | "서울특별시 광진구" | 101개 연령 추출, 학령인구 23,729명 | 총인구 대비 7.2% |
| design_fee | --pay 5000000000 | 로그인 필요 → graceful 에러 | --headed로 수동 로그인 후 사용 |
| building_info | "광진구 아차산로 200" | 검색 가능, 상세는 로그인 필요 | |
| land_info | "광진구 군자동 98" | 학교용지, 101,062㎡, 공시지가 4,484,000원 | 용도지역/규제 전체 추출 |
| heritage | "서울특별시 광진구" | 17건 발견 (사적, 보물 등) | 유형 자동 분류 |
| school_zone | "광남고등학교" | 3건 (서울/경기/전남) | 학교급 자동 분류 |

---

## 6. 기술 구현 참고

### 사이트별 특이사항

| 사이트 | 기술적 난관 | 해결 방식 |
|--------|-----------|----------|
| 학교알리미 | `fnSearchChk()` JS 검증이 hidden 값 요구 | `page.evaluate()`로 hidden 필드 직접 설정 |
| 인구통계 | 콘텐츠가 **iframe** 안에 존재 | `page.frame(url=...)` 으로 iframe 접근 |
| 인구통계 | 메뉴가 `#`링크 + JS 함수 | `page.evaluate("fnMenuSel(...)")` 직접 호출 |
| 토지이음 | 카카오맵/네이버맵 기반 지도 | 상단 검색바 + `ui-autocomplete` 활용 |
| 학구도 | 팝업 다수 + viewport 밖 요소 | JS로 `display:none` 강제 + 검색 페이지 직접 이동 |
| 설계대가 | `kirahub.kira.or.kr`로 리다이렉트 | 로그인 여부 감지 → graceful 에러 |

### 의존성

- Python 3.10+
- `playwright` >=1.40.0 (`pip install playwright && playwright install chromium`)
- pyproject.toml에 `browser` extras로 등록: `pip install -e ".[browser]"`
- 설정: `python-sidecar/config/settings.yaml`의 `browser_tools` 섹션에서 타임아웃·뷰포트 등 조정 가능
