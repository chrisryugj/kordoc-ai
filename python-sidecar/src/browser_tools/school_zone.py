"""학구도안내 — 학구도 정보 조회.

schoolzone.emac.kr에서 주소/학교명 기반 학구도 정보를 조회합니다.
검색 → GIS 지도 페이지 → iframe 내 학구 데이터(주소, 통학구역, 학교목록) 추출.

사용법:
    python -m src.browser_tools.school_zone "서울특별시 광진구 군자동"
    python -m src.browser_tools.school_zone "광장중학교" --headed
"""

import re
from playwright.sync_api import Page

from .base import (
    BrowserTool, SEARCH_WAIT_MS, GIS_LOAD_WAIT_MS, MAP_CAPTURE_WAIT_MS,
)


class SchoolZoneTool(BrowserTool):
    name = "school_zone"
    description = "학구도 정보 조회"
    url = "https://schoolzone.emac.kr"

    def execute(self, page: Page, address: str = "",
               school_id: str = "", school_class: str = "", **kwargs) -> dict:
        if not address and not school_id:
            raise ValueError("주소, 학교명 또는 school_id를 입력하세요")

        # school_id가 주어진 경우 — 특정 학교 GIS 직접 조회 (학교 선택 후 재실행)
        if school_id:
            label = address or school_id
            self.logger.info(f"학구도 GIS 직접 조회: {school_id} ({label})")
            # 메인 페이지 거치지 않고 GIS 직접 진입 (불필요한 이중 네비게이션 제거)
            zone_data = self._extract_zone_from_gis(page, school_id, school_class, label)
            result = {
                "검색어": label,
                "학구_상세": zone_data,
                "학교목록": [],
                "결과수": 0,
                "성공": bool(zone_data),
            }
            safe = re.sub(r'[^\w가-힣]', '_', label)[:30]
            self.save_json(result, f"schoolzone_{safe}.json")
            self.save_text(self._format_summary(result), f"schoolzone_{safe}.md")
            return result

        self.logger.info(f"학구도 검색: {address}")

        # 1. 학교 검색 페이지로 직접 이동 (load 이벤트 후 검색폼 대기)
        page.goto(f"{self.url}/search/schoolSearch.do", wait_until="domcontentloaded")
        try:
            page.wait_for_selector("#searchWrd, input[name='searchWrd']", timeout=8000)
        except Exception:
            pass

        # 팝업 닫기 (공지 모달 등)
        try:
            self._close_popups(page)
        except Exception:
            pass
        self._screenshot(page, "search_page")

        # 2. 검색어 입력 + 실행
        search_input = page.locator("#searchWrd")
        if not search_input.is_visible(timeout=3000):
            search_input = page.locator("input[name='searchWrd']").first
        search_input.fill(address)

        search_btn = page.locator("button.btn-primary:has-text('검색')").first
        if search_btn.is_visible():
            search_btn.click()
        else:
            search_input.press("Enter")

        # 검색 결과 대기 — networkidle 폴백 (타임아웃 허용)
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        page.wait_for_timeout(SEARCH_WAIT_MS)
        self._screenshot(page, "search_result")

        # 3. 검색 결과 추출 (테이블 + data-schoolid)
        result = self._extract_search_results(page, address)

        # 4. GIS 페이지에서 학구 상세 데이터 추출
        #    결과가 1개일 때만 자동 GIS 조회 — 여러 개면 목록만 반환 (사용자 선택 후 재조회)
        if len(result["학교목록"]) == 1:
            first = result["학교목록"][0]
            school_id = first.get("_schoolId", "")
            school_class = first.get("_schoolClass", "")
            if school_id:
                school_name = first.get("학교명", address)
                zone_data = self._extract_zone_from_gis(
                    page, school_id, school_class, school_name
                )
                if zone_data:
                    result["학구_상세"] = zone_data
                    result["학교목록"] = []
                    result["결과수"] = 0

        # 학교목록이 비워진 경우에도 학구_상세가 있으면 성공
        result["성공"] = bool(result.get("학구_상세") or result["학교목록"])
        if not result["성공"]:
            result["오류"] = f"'{address}' 검색 결과가 없습니다. 정식 학교명(예: 대원외국어고등학교)이나 주소로 검색해 보세요."

        # _schoolId, _schoolClass → schoolId, schoolClass 로 rename (프론트 재선택용)
        for school in result["학교목록"]:
            if "_schoolId" in school:
                school["schoolId"] = school.pop("_schoolId")
            if "_schoolClass" in school:
                school["schoolClass"] = school.pop("_schoolClass")
            # 나머지 내부 키 제거
            for key in list(school.keys()):
                if key.startswith("_"):
                    del school[key]

        # 5. 저장
        safe_addr = re.sub(r'[^\w가-힣]', '_', address)[:30]
        self.save_json(result, f"schoolzone_{safe_addr}.json")

        summary = self._format_summary(result)
        self.save_text(summary, f"schoolzone_{safe_addr}.md")

        self.logger.info("조회 완료")
        return result

    def _extract_search_results(self, page: Page, address: str) -> dict:
        """검색 결과 테이블에서 학교 목록 + data 속성을 추출합니다."""
        result = {"검색어": address, "학교목록": []}

        rows = page.locator("table tbody tr").all()
        for row in rows[:20]:
            cells = row.locator("td").all()
            if len(cells) < 4:
                continue

            school = {}
            for cell in cells:
                header = cell.get_attribute("data-cell-header") or ""
                text = cell.inner_text().strip()

                # 지도보기 버튼은 텍스트 대신 data 속성 추출
                btn = cell.locator("button.btn-map").first
                if btn.count() > 0:
                    school["_schoolId"] = btn.get_attribute("data-schoolid") or ""
                    school["_schoolClass"] = btn.get_attribute("data-schoolclass") or ""
                    continue

                # pc 클래스(NO, 학교급)는 header가 없을 수 있음
                if header:
                    school[header] = text
                elif text and not header:
                    css_class = cell.get_attribute("class") or ""
                    if "pc" in css_class and text.isdigit():
                        school["NO"] = text
                    elif "pc" in css_class:
                        school["학교급"] = text
                    elif text:
                        school.setdefault("기타", text)

            if school:
                result["학교목록"].append(school)

        result["결과수"] = len(result["학교목록"])
        return result

    def _is_cancelled(self) -> bool:
        """취소 이벤트 확인 헬퍼."""
        return bool(self.cancel_event and self.cancel_event.is_set())

    def _extract_zone_from_gis(self, page: Page, school_id: str,
                               school_class: str, school_name: str = "") -> dict:
        """GIS 페이지로 이동하여 iframe 내 학구 데이터를 추출합니다."""
        gis_url = f"{self.url}/gis/gis.do?schoolId={school_id}&schoolClass={school_class}"
        self.logger.info(f"GIS 페이지 접근: {gis_url}")

        try:
            if self._is_cancelled():
                return {}
            # GIS 페이지는 무거움 — load 이벤트를 기다리지 않고 commit만 확인
            page.goto(gis_url, wait_until="commit", timeout=10_000)
            if self._is_cancelled():
                return {}
            # domcontentloaded까지만 대기 (networkidle은 GIS 타일 로딩으로 hang 위험)
            try:
                page.wait_for_load_state("domcontentloaded", timeout=8_000)
            except Exception:
                pass
            if self._is_cancelled():
                return {}
            # GIS 안정화 대기 — 고정 대기 대신 짧은 대기 + 탭 존재 확인
            page.wait_for_timeout(min(GIS_LOAD_WAIT_MS, 3000))

            # 팝업 닫기 — GIS 페이지 JS가 Playwright refs를 깨는 경우 무시
            try:
                self._close_popups(page)
            except Exception:
                pass

            if self._is_cancelled():
                return {}

            # 학구검색결과 탭 활성화 — Playwright 네이티브 클릭 우선, JS 폴백
            try:
                page.click("#btn_schoolAreaTab", timeout=3000)
            except Exception:
                try:
                    page.evaluate("""() => {
                        var tab = document.getElementById('btn_schoolAreaTab');
                        if (tab) tab.click();
                    }""")
                except Exception:
                    pass
            page.wait_for_timeout(min(SEARCH_WAIT_MS, 1500))

            if self._is_cancelled():
                return {}

            # iframe 대기 (탭 클릭 후 로드 대기) — 타임아웃 단축
            try:
                page.wait_for_selector(
                    "iframe[name='schoolAreaIframe'], iframe#schoolAreaIframe",
                    timeout=3000,
                )
            except Exception:
                pass

            # iframe 접근 — name → 전체 프레임 URL/name 스캔 순서로 폴백
            frame = page.frame(name="schoolAreaIframe")
            if not frame:
                for f in page.frames:
                    fname = f.name or ""
                    furl = f.url or ""
                    if "schoolArea" in fname or "schoolArea" in furl:
                        frame = f
                        break

            if not frame:
                self.logger.warning("schoolAreaIframe을 찾을 수 없습니다")
                return {}

            zone = self._parse_zone_iframe(frame)
            zone["지도_URL"] = gis_url

            # 지도 캡처 (사이드바/팝업 숨기고 지도만, JPG + 학교명 표시)
            safe_name = re.sub(r'[^\w가-힣]', '_', school_name)[:30]
            map_path = self._capture_map(page, safe_name, school_name)
            if map_path:
                zone["지도_이미지"] = str(map_path)
                # base64 임베드: WebView에서 파일 경로 직접 접근 불가 우회
                try:
                    import base64 as _b64
                    with open(str(map_path), "rb") as _f:
                        zone["지도_이미지_base64"] = (
                            "data:image/jpeg;base64,"
                            + _b64.b64encode(_f.read()).decode("ascii")
                        )
                except Exception:
                    pass

            return zone
        except Exception as e:
            self.logger.warning(f"GIS 학구 데이터 추출 실패: {e}")
            return {}

    def _capture_map(self, page: Page, safe_name: str, label: str) -> str:
        """사이드바/팝업을 숨기고 지도만 캡처 → 여백 크롭 + 라벨 + JPG 저장."""
        try:
            from PIL import Image, ImageDraw, ImageFont

            # UI 요소 숨기기 (사이드바, 헤더, 팝업, 툴바, 축척바, 줌)
            page.evaluate("""() => {
                var hide = [
                    '.lnb-wrap', '#header', '.header-area',
                    '.popup-wrap', '.alert-wrap', '.dimmed',
                    '.map-toolbar-wrap', '.slider-range-area',
                    '[class*=popup]', '[class*=modal]',
                    '.map-toolbar', '.ol-control', '.ol-zoom',
                    '#footer', '.footer-area',
                    '.info-wrap', '.modal-wrap'
                ];
                hide.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => {
                        el.style.display = 'none';
                    });
                });
                var content = document.querySelector('.content-wrap');
                if (content) { content.style.marginLeft = '0'; content.style.left = '0'; }
                var mapArea = document.querySelector('.map-area');
                if (mapArea) { mapArea.style.left = '0'; mapArea.style.width = '100%'; }
            }""")
            page.wait_for_timeout(500)

            # 지도를 학구 영역에 맞춰 줌
            # 전략: 학교 마커(0m 지점)에 가장 가까운 폴리곤 = 주 학구.
            # 분리된 학구(예: 광남중 2개 구역)에서 전체 extent로 잡으면 빈 공간이 많아짐.
            page.evaluate("""() => {
                try {
                    var map = window.map || window.oMap;
                    if (!map || !map.getLayers) return;

                    // 1. 지도 중심점 (학교 마커 위치) 가져오기
                    var center = map.getView().getCenter();

                    // 2. 모든 Vector 레이어에서 폴리곤 feature 수집
                    var allFeatures = [];
                    var layers = map.getLayers().getArray();
                    for (var i = 0; i < layers.length; i++) {
                        var layer = layers[i];
                        if (layer.getSource && layer.getSource().getFeatures) {
                            var features = layer.getSource().getFeatures();
                            for (var j = 0; j < features.length; j++) {
                                var geom = features[j].getGeometry();
                                if (geom && (geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon')) {
                                    allFeatures.push(features[j]);
                                }
                            }
                        }
                    }

                    if (allFeatures.length === 0) return;

                    // 3. 학교 중심에 가장 가까운 폴리곤 찾기 (주 학구)
                    var bestFeature = null;
                    var bestDist = Infinity;
                    for (var k = 0; k < allFeatures.length; k++) {
                        var ext = allFeatures[k].getGeometry().getExtent();
                        // extent 중심까지 거리
                        var cx = (ext[0] + ext[2]) / 2;
                        var cy = (ext[1] + ext[3]) / 2;
                        var dist = Math.sqrt(Math.pow(cx - center[0], 2) + Math.pow(cy - center[1], 2));
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestFeature = allFeatures[k];
                        }
                    }

                    if (bestFeature) {
                        var extent = bestFeature.getGeometry().getExtent();
                        var view = map.getView();
                        view.fit(extent, { padding: [50, 50, 50, 50], duration: 0 });
                        map.updateSize();
                    }
                } catch(e) { /* GIS API 접근 실패 — 기본 줌 유지 */ }
            }""")
            # 줌 후 타일 로딩 대기
            page.wait_for_timeout(MAP_CAPTURE_WAIT_MS + 1000)

            # PNG 임시 캡처
            tmp_path = self.output_dir / f"_tmp_map.png"
            page.screenshot(path=str(tmp_path), timeout=10_000)

            # Pillow로 후처리: 여백 크롭 + 라벨 + JPG 변환
            img = Image.open(tmp_path).convert("RGB")

            # 여백 자동 크롭 (흰/회색 테두리 제거)
            img = self._auto_crop(img, threshold=245)

            # 상단에 학교명 라벨 추가
            img = self._add_label(img, f"학구도 — {label}", ImageDraw, ImageFont)

            # JPG 저장
            filename = f"schoolzone_map_{safe_name}.jpg"
            path = self.output_dir / filename
            img.save(str(path), "JPEG", quality=85, optimize=True)
            tmp_path.unlink(missing_ok=True)

            self._saved_files.append(str(path))
            self.logger.info(f"지도 캡처: {path}")
            return str(path)
        except Exception as e:
            self.logger.warning(f"지도 캡처 실패: {e}")
            return ""

    @staticmethod
    def _auto_crop(img, threshold: int = 245, margin: int = 4):
        """이미지 가장자리의 흰/밝은 여백을 자동으로 잘라냅니다."""
        import numpy as np
        arr = np.array(img)
        # 각 픽셀이 threshold 이하(어두운)인지 확인
        mask = arr.min(axis=2) < threshold
        if not mask.any():
            return img
        rows = mask.any(axis=1)
        cols = mask.any(axis=0)
        r_min, r_max = rows.argmax(), len(rows) - rows[::-1].argmax()
        c_min, c_max = cols.argmax(), len(cols) - cols[::-1].argmax()
        # 약간의 마진 확보
        r_min = max(0, r_min - margin)
        c_min = max(0, c_min - margin)
        r_max = min(arr.shape[0], r_max + margin)
        c_max = min(arr.shape[1], c_max + margin)
        return img.crop((c_min, r_min, c_max, r_max))

    @staticmethod
    def _add_label(img, text: str, ImageDraw, ImageFont):
        """이미지 상단에 반투명 배경 + 라벨 텍스트를 추가합니다."""
        from PIL import Image as PILImage
        bar_height = 36
        new_img = PILImage.new("RGB", (img.width, img.height + bar_height), (255, 255, 255))
        draw = ImageDraw.Draw(new_img)
        # 상단 바 배경 (짙은 회색)
        draw.rectangle([(0, 0), (img.width, bar_height)], fill=(50, 55, 65))
        # 폰트 (시스템 폰트 폴백)
        font = None
        for font_name in ["malgun.ttf", "NanumGothic.ttf", "gulim.ttc", "arial.ttf"]:
            try:
                font = ImageFont.truetype(font_name, 18)
                break
            except OSError:
                continue
        if not font:
            font = ImageFont.load_default()
        # 텍스트 중앙 정렬
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        x = (img.width - text_w) // 2
        draw.text((x, 8), text, fill=(255, 255, 255), font=font)
        # 원본 이미지 붙이기
        new_img.paste(img, (0, bar_height))
        return new_img

    def _parse_zone_iframe(self, frame) -> dict:
        """학구검색결과 iframe에서 주소, 학구명, 학교목록을 추출합니다."""
        zone = {}

        # 주소 정보
        try:
            addr_details = frame.locator(".s-addr-wrap .s-addr-detail").all()
            for detail in addr_details:
                label = detail.locator(".label").inner_text().strip()
                value = detail.locator(".result").inner_text().strip()
                if label and value:
                    zone[label] = value
        except Exception:
            pass

        # 초/중/고 탭별 학구 정보
        tab_map = {
            "tabSchool1": "초등학교",
            "tabSchool2": "중학교",
            "tabSchool3": "고등학교",
        }

        for tab_id, school_type in tab_map.items():
            try:
                tab = frame.locator(f"#{tab_id}")
                if not tab.count():
                    continue

                # 학구명 (통학구역/학교군)
                zone_name_el = tab.locator(".s-addr-tit .title").first
                if zone_name_el.count():
                    zone_name = zone_name_el.inner_text().strip()
                    if zone_name:
                        zone[f"{school_type}_학구"] = zone_name

                # 학교 목록 — li 요소의 data 속성에서 직접 추출
                schools = []
                exceptions = []
                seen = set()
                school_items = tab.locator(".school-list .td-area ul li[schoolname]").all()

                for item in school_items:
                    name = item.get_attribute("schoolname") or ""
                    if not name or name in seen:
                        continue
                    seen.add(name)

                    dist_raw = item.get_attribute("distance") or "0"
                    dist = f"{int(dist_raw):,}m" if dist_raw.isdigit() else f"{dist_raw}m"
                    bigo = item.get_attribute("bigo") or ""

                    entry = {
                        "학교명": name,
                        "직선거리": dist,
                    }
                    addr = item.get_attribute("daddr") or ""
                    if addr:
                        entry["주소"] = addr
                    edu = item.get_attribute("eduarea") or ""
                    if edu:
                        entry["교육지원청"] = edu

                    if bigo == "예외":
                        exceptions.append(entry)
                    else:
                        schools.append(entry)

                if schools:
                    zone[f"{school_type}_학교목록"] = schools
                if exceptions:
                    zone[f"{school_type}_예외학교"] = exceptions

            except Exception as e:
                self.logger.debug(f"{school_type} 탭 파싱 실패: {e}")
                continue

        return zone

    def _format_summary(self, result: dict) -> str:
        lines = [f"# 학구도 검색 결과 — {result.get('검색어', '')}", ""]

        schools = result.get("학교목록", [])
        if schools:
            lines.append(f"검색 결과: {len(schools)}개교")
            lines.append("")
            lines.append("| NO | 지역 | 학교급 | 학교명 |")
            lines.append("|------|------|------|------|")
            for school in schools:
                no = school.get("NO", "")
                region = school.get("지역", "")
                grade = school.get("학교급", school.get("유형", ""))
                name = school.get("학교명", school.get("정보", ""))
                lines.append(f"| {no} | {region} | {grade} | {name} |")
            lines.append("")
        else:
            lines.append("검색 결과가 없습니다.")
            lines.append("")

        # 학구 상세
        zone = result.get("학구_상세", {})
        if zone:
            lines.append("## 학구 상세 정보")
            lines.append("")

            # 주소
            for key in ["도로명", "지번"]:
                if key in zone:
                    lines.append(f"- **{key}**: {zone[key]}")

            if "지도_URL" in zone:
                lines.append(f"- **학구도 지도**: {zone['지도_URL']}")
            if "지도_이미지" in zone:
                lines.append(f"- **지도 캡처**: {zone['지도_이미지']}")

            lines.append("")

            # 학교급별 정보
            for school_type in ["초등학교", "중학교", "고등학교"]:
                zone_key = f"{school_type}_학구"
                if zone_key in zone:
                    lines.append(f"### {school_type}")
                    lines.append(f"- **학구**: {zone[zone_key]}")

                    # 학교 목록
                    list_key = f"{school_type}_학교목록"
                    if list_key in zone:
                        lines.append("")
                        lines.append("| 학교명 | 직선거리 | 주소 |")
                        lines.append("|------|------|------|")
                        for s in zone[list_key]:
                            name = s.get("학교명", "")
                            dist = s.get("직선거리", "")
                            addr = s.get("주소", "")
                            lines.append(f"| {name} | {dist} | {addr} |")

                    # 예외학교
                    exc_key = f"{school_type}_예외학교"
                    if exc_key in zone:
                        lines.append("")
                        lines.append("**예외학교**:")
                        for exc in zone[exc_key]:
                            lines.append(f"  - {exc.get('학교명', '')} ({exc.get('직선거리', '')})")

                    lines.append("")

        lines.append("---")
        lines.append("*학구도안내서비스(schoolzone.emac.kr) 자동 수집*")
        return "\n".join(lines)


def main():
    parser = SchoolZoneTool.create_parser("학구도 정보 조회")
    parser.add_argument("address", help="주소 또는 학교명")
    args = parser.parse_args()

    tool = SchoolZoneTool.from_args(args)
    result = tool.run(address=args.address)
    tool.print_json(result)


if __name__ == "__main__":
    main()
