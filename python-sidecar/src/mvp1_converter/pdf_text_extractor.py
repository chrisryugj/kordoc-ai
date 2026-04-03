"""PDF 텍스트+표 직접 추출 (API 불필요).

PyMuPDF의 find_tables() + get_text()로 표 구조를 살려서 마크다운 변환.
텍스트 기반 PDF는 이것만으로 충분하며, 스캔 이미지 PDF만 OCR 폴백 필요.
"""

import re
import logging
from pathlib import Path

import fitz

from src.shared.result import Result

logger = logging.getLogger("mvp")

# 페이지에서 추출된 텍스트가 이 글자수 미만이면 "이미지 기반"으로 판단
TEXT_THRESHOLD = 50

# 페이지 번호 패턴: "- 1 -", "- 006 -", "— 83 —" 등
_PAGE_NUM_RE = re.compile(r'^[-–—]\s*\d{1,3}\s*[-–—]$')


def _format_page_list(page_nums: list[int], limit: int = 8) -> str:
    if not page_nums:
        return ""
    preview = [f"p.{num}" for num in page_nums[:limit]]
    if len(page_nums) > limit:
        preview.append(f"외 {len(page_nums) - limit}페이지")
    return ", ".join(preview)


def extract_all_pdfs(
    selected_files: list[str],
    output_dir: str,
    cancel_event=None,
    progress_callback=None,
) -> tuple[Result, list[str]]:
    """PDF에서 텍스트+표를 직접 추출. 이미지 기반 페이지가 많은 파일은 OCR 대상으로 반환.

    Returns:
        (result, ocr_needed_files): 추출 결과 + OCR이 필요한 PDF 경로 리스트
    """
    result = Result()
    ocr_needed = []
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pdf_files = sorted(Path(f) for f in selected_files if f.lower().endswith(".pdf"))
    if not pdf_files:
        return result, ocr_needed

    logger.info(f"  {len(pdf_files)}개 PDF 텍스트 직접 추출 시도")

    for idx, pdf_path in enumerate(pdf_files):
        if cancel_event and cancel_event.is_set():
            logger.warning("사용자에 의해 취소됨")
            break

        filename = pdf_path.name
        if progress_callback:
            progress_callback(idx, len(pdf_files), f"PDF 분석: {filename}")

        try:
            doc = fitz.open(str(pdf_path))
        except Exception as e:
            result.add_failure(filename, f"PDF 열기 실패: {e}")
            logger.error(f"  FAIL: {filename} — {e}")
            continue

        try:
            total_pages = len(doc)
            text_pages = 0
            sparse_text_pages: list[int] = []
            empty_pages: list[int] = []
            page_texts = []

            for page_num in range(total_pages):
                if cancel_event and cancel_event.is_set():
                    break

                page = doc[page_num]
                page_md = _extract_page(page, page_num + 1)
                stripped = page_md.strip()

                if len(stripped) >= TEXT_THRESHOLD:
                    text_pages += 1
                elif stripped and "내용 없음" not in stripped:
                    sparse_text_pages.append(page_num + 1)
                else:
                    empty_pages.append(page_num + 1)

                page_texts.append(page_md)
        finally:
            doc.close()

        # H-1: 취소 시 partial 카운트로 OCR 필요 여부를 잘못 판단하지 않도록
        if cancel_event and cancel_event.is_set():
            result.add_failure(filename, "취소됨")
            continue

        # 텍스트 추출률 판단
        text_ratio = text_pages / total_pages if total_pages > 0 else 0

        if text_ratio < 0.3:
            # 30% 미만 텍스트 → OCR 필요
            logger.info(f"  {filename}: 텍스트 {text_ratio:.0%} — OCR 필요")
            ocr_needed.append(str(pdf_path))
            continue

        # 텍스트 추출 성공
        final_content = "\n\n---\n\n".join(page_texts)
        save_path = out_dir / f"{pdf_path.stem}.md"
        save_path.write_text(final_content, encoding="utf-8")

        total_chars = len(final_content)
        result.add_success(filename, f"{total_pages}p, {total_chars:,}자, 텍스트 {text_ratio:.0%}")
        logger.info(f"  OK: {filename} → {save_path.name} ({total_pages}p, {total_chars:,}자, 텍스트 {text_ratio:.0%})")

        if sparse_text_pages:
            result.warnings.append(
                f"{filename}: 직접 추출 텍스트가 적은 페이지 {len(sparse_text_pages)}개 "
                f"({_format_page_list(sparse_text_pages)})"
            )
        if empty_pages:
            result.warnings.append(
                f"{filename}: 직접 추출 결과가 비어 있는 페이지 {len(empty_pages)}개 "
                f"({_format_page_list(empty_pages)})"
            )

    if progress_callback:
        progress_callback(len(pdf_files), len(pdf_files), "PDF 텍스트 추출 완료")

    result.output_path = output_dir
    return result, ocr_needed


