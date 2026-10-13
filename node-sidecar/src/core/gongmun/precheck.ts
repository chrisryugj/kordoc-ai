/** 결재 전 한 번에 점검 (precheck) — AI 없이 빠른 검사를 한 목록으로
 *
 * 표기법(kordoc lint + 본문·표 숫자 + 단계 서식) · 날짜와 요일 · 표 합계 · "끝."·붙임 · 채우지 않은 자리 ·
 * 빈칸 안내 글자(HWPX 누름틀) · 남은 개인정보(정보공개 기준 룰, 남길 것 제외). 지적마다 쪽(알 때)과 낱말 단위 발췌.
 * K팀장(ai_review)·법령 근거(law_check)는 화면이 이 결과를 보인 뒤 뒤에서 따로 부른다.
 */

import { readFile } from 'node:fs/promises';
import { extractClickHereFields, redactMarkdown } from 'kordoc';
import type { LintFinding, PrecheckResult, RedactRule } from '../../types/rpc-contract.js';
import { parseDoc } from '../converter/index.js';
import { formatOf, TEXT_FORMATS } from '../files/format.js';
import { ALL_RULES, RULE_LABELS, keepMatcher } from '../redact/index.js';
import { contextOf, countFindings, lintWithText, replaceWords, sortFindings } from './lint.js';
import { endMarkFindings, placeholderFindings, sumFindings, weekdayFindings } from './consistency.js';
import { findPage, pageTexts } from './pages.js';

/** 남은 개인정보 지적 상한 (명단 문서는 이름이 수백 개라 앞의 것만 하나씩, 나머지는 한 줄로) */
const PRIVACY_MAX = 15;
const SEVERE: RedactRule[] = ['rrn'];
const NUMBERS: RedactRule[] = ['card', 'account', 'passport', 'driver', 'phone', 'email'];

/** 받침 있으면 "으로", 없거나 ㄹ 받침이면 "로" */
function withRo(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  const jong = c >= 0 && c < 11172 ? c % 28 : 0;
  return `${word}${jong && jong !== 8 ? '으로' : '로'}`;
}

