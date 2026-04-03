"""browser_tools mock 테스트.

Playwright 의존 없이 핵심 로직 검증:
  - BrowserTool 기본 동작 (save_json, save_csv, save_text, _close_popups, _extract_table_pairs)
  - HeritageTool API 응답 파싱 + XML 필터링 + 중복제거
  - SchoolInfoTool 카드 텍스트 파싱 + regex 패턴
  - BuildingInfoTool 로그인 감지 + th-td 추출
  - LandInfoTool JS 함수 호출 검증 + 주소 미매칭
  - PopulationTool iframe 접근 + 학령인구 계산
  - SchoolZoneTool 검색 결과 파싱 + zone iframe
  - base.py 설정 로드 + 재시도 로직
"""

import json
import logging
import threading
from unittest.mock import MagicMock, patch


# ── 공통 헬퍼 ──────────────────────────────────────────────────────


def _make_base_tool(tmp_path):
    """BrowserTool 인스턴스를 Playwright 없이 생성합니다."""
    from src.browser_tools.base import BrowserTool
    tool = BrowserTool.__new__(BrowserTool)
    tool.name = "test_tool"
    tool.url = "https://example.com"
    tool.output_dir = tmp_path / "output"
    tool.output_dir.mkdir(parents=True, exist_ok=True)
    tool.debug = False
    tool.headed = False
    tool.timeout = 30000
    tool.cancel_event = threading.Event()
    tool._step_count = 0
    tool._saved_files = []
    tool.logger = logging.getLogger("test_browser_tool")
    return tool


def _make_mock_page(**text_overrides):
    """Playwright Page mock을 생성합니다."""
    page = MagicMock()
    page.url = "https://example.com/test"
    page.evaluate = MagicMock(return_value=None)
    page.wait_for_timeout = MagicMock()
    page.wait_for_load_state = MagicMock()
    page.screenshot = MagicMock()

    # locator chain
    locator = MagicMock()
    locator.all.return_value = []
    locator.first = locator
    locator.count.return_value = 0
    locator.is_visible.return_value = False
    locator.inner_text.return_value = text_overrides.get("body_text", "")
    page.locator = MagicMock(return_value=locator)

    return page


# ── BrowserTool 기본 기능 ─────────────────────────────────────────


class TestBrowserToolBase:
    """BrowserTool 저장 유틸리티 테스트."""

    def test_save_json(self, tmp_path):
        """JSON 저장."""
        tool = _make_base_tool(tmp_path)
        data = {"key": "value", "숫자": 42}
        path = tool.save_json(data, "result.json")
        assert path.exists()
        loaded = json.loads(path.read_text(encoding="utf-8"))
        assert loaded["key"] == "value"
        assert loaded["숫자"] == 42

    def test_save_text(self, tmp_path):
        """텍스트 저장."""
        tool = _make_base_tool(tmp_path)
        path = tool.save_text("한글 텍스트 테스트", "result.txt")
        assert path.exists()
        assert path.read_text(encoding="utf-8") == "한글 텍스트 테스트"

    def test_save_csv(self, tmp_path):
        """CSV 저장."""
        tool = _make_base_tool(tmp_path)
        rows = [["이름", "나이"], ["홍길동", "30"], ["김철수", "25"]]
        path = tool.save_csv(rows, "result.csv", header=["이름", "나이"])
        assert path.exists()
        content = path.read_text(encoding="utf-8-sig")
        assert "홍길동" in content
        assert "김철수" in content

    def test_cancel_event_check(self, tmp_path):
        """cancel_event 설정 시 동작 확인."""
        tool = _make_base_tool(tmp_path)
        assert not tool.cancel_event.is_set()
        tool.cancel_event.set()
        assert tool.cancel_event.is_set()


