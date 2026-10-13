/** 내용 문서의 글(kordoc 마크다운) → 서식을 입힐 수 있는 공문서 마크다운
 *
 * - 기안문 두문(기관 표어·기관명·수신·경유·제목)은 빼고 수신·제목만 건진다. 결문(시행·접수·우편번호·전화)은 버린다.
 * - 항목 기호(□ ○ - · / 1. 가. 1) …)는 떼고 단계(깊이)만 남겨 마크다운 목록으로 → 생성기가 대상 서식의 기호로 다시 붙인다.
 * - 법정 번호는 목록 사이 서술 문단이 있으면 생성기가 1부터 다시 센다 → 목록 중간의 짧은 서술 문단은 앞 항목에 잇는다.
 * - 표·그림은 그대로 둔다.
 */

import { DepthStack, readMarker } from './markers.js';

export interface NormalizedContent {
  title?: string;
  /** 기안문 수신 */
  to?: string;
  markdown: string;
  /** 원문에 있던 항목 기호 갈래 (단계 차례) */
  sourceMarkers: string[];
  /** 원문에 끝 표시가 있었는지 */
  hadEndMark: boolean;
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'item'; depth: number; text: string }
  | { kind: 'ref'; text: string }
  /** 붙임 — 줄마다 (붙임  1. … / 2. …) */
  | { kind: 'attach'; lines: string[] }
  | { kind: 'para'; text: string }
  | { kind: 'raw'; text: string };

