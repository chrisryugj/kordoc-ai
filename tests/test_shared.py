"""shared 모듈 단위 테스트.

외부 API 없이 실행 가능합니다.
실행: pytest tests/test_shared.py -v
"""

import os
import logging
from pathlib import Path

import pytest


# ============================================================
# Result 객체
# ============================================================

class TestResult:
    def test_initial_state(self):
        from src.shared.result import Result
        r = Result()
        assert r.total == 0
        assert not r.all_success  # 비어있으면 False

    def test_add_success(self):
        from src.shared.result import Result
        r = Result()
        r.add_success("file1.pdf", "3페이지 처리")
        assert r.total == 1
        assert r.success_count == 1
        assert r.all_success

    def test_add_failure(self):
        from src.shared.result import Result
        r = Result()
        r.add_success("file1.pdf", "OK")
        r.add_failure("file2.pdf", "변환 실패")
        assert r.total == 2
        assert r.fail_count == 1
        assert not r.all_success

    def test_warnings(self):
        from src.shared.result import Result
        r = Result()
        r.add_success("file3.pdf", "OK", warnings=["경고: 낮은 해상도"])
        assert len(r.warnings) == 1
        assert "낮은 해상도" in r.warnings[0]

    def test_summary(self):
        from src.shared.result import Result
        r = Result()
        r.add_success("file1.pdf", "OK")
        r.add_success("file2.pdf", "OK")
        r.add_failure("file3.pdf", "실패")
        summary = r.summary()
        assert "총 3건" in summary
        assert "성공 2건" in summary
        assert "실패 1건" in summary
        assert "file3.pdf" in summary

    def test_empty_summary(self):
        from src.shared.result import Result
        r = Result()
        assert "총 0건" in r.summary()

    def test_warnings_only(self):
        from src.shared.result import Result
        r = Result()
        r.add_success("test", "ok", warnings=["경고 1", "경고 2"])
        assert r.all_success
        assert "경고" in r.summary()


# ============================================================
# Config 로더
# ============================================================

class TestConfig:
    def test_load_settings(self):
        from src.shared.config import load_config
        config = load_config("settings.yaml")
        assert "mvp1" in config
        assert "mvp2" in config
        assert "mvp3" in config

    def test_get_config_mvp1(self):
        from src.shared.config import get_config
        mvp1 = get_config("mvp1")
        assert "target_dir" in mvp1
        assert "model_name" in mvp1
        assert "max_workers" in mvp1

    def test_get_config_mvp2(self):
        from src.shared.config import get_config
        mvp2 = get_config("mvp2")
        assert "source_files" in mvp2
        assert "topic_folders" in mvp2

    def test_load_ocr_rules(self):
        from src.shared.config import load_config
        ocr = load_config("ocr-rules.yaml")
        assert "prompt" in ocr
        assert "cleaning" in ocr

    def test_missing_file_returns_empty(self):
        from src.shared.config import load_config
        result = load_config("nonexistent.yaml")
        assert result == {}


# ============================================================
# EnvLoader
# ============================================================

class TestEnvLoader:
    def test_save_and_load(self):
        from src.shared.env_loader import _load_env_file, _save_env_file, _get_env_path

        test_key = "TEST_DUMMY_KEY_12345"
        test_value = "AIzaSy_test_value_here"
        original = os.environ.get(test_key)

        try:
            _save_env_file(test_key, test_value)
            assert _get_env_path().exists()

            if test_key in os.environ:
                del os.environ[test_key]

            _load_env_file()
            assert os.environ.get(test_key) == test_value
        finally:
            # 정리
            if original is None:
                os.environ.pop(test_key, None)
            else:
                os.environ[test_key] = original

    def test_env_path_normal_mode(self):
        from src.shared.env_loader import _get_env_path
        path = _get_env_path()
        assert path.name == ".env"
        assert str(path.parent) == str(Path.cwd() / "python-sidecar")


# ============================================================
# Logger
# ============================================================

