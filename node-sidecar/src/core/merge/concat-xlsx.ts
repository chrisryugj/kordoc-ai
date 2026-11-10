/** XLSX 서식 유지 수합 — 시트 레벨 병합 + 스타일 병합 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname } from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import type { MergeFilesParams, MergeFilesResult } from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function parseXml(text: string): any {
  return new DOMParser().parseFromString(text, 'text/xml');
}

function getElements(parent: any, tagName: string): any[] {
  const nodes = parent.getElementsByTagName(tagName);
  const result: any[] = [];
  for (let i = 0; i < nodes.length; i++) result.push(nodes[i]);
  return result;
}

// ─── shared strings 파싱 ────────────────────────────────

function parseSharedStringsText(xml: string): string[] {
  const doc = parseXml(xml);
  const strings: string[] = [];
  const siList = getElements(doc.documentElement, 'si');
  for (const si of siList) {
    const tElements = getElements(si, 't');
    strings.push(tElements.map((t: any) => t.textContent ?? '').join(''));
  }
  return strings;
}

// ─── workbook 파싱 ──────────────────────────────────────

interface SheetInfo {
  name: string;
  sheetId: string;
  rId: string;
}

function parseWorkbook(xml: string): SheetInfo[] {
  const doc = parseXml(xml);
  const sheets: SheetInfo[] = [];
  const els = getElements(doc.documentElement, 'sheet');
  for (const el of els) {
    sheets.push({
      name: el.getAttribute('name') ?? `Sheet${sheets.length + 1}`,
      sheetId: el.getAttribute('sheetId') ?? '',
      rId: el.getAttribute('r:id') ?? '',
    });
  }
  return sheets;
}

function parseRels(xml: string): Map<string, string> {
  const doc = parseXml(xml);
  const map = new Map<string, string>();
  const rels = getElements(doc.documentElement, 'Relationship');
  for (const rel of rels) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) map.set(id, target);
  }
  return map;
}

function resolveSharedStrings(sheetXml: string, strings: string[]): string {
  return sheetXml.replace(
    /(<c\b[^>]*)\bt="s"([^>]*>)([\s\S]*?<v>)(\d+)(<\/v>[\s\S]*?<\/c>)/g,
    (full, pre, mid, vPre, numStr, vPost) => {
      const idx = parseInt(numStr, 10);
      const text = strings[idx] ?? '';
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `${pre}t="inlineStr"${mid}<is><t>${escaped}</t></is></c>`;
    },
  );
}

const xmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlAttr = (s: string) => xmlText(s).replace(/"/g, '&quot;');
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 엑셀이 받는 시트 이름으로 — \ / ? * [ ] : 는 못 쓰고, 앞뒤 ' 도 안 되고, 31자까지 (파일 이름을 그대로 쓰면 통합 문서가 깨진다) */
export function safeSheetName(raw: string): string {
  const s = raw.replace(/[\\/?*[\]:]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 31).trim();
  return s || 'Sheet';
}

