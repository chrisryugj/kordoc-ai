/**
 * HWPX 서식 유지 나누기 — 합치기(hwpx-merge)의 반대. 한컴오피스 없이 XML 수준에서 자른다.
 *
 * 자르는 곳 (mode): section = 구역(section*.xml) 경계, pagebreak = 구역 경계 + 본문 맨 위 문단의 강제 쪽 나눔(pageBreak="1", Ctrl+Enter).
 * auto(기본) = 구역이 여럿이면 구역마다(합친 문서 되돌리기), 하나면 강제 쪽 나눔마다(표지·목차·본문).
 * 줄 배치로 정해지는 "쪽마다"는 한글 문서에서 정확히 알 수 없어 자르지 않는다.
 * 조각마다: 머리(글꼴·글자·문단 모양·스타일)는 그대로 두고, 본문은 그 조각의 문단만, 그림·바탕쪽·차트는 그 조각이 쓰는 것만.
 * 구역 중간에서 잘린 조각은 그 구역 첫 문단의 쪽 설정(secPr·단 설정)을 맨 앞에 붙여 용지·여백이 같다.
 * 줄 배치 정보(linesegarray)는 빼서 한글이 열 때 다시 배치한다.
 */

import JSZip from 'jszip';
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import { ensureVersionXml, readManifest, sectionHrefs } from './hwpx-merge.js';
import { blankPng } from '../redact/preview.js';
import { entryBytes, entryText } from '../files/zip-read.js';

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

