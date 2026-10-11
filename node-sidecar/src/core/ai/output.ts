/** 저장 경로 — output_path 를 주면 그곳, 없으면 설정의 출력 폴더 → 그것도 없으면 원본 옆. 자동 이름이 겹치면 "이름 (2).확장자" */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { getSettings } from '../../infra/config.js';
import { validatePath } from '../../infra/pathGuard.js';

export function uniquePath(p: string): string {
  if (!existsSync(p)) return p;
  const ext = extname(p);
  const stem = p.slice(0, p.length - ext.length);
  for (let i = 2; ; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!existsSync(c)) return c;
  }
}

/** 파일 이름에 못 쓰는 글자 걷기 */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || '결과';
}

export async function resolveOutputPath(explicit: string | undefined, defaultName: string, nearPath: string): Promise<string> {
  if (explicit) {
    // 화면이 고른 폴더의 같은 이름(항목 뽑기.xlsx)을 다시 넘겨도 지난 결과·사용자가 고친 표를 덮지 않는다 (앱 공통 규칙)
    const p = validatePath(explicit);
    await mkdir(dirname(p), { recursive: true });
    return uniquePath(p);
  }
  const dir = getSettings().convert.output_dir?.trim() || dirname(nearPath);
  const p = validatePath(join(dir, safeName(defaultName)));
  await mkdir(dirname(p), { recursive: true });
  return uniquePath(p);
}
