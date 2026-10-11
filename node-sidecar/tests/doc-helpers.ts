/** doc-*.test.ts 공용 — 임시 앱 데이터·출력 폴더(코퍼스·samples 에는 쓰지 않음), 실문서 경로, RPC 호출 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reload } from '../src/infra/config.js';
import type { RpcRouter } from '../src/rpc/router.js';

const here = dirname(fileURLToPath(import.meta.url));

/** 레포에 커밋된 합성 예제 (가상의 가온시·가짜 개인정보) — 늘 있다 */
export const SAMPLES = resolve(here, '..', 'samples');
export const sample = (rel: string) => join(SAMPLES, rel);

/** kordoc 실문서 코퍼스 (읽기 전용, 형제 체크아웃) — 없으면 그 테스트는 건너뛴다 */
export const CORPUS = process.env.KORDOC_CORPUS ?? resolve(here, '..', '..', '..', 'kordoc', 'bench', 'corpus');
export const corpus = (rel: string) => join(CORPUS, rel);
export const hasCorpus = (...rels: string[]) => rels.every((r) => existsSync(corpus(r)));

export const ORG = {
  name: '가온시', dept: '총무과', position: '주무관', person: '김가온', phone: '031-000-0000', fax: '031-000-0001',
  email: 'gaon@example.go.kr', address: '가온시 시청로 1', homepage: 'www.gaon.example', approval_line: ['담당', '팀장', '과장'],
  agency: '', seal_image: '', doc_number_prefix: '총무과-',
};

/** 앱 데이터·출력 폴더를 임시로 — 설정 출력 폴더가 out 이라 원본 옆에 쓰지 않는다 */
export function setupEnv(): { base: string; out: string; data: string; work: string } {
  const base = mkdtempSync(join(tmpdir(), 'kordoc-doc-'));
  const out = join(base, 'out');
  const data = join(base, 'appdata');
  const work = join(base, 'work');
  for (const d of [out, data, work]) mkdirSync(d, { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ convert: { output_dir: out, ocr: 'off' }, org: ORG }));
  process.env.KORDOC_AI_DATA_DIR = data;
  reload();
  return { base, out, data, work };
}

let router: RpcRouter | null = null;

/** 실제 라우터로 호출 (등록·파라미터 꺼내기·오류 문장까지) — 오류면 throw */
export async function call<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!router) {
    const { RpcRouter } = await import('../src/rpc/router.js');
    const { registerAllMethods } = await import('../src/rpc/methods/index.js');
    router = new RpcRouter();
    registerAllMethods(router);
  }
  const r = await router.dispatch(method, { ...params }, 1);
  if (r.error) throw new Error(r.error.message);
  return r.result as T;
}

/** PNG 한 장 (sharp) */
export async function makePng(width: number, height: number, text = 'KORDOC'): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="${Math.round(height / 2)}" font-size="${Math.round(height / 3)}" font-family="Arial">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
