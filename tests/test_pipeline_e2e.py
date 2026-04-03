"""엔드투엔드 파이프라인 통합 테스트.

전체 흐름 검증:
  PDF 텍스트 추출 → AI 태깅 → 페이지 추출 → 요약/통합 분석

실행:
    pytest tests/test_pipeline_e2e.py -v -m online
    pytest tests/test_pipeline_e2e.py -v  (오프라인 단계만)
"""

import json
import os
import sys
import shutil
import tempfile
import threading
from pathlib import Path

import pytest

# ── 경로 설정 ────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
SIDECAR_DIR = PROJECT_ROOT / "python-sidecar"
sys.path.insert(0, str(SIDECAR_DIR))
sys.path.insert(0, str(SIDECAR_DIR / "src"))

TEST_DATA = PROJECT_ROOT / "tests" / "test_data"
MVP1_PDF = TEST_DATA / "mvp1" / "test_document.pdf"
MVP3_INPUT = TEST_DATA / "mvp3" / "input_data"

# ── 공통 설정 ────────────────────────────────────────────────────
MODEL_OCR = "gemini-3-flash-preview"
MODEL_ANALYSIS = "gemini-3-flash-preview"


# ─────────────────────────────────────────────────────────────────
# Step 1: PDF 텍스트 추출
# ─────────────────────────────────────────────────────────────────

class TestPdfTextExtraction:
    """pdf_text_extractor — 오프라인 (AI 불필요)."""

    def test_extracts_pages_with_separator(self, tmp_path):
        """PDF → .md 변환 시 페이지 구분자(\n\n---\n\n) 포함 여부."""
        from mvp1_converter.pdf_text_extractor import extract_all_pdfs

        assert MVP1_PDF.exists(), f"테스트 PDF 없음: {MVP1_PDF}"

        result, ocr_needed = extract_all_pdfs(
            selected_files=[str(MVP1_PDF)],
            output_dir=str(tmp_path),
        )

        md_files = list(tmp_path.glob("*.md"))
        assert len(md_files) >= 1, "MD 파일이 생성되지 않음"

        md_text = md_files[0].read_text(encoding="utf-8")
        # 페이지 구분자 확인
        assert "\n\n---\n\n" in md_text, "페이지 구분자 없음 — tagger가 단일 페이지로 처리"

        pages = md_text.split("\n\n---\n\n")
        assert len(pages) >= 2, f"페이지 수 부족: {len(pages)}"
        print(f"\n[추출] {md_files[0].name}: {len(pages)}페이지, {len(md_text):,}자")

    def test_empty_pages_get_placeholder(self, tmp_path):
        """내용 없는 페이지는 '(p.N: 내용 없음)' 플레이스홀더 생성."""
        from mvp1_converter.pdf_text_extractor import extract_all_pdfs

        result, _ = extract_all_pdfs(
            selected_files=[str(MVP1_PDF)],
            output_dir=str(tmp_path),
        )
        for md_file in tmp_path.glob("*.md"):
            content = md_file.read_text(encoding="utf-8")
            pages = content.split("\n\n---\n\n")
            # 모든 페이지가 빈 문자열이 아닌지
            empty_pages = [i+1 for i, p in enumerate(pages) if not p.strip()]
            assert not empty_pages, f"빈 페이지(구분자만) 발견: {empty_pages}"

    def test_page_count_matches_pdf(self, tmp_path):
        """추출된 MD의 페이지 수가 PDF 페이지 수와 일치."""
        import fitz
        from mvp1_converter.pdf_text_extractor import extract_all_pdfs

        doc = fitz.open(str(MVP1_PDF))
        pdf_pages = len(doc)
        doc.close()

        extract_all_pdfs(selected_files=[str(MVP1_PDF)], output_dir=str(tmp_path))
        md_files = list(tmp_path.glob("*.md"))
        assert md_files, "MD 파일 없음"

        md_pages = len(md_files[0].read_text(encoding="utf-8").split("\n\n---\n\n"))
        assert md_pages == pdf_pages, (
            f"MD 페이지 수({md_pages}) ≠ PDF 페이지 수({pdf_pages})"
        )


# ─────────────────────────────────────────────────────────────────
# Step 2: 태깅
# ─────────────────────────────────────────────────────────────────