def _extract_page(page, page_num: int) -> str:
    """단일 페이지에서 표+텍스트를 마크다운으로 추출."""
    parts = []

    # 1) 표 추출
    try:
        table_finder = page.find_tables()
        tables = table_finder.tables
    except Exception:
        tables = []

    table_rects = set()
    for table in tables:
        try:
            # 표 영역 기록 (나중에 일반 텍스트에서 제외)
            table_rects.add(tuple(table.bbox))
            md_table = _table_to_markdown(table)
            if md_table:
                parts.append(md_table)
        except Exception:
            continue

    # 2) 표 외 일반 텍스트
    text = page.get_text().strip()
    if text:
        # 표 영역 텍스트 중복 제거: 표가 있으면 get_text()에도 같은 내용이 포함됨
        # 완벽한 중복 제거는 어렵지만, 표가 추출됐으면 일반 텍스트도 같이 넣되
        # 사용자가 둘 다 볼 수 있게 함
        if not tables:
            parts.append(_clean_extracted_text(text))
        else:
            # 표가 있는 페이지: 표를 제외한 나머지 텍스트만 추가
            non_table_text = _get_non_table_text(page, table_rects)
            if non_table_text.strip():
                parts.append(_clean_extracted_text(non_table_text.strip()))

    if not parts:
        return f"(p.{page_num}: 내용 없음)"

    return "\n\n".join(parts)


def _table_to_markdown(table) -> str:
    """PyMuPDF Table → 마크다운 테이블."""
    try:
        rows = table.extract()
    except Exception:
        return ""

    if not rows:
        return ""

    # 셀 정리: None → 빈 문자열, 줄바꿈 → 공백
    cleaned = []
    for row in rows:
        cleaned.append([
            str(cell).replace("\n", " ").strip() if cell is not None else ""
            for cell in row
        ])

    if not cleaned:
        return ""

    # 모든 셀이 비어있는 표 제거 (이미지/배치도 영역이 빈 표로 추출되는 경우)
    all_empty = all(
        not cell.strip()
        for row in cleaned for cell in row
    )
    if all_empty:
        return ""

    # 마크다운 테이블 생성
    col_count = max(len(row) for row in cleaned)

    # 모든 행을 같은 열 수로 맞춤
    for row in cleaned:
        while len(row) < col_count:
            row.append("")

    lines = []
    # 헤더
    header = cleaned[0]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * col_count) + " |")
    # 데이터 행
    for row in cleaned[1:]:
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines)


def _clean_extracted_text(text: str) -> str:
    """직접 추출된 텍스트에서 페이지 번호 제거."""
    lines = text.splitlines()
    cleaned = [ln for ln in lines if not _PAGE_NUM_RE.match(ln.strip())]
    return "\n".join(cleaned).strip()


def _get_non_table_text(page, table_rects: set) -> str:
    """표 영역을 제외한 텍스트 블록만 추출."""
    blocks = page.get_text("blocks")  # (x0, y0, x1, y1, text, block_no, block_type)
    non_table_parts = []

    for block in blocks:
        if block[6] != 0:  # 텍스트 블록만 (0=text, 1=image)
            continue
        bx0, by0, bx1, by1 = block[:4]
        text = block[4].strip()
        if not text:
            continue

        # 이 블록이 표 영역 안에 있는지 체크
        in_table = False
        for (tx0, ty0, tx1, ty1) in table_rects:
            # 블록 중심이 표 영역 안에 있으면 표 텍스트로 간주
            cx = (bx0 + bx1) / 2
            cy = (by0 + by1) / 2
            if tx0 <= cx <= tx1 and ty0 <= cy <= ty1:
                in_table = True
                break

        if not in_table:
            non_table_parts.append(text)

    return "\n".join(non_table_parts)
