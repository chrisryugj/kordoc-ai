/** DOCX 서식 유지 수합 — ZIP+XML body 이어붙이기 + 스타일/넘버링 병합 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, posix } from 'node:path';
import JSZip from 'jszip';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- xmldom types need DOM lib
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import type { MergeFilesParams, MergeFilesResult } from './types.js';

// xmldom 반환 타입은 DOM spec이지만 tsconfig에 lib dom이 없으므로 any 사용
/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── XML 헬퍼 ───────────��──────────────────────────────

function getChildElements(parent: any, localName: string): any[] {
  const result: any[] = [];
  const children = parent.childNodes;
  if (!children) return result;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.nodeType === 1) {
      if (node.localName === localName || node.tagName?.endsWith(`:${localName}`)) {
        result.push(node);
      }
    }
  }
  return result;
}

const PAGE_BREAK = '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:br w:type="page"/></w:r></w:p>';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OFFICE_NS = 'urn:schemas-microsoft-com:office:office';
const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** mode: 바깥 링크면 'External' (빠뜨리면 워드가 링크 주소를 문서 안 부품으로 찾다가 문서를 못 연다) */
interface Rel { id: string; target: string; type: string; mode?: string }

function parseRels(xml: string): Rel[] {
  const doc: any = new DOMParser().parseFromString(xml, 'text/xml');
  const rels: Rel[] = [];
  const elements = doc.getElementsByTagName('Relationship');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    rels.push({
      id: el.getAttribute('Id') || '',
      target: el.getAttribute('Target') || '',
      type: el.getAttribute('Type') || '',
      ...(el.getAttribute('TargetMode') ? { mode: el.getAttribute('TargetMode') } : {}),
    });
  }
  return rels;
}

const relXml = (r: Rel) => `<Relationship Id="${xmlAttr(r.id)}" Type="${xmlAttr(r.type)}" Target="${xmlAttr(r.target)}"${r.mode ? ` TargetMode="${xmlAttr(r.mode)}"` : ''}/>`;

/** 문서마다 하나뿐인 부품 — 서식·번호는 따로 합치고, 머리글·바닥글·각주·메모는 옮기지 않는다 (본문과 함께 옮기는 것은 그림·차트·삽입 개체) */
const SINGLETON = /\/(styles|stylesWithEffects|numbering|settings|webSettings|fontTable|theme|footnotes|endnotes|comments|commentsExtended|commentsIds|commentsExtensible|people|header|footer|customXml|glossaryDocument)$/;

interface Types { defaults: Map<string, string>; overrides: Map<string, string> }

/** [Content_Types].xml — 확장자별 기본 종류와 부품별 종류 */
function parseTypes(xml: string): Types {
  const types: Types = { defaults: new Map(), overrides: new Map() };
  const attr = (el: string, name: string) => el.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '';
  for (const m of xml.matchAll(/<Default\b[^>]*>/g)) types.defaults.set(attr(m[0], 'Extension').toLowerCase(), attr(m[0], 'ContentType'));
  for (const m of xml.matchAll(/<Override\b[^>]*>/g)) types.overrides.set(attr(m[0], 'PartName'), attr(m[0], 'ContentType'));
  return types;
}

interface Carry { zip: JSZip; base: JSZip; moved: Map<string, string>; types: Types; baseTypes: Types; addedTypes: string[] }

/** 딸린 부품(그림·차트·삽입 개체)을 합본으로 옮긴다 — 같은 이름이 있으면 새 이름으로, 그 부품에 또 딸린 부품까지.
 *  옮긴 경로를 돌려준다 (원본에 없는 부품이면 null) */
async function bring(from: string, c: Carry): Promise<string | null> {
  const known = c.moved.get(from);
  if (known) return known;
  const file = c.zip.file(from);
  if (!file) return null;
  const dir = posix.dirname(from);
  const name = posix.basename(from);
  const ext = posix.extname(name);
  let to = from;
  for (let n = 2; c.base.file(to); n++) to = `${dir}/${name.slice(0, name.length - ext.length)}_${n}${ext}`;
  c.moved.set(from, to);
  c.base.file(to, await file.async('uint8array'));
  // 종류 표: 원본이 부품별로 적었으면 그대로, 아니면 확장자 기본값을 (첫 문서에 없던 그림 형식이면 워드가 문서를 못 연다)
  const own = c.types.overrides.get(`/${from}`);
  const key = ext.slice(1).toLowerCase();
  if (own) {
    c.addedTypes.push(`<Override PartName="${xmlAttr(`/${to}`)}" ContentType="${xmlAttr(own)}"/>`);
  } else if (c.types.defaults.has(key) && !c.baseTypes.defaults.has(key)) {
    c.baseTypes.defaults.set(key, c.types.defaults.get(key)!);
    c.addedTypes.push(`<Default Extension="${xmlAttr(key)}" ContentType="${xmlAttr(c.types.defaults.get(key)!)}"/>`);
  }
  const relsFile = c.zip.file(`${dir}/_rels/${name}.rels`);
  if (relsFile) {
    const out: Rel[] = [];
    for (const rel of parseRels(await relsFile.async('text'))) {
      if (rel.mode === 'External') { out.push(rel); continue; }
      const next = await bring(rel.target.startsWith('/') ? rel.target.slice(1) : posix.normalize(posix.join(dir, rel.target)), c);
      if (next) out.push({ ...rel, target: posix.relative(posix.dirname(to), next) });
    }
    c.base.file(`${posix.dirname(to)}/_rels/${posix.basename(to)}.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${out.map(relXml).join('')}</Relationships>`);
  }
  return to;
}

