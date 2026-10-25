/**
 * 편집기 AI 의 문서 연산 — rhwp HwpDocument(공개 WASM API)만 받아 읽고 고치는 순수 함수들.
 * 편집기 안에서는 kordoc-ai-plugin.mjs 가 읽기는 host.read, 고치기는 host.transaction(실행 취소 한 단계)으로 감싼다.
 * Node 시험은 같은 함수를 엔진에 바로 건다.
 *
 * 자리 표기 (모델이 보는 것):
 *   문단 "0.12"      = 구역 0 의 12번째 본문 문단
 *   표   "0.5.0"     = 구역 0, 5번 문단의 0번 컨트롤(표)
 *   칸   (행, 열)    = 0부터. 병합 칸은 왼쪽 위 칸 자리로
 * 고치기 연산은 실패해도 문서를 바꾸기 전에 멈추도록 먼저 모두 확인하고, 이유를 문장으로 돌려준다(throw new OpError).
 */

export class OpError extends Error {}

const j = (s) => (typeof s === 'string' ? JSON.parse(s) : s);
const fail = (msg) => { throw new OpError(msg); };
/** 사용자 서식 칸 이름 가운데 앱 내부용 (보이지 않게) */
const INTERNAL_FIELD = /^__kordoc_/;
const CTRL_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

// ── 자리 ──

export function parsePara(id) {
  const m = /^(\d+)\.(\d+)$/.exec(String(id ?? '').trim());
  if (!m) fail(`문단 자리 "${id}" 를 읽지 못했습니다. read_document 가 준 "구역.문단" 꼴(예: 0.12)로 주세요.`);
  return { sec: Number(m[1]), para: Number(m[2]) };
}

