"""설계대가 산출 — 자동 계산.

kira.or.kr에서 건축사 설계대가를 자동 산출합니다.

사용법:
    python -m src.browser_tools.design_fee --pay 1000000000
    python -m src.browser_tools.design_fee --bangsik 1 --jongbyeol 1 --geubsu 1 --pay 5000000000 --headed
"""

import json
from playwright.sync_api import Page

from .base import BrowserTool


# 폼 필드 매핑 (라디오 버튼 값)
BANGSIK = {
    "1": "설계비(도급)",
    "2": "설계비(직영)",
    "3": "감리비",
}
JONGBYEOL = {
    "1": "건축",
    "2": "토목",
    "3": "기계설비",
}
GEUBSU = {
    "1": "1급",
    "2": "2급",
    "3": "3급",
}


class DesignFeeTool(BrowserTool):
    name = "design_fee"
    description = "건축사 설계대가 자동 산출"
    # 업무대가산정 페이지 (로그인 필요 — kirahub.kira.or.kr)
    url = "https://kirahub.kira.or.kr/kira/kiraFrame.do?p1=main&p2=03&p3=06_01"

    def _needs_login(self, page: Page) -> bool:
        """로그인이 필요한 상태인지 판단합니다."""
        url_lower = page.url.lower()
        if "login" in url_lower or "main.do" in url_lower:
            for frame in page.frames:
                radios = frame.locator("input[type='radio']").all()
                if radios:
                    return False
            return True
        return False

    def execute(self, page: Page,
                bangsik: str = "1", jongbyeol: str = "1",
                geubsu: str = "1", pay: str = "",
                **kwargs) -> dict:
        if not pay:
            raise ValueError("대가(공사비) 금액을 입력하세요 (원 단위)")

        # 공사비 검증 — 교육시설은 보통 수억~수백억 단위
        pay_num = int(pay.replace(",", "")) if pay.replace(",", "").isdigit() else 0
        if pay_num > 0 and pay_num < 10_000_000:
            self.logger.warning(
                f"공사비 {pay_num:,}원은 너무 작습니다. "
                f"교육시설 공사비는 보통 수십억 원 이상입니다. "
                f"(예: 50억 = 5000000000)"
            )

        self.logger.info(
            f"설계대가 산출: {BANGSIK.get(bangsik)}, "
            f"{JONGBYEOL.get(jongbyeol)}, {GEUBSU.get(geubsu)}, "
            f"공사비={pay_num:,}원"
        )

        input_info = {
            "방식": BANGSIK.get(bangsik, bangsik),
            "종별": JONGBYEOL.get(jongbyeol, jongbyeol),
            "급수": GEUBSU.get(geubsu, geubsu),
            "공사비": pay,
            "공사비_표시": f"{pay_num:,}원" if pay_num else pay,
        }

        # 1. 설계대가 계산 페이지 접속
        page.goto(self.url, wait_until="domcontentloaded")
        self._screenshot(page, "main")

        # 2. 로그인 필요 여부 확인
        if self._needs_login(page):
            self.logger.warning("로그인 필요 — 로그인 페이지로 이동됨")

            if not self.headed:
                result = {
                    "입력": input_info,
                    "로그인_필요": True,
                    "성공": False,
                    "안내": (
                        "설계대가 산출은 KIRA 회원 로그인이 필요합니다.\n"
                        "① '로그인 후 수집' 버튼을 클릭하면 브라우저가 열립니다.\n"
                        "② kirahub.kira.or.kr에 로그인하세요.\n"
                        "③ 로그인 후 자동으로 산출을 시작합니다.\n\n"
                        "※ KIRA(대한건축사협회) 회원가입이 필요합니다."
                    ),
                }
                self.save_json(result, f"design_fee_{bangsik}_{jongbyeol}_{geubsu}.json")
                return result

            # headed 모드: 로그인 대기
            self.logger.info("브라우저 창에서 로그인해주세요")
            logged_in = self.wait_for_login(
                page,
                success_indicator="not:a:has-text('로그인')",
                timeout_sec=180,
            )
            if not logged_in:
                return {
                    "입력": input_info,
                    "성공": False,
                    "오류": "로그인 대기 시간이 초과되었습니다.",
                }

            page.goto(self.url, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            self._screenshot(page, "after_login")

        # iframe에서 폼 찾기
        target = page
        for frame in page.frames:
            radios = frame.locator("input[type='radio']").all()
            if radios:
                target = frame
                self.logger.info(f"폼을 iframe에서 발견: {frame.url}")
                break

        # 방식/종별/급수 선택 (radio)
        target.locator(f"input[name='bangsik'][value='{bangsik}']").check()
        self._screenshot(page, "bangsik_selected")
        target.locator(f"input[name='jongbyeol'][value='{jongbyeol}']").check()
        target.locator(f"input[name='geubsu'][value='{geubsu}']").check()
        self._screenshot(page, "options_selected")

        # 대가(공사비) 입력
        pay_input = target.locator("input[name='pay']")
        pay_input.fill(str(pay))
        self._screenshot(page, "pay_entered")

        # 산출 버튼 클릭
        calc_btn = target.locator(
            "input[type='submit'], button:has-text('산출'), "
            "input[type='button'][value*='산출'], a:has-text('산출')"
        ).first
        calc_btn.click()
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1000)
        self._screenshot(page, "result")

        # 결과 추출
        result = self._extract_result(target if target != page else page)
        result["입력"] = input_info
        result["성공"] = bool(result.get("산출금액") or result.get("결과_원본"))

        # 저장
        self.save_json(result, f"design_fee_{bangsik}_{jongbyeol}_{geubsu}.json")

        summary = self._format_summary(result)
        self.save_text(summary, f"design_fee_{bangsik}_{jongbyeol}_{geubsu}.md")

        self.logger.info("산출 완료")
        return result

    def _extract_result(self, page: Page) -> dict:
        """산출 결과를 추출합니다."""
        result = {}

        # 결과 영역에서 텍스트 추출
        result_area = page.locator(
            ".result, #result, .calculate_result, "
            "table.result, .cont_area table"
        )

        if result_area.count() > 0:
            text = result_area.first.inner_text().strip()
            result["결과_원본"] = text

            import re
            amounts = re.findall(r'[\d,]+\s*원', text)
            if amounts:
                result["산출금액"] = amounts
        else:
            body_text = page.locator("body").inner_text()
            import re
            lines = body_text.split("\n")
            result_lines = [
                line.strip() for line in lines
                if any(kw in line for kw in ["설계비", "대가", "금액", "원", "합계"])
                and line.strip()
            ]
            result["결과_라인"] = result_lines[:10]

        return result

    def _format_summary(self, result: dict) -> str:
        """결과 요약 텍스트를 생성합니다."""
        inp = result.get("입력", {})
        lines = [
            "# 설계대가 산출 결과\n",
            f"- 방식: {inp.get('방식', '')}",
            f"- 종별: {inp.get('종별', '')}",
            f"- 급수: {inp.get('급수', '')}",
            f"- 공사비: {inp.get('공사비_표시', inp.get('공사비', ''))}\n",
        ]

        if result.get("로그인_필요"):
            lines.append("## 로그인 필요")
            lines.append(result.get("안내", ""))
        elif "산출금액" in result:
            lines.append("## 산출 금액")
            for amt in result["산출금액"]:
                lines.append(f"- {amt}")
        elif "결과_원본" in result:
            lines.append("## 산출 결과")
            lines.append(result["결과_원본"])
        elif "결과_라인" in result:
            lines.append("## 산출 결과")
            for line in result["결과_라인"]:
                lines.append(f"- {line}")

        return "\n".join(lines)


def main():
    parser = DesignFeeTool.create_parser("건축사 설계대가 자동 산출")
    parser.add_argument("--bangsik", default="1", choices=["1", "2", "3"],
                        help="방식 (1=설계비도급, 2=설계비직영, 3=감리비)")
    parser.add_argument("--jongbyeol", default="1", choices=["1", "2", "3"],
                        help="종별 (1=건축, 2=토목, 3=기계설비)")
    parser.add_argument("--geubsu", default="1", choices=["1", "2", "3"],
                        help="급수 (1=1급, 2=2급, 3=3급)")
    parser.add_argument("--pay", required=True,
                        help="대가(공사비) 금액 (원 단위, 예: 5000000000 = 50억)")
    args = parser.parse_args()

    tool = DesignFeeTool.from_args(args)
    result = tool.run(
        bangsik=args.bangsik,
        jongbyeol=args.jongbyeol,
        geubsu=args.geubsu,
        pay=args.pay,
    )
    tool.print_json(result)


if __name__ == "__main__":
    main()
