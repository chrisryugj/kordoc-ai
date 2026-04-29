/**
 * Print core — 문서를 PDF로 변환한 후 Windows PrintTo verb로 인쇄 큐에 투입.
 *
 * 흐름:
 *   1. kordoc.parse(file) → markdown
 *   2. kordoc.markdownToPdf(md, {preset}) → PDF buffer (puppeteer-core, Chrome/Edge 자동 검출)
 *   3. %TEMP%/kordoc-print/<timestamp>-<basename>.pdf 저장
 *   4. PowerShell `Start-Process -Verb PrintTo -ArgumentList "<printer>"` 호출
 *
 * 함정:
 *   - PrintTo verb는 시스템 등록 PDF 핸들러(Adobe Reader/Edge 등)에 의존. 미설치 시 실패.
 *   - copies/duplex/color 등 세부 옵션은 PrintTo verb로 제어 불가 (드라이버 기본값 사용).
 *     세부 제어가 필요하면 SumatraPDF 같은 외부 도구나 Win32 EnumPrintProcessors 필요.
 *   - 임시 PDF는 인쇄 큐 투입 후 즉시 삭제하면 OS가 못 읽음. 60초 지연 삭제.
 *
 * 참조: docs/SPEC.md §2.1, §2.2
 */

import { execFile } from 'node:child_process';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { promisify } from 'node:util';
import { parse, markdownToPdf, type PrintPreset } from 'kordoc';
import { validatePath } from '../../infra/pathGuard.js';
import { logger } from '../../infra/logger.js';

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
}

function quotePsArg(s: string): string {
  // PowerShell 단일 인용 — 작은따옴표 이스케이프
  return `'${s.replace(/'/g, "''")}'`;
}

async function shellPrint(pdfPath: string, printer?: string): Promise<void> {
  const args = ['-FilePath', quotePsArg(pdfPath), '-Verb', 'PrintTo'];
  if (printer) args.push('-ArgumentList', quotePsArg(printer));
  args.push('-WindowStyle', 'Hidden');
  const command = `Start-Process ${args.join(' ')}`;
  await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
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
    throw new Error('files 가 비어있습니다');
  }
  if (process.platform !== 'win32') {
    throw new Error('인쇄는 Windows 에서만 지원됩니다 (PrintTo verb)');
  }

  await ensurePrintTempDir();

  const failed: PrintFailure[] = [];
  const jobIds: string[] = [];
  const preset = params.preset ?? 'default';

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
      const result = await parse(safePath);
      if (!result.success) {
        throw new Error(result.error ?? '파싱 실패');
      }
      const md = result.markdown ?? '';
      if (!md.trim()) throw new Error('변환된 마크다운이 비어있습니다');

      const pdfBuf = await markdownToPdf(md, { preset });
      const pdfName = `${Date.now()}-${i}-${basename(safePath, extname(safePath))}.pdf`;
      const pdfPath = join(PRINT_TEMP_DIR, pdfName);
      await writeFile(pdfPath, pdfBuf);

      await shellPrint(pdfPath, params.printer);
      jobIds.push(pdfPath);
      void scheduleTempCleanup(pdfPath);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      logger.warn(`[print_files] 실패 ${safePath}: ${reason}`);
      failed.push({ file: safePath, reason });
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

export async function listPrinters(): Promise<Printer[]> {
  if (process.platform !== 'win32') {
    throw new Error('listPrinters 는 Windows 에서만 지원됩니다');
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
