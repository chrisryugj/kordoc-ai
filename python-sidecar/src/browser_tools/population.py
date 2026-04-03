"""인구통계 — 학령인구 추이 자동 수집.

jumin.mois.go.kr에서 지역별 연령별 인구현황을 수집합니다.
사이트가 iframe 기반이므로 iframe 안에서 작업합니다.

사용법:
    python -m src.browser_tools.population "서울특별시 광진구"
    python -m src.browser_tools.population "경기도 수원시" --headed --debug
"""

import re
from playwright.sync_api import Page, Frame

from .base import BrowserTool, PAGE_LOAD_WAIT_MS, DETAIL_WAIT_MS


class PopulationTool(BrowserTool):
    name = "population"
    description = "학령인구 추이 자동 수집"
    url = "https://jumin.mois.go.kr"

    SCHOOL_AGES = list(range(6, 18))  # 6~17세

    SIDO_MAP = {
        "서울": "1100000000", "부산": "2600000000", "대구": "2700000000",
        "인천": "2800000000", "광주": "2900000000", "대전": "3000000000",
        "울산": "3100000000", "세종": "3611000000", "경기": "4100000000",
        "강원": "5100000000", "충북": "4300000000", "충남": "4400000000",
        "전북": "5200000000", "전남": "4600000000", "경북": "4700000000",
        "경남": "4800000000", "제주": "5000000000",
    }

    def execute(self, page: Page, region: str = "", **kwargs) -> dict:
        if not region:
            raise ValueError("지역명을 입력하세요 (예: '서울특별시 광진구')")

        self.logger.info(f"인구통계 조회: {region}")
        parts = region.split()

        # 1. 메인 페이지 → 연령별 인구현황 메뉴
        page.goto(self.url, wait_until="domcontentloaded")
        self._screenshot(page, "main")

        page.evaluate("fnMenuSel('admm','ageStatMonth.do','admmAge')")
        page.wait_for_timeout(PAGE_LOAD_WAIT_MS)

        # 2. iframe 접근
        iframe = page.frame(url=lambda u: "ageStatMonth" in u)
        if not iframe:
            return {"지역": region, "오류": "iframe 로딩 실패", "성공": False}

        # 3. 검색 조건 설정
        # 1세 단위, 0~100세 전체 범위
        iframe.select_option("#sltArgTypes", "1")
        iframe.wait_for_timeout(DETAIL_WAIT_MS)
        iframe.select_option("#sltArgTypeA", "0")
        iframe.select_option("#sltArgTypeB", "100")

        # 시도 선택
        sido_code = self._find_sido_code(parts[0])
        selected_sido = False
        if sido_code:
            iframe.select_option("#sltOrgLvl1", sido_code)
            selected_sido = True
            # 시군구 옵션 로딩 대기 — 핵심 수정점
            self.logger.info(f"시도 선택 완료: {parts[0]} ({sido_code})")
            iframe.wait_for_timeout(DETAIL_WAIT_MS * 2)

            # 시군구 옵션이 로딩될 때까지 대기
            self._wait_for_sgg_options(iframe)

        # 시군구 선택
        selected_sgg = False
        if selected_sido and len(parts) >= 2:
            selected_sgg = self._select_sgg(iframe, parts[1])
            if selected_sgg:
                self.logger.info(f"시군구 선택 완료: {parts[1]}")
            else:
                self.logger.warning(f"시군구 '{parts[1]}' 선택 실패 — 시도 전체 데이터로 조회됩니다")

        self._screenshot(page, "options_set")

        # 4. 검색 실행
        submit_btn = iframe.locator("input[type='submit'], button[type='submit']").first
        submit_btn.click()
        # 결과 로딩 대기 — 테이블이 나타날 때까지
        iframe.wait_for_timeout(PAGE_LOAD_WAIT_MS)
        self._wait_for_table(iframe)
        self._screenshot(page, "search_result")

        # 5. 결과 추출
        result = self._extract_age_data(iframe, region)

        # 시군구 선택 상태 기록
        result["조회범위"] = "시군구" if selected_sgg else ("시도" if selected_sido else "전국")
        if not selected_sgg and len(parts) >= 2:
            result["주의"] = f"'{parts[1]}' 시군구 선택이 실패하여 상위 지역 데이터일 수 있습니다"

        # 6. 학령인구 요약
        summary = self._summarize_school_age(result)
        result["학령인구_요약"] = summary
        result["성공"] = bool(result.get("연령별_인구"))

        # 7. 저장
        safe_region = re.sub(r'[^\w가-힣]', '_', region)[:30]
        self.save_json(result, f"population_{safe_region}.json")

        csv_rows = []
        age_data = result.get("연령별_인구", {})
        for age in range(0, 101):
            key = f"{age}세"
            if key in age_data:
                csv_rows.append([key, age_data[key]])
        self.save_csv(csv_rows, f"population_{safe_region}.csv",
                      header=["연령", "인구수"])
        self.save_text(summary, f"population_{safe_region}.md")

        self.logger.info(f"수집 완료: {region} (조회범위: {result['조회범위']})")
        return result

    def _find_sido_code(self, sido_name: str) -> str:
        for key, code in self.SIDO_MAP.items():
            if key in sido_name:
                return code
        return ""

    def _wait_for_sgg_options(self, iframe: Frame, max_wait: int = 5):
        """시군구 드롭다운 옵션이 로딩될 때까지 대기합니다."""
        import time
        start = time.time()
        while time.time() - start < max_wait:
            options = iframe.query_selector_all("#sltOrgLvl2 option")
            # "전체" 외에 실제 시군구 옵션이 있으면 로딩 완료
            if len(options) > 1:
                self.logger.info(f"시군구 옵션 {len(options) - 1}개 로딩됨")
                return
            iframe.wait_for_timeout(500)
        self.logger.warning("시군구 옵션 로딩 타임아웃")

    def _select_sgg(self, iframe: Frame, sgg_name: str) -> bool:
        """시군구를 선택합니다. 성공 여부를 반환합니다."""
        options = iframe.query_selector_all("#sltOrgLvl2 option")
        self.logger.info(f"시군구 옵션 수: {len(options)}")

        for opt in options:
            text = opt.inner_text().strip()
            if sgg_name in text:
                value = opt.get_attribute("value")
                if value:
                    iframe.select_option("#sltOrgLvl2", value)
                    iframe.wait_for_timeout(500)
                    return True

        # 부분 매칭 시도 (ex: "광진" → "광진구")
        sgg_short = sgg_name.rstrip("구시군")
        if sgg_short != sgg_name:
            for opt in options:
                text = opt.inner_text().strip()
                if sgg_short in text:
                    value = opt.get_attribute("value")
                    if value:
                        iframe.select_option("#sltOrgLvl2", value)
                        iframe.wait_for_timeout(500)
                        return True

        self.logger.warning(f"시군구 '{sgg_name}'을 찾지 못했습니다")
        # 사용 가능한 옵션 로그
        available = [opt.inner_text().strip() for opt in options[:5]]
        self.logger.info(f"사용 가능한 옵션 (일부): {available}")
        return False

    def _wait_for_table(self, iframe: Frame, max_wait: int = 10):
        """검색 결과 테이블이 나타날 때까지 대기합니다."""
        import time
        start = time.time()
        while time.time() - start < max_wait:
            tables = iframe.query_selector_all("table")
            for tbl in tables:
                rows = tbl.query_selector_all("tr")
                for row in rows:
                    cells = row.query_selector_all("td")
                    if len(cells) >= 5:
                        return  # 데이터 행 발견
            iframe.wait_for_timeout(1000)
        self.logger.warning("테이블 로딩 타임아웃")

    def _extract_age_data(self, iframe: Frame, region: str) -> dict:
        """테이블에서 연령별 인구 데이터를 추출합니다.

        테이블 구조: 열 = [코드, 지역명, 총인구, 연령구간합계, 0세, 1세, ..., 100세이상]
        첫 번째 데이터 행(시군구 합계)을 사용합니다.
        """
        result = {"지역": region, "연령별_인구": {}}

        tables = iframe.query_selector_all("table")
        if not tables:
            self.logger.warning("데이터 테이블을 찾지 못했습니다")
            return result

        # 데이터 테이블 탐색: "총인구" 또는 "0세" 헤더를 포함하는 테이블
        data_table = None
        for tbl in tables:
            header_text = tbl.inner_text()[:200]
            if "총인구" in header_text or "0세" in header_text:
                data_table = tbl
                break
        if not data_table:
            # fallback: 마지막 테이블 (기존 동작)
            data_table = tables[-1] if len(tables) >= 3 else tables[0]

        rows = data_table.query_selector_all("tr")
        if len(rows) < 2:
            return result

        # 첫 번째 데이터 행 탐색: td가 5개 이상인 행
        data_cells = None
        for row in rows:
            cells = row.query_selector_all("td")
            if len(cells) >= 5:
                data_cells = cells
                break
        if not data_cells:
            return result
        data = [c.inner_text().strip() for c in data_cells]

        if len(data) < 5:
            return result

        # data[0]=코드, [1]=지역명, [2]=총인구, [3]=연령구간합계, [4]=0세, [5]=1세, ...
        result["지역명"] = data[1]
        result["총인구"] = int(data[2].replace(",", "")) if data[2].replace(",", "").isdigit() else 0

        for age in range(0, 101):
            idx = 4 + age
            if idx < len(data):
                count_str = data[idx].replace(",", "")
                if count_str.isdigit():
                    result["연령별_인구"][f"{age}세"] = int(count_str)

        # 검증: 총인구가 비정상적으로 크면 전국 데이터일 가능성
        total_pop = result.get("총인구", 0)
        region_name = result.get("지역명", "")
        if total_pop > 10_000_000 and "전국" not in region and "전체" not in region_name:
            result["경고"] = (
                f"총인구 {total_pop:,}명은 전국 수준입니다. "
                f"시군구 선택이 제대로 되지 않았을 수 있습니다."
            )

        return result

    def _summarize_school_age(self, data: dict) -> str:
        region = data.get("지역", "")
        region_name = data.get("지역명", region)
        age_pop = data.get("연령별_인구", {})

        lines = [f"# {region} — 학령인구 현황", ""]

        # 경고
        if data.get("경고"):
            lines.append(f"> ⚠️ {data['경고']}")
            lines.append("")
        if data.get("주의"):
            lines.append(f"> ⚠️ {data['주의']}")
            lines.append("")

        school_total = 0
        elementary = middle = high = 0
        for age in self.SCHOOL_AGES:
            count = age_pop.get(f"{age}세", 0)
            school_total += count
            if 6 <= age <= 11:
                elementary += count
            elif 12 <= age <= 14:
                middle += count
            elif 15 <= age <= 17:
                high += count

        total = data.get("총인구", 0)

        # 요약 테이블
        lines.append("## 요약")
        lines.append("")
        lines.append("| 항목 | 인구수 | 비율 |")
        lines.append("|------|--------|------|")
        if total > 0:
            lines.append(f"| 총인구 | {total:,}명 | — |")
            lines.append(f"| **학령인구 합계** | **{school_total:,}명** | **{school_total/total*100:.1f}%** |")
            lines.append(f"| 초등학교(6~11세) | {elementary:,}명 | {elementary/total*100:.1f}% |")
            lines.append(f"| 중학교(12~14세) | {middle:,}명 | {middle/total*100:.1f}% |")
            lines.append(f"| 고등학교(15~17세) | {high:,}명 | {high/total*100:.1f}% |")
        else:
            lines.append(f"| **학령인구 합계** | **{school_total:,}명** | — |")
            lines.append(f"| 초등학교(6~11세) | {elementary:,}명 | — |")
            lines.append(f"| 중학교(12~14세) | {middle:,}명 | — |")
            lines.append(f"| 고등학교(15~17세) | {high:,}명 | — |")
        lines.append("")

        # 연령별 상세
        lines.append("## 학령인구 연령별 상세")
        lines.append("")
        lines.append("| 연령 | 인구수 |")
        lines.append("|------|--------|")
        for age in self.SCHOOL_AGES:
            count = age_pop.get(f"{age}세", 0)
            lines.append(f"| {age}세 | {count:,}명 |")
        lines.append("")

        lines.append(f"- 조회지역: {region_name}")
        lines.append(f"- 조회범위: {data.get('조회범위', '미확인')}")
        lines.append("")
        lines.append("---")
        lines.append("*주민등록인구통계(jumin.mois.go.kr) 자동 수집*")
        return "\n".join(lines)


def main():
    parser = PopulationTool.create_parser("학령인구 추이 자동 수집")
    parser.add_argument("region", help="지역명 (예: '서울특별시 광진구')")
    args = parser.parse_args()

    tool = PopulationTool.from_args(args)
    result = tool.run(region=args.region)
    tool.print_json(result)


if __name__ == "__main__":
    main()
