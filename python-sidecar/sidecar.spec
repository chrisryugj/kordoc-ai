# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for EduPlan AI Python Sidecar.

Build:
    cd python-sidecar
    pyinstaller sidecar.spec

Output:
    dist/eduplan-sidecar.exe (single file)
"""

import sys
from pathlib import Path

src_root = Path(".").resolve()

import playwright

# Playwright driver (node.exe + package/) — frozen 환경에서 브라우저 설치 CLI 호출에 필요
_pw_driver = str(Path(playwright.__file__).parent / "driver")

# ── 런타임 데이터 파일 수집 (PyInstaller가 자동 수집 못 하는 것들) ──

# certifi: HTTPS 인증서 번들 — 없으면 Gemini API 등 모든 HTTPS 호출 실패
import certifi as _certifi
_certifi_pem = _certifi.where()  # cacert.pem 절대 경로

# rfc3987_syntax: google-genai 의존성 — .lark 문법 파일을 런타임에 읽음
import rfc3987_syntax as _rfc
_rfc_data = str(Path(_rfc.__file__).parent)

# lark: rfc3987_syntax가 사용하는 파서 — grammars/ 디렉토리에 .lark 파일 필요
import lark as _lark
_lark_data = str(Path(_lark.__file__).parent)

# reportlab: PDF 생성 시 폰트 메트릭 파일(.afm) 필요
import reportlab as _rl
_rl_fonts = str(Path(_rl.__file__).parent / "fonts")

# python-docx: DOCX 생성 시 템플릿 파일 필요 (default.docx 등)
import docx as _docx
_docx_templates = str(Path(_docx.__file__).parent / "templates")

a = Analysis(
    ["main.py"],
    pathex=[str(src_root), str(src_root / "src")],
    binaries=[],
    datas=[
        (str(src_root / "config"), "config"),
        (_pw_driver, "playwright/driver"),
        (_certifi_pem, "certifi"),
        (_rfc_data, "rfc3987_syntax"),
        (_lark_data + "/grammars", "lark/grammars"),
        (_rl_fonts, "reportlab/fonts"),
        (_docx_templates, "docx/templates"),
    ],
    hiddenimports=[
        # Google GenAI + 전이 의존
        "google.genai",
        "google.genai.types",
        "google.genai._api_client",
        "google.genai._common",
        "google.auth",
        "google.auth.transport.requests",
        "google.auth.credentials",
        "google.oauth2",
        "google.oauth2.service_account",
        "httpx",
        "httpx._transports",
        "httpx._transports.default",
        "httpcore",
        "httpcore._async",
        "httpcore._sync",
        "h11",
        "httpx_sse",
        "sniffio",
        "requests",
        "urllib3",
        # PDF
        "fitz",
        "fitz.fitz",
        "pypdf",
        "pypdf._readers",
        "pypdf._writers",
        # Excel
        "openpyxl",
        "openpyxl.styles",
        "openpyxl.utils",
        # DOCX
        "docx",
        "docx.oxml",
        "docx.oxml.ns",
        "docx.shared",
        "docx.enum.text",
        "lxml",
        "lxml.etree",
        # PDF generation
        "reportlab",
        "reportlab.lib.fonts",
        "reportlab.pdfbase._fontdata",
        # YAML
        "yaml",
        # Image + numpy (school_zone lazy import)
        "PIL",
        "PIL.Image",
        "PIL.PngImagePlugin",
        "PIL.JpegImagePlugin",
        "numpy",
        # Playwright
        "playwright",
        "playwright.sync_api",
        "playwright._impl",
        "playwright._impl._driver",
        # stdlib often missed
        "csv",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pytest", "PyQt5", "PySide6", "torch", "torchvision", "torchaudio", "tensorflow"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="eduplan-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,   # JSON-RPC requires sys.stdout; console window hidden via CREATE_NO_WINDOW in Rust
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(src_root.parent / "src-tauri" / "icons" / "icon.ico"),
)
