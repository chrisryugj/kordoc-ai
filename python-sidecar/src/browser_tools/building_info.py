"""세움터 — 건축물대장 정보 조회.

eais.go.kr에서 건축물 정보를 검색합니다.
로그인이 필요한 경우 headed 브라우저로 전환하여 사용자 로그인을 대기합니다.

사용법:
    python -m src.browser_tools.building_info "서울특별시 광진구 아차산로 200"
    python -m src.browser_tools.building_info "OO초등학교" --headed --debug
"""

import re
from playwright.sync_api import Page

from .base import BrowserTool, SEARCH_WAIT_MS, DETAIL_WAIT_MS


class BuildingInfoTool(BrowserTool):
    name = "building_info"
    description = "세움터 건축물 정보 조회"
    url = "https://www.eais.go.kr"
    # 건축물대장 열람 (로그인 후 접근)
    ledger_url = "https://www.eais.go.kr/moct/bci/acd01/BCIACD0101"

    def _needs_login(self, page: Page) -> bool:
        """로그인이 필요한 상태인지 판단합니다.

        세움터 건축물대장 열람은 반드시 로그인이 필요합니다.
        미로그인 시 에러 페이지("요청하신 페이지를 찾을 수 없습니다")로 리다이렉트됩니다.
        """
        url_lower = page.url.lower()

        # 로그인 페이지로 리다이렉트된 경우
        if "login" in url_lower or "cert" in url_lower:
            return True

        # 에러 페이지 감지 ("요청하신 페이지를 찾을 수 없습니다", "메인으로 이동")
        try:
            body_text = page.locator("body").inner_text()[:500]
            if "찾을 수 없습니다" in body_text or "메인으로 이동" in body_text:
                return True
        except Exception:
            pass

        # 건축물대장 검색 폼이 있는지 확인 (있으면 로그인 성공 상태)
        try:
            form = page.locator(
                "input[name*='search'], #searchForm, .search_area, "
                "input[placeholder*='검색'], input[placeholder*='주소']"
            ).first
            if form.is_visible():
                return False  # 검색 폼이 보이면 로그인된 상태
        except Exception:
            pass

        # 위 조건 모두 해당 안 되면 로그인 필요로 판단 (안전 측)
        return True

    def execute(self, page: Page, query: str = "", **kwargs) -> dict:
        if not query:
            raise ValueError("검색어(주소 또는 건물명)를 입력하세요")

        self.logger.info(f"세움터 검색: {query}")

        # 1. 건축물대장 열람 페이지 직접 접속
        page.goto(self.ledger_url, wait_until="domcontentloaded")
        page.wait_for_timeout(SEARCH_WAIT_MS)
        self._screenshot(page, "main")

        # 2. 로그인 필요 여부 확인
        if self._needs_login(page):
            self.logger.warning("세움터 건축물대장 열람에 로그인이 필요합니다")

            if not self.headed:
                result = {
                    "검색어": query,
                    "로그인_필요": True,
                    "성공": False,
                    "안내": (
                        "세움터 건축물대장은 로그인이 필요합니다.\n"
                        "① 아래 '로그인 후 수집' 버튼을 클릭하면 브라우저가 열립니다.\n"
                        "② 공인인증서/간편인증으로 로그인하세요.\n"
                        "③ 로그인이 완료되면 자동으로 수집을 시작합니다."
                    ),
                }
                # 실패 시에도 저장하되 실패 상태 명시
                safe_query = re.sub(r'[^\w가-힣]', '_', query)[:30]
                self.save_json(result, f"building_{safe_query}.json")
                return result

            # headed 모드: 메인 페이지로 이동 후 로그인 대기
            self.logger.info("세움터 메인 페이지에서 로그인해주세요 (공인인증서 / 간편인증)")
            page.goto("https://www.eais.go.kr", wait_until="domcontentloaded")
            page.wait_for_timeout(SEARCH_WAIT_MS)

            # 로그인 성공 감지: "로그아웃" 버튼 표시 OR ledger_url 접근 가능
            logged_in = self.wait_for_login(
                page,
                success_indicator="a:has-text('로그아웃'), button:has-text('로그아웃'), #logoutBtn",
                timeout_sec=180,
            )
            # 로그아웃 버튼 감지 실패 시 ledger_url 직접 접근으로 재확인
            if not logged_in:
                page.goto(self.ledger_url, wait_until="domcontentloaded")
                page.wait_for_timeout(SEARCH_WAIT_MS)
                logged_in = not self._needs_login(page)
            if not logged_in:
                return {
                    "검색어": query,
                    "성공": False,
                    "오류": "로그인 대기 시간이 초과되었습니다. 다시 시도해주세요.",
                }

            page.goto(self.ledger_url, wait_until="domcontentloaded")
            page.wait_for_timeout(SEARCH_WAIT_MS)
            self._screenshot(page, "after_login")

        # 3. 검색 실행
        search_input = page.locator(
            "input[type='text'], input[name*='search'], input[placeholder*='검색']"
        ).first
        if search_input.is_visible():
            search_input.fill(query)
            search_input.press("Enter")
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(SEARCH_WAIT_MS)
        self._screenshot(page, "search_result")

        # 4. 검색 결과 수집
        result = self._extract_search_results(page, query)

        # 5. 첫 번째 결과 상세 조회
        detail_links = page.locator("table a, .list a, td a").all()
        if detail_links:
            self.logger.info("첫 번째 결과 상세 조회")
            detail_links[0].click()
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(DETAIL_WAIT_MS)
            self._screenshot(page, "detail")

            detail = self._extract_building_detail(page)
            result["상세정보"] = detail
            result["성공"] = bool(detail)
        else:
            result["성공"] = bool(result.get("결과목록"))

        # 6. 저장
        safe_query = re.sub(r'[^\w가-힣]', '_', query)[:30]
        self.save_json(result, f"building_{safe_query}.json")

        summary = self._format_summary(result)
        self.save_text(summary, f"building_{safe_query}.md")

        self.logger.info("조회 완료")
        return result

    def _extract_search_results(self, page: Page, query: str) -> dict:
        """검색 결과 목록을 추출합니다."""
        result = {"검색어": query, "결과목록": []}

        tables = page.locator("table").all()
        for table in tables:
            rows = table.locator("tr").all()
            # 헤더 추출
            headers = []
            if rows:
                header_cells = rows[0].locator("th").all()
                headers = [c.inner_text().strip() for c in header_cells]

            for row in rows[1:6]:  # 헤더 제외, 상위 5건
                cells = row.locator("td").all()
                if len(cells) >= 2:
                    item = {}
                    for i, cell in enumerate(cells[:5]):
                        key = headers[i] if i < len(headers) else f"열{i+1}"
                        item[key] = cell.inner_text().strip()
                    result["결과목록"].append(item)

        return result

    def _extract_building_detail(self, page: Page) -> dict:
        """건축물 상세정보를 추출합니다."""
        detail = self._extract_table_pairs(page, max_key_len=20)

        # 주요 필드 추출
        target_fields = [
            "대지위치", "건물명칭", "주용도", "구조",
            "연면적", "건축면적", "건폐율", "용적률",
            "층수", "허가일", "사용승인일",
        ]
        for field in target_fields:
            if field not in detail:
                try:
                    el = page.locator(f"text={field}").first
                    if el.is_visible():
                        parent = el.locator("xpath=..")
                        td = parent.locator("td, dd, span").first
                        if td.is_visible():
                            detail[field] = td.inner_text().strip()
                except Exception:
                    continue

        return detail

    def _format_summary(self, result: dict) -> str:
        """결과 요약 텍스트를 생성합니다."""
        lines = [f"# 건축물 정보 - {result.get('검색어', '')}\n"]

        if result.get("로그인_필요"):
            lines.append("## 로그인 필요")
            lines.append(result.get("안내", "로그인이 필요합니다."))
            return "\n".join(lines)

        detail = result.get("상세정보", {})
        if detail:
            lines.append("## 건축물 상세")
            for key, val in detail.items():
                lines.append(f"- {key}: {val}")
        else:
            lines.append("## 검색 결과")
            for item in result.get("결과목록", []):
                lines.append(f"- {' | '.join(str(v) for v in item.values())}")
            if not result.get("결과목록"):
                lines.append("검색 결과 없음")

        return "\n".join(lines)


def main():
    parser = BuildingInfoTool.create_parser("세움터 건축물 정보 조회")
    parser.add_argument("query", help="검색어 (주소 또는 건물명)")
    args = parser.parse_args()

    tool = BuildingInfoTool.from_args(args)
    result = tool.run(query=args.query)
    tool.print_json(result)


if __name__ == "__main__":
    main()
