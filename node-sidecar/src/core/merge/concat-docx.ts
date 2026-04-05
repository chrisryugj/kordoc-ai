/** DOCX 서식 유지 수합 — ZIP+XML body 이어붙이기 + 스타일/넘버링 병합 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
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

function remapRIds(xml: string, offset: number): string {
  return xml.replace(/rId(\d+)/g, (_, num) => `rId${offset + parseInt(num, 10)}`);
}

function parseRels(xml: string): Array<{ id: string; target: string; type: string }> {
  const doc: any = new DOMParser().parseFromString(xml, 'text/xml');
  const rels: Array<{ id: string; target: string; type: string }> = [];
  const elements = doc.getElementsByTagName('Relationship');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    rels.push({
      id: el.getAttribute('Id') || '',
      target: el.getAttribute('Target') || '',
      type: el.getAttribute('Type') || '',
    });
  }
  return rels;
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

/** 두 styles.xml 병합 — 충돌 시 리네이밍 + 교차 참조 리매핑 */
function mergeDocxStyles(
  baseStylesXml: string,
  donorStylesXml: string,
  docIndex: number,
): { mergedStylesXml: string; remap: Map<string, string> } {
  const baseStyles = parseDocxStyles(baseStylesXml);
  const donorStyles = parseDocxStyles(donorStylesXml);
  const remap = new Map<string, string>();
  const newElements: string[] = [];

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

  // 1차: 충돌 감지 + remap 테이블 빌드
  for (const [styleId, fragment] of donorStyles) {
    const baseFragment = baseStyles.get(styleId);

    if (!baseFragment) {
      newElements.push(fragment);
      baseStyles.set(styleId, fragment);
    } else if (normalize(baseFragment) === normalize(fragment)) {
      // 동일: skip
    } else {
      // 충돌: 유니크한 이름 생성
      let newId = `${styleId}_${docIndex}`;
      let suffix = docIndex;
      while (baseStyles.has(newId)) {
        suffix++;
        newId = `${styleId}_${suffix}`;
      }
      remap.set(styleId, newId);
      const escaped = styleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const renamed = fragment
        .replace(`w:styleId="${styleId}"`, `w:styleId="${newId}"`)
        .replace(new RegExp(`w:val="${escaped}"`, 'g'), `w:val="${newId}"`);
      newElements.push(renamed);
      baseStyles.set(newId, renamed);
    }
  }

  // 2차: 모든 donor 신규 스타일에 remap 일괄 적용 (basedOn/next/link 교차 참조)
  if (remap.size > 0) {
    for (let i = 0; i < newElements.length; i++) {
      for (const [oldId, newId] of remap) {
        const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // basedOn, next, link 등 w:val 참조를 리매핑 (이미 자기 자신은 1차에서 처리됨)
        newElements[i] = newElements[i].replace(
          new RegExp(`(<w:(?:basedOn|next|link|numStyleLink|styleLink)\\s+w:val=")${escaped}("\\s*/>)`, 'g'),
          `$1${newId}$2`,
        );
      }
    }
  }

  let result = baseStylesXml;
  if (newElements.length > 0) {
    result = result.replace('</w:styles>', newElements.join('') + '</w:styles>');
  }

  return { mergedStylesXml: result, remap };
}

