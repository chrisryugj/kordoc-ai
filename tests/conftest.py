"""pytest 공통 설정.

프로젝트 루트를 sys.path에 추가하고 작업 디렉토리를 설정합니다.
"""

import sys
import os
from pathlib import Path

import pytest

# Windows cp949 콘솔에서 Unicode 특수문자(—, ✗ 등) 출력 에러 방지
if sys.stdout.encoding and sys.stdout.encoding.lower() in ("cp949", "euc-kr", "mbcs"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr.encoding and sys.stderr.encoding.lower() in ("cp949", "euc-kr", "mbcs"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
SIDECAR = ROOT / "python-sidecar"

# 프로젝트 루트를 모듈 검색 경로에 추가
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
# python-sidecar/ — sidecar 내부 모듈(shared, mvp1_converter 등)의 테스트 지원
if str(SIDECAR) not in sys.path:
    sys.path.insert(0, str(SIDECAR))


@pytest.fixture(autouse=True)
def _chdir_to_root(monkeypatch):
    """모든 테스트에서 작업 디렉토리를 프로젝트 루트로 설정합니다."""
    monkeypatch.chdir(ROOT)


@pytest.fixture
def test_data():
    """테스트 데이터 디렉토리 경로를 반환합니다."""
    return ROOT / "tests" / "test_data"


@pytest.fixture
def test_logs(tmp_path):
    """임시 로그 디렉토리를 반환합니다."""
    return tmp_path / "logs"
