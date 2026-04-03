"""AI 기반 PDF 페이지 테마 태깅 (PyMuPDF 썸네일 + Gemini 분류)."""

import re
import json
import logging
import random
import threading
import time
from pathlib import Path
from typing import Callable

try:
    from shared.config import get_config
except ImportError:
    from src.shared.config import get_config

logger = logging.getLogger("mvp")

# 테마: settings.yaml에서 로드 (SSOT), 실패 시 기본값
_DEFAULT_THEMES = [
    "학급수 및 학생수", "각종 면적", "사업 유형", "사업 기간",
    "설계발주방식", "사업비 내역", "스페이스 프로그램", "설문조사 결과", "기타",
]

# 테마별 설명 — 프롬프트에 포함하여 분류 정확도 향상
_THEME_HINTS: dict[str, str] = {
    "학급수 및 학생수": "학년별 학급 수, 학생 수, 특수학급 현황, 돌봄교실 인원, 중장기 학생배치계획 등",
    "각종 면적": "부지·건축·연면적, 교실·운동장·체육관 등 각종 공간 면적 수치, 규모 계획표",
    "사업 유형": "신설·증축·개축·리모델링 등 사업 종류, 추진 배경·목적, 사업 개요, 학교 기본 정보",
    "사업 기간": "착공·준공 예정일, 공사 일정표, 설계 일정, 사업 추진 경과, 단계별 추진 일정표 — 단, 위해요소 분석·공사 중 안전·학습권 보호 방안은 '기타'로 분류",
    "설계발주방식": "턴키·설계시공분리·수의계약·제안공모 등 발주 방식 결정 근거 및 비교",
    "사업비 내역": "총사업비, 공사비, 설계비, 감리비, 예산 편성, 재정투자 이력, 수선 이력, 비용 산정 근거",
    "스페이스 프로그램": (
        "교육공간 배치 계획, 특별교실(과학실·도서관·음악실 등) 종류·수량, "
        "공간 구성 및 면적 배분표, 교육 중점 프로그램과 필요 공간, 스페이스 프로그램 표, "
        "건축 배치도·평면계획, 층별 공간 구성, 공간 테마·개념 설계"
    ),
    "설문조사 결과": (
        "학부모·교직원·학생 설문 결과, Q. 형식의 설문 문항, "
        "응답 비율(%), 선호도·만족도 조사, 의견 수렴 내용, 사용자 참여 워크숍 결과"
    ),
    "기타": (
        "목차, 표지, 인사말, 법적 근거·조문, 체크리스트, 법규 내용, "
        "위해요소 분석, 안전 기준, 교육과정 비전·인간상 (공간과 무관한 교육 철학 내용)"
    ),
}

_TAGGER_SYSTEM_INSTRUCTION = (
    "당신은 한국 교육시설 사전기획 문서 분류 전문가입니다.\n"
    "각 페이지에서 가장 비중이 큰 데이터/정보를 기준으로 테마 하나를 선택하세요.\n\n"
    "[분류 우선순위 규칙]\n"
    "1. 수치 데이터(표·숫자)가 있으면 해당 수치가 나타내는 테마를 선택 (예: 면적 수치 → '각종 면적').\n"
    "2. 여러 테마가 혼재하면 페이지 분량의 50% 이상을 차지하는 테마 선택.\n"
    "3. 50% 기준 없으면 '기타' 선택.\n\n"
    "[테마별 핵심 판단 기준]\n"
    "- '스페이스 프로그램': 구체적인 공간 배치표·교실 구성표·면적 배분표가 있을 때만. "
    "교육 비전·인간상·교육목표만 서술된 페이지는 '기타'.\n"
    "- '설계발주방식': 턴키·분리발주 등 발주 방식 비교표나 결정 근거가 명시된 경우만. "
    "설계지침·건축 개념 설명만 있으면 '스페이스 프로그램' 또는 '기타'.\n"
    "- '사업 기간': 착공·준공·설계 일정이 날짜나 표로 명시된 경우만. "
    "위해요소 분석·석면 제거·안전·학습권 보호는 반드시 '기타'.\n"
    "- '사업비 내역': 총사업비·공사비·설계비가 금액(원/억)으로 기재된 표·목록이 있을 때.\n"
    "- '설문조사 결과': 학부모·교직원·학생 대상 설문 응답 비율(%)이 있을 때만.\n"
    "- '기타': 목차·표지·챕터 헤더만 있는 페이지, 법적 근거 조문, 체크리스트.\n"
)

