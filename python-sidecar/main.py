"""
EduPlan AI - Python Sidecar
JSON-RPC 2.0 server over stdin/stdout
Threading model: long-running methods execute in a worker thread
so the stdin loop remains responsive for cancel/ping requests.
"""
import sys
import os
import io
import json
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from rpc_handler import RpcHandler

# Methods that run in a background thread (long-running)
ASYNC_METHODS = frozenset([
    "ocr_files", "text_extract", "extract_pages",
    "summarize", "integrate", "browser_tool",
    "tag_pages", "get_thumbnails",
])

# Lock to prevent interleaved stdout writes
_stdout_lock = threading.Lock()

# 활성 워커 추적: {req_id: (method, start_time)}
_active_workers: dict = {}
_workers_lock = threading.Lock()

# 워커가 이 시간(초) 이상 응답 없으면 watchdog 경고
_WORKER_WARN_SECONDS = 300  # 5분


_notification_callback = None  # main()에서 설정


def _log_path() -> Path:
    base_dir = Path(__file__).resolve().parent.parent
    log_dir = base_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / "sidecar.log"


def _short_path(value: str) -> str:
    try:
        path = Path(value)
        if path.name:
            return path.name
    except Exception:
        pass
    return value


def _preview_for_log(value, depth: int = 0):
    if depth >= 3:
        return "<...>"
    if isinstance(value, dict):
        preview = {}
        for idx, (key, item) in enumerate(value.items()):
            if idx >= 10:
                preview["..."] = f"+{len(value) - idx} more"
                break
            lowered = str(key).lower()
            if any(token in lowered for token in ("api_key", "token", "authorization")):
                preview[key] = "***redacted***"
            elif lowered in {"files"} and isinstance(item, list):
                preview[key] = [_short_path(str(x)) for x in item[:5]]
                if len(item) > 5:
                    preview[key].append(f"... +{len(item) - 5}")
            elif lowered.endswith(("_dir", "_path", "_file", "_folder")) and isinstance(item, str):
                preview[key] = _short_path(item)
            elif lowered == "tags" and isinstance(item, list):
                preview[key] = f"{len(item)} items"
            elif lowered in {"steps", "warnings", "thumbnails"} and isinstance(item, list):
                preview[key] = f"{len(item)} items"
            else:
                preview[key] = _preview_for_log(item, depth + 1)
        return preview
    if isinstance(value, list):
        preview = [_preview_for_log(item, depth + 1) for item in value[:5]]
        if len(value) > 5:
            preview.append(f"... +{len(value) - 5}")
        return preview
    if isinstance(value, str):
        compact = value.replace("\n", "\\n")
        return compact[:197] + "..." if len(compact) > 200 else compact
    return value


def _dump_for_log(value) -> str:
    try:
        return json.dumps(_preview_for_log(value), ensure_ascii=False, default=str)
    except Exception:
        return "<unserializable>"


def _watchdog_loop():
    """주기적으로 오래 실행 중인 워커를 감지합니다.

    - stderr에 경고 기록 (개발자용)
    - 프론트엔드에 JSON-RPC notification 전송 (사용자 알림)
    프로세스를 강제 종료하지 않습니다.
    """
    import logging
    wdog_logger = logging.getLogger("mvp")
    while True:
        time.sleep(60)
        now = time.monotonic()
        with _workers_lock:
            stale = [
                (rid, method, elapsed)
                for rid, (method, start) in _active_workers.items()
                if (elapsed := now - start) >= _WORKER_WARN_SECONDS
            ]
        for rid, method, elapsed in stale:
            wdog_logger.warning(
                f"[watchdog] 워커 {elapsed:.0f}초 실행 중 — "
                f"req_id={rid} method={method}."
            )
            if _notification_callback:
                _notification_callback("progress", {
                    "current": 0,
                    "total": 0,
                    "message": (
                        f"⚠️ 처리 중 ({elapsed / 60:.0f}분 경과) — "
                        f"네트워크 상태나 API 응답을 확인해 주세요."
                    ),
                })


def _setup_stderr_logging():
    """mvp 로거를 stderr와 로그 파일로 출력. stdout은 JSON-RPC 전용."""
    import logging
    logger = logging.getLogger("mvp")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"
        )
        stream_handler = logging.StreamHandler(sys.stderr)
        stream_handler.setFormatter(formatter)
        file_handler = logging.FileHandler(_log_path(), encoding="utf-8")
        file_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)
        logger.addHandler(file_handler)
        logger.propagate = False


