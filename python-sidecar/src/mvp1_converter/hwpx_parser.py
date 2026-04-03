"""HWPX 직접 텍스트 추출 (COM/한컴오피스 불필요).

meari-contents 프로젝트의 hwpx_extractor.py 기반.
HWPX는 zip 포맷으로, Contents/section*.xml에 본문이 있음.
"""

import os
import re
import logging
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List

from src.shared.result import Result

logger = logging.getLogger("mvp")


def extract_text_from_hwpx(filepath: str) -> str:
    """HWPX 파일에서 본문 텍스트를 추출합니다."""
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"파일 없음: {filepath}")

    texts = []
    try:
        zf = zipfile.ZipFile(filepath, "r")
    except zipfile.BadZipFile:
        # Central Directory 손상 — Local File Header 스캔으로 폴백
        logger.warning(f"  ZIP 구조 손상, 복구 시도: {filepath.name}")
        try:
            text = _extract_from_broken_zip(str(filepath))
        except Exception as e:
            logger.error(f"  복구 실패: {filepath.name} — {e}")
            return ""
        if text:
            return _normalize_whitespace(text)
        # section 데이터 자체가 없는 불완전 파일
        return ""

    with zf:
        section_files = sorted(
            f for f in zf.namelist()
            if f.startswith("Contents/section") and f.endswith(".xml")
        )
        if not section_files:
            section_files = [f for f in zf.namelist() if "section" in f.lower() and f.endswith(".xml")]

        for section_file in section_files:
            content = zf.read(section_file).decode("utf-8")
            section_text = _parse_section_xml(content)
            if section_text:
                texts.append(section_text)

    if not texts:
        return ""

    full_text = "\n\n".join(texts)
    return _normalize_whitespace(full_text)


def _parse_section_xml(content: str) -> str:
    """섹션 XML에서 텍스트+표 추출.

    HWPX 구조: sec → p[] (직계), 표는 p > ctrl > tbl로 중첩.
    각 p를 처리하면서 내부에 tbl이 있으면 마크다운 테이블로 변환.
    """
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return re.sub(r"<[^>]+>", " ", content).strip()

    parts = []

    sec = _find_element(root, "sec")
    search_root = sec if sec is not None else root

    # sec 직계 p를 순서대로 처리
    for child in search_root:
        if _local(child.tag) != "p":
            continue

        # p 안에 tbl이 있는지 확인
        tables_in_p = list(child.iter())
        tables_in_p = [e for e in tables_in_p if _local(e.tag) == "tbl"]

        if tables_in_p:
            # 표가 포함된 p: 표를 마크다운으로
            for tbl in tables_in_p:
                table_md = _extract_table(tbl)
                if table_md:
                    parts.append(table_md)
        else:
            # 일반 텍스트 p
            para = _extract_paragraph(child)
            if para.strip():
                parts.append(para.strip())

    if not parts:
        return re.sub(r"<[^>]+>", " ", content).strip()

    return "\n\n".join(parts)


def _extract_paragraph(p) -> str:
    """문단(p)에서 run → t 텍스트 추출."""
    texts = []
    for child in p:
        if _local(child.tag) == "run":
            for t in child:
                if _local(t.tag) == "t" and t.text:
                    texts.append(t.text)
    return "".join(texts)


def _extract_table(tbl) -> str:
    """표(tbl)를 마크다운 테이블로 변환 (2-pass colSpan/rowSpan 지원).

    tbl → tr[] → tc[] → cellSpan(colSpan, rowSpan) + p → run → t.
    lexdiff의 buildTable() 2-pass 그리드 알고리즘 포팅.
    """
    # tc에서 {text, colSpan, rowSpan} 추출
    raw_rows: List[List[dict]] = []
    for tr in tbl:
        if _local(tr.tag) != "tr":
            continue
        cells = []
        for tc in tr:
            if _local(tc.tag) != "tc":
                continue
            col_span, row_span = 1, 1
            # cellSpan 요소에서 병합 정보 파싱
            for child in tc:
                if _local(child.tag) == "cellSpan":
                    col_span = int(child.get("colSpan", "1"))
                    row_span = int(child.get("rowSpan", "1"))
                    break
            # tc 안의 모든 텍스트 추출
            cell_texts = []
            for t in tc.iter():
                if _local(t.tag) == "t" and t.text:
                    cell_texts.append(t.text.strip())
            text = " ".join(cell_texts).replace("\n", " ").strip()
            cells.append({"text": text, "colSpan": col_span, "rowSpan": row_span})
        if cells:
            raw_rows.append(cells)

    if not raw_rows:
        return ""

    num_rows = len(raw_rows)

    # Pass 1: maxCols 계산 (occupied 그리드로 실제 열 수 결정)
    temp_occupied = [[False] * 100 for _ in range(num_rows)]
    max_cols = 0

    for row_idx in range(num_rows):
        col_idx = 0
        for cell in raw_rows[row_idx]:
            while col_idx < 100 and temp_occupied[row_idx][col_idx]:
                col_idx += 1
            if col_idx >= 100:
                break
            for r in range(row_idx, min(row_idx + cell["rowSpan"], num_rows)):
                for c in range(col_idx, min(col_idx + cell["colSpan"], 100)):
                    temp_occupied[r][c] = True
            col_idx += cell["colSpan"]
            if col_idx > max_cols:
                max_cols = col_idx

    if max_cols == 0:
        return ""

    # Pass 2: 실제 그리드 배치
    grid = [[{"text": "", "colSpan": 1, "rowSpan": 1} for _ in range(max_cols)] for _ in range(num_rows)]
    occupied = [[False] * max_cols for _ in range(num_rows)]

    for row_idx in range(num_rows):
        col_idx = 0
        cell_idx = 0
        while col_idx < max_cols and cell_idx < len(raw_rows[row_idx]):
            while col_idx < max_cols and occupied[row_idx][col_idx]:
                col_idx += 1
            if col_idx >= max_cols:
                break
            cell = raw_rows[row_idx][cell_idx]
            grid[row_idx][col_idx] = cell
            for r in range(row_idx, min(row_idx + cell["rowSpan"], num_rows)):
                for c in range(col_idx, min(col_idx + cell["colSpan"], max_cols)):
                    occupied[r][c] = True
            col_idx += cell["colSpan"]
            cell_idx += 1

    # 마크다운 변환: 병합된 영역은 빈 셀로
    display = [[""] * max_cols for _ in range(num_rows)]
    skip = set()

    for r in range(num_rows):
        for c in range(max_cols):
            if (r, c) in skip:
                continue
            cell = grid[r][c]
            display[r][c] = cell["text"].replace("\n", " ")
            for dr in range(cell["rowSpan"]):
                for dc in range(cell["colSpan"]):
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = r + dr, c + dc
                    if nr < num_rows and nc < max_cols:
                        skip.add((nr, nc))

    # 빈 행 제거
    display = [row for row in display if any(cell.strip() for cell in row)]
    if not display:
        return ""

    # 마크다운 테이블 생성
    lines = []
    lines.append("| " + " | ".join(display[0]) + " |")
    lines.append("| " + " | ".join(["---"] * max_cols) + " |")
    for row in display[1:]:
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines)