export async function precheck(p: { path: string; munche?: boolean; keep?: string[] }, signal?: AbortSignal): Promise<PrecheckResult> {
  const fmt = formatOf(p.path);
  const hangul = fmt === 'hwp' || fmt === 'hwpx';
  const parsedDoc = await parseDoc(p.path, { images: false, ocr: 'off', signal });
  const markdown = parsedDoc.markdown;
  if (!markdown.trim()) throw new Error('문서에서 글자를 찾지 못했습니다. 스캔 문서라면 내보내기에서 글자 읽기(OCR)를 한 뒤 그 결과로 점검하세요.');
  const parsed = !TEXT_FORMATS.has(fmt);
  const checked: string[] = ['표기법'];
  const skipped: string[] = [];

  // 쪽 글은 rhwp·PDFium 으로 따로 — 표기 검사와 같이 돌린다
  const pagesP = pageTexts(p.path, signal);
  const lint = await lintWithText({ path: p.path, markdown, numbers: true, styles: fmt === 'hwpx', munche: p.munche }, signal);
  const lines = markdown.split('\n');

  // ── 엔진 검사 (kordoc 이 보지 않는 것) ──
  const extra: LintFinding[] = [];
  const kordocWeekdays = new Set(lint.findings.filter((f) => f.rule === 'WEEKDAY_MISMATCH').map((f) => f.excerpt));
  extra.push(...weekdayFindings(markdown).filter((f) => ![...kordocWeekdays].some((k) => k && (k.includes(f.excerpt!) || f.excerpt!.includes(k)))));
  checked.push('날짜와 요일');
  const sums = sumFindings(parsedDoc.blocks ?? [], markdown);
  // 합계 칸 값이 문서에 한 번만 나올 때만 고칠 거리로 (같은 숫자가 다른 곳에 있으면 잘못 바꿀 수 있다)
  for (const { table: _table, ...f } of sums) {
    if (f.fix && replaceWords(markdown, f.fix.from, f.fix.to).count !== 1) delete f.fix;
    extra.push(f);
  }
  checked.push('표 합계');
  // 글 파일은 kordoc 원고 규칙이 "끝."을 본다. 파싱한 글은 여기서 있고 없음만
  if (parsed) {
    const mine = endMarkFindings(markdown);
    // kordoc CLI 도 붙임 뒤 "끝." 없음을 짚으면 고칠 거리가 있는 쪽 하나만
    if (mine.length) lint.findings = lint.findings.filter((f) => f.rule !== 'END_MARK_MISSING');
    extra.push(...mine);
  }
  checked.push('끝. 표시');
  extra.push(...placeholderFindings(markdown));

  // ── 빈칸 안내 글자 (HWPX 누름틀) ──
  const fieldItems: LintFinding[] = [];
  if (fmt === 'hwpx') {
    checked.push('빈칸 안내 글자');
    try {
      const fields = (await extractClickHereFields(new Uint8Array(await readFile(p.path)).buffer as ArrayBuffer)).filter((f) => !f.value.trim() && f.placeholder?.trim());
      for (const f of fields.slice(0, 10)) {
        fieldItems.push({
          rule: 'EMPTY_FIELD', severity: 'warning', category: '빈칸 안내 글자',
          message: `'${f.name}' 칸을 채우지 않았습니다. 그대로 PDF로 저장하거나 인쇄하면 안내 글자 '${f.placeholder!.trim()}'가 찍힐 수 있습니다.`,
          excerpt: f.placeholder!.trim(), context: f.placeholder!.trim(),
        });
      }
      if (fields.length > 10) fieldItems.push({ rule: 'EMPTY_FIELD', severity: 'warning', category: '빈칸 안내 글자', message: `그 밖에 채우지 않은 칸이 ${fields.length - 10}곳 더 있습니다.` });
    } catch {
      skipped.push('빈칸 안내 글자(문서에서 칸을 읽지 못했습니다)');
    }
  } else if (fmt === 'hwp') skipped.push('빈칸 안내 글자(HWP는 아직 보지 못합니다. HWPX로 저장하면 봅니다)');

  // ── 남은 개인정보 (정보공개 기준: 이름·주소까지) ──
  checked.push('개인정보');
  // 법인등록번호는 개인정보가 아니고, IP 는 "1.2.3.4" 절 번호와 겹쳐 뺀다
  const masked = redactMarkdown(markdown, { rules: ALL_RULES.filter((r) => r !== 'crn' && r !== 'ip') });
  const keep = keepMatcher(p.keep);
  const hits = masked.hits.filter((h) => !keep(markdown.slice(h.index, h.index + h.length)));
  const privacy: Array<LintFinding & { needle: string }> = [];
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) { offsets.push(acc); acc += l.length + 1; }
  const rowOf = (index: number) => { let r = 0; while (r + 1 < offsets.length && offsets[r + 1] <= index) r++; return r; };
  // 화면 발췌는 가린 글로 (남길 것은 원문 그대로)
  let shown = markdown;
  for (const h of hits) shown = shown.slice(0, h.index) + h.masked + shown.slice(h.index + h.length);
  const maskedLines = shown.split('\n');
  for (const h of hits.slice(0, PRIVACY_MAX)) {
    const r = rowOf(h.index);
    const at = h.index - offsets[r];
    privacy.push({
      rule: `PRIVACY_${h.rule.toUpperCase()}`,
      severity: SEVERE.includes(h.rule) ? 'error' : NUMBERS.includes(h.rule) ? 'warning' : 'info',
      category: '개인정보',
      message: `${withRo(RULE_LABELS[h.rule])} 보이는 글이 있습니다: ${h.masked}. 밖으로 보내거나 공개할 문서라면 가리세요.`,
      line: r + 1,
      context: contextOf(maskedLines[r] ?? '', at, at + h.length),
      needle: contextOf(lines[r] ?? '', at, at + h.length),
    });
  }
  if (hits.length > PRIVACY_MAX) {
    privacy.push({ rule: 'PRIVACY_MORE', severity: 'info', category: '개인정보', message: `그 밖에 개인정보로 보이는 곳이 ${hits.length - PRIVACY_MAX}곳 더 있습니다. 개인정보 가리기에서 한꺼번에 가릴 수 있습니다.`, needle: '' });
  }

  // ── 쪽 붙이기 ──
  const pages = await pagesP;
  if (!pages && (hangul || fmt === 'pdf')) skipped.push('쪽 번호(문서가 커서 쪽을 나누지 못했습니다)');
  const withPage = <T extends LintFinding>(f: T, needle?: string): T => {
    const page = findPage(pages, needle ?? f.context ?? f.excerpt);
    return page ? { ...f, page } : f;
  };
  const items = sortFindings([
    ...lint.findings.map((f) => withPage(f, f.context && f.rule !== 'NUMBER_CHECK' ? f.context : f.excerpt)),
    ...extra.map((f) => withPage(f)),
    ...fieldItems.map((f) => withPage(f)),
    ...privacy.map(({ needle, ...f }) => withPage(f, needle || undefined)),
  ]);
  return {
    items,
    counts: countFindings(items),
    fixable: hangul ? items.filter((f) => f.fix).length : 0,
    checked,
    skipped,
    ...(pages ? { page_count: pages.length } : {}),
  };
}
