/** 받은 XML 에서 요소 조각을 글 길이에 비례한 시간으로 찾는다
 *
 * `/<태그…>[\s\S]*?<\/태그>/g` 꼴 정규식은 닫는 태그가 없는 여는 자리마다 글 끝까지 다시 훑는다(제곱 시간):
 * 마지막 닫는 태그 뒤에 여는 누름틀만 2만 개 둔 11KB HWPX 의 미리보기 안내문 넣기가 5.4초, 4만 개면 22초 동안 엔진을 멈췄다.
 * 여기서는 각 글자를 몇 번만 본다. 닫는 표시가 더 없으면 그 뒤의 여는 자리도 닫힐 수 없으니 다시 찾지 않는다.
 */

export interface XmlSpan {
  /** 여는 태그의 '<' 자리 */
  start: number;
  /** 여는 태그 머리('<' 부터 첫 '>' 까지) */
  head: string;
  /** 여는 태그와 닫는 표시 사이 (빈 요소면 '') */
  inner: string;
  /** 닫는 표시 바로 뒤 (빈 요소면 머리 바로 뒤) */
  end: number;
}

const NAME_CHAR = /[\w.:-]/;

/** open(여는 태그 앞부분 그대로, 예 '<w:style')으로 시작해 처음 나오는 close 까지의 조각들을 차례로 — `/open[^>]*>[\s\S]*?close/g` 와 같은 자리.
 *  open 이 이름 글자로 끝나면 바로 뒤가 이름 글자인 것(<w:styles)은 다른 요소라 건너뛴다. accept 가 머리를 받지 않으면 그 자리를 건너뛴다.
 *  머리가 '/>' 로 끝나면 빈 요소. 머리 안에 '<' 가 있으면(올바른 XML 에는 없다) 여는 태그로 보지 않는다 */
export function* xmlSpans(xml: string, open: string, close: string, accept?: (head: string) => boolean): Generator<XmlSpan> {
  const named = NAME_CHAR.test(open.slice(-1));
  let at = 0;
  let gt = -1;
  let closeAt = -1;
  let unclosed = false;
  for (;;) {
    const p = xml.indexOf(open, at);
    if (p < 0) return;
    const q = p + open.length;
    if (named && NAME_CHAR.test(xml[q] ?? '')) { at = q; continue; }
    // 앞서 찾은 '>' 가 아직 앞에 있으면 그대로 쓴다 (여는 자리마다 멀리 있는 '>' 를 다시 찾지 않게)
    if (gt < q) { gt = xml.indexOf('>', q); if (gt < 0) return; }
    const lt = xml.indexOf('<', q);
    if (lt >= 0 && lt < gt) { at = lt; continue; }
    const head = xml.slice(p, gt + 1);
    if (accept && !accept(head)) { at = gt + 1; continue; }
    if (xml[gt - 1] === '/') {
      yield { start: p, head, inner: '', end: gt + 1 };
      at = gt + 1;
      continue;
    }
    if (!unclosed && closeAt <= gt) closeAt = xml.indexOf(close, gt + 1);
    if (unclosed || closeAt < 0) { unclosed = true; at = gt + 1; continue; }
    yield { start: p, head, inner: xml.slice(gt + 1, closeAt), end: closeAt + close.length };
    at = closeAt + close.length;
  }
}

/** xmlSpans 로 찾은 조각마다 fn 이 돌려준 글로 바꾼다 (undefined 면 그대로) */
export function replaceSpans(xml: string, spans: Iterable<XmlSpan>, fn: (whole: string, s: XmlSpan) => string | undefined): string {
  const out: string[] = [];
  let last = 0;
  for (const s of spans) {
    const next = fn(xml.slice(s.start, s.end), s);
    if (next === undefined) continue;
    out.push(xml.slice(last, s.start), next);
    last = s.end;
  }
  if (!out.length) return xml;
  out.push(xml.slice(last));
  return out.join('');
}
