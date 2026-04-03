"""MVP 2: PDF 페이지 발췌 + 테마별 라벨링.

기존 대비 개선:
- YAML 설정에서 모든 매핑 로드 (코드 수정 없이 재사용 가능)
- bare except → except Exception
- Result 객체로 추적
- 라벨 위치/크기 설정 가능
"""

import os
import io
import copy
import logging
from pathlib import Path
from typing import Dict, List, Set

import openpyxl
from openpyxl.utils import column_index_from_string
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from src.shared.result import Result
from src.shared.config import get_config

logger = logging.getLogger("mvp")


_DEFAULT_LABEL_CONFIG = {
    "enabled": True,
    "font_size": 10,
    "x": 20,
    "y": 20,
    "position": "bottom-left",
    "color": [0, 0, 0],
    "format": "{theme}",
}


# ============================================================
# 한글 폰트 등록
# ============================================================
def _register_korean_font() -> str:
    font_name = "MalgunGothic"
    font_paths = [
        r"C:\Windows\Fonts\malgun.ttf",
        r"C:\Windows\Fonts\gulim.ttc",
    ]
    for path in font_paths:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont(font_name, path))
                return font_name
            except Exception:
                continue
    logger.warning("한글 폰트를 찾을 수 없습니다. 라벨에 Helvetica가 사용됩니다.")
    return "Helvetica"


KOREAN_FONT = _register_korean_font()


# ============================================================
# 유틸리티
# ============================================================
def _parse_page_numbers(cell_value) -> Set[int]:
    """엑셀 셀 값을 페이지 번호 집합으로 파싱합니다."""
    if cell_value is None:
        return set()

    s = str(cell_value).strip().replace("\n", ",").replace(" ", "").replace(";", ",")
    if s in ("", "-"):
        return set()

    pages = set()
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            try:
                start_str, end_str = part.split("-", 1)
                start = int(float(start_str))
                end = int(float(end_str))
                pages.update(range(start, end + 1))
            except ValueError:
                logger.warning(f"  페이지 범위 파싱 실패: '{part}'")
        else:
            try:
                pages.add(int(float(part)))
            except ValueError:
                logger.warning(f"  페이지 번호 파싱 실패: '{part}'")

    return pages


_COLOR_MAP = {
    "red": [255, 0, 0],
    "blue": [0, 0, 255],
    "black": [0, 0, 0],
    "gray": [128, 128, 128],
}


def _create_label_overlay(text: str, config: dict,
                          page_width: float = 612, page_height: float = 792) -> io.BytesIO:
    """라벨(워터마크) 오버레이 PDF를 생성합니다.

    Args:
        text: 라벨 텍스트
        config: label 설정 딕셔너리
        page_width: 원본 페이지 너비 (pt)
        page_height: 원본 페이지 높이 (pt)
    """
    label_cfg = config.get("label", {})
    font_size = label_cfg.get("font_size", _DEFAULT_LABEL_CONFIG["font_size"])
    position = label_cfg.get("position", _DEFAULT_LABEL_CONFIG["position"])
    watermark_img = label_cfg.get("watermark_image", "")

    packet = io.BytesIO()
    can = canvas.Canvas(packet, pagesize=(page_width, page_height))

    # 이미지 워터마크
    if watermark_img and os.path.exists(watermark_img):
        try:
            from reportlab.lib.utils import ImageReader
            img = ImageReader(watermark_img)
            iw, ih = img.getSize()
            # 최대 200pt 폭으로 리사이즈
            scale = min(200 / iw, 100 / ih, 1.0)
            draw_w, draw_h = iw * scale, ih * scale

            if "top" in position:
                iy = page_height - draw_h - 15
            else:
                iy = 15
            if "right" in position:
                ix = page_width - draw_w - 15
            else:
                ix = 15

            can.drawImage(watermark_img, ix, iy, width=draw_w, height=draw_h,
                         mask='auto', preserveAspectRatio=True)
        except Exception as e:
            logger.warning(f"  이미지 워터마크 실패: {e}, 텍스트 라벨 사용")
            watermark_img = ""

    # 텍스트 라벨
    if not watermark_img or not os.path.exists(watermark_img):
        can.setFont(KOREAN_FONT, font_size)

        color = label_cfg.get("color", _DEFAULT_LABEL_CONFIG["color"])
        if isinstance(color, str):
            if color not in _COLOR_MAP:
                logger.warning(f"  알 수 없는 색상 '{color}', 검정 사용")
            color = _COLOR_MAP.get(color, [0, 0, 0])
        can.setFillColorRGB(*[c / 255 if c > 1 else c for c in color])

        # 좌표(x, y)가 주어지면 우선 사용, 없으면 position 기반 계산
        x = label_cfg.get("x")
        y = label_cfg.get("y")
        if x is None or y is None:
            margin = 20
            if "top" in position:
                y = page_height - margin - font_size
            else:
                y = margin
            if "right" in position:
                text_width = can.stringWidth(text, KOREAN_FONT, font_size)
                x = page_width - text_width - margin
            else:
                x = margin

        can.drawString(x, y, text)

    can.save()
    packet.seek(0)
    return packet


