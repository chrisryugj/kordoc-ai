# KorDoc Suite 상세 기술 명세

> PRD.md의 기능을 코드 레벨로 구체화한 문서.
> 각 모듈의 입출력·시그니처·에러 케이스를 정의.

---

## 1. Layer 1: kordoc 코어

### 1.1 XLS Parser API

```typescript
// src/xls/parser.ts
export interface XlsParseOptions {
  sheet?: string | number;      // 특정 시트만 (이름 또는 인덱스)
  includeFormulas?: boolean;    // 수식 텍스트 포함 (기본 false: 결과값만)
  encoding?: 'auto' | 'cp949' | 'utf16le';  // 기본 auto
}

export async function parseXls(
  buffer: ArrayBuffer,
  options?: XlsParseOptions
): Promise<ParseResult>;
```

**ParseResult 구조** (기존 동일):
```typescript
{
  blocks: IRBlock[],      // 각 시트 = heading + table
  markdown: string,       // blocksToMarkdown(blocks)
  meta: {
    format: 'xls',
    sheets: string[],
    decryptable?: boolean // 암호화 시 false
  }
}
```

### 1.2 BIFF8 레코드 매핑

| Opcode | 이름 | 처리 |
|--------|------|------|
| 0x0809 | BOF | 스트림 시작, 버전 확인 |
| 0x000A | EOF | 스트림 종료 |
| 0x00FC | SST | 공유 문자열 테이블 |
| 0x003C | CONTINUE | SST 연속 데이터 |
| 0x0085 | BoundSheet8 | 시트 메타 (이름/오프셋) |
| 0x00FD | LabelSst | SST 참조 셀 |
| 0x0203 | Number | 숫자 셀 |
| 0x027E | RK | 압축 숫자 |
| 0x00BD | MulRK | 다중 RK |
| 0x0006 | Formula | 수식 |
| 0x00E5 | MergeCells | 병합 영역 |
| 0x0204 | Label | 구형 문자열 (drop) |

### 1.3 Print Renderer API

```typescript
// src/print/renderer.ts
export type PrintPreset = 'default' | 'gov-formal' | 'compact';

export interface PrintOptions {
  preset?: PrintPreset;
  pageSize?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  margin?: { top, right, bottom, left };  // mm
  header?: string;
  footer?: string;
  watermark?: string;
}

export async function markdownToPdf(
  markdown: string,
  options?: PrintOptions
): Promise<Buffer>;

export async function blocksToPdf(
  blocks: IRBlock[],
  options?: PrintOptions
): Promise<Buffer>;
```

**구현 후보**:
- A) `markdown-it` → HTML → puppeteer-core (Chromium 의존)
- B) `pdfkit` (순수 JS, 한글 폰트 임베딩 필요)
- **선택**: A — Chromium 외부 의존이지만 HTML/CSS 표현력 압도적

---

## 2. Layer 2: kordoc-ai RPC

### 2.1 print_files

```typescript
// node-sidecar/src/core/print/index.ts
interface PrintFilesParams {
  files: string[];           // 절대 경로 배열
  printer?: string;          // 미지정 시 기본 프린터
  preset?: PrintPreset;      // 변환 프리셋
  copies?: number;           // 부수 (기본 1)
  duplex?: boolean;          // 양면 (기본 false)
  color?: boolean;           // 컬러 (기본 true)
}

interface PrintFilesResult {
  queued: number;
  jobIds: string[];
  failed: { file: string; reason: string }[];
}

export async function printFiles(
  params: PrintFilesParams,
  signal: AbortSignal
): Promise<PrintFilesResult>;
```

**처리 흐름**:
1. 각 파일 → kordoc parse() → markdown
2. markdown → markdownToPdf() → 임시 PDF (`%TEMP%/kordoc-print/`)
3. PDF → `rundll32 shell32.dll,ShellExec_RunDLL /p <pdf> "<printer>"`
4. 또는 PowerShell: `Start-Process -FilePath $pdf -Verb PrintTo -ArgumentList "$printer"`
5. 60초 후 임시 PDF 정리

### 2.2 list_printers

```typescript
interface Printer {
  name: string;
  isDefault: boolean;
  status: 'ready' | 'offline' | 'error';
  driver?: string;
}

export async function listPrinters(): Promise<Printer[]>;
```

**구현**:
```bash
powershell -Command "Get-Printer | ConvertTo-Json"
```

### 2.3 mask_pii

```typescript
interface MaskPiiParams {
  input_path: string;
  output_path: string;
  types: ('rrn' | 'phone' | 'email' | 'account' | 'card' | 'name')[];
  use_ai_review?: boolean;   // AI로 false positive 검토
}

interface MaskPiiResult {
  output_path: string;
  masked: { type: string; count: number }[];
  total: number;
}
```

**정규식**:
- 주민번호: `\b\d{6}[-\s]?[1-4]\d{6}\b`
- 전화: `\b01[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b`
- 이메일: `\b[\w.+-]+@[\w-]+\.[\w.-]+\b`
- 계좌: `\b\d{2,6}-\d{2,6}-\d{2,7}\b`
- 카드: `\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b`

마스킹 패턴: `123456-1******` (앞 자리 유지)

---

## 3. Layer 3: kordoc-shell

### 3.1 AppxManifest 핵심

