# 한글 공문서 작성 도구 비교 측정 (재현용)

kordoc-ai 와 공개된 한글 문서(HWP·HWPX) 작성 도구를 같은 입력, 같은 잣대로 잰다. 요약은 [docs/challenge/benchmark.md](../../docs/challenge/benchmark.md).
공개 저장소에는 이 안내만 올린다. 아래 실행 코드·입력·숫자 원본(`results.json`)은 비교 도구의 실명·저장소 주소와 측정 PC 의 경로가 들어 있어 레포 루트 `.gitignore` 로 뺐다(측정 PC 에만 있음).
비교 도구 이름은 공개 문서에서 익명(도구 A·B·C …)이고, 실명 대응은 `out/names.md` 에만 둔다.

## 폴더

| 경로 | 내용 |
| --- | --- |
| `inputs/` | 공통 입력: 메모 3건(`memo-*.txt`), 사람이 정리한 개요 3건(`outline-*.json`), 핵심 사실 점검표(`fact-checklist.json`), 기안문·양식 값·섞인 마크다운 |
| `lib/` | 공통 코드: 개요 → 도구별 입력(`outline.mjs`), 사이드카 JSON-RPC(`sidecar.mjs`), 로컬 LLM(`llm.mjs`), 도구 중립 HWPX 읽기(`inspect.mjs`), 서식 판정(`features.mjs`), rhwp 배치 결함(`layout.mjs`), 과제별 정답 대조(`taskchecks.mjs`), 쪽 그림(`render.mjs`) |
| `py/` | 도구 가상환경에서 `python -I` 로 도는 실행기·검사기 래퍼 |
| `java/` | hwpxlib 로 열어 보기 |
| `run-*.mjs` | 과제 실행 |
| `score.mjs` | 채점 → `results.json` |
| `contact-sheet.mjs` · `hwp-sheet.mjs` | 쪽 그림·접촉 시트 → `out/png`, `out/sheets` |
| `fact-audit.json` | 전체 과정 결과물의 사람 판정 기록(이번 실행분) |
| `out/` | 설치한 도구·생성 문서·그림(gitignore) |

## 준비

- 레포 루트에서 `node-sidecar` 의존성과 사이드카 번들(`node scripts/build-sidecar.mjs`)이 있어야 한다. 사이드카는 앱처럼 `node-sidecar/dist/bundle.mjs` 를 부른다.
- 비교 도구: `BENCH_TOOLS=/경로 bash bench/compare/setup-tools.sh` (도구마다 새 폴더, 파이썬은 그 폴더 `.venv`, 커밋 고정). 인터넷은 이 단계만 쓴다.
- 전체 과정(A)만 로컬 LLM 이 필요하다: Ollama `http://127.0.0.1:11434/v1`, 모델 `gemma4:e4b`. 유료 API 는 부르지 않는다(`lib/llm.mjs` 가 로컬 주소가 아니면 거절).
- 그림: 헤드리스 Chrome/Edge(`BENCH_CHROME`). 맥 한컴오피스가 있으면 그 묶음 글꼴로 그린다(`BENCH_HANGUL_FONTS`, 없으면 대체 글꼴).
- 과제 (e)는 kordoc 코퍼스 `pairs/`(HWP + 한컴이 저장한 HWPX 짝)를 읽기만 한다(`BENCH_CORPUS`, 기본 `~/workspace/kordoc/bench/corpus`). 코퍼스 파일은 레포에 복사하지 않는다.

## 실행 순서

```bash
export BENCH_TOOLS=/경로/bench-tools
node bench/compare/run-typeset.mjs          # (B) 조판만: 같은 개요 → kordoc-ai·도구 A·도구 C
node bench/compare/run-pipeline.mjs --reps 3 # (A) 전체 과정: 같은 메모 → 로컬 LLM → kordoc-ai·도구 A (약 15분)
node bench/compare/run-native-b.mjs          # 도구 B 공개 예제 원문 → kordoc-ai, 도구 B 공개 결과와 나란히
node bench/compare/run-tasks.mjs             # (a) 기안문 (d) 양식 채우기 (e) 옛 HWP → HWPX (f) 섞인 마크다운
node bench/compare/score.mjs                 # 채점 → results.json
node bench/compare/contact-sheet.mjs         # 쪽 그림·접촉 시트
node bench/compare/hwp-sheet.mjs             # (e) 한컴 PDF·한컴 HWPX·결과 나란히
```

`run-pipeline.mjs --kind memo` 로 kordoc-ai 초안 종류를 바꿔 다시 잴 수 있다(사이드카 번들을 다시 빌드한 뒤).
LLM 결과는 매번 달라서 `fact-audit.json`(사람 판정)은 그 실행분에만 맞는다. 다시 돌리면 `out/pipeline-texts.txt` 를 다시 읽고 판정을 새로 적는다.

## 무엇을 재나

| 항목 | 방법 |
| --- | --- |
| 다른 엔진에서 열림 | rhwp 0.8.6 전 쪽 SVG · kordoc parse·validateHwpx · hwpxlib 1.0.5(자바) · 도구 D(파이썬 라이브러리) · 도구 B 검증기 · 도구 C 검증기 |
| 표기 규정 | kordoc 표기법·개조식 문체 검사, 도구 A 점검기, 도구 B 검토기(낱말표 포함), 도구 C 표기 검수기. 모든 검사기는 도구 중립으로 뽑은 글을 받는다 |
| 서식 | 제목 상자·요약 상자·장 제목·항목 위계(□·ㅇ·-)·단계별 서식 일관·단계 구분·표 머리 음영·쪽번호 (`lib/features.mjs`) |
| 배치 결함 | rhwp 글자 좌표로: 외톨이 줄, 선·글자 겹침, 본문 영역 넘침 (`lib/layout.mjs`). kordoc-ai 내장 편집기·PDF 와 같은 엔진 기준 |
| 내용 | 조판: 개요 글 조각 누락 수. 전체 과정: 메모 숫자 보존율과 사람 판정 점검표(핵심 사실 맞음·틀림·빠짐, 지어낸 서술) |
| 속도 | 엔진 안 시간(데운 뒤 5회 중앙값), 한 번 실행 벽시계, 전체 과정은 LLM 포함 문서 1건 시간 |

## 함정 (실측)

- 사이드카는 있는 파일을 덮어쓰지 않고 `이름 (2).hwpx` 로 쓴다. 다시 돌릴 땐 실행기가 먼저 지운다.
- 도구 B 검토기는 `<hp:tab/>`·`<hp:nbSpace/>` 를 글로 안 읽는다: kordoc 의 "부호 + 탭"을 부호로 못 알아보고, 날짜 묶음 빈칸을 빈칸 없는 날짜로 읽는다(도구 C 검수기도 같음). 그래서 도구 B 검토기는 원본 그대로와 "탭 → 빈칸" 사본 두 번 돌린다.
- 한컴 묶음 글꼴 중 HY견고딕·HY견명조·HY울릉도M 은 크로미움이 거부한다(cmap 오류) → `py/fix_fonts.py` 사본. 한컴돋움은 크로미움에서 일부 음절이 깨져 빼고 다음 글꼴로 그린다. 굵은 꼴이 없는 글꼴의 굵게는 획을 덧그려 흉내 낸다.
- LibreOffice + H2Orestart 는 확장 등록 때 GUI soffice 가 떠서 쓰지 않았다.