# ============================================================
# 메인 파이프라인
# ============================================================
def run(config: dict = None, cancel_event=None,
        progress_callback=None) -> Result:
    """MVP 2 전체 파이프라인을 실행합니다."""
    if config is None:
        config = get_config("mvp2")
    config = _with_default_label_config(config)

    result = Result()
    base_dir = Path(config["base_dir"])
    source_dir = base_dir / config.get("source_subdir", "source")
    index_file = base_dir / config.get("index_file", "pages.xlsx")

    source_files: Dict[str, str] = config.get("source_files", {})
    topic_folders: Dict[int, str] = {
        int(k): v for k, v in config.get("topic_folders", {}).items()
    }

    logger.info("=" * 50)
    logger.info("MVP 2: 페이지 발췌 + 테마별 라벨링")
    logger.info("=" * 50)

    # 엑셀 로드
    if not index_file.exists():
        logger.error(f"인덱스 파일을 찾을 수 없습니다: {index_file}")
        return result

    wb = openpyxl.load_workbook(index_file, data_only=True)
    if not wb.worksheets:
        logger.error("엑셀 파일에 워크시트가 없습니다.")
        wb.close()
        return result
    ws = wb.active or wb.worksheets[0]

    try:
        return _process_topics(ws, config, source_dir, source_files, topic_folders,
                               base_dir, result, cancel_event, progress_callback)
    finally:
        wb.close()


def _close_readers(readers: Dict[str, PdfReader]):
    """PdfReader 객체의 내부 스트림을 명시적으로 닫습니다."""
    for reader in readers.values():
        if hasattr(reader, 'stream') and hasattr(reader.stream, 'close'):
            try:
                reader.stream.close()
            except Exception:
                pass


def _label_theme_name(theme: str) -> str:
    """폴더 접두어가 붙은 이름을 표시용 테마명으로 정리합니다."""
    if "_" not in theme:
        return theme
    prefix, rest = theme.split("_", 1)
    if prefix and len(prefix) <= 2 and prefix.isascii() and prefix.isalnum():
        return rest
    return theme


def _with_default_label_config(config: dict | None) -> dict:
    """MVP2 기본 라벨 설정을 현재 실행 config에 반영합니다."""
    base_config = get_config("mvp2") or {}
    merged = dict(base_config)
    if config:
        merged.update(config)

    label_cfg = dict(_DEFAULT_LABEL_CONFIG)
    label_cfg.update(base_config.get("label", {}))
    if config:
        label_cfg.update(config.get("label", {}))
    merged["label"] = label_cfg
    return merged


def _build_label_text(theme: str, source: str, page: int, label_cfg: dict) -> str:
    fmt = label_cfg.get("format", _DEFAULT_LABEL_CONFIG["format"])
    return fmt.format(
        theme=_label_theme_name(theme),
        source=source,
        page=page,
    )


def _process_topics(ws, config, source_dir, source_files, topic_folders,
                    base_dir, result, cancel_event, progress_callback):
    """테마별 PDF 페이지를 추출합니다."""
    # PDF Reader 캐싱
    readers: Dict[str, PdfReader] = {}
    for col_letter, filename in source_files.items():
        pdf_path = source_dir / filename
        if pdf_path.exists():
            readers[col_letter] = PdfReader(str(pdf_path))
            logger.info(f"  원본 로드: {filename} ({len(readers[col_letter].pages)}p)")
        else:
            logger.warning(f"  원본 없음: {pdf_path}")

    try:
        return _do_process_topics(ws, config, readers, source_files, topic_folders,
                                  base_dir, result, cancel_event, progress_callback)
    finally:
        _close_readers(readers)


