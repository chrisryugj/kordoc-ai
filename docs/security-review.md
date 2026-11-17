# 보안성 검토 자료

기관 정보보안 담당자·정보통신 담당자가 KorDoc AI 를 들이기 전에 확인할 내용: 통신, PC 에 남는 것, 실행하는 프로그램, 외부 AI 보호, 입력 방어, 공급망, 한계. 항목마다 근거가 되는 코드 위치를 적음. 기관 배포 설정(정책 파일)은 [기관 배포 설정](deploy-policy.md) 참고.

- 대상: KorDoc AI 2.3.x(main), 문서 엔진 kordoc 4.24.83
- 작성: 2026. 11. 17.
- 확인 방법: 저장소 코드와 자동 시험(엔진 시험·화면 시험·Rust 시험·설치본 스모크). 제3자 보안 진단은 받지 않음(9장)

## 1. 요약

| 질문 | 답 |
| --- | --- |
| 문서 내용을 밖으로 보내는가 | 기본 설정에서는 보내지 않음. 사용자가 외부 AI(Gemini·Claude API 키, PC 에 로그인한 구독 계정)를 골랐을 때만 그 AI 회사로 나감. 이때 개인정보를 가린 뒤 보내는 것이 기본(3·5장) |
| 인터넷에 접속하는가 | 기본 설정에서 없음. 사용자가 켠 기능(외부 AI·법령 확인·내장 AI 모델 받기)만 나감. 새 버전 확인·사용 통계 전송·계정 로그인 없음 |
| 폐쇄망에서 쓸 수 있는가 | 씀. 설치 파일에 Node.js·문서 엔진·OCR 모델·한글 편집기·WebView2·VC++ 런타임이 들어 있음. 폐쇄망 모드를 켜면 인터넷 주소로 가는 요청을 보내기 전에 막음(정책 파일로 고정 가능) |
| 관리자 권한이 필요한가 | 사용자 단위 설치 파일(NSIS `…_x64-setup.exe`)은 필요 없음. MSI 는 PC 단위 설치라 관리자 권한으로 설치 |
| 원본 문서를 바꾸는가 | 바꾸지 않음. 결과는 새 파일. 예외는 사용자가 한글 편집기에서 저장하거나 문서 수합에서 「같은 파일 바꾸기」를 고른 때뿐이고, 이때도 덮기 전에 옆에 `.bak` 백업을 만들고 백업을 못 하면 저장하지 않음 |
| 문서 내용이 PC 에 따로 남는가 | 남는 것이 있음: 저장 안 한 편집 문서의 복구 사본, 우리 기관 문서 모음 사본, AI 대화 기록 등(2장 표의 「문서 내용」 줄). 모두 이 PC 의 사용자 폴더 안 |
| 실행 기록(로그)을 파일로 남기는가 | 남기지 않음. 엔진 로그는 표준 오류로만 내고 앱이 콘솔로 넘김(`node-sidecar/src/infra/logger.ts`, `src-tauri/src/main.rs`) |

## 2. PC 에 놓이는 것

| 구성 | 위치 | 내용 |
| --- | --- | --- |
| 프로그램 | NSIS: `%LOCALAPPDATA%\KorDoc AI\` · MSI: `Program Files` 아래 · macOS: `/Applications/KorDoc AI.app` | 앱(Tauri), 동봉 Node.js, 문서 엔진, OCR 모델, 한글 편집기 정적 파일, 라이선스 고지 |
| 설정 | 앱 데이터 `settings.json` (Windows `%APPDATA%\com.kordoc-ai.app\`, macOS `~/Library/Application Support/com.kordoc-ai.app/`) | 기관 정보·AI 연결·폐쇄망 모드 등. Windows 에서는 API 키를 AES-256-GCM 으로 암호화해 둠(키는 자격 증명 관리자, 8장). macOS 는 평문(파일 권한 0600) |
| 문서 내용 | 앱 데이터 `recovery/` | 한글 편집기에서 저장하지 않은 문서의 복구 사본. 저장·버리기 때 지움 |
| 문서 내용 | 앱 데이터 `org-corpus/` | 「우리 기관 문서 모음」에 사용자가 넣은 문서의 HWPX 사본 |
| 문서 내용 | 앱 데이터 `작업 사본/`, `receipt/`, `styles/`, `templates/` | 편집기 작업 사본, 지출조서 기관 서식, 저장한 서식·서식함 |
| 문서 내용 | 앱 데이터 `inbox.json`, `usage.json` | 받은 공문 접수 목록(제목·기한 등), 처리 건수 집계 |
| 문서 내용 | 앱 창의 WebView 저장소(Windows `%LOCALAPPDATA%\com.kordoc-ai.app\EBWebView`) | AI 대화 기록(최근 대화 목록과 본문), 내 프롬프트 |
| 모델 | 앱 데이터 `models/` | 사용자가 받거나 가져온 내장 AI 모델(GGUF) |
| 결과 파일 | 기본 `문서\KorDoc AI 결과` (설정에서 바꿈) | 만든 문서 |
| 레지스트리(Windows, 현재 사용자) | `HKCU\Software\Classes\SystemFileAssociations\<확장자>\shell\KorDoc`, `…\Directory\shell\KorDoc`, `…\Directory\Background\shell\KorDoc` | 탐색기 우클릭 메뉴(첫 실행 마법사·설정에서 넣거나 뺌) |
| 레지스트리(Windows, 현재 사용자) | `HKCU\Software\Classes\kordoc` | `kordoc://` 주소 연결(우클릭 메뉴·문서 카드가 씀) |
| 자격 증명 관리자(Windows) | 대상 이름 「KorDoc AI」 | 설정 파일 API 키 암호화 키(`src-tauri/src/secrets.rs`) |
| Finder 빠른 동작(macOS) | `~/Library/Services/KorDoc - … .workflow` | 우클릭 빠른 동작 |
| 임시 파일 | 운영체제 임시 폴더 | PDF 작업용 변환본(`kordoc-pdf-work`, 하루 지나면 지움), PDF 인쇄용 브라우저 프로필(작업마다 새로 만들고 지움) |

