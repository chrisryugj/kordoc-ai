/**
 * 브라우저 미리보기용 가짜 쪽 그림 — 글 블록을 A4(595×842pt) SVG 로 대충 조판한다.
 * 실제 앱에서는 쓰지 않는다 (mock-sidecar 가 render_pages·generate_hwpx 미리보기로만 쓴다).
 */

export interface PageBlock {
  kind: "title" | "h" | "p" | "li" | "table" | "meta" | "gap";
  text?: string;
  rows?: string[][];
}

const W = 595;
const H = 842;
const LEFT = 64;
const RIGHT = W - 64;
const TOP = 72;
const BOTTOM = H - 74;
const FONT = "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function charW(ch: string, size: number): number {
  return /[ㄱ-힝]/.test(ch) ? size * 0.96 : /\s/.test(ch) ? size * 0.3 : size * 0.56;
}

function wrap(text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  let w = 0;
  for (const word of text.split(/(\s+)/)) {
    const ww = [...word].reduce((a, c) => a + charW(c, size), 0);
    if (w + ww > width && cur.trim()) {
      lines.push(cur.trimEnd());
      cur = word.trimStart();
      w = [...cur].reduce((a, c) => a + charW(c, size), 0);
    } else {
      cur += word;
      w += ww;
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.length ? lines : [""];
}

/** 블록 → 쪽별 SVG 조각 */
export function layoutPages(blocks: PageBlock[]): string[][] {
  const pages: string[][] = [[]];
  let y = TOP;
  const page = () => pages[pages.length - 1];
  const need = (h: number) => {
    if (y + h > BOTTOM) {
      pages.push([]);
      y = TOP;
    }
  };

  for (const b of blocks) {
    if (b.kind === "gap") { y += 10; continue; }
    if (b.kind === "title") {
      need(52);
      page().push(`<text x="${W / 2}" y="${y + 20}" font-size="19" font-weight="700" text-anchor="middle">${esc(b.text ?? "")}</text>`);
      page().push(`<line x1="${LEFT}" y1="${y + 36}" x2="${RIGHT}" y2="${y + 36}" stroke="#222" stroke-width="1.2"/>`);
      page().push(`<line x1="${LEFT}" y1="${y + 39}" x2="${RIGHT}" y2="${y + 39}" stroke="#222" stroke-width="0.5"/>`);
      y += 58;
      continue;
    }
    if (b.kind === "meta") {
      need(18);
      page().push(`<text x="${RIGHT}" y="${y + 11}" font-size="10" text-anchor="end" fill="#555">${esc(b.text ?? "")}</text>`);
      y += 20;
      continue;
    }
    if (b.kind === "table" && b.rows) {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const cw = (RIGHT - LEFT) / cols;
      for (let r = 0; r < b.rows.length; r++) {
        need(22);
        const head = r === 0;
        page().push(`<rect x="${LEFT}" y="${y}" width="${RIGHT - LEFT}" height="22" fill="${head ? "#EEF0EC" : "none"}" stroke="#555" stroke-width="0.6"/>`);
        for (let c = 0; c < cols; c++) {
          if (c > 0) page().push(`<line x1="${LEFT + c * cw}" y1="${y}" x2="${LEFT + c * cw}" y2="${y + 22}" stroke="#555" stroke-width="0.6"/>`);
          const cell = wrap(b.rows[r][c] ?? "", 9.5, cw - 8)[0];
          page().push(`<text x="${LEFT + c * cw + cw / 2}" y="${y + 14.5}" font-size="9.5" text-anchor="middle" font-weight="${head ? 700 : 400}">${esc(cell)}</text>`);
        }
        y += 22;
      }
      y += 10;
      continue;
    }
    const size = b.kind === "h" ? 12.5 : 11;
    const indent = b.kind === "li" ? 16 : b.kind === "h" ? 0 : 8;
    const lh = b.kind === "h" ? 22 : 18.5;
    const lines = wrap(b.text ?? "", size, RIGHT - LEFT - indent);
    if (b.kind === "h") y += 6;
    for (const line of lines) {
      need(lh);
      page().push(`<text x="${LEFT + indent}" y="${y + size + 2}" font-size="${size}" font-weight="${b.kind === "h" ? 700 : 400}">${esc(line)}</text>`);
      y += lh;
    }
  }
  return pages;
}

export function pageDataUrl(body: string[], page: number, total: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + `<rect width="${W}" height="${H}" fill="#fff"/>`
    + `<g font-family="${FONT}" fill="#1b1b1b">${body.join("")}</g>`
    + `<text x="${W / 2}" y="${H - 40}" font-size="9.5" text-anchor="middle" fill="#666" font-family="${FONT}">${page} / ${total}</text>`
    + `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 마크다운 비슷한 글 → 블록 (작성실 실시간 미리보기 흉내) */
export function markdownBlocks(md: string): PageBlock[] {
  const out: PageBlock[] = [];
  let titled = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { out.push({ kind: "gap" }); continue; }
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      const last = out[out.length - 1];
      if (last?.kind === "table") last.rows!.push(cells);
      else out.push({ kind: "table", rows: [cells] });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (h[1].length === 1 && !titled) { out.push({ kind: "title", text: h[2] }); titled = true; }
      else out.push({ kind: "h", text: h[2] });
      continue;
    }
    if (/^[-*]\s+/.test(line)) { out.push({ kind: "li", text: `○ ${line.replace(/^[-*]\s+/, "")}` }); continue; }
    out.push({ kind: /^([가-하]|\d+|[①-⑳])[.)]\s/.test(line) ? "li" : "p", text: line });
  }
  return out;
}