def _do_process_topics(ws, config, readers, source_files, topic_folders,
                       base_dir, result, cancel_event, progress_callback):
    """테마별 PDF 페이지 추출 내부 구현."""
    # 테마별 처리
    topic_items = list(topic_folders.items())
    for idx, (row_num, folder_name) in enumerate(topic_items):
        if cancel_event and cancel_event.is_set():
            logger.warning("사용자에 의해 취소됨")
            break
        if progress_callback:
            progress_callback(idx, len(topic_items), f"추출: {folder_name}")
        logger.info(f"\n  [{folder_name}]")
        # 테마별 폴더를 "테마별_분리_자료/" 아래로 정리
        theme_base = base_dir / "테마별_분리_자료"
        topic_dir = theme_base / folder_name
        topic_dir.mkdir(parents=True, exist_ok=True)

        master_writer = PdfWriter()
        page_count = 0
        overlay_cache: dict[tuple[str, float, float], object] = {}

        for col_letter, reader in readers.items():
            cell = ws.cell(row=row_num, column=column_index_from_string(col_letter))
            pages = _parse_page_numbers(cell.value)

            if not pages:
                continue

            source_name = source_files[col_letter]
            total_pages_for_source = len(pages)
            for page_idx, pg in enumerate(sorted(pages), start=1):
                if cancel_event and cancel_event.is_set():
                    logger.warning("사용자에 의해 취소됨")
                    break
                if progress_callback:
                    progress_callback(
                        idx,
                        len(topic_items),
                        f"추출: {folder_name} ({source_name} {page_idx}/{total_pages_for_source})",
                    )
                if pg < 1 or pg > len(reader.pages):
                    logger.warning(f"    범위 초과: {source_name} p.{pg}")
                    continue

                page = copy.copy(reader.pages[pg - 1])

                # 라벨 오버레이 (설정에서 켜져 있을 때만)
                label_cfg = config.get("label", {})
                if label_cfg.get("enabled", True):
                    media = page.mediabox
                    pw = float(media.width)
                    ph = float(media.height)

                    label_text = _build_label_text(folder_name, source_name, pg, label_cfg)
                    overlay_key = (label_text, pw, ph)
                    overlay_page = overlay_cache.get(overlay_key)
                    if overlay_page is None:
                        overlay_buf = _create_label_overlay(label_text, config, pw, ph)
                        overlay_reader = PdfReader(overlay_buf)
                        overlay_page = overlay_reader.pages[0]
                        overlay_cache[overlay_key] = overlay_page
                    page.merge_page(copy.copy(overlay_page))

                # 개별 저장
                single_writer = PdfWriter()
                single_writer.add_page(page)
                single_path = topic_dir / f"{source_name}_p{pg:03d}.pdf"
                with open(single_path, "wb") as f:
                    single_writer.write(f)

                # 통합본에 추가
                master_writer.add_page(page)
                page_count += 1

        # 통합 PDF 저장
        if page_count > 0:
            theme_base = base_dir / "테마별_분리_자료"
            master_path = theme_base / f"{folder_name}.pdf"
            with open(master_path, "wb") as f:
                master_writer.write(f)
            result.add_success(folder_name, f"{page_count}페이지 추출")
            logger.info(f"    → {page_count}페이지 추출 완료")
        else:
            result.warnings.append(f"{folder_name}: 추출할 페이지가 없습니다")
            logger.info(f"    → 해당 페이지 없음 (건너뜀)")

    if progress_callback:
        progress_callback(len(topic_items), len(topic_items), "추출 완료")
    result.output_path = str(base_dir)

    logger.info("\n" + result.summary())
    return result