class TestBrowserToolCommonUtils:
    """base.py 공통 유틸리티 (_close_popups, _extract_table_pairs) 테스트."""

    def test_close_popups_calls_evaluate(self, tmp_path):
        """_close_popups가 page.evaluate를 호출하고 대기합니다."""
        tool = _make_base_tool(tmp_path)
        page = _make_mock_page()
        tool._close_popups(page)
        page.evaluate.assert_called_once()
        page.wait_for_timeout.assert_called_once()

    def test_close_popups_custom_selectors(self, tmp_path):
        """커스텀 셀렉터 전달 시 해당 셀렉터가 사용됩니다."""
        tool = _make_base_tool(tmp_path)
        page = _make_mock_page()
        tool._close_popups(page, hide_selectors=".custom-popup", close_selectors=".custom-close")
        args = page.evaluate.call_args[0]
        assert ".custom-popup" in str(args)
        assert ".custom-close" in str(args)

    def test_extract_table_pairs_basic(self, tmp_path):
        """th-td 쌍이 올바르게 딕셔너리로 변환됩니다."""
        tool = _make_base_tool(tmp_path)
        page = MagicMock()

        # th mock 생성 — 체인: th.locator("xpath=..") → parent → parent.locator("td").first → td
        th1 = MagicMock()
        th1.inner_text.return_value = "학교명"
        td1 = MagicMock()
        td1.count.return_value = 1
        td1.is_visible.return_value = True
        td1.inner_text.return_value = "광장중학교"
        parent1 = MagicMock()
        parent1.locator.return_value.first = td1
        th1.locator.return_value = parent1

        th2 = MagicMock()
        th2.inner_text.return_value = "주소"
        td2 = MagicMock()
        td2.count.return_value = 1
        td2.is_visible.return_value = True
        td2.inner_text.return_value = "서울특별시 광진구"
        parent2 = MagicMock()
        parent2.locator.return_value.first = td2
        th2.locator.return_value = parent2

        locator = MagicMock()
        locator.all.return_value = [th1, th2]
        page.locator = MagicMock(return_value=locator)

        result = tool._extract_table_pairs(page)
        assert result["학교명"] == "광장중학교"
        assert result["주소"] == "서울특별시 광진구"

    def test_extract_table_pairs_skips_nav_keys(self, tmp_path):
        """네비게이션 키(홈, 검색 등)는 건너뜁니다."""
        tool = _make_base_tool(tmp_path)
        page = MagicMock()

        th_nav = MagicMock()
        th_nav.inner_text.return_value = "홈"
        locator = MagicMock()
        locator.all.return_value = [th_nav]
        page.locator = MagicMock(return_value=locator)

        result = tool._extract_table_pairs(page)
        assert "홈" not in result

    def test_extract_table_pairs_max_key_len(self, tmp_path):
        """키 길이가 max_key_len 초과 시 건너뜁니다."""
        tool = _make_base_tool(tmp_path)
        page = MagicMock()

        th_long = MagicMock()
        th_long.inner_text.return_value = "아" * 31  # 31글자
        locator = MagicMock()
        locator.all.return_value = [th_long]
        page.locator = MagicMock(return_value=locator)

        result = tool._extract_table_pairs(page, max_key_len=30)
        assert len(result) == 0


class TestBrowserToolConfig:
    """settings.yaml에서 browser_tools 설정이 로드되는지 검증."""

    def test_constants_are_ints(self):
        """상수가 정수형으로 로드됩니다."""
        from src.browser_tools.base import (
            DEFAULT_TIMEOUT_MS, SEARCH_WAIT_MS, POPUP_WAIT_MS,
            GIS_LOAD_WAIT_MS, VIEWPORT_WIDTH,
        )
        assert isinstance(DEFAULT_TIMEOUT_MS, int)
        assert isinstance(SEARCH_WAIT_MS, int)
        assert isinstance(POPUP_WAIT_MS, int)
        assert isinstance(GIS_LOAD_WAIT_MS, int)
        assert VIEWPORT_WIDTH >= 800


