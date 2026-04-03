"""PDF → 텍스트 직접 추출 (AI 없음).

pypdf를 사용하여 PDF에서 텍스트를 직접 추출합니다.
이미지 기반 PDF(스캔본)에는 적합하지 않습니다.
"""

import re
import logging
from pathlib import Path

from pypdf import PdfReader

from src.shared.result import Result

logger = logging.getLogger("mvp")


def _clean_extracted_text(text: str) -> str:
    """추출된 텍스트를 정리합니다."""
    # 과도한 공백 정리
    text = re.sub(r" {3,}", "  ", text)
    # 빈 줄 3개 이상 → 2개로
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    # 줄 끝 공백 제거
    text = re.sub(r" +\n", "\n", text)
    return text.strip()


def _format_as_markdown(pages_text: list[tuple[int, str]]) -> str:
    """페이지별 텍스트를 마크다운으로 포맷합니다."""
    parts = []
    for page_num, text in pages_text:
        parts.append(f"[[PAGE: {page_num}]]\n\n{text}")
    return "\n\n---\n\n".join(parts)


def extract_text_from_pdf(pdf_path: Path) -> tuple[str, int]:
    """PDF에서 텍스트를 직접 추출합니다.

    Returns:
        (추출된 텍스트, 페이지 수)
    """
    reader = PdfReader(str(pdf_path))
    pages_text = []

    for i, page in enumerate(reader.pages, 1):
        raw = page.extract_text() or ""
        cleaned = _clean_extracted_text(raw)
        if cleaned:
            pages_text.append((i, cleaned))
        else:
            pages_text.append((i, "(텍스트 없음 - 이미지 기반 페이지일 수 있습니다)"))

    return _format_as_markdown(pages_text), len(reader.pages)


def process_all_pdfs_text(config: dict = None, cancel_event=None,
                          progress_callback=None) -> Result:
    """모든 PDF를 텍스트 추출 방식으로 처리합니다 (AI 없음).

    Returns:
        Result 객체
    """
    if config is None:
        from src.shared.config import get_config
        config = get_config("mvp1")

    base_dir = Path(config["target_dir"])
    result = Result()

    # 선택된 파일이 있으면 그것만 처리, 없으면 폴더 스캔
    selected = config.get("selected_files", [])
    if selected:
        pdf_files = sorted(
            Path(f) for f in selected if Path(f).suffix.lower() == ".pdf")
        non_pdf = [Path(f).name for f in selected
                   if Path(f).suffix.lower() not in (".pdf",)]
        if non_pdf:
            for name in non_pdf:
                ext = Path(name).suffix or "(확장자 없음)"
                logger.warning(f"지원하지 않는 파일 형식: {name} ({ext})")
                result.warnings.append(f"미지원 형식 건너뜀: {name}")
    else:
        pdf_files = sorted(base_dir.glob("*.pdf"))

    if not pdf_files:
        if selected:
            logger.error("선택된 파일 중 처리 가능한 PDF가 없습니다.")
        else:
            logger.error(f"처리할 PDF 파일이 없습니다: {base_dir}")
        return result

    logger.info(f"총 {len(pdf_files)}개 PDF 파일 발견. 텍스트 추출을 시작합니다.")
    logger.info("(AI 미사용 - pypdf 텍스트 추출)")

    for file_idx, pdf_path in enumerate(pdf_files, 1):
        if cancel_event and cancel_event.is_set():
            logger.warning("사용자에 의해 취소됨")
            break

        logger.info(f"\n{'=' * 50}")
        logger.info(f"[{file_idx}/{len(pdf_files)}] {pdf_path.name}")
        if progress_callback:
            progress_callback(file_idx - 1, len(pdf_files), f"텍스트 추출: {pdf_path.name}")

        try:
            text, total_pages = extract_text_from_pdf(pdf_path)

            save_path = base_dir / f"{pdf_path.stem}.md"
            save_path.write_text(text, encoding="utf-8")

            result.add_success(pdf_path.name, f"{total_pages}페이지 텍스트 추출 완료")
            logger.info(f"  완료! → {save_path.name} ({total_pages}p, {len(text)}자)")

        except Exception as e:
            result.add_failure(pdf_path.name, str(e))
            logger.error(f"  실패: {e}")

    if progress_callback:
        progress_callback(len(pdf_files), len(pdf_files), "텍스트 추출 완료")
    result.output_path = str(base_dir)
    return result
