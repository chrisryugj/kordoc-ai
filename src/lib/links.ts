/** 문서 속 링크 살피기 — 누르기 전에 실제로 갈 곳을 보이고, 보이는 글과 갈 곳이 다르면 묻는다 (MarkdownViewer) */

/** 앱이 밖으로 여는 링크인가 (기본 브라우저·메일 프로그램: http·https·mailto 만) */
export const isExternalHref = (href: string | undefined): href is string => !!href && /^(https?:|mailto:)/i.test(href);

/** 보이지 않는 글자 (폭 없는 글자·글 방향 바꾸기: 주소를 다른 주소처럼 보이게 꾸미는 데 쓴다) */
const HIDDEN = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
const HIDDEN_ALL = new RegExp(HIDDEN.source, "g");

/** 견줄 꼴: 앞의 http(s)://·mailto:·www. 와 끝의 / 를 떼고 소문자로 */
const bare = (s: string) => s.trim().replace(/^(https?:\/\/|mailto:)/i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();

const urlOf = (href: string): URL | null => {
  try {
    return new URL(href);
  } catch {
    return null;
  }
};

/** 실제로 갈 호스트 (www. 는 뗀다). 메일 주소·못 읽는 주소는 "" */
export function hrefHost(href: string): string {
  return (urlOf(href)?.hostname ?? "").toLowerCase().replace(/^www\./, "");
}

/** 호스트 앞에 붙인 사용자 이름 (https://보이는곳@실제곳: 앞쪽을 갈 곳처럼 보이게 꾸민 주소). 없으면 "" */
function userPart(href: string): string {
  const u = urlOf(href);
  const raw = u ? u.username || u.password : "";
  if (!raw) return "";
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    // 못 푸는 %꼴은 그대로
  }
  return s.toLowerCase().replace(/^www\./, "").replace(HIDDEN_ALL, (c) => encodeURIComponent(c));
}

/** 확인 창·말풍선에 보일 주소: 호스트는 퓨니코드 그대로(닮은 글자로 꾸민 주소가 드러나게), 경로의 한글은 읽히게, 보이지 않는 글자는 %꼴로 */
export function displayHref(href: string): string {
  let s = href;
  try {
    s = decodeURI(urlOf(href)?.href ?? href);
  } catch {
    // 못 읽는 주소는 받은 그대로
  }
  return s.replace(HIDDEN_ALL, (c) => encodeURIComponent(c));
}

/** 링크 글이 곧 그 주소인가 (http(s)://·www.·끝 / 차이는 같게 본다) — 그러면 누르는 사람이 이미 갈 곳을 보고 있다.
 *  다른 나라 글자 호스트(퓨니코드)·보이지 않는 글자·호스트 앞 사용자 이름(@)이 든 주소는 늘 아니다 (보이는 글과 갈 곳이 달라 보일 수 있어 확인 창에서 실제 주소를 보인다) */
export function showsOwnHref(text: string, href: string): boolean {
  if (/(^|\.)xn--/.test(hrefHost(href)) || HIDDEN.test(href) || HIDDEN.test(text) || userPart(href)) return false;
  const t = bare(text);
  return !!t && (t === bare(href) || t === bare(displayHref(href)));
}

/** 링크 글에 적힌 호스트 (글이 주소 꼴일 때만, www. 는 뗀다). 아니면 "" */
function textHost(text: string): string {
  const m = /^\s*(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?\s*$/i.exec(text);
  return m ? m[1].toLowerCase().replace(/^www\./, "") : "";
}

/** 링크 글이 주소처럼 보이는데 실제로는 다른 호스트로 간다 (보이는 주소로 속이는 링크) — 그 두 호스트. 아니면 null.
 *  주소 자체가 호스트 앞에 사용자 이름을 붙여 꾸민 것이면 글과 상관없이 그 앞쪽을 보이는 곳으로 본다 */
export function linkMismatch(text: string, href: string): { shown: string; real: string } | null {
  const shown = textHost(text) || userPart(href);
  const real = hrefHost(href);
  return shown && real && shown !== real ? { shown, real } : null;
}