/** 본문 조각의 관계 id 를 합본의 새 id 로. 옮기지 않은 관계(머리글·바닥글, 원본에 없는 부품)를 가리키는 곳은 지운다
 *  (그림·개체 안이면 그 그림·개체째로). 조각 자체를 지워야 하면 false */
function rewire(root: any, ids: Map<string, string | null>): boolean {
  const doomed: any[] = [];
  const walk = (el: any) => {
    const attrs = el.attributes;
    for (let i = 0; attrs && i < attrs.length; i++) {
      const a = attrs[i];
      if (a.namespaceURI !== REL_NS && !(a.namespaceURI === OFFICE_NS && a.localName === 'relid')) continue;
      const next = ids.get(a.value);
      if (next) el.setAttributeNS(a.namespaceURI, a.name, next);
      else doomed.push(el);
    }
    for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) walk(c);
  };
  walk(root);
  for (const el of doomed) {
    let target = el;
    for (let p = el; p; p = p === root ? null : p.parentNode) if (/^(drawing|object|pict)$/.test(p.localName ?? '')) target = p;
    if (target === root) return false;
    target.parentNode?.removeChild(target);
  }
  return true;
}

// ─── styles.xml 병합 ─────────��────────────────────────

/** styles.xml에서 모든 w:style 추출 → styleId → XML 조각 */
function parseDocxStyles(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  // self-closing 또는 children
  const re = /<w:style\b[^>]*w:styleId="([^"]*)"[^>]*(?:\/>|>[\s\S]*?<\/w:style>)/g;
  let m;
  while ((m = re.exec(xml))) {
    map.set(m[1], m[0]);
  }
  return map;
}

