/** rhwp 0.8.7 HWP 저장 보정 — 코퍼스 실측(scripts/hwp-save-audit.mjs, 한컴 HWP 1,641개)으로 확인한 손실만 메운다.
 *
 * 1. 구역 끝 묶음: 구역을 다시 쓰면 마지막 최상위 문단 뒤의 수준 1 묶음(메모 목록 MEMO_LIST, 바탕쪽 등 LIST_HEADER 로
 *    시작)을 버린다(여럿이면 일부만 남기도 함). 저장본 묶음이 없거나 원본보다 짧으면 원본 묶음으로 채운다. (rhwp devel 에서는 고쳐짐)
 * 2. 필드 글자 종류: 한컴은 메모 필드를 컨트롤 레코드는 '%unk', 문단 글 안 시작 글자는 '%%me' 로 쓰는데, rhwp 는 글자 쪽을
 *    '%unk' 로 맞춰 쓴다. 컨트롤 레코드 내용(필드 번호 포함)이 같은 짝을 원본에서 찾아 글자 ID 를 되돌린다.
 * 3. 새 탭 폭: rhwp 는 새로 넣은 탭의 폭을 0 으로 쓰고 뒤 탭들의 폭을 한 칸씩 민다(한컴이 쓴 탭은 늘 전진폭이 있다).
 *    폭 0 탭이 든 본문 문단은 엔진 조판에서 탭 앞뒤 커서 자리 차이를 재서 모든 탭 폭을 다시 쓴다(같은 줄일 때만).
 *    표 칸·머리말 안의 탭은 아직 보지 않는다.
 */

import { TAG, ctrlId, inlineControls, readRecords, type Hwp5, type Rec } from './hwp5.js';

/** 구역 끝 묶음의 시작 (없으면 -1): 마지막 최상위 문단 뒤 첫 수준 1 LIST_HEADER·MEMO_LIST */
export function tailStart(recs: Rec[]): number {
  let lastTop = -1;
  recs.forEach((r, i) => { if (r.tag === TAG.PARA_HEADER && r.level === 0) lastTop = i; });
  for (let i = lastTop + 1; i < recs.length; i++) {
    if (recs[i].level === 1 && (recs[i].tag === TAG.LIST_HEADER || recs[i].tag === TAG.MEMO_LIST)) return i;
  }
  return -1;
}

/** 원본에만 있는 구역 끝 묶음을 저장본에 되붙인다. lost: 구역 수가 달라 되붙이지 못한 묶음이 있다 */
export function restoreSectionTails(orig: Hwp5, out: Hwp5, changed: Map<string, Buffer>): { restored: number; lost: boolean } {
  let restored = 0;
  let lost = false;
  for (const [name, origBuf] of orig.sections) {
    const origRecs = readRecords(origBuf);
    const t = tailStart(origRecs);
    if (t < 0) continue;
    const outBuf = changed.get(name) ?? out.sections.get(name);
    if (!outBuf) { lost = true; continue; }
    const outRecs = readRecords(outBuf);
    const ot = tailStart(outRecs);
    // 묶음이 여럿이면(바탕쪽 몇 개 + 메모) 일부만 빠지기도 한다: 원본보다 짧을 때만 원본 묶음으로 바꾼다
    if (ot >= 0 && outRecs.length - ot >= origRecs.length - t) continue; // 엔진이 지켰다
    const keep = ot >= 0 ? outRecs.slice(0, ot).map((r) => r.raw) : [outBuf];
    changed.set(name, Buffer.concat([...keep, ...origRecs.slice(t).map((r) => r.raw)]));
    restored++;
  }
  return { restored, lost };
}

/** CTRL_HEADER 가 있는 확장 컨트롤 글자 코드 (공개 문서: 1·2·3·11·12·14~18·21~23) */
const EXTENDED = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);

interface ParaCtrl { text: Rec | null; headers: Rec[] }

/** 문단마다 PARA_TEXT 와 바로 아래 CTRL_HEADER 들 */
function paragraphs(recs: Rec[]): ParaCtrl[] {
  const out: ParaCtrl[] = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].tag !== TAG.PARA_HEADER) continue;
    const lv = recs[i].level;
    const p: ParaCtrl = { text: null, headers: [] };
    for (let k = i + 1; k < recs.length && recs[k].level > lv; k++) {
      if (recs[k].level !== lv + 1) continue;
      if (recs[k].tag === TAG.PARA_TEXT) p.text = recs[k];
      if (recs[k].tag === TAG.CTRL_HEADER) p.headers.push(recs[k]);
    }
    out.push(p);
  }
  return out;
}

/** 문단 글의 확장 컨트롤 글자와 그 컨트롤 레코드 짝 (차례로) */
function pairsOf(p: ParaCtrl): Array<{ at: number; header: Rec }> {
  if (!p.text) return [];
  const chars = inlineControls(p.text.data).filter((c) => EXTENDED.has(c.code));
  return chars.slice(0, p.headers.length).map((c, k) => ({ at: c.at, header: p.headers[k] }));
}