def _load_themes() -> list[str]:
    try:
        cfg = get_config("mvp2")
        themes = cfg.get("themes", _DEFAULT_THEMES)
        if themes and isinstance(themes, list):
            return themes
    except Exception:
        pass
    return _DEFAULT_THEMES

THEMES = _load_themes()

VISION_BATCH_SIZE = 5
TEXT_BATCH_SIZE = 10
MAX_RETRIES = 3
BASE_DELAY = 5
THUMBNAIL_DPI = 150


def tag_pages(
    ocr_dir: str,
    files: list[str] | None = None,
    model_name: str = "gemini-3-flash-preview",
    cancel_event: threading.Event | None = None,
    progress_callback: Callable | None = None,
) -> dict:
    """PDF 페이지들을 Gemini Vision으로 테마 분류.

    Args:
        ocr_dir: PDF 파일이 있는 디렉토리
        files: 선택된 파일 경로 목록 (None이면 ocr_dir 전체)
        model_name: Gemini 모델명
        cancel_event: 취소 이벤트
        progress_callback: (current, total, message) 콜백

    Returns:
        {"tags": [{"pageNum", "sourceFile", "theme", "confidence", "confirmed"}, ...]}
    """
    import fitz
    from google import genai
    from google.genai import types as genai_types
    try:
        from shared.env_loader import ensure_api_key
    except ImportError:
        from src.shared.env_loader import ensure_api_key

    if cancel_event is None:
        cancel_event = threading.Event()
    progress = progress_callback or (lambda *a: None)

    ocr_path = Path(ocr_dir)
    themes = _load_themes()  # 매 호출마다 최신 설정 반영
    tagger_options = _load_tagger_options()

    # H-2: files가 지정된 경우 해당 파일에 대응하는 .md만 확인 (이전 실행 잔여물 무시)
    if files:
        relevant_stems = {Path(f).stem for f in files}
        md_files = [ocr_path / f"{stem}.md" for stem in relevant_stems
                    if (ocr_path / f"{stem}.md").exists()]
    else:
        md_files = sorted(ocr_path.glob("*.md"))

    if md_files:
        logger.info(
            "텍스트 기반 태깅: %d개 .md 파일 발견 - model=%s text_batch=%d snippet=%d",
            len(md_files),
            model_name,
            tagger_options["text_batch_size"],
            tagger_options["text_page_snippet"],
        )
        return _tag_text_files(
            ocr_path,
            files,
            model_name,
            cancel_event,
            progress_callback,
            themes,
            text_batch_size=tagger_options["text_batch_size"],
            page_snippet=tagger_options["text_page_snippet"],
        )

    pdf_files = _resolve_pdf_files(ocr_path, files)
    if not pdf_files:
        return {"tags": [], "message": "처리할 파일 없음 (.md 또는 PDF)"}

    # Vision: 이미지 업로드가 포함되므로 텍스트 태깅보다 긴 타임아웃 필요
    client, _model_name, gen_config = _create_client(ensure_api_key(), model_name, timeout=120)
    total_pages = _count_total_pages(fitz, pdf_files)

    tags = []
    current = 0

    for pdf_path in pdf_files:
        if cancel_event.is_set():
            break
        try:
            doc = fitz.open(str(pdf_path))
        except Exception:
            continue

        try:
            batch_start = 0
            num_pages = len(doc)

            while batch_start < num_pages:
                if cancel_event.is_set():
                    break

                batch_end = min(batch_start + tagger_options["vision_batch_size"], num_pages)
                batch_page_nums = list(range(batch_start, batch_end))
                batch_images = _render_batch_thumbnails(fitz, doc, batch_page_nums)

                current += len(batch_page_nums)
                progress(current, total_pages, f"태깅: {pdf_path.name} p.{batch_start + 1}-{batch_end}")

                valid_images = [(pn, img) for pn, img in batch_images if img is not None]

                if not valid_images:
                    tags.extend(_fallback_tags(batch_images, pdf_path.name))
                    batch_start = batch_end
                    continue

                batch_results = _classify_batch(
                    client, _model_name, gen_config,
                    valid_images, cancel_event, progress, current, total_pages,
                    themes=themes,
                )

                for page_num, _img in batch_images:
                    theme, confidence = batch_results.get(page_num, ("기타", 0.0))
                    tags.append({
                        "pageNum": page_num + 1,
                        "sourceFile": pdf_path.name,
                        "theme": theme,
                        "confidence": confidence,
                        "confirmed": False,
                    })

                del batch_images, valid_images
                batch_start = batch_end
        finally:
            doc.close()

    progress(total_pages, total_pages, "태깅 완료")
    return {"tags": tags}