const FOOT_RE = /^(시\s*행\b|접\s*수\b|협\s*조\s*자|우\s*\d{3}|전\s*화\s|전\s*송\s|공개\s*구분|\/\s*(비|부분)?공개|(비|부분)공개\s*\(|공개$)/;
const HEAD_RE = /^(수\s*신(자)?|\(?\s*경\s*유\s*\)?|제\s*목)/;
const END_RE = /(?:^|\s|(?<=\.))끝\s*\.?\s*$/;
const isRaw = (t: string) => /^(<table|\||!\[|```|<img)/i.test(t);
const visible = (s: string) => s.replace(/\s/g, '').length;

/** 빈 줄로 나눈 덩이 — 단, HTML 표는 안에 빈 줄이 있어도(칸 안의 표 등) 닫힐 때까지 한 덩이 */
export function mdChunks(md: string): string[] {
  const out: string[] = [];
  let open = 0;
  // 글 줄 바로 아래 빈 줄 없이 붙은 표는 따로 떼어 낸다
  const pieces = md.replace(/\r\n?/g, '\n').split(/\n{2,}/).flatMap((c) => (/^\s*<table\b/i.test(c) ? [c] : c.split(/\n(?=<table\b)/i)));
  for (const chunk of pieces) {
    if (open > 0) out[out.length - 1] += `\n\n${chunk}`;
    else out.push(chunk);
    open += (chunk.match(/<table\b/gi) ?? []).length - (chunk.match(/<\/table>/gi) ?? []).length;
    if (open < 0) open = 0;
  }
  return out;
}

/** 마크다운 → 문단 줄 (빈 줄로 나누고, 한 덩어리 안에서는 기호·목록·제목으로 시작하는 줄마다 새 문단) */
function paragraphs(md: string): string[] {
  const out: string[] = [];
  for (const chunk of mdChunks(md)) {
    const c = chunk.replace(/^\n+|\n+$/g, '');
    if (!c.trim()) continue;
    if (isRaw(c.trim())) { out.push(c.trim()); continue; }
    let cur = '';
    for (const line of c.split('\n')) {
      const starts = /^\s*(#{1,6}\s|[-*+]\s|\d{1,2}[.)]\s|>)/.test(line) || readMarker(unescapeLead(line)) !== null;
      if (cur && starts) { out.push(cur); cur = line; }
      else cur = cur ? `${cur} ${line.trim()}` : line;
    }
    if (cur.trim()) out.push(cur);
  }
  return out;
}

/** kordoc 이 목록 문법과 겹치지 않게 붙인 줄 앞 역슬래시(`1\.`·`\-`)를 떼어 기호로 읽는다 */
function unescapeLead(line: string): string {
  return line.replace(/^(\s*)\\([-*+#>※])/, '$1$2').replace(/^(\s*\d{1,2})\\([.)])/, '$1$2');
}

export interface NormalizeOptions {
  /** 견본 쪽 글자 크기로 찾은 제목 줄 */
  titleHint?: string;
  /** 마크다운·글·워드 원문 (- 목록의 들여쓰기가 단계) */
  textSource?: boolean;
  /** 대상 서식에 장(Ⅰ.)이 없으면 장 제목(##·Ⅰ.)을 첫 단계 항목으로 */
  headingsAsItems?: boolean;
  /** 대상 서식의 첫 기호가 2단계 이하(○ 로 시작하는 보고서 등)일 때 모든 항목을 그만큼 깊게 */
  depthOffset?: number;
  /** 기안문 서식: 끝 표시를 마지막 줄 끝에 "  끝." 으로 둔다(원문에 없으면 붙인다, 표로 끝나면 다음 줄).
   *  생성기의 자동 끝 표시는 늘 따로 한 줄이라 쓰지 않는다 */
  keepEndMark?: boolean;
}

export function normalizeContent(md: string, opts: NormalizeOptions = {}): NormalizedContent {
  let paras = paragraphs(md);
  let title: string | undefined;
  let to: string | undefined;

  // 기안문 두문: 앞쪽 25문단 안의 "제목 …" 줄 (앞에 "수신" 줄이 있을 때)
  const titleAt = paras.slice(0, 25).findIndex((p) => /^\s*제\s*목\s*[:：]?\s*\S/.test(p));
  const toAt = paras.slice(0, Math.max(titleAt, 0)).findIndex((p) => /^\s*수\s*신(자)?\s*[:：]?/.test(p));
  if (titleAt >= 0 && toAt >= 0) {
    title = paras[titleAt].replace(/^\s*제\s*목\s*[:：]?\s*/, '').trim();
    const toText = paras[toAt].replace(/^\s*수\s*신(자)?\s*[:：]?\s*/, '').replace(/\(\s*경\s*유\s*\).*$/, '').trim();
    if (toText) to = toText;
    // 두문 자리의 짧은 줄(표어·기관명·수신·경유)·그림은 빼고, 순서가 섞여 앞에 온 본문 항목·긴 문단·표는 남긴다
    paras = paras.filter((p, i) => {
      if (i > titleAt) return true;
      if (i === titleAt) return false;
      const t = p.trim();
      if (/^!\[/.test(t)) return false;
      if (readMarker(unescapeLead(t)) || /^<table|^\|/.test(t)) return true;
      return !(HEAD_RE.test(t) || visible(t) <= 40);
    });
  }

  // 결문: 끝 표시 뒤의 시행·접수·주소·전화 줄은 버린다
  let hadEndMark = false;
  const endAt = paras.map((p) => END_RE.test(p) && !isRaw(p.trim())).lastIndexOf(true);
  if (endAt >= 0) {
    const after = paras.slice(endAt + 1);
    if (!after.length || after.some((p) => FOOT_RE.test(p.trim()))) paras = paras.slice(0, endAt + 1);
    hadEndMark = true;
    paras[endAt] = paras[endAt].replace(END_RE, '').replace(/\s+$/, '');
    if (!paras[endAt].trim()) paras.splice(endAt, 1);
  }
  while (paras.length && FOOT_RE.test(paras[paras.length - 1].trim())) paras.pop();

  // 제목: 첫 # 줄 → 견본 쪽에서 찾은 제목 줄 → 맨 앞 짧은 줄
  const blocks: Block[] = [];
  for (const raw of paras) {
    const t = raw.trim();
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { blocks.push({ kind: 'heading', level: h[1].length, text: h[2].trim() }); continue; }
    if (isRaw(t)) { blocks.push({ kind: 'raw', text: t }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) continue;
    // 앞 띄어쓰기는 남긴다 (마크다운 목록의 들여쓰기 = 단계)
    blocks.push({ kind: 'para', text: raw.replace(/\s+$/, '').replace(/^(\s*)>\s?/, '$1') });
  }
  if (!title) {
    const h1 = blocks.findIndex((b) => b.kind === 'heading' && b.level === 1);
    const hint = opts.titleHint?.replace(/\s+/g, ' ').trim();
    const hinted = hint ? blocks.findIndex((b) => b.kind === 'para' && b.text.replace(/\s+/g, ' ').trim() === hint) : -1;
    const at = h1 >= 0 ? h1 : hinted >= 0 ? hinted
      : blocks.findIndex((b, i) => i < 3 && b.kind === 'para' && visible(b.text) <= 60 && !readMarker(unescapeLead(b.text)) && !/다\.?$/.test(b.text));
    if (at >= 0) {
      title = (blocks[at] as { text: string }).text;
      blocks.splice(at, 1);
    }
  }
  // 제목 앞에 붙은 번호 기호("1. 추진 계획") 떼기 (제목은 기호 없이)
  if (title) title = title.replace(/^#+\s*/, '').replace(/<\/?(u|b|i|strong|em)>/gi, '').trim();

  // 항목 단계
  const stack = new DepthStack();
  const sourceMarkers: string[] = [];
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'heading') {
      if (b.level <= 2 && !opts.headingsAsItems) { stack.reset(); out.push({ kind: 'heading', level: 2, text: b.text }); continue; }
      out.push({ kind: 'item', depth: stack.depthOf(`#${b.level}`), text: b.text });
      continue;
    }
    if (b.kind !== 'para') { out.push(b); continue; }
    // PDF·워드 글은 "- 가. 행사명" 처럼 목록 표시 안에 원래 기호가 든다 → 안쪽 기호로
    const wrapped = /^\s*[-*+]\s+(.*)$/.exec(b.text);
    const lead = wrapped && readMarker(unescapeLead(wrapped[1])) ? unescapeLead(wrapped[1]) : unescapeLead(b.text);
    // 붙임 줄은 항목이 아니다 (생성기가 붙임 칸으로 그린다). "붙임 1. …" 다음의 "2. …" "3. …" 은 같은 붙임의 다음 줄
    const attach = /^(?:[-*+]\s+)?붙\s*임\s*[:：]?\s*(.*)$/.exec(lead.trim());
    if (attach) { out.push({ kind: 'attach', lines: [attach[1].trim()] }); continue; }
    const last = out[out.length - 1];
    if (last?.kind === 'attach') {
      const no = /^(\d{1,2})\.\s/.exec(lead.trim());
      const prevNo = Number(/^(\d{1,2})\.\s/.exec(last.lines[last.lines.length - 1])?.[1] ?? NaN);
      if (no && Number(no[1]) === prevNo + 1) { last.lines.push(lead.trim()); continue; }
    }
    const m = readMarker(lead);
    if (!m) {
      // 글 파일·마크다운의 목록(- * + 와 들여쓰기)
      const li = /^(\s*)[-*+]\s+(.*)$/.exec(b.text);
      if (li && opts.textSource) { out.push({ kind: 'item', depth: stack.depthOf(`md@${Math.floor(li[1].length / 2)}`), text: li[2] }); continue; }
      out.push({ kind: 'para', text: b.text.trim().replace(/^\\(?=[-*+])/, '') });
      continue;
    }
    if (m.family === 'chapter') {
      if (opts.headingsAsItems) { out.push({ kind: 'item', depth: stack.depthOf('#2'), text: m.rest.trim() }); continue; }
      stack.reset();
      out.push({ kind: 'heading', level: 2, text: m.rest.trim() });
      continue;
    }
    if (m.family === 'ref') { out.push({ kind: 'ref', text: m.rest.trim() }); continue; }
    // 마크다운 원문의 "-" 목록은 들여쓰기마다 다른 단계
    const key = m.key === '-' && opts.textSource ? `-@${Math.floor((/^\s*/.exec(b.text)?.[0].length ?? 0) / 2)}` : m.key;
    const depth = stack.depthOf(key);
    if (!sourceMarkers.includes(m.key) && depth === sourceMarkers.length) sourceMarkers.push(m.key);
    out.push({ kind: 'item', depth, text: m.rest.trim() });
  }

  // 목록 중간의 짧은 서술 문단(줄을 손으로 끊은 꼬리)은 앞 항목에 잇는다 — 법정 번호가 1부터 다시 세지 않게
  const merged: Block[] = [];
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    const prev = merged[merged.length - 1];
    const nextItem = out.slice(i + 1).find((x) => x.kind !== 'para');
    if (b.kind === 'para' && prev?.kind === 'item' && nextItem?.kind === 'item' && visible(b.text) <= 40 && !/^※/.test(b.text)) {
      prev.text = `${prev.text} ${b.text}`;
      continue;
    }
    merged.push(b);
  }

  // 기안문 서식: 끝 표시는 마지막 글 줄 끝에 두 칸 띄고. 표·그림으로 끝나면 다음 줄에
  if (opts.keepEndMark && merged.length) {
    const lastB = merged[merged.length - 1];
    if (lastB.kind === 'attach') lastB.lines[lastB.lines.length - 1] += '  끝.';
    else if (lastB.kind === 'raw' || lastB.kind === 'heading') merged.push({ kind: 'para', text: '끝.' });
    else lastB.text += '  끝.';
  }

  const lines: string[] = [];
  let prevItem = false;
  for (const b of merged) {
    const isItem = b.kind === 'item';
    if (lines.length && !(isItem && prevItem)) lines.push('');
    if (b.kind === 'heading') lines.push(`## ${b.text}`);
    else if (b.kind === 'item') lines.push(`${'  '.repeat(Math.min(b.depth + (opts.depthOffset ?? 0), 7))}- ${b.text}`);
    else if (b.kind === 'ref') lines.push(`※ ${b.text}`);
    // 둘째 줄부터 앞 6칸(= "붙임  " 폭) 띄워 같은 문단 안 다음 줄로 → 생성기가 붙임으로 이어 그리고 번호가 줄을 맞춘다
    else if (b.kind === 'attach') lines.push([`붙임  ${b.lines[0]}`, ...b.lines.slice(1).map((l) => `      ${l}`)].join('\n'));
    else lines.push(b.text);
    prevItem = isItem;
  }
  const body = lines.join('\n');
  return { ...(title ? { title } : {}), ...(to ? { to } : {}), markdown: `${title ? `# ${title}\n\n` : ''}${body}\n`, sourceMarkers, hadEndMark };
}
