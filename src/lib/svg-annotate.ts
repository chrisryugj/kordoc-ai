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

/** 라벨 문자 시퀀스를 찾아 data-kd-label 부착한 SVG 반환 */
export function annotateLabels(svg: string, labels: string[]): string {
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

  // 라벨별 매칭 — 문서 순서상 인접 + 같은 y + x 증가
  const tagged = new Map<number, string>(); // char index → label
  for (const label of labels) {
    const seq = [...label.replace(/\s/g, "")];
    if (seq.length === 0) continue;
    for (let i = 0; i < chars.length; i++) {
      if (chars[i].ch !== seq[0]) continue;
      let ok = true;
      let prev = chars[i];
      const hit = [i];
      for (let k = 1; k < seq.length; k++) {
        const next = chars[i + k];
        if (!next || next.ch !== seq[k] || Math.abs(next.y - prev.y) > 1 || next.x <= prev.x) {
          ok = false;
          break;
        }
        hit.push(i + k);
        prev = next;
      }
      if (ok) {
        for (const idx of hit) {
          if (!tagged.has(idx)) tagged.set(idx, label);
        }
        // 같은 라벨이 문서에 여러 번 나올 수 있으므로 계속 스캔
        i += seq.length - 1;
      }
    }
  }

  if (tagged.size === 0) return svg;

  // 뒤에서부터 속성 삽입 (오프셋 보존)
  let out = svg;
  const indices = [...tagged.keys()].sort((a, b) => b - a);
  for (const idx of indices) {
    const c = chars[idx];
    const label = tagged.get(idx)!;
    const replaced = `<text data-kd-label="${escapeAttr(label)}" ${c.attrs}>${c.ch}</text>`;
    out = out.slice(0, c.start) + replaced + out.slice(c.end);
  }
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
