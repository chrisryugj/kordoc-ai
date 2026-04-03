"""MVP 3 오프라인 테스트 (mock Gemini Client).

외부 API 없이 summarizer/integrator 로직을 검증합니다.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch
import threading

import pytest


# ============================================================
# Summarizer (Step 1) 테스트
# ============================================================

class TestSummarizer:
    """run_step1 단위 테스트."""

    @pytest.fixture
    def input_dir(self, tmp_path):
        d = tmp_path / "ocr_output"
        d.mkdir()
        (d / "학교A.txt").write_text("학급수 24, 학생수 600명", encoding="utf-8")
        (d / "학교B.md").write_text("부지면적 15,000㎡", encoding="utf-8")
        return d

    @pytest.fixture
    def processed_dir(self, tmp_path):
        return tmp_path / "processed"

    def _mock_response(self, text="요약 결과입니다."):
        resp = MagicMock()
        resp.text = text
        return resp

    @patch("src.mvp3_analyzer.summarizer.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.summarizer.genai")
    def test_basic_run(self, mock_genai, _mock_key, input_dir, processed_dir):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = self._mock_response()
        mock_genai.Client.return_value = mock_client

        from src.mvp3_analyzer.summarizer import run_step1
        result = run_step1(
            input_dir=input_dir,
            processed_dir=processed_dir,
            model_name="gemini-test",
            temperature=0.0,
            timeout=30,
            wait_time=0,
        )

        assert result.total == 2
        assert result.success_count == 2
        assert result.fail_count == 0
        # 요약 파일 생성 확인
        summaries = list(processed_dir.glob("summary_*"))
        assert len(summaries) == 2

    @patch("src.mvp3_analyzer.summarizer.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.summarizer.genai")
    def test_cache_skip(self, mock_genai, _mock_key, input_dir, processed_dir):
        """이미 처리된 파일은 캐시로 건너뜀."""
        processed_dir.mkdir(parents=True)
        (processed_dir / "summary_학교A.txt").write_text("기존 요약", encoding="utf-8")

        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = self._mock_response()
        mock_genai.Client.return_value = mock_client

        from src.mvp3_analyzer.summarizer import run_step1
        result = run_step1(
            input_dir=input_dir,
            processed_dir=processed_dir,
            model_name="gemini-test",
            temperature=0.0,
            timeout=30,
            wait_time=0,
        )

        assert result.total == 2
        # API는 1번만 호출 (학교B만)
        assert mock_client.models.generate_content.call_count == 1

    @patch("src.mvp3_analyzer.summarizer.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.summarizer.genai")
    def test_cancel_event(self, mock_genai, _mock_key, input_dir, processed_dir):
        """cancel_event가 설정되면 즉시 중단."""
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        cancel = threading.Event()
        cancel.set()  # 시작 전에 취소

        from src.mvp3_analyzer.summarizer import run_step1
        result = run_step1(
            input_dir=input_dir,
            processed_dir=processed_dir,
            model_name="gemini-test",
            temperature=0.0,
            timeout=30,
            wait_time=0,
            cancel_event=cancel,
        )

        assert result.total == 0
        assert mock_client.models.generate_content.call_count == 0

    @patch("src.mvp3_analyzer.summarizer.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.summarizer.genai")
    def test_api_error_continues(self, mock_genai, _mock_key, input_dir, processed_dir):
        """API 오류 시 해당 파일만 실패, 나머지 계속 처리."""
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = [
            Exception("API quota exceeded"),
            self._mock_response("정상 요약"),
        ]
        mock_genai.Client.return_value = mock_client

        from src.mvp3_analyzer.summarizer import run_step1
        result = run_step1(
            input_dir=input_dir,
            processed_dir=processed_dir,
            model_name="gemini-test",
            temperature=0.0,
            timeout=30,
            wait_time=0,
        )

        assert result.total == 2
        assert result.success_count == 1
        assert result.fail_count == 1

    @patch("src.mvp3_analyzer.summarizer.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.summarizer.genai")
    def test_empty_input_dir(self, mock_genai, _mock_key, tmp_path):
        """입력 디렉토리가 비어있으면 빈 Result 반환."""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        processed_dir = tmp_path / "processed"

        from src.mvp3_analyzer.summarizer import run_step1
        result = run_step1(
            input_dir=empty_dir,
            processed_dir=processed_dir,
            model_name="gemini-test",
            temperature=0.0,
            timeout=30,
            wait_time=0,
        )

        assert result.total == 0

    @patch("src.mvp3_analyzer.summarizer.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.summarizer.genai")
    def test_safety_filter_blocked(self, mock_genai, _mock_key, input_dir, processed_dir):
        """안전 필터 차단 시 실패로 기록."""
        resp = MagicMock()
        resp.text = None  # text 프로퍼티가 None
        # ValueError를 발생시키도록 설정
        type(resp).text = property(lambda self: (_ for _ in ()).throw(ValueError("blocked")))
        resp.candidates = [MagicMock(finish_reason="SAFETY")]

        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = resp
        mock_genai.Client.return_value = mock_client

        from src.mvp3_analyzer.summarizer import run_step1
        result = run_step1(
            input_dir=input_dir,
            processed_dir=processed_dir,
            model_name="gemini-test",
            temperature=0.0,
            timeout=30,
            wait_time=0,
        )

        assert result.fail_count == 2  # 안전 필터 차단 = 실패로 기록
        assert result.success_count == 0


# ============================================================
# Integrator (Step 2) 테스트
# ============================================================

class TestIntegrator:
    """run_step2 단위 테스트."""

    @pytest.fixture
    def processed_dir(self, tmp_path):
        d = tmp_path / "processed"
        d.mkdir()
        (d / "summary_학교A.txt").write_text("학급수 24, 학생수 600명 요약", encoding="utf-8")
        (d / "summary_학교B.txt").write_text("부지면적 15,000㎡ 요약", encoding="utf-8")
        return d

    @pytest.fixture
    def output_dir(self, tmp_path):
        return tmp_path / "output"

    def _mock_response(self, text="# 통합 분석 리포트\n\n분석 내용"):
        resp = MagicMock()
        resp.text = text
        return resp

    @patch("src.mvp3_analyzer.integrator.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.integrator.genai")
    def test_single_variant(self, mock_genai, _mock_key, processed_dir, output_dir):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = self._mock_response()
        mock_genai.Client.return_value = mock_client

        from src.mvp3_analyzer.integrator import run_step2
        result = run_step2(
            processed_dir=processed_dir,
            output_dir=output_dir,
            model_name="gemini-test",
            temperature=0.3,
            timeout=60,
            wait_time=0,
            num_variants=1,
        )

        assert result.success_count >= 1
        # 새 구조: 리포트는 output_dir 최상단에 저장
        report = output_dir / "통합 분석 리포트.md"
        assert report.exists(), f"리포트가 최상단에 없음: {list(output_dir.glob('*.md'))}"
        assert "통합 분석 리포트" in report.read_text(encoding="utf-8")

    @patch("src.mvp3_analyzer.integrator.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.integrator.genai")
    def test_multiple_variants(self, mock_genai, _mock_key, processed_dir, output_dir):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = self._mock_response()
        mock_genai.Client.return_value = mock_client

        from src.mvp3_analyzer.integrator import run_step2
        result = run_step2(
            processed_dir=processed_dir,
            output_dir=output_dir,
            model_name="gemini-test",
            temperature=0.5,
            timeout=60,
            wait_time=0,
            num_variants=2,
        )

        assert result.success_count >= 2
        # 새 구조: 리포트는 output_dir 최상단
        assert (output_dir / "통합 분석 리포트 1.md").exists()
        assert (output_dir / "통합 분석 리포트 2.md").exists()

    @patch("src.mvp3_analyzer.integrator.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.integrator.genai")
    def test_step1_failure_warning(self, mock_genai, _mock_key, processed_dir, output_dir):
        """Step1 실패가 있으면 경고 메시지 포함."""
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = self._mock_response()
        mock_genai.Client.return_value = mock_client

        from src.shared.result import Result
        step1_result = Result()
        step1_result.add_success("file1.txt")
        step1_result.add_failure("file2.txt", "API error")

        from src.mvp3_analyzer.integrator import run_step2
        result = run_step2(
            processed_dir=processed_dir,
            output_dir=output_dir,
            model_name="gemini-test",
            temperature=0.3,
            timeout=60,
            wait_time=0,
            num_variants=1,
            step1_result=step1_result,
        )

        assert result.success_count >= 1
        assert len(result.warnings) >= 1
        assert any("실패" in w for w in result.warnings)

    @patch("src.mvp3_analyzer.integrator.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.integrator.genai")
    def test_empty_processed_dir(self, mock_genai, _mock_key, tmp_path):
        """요약 파일이 없으면 빈 Result 반환."""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()

        from src.mvp3_analyzer.integrator import run_step2
        result = run_step2(
            processed_dir=empty_dir,
            output_dir=tmp_path / "output",
            model_name="gemini-test",
            temperature=0.3,
            timeout=60,
            wait_time=0,
            num_variants=1,
        )

        assert result.total == 0

    @patch("src.mvp3_analyzer.integrator.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.integrator.genai")
    def test_cancel_event(self, mock_genai, _mock_key, processed_dir, output_dir):
        """cancel_event가 시작 전에 설정되면 API 호출 없이 즉시 종료."""
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client

        cancel = threading.Event()
        cancel.set()  # 시작 전에 취소

        from src.mvp3_analyzer.integrator import run_step2
        result = run_step2(
            processed_dir=processed_dir,
            output_dir=output_dir,
            model_name="gemini-test",
            temperature=0.3,
            timeout=60,
            wait_time=0,
            num_variants=1,
            cancel_event=cancel,
        )

        # 취소 시 generate_content(통합분석) 호출 없음
        assert mock_client.models.generate_content.call_count == 0
        # 통합 분석 리포트 파일은 생성되지 않아야 함
        # (summary sheet는 취소와 무관하게 생성될 수 있음)
        final_dir = output_dir / "최종_산출물"
        report_search_dir = final_dir if final_dir.exists() else output_dir
        report_files = list(report_search_dir.glob("통합 분석 리포트*.md"))
        assert len(report_files) == 0, f"취소 후 리포트가 생성되었음: {report_files}"

    @patch("src.mvp3_analyzer.integrator.ensure_api_key", return_value="fake-key")
    @patch("src.mvp3_analyzer.integrator.genai")
    def test_progress_callback(self, mock_genai, _mock_key, processed_dir, output_dir):
        """progress_callback이 올바르게 호출되는지 확인."""
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = self._mock_response()
        mock_genai.Client.return_value = mock_client

        progress_calls = []

        from src.mvp3_analyzer.integrator import run_step2
        run_step2(
            processed_dir=processed_dir,
            output_dir=output_dir,
            model_name="gemini-test",
            temperature=0.3,
            timeout=60,
            wait_time=0,
            num_variants=1,
            progress_callback=lambda cur, total, msg: progress_calls.append((cur, total, msg)),
        )

        assert len(progress_calls) >= 2  # 최소 진행 + 완료
        # 마지막 콜백은 완료
        assert progress_calls[-1][0] == progress_calls[-1][1]