# ── Private helpers ──────────────────────────────────────────────


def _resolve_pdf_files(ocr_path: Path, files: list[str] | None) -> list[Path]:
    """파일 목록 해석: 선택된 파일 → PDF 경로, 또는 폴더 전체 스캔."""
    if files:
        pdf_paths = set()
        for f in files:
            p = Path(f)
            if p.suffix.lower() == ".pdf" and p.exists():
                pdf_paths.add(p)
            elif p.suffix.lower() in (".hwp", ".hwpx"):
                pdf_version = p.with_suffix(".pdf")
                if pdf_version.exists():
                    pdf_paths.add(pdf_version)
        result = sorted(pdf_paths)
        if result:
            return result
    # fallback: ocr_dir 전체
    return sorted(ocr_path.glob("*.pdf"))


def _create_client(api_key: str, model_name: str, timeout: int = 60):
    """Gemini Client 초기화.

    timeout 파라미터는 하위호환 시그니처 유지용 (실제 SDK에는 적용하지 않음).
    SDK 기본 타임아웃 사용 — 응답 대기 중 끊김 방지.
    """
    from google import genai as _genai
    from google.genai import types as _types
    # timeout은 SDK 기본값 사용 — http_options timeout(ms)을 짧게 잡으면
    # 태깅 응답 대기 중 끊김 발생. 에러는 호출부 재시도 로직에서 처리.
    client = _genai.Client(api_key=api_key)
    gen_config = _types.GenerateContentConfig(
        temperature=0.0,
        system_instruction=_TAGGER_SYSTEM_INSTRUCTION,
    )
    return client, model_name, gen_config


def _count_total_pages(fitz, pdf_files: list[Path]) -> int:
    """전체 페이지 수 계산."""
    total = 0
    for pdf_path in pdf_files:
        try:
            doc = fitz.open(str(pdf_path))
            try:
                total += len(doc)
            finally:
                doc.close()
        except Exception:
            pass
    return total


def _render_batch_thumbnails(fitz, doc, page_nums: list[int]) -> list[tuple[int, bytes | None]]:
    """배치 내 페이지 썸네일 렌더링."""
    matrix = fitz.Matrix(THUMBNAIL_DPI / 72, THUMBNAIL_DPI / 72)
    images = []
    for page_num in page_nums:
        try:
            page = doc[page_num]
            pix = page.get_pixmap(matrix=matrix)
            img_bytes = pix.tobytes("png")
            pix = None
            images.append((page_num, img_bytes))
        except Exception:
            images.append((page_num, None))
    return images


def _fallback_tags(batch_images: list, source_file: str) -> list[dict]:
    """유효 이미지 없을 때 기타 태그 생성."""
    return [
        {"pageNum": pn + 1, "sourceFile": source_file,
         "theme": "기타", "confidence": 0.0, "confirmed": False}
        for pn, _ in batch_images
    ]


def _coerce_positive_int(value, default: int) -> int:
    try:
        num = int(value)
    except (TypeError, ValueError):
        return default
    return num if num > 0 else default


