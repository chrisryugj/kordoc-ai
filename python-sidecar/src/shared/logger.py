"""파일 + 콘솔 듀얼 로깅 설정."""

import logging
import sys
from pathlib import Path
from datetime import datetime


def setup_logger(name: str = "mvp", log_dir: str = None) -> logging.Logger:
    """로거를 생성합니다. 콘솔과 파일에 동시 출력합니다.

    Args:
        name: 로거 이름
        log_dir: 로그 파일 저장 디렉토리. None이면 현재 디렉토리의 logs/

    Returns:
        설정된 Logger 인스턴스
    """
    logger = logging.getLogger(name)

    # 이미 핸들러가 있으면 중복 추가 방지
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S"
    )

    # 콘솔 핸들러 (stderr: sidecar에서 stdout은 JSON-RPC 전용)
    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(formatter)
    logger.addHandler(console)

    # 파일 핸들러
    if log_dir is None:
        if getattr(sys, "frozen", False):
            log_dir = Path.home() / ".eduplan-ai" / "logs"
        else:
            log_dir = Path.cwd() / "logs"
    else:
        log_dir = Path(log_dir)

    log_dir.mkdir(parents=True, exist_ok=True)

    # 오래된 로그 파일 정리 (최대 20개 유지)
    max_log_files = 20
    existing = sorted(log_dir.glob(f"{name}_*.log"))
    if len(existing) >= max_log_files:
        for old_log in existing[:len(existing) - max_log_files + 1]:
            try:
                old_log.unlink()
            except OSError:
                pass

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"{name}_{timestamp}.log"

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    logger.info(f"로그 파일: {log_file}")
    return logger