class TestBrowserToolRetry:
    """base.py run() 재시도 로직 검증."""

    def test_run_retry_on_failure(self, tmp_path):
        """execute() 실패 시 _max_retries만큼 재시도합니다."""
        from src.browser_tools.base import BrowserTool

        class FailTool(BrowserTool):
            name = "fail_tool"
            call_count = 0

            def execute(self, page, **kwargs):
                FailTool.call_count += 1
                raise RuntimeError("의도된 실패")

        tool = FailTool.__new__(FailTool)
        tool.name = "fail_tool"
        tool.headed = False
        tool.debug = False
        tool.timeout = 5000
        tool.cancel_event = None
        tool._step_count = 0
        tool._saved_files = []
        tool.output_dir = tmp_path / "output"
        tool.output_dir.mkdir(parents=True, exist_ok=True)
        tool.logger = logging.getLogger("test_fail_tool")

        FailTool.call_count = 0
        with patch("src.browser_tools.base.sync_playwright") as mock_pw:
            mock_browser = MagicMock()
            mock_context = MagicMock()
            mock_page = _make_mock_page()
            mock_browser.new_context.return_value = mock_context
            mock_context.new_page.return_value = mock_page
            mock_pw.return_value.__enter__ = MagicMock(return_value=MagicMock(
                chromium=MagicMock(launch=MagicMock(return_value=mock_browser))
            ))
            mock_pw.return_value.__exit__ = MagicMock(return_value=False)

            result = tool.run(_max_retries=3)

        assert result["성공"] is False
        assert "의도된 실패" in result["오류"]
        assert FailTool.call_count == 3


# ── HeritageTool (API 기반, Playwright 불필요) ─────────────────────


class TestHeritageTool:
    """국가유산 검색 — urllib mock 기반."""

    SAMPLE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
    <result>
        <totalCnt>2</totalCnt>
        <item>
            <ccbaMnm1>\xea\xb2\xbd\xeb\xb3\xb5\xea\xb6\x81</ccbaMnm1>
            <ccmaName>\xec\x82\xac\xec\xa0\x81</ccmaName>
            <ccbaLcad>\xec\x84\x9c\xec\x9a\xb8 \xec\xa2\x85\xeb\xa1\x9c\xea\xb5\xac</ccbaLcad>
            <ccbaAsno>0117-0000-0000</ccbaAsno>
        </item>
    </result>"""

    MULTI_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
    <result>
        <totalCnt>3</totalCnt>
        <item>
            <ccbaMnm1>\xea\xb2\xbd\xeb\xb3\xb5\xea\xb6\x81</ccbaMnm1>
            <ccmaName>\xec\x82\xac\xec\xa0\x81</ccmaName>
            <ccbaLcad>\xec\x84\x9c\xec\x9a\xb8 \xec\xa2\x85\xeb\xa1\x9c\xea\xb5\xac</ccbaLcad>
            <ccbaAsno>0117-0000-0000</ccbaAsno>
        </item>
        <item>
            <ccbaMnm1>\xea\xb2\xbd\xeb\xb3\xb5\xea\xb6\x81</ccbaMnm1>
            <ccmaName>\xec\x82\xac\xec\xa0\x81</ccmaName>
            <ccbaLcad>\xec\x84\x9c\xec\x9a\xb8 \xec\xa2\x85\xeb\xa1\x9c\xea\xb5\xac</ccbaLcad>
            <ccbaAsno>0117-0000-0000</ccbaAsno>
        </item>
        <item>
            <ccbaMnm1>\xec\xb0\xbd\xeb\x8d\x95\xea\xb6\x81</ccbaMnm1>
            <ccmaName>\xec\x82\xac\xec\xa0\x81</ccmaName>
            <ccbaLcad>\xec\x84\x9c\xec\x9a\xb8 \xec\xa2\x85\xeb\xa1\x9c\xea\xb5\xac</ccbaLcad>
            <ccbaAsno>0118-0000-0000</ccbaAsno>
        </item>
    </result>"""

    def _mock_urlopen(self, xml_data):
        mock_resp = MagicMock()
        mock_resp.read.return_value = xml_data
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    def test_heritage_instantiation(self):
        """HeritageTool 인스턴스 생성."""
        from src.browser_tools.heritage import HeritageTool
        tool = HeritageTool()
        assert tool.name == "heritage"
        assert "heritage" in tool.url or "khs" in tool.url or "go.kr" in tool.url

    @patch("urllib.request.urlopen")
    def test_heritage_api_via_run(self, mock_urlopen):
        """run(location=...) → _search_by_api 호출."""
        from src.browser_tools.heritage import HeritageTool
        mock_urlopen.return_value = self._mock_urlopen(self.SAMPLE_XML)

        tool = HeritageTool()
        result = tool.run(location="서울특별시 종로구")
        assert result["성공"] is True
        assert result["발견수"] >= 1

    def test_heritage_empty_location(self):
        """빈 위치 → 에러."""
        from src.browser_tools.heritage import HeritageTool
        tool = HeritageTool()
        result = tool.run(location="")
        assert result["성공"] is False

    @patch("urllib.request.urlopen")
    def test_heritage_network_error_returns_zero(self, mock_urlopen):
        """API 호출 실패 시 결과 0건."""
        from src.browser_tools.heritage import HeritageTool
        mock_urlopen.side_effect = Exception("Network error")

        tool = HeritageTool()
        result = tool.run(location="서울특별시 광진구")
        assert result["발견수"] == 0

    @patch("urllib.request.urlopen")
    def test_heritage_xml_deduplication(self, mock_urlopen):
        """동일 ccbaAsno → 중복 제거."""
        from src.browser_tools.heritage import HeritageTool
        mock_urlopen.return_value = self._mock_urlopen(self.MULTI_XML)

        tool = HeritageTool()
        result = tool.run(location="서울특별시 종로구")
        # 3건 중 ccbaAsno=0117 중복 → 2건
        assert result["발견수"] == 2

    def test_heritage_xml_parsing_standalone(self):
        """_parse_list_xml 직접 호출 — XML에서 item 추출."""
        from src.browser_tools.heritage import HeritageTool
        tool = HeritageTool()
        # _parse_list_xml(xml_data: str, kind_code: str)
        items = tool._parse_list_xml(self.SAMPLE_XML, "13")  # 13=사적
        assert len(items) == 1
        assert items[0]["명칭"] == "경복궁"
        assert items[0]["종목"] == "사적"

    def test_heritage_sgg_to_sido_mapping(self):
        """SGG_TO_SIDO 역매핑이 정상 동작합니다."""
        from src.browser_tools.heritage import SGG_TO_SIDO
        # "광진구"는 서울에만 있음
        assert "서울" in SGG_TO_SIDO.get("광진구", [])
        # "중구"는 여러 시도에 있음
        assert len(SGG_TO_SIDO.get("중구", [])) > 1