def _find_element(root, tag_name: str):
    for elem in root.iter():
        if _local(elem.tag) == tag_name:
            return elem
    return None


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _extract_from_broken_zip(filepath: str) -> str:
    """Central Directory가 손상된 HWPX에서 Local File Header를 스캔하여 section XML 추출."""
    import struct
    import zlib

    with open(filepath, "rb") as fh:
        data = fh.read()

    pos = 0
    texts = []
    while pos < len(data) - 30:
        if data[pos:pos + 4] != b"PK\x03\x04":
            break
        method = struct.unpack_from("<H", data, pos + 8)[0]
        comp_size = struct.unpack_from("<I", data, pos + 18)[0]
        name_len = struct.unpack_from("<H", data, pos + 26)[0]
        extra_len = struct.unpack_from("<H", data, pos + 28)[0]
        name = data[pos + 30:pos + 30 + name_len].decode("utf-8", errors="replace")
        file_start = pos + 30 + name_len + extra_len
        file_data = data[file_start:file_start + comp_size]
        pos = file_start + comp_size

        if "section" not in name.lower() or not name.endswith(".xml"):
            continue
        try:
            if method == 0:
                content = file_data.decode("utf-8")
            elif method == 8:
                content = zlib.decompress(file_data, -15).decode("utf-8")
            else:
                continue
            section_text = _parse_section_xml(content)
            if section_text:
                texts.append(section_text)
        except Exception:
            continue

    return "\n\n".join(texts) if texts else ""


def _normalize_whitespace(text: str) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
    return text.strip()


# ── Pipeline integration ─────────────────────────────────────


def convert_all_hwpx_to_text(
    target_dir: str,
    selected_files: list = None,
    cancel_event=None,
    progress_callback=None,
) -> Result:
    """HWPX 파일들을 .md 텍스트로 직접 변환 (COM 불필요).

    결과는 같은 디렉토리에 {원본이름}.md로 저장.
    """
    result = Result()

    if selected_files:
        all_files = [f for f in selected_files if f.lower().endswith(".hwpx")]
    else:
        all_files = sorted(str(f) for f in Path(target_dir).glob("*.hwpx"))

    if not all_files:
        return result

    logger.info(f"  {len(all_files)}개 HWPX 파일 직접 텍스트 추출")

    for idx, file_path in enumerate(all_files):
        if cancel_event and cancel_event.is_set():
            logger.warning("사용자에 의해 취소됨")
            break

        filename = os.path.basename(file_path)
        if progress_callback:
            progress_callback(idx, len(all_files), f"HWPX 텍스트 추출: {filename}")

        try:
            text = extract_text_from_hwpx(file_path)
            if not text.strip():
                result.add_failure(filename, "텍스트 없음")
                logger.warning(f"  빈 문서: {filename}")
                continue

            out_path = Path(target_dir) / (Path(file_path).stem + ".md")
            out_path.write_text(text, encoding="utf-8")
            result.add_success(filename)
            logger.info(f"  OK: {filename} → {out_path.name} ({len(text):,}자)")

        except zipfile.BadZipFile:
            result.add_failure(filename, "유효하지 않은 HWPX (zip 손상)")
            logger.error(f"  FAIL: {filename} — zip 손상")
        except Exception as e:
            result.add_failure(filename, str(e))
            logger.error(f"  FAIL: {filename} — {e}")

    if progress_callback:
        progress_callback(len(all_files), len(all_files), "HWPX 추출 완료")

    result.output_path = target_dir
    return result
