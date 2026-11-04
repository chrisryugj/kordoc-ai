/** 한글 문서 손질 — 도장 찍기(seal) · 고친 글 반영(patch_document) · HWPX 구조 검사(validate_hwpx) */

import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import JSZip from 'jszip';
import { patchHwp, patchHwpx, placeSealHwpx, scanSectionXml, validateHwpx, type ScanTable } from 'kordoc';
import { formatOf } from '../files/format.js';
import { outputFile, stemOf } from '../output/index.js';

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const SEAL_EXT = new Set(['png', 'jpg', 'jpeg', 'bmp', 'gif']);

/** 도장 자리 글을 찾을 문단 — kordoc place_seal 과 같은 차례(구역마다 본문·표 칸 문단을 문서 위치 순)라 등장 차례(occurrence)를 맞게 센다 */
async function sealTexts(doc: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(doc);
  const sections = Object.keys(zip.files)
    .filter((n) => /[Ss]ection\d+\.xml$/i.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/i)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/i)?.[1] ?? 0));
  const out: string[] = [];
  for (const [si, name] of sections.entries()) {
    const scan = scanSectionXml(await zip.file(name)!.async('text'), si);
    const paras = [...scan.bodyParagraphs];
    const walk = (tables: ScanTable[], depth: number) => {
      if (depth > 16) return;
      for (const t of tables) for (const row of t.rows) for (const cell of row) { paras.push(...cell.paragraphs); walk(cell.tables, depth + 1); }
    };
    walk(scan.tables, 0);
    walk(scan.orphanTables, 0);
    paras.sort((a, b) => a.start - b.start);
    out.push(...paras.map((p) => p.text));
  }
  return out;
}

/** 자리 글 꼴 — 띄어쓰기·전각 괄호가 달라도 찾는다 ("( 인 )"·"（인）") */
function anchorPattern(anchor: string): RegExp {
  const parts = [...anchor.replace(/\s+/g, '')].map((ch) => (ch === '(' || ch === '（' ? '[(（]' : ch === ')' || ch === '）' ? '[)）]' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp(parts.join('\\s*'));
}

const IN_ANCHOR = /^[(（]\s*인\s*[)）]$/;
/** "(인)" 이 없을 때 차례로 볼 서명 자리 */
const SIGN_ANCHORS = ['(서명 또는 인)', '(서명)'];
/** 발신명의 끝말 (행정기관의 장) — "가온시장"·"가온도지사"·"가온교육청 교육감" 같은 한 줄 */
const HEAD_TITLE = /(?:도지사|시장|군수|구청장|교육감|교육장|청장|장관|처장|위원장|원장|총장|이사장|본부장|센터장|관장|소장|사장)$/;

/** 문단 가운데 발신명의로 보이는 마지막 줄 (짧은 한 줄, 기관 이름 + 장의 직함) */
function senderIndex(texts: string[]): number {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i].replace(/\s+/g, '');
    const m = HEAD_TITLE.exec(t);
    if (m && t.length <= 20 && t.length > m[0].length && /^[가-힣○◯]+$/.test(t)) return i;
  }
  return -1;
}

const countOf = (text: string, ch: string) => text.split(ch).length - 1;

/** 찍을 자리 고르기 — 적은 글(꼴이 조금 달라도) → "(인)" 이면 서명 자리 → 발신명의 끝 글자 */
function pickAnchor(texts: string[], anchor: string): { anchor: string; occurrence: number; mode?: 'overlap' } | null {
  const tries = IN_ANCHOR.test(anchor) ? [anchor, ...SIGN_ANCHORS] : [anchor];
  for (const a of tries) {
    if (texts.some((t) => t.includes(a))) return { anchor: a, occurrence: 0 };
    const re = anchorPattern(a);
    for (const t of texts) {
      const m = re.exec(t);
      // 처음 맞은 꼴은 그보다 앞에 같은 글이 없다 (있으면 앞에서 맞았다) → 0번째
      if (m) return { anchor: m[0], occurrence: 0 };
    }
  }
  if (!IN_ANCHOR.test(anchor)) return null;
  // 관인은 발신명의의 마지막 글자가 인영의 가운데에 오도록 찍는다 (행정업무운영 편람)
  const i = senderIndex(texts);
  if (i < 0) return null;
  const last = texts[i].trimEnd().slice(-1);
  const before = texts.slice(0, i).reduce((n, t) => n + countOf(t, last), 0);
  return { anchor: last, occurrence: before + countOf(texts[i], last) - 1, mode: 'overlap' };
}

