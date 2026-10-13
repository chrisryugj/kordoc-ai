/** 마크다운 → 꾸밈 없는 글 ("글만" 저장·메신저용 복사)
 *
 * kordoc 은 plain 을 줘도 제목 `#`·표 `|`·이스케이프(`\~`)가 남은 마크다운을 낸다.
 * 표는 칸을 탭으로 이은 줄로(엑셀·메신저에 붙이면 칸이 갈린다), 그 밖의 표시는 걷어 낸다.
 * 의존이 없는 순수 함수라 화면(메신저용 복사)도 같은 것을 불러 쓴다.
 */

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** 줄 안 표시: 그림·링크·굵게·취소선·코드·태그·이스케이프 */
function inline(s: string, br: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, br)
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>"'=:^])/g, '$1');
}

/** GFM 표 한 줄 → 칸 (escaped `\|` 는 칸 경계가 아니다) */
function cells(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((c) => inline(c.trim(), ' ').trim());
}

const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** HTML 표(병합 칸이 있으면 kordoc 이 HTML 로 낸다) → 탭으로 이은 줄들 */
function htmlTable(html: string): string {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return rows
    .map((tr) => (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? [])
      .map((td) => inline(td.replace(/^<t[hd][^>]*>|<\/t[hd]>$/gi, ''), ' ').replace(/\s+/g, ' ').trim())
      .join('\t'))
    .join('\n');
}

export function markdownToPlain(md: string): string {
  const src = md.replace(/\r\n?/g, '\n').replace(/<table[\s\S]*?<\/table>/gi, (t) => `\n${htmlTable(t)}\n`);
  const out: string[] = [];
  let fence = false;
  for (const line of src.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) { out.push(line); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!SEPARATOR.test(line)) out.push(cells(line).join('\t'));
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push(''); continue; }
    // 들여 쓴 칸(탭으로 이은 표 줄 포함)은 들여쓰기를 살리고, 제목·인용·목록 기호만 걷는다
    const m = /^(\s*)(.*)$/.exec(line)!;
    const body = m[2]
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(>\s?)+/, '')
      .replace(/^[*+]\s+/, '- ');
    out.push(m[1] + inline(body, '\n'));
  }
  return out.join('\n').replace(/ +$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