# ============================================================
# AI 태그 기반 추출 (v2 파이프라인)
# ============================================================
def run_from_tags(tags: List[dict], source_dir: str,
                  output_dir: str = None,
                  config: dict = None,
                  cancel_event=None,
                  progress_callback=None) -> Result:
    """AI 태그 기반으로 PDF 페이지를 테마별로 추출합니다.

    Args:
        tags: AI 태그 리스트 [{pageNum, sourceFile, theme, confidence, confirmed}]
        source_dir: 원본 PDF가 있는 디렉토리
        output_dir: 출력 디렉토리 (None이면 source_dir/extracted)
        config: 라벨 설정 등 (optional)
    """
    result = Result()
    src_path = Path(source_dir)
    # output_dir이 지정되면 그걸 사용, 없으면 source_dir 자체를 root로 사용 (나중에 테마별_분리_자료가 생성됨)
    out_path = Path(output_dir) if output_dir else src_path
    out_path.mkdir(parents=True, exist_ok=True)

    if not tags:
        result.add_success("태그 추출", "추출할 태그 없음")
        result.output_path = str(out_path)
        return result

    # 확인된 태그만 필터
    confirmed_tags = [t for t in tags if t.get("confirmed", False)]
    if not confirmed_tags:
        confirmed_tags = tags  # 확인 안 된 경우 전체 사용

    label_config = _with_default_label_config(config)

    # 테마별 그룹화
    theme_pages: Dict[str, List[dict]] = {}
    for tag in confirmed_tags:
        theme = tag.get("theme", "기타")
        theme_pages.setdefault(theme, []).append(tag)

    # 테마 순서 번호 매핑 (settings.yaml themes 순서 기반)
    try:
        from shared.config import get_config
        ordered_themes = get_config("mvp2").get("themes", [])
    except Exception:
        ordered_themes = []
    theme_order = {t: i + 1 for i, t in enumerate(ordered_themes)}

    def _numbered_name(theme_name: str) -> str:
        """테마에 순서 번호를 붙여 정렬 가능한 이름을 반환합니다."""
        num = theme_order.get(theme_name, len(theme_order) + 1)
        return f"{num:02d}_{theme_name}"

    # PDF Reader 캐싱
    readers: Dict[str, PdfReader] = {}
    total_themes = len(theme_pages)

    try:
        for idx, (theme, pages) in enumerate(sorted(theme_pages.items(),
                                                     key=lambda x: theme_order.get(x[0], 999))):
            if cancel_event and cancel_event.is_set():
                break
            if progress_callback:
                progress_callback(idx, total_themes, f"추출: {theme}")
            logger.info("  [%s] %d페이지 추출 시작", theme, len(pages))

            # 테마별 폴더를 "테마별_분리_자료/" 아래로 정리 (번호 마킹)
            theme_base = out_path / "테마별_분리_자료"
            numbered = _numbered_name(theme)
            theme_dir = theme_base / numbered
            theme_dir.mkdir(parents=True, exist_ok=True)
            master_writer = PdfWriter()
            page_count = 0
            overlay_cache: dict[tuple[str, float, float], object] = {}

            sorted_pages = sorted(pages, key=lambda t: (t.get("sourceFile", ""), t.get("pageNum", 0)))
            total_pages_for_theme = len(sorted_pages)
            for page_idx, tag in enumerate(sorted_pages, start=1):
                if cancel_event and cancel_event.is_set():
                    logger.warning("사용자에 의해 취소됨")
                    break
                if progress_callback:
                    progress_callback(idx, total_themes, f"추출: {theme} ({page_idx}/{total_pages_for_theme})")
                src_file = tag.get("sourceFile")
                page_num = tag.get("pageNum")
                if not src_file or page_num is None:
                    logger.warning(f"  불완전한 태그 건너뜀: {tag}")
                    continue

                # Reader 캐싱
                if src_file not in readers:
                    pdf_path = src_path / src_file
                    if not pdf_path.exists():
                        logger.warning(f"  원본 없음: {pdf_path}")
                        continue
                    readers[src_file] = PdfReader(str(pdf_path))

                reader = readers[src_file]
                if page_num < 1 or page_num > len(reader.pages):
                    logger.warning(f"  범위 초과: {src_file} p.{page_num}")
                    continue

                page = copy.copy(reader.pages[page_num - 1])

                # 라벨 오버레이
                label_cfg = label_config.get("label", {})
                if label_cfg.get("enabled", True):
                    media = page.mediabox
                    pw, ph = float(media.width), float(media.height)
                    label_text = _build_label_text(theme, src_file, page_num, label_cfg)
                    overlay_key = (label_text, pw, ph)
                    overlay_page = overlay_cache.get(overlay_key)
                    if overlay_page is None:
                        overlay_buf = _create_label_overlay(label_text, label_config, pw, ph)
                        overlay_reader = PdfReader(overlay_buf)
                        overlay_page = overlay_reader.pages[0]
                        overlay_cache[overlay_key] = overlay_page
                    page.merge_page(copy.copy(overlay_page))

                # 개별 저장
                single_writer = PdfWriter()
                single_writer.add_page(page)
                single_path = theme_dir / f"{Path(src_file).stem}_p{page_num:03d}.pdf"
                with open(single_path, "wb") as f:
                    single_writer.write(f)

                master_writer.add_page(page)
                page_count += 1

            # 테마 통합 PDF — 테마별_분리_자료/ 안에 저장
            if page_count > 0:
                master_path = theme_base / f"{numbered}.pdf"
                with open(master_path, "wb") as f:
                    master_writer.write(f)
                result.add_success(theme, f"{page_count}페이지 추출")
                logger.info("  [%s] %d페이지 추출 완료", theme, page_count)
            else:
                result.add_success(theme, "해당 페이지 없음")

        if progress_callback:
            progress_callback(total_themes, total_themes, "태그 기반 추출 완료")
        result.output_path = str(out_path)
    finally:
        _close_readers(readers)

    logger.info("\n" + result.summary())
    return result
