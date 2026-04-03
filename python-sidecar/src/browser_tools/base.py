"""브라우저 자동화 공통 베이스 클래스."""

import argparse
import json
import logging
from pathlib import Path

from playwright.sync_api import sync_playwright, Page


def _load_browser_config() -> dict:
    """settings.yaml의 browser_tools 섹션을 로드합니다.

    shared.config 모듈을 사용하여 캐시된 설정을 읽습니다.
    설정 변경 시 reload_config() 호출로 캐시 무효화되면 반영됩니다.
    """
    try:
        from shared.config import get_config
        return get_config("browser_tools") or {}
    except Exception:
        # shared.config 로드 실패 시 (독립 CLI 실행 등) 직접 YAML 로드
        try:
            import yaml
            for candidate in [
                Path(__file__).resolve().parents[2] / "config" / "settings.yaml",
                Path.cwd() / "python-sidecar" / "config" / "settings.yaml",
            ]:
                if candidate.exists():
                    with open(candidate, encoding="utf-8") as f:
                        data = yaml.safe_load(f) or {}
                    return data.get("browser_tools", {})
        except Exception:
            pass
    return {}


def _get_cfg() -> dict:
    """런타임에 최신 config를 반환합니다 (캐시 무효화 대응)."""
    return _load_browser_config()


# 초기값 — 모듈 상수는 최초 import 시 설정, 런타임 갱신은 _get_cfg() 사용
_CFG = _load_browser_config()

# ── 공통 상수 (settings.yaml browser_tools 섹션으로 오버라이드 가능) ──
DEFAULT_TIMEOUT_MS = _CFG.get("default_timeout_ms", 30_000)
LOGIN_TIMEOUT_SEC = _CFG.get("login_timeout_sec", 120)
LOGIN_POLL_SEC = 2.0                # 로그인 폴링 간격
VIEWPORT_WIDTH = _CFG.get("viewport_width", 1280)
VIEWPORT_HEIGHT = _CFG.get("viewport_height", 900)
POPUP_WAIT_MS = _CFG.get("popup_wait_ms", 500)
SEARCH_WAIT_MS = _CFG.get("search_wait_ms", 2000)
DETAIL_WAIT_MS = _CFG.get("detail_wait_ms", 1000)
PAGE_LOAD_WAIT_MS = _CFG.get("page_load_wait_ms", 3000)
GIS_LOAD_WAIT_MS = _CFG.get("gis_load_wait_ms", 5000)
MAP_CAPTURE_WAIT_MS = _CFG.get("map_capture_wait_ms", 1500)
IGNORE_HTTPS_ERRORS = bool(_CFG.get("ignore_https_errors", False))

# 팝업 닫기 기본 셀렉터
DEFAULT_POPUP_HIDE_SELECTORS = (
    '.layerpopup, .layer_popup, .popup, .popup-wrap, .alert-wrap, '
    '.dimmed, .modal, [class*="popup"], [class*="modal"]'
)
DEFAULT_POPUP_CLOSE_SELECTORS = (
    'button.ico-close, .popup_close, .btn-close, a.btn-close'
)

# th-td 추출 기본 설정
TH_TD_MAX_ROWS = 30
TH_TD_MAX_KEY_LEN = 30
TH_TD_SKIP_KEYS = frozenset({
    "홈", "검색", "전체메뉴", "본문 바로가기", "주메뉴 바로가기", "홈으로",
})


