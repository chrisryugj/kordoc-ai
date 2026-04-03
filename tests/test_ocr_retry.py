"""OCR 엔진 retry 로직 단위 테스트.

_analyze_page의 지수 백오프, 취소, 비-재시도 에러 처리를 검증합니다.
"""

from unittest.mock import MagicMock, patch
import threading

import pytest


@pytest.fixture
def ocr_config():
    return {
        "max_retries": 3,
        "base_delay": 0.01,  # 테스트용 짧은 딜레이
        "temperature": 0.0,
        "model_name": "gemini-test",
        "timeout_seconds": 10,
    }


@pytest.fixture
def mock_img_path(tmp_path):
    img = tmp_path / "001.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)  # 가짜 PNG
    return img


@pytest.fixture
def mock_gen_config():
    return MagicMock()


class TestAnalyzePageRetry:
    """_analyze_page 재시도 로직 테스트."""

    def _make_response(self, text="OCR 결과"):
        resp = MagicMock()
        resp.text = text
        resp.candidates = [MagicMock(content=MagicMock(parts=[MagicMock()]))]
        return resp

    @patch("src.mvp1_converter.ocr_engine.clean_text", side_effect=lambda x: x)
    @patch("src.mvp1_converter.ocr_engine._get_ocr_prompt", return_value="OCR 프롬프트")
    def test_success_first_try(self, _mock_prompt, _mock_clean,
                                mock_img_path, ocr_config, mock_gen_config):
        from src.mvp1_converter.ocr_engine import _analyze_page

        client = MagicMock()
        client.models.generate_content.return_value = self._make_response()

        result = _analyze_page(client, "gemini-test", mock_gen_config,
                               mock_img_path, 1, ocr_config)

        assert "OCR 결과" in result
        assert client.models.generate_content.call_count == 1

    @patch("src.mvp1_converter.ocr_engine.clean_text", side_effect=lambda x: x)
    @patch("src.mvp1_converter.ocr_engine._get_ocr_prompt", return_value="OCR 프롬프트")
    def test_retry_on_quota_error(self, _mock_prompt, _mock_clean,
                                   mock_img_path, ocr_config, mock_gen_config):
        """429 quota 에러 시 재시도 후 성공."""
        from src.mvp1_converter.ocr_engine import _analyze_page

        client = MagicMock()
        client.models.generate_content.side_effect = [
            Exception("429 Resource exhausted: quota"),
            self._make_response("재시도 성공"),
        ]

        result = _analyze_page(client, "gemini-test", mock_gen_config,
                               mock_img_path, 1, ocr_config)

        assert "재시도 성공" in result
        assert client.models.generate_content.call_count == 2

    @patch("src.mvp1_converter.ocr_engine.clean_text", side_effect=lambda x: x)
    @patch("src.mvp1_converter.ocr_engine._get_ocr_prompt", return_value="OCR 프롬프트")
    def test_retry_on_503_unavailable(self, _mock_prompt, _mock_clean,
                                       mock_img_path, ocr_config, mock_gen_config):
        """503 unavailable 에러 시 재시도."""
        from src.mvp1_converter.ocr_engine import _analyze_page

        client = MagicMock()
        client.models.generate_content.side_effect = [
            Exception("503 Service Unavailable"),
            Exception("503 Service Unavailable"),
            self._make_response("최종 성공"),
        ]

        result = _analyze_page(client, "gemini-test", mock_gen_config,
                               mock_img_path, 1, ocr_config)

        assert "최종 성공" in result
        assert client.models.generate_content.call_count == 3

    @patch("src.mvp1_converter.ocr_engine.clean_text", side_effect=lambda x: x)
    @patch("src.mvp1_converter.ocr_engine._get_ocr_prompt", return_value="OCR 프롬프트")
    def test_no_retry_on_non_transient_error(self, _mock_prompt, _mock_clean,
                                              mock_img_path, ocr_config, mock_gen_config):
        """비-재시도 에러는 즉시 실패."""
        from src.mvp1_converter.ocr_engine import _analyze_page

        client = MagicMock()
        client.models.generate_content.side_effect = ValueError("Invalid argument")

        result = _analyze_page(client, "gemini-test", mock_gen_config,
                               mock_img_path, 1, ocr_config)

        assert "분석 실패" in result
        assert client.models.generate_content.call_count == 1

    @patch("src.mvp1_converter.ocr_engine.clean_text", side_effect=lambda x: x)
    @patch("src.mvp1_converter.ocr_engine._get_ocr_prompt", return_value="OCR 프롬프트")
    def test_max_retries_exceeded(self, _mock_prompt, _mock_clean,
                                   mock_img_path, ocr_config, mock_gen_config):
        """최대 재시도 초과 시 실패 메시지 (마지막 attempt에서 non-retryable 분기)."""
        from src.mvp1_converter.ocr_engine import _analyze_page

        client = MagicMock()
        client.models.generate_content.side_effect = Exception("429 quota exceeded")

        result = _analyze_page(client, "gemini-test", mock_gen_config,
                               mock_img_path, 1, ocr_config)

        assert "분석 실패" in result
        assert client.models.generate_content.call_count == 3

    @patch("src.mvp1_converter.ocr_engine.clean_text", side_effect=lambda x: x)
    @patch("src.mvp1_converter.ocr_engine._get_ocr_prompt", return_value="OCR 프롬프트")
    def test_cancel_during_retry_wait(self, _mock_prompt, _mock_clean,
                                       mock_img_path, ocr_config, mock_gen_config):
        """재시도 대기 중 취소 이벤트 감지."""
        from src.mvp1_converter.ocr_engine import _analyze_page

        client = MagicMock()
        client.models.generate_content.side_effect = Exception("429 quota exceeded")

        cancel = threading.Event()
        # 첫 번째 실패 후 취소
        def cancel_on_wait(_timeout):
            cancel.set()
            return True
        cancel.wait = cancel_on_wait

        result = _analyze_page(client, "gemini-test", mock_gen_config,
                               mock_img_path, 1, ocr_config, cancel_event=cancel)

        assert "취소됨" in result

    @patch("src.mvp1_converter.ocr_engine.clean_text", side_effect=lambda x: x)
    @patch("src.mvp1_converter.ocr_engine._get_ocr_prompt", return_value="OCR 프롬프트")
    def test_cancel_before_start(self, _mock_prompt, _mock_clean,
                                  mock_img_path, ocr_config, mock_gen_config):
        """시작 전 취소 이벤트가 설정되어 있으면 즉시 반환."""
        from src.mvp1_converter.ocr_engine import _analyze_page

        client = MagicMock()
        cancel = threading.Event()
        cancel.set()

        result = _analyze_page(client, "gemini-test", mock_gen_config,
                               mock_img_path, 1, ocr_config, cancel_event=cancel)

        assert "취소됨" in result
        assert client.models.generate_content.call_count == 0

    @patch("src.mvp1_converter.ocr_engine.clean_text", side_effect=lambda x: x)
    @patch("src.mvp1_converter.ocr_engine._get_ocr_prompt", return_value="OCR 프롬프트")
    def test_safety_filter_blocked(self, _mock_prompt, _mock_clean,
                                    mock_img_path, ocr_config, mock_gen_config):
        """안전 필터 차단 시 적절한 메시지 반환."""
        from src.mvp1_converter.ocr_engine import _analyze_page

        resp = MagicMock()
        resp.candidates = []  # 빈 candidates = 차단

        client = MagicMock()
        client.models.generate_content.return_value = resp

        result = _analyze_page(client, "gemini-test", mock_gen_config,
                               mock_img_path, 1, ocr_config)

        assert "안전 필터 차단" in result


class TestDetectPdfEngine:
    """_detect_pdf_engine 테스트."""

    def test_explicit_pymupdf(self):
        from src.mvp1_converter.ocr_engine import _detect_pdf_engine
        assert _detect_pdf_engine({"pdf_engine": "pymupdf"}) == "pymupdf"

    def test_explicit_poppler(self):
        from src.mvp1_converter.ocr_engine import _detect_pdf_engine
        assert _detect_pdf_engine({"pdf_engine": "poppler"}) == "poppler"
