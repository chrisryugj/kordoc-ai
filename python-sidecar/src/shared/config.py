"""YAML 설정 파일 로더 (LRU 캐싱)."""

import sys
import copy
import yaml
from pathlib import Path
from functools import lru_cache
from typing import Dict, Any


def _find_config_dir() -> Path:
    """config 디렉토리를 찾습니다.
    exe 빌드 시에도 동작하도록 여러 경로를 시도합니다.
    """
    candidates = [
        Path(__file__).parent.parent.parent / "config",  # src/../config (소스 실행)
    ]
    # PyInstaller --onefile: 번들 데이터는 _MEIPASS 임시 폴더에 추출됨
    meipass_config = None
    if getattr(sys, "_MEIPASS", None):
        meipass_config = Path(sys._MEIPASS) / "config"
        candidates.insert(0, meipass_config)
    # frozen 환경: 사용자 홈 디렉토리에 설정 저장 (Program Files 쓰기 불가 대응)
    if getattr(sys, "frozen", False):
        user_config = Path.home() / ".eduplan-ai" / "config"
        user_config.mkdir(parents=True, exist_ok=True)
        # 번들 내 기본 settings.yaml이 있고 유저 config에 없으면 복사
        if meipass_config and (meipass_config / "settings.yaml").exists():
            if not (user_config / "settings.yaml").exists():
                try:
                    import shutil
                    shutil.copy2(
                        str(meipass_config / "settings.yaml"),
                        str(user_config / "settings.yaml"),
                    )
                except Exception:
                    pass
        # exe 옆 config/에서 마이그레이션
        legacy_config = Path(sys.executable).parent / "config"
        if (legacy_config / "settings.yaml").exists() and not (user_config / "settings.yaml").exists():
            try:
                import shutil
                shutil.copy2(
                    str(legacy_config / "settings.yaml"),
                    str(user_config / "settings.yaml"),
                )
            except Exception:
                pass
        return user_config

    candidates.append(Path.cwd() / "config")  # 현재 디렉토리 (fallback)

    for p in candidates:
        if (p / "settings.yaml").exists():
            return p

    # 못 찾으면 현재 디렉토리에 생성
    default = Path.cwd() / "config"
    default.mkdir(parents=True, exist_ok=True)
    return default


@lru_cache(maxsize=10)
def load_config(filename: str) -> Dict[str, Any]:
    """YAML 설정 파일을 로드합니다 (캐싱됨).

    Args:
        filename: 설정 파일명 (예: 'settings.yaml')

    Returns:
        파싱된 YAML 딕셔너리
    """
    config_dir = _find_config_dir()
    filepath = (config_dir / filename).resolve()
    # 경로 순회 방지: config 디렉토리 내부만 허용
    if not filepath.is_relative_to(config_dir.resolve()):
        raise ValueError(f"잘못된 설정 파일 경로: {filename}")
    if not filepath.exists():
        return {}

    with open(filepath, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def reload_config():
    """LRU 캐시를 무효화하여 다음 호출에서 파일을 다시 읽도록 합니다."""
    load_config.cache_clear()


def get_config(section: str = None, filename: str = "settings.yaml") -> Dict[str, Any]:
    """설정의 특정 섹션을 반환합니다.

    Args:
        section: 섹션명 (예: 'mvp1'). None이면 전체 반환
        filename: 설정 파일명

    Returns:
        설정 딕셔너리
    """
    config = load_config(filename)
    if section:
        return copy.deepcopy(config.get(section, {}))
    return copy.deepcopy(config)
