/**
 * rhwp SVG 라벨 어노테이션 — 필드 포커스 ↔ 미리보기 하이라이트/역방향 점프용.
 *
 * rhwp SVG는 글자 단위 <text x y>ch</text> 배치라 라벨 문자열이 연속 텍스트로
 * 존재하지 않는다. 같은 y(±1px)에서 x 오름차순으로 라벨 문자 시퀀스를 찾아
 * 해당 <text> 요소들에 data-kd-label 속성을 부착한다.
 */

const TEXT_RE = /<text ([^>]*?)>([^<])<\/text>/g;
const X_RE = /x="([\d.]+)"/;
const Y_RE = /y="([\d.]+)"/;

interface CharEl {
  /** 원본 SVG 문자열 내 시작/끝 오프셋 */
  start: number;
  end: number;
  attrs: string;
  ch: string;
  x: number;
  y: number;
}

function collectChars(svg: string): CharEl[] {
  const chars: CharEl[] = [];
  TEXT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEXT_RE.exec(svg)) !== null) {
    const x = X_RE.exec(m[1]);
    const y = Y_RE.exec(m[1]);
    if (!x || !y) continue;
    chars.push({
      start: m.index,
      end: TEXT_RE.lastIndex,
      attrs: m[1],
      ch: m[2],
      x: parseFloat(x[1]),
      y: parseFloat(y[1]),
    });
  }
  return chars;
}

/** 태그된 문자에 속성을 삽입한 SVG 반환 (뒤에서부터 치환해 오프셋 보존) */
function injectAttrs(svg: string, chars: CharEl[], tagged: Map<number, string>): string {
  if (tagged.size === 0) return svg;
  let out = svg;
  const indices = [...tagged.keys()].sort((a, b) => b - a);
  for (const idx of indices) {
    const c = chars[idx];
    out = out.slice(0, c.start) + `<text ${tagged.get(idx)!} ${c.attrs}>${c.ch}</text>` + out.slice(c.end);
  }
  return out;
}

/**
 * 한 페이지 SVG에 해당 라벨 문자 시퀀스가 존재하는지 검사.
 * 채우기 필드 포커스 시 라벨이 어느 페이지에 있는지 찾아 자동 전환하는 데 쓴다.
 * (라벨 매칭 규칙: 문서 순서상 인접 + 같은 y(±1px) + x 증가)
 */
export function svgHasLabel(svg: string, label: string): boolean {
  const seq = [...label.replace(/\s/g, "")];
  if (seq.length === 0) return false;
  const chars = collectChars(svg);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].ch !== seq[0]) continue;
    let ok = true;
    let prev = chars[i];
    for (let k = 1; k < seq.length; k++) {
      const next = chars[i + k];
      if (!next || next.ch !== seq[k] || Math.abs(next.y - prev.y) > 1 || next.x <= prev.x) {
        ok = false;
        break;
      }
      prev = next;
    }
    if (ok) return true;
  }
  return false;
}

// ── 블록 단위 어노테이션 (Phase C 클릭-편집) ──

/** 편집 가능 단위 — 문단/헤딩 블록 또는 표 셀 */
export interface BlockAnnotation {
  /** session.blocks 기준 블록 인덱스 */
  block: number;
  /** 표 셀이면 격자 좌표 */
  cell?: { row: number; col: number };
  /** 매칭할 평문 텍스트 */
  text: string;
  /** capability 잠금 여부 — data-kd-locked로 부착 */
  locked: boolean;
}

/**
 * 블록/셀 텍스트 시퀀스를 찾아 data-kd-block(-cell/-locked) 부착.
 *
 * 라벨 매칭과 달리 여러 줄 문단을 허용한다: 다음 문자는 같은 줄(y±1, x 증가)
 * 또는 다음 줄(y 증가)에 올 수 있다. 같은 텍스트가 여러 블록에 있으면
 * 문서 순서대로 첫 미점유 시퀀스를 소비한다 (블록 인덱스 순 처리).
 * 긴 텍스트부터 처리해 짧은 항목이 긴 블록의 접두를 가로채는 것을 막는다.
 */
export function annotateBlocks(svg: string, items: BlockAnnotation[]): string {
  const chars = collectChars(svg);
  const tagged = new Map<number, string>();
  const taken = new Set<number>();

  const sorted = [...items].sort((a, b) =>
    b.text.replace(/\s/g, "").length - a.text.replace(/\s/g, "").length || a.block - b.block);

  for (const item of sorted) {
    const seq = [...item.text.replace(/\s/g, "")];
    if (seq.length === 0) continue;
    const attr = `data-kd-block="${item.block}"`
      + (item.cell ? ` data-kd-cell="${item.cell.row},${item.cell.col}"` : "")
      + (item.locked ? ` data-kd-locked="1"` : "");

    for (let i = 0; i < chars.length; i++) {
      if (taken.has(i) || chars[i].ch !== seq[0]) continue;
      let ok = true;
      let prev = chars[i];
      const hit = [i];
      for (let k = 1; k < seq.length; k++) {
        const next = chars[i + k];
        const sameLine = next && Math.abs(next.y - prev.y) <= 1 && next.x > prev.x;
        const nextLine = next && next.y > prev.y + 1;
        if (!next || taken.has(i + k) || next.ch !== seq[k] || (!sameLine && !nextLine)) {
          ok = false;
          break;
        }
        hit.push(i + k);
        prev = next;
      }
      if (ok) {
        for (const idx of hit) {
          taken.add(idx);
          tagged.set(idx, attr);
        }
        break; // 항목당 한 시퀀스만 — 같은 텍스트의 다음 블록이 다음 occurrence를 소비
      }
    }
  }

  return injectAttrs(svg, chars, tagged);
}
