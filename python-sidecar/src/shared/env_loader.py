"""API 키 관리: 첫 실행 시 입력 → .env 자동 저장 → 이후 자동 로드."""

import os
import sys
import stat
from pathlib import Path


# google-generativeai SDK 기본 환경변수명
API_KEY_ENV = "GOOGLE_API_KEY"
# 하위 호환: 기존 사용자가 .env에 저장해둔 키 이름
_LEGACY_KEY_ENV = "GEMINI_API_KEY"


def _get_env_path() -> Path:
    """exe 실행 위치 기준 .env 파일 경로.

    PyInstaller로 빌드된 exe의 경우 사용자 홈 디렉토리를 사용합니다.
    (Program Files 등 읽기 전용 폴더에서도 안전하게 저장)
    개발 환경에서는 cwd → python-sidecar → 이 파일 기준 상위 순서로 탐색합니다.
    """
    if getattr(sys, "frozen", False):
        user_dir = Path.home() / ".eduplan-ai"
        user_dir.mkdir(parents=True, exist_ok=True)
        # 기존 exe 옆 .env가 있으면 마이그레이션
        legacy = Path(sys.executable).parent / ".env"
        user_env = user_dir / ".env"
        if legacy.exists() and not user_env.exists():
            try:
                import shutil
                shutil.copy2(str(legacy), str(user_env))
            except Exception:
                pass
        return user_env
    # 개발 환경: cwd, python-sidecar/, 이 파일 기준 상위 순서로 탐색
    candidates = [
        Path.cwd() / "python-sidecar" / ".env",
        Path(__file__).parent.parent.parent / ".env",  # src/shared/ → python-sidecar/
        Path.cwd() / ".env",
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]  # 없으면 cwd/.env (저장 위치)


def _load_env_file():
    """간단한 .env 파일 파서. python-dotenv 의존 없이 동작합니다."""
    env_path = _get_env_path()
    if not env_path.exists():
        return

    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ[key] = value


def _save_env_file(key: str, value: str):
    """키를 .env 파일에 저장합니다."""
    env_path = _get_env_path()
    lines = []

    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

    # 기존 키가 있으면 교체 (정확한 키 이름 매칭)
    found = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        line_key, _, _ = stripped.partition("=")
        if line_key.strip() == key:
            lines[i] = f'{key}={value}\n'
            found = True
            break

    if not found:
        lines.append(f'{key}={value}\n')

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)

    # 소유자만 읽기/쓰기 가능하도록 권한 설정 (API 키 보호)
    try:
        os.chmod(env_path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    # Windows: POSIX chmod는 NTFS ACL을 변경하지 않으므로 icacls로 보완
    # 현재 사용자만 접근 가능하도록 상속 제거 후 명시적 부여
    import platform, subprocess
    if platform.system() == "Windows":
        try:
            username = os.environ.get("USERNAME", "")
            if username:
                subprocess.run(
                    ["icacls", str(env_path), "/inheritance:r",
                     "/grant:r", f"{username}:(R,W)"],
                    check=False, capture_output=True,
                )
        except Exception:
            pass


def save_api_key(key: str):
    """API 키를 .env 파일에 저장합니다 (GUI에서 호출용)."""
    _save_env_file(API_KEY_ENV, key)
    os.environ[API_KEY_ENV] = key


def ensure_api_key() -> str:
    """API 키를 확보합니다. 없으면 사용자에게 입력받아 .env에 저장합니다.

    환경변수명은 GOOGLE_API_KEY로 통일합니다 (google-generativeai SDK 기본값).
    기존 GEMINI_API_KEY도 fallback으로 인식합니다.

    Returns:
        API 키 문자열

    Raises:
        ValueError: GUI 모드에서 API 키를 찾을 수 없을 때
    """
    _load_env_file()

    # GOOGLE_API_KEY 우선, GEMINI_API_KEY fallback
    value = os.environ.get(API_KEY_ENV) or os.environ.get(_LEGACY_KEY_ENV)
    if value:
        # 통일: GOOGLE_API_KEY로 환경변수 세팅
        os.environ[API_KEY_ENV] = value
        return value

    # GUI 모드인지 확인: PyInstaller exe 또는 stdin이 없으면 GUI
    # getattr(sys, "frozen", False): PyInstaller 빌드에서는 항상 True
    # → exe 배포 환경에서 CLI 분기가 실행되어 stdout을 오염시키는 것을 방지
    is_gui = getattr(sys, "frozen", False) or not sys.stdin or not sys.stdin.isatty()

    if is_gui:
        raise ValueError(
            "API 키가 설정되지 않았습니다. 설정 탭에서 Gemini API 키를 입력해 주세요."
        )

    # CLI 모드: 사용자에게 입력 요청 (stderr 사용 — stdout은 JSON-RPC 전용)
    import sys as _sys
    print(f"\n{'=' * 50}", file=_sys.stderr)
    print(f"  {API_KEY_ENV}가 설정되지 않았습니다.", file=_sys.stderr)
    print(f"  API 키를 입력해 주세요.", file=_sys.stderr)
    print(f"  (한 번만 입력하면 .env 파일에 자동 저장됩니다)", file=_sys.stderr)
    print(f"{'=' * 50}", file=_sys.stderr)

    max_attempts = 5
    for attempt in range(max_attempts):
        value = input(f"\n  {API_KEY_ENV}: ").strip()
        if value:
            break
        remaining = max_attempts - attempt - 1
        if remaining > 0:
            print(f"  키를 입력해 주세요. (남은 시도: {remaining}회)", file=_sys.stderr)
        else:
            raise ValueError("API 키가 입력되지 않았습니다. 프로그램을 종료합니다.")

    _save_env_file(API_KEY_ENV, value)
    os.environ[API_KEY_ENV] = value
    print(f"  .env 파일에 저장되었습니다.\n", file=_sys.stderr)
    return value