# ── SchoolInfoTool (page mock) ────────────────────────────────────


class TestSchoolInfoTool:
    """학교정보 검색 — Playwright page mock."""

    def test_instantiation(self):
        """도구 인스턴스 생성."""
        from src.browser_tools.schoolinfo import SchoolInfoTool
        tool = SchoolInfoTool()
        assert tool.name == "schoolinfo"
        assert "schoolinfo" in tool.url

    def test_empty_school_name(self):
        """빈 학교명 → 실패."""
        from src.browser_tools.schoolinfo import SchoolInfoTool
        tool = SchoolInfoTool()
        result = tool.run(school_name="")
        assert result["성공"] is False

    def test_card_text_regex_patterns(self, tmp_path):
        """검색 결과 카드 텍스트에서 regex 패턴이 올바르게 추출됩니다."""
        from src.browser_tools.schoolinfo import SchoolInfoTool
        tool = SchoolInfoTool()
        tool.output_dir = tmp_path
        tool._saved_files = []
        tool.debug = False
        tool.logger = logging.getLogger("test_schoolinfo")

        page = _make_mock_page()
        # 검색 결과 카드 텍스트 시뮬레이션
        card_text = (
            "설립구분 : 공립  학생수 : 571명 (남 296명, 여 275명)\n"
            "설립유형 : 단설  교원수 : 57명 (남 18명, 여 39명)\n"
            "설립일자 : 1982년 3월 1일\n"
            "대표번호 : 02-1234-5678  관할교육청 : 서울특별시광진교육지원청\n"
            "주소 : 서울특별시 광진구 아차산로 200\n"
            "홈페이지 : https://www.school.go.kr\n"
            "체육집회공간 : 1실\n"
            "교원1인당 학생수\t학급당 학생수\t전체 학생수\n"
            "10.0\t23.8\t571\n"
        )

        # page.locator("#contents, ...").first → content_locator
        content_locator = MagicMock()
        content_locator.count.return_value = 1
        content_locator.inner_text.return_value = card_text

        # locator(...) 반환의 .first가 content_locator를 가리키도록
        content_wrapper = MagicMock()
        content_wrapper.first = content_locator

        def locator_side_effect(selector):
            if "#contents" in selector or "main" in selector:
                return content_wrapper
            return MagicMock(all=MagicMock(return_value=[]))
        page.locator = locator_side_effect

        result = tool._extract_search_result_card(page)
        assert result["설립구분"] == "공립"
        assert result["학생수_총"] == 571
        assert result["학생수_남"] == 296
        assert result["학생수_여"] == 275
        assert result["교원수_총"] == 57
        assert result["교원1인당학생수"] == 10.0
        assert result["학급당학생수"] == 23.8
        assert "광진구" in result["주소"]
        assert result["대표번호"] == "02-1234-5678"

    def test_card_text_school_type_tab(self):
        """학교급 탭에서 학교급이 추출됩니다."""
        from src.browser_tools.schoolinfo import SchoolInfoTool
        tool = SchoolInfoTool()
        tool.logger = logging.getLogger("test_schoolinfo")

        page = _make_mock_page()
        card_text = "중학교(3)  고등학교(0)  초등학교(0)"
        content_locator = MagicMock()
        content_locator.count.return_value = 1
        content_locator.inner_text.return_value = card_text

        content_wrapper = MagicMock()
        content_wrapper.first = content_locator

        def locator_side_effect(selector):
            if "#contents" in selector or "main" in selector:
                return content_wrapper
            return MagicMock(all=MagicMock(return_value=[]))
        page.locator = locator_side_effect

        result = tool._extract_search_result_card(page)
        assert result["학교급"] == "중학교"


