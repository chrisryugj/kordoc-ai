"""전체 테스트 실행기.

사용법:
    pytest tests/ -v                     # 오프라인 테스트만 (기본)
    pytest tests/ -v -m online           # 온라인 테스트만
    pytest tests/ -v -m "not online"     # 오프라인만 (명시적)

    # 레거시 호환: 이전처럼 직접 실행도 가능
    python tests/test_all.py             # pytest를 자동 호출
    python tests/test_all.py --online    # 온라인 포함

오프라인 테스트:
    - shared 모듈 (Result, Config, Logger, EnvLoader)
    - 텍스트 정제 (clean_text)
    - MVP 2 전체 (페이지 추출 + 라벨링)
    - MVP 1 오프라인 (설정, 임포트, 정제)

온라인 테스트 (--online / -m online):
    - MVP 1 OCR (Gemini API 호출)
    - MVP 3 분석 (Gemini API 호출)
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def main():
    """레거시 호환: python tests/test_all.py 실행 시 pytest를 호출합니다."""
    online = "--online" in sys.argv

    # 테스트 데이터 생성
    print("=" * 60)
    print("  테스트 데이터 생성")
    print("=" * 60)
    data_result = subprocess.run(
        [sys.executable, str(ROOT / "tests" / "create_test_data.py")],
        cwd=str(ROOT),
    )
    if data_result.returncode != 0:
        print("  [ERROR] 테스트 데이터 생성 실패!")
        sys.exit(1)

    # pytest 실행
    cmd = [sys.executable, "-m", "pytest", "tests/", "-v", "--tb=short"]
    if not online:
        cmd.extend(["-m", "not online"])

    print(f"\n{'=' * 60}")
    print(f"  pytest 실행: {' '.join(cmd)}")
    print(f"{'=' * 60}\n")

    result = subprocess.run(cmd, cwd=str(ROOT))
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
