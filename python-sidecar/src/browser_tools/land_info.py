"""토지이음 — 토지 이용계획 확인.

eum.go.kr에서 주소 기반 토지 이용계획을 조회합니다.
내부 JS 함수(fn_searchTel, chiceAdAddr)를 직접 호출하여
자동완성 한계를 우회합니다.

사용법:
    python -m src.browser_tools.land_info "서울특별시 광진구 군자동 98"
    python -m src.browser_tools.land_info "광진구 아차산로 200" --headed
"""

import re
from playwright.sync_api import Page

from .base import BrowserTool, PAGE_LOAD_WAIT_MS, SEARCH_WAIT_MS, GIS_LOAD_WAIT_MS


class LandInfoTool(BrowserTool):
    name = "land_info"
    description = "토지이음 토지 이용계획 조회"
    url = "https://www.eum.go.kr"

    def _is_cancelled(self) -> bool:
        """취소 이벤트 확인 헬퍼."""
        return bool(self.cancel_event and self.cancel_event.is_set())

    def _safe_evaluate(self, page: Page, expression, arg=None, timeout_ms: int = 8000):
        """page.evaluate에 JS 타임아웃을 감싸서 hang 방지."""
        # 인자가 있는 경우
        if arg is not None:
            wrapped = f"""([__expr, __arg]) => {{
                return new Promise((resolve, reject) => {{
                    const timer = setTimeout(() => resolve(null), {timeout_ms});
                    try {{
                        const fn = new Function('__arg', 'return (' + __expr + ')(__arg)');
                        const r = fn(__arg);
                        clearTimeout(timer);
                        resolve(r);
                    }} catch(e) {{ clearTimeout(timer); reject(e); }}
                }});
            }}"""
            return page.evaluate(wrapped, [expression, arg])
        # 단순 표현식
        wrapped = f"""() => {{
            return new Promise((resolve, reject) => {{
                const timer = setTimeout(() => resolve(null), {timeout_ms});
                try {{
                    const r = (function() {{ {expression} }})();
                    clearTimeout(timer);
                    resolve(r === undefined ? true : r);
                }} catch(e) {{ clearTimeout(timer); reject(e); }}
            }});
        }}"""
        return page.evaluate(wrapped)

    def execute(self, page: Page, address: str = "", **kwargs) -> dict:
        if not address:
            raise ValueError("주소를 입력하세요 (예: '서울특별시 광진구 군자동 98')")

        # 도로명 정규화: "동일로 227길" → "동일로227길" (분기 도로명 공백 제거)
        address = re.sub(r'(로|대로)\s+(\d+길)', r'\1\2', address)
        self.logger.info(f"토지이음 조회: {address}")

        # 1. 메인 페이지 접속 — networkidle은 SPA에서 hang 가능, domcontentloaded로 대체
        page.goto(self.url, wait_until="domcontentloaded", timeout=15_000)
        try:
            page.wait_for_load_state("networkidle", timeout=5_000)
        except Exception:
            pass
        page.wait_for_timeout(PAGE_LOAD_WAIT_MS)

        if self._is_cancelled():
            return {"주소": address, "성공": False, "오류": "사용자에 의해 취소됨"}

        # 에러 페이지 감지
        try:
            body_text = page.locator("body").inner_text(timeout=3000)[:300]
        except Exception:
            body_text = ""
        if "시스템 에러" in body_text or "찾을 수 없습니다" in body_text:
            page.goto(self.url, wait_until="domcontentloaded", timeout=15_000)
            try:
                page.wait_for_load_state("networkidle", timeout=5_000)
            except Exception:
                pass
            page.wait_for_timeout(PAGE_LOAD_WAIT_MS)

        self._screenshot(page, "main")

        # 2. 주소 입력 + 자동완성 트리거
        search_input = page.locator("input.addrTxt_back").first
        if not search_input.is_visible():
            search_input = page.locator(
                "input[placeholder*='지번'], input[placeholder*='주소']"
            ).first

        if not search_input.is_visible():
            return {"주소": address, "오류": "검색 필드를 찾을 수 없습니다. 사이트가 변경되었을 수 있습니다.", "성공": False}

        search_input.click()
        search_input.type(address, delay=80)
        self.logger.info(f"주소 입력 완료: {address}")
        page.wait_for_timeout(SEARCH_WAIT_MS)

        if self._is_cancelled():
            return {"주소": address, "성공": False, "오류": "사용자에 의해 취소됨"}

        # 3. fn_searchTel() 호출 — 주소 검색 실행 (타임아웃 보호)
        try:
            self._safe_evaluate(page, "fn_searchTel()", timeout_ms=8000)
            self.logger.info("주소 검색 실행")
        except Exception as e:
            self.logger.warning(f"fn_searchTel 실패: {e}")
            search_input.press("Enter")

        page.wait_for_timeout(PAGE_LOAD_WAIT_MS)

        if self._is_cancelled():
            return {"주소": address, "성공": False, "오류": "사용자에 의해 취소됨"}

        self._screenshot(page, "address_list")

        # 4. 주소 목록에서 첫 번째 항목의 PNU 추출 + 선택
        addr_info = page.evaluate("""() => {
            const links = document.querySelectorAll('.address_list a, .addrDiv a');
            const result = [];
            for (const a of links) {
                const onclick = a.getAttribute('onclick') || '';
                const match = onclick.match(/chiceAdAddr\\("([^"]+)","(\\d+)"/);
                if (match) {
                    result.push({text: match[1], pnu: match[2]});
                }
            }
            return result;
        }""")

        if not addr_info:
            self.logger.warning("주소 목록 없음")
            return {
                "주소": address,
                "성공": False,
                "오류": f"'{address}' 검색 결과가 없습니다. 지번주소(예: OO동 98) 또는 전체 도로명(예: 서울특별시 OO구 아차산로 400)으로 검색해 보세요.",
            }

        if self._is_cancelled():
            return {"주소": address, "성공": False, "오류": "사용자에 의해 취소됨"}

        # 첫 번째 주소 선택
        first = addr_info[0]
        self.logger.info(f"주소 선택: {first['text']}")

        # chiceAdAddr 호출 — 지도 이동 + 토지 정보 표시 (타임아웃 보호)
        addr_selected = False
        try:
            self._safe_evaluate(
                page,
                '([addr, pnu]) => chiceAdAddr(addr, pnu, true)',
                arg=[first['text'], first['pnu']],
                timeout_ms=8000,
            )
            self.logger.info("주소 선택 완료")
            addr_selected = True
        except Exception as e:
            self.logger.warning(f"chiceAdAddr 실패: {e}")

        if not addr_selected:
            # DOM 링크 직접 클릭 폴백
            self.logger.info("링크 클릭 폴백")
            try:
                first_link = page.locator('.address_list a, .addrDiv a').first
                if first_link.is_visible(timeout=2000):
                    first_link.click()
                    addr_selected = True
            except Exception:
                pass

        if not addr_selected:
            return {
                "주소": address, "성공": False,
                "오류": "주소 선택에 실패했습니다. 사이트 구조가 변경되었을 수 있습니다.",
            }

        # GIS 로딩 대기 + 추출 재시도 (SPA 렌더링 타이밍 이슈 대응)
        # 첫 시도 후 실패하면 추가 대기 후 재시도 (최대 3회)
        result = None
        meaningful = {"지목", "면적", "개별공시지가", "용도지역"}
        for attempt in range(3):
            wait_ms = GIS_LOAD_WAIT_MS if attempt == 0 else 3000
            page.wait_for_timeout(wait_ms)

            if self._is_cancelled():
                return {"주소": address, "성공": False, "오류": "사용자에 의해 취소됨"}

            self._screenshot(page, f"land_info_{attempt}")
            result = self._extract_land_info(page, address)
            if meaningful & set(result.keys()):
                break  # 의미 있는 데이터 추출 성공
            self.logger.info(f"토지 정보 추출 재시도 ({attempt + 1}/3)")
        result["PNU"] = first['pnu']
        result["정확주소"] = first['text']

        if self._is_cancelled():
            return {"주소": address, "성공": False, "오류": "사용자에 의해 취소됨"}

        # 6. 다른 주소 후보도 저장
        if len(addr_info) > 1:
            result["주소후보"] = [a['text'] for a in addr_info[:10]]

        # 성공 판정
        meaningful = {"지목", "면적", "개별공시지가", "용도지역",
                      "국토계획법_지역지구", "다른법령_지역지구"}
        result["성공"] = bool(meaningful & set(result.keys()))

        if not result["성공"]:
            result["오류"] = "토지 정보를 추출하지 못했습니다. GIS 페이지 로딩이 느릴 수 있습니다."

        # 6.5. 확인도면 캡처 — 사이드바 탭 클릭 전에 해야 함 (페이지 상태 보존)
        if result["성공"]:
            map_path = self._capture_land_map(page, address)
            if map_path:
                result["확인도면"] = str(map_path)
                try:
                    import base64 as _b64
                    with open(str(map_path), "rb") as _f:
                        result["확인도면_base64"] = (
                            "data:image/jpeg;base64,"
                            + _b64.b64encode(_f.read()).decode("ascii")
                        )
                except Exception:
                    pass

        # 6.6. 사이드바 탭 순회 (토지정보, 토지특성, 건축물정보 등)
        # 도면 캡처 후에 해야 함 — 탭 클릭이 페이지 상태를 바꿈
        if result["성공"]:
            self._extract_sidebar_tabs(page, result)

        # 7. 저장
        safe_addr = re.sub(r'[^\w가-힣]', '_', address)[:30]
        self.save_json(result, f"land_{safe_addr}.json")

        md = self._format_markdown(result)
        self.save_text(md, f"land_{safe_addr}.md")

        self.logger.info(f"조회 완료 (성공: {result['성공']})")
        return result

    def _capture_land_map(self, page: Page, address: str) -> str:
        """확인도면(토지이용계획도)을 캡처합니다."""
        try:
            from PIL import Image, ImageDraw, ImageFont

            # 확인도면 영역으로 스크롤 — 도면은 페이지 하단에 있음
            page.evaluate("""() => {
                // 확인도면 img 또는 canvas 찾기
                var mapEl = document.querySelector('.mapImg img, .mapArea img, #mapArea img, canvas.mapCanvas');
                if (!mapEl) {
                    // "확인도면" 텍스트 근처 영역 찾기
                    var allTh = document.querySelectorAll('th');
                    for (var th of allTh) {
                        if (th.innerText.includes('확인도면')) {
                            var parent = th.closest('tr') || th.closest('table');
                            if (parent) parent.scrollIntoView({block: 'center'});
                            return;
                        }
                    }
                } else {
                    mapEl.scrollIntoView({block: 'center'});
                }
            }""")
            page.wait_for_timeout(1500)

            # 확인도면 + 범례 영역을 element screenshot으로 캡처
            # 먼저 도면 이미지를 찾아서 element screenshot 시도
            map_el = page.locator(".mapImg, .mapArea, #mapArea").first
            if not map_el.is_visible(timeout=2000):
                # 폴백: 확인도면 th가 포함된 테이블 행 이후 전체
                map_el = page.locator("th:has-text('확인도면')").first
                if map_el.is_visible(timeout=1000):
                    # 확인도면 행의 부모 테이블 캡처
                    map_el = map_el.locator("xpath=ancestor::table[1]")

            if not map_el.is_visible(timeout=1000):
                self.logger.info("확인도면 영역을 찾을 수 없어 전체 페이지 하단 캡처")
                # 폴백: 페이지 하단 영역 full screenshot
                tmp_path = self.output_dir / "_tmp_land_map.png"
                page.screenshot(path=str(tmp_path), full_page=True, timeout=15_000)
                img = Image.open(tmp_path).convert("RGB")
                # 하단 40% 크롭 (도면은 보통 페이지 하단)
                h = img.height
                img = img.crop((0, int(h * 0.6), img.width, h))
            else:
                tmp_path = self.output_dir / "_tmp_land_map.png"
                map_el.screenshot(path=str(tmp_path), timeout=10_000)
                img = Image.open(tmp_path).convert("RGB")

            # 라벨 추가
            safe_addr = re.sub(r'[^\w가-힣]', '_', address)[:30]
            bar_height = 32
            from PIL import Image as PILImage
            new_img = PILImage.new("RGB", (img.width, img.height + bar_height), (255, 255, 255))
            draw = ImageDraw.Draw(new_img)
            draw.rectangle([(0, 0), (img.width, bar_height)], fill=(50, 55, 65))
            font = None
            for font_name in ["malgun.ttf", "NanumGothic.ttf", "gulim.ttc", "arial.ttf"]:
                try:
                    font = ImageFont.truetype(font_name, 16)
                    break
                except OSError:
                    continue
            if not font:
                font = ImageFont.load_default()
            label = f"확인도면 — {address}"
            bbox = draw.textbbox((0, 0), label, font=font)
            text_w = bbox[2] - bbox[0]
            draw.text(((img.width - text_w) // 2, 7), label, fill=(255, 255, 255), font=font)
            new_img.paste(img, (0, bar_height))

            # JPG 저장
            filename = f"land_map_{safe_addr}.jpg"
            path = self.output_dir / filename
            new_img.save(str(path), "JPEG", quality=90, optimize=True)
            tmp_path.unlink(missing_ok=True)

            self._saved_files.append(str(path))
            self.logger.info(f"확인도면 캡처: {path}")
            return str(path)
        except Exception as e:
            self.logger.warning(f"확인도면 캡처 실패: {e}")
            return ""

    def _extract_land_info(self, page: Page, address: str) -> dict:
        """토지 이용계획 + 토지정보/특성/이동/건축물 전체를 추출합니다."""
        result = {"주소": address}

        # 모든 테이블의 th-td 쌍을 한 번에 추출 (DOM 반복 호출 방지)
        try:
            all_data = self._safe_evaluate(page, """
                const output = { basic: '', sections: [] };
                const tables = document.querySelectorAll('table');

                // 1) 기본정보 테이블 (소재지, 지목, 면적, 공시지가)
                for (const t of tables) {
                    const text = t.innerText;
                    if (text.includes('소재지') && text.includes('지목')) {
                        output.basic = text;
                        break;
                    }
                }

                // 2) 모든 테이블의 th-td 쌍 추출
                for (const table of tables) {
                    const rows = table.querySelectorAll('tr');
                    for (const row of rows) {
                        const ths = row.querySelectorAll('th');
                        const tds = row.querySelectorAll('td');
                        if (ths.length === 0 || tds.length === 0) continue;
                        const category = Array.from(ths).map(th => th.innerText.trim()).join(' ').trim();
                        const value = Array.from(tds).map(td => td.innerText.trim()).filter(t => t && t !== '-').join(', ');
                        if (category && value && value.length > 0) {
                            output.sections.push({c: category, v: value});
                        }
                    }
                }

                // 3) 탭/아코디언 섹션 — "토지정보", "토지특성" 등 숨겨진 컨텐츠 열기 시도
                var tabs = document.querySelectorAll('[role=tab], .tab-menu a, .tab-link, .acc-tit');
                for (var tab of tabs) {
                    try { tab.click(); } catch(e) {}
                }

                return output;
            """, timeout_ms=8000) or {"basic": "", "sections": []}
        except Exception as e:
            self.logger.warning(f"토지 정보 추출 실패: {e}")
            all_data = {"basic": "", "sections": []}

        # 기본정보 파싱
        table_text = all_data.get("basic", "")
        if table_text:
            m = re.search(r'소재지\t(.+?)(?:\n|$)', table_text)
            if m:
                result["소재지"] = m.group(1).strip()

            m = re.search(r'지목\t(.+?)\t면적\t([\d,\.]+\s*㎡)', table_text)
            if m:
                result["지목"] = m.group(1).replace("?", "").strip()
                result["면적"] = m.group(2).strip()
            else:
                m = re.search(r'지목\t(.+?)(?:\t|\n|$)', table_text)
                if m:
                    result["지목"] = m.group(1).replace("?", "").strip()
                m = re.search(r'면적\t([\d,\.]+\s*㎡)', table_text)
                if m:
                    result["면적"] = m.group(1).strip()

            m = re.search(r'개별공시지가[^\t]*\t([\d,]+)원', table_text)
            if m:
                result["개별공시지가"] = f"{m.group(1)}원/㎡"

        # th-td 쌍에서 구조화 데이터 추출
        sections = all_data.get("sections", [])

        # 토지이용규제 카테고리 매핑
        for item in sections:
            cat = item.get("c", "")
            val = item.get("v", "")
            if not cat or not val or len(val) < 2:
                continue

            # 토지이용규제
            if "국토의 계획" in cat or ("용도지역" in cat and "지정" not in cat):
                result["국토계획법_지역지구"] = val
            elif "다른 법령" in cat and "지역" in cat:
                result["다른법령_지역지구"] = val
            elif "토지이용규제 기본법" in cat or "제9조" in cat:
                result["토지이용규제_기타"] = val

            # 사이드바 탭에서 추출하는 필드들은 skip (토지정보/특성/이동/건축물)
            else:
                continue

        return result

    def _extract_sidebar_tabs(self, page: Page, result: dict):
        """관련정보 탭에서 토지소유/거래, 토지이력/특성, 건축물정보를 추출합니다.

        eum.go.kr DOM 구조:
        - 메인 탭: li.f01(토지이용계획), li.f03(관련정보) 등
        - 관련정보 서브탭: #rel_01(토지소유/거래), #rel_02(토지이력 및 특성), #rel_03(건축물정보)
        - 건축물정보 내: 총괄표제부, 표제부 등 div.tbl04 테이블들
        """

        # Step 1: "관련정보" 탭 클릭 (li.f03 > a 또는 텍스트 매칭)
        try:
            self._safe_evaluate(page, """() => {
                // f03 클래스 (관련정보 탭) 또는 텍스트로 찾기
                var tab = document.querySelector('li.f03 a');
                if (!tab) {
                    var links = document.querySelectorAll('.useplan a, .tab_wrap a');
                    for (var a of links) {
                        if (a.innerText.includes('관련정보')) { tab = a; break; }
                    }
                }
                if (tab) tab.click();
            }""", timeout_ms=3000)
            page.wait_for_timeout(2000)
            self.logger.info("관련정보 탭 클릭")
        except Exception as e:
            self.logger.debug(f"관련정보 탭 클릭 실패: {e}")
            return

        if self._is_cancelled():
            return

        # Step 2: 토지이력·특성 (사이드바 클릭 → AJAX 대기 → ID 기반 추출)
        self._click_sidebar_link(page, ["이력", "특성"])
        rel02 = self._extract_by_ids(page, {
            "소유구분": "posesnSeCodeNm",
            "공유인수": "cnrsPsnCo",
            "축척구분": "ladFrtlScNm",
            "토지정보_기준일": "plastUpdtDt",
            "지형높이": "tpgrphHgCodeNm",
            "지형형상": "tpgrphFrmCodeNm",
            "도로접면": "roadSideCodeNm",
            "토지특성_기준일": "lastUpdtDt",
        })
        if rel02:
            result["토지이력_특성"] = rel02

        if self._is_cancelled():
            return

        # Step 3: 건축물정보
        self._click_sidebar_link(page, ["건축물"])
        rel03 = self._extract_by_ids(page, {
            "건축면적(㎡)": "archArea",
            "연면적(㎡)": "totArea",
            "용적률산정용연면적(㎡)": "vlRatEstmTotArea",
            "건폐율(%)": "bcRat",
            "용적률(%)": "vlRat",
            "사용승인일자": "useAprDay",
        })
        # 건축물 표제부 테이블 (동별 정보)
        bld_detail = self._extract_building_table(page)
        if bld_detail:
            if rel03 is None:
                rel03 = {}
            rel03["표제부"] = bld_detail
        if rel03:
            result["건축물정보"] = rel03

    def _click_sidebar_link(self, page, keywords: list):
        """왼쪽 사이드바(con_left)에서 키워드 매칭 링크를 클릭합니다."""
        try:
            clicked = self._safe_evaluate(page, """
                (keywords) => {
                    // con_left 내 사이드바 링크 (f03 하위)
                    var links = document.querySelectorAll('.con_left a, .useplan a');
                    for (var a of links) {
                        var text = a.innerText.trim();
                        for (var kw of keywords) {
                            if (text.includes(kw)) {
                                a.click();
                                return text;
                            }
                        }
                    }
                    return null;
                }
            """, arg=keywords, timeout_ms=3000)
            if clicked:
                self.logger.info(f"사이드바 클릭: {clicked}")
                page.wait_for_timeout(2000)
        except Exception as e:
            self.logger.debug(f"사이드바 클릭 실패: {e}")

    def _extract_by_ids(self, page, id_map: dict) -> dict:
        """AJAX로 채워지는 <td id="..."> 요소에서 값을 추출합니다.

        데이터 로딩 대기: 첫 번째 ID에 텍스트가 들어올 때까지 최대 5초 폴링.
        """
        try:
            first_id = list(id_map.values())[0]
            # AJAX 대기 — 첫 번째 필드에 값이 채워질 때까지 폴링
            for _ in range(10):
                val = page.evaluate(f'document.getElementById("{first_id}")?.innerText?.trim() || ""')
                if val:
                    break
                page.wait_for_timeout(500)

            data = self._safe_evaluate(page, """
                (idMap) => {
                    var result = {};
                    for (var entry of idMap) {
                        var el = document.getElementById(entry[1]);
                        var val = el ? el.innerText.trim() : '';
                        if (val && val !== '-') {
                            result[entry[0]] = val;
                        }
                    }
                    return result;
                }
            """, arg=list(id_map.items()), timeout_ms=3000)

            if isinstance(data, dict) and data:
                self.logger.info(f"ID 기반 추출: {len(data)}개 필드")
                return data
        except Exception as e:
            self.logger.debug(f"ID 기반 추출 실패: {e}")
        return {}

    def _extract_building_table(self, page) -> str:
        """건축물 표제부 테이블(동별 정보)을 텍스트로 추출합니다."""
        try:
            # 표제부 테이블 AJAX 로딩 대기
            page.wait_for_timeout(2000)
            text = self._safe_evaluate(page, """() => {
                var table = document.getElementById('tblBrFlrOulnInfo');
                if (!table) return '';
                // 로딩 이미지가 있으면 아직 로딩 중
                if (table.querySelector('img[src*="loading"]')) return '';
                var rows = table.querySelectorAll('tr');
                var lines = [];
                for (var row of rows) {
                    var cells = row.querySelectorAll('th, td');
                    var line = [];
                    for (var cell of cells) {
                        var t = cell.innerText.trim();
                        if (t) line.push(t);
                    }
                    if (line.length > 0) lines.push(line.join(' | '));
                }
                return lines.join('\\n');
            }""", timeout_ms=5000)
            if text and len(text) > 10:
                self.logger.info(f"건축물 표제부: {len(text)}자")
                return text
        except Exception as e:
            self.logger.debug(f"건축물 표제부 추출 실패: {e}")
        return ""

    def _extract_panel_data(self, page, panel_id: str, label: str) -> dict:
        """특정 패널(#rel_01 등)에서 테이블 데이터를 추출합니다."""
        try:
            data = self._safe_evaluate(page, """
                (panelId) => {
                    var panel = document.getElementById(panelId);
                    if (!panel) return {};

                    var data = {};
                    var tables = panel.querySelectorAll('table');
                    for (var table of tables) {
                        var rows = table.querySelectorAll('tr');
                        var headerRow = null;

                        for (var row of rows) {
                            var ths = row.querySelectorAll('th');
                            var tds = row.querySelectorAll('td');

                            // th만 = 헤더행
                            if (ths.length > 0 && tds.length === 0) {
                                headerRow = Array.from(ths).map(th => th.innerText.trim());
                                continue;
                            }

                            // th + td 쌍
                            if (ths.length > 0 && tds.length > 0) {
                                for (var i = 0; i < Math.min(ths.length, tds.length); i++) {
                                    var key = ths[i].innerText.trim().replace(/\\s+/g, ' ');
                                    var val = tds[i].innerText.trim();
                                    if (!key || !val || val === '-' || key.length > 40) continue;
                                    if (val.length > 300) val = val.substring(0, 300) + '...';
                                    data[key] = val;
                                }
                                headerRow = null;
                            }
                            // td만 (이전 헤더와 매칭)
                            else if (tds.length > 0 && headerRow) {
                                for (var j = 0; j < Math.min(tds.length, headerRow.length); j++) {
                                    var hkey = headerRow[j];
                                    var hval = tds[j].innerText.trim();
                                    if (!hkey || !hval || hval === '-') continue;
                                    if (hval.length > 300) hval = hval.substring(0, 300) + '...';
                                    data[hkey] = hval;
                                }
                                headerRow = null;
                            }
                        }
                    }
                    return data;
                }
            """, arg=panel_id, timeout_ms=5000)

            if isinstance(data, dict) and data:
                self.logger.info(f"{label}: {len(data)}개 필드")
                return data
        except Exception as e:
            self.logger.debug(f"{label} 추출 실패: {e}")
        return {}

    def _extract_visible_tables(self, page: Page, label: str) -> dict:
        """현재 display:block인 탭 패널의 테이블에서 th-td 쌍을 추출합니다."""
        try:
            data = self._safe_evaluate(page, """() => {
                var data = {};
                // display:block인 tab_content 패널 찾기
                var panels = document.querySelectorAll('.tab_content[style*="display: block"], .tab_content[style*="display:block"]');
                if (panels.length === 0) {
                    // 폴백: 모든 visible 테이블
                    panels = [document.body];
                }

                for (var panel of panels) {
                    var tables = panel.querySelectorAll('table');
                    for (var table of tables) {
                        if (table.offsetParent === null) continue;
                        var rows = table.querySelectorAll('tr');
                        var headerRow = null;
                        var dataRow = null;

                        for (var row of rows) {
                            var ths = row.querySelectorAll('th');
                            var tds = row.querySelectorAll('td');

                            // th만 있는 행 = 헤더
                            if (ths.length > 0 && tds.length === 0) {
                                headerRow = Array.from(ths).map(th => th.innerText.trim());
                                continue;
                            }

                            // th + td 쌍
                            if (ths.length > 0 && tds.length > 0) {
                                for (var i = 0; i < Math.min(ths.length, tds.length); i++) {
                                    var key = ths[i].innerText.trim().replace(/\\s+/g, ' ');
                                    var val = tds[i].innerText.trim();
                                    if (!key || !val || val === '-' || val === '' || key.length > 40) continue;
                                    if (val.length > 300) val = val.substring(0, 300) + '...';
                                    data[key] = val;
                                }
                            }
                            // td만 있는 행 (이전 headerRow와 매칭)
                            else if (tds.length > 0 && headerRow && tds.length <= headerRow.length) {
                                for (var j = 0; j < tds.length; j++) {
                                    var hkey = headerRow[j] || '';
                                    var hval = tds[j].innerText.trim();
                                    if (!hkey || !hval || hval === '-' || hval === '') continue;
                                    if (hval.length > 300) hval = hval.substring(0, 300) + '...';
                                    data[hkey] = hval;
                                }
                                headerRow = null;
                            }
                        }
                    }
                }
                return data;
            }""", timeout_ms=5000)

            if isinstance(data, dict) and data:
                self.logger.info(f"{label}: {len(data)}개 필드 추출")
                return data
        except Exception as e:
            self.logger.debug(f"{label} 추출 실패: {e}")
        return {}

    def _extract_usage_zones(self, page: Page, result: dict):
        """토지이용규제 정보를 구조화하여 추출합니다.

        사이트 테이블 구조:
        - 「국토의 계획 및 이용에 관한 법률」에 따른 지역·지구등
        - 다른 법령 등에 따른 지역·지구등
        - 「토지이용규제 기본법 시행령」 제9조 제4항 각 호에 해당되는 사항
        각 행은 th(카테고리) + td(내용) 구조.
        """
        try:
            zones = self._safe_evaluate(page, """
                const result = [];
                const tables = document.querySelectorAll('table');
                for (const table of tables) {
                    const rows = table.querySelectorAll('tr');
                    for (const row of rows) {
                        const ths = row.querySelectorAll('th');
                        const tds = row.querySelectorAll('td');
                        if (ths.length === 0 || tds.length === 0) continue;
                        // 모든 th 텍스트를 합쳐서 카테고리로
                        const category = Array.from(ths).map(th => th.innerText.trim()).join(' ').trim();
                        const value = Array.from(tds).map(td => td.innerText.trim()).filter(t => t && t !== '-').join(', ');
                        if (category && value) {
                            result.push({category, value});
                        }
                    }
                }
                return result;
            """, timeout_ms=5000) or []

            for item in zones:
                cat = item.get("category", "")
                val = item.get("value", "")
                if not cat or not val:
                    continue

                # 카테고리 정규화
                if "국토의 계획" in cat or "용도지역" in cat:
                    result["국토계획법_지역지구"] = val
                elif "다른 법령" in cat:
                    result["다른법령_지역지구"] = val
                elif "토지이용규제 기본법" in cat or "제9조" in cat:
                    result["토지이용규제_기타"] = val
                elif "지역지구등 지정여부" in cat:
                    continue  # 상위 헤더, skip
                elif "소재지" in cat or "지목" in cat or "면적" in cat or "공시지가" in cat:
                    continue  # 이미 기본정보에서 추출됨
                elif len(val) > 2:
                    # 기타 카테고리
                    clean_cat = re.sub(r'\s+', ' ', cat)[:30]
                    result[clean_cat] = val

        except Exception as e:
            self.logger.warning(f"용도지역 추출 실패: {e}")

    def _format_markdown(self, result: dict) -> str:
        lines = [f"# 토지 이용계획 — {result.get('정확주소', result.get('주소', ''))}", ""]

        if not result.get("성공"):
            lines.append("> **조회 실패**")
            if result.get("안내"):
                lines.append(f"> {result['안내']}")
            lines.append("")
            lines.append("---")
            lines.append("*토지이음(eum.go.kr) 자동 수집*")
            return "\n".join(lines)

        # 기본정보
        lines.append("## 기본정보")
        lines.append("")
        lines.append("| 항목 | 내용 |")
        lines.append("|------|------|")

        basic_fields = ["소재지", "지목", "면적", "개별공시지가", "PNU", "확인도면"]
        for field in basic_fields:
            if field in result:
                lines.append(f"| {field} | {result[field]} |")
        lines.append("")

        # 토지이용규제
        usage_fields = ["국토계획법_지역지구", "다른법령_지역지구", "토지이용규제_기타",
                        "용도지역", "용도지구", "용도구역"]
        has_usage = any(f in result for f in usage_fields)
        if has_usage:
            lines.append("## 토지이용규제")
            lines.append("")
            for field in usage_fields:
                if field in result:
                    label = field.replace("_", " — ")
                    lines.append(f"### {label}")
                    lines.append(f"{result[field]}")
                    lines.append("")

        # 기타 정보
        skip = {"주소", "정확주소", "PNU", "성공", "안내", "주소후보", "오류",
                "확인도면", "확인도면_base64",
                "_meta"} | set(basic_fields) | set(usage_fields)
        others = {k: v for k, v in result.items()
                  if k not in skip and not k.startswith("_")}
        if others:
            lines.append("## 기타")
            lines.append("")
            for k, v in others.items():
                lines.append(f"- **{k}**: {v}")
            lines.append("")

        # 주소 후보
        if result.get("주소후보") and len(result["주소후보"]) > 1:
            lines.append("## 인근 필지")
            lines.append("")
            for addr in result["주소후보"][:5]:
                lines.append(f"- {addr}")
            lines.append("")

        lines.append("---")
        lines.append("*토지이음(eum.go.kr) 자동 수집*")
        return "\n".join(lines)


def main():
    parser = LandInfoTool.create_parser("토지이음 토지 이용계획 조회")
    parser.add_argument("address", help="주소 (예: '서울특별시 광진구 군자동 98')")
    args = parser.parse_args()

    tool = LandInfoTool.from_args(args)
    result = tool.run(address=args.address)
    tool.print_json(result)


if __name__ == "__main__":
    main()