/** 문단 자리 목록 (겹친 것은 하나로) */
function uniqueParas(ids) {
  const seen = new Set();
  return (ids ?? []).map(parsePara).filter((p) => { const k = `${p.sec}.${p.para}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * 표 자리: 본문 표 "구역.문단.번호", 칸 안의 표는 그 뒤에 ">칸.칸문단.번호" 를 잇는다 (예: 0.5.0>13.4.0).
 * inner: 바깥에서 안쪽으로 [{ cell, cellPara, ctrl }] — 칸 cell 의 문단 cellPara 에 든 번호 ctrl 의 표
 */
export function parseTable(id) {
  const raw = String(id ?? '').trim();
  const m = /^(\d+)\.(\d+)\.(\d+)((?:>\d+\.\d+\.\d+)*)$/.exec(raw);
  if (!m) fail(`표 자리 "${id}" 를 읽지 못했습니다. read_document·read_table 이 준 "구역.문단.번호" 꼴(예: 0.5.0, 칸 안의 표는 0.5.0>3.0.0)로 주세요.`);
  const inner = m[4] ? m[4].slice(1).split('>').map((x) => { const [cell, cellPara, ctrl] = x.split('.').map(Number); return { cell, cellPara, ctrl }; }) : [];
  return { sec: Number(m[1]), para: Number(m[2]), ctrl: Number(m[3]), inner };
}

const tableId = (t) => [`${t.sec}.${t.para}.${t.ctrl}`, ...t.inner.map((x) => `${x.cell}.${x.cellPara}.${x.ctrl}`)].join('>');

/** 칸 안의 표의 칸 문단까지 가는 경로 (엔진의 ByPath API 꼴) */
function cellPath(t, cellIdx, cellPara) {
  const ctrls = [t.ctrl, ...t.inner.map((x) => x.ctrl)];
  const steps = [...t.inner.map((x) => [x.cell, x.cellPara]), [cellIdx, cellPara]];
  return JSON.stringify(steps.map(([cellIndex, cellParaIndex], i) => ({ controlIndex: ctrls[i], cellIndex, cellParaIndex })));
}

/** 표 칸 읽기·쓰기 (본문 표는 평면 API, 칸 안의 표는 경로 API) */
function cellApi(doc, t) {
  if (!t.inner?.length) {
    const a = (c) => [t.sec, t.para, t.ctrl, c];
    return {
      dims: () => j(doc.getTableDimensions(t.sec, t.para, t.ctrl)),
      boxes: () => j(doc.getTableCellBboxes(t.sec, t.para, t.ctrl)),
      paras: (c) => doc.getCellParagraphCount(...a(c)),
      len: (c, cp) => doc.getCellParagraphLength(...a(c), cp),
      text: (c, cp, n) => doc.getTextInCell(...a(c), cp, 0, n),
      del: (c, cp, off, n) => doc.deleteTextInCell(...a(c), cp, off, n),
      ins: (c, cp, off, s) => doc.insertTextInCell(...a(c), cp, off, s),
      merge: (c, cp) => doc.mergeParagraphInCell(...a(c), cp),
      split: (c, cp, off) => doc.splitParagraphInCell(...a(c), cp, off),
      prefix: (c, cp) => [{ controlIndex: t.ctrl, cellIndex: c, cellParaIndex: cp }],
    };
  }
  const p = (c, cp) => cellPath(t, c, cp);
  return {
    dims: () => j(doc.getTableDimensionsByPath(t.sec, t.para, p(0, 0))),
    boxes: () => j(doc.getTableCellBboxesByPath(t.sec, t.para, p(0, 0))),
    paras: (c) => doc.getCellParagraphCountByPath(t.sec, t.para, p(c, 0)),
    len: (c, cp) => doc.getCellParagraphLengthByPath(t.sec, t.para, p(c, cp)),
    text: (c, cp, n) => doc.getTextInCellByPath(t.sec, t.para, p(c, cp), 0, n),
    del: (c, cp, off, n) => doc.deleteTextInCellByPath(t.sec, t.para, p(c, cp), off, n),
    ins: (c, cp, off, s) => doc.insertTextInCellByPath(t.sec, t.para, p(c, cp), off, s),
    merge: (c, cp) => doc.mergeParagraphInCellByPath(t.sec, t.para, p(c, cp)),
    split: (c, cp, off) => doc.splitParagraphInCellByPath(t.sec, t.para, p(c, cp), off),
    prefix: (c, cp) => JSON.parse(p(c, cp)),
  };
}

/** 칸 c 의 문단들에 든 개체 (번호 순): 표면 그 자리, 그 밖은 'object' */
function cellObjects(doc, t, api, c) {
  const out = [];
  const n = api.paras(c);
  for (let cp = 0; cp < n; cp++) {
    for (let k = 0; k < 20; k++) {
      try {
        const d = j(doc.getTableDimensionsByPath(t.sec, t.para, JSON.stringify([...api.prefix(c, cp), { controlIndex: k, cellIndex: 0, cellParaIndex: 0 }])));
        out.push({ cellPara: cp, ctrl: k, rows: d.rowCount, cols: d.colCount });
      } catch (e) {
        if (/범위 초과/.test(String(e))) break; // 이 문단엔 더 없다
        out.push({ cellPara: cp, ctrl: k, kind: 'object' }); // 표가 아닌 개체 (그림 등)
      }
    }
  }
  return out;
}

function checkPara(doc, { sec, para }) {
  if (sec >= doc.getSectionCount() || para >= doc.getParagraphCount(sec)) fail(`문단 ${sec}.${para} 이 없습니다. read_document 로 다시 확인하세요.`);
}

const paraText = (doc, sec, para) => {
  const len = doc.getParagraphLength(sec, para);
  return len ? doc.getTextRange(sec, para, 0, len) : '';
};

/** 본문 문단마다 든 컨트롤 { "구역.문단": [{ctrlId, controlIndex}] }.
 *  getControls 의 list 0 이 본문이고, 그 문단 번호는 구역을 넘어 이어진다(구역마다 문단 수를 빼서 구역 문단으로) */
function bodyControls(doc) {
  const counts = Array.from({ length: doc.getSectionCount() }, (_, s) => doc.getParagraphCount(s));
  const out = new Map();
  for (const c of j(doc.getControls())) {
    if ((c.list ?? 0) !== 0) continue;
    let sec = 0;
    let para = c.para;
    while (sec < counts.length && para >= counts[sec]) { para -= counts[sec]; sec++; }
    const key = `${sec}.${para}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ ctrlId: String(c.ctrlId ?? '').trim(), controlIndex: c.controlIndex });
  }
  return out;
}

/** 글을 고쳐도 다치지 않는 컨트롤 (구역·단 정의, 쪽 번호 위치, 감추기, 머리말·꼬리말, 새 번호) */
const HARMLESS = new Set(['secd', 'cold', 'pgnp', 'pghd', 'head', 'foot', 'nwno']);
const hasObjects = (doc, sec, para, ctl = bodyControls(doc)) => (ctl.get(`${sec}.${para}`) ?? []).some((c) => !HARMLESS.has(c.ctrlId));

// ── 읽기 ──

/** 문서 개요: 본문 문단 글(길면 자름)과 그 문단의 표 */
export function outline(doc, { from = 0, count = 120, maxChars = 400 } = {}) {
  const controls = bodyControls(doc);
  const blocks = [];
  let total = 0;
  for (let sec = 0; sec < doc.getSectionCount(); sec++) {
    const n = doc.getParagraphCount(sec);
    for (let para = 0; para < n; para++, total++) {
      if (total < from || blocks.length >= count) continue;
      const text = paraText(doc, sec, para).replace(CTRL_CHAR, '');
      const tables = (controls.get(`${sec}.${para}`) ?? []).filter((c) => c.ctrlId === 'tbl').map(({ controlIndex: ctrl }) => {
        const d = j(doc.getTableDimensions(sec, para, ctrl));
        return { id: `${sec}.${para}.${ctrl}`, rows: d.rowCount, cols: d.colCount };
      });
      blocks.push({ id: `${sec}.${para}`, text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text, ...(tables.length ? { tables } : {}) });
    }
  }
  return { total, from, blocks };
}