def _check_dependencies():
    """시작 시 필수 의존성 체크. 누락 시 자동 설치 시도."""
    import subprocess
    import importlib

    # frozen(PyInstaller) 환경에서도 playwright는 번들 제외 → 시스템에 별도 설치 필요
    # pip 기반 패키지는 frozen 환경에서 설치 불가이므로 playwright만 별도 처리
    if getattr(sys, "frozen", False):
        _ensure_playwright_chromium()
        return

    required = {
        "google.genai": "google-genai",
        "fitz": "PyMuPDF",
        "PIL": "Pillow",
        "yaml": "PyYAML",
        "openpyxl": "openpyxl",
        "reportlab": "reportlab",
        "pypdf": "PyPDF",
        "playwright": "playwright",
    }
    # pyhwpx는 Windows 전용 (한컴오피스 필요)
    if sys.platform == "win32":
        required["pyhwpx"] = "pyhwpx"

    missing = []
    for module, package in required.items():
        try:
            __import__(module)
        except ImportError:
            missing.append(package)

    if missing:
        print(f"[sidecar] 누락된 패키지 자동 설치: {', '.join(missing)}", file=sys.stderr, flush=True)
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--quiet"] + missing,
                stdout=sys.stderr, stderr=sys.stderr,
            )
            importlib.invalidate_caches()
            print("[sidecar] 패키지 설치 완료", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[sidecar] 패키지 설치 실패: {e}", file=sys.stderr, flush=True)
            print(f"[sidecar] 수동 설치 필요: pip install {' '.join(missing)}", file=sys.stderr, flush=True)

    # playwright 패키지 설치 후 Chromium 바이너리도 확인
    _ensure_playwright_chromium()


def _ensure_playwright_chromium():
    """Playwright Chromium 바이너리 확인 및 자동 설치."""
    import os
    from pathlib import Path

    # playwright 패키지 자체가 없으면 skip (pip 단계에서 처리됨)
    try:
        __import__("playwright")
    except ImportError:
        return

    # 이미 설치됐는지 빠르게 확인 (subprocess 없이)
    custom_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if custom_path:
        base = Path(custom_path)
    elif sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Caches" / "ms-playwright"
    else:
        base = Path.home() / ".cache" / "ms-playwright"

    if base.exists() and any(base.glob("chromium-*")):
        return  # 이미 설치됨

    import subprocess
    print("[sidecar] Playwright Chromium 브라우저 설치 중...", file=sys.stderr, flush=True)
    try:
        subprocess.check_call(
            [sys.executable, "-m", "playwright", "install", "chromium"],
            stdout=sys.stderr, stderr=sys.stderr,
        )
        print("[sidecar] Playwright Chromium 설치 완료", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[sidecar] Playwright Chromium 설치 실패: {e}", file=sys.stderr, flush=True)


def main():
    # Force unbuffered stdout — prevents pipe buffer hang in PyInstaller builds
    os.environ["PYTHONUNBUFFERED"] = "1"

    # Force UTF-8 for stdin/stdout on Windows (prevents cp949 encoding errors)
    if sys.platform == "win32":
        sys.stdout = io.TextIOWrapper(
            sys.stdout.detach(), encoding="utf-8", errors="replace",
            newline="", write_through=True,
        )
        sys.stdin = io.TextIOWrapper(
            sys.stdin.detach(), encoding="utf-8", errors="replace",
        )
        sys.stderr = io.TextIOWrapper(
            sys.stderr.detach(), encoding="utf-8", errors="replace",
            write_through=True,
        )
        os.environ["PYTHONIOENCODING"] = "utf-8"

        # stdin/stdout 파이프 핸들을 non-inheritable로 설정.
        # Playwright의 node.js가 CreateProcess로 spawn될 때 stdout 핸들을 상속받으면
        # Windows 파이프 상태가 오염되어 Rust reader가 데이터를 수신하지 못함.
        os.set_inheritable(0, False)  # stdin
        os.set_inheritable(1, False)  # stdout
        # stderr(fd=2)는 inheritable 유지 — Playwright 로그가 stderr로 나와야 함

    _check_dependencies()
    _setup_stderr_logging()

    # Watchdog: hang 감지 데몬 스레드 (프로세스 종료 시 자동 소멸)
    wdog = threading.Thread(target=_watchdog_loop, daemon=True, name="watchdog")
    wdog.start()

    global _notification_callback
    handler = RpcHandler(notification_callback=send_notification)
    _notification_callback = send_notification
    # Thread pool limits concurrent long-running tasks (OCR, tagging, etc.)
    executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="rpc")

    try:
        _run_loop(handler, executor)
    finally:
        # M-9: 종료 시 모든 활성 작업에 취소 신호 → 완료 대기 (clean shutdown)
        handler.dispatch("cancel", {})
        executor.shutdown(wait=True, cancel_futures=True)


def _run_loop(handler, executor):
    """Main stdin read loop (extracted for clean shutdown)."""
    import logging
    rpc_logger = logging.getLogger("mvp.rpc")
    # Read JSON-RPC requests from stdin, one per line
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            send_error(None, -32700, f"Parse error: {e}")
            continue

        req_id = request.get("id")
        method = request.get("method", "")
        params = request.get("params", {})
        rpc_logger.info(
            "[rpc.recv] id=%s method=%s params=%s",
            req_id,
            method,
            _dump_for_log(params),
        )

        if method in ASYNC_METHODS:
            # Run long-running methods in bounded thread pool
            executor.submit(_handle_async, handler, req_id, method, params)
        else:
            # Short methods (ping, cancel, settings) run inline
            started = time.perf_counter()
            try:
                result = handler.dispatch(method, params or {})
                rpc_logger.info(
                    "[rpc.ok] id=%s method=%s elapsed=%.2fs result=%s",
                    req_id,
                    method,
                    time.perf_counter() - started,
                    _dump_for_log(result),
                )
                send_response(req_id, result)
            except Exception as e:
                rpc_logger.exception(
                    "[rpc.err] id=%s method=%s elapsed=%.2fs error=%s",
                    req_id,
                    method,
                    time.perf_counter() - started,
                    e,
                )
                send_error(req_id, -32000, str(e))


def _handle_async(handler, req_id, method, params):
    """Execute a long-running RPC method in a worker thread."""
    import logging
    rpc_logger = logging.getLogger("mvp.rpc")
    with _workers_lock:
        _active_workers[req_id] = (method, time.monotonic())
    started = time.perf_counter()
    try:
        result = handler.dispatch(method, params or {})
        elapsed = time.perf_counter() - started
        rpc_logger.info(
            "[rpc.ok] id=%s method=%s elapsed=%.2fs result=%s",
            req_id,
            method,
            elapsed,
            _dump_for_log(result),
        )
        # DEBUG: stdout 쓰기 전후 stderr 로그 (빌드 hang 디버깅)
        print(f"[sidecar] RPC 응답 전송: id={req_id} method={method} ({elapsed:.1f}s)", file=sys.stderr, flush=True)
        nbytes = send_response(req_id, result)
        print(f"[sidecar] RPC 응답 완료: id={req_id} size={nbytes}B", file=sys.stderr, flush=True)
    except Exception as e:
        rpc_logger.exception(
            "[rpc.err] id=%s method=%s elapsed=%.2fs error=%s",
            req_id,
            method,
            time.perf_counter() - started,
            e,
        )
        send_error(req_id, -32000, str(e))
    finally:
        with _workers_lock:
            _active_workers.pop(req_id, None)


def send_response(req_id, result):
    """Send JSON-RPC response to stdout (thread-safe). Returns bytes written."""
    response = {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": result,
    }
    return _write_json(response)


def send_error(req_id, code, message):
    """Send JSON-RPC error to stdout (thread-safe). Returns bytes written."""
    response = {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    }
    return _write_json(response)


def send_notification(method, params):
    """Send JSON-RPC notification (no id) to stdout (thread-safe). Returns bytes written."""
    notification = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    }
    return _write_json(notification)


def _write_json(obj):
    """Thread-safe JSON write to stdout via direct OS write.

    os.write(1, ...) bypasses ALL Python IO buffering (TextIOWrapper, BufferedWriter).
    On Windows + PyInstaller, sys.stdout.buffer.write()/flush()가 Playwright node.js의
    파이프 핸들 상속과 맞물려 Rust reader에 도달하지 못하는 문제를 우회합니다.
    """
    try:
        line = json.dumps(obj, ensure_ascii=False, default=str) + "\n"
    except (TypeError, ValueError) as e:
        line = json.dumps({"jsonrpc": "2.0", "id": obj.get("id") if isinstance(obj, dict) else None,
                           "error": {"code": -32603, "message": f"직렬화 실패: {e}"}},
                          ensure_ascii=False) + "\n"
    raw = line.encode("utf-8")
    with _stdout_lock:
        try:
            written = 0
            while written < len(raw):
                n = os.write(1, raw[written:])
                if n <= 0:
                    return 0
                written += n
        except OSError:
            return 0  # stdout 닫힘 (부모 프로세스 종료) — 조용히 무시
    return len(raw)


if __name__ == "__main__":
    main()
