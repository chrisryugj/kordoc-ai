/**
 * HWPX 서식 유지 수합 — 한컴오피스 없이 XML 수준에서 문서를 이어 붙인다 (부서별 제출 자료 한 파일로 합치기)
 *
 * 첫 문서를 바탕으로, 뒤 문서마다
 *   1) 머리(header.xml)의 목록(글꼴·테두리·글자 모양·탭·번호·글머리·문단 모양·스타일·메모)을 바탕 뒤에 붙이며 ID 를 새로 매기고
 *      (같은 이름의 글꼴·스타일은 바탕 것을 그대로 쓴다)
 *   2) 본문 구역(section*.xml)의 참조 ID 를 새 ID 로 바꿔 새 구역으로 붙이고 (구역이라 쪽 설정이 그대로, 새 쪽에서 시작)
 *   3) 그림(BinData)·차트(Chart)·바탕쪽(masterpage)을 이름을 바꿔 옮기고, 메모 답글 관계(memoExtended)를 이어 붙인다.
 * HWP(5.x) 는 rhwp 로 HWPX 로 바꿔서 섞어 합칠 수 있다.
 */

import JSZip from 'jszip';
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import { VERSION } from 'kordoc';

/** OWPML 필수 항목 version.xml 이 없으면 넣는다. 예전 판으로 만든 문서에는 이 항목이 없어, 그런 문서를 합치거나 나눈 결과를
 *  엄격한 판독기가 거부한다. 내용은 엔진이 새 문서에 쓰는 것과 같다 */
/** HWPX 바이트에 version.xml 이 없으면 넣은 바이트를, 있으면(또는 HWPX 묶음이 아니면) 받은 그대로 돌려준다.
 *  엔진이 낸 사본(고친 글 반영·도장·양식 채우기·가리기)의 끝에서 부른다 */
