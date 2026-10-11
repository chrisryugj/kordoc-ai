/** 내장 AI 모델 관리 — 추천 목록·받기(이어받기)·가져오기(폐쇄망 반입)·지우기
 *
 * 추천 목록 주소는 Hugging Face 커밋 고정 주소다(2026-10-10 HEAD 로 존재·크기 확인, 크기·sha256 은 x-linked-size·x-linked-etag 값).
 * 받기는 앱 모델 폴더에 `.part` 로 받다가 크기·GGUF 머리·sha256 을 확인한 뒤 이름을 바꾼다. 취소하면 `.part` 를 남겨 다음에 이어 받는다.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat, statfs } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';
import { pipeline } from 'node:stream/promises';
import type { LlmCatalogItem } from '../../types/rpc-contract.js';
import { dataDir, getSettings } from '../../infra/config.js';
import { unloadEmbedded } from '../../infra/llm/embedded.js';
import { assertAllowed } from '../../infra/net-guard.js';
import { sendProgress } from '../../infra/progress.js';
import { listLocalLlmModels } from '../system/index.js';
import { safeName, uniquePath } from './output.js';

export interface CatalogEntry {
  id: string;
  name: string;
  file: string;
  /** 바이트 */
  size: number;
  sha256?: string;
  ram_gb: number;
  url: string;
  license: string;
  description: string;
  recommended?: boolean;
}

const HF = 'https://huggingface.co';

export const CATALOG: CatalogEntry[] = [
  {
    id: 'qwen3-4b-2507',
    name: 'Qwen3 4B Instruct 2507',
    file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    size: 2497281120,
    sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
    ram_gb: 8,
    url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`,
    license: 'Apache-2.0',
    description: '기본 추천. 가볍고 빨라 요약·문서 대화·초안이 무난하고, 양식 채우기·표 추출의 JSON 을 잘 지킵니다. 메모리 8GB PC 부터 쓸 수 있습니다.',
    recommended: true,
  },
  {
    id: 'gemma4-e4b',
    name: 'Gemma 4 E4B',
    file: 'gemma-4-E4B-it-Q4_K_M.gguf',
    size: 4977171584,
    sha256: '85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87',
    ram_gb: 16,
    url: `${HF}/unsloth/gemma-4-E4B-it-GGUF/resolve/bfc15c382204943c3a8fff0c750b94ae2364d7a3/gemma-4-E4B-it-Q4_K_M.gguf`,
    license: 'Apache-2.0',
    description: '한국어 문장이 가장 자연스러운 고품질 모델. 초안·고쳐 쓰기·보고서에 좋습니다. 파일이 크고 느린 편이라 메모리 16GB 이상 PC 에 맞습니다.',
  },
  {
    id: 'gemma3-4b',
    name: 'Gemma 3 4B',
    file: 'gemma-3-4b-it-Q4_K_M.gguf',
    size: 2489894016,
    sha256: '04a43a22e8d2003deda5acc262f68ec1005fa76c735a9962a8c77042a74a7d19',
    ram_gb: 8,
    url: `${HF}/unsloth/gemma-3-4b-it-GGUF/resolve/5a3566e716d80f709ed7b79817eaf7733d2a1fce/gemma-3-4b-it-Q4_K_M.gguf`,
    license: 'Gemma 이용 약관',
    description: '구글 Gemma 3 소형 모델. 가볍고 한국어 문장이 자연스럽습니다. 상업적 이용은 되지만 Gemma 이용 약관의 금지 용도 정책을 따라야 합니다.',
  },
  // 비상업(NC) 라이선스 모델은 추천 목록에 넣지 않는다(업무용은 별도 계약). 사용자가 가진 파일은 "가져오기"로 쓸 수 있다
];

export function llmDir(): string {
  return join(dataDir(), 'models', 'llm');
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)}GB`;

export function catalog(): LlmCatalogItem[] {
  return CATALOG.map(({ size, sha256: _sha, ...c }) => ({
    ...c,
    size_gb: Math.round((size / 1024 ** 3) * 10) / 10,
    downloaded: existsSync(join(llmDir(), c.file)) && statSync(join(llmDir(), c.file)).size === size,
  }));
}

/** 앱 모델 폴더의 .gguf + 설정에 지정된 폴더 밖 모델 */
export function listModels(): Array<{ path: string; name: string; size: number }> {
  const list = listLocalLlmModels();
  const configured = getSettings().ai.embedded.model_path;
  if (configured && existsSync(configured) && !list.some((m) => resolve(m.path) === resolve(configured))) {
    list.push({ path: configured, name: basename(configured), size: statSync(configured).size });
  }
  return list;
}

async function isGguf(path: string): Promise<boolean> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(4);
    await fh.read(buf, 0, 4, 0);
    return buf.toString('latin1') === 'GGUF';
  } finally {
    await fh.close();
  }
}

async function sha256Of(path: string, signal: AbortSignal): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), async function* (src) { for await (const c of src) h.update(c as Buffer); }, { signal });
  return h.digest('hex');
}

/** 넘겨주기(redirect)를 한 단계씩 따라가며 매번 폐쇄망 관문을 지난다.
 *  node:http(s) 를 쓰는 이유: 내장 fetch 로 Hugging Face CDN 을 받으면 1.7MB/s, https.get 은 29MB/s (2026-10 Node 26 실측) */
async function getFollow(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<IncomingMessage> {
  let cur = url;
  for (let hop = 0; hop < 8; hop++) {
    await assertAllowed(cur);
    const res = await new Promise<IncomingMessage>((ok, fail) => {
      const req = (cur.startsWith('https:') ? httpsGet : httpGet)(cur, { headers, signal }, ok);
      req.on('error', fail);
    });
    const loc = res.headers.location;
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
      res.resume();
      cur = new URL(loc, cur).toString();
      continue;
    }
    return res;
  }
  throw new Error('모델 주소가 너무 여러 번 넘겨집니다. 잠시 후 다시 시도하세요.');
}