/** 표 한 개: 행·열 격자 (병합 칸은 왼쪽 위 자리에 글, 나머지 자리는 null) */
export function readTable(doc, { table }) {
  const t = parseTable(table);
  const d = dims(doc, t, table);
  const api = cellApi(doc, t);
  const grid = Array.from({ length: d.rowCount }, () => Array(d.colCount).fill(null));
  const nested = [];
  for (const c of cells(doc, t)) {
    grid[c.row][c.col] = cellText(doc, t, c.cellIdx);
    // 칸 안의 표: 자리를 알려 read_table·fill_cells 로 이어 갈 수 있게
    for (const o of cellObjects(doc, t, api, c.cellIdx)) {
      if (!o.kind) nested.push({ row: c.row, col: c.col, table: `${tableId(t)}>${c.cellIdx}.${o.cellPara}.${o.ctrl}`, rows: o.rows, cols: o.cols });
    }
  }
  return { table: tableId(t), rows: d.rowCount, cols: d.colCount, cells: grid, ...(nested.length ? { nested } : {}) };
}

function dims(doc, t, table) {
  let d = null;
  try { d = cellApi(doc, t).dims(); } catch { /* 표가 아닌 자리 */ }
  if (!d?.rowCount) fail(`표 ${table} 이 없습니다. read_document·read_table 로 다시 확인하세요.`);
  return d;
}

/** 칸 문단에 표·그림 같은 개체가 있나 (칸 경로로 물어 "범위 초과"면 없음) */
const cellHasObjects = (doc, t, cellIdx) => cellObjects(doc, t, cellApi(doc, t), cellIdx).length > 0;

function cells(doc, t) {
  const boxes = cellApi(doc, t).boxes();
  const seen = new Map();
  for (const b of boxes) if (!seen.has(b.cellIdx)) seen.set(b.cellIdx, { cellIdx: b.cellIdx, row: b.row, col: b.col, rowSpan: b.rowSpan ?? 1, colSpan: b.colSpan ?? 1 });
  return [...seen.values()];
}

function cellText(doc, t, cellIdx) {
  const api = cellApi(doc, t);
  const n = api.paras(cellIdx);
  const lines = [];
  for (let cp = 0; cp < n; cp++) {
    const len = api.len(cellIdx, cp);
    lines.push(len ? api.text(cellIdx, cp, len).replace(CTRL_CHAR, '') : '');
  }
  return lines.join('\n');
}

/** 찾기 결과의 경로 → 그 칸이 든 표 자리 ("구역.문단.번호>칸.칸문단.번호…") */
function nestedTableId(h) {
  const path = h.cellPath;
  return [`${h.sec}.${h.para}.${path[0].controlIndex}`, ...path.slice(1).map((x, i) => `${path[i].cellIndex}.${path[i].cellParaIndex}.${x.controlIndex}`)].join('>');
}

/** 글 찾기 (본문·표 칸) */
/** 찾기 결과 가운데 글로 고칠 수 있는 것: 수식 스크립트 안에서 찾은 것은 뺀다 (그 자리는 문단 글 위치가 아니다) */
const textHits = (doc, text) => j(doc.searchAllText(text, false, true)).filter((h) => h.equationControl === undefined);

export function find(doc, { text }) {
  if (!text) fail('찾을 글이 비었습니다.');
  const hits = textHits(doc, text);
  return {
    count: hits.length,
    matches: hits.slice(0, 30).map((h) => (h.cellPath
      // 칸 안의 표: 그 안쪽 표 자리와 칸 번호
      ? { at: nestedTableId(h), cell: h.cellPath.at(-1).cellIndex, offset: h.charOffset }
      : {
        at: h.cellContext ? `${h.sec}.${h.cellContext.parentPara}.${h.cellContext.ctrlIdx}` : `${h.sec}.${h.para}`,
        ...(h.cellContext ? { cell: h.cellContext.cellIdx } : {}),
        offset: h.charOffset,
      })),
  };
}

export function styles(doc) {
  return j(doc.getStyleList()).map((s) => ({ id: s.id, name: s.name, englishName: s.englishName, kind: s.type === 1 ? 'char' : 'para' }));
}

function styleByName(doc, name) {
  const all = styles(doc);
  const s = all.find((x) => x.name === name || x.englishName === name);
  if (!s) fail(`"${name}" 스타일이 없습니다. 있는 스타일: ${all.map((x) => x.name).join(', ')}`);
  return s;
}

