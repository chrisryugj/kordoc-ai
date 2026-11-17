/** 이 PC의 작업 흔적 지우기 — 공용 PC·PC 반납 전에 앱이 남긴 문서 사본을 한 번에 지운다.
 *
 * 지우는 것: 복구 사본(recovery/), 새로 쓰기 작업 사본, 임시 폴더의 붙여 넣기·PDF 작업·인쇄·수합·브라우저 프로필·구독 프로그램 지시문·우클릭 목록.
 * 남기는 것: 설정(기관 정보·키), 서식·문체·기관 문서, 받은 공문 목록, 사용자가 저장한 결과 파일.
 * 쓰는 중이라 지우지 못한 것은 건너뛰고 수만 돌려준다.
 */

import { lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataDir } from '../../infra/config.js';

/** 임시 폴더에서 이 앱이 만드는 이름 (각 모듈의 이름과 같게 둔다) */
const TEMP_NAMES: RegExp[] = [
  /^kordoc-pdf-work$/,
  /^kordoc-print$/,
  /^kordoc-gather-/,
  /^kordoc-ai-chrome-/,
  /^kordoc-sub-/,
  // kordoc-agy-pending 은 지울 구독 대화 기록의 표시라 남긴다 (지우면 그 기록을 못 지운다)
  /^kordoc-agy-(?!pending$)/,
  /^kordoc-batch-\d+\.json$/,
];

export interface WipeResult {
  removed: number;
  /** 다른 프로그램이 쓰고 있어 남은 것 */
  skipped: number;
}

function rmEach(dir: string, pick: (name: string) => boolean, r: WipeResult): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return; // 폴더가 없다
  }
  for (const name of names) {
    if (!pick(name)) continue;
    try {
      const p = join(dir, name);
      // 파일은 unlink: Node 24.13 은 한글 폴더 안 파일에 rmSync 를 부르면 말없이 죽는다
      if (lstatSync(p).isDirectory()) rmSync(p, { recursive: true, force: true });
      else unlinkSync(p);
      r.removed++;
    } catch {
      r.skipped++;
    }
  }
}

export function wipeTraces(dirs: { data?: string; temp?: string } = {}): WipeResult {
  const data = dirs.data ?? dataDir();
  const temp = dirs.temp ?? tmpdir();
  const r: WipeResult = { removed: 0, skipped: 0 };
  rmEach(join(data, 'recovery'), () => true, r);
  rmEach(join(data, '작업 사본'), () => true, r);
  rmEach(temp, (n) => TEMP_NAMES.some((re) => re.test(n)), r);
  // 붙여 넣은 글·그림 (Rust 가 %TEMP%\kordoc-ai\clipboard_* 로 쓴다)
  rmEach(join(temp, 'kordoc-ai'), (n) => n.startsWith('clipboard_'), r);
  return r;
}
