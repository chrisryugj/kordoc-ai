# 기관 배포 설정 (policy.json)

기관 정보통신 담당자가 파일 하나로 여러 PC에 같은 설정을 미리 넣는 기능. 내부 AI 서버 주소, 기관 정보 기본값, 폐쇄망 모드 등을 넣고 그중 일부는 설정 화면에서 바꾸지 못하게 고정함. 고정은 보안 경계가 아님(아래 "주의").

- `defaults`: 사용자가 아직 정하지 않은 칸의 기본값. 사용자가 바꾸면 사용자 값이 이김.
- `locked`: 항상 이 값. 설정 화면에서 칸이 잠기고 "기관에서 정함" 표시가 붙음.

## 두는 곳

앱이 켜질 때 아래 순서로 찾고, 처음 찾은 파일 하나만 씀.

| 순서 | 위치 | 비고 |
| --- | --- | --- |
| 1 | 환경변수 `KORDOC_AI_POLICY` 에 적은 경로 | 시험·특수 배치용 |
| 2 | Windows: `%ProgramData%\KorDoc AI\policy.json` (보통 `C:\ProgramData\KorDoc AI\policy.json`) | **권장.** 관리자만 고칠 수 있게 둠 |
| 2 | macOS: `/Library/Application Support/KorDoc AI/policy.json` | **권장.** 관리자 권한이 있어야 쓸 수 있는 곳 |
| 3 | 설치 폴더의 `policy.json`: `node` 폴더가 들어 있는 폴더 (Windows 는 `kordoc-ai.exe` 가 있는 폴더, macOS 는 `KorDoc AI.app/Contents/Resources/`) | 설치 파일과 함께 묶어 배포할 때 |

- 고정(`locked`)을 지키려면 2번 위치에 두고 사용자에게 쓰기 권한을 주지 않음. 1번 환경변수는 다음 줄처럼 따로 막아야 함.
- 1번(환경변수)이 2번보다 앞이므로, 사용자가 자기 계정 환경변수로 다른 파일을 가리키면 기관 파일 대신 그 파일을 읽음. 이 점을 막아야 하는 환경이면 사용자 환경변수 변경을 그룹 정책으로 제한함.
- Windows 사용자 단위 설치(NSIS)는 설치 폴더를 사용자가 고칠 수 있으므로 3번 위치의 고정은 사용자가 지울 수 있음.
- macOS 는 앱 묶음(.app) 안을 고치면 서명 검사에 걸릴 수 있어 2번 위치를 씀.
- 파일을 고친 뒤에는 앱을 끝내고(트레이 포함) 다시 켜야 적용됨.

## 형식

UTF-8 로 저장한 JSON 파일. 메모장이 붙이는 BOM 은 읽음.

```json
{
  "version": 1,
  "notice": "설정 화면 맨 위에 보일 한 줄 (선택)",
  "defaults": { "설정 일부": "…" },
  "locked": { "설정 일부": "…" }
}
```

| 키 | 필수 | 내용 |
| --- | --- | --- |
| `version` | 예 | 숫자 `1` |
| `notice` | 아니요 | 안내 한 줄. 예: 배포 부서·문의처 |
| `defaults` | 아니요 | 기본값. 모양은 아래 항목표와 같음 |
| `locked` | 아니요 | 고정값. 모양은 아래 항목표와 같음 |

예시: 레포 루트 [`policy.example.json`](../policy.example.json) (가상의 가온시 값).

## 적용 순서

`앱 기본값 < defaults < 사용자 설정 < locked`

- 사용자 설정 파일(`settings.json`)에는 사용자가 직접 바꾼 값만 저장함. 기관 기본값·고정값은 써 넣지 않음.
- 그래서 `defaults` 를 고치면 사용자가 바꾸지 않은 칸은 새 값을 따라가고, 정책 파일을 빼면 고정 전에 사용자가 쓰던 값이 돌아옴.
- 고정된 칸을 저장하려 해도 그 값은 무시하고 나머지만 저장함.

## 정할 수 있는 항목

구획은 아래 7개만. 같은 자리에 같은 형식(글자·숫자·true/false·글자 목록)이어야 함.

