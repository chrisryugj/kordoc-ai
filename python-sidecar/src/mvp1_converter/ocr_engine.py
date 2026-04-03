"""PDF → 이미지 → Gemini Vision OCR 엔진.

langchain 없이 google-genai SDK를 직접 사용합니다.
PDF→이미지 변환: PyMuPDF(기본) / pdf2image+Poppler(폴백).
"""

import os
import time
import random
import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from typing import Dict, List

from google import genai
from google.genai import types

from src.shared.result import Result
from src.shared.config import get_config, load_config
from src.shared.env_loader import ensure_api_key
from .text_cleaner import clean_text

logger = logging.getLogger("mvp")


# ============================================================
# PDF → 이미지 변환 엔진 (PyMuPDF 기본, pdf2image+Poppler 폴백)
# ============================================================

def _convert_pdf_to_images_pymupdf(pdf_path: Path, dpi: int,
                                    first_page: int = None,
                                    last_page: int = None) -> List:
    """PyMuPDF(fitz)로 PDF를 PIL Image 리스트로 변환합니다."""
    import fitz
    from PIL import Image
    import io

    doc = fitz.open(str(pdf_path))
    try:
        images = []
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)

        start = (first_page or 1) - 1
        end = last_page or len(doc)

        for page_num in range(start, min(end, len(doc))):
            try:
                page = doc[page_num]
                pix = page.get_pixmap(matrix=matrix)
                try:
                    img_data = pix.tobytes("png")
                    img = Image.open(io.BytesIO(img_data))
                    images.append(img)
                finally:
                    pix = None  # Pixmap C 리소스 즉시 해제
            except Exception as e:
                # 손상된 페이지는 빈 이미지로 대체하여 전체 변환 실패 방지
                logger.warning(f"  페이지 {page_num + 1} 이미지 변환 실패: {e}")
                blank = Image.new("RGB", (int(612 * zoom), int(792 * zoom)), "white")
                images.append(blank)

        return images
    finally:
        doc.close()


def _convert_pdf_to_images_poppler(pdf_path: Path, dpi: int,
                                    poppler_path: str = None,
                                    first_page: int = None,
                                    last_page: int = None) -> List:
    """pdf2image+Poppler로 PDF를 PIL Image 리스트로 변환합니다 (폴백)."""
    try:
        from pdf2image import convert_from_path
    except ImportError:
        raise ImportError(
            "pdf2image 패키지가 설치되지 않았습니다. "
            "Poppler 엔진을 사용하려면: pip install pdf2image\n"
            "또는 settings.yaml에서 pdf_engine을 'pymupdf'로 변경하세요."
        )

    kwargs = {"dpi": dpi}
    if poppler_path:
        kwargs["poppler_path"] = poppler_path
    if first_page:
        kwargs["first_page"] = first_page
    if last_page:
        kwargs["last_page"] = last_page

    return convert_from_path(str(pdf_path), **kwargs)


def _get_pdf_page_count(pdf_path: Path) -> int:
    """PDF 페이지 수를 반환합니다 (PyMuPDF 우선, pypdf 폴백)."""
    try:
        import fitz
        doc = fitz.open(str(pdf_path))
        try:
            count = len(doc)
        finally:
            doc.close()
        return count
    except Exception:
        pass
    try:
        from pypdf import PdfReader
        return len(PdfReader(str(pdf_path)).pages)
    except Exception:
        return 0


import threading as _threading

_engine_lock = _threading.Lock()
_cached_engine: str = ""


def _detect_pdf_engine(config: dict) -> str:
    """사용 가능한 PDF 변환 엔진을 감지합니다 (결과 캐싱, 스레드 안전).

    Returns:
        'pymupdf' 또는 'poppler'
    """
    global _cached_engine

    # 설정에서 명시적 지정
    engine = config.get("pdf_engine", "auto")
    if engine in ("pymupdf", "poppler"):
        return engine

    # 캐싱된 결과 반환 (lock 없이 읽기 — 문자열 할당은 원자적)
    if _cached_engine:
        return _cached_engine

    with _engine_lock:
        # Double-check: 다른 스레드가 이미 설정했을 수 있음
        if _cached_engine:
            return _cached_engine

        # auto: PyMuPDF 우선
        try:
            import fitz  # noqa: F401
            _cached_engine = "pymupdf"
            return _cached_engine
        except ImportError:
            pass

        # Poppler 폴백
        try:
            from pdf2image import convert_from_path  # noqa: F401
            _cached_engine = "poppler"
            return _cached_engine
        except ImportError:
            pass

    raise ImportError(
        "PDF 변환 라이브러리가 없습니다. "
        "PyMuPDF(권장: pip install PyMuPDF) 또는 "
        "pdf2image+Poppler를 설치해 주세요."
    )