const styleName = (fragment: string) => fragment.match(/<w:name\s+w:val="([^"]*)"/)?.[1] ?? '';
const styleType = (fragment: string) => fragment.match(/^<w:style\b[^>]*\bw:type="([^"]*)"/)?.[1] ?? 'paragraph';
const isDefaultStyle = (fragment: string) => /^<w:style\b[^>]*\bw:default="(?:1|true|on)"/.test(fragment);
/** 서식이 다른 서식을 가리키는 곳 */
const STYLE_LINK = /(<w:(?:basedOn|next|link)\s+w:val=")([^"]*)(")/g;

/** 문서의 기본 문단 서식 id (문단에 서식을 적지 않으면 이 서식을 쓴다) */
function defaultParagraphStyle(stylesXml: string): string | undefined {
  for (const [id, fragment] of parseDocxStyles(stylesXml)) if (styleType(fragment) === 'paragraph' && isDefaultStyle(fragment)) return id;
  return undefined;
}

/** 두 styles.xml 병합 — 서식은 이름으로 맞춘다 (워드에서 서식을 가르는 것은 이름이고, id 는 문서마다 다르게 매겨진다).
 *  - 이름과 정의가 같으면 첫 문서 서식을 쓴다. 편집 흔적 번호(rsid)만 다른 것은 같은 서식이다
 *  - 이름은 같은데 정의가 다르면 새 id·새 이름의 사본으로 넣는다 (같은 이름의 서식이 둘이면 워드가 문서를 손상으로 본다)
 *  - 첫 문서에 없는 이름이면 그대로 넣는다 (id 가 겹치면 새 id)
 *  added 는 합본에 더할 서식 조각, remap 은 뒤 문서의 서식 id → 합본의 서식 id */
function mergeDocxStyles(
  baseStylesXml: string,
  donorStylesXml: string,
  docIndex: number,
): { added: string[]; remap: Map<string, string> } {
  const baseStyles = parseDocxStyles(baseStylesXml);
  const donorStyles = parseDocxStyles(donorStylesXml);

  const normalize = (s: string): string => {
    let n = s.replace(/\s+/g, ' ').trim();
    n = n.replace(/\s+\/>/g, '/>');
    n = n.replace(/<([\w:]+)((?:\s+[\w:]+="[^"]*")+)\s*(\/?)>/g, (_, tag, attrs, close) => {
      const sorted = (attrs.match(/\s+[\w:]+="[^"]*"/g) || [])
        .map((a: string) => a.trim()).sort().join(' ');
      return `<${tag} ${sorted}${close}>`;
    });
    return n;
  };
  /** 견줄 모양: 문서마다 다른 것(서식 id, 편집 흔적 번호)은 빼고, 다른 서식을 가리키는 곳은 그 서식의 이름으로 */
  const canonical = (fragment: string, styles: Map<string, string>) => normalize(fragment
    .replace(/\s+w:styleId="[^"]*"/, '')
    .replace(/<w:rsid\b[^>]*\/>/g, '')
    .replace(STYLE_LINK, (_, a, id, z) => a + styleName(styles.get(id) ?? '') + z));
  const key = (fragment: string) => `${styleType(fragment)}\u0000${styleName(fragment).toLowerCase()}`;

  const baseByName = new Map<string, string>();
  for (const [id, fragment] of baseStyles) baseByName.set(key(fragment), id);

  // 1) 같은 이름의 첫 문서 서식과 정의가 같은가. 기대는 서식(basedOn)·짝 서식(link)이 사본이 되면 따라서 사본이 된다
  const twin = new Map<string, string>();
  for (const [id, fragment] of donorStyles) {
    const baseId = baseByName.get(key(fragment));
    if (baseId !== undefined && canonical(baseStyles.get(baseId)!, baseStyles) === canonical(fragment, donorStyles)) twin.set(id, baseId);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, fragment] of donorStyles) {
      if (!twin.has(id)) continue;
      const leans = [...fragment.matchAll(/<w:(?:basedOn|link)\s+w:val="([^"]*)"/g)].map((m) => m[1]);
      if (leans.some((ref) => donorStyles.has(ref) && !twin.has(ref))) { twin.delete(id); changed = true; }
    }
  }

  // 2) 사본·새 서식의 id 와 이름
  const remap = new Map<string, string>();
  const usedIds = new Set(baseStyles.keys());
  const usedNames = new Set([...baseStyles.values()].map((f) => styleName(f).toLowerCase()));
  const fresh = (want: string, used: Set<string>, next: (n: number) => string): string => {
    let out = want;
    for (let n = docIndex; used.has(out.toLowerCase()) || used.has(out); n++) out = next(n);
    return out;
  };
  const adding: Array<{ from: string; id: string; name: string; fragment: string }> = [];
  for (const [id, fragment] of donorStyles) {
    const same = twin.get(id);
    if (same !== undefined) {
      if (same !== id) remap.set(id, same);
      continue;
    }
    const newId = fresh(id, usedIds, (n) => `${id}_${n}`);
    const own = styleName(fragment);
    const newName = fresh(own, usedNames, (n) => `${own} (${n})`);
    usedIds.add(newId);
    usedNames.add(newName.toLowerCase());
    if (newId !== id) remap.set(id, newId);
    adding.push({ from: id, id: newId, name: newName, fragment });
  }

  // 3) 더할 조각: 새 id·새 이름, 기본 서식 표시는 뗀다(문서에 기본 서식은 하나), 다른 서식을 가리키는 곳은 합본의 id 로
  const added = adding.map(({ from, id, name, fragment }) => fragment
    .replace(`w:styleId="${from}"`, () => `w:styleId="${id}"`)
    .replace(/^(<w:style\b[^>]*?)\s+w:default="[^"]*"/, '$1')
    .replace(/(<w:name\s+w:val=")[^"]*(")/, (_, a, z) => a + name + z)
    .replace(/(<w:(?:basedOn|next|link|numStyleLink|styleLink)\s+w:val=")([^"]*)(")/g, (_, a, ref, z) => a + (remap.get(ref) ?? ref) + z));

  return { added, remap };
}

/** 문단 속성(pPr)의 규격 차례 — 차례가 틀리면 워드가 문서를 못 읽는 일이 있다 */
const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs',
  'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid',
  'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl',
  'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];

const docDefaults = (stylesXml: string) => ({
  rPr: stylesXml.match(/<w:rPrDefault>\s*<w:rPr>([\s\S]*?)<\/w:rPr>\s*<\/w:rPrDefault>/)?.[1] ?? '',
  pPr: stylesXml.match(/<w:pPrDefault>\s*<w:pPr>([\s\S]*?)<\/w:pPr>\s*<\/w:pPrDefault>/)?.[1] ?? '',
});
/** 속성 묶음의 맨 위 요소들 (같은 이름이 안에 겹쳐 들지 않는 묶음에만 쓴다) */
const topLevel = (inner: string) => [...inner.matchAll(/<w:(\w+)\b[^>]*?(?:\/>|>[\s\S]*?<\/w:\1>)/g)].map((m) => ({ tag: m[1], xml: m[0] }));

/** 뒤 문서의 문서 기본값이 합본과 다르면, 기대는 서식이 없는 문단 서식(뿌리 서식)에 그 기본값을 적어 넣은 styles.xml 을 돌려준다.
 *  서식에 이미 적힌 속성은 그대로 둔다(서식이 기본값을 이긴다). 같으면 그대로 */
export function withDocDefaults(donorStylesXml: string, baseStylesXml: string): string {
  const own = docDefaults(donorStylesXml);
  const base = docDefaults(baseStylesXml);
  const flat = (s: string) => topLevel(s).map((k) => k.xml.replace(/\s+/g, ' ')).sort().join('');
  if (flat(own.rPr) === flat(base.rPr) && flat(own.pPr) === flat(base.pPr)) return donorStylesXml;
  // 첫 문서 기본값에만 있는 속성은 규격의 기본값을 적는다. 뒤 문서에 그 속성이 없다는 것은 규격 기본값(10pt·문단 간격 0)을 쓴다는 뜻인데,
  // 합본에서는 그 자리에 첫 문서 기본값(11pt·문단 뒤 8pt)이 먹는다
  const SPEC: Record<string, string> = {
    sz: '<w:sz w:val="20"/>', szCs: '<w:szCs w:val="20"/>',
    spacing: '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>',
  };
  const withSpec = (mine: string, theirs: string) => mine + topLevel(theirs).filter((b) => SPEC[b.tag] && !topLevel(mine).some((o) => o.tag === b.tag)).map((b) => SPEC[b.tag]).join('');
  own.rPr = withSpec(own.rPr, base.rPr);
  own.pPr = withSpec(own.pPr, base.pPr);
  const fill = (have: string, defaults: string, order?: string[]) => {
    const kids = topLevel(have);
    const merged = [...topLevel(defaults).filter((d) => !kids.some((k) => k.tag === d.tag)), ...kids];
    if (order) merged.sort((a, b) => (order.indexOf(a.tag) + 1 || 99) - (order.indexOf(b.tag) + 1 || 99));
    return merged.map((k) => k.xml).join('');
  };
  return donorStylesXml.replace(/<w:style\b[^>]*w:type="paragraph"[^>]*(?<!\/)>[\s\S]*?<\/w:style>/g, (whole) => {
    if (/<w:basedOn\b/.test(whole)) return whole;
    const style = whole.replace(/<w:(?:pPr|rPr)\/>/g, '');
    // 문단 속성과 그 밖을 가른다 (서식의 글자 속성은 문단 속성 밖에 있다)
    const pPr = style.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
    const rest = pPr ? style.replace(pPr[0], '\u0000') : style;
    const rPr = rest.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const nextP = own.pPr ? `<w:pPr>${fill(pPr?.[1] ?? '', own.pPr, PPR_ORDER)}</w:pPr>` : pPr?.[0] ?? '';
    const nextR = own.rPr ? `<w:rPr>${fill(rPr?.[1] ?? '', own.rPr)}</w:rPr>` : rPr?.[0] ?? '';
    // 서식 안 차례: … pPr, rPr, (tblPr …) → 있던 자리에 넣고, 없었으면 닫는 표시 앞(표 속성이 있으면 그 앞)에
    let out = rest;
    out = rPr ? out.replace(rPr[0], () => nextR) : out.replace(/(<w:tblPr\b|<\/w:style>)/, (m) => nextR + m);
    out = pPr ? out.replace('\u0000', () => nextP) : out.replace(nextR || /(<w:tblPr\b|<\/w:style>)/, (m) => nextP + m);
    return out;
  });
}

/** 뒤 문서의 기본 문단 서식이 합본의 기본 서식과 다르면, 서식을 적지 않은 문단에 그 서식을 적어 준다
 *  (안 적으면 그 문단들이 첫 문서의 기본 글꼴·크기·줄 간격으로 바뀐다) */
function withParagraphStyle(xml: string, styleId: string): string {
  const pStyle = `<w:pStyle w:val="${styleId}"/>`;
  return xml
    .replace(/<w:p(\s[^>]*)?\/>/g, (_, attrs = '') => `<w:p${attrs}><w:pPr>${pStyle}</w:pPr></w:p>`)
    .replace(/<w:pPr\/>/g, () => `<w:pPr>${pStyle}</w:pPr>`)
    .replace(/<w:pPr>(?!\s*<w:pStyle\b)/g, () => `<w:pPr>${pStyle}`)
    .replace(/(<w:p(?:\s[^>]*)?>)(?!\s*<w:pPr\b)/g, (_, open) => `${open}<w:pPr>${pStyle}</w:pPr>`);
}

/** body XML의 스타일 참조 리매��� */
function remapDocxStyleRefs(bodyXml: string, remap: Map<string, string>): string {
  if (remap.size === 0) return bodyXml;
  // 한 번에 바꾼다 (하나씩 차례로 바꾸면 a→b, b→c 가 겹칠 때 a 가 c 까지 간다)
  return bodyXml.replace(/(<w:(?:pStyle|rStyle|tblStyle|numStyleLink|styleLink)\s+w:val=")([^"]*)(")/g, (_, a, id, z) => a + (remap.get(id) ?? id) + z);
}

// ─── numbering.xml 병합 ───���───────────────────────────

function mergeNumbering(
  baseXml: string | null,
  donorXml: string | null,
  offset: number,
): { mergedXml: string | null; abstractNumRemap: Map<number, number>; numIdRemap: Map<number, number> } {
  if (!donorXml) return { mergedXml: baseXml, abstractNumRemap: new Map(), numIdRemap: new Map() };
  if (!baseXml) return { mergedXml: donorXml, abstractNumRemap: new Map(), numIdRemap: new Map() };

  // base의 max abstractNumId, numId 찾기
  let maxAbstractNum = -1;
  const anRe = /w:abstractNumId="(\d+)"/g;
  let m;
  while ((m = anRe.exec(baseXml))) {
    maxAbstractNum = Math.max(maxAbstractNum, parseInt(m[1], 10));
  }
  let maxNumId = -1;
  const nRe = /<w:num\s+w:numId="(\d+)"/g;
  while ((m = nRe.exec(baseXml))) {
    maxNumId = Math.max(maxNumId, parseInt(m[1], 10));
  }

  const abstractNumOffset = maxAbstractNum + 1;
  const numIdOffset = maxNumId + 1;

  const abstractNumRemap = new Map<number, number>();
  const numIdRemap = new Map<number, number>();

  const usedNsids = new Set([...baseXml.matchAll(/<w:nsid\s+w:val="([0-9A-Fa-f]{1,8})"/g)].map((x) => parseInt(x[1], 16)));

  // donor의 abstractNum 추출 + 리매핑
  const abstractNums: string[] = [];
  const anExtractRe = /<w:abstractNum\s+w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g;
  while ((m = anExtractRe.exec(donorXml))) {
    const oldId = parseInt(m[1], 10);
    const newId = oldId + abstractNumOffset;
    abstractNumRemap.set(oldId, newId);
    let fragment = m[0].replace(
      `w:abstractNumId="${oldId}"`,
      `w:abstractNumId="${newId}"`,
    );
    // 번호 정의의 고유 번호(nsid)가 앞 문서 것과 같으면 워드가 같은 목록으로 보고 번호를 이어 매긴다
    // (같은 서식에서 나온 문서는 nsid 가 같다 → 둘째 문서의 "1." 이 "8." 이 된다) → 안 쓰는 번호로 바꾼다
    fragment = fragment.replace(/(<w:nsid\s+w:val=")([0-9A-Fa-f]{1,8})(")/, (_, a, hex, z) => {
      let n = parseInt(hex, 16);
      while (usedNsids.has(n)) n = (n + 1) >>> 0;
      usedNsids.add(n);
      return a + n.toString(16).toUpperCase().padStart(8, '0') + z;
    });
    abstractNums.push(fragment);
  }

  // donor의 num 추출 + 리매핑
  const nums: string[] = [];
  const numExtractRe = /<w:num\s+w:numId="(\d+)"[\s\S]*?<\/w:num>/g;
  while ((m = numExtractRe.exec(donorXml))) {
    const oldId = parseInt(m[1], 10);
    const newId = oldId + numIdOffset;
    numIdRemap.set(oldId, newId);
    let fragment = m[0]
      .replace(`w:numId="${oldId}"`, `w:numId="${newId}"`)
      // 목록의 고유 번호도 문서마다 같을 수 있다 (겹치면 안 된다. 없으면 워드가 새로 매긴다)
      .replace(/^(<w:num\b[^>]*?)\s+w16cid:durableId="[^"]*"/, '$1');
    // abstractNumId 참조 리매핑
    fragment = fragment.replace(
      /(<w:abstractNumId\s+w:val=")(\d+)(")/g,
      (_, pre, num, post) => {
        const remapped = abstractNumRemap.get(parseInt(num, 10)) ?? parseInt(num, 10);
        return `${pre}${remapped}${post}`;
      },
    );
    nums.push(fragment);
  }

  // 규격의 차례대로 넣는다: 번호 정의(abstractNum)가 모두 먼저, 목록(num)이 그 뒤.
  // 섞어 넣으면 워드가 뒤에 온 정의를 못 읽어 뒤 문서의 목록이 앞 문서 목록에 이어 붙는다
  const insertAt = (xml: string, at: number, text: string) => (at < 0 ? xml : xml.slice(0, at) + text + xml.slice(at));
  // 첫 문서의 번호 부품이 빈 꼴(<w:numbering …/>)이면 넣을 자리가 없어 뒤 문서의 번호 정의가 말없이 빠진다 → 펼친다
  let mergedXml = baseXml.replace(/<w:numbering\b([^>]*)\/>\s*$/, (_, attrs) => `<w:numbering${attrs}></w:numbering>`);
  const end = (xml: string) => xml.search(/<w:numIdMacAtCleanup\b|<\/w:numbering>\s*$/);
  if (abstractNums.length > 0) {
    const firstNum = mergedXml.search(/<w:num\s/);
    mergedXml = insertAt(mergedXml, firstNum >= 0 ? firstNum : end(mergedXml), abstractNums.join(''));
  }
  if (nums.length > 0) mergedXml = insertAt(mergedXml, end(mergedXml), nums.join(''));

  return { mergedXml, abstractNumRemap, numIdRemap };
}

/** body XML의 numId 참조 리매핑 */
function remapNumIds(bodyXml: string, numIdRemap: Map<number, number>): string {
  if (numIdRemap.size === 0) return bodyXml;
  return bodyXml.replace(
    /(<w:numId\s+w:val=")(\d+)(")/g,
    (full, pre, num, post) => {
      const oldId = parseInt(num, 10);
      const newId = numIdRemap.get(oldId) ?? oldId;
      return `${pre}${newId}${post}`;
    },
  );
}

// ─── 메인 함수 ───────────��─────────────────────────────

export async function concatDocx(
  params: MergeFilesParams,
  signal: AbortSignal,
): Promise<MergeFilesResult> {
  const { files, output_path } = params;
  const failedFiles: string[] = [];
  let baseZip: JSZip | null = null;
  let baseDoc: any = null;
  let baseBody: any = null;
  let lastSectPr: any = null;
  /** 첫 문서의 구역 설정 — 머리글·바닥글 참조는 첫 문서 것만 합본에 있다 */
  let baseSectPr: any = null;
  let nextRelId = 1;
  const additionalRels: Rel[] = [];
  const warnings: string[] = [];
  let baseTypes: Types = { defaults: new Map(), overrides: new Map() };
  const addedTypes: string[] = [];

  // 스타일/넘버링 병합용
  let mergedStylesXml: string | null = null;
  let mergedNumberingXml: string | null = null;

  logger.info(`[concat-docx] ${files.length}개 DOCX 수합 시작`);

  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    sendProgress({
      current: i + 1,
      total: files.length,
      message: `DOCX 합치는 중 ${i + 1}/${files.length}: ${basename(files[i])}`,
    });

    try {
      const buffer = await readFile(files[i]);
      const zip = await JSZip.loadAsync(buffer);

      const docFile = zip.file('word/document.xml');
      if (!docFile) throw new Error('word/document.xml 없음');
      const docXml = await docFile.async('text');

      if (!baseZip) {
        // 본문이 있는지 본 뒤에 첫 문서로 삼는다 (본문 없는 파일을 첫 문서로 잡으면 뒤 문서가 모두 실패한다)
        const first: any = new DOMParser().parseFromString(docXml, 'text/xml');
        const firstBody = getChildElements(first.documentElement, 'body')[0];
        if (!firstBody) throw new Error('w:body 없음');
        baseZip = zip;
        baseDoc = first;
        baseBody = firstBody;

        const sectPrs = getChildElements(baseBody, 'sectPr');
        if (sectPrs.length > 0) {
          lastSectPr = sectPrs[sectPrs.length - 1];
          baseSectPr = lastSectPr;
          baseBody.removeChild(lastSectPr);
        }
        // 뒤 문서의 관계 id 는 첫 문서가 쓰는 번호 뒤부터 매긴다
        const baseRels = zip.file('word/_rels/document.xml.rels');
        if (baseRels) for (const rel of parseRels(await baseRels.async('text'))) nextRelId = Math.max(nextRelId, (parseInt(rel.id.replace(/\D/g, ''), 10) || 0) + 1);
        const baseTypesFile = zip.file('[Content_Types].xml');
        if (baseTypesFile) baseTypes = parseTypes(await baseTypesFile.async('text'));

        // base styles/numbering 읽기
        const stylesFile = zip.file('word/styles.xml');
        if (stylesFile) mergedStylesXml = await stylesFile.async('text');
        const numFile = zip.file('word/numbering.xml');
        if (numFile) mergedNumberingXml = await numFile.async('text');

        continue;
      }

      // ── 추가 파일 ──

      // 본문과 문서 꼴을 먼저 본다 (서식·번호를 합본에 더한 뒤에 실패하면 찌꺼기가 남는다)
      const doc: any = new DOMParser().parseFromString(docXml, 'text/xml');
      const body = getChildElements(doc.documentElement, 'body')[0];
      if (!body) throw new Error('w:body 없음');
      // 이름공간이 다른 꼴(Strict Open XML)은 본문 요소 이름이 달라 그대로 이어 붙이면 깨진다
      if (doc.documentElement.namespaceURI !== baseDoc.documentElement.namespaceURI) throw new Error('문서 이름공간이 첫 문서와 다름');

      // 스타일 병합
      let styleRemap = new Map<string, string>();
      let addedStyles: string[] = [];
      /** 서식을 적지 않은 문단에 적어 줄 서식 (이 문서의 기본 문단 서식이 합본의 기본 서식과 다를 때) */
      let implicitStyle: string | undefined;
      const donorStylesFile = zip.file('word/styles.xml');
      if (donorStylesFile && mergedStylesXml) {
        // 문서 기본값(글꼴·크기·문단 간격)이 첫 문서와 다르면 이 문서의 뿌리 서식에 적어 넣는다
        // (기본값은 합본에 하나뿐이라, 안 적으면 이 문서 본문 전체가 첫 문서의 글꼴·크기로 바뀐다)
        const donorStylesXml = withDocDefaults(await donorStylesFile.async('text'), mergedStylesXml);
        const result = mergeDocxStyles(mergedStylesXml, donorStylesXml, i + 1);
        addedStyles = result.added;
        styleRemap = result.remap;
        const own = defaultParagraphStyle(donorStylesXml);
        const merged = own === undefined ? undefined : styleRemap.get(own) ?? own;
        if (merged !== undefined && merged !== defaultParagraphStyle(mergedStylesXml)) implicitStyle = merged;
      }

      // 넘버링 병합 (번호 정의가 가리키는 서식도 합본의 id 로)
      let numIdRemap = new Map<number, number>();
      const donorNumFile = zip.file('word/numbering.xml');
      if (donorNumFile) {
        const donorNumXml = remapDocxStyleRefs(await donorNumFile.async('text'), styleRemap);
        const result = mergeNumbering(mergedNumberingXml, donorNumXml, i);
        mergedNumberingXml = result.mergedXml;
        numIdRemap = result.numIdRemap;
      }
      // 더하는 서식이 쓰는 번호도 합본의 번호로 바꿔 넣는다
      if (addedStyles.length && mergedStylesXml) {
        const insert = addedStyles.map((f) => remapNumIds(f, numIdRemap)).join('');
        mergedStylesXml = /<\/w:styles>\s*$/.test(mergedStylesXml)
          ? mergedStylesXml.replace(/<\/w:styles>\s*$/, () => `${insert}</w:styles>`)
          : mergedStylesXml.replace(/<w:styles\b([^>]*)\/>\s*$/, (_, attrs) => `<w:styles${attrs}>${insert}</w:styles>`);
      }

      // 이 문서의 관계: 바깥 링크는 그대로, 그림·차트·삽입 개체는 부품째 옮기고, 나머지(머리글·각주…)는 옮기지 않는다.
      // 관계 id 는 이 문서 것만 새로 매긴다 (앞 문서의 관계까지 건드리면 같은 이름 그림이 뒤바뀐다)
      const typesFile = zip.file('[Content_Types].xml');
      const carry: Carry = { zip, base: baseZip, moved: new Map(), types: typesFile ? parseTypes(await typesFile.async('text')) : { defaults: new Map(), overrides: new Map() }, baseTypes, addedTypes };
      const ids = new Map<string, string | null>();
      const mine: Rel[] = [];
      const relsFile = zip.file('word/_rels/document.xml.rels');
      for (const rel of relsFile ? parseRels(await relsFile.async('text')) : []) {
        let target: string | null = rel.target;
        if (rel.mode !== 'External') {
          if (SINGLETON.test(rel.type)) target = null;
          else {
            const to = await bring(rel.target.startsWith('/') ? rel.target.slice(1) : posix.normalize(posix.join('word', rel.target)), carry);
            target = to && posix.relative('word', to);
          }
        }
        if (!target) { ids.set(rel.id, null); continue; }
        const id = `rId${nextRelId++}`;
        ids.set(rel.id, id);
        mine.push({ ...rel, id, target });
      }

      // body 자식 복사 (sectPr 은 따로). 다 만든 뒤에 붙인다: 도중에 실패한 문서가 반쯤 들어가지 않게
      const nodes: any[] = [];
      let sectPr: any = null;
      let notes = 0;
      let headers = 0;
      const children: any[] = [];
      for (let c = 0; c < body.childNodes.length; c++) if (body.childNodes[c].nodeType === 1) children.push(body.childNodes[c]);
      for (const child of children) {
        headers += child.getElementsByTagNameNS(W_NS, 'headerReference').length + child.getElementsByTagNameNS(W_NS, 'footerReference').length;
        if (!rewire(child, ids)) continue;
        let serialized = new XMLSerializer().serializeToString(child);
        // 각주·미주·메모는 문서마다 따로 번호를 매긴 부품에 있다 → 표시를 남기면 첫 문서의 다른 각주를 가리킨다
        serialized = serialized.replace(/<w:(?:footnoteReference|endnoteReference|commentReference|commentRangeStart|commentRangeEnd)\b[^>]*\/>/g, (el) => { if (!/Range(Start|End)/.test(el)) notes++; return ''; });
        serialized = remapDocxStyleRefs(serialized, styleRemap);
        if (implicitStyle) serialized = withParagraphStyle(serialized, implicitStyle);
        serialized = remapNumIds(serialized, numIdRemap);
        const reimported: any = new DOMParser().parseFromString(serialized, 'text/xml');
        const node = baseDoc.importNode(reimported.documentElement, true);
        if (child.localName === 'sectPr') sectPr = node;
        else nodes.push(node);
      }

      // page break 삽입
      const breakDoc: any = new DOMParser().parseFromString(PAGE_BREAK, 'text/xml');
      baseBody.appendChild(baseDoc.importNode(breakDoc.documentElement, true));
      for (const node of nodes) baseBody.appendChild(node);
      if (sectPr) lastSectPr = sectPr;
      // 이 문서가 쓰는 이름공간 선언과 "몰라도 되는 확장" 목록을 합본 뿌리에 더한다
      // (글상자·도형의 mc:Choice Requires="wps" 는 뿌리에 선언된 접두사만 알아본다. 없으면 워드가 문서를 손상으로 본다)
      const root = baseDoc.documentElement;
      const from = doc.documentElement;
      for (let a = 0; a < from.attributes.length; a++) {
        const attr = from.attributes[a];
        if (attr.name.startsWith('xmlns:') && !root.hasAttribute(attr.name)) root.setAttribute(attr.name, attr.value);
      }
      const ignorable = new Set(`${root.getAttribute('mc:Ignorable') ?? ''} ${from.getAttribute('mc:Ignorable') ?? ''}`.split(/\s+/).filter((x) => x && root.hasAttribute(`xmlns:${x}`)));
      if (ignorable.size && root.hasAttribute('xmlns:mc')) root.setAttribute('mc:Ignorable', [...ignorable].join(' '));
      additionalRels.push(...mine);
      const name = basename(files[i]);
      if (notes) warnings.push(`${name}: 각주·미주·메모 ${notes}개는 합본으로 옮기지 못했습니다. 본문은 그대로입니다.`);
      if (headers) warnings.push(`${name}: 머리글·바닥글은 옮기지 않았습니다. 합본은 첫 문서의 머리글·바닥글을 씁니다.`);
    } catch (err) {
      failedFiles.push(files[i]);
      logger.warn(`[concat-docx] 실패: ${files[i]} — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!baseZip || !baseDoc || !baseBody) throw new Error('합칠 수 있는 DOCX 파일이 없습니다');

  if (lastSectPr) {
    // 쪽 설정은 마지막 문서 것, 머리글·바닥글 참조는 첫 문서 것 (그 부품만 합본에 있다)
    if (baseSectPr && lastSectPr !== baseSectPr) {
      const first = lastSectPr.firstChild;
      for (const tag of ['headerReference', 'footerReference']) {
        for (const ref of getChildElements(baseSectPr, tag)) lastSectPr.insertBefore(ref.cloneNode(true), first);
      }
    }
    baseBody.appendChild(lastSectPr);
  }

  // 첫 문서에 번호 정의가 없었으면 번호 부품을 문서에 잇는다 (잇지 않으면 뒤 문서의 번호 목록이 번호 없이 나온다)
  if (mergedNumberingXml && !baseZip.file('word/numbering.xml')) {
    additionalRels.push({ id: `rId${nextRelId++}`, type: `${REL_NS}/numbering`, target: 'numbering.xml' });
    addedTypes.push('<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>');
  }

  if (additionalRels.length > 0) {
    const relsFile = baseZip.file('word/_rels/document.xml.rels');
    const relsXml = relsFile
      ? await relsFile.async('text')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    baseZip.file('word/_rels/document.xml.rels', relsXml.replace(/<\/Relationships>\s*$/, () => `${additionalRels.map(relXml).join('\n')}\n</Relationships>`));
  }

  if (addedTypes.length > 0) {
    const typesFile = baseZip.file('[Content_Types].xml');
    if (typesFile) baseZip.file('[Content_Types].xml', (await typesFile.async('text')).replace(/<\/Types>\s*$/, () => `${addedTypes.join('')}</Types>`));
  }

  // 병합된 styles.xml ��기
  if (mergedStylesXml) {
    baseZip.file('word/styles.xml', mergedStylesXml);
  }

  // 병합된 numbering.xml 쓰기
  if (mergedNumberingXml) {
    baseZip.file('word/numbering.xml', mergedNumberingXml);
  }

  const mergedXml = new XMLSerializer().serializeToString(baseDoc);
  baseZip.file('word/document.xml', mergedXml);

  await mkdir(dirname(output_path), { recursive: true });
  const outputBuffer = await baseZip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  await writeFile(output_path, outputBuffer);

  logger.info(`[concat-docx] done → ${output_path} (${outputBuffer.length} bytes, ${failedFiles.length}�� 실패)`);

  return {
    success: true,
    output_path,
    file_count: files.length,
    total_length: outputBuffer.length,
    failed_files: failedFiles,
    ...(warnings.length ? { warnings } : {}),
  };
}