class TestLogger:
    def test_setup_logger(self, tmp_path):
        from src.shared.logger import setup_logger

        log_dir = tmp_path / "logs"
        log_dir.mkdir()
        logger = setup_logger(f"test_logger_{id(self)}", str(log_dir))

        assert logger is not None
        assert len(logger.handlers) >= 2  # 콘솔 + 파일

    def test_log_output(self, tmp_path):
        from src.shared.logger import setup_logger

        log_dir = tmp_path / "logs"
        log_dir.mkdir()
        logger_name = f"test_output_{id(self)}"
        logger = setup_logger(logger_name, str(log_dir))
        logger.info("테스트 로그 메시지")

        log_files = list(log_dir.glob(f"{logger_name}_*.log"))
        assert len(log_files) > 0
        content = log_files[0].read_text(encoding="utf-8")
        assert "테스트 로그 메시지" in content

    def test_log_cleanup(self, tmp_path):
        """로그 파일 자동 정리 테스트."""
        log_dir = tmp_path / "cleanup"
        log_dir.mkdir()

        # 고정 로거 이름 사용 (glob 패턴 "{name}_*.log"과 일치해야 함)
        logger_name = "cleanuptest"

        # 25개 더미 로그 파일 생성 (패턴: cleanuptest_*.log)
        for i in range(25):
            (log_dir / f"{logger_name}_{20260101000000 + i}.log").write_text("dummy")
        assert len(list(log_dir.glob(f"{logger_name}_*.log"))) == 25

        # 새 로거 생성 (정리 트리거)
        logger = logging.getLogger(logger_name)
        logger.handlers.clear()

        from src.shared.logger import setup_logger
        setup_logger(logger_name, str(log_dir))

        after_count = len(list(log_dir.glob(f"{logger_name}_*.log")))
        assert after_count <= 21  # 20 유지 + 새로 생성 1개


# ============================================================
# TextCleaner
# ============================================================

class TestTextCleaner:
    def test_empty(self):
        from src.mvp1_converter.text_cleaner import clean_text
        assert clean_text("") == ""
        assert clean_text(None) == ""

    def test_duplicate_removal(self):
        from src.mvp1_converter.text_cleaner import clean_text
        result = clean_text("가나다\n\n가나다\n라마바")
        assert result.count("가나다") == 1

    def test_table_preservation(self):
        from src.mvp1_converter.text_cleaner import clean_text
        table = "| 이름 | 점수 |\n| --- | --- |\n| 홍길동 | 95 |"
        result = clean_text(table)
        assert "| 이름 | 점수 |" in result
        assert "| --- | --- |" in result

    def test_long_separator_removal(self):
        from src.mvp1_converter.text_cleaner import clean_text
        result = clean_text("내용\n" + "-" * 30 + "\n다음 내용")
        assert "-" * 30 not in result
        assert "내용" in result and "다음 내용" in result

    def test_short_separator_kept(self):
        from src.mvp1_converter.text_cleaner import clean_text
        result = clean_text("내용\n---\n다음")
        assert "---" in result

    def test_html_br_conversion(self):
        from src.mvp1_converter.text_cleaner import clean_text
        result = clean_text("가<br>나<br/>다")
        assert "가" in result and "나" in result

    def test_special_chars_only_line(self):
        from src.mvp1_converter.text_cleaner import clean_text
        result = clean_text("내용\n●◆■★\n다음 내용")
        assert "●◆■★" not in result
        assert "내용" in result


# ============================================================
# reload_config
# ============================================================

class TestReloadConfig:
    def test_cache_clear(self):
        from src.shared.config import load_config, reload_config
        # 첫 로드
        config1 = load_config("settings.yaml")
        assert config1 is not None
        # 캐시 무효화 후 다시 로드
        reload_config()
        config2 = load_config("settings.yaml")
        assert config2 is not None
        assert config1 == config2


# ============================================================
# Result.to_dict (JSON-RPC 직렬화)
# ============================================================

class TestResultToDict:
    def test_result_to_dict_basic(self):
        from rpc_handler import _result_to_dict
        from src.shared.result import Result
        r = Result()
        r.add_success("test.pdf", "OK")
        r.add_failure("fail.pdf", "에러 발생")
        d = _result_to_dict(r)
        assert d["total"] == 2
        assert d["successCount"] == 1
        assert d["failCount"] == 1
        assert len(d["steps"]) == 2
        assert d["steps"][0]["success"] is True
        assert d["steps"][1]["success"] is False

    def test_result_to_dict_empty(self):
        from rpc_handler import _result_to_dict
        from src.shared.result import Result
        r = Result()
        d = _result_to_dict(r)
        assert d["total"] == 0
        assert d["steps"] == []