# ── BuildingInfoTool ───────────────────────────────────────────────


class TestBuildingInfoTool:
    """세움터 건축물 정보 — 로그인 감지 + th-td 추출."""

    def test_instantiation(self):
        from src.browser_tools.building_info import BuildingInfoTool
        tool = BuildingInfoTool()
        assert tool.name == "building_info"
        assert "eais.go.kr" in tool.url

    def test_empty_query(self):
        from src.browser_tools.building_info import BuildingInfoTool
        tool = BuildingInfoTool()
        result = tool.run(query="")
        assert result["성공"] is False

    def test_needs_login_url_login(self):
        """URL에 'login'이 있으면 로그인 필요."""
        from src.browser_tools.building_info import BuildingInfoTool
        tool = BuildingInfoTool()
        tool.logger = logging.getLogger("test_building")
        page = _make_mock_page()
        page.url = "https://www.eais.go.kr/moct/awp/abb01/login"
        assert tool._needs_login(page) is True

    def test_needs_login_error_page(self):
        """에러 페이지 텍스트 감지."""
        from src.browser_tools.building_info import BuildingInfoTool
        tool = BuildingInfoTool()
        tool.logger = logging.getLogger("test_building")
        page = _make_mock_page()
        page.url = "https://www.eais.go.kr/error"
        body_locator = MagicMock()
        body_locator.inner_text.return_value = "요청하신 페이지를 찾을 수 없습니다. 메인으로 이동"
        page.locator = MagicMock(return_value=body_locator)
        assert tool._needs_login(page) is True

    def test_needs_login_form_visible(self):
        """검색 폼이 보이면 로그인 불필요."""
        from src.browser_tools.building_info import BuildingInfoTool
        tool = BuildingInfoTool()
        tool.logger = logging.getLogger("test_building")
        page = _make_mock_page()
        page.url = "https://www.eais.go.kr/moct/bci/acd01/BCIACD0101"

        body_locator = MagicMock()
        body_locator.inner_text.return_value = "건축물대장 열람"
        form_locator = MagicMock()
        form_locator.first = form_locator
        form_locator.is_visible.return_value = True

        call_count = {"n": 0}
        def locator_side_effect(selector):
            call_count["n"] += 1
            if "body" in selector:
                return body_locator
            return form_locator
        page.locator = locator_side_effect

        assert tool._needs_login(page) is False

    def test_extract_building_detail_uses_table_pairs(self):
        """_extract_building_detail이 base의 _extract_table_pairs를 사용합니다."""
        from src.browser_tools.building_info import BuildingInfoTool
        tool = BuildingInfoTool()
        tool.logger = logging.getLogger("test_building")

        page = MagicMock()
        th = MagicMock()
        th.inner_text.return_value = "주용도"
        td = MagicMock()
        td.count.return_value = 1
        td.is_visible.return_value = True
        td.inner_text.return_value = "교육연구시설"
        parent = MagicMock()
        parent.locator.return_value.first = td  # .locator("td").first 체인
        th.locator.return_value = parent

        # page.locator("th") → th 목록 / page.locator("text=...") → 추가 필드용
        fallback_el = MagicMock()
        fallback_el.is_visible.return_value = False

        def locator_side_effect(selector):
            mock = MagicMock()
            if selector == "th":
                mock.all.return_value = [th]
            else:
                mock.all.return_value = []
                mock.first = fallback_el
            return mock
        page.locator = locator_side_effect

        detail = tool._extract_building_detail(page)
        assert detail.get("주용도") == "교육연구시설"


