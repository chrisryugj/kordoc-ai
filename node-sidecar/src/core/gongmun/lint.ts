/** 공문서 표기법 검사 (lint) — kordoc 표기 규칙. 수치 대조(--numbers)·단계별 서식 편차(--styles)는 공개 API 에 없어 CLI 로
 *
 * 화면에는 규칙 코드(DATE_NO_SPACE 등) 대신 쉬운 갈래 이름(category)·합니다체 설명·낱말 단위 발췌(context)·실제로 고칠 값(fix)을 낸다.
 */

import { readFile } from 'node:fs/promises';
import { lintGongmunText, lintMuncheText, parse, type GongmunLintFinding } from 'kordoc';
import type { LintFinding } from '../../types/rpc-contract.js';
import { cleanMessage, parseFailure } from '../errors.js';
import { patchDocument } from '../hwpx-tools/index.js';
import { parseDoc } from '../converter/index.js';
import { formatOf, TEXT_FORMATS } from '../files/format.js';
import { parseCliJson, runKordocCli } from '../kordoc-cli.js';

export type LintCounts = { error: number; warning: number; info: number };

/** 규칙 코드 → 화면에 보일 갈래 이름 (위에서부터 처음 맞는 것) */
const CATEGORIES: Array<[RegExp, string]> = [
  [/^WEEKDAY/, '날짜와 요일'],
  [/^DATE_/, '날짜 표기'],
  [/^TIME_/, '시각 표기'],
  [/^(RANGE_DASH|TILDE_SPACE|KKAJI_DUP)$/, '기간 표기'],
  [/^MONEY_/, '금액 표기'],
  [/^COLON_SPACE$/, '쌍점 띄어쓰기'],
  [/^(BUNIM_|END_MARK)/, '붙임·끝 표시'],
  [/^PLAIN_LANGUAGE$/, '쉬운 말'],
  [/^(SPELLING_ERROR|DUEUM_ERROR)$/, '맞춤법'],
  [/^LOANWORD_ERROR$/, '외래어 표기'],
  [/^DISCRIMINATORY_TERM$/, '차별 표현'],
  [/^FOREIGN_FIRST$/, '외국어 병기'],
  [/^AI_/, 'AI 문체 흔적'],
  [/^NUMBER_CHECK$/, '본문과 표 숫자'],
  [/^STYLE_DEVIATION$/, '항목 서식'],
];

export function categoryOf(rule: string): string {
  return CATEGORIES.find(([re]) => re.test(rule))?.[1] ?? '표기';
}

/** kordoc 설명(~함 꼴)을 화면 문체(합니다체)로. 없는 규칙은 kordoc 설명 그대로 */
const MESSAGES: Record<string, string> = {
  DATE_NO_SPACE: '날짜는 연·월·일 온점 뒤를 한 칸씩 띄웁니다.',
  DATE_NO_END_DOT: "날짜의 '일' 뒤에도 온점을 찍습니다.",
  DATE_ZERO_PAD: '월·일 앞에 0을 붙이지 않습니다.',
  DATE_2DIGIT_YR: '연도는 네 자리로 적습니다.',
  DATE_HYPHEN: '날짜는 하이픈 대신 온점으로 구분합니다.',
  WEEKDAY_MISMATCH: '날짜와 요일이 맞지 않습니다.',
  TIME_AMPM: '시각은 오전·오후 대신 24시각제 숫자로 적습니다.',
  TIME_24H: "'24시'보다 '다음 날 00:00'이나 '18:00까지'처럼 적습니다.",
  TIME_COLON_SP: '시와 분 사이 쌍점은 앞뒤를 붙여 씁니다.',
  RANGE_DASH: '기간과 시각 범위는 물결표(∼)로 잇습니다.',
  TILDE_SPACE: '물결표(∼) 앞뒤는 붙여 씁니다.',
  KKAJI_DUP: "물결표(∼)와 '까지'를 함께 쓰지 않습니다.",
  MONEY_NO_HANGUL: '금액은 숫자 뒤 괄호 안에 한글로도 적습니다.',
  MONEY_HANGUL_MISMATCH: '괄호 안 한글 금액이 숫자와 다릅니다.',
  MONEY_GEUM_SP: "'금'과 숫자는 붙여 씁니다.",
  MONEY_CHEONWON: "금액은 '천원'으로 줄이지 않고 숫자로 다 적습니다.",
  COLON_SPACE: '쌍점은 앞말에 붙이고 뒤는 한 칸 띄웁니다.',
  BUNIM_COLON: "'붙임' 뒤에는 쌍점을 쓰지 않고 두 칸 띄웁니다.",
  BUNIM_SPACE: "'붙임' 뒤는 두 칸 띄웁니다.",
  END_MARK_MISSING: "본문이나 붙임이 끝나는 곳에 '끝.' 표시가 없습니다.",
  END_MARK_SPACE: "'끝.'은 앞 글 마침표에서 두 칸 띄웁니다.",
  PLAIN_LANGUAGE: '더 쉬운 말로 바꿔 쓸 수 있습니다(틀린 말은 아닙니다).',
  SPELLING_ERROR: '맞춤법에 맞지 않는 말입니다.',
  DUEUM_ERROR: "낱말 첫머리의 '년'은 '연'으로 적습니다(두음법칙).",
  LOANWORD_ERROR: '외래어 표기법에 맞지 않습니다.',
  DISCRIMINATORY_TERM: '차별하거나 낮잡는 표현은 바꿔 씁니다.',
  FOREIGN_FIRST: '한글을 먼저 쓰고 외국어는 괄호 안에 적습니다.',
  AI_EM_DASH: '긴 줄표는 공문서 표기에 맞지 않습니다. 쉼표나 괄호로 풀어 씁니다.',
  AI_BOLD_OVERUSE: '한 줄에 굵게 강조가 너무 많습니다.',
};

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const groupDigits = (s: string) => s.replace(/(?<![\d,.])\d{4,}(?![\d,.])/g, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ','));

