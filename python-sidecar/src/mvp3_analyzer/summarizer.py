"""MVP 3 Step 1: 개별 파일 요약.

google-genai SDK 직접 사용 (langchain 제거).
"""

import time
import logging
from pathlib import Path

from google import genai
from google.genai import types

from src.shared.result import Result
from src.shared.env_loader import ensure_api_key
from src.shared import read_text_file

logger = logging.getLogger("mvp")

SYSTEM_PROMPT = """당신은 교육시설 사전기획 문서 분석 전문가입니다.
당신의 임무는 학교 신설·증축·개축 사전기획 문서에서 핵심 정보를 추출하여 구조화하는 것입니다.

[추출 항목]
1. 기본정보: 학급수, 학생수(연도별 배치계획 포함), 부지면적, 건축면적, 연면적
2. 사업 개요: 사업 유형(신축/증축/개축), 사업 기간(착공·준공), 총사업비 내역
3. 교육과정 운영: 핵심 특색교육 프로그램명, 교육과정 비전, 교육활동별 공간 요구사항
4. 공간 계획: 스페이스 프로그램 상세(교실명·면적), 배치 계획, 특수실 구성
5. 발주·설계: 설계발주방식, 근거 법령, 설계 조건·기준
6. 사용자 참여: 설문조사 주요 결과(상위 응답 %), 참여 프로세스
7. 위해요소·안전: 공사 중 학습권 보호 방안, 인증 의무 사항

[출력 형식]
- 각 항목을 **항목명** 형태로 명시
- 수치 데이터는 단위까지 원문 그대로 인용 (예: "25,273.00m²", "124명")
- 중요 고유명칭은 원문 그대로 사용 (예: "OO 아고라", "탄소제로 생생학교")
- 원문의 핵심 표현은 큰따옴표로 인용 (예: "학생 주도적 학습 및 협업을 위한 가변형 공간")
- 설문조사 결과는 응답 항목·비율 구체적으로 기재
- 분량: 각 항목당 3~7개 불릿, 전체 600~1000자 목표

[주의사항]
- 반드시 문서에 명시된 원래의 명칭을 그대로 사용하십시오.
- 데이터에 없는 항목은 '미기재'로 표기하십시오.
- 추측이나 해석을 추가하지 마십시오."""


def run_step1(
    input_dir: Path,
    processed_dir: Path,
    model_name: str,
    temperature: float,
    timeout: int,
    wait_time: int,
    cancel_event=None,
    progress_callback=None,
) -> Result:
    """개별 파일을 요약하여 processed_dir에 저장합니다."""
    result = Result()
    processed_dir.mkdir(parents=True, exist_ok=True)

    api_key = ensure_api_key()
    # timeout은 SDK 기본값 사용 — http_options timeout(ms)을 짧게 잡으면
    # 응답 대기 중 끊김 발생. 에러는 아래 재시도 로직에서 처리.
    client = genai.Client(api_key=api_key)
    gen_config = types.GenerateContentConfig(
        temperature=temperature,
        system_instruction=SYSTEM_PROMPT,
    )

    # OCR 출력은 .md, 기존 파이프라인은 .txt — 둘 다 지원
    # 같은 stem에 .md와 .txt가 동시에 있으면 .md 우선 (중복 처리 방지)
    by_stem: dict[str, Path] = {}
    for f in input_dir.glob("*.txt"):
        by_stem[f.stem] = f
    for f in input_dir.glob("*.md"):
        by_stem[f.stem] = f  # .md가 .txt를 덮어씀
    files = sorted(by_stem.values())
    if not files:
        logger.warning(f"입력 파일이 없습니다: {input_dir}")
        return result

    logger.info(f"  {len(files)}개 파일 요약 시작")

    for idx, file_path in enumerate(files):
        if cancel_event and cancel_event.is_set():
            logger.warning("사용자에 의해 취소됨")
            break
        if progress_callback:
            progress_callback(idx, len(files), f"Step1 요약 ({idx + 1}/{len(files)}): {file_path.name}")

        processed_file = processed_dir / f"summary_{file_path.name}"

        if processed_file.exists() and processed_file.stat().st_size > 0:
            result.add_success(file_path.name, "이미 처리됨 (캐시)")
            if progress_callback:
                progress_callback(idx, len(files), f"✓ 캐시 사용: {file_path.name}")
            continue

        content = read_text_file(file_path)

        # 재시도 로직: 503/429 transient 에러는 최대 3회 재시도 (integrator 동일 패턴)
        text = None
        for attempt in range(3):
            if cancel_event and cancel_event.is_set():
                break
            try:
                if progress_callback:
                    progress_callback(idx, len(files), f"⏳ AI 요약 요청 중: {file_path.name} (시도 {attempt + 1}/3)")
                logger.info(f"  요약 중: {file_path.name} (시도 {attempt + 1}/3)")
                response = client.models.generate_content(
                    model=model_name, contents=content, config=gen_config)
                try:
                    text = response.text or ""
                except ValueError:
                    reason = getattr(response.candidates[0], 'finish_reason', 'UNKNOWN') if response.candidates else 'NO_CANDIDATES'
                    logger.warning(f"  안전 필터 차단: {file_path.name} (사유: {reason})")
                    text = ""
                break  # 성공 시 재시도 루프 탈출

            except Exception as e:
                err_str = str(e).lower()
                is_transient = any(kw in err_str for kw in ("503", "429", "unavailable", "quota", "timeout"))
                if is_transient and attempt < 2:
                    retry_wait = 5 * (2 ** attempt)
                    logger.warning(f"  임시 오류 (재시도 {retry_wait}초 후): {e}")
                    if progress_callback:
                        progress_callback(idx, len(files), f"⏳ API 대기 중... {retry_wait}초")
                    if cancel_event:
                        if cancel_event.wait(retry_wait):
                            break
                    else:
                        time.sleep(retry_wait)
                else:
                    result.add_failure(file_path.name, str(e))
                    logger.error(f"  실패: {file_path.name} — {e}")
                    if progress_callback:
                        progress_callback(idx, len(files), f"✕ 실패: {file_path.name} — {e}")
                    break

        if cancel_event and cancel_event.is_set():
            logger.warning("사용자에 의해 취소됨")
            break

        if text is None:
            continue
        if not text:
            logger.warning(f"  빈 응답: {file_path.name} (안전 필터 또는 빈 결과)")
            result.add_failure(file_path.name, "AI 응답이 비어 있습니다 (안전 필터 차단 가능성)")
            continue
        processed_file.write_text(text, encoding="utf-8")
        result.add_success(file_path.name)
        if progress_callback:
            progress_callback(idx + 1, len(files), f"✓ 요약 완료: {file_path.name}")
        # 다음 요청 전 대기 (rate limit 방지) — 취소 시 즉시 깨어남
        if cancel_event:
            if cancel_event.wait(wait_time):
                logger.warning("사용자에 의해 취소됨 (대기 중)")
                break
        else:
            time.sleep(wait_time)

    if progress_callback:
        progress_callback(len(files), len(files), "Step1 요약 완료")
    result.output_path = str(processed_dir)
    return result
