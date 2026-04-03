"""MVP 1 오프라인 테스트 (API 호출 없이).

텍스트 정제, 설정 로드, 파이프라인 구조만 검증합니다.
OCR 자체는 API 키가 필요하므로 test_mvp1_online.py에서 테스트합니다.

실행: pytest tests/test_mvp1_offline.py -v
"""

import pytest


# ============================================================
# 텍스트 정제 (고급)
# ============================================================

class TestTextCleanerAdvanced:
    def test_ocr_like_text(self):
        from src.mvp1_converter.text_cleaner import clean_text

        ocr_like = """## 학교 현황

| 항목 | 내용 |
| --- | --- |
| 학교명 | 광진초등학교 |
| 학급수 | 24학급 |
| 학생수 | 650명 |

---

다음 섹션으로 넘어갑니다.

==================================

## 사업 개요

총 사업비는 150억원입니다.
총 사업비는 150억원입니다.

■ ◆ ★ ●
"""
        result = clean_text(ocr_like)
        assert "| 항목 | 내용 |" in result
        assert "광진초등학교" in result
        assert "---" in result  # 짧은 구분선 유지
        assert "=" * 20 not in result  # 긴 구분선 제거
        assert result.count("총 사업비는 150억원입니다") == 1  # 중복 제거
        assert "■ ◆ ★ ●" not in result  # 특수문자 줄 제거
        assert "사업 개요" in result


# ============================================================
# 테스트 데이터 확인
# ============================================================

class TestPdfExists:
    def test_test_pdf_exists(self, test_data):
        pdf_path = test_data / "mvp1" / "test_document.pdf"
        if not pdf_path.exists():
            pytest.skip("테스트 PDF 없음. 먼저 실행: python tests/create_test_data.py")

        assert pdf_path.stat().st_size > 0

    def test_pdf_page_count(self, test_data):
        pdf_path = test_data / "mvp1" / "test_document.pdf"
        if not pdf_path.exists():
            pytest.skip("테스트 PDF 없음")

        try:
            from pypdf import PdfReader
        except ImportError:
            pytest.skip("pypdf 미설치")

        reader = PdfReader(str(pdf_path))
        assert len(reader.pages) == 3


# ============================================================
# MVP 1 설정 검증
# ============================================================

class TestConfigMvp1:
    def test_required_keys(self):
        from src.shared.config import get_config
        config = get_config("mvp1")
        assert "target_dir" in config
        assert "model_name" in config
        assert "max_workers" in config
        assert isinstance(config["max_workers"], int)
        assert "chunk_size" in config
        assert "pdf_engine" in config


# ============================================================
# 모듈 임포트
# ============================================================

class TestModuleImport:
    def test_pipeline_import(self):
        from src.mvp1_converter.pipeline import run
        assert callable(run)

    def test_ocr_engine_import(self):
        from src.mvp1_converter.ocr_engine import process_all_pdfs
        assert callable(process_all_pdfs)

    def test_hwp_to_pdf_import(self):
        try:
            from src.mvp1_converter.hwp_to_pdf import convert_all_hwp_to_pdf
            assert callable(convert_all_hwp_to_pdf)
        except ImportError as e:
            if "pyhwpx" in str(e):
                pytest.skip("pyhwpx 미설치 (Windows+한컴 필요)")
            raise
