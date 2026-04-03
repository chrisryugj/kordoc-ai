"""HWP 처리 모듈.

- convert_all_hwp_to_text: HWP → 텍스트 직접 추출 (COM, PDF 변환/OCR 불필요)
- convert_all_hwp_to_pdf: HWP → PDF 변환 (폴백용, 레거시)
"""

import glob
import os
import tempfile
import logging
from pathlib import Path

from src.shared.result import Result

logger = logging.getLogger("mvp")


def _com_initialize() -> bool:
    """ThreadPoolExecutor 워커 스레드에서 COM STA를 초기화합니다.

    pyhwpx.Hwp는 COM STA 객체로, 생성 전 CoInitialize()가 필요합니다.
    미초기화 시 스레드 간 COM 아파트먼트 불일치로 데이터 손상 또는
    간헐적 크래시가 발생할 수 있습니다.

    Returns:
        True if CoInitialize() 성공, False otherwise (CoUninitialize 스킵).
    """
    try:
        import pythoncom
        pythoncom.CoInitialize()
        return True
    except ImportError:
        return False  # pywin32 미설치: pyhwpx 자체 초기화에 의존
    except Exception as e:
        logger.warning(f"  COM 초기화 실패: {e}")
        return False


def _com_uninitialize():
    """CoInitialize()에 대응하는 CoUninitialize() 호출."""
    try:
        import pythoncom
        pythoncom.CoUninitialize()
    except Exception:
        pass


def convert_all_hwp_to_text(
    target_dir: str,
    selected_files: list = None,
    cancel_event=None,
    progress_callback=None,
) -> Result:
    """HWP 파일에서 텍스트를 직접 추출합니다 (PDF 변환/OCR 불필요).

    pyhwpx COM으로 열어서 TEXT 포맷으로 저장 → .md 파일 생성.
    """
    result = Result()

    if selected_files:
        all_files = [f for f in selected_files if f.lower().endswith(".hwp")]
    else:
        all_files = sorted(glob.glob(os.path.join(target_dir, "*.hwp")))

    if not all_files:
        return result

    try:
        from pyhwpx import Hwp
    except ImportError:
        msg = "pyhwpx가 설치되지 않았습니다. Windows + 한컴오피스 설치 환경에서만 동작합니다."
        logger.error(msg)
        result.warnings.append(f"[HWP 변환 불가] {msg}")
        return result

    logger.info(f"  {len(all_files)}개 HWP 파일 텍스트 직접 추출")

    # COM STA 초기화: ThreadPoolExecutor 워커 스레드는 CoInitialize 없이
    # STA COM 객체(pyhwpx.Hwp)를 안전하게 생성할 수 없다.
    com_initialized = _com_initialize()
    try:
        hwp = Hwp(visible=False)
        try:
            hwp.SetMessageBoxMode(0x00020000)
        except Exception:
            pass

        try:
            for idx, file_path in enumerate(all_files):
                if cancel_event and cancel_event.is_set():
                    logger.warning("사용자에 의해 취소됨")
                    break

                filename = os.path.basename(file_path)
                if progress_callback:
                    progress_callback(idx, len(all_files), f"HWP 텍스트 추출: {filename}")

                try:
                    hwp.open(file_path)

                    # TEXT 포맷으로 임시 파일에 저장 (고유 파일명으로 동시 실행 안전)
                    fd, tmp_path = tempfile.mkstemp(suffix=".txt", prefix="hwp_extract_")
                    os.close(fd)
                    try:
                        hwp.SaveAs(tmp_path, "TEXT")

                        if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
                            # 여러 인코딩 시도
                            text = None
                            for enc in ("utf-8", "cp949", "euc-kr"):
                                try:
                                    with open(tmp_path, encoding=enc) as tf:
                                        text = tf.read()
                                    break
                                except UnicodeDecodeError:
                                    continue

                            if text and text.strip():
                                # 폼피드(\x0c) → 페이지 구분자로 변환 (tagger가 페이지별 분류 가능)
                                if "\x0c" in text:
                                    pages = [p.strip() for p in text.split("\x0c")]
                                    text = "\n\n---\n\n".join(p for p in pages if p)
                                out_path = Path(target_dir) / (Path(file_path).stem + ".md")
                                out_path.write_text(text, encoding="utf-8")
                                result.add_success(filename)
                                logger.info(f"  OK: {filename} → {out_path.name} ({len(text):,}자)")
                            else:
                                result.add_failure(filename, "텍스트 없음")
                                logger.warning(f"  빈 문서: {filename}")
                        else:
                            result.add_failure(filename, "TEXT 저장 실패")
                            logger.error(f"  FAIL: {filename} — TEXT 저장 실패")
                    finally:
                        if os.path.exists(tmp_path):
                            os.remove(tmp_path)

                    # 문서 닫기
                    try:
                        hwp.clear()
                    except Exception:
                        pass

                except Exception as e:
                    result.add_failure(filename, str(e))
                    logger.error(f"  FAIL: {filename} — {e}")
                    try:
                        hwp.clear()
                    except Exception:
                        pass
        finally:
            try:
                hwp.quit()
            except Exception:
                logger.warning("  한컴오피스 프로세스 종료 실패")
    finally:
        if com_initialized:
            _com_uninitialize()

    if progress_callback:
        progress_callback(len(all_files), len(all_files), "HWP 추출 완료")

    result.output_path = target_dir
    return result


def convert_all_hwp_to_pdf(target_dir: str,
                           selected_files: list = None,
                           cancel_event=None) -> Result:
    """HWP 파일을 PDF로 변환합니다 (레거시/폴백용)."""
    result = Result()

    if not target_dir or not os.path.exists(target_dir):
        logger.error(f"유효하지 않은 경로: {target_dir}")
        return result

    if selected_files:
        all_files = [f for f in selected_files
                     if f.lower().endswith((".hwp", ".hwpx"))]
    else:
        hwp_files = glob.glob(os.path.join(target_dir, "*.hwp"))
        hwpx_files = glob.glob(os.path.join(target_dir, "*.hwpx"))
        all_files = hwp_files + hwpx_files

    if not all_files:
        logger.warning("변환할 한글 파일(.hwp, .hwpx)이 없습니다.")
        return result

    logger.info(f"{len(all_files)}개의 한글 파일 발견. 변환을 시작합니다.")

    try:
        from pyhwpx import Hwp
    except ImportError:
        msg = "pyhwpx가 설치되지 않았습니다. Windows + 한컴오피스 설치 환경에서만 동작합니다."
        logger.error(msg)
        result.warnings.append(f"[HWP 변환 불가] {msg}")
        return result

    com_initialized = _com_initialize()
    try:
        hwp = Hwp(visible=False)
        try:
            hwp.SetMessageBoxMode(0x00020000)
        except Exception:
            pass

        try:
            for file_path in all_files:
                if cancel_event and cancel_event.is_set():
                    logger.warning("사용자에 의해 취소됨")
                    break
                filename = os.path.basename(file_path)
                try:
                    hwp.open(file_path)
                    pdf_path = os.path.splitext(file_path)[0] + ".pdf"
                    hwp.save_as(pdf_path, format="PDF")
                    result.add_success(filename)
                    logger.info(f"  OK: {filename}")
                except Exception as e:
                    result.add_failure(filename, str(e))
                    logger.error(f"  FAIL: {filename} — {e}")
                    try:
                        hwp.clear()
                    except Exception:
                        pass
        finally:
            try:
                hwp.quit()
            except Exception:
                logger.warning("  한컴오피스 프로세스 종료 실패")
    finally:
        if com_initialized:
            _com_uninitialize()

    result.output_path = target_dir
    return result
