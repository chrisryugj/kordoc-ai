"""page_tagger 단위 테스트 — Gemini API mock 기반.

테스트 대상:
  - _parse_response: JSON 응답 파싱
  - _resolve_pdf_files: 파일 경로 해석
  - _fallback_tags: 폴백 태그 생성
  - _classify_batch: API 호출 + 응답 파싱 (mock)
  - _classify_text_batch: 텍스트 기반 배치 분류 (mock)
"""

import json
import threading
from unittest.mock import MagicMock

import pytest

from src.mvp1_converter.page_tagger import (
    _parse_response,
    _resolve_pdf_files,
    _fallback_tags,
    _classify_batch,
    _classify_text_batch,
    THEMES,
)


# ── _parse_response ──────────────────────────────────────────────


class TestParseResponse:
    """Gemini 응답 JSON 파싱 로직 테스트."""

    def test_batch_array_response(self):
        """배치 모드: JSON 배열 응답 파싱."""
        valid_images = [(0, b"img0"), (1, b"img1"), (2, b"img2")]
        text = json.dumps([
            {"page": 1, "theme": "학급수 및 학생수", "confidence": 0.95},
            {"page": 2, "theme": "각종 면적", "confidence": 0.80},
            {"page": 3, "theme": "사업 유형", "confidence": 0.70},
        ])
        result = _parse_response(text, valid_images, use_batch=True)
        assert result[0] == ("학급수 및 학생수", 0.95)
        assert result[1] == ("각종 면적", 0.80)
        assert result[2] == ("사업 유형", 0.70)

    def test_single_dict_response(self):
        """단일 모드: JSON 딕셔너리 응답 파싱."""
        valid_images = [(5, b"img")]
        text = json.dumps({"theme": "사업 기간", "confidence": 0.9})
        result = _parse_response(text, valid_images, use_batch=False)
        assert result[5] == ("사업 기간", 0.9)

    def test_markdown_code_fence_stripped(self):
        """마크다운 코드 펜스 제거 후 파싱."""
        valid_images = [(0, b"img")]
        text = '```json\n{"theme": "사업비 내역", "confidence": 0.85}\n```'
        result = _parse_response(text, valid_images, use_batch=False)
        assert result[0] == ("사업비 내역", 0.85)

    def test_unknown_theme_falls_back_to_gita(self):
        """정의되지 않은 테마 → '기타'로 폴백, confidence 0.3."""
        valid_images = [(0, b"img")]
        text = json.dumps({"theme": "존재하지않는테마", "confidence": 0.99})
        result = _parse_response(text, valid_images, use_batch=False)
        assert result[0] == ("기타", 0.3)

    def test_batch_page_index_out_of_range(self):
        """배치에서 page 인덱스가 범위 밖이면 순서 기반 폴백."""
        valid_images = [(10, b"img0"), (11, b"img1")]
        text = json.dumps([
            {"page": 99, "theme": "각종 면적", "confidence": 0.5},
            {"page": 2, "theme": "사업 유형", "confidence": 0.6},
        ])
        result = _parse_response(text, valid_images, use_batch=True)
        # page 99 → out of range → fallback to index 0 → page_num 10
        assert 10 in result
        # page 2 → valid → valid_images[1] → page_num 11
        assert 11 in result

    def test_empty_response(self):
        """빈 JSON 배열 → 빈 결과."""
        valid_images = [(0, b"img")]
        text = "[]"
        result = _parse_response(text, valid_images, use_batch=True)
        assert result == {}

    def test_invalid_json_raises(self):
        """잘못된 JSON → JSONDecodeError."""
        valid_images = [(0, b"img")]
        with pytest.raises(json.JSONDecodeError):
            _parse_response("not json at all", valid_images, use_batch=True)


# ── _resolve_pdf_files ───────────────────────────────────────────