/** existing 은 소문자로 담는다 (엑셀은 시트 이름의 대소문자를 가리지 않는다) */
function uniqueSheetName(name: string, existing: Set<string>): string {
  const base = safeSheetName(name);
  if (!existing.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const tail = ` (${i})`;
    const candidate = base.slice(0, 31 - tail.length).trimEnd() + tail;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
}

/** 수식 속 시트 참조의 이름 바꾸기 ('가 나'!A1 · 가나!A1). 글은 XML 에 적힌 그대로(&amp; 등) 받는다.
 *  합치면서 시트 이름이 바뀌는데 수식을 그대로 두면 다시 계산할 때 다른 파일의 같은 이름 시트 값을 가져온다 */
export function renameSheetRefs(formula: string, renames: Map<string, string>): string {
  if (!renames.size) return formula;
  const table = new Map<string, string>();
  for (const [from, to] of renames) {
    const next = xmlText(`'${to.replace(/'/g, "''")}'!`);
    table.set(xmlText(`'${from.replace(/'/g, "''")}'!`), next);
    if (/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(from)) table.set(xmlText(`${from}!`), next);
  }
  const alt = [...table.keys()].sort((a, b) => b.length - a.length).map(reEsc).join('|');
  return formula.replace(new RegExp(`(?<![\\p{L}\\p{N}_.'\\]])(?:${alt})`, 'gu'), (m) => table.get(m) ?? m);
}

/** 수식 속 이름 정의의 이름 바꾸기 (names 의 열쇠는 소문자). 따옴표 안(글·시트 이름)·대괄호 안(표의 열 이름)과 함수 이름·시트 이름·칸 주소는 건드리지 않는다.
 *  같은 서식의 파일은 같은 이름을 쓴다 → 뒤 파일의 이름을 그대로 두면 그 수식이 앞 파일의 범위를 읽는다 */
export function renameDefinedNames(formula: string, names: Map<string, string>): string {
  if (!names.size) return formula;
  return formula.replace(/"[^"]*"|'[^']*'|\[[^\]]*\]|[^"'[]+/g, (part) => (part[0] === '"' || part[0] === "'" || part[0] === '['
    ? part
    : part.replace(/(?<![\p{L}\p{N}_.\\!$&])[\p{L}_\\][\p{L}\p{N}_.\\]*(?![\p{L}\p{N}_.\\(![])/gu, (id) => names.get(id.toLowerCase()) ?? id)));
}

/** 시트 안의 수식(셀·조건부 서식·유효성 검사)과 문서 안 링크에서 시트 이름·이름 정의 바꾸기 */
function renameInSheet(xml: string, renames: Map<string, string>, names: Map<string, string>): string {
  if (!renames.size && !names.size) return xml;
  return xml
    .replace(/(<(f|formula|formula1|formula2)\b[^>]*>)([^<]*)(<\/\2>)/g, (_, open, _tag, body, close) => open + renameDefinedNames(renameSheetRefs(body, renames), names) + close)
    .replace(/(<hyperlink\b[^>]*\blocation=")([^"]*)(")/g, (_, a, loc, z) => a + renameSheetRefs(loc, renames) + z);
}

/** 옮기지 않는 딸린 부품의 종류 → 안내에 쓸 말 (인쇄 설정·메모 도형 틀은 알릴 것이 없다) */
const PART_LABEL: Record<string, string> = { drawing: '그림·도형·차트', comments: '메모', table: '표 서식', pivotTable: '피벗 테이블', oleObject: '삽입 개체', control: '양식 단추', image: '배경 그림' };

/** 뒤에 붙는 파일의 시트: 딸린 부품(그림·메모·표·인쇄 설정)은 옮기지 않는다 → 바깥 링크만 남기고 그 부품을 가리키는 곳을 지운다.
 *  남겨 두면 첫 파일의 같은 이름 부품(다른 문서의 그림)이 붙거나 없는 부품을 가리켜 엑셀이 복구 창을 띄운다 */
function dropParts(sheetXml: string, relsXml: string | null): { xml: string; rels: string | null; dropped: string[] } {
  if (!relsXml) return { xml: sheetXml, rels: null, dropped: [] };
  const gone = new Set<string>();
  const dropped = new Set<string>();
  let kept = 0;
  const rels = relsXml.replace(/<Relationship\b[^>]*?\/?>(?:\s*<\/Relationship>)?/g, (el) => {
    if (/\bTargetMode="External"/.test(el)) { kept++; return el; }
    const id = el.match(/\bId="([^"]*)"/)?.[1];
    if (id) gone.add(id);
    const label = PART_LABEL[el.match(/\bType="[^"]*\/([^"/]+)"/)?.[1] ?? ''];
    if (label) dropped.add(label);
    return '';
  });
  if (!gone.size) return { xml: sheetXml, rels: relsXml, dropped: [] };
  const refs = (s: string) => [...s.matchAll(/\br:id="([^"]*)"/g)].some((m) => gone.has(m[1]));
  const xml = sheetXml
    .replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/g, (b) => (refs(b) ? '' : b))
    .replace(/<(tableParts|oleObjects|controls|customProperties|webPublishItems)\b[^>]*>[\s\S]*?<\/\1>/g, (b) => (refs(b) ? '' : b))
    .replace(/<pageSetup\b[^>]*\/>/g, (el) => el.replace(/\s+r:id="([^"]*)"/, (a, id) => (gone.has(id) ? '' : a)))
    .replace(/<[\w:]+\b[^>]*\br:id="([^"]*)"[^>]*\/>/g, (el, id) => (gone.has(id) ? '' : el));
  return { xml, rels: kept ? rels : null, dropped: [...dropped] };
}

function patchWorkbook(originalXml: string, sheetEntries: Array<{ name: string; rId: string; sheetId: number }>, definedNames: string[] = []): string {
  const sheetsContent = sheetEntries.map(s =>
    `<sheet name="${xmlAttr(s.name)}" sheetId="${s.sheetId}" r:id="${s.rId}"/>`,
  ).join('');
  let xml = originalXml.replace(/<sheets>[\s\S]*?<\/sheets>/, () => `<sheets>${sheetsContent}</sheets>`);
  // 이름 정의(인쇄 영역·인쇄 제목 포함)는 시트 번호와 시트 이름이 바뀐 대로 다시 적는다
  const block = definedNames.length ? `<definedNames>${definedNames.join('')}</definedNames>` : '';
  if (/<definedNames\b/.test(xml)) xml = xml.replace(/<definedNames\b[^>]*>[\s\S]*?<\/definedNames>|<definedNames\b[^>]*\/>/, () => block);
  else if (block) xml = xml.replace(xml.includes('</externalReferences>') ? '</externalReferences>' : '</sheets>', (m) => m + block);
  return xml;
}

function patchWorkbookRels(originalXml: string, sheetEntries: Array<{ rId: string; target: string }>): string {
  const WORKSHEET_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
  let patched = originalXml.replace(
    new RegExp(`<Relationship[^>]*Type="${WORKSHEET_TYPE.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}"[^>]*/?>`, 'g'),
    '',
  );
  const newRels = sheetEntries.map(s =>
    `<Relationship Id="${s.rId}" Target="${s.target}" Type="${WORKSHEET_TYPE}"/>`,
  ).join('');
  return patched.replace('</Relationships>', `${newRels}</Relationships>`);
}

function patchContentTypes(originalXml: string, sheetEntries: Array<{ target: string }>): string {
  const SHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  const escapedCT = SHEET_CT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let patched = originalXml.replace(
    new RegExp(`<Override[^>]*ContentType="${escapedCT}"[^>]*/?>`, 'g'),
    '',
  );
  const newOverrides = sheetEntries.map(s =>
    `<Override PartName="/xl/${s.target}" ContentType="${SHEET_CT}"/>`,
  ).join('');
  return patched.replace('</Types>', `${newOverrides}</Types>`);
}

// ─── styles.xml 파싱 + 병합 ────────────────────────────

interface ParsedStyles {
  numFmts: Array<{ id: number; xml: string }>;
  fonts: string[];
  fills: string[];
  borders: string[];
  cellStyleXfs: string[];
  cellXfs: string[];
  dxfs: string[];
}

/** 부모 블록 안에서만 자식 요소 추출 (dxfs 등과의 혼동 방지) */
function extractFromBlock(xml: string, blockTag: string, childTag: string): string[] {
  const blockRe = new RegExp(`<${blockTag}\\b[^>]*>([\\s\\S]*?)<\\/${blockTag}>`);
  const blockMatch = xml.match(blockRe);
  if (!blockMatch) return [];
  const block = blockMatch[1];
  const items: string[] = [];
  const re = new RegExp(`<${childTag}\\b(?:[^>]*/>|[\\s\\S]*?<\\/${childTag}>)`, 'g');
  let m;
  while ((m = re.exec(block))) items.push(m[0]);
  return items;
}

/** styles.xml 전체 파싱 — 각 블록 범위 제한 */
function parseStylesXmlFull(xml: string): ParsedStyles {
  // numFmts
  const numFmts: Array<{ id: number; xml: string }> = [];
  const nfBlock = xml.match(/<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/);
  if (nfBlock) {
    const nfRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*\/?>/g;
    let nfm;
    while ((nfm = nfRe.exec(nfBlock[1]))) {
      numFmts.push({ id: parseInt(nfm[1], 10), xml: nfm[0] });
    }
  }

  return {
    numFmts,
    fonts: extractFromBlock(xml, 'fonts', 'font'),
    fills: extractFromBlock(xml, 'fills', 'fill'),
    borders: extractFromBlock(xml, 'borders', 'border'),
    cellStyleXfs: extractFromBlock(xml, 'cellStyleXfs', 'xf'),
    cellXfs: extractFromBlock(xml, 'cellXfs', 'xf'),
    dxfs: extractFromBlock(xml, 'dxfs', 'dxf'),
  };
}

/** 두 styles 병합 + cellXf 리매핑 테이블 */
function mergeXlsxStyles(
  base: ParsedStyles,
  donor: ParsedStyles,
): { merged: ParsedStyles; cellXfRemap: Map<number, number>; dxfOffset: number } {
  // 헬퍼: XML 문자열 정규화 (공백 차이 무시)
  // XML 정규화: 공백 + 속성 순서 + 자식 요소 순서 정규화
  const normalize = (s: string): string => {
    // 1. 공백 정규화
    let n = s.replace(/\s+/g, ' ').trim();
    // 2. self-closing 일관화: <tag /> → <tag/>
    n = n.replace(/\s+\/>/g, '/>');
    // 3. 각 태그의 속성을 알파벳 순 정렬
    n = n.replace(/<(\w+)((?:\s+[\w:]+="[^"]*")+)\s*(\/?)>/g, (_, tag, attrs, close) => {
      const sorted = (attrs.match(/\s+[\w:]+="[^"]*"/g) || [])
        .map((a: string) => a.trim())
        .sort()
        .join(' ');
      return `<${tag} ${sorted}${close}>`;
    });
    return n;
  };

  // ── numFmts ──
  const mergedNumFmts = [...base.numFmts];
  const numFmtRemap = new Map<number, number>();
  let nextCustomNumFmtId = Math.max(164, ...base.numFmts.map(n => n.id + 1));

  for (const dnf of donor.numFmts) {
    if (dnf.id < 164) {
      // 빌트인: 리매핑 불필요
      numFmtRemap.set(dnf.id, dnf.id);
      continue;
    }
    // 동일 formatCode 존재하면 재사용
    const existing = mergedNumFmts.find(b => {
      const bCode = b.xml.match(/formatCode="([^"]*)"/)?.[1];
      const dCode = dnf.xml.match(/formatCode="([^"]*)"/)?.[1];
      return bCode && dCode && bCode === dCode;
    });
    if (existing) {
      numFmtRemap.set(dnf.id, existing.id);
    } else {
      const newId = nextCustomNumFmtId++;
      numFmtRemap.set(dnf.id, newId);
      mergedNumFmts.push({
        id: newId,
        xml: dnf.xml.replace(/numFmtId="\d+"/, `numFmtId="${newId}"`),
      });
    }
  }

  // ── 위치 기반 배열 병합 (fonts, fills, borders) ──
  const mergePositional = (baseArr: string[], donorArr: string[]): { merged: string[]; remap: Map<number, number> } => {
    const merged = [...baseArr];
    const remap = new Map<number, number>();

    for (let i = 0; i < donorArr.length; i++) {
      const norm = normalize(donorArr[i]);
      const existingIdx = merged.findIndex(b => normalize(b) === norm);
      if (existingIdx >= 0) {
        remap.set(i, existingIdx);
      } else {
        remap.set(i, merged.length);
        merged.push(donorArr[i]);
      }
    }
    return { merged, remap };
  };

  const fonts = mergePositional(base.fonts, donor.fonts);
  const fills = mergePositional(base.fills, donor.fills);
  const borders = mergePositional(base.borders, donor.borders);

  // ── cellStyleXfs — 내용 비교 + sub-index 리매핑 ──
  const mergedCellStyleXfs = [...base.cellStyleXfs];
  const cellStyleXfRemap = new Map<number, number>();

  const remapXfSubIds = (xf: string): string => {
    let result = xf;
    result = result.replace(/\bfontId="(\d+)"/, (_, n) => `fontId="${fonts.remap.get(parseInt(n, 10)) ?? parseInt(n, 10)}"`);
    result = result.replace(/\bfillId="(\d+)"/, (_, n) => `fillId="${fills.remap.get(parseInt(n, 10)) ?? parseInt(n, 10)}"`);
    result = result.replace(/\bborderId="(\d+)"/, (_, n) => `borderId="${borders.remap.get(parseInt(n, 10)) ?? parseInt(n, 10)}"`);
    result = result.replace(/\bnumFmtId="(\d+)"/, (_, n) => { const o = parseInt(n, 10); return `numFmtId="${numFmtRemap.get(o) ?? o}"`; });
    return result;
  };

  for (let i = 0; i < donor.cellStyleXfs.length; i++) {
    const remapped = remapXfSubIds(donor.cellStyleXfs[i]);
    const norm = normalize(remapped);
    const existingIdx = mergedCellStyleXfs.findIndex(b => normalize(b) === norm);
    if (existingIdx >= 0) {
      cellStyleXfRemap.set(i, existingIdx);
    } else {
      cellStyleXfRemap.set(i, mergedCellStyleXfs.length);
      mergedCellStyleXfs.push(remapped);
    }
  }

  // ── cellXfs — donor의 xf를 리매핑 후 병합 ──
  const mergedCellXfs = [...base.cellXfs];
  const cellXfRemap = new Map<number, number>();

  for (let i = 0; i < donor.cellXfs.length; i++) {
    let xf = donor.cellXfs[i];

    // fontId 리매핑
    xf = xf.replace(/\bfontId="(\d+)"/, (_, n) => {
      const newIdx = fonts.remap.get(parseInt(n, 10)) ?? parseInt(n, 10);
      return `fontId="${newIdx}"`;
    });
    // fillId 리매핑
    xf = xf.replace(/\bfillId="(\d+)"/, (_, n) => {
      const newIdx = fills.remap.get(parseInt(n, 10)) ?? parseInt(n, 10);
      return `fillId="${newIdx}"`;
    });
    // borderId 리매핑
    xf = xf.replace(/\bborderId="(\d+)"/, (_, n) => {
      const newIdx = borders.remap.get(parseInt(n, 10)) ?? parseInt(n, 10);
      return `borderId="${newIdx}"`;
    });
    // numFmtId 리매핑
    xf = xf.replace(/\bnumFmtId="(\d+)"/, (_, n) => {
      const oldId = parseInt(n, 10);
      const newId = numFmtRemap.get(oldId) ?? oldId;
      return `numFmtId="${newId}"`;
    });
    // xfId 리매핑
    xf = xf.replace(/\bxfId="(\d+)"/, (_, n) => {
      const newIdx = cellStyleXfRemap.get(parseInt(n, 10)) ?? parseInt(n, 10);
      return `xfId="${newIdx}"`;
    });

    // 중복 체크
    const norm = normalize(xf);
    const existingIdx = mergedCellXfs.findIndex(b => normalize(b) === norm);
    if (existingIdx >= 0) {
      cellXfRemap.set(i, existingIdx);
    } else {
      cellXfRemap.set(i, mergedCellXfs.length);
      mergedCellXfs.push(xf);
    }
  }

  // ── dxfs (조건부 서식) — donor 것을 base 뒤에 추가 ──
  const mergedDxfs = [...base.dxfs];
  const dxfOffset = base.dxfs.length;
  for (const dxf of donor.dxfs) {
    mergedDxfs.push(dxf);
  }

  return {
    merged: {
      numFmts: mergedNumFmts,
      fonts: fonts.merged,
      fills: fills.merged,
      borders: borders.merged,
      cellStyleXfs: mergedCellStyleXfs,
      cellXfs: mergedCellXfs,
      dxfs: mergedDxfs,
    },
    cellXfRemap,
    dxfOffset,
  };
}

