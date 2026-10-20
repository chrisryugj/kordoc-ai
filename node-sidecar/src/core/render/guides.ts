/** 미리보기용: 빈 누름틀의 안내 글자를 실제 글(빨간 기울임)로 넣은 사본
 *
 * 한글은 빈 누름틀의 안내문을 빨간 기울임으로 보여 주고 그 폭만큼 뒤 글을 민다. rhwp(0.8.7)는 안내문을 그리기만 하고
 * 폭을 0으로 잡아 "기안자 직위(직급) 서명   검토자 …" 줄에서 뒤 글자가 안내문 위에 겹친다. 미리보기 사본에서만 안내문을
 * 누름틀 안의 글로 넣어 rhwp 가 폭을 잡게 한다. 저장 파일·PDF·인쇄에는 쓰지 않는다(한글도 안내문은 인쇄하지 않는다).
 */

import JSZip from 'jszip';

const BEGIN = /<hp:ctrl><hp:fieldBegin [^>]*type="CLICK_HERE"[^>]*>([\s\S]*?)<\/hp:fieldBegin><\/hp:ctrl>/g;
const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescapeXml = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()] ?? m);
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** 누름틀 시작과 끝 사이가 비었는가 — 빈 글 조각·run 경계만 */
const EMPTY_BETWEEN = /^(?:<\/hp:run><hp:run charPrIDRef="\d+">|<hp:t\/>|<hp:t><\/hp:t>|\s)*<hp:ctrl><hp:fieldEnd /;

export async function showFieldGuides(bytes: Uint8Array): Promise<Uint8Array> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { return bytes; }
  const headerFile = zip.file('Contents/header.xml');
  const sections = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n));
  if (!headerFile || !sections.length) return bytes;

  let header = await headerFile.async('string');
  const charPr = new Map([...header.matchAll(/<hh:charPr id="(\d+)"[\s\S]*?<\/hh:charPr>/g)].map((m) => [m[1], m[0]]));
  let nextId = Math.max(-1, ...[...charPr.keys()].map(Number)) + 1;
  const guideId = new Map<string, string>();
  const added: string[] = [];
  const guideStyle = (id: string): string | undefined => {
    if (guideId.has(id)) return guideId.get(id);
    const src = charPr.get(id);
    if (!src) return undefined;
    const nid = String(nextId++);
    let copy = src.replace(/<hh:charPr id="\d+"/, `<hh:charPr id="${nid}"`).replace(/textColor="[^"]*"/, 'textColor="#FF0000"');
    if (!/<hh:italic\s*\/>/.test(copy)) copy = copy.replace(/(<hh:charPr [^>]*>)/, '$1<hh:italic/>');
    added.push(copy);
    guideId.set(id, nid);
    return nid;
  };

  let changed = 0;
  for (const name of sections) {
    const xml = await zip.file(name)!.async('string');
    const edits: Array<{ at: number; text: string }> = [];
    for (const m of xml.matchAll(BEGIN)) {
      const end = m.index! + m[0].length;
      if (!EMPTY_BETWEEN.test(xml.slice(end, end + 400))) continue;
      // "Clickhere:set:N:Direction:wstring:9:직위(직급) 서명 HelpState:…" — 글자 수(이스케이프를 푼 글자 기준)만큼이 안내문
      const d = /Direction:wstring:(\d+):/.exec(m[1]);
      if (!d) continue;
      const guide = escapeXml(unescapeXml(m[1].slice(d.index + d[0].length)).slice(0, Number(d[1])));
      if (!guide.trim()) continue;
      const runAt = xml.lastIndexOf('<hp:run charPrIDRef="', m.index!);
      const cp = runAt < 0 ? undefined : /^<hp:run charPrIDRef="(\d+)"/.exec(xml.slice(runAt))?.[1];
      const g = cp && guideStyle(cp);
      if (!cp || !g) continue;
      // 지금 run 을 닫고 안내문 run 을 넣은 뒤 같은 글자 모양으로 다시 연다 (뒤의 누름틀 끝·글은 그대로)
      edits.push({ at: end, text: `</hp:run><hp:run charPrIDRef="${g}"><hp:t>${guide}</hp:t></hp:run><hp:run charPrIDRef="${cp}">` });
    }
    if (!edits.length) continue;
    let out = xml;
    for (const e of edits.reverse()) out = out.slice(0, e.at) + e.text + out.slice(e.at);
    // 원본 항목 시각을 그대로: 같은 문서면 언제 만들어도 같은 바이트 (zip 은 고친 시각을 찍는다)
    zip.file(name, out, { date: zip.file(name)!.date });
    changed += edits.length;
  }
  if (!changed) return bytes;
  header = header.replace('</hh:charProperties>', `${added.join('')}</hh:charProperties>`)
    .replace(/(<hh:charProperties itemCnt=")(\d+)(")/, (_, a: string, n: string, b: string) => `${a}${Number(n) + added.length}${b}`);
  zip.file('Contents/header.xml', header, { date: headerFile.date });
  const mime = zip.file('mimetype');
  if (mime) zip.file('mimetype', await mime.async('uint8array'), { compression: 'STORE', date: mime.date });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