class TestResolvePdfFiles:
    """PDF 파일 경로 해석 로직."""

    def test_empty_files_scans_directory(self, tmp_path):
        """files=None이면 ocr_path에서 *.pdf 스캔."""
        (tmp_path / "a.pdf").touch()
        (tmp_path / "b.pdf").touch()
        (tmp_path / "c.txt").touch()  # 무시
        result = _resolve_pdf_files(tmp_path, None)
        assert len(result) == 2
        assert all(p.suffix == ".pdf" for p in result)

    def test_explicit_pdf_paths(self, tmp_path):
        """명시적 파일 경로 지정."""
        pdf = tmp_path / "test.pdf"
        pdf.touch()
        result = _resolve_pdf_files(tmp_path, [str(pdf)])
        assert len(result) == 1
        assert result[0] == pdf

    def test_hwp_converted_to_pdf(self, tmp_path):
        """HWP 경로 → 같은 이름 PDF로 변환 검색."""
        hwp = tmp_path / "doc.hwp"
        pdf = tmp_path / "doc.pdf"
        hwp.touch()
        pdf.touch()
        result = _resolve_pdf_files(tmp_path, [str(hwp)])
        assert len(result) == 1
        assert result[0] == pdf

    def test_nonexistent_file_ignored(self, tmp_path):
        """존재하지 않는 파일은 무시."""
        result = _resolve_pdf_files(tmp_path, ["/nonexistent/file.pdf"])
        # fallback to directory scan (no PDFs)
        assert len(result) == 0

    def test_deduplication(self, tmp_path):
        """중복 경로 제거."""
        pdf = tmp_path / "same.pdf"
        pdf.touch()
        result = _resolve_pdf_files(tmp_path, [str(pdf), str(pdf)])
        assert len(result) == 1


# ── _fallback_tags ───────────────────────────────────────────────


class TestFallbackTags:
    """이미지 없을 때 기타 태그 생성."""

    def test_generates_gita_tags(self):
        batch_images = [(0, None), (1, None), (2, None)]
        result = _fallback_tags(batch_images, "test.pdf")
        assert len(result) == 3
        assert all(t["theme"] == "기타" for t in result)
        assert all(t["confidence"] == 0.0 for t in result)
        assert result[0]["pageNum"] == 1
        assert result[2]["pageNum"] == 3
        assert all(t["sourceFile"] == "test.pdf" for t in result)


# ── _classify_batch (mocked API) ─────────────────────────────────


class TestClassifyBatch:
    """Gemini API 배치 분류 — mock 기반."""

    @pytest.fixture(autouse=True)
    def _mock_genai(self, monkeypatch):
        """google.genai 모듈 mock (미설치 환경 대응)."""
        import sys
        mock_types = MagicMock()
        mock_types.Part.from_bytes.return_value = MagicMock()
        monkeypatch.setitem(sys.modules, "google.genai", MagicMock())
        monkeypatch.setitem(sys.modules, "google.genai.types", mock_types)

    def _make_mock_client(self, response_text: str):
        """mock client + response 생성."""
        mock_response = MagicMock()
        mock_response.text = response_text
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response
        return mock_client

    def test_successful_batch_classification(self):
        """정상 배치 분류."""
        response_json = json.dumps([
            {"page": 1, "theme": "학급수 및 학생수", "confidence": 0.9},
            {"page": 2, "theme": "각종 면적", "confidence": 0.8},
        ])
        client = self._make_mock_client(response_json)
        cancel = threading.Event()
        progress = MagicMock()

        valid_images = [(0, b"img0"), (1, b"img1")]
        result = _classify_batch(
            client, "gemini-test", MagicMock(),
            valid_images, cancel, progress, 0, 10,
        )
        assert 0 in result
        assert 1 in result
        assert result[0][0] == "학급수 및 학생수"
        client.models.generate_content.assert_called_once()

    def test_cancel_returns_empty(self):
        """cancel_event 설정 시 빈 결과 반환."""
        client = MagicMock()
        cancel = threading.Event()
        cancel.set()

        result = _classify_batch(
            client, "gemini-test", MagicMock(),
            [(0, b"img")], cancel, MagicMock(), 0, 10,
        )
        assert result == {}
        client.models.generate_content.assert_not_called()

    def test_api_error_retries(self):
        """API 429 에러 → 재시도."""
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = [
            Exception("429 Resource exhausted"),
            MagicMock(text=json.dumps({"theme": "기타", "confidence": 0.5})),
        ]
        cancel = threading.Event()
        progress = MagicMock()

        result = _classify_batch(
            mock_client, "gemini-test", MagicMock(),
            [(0, b"img")], cancel, progress, 0, 10,
        )
        # 재시도 후 성공
        assert 0 in result
        assert mock_client.models.generate_content.call_count == 2