# ── SchoolZoneTool (page mock) ────────────────────────────────────


class TestSchoolZoneTool:
    """학구도 검색 — 기본 + 파싱 테스트."""

    def test_instantiation(self):
        from src.browser_tools.school_zone import SchoolZoneTool
        tool = SchoolZoneTool()
        assert tool.name == "school_zone"

    def test_empty_address(self):
        from src.browser_tools.school_zone import SchoolZoneTool
        tool = SchoolZoneTool()
        result = tool.run(address="")
        assert result["성공"] is False

    def test_parse_zone_iframe_extracts_schools(self):
        """_parse_zone_iframe이 li[schoolname] data 속성에서 학교를 추출합니다."""
        from src.browser_tools.school_zone import SchoolZoneTool
        tool = SchoolZoneTool()
        tool.logger = logging.getLogger("test_school_zone")

        frame = MagicMock()

        # 주소 정보
        addr_detail = MagicMock()
        addr_detail.locator.side_effect = lambda sel: (
            MagicMock(inner_text=MagicMock(return_value="도로명"))
            if sel == ".label" else
            MagicMock(inner_text=MagicMock(return_value="서울특별시 광진구 아차산로 200"))
        )
        addr_wrap = MagicMock()
        addr_wrap.all.return_value = [addr_detail]

        def frame_locator_side_effect(selector):
            if ".s-addr-wrap" in selector:
                return addr_wrap
            elif "#tabSchool" in selector:
                tab = MagicMock()
                tab.count.return_value = 1
                # 학구명
                title_el = MagicMock()
                title_el.count.return_value = 1
                title_el.inner_text.return_value = "광장학구"
                # 학교 목록
                item = MagicMock()
                item.get_attribute = lambda attr: {
                    "schoolname": "광장중학교",
                    "distance": "500",
                    "bigo": "",
                    "daddr": "서울특별시 광진구",
                    "eduarea": "광진",
                }.get(attr, "")

                school_list = MagicMock()
                school_list.all.return_value = [item]

                def tab_locator(sel):
                    if ".s-addr-tit" in sel:
                        return title_el
                    if ".school-list" in sel:
                        return school_list
                    return MagicMock(count=MagicMock(return_value=0))
                tab.locator = tab_locator
                return tab
            return MagicMock(count=MagicMock(return_value=0), all=MagicMock(return_value=[]))

        frame.locator = frame_locator_side_effect

        zone = tool._parse_zone_iframe(frame)
        assert "도로명" in zone
        # 탭 중 하나에서 학교 목록이 추출되어야 함
        has_school_list = any("학교목록" in k for k in zone)
        assert has_school_list

    def test_search_results_extraction(self):
        """_extract_search_results가 테이블에서 학교를 추출합니다."""
        from src.browser_tools.school_zone import SchoolZoneTool
        tool = SchoolZoneTool()
        tool.logger = logging.getLogger("test_school_zone")

        page = MagicMock()

        # 헬퍼: cell.locator("button.btn-map").first 체인을 올바르게 mock
        def _make_cell(header, text, btn_count=0, btn_attrs=None):
            cell = MagicMock()
            cell.get_attribute = lambda a: header if a == "data-cell-header" else ""
            cell.inner_text.return_value = text
            btn = MagicMock()
            btn.count.return_value = btn_count
            if btn_attrs:
                btn.get_attribute = lambda a: btn_attrs.get(a, "")
            wrapper = MagicMock()
            wrapper.first = btn
            cell.locator = MagicMock(return_value=wrapper)
            return cell

        cell1 = _make_cell("NO", "1")
        cell2 = _make_cell("학교명", "광장중학교")
        cell3 = _make_cell("지역", "서울")
        cell4 = _make_cell("", "", btn_count=1, btn_attrs={
            "data-schoolid": "SCH123", "data-schoolclass": "M",
        })

        row = MagicMock()
        row.locator = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[cell1, cell2, cell3, cell4])))

        rows_locator = MagicMock()
        rows_locator.all.return_value = [row]
        page.locator = MagicMock(return_value=rows_locator)

        result = tool._extract_search_results(page, "광장중학교")
        assert len(result["학교목록"]) == 1
        assert result["학교목록"][0]["학교명"] == "광장중학교"
        assert result["학교목록"][0]["_schoolId"] == "SCH123"


