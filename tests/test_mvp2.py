"""MVP 2 통합 테스트.

외부 API 없이 실행 가능합니다 (오프라인 테스트).
사전 조건: python tests/create_test_data.py 먼저 실행

실행: pytest tests/test_mvp2.py -v

참고: TestMvp2Extraction 내 테스트는 test_full_extraction이 먼저 실행되어야
테마 폴더/통합 PDF가 존재함. 별도 테스트 클래스(TestParsePageNumbers 등)는
독립적으로 실행 가능.
"""

import os
import shutil

import pytest
import yaml


# ============================================================
# 페이지 번호 파싱 (독립 단위 테스트)
# ============================================================

class TestParsePageNumbers:
    @pytest.fixture
    def parse(self):
        from src.mvp2_extractor.extractor import _parse_page_numbers
        return _parse_page_numbers

    def test_single_page(self, parse):
        assert parse("3") == {3}

    def test_comma_separated(self, parse):
        assert parse("1, 3, 5") == {1, 3, 5}

    def test_range(self, parse):
        assert parse("2-5") == {2, 3, 4, 5}

    def test_mixed(self, parse):
        assert parse("1, 3-5, 8") == {1, 3, 4, 5, 8}

    def test_none(self, parse):
        assert parse(None) == set()

    def test_dash_only(self, parse):
        assert parse("-") == set()

    def test_empty_string(self, parse):
        assert parse("") == set()

    def test_float_from_excel(self, parse):
        assert parse(3.0) == {3}

    def test_semicolon(self, parse):
        assert parse("1;3;5") == {1, 3, 5}

    def test_newline(self, parse):
        assert parse("1\n3\n5") == {1, 3, 5}


class TestParsePageNumbersEdge:
    @pytest.fixture
    def parse(self):
        from src.mvp2_extractor.extractor import _parse_page_numbers
        return _parse_page_numbers

    def test_negative(self, parse):
        assert parse("-1") == set()

    def test_zero(self, parse):
        assert parse("0") == {0}

    def test_large_number(self, parse):
        assert 999999 in parse("999999")

    def test_whitespace_only(self, parse):
        assert parse("   ") == set()

    def test_invalid_format(self, parse):
        assert parse("abc") == set()

    def test_mixed_invalid(self, parse):
        assert {1, 3}.issubset(parse("1,abc,3"))

    def test_reversed_range(self, parse):
        assert parse("5-2") == set()


# ============================================================
# COLOR_MAP
# ============================================================

class TestColorMap:
    def test_standard_colors(self):
        from src.mvp2_extractor.extractor import _COLOR_MAP
        assert "red" in _COLOR_MAP
        assert "blue" in _COLOR_MAP
        assert "black" in _COLOR_MAP
        assert "gray" in _COLOR_MAP
        assert _COLOR_MAP["red"] == [255, 0, 0]


# ============================================================
# 통합 테스트: 페이지 추출 + 라벨링
# ============================================================

class TestMvp2Extraction:
    def test_full_extraction(self, test_data):
        """MVP 2 페이지 추출 + 라벨링 전체 테스트."""
        mvp2_dir = test_data / "mvp2"
        source_dir = mvp2_dir / "source"

        if not (source_dir / "1_사업계획서.pdf").exists():
            pytest.skip("테스트 데이터 없음. 먼저 실행: python tests/create_test_data.py")

        test_config_path = test_data / "test_settings.yaml"
        if not test_config_path.exists():
            pytest.skip("테스트 설정 없음")

        with open(test_config_path, "r", encoding="utf-8") as f:
            all_config = yaml.safe_load(f)
        config = all_config["mvp2"]
        # 상대경로 → 절대경로 변환 (CI/로컬 모두 동작)
        if not os.path.isabs(config.get("base_dir", "")):
            config["base_dir"] = str(test_data / config["base_dir"])

        # 이전 실행 결과 정리
        theme_base = mvp2_dir / "테마별_분리_자료"
        if theme_base.exists():
            shutil.rmtree(theme_base, ignore_errors=True)
        for folder_name in config.get("topic_folders", {}).values():
            topic_dir = mvp2_dir / folder_name
            if topic_dir.exists():
                shutil.rmtree(topic_dir, ignore_errors=True)

        # 실행
        from src.shared.logger import setup_logger
        import logging
        logger = logging.getLogger("mvp")
        logger.handlers.clear()
        setup_logger("mvp", str(test_data.parent / "test_logs"))

        from src.mvp2_extractor.extractor import run
        result = run(config)

        # 결과 검증
        assert result is not None
        assert result.total > 0
        assert result.success_count > 0
        assert len(result.summary()) > 0

    def test_topic_folders_created(self, test_data):
        """테마별 폴더 생성 확인."""
        mvp2_dir = test_data / "mvp2"
        expected_folders = ["a_학급수 및 학생수", "b_각종 면적", "c_사업 유형",
                           "d_사업 기간", "f_사업비 내역"]
        for folder in expected_folders:
            folder_path = mvp2_dir / folder
            if not folder_path.exists():
                pytest.skip("추출 결과 없음 — test_full_extraction 먼저 실행")
            pdfs = list(folder_path.glob("*.pdf"))
            assert len(pdfs) > 0, f"{folder}에 PDF 없음"

    def test_merged_pdfs_created(self, test_data):
        """통합 PDF 생성 확인."""
        mvp2_dir = test_data / "mvp2"
        expected = ["a_학급수 및 학생수", "b_각종 면적", "c_사업 유형",
                    "d_사업 기간", "f_사업비 내역"]
        for folder in expected:
            merged = mvp2_dir / f"{folder}.pdf"
            if not merged.exists():
                pytest.skip("추출 결과 없음 — test_full_extraction 먼저 실행")

    def test_empty_topics_no_pdf(self, test_data):
        """비어있는 테마에 통합 PDF가 생성되지 않음."""
        mvp2_dir = test_data / "mvp2"
        empty_folders = ["e_설계발주방식", "g_스페이스 프로그램", "h_설문조사 결과"]
        for folder in empty_folders:
            merged = mvp2_dir / f"{folder}.pdf"
            assert not merged.exists(), f"빈 테마에 PDF가 생성됨: {folder}"

    def test_label_overlay(self, test_data):
        """라벨 오버레이 존재 확인."""
        try:
            from pypdf import PdfReader
        except ImportError:
            pytest.skip("pypdf 미설치")

        sample_folder = test_data / "mvp2" / "a_학급수 및 학생수"
        if not sample_folder.exists():
            pytest.skip("추출 결과 없음")

        sample_pdfs = list(sample_folder.glob("*.pdf"))
        if not sample_pdfs:
            pytest.skip("PDF 파일 없음")

        reader = PdfReader(str(sample_pdfs[0]))
        page_text = reader.pages[0].extract_text() or ""
        assert len(page_text) > 0, "라벨 오버레이 텍스트가 없음"