/** 스타일 모양 요약 (모델이 읽을 만큼) */
export function readStyle(doc, { name }) {
  const s = styleByName(doc, name);
  const d = j(doc.getStyleDetail(s.id));
  const c = d.charProps ?? {};
  const p = d.paraProps ?? {};
  return {
    name: s.name, kind: s.kind,
    font: c.fontFamily, size_pt: c.fontSize ? c.fontSize / 100 : undefined, bold: c.bold, italic: c.italic, underline: c.underline, color: c.textColor,
    ...(s.kind === 'para' ? { align: p.alignment, line_spacing: p.lineSpacing, indent_pt: pt(p.indent), left_pt: pt(p.marginLeft), right_pt: pt(p.marginRight), before_pt: pt(p.spacingBefore), after_pt: pt(p.spacingAfter) } : {}),
  };
}

/** 엔진이 돌려주는 문단 길이 값(px, 96dpi) → pt */
const pt = (px) => (typeof px === 'number' ? Math.round(px * 0.75 * 10) / 10 : undefined);

export function fields(doc) {
  return j(doc.getFieldList()).filter((f) => f.name && !INTERNAL_FIELD.test(f.name)).map((f) => ({ name: f.name, value: f.value ?? '', ...(f.guide ? { guide: f.guide } : {}) }));
}

// ── 고치기 (부른 쪽이 트랜잭션 하나로 감싼다) ──

/** 찾아 바꾸기: occurrence 번째 하나(1부터) 또는 all. 본문·표 칸 모두 */
export function replace(doc, { find: text, replace: by = '', occurrence, all = false }) {
  if (!text) fail('바꿀 글이 비었습니다.');
  if (/\n/.test(by)) fail('바꿀 글에 줄바꿈을 넣지 마세요. 새 문단은 insert_paragraphs 로 넣습니다.');
  const hits = textHits(doc, text);
  if (!hits.length) fail(`"${text}" 를 찾지 못했습니다.`);
  let targets;
  if (all) targets = hits;
  else if (occurrence) {
    if (occurrence < 1 || occurrence > hits.length) fail(`"${text}" 는 ${hits.length}곳에 있습니다. occurrence 는 1~${hits.length} 사이로 주세요.`);
    targets = [hits[occurrence - 1]];
  } else if (hits.length > 1) fail(`"${text}" 가 ${hits.length}곳에 있습니다. occurrence 로 몇 번째인지 정하거나 all 로 모두 바꾸세요.`);
  else targets = hits;
  // 뒤에서부터: 앞 자리를 바꿔도 뒤 자리의 위치가 그대로다
  for (const h of [...targets].reverse()) {
    if (h.cellPath) {
      // 칸 안의 표: 경로 API 로
      const path = JSON.stringify(h.cellPath);
      doc.deleteTextInCellByPath(h.sec, h.para, path, h.charOffset, h.length);
      if (by) doc.insertTextInCellByPath(h.sec, h.para, path, h.charOffset, by);
    } else if (h.cellContext) {
      const c = h.cellContext;
      doc.deleteTextInCell(h.sec, c.parentPara, c.ctrlIdx, c.cellIdx, c.cellPara, h.charOffset, h.length);
      if (by) doc.insertTextInCell(h.sec, c.parentPara, c.ctrlIdx, c.cellIdx, c.cellPara, h.charOffset, by);
    } else {
      doc.replaceText(h.sec, h.para, h.charOffset, h.length, by);
    }
  }
  return { replaced: targets.length };
}

/** 문단 글 통째로 바꾸기 (서식은 문단 첫 글자 것을 따른다). 표·그림이 든 문단은 거절 */
export function setParagraph(doc, { id, text }) {
  const p = parsePara(id);
  checkPara(doc, p);
  if (hasObjects(doc, p.sec, p.para)) fail(`문단 ${id} 에는 표나 그림이 있어 통째로 바꿀 수 없습니다. replace_text 로 글만 바꾸세요.`);
  if (/\n/.test(text)) fail('문단 하나에 줄바꿈을 넣을 수 없습니다. 여러 문단은 insert_paragraphs 로 넣으세요.');
  const len = doc.getParagraphLength(p.sec, p.para);
  if (len) doc.deleteText(p.sec, p.para, 0, len);
  if (text) doc.insertText(p.sec, p.para, 0, text);
  return { id };
}