서비스·시작 프로그램·방화벽 규칙·드라이버는 등록하지 않음. 앱을 지워도 앱 데이터 폴더는 남으므로, 문서 사본까지 지우려면 위 앱 데이터 폴더와 WebView 저장소 폴더를 함께 지움.

## 3. 네트워크 통신

기본 설정(AI 없이 시작, 폐쇄망 모드 꺼짐)에서 앱이 인터넷으로 보내는 요청은 없음. 아래 기능을 사용자가 켰을 때만 그 대상으로 나감.

| 기능 | 대상 | 보내는 것 | 켜는 곳 |
| --- | --- | --- | --- |
| 외부 AI(API 키) | `generativelanguage.googleapis.com`, `api.anthropic.com` | AI 에게 맡긴 문서 내용(개인정보 가린 뒤, 5장) | 설정 › AI 연결 |
| 외부 AI(구독 계정) | 각 프로그램의 회사 서버(Claude Code·Codex·Antigravity CLI) | 위와 같음 | 설정 › AI 연결, 「구독 계정으로 보내기 허용」을 따로 켜야 함(기본 꺼짐) |
| 기관 AI 서버 | 설정한 OpenAI 호환 주소 | 문서 내용 | 설정 › AI 연결 |
| 이 PC 의 AI 프로그램 찾기 | `127.0.0.1` 의 정해진 포트(Ollama 등) | 모델 목록 요청 | 첫 실행 마법사·설정 |
| 법령 확인 | `www.law.go.kr` (법제처 Open API) | 법령 이름·조문 번호 | 설정 › 법령 확인에 기관 OC 를 넣었을 때 |
| 내장 AI 모델 받기 | `huggingface.co` (커밋 고정 주소) | 없음(받기만) | 설정 › AI 연결 › 모델 받기 |

막는 장치:

- **통신 관문**: 앱 엔진이 밖으로 보내는 요청은 모두 `assertAllowed` 를 지남(`node-sidecar/src/infra/net-guard.ts`). 주소를 DNS 로 풀어 사설·루프백 주소인지 판정하고, 폐쇄망 모드면 그 밖의 주소는 보내기 전에 막음. 이름을 풀었더니 127.0.0.1 이 아닌 루프백이 나오는 가짜 주소(프록시 DNS)는 외부로 봄
- **통신 기록**: 허용·막음 결과를 모두 남기고 설정 › 보안에 「이번 실행에서 인터넷으로 나간 요청 N건」과 최근 기록 표로 보여 줌. 구독 프로그램은 실제 주소를 앱이 볼 수 없어 그 회사 대표 주소에 프로그램 이름을 붙여 늘 외부로 셈
- **문서 엔진(kordoc)**: 폐쇄망 모드면 `KORDOC_OFFLINE=1` 로 엔진 자체의 모델 내려받기도 막음. OCR 모델은 설치본에 들어 있어 내려받지 않음
- **앱 창(WebView2)**: 백그라운드 통신·SmartScreen 을 끈 인자로 띄움(`src-tauri/tauri.windows.conf.json`). 화면 보안 정책(CSP)은 앱 자신과 `127.0.0.1` 편집기 틀만 허용(`src-tauri/tauri.conf.json`)
- **PDF 인쇄용 브라우저**: PC 의 Edge·Chrome 을 화면 없이 띄우며 Puppeteer 기본 인자로 백그라운드 통신·동기화를 끔. 작업마다 새 프로필
- **한글 편집기**: 엔진이 `127.0.0.1` 에만 여는 읽기 전용 정적 파일 서버(`node-sidecar/src/core/editor-server`). 외부 웹 글꼴을 쓰지 않게 빌드

