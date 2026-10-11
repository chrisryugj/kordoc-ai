/**
 * HWPX 서식 유지 수합 — 한컴오피스 없이 XML 수준에서 문서를 이어 붙인다 (부서별 제출 자료 한 파일로 합치기)
 *
 * 첫 문서를 바탕으로, 뒤 문서마다
 *   1) 머리(header.xml)의 목록(글꼴·테두리·글자 모양·탭·번호·글머리·문단 모양·스타일·메모)을 바탕 뒤에 붙이며 ID 를 새로 매기고
 *      (같은 이름의 글꼴·스타일은 바탕 것을 그대로 쓴다)
 *   2) 본문 구역(section*.xml)의 참조 ID 를 새 ID 로 바꿔 새 구역으로 붙이고 (구역이라 쪽 설정이 그대로, 새 쪽에서 시작)
 *   3) 그림(BinData)을 이름을 바꿔 옮긴다.
 * HWP(5.x) 는 rhwp 로 HWPX 로 바꿔서 섞어 합칠 수 있다.
 */

import JSZip from 'jszip';
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';

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
    let next = maxId(baseItems) + 1;
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
  ];
  let out = xml;
  for (const [attr, map] of table) {
    if (!map || map.size === 0) continue;
    out = out.replace(new RegExp(`\\b${attr}="([^"]*)"`, 'g'), (m, v: string) => (map.has(v) ? `${attr}="${map.get(v)}"` : m));
  }
  return out;
}

interface Manifest {
  xml: string;
  items: Array<{ id: string; href: string; attrs: string }>;
  spine: string[];
}

function readManifest(xml: string): Manifest {
  const items = [...xml.matchAll(/<opf:item\s([^>]*?)\/>/g)].map((m) => ({
    id: /\bid="([^"]*)"/.exec(m[1])?.[1] ?? '',
    href: /\bhref="([^"]*)"/.exec(m[1])?.[1] ?? '',
    attrs: m[1],
  }));
  const spine = [...xml.matchAll(/<opf:itemref\s[^>]*idref="([^"]*)"[^>]*\/>/g)].map((m) => m[1]);
  return { xml, items, spine };
}

const sectionHrefs = (m: Manifest) => m.spine.map((id) => m.items.find((i) => i.id === id)).filter((i) => i && /section\d+\.xml$/i.test(i.href)).map((i) => i!.href);

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
    for (const it of addManifest.items.filter((i) => /^BinData\//i.test(i.href))) {
      const file = add.file(it.href);
      if (!file) continue;
      const newId = `m${k}_${it.id}`;
      const newHref = it.href.replace(/^BinData\//i, `BinData/m${k}_`);
      zip.file(newHref, await file.async('uint8array'));
      bin.set(it.id, newId);
      newItems.push(`<opf:item ${it.attrs.replace(/\bid="[^"]*"/, `id="${newId}"`).replace(/\bhref="[^"]*"/, `href="${newHref}"`)}/>`);
    }

    const maps = mergeHeader(header, parser.parseFromString(await addHeader.async('string'), 'text/xml'), bin);

    // 구역
    const newRefs: string[] = [];
    for (const href of sectionHrefs(addManifest)) {
      const xml = await add.file(href)?.async('string');
      if (!xml) continue;
      const id = `section${sectionNo}`;
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
  // HWPX 규칙: mimetype 은 맨 앞·압축 없음
  const mimetype = await zip.file('mimetype')?.async('uint8array');
  if (mimetype) zip.file('mimetype', mimetype, { compression: 'STORE' });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, sections: sectionNo, warnings };
}