/** 각주: 본문 문단의 글 after 바로 뒤(없으면 문단 끝)에 각주 번호를 달고 각주 글을 넣는다 */
export function insertFootnote(doc, { id, after, text }) {
  const p = parsePara(id);
  checkPara(doc, p);
  if (typeof text !== 'string' || !text.trim()) fail('각주 글(text)이 없습니다.');
  if (/\n/.test(text)) fail('각주 글에 줄바꿈을 넣지 마세요. 한 문단으로 씁니다.');
  if (text.length > 500) fail('각주 글은 500자까지 넣을 수 있습니다.');
  const body = paraText(doc, p.sec, p.para);
  // 엔진 글자 자리는 코드 포인트로 센다 (확장 한자 같은 두 단위 글자)
  const chars = (str) => [...str].length;
  let offset = chars(body);
  if (after !== undefined && after !== '') {
    const at = body.indexOf(String(after));
    if (at < 0) fail(`문단 ${id} 에서 "${after}" 를 찾지 못했습니다. read_document 로 문단 글을 확인하세요.`);
    if (body.indexOf(String(after), at + 1) >= 0) fail(`문단 ${id} 에 "${after}" 가 여러 곳 있습니다. 더 길게 적어 한 곳을 가리키세요.`);
    offset = chars(body.slice(0, at)) + chars(String(after));
  }
  const r = j(doc.insertFootnote(p.sec, p.para, offset));
  if (!r?.ok) fail('각주를 넣지 못했습니다.');
  const at = r.paraIdx ?? p.para;
  // 새 각주의 첫 문단은 엔진이 넣은 앞 칸·자동 번호 자리로 시작한다: 그 뒤(문단 끝)에 글을 넣어야 번호 뒤에 붙는다
  const lead = j(doc.getFootnoteInfo(p.sec, at, r.controlIdx))?.texts?.[0] ?? '';
  doc.insertTextInFootnote(p.sec, at, r.controlIdx, 0, chars(lead), text);
  return { id, number: r.footnoteNumber };
}

/** 문단 뒤에 새 문단들 (앞 문단 모양을 이어받는다) */
export function insertParagraphs(doc, { after, texts }) {
  const p = parsePara(after);
  checkPara(doc, p);
  if (!Array.isArray(texts) || !texts.length) fail('넣을 문단 글이 없습니다.');
  if (texts.some((t) => /\n/.test(t))) fail('문단 글 하나에 줄바꿈을 넣지 마세요. 문단마다 배열 항목 하나입니다.');
  let at = p.para;
  for (const t of texts) {
    doc.splitParagraph(p.sec, at, doc.getParagraphLength(p.sec, at));
    at += 1;
    const len = doc.getParagraphLength(p.sec, at);
    if (len) doc.deleteText(p.sec, at, 0, len);
    if (t) doc.insertText(p.sec, at, 0, t);
  }
  return { first: `${p.sec}.${p.para + 1}`, count: texts.length };
}

/** 문단 지우기 (뒤에서부터). 표·그림이 든 문단은 거절 */
export function deleteParagraphs(doc, { ids }) {
  const ps = uniqueParas(ids);
  if (!ps.length) fail('지울 문단이 없습니다.');
  const ctl = bodyControls(doc);
  for (const p of ps) {
    checkPara(doc, p);
    if (hasObjects(doc, p.sec, p.para, ctl)) fail(`문단 ${p.sec}.${p.para} 에는 표나 그림이 있어 지우지 않았습니다.`);
    if (p.para === 0) fail(`문단 ${p.sec}.0 은 구역의 첫 문단이라 지우지 않았습니다. 글만 비우려면 rewrite_paragraph 로 빈 글을 주세요.`);
  }
  ps.sort((a, b) => b.sec - a.sec || b.para - a.para);
  for (const p of ps) {
    if (doc.getParagraphCount(p.sec) <= 1) { const len = doc.getParagraphLength(p.sec, p.para); if (len) doc.deleteText(p.sec, p.para, 0, len); continue; }
    doc.deleteParagraph(p.sec, p.para);
  }
  return { deleted: ps.length };
}

/** 칸 채우기: 글을 바꾼다(줄바꿈은 칸 안 문단으로) */
export function fillCells(doc, { table, cells: wanted }) {
  const t = parseTable(table);
  const d = dims(doc, t, table);
  const all = cells(doc, t);
  const at = (row, col) => all.find((c) => row >= c.row && row < c.row + c.rowSpan && col >= c.col && col < c.col + c.colSpan);
  const plan = (wanted ?? []).map((w) => {
    const c = at(w.row, w.col);
    if (!c) fail(`표 ${table} 에 (${w.row}, ${w.col}) 칸이 없습니다. 표는 ${d.rowCount}행 ${d.colCount}열입니다.`);
    if (cellHasObjects(doc, t, c.cellIdx)) fail(`표 ${table} 의 (${w.row}, ${w.col}) 칸에는 표나 그림이 들어 있어 채우지 않았습니다. 편집기에서 직접 고치세요.`);
    return { cellIdx: c.cellIdx, text: String(w.text ?? '') };
  });
  for (const { cellIdx, text } of plan) setCell(doc, t, cellIdx, text);
  return { filled: plan.length };
}