```xml
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
         IgnorableNamespaces="uap desktop">
  <Identity Name="KorDoc.Shell"
            Publisher="CN=KorDoc"
            Version="1.0.0.0"
            ProcessorArchitecture="x64"/>
  <Properties>
    <DisplayName>KorDoc Shell</DisplayName>
    <PublisherDisplayName>KorDoc</PublisherDisplayName>
    <Logo>assets/icon-50.png</Logo>
  </Properties>
  <Applications>
    <Application Id="KorDocShell" Executable="kordoc-launcher.exe">
      <Extensions>
        <uap:Extension Category="windows.fileTypeAssociation">
          <uap:FileTypeAssociation Name="kordoc-files">
            <uap:SupportedFileTypes>
              <uap:FileType>.hwp</uap:FileType>
              <uap:FileType>.hwpx</uap:FileType>
              <uap:FileType>.pdf</uap:FileType>
              <uap:FileType>.xlsx</uap:FileType>
              <uap:FileType>.xls</uap:FileType>
              <uap:FileType>.docx</uap:FileType>
              <uap:FileType>.doc</uap:FileType>
            </uap:SupportedFileTypes>
          </uap:FileTypeAssociation>
        </uap:Extension>
        <uap:Extension Category="windows.protocol">
          <uap:Protocol Name="kordoc"/>
        </uap:Extension>
      </Extensions>
    </Application>
  </Applications>
</Package>
```

### 3.2 Verb 구조

```xml
<!-- Microsoft.Registry.xml -->
<RegistryData>
  <RegistryKey Path="HKCU\Software\Classes\.hwp\shell\KorDoc">
    <RegistryValue Name="MUIVerb" Type="REG_SZ" Value="KorDoc"/>
    <RegistryValue Name="SubCommands" Type="REG_SZ" Value=""/>
    <RegistryValue Name="ExtendedSubCommandsKey" Type="REG_SZ"
                   Value="Software\Classes\KorDoc\Submenu"/>
  </RegistryKey>
  <RegistryKey Path="HKCU\Software\Classes\KorDoc\Submenu\shell\01_md">
    <RegistryValue Name="MUIVerb" Type="REG_SZ" Value="마크다운으로 변환"/>
    <RegistryKey Path="command">
      <RegistryValue Type="REG_SZ" Value='kordoc-launcher.exe convert "%1" md'/>
    </RegistryKey>
  </RegistryKey>
  <!-- ... 나머지 메뉴 동일 패턴 -->
</RegistryData>
```

### 3.3 kordoc-launcher.exe

**역할**: shell verb 호출 → kordoc-ai deep-link 변환

**구현 후보**:
- Rust (windows-rs) — 50KB 이내 단일 exe
- C# (single-file publish) — 빠른 개발

**선택**: Rust (Tauri와 동일 스택, 빌드 일관성)

```rust
// kordoc-launcher/src/main.rs
fn main() {
    let args: Vec<String> = std::env::args().collect();
    // args[1] = action, args[2..] = files
    let action = &args[1];
    let files: Vec<&String> = args[2..].iter().collect();

    if files.len() == 1 {
        // 단일: 직접 deep-link
        let url = format!("kordoc://{}?path={}", action,
                          urlencoding::encode(files[0]));
        open::that(&url).unwrap();
    } else {
        // 다중: manifest 파일 생성
        let manifest_path = create_manifest(action, &files);
        let url = format!("kordoc://batch?manifest={}",
                          urlencoding::encode(&manifest_path));
        open::that(&url).unwrap();
    }
}
```

### 3.4 Tauri deep-link 핸들러

```rust
// src-tauri/src/lib.rs
use tauri_plugin_single_instance;
use tauri_plugin_deep_link;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // 두 번째 인스턴스 → 첫 인스턴스로 args 전달
            let url = args.iter().find(|a| a.starts_with("kordoc://"));
            if let Some(url) = url {
                app.emit_all("deep-link", url).unwrap();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        // ...
}
```

```typescript
// src/App.tsx
listen('deep-link', (event) => {
  const url = new URL(event.payload as string);
  const action = url.host;  // convert / summarize / batch
  const path = url.searchParams.get('path');
  const manifest = url.searchParams.get('manifest');
  // 라우팅 처리
});
```

---

## 4. 에러 처리 정책

| 케이스 | 처리 |
|--------|------|
| XLS 파일 손상 | `cfb-lenient` 폴백, 부분 추출 |
| 암호화 XLS | `decryptable: false` 반환, 메시지 표시 |
| 인쇄 실패 | `failed[]` 배열에 추가, 다른 파일은 계속 |
| deep-link 길이 > 2000 | manifest 파일 방식 강제 |
| MSIX 미설치 | 설치 가이드 페이지 표시 |
| Node.js 미설치 | 기존 `install_node` RPC 활용 |

---

## 5. 테스트 전략

### Phase 1
- 단위: `tests/xls-record.test.ts`, `tests/xls-parser.test.ts`
- 통합: `tests/parse-auto-detect.test.ts`
- 회귀: 기존 HWP5/HWPX/XLSX 테스트 통과

### Phase 2
- E2E: PowerShell 스크립트로 우클릭 시뮬레이션
- 수동: 5종 확장자 우클릭 메뉴 표시 확인

### Phase 3
- 부하: 100개 파일 일괄 변환
- 부하: 10개 파일 동시 인쇄 큐잉

---

## 6. 코드 스타일 (kordoc 기존 따름)

- ESM only, 타입 strict
- 파일당 500줄 이하 (CLAUDE.md 가이드)
- IRBlock 우선, 마크다운 직접 생성 금지
- 에러는 `sanitizeError()` 통해 정규화