/** body XML의 스타일 참조 리매��� */
function remapDocxStyleRefs(bodyXml: string, remap: Map<string, string>): string {
  if (remap.size === 0) return bodyXml;
  let result = bodyXml;
  for (const [oldId, newId] of remap) {
    // w:pStyle, w:rStyle, w:tblStyle의 val 속성
    const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(
      new RegExp(`(<w:(?:pStyle|rStyle|tblStyle)\\s+w:val=")${escaped}("\\s*/>)`, 'g'),
      `$1${newId}$2`,
    );
  }
  return result;
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
      .replace(`w:numId="${oldId}"`, `w:numId="${newId}"`);
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

  let mergedXml = baseXml;
  if (abstractNums.length > 0 || nums.length > 0) {
    const insert = [...abstractNums, ...nums].join('');
    mergedXml = mergedXml.replace('</w:numbering>', insert + '</w:numbering>');
  }

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
  let nextRelOffset = 1000;
  const additionalRels: Array<{ id: string; target: string; type: string }> = [];

  // 스타일/넘버링 병합용
  let mergedStylesXml: string | null = null;
  let mergedNumberingXml: string | null = null;

  logger.info(`[concat-docx] ${files.length}개 DOCX 수합 시작`);

  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    sendProgress({
      current: i + 1,
      total: files.length,
      message: `DOCX 수합 ${i + 1}/${files.length}: ${basename(files[i])}`,
    });

    try {
      const buffer = await readFile(files[i]);
      const zip = await JSZip.loadAsync(buffer);

      const docFile = zip.file('word/document.xml');
      if (!docFile) throw new Error('word/document.xml 없음');
      const docXml = await docFile.async('text');

      if (!baseZip) {
        baseZip = zip;
        baseDoc = new DOMParser().parseFromString(docXml, 'text/xml');
        const bodies = getChildElements(baseDoc.documentElement, 'body');
        baseBody = bodies[0] || null;
        if (!baseBody) throw new Error('w:body 없음');

        const sectPrs = getChildElements(baseBody, 'sectPr');
        if (sectPrs.length > 0) {
          lastSectPr = sectPrs[sectPrs.length - 1];
          baseBody.removeChild(lastSectPr);
        }

        // base styles/numbering 읽기
        const stylesFile = zip.file('word/styles.xml');
        if (stylesFile) mergedStylesXml = await stylesFile.async('text');
        const numFile = zip.file('word/numbering.xml');
        if (numFile) mergedNumberingXml = await numFile.async('text');

        continue;
      }

      // ── 추가 파일 ──

      // 스타일 병합
      let styleRemap = new Map<string, string>();
      const donorStylesFile = zip.file('word/styles.xml');
      if (donorStylesFile && mergedStylesXml) {
        const donorStylesXml = await donorStylesFile.async('text');
        const result = mergeDocxStyles(mergedStylesXml, donorStylesXml, i + 1);
        mergedStylesXml = result.mergedStylesXml;
        styleRemap = result.remap;
      }

      // 넘버링 병합
      let numIdRemap = new Map<number, number>();
      const donorNumFile = zip.file('word/numbering.xml');
      if (donorNumFile) {
        const donorNumXml = await donorNumFile.async('text');
        const result = mergeNumbering(mergedNumberingXml, donorNumXml, i);
        mergedNumberingXml = result.mergedXml;
        numIdRemap = result.numIdRemap;
      }

      const doc: any = new DOMParser().parseFromString(docXml, 'text/xml');
      const bodies = getChildElements(doc.documentElement, 'body');
      const body = bodies[0];
      if (!body) { failedFiles.push(files[i]); continue; }

      // page break 삽입
      const breakDoc: any = new DOMParser().parseFromString(PAGE_BREAK, 'text/xml');
      baseBody.appendChild(baseDoc.importNode(breakDoc.documentElement, true));

      // body 자식 복사 (sectPr 제외)
      const children = body.childNodes;
      const currentOffset = nextRelOffset;
      for (let c = 0; c < children.length; c++) {
        const child = children[c];
        if (child.nodeType !== 1) continue;
        if (child.localName === 'sectPr' || child.tagName?.endsWith(':sectPr')) {
          lastSectPr = child;
          continue;
        }
        let serialized = new XMLSerializer().serializeToString(child);
        serialized = remapRIds(serialized, currentOffset);
        serialized = remapDocxStyleRefs(serialized, styleRemap);
        serialized = remapNumIds(serialized, numIdRemap);
        const reimported: any = new DOMParser().parseFromString(serialized, 'text/xml');
        baseBody.appendChild(baseDoc.importNode(reimported.documentElement, true));
      }

      // 관계 파일 처리
      const relsFile = zip.file('word/_rels/document.xml.rels');
      if (relsFile) {
        const relsXml = await relsFile.async('text');
        const rels = parseRels(relsXml);
        for (const rel of rels) {
          additionalRels.push({
            id: `rId${currentOffset + (parseInt(rel.id.replace('rId', ''), 10) || 0)}`,
            target: rel.target,
            type: rel.type,
          });
        }
      }

      // 미디어 파일 복사 (충돌 시 리네이밍 + 관계 타겟 갱신)
      const mediaFiles = Object.keys(zip.files).filter(p => p.startsWith('word/media/'));
      for (const mf of mediaFiles) {
        const content = await zip.file(mf)!.async('uint8array');
        if (baseZip.file(mf)) {
          // 충돌: 리네이밍
          const origName = mf.replace('word/media/', '');
          const dot = origName.lastIndexOf('.');
          const stem = dot > 0 ? origName.substring(0, dot) : origName;
          const ext = dot > 0 ? origName.substring(dot) : '';
          let idx = 2;
          let newName = `${stem}_${idx}${ext}`;
          while (baseZip.file(`word/media/${newName}`)) { idx++; newName = `${stem}_${idx}${ext}`; }
          baseZip.file(`word/media/${newName}`, content);
          // 관계 파일의 타겟도 갱신
          for (const rel of additionalRels) {
            if (rel.target === `media/${origName}`) rel.target = `media/${newName}`;
          }
        } else {
          baseZip.file(mf, content);
        }
      }

      nextRelOffset += 1000;
    } catch (err) {
      failedFiles.push(files[i]);
      logger.warn(`[concat-docx] 실패: ${files[i]} — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!baseZip || !baseDoc || !baseBody) throw new Error('수합할 유효한 DOCX 파일이 없습니다');

  if (lastSectPr) {
    baseBody.appendChild(baseDoc.importNode(lastSectPr, true));
  }

  if (additionalRels.length > 0) {
    const relsFile = baseZip.file('word/_rels/document.xml.rels');
    if (relsFile) {
      let relsXml = await relsFile.async('text');
      const newRels = additionalRels.map(r =>
        `<Relationship Id="${r.id}" Target="${r.target}" Type="${r.type}"/>`,
      ).join('\n');
      relsXml = relsXml.replace('</Relationships>', `${newRels}\n</Relationships>`);
      baseZip.file('word/_rels/document.xml.rels', relsXml);
    }
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
  };
}