def _load_tagger_options() -> dict[str, int]:
    """태거 실행 옵션을 settings.yaml에서 읽습니다."""
    try:
        cfg = get_config("mvp2") or {}
    except Exception:
        cfg = {}
    return {
        "vision_batch_size": _coerce_positive_int(
            cfg.get("vision_tag_batch_size"),
            VISION_BATCH_SIZE,
        ),
        "text_batch_size": _coerce_positive_int(
            cfg.get("text_tag_batch_size"),
            TEXT_BATCH_SIZE,
        ),
        "text_page_snippet": _coerce_positive_int(
            cfg.get("text_tag_page_snippet"),
            _PAGE_SNIPPET,
        ),
    }


def _summarize_theme_counts(results: dict[int, tuple[str, float]]) -> str:
    counts: dict[str, int] = {}
    for theme, _confidence in results.values():
        counts[theme] = counts.get(theme, 0) + 1
    if not counts:
        return "no-tags"
    return ", ".join(
        f"{theme}:{count}" for theme, count in sorted(
            counts.items(),
            key=lambda item: (-item[1], item[0]),
        )
    )


def _classify_batch(
    client,
    model_name: str,
    gen_config,
    valid_images: list[tuple[int, bytes]],
    cancel_event: threading.Event,
    progress: Callable,
    current: int,
    total_pages: int,
    themes: list[str] | None = None,
) -> dict[int, tuple[str, float]]:
    """Gemini API로 배치 분류 (재시도 포함)."""
    from google.genai import types as _types
    _themes = themes or THEMES
    _tl = ", ".join(_themes)
    theme_desc = "\n".join(f"  - {t}: {_THEME_HINTS.get(t, '')}" for t in _themes)
    use_batch = len(valid_images) > 1
    if use_batch:
        prompt = (
            "아래 PDF 페이지 이미지들을 각각 분석하고, 각 페이지에 가장 적합한 테마를 선택하세요.\n\n"
            f"테마 목록 (설명 참고):\n{theme_desc}\n\n"
            "JSON 배열로만 응답하세요 (다른 텍스트 없이):\n"
            '[{"page": 1, "theme": "테마명", "confidence": 0.85}, ...]\n'
            "(page는 이미지 순서: 첫 번째=1, 두 번째=2, ...)"
        )
    else:
        prompt = (
            "이 PDF 페이지 이미지를 분석하고, 가장 적합한 테마를 선택하세요.\n\n"
            f"테마 목록 (설명 참고):\n{theme_desc}\n\n"
            "JSON으로만 응답하세요 (다른 텍스트 없이):\n"
            '{"theme": "테마명", "confidence": 0.85}'
        )
    content_parts = [prompt] + [
        _types.Part.from_bytes(data=img, mime_type="image/png") for _, img in valid_images
    ]

    for attempt in range(MAX_RETRIES):
        if cancel_event.is_set():
            return {}
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=content_parts,
                config=gen_config,
            )
            return _parse_response(response.text, valid_images, use_batch, _themes)
        except json.JSONDecodeError as parse_err:
            # JSON 파싱 실패는 non-transient — 즉시 fallback (재시도 무의미)
            logger.warning(f"태깅 JSON 파싱 실패: {parse_err}")
            progress(current, total_pages, f"⚠️ [태깅] 응답 파싱 실패: {str(parse_err)[:120]}")
            return {}
        except Exception as err:
            err_str = str(err).lower()
            is_transient = any(
                kw in err_str for kw in (
                    "429", "503", "quota", "timeout", "timed out",
                    "deadline", "unavailable", "connection", "reset",
                )
            )
            if is_transient and attempt < MAX_RETRIES - 1:
                wait = BASE_DELAY * (2 ** attempt) + random.uniform(0, 3)
                progress(current, total_pages, f"태깅: API 대기 {wait:.0f}초...")
                if cancel_event.wait(wait):
                    return {}
            else:
                logger.warning(f"태깅 배치 실패: {err}")
                progress(current, total_pages, f"⚠️ [태깅] API 오류: {str(err)[:150]}")
                return {}
    return {}