# ── LandInfoTool ──────────────────────────────────────────────────


class TestLandInfoTool:
    """토지이음 — 기본 + JS 호출 + 주소 미매칭."""

    def test_instantiation(self):
        from src.browser_tools.land_info import LandInfoTool
        tool = LandInfoTool()
        assert tool.name == "land_info"
        assert "eum.go.kr" in tool.url

    def test_empty_address(self):
        from src.browser_tools.land_info import LandInfoTool
        tool = LandInfoTool()
        result = tool.run(address="")
        assert result["성공"] is False

    def test_extract_land_info_table_regex(self):
        """토지 정보 테이블 텍스트에서 지목/면적/공시지가가 파싱됩니다."""
        from src.browser_tools.land_info import LandInfoTool
        tool = LandInfoTool()
        tool.logger = logging.getLogger("test_land")

        page = MagicMock()
        table_text = (
            "소재지\t서울특별시 광진구 군자동 98\n"
            "지목\t학교용지\t면적\t101,062 ㎡\n"
            "개별공시지가(원/㎡)\t3,150,000원\n"
        )
        page.evaluate = MagicMock(return_value={"basic": table_text, "sections": []})
        page.locator = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))

        result = tool._extract_land_info(page, "군자동 98")
        assert result["지목"] == "학교용지"
        assert result["면적"] == "101,062 ㎡"
        assert "3,150,000" in result["개별공시지가"]
        assert "군자동" in result.get("소재지", "")

    def test_extract_land_info_empty_table(self):
        """테이블 없으면 주소만 반환."""
        from src.browser_tools.land_info import LandInfoTool
        tool = LandInfoTool()
        tool.logger = logging.getLogger("test_land")
        page = MagicMock()
        page.evaluate = MagicMock(return_value={"basic": "", "sections": []})
        page.locator = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        result = tool._extract_land_info(page, "없는주소")
        assert result["주소"] == "없는주소"
        assert "지목" not in result

    def test_usage_zone_extraction(self):
        """용도지역/지구 테이블에서 카테고리별 추출 (JS evaluate 방식)."""
        from src.browser_tools.land_info import LandInfoTool
        tool = LandInfoTool()
        tool.logger = logging.getLogger("test_land")

        page = MagicMock()
        # _safe_evaluate가 JS로 추출한 [{category, value}] 리스트 반환
        tool._safe_evaluate = MagicMock(return_value=[
            {"category": "국토의 계획 및 이용에 관한 법률", "value": "제2종일반주거지역"},
        ])

        result = {}
        tool._extract_usage_zones(page, result)
        assert "국토계획법_지역지구" in result
        assert "일반주거" in result["국토계획법_지역지구"]


