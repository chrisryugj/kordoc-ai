/**
 * 인쇄 — 문서를 인쇄용 PDF 로 만든 뒤 OS 인쇄 큐에 넣는다.
 *
 * 흐름:
 *   1. PDF 만들기는 PDF 내보내기와 같은 경로(docToPdf): HWP·HWPX 는 rhwp 조판 그대로, PDF 는 그대로
 *      (종전엔 글로 바꿔 다시 찍어서 한글 서식이 날아갔다)
 *   2. 임시 폴더 kordoc-print/<시각>-<이름>.pdf 저장
 *   3. Windows: PowerShell `Start-Process -Verb PrintTo` · macOS·리눅스: CUPS `lp`
 *
 * 함정:
 *   - PrintTo verb는 시스템 등록 PDF 핸들러(Adobe Reader/Edge 등)에 의존. 미설치 시 실패.
 *   - copies/duplex/color 등 세부 옵션은 PrintTo verb로 제어 불가 (드라이버 기본값 사용).
 *     세부 제어가 필요하면 SumatraPDF 같은 외부 도구나 Win32 EnumPrintProcessors 필요.
 *   - 임시 PDF는 인쇄 큐 투입 후 즉시 삭제하면 OS가 못 읽음. 60초 지연 삭제.
 *
 * 참조: docs/archive/SPEC.md §2.1, §2.2 (v1 기획)
 */

import { execFile } from 'node:child_process';
import { writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PrintPreset } from 'kordoc';
import { docToPdf } from '../export/index.js';
import { validatePath } from '../../infra/pathGuard.js';
import { logger } from '../../infra/logger.js';
import { errorText } from '../errors.js';

const execFileAsync = promisify(execFile);

export interface PrintFilesParams {
  files: string[];
  printer?: string;
  preset?: PrintPreset;
  copies?: number;       // 현재 미사용 (드라이버 기본값) — UX 일관성 위해 시그니처만 유지
  duplex?: boolean;      // 동상
  color?: boolean;       // 동상
}

export interface PrintFailure {
  file: string;
  reason: string;
}

export interface PrintFilesResult {
  queued: number;
  jobIds: string[];
  failed: PrintFailure[];
}

export interface Printer {
  name: string;
  isDefault: boolean;
  status: 'ready' | 'offline' | 'error';
  driver?: string;
}

const PRINT_TEMP_DIR = join(tmpdir(), 'kordoc-print');
const TEMP_PDF_TTL_MS = 60_000;

async function ensurePrintTempDir(): Promise<void> {
  await mkdir(PRINT_TEMP_DIR, { recursive: true });
  // 60초 안에 엔진이 꺼져 못 지운 지난 인쇄 파일
  const cut = Date.now() - 3_600_000;
  for (const name of await readdir(PRINT_TEMP_DIR)) {
    const f = join(PRINT_TEMP_DIR, name);
    await stat(f).then((s) => (s.mtimeMs < cut ? unlink(f) : undefined)).catch(() => {});
  }
}

// PowerShell 은 ‘ ’ ‚ ‛ 도 작은따옴표로 읽는다 — 파일 이름·프린터 이름을 명령 글에 엮지 않고 환경 변수로 넘긴다(명령은 고정 글)
const PS_PRINT = [
  '$a = @{ FilePath = $env:KORDOC_PRINT_FILE; Verb = "PrintTo"; WindowStyle = "Hidden" }',
  // PrintTo 는 인자를 빈칸으로 나눠 %2 에 넣는다 — "HP LaserJet 4000" 같은 이름이 첫 낱말만 가지 않게 큰따옴표로 감싼다
  'if ($env:KORDOC_PRINTER) { $a.ArgumentList = \'"\' + $env:KORDOC_PRINTER + \'"\' }',
  'Start-Process @a',
].join('; ');

async function shellPrint(pdfPath: string, printer?: string): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, KORDOC_PRINT_FILE: pdfPath };
  if (printer) env.KORDOC_PRINTER = printer;
  else delete env.KORDOC_PRINTER;
  await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_PRINT], {
    windowsHide: true,
    env,
  });
}

async function scheduleTempCleanup(pdfPath: string): Promise<void> {
  setTimeout(() => {
    unlink(pdfPath).catch((e) => logger.warn(`[print] 임시 PDF 삭제 실패: ${pdfPath} (${e.message})`));
  }, TEMP_PDF_TTL_MS).unref?.();
}