def _parse_response(
    text: str, valid_images: list[tuple[int, bytes]], use_batch: bool,
    themes: list[str] | None = None,
) -> dict[int, tuple[str, float]]:
    """Gemini 응답 JSON 파싱 → {page_num: (theme, confidence)}."""
    _themes = themes or THEMES
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    parsed = json.loads(text)
    results = {}

    if use_batch and isinstance(parsed, list):
        for i, item in enumerate(parsed):
            if i >= len(valid_images):
                break
            page_idx = item.get("page")
            if isinstance(page_idx, int) and 1 <= page_idx <= len(valid_images):
                pn = valid_images[page_idx - 1][0]
            else:
                pn = valid_images[i][0]
            theme = item.get("theme", "기타")
            try:
                confidence = float(item.get("confidence", 0.5))
            except (TypeError, ValueError):
                confidence = 0.5
            if theme not in _themes:
                theme, confidence = "기타", 0.3
            results[pn] = (theme, confidence)
    elif isinstance(parsed, dict):
        pn = valid_images[0][0]
        theme = parsed.get("theme", "기타")
        try:
            confidence = float(parsed.get("confidence", 0.5))
        except (TypeError, ValueError):
            confidence = 0.5
        if theme not in _themes:
            theme, confidence = "기타", 0.3
        results[pn] = (theme, confidence)

    return results


# ── Text-based tagging (PDF → .md 페이지별 분류) ─────────────────

_PAGE_SEP = "\n\n---\n\n"   # pdf_text_extractor가 사용하는 구분자
_PAGE_SNIPPET = 1200         # 페이지당 전달 텍스트 최대 길이 (표 데이터 누락 방지)

_PAGE_NUM_RE = re.compile(r"^\s*-\s*\d+\s*-\s*$", re.MULTILINE)
# "1. 사업의 추진에 관한 사항" 같은 챕터 네비게이션 헤더 (문서마다 반복되는 breadcrumb)
_CHAPTER_NAV_RE = re.compile(r"^\d+\.\s+.{2,20}(?:에 관한 사항|에관한사항)\s*$", re.MULTILINE)
# 마크다운 표 행: "| ... | --- | ..." 구분선 또는 빈 셀만 있는 행
_TABLE_ROW_RE = re.compile(r"^\|.*\|$")
_TABLE_SEP_RE = re.compile(r"^\|[\s|:-]+\|$")  # "| --- | --- |" 구분선


def _clean_page_text(text: str) -> str:
    """페이지 텍스트 전처리 — 스니펫 낭비 노이즈 제거.

    표 마크다운을 텍스트 셀 내용만 남기는 방식으로 단순화하여
    Gemini가 실제 내용을 파악할 수 있게 한다.
    """
    text = _PAGE_NUM_RE.sub("", text)        # "- 021 -" 형식 페이지 번호 마커
    text = _CHAPTER_NAV_RE.sub("", text)     # 챕터 네비게이션 breadcrumb

    # 표 구분선 행 제거, 표 행은 셀 내용만 추출
    lines = text.splitlines()
    result_lines = []
    for line in lines:
        stripped = line.strip()
        if _TABLE_SEP_RE.match(stripped):
            continue  # "| --- | --- |" 구분선 제거
        if _TABLE_ROW_RE.match(stripped):
            # "| 셀1 | 셀2 |" → "셀1 셀2"
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            cell_text = " ".join(c for c in cells if c)
            if cell_text:
                result_lines.append(cell_text)
        else:
            result_lines.append(line)

    # 테이블 처리 후 챕터 네비게이션이 셀로 분리된 경우 재적용
    # 예: "1. 사업의 추진에 관한 사항 1. 사업의 추진에 관한 사항" 형태
    cleaned = "\n".join(result_lines)
    cleaned = _CHAPTER_NAV_RE.sub("", cleaned)

    # 연속 중복 행 제거 (같은 내용이 2번 이상 반복되는 브레드크럼 처리)
    seen: set = set()
    deduped_lines = []
    for line in cleaned.splitlines():
        stripped = line.strip()
        if stripped and stripped in seen:
            continue
        if stripped:
            seen.add(stripped)
        deduped_lines.append(line)

    return "\n".join(deduped_lines).strip()


