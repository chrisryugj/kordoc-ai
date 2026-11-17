/**
 * HWPX 서식 유지 나누기 — 합치기(hwpx-merge)의 반대. 한컴오피스 없이 XML 수준에서 자른다.
 *
 * 자르는 곳 (mode): section = 구역(section*.xml) 경계, pagebreak = 구역 경계 + 본문 맨 위 문단의 강제 쪽 나눔(pageBreak="1", Ctrl+Enter).
 * auto(기본) = 구역이 여럿이면 구역마다(합친 문서 되돌리기), 하나면 강제 쪽 나눔마다(표지·목차·본문).
 * 줄 배치로 정해지는 "쪽마다"는 한글 문서에서 정확히 알 수 없어 자르지 않는다.
 * 조각마다: 머리(글꼴·글자·문단 모양·스타일)와 그림은 그대로 두고, 본문은 그 조각의 문단만.
 * 구역 중간에서 잘린 조각은 그 구역 첫 문단의 쪽 설정(secPr·단 설정)을 조각 첫 문단 맨 앞에 붙여 용지·여백이 같다.
 * 앞 조각에서 정해 원래 이 조각 쪽에도 찍히던 머리말·꼬리말·쪽 번호도 조각 첫 문단에 옮긴다.
 * 줄 배치 정보(linesegarray)는 빼서 한글이 열 때 다시 배치한다.
 */

import JSZip from 'jszip';
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { ensureVersionXml, readManifest, sectionHrefs } from './hwpx-merge.js';
import { blankPng } from '../redact/preview.js';

type El = Element;

const kids = (el: El): El[] => {
  const out: El[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as El);
  return out;
};
const local = (el: El) => el.localName ?? el.nodeName.replace(/^.*:/, '');

function dropLineseg(el: El) {
  for (const l of [...(el.getElementsByTagName('hp:linesegarray') as unknown as El[])]) l.parentNode?.removeChild(l);
}

/** 쪽 설정(secPr)·단 설정(colPr) 자체인 run 의 자식 */
const isSettings = (c: El) => local(c) === 'secPr' || (local(c) === 'ctrl' && kids(c).some((k) => local(k) === 'colPr'));

/** 구역 첫 문단에서 쪽 설정만 남긴 run (구역 중간에서 시작하는 조각의 첫 문단 맨 앞에 붙인다).
 *  머리말·쪽 번호·감추기는 뺀다: 머리말·쪽 번호는 조각마다 그때 살아 있는 것을 따로 넣고, 감추기는 원래 그 쪽에만 걸린다 */
function settingsRun(first: El): El | null {
  const run = kids(first).find((c) => local(c) === 'run' && c.getElementsByTagName('hp:secPr').length > 0);
  if (!run) return null;
  const copy = run.cloneNode(true) as El;
  for (const c of kids(copy)) if (!isSettings(c)) copy.removeChild(c);
  return copy;
}

/** 머리말·꼬리말(쪽 종류별)·쪽 번호 컨트롤의 열쇠. 그 밖의 컨트롤이면 null */
function pageCtrlKey(ctrl: El): string | null {
  const inner = kids(ctrl)[0];
  if (!inner) return null;
  const name = local(inner);
  if (name === 'pageNum') return 'pageNum';
  if (name === 'header' || name === 'footer') return `${name}:${inner.getAttribute('applyPageType') || 'BOTH'}`;
  return null;
}

/** 문단들에 나온 머리말·꼬리말·쪽 번호로 "지금 살아 있는 것" 표를 고친다 (한글은 앞에서 정한 것을 다음 쪽·구역에도 찍는다) */
function trackPageCtrls(paras: El[], live: Map<string, El>): void {
  for (const p of paras) {
    for (const run of kids(p)) {
      if (local(run) !== 'run') continue;
      for (const ctrl of kids(run)) {
        const key = local(ctrl) === 'ctrl' ? pageCtrlKey(ctrl) : null;
        if (!key) continue;
        // 양쪽(BOTH)은 홀·짝쪽 것을 덮는다
        if (key.endsWith(':BOTH')) for (const t of ['ODD', 'EVEN']) live.delete(key.replace('BOTH', t));
        live.delete(key);
        live.set(key, ctrl);
      }
    }
  }
}