export async function printFiles(
  params: PrintFilesParams,
  signal: AbortSignal,
): Promise<PrintFilesResult> {
  if (!Array.isArray(params.files) || params.files.length === 0) {
    throw new Error('인쇄할 파일이 없습니다. 파일을 고른 뒤 다시 시도하세요.');
  }
  await ensurePrintTempDir();

  const failed: PrintFailure[] = [];
  const jobIds: string[] = [];

  for (let i = 0; i < params.files.length; i++) {
    signal.throwIfAborted();
    let safePath: string;
    try {
      safePath = validatePath(params.files[i]);
    } catch (e) {
      failed.push({ file: params.files[i], reason: e instanceof Error ? e.message : String(e) });
      continue;
    }

    try {
      const pdfBuf = await docToPdf(safePath, signal);
      // 임시 이름은 ASCII 로만 — 원래 이름은 인쇄 대기열에 보일 필요가 없다
      const pdfName = `print-${Date.now()}-${i}.pdf`;
      const pdfPath = join(PRINT_TEMP_DIR, pdfName);
      await writeFile(pdfPath, pdfBuf);

      if (process.platform === 'win32') {
        await shellPrint(pdfPath, params.printer);
        jobIds.push(pdfPath);
      } else {
        const { stdout } = await execFileAsync('lp', lpArgs(pdfPath, params.printer), { env: { ...process.env, LANG: 'C', LC_ALL: 'C' } });
        jobIds.push(/request id is (\S+)/.exec(stdout)?.[1] ?? pdfPath);
      }
      void scheduleTempCleanup(pdfPath);
    } catch (e) {
      logger.warn(`[print_files] 실패 ${safePath}: ${e instanceof Error ? e.message : String(e)}`);
      // 화면엔 명령줄 원문 대신 할 일을 (기본 PDF 프로그램이 인쇄를 못 받는 PC 가 많다)
      failed.push({ file: safePath, reason: /Command failed|powershell|Start-Process|lp:/i.test(String(e)) ? '프린터로 보내지 못했습니다. PDF로 저장한 뒤 PDF 프로그램에서 인쇄하세요.' : errorText(e) });
    }
  }

  return { queued: jobIds.length, jobIds, failed };
}

// Get-Printer PrinterStatus 코드 (CIM_Printer.PrinterStatus)
//   1=Other 2=Unknown 3=Idle/Normal 4=Printing 5=Warmup 6=Stopped 7=Offline
function mapPrinterStatus(raw: unknown): Printer['status'] {
  if (typeof raw === 'number') {
    if (raw === 3 || raw === 4 || raw === 5) return 'ready';
    if (raw === 7) return 'offline';
    return 'error';
  }
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    if (lower === 'normal' || lower === 'idle' || lower === 'printing') return 'ready';
    if (lower === 'offline') return 'offline';
    return 'error';
  }
  return 'error';
}

/** CUPS lp 인자 — 프린터를 안 고르면 기본 프린터 */
export function lpArgs(pdfPath: string, printer?: string): string[] {
  return [...(printer ? ['-d', printer] : []), '--', pdfPath];
}

/** `LANG=C lpstat -p -d` 출력 → 프린터 목록 */
export function parseLpstat(out: string): Printer[] {
  const def = /system default destination:\s*(\S+)/.exec(out)?.[1];
  return [...out.matchAll(/^printer (\S+) (?:is (\w+)|(disabled))/gm)].map((m) => ({
    name: m[1],
    isDefault: m[1] === def,
    status: m[3] ? 'offline' : m[2] === 'idle' || m[2] === 'printing' ? 'ready' : 'error',
  }));
}

export async function listPrinters(): Promise<Printer[]> {
  if (process.platform !== 'win32') {
    // 프린터가 하나도 없으면 lpstat 이 0 이 아닌 종료 코드를 낸다 → 빈 목록
    const r = await execFileAsync('lpstat', ['-p', '-d'], { env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }));
    return parseLpstat(r.stdout);
  }

  // Get-CimInstance Win32_Printer 가 default/share/status 정보 모두 제공
  const ps =
    'Get-CimInstance Win32_Printer | ' +
    'Select-Object Name, Default, PrinterStatus, DriverName | ConvertTo-Json -Compress';

  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );

  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    logger.warn(`[list_printers] JSON 파싱 실패: ${(e as Error).message}`);
    return [];
  }

  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({
      name: String(p.Name ?? ''),
      isDefault: Boolean(p.Default),
      status: mapPrinterStatus(p.PrinterStatus),
      driver: typeof p.DriverName === 'string' ? p.DriverName : undefined,
    }))
    .filter((p) => p.name.length > 0);
}
