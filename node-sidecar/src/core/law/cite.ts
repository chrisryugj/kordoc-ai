/** 글 속 법령 인용 찾기 — 「법령명」 제N조(의N)(제N항)(제N호(의N))(가목), 따옴표 없는 ○○법 제N조, 같은 법·동법·같은 영
 *
 * 인터넷 없이 돈다(폐쇄망에서도 인용 찾기는 된다).
 * 따옴표 없는 법령명은 앞 어절 경계가 불확실해 앞 어절을 하나씩 뗀 후보를 함께 둔다 → 대조 단계가 이름이 정확히 같은 후보를 고른다.
 */

/** 찾은 인용 한 건 */
export interface FoundCitation {
  /** 법령명 후보 (첫째가 기본값). 「」 안 이름·같은 법은 보통 하나, 따옴표 없는 이름은 앞 어절을 뗀 것까지 */
  names: string[];
  /** names 와 같은 순서의 원문 인용 (공백은 한 칸으로) */
  texts: string[];
  /** 제17조제1항 꼴. 없으면 법령만 인용 */
  article?: string;
  /** 조 번호·가지 번호 (제17조의2 → 17, 2) */
  jo?: number;
  branch?: number;
  /** 항 번호 (제1항 → 1) */
  paragraph?: number;
  /** 호 번호 (제2호 → "2", 제2호의3 → "2의3") */
  item?: string;
  /** 목 (가목 → "가") */
  subitem?: string;
  /** 인용이 시작하는 곳 (normalizeText 한 글 기준, 인용 문장 찾기용) */
  start: number;
  /** 다음 인용과의 경계 판정용 (원문 위치) */
  end: number;
}

/** 법령명에 쓰이는 가운뎃점 변형 — 법제처 공식은 'ㆍ'(U+318D) */
export const INTERPUNCT = /[·ㆍ‧•・]/g;

/** 비교용 이름: 띄어쓰기·가운뎃점 무시 */
export const normName = (s: string) => s.replace(/\s+/g, '').replace(INTERPUNCT, '');

const LAW_END = /(?:법률|법|령|규칙|규정|조례)$/;
/** 법령 종류를 가리키는 말이지 이름이 아니다 */
const NOT_LAW_END = /(?:훈령|대통령령|총리령|부령)$/;
/** 그 자체로는 어느 법령인지 알 수 없는 말 (이 법·위 법·관계 법령) */
const GENERIC = new Set(['법', '법률', '령', '영', '시행령', '시행규칙', '규칙', '규정', '조례', '법령', '관련법령', '관계법령', '상위법', '상위법령', '하위법령', '모법', '본법', '특별법', '기본법']);
/** 이름 앞머리가 될 수 없는 어절 (뒤쪽 후보에서만 거른다) */
const FRAGMENT_HEAD = /^(?:관한|대한|위한|관하여|대하여|위하여|따른|의한|및|등|하는|에|의)$/;
/** 법령명 앞에 붙는 접속어·지시어·조사 */
const LEAD_DROP = new Set([
  '또한', '그리고', '따라서', '따라', '의하여', '의해', '근거', '관계', '관련', '해당', '이에', '아울러', '즉', '특히', '한편',
  '또', '또는', '혹은', '및', '등', '다만', '단', '이', '그', '저', '본', '위', '각', '이와', '같이', '현행', '구', '먼저',
  '에', '의', '에서', '으로', '로', '에게', '와', '과', '은', '는', '을', '를', '이를', '이는', '이에따라',
]);