/** 흘러가는 바이트를 세며 0.3초마다 진행률 알림 */
function counter(start: number, total: number, label: (got: number) => string) {
  return async function* (source: AsyncIterable<Buffer>) {
    let got = start;
    let last = 0;
    for await (const chunk of source) {
      got += chunk.length;
      const now = Date.now();
      if (now - last > 300) {
        last = now;
        sendProgress({ current: got, total, message: label(got) });
      }
      yield chunk;
    }
  };
}

const inflight = new Set<string>();

/** 모델 받기 — 이어받기(Range), 진행률 알림, 취소 시 .part 보존 */
export async function downloadModel(item: CatalogEntry, signal: AbortSignal): Promise<string> {
  if (getSettings().privacy.offline) {
    throw new Error('폐쇄망 모드에서는 모델을 받을 수 없습니다. 인터넷이 되는 PC에서 받은 .gguf 파일을 "가져오기"로 넣으세요.');
  }
  const dir = llmDir();
  await mkdir(dir, { recursive: true });
  const dest = join(dir, item.file);
  if (existsSync(dest) && statSync(dest).size === item.size) return dest;
  if (inflight.has(item.id)) throw new Error('이 모델을 이미 받는 중입니다.');
  inflight.add(item.id);
  try {
    const part = `${dest}.part`;
    let start = existsSync(part) ? statSync(part).size : 0;
    if (start > item.size) { await rm(part); start = 0; }
    const free = await statfs(dir).then((s) => s.bavail * s.bsize).catch(() => undefined);
    const need = item.size - start + 200 * 1024 ** 2;
    if (free !== undefined && free < need) throw new Error(`디스크 공간이 부족합니다 (필요 ${gb(need)}, 남은 ${gb(free)}). 공간을 비운 뒤 다시 시도하세요.`);

    if (start < item.size) {
      const res = await getFollow(item.url, start ? { range: `bytes=${start}-` } : {}, signal);
      if (res.statusCode === 200) start = 0; // 서버가 이어받기를 모르면 처음부터
      else if (res.statusCode !== 206) {
        res.resume();
        throw new Error(`모델을 받지 못했습니다 (${res.statusCode}). 인터넷 연결을 확인하고 다시 시도하세요.`);
      }
      const label = (got: number) => `${item.name} 받는 중 ${gb(got)} / ${gb(item.size)}`;
      await pipeline(res, counter(start, item.size, label), createWriteStream(part, { flags: start ? 'a' : 'w' }), { signal });
    }

    const size = statSync(part).size;
    if (size !== item.size) {
      if (size > item.size) await rm(part);
      throw new Error(`받은 파일 크기가 맞지 않습니다 (${size}/${item.size}). 다시 받으세요.`);
    }
    if (!(await isGguf(part))) {
      await rm(part);
      throw new Error('받은 파일이 GGUF 모델이 아닙니다. 다시 받으세요.');
    }
    if (item.sha256) {
      sendProgress({ current: item.size, total: item.size, message: '받은 파일 확인 중...' });
      if ((await sha256Of(part, signal)) !== item.sha256) {
        await rm(part);
        throw new Error('받은 파일이 손상되었습니다(검사값 불일치). 다시 받으세요.');
      }
    }
    await rename(part, dest);
    sendProgress({ current: item.size, total: item.size, message: `${item.name} 받기 완료` });
    return dest;
  } finally {
    inflight.delete(item.id);
  }
}

/** 폐쇄망 반입 — 가진 GGUF 파일을 앱 모델 폴더로 복사 (확장자가 없어도 GGUF 머리면 받는다) */
export async function importModel(src: string, signal: AbortSignal): Promise<string> {
  const st = await stat(src).catch(() => null);
  if (!st?.isFile()) throw new Error('모델 파일을 찾을 수 없습니다.');
  if (!(await isGguf(src))) throw new Error('GGUF 모델 파일이 아닙니다. .gguf 파일을 고르세요.');
  const dir = llmDir();
  if (resolve(dirname(src)) === resolve(dir)) return src;
  await mkdir(dir, { recursive: true });
  let name = safeName(basename(src));
  if (!name.toLowerCase().endsWith('.gguf')) name += '.gguf';
  let dest = join(dir, name);
  if (existsSync(dest) && statSync(dest).size === st.size) return dest;
  dest = uniquePath(dest);
  const part = `${dest}.part`;
  sendProgress({ current: 0, total: st.size, message: `${basename(src)} 가져오는 중 (${gb(st.size)})` });
  try {
    if (st.size < 64 * 1024 ** 2) {
      await copyFile(src, part);
    } else {
      await pipeline(createReadStream(src), counter(0, st.size, (got) => `가져오는 중 ${gb(got)} / ${gb(st.size)}`), createWriteStream(part), { signal });
    }
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
  return dest;
}

/** 앱 모델 폴더 안의 .gguf(또는 받다 만 .part)만 지운다 */
export async function deleteModel(path: string): Promise<boolean> {
  const dir = resolve(llmDir());
  const target = resolve(path);
  const rel = relative(dir, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel !== basename(rel)) {
    throw new Error('앱 모델 폴더 안의 모델만 지울 수 있습니다.');
  }
  if (!/\.gguf(\.part)?$/i.test(target)) throw new Error('.gguf 모델 파일만 지울 수 있습니다.');
  if (!existsSync(target)) return false;
  const configured = getSettings().ai.embedded.model_path;
  if (configured && resolve(configured) === target) await unloadEmbedded();
  await rm(target);
  return true;
}