## 4. 앱이 실행하는 다른 프로그램

| 대상 | 언제 | 방식 |
| --- | --- | --- |
| 동봉 Node.js(문서 엔진) | 앱이 켜질 때 | 창 없이, 표준 입출력으로만 앱과 주고받음. PC 에 깔린 다른 Node 는 쓰지 않음 |
| Edge·Chrome | HWP·HWPX·워드 등을 PDF 로 낼 때 | 화면 없이, 파이프 연결(엔진이 꺼지면 브라우저도 끝남) |
| `reg.exe`(Windows) | 우클릭 메뉴를 넣거나 뺄 때 | 현재 사용자 키만, 창 없이 |
| PowerShell(Windows) | 인쇄·프린터 목록, 정책 파일 권한 확인 | `System32` 의 전체 경로로만 실행(이름만으로 찾지 않음: `node-sidecar/src/infra/win-tools.ts`), 제한 시간 있음 |
| 한컴오피스 한글(Windows, 설치된 PC) | 문서 엔진이 DRM 걸린 HWPX·배포용 HWP 를 만났을 때 | 문서 엔진(kordoc)이 PowerShell 로 한글 자동화(COM)를 불러 글을 읽음(최대 2분). 한글이 없으면 실패하고 「열 수 없음」으로 알림 |
| Claude Code·Codex·Antigravity CLI | 구독 계정 AI 를 골랐고 허용했을 때 | 셸을 거치지 않고 고정 인자로, 도구·MCP·파일 접근을 끈 채(5장) |
| 탐색기·Finder·기본 앱 | 「결과 폴더 열기」「만든 문서 열기」 | 문서 확장자만 열고 실행 파일은 열지 않음 |

문서 안의 매크로·스크립트는 실행하지 않음. 문서 엔진은 글과 구조만 읽음.

## 5. 외부 AI 를 쓸 때의 보호

- **보내기 전 가림**(기본 켜짐, `ai.redact_before_cloud`): 주민등록번호·전화번호·이메일·카드·계좌 등을 가린 꼴(●)로 바꿔 보내고, 답에 실려 온 가린 꼴은 이 PC 안에서 원래 값으로 되돌림. 대응표는 이 PC 메모리에만 있음
- **구독 계정 프로그램 제한**: 자식 프로세스 환경 변수는 허용 목록만 넘김, 글은 표준 입력·작업 폴더 파일로만(명령줄 인자로 문서를 넘기지 않음). Claude Code 는 도구 0개·MCP 0개·API 키 미사용을 시작 보고로 확인하고, 아니면 답 전에 끝냄. Codex 는 읽기 전용·승인 없음에 도구 기능을 끄고 기능 목록으로 확인. Antigravity CLI 는 도구 선언을 끌 수 없어 모든 도구를 거절 규칙으로 막고 도구 단계가 보이면 바로 끝냄(설정 화면에 「보호가 한 겹 약함」 경고). 근거: `node-sidecar/src/infra/llm/`
- **기관이 막기**: 정책 파일로 `ai.allow_subscription: false`, `privacy.offline: true`, AI 공급자 고정 등을 잠글 수 있음([기관 배포 설정](deploy-policy.md))

## 6. 입력 문서에 대한 방어