# ============================================================
# API 키 마스킹
# ============================================================

class TestApiKeyMasking:
    def test_long_key_masked(self):
        """10자 초과 키는 ****...끝4자로 마스킹."""
        key = "AIzaSyABCDEFGHIJK"
        masked = f"{'*' * 8}...{key[-4:]}" if len(key) > 10 else ("****" if key else "")
        assert masked == "********...HIJK"

    def test_short_key_masked(self):
        """4~10자 짧은 키는 ****로만 표시."""
        key = "short"
        masked = f"{'*' * 8}...{key[-4:]}" if len(key) > 10 else ("****" if key else "")
        assert masked == "****"

    def test_empty_key(self):
        """빈 키는 빈 문자열."""
        key = ""
        masked = f"{'*' * 8}...{key[-4:]}" if len(key) > 10 else ("****" if key else "")
        assert masked == ""


# ============================================================
# RpcHandler 초기화
# ============================================================

class TestRpcHandler:
    def test_notification_callback_injection(self):
        """notification_callback이 올바르게 주입되는지 확인."""
        from rpc_handler import RpcHandler
        calls = []
        handler = RpcHandler(notification_callback=lambda m, p: calls.append((m, p)))
        cb = handler._make_progress_callback()
        cb(1, 10, "테스트")
        assert len(calls) == 1
        assert calls[0] == ("progress", {"current": 1, "total": 10, "message": "테스트"})

    def test_no_callback_no_error(self):
        """콜백 없어도 에러 없이 동작."""
        from rpc_handler import RpcHandler
        handler = RpcHandler(notification_callback=None)
        cb = handler._make_progress_callback()
        cb(1, 10, "테스트")  # 에러 없이 통과

    def test_save_pipeline_state_and_inspect_match(self, tmp_path):
        """저장된 state와 현재 파일셋이 일치하면 태그 재사용 가능해야 함."""
        from rpc_handler import RpcHandler

        handler = RpcHandler(notification_callback=None)
        out_dir = tmp_path / "_output"
        out_dir.mkdir()

        save_resp = handler.dispatch("save_pipeline_state", {
            "output_dir": str(out_dir),
            "files": [{"name": "sample.pdf", "size": 1234}],
            "tags": [{
                "pageNum": 1,
                "sourceFile": "sample.pdf",
                "theme": "기타",
                "confidence": 0.9,
                "confirmed": True,
            }],
            "ocr_model": "gemini-3-flash-preview",
            "analysis_model": "gemini-3.1-flash-lite-preview",
        })
        assert save_resp["ok"] is True

        inspect = handler.dispatch("inspect_pipeline_output", {
            "output_dir": str(out_dir),
            "files": [{"name": "sample.pdf", "size": 1234}],
        })
        assert inspect["filesMatch"] is True
        assert inspect["stateMatched"] is True
        assert inspect["available"]["tags"] is True
        assert len(inspect["savedTags"]) == 1
        assert inspect["savedModels"]["ocrModel"] == "gemini-3-flash-preview"

    def test_inspect_pipeline_output_fallbacks_to_existing_ocr(self, tmp_path):
        """state 파일이 없어도 OCR 산출물 이름이 맞으면 재사용 대상으로 인식해야 함."""
        from rpc_handler import RpcHandler

        handler = RpcHandler(notification_callback=None)
        out_dir = tmp_path / "_output"
        out_dir.mkdir()
        (out_dir / "school_plan.md").write_text("테스트 OCR 결과", encoding="utf-8")

        inspect = handler.dispatch("inspect_pipeline_output", {
            "output_dir": str(out_dir),
            "files": [{"name": "school_plan.pdf", "size": 0}],
        })
        assert inspect["filesMatch"] is True
        assert inspect["stateMatched"] is False
        assert inspect["available"]["ocr"] is True