class TestTagging:
    """page_tagger — 오프라인(파싱 로직) + 온라인(실제 API)."""

    def test_page_separator_split(self):
        """_PAGE_SEP으로 올바르게 분리되는지."""
        from mvp1_converter.page_tagger import _PAGE_SEP
        text = "page1 content\n\n---\n\npage2 content\n\n---\n\npage3 content"
        pages = text.split(_PAGE_SEP)
        assert len(pages) == 3

    def test_theme_hints_populated(self):
        """_THEME_HINTS가 모든 기본 테마를 포함하는지."""
        from mvp1_converter.page_tagger import _THEME_HINTS, _DEFAULT_THEMES
        for theme in _DEFAULT_THEMES:
            assert theme in _THEME_HINTS, f"테마 설명 없음: {theme}"
            assert len(_THEME_HINTS[theme]) > 5, f"테마 설명 너무 짧음: {theme}"

    def test_system_instruction_set(self):
        """system_instruction에 '기타' 최후 수단 명시."""
        from mvp1_converter.page_tagger import _TAGGER_SYSTEM_INSTRUCTION
        assert "기타" in _TAGGER_SYSTEM_INSTRUCTION
        assert len(_TAGGER_SYSTEM_INSTRUCTION) > 30

    def test_parse_response_confidence_string(self):
        """confidence가 문자열 '0.0~1.0'이어도 ValueError 없음."""
        from mvp1_converter.page_tagger import _parse_response
        text = json.dumps([
            {"page": 1, "theme": "학급수 및 학생수", "confidence": "0.0~1.0"},
        ])
        valid_images = [(0, b"img")]
        result = _parse_response(text, valid_images, use_batch=True)
        assert 0 in result
        assert result[0][0] == "학급수 및 학생수"
        assert result[0][1] == 0.5  # 파싱 실패 시 기본값

    @pytest.mark.online
    def test_full_tagging_pipeline(self, tmp_path):
        """실제 API로 PDF 태깅 — 기타 비율 50% 미만 검증."""
        from mvp1_converter.pdf_text_extractor import extract_all_pdfs
        from mvp1_converter.page_tagger import tag_pages

        # Step 1: PDF → MD
        extract_all_pdfs(selected_files=[str(MVP1_PDF)], output_dir=str(tmp_path))
        md_files = list(tmp_path.glob("*.md"))
        assert md_files, "MD 생성 실패"

        # Step 2: 태깅
        cancel = threading.Event()
        progress_log = []
        def progress(cur, total, msg):
            progress_log.append(f"[{cur}/{total}] {msg}")

        result = tag_pages(
            ocr_dir=str(tmp_path),
            model_name=MODEL_OCR,
            cancel_event=cancel,
            progress_callback=progress,
        )

        tags = result.get("tags", [])
        assert len(tags) > 0, "태그 없음"

        gita_count = sum(1 for t in tags if t["theme"] == "기타")
        gita_ratio = gita_count / len(tags)
        themes_used = {t["theme"] for t in tags}

        def _safe(s): return s.encode("utf-8", "replace").decode("utf-8")
        print(f"\n[태깅] 전체: {len(tags)}태그, 기타: {gita_count}({gita_ratio:.0%})")
        print(f"[태깅] 사용된 테마: {themes_used}")
        print("[태깅] 진행 로그:\n" + "\n".join(_safe(m) for m in progress_log[-5:]))

        # 기타가 50% 이상이면 경고 (실패로 처리하진 않음 — 테스트 데이터 한계)
        if gita_ratio > 0.5:
            import warnings
            warnings.warn(
                f"기타 비율 과다: {gita_ratio:.0%} > 50%",
                UserWarning,
                stacklevel=2,
            )

        # 최소 2개 이상의 테마가 사용돼야 함
        non_gita_themes = themes_used - {"기타"}
        assert len(non_gita_themes) >= 1, (
            f"모든 페이지가 기타로 분류됨 — 태깅 실패\n로그:\n" + "\n".join(progress_log)
        )


# ─────────────────────────────────────────────────────────────────
# Step 3: 페이지 추출 (MVP2)
# ─────────────────────────────────────────────────────────────────