def _tag_text_files(
    ocr_path: Path,
    files: list[str] | None,
    model_name: str,
    cancel_event: threading.Event | None,
    progress_callback: Callable | None,
    themes: list[str] | None = None,
    text_batch_size: int = TEXT_BATCH_SIZE,
    page_snippet: int = _PAGE_SNIPPET,
) -> dict:
    """텍스트 파일(.md)을 Gemini Text로 페이지별 테마 분류.

    pdf_text_extractor가 생성한 .md 파일은 '\\n\\n---\\n\\n' 구분자로
    페이지가 구분되어 있다. 페이지별로 분리하여 배치 태깅한다.
    """
    try:
        from shared.env_loader import ensure_api_key
        from shared import read_text_file
    except ImportError:
        from src.shared.env_loader import ensure_api_key
        from src.shared import read_text_file

    if cancel_event is None:
        cancel_event = threading.Event()
    progress = progress_callback or (lambda *a: None)

    if files:
        relevant_stems = {Path(f).stem for f in files}
        md_files = sorted(
            p for p in ocr_path.glob("*.md") if p.stem in relevant_stems
        )
    else:
        md_files = sorted(ocr_path.glob("*.md"))
    if not md_files:
        return {"tags": [], "message": "텍스트 파일 없음"}

    client, _model_name, gen_config = _create_client(ensure_api_key(), model_name, timeout=120)
    tags = []

    for md_path in md_files:
        if cancel_event.is_set():
            break

        # H-3: 실제 원본 파일 확장자 추론 (HWP/HWPX → .hwp/.hwpx 가능)
        stem = md_path.stem
        _candidate = next(
            (ocr_path / f"{stem}{ext}" for ext in (".pdf", ".hwp", ".hwpx")
             if (ocr_path / f"{stem}{ext}").exists()),
            None,
        )
        source_file = _candidate.name if _candidate else f"{stem}.pdf"
        full_text = read_text_file(md_path)

        # 페이지별 분리 (구분자 없으면 단일 페이지로 처리)
        pages = full_text.split(_PAGE_SEP) if _PAGE_SEP in full_text else [full_text]
        total_pages = len(pages)

        logger.info(f"텍스트 태깅: {source_file} ({total_pages}페이지)")

        # 배치 처리
        batch_start = 0
        while batch_start < total_pages:
            if cancel_event.is_set():
                break

            batch_end = min(batch_start + text_batch_size, total_pages)
            batch = pages[batch_start:batch_end]   # 0-indexed 슬라이스
            batch_page_nums = list(range(batch_start + 1, batch_end + 1))  # 1-indexed

            progress(batch_start, total_pages, f"태깅: {source_file} p.{batch_start + 1}-{batch_end} - AI 분석 중...")
            logger.info(
                "[tag.text] request file=%s range=%s-%s pages=%d model=%s snippet=%d",
                source_file,
                batch_start + 1,
                batch_end,
                len(batch_page_nums),
                model_name,
                page_snippet,
            )

            results = _classify_text_batch(
                client, _model_name, gen_config,
                batch, batch_page_nums,
                cancel_event, progress, batch_start, total_pages,
                themes=themes,
                page_snippet=page_snippet,
            )

            for page_num in batch_page_nums:
                theme, confidence = results.get(page_num, ("기타", 0.0))
                page_text = pages[page_num - 1]  # 1-indexed → 0-indexed
                tags.append({
                    "pageNum": page_num,
                    "sourceFile": source_file,
                    "theme": theme,
                    "confidence": confidence,
                    "confirmed": False,
                    "snippet": page_text[:400].strip(),
                })

            progress(batch_end, total_pages, f"태깅: {source_file} p.{batch_start + 1}-{batch_end} 완료 ({batch_end}/{total_pages})")
            batch_start = batch_end

    progress(1, 1, "태깅 완료")
    return {"tags": tags}