# ── _classify_text_batch (mocked API) ────────────────────────────


class TestClassifyTextBatch:
    """Gemini 텍스트 기반 배치 분류 — mock 기반."""

    def test_successful_text_batch_classification(self):
        """정상 배치 텍스트 분류."""
        response_json = json.dumps([
            {"page": 1, "theme": "사업 기간", "confidence": 0.85},
            {"page": 2, "theme": "각종 면적", "confidence": 0.75},
        ])
        mock_response = MagicMock()
        mock_response.text = response_json
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response

        cancel = threading.Event()
        result = _classify_text_batch(
            mock_client, "gemini-test", MagicMock(),
            ["사업 기간 관련 내용 입니다." * 3, "면적 관련 내용 입니다." * 3],
            [1, 2],
            cancel, MagicMock(), 0, 2,
        )
        assert 1 in result
        assert 2 in result
        assert result[1][0] == "사업 기간"
        assert result[2][0] == "각종 면적"

    def test_cancel_returns_empty(self):
        """cancel 시 빈 결과 반환."""
        cancel = threading.Event()
        cancel.set()
        result = _classify_text_batch(
            MagicMock(), "test", MagicMock(),
            ["text content here for classification"], [1],
            cancel, MagicMock(), 0, 1,
        )
        assert result == {}

    def test_invalid_theme_falls_back(self):
        """유효하지 않은 테마 → '기타' 폴백."""
        mock_response = MagicMock()
        mock_response.text = json.dumps([{"page": 5, "theme": "없는테마", "confidence": 0.99}])
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response

        cancel = threading.Event()
        result = _classify_text_batch(
            mock_client, "test", MagicMock(),
            ["이 페이지는 없는테마에 해당합니다. 내용이 충분히 있어서 분류가 가능합니다."],
            [5],
            cancel, MagicMock(), 0, 1,
        )
        assert 5 in result
        assert result[5] == ("기타", 0.3)

    def test_short_text_filtered_out(self):
        """30자 미만 텍스트는 API 호출 없이 빈 결과."""
        mock_client = MagicMock()
        cancel = threading.Event()
        result = _classify_text_batch(
            mock_client, "test", MagicMock(),
            ["짧음"],  # < 30 chars
            [1],
            cancel, MagicMock(), 0, 1,
        )
        assert result == {}
        mock_client.models.generate_content.assert_not_called()

    def test_confidence_string_fallback(self):
        """confidence가 문자열 '0.0~1.0'이어도 파싱 오류 없음."""
        mock_response = MagicMock()
        mock_response.text = json.dumps([
            {"page": 1, "theme": "사업 유형", "confidence": "0.0~1.0"},
        ])
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response

        cancel = threading.Event()
        result = _classify_text_batch(
            mock_client, "test", MagicMock(),
            ["사업 유형 관련 내용입니다. 신설 증축 개축 리모델링 등의 내용"],
            [1],
            cancel, MagicMock(), 0, 1,
        )
        # confidence 파싱 실패해도 기본값(0.5)으로 처리
        assert 1 in result
        assert result[1][0] == "사업 유형"
        assert result[1][1] == 0.5