def convert_pdf_to_images(pdf_path: Path, dpi: int, config: dict,
                           first_page: int = None,
                           last_page: int = None) -> List:
    """PDF를 이미지 리스트로 변환합니다 (엔진 자동 선택)."""
    engine = _detect_pdf_engine(config)

    if engine == "pymupdf":
        return _convert_pdf_to_images_pymupdf(
            pdf_path, dpi, first_page, last_page)
    else:
        poppler_path = config.get("poppler_path")
        return _convert_pdf_to_images_poppler(
            pdf_path, dpi, poppler_path, first_page, last_page)


# ============================================================
# Gemini OCR
# ============================================================

def _get_client(config: dict):
    """Gemini Client + 모델/생성 설정을 반환합니다."""
    api_key = ensure_api_key()
    # timeout은 SDK 기본값 사용 — http_options timeout(ms)을 짧게 잡으면
    # 응답 대기 중 끊김 발생. 에러는 _analyze_page 재시도 로직에서 처리.
    client = genai.Client(api_key=api_key)
    model_name = config.get("model_name", "gemini-3-flash-preview")
    gen_config = types.GenerateContentConfig(
        temperature=config.get("temperature", 0.0),
    )
    return client, model_name, gen_config


def _get_ocr_prompt() -> str:
    try:
        rules = load_config("ocr-rules.yaml")
        return rules.get("prompt", "이미지 속의 모든 정보를 마크다운으로 변환해.")
    except FileNotFoundError:
        return "이미지 속의 모든 정보를 마크다운으로 변환해."


def _analyze_page(client, model_name: str, gen_config, img_path: Path,
                   page_num: int, config: dict,
                   cancel_event=None, prompt_text: str = None) -> str:
    """한 페이지를 OCR 분석합니다. 재시도 로직 포함."""
    if prompt_text is None:
        prompt_text = _get_ocr_prompt()

    with open(img_path, "rb") as f:
        image_data = f.read()

    max_retries = config.get("max_retries", 5)
    base_delay = config.get("base_delay", 10)

    for attempt in range(max_retries):
        if cancel_event and cancel_event.is_set():
            return f"\n> **[Page {page_num} 취소됨]**\n"

        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[prompt_text, types.Part.from_bytes(data=image_data, mime_type="image/png")],
                config=gen_config,
            )
            # 안전 필터 차단 확인
            candidate = response.candidates[0] if response.candidates else None
            content = getattr(candidate, 'content', None) if candidate else None
            if not candidate or not content or not content.parts:
                reason = "UNKNOWN"
                if candidate:
                    reason = getattr(candidate, 'finish_reason', reason)
                logger.warning(f"  [Page {page_num}] 안전 필터 차단 (사유: {reason})")
                return f"\n> **[Page {page_num} 안전 필터 차단]**\n"
            raw = response.text
            cleaned = clean_text(raw)
            logger.info(f"  [Page {page_num}] 추출 성공 ({len(cleaned)}자)")
            return cleaned

        except Exception as e:
            err_name = type(e).__name__
            # 재시도 가능한 에러 판별
            is_transient = any(kw in err_name.lower() or kw in str(e).lower()
                               for kw in ("resource", "quota", "429", "503",
                                          "unavailable", "deadline", "timeout"))
            if is_transient and attempt < max_retries - 1:
                wait_time = base_delay * (2 ** attempt) + random.uniform(0, 5)
                logger.warning(
                    f"  [Page {page_num}] API 오류({err_name}). "
                    f"{wait_time:.1f}초 후 재시도 ({attempt + 1}/{max_retries})"
                )
                # cancel_event.wait()로 취소 가능한 대기
                if cancel_event:
                    if cancel_event.wait(wait_time):
                        return f"\n> **[Page {page_num} 취소됨]**\n"
                else:
                    time.sleep(wait_time)
            else:
                logger.error(f"  [Page {page_num}] 오류: {e}")
                return f"\n> **[Page {page_num} 분석 실패: {err_name}]**\n"

    return f"\n> **[Page {page_num} 분석 실패: 최대 재시도 초과]**\n"