| 경로 | 형식 | 내용 |
| --- | --- | --- |
| `ai.provider` | 글자 | AI를 돌릴 곳: `none`(쓰지 않음)·`embedded`(이 PC 안)·`local`(이 PC의 로컬 모델 서버)·`openai`(기관 서버)·`gemini`·`anthropic`·`claude-code`(구독 계정, Claude Code)·`codex`(구독 계정, ChatGPT/Codex) |
| `ai.local.base_url` · `ai.local.model` · `ai.local.api_key` | 글자 | 이 PC의 로컬 모델 서버 주소(OpenAI 호환, 예: `http://127.0.0.1:11434/v1`)·모델·키(대개 비움) |
| `ai.allow_subscription` | true/false | 구독 계정(Claude Code·Codex)으로 문서 보내기 허용 (기본 `false`). **`locked` 에 `false` 로 두면 구독 연결을 막음**(설정 화면 칸이 "기관에서 막음"으로 잠기고 프로그램을 띄우지 않음) |
| `ai.claude_code.model` · `ai.claude_code.cli_path` · `ai.codex.model` · `ai.codex.cli_path` | 글자 | 구독 프로그램이 쓸 모델(빈 글자면 프로그램 기본)·실행 파일 위치(빈 글자면 PATH 와 흔한 설치 폴더에서 찾음). **`cli_path` 는 이 배포 설정으로만 정함**: 설정 화면과 사용자 settings.json 의 값은 버림(화면이 뚫려도 아무 실행 파일이나 띄우지 않게) |
| `ai.openai.base_url` | 글자 | 기관 AI 서버 주소 (OpenAI 호환, 예: `http://10.10.1.20:8000/v1`) |
| `ai.openai.api_key` | 글자 | 기관 서버 키 (아래 주의 참고) |
| `ai.openai.model` · `ai.openai.vision_model` | 글자 | 쓸 모델·그림 읽기 모델 이름 |
| `ai.gemini.api_key` · `ai.gemini.model` | 글자 | Gemini 키·모델 |
| `ai.anthropic.api_key` · `ai.anthropic.model` | 글자 | Claude 키·모델 |
| `ai.embedded.model_path` · `ai.embedded.context_size` · `ai.embedded.gpu` | 글자·숫자·글자 | 내장 모델 파일 경로, 한 번에 읽는 길이(토큰), GPU `auto`·`off` |
| `ai.redact_before_cloud` | true/false | 인터넷 AI로 보내기 전 개인정보 자동 가림 |
| `ai.timeout_ms` | 숫자 | AI 응답 대기 한도(밀리초) |
| `privacy.offline` | true/false | 폐쇄망 모드 (인터넷 주소로 나가는 요청 차단) |
| `org.name` · `dept` · `position` · `person` · `phone` · `fax` · `email` · `address` · `homepage` | 글자 | 내 기관 정보 |
| `org.approval_line` | 글자 목록 | 결재선 직위, 예: `["담당", "팀장", "과장"]` |
| `org.agency` | 글자 | 기관 서식 이름 (빈 글자면 공통 서식) |
| `org.seal_image` | 글자 | 관인·서명 PNG 경로 (각 PC에 같은 경로로 파일을 둬야 함) |
| `org.doc_number_prefix` | 글자 | 문서번호 앞부분, 예: `총무과-` |
| `convert.output_dir` | 글자 | 결과 저장 폴더 (빈 글자면 원본 옆) |
| `convert.ocr` | 글자 | 스캔 쪽 글자 읽기: `auto`·`force`·`off` |
| `general.log_level` | 글자 | `debug`·`info`·`warn`·`error` |
| `impact.baselines.<일 종류>` | 숫자 | 효과 집계 기준 시간(분) |
| `law.oc` | 글자 | 법제처 Open API 아이디 |

- `ai.provider` 등 정해진 값만 쓰는 칸은 형식만 검사함. 표에 없는 글자를 넣으면 그대로 들어가 그 기능이 동작하지 않을 수 있음.
- 경로 칸(`convert.output_dir`·`org.seal_image`)은 이 PC 의 폴더나 드라이브 문자로 연결한 공유 폴더로 적음(예: `Z:\서식\관인.png`). `\\서버\공유\…` 꼴의 네트워크 경로(UNC)는 앱이 쓰지 않음: `convert.output_dir` 는 그 값만 버리고(엔진 로그) 원본 옆에 저장하고, `org.seal_image` 는 날인할 때 오류가 남.
- 설정 화면에서 잠금 표시가 붙는 칸: 내 기관 정보 전체, AI 연결(AI를 돌릴 곳·주소·키·모델·자동 가림), 보안의 폐쇄망 모드, 첫 실행 안내의 같은 칸. 내장 모델 설정은 한 줄 안내만 보임. 저장 폴더·글자 읽기 기본값·효과 집계 기준 시간·법령 아이디는 엔진에서 고정되지만 화면에 표시가 아직 없음.

## 잘못됐을 때

| 상황 | 동작 |
| --- | --- |
| 파일을 못 읽음, UTF-8 아님, JSON 문법 오류, `version` 이 1이 아님 | 파일 전체를 무시하고 사용자 설정으로 엶. 설정 화면 맨 위에 "기관 배포 설정 파일을 읽지 못했습니다: (까닭과 할 일)" 과 파일 경로 표시 |
| 모르는 구획·항목, 형식이 다른 값, `__proto__`·`constructor`·`prototype` 같은 금지 이름 | 그 값만 버리고 나머지는 적용. 엔진 로그(stderr)에만 남음 |

JSON 문법 오류는 몇째 줄 몇째 칸 근처인지 알려 줌. 흔한 원인은 마지막 항목 뒤 쉼표, 작은따옴표, 닫는 괄호 빠짐.

## 확인 방법

1. 정책 파일을 두고 앱을 다시 켬.
2. 설정 화면 맨 위 안내 확인: "기관 배포 설정이 적용됐습니다: (notice)" 와 읽은 파일 경로.
3. 고정한 칸마다 "기관에서 정함" 표시와 잠김 확인. 표시가 없으면 경로 철자와 형식(글자·숫자·true/false)을 확인함. 값 단위 오류는 화면에 나오지 않음.
4. 기본값을 넣은 칸에 그 값이 들어 있는지 확인 (사용자가 이미 바꾼 칸은 사용자 값이 보임).

