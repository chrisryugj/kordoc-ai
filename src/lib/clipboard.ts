/** 표를 클립보드로: 한글·워드는 HTML 표, 엑셀·메모장은 탭으로 나눈 글을 받는다 (둘 다 넣는다) */

export async function copyTable(tsv: string, html: string): Promise<void> {
  const write = navigator.clipboard?.write?.bind(navigator.clipboard);
  if (write && typeof ClipboardItem !== "undefined") {
    try {
      await write([new ClipboardItem({
        "text/plain": new Blob([tsv], { type: "text/plain" }),
        "text/html": new Blob([`<meta charset="utf-8">${html}`], { type: "text/html" }),
      })]);
      return;
    } catch {
      // HTML 을 못 받는 환경이면 글만
    }
  }
  await navigator.clipboard.writeText(tsv);
}