def _process_single_page(args) -> tuple:
    """개별 페이지 처리 함수 (스레드 풀에서 호출)."""
    idx, page_image, img_dir, txt_dir, client_info, config = args[:6]
    cancel_event = args[6] if len(args) > 6 else None
    prompt_text = args[7] if len(args) > 7 else None
    client, model_name, gen_config = client_info
    page_num = idx + 1

    if cancel_event and cancel_event.is_set():
        return (idx, f"(Page {page_num} 취소됨)", False)

    img_path = img_dir / f"{page_num:03d}.png"
    txt_path = txt_dir / f"{page_num:03d}.txt"

    # 이어하기: 이미 처리된 파일은 건너뜀
    if txt_path.exists() and txt_path.stat().st_size > 50:
        content = txt_path.read_text(encoding="utf-8")
        return (idx, content, True)

    try:
        page_image.save(img_path, "PNG")
        # 디스크에 저장 완료 후 픽셀 데이터 즉시 해제.
        # items 리스트가 전체 배치를 참조하는 동안 메모리를 점유하는 것을 방지.
        try:
            page_image.close()
        except Exception:
            pass
        raw_text = _analyze_page(client, model_name, gen_config, img_path,
                                    page_num, config, cancel_event, prompt_text)

        if cancel_event and cancel_event.is_set():
            return (idx, f"(Page {page_num} 취소됨)", False)

        formatted = f"[[PAGE: {page_num}]]\n\n{raw_text}"
        txt_path.write_text(formatted, encoding="utf-8")
        return (idx, formatted, True)

    except Exception as e:
        logger.error(f"  [Page {page_num}] 치명적 에러: {e}")
        return (idx, f"(Page {page_num} 에러: {e})", False)


# ============================================================
# 메인 파이프라인
# ============================================================