function setCell(doc, t, cellIdx, text) {
  const api = cellApi(doc, t);
  // 칸 문단을 하나로 합치고 비운 뒤 줄마다 문단을 나눠 넣는다
  for (let n = api.paras(cellIdx); n > 1; n--) api.merge(cellIdx, n - 1);
  const len = api.len(cellIdx, 0);
  if (len) api.del(cellIdx, 0, 0, len);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) api.split(cellIdx, i - 1, api.len(cellIdx, i - 1));
    if (line) api.ins(cellIdx, i, 0, line);
  });
}

/** 줄(행) 넣기·지우기 */
const noNestedRows = (t, table) => { if (t.inner.length) fail(`표 ${table} 은 칸 안의 표라 줄을 넣거나 지울 수 없습니다. 편집기에서 직접 고치세요.`); };

export function addRows(doc, { table, after_row, count = 1 }) {
  const t = parseTable(table);
  const d = dims(doc, t, table);
  noNestedRows(t, table);
  if (!Number.isInteger(count) || count < 1 || count > 50) fail('count 는 1~50 사이로 주세요.');
  if (after_row < -1 || after_row >= d.rowCount) fail(`after_row 는 -1(맨 위)~${d.rowCount - 1} 사이로 주세요.`);
  for (let i = 0; i < count; i++) {
    if (after_row < 0) doc.insertTableRow(t.sec, t.para, t.ctrl, 0, false);
    else doc.insertTableRow(t.sec, t.para, t.ctrl, after_row, true);
  }
  return { rows: d.rowCount + count };
}

export function removeRows(doc, { table, rows }) {
  const t = parseTable(table);
  const d = dims(doc, t, table);
  noNestedRows(t, table);
  const list = [...new Set(rows ?? [])].sort((a, b) => b - a);
  if (!list.length) fail('지울 줄이 없습니다.');
  if (list.some((r) => r < 0 || r >= d.rowCount)) fail(`줄 번호는 0~${d.rowCount - 1} 사이로 주세요.`);
  if (list.length >= d.rowCount) fail('표의 줄을 모두 지울 수는 없습니다.');
  for (const r of list) doc.deleteTableRow(t.sec, t.para, t.ctrl, r);
  return { rows: d.rowCount - list.length };
}

/** 문단 뒤에 표 (첫 줄은 머리줄로 진하게) */
export function insertTable(doc, { after, rows }) {
  const p = parsePara(after);
  checkPara(doc, p);
  if (!Array.isArray(rows) || !rows.length || !rows.every(Array.isArray)) fail('rows 는 줄마다 칸 글 배열입니다. 예: [["항목","금액"],["인건비","100"]]');
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols < 1 || cols > 20 || rows.length > 200) fail('표는 1~20열, 200줄까지 넣을 수 있습니다.');
  doc.splitParagraph(p.sec, p.para, doc.getParagraphLength(p.sec, p.para));
  const at = p.para + 1;
  const len = doc.getParagraphLength(p.sec, at);
  if (len) doc.deleteText(p.sec, at, 0, len);
  const r = j(doc.createTableEx(JSON.stringify({ sectionIdx: p.sec, paraIdx: at, charOffset: 0, rowCount: rows.length, colCount: cols, treatAsChar: false })));
  if (!r?.ok) fail('표를 넣지 못했습니다.');
  const t = { sec: p.sec, para: r.paraIdx ?? at, ctrl: r.controlIdx ?? 0 };
  const all = cells(doc, t);
  rows.forEach((row, ri) => row.forEach((text, ci) => {
    const c = all.find((x) => x.row === ri && x.col === ci);
    if (!c || !text) return;
    setCell(doc, t, c.cellIdx, String(text));
    if (ri === 0) String(text).split('\n').forEach((line, li) => { if (line) doc.applyCharFormatInCell(t.sec, t.para, t.ctrl, c.cellIdx, li, 0, line.length, JSON.stringify({ bold: true })); });
  }));
  return { table: `${t.sec}.${t.para}.${t.ctrl}`, rows: rows.length, cols };
}

// ── 서식 ──

const ALIGN = new Set(['left', 'right', 'center', 'justify', 'distribute']);
const CHAR_KEYS = ['bold', 'italic', 'underline', 'strikethrough', 'color', 'size_pt', 'font'];
const PARA_KEYS = ['align', 'line_spacing', 'indent_pt', 'left_pt', 'right_pt', 'before_pt', 'after_pt'];
const has = (f, keys) => keys.some((k) => f[k] !== undefined);
/** 글꼴 이름 → 언어 7갈래(한글·영문·한자·일어·외국어·기호·사용자) 글꼴 번호 (없으면 문서에 더한다: 고치기 안에서만 부른다) */
const fontIds = (doc, name) => Array.from({ length: 7 }, (_, lang) => doc.findOrCreateFontIdForLang(lang, name));

