/** 여러 문서 × 열 → 표 — 문서마다 AI 1회(JSON 스키마), 실패한 문서는 failed 에 담고 나머지는 계속. xlsx(기본) 또는 csv 로 저장
 *
 * 행에는 열 값과 함께 "파일"(문서 이름) 칸이 맨 앞에 붙는다.
 */

import { writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { BatchItemResult } from '../../types/rpc-contract.js';
import { ask, contextCharBudget, parseJsonLoose, type JsonSchema } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { loadDoc, selectPassages, unescapeMd } from './docs.js';
import { stemOf } from '../output/index.js';
import { resolveOutputPath } from './output.js';
import { FIDELITY_RULES } from './prompts.js';
import { writeCsv, writeXlsx } from './xlsx.js';

const SYSTEM = [
  '당신은 문서에서 정해진 항목의 값을 찾아 표로 옮기는 정리 담당입니다.',
  FIDELITY_RULES,
  '- 문서에 적힌 값을 그대로 옮기세요. 문서에 없는 항목은 빈 문자열("")로 두세요.',
  '- 값만 쓰세요. 설명이나 출처를 붙이지 마세요.',
].join('\n');

const FILE_COL = '파일';

export async function extractTable(
  params: { paths: string[]; columns: string[]; output_path?: string },
  signal: AbortSignal,
): Promise<{ rows: Array<Record<string, string>>; output_path: string; failed: BatchItemResult[] }> {
  const columns = [...new Set((params.columns ?? []).map((c) => String(c).trim()).filter(Boolean))];
  if (!params.paths?.length) throw new Error('표로 만들 문서를 하나 이상 고르세요.');
  if (!columns.length) throw new Error('뽑을 항목(열 이름)을 하나 이상 적으세요.');

  const maxTokens = Math.min(2500, 200 + columns.length * 100);
  const budget = await contextCharBudget({ reserveTokens: maxTokens, signal });
  const colList = columns.map((c) => `- ${c}`).join('\n');
  const room = Math.max(800, budget - SYSTEM.length - colList.length - 400);
  const schema: JsonSchema = {
    type: 'object',
    properties: Object.fromEntries(columns.map((c) => [c, { type: 'string' }])),
    required: columns,
    additionalProperties: false,
  };

  const rows: Array<Record<string, string>> = [];
  const failed: BatchItemResult[] = [];
  for (let i = 0; i < params.paths.length; i++) {
    const path = params.paths[i];
    signal.throwIfAborted();
    sendProgress({ current: i, total: params.paths.length, message: `${basename(path)}에서 뽑는 중 (${i + 1}/${params.paths.length})` });
    try {
      const doc = await loadDoc(path, signal);
      const { selected } = selectPassages(doc.passages, colList, room);
      const text = selected.map((p) => p.text).join('\n\n');
      const r = await ask({
        system: SYSTEM,
        messages: [{ role: 'user', content: `[뽑을 항목]\n${colList}\n\n[문서: ${doc.name}]\n${text}\n\n항목 이름을 키로 하는 JSON 객체 하나로 답하세요.` }],
        schema,
        maxTokens,
        signal,
        stream: false,
      });
      const raw = parseJsonLoose<Record<string, unknown>>(r.text);
      const row: Record<string, string> = columns.includes(FILE_COL) ? {} : { [FILE_COL]: doc.name };
      for (const c of columns) {
        const v = raw[c];
        row[c] = unescapeMd(typeof v === 'string' ? v : v == null ? '' : String(v)).trim();
      }
      rows.push(row);
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[ai_extract] ${basename(path)}: ${msg}`);
      failed.push({ path, ok: false, error: msg });
    }
  }
  if (!rows.length) throw new Error(`어느 문서에서도 뽑지 못했습니다: ${failed[0]?.error ?? '알 수 없는 오류'}`);

  const header = columns.includes(FILE_COL) ? columns : [FILE_COL, ...columns];
  const first = stemOf(params.paths[0]);
  const name = `${first}${params.paths.length > 1 ? ` 외 ${params.paths.length - 1}건` : ''} 추출표.xlsx`;
  const outPath = await resolveOutputPath(params.output_path, name, params.paths[0]);
  const table = rows.map((r) => header.map((h) => r[h] ?? ''));
  const data = extname(outPath).toLowerCase() === '.csv' ? writeCsv(header, table) : await writeXlsx(header, table);
  await writeFile(outPath, data);
  sendProgress({ current: params.paths.length, total: params.paths.length, message: `${rows.length}건 저장 완료` });
  return { rows, output_path: outPath, failed };
}
