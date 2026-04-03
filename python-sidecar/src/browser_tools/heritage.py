"""유산정보 — 국가유산 존재여부 확인.

국가유산청 Open API(khs.go.kr)를 사용하여 위치 기반 국가유산을 검색합니다.
API 키가 필요하지 않으며, Playwright 없이 동작합니다.

기존 gis-heritage.go.kr 크롤링 방식에서 공식 API로 전환하여 안정성이 크게 향상되었습니다.

사용법:
    python -m src.browser_tools.heritage "서울특별시 종로구"
    python -m src.browser_tools.heritage "경기도 수원시 팔달구"
"""

import json
import re
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from playwright.sync_api import Page

from .base import BrowserTool


# 시도 코드 매핑 (국가유산청 API용)
SIDO_CODE = {
    "서울": "11", "부산": "21", "대구": "22", "인천": "23",
    "광주": "24", "대전": "25", "울산": "26", "세종": "45",
    "경기": "31", "강원": "32", "충북": "33", "충남": "34",
    "전북": "35", "전남": "36", "경북": "37", "경남": "38",
    "제주": "50",
}

# 시군구 → 시도 역매핑 (하위 주소만으로 시도를 추론)
# 동일 이름(중구, 남구 등)은 여러 시도에 존재하므로 리스트로 매핑
SGG_TO_SIDO = {
    # 서울 (25구)
    "종로구": ["서울"], "용산구": ["서울"], "성동구": ["서울"],
    "광진구": ["서울"], "동대문구": ["서울"], "중랑구": ["서울"],
    "성북구": ["서울"], "강북구": ["서울"], "도봉구": ["서울"],
    "노원구": ["서울"], "은평구": ["서울"], "서대문구": ["서울"],
    "마포구": ["서울"], "양천구": ["서울"], "영등포구": ["서울"],
    "구로구": ["서울"], "금천구": ["서울"], "동작구": ["서울"],
    "관악구": ["서울"], "서초구": ["서울"], "강남구": ["서울"],
    "송파구": ["서울"], "강동구": ["서울"],
    # 부산 (16구군)
    "해운대구": ["부산"], "수영구": ["부산"], "사하구": ["부산"],
    "금정구": ["부산"], "연제구": ["부산"], "사상구": ["부산"],
    "기장군": ["부산"], "부산진구": ["부산"],
    # 대구 (8구군)
    "수성구": ["대구"], "달서구": ["대구"], "달성군": ["대구"],
    # 인천 (10구군)
    "미추홀구": ["인천"], "연수구": ["인천"], "남동구": ["인천"],
    "부평구": ["인천"], "계양구": ["인천"], "옹진군": ["인천"],
    # 광주 (5구)
    "광산구": ["광주"],
    # 대전 (5구)
    "유성구": ["대전"], "대덕구": ["대전"],
    # 울산 (5구군)
    "울주군": ["울산"],
    # 경기 (31시군)
    "수원시": ["경기"], "성남시": ["경기"], "안양시": ["경기"],
    "안산시": ["경기"], "고양시": ["경기"], "용인시": ["경기"],
    "부천시": ["경기"], "광명시": ["경기"], "평택시": ["경기"],
    "시흥시": ["경기"], "군포시": ["경기"], "화성시": ["경기"],
    "이천시": ["경기"], "김포시": ["경기"], "파주시": ["경기"],
    "양주시": ["경기"], "구리시": ["경기"], "남양주시": ["경기"],
    "오산시": ["경기"], "하남시": ["경기"], "의왕시": ["경기"],
    "여주시": ["경기"], "양평군": ["경기"], "과천시": ["경기"],
    "광주시": ["경기"], "포천시": ["경기"], "동두천시": ["경기"],
    "연천군": ["경기"], "가평군": ["경기"], "안성시": ["경기"],
    "의정부시": ["경기"],
    # 경기 하위구
    "장안구": ["경기"], "권선구": ["경기"], "팔달구": ["경기"],
    "영통구": ["경기"], "수정구": ["경기"], "중원구": ["경기"],
    "분당구": ["경기"], "만안구": ["경기"], "동안구": ["경기"],
    "단원구": ["경기"], "상록구": ["경기"], "덕양구": ["경기"],
    "일산동구": ["경기"], "일산서구": ["경기"], "처인구": ["경기"],
    "기흥구": ["경기"], "수지구": ["경기"],
    # 강원 (18시군)
    "춘천시": ["강원"], "원주시": ["강원"], "강릉시": ["강원"],
    "동해시": ["강원"], "속초시": ["강원"], "삼척시": ["강원"],
    "태백시": ["강원"], "홍천군": ["강원"], "횡성군": ["강원"],
    "영월군": ["강원"], "평창군": ["강원"], "정선군": ["강원"],
    "철원군": ["강원"], "화천군": ["강원"], "양구군": ["강원"],
    "인제군": ["강원"], "고성군": ["강원", "경남"],
    "양양군": ["강원"],
    # 충북 (12시군)
    "청주시": ["충북"], "충주시": ["충북"], "제천시": ["충북"],
    "보은군": ["충북"], "옥천군": ["충북"], "영동군": ["충북"],
    "증평군": ["충북"], "진천군": ["충북"], "괴산군": ["충북"],
    "음성군": ["충북"], "단양군": ["충북"],
    # 충남 (15시군)
    "천안시": ["충남"], "공주시": ["충남"], "보령시": ["충남"],
    "아산시": ["충남"], "서산시": ["충남"], "논산시": ["충남"],
    "계룡시": ["충남"], "당진시": ["충남"], "금산군": ["충남"],
    "부여군": ["충남"], "서천군": ["충남"], "청양군": ["충남"],
    "홍성군": ["충남"], "예산군": ["충남"], "태안군": ["충남"],
    # 전북 (14시군)
    "전주시": ["전북"], "군산시": ["전북"], "익산시": ["전북"],
    "정읍시": ["전북"], "남원시": ["전북"], "김제시": ["전북"],
    "완주군": ["전북"], "진안군": ["전북"], "무주군": ["전북"],
    "장수군": ["전북"], "임실군": ["전북"], "순창군": ["전북"],
    "고창군": ["전북"], "부안군": ["전북"],
    # 전남 (22시군)
    "목포시": ["전남"], "여수시": ["전남"], "순천시": ["전남"],
    "나주시": ["전남"], "광양시": ["전남"], "담양군": ["전남"],
    "곡성군": ["전남"], "구례군": ["전남"], "고흥군": ["전남"],
    "보성군": ["전남"], "화순군": ["전남"], "장흥군": ["전남"],
    "강진군": ["전남"], "해남군": ["전남"], "영암군": ["전남"],
    "무안군": ["전남"], "함평군": ["전남"], "영광군": ["전남"],
    "장성군": ["전남"], "완도군": ["전남"], "진도군": ["전남"],
    "신안군": ["전남"],
    # 경북 (23시군)
    "포항시": ["경북"], "경주시": ["경북"], "김천시": ["경북"],
    "안동시": ["경북"], "구미시": ["경북"], "영주시": ["경북"],
    "영천시": ["경북"], "상주시": ["경북"], "문경시": ["경북"],
    "경산시": ["경북"], "군위군": ["경북"], "의성군": ["경북"],
    "청송군": ["경북"], "영양군": ["경북"], "영덕군": ["경북"],
    "청도군": ["경북"], "고령군": ["경북"], "성주군": ["경북"],
    "칠곡군": ["경북"], "예천군": ["경북"], "봉화군": ["경북"],
    "울진군": ["경북"], "울릉군": ["경북"],
    # 경남 (18시군)
    "창원시": ["경남"], "진주시": ["경남"], "통영시": ["경남"],
    "사천시": ["경남"], "김해시": ["경남"], "밀양시": ["경남"],
    "거제시": ["경남"], "양산시": ["경남"], "의령군": ["경남"],
    "함안군": ["경남"], "창녕군": ["경남"], "남해군": ["경남"],
    "하동군": ["경남"], "산청군": ["경남"], "함양군": ["경남"],
    "거창군": ["경남"], "합천군": ["경남"],
    # 제주
    "서귀포시": ["제주"], "제주시": ["제주"],
    # 중복 이름 (여러 시도에 존재)
    "중구": ["서울", "부산", "대구", "인천", "대전", "울산"],
    "동구": ["부산", "대구", "인천", "광주", "대전", "울산"],
    "서구": ["부산", "대구", "인천", "광주", "대전"],
    "남구": ["부산", "대구", "인천", "광주", "울산"],
    "북구": ["부산", "대구", "광주", "울산"],
    "강서구": ["서울", "부산"],
}

