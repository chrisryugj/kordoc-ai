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

function uniqueSheetName(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name;
  let i = 2;
  while (existing.has(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}

function patchWorkbook(originalXml: string, sheetEntries: Array<{ name: string; rId: string; sheetId: number }>): string {
  const sheetsContent = sheetEntries.map(s =>
    `<sheet name="${s.name.replace(/"/g, '&quot;')}" sheetId="${s.sheetId}" r:id="${s.rId}"/>`,
  ).join('');
  return originalXml.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheetsContent}</sheets>`);
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
      message: `XLSX 수합 ${fi + 1}/${files.length}: ${basename(files[fi])}`,
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
      const sheets = parseWorkbook(await wbFile.async('text'));

      const relsFile = zip.file('xl/_rels/workbook.xml.rels');
      const relsMap = relsFile ? parseRels(await relsFile.async('text')) : new Map<string, string>();

      const fileBaseName = basename(files[fi], extname(files[fi]));
      for (const sheet of sheets) {
        let target = relsMap.get(sheet.rId) || `worksheets/sheet${sheet.sheetId}.xml`;
        if (!target.startsWith('xl/')) target = 'xl/' + target;

        const sheetFile = zip.file(target);
        if (!sheetFile) continue;

        let sheetXml = await sheetFile.async('text');

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
        const sheetRelsContent = sheetRelsFile ? await sheetRelsFile.async('text') : null;

        const rawName = files.length > 1 && sheets.length === 1
          ? fileBaseName
          : sheet.name;
        const finalName = uniqueSheetName(rawName, usedSheetNames);
        usedSheetNames.add(finalName);

        collectedSheets.push({ name: finalName, xml: sheetXml, relsXml: sheetRelsContent });
      }
    } catch (err) {
      failedFiles.push(files[fi]);
      logger.warn(`[concat-xlsx] 실패: ${files[fi]} — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!baseZip || collectedSheets.length === 0) throw new Error('수합할 유효한 XLSX 파일이 없습니다');

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
    baseZip.file('xl/workbook.xml', patchWorkbook(baseWorkbookXml, sheetEntries));
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
  };
}
