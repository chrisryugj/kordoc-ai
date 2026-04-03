"""MVP 1 파이프라인: 문서 → 텍스트 변환.

흐름:
  1. HWPX → 직접 텍스트 추출 (COM 불필요, zip XML 파싱)
  2. HWP → 텍스트 직접 추출 (pyhwpx COM, PDF 변환/OCR 불필요)
  3. PDF → Gemini Vision OCR

모든 출력은 {원본폴더}/_output/ 하위에 저장하여 원본과 분리.
"""

import logging
from pathlib import Path
from src.shared.config import get_config
from src.shared.result import Result

logger = logging.getLogger("mvp")

OUTPUT_DIR_NAME = "_output"


def run(config: dict = None, cancel_event=None,
        progress_callback=None) -> Result:
    """MVP 1 전체 파이프라인을 실행합니다."""
    if config is None:
        config = get_config("mvp1")

    target_dir = config.get("target_dir", "")
    selected_files = config.get("selected_files", [])
    final_result = Result()

    # 출력 디렉토리: 사용자 지정 > 원본 폴더/_output/
    custom_output = config.get("output_dir", "")
    if not custom_output and not target_dir:
        raise ValueError("target_dir 또는 output_dir이 설정되어야 합니다")
    if custom_output:
        output_dir = Path(custom_output)
    else:
        output_dir = Path(target_dir) / OUTPUT_DIR_NAME
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info("=" * 50)
    logger.info("MVP 1: 문서 → AI 친화적 텍스트 변환")
    logger.info(f"  출력: {output_dir}")
    logger.info("=" * 50)

    # 파일 분류
    hwpx_files = [f for f in selected_files if f.lower().endswith(".hwpx")]
    hwp_files = [f for f in selected_files if f.lower().endswith(".hwp")]
    pdf_files = [f for f in selected_files if f.lower().endswith(".pdf")]

    logger.info(f"  입력: HWPX {len(hwpx_files)}개, HWP {len(hwp_files)}개, PDF {len(pdf_files)}개")

    # === Step 1: HWPX → 직접 텍스트 추출 ===
    step_hwpx = Result()
    if hwpx_files:
        logger.info("\n[Step 1a] HWPX → 텍스트 직접 추출")
        from .hwpx_parser import convert_all_hwpx_to_text
        step_hwpx = convert_all_hwpx_to_text(
            target_dir=str(output_dir),
            selected_files=hwpx_files,
            cancel_event=cancel_event,
            progress_callback=progress_callback,
        )
        # warnings는 _merge_results에서 통합

    if cancel_event and cancel_event.is_set():
        return _merge_results(final_result, step_hwpx, Result(), Result())

    # === Step 2: HWP → 텍스트 직접 추출 ===
    step_hwp = Result()
    if hwp_files:
        logger.info("\n[Step 1b] HWP → 텍스트 직접 추출 (한컴오피스 COM)")
        from .hwp_to_pdf import convert_all_hwp_to_text
        step_hwp = convert_all_hwp_to_text(
            target_dir=str(output_dir),
            selected_files=hwp_files,
            cancel_event=cancel_event,
            progress_callback=progress_callback,
        )
        # warnings는 _merge_results에서 통합

    if cancel_event and cancel_event.is_set():
        return _merge_results(final_result, step_hwpx, step_hwp, Result())

    # === Step 3: PDF → 텍스트+표 직접 추출 (우선) → OCR (폴백) ===
    step_pdf = Result()
    if pdf_files:
        logger.info(f"\n[Step 2] PDF → 텍스트+표 직접 추출 ({len(pdf_files)}개 파일)")
        from .pdf_text_extractor import extract_all_pdfs
        step_text, ocr_needed = extract_all_pdfs(
            selected_files=pdf_files,
            output_dir=str(output_dir),
            cancel_event=cancel_event,
            progress_callback=progress_callback,
        )
        step_pdf = step_text

        # 텍스트 추출 불가 (이미지 기반) → OCR 폴백
        if ocr_needed and not (cancel_event and cancel_event.is_set()):
            logger.info(f"\n[Step 2b] 이미지 기반 PDF → Vision OCR ({len(ocr_needed)}개)")
            from .ocr_engine import process_all_pdfs
            ocr_config = dict(config)
            ocr_config["selected_files"] = ocr_needed
            ocr_config["output_dir"] = str(output_dir)
            step_ocr = process_all_pdfs(
                ocr_config, cancel_event=cancel_event, progress_callback=progress_callback,
            )
            step_pdf = _merge_results(step_pdf, step_ocr)

    elif not hwpx_files and not hwp_files:
        msg = "처리할 문서가 없습니다. PDF, HWP, 또는 HWPX 파일을 선택하세요."
        logger.error(msg)
        raise RuntimeError(msg)
    else:
        logger.info("\n[Step 2] PDF 없음 — 건너뜀")

    # === 결과 합산 ===
    merged = _merge_results(final_result, step_hwpx, step_hwp, step_pdf)
    merged.output_path = str(output_dir)

    logger.info("\n" + merged.summary())
    return merged


def _merge_results(base: Result, *others: Result) -> Result:
    for r in others:
        base.total += r.total
        base.success_count += r.success_count
        base.fail_count += r.fail_count
        base.steps.extend(r.steps)
        base.warnings.extend(r.warnings)
    return base
