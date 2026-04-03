"""학교알리미 — 학교 공시정보 자동 수집.

schoolinfo.go.kr에서 학교명으로 검색하여 공시정보를 수집합니다.
검색 결과 페이지의 학교 카드에서 모든 기본정보를 추출합니다.

수집 항목:
  - 설립구분, 설립유형, 설립일자
  - 학생수 (총/남/여), 교원수 (총/남/여)
  - 주소, 대표번호, 관할교육청, 홈페이지
  - 체육집회공간, 급식정보
  - 교원1인당학생수, 학급당학생수

사용법:
    python -m src.browser_tools.schoolinfo "광장중학교"
    python -m src.browser_tools.schoolinfo "광남고등학교" --headed --debug
"""

import re
from playwright.sync_api import Page

from .base import BrowserTool, SEARCH_WAIT_MS, DETAIL_WAIT_MS


class SchoolInfoTool(BrowserTool):
    name = "schoolinfo"
    description = "학교알리미 공시정보 자동 수집"
    url = "https://www.schoolinfo.go.kr"

    def execute(self, page: Page, school_name: str = "",
               schul_id: str = "", **kwargs) -> dict:
        if not school_name and not schul_id:
            raise ValueError("학교명을 입력하세요")

        # schulId로 직접 상세 조회 (후보 선택 후 재실행)
        if schul_id:
            return self._execute_direct(page, school_name, schul_id)

        self.logger.info(f"학교알리미 검색: {school_name}")

        # 1. 메인 페이지 접속 (리다이렉트 완전 대기)
        page.goto(self.url, wait_until="networkidle", timeout=15_000)

        # 팝업 닫기 (학교알리미는 메인에 레이어 팝업이 뜸)
        try:
            self._close_popups(page)
        except Exception:
            pass
        # 팝업 닫기가 네비게이션을 트리거할 수 있으므로 안정화 대기
        page.wait_for_timeout(500)
        self._screenshot(page, "main")

        # 2. 학교 검색 — hidden field를 JS로 설정 후 submit
        #    fill()이 autocomplete를 트리거해 context가 파괴될 수 있으므로
        #    evaluate 한 번에 모든 필드 설정 + submit까지 처리
        page.evaluate("""(name) => {
            var kw = document.getElementById('SEARCH_KEYWORD');
            if (kw) kw.value = name;
            var sn = document.getElementById('SEARCH_SCHUL_NM');
            if (sn) sn.value = name;
            var sm = document.getElementById('SEARCH_MODE');
            if (sm) sm.value = '';
            var st = document.getElementById('SEARCH_TYPE');
            if (st) st.value = '1';
            var form = document.getElementById('headerSearchForm');
            if (form) form.submit();
        }""", school_name)
        try:
            page.wait_for_load_state("networkidle", timeout=10_000)
        except Exception:
            pass
        page.wait_for_timeout(SEARCH_WAIT_MS)

        self._screenshot(page, "search_result")

        # 3. 검색 결과 수 확인 — 여러 학교면 후보 목록 반환
        candidates = self._extract_candidates(page)
        school_data = {"학교명": school_name}
        school_data["검색결과수"] = len(candidates)

        if len(candidates) > 1:
            # 여러 학교 → 후보 목록만 반환 (사용자 선택 후 재조회)
            self.logger.info(f"검색 결과 {len(candidates)}건 — 후보 목록 반환")
            school_data["후보목록"] = candidates
            school_data["성공"] = True
            safe_name = re.sub(r'[^\w가-힣]', '_', school_name)[:30]
            self.save_json(school_data, f"schoolinfo_{safe_name}.json")
            self.save_text(self._format_markdown(school_data), f"schoolinfo_{safe_name}.md")
            return school_data

        # 단일 결과 또는 0건 — 기존 로직으로 카드 추출
        school_data.update(self._extract_search_result_card(page))

        school_links = page.locator("a[href*='searchSchul']").all()

        if not school_data.get("설립구분") and not school_data.get("학생수"):
            # 카드에서 추출 실패 → 상세 페이지 시도
            if school_links:
                self.logger.info("검색 결과 카드 추출 실패, 상세 페이지로 이동")
                school_links[0].click()
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(SEARCH_WAIT_MS)
                self._screenshot(page, "detail_page")
                school_data.update(self._extract_detail_page(page))

        school_data["성공"] = bool(
            school_data.get("학생수") or school_data.get("교원수")
            or school_data.get("설립구분")
        )

        # 카드에서 데이터를 추출했으면 검색결과수를 최소 1로 보정
        if school_data["성공"] and school_data.get("검색결과수", 0) == 0:
            school_data["검색결과수"] = 1

        if not school_data["성공"]:
            school_data["오류"] = "학교 정보를 추출하지 못했습니다"

        self._screenshot(page, "final")

        # 5. 결과 저장
        safe_name = re.sub(r'[^\w가-힣]', '_', school_name)[:30]
        self.save_json(school_data, f"schoolinfo_{safe_name}.json")

        md_content = self._format_markdown(school_data)
        self.save_text(md_content, f"schoolinfo_{safe_name}.md")

        self.logger.info(f"수집 완료: {len(school_data)}개 항목")
        return school_data

    def _execute_direct(self, page: Page, school_name: str, schul_id: str) -> dict:
        """schulId로 학교알리미 상세 페이지에 직접 접근하여 정보를 수집합니다.

        searchSchul()은 새 창(팝업)을 여는 방식이므로,
        먼저 검색 페이지를 열고 → 해당 링크 클릭 시 새 창 캡처.
        """
        label = school_name or schul_id
        self.logger.info(f"학교알리미 직접 조회: {label} (schulId: {schul_id})")

        # 1. 검색 페이지에서 학교명으로 검색
        page.goto(self.url, wait_until="networkidle", timeout=15_000)
        try:
            self._close_popups(page)
        except Exception:
            pass
        page.wait_for_timeout(500)

        page.evaluate("""(name) => {
            var kw = document.getElementById('SEARCH_KEYWORD');
            if (kw) kw.value = name;
            var sn = document.getElementById('SEARCH_SCHUL_NM');
            if (sn) sn.value = name;
            var sm = document.getElementById('SEARCH_MODE');
            if (sm) sm.value = '';
            var st = document.getElementById('SEARCH_TYPE');
            if (st) st.value = '1';
            var form = document.getElementById('headerSearchForm');
            if (form) form.submit();
        }""", label)
        try:
            page.wait_for_load_state("networkidle", timeout=10_000)
        except Exception:
            pass
        page.wait_for_timeout(SEARCH_WAIT_MS)

        # 더보기 클릭
        try:
            page.evaluate("""() => {
                var links = document.querySelectorAll('a');
                for (var i = 0; i < links.length; i++) {
                    if (links[i].innerText.indexOf('더보기') !== -1) {
                        links[i].click(); return true;
                    }
                }
                return false;
            }""")
            page.wait_for_timeout(1500)
        except Exception:
            pass

        # 2. searchSchul은 새 창을 여므로 popup 이벤트 대기
        school_data = {"학교명": label}
        try:
            with page.expect_popup(timeout=10_000) as popup_info:
                page.evaluate(f"searchSchul('{schul_id}')")
            popup_page = popup_info.value
            try:
                popup_page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                pass
            popup_page.wait_for_timeout(SEARCH_WAIT_MS)
            self._screenshot(popup_page, "direct_detail")

            school_data.update(self._extract_search_result_card(popup_page))

            if not school_data.get("설립구분") and not school_data.get("학생수"):
                school_data.update(self._extract_detail_page(popup_page))

            popup_page.close()
        except Exception as e:
            self.logger.warning(f"팝업 접근 실패: {e}")
            # 폴백: 현재 페이지에서 첫 번째 카드 추출
            school_data.update(self._extract_search_result_card(page))

        school_data["성공"] = bool(
            school_data.get("학생수") or school_data.get("교원수")
            or school_data.get("설립구분")
        )
        school_data["검색결과수"] = 1 if school_data["성공"] else 0

        if not school_data["성공"]:
            school_data["오류"] = "학교 정보를 추출하지 못했습니다"

        safe_name = re.sub(r'[^\w가-힣]', '_', label)[:30]
        self.save_json(school_data, f"schoolinfo_{safe_name}.json")
        self.save_text(self._format_markdown(school_data), f"schoolinfo_{safe_name}.md")
        self.logger.info(f"직접 조회 완료: {len(school_data)}개 항목")
        return school_data

    def _extract_candidates(self, page: Page) -> list:
        """검색 결과에서 학교 후보 목록을 추출합니다.

        학교알리미는 기본 2개만 표시하고 나머지는 '더보기' 클릭 필요.
        각 학교의 schulId를 반환하여 프론트에서 선택 후 재조회 가능.
        """
        # 더보기 클릭 → 전체 결과 로드
        try:
            page.evaluate("""() => {
                var links = document.querySelectorAll('a');
                for (var i = 0; i < links.length; i++) {
                    if (links[i].innerText.indexOf('더보기') !== -1) {
                        links[i].click();
                        return true;
                    }
                }
                return false;
            }""")
            page.wait_for_timeout(1500)
        except Exception:
            pass

        candidates = []
        try:
            candidates = page.evaluate("""() => {
                var results = [];
                var allBD = document.querySelectorAll('.basic_data');
                for (var i = 0; i < allBD.length; i++) {
                    var bd = allBD[i];
                    var link = bd.querySelector('a');
                    if (!link) continue;
                    var href = link.getAttribute('href') || '';
                    if (href.indexOf('searchSchul') === -1) continue;
                    var name = link.innerText.trim();
                    var match = href.match(/searchSchul\\('([^']+)'\\)/);
                    var schulId = match ? match[1] : '';
                    results.push({name: name, schulId: schulId});
                }
                return results;
            }""")
        except Exception:
            pass

        # schulId가 없는 후보 제거
        return [c for c in candidates if c.get("schulId")]

    def _extract_search_result_card(self, page: Page) -> dict:
        """검색 결과 페이지의 학교 카드에서 정보를 추출합니다.

        학교알리미 검색 결과 카드 구조:
          설립구분: 공립     학생수: 571명 (남 296명, 여 275명)
          설립유형: 단설     교원수: 57명 (남 18명, 여 39명)
          설립일자: 1982년   체육집회공간: 1실
          대표번호: 02-...   관할교육청: ...
          주소: ...          홈페이지: ...
        """
        info = {}

        # 전체 본문 텍스트에서 패턴 매칭으로 추출
        try:
            # 검색 결과 영역 텍스트
            content_area = page.locator("#contents, .content, #content, main").first
            if content_area.count() == 0:
                content_area = page.locator("body")
            full_text = content_area.inner_text()
        except Exception:
            return info

        # ── 핵심 정보 패턴 매칭 ──
        # 설립구분 등은 검색 결과 카드 내에서만 매칭 (콜론 뒤 값)
        patterns = {
            "설립구분": r'설립구분\s*[:：]\s*(공립|사립|국립)',
            "설립유형": r'설립유형\s*[:：]\s*(\S+)',
            "설립일자": r'설립일자\s*[:：]\s*(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)',
            "대표번호": r'대표번호\s*[:：]\s*([\d\-]+)',
            "주소": r'주\s*소\s*[:：]\s*(.+?)(?:\n|학생수|교원수|체육)',
            "학생수": r'학생수\s*[:：]\s*([\d,]+명\s*\(남\s*[\d,]+명\s*,\s*여\s*[\d,]+명\))',
            "교원수": r'교원수\s*[:：]\s*([\d,]+명\s*\(남\s*[\d,]+명\s*,\s*여\s*[\d,]+명\))',
            "체육집회공간": r'체육집회공간\s*[:：]\s*(\S+)',
            "관할교육청": r'관할교육청\s*[:：]\s*(.+?)(?:\n|$)',
            "홈페이지": r'홈페이지\s*[:：]\s*(https?://\S+)',
        }

        for field, pattern in patterns.items():
            match = re.search(pattern, full_text)
            if match:
                val = match.group(1).strip()
                if val:
                    info[field] = val

        # ── 주소 정리 (줄바꿈/공백 제거) ──
        if "주소" in info:
            info["주소"] = re.sub(r'\s+', ' ', info["주소"]).strip()
            # 뒤에 붙은 불필요한 텍스트 제거
            info["주소"] = re.split(r'(?:학생|교원|체육|홈페이지|관할)', info["주소"])[0].strip()

        # ── 학생수 상세 파싱 ──
        if "학생수" in info:
            m = re.search(r'([\d,]+)명\s*\(남\s*([\d,]+)명\s*,\s*여\s*([\d,]+)명\)', info["학생수"])
            if m:
                info["학생수_총"] = int(m.group(1).replace(",", ""))
                info["학생수_남"] = int(m.group(2).replace(",", ""))
                info["학생수_여"] = int(m.group(3).replace(",", ""))

        # ── 교원수 상세 파싱 ──
        if "교원수" in info:
            m = re.search(r'([\d,]+)명\s*\(남\s*([\d,]+)명\s*,\s*여\s*([\d,]+)명\)', info["교원수"])
            if m:
                info["교원수_총"] = int(m.group(1).replace(",", ""))
                info["교원수_남"] = int(m.group(2).replace(",", ""))
                info["교원수_여"] = int(m.group(3).replace(",", ""))

        # ── 차트 수치 추출 ──
        # 차트 대체텍스트 형식: "교원1인당 학생수\t학급당학생수\t전체학생수\n12.7\n24.8\n571"
        chart_match = re.search(
            r'교원1인당\s*학생수\s+학급당\s*학생수\s+전체\s*학생수\s+'
            r'([\d.]+)\s+([\d.]+)\s+([\d,]+)',
            full_text
        )
        if chart_match:
            info["교원1인당학생수"] = float(chart_match.group(1))
            info["학급당학생수"] = float(chart_match.group(2))
        else:
            # 개별 패턴 폴백
            for field, pattern in {
                "교원1인당학생수": r'교원1인당\s*학생수?\s*[:：\s]+([\d.]+)',
                "학급당학생수": r'학급당\s*학생수?\s*[:：\s]+([\d.]+)',
            }.items():
                match = re.search(pattern, full_text)
                if match:
                    info[field] = float(match.group(1))

        # ── 학교급 추출 (탭에서 결과수>0인 것) ──
        for school_type in ["중학교", "고등학교", "초등학교"]:
            tab_match = re.search(rf'{school_type}\(([1-9]\d*)\)', full_text)
            if tab_match:
                info["학교급"] = school_type
                break

        # ── 급식 정보 (최신 날짜 우선) ──
        meal_matches = re.findall(
            r'(\d{4}\.\s*\d{2}\.\s*\d{2}\s*\S+\s*\[.+?\])\s*\n(.+?)(?=\d{4}\.\s*\d{2}\.\s*\d{2}\s*\S+\s*\[|\n\n|\n학급당)',
            full_text, re.DOTALL
        )
        if meal_matches:
            # 마지막 매칭이 최신 날짜 (사이트 역순 표시 대비: 날짜 비교로 최신 선택)
            meal_date, meal_menu = meal_matches[-1]
            for md, mm in meal_matches:
                # 숫자만 추출해서 비교 (YYYYMMDD)
                d = re.sub(r'\D', '', md.split('[')[0])
                best_d = re.sub(r'\D', '', meal_date.split('[')[0])
                if d > best_d:
                    meal_date, meal_menu = md, mm
            meal_date = meal_date.strip()
            meal_menu = meal_menu.strip()
            # 잔여 UI 텍스트 제거
            meal_menu = re.sub(r'\n?(?:topscroll|downscroll|prevscroll|nextscroll)\s*', '', meal_menu)
            meal_menu = meal_menu.strip()
            info["급식일자"] = meal_date
            info["급식메뉴"] = meal_menu

        # ── 학교명 보정 (검색 결과에서 실제 학교명 추출) ──
        name_match = re.search(r'[초중고]\s+(\S+(?:초등학교|중학교|고등학교))', full_text)
        if name_match:
            info["학교명_정식"] = name_match.group(1)

        return info

    def _extract_detail_page(self, page: Page) -> dict:
        """학교 상세 페이지(fallback)에서 정보를 추출합니다."""
        return self._extract_table_pairs(page)

    def _format_markdown(self, data: dict) -> str:
        """수집 결과를 마크다운으로 변환합니다."""
        name = data.get("학교명_정식", data.get("학교명", "학교"))
        school_type = data.get("학교급", "")
        lines = [
            f"# {name} — 학교알리미 공시정보",
            "",
        ]

        # 후보 목록 모드
        candidates = data.get("후보목록", [])
        if candidates and len(candidates) > 1:
            lines.append(f"검색 결과: {len(candidates)}개교")
            lines.append("")
            for i, c in enumerate(candidates, 1):
                cname = c.get("학교명", c.get("name", f"{i}번"))
                lines.append(f"- {cname}")
            lines.append("")
            lines.append("---")
            lines.append("*학교알리미(schoolinfo.go.kr) 자동 수집*")
            return "\n".join(lines)

        if data.get("오류"):
            lines.append(f"> **수집 실패**: {data['오류']}")
            lines.append("")
            lines.append("---")
            lines.append("*학교알리미(schoolinfo.go.kr) 자동 수집*")
            return "\n".join(lines)

        # ── 기본정보 테이블 ──
        lines.append("## 기본정보")
        lines.append("")
        lines.append("| 항목 | 내용 |")
        lines.append("|------|------|")

        basic_fields = [
            ("학교급", school_type),
            ("설립구분", data.get("설립구분", "")),
            ("설립유형", data.get("설립유형", "")),
            ("설립일자", data.get("설립일자", "")),
            ("주소", data.get("주소", "")),
            ("대표번호", data.get("대표번호", "")),
            ("관할교육청", data.get("관할교육청", "")),
            ("홈페이지", data.get("홈페이지", "")),
        ]
        for label, val in basic_fields:
            if val:
                lines.append(f"| {label} | {val} |")
        lines.append("")

        # ── 학생·교원 현황 ──
        has_students = "학생수" in data or "학생수_총" in data
        has_teachers = "교원수" in data or "교원수_총" in data
        if has_students or has_teachers:
            lines.append("## 학생·교원 현황")
            lines.append("")
            lines.append("| 구분 | 합계 | 남 | 여 |")
            lines.append("|------|------|------|------|")
            if has_students:
                total = data.get("학생수_총")
                male = data.get("학생수_남")
                female = data.get("학생수_여")
                # total이 int인 경우 0도 유효한 값이므로 isinstance로 확인
                if isinstance(total, int):
                    male_str = f"{male:,}명" if isinstance(male, int) else "—"
                    female_str = f"{female:,}명" if isinstance(female, int) else "—"
                    lines.append(f"| **학생수** | **{total:,}명** | {male_str} | {female_str} |")
                else:
                    lines.append(f"| **학생수** | {data.get('학생수', '')} | — | — |")
            if has_teachers:
                total = data.get("교원수_총")
                male = data.get("교원수_남")
                female = data.get("교원수_여")
                if isinstance(total, int):
                    male_str = f"{male:,}명" if isinstance(male, int) else "—"
                    female_str = f"{female:,}명" if isinstance(female, int) else "—"
                    lines.append(f"| **교원수** | **{total:,}명** | {male_str} | {female_str} |")
                else:
                    lines.append(f"| **교원수** | {data.get('교원수', '')} | — | — |")
            lines.append("")

        # ── 핵심 지표 ──
        metrics = []
        if data.get("교원1인당학생수"):
            metrics.append(("교원 1인당 학생수", f"{data['교원1인당학생수']}명"))
        if data.get("학급당학생수"):
            metrics.append(("학급당 학생수", f"{data['학급당학생수']}명"))
        if data.get("체육집회공간"):
            metrics.append(("체육집회공간", data["체육집회공간"]))

        if metrics:
            lines.append("## 핵심 지표")
            lines.append("")
            lines.append("| 지표 | 값 |")
            lines.append("|------|------|")
            for label, val in metrics:
                lines.append(f"| {label} | {val} |")
            lines.append("")

        # ── 급식정보 ──
        if data.get("급식메뉴"):
            lines.append("## 급식정보 (참고)")
            lines.append("")
            if data.get("급식일자"):
                lines.append(f"**{data['급식일자']}** (사이트 기준 최신 등록 급식)")
                lines.append("")
            lines.append(f"```")
            lines.append(data["급식메뉴"])
            lines.append(f"```")
            lines.append("")

        lines.append("---")
        lines.append("*학교알리미(schoolinfo.go.kr) 자동 수집*")
        return "\n".join(lines)


def main():
    parser = SchoolInfoTool.create_parser("학교알리미 공시정보 자동 수집")
    parser.add_argument("school_name", help="검색할 학교명")
    args = parser.parse_args()

    tool = SchoolInfoTool.from_args(args)
    result = tool.run(school_name=args.school_name)
    tool.print_json(result)


if __name__ == "__main__":
    main()
