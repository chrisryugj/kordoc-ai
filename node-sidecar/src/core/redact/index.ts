/** 개인정보 가림 (redact·redact_batch)
 *
 * HWPX·HWP 는 kordoc CLI `redact --json` — 본문·표·머리말·각주·미리보기·문서 정보까지 같은 길이로 가리고
 * 가린 뒤 다시 검사(잔존)한다. 남길 것(keep: 기관 대표번호·담당 공무원 이름 등)은 가린 사본에서 되살린다.
 * PDF·스캔·그림은 쪽 그림에 검은 상자를 칠한 새 PDF(글자층 없음, ./pdf.ts). 워드·엑셀 등은 원본을 건드리지 않고 가린 Markdown(.md).
 * 결과·로그에는 원본 개인정보를 싣지 않는다 — samples 는 가려진 문자열, 파일 이름 속 개인정보도 가린다.
 */

import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_REDACT_RULES, parse, redactMarkdown, redactText, type RedactHit } from 'kordoc';
import type { BatchItemResult, RedactResult, RedactRule } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { errorText } from '../errors.js';
import { parseDoc } from '../converter/index.js';
import { formatOf } from '../files/format.js';
import { parseCliJson, runKordocCli } from '../kordoc-cli.js';
import { outputDir, outputFile, stemOf } from '../output/index.js';
import { patchDocument } from '../hwpx-tools/index.js';
import { exportPdf } from '../export/index.js';
import { imageToPdf, redactPdf } from './pdf.js';

export const ALL_RULES: readonly RedactRule[] = ['rrn', 'phone', 'email', 'card', 'account', 'passport', 'driver', 'brn', 'crn', 'ip', 'name', 'address'];
export const RULE_LABELS: Record<RedactRule, string> = {
  rrn: '주민등록번호', phone: '전화번호', email: '전자우편', card: '카드번호', account: '계좌번호', passport: '여권번호',
  driver: '운전면허번호', brn: '사업자등록번호', crn: '법인등록번호', ip: 'IP 주소', name: '사람 이름', address: '주소',
};
/** "가린 뒤 남은 곳 없음"이라 말할 때 함께 밝힐, 이번에 보지 않은 항목 (개인정보 갈래만 — 법인번호·IP 는 개인정보가 아니라 뺀다) */
const PERSONAL: readonly RedactRule[] = ['rrn', 'phone', 'email', 'card', 'account', 'passport', 'driver', 'name', 'address'];

export interface RedactParams {
  path: string;
  rules?: RedactRule[];
  mask_char?: string;
  dry_run?: boolean;
  output_path?: string;
  output_dir?: string;
  /** 가리지 않고 남길 글 (기관 대표번호·담당 공무원 이름 등) — 띄어쓰기·하이픈은 무시하고 비교 */
  keep?: string[];
  /** 한글 문서를 가린 뒤 PDF 로도 저장 */
  also_pdf?: boolean;
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

const norm = (s: string) => s.replace(/[\s\-–.()·,]/g, '').toLowerCase();

/** 남길 것인가 — 같은 글이거나(띄어쓰기·하이픈 무시) 남길 글 안에 들어 있으면 */
export function keepMatcher(keep?: string[]): (s: string) => boolean {
  const list = (keep ?? []).map(norm).filter((k) => k.length >= 2);
  if (!list.length) return () => false;
  return (s: string) => {
    const n = norm(s);
    return n.length >= 2 && list.some((k) => k === n || k.includes(n));
  };
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

/** 남길 원문 → 가린 모양. 같은 가린 모양을 남기지 않을 다른 원문도 가지면 되살리지 않는다(되살리면 그것까지 드러난다) */
function keptForms(markdown: string, rules: readonly RedactRule[], maskChar: string, keep: (s: string) => boolean): Map<string, { orig: string; count: number }> {
  const forms = new Map<string, { orig: string; count: number } | null>();
  for (const h of redactMarkdown(markdown, { rules, maskChar }).hits) {
    const orig = markdown.slice(h.index, h.index + h.length);
    const cur = forms.get(h.masked);
    if (!keep(orig)) { forms.set(h.masked, null); continue; }
    if (cur === null) continue;
    if (cur && cur.orig !== orig) forms.set(h.masked, null);
    else forms.set(h.masked, { orig, count: (cur?.count ?? 0) + 1 });
  }
  return new Map([...forms].filter((e): e is [string, { orig: string; count: number }] => e[1] !== null));
}

/** 견본 목록에서 남길 것을 뺀다 (그 가린 모양은 남길 원문에서만 나온다 — keptForms 가 확인) */
function dropKept(hits: CliHit[], forms: Map<string, unknown>): CliHit[] {
  return hits.filter((h) => !forms.has(h.masked));
}

const unchecked = (rules: readonly RedactRule[]) => PERSONAL.filter((r) => !rules.includes(r));

async function redactHangul(p: RedactParams, rules: readonly RedactRule[], maskChar: string, stem: string, signal?: AbortSignal): Promise<RedactResult> {
  const format = formatOf(p.path) as 'hwp' | 'hwpx';
  const keep = keepMatcher(p.keep);
  const outPath = p.dry_run ? undefined : outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stem}_가림.${format}` });
  const args = ['redact', p.path, '--json', '--silent', `--rules=${rules.join(',')}`, `--mask-char=${maskChar}`, ...(outPath ? [`--output=${outPath}`] : ['--dry-run'])];
  const report = parseCliJson<CliReport>(await runKordocCli(args, { signal }), '개인정보를 가리지 못했습니다.');
  let listed = report.fileHits.length ? report.fileHits : report.hits;
  let keptCount = 0;
  if (p.keep?.length) {
    const orig = await parse(await readFile(p.path));
    const forms = orig.success ? keptForms(orig.markdown, rules, maskChar, keep) : new Map();
    if (forms.size) {
      listed = dropKept(listed, forms);
      keptCount = [...forms.values()].reduce((a, f) => a + f.count, 0);
      // 가린 사본에서 남길 글을 되살린다 (본문·표 — 서식 그대로 패치)
      if (report.output && !report.output.toLowerCase().endsWith('.md')) {
        const masked = await parse(await readFile(report.output));
        if (masked.success) {
          let md = masked.markdown;
          for (const [form, f] of forms) md = md.split(form).join(f.orig);
          if (md !== masked.markdown) {
            const tmp = join(dirname(report.output), `.${Date.now()}_가림.${format}`);
            try {
              await patchDocument({ path: report.output, markdown: md, output_path: tmp });
              await rename(tmp, report.output);
            } finally {
              await rm(tmp, { force: true });
            }
          }
        }
      }
    }
  }
  let pdfPath: string | undefined;
  if (report.output && p.also_pdf && !report.output.toLowerCase().endsWith('.md')) {
    pdfPath = (await exportPdf({ path: report.output, output_path: report.output.replace(/\.(hwpx|hwp)$/i, '.pdf') }, signal)).output_path;
  }
  return {
    ...(report.output ? { output_path: report.output } : {}),
    ...(pdfPath ? { pdf_path: pdfPath } : {}),
    hits: summarize(listed),
    total: listed.length,
    residual: report.residual.length + report.unscanned.length,
    unscanned: report.unscanned.length,
    preserved: !report.output || !report.output.toLowerCase().endsWith('.md'),
    unchecked_rules: unchecked(rules),
    ...(keptCount ? { kept: keptCount } : {}),
  };
}

async function redactPdfLike(p: RedactParams, rules: readonly RedactRule[], stem: string, signal?: AbortSignal): Promise<RedactResult> {
  const raw = new Uint8Array(await readFile(p.path));
  const bytes = formatOf(p.path) === 'image' ? await imageToPdf(raw) : raw;
  const r = await redactPdf(bytes, { rules, keep: keepMatcher(p.keep), dryRun: p.dry_run, signal });
  let outPath: string | undefined;
  if (!p.dry_run && r.pdf && r.hits.length) {
    outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stem}_가림.pdf` });
    await writeFile(outPath, r.pdf);
  }
  return {
    ...(outPath ? { output_path: outPath } : {}),
    hits: summarize(r.hits),
    total: r.hits.length,
    residual: r.residual,
    unscanned: r.unscanned.length,
    ...(r.unscanned.length ? { unscanned_pages: r.unscanned } : {}),
    preserved: false,
    unchecked_rules: unchecked(rules),
  };
}