/** 모델이 준 글자 서식 → 엔진 속성 (준 것만, 틀리면 이유를 들어 거절) */
export function charProps(doc, f) {
  const out = {};
  for (const k of ['bold', 'italic', 'underline', 'strikethrough']) if (typeof f[k] === 'boolean') out[k] = f[k];
  if (f.color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(f.color)) fail('color 는 #RRGGBB 꼴로 주세요. 예: #FF0000');
    out.textColor = f.color.toUpperCase();
  }
  if (f.size_pt !== undefined) {
    if (!(f.size_pt >= 1 && f.size_pt <= 200)) fail('size_pt 는 1~200 사이로 주세요.');
    out.fontSize = Math.round(f.size_pt * 100);
  }
  if (f.font !== undefined) {
    if (!String(f.font).trim()) fail('font 이름이 비었습니다.');
    out.fontIds = fontIds(doc, String(f.font).trim());
  }
  if (!Object.keys(out).length) fail('바꿀 글자 서식이 없습니다 (bold·italic·underline·strikethrough·color·size_pt·font).');
  return out;
}

/** 문단 서식 → 엔진 속성. 엔진 단위: 여백·들여쓰기는 1pt = 200, 문단 간격은 1pt = 100 */
export function paraProps(f) {
  const out = {};
  if (f.align !== undefined) {
    if (!ALIGN.has(f.align)) fail('align 은 left·right·center·justify·distribute 가운데 하나입니다.');
    out.alignment = f.align;
  }
  if (f.line_spacing !== undefined) {
    if (!(f.line_spacing >= 50 && f.line_spacing <= 500)) fail('line_spacing 은 퍼센트(50~500)로 주세요.');
    out.lineSpacing = f.line_spacing;
    out.lineSpacingType = 'Percent';
  }
  const num = (k, lo, hi) => {
    const v = Number(f[k]);
    if (!(v >= lo && v <= hi)) fail(`${k} 는 ${lo}~${hi} 사이(pt)로 주세요.`);
    return v;
  };
  if (f.indent_pt !== undefined) out.indent = Math.round(num('indent_pt', -200, 200) * 200);
  if (f.left_pt !== undefined) out.marginLeft = Math.round(num('left_pt', 0, 300) * 200);
  if (f.right_pt !== undefined) out.marginRight = Math.round(num('right_pt', 0, 300) * 200);
  if (f.before_pt !== undefined) out.spacingBefore = Math.round(num('before_pt', 0, 200) * 100);
  if (f.after_pt !== undefined) out.spacingAfter = Math.round(num('after_pt', 0, 200) * 100);
  if (!Object.keys(out).length) fail('바꿀 문단 서식이 없습니다 (align·line_spacing·indent_pt·left_pt·right_pt·before_pt·after_pt).');
  return out;
}

/** 글자 서식: 문단 전체 또는 그 문단 안의 글(find) */
export function formatText(doc, { id, find: text, ...f }) {
  const p = parsePara(id);
  checkPara(doc, p);
  const full = paraText(doc, p.sec, p.para);
  let start = 0;
  let end = doc.getParagraphLength(p.sec, p.para);
  if (text) {
    const i = full.indexOf(text);
    if (i < 0) fail(`문단 ${id} 에 "${text}" 가 없습니다.`);
    start = i;
    end = i + text.length;
  }
  if (end <= start) fail(`문단 ${id} 에 글이 없습니다.`);
  doc.applyCharFormat(p.sec, p.para, start, end, JSON.stringify(charProps(doc, f)));
  return { id };
}

export function formatParagraphs(doc, { ids, ...f }) {
  const ps = uniqueParas(ids);
  if (!ps.length) fail('서식을 바꿀 문단이 없습니다.');
  ps.forEach((p) => checkPara(doc, p));
  const props = JSON.stringify(paraProps(f));
  for (const p of ps) doc.applyParaFormat(p.sec, p.para, props);
  return { count: ps.length };
}

// ── 스타일 ──

export function applyStyle(doc, { ids, style }) {
  const s = styleByName(doc, style);
  if (s.kind !== 'para') fail(`"${style}" 는 글자 스타일입니다. 문단에는 문단 스타일만 걸 수 있습니다.`);
  const ps = uniqueParas(ids);
  if (!ps.length) fail('스타일을 걸 문단이 없습니다.');
  ps.forEach((p) => checkPara(doc, p));
  for (const p of ps) doc.applyStyle(p.sec, p.para, s.id);
  return { count: ps.length, style: s.name };
}