export async function withVersionXml<T extends Uint8Array>(bytes: T): Promise<T | Uint8Array> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { return bytes; }
  if (zip.file('version.xml') || !zip.file('mimetype') || !zip.file('Contents/header.xml')) return bytes;
  ensureVersionXml(zip);
  // HWPX 규칙: mimetype 은 맨 앞·압축 없음
  zip.file('mimetype', await zip.file('mimetype')!.async('uint8array'), { compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export function ensureVersionXml(zip: JSZip): void {
  if (zip.file('version.xml')) return;
  zip.file('version.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="kordoc" appVersion="${VERSION}"/>`);
}

type El = Element;
type IdMap = Map<string, string>;

const LANG_ATTR: Record<string, string> = { HANGUL: 'hangul', LATIN: 'latin', HANJA: 'hanja', JAPANESE: 'japanese', OTHER: 'other', SYMBOL: 'symbol', USER: 'user' };

/** 머리 목록 이름 → 항목 태그 (순서 = 한컴 머리 순서) */
const LISTS: Array<[string, string]> = [
  ['borderFills', 'borderFill'],
  ['charProperties', 'charPr'],
  ['tabProperties', 'tabPr'],
  ['numberings', 'numbering'],
  ['bullets', 'bullet'],
  ['paraProperties', 'paraPr'],
  ['styles', 'style'],
  ['memoProperties', 'memoPr'],
];

const kids = (el: El, local: string): El[] => {
  const out: El[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (n as El).localName === local) out.push(n as El);
  return out;
};
const first = (el: El, local: string): El | undefined => kids(el, local)[0];

function refList(doc: Document): El {
  const head = doc.documentElement;
  const rl = head ? first(head, 'refList') : undefined;
  if (!rl) throw new Error('HWPX 머리(refList)가 없습니다');
  return rl;
}

/** 바탕 문서에 목록이 없으면 만든다 (뒤 문서에만 있는 번호·글머리·메모) */
function ensureList(doc: Document, name: string): El {
  const rl = refList(doc);
  const found = first(rl, name);
  if (found) return found;
  const el = doc.createElementNS(rl.namespaceURI, `${rl.prefix ? `${rl.prefix}:` : ''}${name}`);
  el.setAttribute('itemCnt', '0');
  rl.appendChild(el);
  return el;
}

/** id 가 1부터인 목록의 항목 (0 은 "쓰지 않음") */
const ONE_BASED = new Set(['numbering', 'bullet', 'borderFill']);
const maxId = (items: El[]) => items.reduce((m, it) => Math.max(m, Number(it.getAttribute('id') ?? -1)), -1);

function setAttrIf(el: El, attr: string, map: IdMap): void {
  const v = el.getAttribute(attr);
  if (v != null && map.has(v)) el.setAttribute(attr, map.get(v)!);
}

/** el 과 모든 자손의 attr 값을 map 으로 바꾼다 */
function remapDeep(el: El, attr: string, map: IdMap): void {
  setAttrIf(el, attr, map);
  const all = el.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) setAttrIf(all[i] as El, attr, map);
}

interface Maps {
  font: Record<string, IdMap>;
  list: Record<string, IdMap>;
  bin: IdMap;
  /** 차트 부품 경로 (chartIDRef 는 묶음 안 경로다) */
  chart?: IdMap;
  /** 바탕쪽 id (구역 secPr 의 <hp:masterPage idRef>) */
  master?: IdMap;
}

/** 뒤 문서 머리를 바탕 머리에 붙이고 ID 대응표를 돌려준다 */
function mergeHeader(base: Document, add: Document, bin: IdMap): Maps {
  const maps: Maps = { font: {}, list: {}, bin };

  // 글꼴: 언어 묶음별, 같은 이름은 바탕 것으로
  const baseFaces = first(refList(base), 'fontfaces');
  const addFaces = first(refList(add), 'fontfaces');
  if (baseFaces && addFaces) {
    for (const af of kids(addFaces, 'fontface')) {
      const lang = af.getAttribute('lang') ?? '';
      const bf = kids(baseFaces, 'fontface').find((f) => f.getAttribute('lang') === lang);
      const map: IdMap = new Map();
      maps.font[lang] = map;
      if (!bf) continue;
      const baseFonts = kids(bf, 'font');
      let next = maxId(baseFonts) + 1;
      for (const font of kids(af, 'font')) {
        const id = font.getAttribute('id') ?? '';
        const same = baseFonts.find((b) => b.getAttribute('face') === font.getAttribute('face'));
        if (same) {
          map.set(id, same.getAttribute('id') ?? '0');
          continue;
        }
        const clone = base.importNode(font, true) as El;
        clone.setAttribute('id', String(next));
        map.set(id, String(next++));
        bf.appendChild(clone);
      }
      bf.setAttribute('fontCnt', String(kids(bf, 'font').length));
    }
  }

  // 나머지 목록: 새 ID 를 매긴 복제본을 붙이되, 안쪽 참조는 이미 매긴 대응표로 바꾼다 (목록 순서가 의존 순서)
  for (const [listName, item] of LISTS) {
    const addList = first(refList(add), listName);
    const map: IdMap = new Map();
    maps.list[item] = map;
    if (!addList) continue;
    const baseList = ensureList(base, listName);
    const baseItems = kids(baseList, item);
    // 번호·글머리표·테두리의 id 는 1부터다(0 은 "없음"). 바탕에 그 목록이 비어 있을 때 0 을 주면 뒤 문서의 문단 번호·글머리표가 사라진다
    let next = Math.max(maxId(baseItems) + 1, ONE_BASED.has(item) ? 1 : 0);
    const pendingStyles: El[] = [];
    for (const it of kids(addList, item)) {
      const id = it.getAttribute('id') ?? '';
      if (item === 'style') {
        const same = baseItems.find((b) => b.getAttribute('name') === it.getAttribute('name') && b.getAttribute('type') === it.getAttribute('type'));
        if (same) {
          map.set(id, same.getAttribute('id') ?? '0');
          continue;
        }
      }
      const clone = base.importNode(it, true) as El;
      clone.setAttribute('id', String(next));
      map.set(id, String(next++));
      switch (item) {
        case 'borderFill':
          remapDeep(clone, 'binaryItemIDRef', bin);
          break;
        case 'charPr': {
          remapDeep(clone, 'borderFillIDRef', maps.list.borderFill);
          for (const fr of kids(clone, 'fontRef')) {
            for (const [lang, attr] of Object.entries(LANG_ATTR)) if (maps.font[lang]) setAttrIf(fr, attr, maps.font[lang]);
          }
          break;
        }
        case 'paraPr': {
          setAttrIf(clone, 'tabPrIDRef', maps.list.tabPr);
          remapDeep(clone, 'borderFillIDRef', maps.list.borderFill);
          const hs = clone.getElementsByTagName('*');
          for (let i = 0; i < hs.length; i++) {
            const h = hs[i] as El;
            if (h.localName !== 'heading') continue;
            const type = h.getAttribute('type');
            if (type === 'BULLET') setAttrIf(h, 'idRef', maps.list.bullet);
            else if (type === 'NUMBER' || type === 'OUTLINE') setAttrIf(h, 'idRef', maps.list.numbering);
          }
          break;
        }
        case 'style':
          setAttrIf(clone, 'paraPrIDRef', maps.list.paraPr);
          setAttrIf(clone, 'charPrIDRef', maps.list.charPr);
          pendingStyles.push(clone);
          break;
        default:
          break;
      }
      baseList.appendChild(clone);
    }
    for (const st of pendingStyles) setAttrIf(st, 'nextStyleIDRef', map);
    baseList.setAttribute('itemCnt', String(kids(baseList, item).length));
  }
  return maps;
}

/** 구역 XML 의 머리 참조를 새 ID 로 (문자열 치환 — 속성 이름이 고유하다) */
function remapSection(xml: string, maps: Maps): string {
  const table: Array<[string, IdMap | undefined]> = [
    ['paraPrIDRef', maps.list.paraPr],
    ['charPrIDRef', maps.list.charPr],
    ['styleIDRef', maps.list.style],
    ['borderFillIDRef', maps.list.borderFill],
    ['tabPrIDRef', maps.list.tabPr],
    ['binaryItemIDRef', maps.bin],
    ['outlineShapeIDRef', maps.list.numbering],
    ['memoShapeIDRef', maps.list.memoPr],
    ['chartIDRef', maps.chart],
  ];
  let out = xml;
  for (const [attr, map] of table) {
    if (!map || map.size === 0) continue;
    out = out.replace(new RegExp(`\\b${attr}="([^"]*)"`, 'g'), (m, v: string) => (map.has(v) ? `${attr}="${map.get(v)}"` : m));
  }
  // 바탕쪽 참조는 idRef 라는 흔한 이름이라 그 요소에서만
  const master = maps.master;
  if (master?.size) out = out.replace(/(<(?:[\w-]+:)?masterPage\b[^>]*?\sidRef=")([^"]*)"/g, (m, head: string, v: string) => (master.has(v) ? `${head}${master.get(v)}"` : m));
  return out;
}

/** used 가 아닌 가장 작은 번호 (from 부터) */
function freeNo(from: number, used: (n: number) => boolean): number {
  let n = from;
  while (used(n)) n++;
  return n;
}

export interface Manifest {
  xml: string;
  items: Array<{ id: string; href: string; attrs: string }>;
  spine: string[];
}

export function readManifest(xml: string): Manifest {
  const items = [...xml.matchAll(/<opf:item\s([^>]*?)\/>/g)].map((m) => ({
    id: /\bid="([^"]*)"/.exec(m[1])?.[1] ?? '',
    href: /\bhref="([^"]*)"/.exec(m[1])?.[1] ?? '',
    attrs: m[1],
  }));
  const spine = [...xml.matchAll(/<opf:itemref\s[^>]*idref="([^"]*)"[^>]*\/>/g)].map((m) => m[1]);
  return { xml, items, spine };
}

export const sectionHrefs = (m: Manifest) => m.spine.map((id) => m.items.find((i) => i.id === id)).filter((i) => i && /section\d+\.xml$/i.test(i.href)).map((i) => i!.href);

export interface MergeHwpxResult {
  bytes: Uint8Array;
  sections: number;
  warnings: string[];
}

/** HWPX 바이트 여러 개 → 서식 유지 합본 HWPX */
export async function mergeHwpx(inputs: Uint8Array[]): Promise<MergeHwpxResult> {
  if (inputs.length < 2) throw new Error('합칠 문서를 두 개 이상 고르세요.');
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(inputs[0]);
  const headerPath = 'Contents/header.xml';
  const hpfPath = Object.keys(zip.files).find((n) => /content\.hpf$/i.test(n)) ?? 'Contents/content.hpf';
  const parser = new DOMParser();
  const header = parser.parseFromString(await zip.file(headerPath)!.async('string'), 'text/xml');
  let hpf = await zip.file(hpfPath)!.async('string');
  let manifest = readManifest(hpf);
  let sectionNo = sectionHrefs(manifest).length;

  for (let k = 1; k < inputs.length; k++) {
    const add = await JSZip.loadAsync(inputs[k]);
    const addHpfPath = Object.keys(add.files).find((n) => /content\.hpf$/i.test(n));
    const addHeader = add.file(headerPath);
    if (!addHpfPath || !addHeader) {
      warnings.push(`${k + 1}번째 문서는 HWPX 구조가 아니어서 건너뛰었습니다.`);
      continue;
    }
    const addManifest = readManifest(await add.file(addHpfPath)!.async('string'));

    // 그림: 이름 바꿔 옮기고 대응표
    const bin: IdMap = new Map();
    const newItems: string[] = [];
    // 새 이름의 머리(m1_ m2_ …)는 바탕에 아직 없는 번호로 잡는다. 바탕이 앞서 합친 문서면 m1_image1 이 이미 있다:
    // 같은 번호를 또 쓰면 앞서 합친 문서의 그림이 새 문서 그림으로 덮이고(경고도 없이) 같은 id 가 둘이 된다
    const taken = (tag: string) => manifest.items.some((i) => i.id.startsWith(`${tag}_`)) || Object.keys(zip.files).some((n) => new RegExp(`^BinData/${tag}_`, 'i').test(n));
    let tagNo = k;
    while (taken(`m${tagNo}`)) tagNo++;
    for (const it of addManifest.items.filter((i) => /^BinData\//i.test(i.href))) {
      const file = add.file(it.href);
      if (!file) continue;
      const newId = `m${tagNo}_${it.id}`;
      const newHref = it.href.replace(/^BinData\//i, `BinData/m${tagNo}_`);
      zip.file(newHref, await file.async('uint8array'));
      bin.set(it.id, newId);
      newItems.push(`<opf:item ${it.attrs.replace(/\bid="[^"]*"/, `id="${newId}"`).replace(/\bhref="[^"]*"/, `href="${newHref}"`)}/>`);
    }

    const maps = mergeHeader(header, parser.parseFromString(await addHeader.async('string'), 'text/xml'), bin);

    // 차트·바탕쪽: 문서마다 Chart/chart1·masterpage0 부터 매겨서(한컴 문서·kordoc 변환본), 그대로 두면 뒤 문서 구역이 첫 문서의 차트·바탕쪽을
    // 가리킨다. 바탕에 없는 번호로 옮기고 이 문서 구역의 참조를 바꾼다. 이름 꼴은 그대로 둔다: kordoc 은 Contents/masterpage*.xml 만 바탕쪽으로 읽는다
    maps.chart = new Map();
    for (const name of Object.keys(add.files).filter((n) => /^Chart\/[^/]+\.xml$/i.test(n))) {
      const no = freeNo(1, (n) => !!zip.file(`Chart/chart${n}.xml`) || manifest.items.some((i) => i.id === `chart${n}`));
      const to = `Chart/chart${no}.xml`;
      zip.file(to, await add.file(name)!.async('uint8array'));
      maps.chart.set(name, to);
      // 차트를 manifest 에 올린 문서(kordoc 마크다운 변환본)면 항목도. 한컴 문서·HWP 변환본은 올리지 않는다
      const item = addManifest.items.find((i) => i.href === name);
      if (item) newItems.push(`<opf:item ${item.attrs.replace(/\bid="[^"]*"/, `id="chart${no}"`).replace(/\bhref="[^"]*"/, `href="${to}"`)}/>`);
    }
    maps.master = new Map();
    for (const it of addManifest.items.filter((i) => /^Contents\/masterpage[^/]*\.xml$/i.test(i.href))) {
      const xml = await add.file(it.href)?.async('string');
      if (xml == null) continue;
      const id = `masterpage${freeNo(0, (n) => !!zip.file(`Contents/masterpage${n}.xml`) || manifest.items.some((i) => i.id === `masterpage${n}`))}`;
      const href = `Contents/${id}.xml`;
      // 바탕쪽 안의 글자·문단 모양·그림·차트도 이 문서의 새 ID 로. 뿌리 id 도 새 이름으로 (kordoc 은 뿌리 id 로, 한글·rhwp 는 manifest 로 찾는다)
      zip.file(href, remapSection(xml, maps).replace(/(<(?:[\w-]+:)?masterPage\b[^>]*?\sid=")[^"]*"/, `$1${id}"`));
      maps.master.set(it.id, id);
      newItems.push(`<opf:item ${it.attrs.replace(/\bid="[^"]*"/, `id="${id}"`).replace(/\bhref="[^"]*"/, `href="${href}"`)}/>`);
    }

    // 메모 답글 관계(memoExtended): 메모 id 는 그대로 옮기므로 바탕 것에 항목만 이어 붙인다
    const exItem = addManifest.items.find((i) => /memoExtended\.xml$/i.test(i.href));
    const exXml = exItem && (await add.file(exItem.href)?.async('string'));
    if (exItem && exXml) {
      const baseItem = manifest.items.find((i) => /memoExtended\.xml$/i.test(i.href));
      const baseXml = baseItem && (await zip.file(baseItem.href)?.async('string'));
      if (baseItem && baseXml) {
        const into = parser.parseFromString(baseXml, 'text/xml');
        for (const memo of kids(parser.parseFromString(exXml, 'text/xml').documentElement!, 'memo')) into.documentElement!.appendChild(into.importNode(memo, true));
        zip.file(baseItem.href, new XMLSerializer().serializeToString(into));
      } else {
        zip.file(exItem.href, exXml);
        newItems.push(`<opf:item ${exItem.attrs}/>`);
      }
    }

    // 구역
    const newRefs: string[] = [];
    for (const href of sectionHrefs(addManifest)) {
      const xml = await add.file(href)?.async('string');
      if (!xml) continue;
      // 이름은 바탕에 없는 번호로: 옛 판으로 나눈 조각은 Contents/section0.xml 의 id 가 section1 일 수 있어, 구역 수로만 매기면
      // 같은 id 가 둘이 되고 한 조각이 두 번 나오고 다른 조각은 빠진다
      const id = `section${freeNo(sectionNo, (n) => !!zip.file(`Contents/section${n}.xml`) || manifest.items.some((i) => i.id === `section${n}`))}`;
      const path = `Contents/${id}.xml`;
      zip.file(path, remapSection(xml, maps));
      newItems.push(`<opf:item id="${id}" href="${path}" media-type="application/xml"/>`);
      newRefs.push(`<opf:itemref idref="${id}" linear="yes"/>`);
      sectionNo++;
    }
    hpf = hpf.replace('</opf:manifest>', `${newItems.join('')}</opf:manifest>`).replace('</opf:spine>', `${newRefs.join('')}</opf:spine>`);
    manifest = readManifest(hpf);
  }

  header.documentElement?.setAttribute('secCnt', String(sectionNo));
  zip.file(headerPath, new XMLSerializer().serializeToString(header));
  zip.file(hpfPath, hpf);
  ensureVersionXml(zip);
  // HWPX 규칙: mimetype 은 맨 앞·압축 없음
  const mimetype = await zip.file('mimetype')?.async('uint8array');
  if (mimetype) zip.file('mimetype', mimetype, { compression: 'STORE' });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, sections: sectionNo, warnings };
}