export async function redact(p: RedactParams, signal?: AbortSignal): Promise<RedactResult> {
  const rules = p.rules?.length ? p.rules : [...DEFAULT_REDACT_RULES];
  const maskChar = p.mask_char || '●';
  redactText('', { rules, maskChar }); // 마스크 문자·룰 검사 (잘못되면 여기서 오류)
  const format = formatOf(p.path);
  const stem = maskName(stemOf(p.path), rules, maskChar);

  if (format === 'hwp' || format === 'hwpx') return redactHangul(p, rules, maskChar, stem, signal);
  if (format === 'pdf' || format === 'image') return redactPdfLike(p, rules, stem, signal);

  const r = await parseDoc(p.path, { images: false, signal });
  const keep = keepMatcher(p.keep);
  const masked = redactMarkdown(r.markdown, { rules, maskChar });
  const hits = masked.hits.filter((h) => !keep(r.markdown.slice(h.index, h.index + h.length)));
  // 남길 것은 원문으로 되돌린다 (같은 길이라 자리 그대로)
  let text = masked.text;
  for (const h of masked.hits) if (!hits.includes(h)) text = text.slice(0, h.index) + r.markdown.slice(h.index, h.index + h.length) + text.slice(h.index + h.length);
  const residual: RedactHit[] = hits.length ? redactMarkdown(text, { rules, maskChar }).hits.filter((h) => !keep(text.slice(h.index, h.index + h.length))) : [];
  let outPath: string | undefined;
  if (!p.dry_run && hits.length) {
    outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stem}_가림.md` });
    await writeFile(outPath, text, 'utf-8');
  }
  return { ...(outPath ? { output_path: outPath } : {}), hits: summarize(hits), total: hits.length, residual: residual.length, preserved: false, unchecked_rules: unchecked(rules) };
}

export async function redactBatch(
  p: { paths: string[]; rules?: RedactRule[]; mask_char?: string; output_dir?: string; keep?: string[] },
  signal: AbortSignal,
): Promise<{ results: Array<BatchItemResult & { total?: number; residual?: number }>; output_dir: string }> {
  const results: Array<BatchItemResult & { total?: number; residual?: number }> = [];
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total: p.paths.length, message: `${i + 1}/${p.paths.length} 가리는 중` });
    try {
      const r = await redact({ path, rules: p.rules, mask_char: p.mask_char, output_dir: p.output_dir, keep: p.keep }, signal);
      results.push({ path, ok: true, output_path: r.output_path, total: r.total, residual: r.residual });
    } catch (err) {
      if (signal.aborted) throw err;
      results.push({ path, ok: false, error: errorText(err) });
    }
  }
  return { results, output_dir: outputDir({ output_dir: p.output_dir, source: p.paths[0] }) };
}