/** 시트 XML의 dxfId 속성 리매핑 (조건부 서식) */
function remapDxfIds(sheetXml: string, offset: number): string {
  if (offset === 0) return sheetXml;
  return sheetXml.replace(
    /\bdxfId="(\d+)"/g,
    (_, num) => `dxfId="${parseInt(num, 10) + offset}"`,
  );
}

/** 시트 XML의 셀+행 s 속성 리매핑 */
function remapCellStyles(sheetXml: string, remap: Map<number, number>): string {
  if (remap.size === 0) return sheetXml;
  // <c> 셀과 <row> 행 모두 처리
  return sheetXml.replace(
    /(<(?:c|row)\b[^>]*)\bs="(\d+)"/g,
    (full, pre, num) => {
      const oldIdx = parseInt(num, 10);
      const newIdx = remap.get(oldIdx) ?? oldIdx;
      return `${pre}s="${newIdx}"`;
    },
  );
}

/** 병합된 스타일을 원본 styles.xml에 패치 */
function patchStylesXml(originalXml: string, merged: ParsedStyles): string {
  let xml = originalXml;

  // numFmts
  if (merged.numFmts.length > 0) {
    const numFmtsContent = merged.numFmts.map(n => n.xml).join('');
    if (xml.includes('<numFmts')) {
      xml = xml.replace(/<numFmts[^>]*>[\s\S]*?<\/numFmts>/, `<numFmts count="${merged.numFmts.length}">${numFmtsContent}</numFmts>`);
    } else {
      // numFmts가 없으면 fonts 앞에 삽입
      xml = xml.replace(/<fonts\b/, `<numFmts count="${merged.numFmts.length}">${numFmtsContent}</numFmts><fonts`);
    }
  }

  // fonts
  const fontsContent = merged.fonts.join('');
  xml = xml.replace(/<fonts[^>]*>[\s\S]*?<\/fonts>/, `<fonts count="${merged.fonts.length}">${fontsContent}</fonts>`);

  // fills
  const fillsContent = merged.fills.join('');
  xml = xml.replace(/<fills[^>]*>[\s\S]*?<\/fills>/, `<fills count="${merged.fills.length}">${fillsContent}</fills>`);

  // borders
  const bordersContent = merged.borders.join('');
  xml = xml.replace(/<borders[^>]*>[\s\S]*?<\/borders>/, `<borders count="${merged.borders.length}">${bordersContent}</borders>`);

  // cellStyleXfs
  if (merged.cellStyleXfs.length > 0) {
    const csxContent = merged.cellStyleXfs.join('');
    xml = xml.replace(/<cellStyleXfs[^>]*>[\s\S]*?<\/cellStyleXfs>/, `<cellStyleXfs count="${merged.cellStyleXfs.length}">${csxContent}</cellStyleXfs>`);
  }

  // cellXfs
  const cxContent = merged.cellXfs.join('');
  xml = xml.replace(/<cellXfs[^>]*>[\s\S]*?<\/cellXfs>/, `<cellXfs count="${merged.cellXfs.length}">${cxContent}</cellXfs>`);

  // dxfs (조건부 서식)
  if (merged.dxfs.length > 0) {
    const dxfContent = merged.dxfs.join('');
    if (xml.includes('<dxfs')) {
      xml = xml.replace(/<dxfs[^>]*>[\s\S]*?<\/dxfs>/, `<dxfs count="${merged.dxfs.length}">${dxfContent}</dxfs>`);
    } else {
      // dxfs 블록이 없으면 cellXfs 뒤에 삽입
      xml = xml.replace(/<\/cellXfs>/, `</cellXfs><dxfs count="${merged.dxfs.length}">${dxfContent}</dxfs>`);
    }
  }

  return xml;
}