export async function seal(p: { path: string; image_path: string; anchor: string; output_path?: string }): Promise<{ output_path: string; placed: number; anchor?: string; reason?: string }> {
  if (formatOf(p.path) !== 'hwpx') throw new Error('도장은 HWPX 문서에만 찍을 수 있습니다. 한글에서 HWPX로 저장해 넣으세요.');
  const ext = extname(p.image_path).slice(1).toLowerCase();
  if (!SEAL_EXT.has(ext)) throw new Error('도장 그림은 PNG·JPG 파일로 넣으세요. 배경이 투명한 PNG가 좋습니다.');
  const anchor = p.anchor?.trim() || '(인)';
  const [doc, image] = await Promise.all([readFile(p.path), readFile(p.image_path)]);
  const pick = pickAnchor(await sealTexts(doc), anchor);
  if (!pick) {
    return {
      output_path: '',
      placed: 0,
      reason: IN_ANCHOR.test(anchor)
        ? '문서에서 (인) 자리나 발신명의(예: ○○시장)를 찾지 못해 찍지 않았습니다. 편집기에서 도장 찍을 곳에 (인)을 넣고 다시 하세요.'
        : `문서에서 "${anchor}" 글자를 찾지 못해 찍지 않았습니다. 문서에 쓰인 글자 그대로 넣어 보세요.`,
    };
  }
  let r: Awaited<ReturnType<typeof placeSealHwpx>>;
  try {
    r = await placeSealHwpx(toAB(doc), [{ anchor: pick.anchor, occurrence: pick.occurrence, ...(pick.mode ? { mode: pick.mode } : {}), image: new Uint8Array(image), ext: ext as 'png' | 'jpg' | 'jpeg' | 'bmp' | 'gif' }]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/매직|형식이 아닙니다/.test(msg)) throw new Error('도장 그림 파일의 내용이 PNG·JPG 그림이 아닙니다. 그림 파일을 다시 골라 넣으세요.');
    if (/^place_seal:/.test(msg)) return { output_path: '', placed: 0, reason: '도장 찍을 자리에 그림을 넣지 못해 찍지 않았습니다. 편집기에서 도장 찍을 곳에 (인)을 넣고 다시 하세요.' };
    throw err;
  }
  const outPath = outputFile({ output_path: p.output_path, source: p.path, name: `${stemOf(p.path)}_날인.hwpx` });
  await writeFile(outPath, Buffer.from(r.buffer));
  return { output_path: outPath, placed: r.placed.length, anchor: pick.anchor };
}

export async function patchDocument(p: { path: string; markdown: string; output_path?: string }): Promise<{ output_path: string; applied: number; skipped: Array<{ reason: string; excerpt?: string }> }> {
  const fmt = formatOf(p.path);
  if (fmt !== 'hwpx' && fmt !== 'hwp') throw new Error('서식 그대로 반영은 HWPX·HWP 문서만 됩니다.');
  if (typeof p.markdown !== 'string' || !p.markdown.trim()) throw new Error('반영할 글이 비어 있습니다.');
  const original = new Uint8Array(await readFile(p.path));
  const r = fmt === 'hwpx' ? await patchHwpx(original, p.markdown) : await patchHwp(original, p.markdown);
  if (!r.success || !r.data) throw new Error(r.error || '고친 글을 반영하지 못했습니다.');
  const outPath = outputFile({ output_path: p.output_path, source: p.path, name: `${stemOf(p.path)}_수정.${fmt}` });
  await writeFile(outPath, r.data);
  return {
    output_path: outPath,
    applied: r.applied,
    skipped: r.skipped.map((s) => ({ reason: s.reason, ...(s.before ?? s.after ? { excerpt: s.before ?? s.after } : {}) })),
  };
}

export async function validateHwpxFile(path: string): Promise<{ ok: boolean; issues: Array<{ severity: string; message: string; part?: string }> }> {
  if (formatOf(path) !== 'hwpx') throw new Error('구조 검사는 HWPX 문서만 됩니다.');
  const r = await validateHwpx(await readFile(path));
  return { ok: r.ok, issues: r.issues.map((i) => ({ severity: 'error', message: i.message, ...(i.path ? { part: i.path } : {}) })) };
}