| 위험 | 대응 |
| --- | --- |
| 압축 폭탄(HWPX·DOCX·XLSX·PPTX) | 압축을 푼 크기 상한 256MB(`node-sidecar/src/core/files/zip-read.ts`, kordoc 과 같은 한도). 푼 XML 이 30MB 넘거나 PDF 3MB·파일 30MB 넘으면 작업자 스레드에서 읽음 |
| 멈춤 | 앱이 엔진에 15초마다 응답을 묻고 120초 답이 없으면 엔진을 다시 켬(`src-tauri/src/sidecar/manager.rs`). 무거운 읽기는 작업자 스레드라 취소가 바로 먹음 |
| 네트워크 경로 | 공유 폴더 UNC 경로(`\\서버\공유`)는 열지 않음(NTLM 릴레이 방지, `node-sidecar/src/infra/pathGuard.ts`). 드라이브 문자로 연결해 씀 |
| 시스템 폴더 | `C:\Windows`·`Program Files`·`ProgramData` 안에는 결과를 쓰지 않음 |
| 웹·메일 링크 | `kordoc://` 주소로 온 동작은 바로 돌지 않고 화면에 올리기만 함. 설치 때 만든 표지를 가진 Finder 동작만 바로 돔(`src-tauri/src/shell.rs`) |
| MCP 로 연결한 AI 프로그램 | 폐쇄망 모드거나 기관이 구독 계정 AI 보내기를 꺼서 잠갔으면 연결 등록과 앱 엔진(`--mcp`) 도구 호출을 거절함. 예전 판이 문서 엔진(kordoc) MCP 로 직접 등록한 항목은 이 검사를 거치지 않으므로 그런 PC 는 그 항목을 AI 프로그램 설정에서 지움(`mcpBlocked`, `node-sidecar/src/infra/net-guard.ts`: 그 프로그램이 문서를 어디로 보내는지 앱이 볼 수 없음). 폴더를 정하면 그 폴더 밖 파일은 엔진이 막음(`KORDOC_ROOT`). 엔진은 작업 폴더를 자기 폴더로 옮겨 받은 압축을 푼 폴더의 실행 파일을 이름만으로 집지 않게 함(`node-sidecar/src/main.ts`) |
| 정책 파일 바꿔치기 | `ProgramData` 의 정책 파일은 소유자가 관리자이고 일반 사용자가 쓸 수 없을 때만 적용([기관 배포 설정](deploy-policy.md)) |

## 7. 공급망

| 대상 | 받는 곳 | 고정·검증 |
| --- | --- | --- |
| Node.js(동봉) | nodejs.org | 정확한 판(`scripts/fetch-node.mjs` 의 `NODE_VERSION`)을 공식 `SHASUMS256.txt` 와 대조 |
| 문서 엔진 kordoc | npm | 정확한 판 고정(`node-sidecar/package.json`), 잠금 파일 무결성 해시. 같은 개발자의 MIT 프로젝트 |
| 엔진 의존 패키지 | npm | 잠금 파일 고정. 설치본에 싣는 패키지가 잠금 파일 판과 다르면 빌드 실패(`node-sidecar/scripts/stage-natives.mjs`). `npm audit` 0건(2026. 11. 17.) |
| 내장 AI 모델 | huggingface.co | 커밋 고정 주소, 받은 뒤 크기·GGUF 머리·SHA-256 확인 후 이름을 바꿈(`node-sidecar/src/core/ai/models.ts`) |
| 설치 파일 | GitHub Actions | 그 판의 태그를 빌드하고, 그 커밋의 CI 가 성공했을 때만 올림(`.github/workflows/release.yml`). 빌드 잡은 저장소에 쓰기 권한 없음 |

출품 관문(`node scripts/contest-gate.mjs`)이 타입·시험·빌드·설치본 스모크·도구 전수(원본 불변 포함)·비밀값·취약점(OSV)·고지를 한 번에 검사함.

## 8. 직접 확인하는 방법

1. **통신**: 설정 › 보안의 「이번 실행에서 인터넷으로 나간 요청」 건수와 최근 통신 기록 표. 방화벽에서 `kordoc-ai.exe`·동봉 `node.exe` 의 외부 연결을 막고 써 봐도 AI 없이 하는 기능(변환·점검·가리기·수합·PDF)은 그대로 돎
2. **엔진 상태**: 설정 › 엔진과 모델 › 엔진 점검(문서 읽기·만들기·OCR 단계별 결과)
3. **폐쇄망 고정**: 정책 파일 `locked` 에 `{"privacy": {"offline": true}}` 를 넣으면 설정 화면에서 끌 수 없음
4. **코드**: 외부로 나가는 요청은 `assertAllowed`·`assertProgramEgress` 를 거치는 곳뿐임

   ```bash
   grep -rn "assertAllowed\|assertProgramEgress\|fetch(" node-sidecar/src --include="*.ts"
   ```

## 9. 확인하지 못한 것·알려진 한계

| 항목 | 상태 |
| --- | --- |
| 코드 서명 | 없음. 처음 실행 때 Windows SmartScreen·macOS Gatekeeper 가 한 번 묻고, 백신이 경고할 수 있음 |
| 제3자 보안 진단 | 받지 않음 |
| 패킷 수집으로 실제 통신 확인 | 하지 않음(통신 기록은 앱 안 관문 기준) |
| WebView2·Windows 자체 통신 | 앱 설정과 별개. 운영체제 정책으로 따로 확인 |
| API 키 암호화 | Windows 만. macOS 는 사용자 폴더 안 평문(파일 권한 0600) |
| 한글 자동화(4장) | DRM HWPX·배포용 HWP 를 읽을 때 문서 엔진이 한글을 띄움. 끄는 설정은 아직 없음 |
| 앱 데이터의 문서 사본(2장) | 따로 암호화하지 않음. 사용자 계정·디스크 암호화(BitLocker·FileVault)에 맡김 |