// ─── 메인 함수 ─────────────────────────────────────────

export async function concatXlsx(
  params: MergeFilesParams,
  signal: AbortSignal,
): Promise<MergeFilesResult> {
  const { files, output_path } = params;
  const failedFiles: string[] = [];

  const collectedSheets: Array<{
    name: string;
    xml: string;
    relsXml: string | null;
  }> = [];
  const usedSheetNames = new Set<string>();
  const warnings: string[] = [];
  /** 합본에 실을 이름 정의(<definedName …>…</definedName>)와 통합 문서 범위 이름(소문자) */
  const definedNames: string[] = [];
  const globalNames = new Set<string>();

  let baseZip: JSZip | null = null;
  let baseWorkbookXml = '';
  let baseRelsXml = '';
  let baseContentTypesXml = '';
  let baseStylesXml = '';
  let mergedStyles: ParsedStyles | null = null;

  logger.info(`[concat-xlsx] ${files.length}개 XLSX 수합 시작`);

  for (let fi = 0; fi < files.length; fi++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    sendProgress({
      current: fi + 1,
      total: files.length,
      message: `XLSX 합치는 중 ${fi + 1}/${files.length}: ${basename(files[fi])}`,
    });

    try {
      const buffer = await readFile(files[fi]);
      const zip = await JSZip.loadAsync(buffer);
      const isFirst = !baseZip;

      if (isFirst) {
        baseZip = zip;
        const wbFile = zip.file('xl/workbook.xml');
        if (wbFile) baseWorkbookXml = await wbFile.async('text');
        const relsFile = zip.file('xl/_rels/workbook.xml.rels');
        if (relsFile) baseRelsXml = await relsFile.async('text');
        const ctFile = zip.file('[Content_Types].xml');
        if (ctFile) baseContentTypesXml = await ctFile.async('text');
        // 스타일 파싱
        const stylesFile = zip.file('xl/styles.xml');
        if (stylesFile) {
          baseStylesXml = await stylesFile.async('text');
          mergedStyles = parseStylesXmlFull(baseStylesXml);
        }
      }

      // 추가 파일의 shared strings + styles
      let sharedStrings: string[] = [];
      let cellXfRemap = new Map<number, number>();
      let dxfOffset = 0;

      if (!isFirst) {
        const ssFile = zip.file('xl/sharedStrings.xml');
        if (ssFile) {
          sharedStrings = parseSharedStringsText(await ssFile.async('text'));
        }

        // 스타일 병합
        const stylesFile = zip.file('xl/styles.xml');
        if (stylesFile && mergedStyles) {
          const donorStylesXml = await stylesFile.async('text');
          const donorStyles = parseStylesXmlFull(donorStylesXml);
          const result = mergeXlsxStyles(mergedStyles, donorStyles);
          mergedStyles = result.merged;
          cellXfRemap = result.cellXfRemap;
          dxfOffset = result.dxfOffset;
        }
      }

      const wbFile = zip.file('xl/workbook.xml');
      if (!wbFile) { failedFiles.push(files[fi]); continue; }
      const workbookXml = await wbFile.async('text');
      const sheets = parseWorkbook(workbookXml);

      const relsFile = zip.file('xl/_rels/workbook.xml.rels');
      const relsMap = relsFile ? parseRels(await relsFile.async('text')) : new Map<string, string>();

      const fileBaseName = basename(files[fi], extname(files[fi]));
      // 이 파일의 시트가 합본에서 받을 이름을 먼저 정한다 (같은 파일 안의 수식이 서로의 새 이름을 알아야 한다)
      const renames = new Map<string, string>();
      const finalNames = sheets.map((sheet) => {
        const finalName = uniqueSheetName(files.length > 1 && sheets.length === 1 ? fileBaseName : sheet.name, usedSheetNames);
        usedSheetNames.add(finalName.toLowerCase());
        if (finalName !== sheet.name) renames.set(sheet.name, finalName);
        return finalName;
      });
      // 통합 문서 범위의 이름 정의가 앞 파일과 겹치면 새 이름으로 (이 파일의 수식도 그 이름으로 바꾼다)
      const definedHere = [...workbookXml.matchAll(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g)];
      const nameRenames = new Map<string, string>();
      for (const m of definedHere) {
        if (/\blocalSheetId="/.test(m[1])) continue;
        const own = m[1].match(/\bname="([^"]*)"/)?.[1] ?? '';
        // 엑셀이 정해 둔 이름(_xlnm.…)은 이름을 바꿀 수 없다 → 겹치면 아래에서 뺀다
        if (own.startsWith('_xlnm.')) continue;
        let name = own;
        for (let n = 2; globalNames.has(name.toLowerCase()); n++) name = `${own}_${n}`;
        globalNames.add(name.toLowerCase());
        if (name !== own) nameRenames.set(own.toLowerCase(), name);
      }
      /** 이 파일의 시트 차례 → 합본의 시트 차례 (이름 정의의 localSheetId) */
      const placed = new Map<number, number>();
      const droppedParts = new Set<string>();
      let chartSheets = 0;
      for (const [si, sheet] of sheets.entries()) {
        let target = (relsMap.get(sheet.rId) || `worksheets/sheet${sheet.sheetId}.xml`).replace(/^\//, '');
        if (!target.startsWith('xl/')) target = 'xl/' + target;
        // 차트 시트·매크로 시트는 워크시트가 아니다 (워크시트로 실으면 통합 문서가 깨진다)
        if (!target.startsWith('xl/worksheets/')) { chartSheets++; continue; }

        const sheetFile = zip.file(target);
        if (!sheetFile) continue;

        let sheetXml = renameInSheet(await sheetFile.async('text'), renames, nameRenames);

        // 첫 파일: 원본 그대로, 추가 파일: shared string → 인라인 + 스타일 리매핑
        if (!isFirst) {
          if (sharedStrings.length > 0) {
            sheetXml = resolveSharedStrings(sheetXml, sharedStrings);
          }
          if (cellXfRemap.size > 0) {
            sheetXml = remapCellStyles(sheetXml, cellXfRemap);
          }
          if (dxfOffset > 0) {
            sheetXml = remapDxfIds(sheetXml, dxfOffset);
          }
        }

        const sheetRelsPath = target.replace(/([^/]+)$/, '_rels/$1.rels');
        const sheetRelsFile = zip.file(sheetRelsPath);
        let sheetRelsContent = sheetRelsFile ? await sheetRelsFile.async('text') : null;
        if (!isFirst) {
          const cut = dropParts(sheetXml, sheetRelsContent);
          sheetXml = cut.xml;
          sheetRelsContent = cut.rels;
          cut.dropped.forEach((x) => droppedParts.add(x));
        }

        placed.set(si, collectedSheets.length);
        collectedSheets.push({ name: finalNames[si], xml: sheetXml, relsXml: sheetRelsContent });
      }

      // 이름 정의: 시트에 딸린 것(인쇄 영역·인쇄 제목)은 새 시트 번호로, 통합 문서 범위는 위에서 정한 이름으로
      for (const m of definedHere) {
        const local = m[1].match(/\blocalSheetId="(\d+)"/);
        const body = renameDefinedNames(renameSheetRefs(m[2], renames), nameRenames);
        if (local) {
          const at = placed.get(parseInt(local[1], 10));
          if (at !== undefined) definedNames.push(`<definedName${m[1].replace(/\blocalSheetId="\d+"/, `localSheetId="${at}"`)}>${body}</definedName>`);
          continue;
        }
        const builtin = m[1].match(/\bname="(_xlnm\.[^"]*)"/)?.[1].toLowerCase();
        if (builtin) {
          if (globalNames.has(builtin)) continue;
          globalNames.add(builtin);
        }
        const attrs = m[1].replace(/\bname="([^"]*)"/, (all, own: string) => (nameRenames.has(own.toLowerCase()) ? `name="${nameRenames.get(own.toLowerCase())}"` : all));
        definedNames.push(`<definedName${attrs}>${body}</definedName>`);
      }
      const fileName = basename(files[fi]);
      if (droppedParts.size) {
        const what = [...droppedParts].join(', ');
        const last = what.charCodeAt(what.length - 1) - 0xac00;
        warnings.push(`${fileName}: ${what}${last >= 0 && last <= 11171 && last % 28 ? '은' : '는'} 합본으로 옮기지 못했습니다. 글자·숫자·서식·수식은 그대로입니다.`);
      }
      if (chartSheets) warnings.push(`${fileName}: 차트 시트 ${chartSheets}개는 넣지 못했습니다.`);
    } catch (err) {
      failedFiles.push(files[fi]);
      logger.warn(`[concat-xlsx] 실패: ${files[fi]} — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!baseZip || collectedSheets.length === 0) throw new Error('합칠 수 있는 XLSX 파일이 없습니다');

  // ── 출력 ZIP 구성 ──

  const sheetEntries: Array<{ name: string; target: string; rId: string; sheetId: number }> = [];

  const existingSheets = Object.keys(baseZip.files).filter(p =>
    (p.startsWith('xl/worksheets/') && p.endsWith('.xml')) ||
    (p.startsWith('xl/worksheets/_rels/') && p.endsWith('.xml.rels')),
  );
  for (const p of existingSheets) baseZip.remove(p);

  if (baseZip.file('xl/calcChain.xml')) baseZip.remove('xl/calcChain.xml');

  for (let i = 0; i < collectedSheets.length; i++) {
    const sheetPath = `xl/worksheets/sheet${i + 1}.xml`;
    baseZip.file(sheetPath, collectedSheets[i].xml);
    const sheetRels = collectedSheets[i].relsXml;
    if (sheetRels) {
      baseZip.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, sheetRels);
    }
    sheetEntries.push({
      name: collectedSheets[i].name,
      target: `worksheets/sheet${i + 1}.xml`,
      rId: `rId${100 + i}`,
      sheetId: i + 1,
    });
  }

  if (baseWorkbookXml) {
    baseZip.file('xl/workbook.xml', patchWorkbook(baseWorkbookXml, sheetEntries, definedNames));
  }

  if (baseRelsXml) {
    let patchedRels = patchWorkbookRels(baseRelsXml, sheetEntries);
    patchedRels = patchedRels.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/?>/g, '');
    baseZip.file('xl/_rels/workbook.xml.rels', patchedRels);
  }

  if (baseContentTypesXml) {
    let ct = baseContentTypesXml.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/?>/g, '');
    baseZip.file('[Content_Types].xml', patchContentTypes(ct, sheetEntries));
  }

  // 병합된 styles.xml 쓰기
  if (mergedStyles && baseStylesXml) {
    baseZip.file('xl/styles.xml', patchStylesXml(baseStylesXml, mergedStyles));
  }

  await mkdir(dirname(output_path), { recursive: true });
  const outputBuffer = await baseZip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  await writeFile(output_path, outputBuffer);

  logger.info(`[concat-xlsx] done → ${output_path} (${outputBuffer.length} bytes, ${collectedSheets.length} sheets, ${failedFiles.length}개 실패)`);

  return {
    success: true,
    output_path,
    file_count: files.length,
    total_length: outputBuffer.length,
    failed_files: failedFiles,
    ...(warnings.length ? { warnings } : {}),
  };
}
