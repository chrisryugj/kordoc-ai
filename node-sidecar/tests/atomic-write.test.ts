/** 옆에 다 쓴 뒤 바꿔 넣기(atomicWriteFile) — 덮는 파일의 권한·링크는 그대로, 한도에 맞춘 긴 이름도 쓴다, 임시 파일은 남기지 않는다 */

import { describe, it, expect } from 'vitest';
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../src/core/files/io.js';
import { fitFileName, uniquePath } from '../src/core/output/index.js';
import { tempDir } from './tmp-dirs.js';

const posix = process.platform !== 'win32';

describe('atomicWriteFile', () => {
  it.skipIf(!posix)('덮는 파일의 권한(0600)을 그대로 둔다', async () => {
    const dir = tempDir('kordoc-atomic-');
    const p = join(dir, '토큰.json');
    writeFileSync(p, '{}');
    chmodSync(p, 0o600);
    await atomicWriteFile(p, '{"a":1}');
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readFileSync(p, 'utf-8')).toBe('{"a":1}');
  });

  it.skipIf(!posix)('심볼릭 링크를 덮으면 링크는 그대로, 가리키는 파일이 바뀐다', async () => {
    const dir = tempDir('kordoc-atomic-');
    const real = join(dir, '실제.md');
    const link = join(dir, '링크.md');
    writeFileSync(real, '앞');
    symlinkSync(real, link);
    await atomicWriteFile(link, '뒤');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(real);
    expect(readFileSync(real, 'utf-8')).toBe('뒤');
  });

  it('한도에 맞춘 긴 이름(+ (2))에도 쓴다: 임시 이름을 꼬리로 붙이지 않는다. 다 쓰면 임시 파일이 없다', async () => {
    const dir = tempDir('kordoc-atomic-');
    // 영문으로 — APFS·NTFS 는 글자 수로 255 를 센다(SMB NAS 는 바이트라 한글 240바이트 이름이 거기서 넘쳤다)
    const first = join(dir, fitFileName(`${'a'.repeat(300)}_shrunk.pdf`));
    writeFileSync(first, 'x');
    const p = uniquePath(first);
    await atomicWriteFile(p, 'PDF');
    expect(readFileSync(p, 'utf-8')).toBe('PDF');
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('못 쓰면 임시 파일을 지우고, 오류에는 임시 이름이 아니라 그 파일 이름', async () => {
    const dir = tempDir('kordoc-atomic-');
    const p = join(dir, '폴더 자리.hwpx');
    // 파일 자리에 폴더가 있으면 바꿔 넣기가 실패한다
    mkdirSync(join(p, '안'), { recursive: true });
    const err = await atomicWriteFile(p, 'x').then(() => null, (e: NodeJS.ErrnoException) => e);
    expect(err).toBeTruthy();
    expect(readdirSync(dir)).toEqual(['폴더 자리.hwpx']);
    expect(String(err!.path ?? '')).not.toMatch(/\.tmp$/);
  });
});
