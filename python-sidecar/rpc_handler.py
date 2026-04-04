"""
JSON-RPC method dispatcher.
Maps method names to existing MVP pipeline functions.
"""
import sys
import os
import threading
import json

# Add src/ to Python path so we can import existing modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))


class RpcHandler:
    def __init__(self, notification_callback=None):
        self._ocr_model = None
        self._analysis_model = None
        self._notify = notification_callback  # (method, params) → None
        # 요청별 cancel_event 관리 (동시 요청에서 독립 취소 보장)
        self._cancel_events: dict[int, threading.Event] = {}
        self._cancels_lock = threading.Lock()
        # settings.yaml 동시 쓰기 방지
        self._settings_lock = threading.Lock()
        # Load saved API key from .env on startup
        try:
            from shared.env_loader import ensure_api_key
            self._api_key = ensure_api_key()
        except Exception:
            self._api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        # Load saved models from settings.yaml on startup
        try:
            from shared.config import get_config
            mvp1_config = get_config("mvp1")
            mvp3_config = get_config("mvp3")
            if isinstance(mvp1_config, dict) and "model_name" in mvp1_config:
                self._ocr_model = mvp1_config["model_name"]
            if isinstance(mvp3_config, dict) and "model_name" in mvp3_config:
                self._analysis_model = mvp3_config["model_name"]
        except Exception:
            pass  # Use None defaults if loading fails
        self._methods = {
            "ping": self._ping,
            "get_settings": self._get_settings,
            "update_settings": self._update_settings,
            "set_api_key": self._set_api_key,
            "set_models": self._set_models,
            "ocr_files": self._ocr_files,
            "text_extract": self._text_extract,
            "summarize": self._summarize,
            "cancel": self._cancel,
            "open_folder": self._open_folder,
            "open_file": self._open_file,
            "read_report": self._read_report,
            "inspect_pipeline_output": self._inspect_pipeline_output,
            "save_pipeline_state": self._save_pipeline_state,
            "list_files": self._list_files,
            "save_report": self._save_report,
        }

    def dispatch(self, method: str, params: dict):
        """Dispatch a method call to the appropriate handler."""
        handler = self._methods.get(method)
        if handler is None:
            raise ValueError(f"Unknown method: {method}")
        return handler(params)

    def _make_progress_callback(self):
        """Create a progress callback that sends JSON-RPC notifications (thread-safe)."""
        notify = self._notify

        def callback(current, total, message=""):
            if notify:
                notify("progress", {
                    "current": current,
                    "total": total,
                    "message": message,
                })

        return callback

    # ==================== Core Methods ====================

    def _make_cancel_event(self) -> threading.Event:
        """새 cancel_event를 생성하고 활성 목록에 등록."""
        ev = threading.Event()
        with self._cancels_lock:
            self._cancel_events[id(ev)] = ev
        return ev

    def _release_cancel_event(self, ev: threading.Event) -> None:
        """완료된 cancel_event를 활성 목록에서 제거."""
        with self._cancels_lock:
            self._cancel_events.pop(id(ev), None)

    def _ping(self, params: dict):
        return "pong"

    def _cancel(self, params: dict):
        """활성 중인 모든 요청에 취소 신호 전송."""
        with self._cancels_lock:
            for ev in self._cancel_events.values():
                ev.set()
        return {"cancelled": True}

    def _set_api_key(self, params: dict):
        """Set API key for Gemini calls and persist to .env."""
        key = params.get("api_key", "")
        if key:
            self._api_key = key
            # GOOGLE_API_KEY만 설정 (google-genai SDK 기본 환경변수)
            # GEMINI_API_KEY 이중 설정은 보안상 노출 표면만 늘리므로 제거
            os.environ["GOOGLE_API_KEY"] = key
            # Persist to .env file
            try:
                from shared.env_loader import save_api_key
                save_api_key(key)
            except Exception:
                pass  # Non-critical: key is still in env
            return {"ok": True}
        return {"ok": False, "error": "Empty API key"}

    def _set_models(self, params: dict):
        """Set model names for OCR and analysis, and persist to settings.yaml."""
        import sys
        from shared.config import load_config

        changed = False
        if "ocr_model" in params:
            self._ocr_model = params["ocr_model"]
            changed = True
        if "analysis_model" in params:
            self._analysis_model = params["analysis_model"]
            changed = True

        # Persist to settings.yaml — _update_settings 패턴 재사용 (원자적 쓰기 + 캐시 무효화)
        if changed:
            try:
                if "ocr_model" in params:
                    self._update_settings({"section": "mvp1", "values": {"model_name": self._ocr_model}})
                if "analysis_model" in params:
                    self._update_settings({"section": "mvp3", "values": {"model_name": self._analysis_model}})
            except Exception as e:
                print(f"Warning: Failed to persist model settings: {e}", file=sys.stderr)

        return {"ok": True, "ocr_model": self._ocr_model, "analysis_model": self._analysis_model}

    # ==================== Settings ====================

    def _get_settings(self, params: dict):
        from shared.config import get_config
        section = params.get("section")
        config = get_config(section)
        # Include current API key status (suffix 노출 없이 설정 여부와 길이만 반환)
        api_key = os.environ.get("GOOGLE_API_KEY", "") or os.environ.get("GEMINI_API_KEY", "")
        if isinstance(config, dict):
            config["api_key_set"] = bool(api_key)
            config["api_key_masked"] = f"{'*' * min(len(api_key), 12)}" if api_key else ""
            # Include current model selections for frontend
            if self._ocr_model:
                config["ocr_model"] = self._ocr_model
            if self._analysis_model:
                config["analysis_model"] = self._analysis_model
        return config

    # 허용된 섹션 및 각 섹션의 허용 키 (whitelist)
    _ALLOWED_SETTINGS_SECTIONS = frozenset({"mvp1", "mvp2", "mvp3", "browser_tools"})
    _ALLOWED_SETTINGS_KEYS: dict = {
        "mvp1": frozenset({
            "model_name", "temperature", "max_workers", "timeout_seconds",
            "chunk_size", "dpi", "step_delay", "max_retries", "base_delay",
        }),
        "mvp2": frozenset({
            "themes", "vision_tag_batch_size", "text_tag_batch_size",
            "text_tag_page_snippet",
        }),
        "mvp3": frozenset({
            "model_name", "step1_temperature", "step2_temperature",
            "timeout_seconds", "wait_time", "num_variants", "evaluate",
        }),
        "browser_tools": frozenset({
            "default_timeout_ms", "headless", "ignore_https_errors",
            "search_wait_ms", "detail_wait_ms", "page_load_wait_ms",
            "gis_load_wait_ms",
        }),
    }

    def _update_settings(self, params: dict):
        """설정을 YAML 파일에 저장합니다."""
        import tempfile
        import yaml
        from shared.config import _find_config_dir, load_config

        section = params.get("section")
        values = params.get("values", {})
        if not values:
            return {"ok": False, "error": "변경할 설정이 없습니다"}

        # 섹션 whitelist 검증 (임의 키 주입 방지)
        if section is not None:
            if section not in self._ALLOWED_SETTINGS_SECTIONS:
                return {"ok": False, "error": f"허용되지 않는 섹션: {section}"}
            allowed_keys = self._ALLOWED_SETTINGS_KEYS.get(section, frozenset())
            invalid_keys = set(values.keys()) - allowed_keys
            if invalid_keys:
                return {"ok": False, "error": f"허용되지 않는 키: {', '.join(sorted(invalid_keys))}"}

        config_path = _find_config_dir() / "settings.yaml"
        with self._settings_lock:
            # 현재 설정 로드 (캐시 아닌 파일 직접, 없으면 빈 딕셔너리)
            if config_path.exists():
                with open(config_path, "r", encoding="utf-8") as f:
                    full_config = yaml.safe_load(f) or {}
            else:
                full_config = {}

            if section and isinstance(full_config.get(section), dict):
                full_config[section].update(values)
            elif section:
                full_config[section] = values
            # else 분기(section 없이 최상위 덮어쓰기)는 whitelist 없으므로 제거

            # 원자적 쓰기: 임시 파일에 쓴 후 교체 (쓰기 실패 시 기존 설정 보존)
            tmp_fd, tmp_path = tempfile.mkstemp(
                dir=config_path.parent, suffix=".tmp", prefix="settings_"
            )
            try:
                with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                    yaml.dump(full_config, f, default_flow_style=False,
                              allow_unicode=True, sort_keys=False)
                from pathlib import Path as _Path
                _Path(tmp_path).replace(config_path)
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise

        # LRU 캐시 무효화
        load_config.cache_clear()
        return {"ok": True}

    # ==================== MVP 1: OCR ====================

    def _ocr_files(self, params: dict):
        cancel = self._make_cancel_event()
        try:
            from mvp1_converter.pipeline import run

            config = params.get("config", {})
            files = params.get("files", [])
            if "target_dir" in params:
                config["target_dir"] = params["target_dir"]
            if files:
                config["selected_files"] = files
            if self._ocr_model:
                config["model_name"] = self._ocr_model

            result = run(
                config=config,
                cancel_event=cancel,
                progress_callback=self._make_progress_callback(),
            )
            return result.to_dict() if hasattr(result, "to_dict") else _result_to_dict(result)
        finally:
            self._release_cancel_event(cancel)

    def _text_extract(self, params: dict):
        cancel = self._make_cancel_event()
        try:
            from mvp1_converter.text_extractor import process_all_pdfs_text

            config = params.get("config", {})
            result = process_all_pdfs_text(
                config=config,
                cancel_event=cancel,
                progress_callback=self._make_progress_callback(),
            )
            return _result_to_dict(result)
        finally:
            self._release_cancel_event(cancel)

    # ==================== MVP 2: Extraction ====================

    def _extract_pages(self, params: dict):
        cancel = self._make_cancel_event()
        try:
            tags = params.get("tags")
            if tags:
                from mvp2_extractor.extractor import run_from_tags
                source_dir = params.get("source_dir", params.get("ocr_dir", ""))
                output_dir = params.get("output_dir")
                result = run_from_tags(
                    tags=tags,
                    source_dir=source_dir,
                    output_dir=output_dir,
                    config=params.get("config", {}),
                    cancel_event=cancel,
                    progress_callback=self._make_progress_callback(),
                )
            else:
                from mvp2_extractor.extractor import run
                config = params.get("config", {})
                result = run(
                    config=config,
                    cancel_event=cancel,
                    progress_callback=self._make_progress_callback(),
                )
            return _result_to_dict(result)
        finally:
            self._release_cancel_event(cancel)

    # ==================== MVP 3: Analysis ====================

    def _summarize(self, params: dict):
        cancel = self._make_cancel_event()
        try:
            from mvp3_analyzer.summarizer import run_step1
            from shared.config import get_config
            from pathlib import Path

            config = params.get("config") or get_config("mvp3") or {}
            model = self._analysis_model or config.get("model_name", "gemini-3.1-flash-lite-preview")

            input_dir = params.get("input_dir") or config.get("input_subdir", "input_data")
            input_path = Path(input_dir)
            # 새 구조: _작업데이터/요약_중간결과, 하위호환: processed/
            if input_path.is_absolute():
                new_dir = input_path / "_작업데이터" / "요약_중간결과"
                old_dir = input_path / "processed"
                processed_dir = new_dir if new_dir.exists() else (old_dir if old_dir.exists() else new_dir)
            else:
                processed_dir = Path(config.get("processed_subdir", "input_processed"))

            result = run_step1(
                input_dir=input_path,
                processed_dir=processed_dir,
                model_name=model,
                temperature=config.get("step1_temperature", 0.0),
                timeout=config.get("timeout_seconds", 120),
                wait_time=config.get("wait_time", 10),
                cancel_event=cancel,
                progress_callback=self._make_progress_callback(),
            )
            return _result_to_dict(result)
        finally:
            self._release_cancel_event(cancel)

    def _integrate(self, params: dict):
        cancel = self._make_cancel_event()
        try:
            from mvp3_analyzer.integrator import run_step2
            from shared.config import get_config
            from pathlib import Path

            config = params.get("config") or get_config("mvp3") or {}
            model = self._analysis_model or config.get("model_name", "gemini-3.1-flash-lite-preview")

            input_dir = params.get("input_dir")
            if input_dir:
                input_path = Path(input_dir)
                # 새 구조: 요약은 _작업데이터/요약_중간결과, 리포트는 최상단에 직접 저장
                new_proc = input_path / "_작업데이터" / "요약_중간결과"
                old_proc = input_path / "processed"
                processed_dir = new_proc if new_proc.exists() else (old_proc if old_proc.exists() else new_proc)
                output_dir = input_path  # 리포트를 최상단에 저장
            else:
                processed_dir = Path(config.get("processed_subdir", "input_processed"))
                output_dir = Path(config.get("output_subdir", "output"))

            result = run_step2(
                processed_dir=processed_dir,
                output_dir=output_dir,
                model_name=model,
                temperature=config.get("step2_temperature", 0.7),
                timeout=config.get("timeout_seconds", 120),
                wait_time=config.get("wait_time", 10),
                num_variants=config.get("num_variants", 1),
                step1_result=None,
                cancel_event=cancel,
                progress_callback=self._make_progress_callback(),
                evaluate=config.get("evaluate", True),
            )
            return _result_to_dict(result)
        finally:
            self._release_cancel_event(cancel)

    # ==================== File Operations ====================

    def _open_folder(self, params: dict):
        """OS 파일 탐색기로 폴더 열기 (경로 검증 포함)."""
        import subprocess
        import platform
        path = params.get("path", "")
        if not path:
            raise ValueError("path 파라미터가 필요합니다")
        from pathlib import Path as _Path
        folder = _Path(path).resolve()
        # UNC 경로 차단 (NTLM 인증 탈취 방지)
        # \\server\share, \\?\..., //?/... 형식 모두 차단
        _folder_str = str(folder)
        if _folder_str.startswith("\\\\") or _folder_str.startswith("//?/"):
            raise ValueError("네트워크 경로는 허용되지 않습니다")
        if not folder.exists():
            raise FileNotFoundError(f"폴더가 존재하지 않습니다: {path}")
        if not folder.is_dir():
            folder = folder.parent
        if platform.system() == "Windows":
            subprocess.Popen(["explorer", str(folder)])
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", str(folder)])
        else:
            subprocess.Popen(["xdg-open", str(folder)])
        return {"ok": True}

    _SAFE_EXTENSIONS = frozenset({
        ".pdf", ".md", ".txt", ".xlsx", ".xls", ".csv", ".json",
        ".hwp", ".hwpx", ".jpg", ".jpeg", ".png", ".gif", ".bmp",
    })

    def _open_file(self, params: dict):
        """시스템 기본 앱으로 파일 열기."""
        import subprocess
        import platform
        path = params.get("path", "")
        if not path:
            raise ValueError("path 파라미터가 필요합니다")
        from pathlib import Path as _Path
        filepath = _Path(path).resolve()
        _filepath_str = str(filepath)
        if _filepath_str.startswith("\\\\") or _filepath_str.startswith("//?/"):
            raise ValueError("네트워크 경로는 허용되지 않습니다")
        if filepath.suffix.lower() not in self._SAFE_EXTENSIONS:
            raise ValueError(f"허용되지 않는 파일 형식: {filepath.suffix}")
        if not filepath.exists():
            raise FileNotFoundError(f"파일이 존재하지 않습니다: {path}")
        if platform.system() == "Windows":
            os.startfile(str(filepath))
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", str(filepath)])
        else:
            subprocess.Popen(["xdg-open", str(filepath)])
        return {"ok": True}

    def _read_report(self, params: dict):
        """산출물 폴더에서 Markdown 리포트 읽기 (미리보기용)."""
        from pathlib import Path
        output_dir = params.get("output_dir", "")
        if not output_dir:
            raise ValueError("output_dir 파라미터가 필요합니다")

        p = Path(output_dir).resolve()
        _p_str = str(p)
        if _p_str.startswith("\\\\") or _p_str.startswith("//?/"):
            raise ValueError("네트워크 경로는 허용되지 않습니다")

        # 리포트 찾기: 최상단 → output/ (레거시) → 최종_산출물/ (레거시)
        report_file = None
        search_dirs = [p]
        for legacy in ["output", "최종_산출물"]:
            ld = p / legacy
            if ld.exists():
                search_dirs.append(ld)

        for search_dir in search_dirs:
            for md_file in sorted(search_dir.glob("*.md")):
                if "통합" in md_file.name and "리포트" in md_file.name:
                    report_file = md_file
                    break
            if report_file:
                break

        if not report_file or not report_file.exists():
            raise FileNotFoundError(f"리포트를 찾을 수 없습니다: {output_dir}")

        # 파일 읽기 (MD 형식)
        try:
            content = report_file.read_text(encoding="utf-8")
            return {
                "ok": True,
                "filename": report_file.name,
                "content": content,
            }
        except Exception as e:
            raise ValueError(f"파일 읽기 실패: {e}")

    def _list_files(self, params: dict):
        """폴더 내 지원 파일 목록 반환 (HWP/HWPX/PDF)."""
        from pathlib import Path
        folder = params.get("folder", "")
        if not folder:
            raise ValueError("folder 파라미터가 필요합니다")
        p = Path(folder).resolve()
        _pf_str = str(p)
        if _pf_str.startswith("\\\\") or _pf_str.startswith("//?/"):
            raise ValueError("네트워크 경로는 허용되지 않습니다")
        if not p.is_dir():
            raise ValueError(f"폴더가 존재하지 않습니다: {folder}")
        exts = {".hwp", ".hwpx", ".pdf"}
        files = []
        for f in sorted(p.iterdir()):
            if f.is_file() and f.suffix.lower() in exts:
                files.append({
                    "path": str(f),
                    "name": f.name,
                    "size": f.stat().st_size,
                })
        return {"files": files}

    def _save_report(self, params: dict):
        """수집 리포트를 파일로 저장."""
        from pathlib import Path
        content = params.get("content", "")
        filename = Path(params.get("filename", "report.md")).name  # path traversal 방지
        if not content:
            raise ValueError("content 파라미터가 필요합니다")
        if Path(filename).suffix.lower() not in {".md", ".txt"}:
            raise ValueError(f"허용되지 않는 파일 형식: {filename}")
        # frozen 환경: Program Files 쓰기 권한 없음 → 홈 디렉토리 사용
        # (BrowserTool.output_dir과 동일 경로)
        if getattr(sys, "frozen", False):
            base = Path.home() / ".eduplan-ai"
        else:
            base = Path(__file__).parent
        output_dir = base / "output" / "browser_tools"
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / filename
        path.write_text(content, encoding="utf-8")
        # 자동으로 파일 열기
        import subprocess, platform
        if platform.system() == "Windows":
            os.startfile(str(path))
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
        return {"ok": True, "path": str(path)}

    # ==================== Pipeline State ====================

    def _save_pipeline_state(self, params: dict):
        """현재 파이프라인 상태를 output_dir에 저장합니다."""
        from pathlib import Path

        output_dir_raw = params.get("output_dir", "")
        if not output_dir_raw:
            raise ValueError("output_dir 파라미터가 필요합니다")

        output_dir = Path(output_dir_raw).resolve()
        if str(output_dir).startswith("\\\\"):
            raise ValueError("네트워크 경로는 허용되지 않습니다")
        output_dir.mkdir(parents=True, exist_ok=True)

        state = {
            "version": 1,
            "updated_at": params.get("updated_at"),
            "current_step": params.get("current_step", ""),
            "ocr_model": params.get("ocr_model", ""),
            "analysis_model": params.get("analysis_model", ""),
            "files": params.get("files", []),
            "tags": params.get("tags", []),
        }

        # pipeline_state.json → _작업데이터/에 저장
        work_dir = output_dir / "_작업데이터"
        work_dir.mkdir(parents=True, exist_ok=True)
        state_path = work_dir / "pipeline_state.json"
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return {"ok": True, "path": str(state_path)}

    def _inspect_pipeline_output(self, params: dict):
        """기존 산출물을 검사해 재사용 가능한 단계를 반환합니다."""
        from pathlib import Path

        output_dir_raw = params.get("output_dir", "")
        files = params.get("files", [])
        if not output_dir_raw:
            raise ValueError("output_dir 파라미터가 필요합니다")

        output_dir = Path(output_dir_raw).resolve()
        if str(output_dir).startswith("\\\\"):
            raise ValueError("네트워크 경로는 허용되지 않습니다")

        info = {
            "outputDir": str(output_dir),
            "exists": output_dir.exists(),
            "filesMatch": False,
            "stateMatched": False,
            "statePath": "",
            "savedTags": [],
            "savedModels": {"ocrModel": "", "analysisModel": ""},
            "available": {
                "ocr": False,
                "tags": False,
                "extracted": False,
                "summaries": False,
                "report": False,
            },
        }
        if not output_dir.exists():
            return info

        def _normalized(items):
            normalized = []
            for item in items or []:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name", "")).strip()
                if not name:
                    continue
                size_raw = item.get("size", 0)
                try:
                    size = int(size_raw or 0)
                except (TypeError, ValueError):
                    size = 0
                normalized.append({"name": name, "size": size})
            normalized.sort(key=lambda x: x["name"].lower())
            return normalized

        def _same_files(saved_items, current_items):
            saved = _normalized(saved_items)
            current = _normalized(current_items)
            if not saved or not current or len(saved) != len(current):
                return False
            for saved_file, current_file in zip(saved, current):
                if saved_file["name"].lower() != current_file["name"].lower():
                    return False
                saved_size = saved_file["size"]
                current_size = current_file["size"]
                if saved_size > 0 and current_size > 0 and saved_size != current_size:
                    return False
            return True

        expected_stems = {
            Path(str(item.get("name", ""))).stem
            for item in files if isinstance(item, dict) and item.get("name")
        }
        root_ocr_stems = {
            p.stem for p in output_dir.iterdir()
            if p.is_file() and p.suffix.lower() in {".md", ".txt"}
        }
        info["available"]["ocr"] = bool(expected_stems) and expected_stems.issubset(root_ocr_stems)

        # 새 폴더 구조
        theme_extracted_dir = output_dir / "테마별_분리_자료"
        work_dir = output_dir / "_작업데이터"
        summary_cache_dir = work_dir / "요약_중간결과"

        # 하위호환성: 기존 폴더 구조도 지원
        old_extracted_dir = output_dir / "extracted"
        old_processed_dir = output_dir / "processed"
        old_logs_dir = output_dir / "작업_로그"

        extracted_dir = theme_extracted_dir if theme_extracted_dir.exists() else old_extracted_dir
        # 요약 중간결과: _작업데이터/요약_중간결과 → 작업_로그/요약_중간결과 → processed
        if summary_cache_dir.exists():
            processed_dir = summary_cache_dir
        elif (old_logs_dir / "요약_중간결과").exists():
            processed_dir = old_logs_dir / "요약_중간결과"
        else:
            processed_dir = old_processed_dir

        info["available"]["extracted"] = extracted_dir.exists() and (
            next(extracted_dir.glob("**/*.pdf"), None) is not None
        )
        info["available"]["summaries"] = processed_dir.exists() and any(
            p.is_file() and p.name.startswith("summary_")
            for p in processed_dir.iterdir()
        )
        # 리포트는 이제 최상단에 있음
        info["available"]["report"] = any(
            p.is_file() and p.name.startswith("통합 분석 리포트") and p.suffix.lower() in {".md", ".docx"}
            for p in output_dir.iterdir()
        )
        # 하위호환: 최종_산출물/ 또는 output/ 에도 있을 수 있음
        if not info["available"]["report"]:
            for legacy in ["최종_산출물", "output"]:
                ld = output_dir / legacy
                if ld.exists():
                    info["available"]["report"] = any(
                        p.is_file() and "통합" in p.name and "리포트" in p.name
                        for p in ld.iterdir()
                    )
                    if info["available"]["report"]:
                        break

        # 새 구조: _작업데이터/, 하위호환: 루트
        state_path = output_dir / "_작업데이터" / "pipeline_state.json"
        if not state_path.exists():
            state_path = output_dir / "pipeline_state.json"  # 레거시 폴백
        if not state_path.exists():
            info["filesMatch"] = info["available"]["ocr"]
            return info

        info["statePath"] = str(state_path)
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            info["filesMatch"] = info["available"]["ocr"]
            return info

        state_matched = _same_files(state.get("files", []), files)
        info["stateMatched"] = state_matched
        info["filesMatch"] = state_matched or info["available"]["ocr"]
        if state_matched:
            saved_tags = state.get("tags", [])
            if isinstance(saved_tags, list):
                info["savedTags"] = saved_tags
                info["available"]["tags"] = len(saved_tags) > 0
            info["savedModels"] = {
                "ocrModel": state.get("ocr_model", ""),
                "analysisModel": state.get("analysis_model", ""),
            }

        return info

    # ==================== Browser Tools ====================

    # _chromium_verified는 __init__에서 인스턴스 속성으로 관리

    def _ensure_chromium_browser(self):
        """Chromium 브라우저가 설치되어 있는지 확인하고, 없으면 자동 다운로드합니다.

        frozen(exe) 환경에서는 번들된 Playwright driver(node.exe + cli.js)를 사용하여
        `playwright install chromium`을 실행합니다.
        브라우저는 ~/.eduplan-ai/browsers/ 에 저장되어 앱 업데이트와 무관하게 유지됩니다.
        """
        if self._chromium_verified:
            return

        import subprocess
        from pathlib import Path

        # 브라우저 저장 경로 설정
        if getattr(sys, "frozen", False):
            browsers_dir = Path.home() / ".eduplan-ai" / "browsers"
        else:
            # 개발 환경: 기본 경로 사용 (%LOCALAPPDATA%/ms-playwright)
            browsers_dir = None

        if browsers_dir:
            browsers_dir.mkdir(parents=True, exist_ok=True)
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_dir)

        # 빠른 검사: chrome.exe가 이미 존재하는지 확인
        if browsers_dir:
            chrome_exists = any(
                f.name == "chrome.exe"
                for f in browsers_dir.rglob("chrome.exe")
            ) if browsers_dir.exists() else False
        else:
            # 개발 환경: 기본 경로에서 확인
            default_path = Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"
            chrome_exists = any(
                f.name == "chrome.exe"
                for f in default_path.rglob("chrome.exe")
            ) if default_path.exists() else False

        if chrome_exists:
            self._chromium_verified = True
            return

        # Chromium 다운로드 실행
        progress = self._make_progress_callback()
        progress(0, 1, "Chromium 브라우저 다운로드 중... (최초 1회, 약 150MB)")
        print("[sidecar] Chromium 브라우저 다운로드 시작", file=sys.stderr, flush=True)

        try:
            if getattr(sys, "frozen", False):
                # frozen 환경: 번들된 driver 사용
                if getattr(sys, "_MEIPASS", None):
                    driver_dir = Path(sys._MEIPASS) / "playwright" / "driver"
                else:
                    driver_dir = Path(sys.executable).parent / "playwright" / "driver"

                node_exe = driver_dir / "node.exe"
                cli_js = driver_dir / "package" / "cli.js"

                if not node_exe.exists():
                    raise RuntimeError(
                        f"Playwright driver가 번들에 포함되지 않았습니다. "
                        f"(찾은 경로: {driver_dir})"
                    )

                env = os.environ.copy()
                env["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_dir)
                cmd = [str(node_exe), str(cli_js), "install", "chromium"]
            else:
                # 개발 환경: python -m playwright install
                env = os.environ.copy()
                cmd = [sys.executable, "-m", "playwright", "install", "chromium"]

            # Popen을 사용하여 출력을 실시간으로 읽음 (stderr로 진행률이 출력됨)
            process = subprocess.Popen(
                cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace"
            )

            # 실시간 출력 읽기
            for line in iter(process.stdout.readline, ""):
                line = line.strip()
                if line:
                    # UI에 진행 상태 한 줄씩 전달
                    progress(0, 1, f"다운로드 중: {line[:50]}...")
                    print(f"[playwright] {line}", file=sys.stderr, flush=True)

            process.stdout.close()
            return_code = process.wait(timeout=300)
            
            if return_code != 0:
                raise RuntimeError(f"Chromium 설치 실패 (exit {return_code})")

            self._chromium_verified = True
            progress(1, 1, "Chromium 브라우저 설치 완료")
            print("[sidecar] Chromium 브라우저 설치 완료", file=sys.stderr, flush=True)

        except subprocess.TimeoutExpired:
            raise RuntimeError(
                "Chromium 다운로드 시간 초과 (5분). "
                "네트워크 연결을 확인하고 다시 시도해 주세요."
            )
        except Exception as e:
            if "설치 실패" in str(e) or "번들" in str(e) or "시간 초과" in str(e):
                raise
            raise RuntimeError(f"Chromium 브라우저 설치 실패: {e}")

    def _get_or_create_playwright(self):
        """Playwright 서버 싱글톤을 반환합니다.

        매 호출마다 sync_playwright()를 생성/파괴하면 Windows에서
        node.js/Chromium 좀비 프로세스가 누적되어 3번째 호출부터 hang 발생.
        싱글톤으로 Playwright 서버를 재사용하고 브라우저만 매 호출 생성/파괴합니다.
        """
        with self._pw_lock:
            if self._playwright_instance is None:
                from playwright.sync_api import sync_playwright
                print("[sidecar] Playwright 서버 시작 (싱글톤)", file=sys.stderr, flush=True)
                self._playwright_instance = sync_playwright().start()
            return self._playwright_instance

    def _reset_playwright(self):
        """Playwright 인스턴스를 강제 종료하고 초기화합니다."""
        with self._pw_lock:
            if self._playwright_instance:
                try:
                    self._playwright_instance.stop()
                except Exception:
                    pass
                self._playwright_instance = None
                print("[sidecar] Playwright 서버 리셋", file=sys.stderr, flush=True)

    def _browser_tool(self, params: dict):
        """Run a browser automation tool (requires playwright)."""
        cancel = self._make_cancel_event()
        try:
            try:
                import playwright  # noqa: F401
            except ImportError:
                if getattr(sys, "frozen", False):
                    raise RuntimeError(
                        "Playwright 모듈을 찾을 수 없습니다. "
                        "빌드 시 playwright가 번들에 포함되었는지 확인하세요."
                    )
                import subprocess
                print("[sidecar] playwright 자동 설치 중...", file=sys.stderr, flush=True)
                try:
                    subprocess.check_call(
                        [sys.executable, "-m", "pip", "install", "--quiet", "playwright"],
                        stdout=sys.stderr, stderr=sys.stderr,
                    )
                    import importlib; importlib.invalidate_caches()
                    import playwright  # noqa: F401
                    print("[sidecar] playwright 설치 완료", file=sys.stderr, flush=True)
                except Exception as e:
                    raise RuntimeError(f"Playwright 자동 설치 실패: {e}")

            # Chromium 브라우저 바이너리 확보 (없으면 자동 다운로드)
            self._ensure_chromium_browser()

            tool_name = params.get("tool")
            tool_params = params.get("params", {})

            # 명시적 import 맵 (importlib 동적 로딩 제거)
            from browser_tools.schoolinfo import SchoolInfoTool
            from browser_tools.building_info import BuildingInfoTool
            from browser_tools.land_info import LandInfoTool
            from browser_tools.population import PopulationTool
            from browser_tools.heritage import HeritageTool
            from browser_tools.design_fee import DesignFeeTool
            from browser_tools.school_zone import SchoolZoneTool

            tool_map = {
                "schoolinfo": (SchoolInfoTool, lambda t, p: t.run(
                    _playwright=pw,
                    school_name=p.get("school_name", ""),
                    schul_id=p.get("schul_id", ""),
                )),
                "building_info": (BuildingInfoTool, lambda t, p: t.run(_playwright=pw, query=p.get("query", ""))),
                "land_info": (LandInfoTool, lambda t, p: t.run(_playwright=pw, address=p.get("address", ""))),
                "population": (PopulationTool, lambda t, p: t.run(_playwright=pw, region=p.get("region", ""))),
                "heritage": (HeritageTool, lambda t, p: t.run(_playwright=pw, location=p.get("location", ""))),
                "design_fee": (DesignFeeTool, lambda t, p: t.run(
                    _playwright=pw,
                    pay=p.get("pay", ""),
                    bangsik=p.get("bangsik", "1"),
                    jongbyeol=p.get("jongbyeol", "1"),
                    geubsu=p.get("geubsu", "1"),
                )),
                "school_zone": (SchoolZoneTool, lambda t, p: t.run(
                    _playwright=pw,
                    address=p.get("address", ""),
                    school_id=p.get("school_id", ""),
                    school_class=p.get("school_class", ""),
                )),
            }

            if tool_name not in tool_map:
                raise ValueError(f"Unknown browser tool: {tool_name}")

            import logging
            tool_class, runner = tool_map[tool_name]
            # 프론트엔드에서 string "true"로 올 수 있음 → 명시적 bool 변환
            headed_raw = tool_params.get("headed", False)
            headed = headed_raw is True or headed_raw == "true" or headed_raw == "True"
            tool = tool_class(headed=headed, cancel_event=cancel)

            # Redirect all browser tool logging to stderr (stdout is JSON-RPC only)
            for handler in tool.logger.handlers[:]:
                tool.logger.removeHandler(handler)
            stderr_handler = logging.StreamHandler(sys.stderr)
            stderr_handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S"))
            tool.logger.addHandler(stderr_handler)

            self._make_progress_callback()(0, 1, f"{tool_name} 실행 중...")

            # Playwright 싱글톤 사용 — 실패 시 리셋 후 1회 재시도
            pw = self._get_or_create_playwright()
            try:
                result = runner(tool, tool_params)
            except Exception as first_err:
                print(f"[sidecar] 브라우저 도구 실패, Playwright 리셋 후 재시도: {first_err}",
                      file=sys.stderr, flush=True)
                self._reset_playwright()
                pw = self._get_or_create_playwright()
                # 새 도구 인스턴스로 재시도 (이전 인스턴스의 상태 오염 방지)
                tool = tool_class(headed=headed, cancel_event=cancel)
                for handler in tool.logger.handlers[:]:
                    tool.logger.removeHandler(handler)
                tool.logger.addHandler(stderr_handler)
                result = runner(tool, tool_params)

            self._make_progress_callback()(1, 1, f"{tool_name} 완료")
            return result
        finally:
            self._release_cancel_event(cancel)

    # ==================== AI Tagging ====================

    def _tag_pages(self, params: dict):
        """AI 기반 페이지 테마 태깅 → page_tagger 모듈에 위임."""
        cancel = self._make_cancel_event()
        try:
            from mvp1_converter.page_tagger import tag_pages

            ocr_dir = params.get("ocr_dir", "")
            if not ocr_dir:
                raise ValueError("ocr_dir 파라미터가 필요합니다")

            from shared.config import get_config
            config_model = (get_config("mvp1") or {}).get("model_name", "gemini-3-flash-preview")
            return tag_pages(
                ocr_dir=ocr_dir,
                files=params.get("files"),
                model_name=self._ocr_model or config_model,
                cancel_event=cancel,
                progress_callback=self._make_progress_callback(),
            )
        finally:
            self._release_cancel_event(cancel)

    def _get_thumbnails(self, params: dict):
        """PyMuPDF로 PDF 페이지 썸네일 생성 (base64)."""
        cancel = self._make_cancel_event()
        try:
            import fitz
            import base64
            from pathlib import Path as _Path

            pdf_path_raw = params.get("pdf_path", "")
            if not pdf_path_raw:
                raise ValueError("pdf_path 파라미터가 필요합니다")

            # C-2: 경로 검증 (경로 순회, 네트워크 경로, 비PDF 차단)
            pdf_path = _Path(pdf_path_raw).resolve()
            if str(pdf_path).startswith("\\\\"):
                raise ValueError("네트워크 경로는 허용되지 않습니다")
            if pdf_path.suffix.lower() != ".pdf":
                raise ValueError("PDF 파일만 허용됩니다")
            if not pdf_path.exists():
                raise FileNotFoundError(f"파일이 존재하지 않습니다: {pdf_path_raw}")

            dpi = int(params.get("dpi", 72))
            max_pages = int(params.get("max_pages", 50))
            start_page = max(0, int(params.get("start_page", 0)))

            doc = fitz.open(str(pdf_path))
            try:
                thumbnails = []
                zoom = dpi / 72.0
                matrix = fitz.Matrix(zoom, zoom)
                total_pages = len(doc)

                for i in range(start_page, min(total_pages, start_page + max_pages)):
                    if cancel.is_set():
                        break
                    try:
                        page = doc[i]
                        pix = page.get_pixmap(matrix=matrix)
                        img_bytes = pix.tobytes("png")
                        pix = None
                        thumbnails.append({
                            "pageNum": i + 1,
                            "data": base64.b64encode(img_bytes).decode("ascii"),
                            "width": page.rect.width * zoom,
                            "height": page.rect.height * zoom,
                        })
                    except Exception:
                        thumbnails.append({"pageNum": i + 1, "data": "", "width": 0, "height": 0})

                return {"thumbnails": thumbnails, "totalPages": total_pages}
            finally:
                doc.close()
        finally:
            self._release_cancel_event(cancel)


def _result_to_dict(result) -> dict:
    """Convert a Result dataclass to a JSON-serializable dict.

    Keys use camelCase to match the TypeScript PipelineResult interface.
    """
    return {
        "total": getattr(result, "total", 0),
        "successCount": getattr(result, "success_count", 0),
        "failCount": getattr(result, "fail_count", 0),
        "outputPath": str(getattr(result, "output_path", "") or ""),
        "warnings": list(getattr(result, "warnings", [])),
        "steps": [
            {
                "name": s.name,
                "success": s.success,
                "message": s.message,
                "warnings": list(s.warnings) if s.warnings else [],
            }
            for s in getattr(result, "steps", [])
        ],
    }
