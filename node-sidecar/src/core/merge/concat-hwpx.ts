/**
 * HWPX 서식 유지 수합 — 한/글 COM 자동화 (pyhwpx)
 * Python + pyhwpx를 통해 한/글 HwpObject COM을 호출,
 * insert_file로 파일을 병합하여 서식·페이지 설정 완벽 보존.
 * 요구사항: Windows + 한컴오피스 + Python + pyhwpx
 *
 * 제약: 특정 대형 멀티섹션 문서는 insert_file 시 페이지 손실 가능 (한/글 COM 한계)
 *       → 병합 후 PageCount 비교하여 경고
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, basename } from 'node:path';
import { writeFile as fsWriteFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import type { MergeFilesParams, MergeFilesResult } from './types.js';

const execFileAsync = promisify(execFile);

function buildPyScript(files: string[], outputPath: string): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const fileList = files.map(f => `'${esc(f)}'`).join(',');

  return `# -*- coding: utf-8 -*-
import sys, os, subprocess
from pyhwpx import Hwp

files = [${fileList}]
output = '${esc(outputPath)}'
hwp = None

try:
    hwp = Hwp(visible=False)
    hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")

    # 각 파일 페이지 수 합산
    page_sum = 0
    for f in files:
        hwp.open(f)
        page_sum += hwp.PageCount
        hwp.clear(1)

    # 병합: 첫 파일 base, 나머지 순서대로 끝에 삽입
    hwp.open(files[0])
    for f in files[1:]:
        hwp.move_pos(3)  # moveBottomOfFile
        hwp.insert_file(f, keep_section=1, keep_charshape=1, keep_parashape=1, keep_style=1)

    merged_pages = hwp.PageCount
    hwp.save_as(output)
    hwp.clear(1)
    hwp.quit()
    hwp = None

    sz = os.path.getsize(output)

    # 페이지 손실 검증 (섹션 구분으로 ±5p 허용)
    diff = page_sum - merged_pages
    if diff > 5:
        print(f'WARN:page_loss:{diff}:{page_sum}:{merged_pages}')
    print(f'SUCCESS:{sz}:{merged_pages}:{page_sum}')
except Exception as e:
    if hwp:
        try:
            hwp.quit()
        except:
            subprocess.run(['taskkill', '/F', '/IM', 'Hwp.exe'],
                           capture_output=True, timeout=5)
    print(f'ERROR:{e}')
    sys.exit(1)
`;
}

export async function concatHwpx(
  params: MergeFilesParams,
  signal: AbortSignal,
): Promise<MergeFilesResult> {
  const { files, output_path } = params;

  logger.info(`[concat-hwpx] ${files.length}개 HWPX COM 수합 시작 (pyhwpx)`);
  sendProgress({
    current: 0,
    total: files.length,
    message: `HWPX 수합 준비 (한/글 COM) — ${files.map(f => basename(f)).join(', ')}`,
  });

  await mkdir(dirname(output_path), { recursive: true });

  const scriptId = randomBytes(4).toString('hex');
  const scriptPath = join(tmpdir(), `hwpx-merge-${scriptId}.py`);
  await fsWriteFile(scriptPath, buildPyScript(files, output_path), 'utf-8');

  try {
    const { stdout, stderr } = await execFileAsync(
      'python',
      [scriptPath],
      { signal, timeout: 120_000 },
    );

    if (stderr) logger.warn(`[concat-hwpx] stderr: ${stderr}`);

    const lines = stdout.trim().split(/\r?\n/);

    // 페이지 손실 경고 체크
    const warnLine = lines.find(l => l.startsWith('WARN:page_loss:'));
    if (warnLine) {
      const [, , lostStr, expectedStr, actualStr] = warnLine.split(':');
      const msg = `⚠ 일부 페이지가 누락되었을 수 있습니다 (예상 ${expectedStr}p → 결과 ${actualStr}p, ${lostStr}p 차이). 결과를 확인해 주세요.`;
      logger.warn(`[concat-hwpx] ${msg}`);
      sendProgress({ current: files.length, total: files.length, message: msg });
    }

    const lastLine = lines[lines.length - 1].trim();

    if (lastLine.startsWith('SUCCESS:')) {
      const parts = lastLine.replace('SUCCESS:', '').split(':');
      const size = parseInt(parts[0], 10);

      if (!warnLine) {
        sendProgress({
          current: files.length,
          total: files.length,
          message: 'HWPX 수합 완료',
        });
      }

      logger.info(`[concat-hwpx] done → ${output_path} (${size} bytes, ${files.length}개 파일)`);

      return {
        success: true,
        output_path,
        file_count: files.length,
        total_length: size,
        failed_files: [],
      };
    }

    const errorMsg = lastLine.startsWith('ERROR:')
      ? lastLine.replace('ERROR:', '')
      : lastLine;
    throw new Error(errorMsg);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;

    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[concat-hwpx] COM 실패: ${message}`);
    throw new Error(`HWPX 수합 실패: ${message}\n한컴오피스 + Python + pyhwpx가 설치되어 있는지 확인하세요.`);
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
}
