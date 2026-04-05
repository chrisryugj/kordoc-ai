/**
 * HWPX 서식 유지 수합 — 한/글 COM 자동화 (pyhwpx)
 * Python + pyhwpx를 통해 한/글 HwpObject COM을 호출,
 * insert_file로 파일을 병합하여 서식·페이지 설정 완벽 보존.
 * 요구사항: Windows + 한컴오피스 + Python + pyhwpx
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

    # 가장 큰 파일을 base로 사용 (작은 base에 큰 파일 insert 시 페이지 손실 방지)
    indexed = [(i, f, os.path.getsize(f)) for i, f in enumerate(files)]
    indexed.sort(key=lambda x: -x[2])
    base_idx, base_file, _ = indexed[0]

    before = sorted([(i, f) for i, f, _ in indexed if i < base_idx], key=lambda x: x[0])
    after = sorted([(i, f) for i, f, _ in indexed if i > base_idx], key=lambda x: x[0])

    hwp.open(base_file)

    # base 앞에 올 파일들: 역순으로 문서 시작에 삽입
    for i, f in reversed(before):
        hwp.move_pos(2)  # moveTopOfFile
        hwp.insert_file(f, keep_section=1, keep_charshape=1, keep_parashape=1, keep_style=1)

    # base 뒤에 올 파일들: 순서대로 문서 끝에 삽입
    for i, f in after:
        hwp.move_pos(3)  # moveBottomOfFile
        hwp.insert_file(f, keep_section=1, keep_charshape=1, keep_parashape=1, keep_style=1)

    hwp.save_as(output)
    hwp.clear(1)
    hwp.quit()
    hwp = None

    sz = os.path.getsize(output)
    print(f'SUCCESS:{sz}')
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
    const lastLine = lines[lines.length - 1].trim();

    if (lastLine.startsWith('SUCCESS:')) {
      const size = parseInt(lastLine.replace('SUCCESS:', ''), 10);

      sendProgress({
        current: files.length,
        total: files.length,
        message: 'HWPX 수합 완료',
      });

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