/** 구역 첫 문단에서 쪽 설정만 남긴 빈 문단 (구역 중간에서 시작하는 조각의 맨 앞) */
function settingsCarrier(first: El): El | null {
  const p = first.cloneNode(true) as El;
  let keep = false;
  for (const run of kids(p).filter((c) => local(c) === 'run')) {
    const hasSec = run.getElementsByTagName('hp:secPr').length > 0;
    if (!hasSec) { p.removeChild(run); continue; }
    keep = true;
    for (const c of kids(run)) if (local(c) !== 'secPr' && local(c) !== 'ctrl') run.removeChild(c);
  }
  for (const c of kids(p)) if (local(c) !== 'run') p.removeChild(c);
  if (!keep) return null;
  p.setAttribute('pageBreak', '0');
  return p;
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

export async function splitHwpx(bytes: Uint8Array, mode: SplitMode = 'auto', signal?: AbortSignal): Promise<SplitHwpxResult> {
  const src = await JSZip.loadAsync(bytes);
  const hpfPath = Object.keys(src.files).find((n) => /content\.hpf$/i.test(n));
  if (!hpfPath || !src.file('Contents/header.xml')) throw new Error('HWPX 구조가 아니어서 나눌 수 없습니다.');
  const hpfText = (await entryText(src, hpfPath))!;
  const manifest = readManifest(hpfText);
  const hrefs = sectionHrefs(manifest);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const atBreaks = mode === 'pagebreak' || (mode === 'auto' && hrefs.length < 2);

  // 조각: [구역 경로, 그 구역 문서, 문단들, 구역의 첫 조각인지]
  const pieces: Array<{ href: string; doc: Document; paras: El[]; first: boolean }> = [];
  // 구역마다 한 번: 문단을 뺀 뿌리(속성·이름공간 선언 그대로)와 구역 첫 문단의 쪽 설정.
  // 조각마다 구역 전체를 다시 쓰고 읽은 뒤 문단을 하나씩 지우면(removeChild) 쪽 나눔 6만 개 문서(59KB)에 13분·RSS 1.9GB 였다.
  // 뿌리 바로 아래 문단 아닌 것(주석·빈칸)은 그 구역의 첫 조각에만 (조각마다 넣으면 그것이 많은 문서에서 다시 제곱)
  const shells = new Map<string, { first: string; rest: string; carrier: El | null }>();
  let pageBreaks = 0;
  for (const href of hrefs) {
    signal?.throwIfAborted();
    const xml = await entryText(src, href);
    if (!xml) continue;
    const doc = parser.parseFromString(xml, 'text/xml');
    const srcRoot = doc.documentElement as unknown as El;
    const tops = kids(srcRoot);
    let prolog = '';
    for (let n = doc.firstChild; n && n !== doc.documentElement; n = n.nextSibling) prolog += serializer.serializeToString(n);
    const bare = srcRoot.cloneNode(false);
    const withOthers = srcRoot.cloneNode(false);
    for (let n = srcRoot.firstChild; n; n = n.nextSibling) if (n.nodeType !== 1) withOthers.appendChild(n.cloneNode(true));
    shells.set(href, { first: prolog + serializer.serializeToString(withOthers), rest: prolog + serializer.serializeToString(bare), carrier: tops[0] ? settingsCarrier(tops[0]) : null });
    let cur: El[] = [];
    let first = true;
    for (const [i, p] of tops.entries()) {
      if (atBreaks && i > 0 && local(p) === 'p' && p.getAttribute('pageBreak') === '1' && cur.length) {
        pieces.push({ href, doc, paras: cur, first });
        cur = [];
        first = false;
        pageBreaks++;
      }
      cur.push(p);
    }
    if (cur.length) pieces.push({ href, doc, paras: cur, first });
  }
  if (pieces.length < 2) throw new Error(atBreaks ? '나눌 곳이 없습니다. 구역이 하나이고 강제 쪽 나눔(Ctrl+Enter)도 없는 문서입니다.' : '나눌 곳이 없습니다. 구역이 하나뿐인 문서입니다. 강제 쪽 나눔마다 나누기를 고르세요.');

  // 구역 밖 XML(머리·바탕쪽·차트·설정)은 조각마다 같다: 한 번만 풀고 그 안의 차트·그림 참조도 한 번만 찾는다
  // (조각마다 모든 XML 을 한꺼번에 풀면 조각 수 × 머리 크기만큼 푼다)
  const binItems = manifest.items.filter((it) => /^BinData\//i.test(it.href) && it.id);
  const usesBins = (t: string) => new Set(binItems.filter((it) => t.includes(`"${it.id}"`)).map((it) => it.id));
  const chartRefs = (t: string) => [...t.matchAll(/\bchartIDRef="([^"]*)"/g)].map((m) => m[1]);
  const fixed = new Map<string, { charts: string[]; bins: Set<string> }>();
  for (const name of Object.keys(src.files)) {
    if (src.files[name].dir || !/\.xml$/i.test(name) || hrefs.includes(name) || name === 'Contents/section0.xml') continue;
    signal?.throwIfAborted();
    const t = (await entryText(src, name)) ?? '';
    fixed.set(name, { charts: /^Chart\//i.test(name) ? [] : chartRefs(t), bins: usesBins(t) });
  }
  const header = parser.parseFromString((await entryText(src, 'Contents/header.xml'))!, 'text/xml');
  // 이미 구역 하나(secCnt="1")라고 적힌 머리는 원본 그대로 둔다: 조각마다 다시 쓰면 머리(87KB)를 조각 수만큼 다시 압축한다(조각 1천 개에 10초)
  let headerXml: string | null = null;
  if (header.documentElement?.getAttribute('secCnt') !== '1') {
    header.documentElement?.setAttribute('secCnt', '1');
    headerXml = serializer.serializeToString(header);
  }
  const mimetype = await entryBytes(src, 'mimetype');
  let blank: Buffer | undefined;

  const parts: Uint8Array[] = [];
  const titles: string[] = [];
  for (const [index, piece] of pieces.entries()) {
    signal?.throwIfAborted();
    const zip = await JSZip.loadAsync(bytes);
    const shell = shells.get(piece.href)!;
    const doc = parser.parseFromString(piece.first ? shell.first : shell.rest, 'text/xml');
    const root = doc.documentElement as unknown as El;
    if (!piece.first && shell.carrier) root.appendChild(doc.importNode(shell.carrier as never, true));
    for (const [i, p] of piece.paras.entries()) {
      // 문단이 아주 많은 조각(6만 개 12초)도 엔진이 다른 요청·멈춤을 받게 사이사이 숨을 돌린다
      if (i % 2000 === 1999) { await new Promise((r) => setImmediate(r)); signal?.throwIfAborted(); }
      const c = doc.importNode(p as never, true) as unknown as El;
      if (i === 0) c.setAttribute('pageBreak', '0');
      root.appendChild(c as never);
    }
    dropLineseg(root);
    titles.push(piece.paras.map(textOf).find(Boolean)?.slice(0, 40) ?? '');

    // 구역 하나만 남긴다: 이 조각의 구역을 section0 으로 (항목 id 도. 원래 id 를 두면 조각을 차례를 바꿔 다시 합칠 때 같은 id 가 둘이 된다)
    for (const href of hrefs) zip.remove(href);
    const sectionXml = serializer.serializeToString(doc);
    zip.file('Contents/section0.xml', sectionXml);
    let hpf = hpfText;
    const keepItem = manifest.items.find((i) => i.href === piece.href);
    for (const it of manifest.items.filter((i) => hrefs.includes(i.href))) {
      const re = new RegExp(`<opf:item\\s${it.attrs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/>`);
      hpf = hpf.replace(re, it === keepItem ? `<opf:item ${it.attrs.replace(/\bid="[^"]*"/, 'id="section0"').replace(/\bhref="[^"]*"/, 'href="Contents/section0.xml"')}/>` : '');
    }
    hpf = hpf.replace(/<opf:itemref\s[^>]*idref="([^"]*)"[^>]*\/>/g, (m, id) => {
      if (!manifest.items.some((i) => i.id === id && hrefs.includes(i.href))) return m;
      return id === keepItem?.id ? m.replace(/\bidref="[^"]*"/, 'idref="section0"') : '';
    });

    // 바탕쪽·차트도 이 조각 구역이 가리키는 것만 남긴다. 조각마다 원본 묶음 전체에서 시작해서, 두면 조각 하나만 보내도 다른 조각(다른 부서)의
    // 바탕쪽 글·차트 숫자가 딸려 간다. 바탕쪽을 먼저 빼야 그 바탕쪽만 쓰던 차트·그림도 뒤에서 빠진다
    const drop = (name: string) => {
      zip.remove(name);
      const it = manifest.items.find((i) => i.href === name);
      if (it) hpf = hpf.replace(new RegExp(`<opf:item\\s${it.attrs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/>`), '');
    };
    const masters = new Set([...(doc.getElementsByTagName('hp:masterPage') as unknown as El[])].map((m) => m.getAttribute('idRef')));
    for (const name of Object.keys(zip.files).filter((n) => /^Contents\/masterpage[^/]*\.xml$/i.test(n))) {
      if (!masters.has(manifest.items.find((i) => i.href === name)?.id ?? name.replace(/^.*\/|\.xml$/gi, ''))) drop(name);
    }
    const kept = () => Object.keys(zip.files).filter((n) => fixed.has(n)).map((n) => fixed.get(n)!);
    const charts = new Set([...chartRefs(sectionXml), ...kept().flatMap((f) => f.charts)]);
    for (const name of Object.keys(zip.files).filter((n) => /^Chart\/[^/]+$/i.test(n) && !charts.has(n))) drop(name);

    // 그림: 이 조각(과 머리·바탕쪽)이 쓰지 않는 것은 뺀다. 두면 조각 하나만 보내도 다른 조각의 그림이 모두 딸려 가고,
    // 조각 수만큼 용량이 불어난다
    const bins = new Set([...usesBins(sectionXml), ...kept().flatMap((f) => [...f.bins])]);
    for (const it of manifest.items) {
      if (!/^BinData\//i.test(it.href) || !it.id || bins.has(it.id)) continue;
      zip.remove(it.href);
      hpf = hpf.replace(new RegExp(`<opf:item\\s${it.attrs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/>`), '');
    }
    zip.file(hpfPath, hpf);

    // 미리보기: 원본 첫 쪽의 글과 그림이 조각마다 그대로 들어 있다 → 글은 이 조각의 글로, 그림은 첫 조각만 남긴다
    // (조각은 쪽이 바뀌는 곳에서 나뉘므로 첫 쪽 그림은 첫 조각의 내용이다)
    const preview = piece.paras.map(textOf).filter(Boolean).join('\r\n').slice(0, 1000);
    for (const f of zip.file(/^Preview\/PrvText\.txt$/i)) zip.file(f.name, preview);
    if (index > 0) for (const f of zip.file(/^Preview\/PrvImage\./i)) zip.file(f.name, blank ??= await blankPng(), { compression: 'STORE' });
    if (headerXml !== null) zip.file('Contents/header.xml', headerXml);
    ensureVersionXml(zip);
    if (mimetype) zip.file('mimetype', mimetype, { compression: 'STORE' });
    parts.push(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
  }
  return { parts, titles, sections: hrefs.length, pageBreaks };
}
