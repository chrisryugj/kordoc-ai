/** 우리 서식으로 맞추기 — 견본에서 서식 읽기(style_extract)·저장(style_save·style_list·style_delete)·미리보기(style_preview)·맞추기(style_apply)
 *
 * 저장: 앱 데이터 폴더 styles/index.json (서식 JSON 만, 견본 파일은 복사하지 않는다 — 견본에 든 이름·연락처가 앱 폴더에 남지 않게).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BatchItemResult, StyleEntry, StyleFormat } from '../../types/rpc-contract.js';
import { dataDir } from '../../infra/config.js';
import { applyStyle, generateStyled } from './apply.js';
import { extractStyle, styleSummary } from './extract.js';

export { extractStyle, styleSummary } from './extract.js';

const dir = () => join(dataDir(), 'styles');
const indexPath = () => join(dir(), 'index.json');

async function readIndex(): Promise<StyleEntry[]> {
  try {
    const j = JSON.parse(await readFile(indexPath(), 'utf-8')) as { styles?: StyleEntry[] };
    return Array.isArray(j.styles) ? j.styles.filter((s) => s && typeof s.id === 'string' && s.format?.version === 1) : [];
  } catch {
    return [];
  }
}

async function writeIndex(styles: StyleEntry[]): Promise<void> {
  await mkdir(dir(), { recursive: true });
  const tmp = `${indexPath()}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, styles }, null, 2), 'utf-8');
  await rename(tmp, indexPath());
}

/** 화면이 보낸 서식은 모양만 확인한다 (저장·적용 전에) */
function checkFormat(f: unknown): StyleFormat {
  const v = f as StyleFormat | undefined;
  if (!v || v.version !== 1 || !v.margins || !v.body || !v.numbering || !Array.isArray(v.levels) || !v.title || !v.paper) {
    throw new Error('서식 내용이 올바르지 않습니다. 견본 문서를 다시 골라 서식을 읽으세요.');
  }
  return v;
}

export async function styleExtract(path: string, signal?: AbortSignal): Promise<{ format: StyleFormat; warnings: string[] }> {
  const { format, warnings } = await extractStyle(path, signal);
  return { format, warnings };
}

export async function styleList(): Promise<{ styles: StyleEntry[] }> {
  return { styles: (await readIndex()).sort((a, b) => b.created_at.localeCompare(a.created_at)) };
}

export async function styleSave(p: { name: string; format: unknown }): Promise<StyleEntry> {
  const name = p.name.trim();
  if (!name) throw new Error('서식 이름을 적으세요.');
  if (name.length > 40) throw new Error('서식 이름은 40자까지 됩니다.');
  const format = checkFormat(p.format);
  const list = await readIndex();
  // 같은 이름이면 새 서식으로 바꾼다 (같은 서식을 다시 읽어 저장하는 일이 흔하다)
  const entry: StyleEntry = { id: randomUUID().slice(0, 8), name, summary: styleSummary(format), created_at: new Date().toISOString(), format };
  await writeIndex([...list.filter((s) => s.name !== name), entry]);
  return entry;
}

export async function styleDelete(id: string): Promise<boolean> {
  const list = await readIndex();
  if (!list.some((s) => s.id === id)) return false;
  await writeIndex(list.filter((s) => s.id !== id));
  return true;
}

async function resolveFormat(p: { style_id?: string; format?: unknown; sample_path?: string }, signal?: AbortSignal): Promise<StyleFormat> {
  if (p.style_id) {
    const hit = (await readIndex()).find((s) => s.id === p.style_id);
    if (!hit) throw new Error('저장한 서식을 찾지 못했습니다. 서식 목록을 새로 고친 뒤 다시 고르세요.');
    return hit.format;
  }
  if (p.format) return checkFormat(p.format);
  if (p.sample_path) return (await extractStyle(p.sample_path, signal)).format;
  throw new Error('서식을 먼저 고르세요. 저장한 서식을 고르거나 견본 문서를 넣으세요.');
}

/** 미리보기용 가상의 글 (가온시) — 단계 셋·※·표 하나 */
const DEMO = `수신 내부결재

제목 2026년 가온시 생활 안전 점검 계획

## 추진 배경

- 여름철 집중호우에 대비하여 생활 안전 시설을 미리 점검
  - 하천변 산책로와 지하차도 배수 시설 위주로 살핌
    - 지난해 침수 신고 12곳 우선 확인

※ 점검 결과는 누리집에 공개

## 추진 계획

- 점검 기간: 2026. 6. 1.(월) ~ 6. 19.(금)
- 점검 대상

| 구분 | 시설 수 | 담당 |
| --- | --- | --- |
| 하천변 산책로 | 8곳 | 안전총괄과 |
| 지하차도 | 4곳 | 도로과 |
`;

export async function stylePreview(p: { style_id?: string; format?: unknown }): Promise<{ preview_hwpx_b64: string }> {
  const f = await resolveFormat(p);
  const { bytes } = await generateStyled(f, DEMO, { textSource: true });
  return { preview_hwpx_b64: Buffer.from(bytes).toString('base64') };
}

export async function styleApply(
  p: { source_paths: string[]; style_id?: string; sample_path?: string; output_dir?: string },
  signal?: AbortSignal,
): Promise<{ results: BatchItemResult[]; output_dir: string; summary: string }> {
  const format = await resolveFormat(p, signal);
  const r = await applyStyle({ source_paths: p.source_paths, format, output_dir: p.output_dir }, signal);
  return { ...r, summary: format.summary };
}