export function restoreFieldKinds(orig: Hwp5, out: Hwp5, changed: Map<string, Buffer>): number {
  // 원본에서 글자 ID 가 컨트롤 레코드 ID 와 다른 짝: 레코드 내용 → 글자 ID 4바이트
  const want = new Map<string, Buffer>();
  for (const buf of orig.sections.values()) {
    for (const p of paragraphs(readRecords(buf))) {
      for (const { at, header } of pairsOf(p)) {
        const inline = p.text!.data.subarray(at + 2, at + 6);
        if (ctrlId(inline) !== ctrlId(header.data)) want.set(header.data.toString('hex'), Buffer.from(inline));
      }
    }
  }
  if (!want.size) return 0;
  let fixed = 0;
  for (const [name, sec] of out.sections) {
    const buf = Buffer.from(changed.get(name) ?? sec); // 고칠 사본
    let dirty = false;
    for (const p of paragraphs(readRecords(buf))) {
      for (const { at, header } of pairsOf(p)) {
        const id = want.get(header.data.toString('hex'));
        const pos = p.text!.data.byteOffset - buf.byteOffset + at + 2;
        if (!id || buf.subarray(pos, pos + 4).equals(id)) continue;
        id.copy(buf, pos);
        dirty = true;
        fixed++;
      }
    }
    if (dirty) changed.set(name, buf);
  }
  return fixed;
}

/** 엔진의 커서 자리 (px, 96dpi) */
export interface Caret { pageIndex: number; x: number; y: number }
/** 본문 문단 글자 자리의 커서 — 엔진(rhwp)에 물어 채운다 */
export type CaretAt = (sec: number, para: number, charOffset: number) => Caret | null;
export type ParaText = (sec: number, para: number) => string;

/** HWPUNIT = 1/7200 인치, 96dpi px 하나 = 75 */
const PX_TO_HWPUNIT = 75;

/** 폭 0 탭이 든 본문 문단이 있나 (없으면 엔진을 열지 않는다: 큰 문서는 다시 여는 데 1분 가까이 걸린다) */
export function hasZeroWidthTabs(out: Hwp5, changed: Map<string, Buffer>): boolean {
  for (const [name, sec] of out.sections) {
    for (const r of readRecords(changed.get(name) ?? sec)) {
      if (r.tag === TAG.PARA_TEXT && r.level === 1 && inlineControls(r.data).some((c) => c.code === 9 && r.data.readUInt32LE(c.at + 2) === 0)) return true;
    }
  }
  return false;
}

/** 폭 0 탭이 든 문단은 탭 폭을 모두 다시 잰다: rhwp 0.8.7 은 탭을 넣으면 뒤 탭들의 폭이 한 칸씩 밀린다(rhwp PR #8224).
 *  새 탭의 종류 바이트가 비어 있으면 한컴이 쓰는 왼쪽 탭(종류 1)으로 둔다 */
export function fillTabWidths(out: Hwp5, changed: Map<string, Buffer>, caret: CaretAt, textOf: ParaText): number {
  let filled = 0;
  [...out.sections.keys()].forEach((name, sec) => {
    const buf = Buffer.from(changed.get(name) ?? out.sections.get(name)!);
    let dirty = false;
    const recs = readRecords(buf);
    let para = -1;
    for (let i = 0; i < recs.length; i++) {
      if (recs[i].tag === TAG.PARA_HEADER && recs[i].level === 0) para++;
      if (recs[i].tag !== TAG.PARA_TEXT || recs[i].level !== 1 || para < 0) continue;
      const data = recs[i].data;
      const tabs = inlineControls(data).filter((c) => c.code === 9);
      if (!tabs.some((t) => data.readUInt32LE(t.at + 2) === 0)) continue;
      // 엔진 글에서 탭 글자 자리 (엔진은 코드 포인트로 센다)
      const chars = [...textOf(sec, para)];
      const offsets: number[] = [];
      chars.forEach((ch, k) => { if (ch === '\t') offsets.push(k); });
      if (offsets.length !== tabs.length) continue; // 짝이 안 맞으면 건드리지 않는다
      const base = data.byteOffset - buf.byteOffset;
      tabs.forEach((t, k) => {
        const a = caret(sec, para, offsets[k]);
        const b = caret(sec, para, offsets[k] + 1);
        if (!a || !b || a.pageIndex !== b.pageIndex || Math.abs(a.y - b.y) > 1 || b.x <= a.x) return;
        const pos = base + t.at + 2;
        const width = Math.round((b.x - a.x) * PX_TO_HWPUNIT);
        if (buf.readUInt16LE(pos + 4) === 0) buf.writeUInt16LE(0x0100, pos + 4);
        if (buf.readUInt32LE(pos) === width) return;
        buf.writeUInt32LE(width, pos);
        dirty = true;
        filled++;
      });
    }
    if (dirty) changed.set(name, buf);
  });
  return filled;
}
