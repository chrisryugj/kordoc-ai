/** 연 문서의 글(convert txt, 저장 없이)을 한 번만 뽑아 나눠 쓴다: 정보 탭 글자 수 · 받은 공문 알아보기 */

import { useEffect, useState } from "react";
import type { OpenDoc } from "../../state/app";
import type { DocInfo } from "../../lib/contract";
import { rpc } from "../../lib/rpc";

const cache = new Map<string, Promise<string>>();

/** 같은 파일·같은 쪽 범위면 같은 약속을 돌려준다 (파일이 바뀌면 크기·고친 날이 달라져 새로 뽑는다) */
export function docText(doc: OpenDoc, info: DocInfo, pages?: string): Promise<string> {
  const key = [doc.path, info.size, info.modified ?? "", pages ?? ""].join("|");
  let p = cache.get(key);
  if (!p) {
    p = rpc("convert", { path: doc.path, format: "txt", save: false, ...(pages ? { pages } : {}), ...(doc.password ? { password: doc.password } : {}) })
      .then((r) => r.content);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** 받은 공문처럼 생겼나: 수신 줄 + 시행 줄, 또는 제목 줄 + "끝." 아래 발신명의(…장·…지사).
 *  엔진 없이 글만 보고 정한다. 내가 쓴 기안문도 걸릴 수 있어 회신 단추를 앞에 내는 데만 쓴다 */
export function looksReceived(text: string): boolean {
  const t = text.replace(/\r/g, "");
  const susin = /(^|\n)[ \t]*수[ \t]*신[ \t]*[:\s]\s*\S/.test(t);
  const sihaeng = /(^|\n)[ \t]*시[ \t]*행[ \t]+[^\n]*\S+-\d+/.test(t);
  const title = /(^|\n)[ \t]*제[ \t]*목[ \t]*[:\s]\s*\S/.test(t);
  const sender = /끝\.[ \t]*\n(?:[ \t]*\n)*[ \t]*\S[^\n]{0,30}(장|지사|청장|군수|교육감|총장)[ \t]*(\n|$)/.test(t);
  return (susin && sihaeng) || (title && sender);
}

/** 공문 본문은 앞 몇 쪽에 다 있다 (붙임이 긴 공문도 앞 3쪽이면 시행 줄까지 들어온다) */
const HEAD_PAGES = 3;

export function useLooksReceived(doc: OpenDoc | null): boolean {
  const info = doc?.info;
  const [hit, setHit] = useState<{ key: string; yes: boolean } | null>(null);
  const key = doc && info ? `${doc.path}|${info.size}|${info.modified ?? ""}` : "";
  // 그림·스캔은 글자 읽기(OCR)를 돌려야 해서, 암호 문서는 엔진이 다 못 읽어서 묻지 않는다
  const skip = !doc || !info || info.encrypted || info.needs_ocr || info.format === "image" || info.format === "unknown" || (!info.page_count && info.size > 2 * 1024 * 1024);
  useEffect(() => {
    if (skip || !doc || !info) return;
    let alive = true;
    const pages = info.page_count && info.page_count > HEAD_PAGES ? `1-${HEAD_PAGES}` : undefined;
    docText(doc, info, pages)
      .then((t) => { if (alive) setHit({ key, yes: looksReceived(t) }); })
      .catch(() => { if (alive) setHit({ key, yes: false }); });
    return () => { alive = false; };
    // 문서(파일 상태)마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, skip]);
  return !skip && hit?.key === key && hit.yes;
}
