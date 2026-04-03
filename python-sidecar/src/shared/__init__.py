from pathlib import Path

from .result import Result, StepResult
from .config import load_config, get_config
from .env_loader import ensure_api_key
from .logger import setup_logger


def read_text_file(file_path: Path) -> str:
    """텍스트 파일을 읽습니다 (UTF-8 → CP949 → latin-1 폴백)."""
    try:
        return file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return file_path.read_text(encoding="cp949")
        except UnicodeDecodeError:
            return file_path.read_text(encoding="latin-1")