def _classify_text_batch(
    client,
    model_name: str,
    gen_config,
    page_texts: list[str],
    page_nums: list[int],
    cancel_event: threading.Event,
    progress: Callable,
    current: int,
    total: int,
    themes: list[str] | None = None,
    page_snippet: int = _PAGE_SNIPPET,
) -> dict[int, tuple[str, float]]:
    """여러 페이지 텍스트를 한 번의 API 호출로 배치 분류."""
    _themes = themes or THEMES
    # 페이지 번호 마커 등 노이즈 제거 후 유효 페이지 필터
    cleaned = [_clean_page_text(txt) for txt in page_texts]
    valid = [(num, txt) for num, txt in zip(page_nums, cleaned) if len(txt.strip()) >= 30]
    results: dict[int, tuple[str, float]] = {}

    if not valid:
        return results

    # 테마 설명 블록 (hints가 있는 테마만 포함)
    theme_desc = "\n".join(
        f"  - {t}: {_THEME_HINTS.get(t, '')}" for t in _themes
    )
    # 프롬프트 구성: [PAGE N] 구분자로 각 페이지 텍스트 삽입
    pages_block = "\n\n".join(
        f"[PAGE {num}]\n{txt[:page_snippet]}" for num, txt in valid
    )
    first_page = valid[0][0] if valid else 1
    prompt = (
        f"아래 교육시설 사전기획 문서 페이지들을 분석하고, 각 페이지에 가장 적합한 테마를 선택하세요.\n\n"
        f"테마 목록 (설명 참고):\n{theme_desc}\n\n"
        f"JSON 배열로만 응답하세요 (다른 텍스트 없이):\n"
        f'[{{"page": {first_page}, "theme": "테마명", "confidence": 0.85}}, ...]\n'
        f"(page는 아래 [PAGE N]의 N 번호를 그대로 사용)\n\n"
        f"{pages_block}"
    )
    batch_label = f"p.{page_nums[0]}-{page_nums[-1]}"
    prompt_chars = len(prompt)

    for attempt in range(MAX_RETRIES):
        if cancel_event.is_set():
            return results
        started = time.perf_counter()
        try:
            response = client.models.generate_content(
                model=model_name, contents=prompt, config=gen_config,
            )
            raw = response.text.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            parsed = json.loads(raw)
            if not isinstance(parsed, list):
                return results
            for i, item in enumerate(parsed):
                page_idx = item.get("page")
                # Gemini가 반환한 page 번호로 매핑, 없으면 순서대로
                if isinstance(page_idx, int) and any(n == page_idx for n, _ in valid):
                    pn = page_idx
                elif i < len(valid):
                    pn = valid[i][0]
                else:
                    continue
                theme = item.get("theme", "기타")
                try:
                    confidence = float(item.get("confidence", 0.5))
                except (TypeError, ValueError):
                    confidence = 0.5
                if theme not in _themes:
                    theme, confidence = "기타", 0.3
                results[pn] = (theme, confidence)
            elapsed = time.perf_counter() - started
            logger.info(
                "[tag.text] response range=%s attempt=%d elapsed=%.1fs prompt_chars=%d tagged=%d/%d themes=%s",
                batch_label,
                attempt + 1,
                elapsed,
                prompt_chars,
                len(results),
                len(page_nums),
                _summarize_theme_counts(results),
            )
            return results
        except json.JSONDecodeError as e:
            logger.warning(
                "[tag.text] parse-fail range=%s attempt=%d prompt_chars=%d error=%s",
                batch_label,
                attempt + 1,
                prompt_chars,
                e,
                exc_info=True,
            )
            progress(current, total, f"⚠️ [태깅] 응답 파싱 실패: {str(e)[:80]}")
            return results
        except Exception as err:
            err_str = str(err).lower()
            is_transient = any(kw in err_str for kw in (
                "429", "503", "quota", "timeout", "timed out", "deadline", "unavailable",
            ))
            if is_transient and attempt < MAX_RETRIES - 1:
                wait = BASE_DELAY * (2 ** attempt) + random.uniform(0, 2)
                logger.warning(
                    "[tag.text] retry range=%s attempt=%d wait=%.1fs error=%s",
                    batch_label,
                    attempt + 1,
                    wait,
                    err,
                )
                progress(current, total, f"태깅: API 대기 {wait:.0f}초...")
                if cancel_event.wait(wait):
                    return results
            else:
                logger.warning(
                    "[tag.text] fail range=%s attempt=%d prompt_chars=%d error=%s",
                    batch_label,
                    attempt + 1,
                    prompt_chars,
                    err,
                    exc_info=True,
                )
                progress(current, total, f"⚠️ [태깅] API 오류: {str(err)[:120]}")
                return results
    return results