const TOKEN = /[「『]([^」』\n]{1,80})[」』]|“([^”\n]{1,80})”|제\s?(\d{1,4})\s?조(?:\s?의\s?(\d{1,3}))?(?:\s?제\s?(\d{1,3})\s?항)?(?:\s?제\s?(\d{1,3})\s?호(?:\s?의\s?(\d{1,2}))?(?:\s?([가나다라마바사아자차카타파하])\s?목)?)?/g;
const BOUNDARY = /[.,;:!?()[\]{}<>「」『』"'“”‘’|\n…]/;
const ANAPHORA = /(?:^|[^가-힣])(같은|동)\s?(법률|법|영|령|시행령|규칙|시행규칙|규정|조례)(?:\s?(시행령|시행규칙))?\s*$/;
const CONNECTOR_GAP = /^(?:\s|[,·ㆍ~∼]|및|또는|와|과|부터|까지|내지|그리고)*$/;
/** 조문 제목·약칭 정의 같은 짧은 괄호 */
const PAREN = /\([^()]{0,60}\)/g;

const isLawName = (name: string) => name.length >= 2 && LAW_END.test(name) && !NOT_LAW_END.test(name) && !GENERIC.has(name.replace(/\s+/g, ''));
const stripSub = (name: string) => name.replace(/\s*(?:시행령|시행규칙)$/, '');
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 어절이 법령명이 아니라 문장 성분인지 (은·는·을·를 조사, 서술어) — "국가를 당사자로 하는"처럼 이름 안 어절은 살린다 */
function isClauseWord(word: string, next: string | undefined): boolean {
  if (LEAD_DROP.has(word)) return true;
  if (/(?:은|는)$/.test(word) && !/(?:하는|되는|있는|없는|받는|주는|따르는)$/.test(word)) return true;
  if (/(?:을|를)$/.test(word) && !(next && /^(?:위한|위하여|당사자로|통한|대상으로)$/.test(next))) return true;
  return /(?:에게|에서는|에서|으로서|이며|이고|하고|하며|하여|하면|라고|한다|된다|있다|없다)$/.test(word);
}

/** 제N조 바로 앞 따옴표 없는 법령명 → 후보 (긴 것부터). 이름이 아니면 null */
function unquotedNames(text: string, from: number, to: number): { names: string[]; starts: number[] } | null {
  const win = text.slice(from, to);
  let cut = 0;
  for (let i = win.length - 1; i >= 0; i--) if (BOUNDARY.test(win[i])) { cut = i + 1; break; }
  const tail = win.slice(cut).replace(/\s+$/, '');
  if (!LAW_END.test(tail) || NOT_LAW_END.test(tail)) return null;
  const words: Array<{ w: string; at: number }> = [];
  for (const m of tail.matchAll(/\S+/g)) words.push({ w: m[0], at: from + cut + m.index });
  let i = 0;
  while (i < words.length - 1 && isClauseWord(words[i].w, words[i + 1]?.w)) i++;
  const names: string[] = [];
  const starts: number[] = [];
  for (let k = i; k < words.length && names.length < 4; k++) {
    const slice = words.slice(k).map((x) => x.w);
    if (slice.every((w) => GENERIC.has(w))) break;
    if (k > i && FRAGMENT_HEAD.test(slice[0])) continue;
    const name = slice.join(' ');
    if (!isLawName(name)) continue;
    names.push(name);
    starts.push(words[k].at);
  }
  return names.length ? { names, starts } : null;
}

const articleLabel = (jo: number, branch: number, hang?: number, ho?: string, mok?: string) =>
  `제${jo}조${branch ? `의${branch}` : ''}${hang ? `제${hang}항` : ''}${ho ? `제${ho.replace('의', '호의')}${ho.includes('의') ? '' : '호'}` : ''}${mok ? `${mok}목` : ''}`;

/** HTML 꼬리표는 칸으로, 가로 공백은 한 칸으로 (줄바꿈은 문장 경계라 남긴다) */
export function normalizeText(raw: string): string {
  return raw.replace(/<[^>\n]{1,200}>/g, ' ').replace(/[ \t 　]+/g, ' ');
}

interface Context {
  last?: string[];
  byKind: Partial<Record<'령' | '규칙' | '규정' | '조례', string[]>>;
}

function remember(ctx: Context, names: string[]): void {
  ctx.last = names;
  const n = names[0];
  const kind = /규칙$/.test(n) ? '규칙' : /령$/.test(n) ? '령' : /규정$/.test(n) ? '규정' : /조례$/.test(n) ? '조례' : null;
  if (kind) ctx.byKind[kind] = names;
}

/** 같은 법·동법·같은 영 → 앞 법령. 같은 영은 바로 앞이 영(시행령·○○규정)이면 그것, 아니면 앞에 나온 영, 그것도 없으면 앞 법률의 시행령 */
function resolveAnaphora(ctx: Context, kind: string, sub: string | undefined): string[] | null {
  const last = ctx.last;
  if (!last) return null;
  if (kind === '법' || kind === '법률') return last.map((n) => (sub ? `${stripSub(n)} ${sub}` : stripSub(n)));
  if (kind === '영' || kind === '령' || kind === '시행령') return /(?:령|규정)$/.test(last[0]) ? last : ctx.byKind['령'] ?? last.map((n) => `${stripSub(n)} 시행령`);
  if (kind === '규칙' || kind === '시행규칙') return /규칙$/.test(last[0]) ? last : ctx.byKind['규칙'] ?? last.map((n) => `${stripSub(n)} 시행규칙`);
  return ctx.byKind[kind as '규정' | '조례'] ?? null;
}

/** 인용 찾기 — 원문 순서, 같은 인용은 한 번만, 조문을 인용한 법령의 "법령만 인용"은 뺀다 */
export function findCitations(raw: string, max = 200): FoundCitation[] {
  const text = normalizeText(raw);
  const out: FoundCitation[] = [];
  const ctx: Context = { byKind: {} };
  /** 바로 앞 「」 법령 (조문이 붙으면 이 인용을 조문 인용으로 바꾼다) */
  let quoted: { index: number; end: number } | null = null;
  let prevEnd = 0;

  for (const m of text.matchAll(TOKEN)) {
    if (out.length >= max) break;
    const start = m.index;
    const inner = m[1] ?? m[2];
    if (inner !== undefined) {
      quoted = null;
      let name = oneLine(inner);
      let end = start + m[0].length;
      const sub = /^ ?(시행령|시행규칙)(?![가-힣])/.exec(text.slice(end));
      if (sub && !/(?:시행령|시행규칙)$/.test(name)) { name = `${name} ${sub[1]}`; end += sub[0].length; }
      if (!isLawName(name)) { prevEnd = end; continue; }
      out.push({ names: [name], texts: [oneLine(text.slice(start, end))], start, end });
      quoted = { index: out.length - 1, end };
      remember(ctx, [name]);
      prevEnd = end;
      continue;
    }

    const jo = Number(m[3]);
    const branch = m[4] ? Number(m[4]) : 0;
    const paragraph = m[5] ? Number(m[5]) : undefined;
    const item = m[6] ? (m[7] ? `${Number(m[6])}의${Number(m[7])}` : String(Number(m[6]))) : undefined;
    const subitem = item ? m[8] : undefined;
    const article = articleLabel(jo, branch, paragraph, item, subitem);
    const end = start + m[0].length;
    const cite = { article, jo, branch, ...(paragraph ? { paragraph } : {}), ...(item ? { item } : {}), ...(subitem ? { subitem } : {}), start, end };

    // 1) 「법령명」 바로 뒤(사이에 괄호 하나는 허용: (이하 "법"이라 한다)) — 법령만 인용으로 넣어 둔 것을 조문 인용으로
    if (quoted && text.slice(quoted.end, start).replace(PAREN, '').trim() === '') {
      const q = out[quoted.index];
      out[quoted.index] = { ...q, ...cite, start: q.start, texts: [oneLine(`${q.texts[0]} ${text.slice(quoted.end, end)}`)] };
      quoted = null;
      prevEnd = end;
      continue;
    }
    quoted = null;

    const from = Math.max(prevEnd, start - 60);
    const before = text.slice(from, start);
    // 2) 같은 법·동법·같은 영
    const ana = ANAPHORA.exec(before);
    if (ana) {
      const names = resolveAnaphora(ctx, ana[2], ana[3]);
      if (names) {
        const at = from + ana.index + ana[0].indexOf(ana[1]);
        const t = oneLine(text.slice(at, end));
        out.push({ names, texts: names.map(() => t), ...cite, start: at });
        remember(ctx, names);
      }
      prevEnd = end;
      continue;
    }
    // 3) 따옴표 없는 ○○법 제N조
    const un = unquotedNames(text, from, start);
    if (un) {
      out.push({ names: un.names, texts: un.starts.map((s) => oneLine(text.slice(s, end))), ...cite, start: un.starts[un.starts.length - 1] });
      remember(ctx, un.names);
      prevEnd = end;
      continue;
    }
    // 4) 제17조 및 제18조 · 제17조(제목), 제18조 — 앞 인용의 법령
    const prev = out[out.length - 1];
    if (prev?.article && prev.end === prevEnd && CONNECTOR_GAP.test(text.slice(prevEnd, start).replace(PAREN, ''))) {
      const t = oneLine(text.slice(start, end));
      out.push({ names: prev.names, texts: prev.names.map(() => t), ...cite });
    }
    prevEnd = end;
  }
  return dedupe(out);
}

function dedupe(list: FoundCitation[]): FoundCitation[] {
  const withArticle = new Set(list.filter((c) => c.article).map((c) => normName(c.names[0])));
  const seen = new Set<string>();
  return list.filter((c) => {
    const law = normName(c.names[0]);
    if (!c.article && withArticle.has(law)) return false;
    const key = `${law}|${c.article ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