# 종목 코드 매핑
KIND_CODE = {
    "11": "국보", "12": "보물", "13": "사적", "14": "사적및명승",
    "15": "명승", "16": "천연기념물", "17": "국가무형유산",
    "18": "국가민속문화유산",
    "21": "시도유형문화유산", "22": "시도무형유산",
    "23": "시도기념물", "24": "시도민속문화유산",
    "25": "시도등록문화유산",
    "31": "문화유산자료",
    "79": "국가등록문화유산", "80": "국가등록무형유산",
}


class HeritageTool(BrowserTool):
    name = "heritage"
    description = "국가유산 존재여부 확인 (Open API)"
    url = "https://www.heritage.go.kr"

    # Open API 엔드포인트 (인증키 불요)
    API_LIST = "http://www.khs.go.kr/cha/SearchKindOpenapiList.do"
    API_DETAIL = "http://www.khs.go.kr/cha/SearchKindOpenapiDt.do"

    def execute(self, page: Page, location: str = "", **kwargs) -> dict:
        """Playwright page는 사용하지 않고 API로 직접 조회합니다."""
        if not location:
            raise ValueError("위치를 입력하세요 (예: '서울특별시 종로구')")
        return self._search_by_api(location)

    def run(self, **kwargs) -> dict:
        """API 기반이므로 브라우저 없이 실행합니다."""
        self._saved_files = []
        try:
            result = self._search_by_api(kwargs.get("location", ""))
            result["_meta"] = {
                "saved_files": self._saved_files,
                "output_dir": str(self.output_dir),
            }
            return result
        except Exception as e:
            self.logger.error(f"실행 실패: {e}")
            return {
                "오류": str(e),
                "성공": False,
                "_meta": {
                    "saved_files": self._saved_files,
                    "output_dir": str(self.output_dir),
                },
            }

    def _search_by_api(self, location: str) -> dict:
        if not location:
            raise ValueError("위치를 입력하세요 (예: '서울특별시 종로구')")

        self.logger.info(f"국가유산 API 검색: {location}")
        parts = location.split()

        # ── 1) 시도 코드 추출 ──
        sido_code = ""
        for key, code in SIDO_CODE.items():
            if any(key in p for p in parts):
                sido_code = code
                break

        # ── 2) 시군구명 추출 (필터링용) ──
        sgg_name = ""
        for p in parts:
            if p.endswith(("구", "시", "군")) and len(p) >= 2:
                if not any(k in p for k in SIDO_CODE):
                    sgg_name = p
                    break
        # 단일 토큰("종로구")인 경우
        if not sgg_name and len(parts) == 1:
            token = parts[0]
            if token.endswith(("구", "시", "군")) and len(token) >= 2:
                sgg_name = token

        # ── 3) 시도 미지정 시 SGG_TO_SIDO로 자동 추론 ──
        sido_codes_to_search = []
        if sido_code:
            sido_codes_to_search = [sido_code]
        elif sgg_name:
            # 역매핑에서 시도 찾기
            matched_sidos = SGG_TO_SIDO.get(sgg_name, [])
            if not matched_sidos:
                # 부분 매칭 시도 ("팔달" → "팔달구")
                for key, sidos in SGG_TO_SIDO.items():
                    if sgg_name in key or key in sgg_name:
                        matched_sidos = sidos
                        sgg_name = key  # 정확한 이름으로 보정
                        break
            if matched_sidos:
                sido_codes_to_search = [SIDO_CODE[s] for s in matched_sidos
                                        if s in SIDO_CODE]
                self.logger.info(
                    f"'{sgg_name}' → 시도 추론: "
                    f"{', '.join(matched_sidos)}"
                )
            else:
                # 매핑에 없으면 전체 시도 검색
                self.logger.warning(f"'{sgg_name}' 매핑 없음 → 전국 검색")
                sido_codes_to_search = list(SIDO_CODE.values())
        else:
            # 시도도 시군구도 없으면 전국
            self.logger.warning(f"위치 미특정 → 전국 검색: {location}")
            sido_codes_to_search = list(SIDO_CODE.values())

        # ── 4) API 호출 ──
        all_items = []
        # 시도가 많으면 주요 종목만 검색 (속도 최적화)
        if len(sido_codes_to_search) > 3:
            target_kinds = ["11", "12", "13", "15", "16", "79"]  # 국가지정만
        else:
            target_kinds = ["11", "12", "13", "15", "16", "18",
                            "21", "22", "23", "24", "79"]

        for sc in sido_codes_to_search:
            for kind_code in target_kinds:
                items = self._call_list_api(sc, "", kind_code)
                all_items.extend(items)

        # ── 5) 시군구 필터링 ──
        if sgg_name:
            filtered = [item for item in all_items
                        if sgg_name in item.get("시군구", "")]
            if filtered:
                all_items = filtered
                self.logger.info(f"시군구 필터링: {sgg_name} → {len(filtered)}건")
            else:
                self.logger.info(f"'{sgg_name}' 필터링 결과 0건, 전체 결과 사용")

        # 중복 제거 (관리번호 기준)
        seen = set()
        unique_items = []
        for item in all_items:
            key = item.get("관리번호", item.get("명칭", ""))
            if key not in seen:
                seen.add(key)
                unique_items.append(item)

        result = {
            "검색위치": location,
            "시도코드": sido_code,
            "시군구명": sgg_name,
            "유산목록": unique_items[:50],
            "발견수": len(unique_items),
            "성공": True,
        }

        # 상세 정보 (첫 번째 유산)
        if unique_items:
            first = unique_items[0]
            detail = self._call_detail_api(
                first.get("종목코드", ""),
                first.get("관리번호", ""),
            )
            if detail:
                result["첫번째_상세"] = detail

        # 저장
        safe_loc = re.sub(r'[^\w가-힣]', '_', location)[:30]
        self.save_json(result, f"heritage_{safe_loc}.json")

        summary = self._format_summary(result)
        self.save_text(summary, f"heritage_{safe_loc}.md")

        self.logger.info(f"조회 완료: {len(unique_items)}건 발견")
        return result

    def _call_list_api(self, sido_code: str, sgg_code: str,
                       kind_code: str) -> list:
        """국가유산 목록 API를 호출합니다."""
        params = {
            "ccbaKdcd": kind_code,
            "ccbaCtcd": sido_code,
            "ccbaCncl": "N",  # 해제되지 않은 것만
            "pageUnit": "50",
            "pageIndex": "1",
        }
        if sgg_code:
            params["ccbaLcto"] = sgg_code

        url = f"{self.API_LIST}?{urllib.parse.urlencode(params)}"
        self.logger.info(f"API 호출: 종목={KIND_CODE.get(kind_code, kind_code)}")

        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "Mozilla/5.0")
            with urllib.request.urlopen(req, timeout=15) as resp:
                xml_data = resp.read().decode("utf-8")
        except Exception as e:
            self.logger.warning(f"API 호출 실패 ({kind_code}): {e}")
            return []

        return self._parse_list_xml(xml_data, kind_code)

    def _parse_list_xml(self, xml_data: str, kind_code: str) -> list:
        """목록 API XML 응답을 파싱합니다."""
        items = []
        try:
            root = ET.fromstring(xml_data)
            for item_el in root.findall(".//item"):
                item = {
                    "명칭": self._get_text(item_el, "ccbaMnm1"),
                    "종목": KIND_CODE.get(kind_code, kind_code),
                    "종목코드": kind_code,
                    "관리번호": self._get_text(item_el, "ccbaAsno"),
                    "시군구": self._get_text(item_el, "ccsiName"),
                    "시대": self._get_text(item_el, "ccceName"),
                    "소재지": self._get_text(item_el, "ccbaLcad"),
                    "지정일": self._get_text(item_el, "ccbaAsdt"),
                }
                # 빈 항목 제거
                item = {k: v for k, v in item.items() if v}
                if item.get("명칭"):
                    items.append(item)
        except ET.ParseError as e:
            self.logger.warning(f"XML 파싱 실패: {e}")
        return items

    def _call_detail_api(self, kind_code: str, asno: str) -> dict:
        """국가유산 상세 API를 호출합니다."""
        if not kind_code or not asno:
            return {}

        params = {
            "ccbaKdcd": kind_code,
            "ccbaAsno": asno,
            "ccbaCtcd": "",
        }
        url = f"{self.API_DETAIL}?{urllib.parse.urlencode(params)}"

        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "Mozilla/5.0")
            with urllib.request.urlopen(req, timeout=15) as resp:
                xml_data = resp.read().decode("utf-8")
        except Exception as e:
            self.logger.warning(f"상세 API 호출 실패: {e}")
            return {}

        return self._parse_detail_xml(xml_data)

    def _parse_detail_xml(self, xml_data: str) -> dict:
        """상세 API XML 응답을 파싱합니다."""
        detail = {}
        try:
            root = ET.fromstring(xml_data)
            item = root.find(".//item")
            if item is None:
                return detail

            field_map = {
                "ccbaMnm1": "명칭",
                "ccbaCtcdNm": "시도",
                "ccsiName": "시군구",
                "ccbaLcad": "소재지",
                "ccceName": "시대",
                "ccbaAsdt": "지정일",
                "ccbaQuan": "수량",
                "ccbaAdmin": "관리자",
                "ccbaPoss": "소유자",
                "content": "설명",
            }

            for xml_tag, kr_name in field_map.items():
                val = self._get_text(item, xml_tag)
                if val:
                    # 설명은 HTML 태그 제거
                    if xml_tag == "content":
                        val = re.sub(r'<[^>]+>', '', val).strip()
                        val = val[:500]  # 설명은 500자까지
                    detail[kr_name] = val
        except ET.ParseError as e:
            self.logger.warning(f"상세 XML 파싱 실패: {e}")
        return detail

    @staticmethod
    def _get_text(element, tag: str) -> str:
        """XML 요소에서 텍스트를 추출합니다."""
        el = element.find(tag)
        if el is not None and el.text:
            return el.text.strip()
        return ""

    def _format_summary(self, result: dict) -> str:
        """결과 요약 텍스트를 생성합니다."""
        location = result.get("검색위치", "")
        count = result.get("발견수", 0)

        lines = [
            f"# 국가유산 현황 - {location}\n",
            f"발견된 유산: {count}건\n",
        ]

        if count == 0:
            lines.append("해당 지역에서 국가유산이 발견되지 않았습니다.")
            lines.append("(검토의견서 부지분석에 '문화유산 영향 없음'으로 기재 가능)")
        else:
            # 종목별 그룹핑
            by_kind = {}
            for item in result.get("유산목록", []):
                kind = item.get("종목", "기타")
                by_kind.setdefault(kind, []).append(item)

            for kind, items in by_kind.items():
                lines.append(f"\n## {kind} ({len(items)}건)")
                for i, item in enumerate(items, 1):
                    name = item.get("명칭", "")
                    addr = item.get("소재지", "")
                    era = item.get("시대", "")
                    detail_parts = []
                    if addr:
                        detail_parts.append(addr)
                    if era:
                        detail_parts.append(era)
                    detail_str = f" — {', '.join(detail_parts)}" if detail_parts else ""
                    lines.append(f"  {i}. {name}{detail_str}")

        if result.get("첫번째_상세"):
            lines.append("\n## 상세 정보 (첫 번째 유산)")
            for key, val in result["첫번째_상세"].items():
                lines.append(f"- {key}: {val}")

        return "\n".join(lines)


def main():
    parser = HeritageTool.create_parser("국가유산 존재여부 확인")
    parser.add_argument("location", help="검색 위치 (예: '서울특별시 종로구')")
    args = parser.parse_args()

    tool = HeritageTool.from_args(args)
    result = tool.run(location=args.location)
    tool.print_json(result)


if __name__ == "__main__":
    main()
