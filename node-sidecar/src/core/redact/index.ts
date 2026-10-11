/** 개인정보 마스킹 (redact·redact_batch)
 *
 * HWPX·HWP 는 kordoc CLI `redact --json` — 본문·표·머리말·각주·미리보기·문서 정보까지 같은 길이로 가리고
 * 가린 뒤 다시 검사(잔존)한다. 그 밖(PDF·워드·엑셀 등)은 원본을 건드리지 않고 가린 Markdown(.md)을 낸다.
 * 결과·로그에는 원본 개인정보를 싣지 않는다 — samples 는 가려진 문자열, 파일 이름 속 개인정보도 가린다.
 */

import { writeFile } from 'node:fs/promises';
import { DEFAULT_REDACT_RULES, redactMarkdown, redactText, type RedactHit } from 'kordoc';
import type { BatchItemResult, RedactResult, RedactRule } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { errorText } from '../errors.js';
import { parseDoc } from '../converter/index.js';
import { formatOf } from '../files/format.js';
import { parseCliJson, runKordocCli } from '../kordoc-cli.js';
import { outputDir, outputFile, stemOf } from '../output/index.js';

export interface RedactParams {
  path: string;
  rules?: RedactRule[];
  mask_char?: string;
  dry_run?: boolean;
  output_path?: string;
  output_dir?: string;
}

interface CliHit { rule: RedactRule; masked: string }
interface CliReport {
  format: string;
  hits: CliHit[];
  fileHits: CliHit[];
  residual: CliHit[];
  unscanned: string[];
  output: string | null;
}

/** 룰별 건수 + 가려진 견본 (최대 3개) */
function summarize(hits: Array<{ rule: RedactRule; masked: string }>): RedactResult['hits'] {
  const by = new Map<RedactRule, { count: number; samples: Set<string> }>();
  for (const h of hits) {
    const e = by.get(h.rule) ?? { count: 0, samples: new Set<string>() };
    e.count++;
    if (e.samples.size < 3) e.samples.add(h.masked);
    by.set(h.rule, e);
  }
  return [...by].map(([rule, e]) => ({ rule, count: e.count, samples: [...e.samples] }));
}

/** 파일 이름 속 개인정보도 가린다 (예: 홍길동_900101-1234567.hwpx) */
function maskName(name: string, rules: readonly RedactRule[], maskChar: string): string {
  const probe = name.replace(/_/g, ' ');
  const out = [...name];
  const mask = /[*?\\/:"<>|]/.test(maskChar) ? '●' : maskChar;
  for (const h of redactText(probe, { rules, maskChar: mask }).hits) {
    for (let k = 0; k < h.length; k++) if (h.masked[k] !== probe[h.index + k]) out[h.index + k] = mask;
  }
  return out.join('');
}

export async function redact(p: RedactParams, signal?: AbortSignal): Promise<RedactResult> {
  const rules = p.rules?.length ? p.rules : [...DEFAULT_REDACT_RULES];
  const maskChar = p.mask_char || '●';
  redactText('', { rules, maskChar }); // 마스크 문자·룰 검사 (잘못되면 여기서 오류)
  const format = formatOf(p.path);
  const stem = maskName(stemOf(p.path), rules, maskChar);

  if (format === 'hwp' || format === 'hwpx') {
    const outPath = p.dry_run ? undefined : outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stem}_마스킹.${format}` });
    const args = ['redact', p.path, '--json', '--silent', `--rules=${rules.join(',')}`, `--mask-char=${maskChar}`, ...(outPath ? [`--output=${outPath}`] : ['--dry-run'])];
    const report = parseCliJson<CliReport>(await runKordocCli(args, { signal }), '개인정보를 가리지 못했습니다.');
    const listed = report.fileHits.length ? report.fileHits : report.hits;
    return {
      ...(report.output ? { output_path: report.output } : {}),
      hits: summarize(listed),
      total: listed.length,
      residual: report.residual.length + report.unscanned.length,
      preserved: !report.output || !report.output.toLowerCase().endsWith('.md'),
    };
  }

  const r = await parseDoc(p.path, { images: false, signal });
  const masked = redactMarkdown(r.markdown, { rules, maskChar });
  const residual: RedactHit[] = masked.hits.length ? redactMarkdown(masked.text, { rules, maskChar }).hits : [];
  let outPath: string | undefined;
  if (!p.dry_run && masked.hits.length) {
    outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stem}_마스킹.md` });
    await writeFile(outPath, masked.text, 'utf-8');
  }
  return { ...(outPath ? { output_path: outPath } : {}), hits: summarize(masked.hits), total: masked.hits.length, residual: residual.length, preserved: false };
}

export async function redactBatch(
  p: { paths: string[]; rules?: RedactRule[]; mask_char?: string; output_dir?: string },
  signal: AbortSignal,
): Promise<{ results: Array<BatchItemResult & { total?: number; residual?: number }>; output_dir: string }> {
  const results: Array<BatchItemResult & { total?: number; residual?: number }> = [];
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total: p.paths.length, message: `${i + 1}/${p.paths.length} 가리는 중` });
    try {
      const r = await redact({ path, rules: p.rules, mask_char: p.mask_char, output_dir: p.output_dir }, signal);
      results.push({ path, ok: true, output_path: r.output_path, total: r.total, residual: r.residual });
    } catch (err) {
      if (signal.aborted) throw err;
      results.push({ path, ok: false, error: errorText(err) });
    }
  }
  return { results, output_dir: outputDir({ output_dir: p.output_dir, source: p.paths[0] }) };
}