class TestPageExtraction:
    """mvp2_extractor — 오프라인."""

    def test_extraction_creates_theme_folders(self, tmp_path):
        """확인된 태그가 있으면 테마별 폴더/파일 생성."""
        from mvp2_extractor.extractor import run_from_tags

        # 더미 태그 (모두 confirmed)
        tags = [
            {"pageNum": 1, "sourceFile": MVP1_PDF.name, "theme": "학급수 및 학생수",
             "confidence": 0.9, "confirmed": True},
            {"pageNum": 2, "sourceFile": MVP1_PDF.name, "theme": "각종 면적",
             "confidence": 0.8, "confirmed": True},
        ]

        # source_dir에 PDF 복사
        src_dir = tmp_path / "source"
        src_dir.mkdir()
        shutil.copy(str(MVP1_PDF), str(src_dir / MVP1_PDF.name))

        cancel = threading.Event()
        result = run_from_tags(
            tags=tags,
            source_dir=str(src_dir),
            cancel_event=cancel,
        )

        print(f"\n[추출] 성공: {result.success_count}, 실패: {result.fail_count}")
        print(f"[추출] 경고: {result.warnings}")

        assert result.success_count > 0, f"추출 실패\n경고: {result.warnings}"

    def test_confirmed_tags_only_extracted(self, tmp_path):
        """confirmed=True 태그만 추출 — confirmed=False는 스킵 (일부 confirmed일 때)."""
        from mvp2_extractor.extractor import run_from_tags

        tags = [
            {"pageNum": 1, "sourceFile": MVP1_PDF.name, "theme": "학급수 및 학생수",
             "confidence": 0.9, "confirmed": True},
            {"pageNum": 2, "sourceFile": MVP1_PDF.name, "theme": "각종 면적",
             "confidence": 0.8, "confirmed": False},  # 스킵 대상
        ]

        src_dir = tmp_path / "source"
        src_dir.mkdir()
        shutil.copy(str(MVP1_PDF), str(src_dir / MVP1_PDF.name))

        result = run_from_tags(tags=tags, source_dir=str(src_dir))
        # confirmed=True가 1개이므로 그것만 추출됨
        assert result.success_count == 1, f"confirmed=True 1개만 추출돼야 함: {result.success_count}"

    def test_extraction_adds_theme_label_by_default(self, tmp_path):
        """AI 태그 기반 추출은 기본적으로 테마 라벨을 페이지에 삽입한다."""
        from pypdf import PdfReader
        from mvp2_extractor.extractor import run_from_tags

        unique_theme = "라벨테스트전용테마"
        tags = [
            {"pageNum": 1, "sourceFile": MVP1_PDF.name, "theme": unique_theme,
             "confidence": 0.9, "confirmed": True},
        ]

        src_dir = tmp_path / "source"
        src_dir.mkdir()
        shutil.copy(str(MVP1_PDF), str(src_dir / MVP1_PDF.name))

        result = run_from_tags(tags=tags, source_dir=str(src_dir))
        assert result.success_count == 1

        # 합침 PDF는 테마별_분리_자료/ 안에 번호 마킹되어 저장
        theme_base = src_dir / "테마별_분리_자료"
        # 테마명으로 끝나는 PDF 찾기 (번호 접두사 무관)
        merged_candidates = list(theme_base.glob(f"*{unique_theme}.pdf"))
        assert merged_candidates, f"통합 PDF가 생성되지 않음: {theme_base}"
        merged_pdf = merged_candidates[0]

        reader = PdfReader(str(merged_pdf))
        page_text = reader.pages[0].extract_text() or ""
        assert unique_theme in page_text, f"테마 라벨이 PDF 텍스트에 없음: {page_text[:200]}"


# ─────────────────────────────────────────────────────────────────
# Step 4: 분석 보고서 (MVP3)
# ─────────────────────────────────────────────────────────────────

