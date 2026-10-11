/** 한국어 BM25 — 형태소 분석기 없이 글자 2-gram 으로 (조사·어미가 붙어도 어간이 겹치면 맞는다) */

/** 한글 덩어리는 2글자씩 겹쳐 자르고(한 글자면 그대로), 영문·숫자는 낱말 그대로 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const run of text.toLowerCase().match(/[가-힣]+|[a-z0-9]+/g) ?? []) {
    if (!/^[가-힣]/.test(run) || run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

/** 각 글의 점수 (질의와 겹치는 낱말이 없으면 0) */
export function bm25Scores(texts: string[], query: string, k1 = 1.2, b = 0.75): number[] {
  const docs = texts.map((t) => {
    const tf = new Map<string, number>();
    const toks = tokenize(t);
    for (const tok of toks) tf.set(tok, (tf.get(tok) ?? 0) + 1);
    return { tf, len: toks.length };
  });
  const n = docs.length;
  const avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, n) || 1;
  const terms = [...new Set(tokenize(query))];
  const idf = new Map<string, number>();
  for (const term of terms) {
    const df = docs.reduce((c, d) => c + (d.tf.has(term) ? 1 : 0), 0);
    idf.set(term, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
  }
  return docs.map((d) => {
    let s = 0;
    for (const term of terms) {
      const f = d.tf.get(term);
      if (!f) continue;
      s += (idf.get(term) ?? 0) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
    }
    return s;
  });
}

/** 두 글이 얼마나 겹치는지 (a 의 2-gram 중 b 에 있는 비율, 0~1) */
export function overlapRatio(a: string, b: string): number {
  const ta = tokenize(a);
  if (!ta.length) return 0;
  const tb = new Set(tokenize(b));
  return ta.filter((t) => tb.has(t)).length / ta.length;
}