class BrowserTool:
    """Playwright 기반 브라우저 자동화 베이스.

    모든 사이트별 도구가 이 클래스를 상속합니다.
    공통 기능: headed/headless 전환, 디버그 스크린샷, 타임아웃 관리.
    """

    name: str = "base"
    description: str = ""
    url: str = ""

    def __init__(self, headed: bool = False, debug: bool = False,
                 output_dir: str = None, timeout: int = None,
                 cancel_event=None):
        # 런타임 config 갱신 — 설정 UI 변경 반영
        cfg = _get_cfg()
        self.headed = headed
        self.debug = debug
        self.timeout = timeout if timeout is not None else cfg.get("default_timeout_ms", DEFAULT_TIMEOUT_MS)
        self.cancel_event = cancel_event
        self._step_count = 0
        self._saved_files: list[str] = []

        if output_dir:
            self.output_dir = Path(output_dir)
        else:
            import sys
            if getattr(sys, "frozen", False):
                self.output_dir = Path.home() / ".eduplan-ai" / "output" / "browser_tools"
            else:
                self.output_dir = Path.cwd() / "output" / "browser_tools"
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.logger = logging.getLogger(f"browser.{self.name}")
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter(
                "%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S"
            ))
            self.logger.addHandler(handler)
            self.logger.setLevel(logging.INFO)

    def run(self, _max_retries: int = 1, _playwright=None, **kwargs) -> dict:
        """브라우저를 열고 자동화를 실행합니다.

        Args:
            _max_retries: 최대 재시도 횟수 (기본 1 = 재시도 없음)
            _playwright: 외부에서 관리하는 Playwright 인스턴스 (싱글톤 재사용).
                         None이면 호출마다 sync_playwright() 생성 (CLI 모드).

        Returns:
            결과 딕셔너리 (_meta 포함: 저장된 파일 경로 등)
        """
        last_error = None
        for attempt in range(_max_retries):
            # 취소 이벤트 체크 — 브라우저 열기 전에 확인
            if self.cancel_event and self.cancel_event.is_set():
                return {
                    "오류": "사용자에 의해 취소됨",
                    "성공": False,
                    "_meta": {"saved_files": [], "output_dir": str(self.output_dir)},
                }
            self._saved_files = []
            try:
                if _playwright:
                    # 싱글톤 모드: 외부 Playwright 인스턴스 재사용 (sidecar RPC)
                    result = self._execute_with_browser(_playwright, **kwargs)
                else:
                    # CLI 모드: 호출마다 Playwright 생성/파괴
                    with sync_playwright() as p:
                        result = self._execute_with_browser(p, **kwargs)
                result["_meta"] = {
                    "saved_files": self._saved_files,
                    "output_dir": str(self.output_dir),
                }
                return result
            except Exception as e:
                last_error = e
                self.logger.error(f"실행 실패 (시도 {attempt + 1}/{_max_retries}): {e}")
                if attempt + 1 < _max_retries:
                    if self.cancel_event and self.cancel_event.is_set():
                        break
                    self.logger.info("재시도합니다...")

        return {
            "오류": str(last_error),
            "성공": False,
            "_meta": {
                "saved_files": self._saved_files,
                "output_dir": str(self.output_dir),
            },
        }

    def _execute_with_browser(self, p, **kwargs) -> dict:
        """Playwright 인스턴스로 브라우저를 열고 자동화를 실행합니다."""
        launch_args = []
        if not self.headed:
            launch_args = [
                "--disable-gpu",
                "--disable-software-rasterizer",
            ]
        browser = p.chromium.launch(
            headless=not self.headed, args=launch_args,
        )
        try:
            rt_cfg = _get_cfg()
            context = browser.new_context(
                viewport={
                    "width": rt_cfg.get("viewport_width", VIEWPORT_WIDTH),
                    "height": rt_cfg.get("viewport_height", VIEWPORT_HEIGHT),
                },
                locale="ko-KR",
                ignore_https_errors=bool(rt_cfg.get("ignore_https_errors", IGNORE_HTTPS_ERRORS)),
            )
            page = context.new_page()
            page.set_default_timeout(self.timeout)
            return self.execute(page, **kwargs)
        except Exception:
            try:
                self._screenshot(page, "error")
            except Exception:
                pass
            raise
        finally:
            browser.close()
            # Windows에서 Chromium 프로세스 정리 대기 — 연속 호출 시 hang 방지
            import time
            time.sleep(0.5)

    def run_without_browser(self, **kwargs) -> dict:
        """브라우저 없이 API로 데이터를 수집합니다.

        API 기반 도구가 이 메서드를 오버라이드합니다.
        """
        raise NotImplementedError("이 도구는 브라우저가 필요합니다")

    def execute(self, page: Page, **kwargs) -> dict:
        """사이트별 자동화 로직 (하위 클래스에서 구현)."""
        raise NotImplementedError

    def _screenshot(self, page: Page, step_name: str):
        """디버그 모드일 때 스크린샷을 저장합니다."""
        if not self.debug:
            return
        self._step_count += 1
        debug_dir = self.output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{self.name}_{self._step_count:02d}_{step_name}.png"
        path = debug_dir / filename
        page.screenshot(path=str(path), timeout=10_000)
        self.logger.info(f"스크린샷: {path}")

    def save_json(self, data: dict, filename: str) -> Path:
        """결과를 JSON 파일로 저장합니다."""
        path = self.output_dir / filename
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        self._saved_files.append(str(path))
        self.logger.info(f"저장: {path}")
        return path

    def save_text(self, text: str, filename: str) -> Path:
        """결과를 텍스트 파일로 저장합니다."""
        path = self.output_dir / filename
        path.write_text(text, encoding="utf-8")
        self._saved_files.append(str(path))
        self.logger.info(f"저장: {path}")
        return path

    def save_csv(self, rows: list, filename: str, header: list = None) -> Path:
        """결과를 CSV 파일로 저장합니다."""
        import csv
        path = self.output_dir / filename
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            if header:
                writer.writerow(header)
            writer.writerows(rows)
        self._saved_files.append(str(path))
        self.logger.info(f"저장: {path}")
        return path

    def relaunch_headed(self, playwright_instance, context_options: dict = None):
        """headless에서 로그인이 필요한 경우, headed 브라우저로 재시작합니다.

        Returns:
            (browser, page) tuple
        """
        self.logger.info("로그인 필요 — headed 브라우저로 전환합니다")
        opts = {
            "viewport": {"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
            "locale": "ko-KR",
            "ignore_https_errors": IGNORE_HTTPS_ERRORS,
        }
        if context_options:
            opts.update(context_options)
        browser = playwright_instance.chromium.launch(headless=False)
        context = browser.new_context(**opts)
        page = context.new_page()
        page.set_default_timeout(self.timeout)
        return browser, page

    def wait_for_login(self, page, success_indicator: str,
                       timeout_sec: int = LOGIN_TIMEOUT_SEC,
                       poll_sec: float = LOGIN_POLL_SEC) -> bool:
        """사용자가 headed 브라우저에서 로그인할 때까지 대기합니다.

        Args:
            page: Playwright page
            success_indicator: 로그인 성공 시 나타나는 CSS 선택자 또는 URL 패턴
            timeout_sec: 최대 대기 시간 (초)
            poll_sec: 폴링 간격 (초)

        Returns:
            로그인 성공 여부
        """
        import time
        self.logger.info(f"브라우저에서 로그인해주세요 (최대 {timeout_sec}초 대기)")
        start = time.time()
        while time.time() - start < timeout_sec:
            # URL 패턴 체크
            if success_indicator.startswith("url:"):
                pattern = success_indicator[4:]
                if pattern in page.url:
                    self.logger.info("로그인 감지됨")
                    return True
            # CSS 선택자 체크
            elif success_indicator.startswith("not:"):
                selector = success_indicator[4:]
                try:
                    if not page.locator(selector).first.is_visible():
                        self.logger.info("로그인 감지됨")
                        return True
                except Exception:
                    pass
            else:
                try:
                    if page.locator(success_indicator).first.is_visible():
                        self.logger.info("로그인 감지됨")
                        return True
                except Exception:
                    pass
            page.wait_for_timeout(int(poll_sec * 1000))
        self.logger.warning("로그인 대기 시간 초과")
        return False

    def _close_popups(self, page: Page,
                      hide_selectors: str = DEFAULT_POPUP_HIDE_SELECTORS,
                      close_selectors: str = DEFAULT_POPUP_CLOSE_SELECTORS,
                      wait_ms: int = POPUP_WAIT_MS):
        """페이지의 팝업/모달을 숨기거나 닫습니다.

        Args:
            page: Playwright 페이지
            hide_selectors: CSS 셀렉터 (display:none + remove)
            close_selectors: 닫기 버튼 CSS 셀렉터 (click)
            wait_ms: DOM 안정화 대기 시간
        """
        page.evaluate("""([hideSel, closeSel]) => {
            document.querySelectorAll(hideSel).forEach(el => {
                el.style.display = 'none';
                el.remove();
            });
            document.querySelectorAll(closeSel).forEach(btn => {
                try { btn.click(); } catch(e) {}
            });
        }""", [hide_selectors, close_selectors])
        page.wait_for_timeout(wait_ms)

    def _extract_table_pairs(self, page: Page,
                             max_rows: int = TH_TD_MAX_ROWS,
                             max_key_len: int = TH_TD_MAX_KEY_LEN,
                             skip_keys: frozenset = TH_TD_SKIP_KEYS) -> dict:
        """페이지에서 th-td 쌍을 딕셔너리로 추출합니다.

        Args:
            page: Playwright 페이지
            max_rows: 최대 추출 행 수
            max_key_len: 키 최대 길이 (초과 시 skip)
            skip_keys: 건너뛸 키 이름 집합

        Returns:
            {키: 값} 딕셔너리
        """
        info = {}
        th_elements = page.locator("th").all()
        for th in th_elements[:max_rows]:
            try:
                key = th.inner_text().strip()
                if not key or len(key) > max_key_len:
                    continue
                if key in skip_keys:
                    continue
                parent = th.locator("xpath=..")
                td = parent.locator("td").first
                if td.count() > 0 and td.is_visible():
                    val = td.inner_text().strip()
                    if val:
                        info[key] = val
            except Exception:
                continue
        return info

    @staticmethod
    def print_json(data: dict, limit: int = 3000):
        """UTF-8로 JSON을 출력합니다 (Windows cp949 호환).

        CLI 실행 전용. Sidecar 모드에서는 사용하지 않음.
        """
        import sys, io
        text = json.dumps(data, ensure_ascii=False, indent=2)[:limit]
        # stdout.buffer에 직접 써서 sys.stdout 교체를 피함
        if hasattr(sys.stdout, 'buffer'):
            sys.stdout.buffer.write((text + "\n").encode("utf-8", errors="replace"))
            sys.stdout.buffer.flush()
        else:
            print(text)

    @classmethod
    def create_parser(cls, description: str = None) -> argparse.ArgumentParser:
        """CLI 인자 파서를 생성합니다."""
        parser = argparse.ArgumentParser(
            description=description or cls.description
        )
        parser.add_argument("--headed", action="store_true",
                            help="브라우저 창을 표시합니다")
        parser.add_argument("--debug", action="store_true",
                            help="각 단계마다 스크린샷을 저장합니다")
        parser.add_argument("--output", "-o", type=str, default=None,
                            help="출력 디렉토리")
        parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_MS,
                            help="타임아웃(ms)")
        return parser

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> "BrowserTool":
        """파싱된 인자로 인스턴스를 생성합니다."""
        return cls(
            headed=args.headed,
            debug=args.debug,
            output_dir=args.output,
            timeout=args.timeout,
        )