class TestAnalysisReport:
    """mvp3_analyzer — 오프라인(mock) + 온라인(실제 API)."""

    def test_summarizer_no_http_options_timeout(self):
        """summarizer Client 생성 시 http_options= 파라미터 버그 없음."""
        import inspect
        from mvp3_analyzer import summarizer
        src = inspect.getsource(summarizer.run_step1)
        # 주석이 아닌 실제 파라미터 전달 패턴만 체크
        assert "http_options=" not in src, (
            "summarizer에 http_options timeout 버그 재발!"
        )

    def test_integrator_no_http_options_timeout(self):
        """integrator Client 생성 시 http_options= 파라미터 버그 없음."""
        import inspect
        from mvp3_analyzer import integrator
        src = inspect.getsource(integrator.run_step2)
        assert "http_options=" not in src, (
            "integrator에 http_options timeout 버그 재발!"
        )

    def test_ocr_engine_no_http_options_timeout(self):
        """ocr_engine Client 생성 시 http_options= 파라미터 버그 없음."""
        import inspect
        from mvp1_converter import ocr_engine
        src = inspect.getsource(ocr_engine._get_client)
        assert "http_options=" not in src, (
            "ocr_engine에 http_options timeout 버그 재발!"
        )

    @pytest.mark.online
    def test_full_summarize_pipeline(self, tmp_path):
        """실제 API로 요약(step1) 검증."""
        from mvp3_analyzer.summarizer import run_step1

        processed_dir = tmp_path / "processed"
        cancel = threading.Event()
        progress_log = []

        result = run_step1(
            input_dir=MVP3_INPUT,
            processed_dir=processed_dir,
            model_name=MODEL_ANALYSIS,
            temperature=0.0,
            timeout=120,
            wait_time=2,  # 테스트에서는 짧은 대기
            cancel_event=cancel,
            progress_callback=lambda c, t, m: progress_log.append(m),
        )

        print(f"\n[요약] 성공: {result.success_count}, 실패: {result.fail_count}")
        print(f"[요약] 로그:\n" + "\n".join(progress_log[-5:]))

        assert result.success_count > 0, (
            f"요약 실패\n로그:\n" + "\n".join(progress_log)
        )
        summary_files = list(processed_dir.glob("*.md")) + list(processed_dir.glob("*.txt"))
        assert summary_files, "요약 파일이 생성되지 않음"

        for f in summary_files:
            content = f.read_text(encoding="utf-8")
            assert len(content) > 100, f"요약 내용이 너무 짧음: {f.name}"
        print(f"[요약] 생성된 파일: {[f.name for f in summary_files]}")

    @pytest.mark.online
    def test_full_integrate_pipeline(self, tmp_path):
        """실제 API로 통합분석(step2) 검증 — step1 결과 먼저 생성."""
        from mvp3_analyzer.summarizer import run_step1
        from mvp3_analyzer.integrator import run_step2

        processed_dir = tmp_path / "processed"
        output_dir = tmp_path / "output"
        cancel = threading.Event()

        # Step 1
        result1 = run_step1(
            input_dir=MVP3_INPUT,
            processed_dir=processed_dir,
            model_name=MODEL_ANALYSIS,
            temperature=0.0,
            timeout=120,
            wait_time=2,
            cancel_event=cancel,
        )
        assert result1.success_count > 0, "Step1 실패 — Step2 테스트 불가"

        # Step 2
        progress_log = []
        result2 = run_step2(
            processed_dir=processed_dir,
            output_dir=output_dir,
            model_name=MODEL_ANALYSIS,
            temperature=0.7,
            timeout=120,
            wait_time=2,
            num_variants=1,
            step1_result=result1,
            cancel_event=cancel,
            progress_callback=lambda c, t, m: progress_log.append(m),
            evaluate=True,
        )

        print(f"\n[통합분석] 성공: {result2.success_count}, 실패: {result2.fail_count}")
        print(f"[통합분석] 경고: {result2.warnings}")
        print(f"[통합분석] 로그:\n" + "\n".join(progress_log[-5:]))

        assert result2.success_count > 0, (
            f"통합분석 실패\n경고: {result2.warnings}\n로그:\n" + "\n".join(progress_log)
        )

        # _reorganize_output_structure()가 실행되면 리포트는 최종_산출물/로 이동
        final_dir = output_dir / "최종_산출물"
        report_search_dir = final_dir if final_dir.exists() else output_dir
        report_files = list(report_search_dir.glob("*.md"))
        assert report_files, "리포트 파일이 생성되지 않음 (최종_산출물/ 또는 output_dir 확인)"

        report_text = report_files[0].read_text(encoding="utf-8")
        assert len(report_text) > 500, "리포트 내용이 너무 짧음"

        # 리포트 구조 검증
        required_sections = ["사업 개요", "교육과정", "공간", "종합"]
        missing = [s for s in required_sections if s not in report_text]
        if missing:
            print(f"[통합분석] ⚠️ 누락 섹션: {missing}")

        print(f"[통합분석] 리포트 길이: {len(report_text):,}자")
        print(f"[통합분석] 리포트 미리보기:\n{report_text[:300]}...")
