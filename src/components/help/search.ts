/** 도움말 찾기 — 대소문자를 가리지 않고(pdf 로 PDF 도) 찾아, 찾은 곳 앞뒤 한 줄을 돌려준다. 없으면 null */
export function findLine(body: string, q: string): string | null {
  const t = q.trim().toLowerCase();
  if (!t) return null;
  const i = body.toLowerCase().indexOf(t);
  if (i < 0) return null;
  return body.slice(Math.max(0, i - 30), i + t.length + 40).replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim();
}
