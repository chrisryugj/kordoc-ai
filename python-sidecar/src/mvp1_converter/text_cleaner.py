"""OCR 결과 텍스트 정제 모듈.

기존 clean_text V5 로직을 개선:
- YAML 규칙에서 설정 로드
- 페이지 번호, 코드블록 마커, 각주 이스케이프 후처리
"""

import re
from src.shared.config import load_config


def clean_text(text: str) -> str:
    """OCR 결과 텍스트를 정제합니다.

    - 표(Table) 구조 보존
    - 무의미한 구분선 제거
    - 중복 라인 제거
    - 페이지 번호 제거
    - 코드블록 마커 제거
    - 각주 이스케이프 정리
    """
    if not text:
        return ""

    # 설정 로드 (캐싱됨)
    try:
        rules = load_config("ocr-rules.yaml").get("cleaning", {})
    except FileNotFoundError:
        rules = {}

    max_spaces = rules.get("max_consecutive_spaces", 20)
    garbage_min = rules.get("garbage_line_min_length", 10)
    garbage_chars = rules.get("garbage_chars", r"[-=_*]")
    remove_dups = rules.get("remove_duplicates", True)

    # 코드블록 마커 제거 (```markdown, ``` 등)
    text = re.sub(r'^```(?:markdown|md)?\s*$', '', text, flags=re.MULTILINE)

    # HTML 태그 → 줄바꿈
    text = text.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")

    # 과도한 연속 공백 축소
    text = re.sub(rf'[ \t]{{{max_spaces},}}', ' ', text)

    lines = text.split('\n')
    cleaned = []
    prev_line = None

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # 페이지 번호 제거 (예: "- 1 -", "— 3 —", "- 10 -")
        if re.match(r'^[-–—]\s*\d{1,3}\s*[-–—]$', stripped):
            continue

        has_content = bool(re.search(r'[가-힣a-zA-Z0-9]', stripped))
        is_table_row = '|' in stripped
        is_long_garbage = (not is_table_row) and bool(
            re.match(rf'^{garbage_chars}{{{garbage_min},}}$', stripped)
        )

        # 무의미한 긴 구분선 제거
        if is_long_garbage:
            continue

        # 내용 없고 표도 아닌 특수문자 찌꺼기 제거
        if not has_content and not is_table_row:
            if not re.match(r'^[-=_*]{1,9}$', stripped):
                continue

        # 중복 라인 제거
        if remove_dups and stripped == prev_line:
            continue

        cleaned.append(stripped)
        prev_line = stripped

    result = '\n\n'.join(cleaned).strip()

    # 각주 이스케이프 정리: "\*" → "*" (마크다운 렌더링 시 불필요한 백슬래시)
    result = re.sub(r'\\(\*{1,2})', r'\1', result)

    return result