def process_all_pdfs(config: dict = None, cancel_event=None,
                     progress_callback=None) -> Result:
    """모든 PDF를 OCR 처리합니다."""
    if config is None:
        config = get_config("mvp1")

    base_dir = Path(config.get("output_dir") or config["target_dir"])
    chunk_size = config.get("chunk_size", 20)
    max_workers = config.get("max_workers", 3)
    dpi = config.get("dpi", 150)

    # PDF 변환 엔진 감지 및 로깅
    engine = _detect_pdf_engine(config)
    logger.info(f"PDF 변환 엔진: {engine}")

    result = Result()
    client, model_name, gen_config = _get_client(config)
    ocr_prompt = _get_ocr_prompt()

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
            raise RuntimeError("선택된 파일 중 처리 가능한 PDF가 없습니다.")
        else:
            raise RuntimeError(f"처리할 PDF 파일이 없습니다: {base_dir}")

    logger.info(f"총 {len(pdf_files)}개 PDF 파일 발견. 처리를 시작합니다.")

    for file_idx, pdf_path in enumerate(pdf_files, 1):
        if cancel_event and cancel_event.is_set():
            logger.warning("사용자에 의해 취소됨")
            break

        file_stem = pdf_path.stem
        logger.info(f"\n{'=' * 50}")
        logger.info(f"[{file_idx}/{len(pdf_files)}] {pdf_path.name}")
        if progress_callback:
            progress_callback(file_idx - 1, len(pdf_files),
                              f"[{file_idx}/{len(pdf_files)}] {pdf_path.name} 준비 중...")

        img_dir = base_dir / f"{file_stem}_img"
        txt_dir = base_dir / f"{file_stem}_txt"
        img_dir.mkdir(parents=True, exist_ok=True)
        txt_dir.mkdir(parents=True, exist_ok=True)

        # 페이지 수 파악
        total_pages = _get_pdf_page_count(pdf_path) or None
        logger.info(f"  페이지 수: {total_pages}")
        if progress_callback:
            progress_callback(file_idx - 1, len(pdf_files),
                              f"{pdf_path.name}: {total_pages or '?'}페이지 이미지 변환 중...")

        all_results: Dict[int, str] = {}

        if total_pages and total_pages > chunk_size:
            logger.info(f"  총 {total_pages}페이지 → {chunk_size}페이지씩 청크 처리")

            for start in range(1, total_pages + 1, chunk_size):
                if cancel_event and cancel_event.is_set():
                    logger.warning("사용자에 의해 취소됨 (청크 처리 중)")
                    break
                end = min(start + chunk_size - 1, total_pages)
                logger.info(f"  청크 {start}-{end} 변환 중...")
                if progress_callback:
                    progress_callback(start - 1, total_pages,
                                      f"{pdf_path.name}: p.{start}-{end} 이미지 변환 중...")

                try:
                    pages = convert_pdf_to_images(
                        pdf_path, dpi, config,
                        first_page=start, last_page=end,
                    )
                except Exception as e:
                    logger.error(f"  청크 {start}-{end} 변환 실패: {e}")
                    for i in range(start - 1, end):
                        all_results[i] = f"(Page {i + 1} 변환 실패)"
                    continue

                items = [
                    (start - 1 + i, page, img_dir, txt_dir,
                     (client, model_name, gen_config), config,
                     cancel_event, ocr_prompt)
                    for i, page in enumerate(pages)
                ]
                chunk_results = _parallel_process(items, max_workers, cancel_event, progress_callback)
                all_results.update(chunk_results)
                for p in pages:
                    try:
                        p.close()
                    except Exception:
                        pass
                del pages
        else:
            try:
                pages = convert_pdf_to_images(pdf_path, dpi, config)
                total_pages = len(pages)
                logger.info(f"  이미지 변환 완료: {total_pages}페이지")
                if progress_callback:
                    progress_callback(0, total_pages,
                                      f"{pdf_path.name}: 이미지 변환 완료, OCR 시작 ({total_pages}페이지)")
            except Exception as e:
                logger.error(f"  PDF 변환 실패: {e}")
                result.add_failure(pdf_path.name, str(e))
                continue

            items = [
                (i, page, img_dir, txt_dir,
                 (client, model_name, gen_config), config,
                 cancel_event, ocr_prompt)
                for i, page in enumerate(pages)
            ]
            all_results = _parallel_process(items, max_workers, cancel_event, progress_callback)
            for p in pages:
                try:
                    p.close()
                except Exception:
                    pass
            del pages

        # C-3: 취소된 경우 partial 결과로 .md 저장하지 않음
        if cancel_event and cancel_event.is_set():
            result.add_failure(pdf_path.name, "취소됨 — 부분 결과 저장 생략")
            continue

        if total_pages is None:
            total_pages = len(all_results)

        sorted_texts = [all_results.get(i, "") for i in range(total_pages)]
        final_content = "\n\n---\n\n".join(sorted_texts)

        save_path = base_dir / f"{file_stem}.md"
        save_path.write_text(final_content, encoding="utf-8")

        result.add_success(pdf_path.name, f"{total_pages}페이지 처리 완료")
        logger.info(f"  완료! → {save_path.name}")

    if progress_callback:
        progress_callback(len(pdf_files), len(pdf_files), "OCR 완료")
    result.output_path = str(base_dir)
    return result


def _parallel_process(items: list, max_workers: int,
                      cancel_event=None,
                      progress_callback=None) -> Dict[int, str]:
    """스레드 풀로 병렬 처리 후 결과를 딕셔너리로 반환."""
    results = {}
    total_items = len(items)
    done_count = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(_process_single_page, item): item[0]
            for item in items
        }
        while future_map:
            if cancel_event and cancel_event.is_set():
                for f in list(future_map):
                    if not f.cancel():
                        # 이미 실행 중인 Future — 완료 대기 (최대 15초)
                        try:
                            idx, text, success = f.result(timeout=15)
                            results[idx] = text
                        except Exception:
                            pass
                    del future_map[f]
                logger.warning("  병렬 처리 취소됨")
                break
            done, _ = wait(future_map, timeout=10, return_when=FIRST_COMPLETED)
            for future in done:
                try:
                    idx, text, success = future.result()
                    results[idx] = text
                    done_count += 1
                    if progress_callback:
                        progress_callback(
                            done_count, total_items,
                            f"페이지 {done_count}/{total_items} 완료"
                        )
                except Exception as e:
                    idx = future_map[future]
                    results[idx] = f"(처리 실패: {e})"
                    logger.error(f"  Future 에러: {e}")
                    done_count += 1
                finally:
                    del future_map[future]
    return results
