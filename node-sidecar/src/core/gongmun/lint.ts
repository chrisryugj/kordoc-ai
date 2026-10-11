/** 공문서 표기법 검사 (lint) — kordoc 표기 규칙. 수치 대조(--numbers)·단계별 서식 편차(--styles)는 공개 API 에 없어 CLI 로 */

import { readFile } from 'node:fs/promises';
import { lintGongmunText, lintMuncheText, parse, type GongmunLintFinding } from 'kordoc';
import type { LintFinding } from '../../types/rpc-contract.js';
import { cleanMessage, parseFailure } from '../errors.js';
import { patchDocument } from '../hwpx-tools/index.js';
import { parseDoc } from '../converter/index.js';
import { formatOf, TEXT_FORMATS } from '../files/format.js';
import { parseCliJson, runKordocCli } from '../kordoc-cli.js';

export type LintCounts = { error: number; warning: number; info: number };

/** 바꿀 말이 하나로 정해진 지적만 고칠 거리로: "금일 → 오늘" 꼴 제안, 날짜 온점 뒤 띄어쓰기 */
export function fixOf(f: { rule: string; match: string; suggest?: string }): LintFinding['fix'] {
  if (f.rule === 'DATE_NO_SPACE' && /^\d{2,4}\.\d{1,2}\.(\d{1,2}\.)?$/.test(f.match)) return { from: f.match, to: f.match.replace(/\.(?=\d)/g, '. ') };
  const m = /^(.+?)\s*→\s*(.+)$/.exec(f.suggest ?? '');
  if (!m || m[1].trim() !== f.match || /[,·/]|또는/.test(m[2])) return undefined;
  return { from: f.match, to: m[2].trim() };
}

function toFinding(f: GongmunLintFinding): LintFinding {
  const fix = fixOf(f);
  return {
    rule: f.rule,
    severity: f.severity,
    message: cleanMessage(f.message),
    line: f.line,
    excerpt: f.match,
    ...(f.suggest ? { suggestion: cleanMessage(f.suggest) } : {}),
    ...(fix ? { fix } : {}),
  };
}

/** 고른 지적을 문서 글에 바꿔 넣고 서식 그대로 사본으로 (kordoc patchHwpx 는 parse 결과 마크다운을 고친 것을 받는다) */
export async function lintFix(p: { path: string; fixes: Array<{ from: string; to: string }>; output_path?: string }) {
  const fmt = formatOf(p.path);
  if (fmt !== 'hwpx' && fmt !== 'hwp') throw new Error('서식 그대로 고치기는 한글 문서(HWPX·HWP)만 됩니다.');
  const r = await parse(await readFile(p.path));
  if (!r.success) throw parseFailure(r, false);
  let md = r.markdown;
  let replaced = 0;
  for (const f of p.fixes) {
    if (!f.from || f.from === f.to) continue;
    const parts = md.split(f.from);
    replaced += parts.length - 1;
    md = parts.join(f.to);
  }
  if (!replaced) throw new Error('고칠 곳을 문서에서 찾지 못했습니다. 문서가 바뀌었으면 다시 검사하세요.');
  return { ...(await patchDocument({ path: p.path, markdown: md, output_path: p.output_path })), replaced };
}

/** 글 검사 — document: 완성 원고 규칙("끝."·붙임) 포함, parsed: 문서를 파싱한 글(원고 전용 규칙 제외) */
export function lintText(text: string, opts: { document?: boolean; parsed?: boolean } = {}): LintFinding[] {
  return lintGongmunText(text, { document: opts.document ?? true, parsed: opts.parsed }).map(toFinding);
}

export function countFindings(findings: LintFinding[]): LintCounts {
  const counts: LintCounts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

interface LevelStyle { font?: string; pt?: number; bold?: boolean }
interface CliLint {
  findings: GongmunLintFinding[];
  numbers?: { checked: number; review: Array<{ match: string; context: string }> };
  styles?: Array<{ depth: number; text: string; got: LevelStyle; expected: LevelStyle }>;
}

const showStyle = (s: LevelStyle) => [s.font, s.pt === undefined ? undefined : `${s.pt}pt`, s.bold === undefined ? undefined : s.bold ? '굵게' : '보통'].filter(Boolean).join('/');

export async function lintDoc(
  p: { text?: string; path?: string; numbers?: boolean; styles?: boolean; munche?: boolean },
  signal?: AbortSignal,
): Promise<{ findings: LintFinding[]; counts: LintCounts }> {
  if (p.text === undefined && !p.path) throw new Error('검사할 글이나 파일을 넣으세요.');
  let findings: LintFinding[];
  let markdown = p.text;
  const readDoc = async () => (markdown ??= (await parseDoc(p.path!, { images: false, ocr: 'off', signal })).markdown);
  if (!p.numbers && !p.styles) {
    if (p.text !== undefined) findings = lintText(p.text);
    else findings = lintText(await readDoc(), { parsed: !TEXT_FORMATS.has(formatOf(p.path!)) });
  } else {
    const args = ['lint', p.path ?? '-', '--json', ...(p.numbers ? ['--numbers'] : []), ...(p.styles ? ['--styles'] : [])];
    const res = await runKordocCli(args, { input: p.path ? undefined : p.text, signal });
    const j = parseCliJson<CliLint>(res, '표기법 검사를 하지 못했습니다.');
    findings = [
      ...j.findings.map(toFinding),
      ...(j.numbers?.review ?? []).map((r): LintFinding => ({
        rule: 'NUMBER_CHECK',
        severity: 'info',
        message: `본문의 "${r.match}" 값이 가까운 표에 없습니다. 숫자가 맞는지 확인하세요.`,
        excerpt: r.context,
      })),
      ...(j.styles ?? []).map((s): LintFinding => ({
        rule: 'STYLE_DEVIATION',
        severity: 'info',
        message: `${s.depth + 1}단계 항목인데 글꼴·크기·굵기가 같은 단계의 다른 문단과 다릅니다.`,
        excerpt: s.text,
        suggestion: `대표 ${showStyle(s.expected)} (지금 ${showStyle(s.got)})`,
      })),
    ];
  }
  // 개조식 문체(□ ○ - 항목은 "~함·~임"으로 끝맺기). 기안문처럼 서술형이 맞는 문서엔 켜지 않는다
  if (p.munche) {
    findings.push(...lintMuncheText(await readDoc()).map((f): LintFinding => ({
      rule: f.rule,
      severity: f.severity,
      message: cleanMessage(f.message),
      line: f.line,
      excerpt: f.match.slice(0, 60),
      ...(f.suggest ? { suggestion: cleanMessage(f.suggest) } : {}),
    })));
  }
  return { findings, counts: countFindings(findings) };
}
