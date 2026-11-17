/** 대조표·바뀐 곳 목록의 낱말 단위 차이 */

type Segs = { old: Array<[string, boolean]>; next: Array<[string, boolean]> };
const DIFF_BUDGET = 60000;
const blank = (t: string) => /^\s+$/.test(t);

/** 두 목록의 LCS 짝 (같은 것끼리 [i, j]) — 앞뒤 같은 것은 바로 짝짓고 가운데만 견준다. 가운데 곱이 한도를 넘으면 null */
function lcsPairs(x0: string[], y0: string[]): Array<[number, number]> | null {
  let head = 0;
  while (head < x0.length && head < y0.length && x0[head] === y0[head]) head++;
  let tail = 0;
  while (tail < x0.length - head && tail < y0.length - head && x0[x0.length - 1 - tail] === y0[y0.length - 1 - tail]) tail++;
  const x = x0.slice(head, x0.length - tail);
  const y = y0.slice(head, y0.length - tail);
  if (x.length * y.length > DIFF_BUDGET) return null;
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: Array<[number, number]> = Array.from({ length: head }, (_, k) => [k, k]);
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { pairs.push([head + i, head + j]); i++; j++; }
    else if (dp[i][j + 1] >= dp[i + 1][j]) j++;
    else i++;
  }
  for (let k = tail; k > 0; k--) pairs.push([x0.length - k, y0.length - k]);
  return pairs;
}

/** 어절 단위 차이 */
function tokenDiff(a: string, b: string): Segs | null {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  const pairs = lcsPairs(x, y);
  if (!pairs) return null;
  const old: Segs["old"] = [];
  const next: Segs["next"] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [x.length, y.length] as [number, number]]) {
    for (; j < pj; j++) next.push([y[j], !blank(y[j])]);
    for (; i < pi; i++) old.push([x[i], !blank(x[i])]);
    if (pi < x.length) { old.push([x[pi], false]); next.push([y[pj], false]); i++; j++; }
  }
  return { old, next };
}

/** 낱말 단위 차이 — 여러 줄 글(표는 행마다 한 줄)이 길면 줄을 먼저 맞추고 짝지은 줄 안에서만 어절을 견준다.
 *  그래도 너무 길면 null (강조 없이 보인다) */
export function wordDiff(a: string, b: string): Segs | null {
  const whole = tokenDiff(a, b);
  if (whole || (!a.includes("\n") && !b.includes("\n"))) return whole;
  const x = a.split("\n");
  const y = b.split("\n");
  const pairs = lcsPairs(x, y);
  if (!pairs) return null;
  const out: Segs = { old: [], next: [] };
  const nl = (side: "old" | "next", k: number, len: number) => { if (k < len - 1) out[side].push(["\n", false]); };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [x.length, y.length] as [number, number]]) {
    // 같은 줄 사이의 다른 줄들: 차례대로 짝지어 줄 안에서 견주고, 남는 줄은 통째로 바뀜
    while (i < pi || j < pj) {
      if (i < pi && j < pj) {
        const d = tokenDiff(x[i], y[j]) ?? { old: [[x[i], true]], next: [[y[j], true]] };
        out.old.push(...d.old); out.next.push(...d.next);
        nl("old", i++, x.length); nl("next", j++, y.length);
      } else if (i < pi) { out.old.push([x[i], !!x[i].trim()]); nl("old", i++, x.length); }
      else { out.next.push([y[j], !!y[j].trim()]); nl("next", j++, y.length); }
    }
    if (pi < x.length) {
      out.old.push([x[pi], false]); out.next.push([y[pj], false]);
      nl("old", i++, x.length); nl("next", j++, y.length);
    }
  }
  return out;
}