export interface SplitHwpxResult {
  parts: Uint8Array[];
  /** 조각마다 첫 글 (파일 이름·안내용) */
  titles: string[];
  sections: number;
  pageBreaks: number;
}

const textOf = (el: El) => [...(el.getElementsByTagName('hp:t') as unknown as El[])].map((t) => t.textContent ?? '').join('').replace(/\s+/g, ' ').trim();

/** HWPX 바이트 → 구역·강제 쪽 나눔마다 나눈 HWPX 바이트들 */
export type SplitMode = 'auto' | 'section' | 'pagebreak';

export async function splitHwpx(bytes: Uint8Array, mode: SplitMode = 'auto'): Promise<SplitHwpxResult> {
  const src = await JSZip.loadAsync(bytes);
  const hpfPath = Object.keys(src.files).find((n) => /content\.hpf$/i.test(n));
  if (!hpfPath || !src.file('Contents/header.xml')) throw new Error('HWPX 구조가 아니어서 나눌 수 없습니다.');
  const manifest = readManifest(await src.file(hpfPath)!.async('string'));
  const hrefs = sectionHrefs(manifest);
  const parser = new DOMParser();
  const atBreaks = mode === 'pagebreak' || (mode === 'auto' && hrefs.length < 2);

  // 조각: [구역 경로, 그 구역의 빈 껍데기 XML, 구역 첫 문단, 문단들, 구역의 첫 조각인지]
  const pieces: Array<{ href: string; shell: string; sectionFirst: El; paras: El[]; first: boolean }> = [];
  let pageBreaks = 0;
  const serializer = new XMLSerializer();
  for (const href of hrefs) {
    const xml = await src.file(href)?.async('string');
    if (!xml) continue;
    const doc = parser.parseFromString(xml, 'text/xml');
    const tops = kids(doc.documentElement as unknown as El);
    // 구역 껍데기(뿌리와 이름공간)는 구역마다 한 번만 만든다. 조각마다 구역 전체를 다시 쓰고 읽으면 조각 수에 곱으로 느려진다
    const empty = parser.parseFromString(xml, 'text/xml');
    const emptyRoot = empty.documentElement as unknown as El;
    for (const c of kids(emptyRoot)) emptyRoot.removeChild(c);
    const shell = serializer.serializeToString(empty);
    let cur: El[] = [];
    let first = true;
    for (const [i, p] of tops.entries()) {
      if (atBreaks && i > 0 && local(p) === 'p' && p.getAttribute('pageBreak') === '1' && cur.length) {
        pieces.push({ href, shell, sectionFirst: tops[0], paras: cur, first });
        cur = [];
        first = false;
        pageBreaks++;
      }
      cur.push(p);
    }
    if (cur.length) pieces.push({ href, shell, sectionFirst: tops[0], paras: cur, first });
  }
  if (pieces.length < 2) throw new Error(atBreaks ? '나눌 곳이 없습니다. 구역이 하나이고 강제 쪽 나눔(Ctrl+Enter)도 없는 문서입니다.' : '나눌 곳이 없습니다. 구역이 하나뿐인 문서입니다. 강제 쪽 나눔마다 나누기를 고르세요.');

  // 원본 묶음은 한 번만 푼다 (조각마다 다시 풀지 않는다). 구역 밖 XML(머리·바탕쪽)의 글은 그림을 쓰는지 볼 때 쓴다
  const names = Object.keys(src.files).filter((n) => !src.files[n].dir && !hrefs.includes(n));
  const data = new Map<string, Uint8Array>();
  for (const n of names) data.set(n, await src.file(n)!.async('uint8array'));
  const header = parser.parseFromString(await src.file('Contents/header.xml')!.async('string'), 'text/xml');
  header.documentElement?.setAttribute('secCnt', '1');
  const headerXml = serializer.serializeToString(header);
  const otherTexts = await Promise.all(names.filter((n) => /\.xml$/i.test(n) && n !== 'Contents/header.xml').map((n) => src.file(n)!.async('string')));
  const hpfSource = await src.file(hpfPath)!.async('string');

  const parts: Uint8Array[] = [];
  const titles: string[] = [];
  /** 이 조각 앞에서 정해져 아직 살아 있는 머리말·꼬리말·쪽 번호 */
  const live = new Map<string, El>();
  for (const [index, piece] of pieces.entries()) {
    const zip = new JSZip();
    for (const n of names) zip.file(n, data.get(n)!);
    zip.file('Contents/header.xml', headerXml);
    const doc = parser.parseFromString(piece.shell, 'text/xml');
    const root = doc.documentElement as unknown as El;
    // 앞 조각에서 정한 머리말·쪽 번호는 원래 이 조각 쪽에도 찍혔다 → 조각 첫 문단의 쪽 설정 뒤에 옮긴다
    const inherited = [...live.values()];
    trackPageCtrls(piece.paras, live);
    const settings = piece.first ? null : settingsRun(piece.sectionFirst);
    piece.paras.forEach((p, i) => {
      const c = doc.importNode(p as never, true) as unknown as El;
      if (i === 0) {
        c.setAttribute('pageBreak', '0');
        // 쪽 설정은 조각 첫 문단에 넣는다 (따로 빈 문단을 만들면 조각 맨 위에 빈 줄이 생긴다)
        if (settings) c.insertBefore(doc.importNode(settings as never, true), c.firstChild);
        const run = kids(c).find((r) => local(r) === 'run' && r.getElementsByTagName('hp:secPr').length > 0);
        if (run && inherited.length) {
          const after = kids(run).find((k) => !isSettings(k)) ?? null;
          for (const ctrl of inherited) run.insertBefore(doc.importNode(ctrl as never, true), after);
        }
      }
      root.appendChild(c as never);
    });
    dropLineseg(root);
    titles.push(piece.paras.map(textOf).find(Boolean)?.slice(0, 40) ?? '');

    // 구역 하나만 남긴다: 이 조각의 구역을 section0 으로
    const sectionXml = serializer.serializeToString(doc);
    zip.file('Contents/section0.xml', sectionXml);
    let hpf = hpfSource;
    const keepItem = manifest.items.find((i) => i.href === piece.href);
    for (const it of manifest.items.filter((i) => hrefs.includes(i.href))) {
      const re = new RegExp(`<opf:item\\s${it.attrs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/>`);
      hpf = hpf.replace(re, it === keepItem ? `<opf:item ${it.attrs.replace(/\bhref="[^"]*"/, 'href="Contents/section0.xml"')}/>` : '');
    }
    hpf = hpf.replace(/<opf:itemref\s[^>]*idref="([^"]*)"[^>]*\/>/g, (m, id) => (manifest.items.some((i) => i.id === id && hrefs.includes(i.href)) && id !== keepItem?.id ? '' : m));

    // 그림: 이 조각(과 머리·바탕쪽)이 쓰지 않는 것은 뺀다. 두면 조각 하나만 보내도 다른 조각의 그림이 모두 딸려 가고,
    // 조각 수만큼 용량이 불어난다
    const texts = [headerXml, ...otherTexts, sectionXml];
    for (const it of manifest.items) {
      if (!/^BinData\//i.test(it.href) || !it.id || texts.some((t) => t.includes(`"${it.id}"`))) continue;
      zip.remove(it.href);
      hpf = hpf.replace(new RegExp(`<opf:item\\s${it.attrs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/>`), '');
    }
    zip.file(hpfPath, hpf);

    // 미리보기: 원본 첫 쪽의 글과 그림이 조각마다 그대로 들어 있다 → 글은 이 조각의 글로, 그림은 첫 조각만 남긴다
    // (조각은 쪽이 바뀌는 곳에서 나뉘므로 첫 쪽 그림은 첫 조각의 내용이다)
    const preview = piece.paras.map(textOf).filter(Boolean).join('\r\n').slice(0, 1000);
    for (const f of zip.file(/^Preview\/PrvText\.txt$/i)) zip.file(f.name, preview);
    if (index > 0) for (const f of zip.file(/^Preview\/PrvImage\./i)) zip.file(f.name, await blankPng(), { compression: 'STORE' });
    ensureVersionXml(zip);
    const mimetype = await zip.file('mimetype')?.async('uint8array');
    if (mimetype) zip.file('mimetype', mimetype, { compression: 'STORE' });
    parts.push(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
  }
  return { parts, titles, sections: hrefs.length, pageBreaks };
}