/** 스타일의 지금 모양을 엔진 속성으로 (새 스타일이 이어받게: 글꼴은 언어별 번호, 길이는 엔진 단위로) */
function shapeOf(doc, styleId) {
  const d = j(doc.getStyleDetail(styleId));
  const c = d.charProps ?? {};
  const p = d.paraProps ?? {};
  const char = {};
  for (const k of ['fontSize', 'bold', 'italic', 'underline', 'strikethrough', 'textColor', 'ratios', 'spacings', 'relativeSizes', 'charOffsets']) if (c[k] !== undefined) char[k] = c[k];
  if (Array.isArray(c.fontFamilies)) char.fontIds = c.fontFamilies.map((name, lang) => doc.findOrCreateFontIdForLang(lang, name));
  const para = {};
  for (const k of ['alignment', 'lineSpacing', 'lineSpacingType']) if (p[k] !== undefined) para[k] = p[k];
  // 읽는 값은 px(96dpi): 여백·들여쓰기 px × 150, 간격 px × 75 가 엔진 값
  for (const k of ['marginLeft', 'marginRight', 'indent']) if (typeof p[k] === 'number') para[k] = Math.round(p[k] * 150);
  for (const k of ['spacingBefore', 'spacingAfter']) if (typeof p[k] === 'number') para[k] = Math.round(p[k] * 75);
  return { char, para };
}

/** 새 스타일: based_on 스타일 모양을 이어받고 준 속성만 바꾼다 */
export function createStyle(doc, { name, kind = 'para', based_on, ...f }) {
  if (!name || !String(name).trim()) fail('새 스타일 이름이 비었습니다.');
  if (kind !== 'para' && kind !== 'char') fail('kind 는 para(문단) 또는 char(글자) 입니다.');
  if (styles(doc).some((s) => s.name === name || s.englishName === name)) fail(`"${name}" 스타일이 이미 있습니다. 고치려면 edit_style 을 쓰세요.`);
  if (kind === 'char' && has(f, PARA_KEYS)) fail('글자 스타일에는 문단 서식(정렬·간격·여백)을 줄 수 없습니다.');
  // 확인을 모두 마친 뒤에 문서를 바꾼다
  const base = based_on ? styleByName(doc, based_on) : styles(doc)[0];
  const cMods = has(f, CHAR_KEYS) ? charProps(doc, f) : {};
  const pMods = kind === 'para' && has(f, PARA_KEYS) ? paraProps(f) : {};
  const inherit = shapeOf(doc, base.id);
  const id = doc.createStyle(JSON.stringify({ name, englishName: '', type: kind === 'char' ? 1 : 0, nextStyleId: 0 }));
  if (typeof id !== 'number' || id < 0) fail('스타일을 만들지 못했습니다.');
  // 문단 스타일의 다음 스타일은 자기 자신 (엔터를 쳐도 같은 스타일)
  if (kind === 'para') doc.updateStyle(id, JSON.stringify({ name, englishName: '', nextStyleId: id }));
  doc.updateStyleShapes(id, JSON.stringify({ ...inherit.char, ...cMods }), JSON.stringify(kind === 'para' ? { ...inherit.para, ...pMods } : {}));
  return { name, kind };
}

export function editStyle(doc, { name, new_name, ...f }) {
  const s = styleByName(doc, name);
  if (new_name && styles(doc).some((x) => x.id !== s.id && (x.name === new_name || x.englishName === new_name))) fail(`"${new_name}" 스타일이 이미 있습니다.`);
  if (s.kind === 'char' && has(f, PARA_KEYS)) fail('글자 스타일에는 문단 서식(정렬·간격·여백)을 줄 수 없습니다.');
  const c = has(f, CHAR_KEYS) ? charProps(doc, f) : {};
  const p = s.kind === 'para' && has(f, PARA_KEYS) ? paraProps(f) : {};
  if (!new_name && !Object.keys(c).length && !Object.keys(p).length) fail('바꿀 것이 없습니다 (new_name 또는 서식).');
  if (new_name) {
    const cur = j(doc.getStyleList()).find((x) => x.id === s.id);
    doc.updateStyle(s.id, JSON.stringify({ name: new_name, englishName: cur.englishName ?? '', nextStyleId: cur.nextStyleId ?? s.id }));
  }
  if (Object.keys(c).length || Object.keys(p).length) doc.updateStyleShapes(s.id, JSON.stringify(c), JSON.stringify(p));
  return { name: new_name || s.name };
}

// ── 누름틀 ──

export function fillField(doc, { name, value }) {
  if (!fields(doc).some((f) => f.name === name)) fail(`"${name}" 칸이 없습니다. list_fields 로 이름을 확인하세요.`);
  const r = j(doc.setFieldValueByName(name, String(value ?? '')));
  if (r && r.ok === false) fail(`"${name}" 칸을 채우지 못했습니다.`);
  return { name };
}