/** 걸린 조각(match)을 무엇으로 바꾸면 되는가 — 정해진 값이 있을 때만. after 는 줄에서 match 뒤에 오는 글 */
function correctedOf(f: { rule: string; match: string; suggest?: string }, after: string): string | undefined {
  const m = f.match;
  switch (f.rule) {
    case 'DATE_NO_SPACE': return /^\d{2,4}\.\d{1,2}\.(\d{1,2}\.)?$/.test(m) ? m.replace(/\.(?=\d)/g, '. ') : undefined;
    case 'DATE_ZERO_PAD': return m.replace(/\.\s*0(\d)/g, '. $1');
    case 'DATE_NO_END_DOT': return `${m}.`;
    case 'DATE_2DIGIT_YR': return /^['’]\d{2}\./.test(m) ? m.replace(/^['’](\d{2})/, '20$1') : undefined;
    case 'TIME_COLON_SP': return m.replace(/\s+/g, '');
    case 'TILDE_SPACE': return m.replace(/[ \t]+/g, '');
    case 'MONEY_GEUM_SP': return m.replace(/^금\s+/, '금');
    case 'COLON_SPACE': return /\s:/.test(m) ? m.replace(/\s+:/, ':') : m.replace(':', ': ');
    case 'TIME_AMPM': {
      const t = /^(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/.exec(m + after);
      if (!t) return undefined;
      let h = Number(t[2]);
      if (h > 12) return undefined;
      if (t[1] === '오후' && h < 12) h += 12;
      if (t[1] === '오전' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(Number(t[3] ?? 0)).padStart(2, '0')}`;
    }
    case 'MONEY_HANGUL_MISMATCH': return f.suggest && /^금[\d,]+원/.test(f.suggest) ? groupDigits(f.suggest) : undefined;
  }
  const a = /^(.+?)\s*→\s*(.+)$/.exec(f.suggest ?? '');
  if (!a || a[1].trim() !== m || /[,·/]|또는/.test(a[2].replace(/(\d),(\d)/g, '$1$2'))) return undefined;
  return f.rule.startsWith('MONEY_') ? groupDigits(a[2].trim()) : a[2].trim();
}

/** TIME_AMPM 은 "오후 2시 30분"처럼 match 뒤까지 바꾼다 — 바꿀 길이 */
function spanOf(f: { rule: string; match: string }, after: string): number {
  if (f.rule !== 'TIME_AMPM') return f.match.length;
  const t = /^(오전|오후)\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?/.exec(f.match + after);
  return t ? t[0].length : f.match.length;
}

/** 바꿀 말이 하나로 정해진 지적만 고칠 거리로 (줄을 모를 때는 걸린 조각만으로) */
export function fixOf(f: { rule: string; match: string; suggest?: string }): LintFinding['fix'] {
  const to = correctedOf(f, '');
  return to && to !== f.match ? { from: f.match, to } : undefined;
}

/** 줄에서 걸린 조각을 찾는다 (줄 번호가 어긋나면 글 전체에서 처음 나온 곳) */
function locate(lines: string[], line: number | undefined, match: string): { row: number; at: number } | undefined {
  if (!match) return undefined;
  const at = line ? lines[line - 1]?.indexOf(match) ?? -1 : -1;
  if (at >= 0) return { row: line! - 1, at };
  for (let r = 0; r < lines.length; r++) {
    const i = lines[r].indexOf(match);
    if (i >= 0) return { row: r, at: i };
  }
  return undefined;
}

/** 화면용 발췌 — 마크다운 표지(\~ ** | #)를 걷어 낸다 */
export function plainText(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!~$>|])/g, '$1').replace(/\*\*|__/g, '').replace(/^\s*(#{1,6}|[-*]|\|)\s+/, '').replace(/\s*\|\s*/g, ' · ').replace(/\s+/g, ' ').trim();
}

/** 걸린 조각을 감싼 낱말들 (앞뒤로 한 낱말씩 더, 40자 안에서) */
export function contextOf(text: string, start: number, end: number): string {
  let s = start;
  let e = end;
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  while (e < text.length && !/\s/.test(text[e])) e++;
  const grow = (dir: -1 | 1) => {
    let i = dir < 0 ? s : e;
    while (dir < 0 ? i > 0 && /[ \t]/.test(text[i - 1]) : i < text.length && /[ \t]/.test(text[i])) i += dir;
    while (dir < 0 ? i > 0 && !/\s/.test(text[i - 1]) : i < text.length && !/\s/.test(text[i])) i += dir;
    return i;
  };
  const ps = grow(-1);
  if (e - ps <= 40) s = ps;
  const ne = grow(1);
  if (ne - s <= 40) e = ne;
  return plainText(text.slice(s, e));
}

/** kordoc 지적 하나를 화면용으로 — text 가 있으면 낱말 단위 발췌·낱말 경계까지 넓힌 고칠 거리 */
function toFinding(f: GongmunLintFinding | (Omit<GongmunLintFinding, 'severity'> & { severity: LintFinding['severity'] }), lines?: string[]): LintFinding {
  const pos = lines ? locate(lines, f.line, f.match) : undefined;
  let fix: LintFinding['fix'];
  let context: string | undefined;
  let line = f.line;
  if (pos) {
    const text = lines![pos.row];
    line = pos.row + 1;
    const after = text.slice(pos.at + f.match.length);
    const to = correctedOf(f, after);
    const len = spanOf(f, after);
    if (to !== undefined && to !== text.slice(pos.at, pos.at + len)) {
      // 고칠 말이 낱말 가운데서 시작·끝나면(예: "련 :") 낱말 끝까지 넓혀 다른 낱말 속 같은 글자를 건드리지 않게
      let s = pos.at;
      let e = pos.at + len;
      while (s > 0 && isWord(text[s - 1]) && isWord(text[s])) s--;
      while (e < text.length && isWord(text[e]) && isWord(text[e - 1])) e++;
      fix = { from: text.slice(s, e), to: text.slice(s, pos.at) + to + text.slice(pos.at + len, e) };
    }
    context = contextOf(text, pos.at, pos.at + len);
  } else {
    fix = fixOf(f);
  }
  const weekday = f.rule === 'WEEKDAY_MISMATCH' && fix ? /(\d{1,2})\.\s*(\d{1,2})\.?\s*\(([일월화수목금토])\)\s*$/.exec(fix.to) : null;
  const message = weekday ? `${weekday[1]}월 ${weekday[2]}일은 ${weekday[3]}요일입니다.` : MESSAGES[f.rule] ?? cleanMessage(f.message);
  // 정해진 값이 없을 때만 예시를 보인다 ("예) …" → "예: …")
  const suggestion = fix ? undefined : f.rule === 'RANGE_DASH' ? `${f.match.replace(/\s*[-–―~～]\s*/, '∼')}` : f.suggest ? cleanMessage(f.suggest).replace(/^예\)\s*/, '예: ') : undefined;
  return {
    rule: f.rule,
    severity: f.severity,
    category: categoryOf(f.rule),
    message,
    line,
    excerpt: f.match,
    ...(context ? { context } : {}),
    ...(suggestion ? { suggestion } : {}),
    ...(fix ? { fix } : {}),
  };
}

const ORDER = { error: 0, warning: 1, info: 2 } as const;
/** 심각한 것부터, 같은 심각도는 문서 순서 */
export function sortFindings<T extends { severity: LintFinding['severity']; line?: number }>(list: T[]): T[] {
  return list.map((f, i) => ({ f, i })).sort((a, b) => ORDER[a.f.severity] - ORDER[b.f.severity] || (a.f.line ?? 1e9) - (b.f.line ?? 1e9) || a.i - b.i).map((x) => x.f);
}

/** 바꿀 말이 낱말 가운데에 붙어 있으면(예: "금일백만원" 속 "금일") 바꾸지 않는다 */
export function replaceWords(text: string, from: string, to: string): { text: string; count: number } {
  let out = '';
  let count = 0;
  let i = 0;
  for (;;) {
    const j = text.indexOf(from, i);
    if (j < 0) break;
    const before = text[j - 1];
    const after = text[j + from.length];
    if ((isWord(before) && isWord(from[0])) || (isWord(after) && isWord(from.at(-1)))) {
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += text.slice(i, j) + to;
    i = j + from.length;
    count++;
  }
  return { text: out + text.slice(i), count };
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
    const next = replaceWords(md, f.from, f.to);
    replaced += next.count;
    md = next.text;
  }
  if (!replaced) throw new Error('고칠 곳을 문서에서 찾지 못했습니다. 문서가 바뀌었으면 다시 검사하세요.');
  return { ...(await patchDocument({ path: p.path, markdown: md, output_path: p.output_path })), replaced };
}

/** 글 검사 — document: 완성 원고 규칙("끝."·붙임) 포함, parsed: 문서를 파싱한 글(원고 전용 규칙 제외) */
export function lintText(text: string, opts: { document?: boolean; parsed?: boolean } = {}): LintFinding[] {
  const lines = text.split('\n');
  return lintGongmunText(text, { document: opts.document ?? true, parsed: opts.parsed }).map((f) => toFinding(f, lines));
}

export function countFindings(findings: Array<{ severity: LintFinding['severity'] }>): LintCounts {
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
const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function lintDoc(
  p: { text?: string; path?: string; numbers?: boolean; styles?: boolean; munche?: boolean },
  signal?: AbortSignal,
): Promise<{ findings: LintFinding[]; counts: LintCounts }> {
  const { findings, counts } = await lintWithText(p, signal);
  return { findings, counts };
}

/** lintDoc + 검사한 글(마크다운) — 결재 전 점검이 같은 글로 다른 검사를 잇는다 */
export async function lintWithText(
  p: { text?: string; path?: string; numbers?: boolean; styles?: boolean; munche?: boolean; markdown?: string },
  signal?: AbortSignal,
): Promise<{ findings: LintFinding[]; counts: LintCounts; markdown: string }> {
  if (p.text === undefined && !p.path) throw new Error('검사할 글이나 파일을 넣으세요.');
  let findings: LintFinding[];
  let markdown = p.text ?? p.markdown;
  const readDoc = async () => (markdown ??= (await parseDoc(p.path!, { images: false, ocr: 'off', signal })).markdown);
  if (!p.numbers && !p.styles) {
    if (p.text !== undefined) findings = lintText(p.text);
    else findings = lintText(await readDoc(), { parsed: !TEXT_FORMATS.has(formatOf(p.path!)) });
  } else {
    const args = ['lint', p.path ?? '-', '--json', ...(p.numbers ? ['--numbers'] : []), ...(p.styles ? ['--styles'] : [])];
    const [res, md] = await Promise.all([runKordocCli(args, { input: p.path ? undefined : p.text, signal }), readDoc()]);
    const j = parseCliJson<CliLint>(res, '표기법 검사를 하지 못했습니다.');
    const lines = md.split('\n');
    findings = [
      ...j.findings.map((f) => toFinding(f, lines)),
      ...(j.numbers?.review ?? []).map((r): LintFinding => ({
        rule: 'NUMBER_CHECK',
        severity: 'info',
        category: categoryOf('NUMBER_CHECK'),
        message: `본문의 "${plainText(r.match)}" 값이 가까운 표에 없습니다. 숫자가 맞는지 확인하세요.`,
        excerpt: r.context,
        context: clip(plainText(r.context)),
      })),
      ...(j.styles ?? []).map((s): LintFinding => ({
        rule: 'STYLE_DEVIATION',
        severity: 'info',
        category: categoryOf('STYLE_DEVIATION'),
        message: `${s.depth + 1}단계 항목인데 글꼴·크기·굵기가 같은 단계의 다른 문단과 다릅니다.`,
        excerpt: s.text,
        context: clip(plainText(s.text)),
        suggestion: `대표 ${showStyle(s.expected)} (지금 ${showStyle(s.got)})`,
      })),
    ];
  }
  // 개조식 문체(□ ○ - 항목은 "~함·~임"으로 끝맺기). 기안문처럼 서술형이 맞는 문서엔 켜지 않는다
  if (p.munche) {
    findings.push(...lintMuncheText(await readDoc()).map((f): LintFinding => ({
      rule: f.rule,
      severity: f.severity,
      category: '개조식 문체',
      message: cleanMessage(f.message),
      line: f.line,
      excerpt: f.match.slice(0, 60),
      context: clip(plainText(f.match)),
      ...(f.suggest ? { suggestion: cleanMessage(f.suggest) } : {}),
    })));
  }
  findings = sortFindings(findings);
  return { findings, counts: countFindings(findings), markdown: await readDoc() };
}