## 주의

- 정책 파일은 PC 사용자가 읽을 수 있음. `api_key` 를 넣으면 화면에서는 가려도 파일을 열면 보이므로 기관 내부 서버용 키만 넣음.
- 고정은 설정 화면과 엔진에서 값을 바꾸지 못하게 하는 장치이며 보안 경계가 아님. 사용자가 자기 계정 환경변수 `KORDOC_AI_POLICY` 로 다른 파일을 가리키면 기관 파일의 고정이 빠짐(관리자 권한 불필요, 막는 법은 위 "두는 곳"). PC 관리자 권한이 있으면 정책 파일 자체도 고칠 수 있음.

## 우클릭 메뉴 (Windows 탐색기)

- 메뉴는 사용자 계정마다 따로 들어감: `HKCU\Software\Classes\SystemFileAssociations\<확장자>\shell\KorDoc`. 관리자 권한은 필요 없고, 설치 파일(NSIS·MSI)은 메뉴를 넣지 않음.
- 사용자가 직접 넣을 때: 설정 > 저장과 연결 > 탐색기 우클릭 메뉴 > 메뉴 넣기.
- 여러 PC에 넣을 때: 사용자마다 그 사용자 계정으로 아래 명령을 실행함(로그온 스크립트 등). MSI 를 관리자 계정으로 일괄 설치해도 각 사용자의 메뉴는 이 명령을 그 사용자로 돌려야 들어감.

| 명령 | 하는 일 |
| --- | --- |
| `kordoc-ai.exe --shell-menu install` | 메뉴 넣기 (메뉴는 이 명령을 실행한 `kordoc-ai.exe` 경로를 가리킴) |
| `kordoc-ai.exe --shell-menu uninstall` | 메뉴 빼기 |
| `kordoc-ai.exe --shell-menu status` | 들어 있는지 확인 |

- 창 없이 처리하고 끝남. 성공하면 종료 코드 0, 실패하면 1. 배포판은 창 앱이라 명령 프롬프트가 끝나길 기다리지 않고 안내 글도 보이지 않으므로, PowerShell 에서 끝날 때까지 기다린 뒤 종료 코드와 레지스트리로 확인함.

```powershell
# 사용자 단위 설치(NSIS) 기본 위치. MSI 로 깔았으면 그 설치 폴더의 kordoc-ai.exe
$exe = "$env:LOCALAPPDATA\KorDoc AI\kordoc-ai.exe"
$p = Start-Process -FilePath $exe -ArgumentList '--shell-menu', 'install' -Wait -PassThru
if ($p.ExitCode -ne 0) { Write-Error "우클릭 메뉴를 넣지 못했습니다(종료 코드 $($p.ExitCode)). 앱을 한 번 켜서 설정 > 저장과 연결에서 메뉴 넣기를 눌러 보세요." }
Test-Path 'HKCU:\Software\Classes\SystemFileAssociations\.hwpx\shell\KorDoc'   # True 면 들어 있음
```

- 지울 때: 사용자 단위 설치(NSIS)의 제거 프로그램은 제거하는 사용자의 메뉴를 함께 지움. MSI 로 일괄 제거하면 다른 사용자 계정의 메뉴가 남을 수 있으므로, 제거 전에 사용자마다 `--shell-menu uninstall` 을 실행함.
- macOS 는 Finder 빠른 동작(`~/Library/Services/KorDoc - … .workflow`)으로 들어가고, 같은 명령을 `"/Applications/KorDoc AI.app/Contents/MacOS/kordoc-ai" --shell-menu install` 로 실행함.

## 공유 폴더 (네트워크 경로)

- 앱은 `\\서버\공유\…` 꼴의 네트워크 경로(UNC)를 열거나 저장하지 않음(NTLM 릴레이 같은 공격을 막으려는 것). 문서 열기·저장 위치·폴더 감시·관인 그림 모두 같음.
- 공유 폴더는 드라이브 문자(예: `Z:`)로 연결한 뒤 그 경로로 고름. 정책 파일의 경로 칸도 같음(위 "정할 수 있는 항목").

## PC 준비

- PDF 내보내기(한글·글 문서를 PDF 로, 합본 PDF)는 Microsoft Edge 나 Google Chrome 으로 인쇄해서 만듦. Windows 10·11 은 보통 Edge 가 들어 있음. macOS 는 Chrome(또는 Edge)을 응용 프로그램 폴더에 설치함. 둘 다 없으면 "PDF로 내보내려면 Microsoft Edge나 Chrome이 필요합니다" 오류가 남.
- 내장 AI 모델 파일(.gguf, 기본 추천 모델 약 2.3GB)은 설치 파일에 없음. PC 마다 설정 > AI 연결에서 한 번 받거나, 받은 파일을 USB 로 옮겨 가져옴. 정책의 `ai.embedded.model_path` 로 가리키려면 각 PC 의 같은 경로에 파일을 둠.