# ── PopulationTool ────────────────────────────────────────────────


class TestPopulationTool:
    """주민등록인구 — 기본 + 학령인구 계산."""

    def test_instantiation(self):
        from src.browser_tools.population import PopulationTool
        tool = PopulationTool()
        assert tool.name == "population"

    def test_empty_region(self):
        from src.browser_tools.population import PopulationTool
        tool = PopulationTool()
        result = tool.run(region="")
        assert result["성공"] is False

    def test_school_ages_range(self):
        """SCHOOL_AGES가 6~17세입니다."""
        from src.browser_tools.population import PopulationTool
        assert PopulationTool.SCHOOL_AGES == list(range(6, 18))

    def test_sido_map_coverage(self):
        """17개 시도가 모두 매핑되어 있습니다."""
        from src.browser_tools.population import PopulationTool
        assert len(PopulationTool.SIDO_MAP) == 17
        assert "서울" in PopulationTool.SIDO_MAP
        assert "세종" in PopulationTool.SIDO_MAP

    def test_find_sido_code(self):
        """시도 코드 검색."""
        from src.browser_tools.population import PopulationTool
        tool = PopulationTool()
        assert tool._find_sido_code("서울특별시") == "1100000000"
        assert tool._find_sido_code("경기도") == "4100000000"
        assert tool._find_sido_code("없는곳") == ""

    def test_summarize_school_age(self):
        """학령인구 요약 마크다운 생성."""
        from src.browser_tools.population import PopulationTool
        tool = PopulationTool()

        data = {
            "지역": "서울특별시 광진구",
            "지역명": "광진구",
            "총인구": 350000,
            "연령별_인구": {},
            "조회범위": "시군구",
        }
        # 학령인구 데이터 생성
        for age in range(0, 101):
            data["연령별_인구"][f"{age}세"] = 3000 if 6 <= age <= 17 else 1000

        summary = tool._summarize_school_age(data)
        assert "학령인구 현황" in summary
        assert "초등학교" in summary
        assert "중학교" in summary
        assert "고등학교" in summary
        # 6~11세 (6명) × 3000 = 18,000
        assert "18,000" in summary

    def test_summarize_school_age_warning(self):
        """전국 수준 인구 → 경고 포함."""
        from src.browser_tools.population import PopulationTool
        tool = PopulationTool()

        data = {
            "지역": "서울특별시 광진구",
            "지역명": "전체",
            "총인구": 50_000_000,
            "연령별_인구": {},
            "조회범위": "시도",
            "경고": "총인구 50,000,000명은 전국 수준입니다.",
        }
        summary = tool._summarize_school_age(data)
        assert "전국 수준" in summary

    def test_extract_age_data_basic(self):
        """테이블에서 연령별 데이터 추출."""
        from src.browser_tools.population import PopulationTool
        tool = PopulationTool()
        tool.logger = logging.getLogger("test_pop")

        iframe = MagicMock()

        # 테이블 mock
        header_row = MagicMock()
        header_row.query_selector_all = MagicMock(return_value=[])  # th만 있는 행

        # data row: [코드, 지역, 총인구, 구간합, 0세, 1세, ..., 17세, ...]
        data_values = ["1168000000", "광진구", "350,000", "350,000"]
        for age in range(101):
            data_values.append(str(3000 + age))

        data_cells = [MagicMock(inner_text=MagicMock(return_value=v)) for v in data_values]
        data_row = MagicMock()
        data_row.query_selector_all = MagicMock(return_value=data_cells)

        table = MagicMock()
        table.inner_text = MagicMock(return_value="총인구 0세 1세")
        table.query_selector_all = MagicMock(return_value=[header_row, data_row])

        iframe.query_selector_all = MagicMock(return_value=[table])

        result = tool._extract_age_data(iframe, "서울특별시 광진구")
        assert result["지역명"] == "광진구"
        assert result["총인구"] == 350000
        assert result["연령별_인구"]["0세"] == 3000
        assert result["연령별_인구"]["6세"] == 3006
