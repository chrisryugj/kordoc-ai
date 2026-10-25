/**
 * KorDoc 한글 편집기 중계 페이지 — 앱 창(Tauri) ↔ rhwp-studio
 *
 * 프로토콜: node-sidecar/src/types/editor-bridge.ts
 * - SDK(@rhwp/editor)는 HTTP(S) 출처에서만 돈다 → 사이드카가 127.0.0.1 에서 이 페이지와 스튜디오를 함께 서빙한다.
 * - 앱 창과는 postMessage 만. 부모 출처는 ?parent= 로 받고 허용 목록으로 거른다.
 * - 문단 바꿔 넣기·찾아가기는 스튜디오의 문서 에이전트 계약(applyTextCommand·focusTarget)을 쓴다.
 *   계약이 요구하는 해시(문단 글·서식·앞뒤 문맥)는 스튜디오 내부 ID 로 계산되므로, 현재 문서를 HWPX 로
 *   내보내 같은 rhwp 엔진으로 다시 읽어 스튜디오와 똑같은 식으로 계산한다(document-agent/controller.ts).
 * - 문서 수명은 앱이 쥔다: 스튜디오를 ?chrome=embed 로 띄워 스튜디오 자체의 열기·새로 만들기·저장·PDF·인쇄
 *   메뉴와 단축키를 없앤다(스튜디오가 내려받기로 "저장"하고 dirty 를 지우면 앱이 저장된 줄 안다).
 *   편집기 안 Ctrl/⌘+S 는 save_request 로 앱에 넘긴다(스튜디오는 같은 출처 iframe 이라 키를 먼저 본다).
 */
import { createStudio } from './sdk/index.js';

const params = new URLSearchParams(location.search);
const parentOrigin = params.get('parent') || '';
const ALLOWED = [/^tauri:\/\/localhost$/, /^https?:\/\/tauri\.localhost$/, /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
const parentOk = parentOrigin === 'null' || ALLOWED.some((re) => re.test(parentOrigin));
const target = parentOrigin && parentOrigin !== 'null' ? parentOrigin : '*';
const send = (msg, transfer = []) => window.parent.postMessage(msg, target, transfer);

const FS = '\u0002';
/** 스튜디오 안 앱 플러그인 (scripts/rhwp-patches.mjs 가 허용 목록에 넣는다) */
const AGENT_PLUGIN = 'kordoc-agent';
const AGENT_METHODS = new Set([
  'foreignChanges', 'readText', 'findText', 'replaceText', 'replaceAllText', 'insertParagraphs', 'deleteParagraph', 'insertTable',
  'formatText', 'formatParagraph', 'listTables', 'readTable', 'fillCells', 'addTableLines', 'removeTableLines', 'deleteTable',
  'reveal', 'selection', 'replaceSelection', 'formatSelection', 'listFields', 'fillField', 'insertToc', 'refreshToc',
  'listNotes', 'insertNote', 'editNote', 'deleteNote', 'measureTabs', 'clearMarks', 'listStyles', 'formatCells', 'mergeCells',
  'splitCell', 'readStyle', 'createStyle', 'editStyle', 'undo',
]);
let agentLoaded = null;
const enc = new TextEncoder();
let studio = null;
let docLoaded = false;
let lastSeq = -1;
let lastDirty = false;
/** 문서를 바꿀 때마다 +1 — 바꾸기 전에 시작한 상태 확인 결과가 새 문서로 새지 않게 */
let docGen = 0;
/** 변경 확인 — 앱이 편집 화면을 떠나면 watch 로 끈다 */
let watching = true;
let pollTimer = 0;
let polling = false;

// ── 해시 (스튜디오 document-agent 와 같은 식) ──

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let rhwpMod = null;
async function rhwp() {
  if (!rhwpMod) {
    rhwpMod = await import('./studio/rhwp.js');
    await rhwpMod.default({ module_or_path: new URL('./studio/rhwp_bg.wasm', location.href) });
  }
  return rhwpMod;
}

/** 현재 문서를 HWPX 로 내보내 다시 읽은 사본 (해시·문단 찾기용) */
async function snapshotDoc() {
  const m = await rhwp();
  const bytes = await studio.exportHwpx();
  return new m.HwpDocument(bytes);
}

const J = (s) => JSON.parse(s);
const paraLen = (d, s, p) => d.getParagraphLength(s, p);
const paraText = (d, s, p) => { const n = paraLen(d, s, p); return n > 0 ? d.getTextRange(s, p, 0, n) : ''; };
const charIds = (d, s, p, n) => { const ids = []; for (let o = 0; o < Math.max(n, 1); o += 1) ids.push(J(d.getCharPropertiesAt(s, p, o)).charShapeId); return ids; };

async function semantic(d, s, p) {
  const length = paraLen(d, s, p);
  const text = length > 0 ? d.getTextRange(s, p, 0, length) : '';
  return {
    section: s,
    paragraph: p,
    length,
    textSha256: await sha256Hex(text),
    paraShapeId: J(d.getParaPropertiesAt(s, p)).paraShapeId,
    styleId: J(d.getStyleAt(s, p)).id,
    charShapeIds: charIds(d, s, p, length),
    controls: J(d.getControlTextPositions(s, p)),
  };
}

async function evidence(d, s, p) {
  const length = paraLen(d, s, p);
  if (J(d.getControlTextPositions(s, p)).length > 0) throw new Error('표·그림 같은 개체가 든 문단');
  for (let o = 0; o <= length; o += 1) {
    if (J(d.getFieldInfoAt(s, p, o)).inField) throw new Error('누름틀이 든 문단');
  }
  const ids = charIds(d, s, p, length);
  if (!ids.every((x) => x === ids[0])) throw new Error('글자 모양이 섞인 문단');
  const text = length > 0 ? d.getTextRange(s, p, 0, length) : '';
  const previous = p > 0 ? await semantic(d, s, p - 1) : null;
  const next = p + 1 < d.getParagraphCount(s) ? await semantic(d, s, p + 1) : null;
  return {
    text,
    length,
    textSha256: await sha256Hex(text),
    formatSha256: await sha256Hex(JSON.stringify({ schemaVersion: 1, charShapeId: ids[0], paraShapeId: J(d.getParaPropertiesAt(s, p)).paraShapeId, styleId: J(d.getStyleAt(s, p)).id })),
    adjacentContextSha256: await sha256Hex(JSON.stringify({ schemaVersion: 1, previous, next })),
  };
}

const normText = (t) => String(t ?? '').replace(/\r\n/g, '\n');

/** 지금 상태. getDocumentState 는 부를 때마다 문서 전체를 내보내 해시를 내서(큰 문서는 한 번에 수 초) 쓰지 않는다:
 *  dirty·형식은 커맨드 문맥, changeSeq 는 커서 문맥(커서 문단 하나만 본다)에서 읽는다 */
async function docState() {
  const [ctx, sel, pageCount] = await Promise.all([studio.commands.context(), studio.getSelectionContext(), studio.pageCount()]);
  return { format: ctx.sourceFormat === 'hwp' ? 'hwp' : 'hwpx', dirty: !!ctx.isDirty, changeSeq: sel.changeSeq, pageCount };
}

// ── 동작 ──

const ops = {
  async load({ bytes, name }) {
    // 바꾸는 동안엔 상태 확인을 멈춘다 (앞 문서의 dirty 가 새 문서 알림으로 새지 않게)
    docLoaded = false;
    docGen += 1;
    const r = await studio.loadFile(new Uint8Array(bytes), name || '문서.hwpx', { skipUnsavedGuard: true, suppressDialogs: true });
    docLoaded = true;
    lastSeq = -1;
    lastDirty = false;
    schedulePoll(1000);
    return { pageCount: r.pageCount };
  },
  async new_doc() {
    const r = await studio.commands.execute('file:new-doc');
    // embed 프로필엔 새 문서 명령이 없다 → 빈 문서는 앱이 만들어 load 로 연다
    if (!r?.ok) throw new Error('편집기에서 빈 문서를 만들 수 없습니다. 빈 문서는 작성 단계의 "빈 문서로 시작"으로 만드세요.');
    docLoaded = true;
    lastSeq = -1;
    return { pageCount: await studio.pageCount() };
  },
  async export({ format }) {
    const b = format === 'hwp' ? await studio.exportHwp() : await studio.exportHwpx();
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    return { result: { bytes: buf }, transfer: [buf] };
  },
  async state() {
    return docState();
  },
  async text() {
    return { text: normText(await studio.hwpctrl.call('GetTextFile', ['TEXT', ''])) };
  },
  /** 커서(또는 선택)가 있는 본문 문단 글. HwpCtrl 의 블록은 화면 선택과 따로 놀아 쓰지 않는다 */
  async selection_text() {
    const sel = await studio.getSelectionContext();
    if (!sel.target) return { text: '', target: null, collapsed: sel.collapsed };
    const d = await snapshotDoc();
    try {
      const t = { section: sel.target.section, paragraph: sel.target.paragraph };
      return { text: paraText(d, t.section, t.paragraph), target: t, collapsed: sel.collapsed };
    } finally {
      d.free?.();
    }
  },
  /** 커서 문단을 통째로 바꿔 넣기 (실행 취소 1단계).
   *  글자 모양이 섞였거나 개체가 든 문단은 스튜디오 계약이 받지 않는다 → 그 문단을 선택해 두고
   *  { ok:false, fallback:'paste' } — 앱이 글을 클립보드에 넣고 사용자가 붙여 넣는다. */
  async replace_selection({ text }) {
    const sel = await studio.getSelectionContext();
    if (!sel.target) throw new Error('커서를 본문 문단에 두세요. 표 안 글은 복사해서 붙여 넣어야 합니다.');
    const state = await studio.getDocumentState();
    const { section, paragraph } = sel.target;
    const d = await snapshotDoc();
    let ev;
    let length;
    try {
      length = paraLen(d, section, paragraph);
      ev = await evidence(d, section, paragraph).catch((err) => ({ error: err.message }));
    } finally {
      d.free?.();
    }
    const target = { kind: 'body_paragraph', section, paragraph, charOffset: 0, length };
    if (ev.error) {
      await studio.focusTarget(target);
      return { ok: false, fallback: 'paste', reason: ev.error };
    }
    await studio.applyTextCommand({
      schemaVersion: 1,
      commandId: `kordoc-${Date.now()}`,
      expectedDocumentEpoch: state.documentEpoch,
      expectedChangeSeq: state.changeSeq,
      expectedDocumentSha256: state.documentSha256,
      target,
      expectedBeforeSha256: ev.textSha256,
      expectedFormatSha256: ev.formatSha256,
      expectedAdjacentContextSha256: ev.adjacentContextSha256,
      replacement: String(text).replace(/\r?\n+/g, ' ').trim(),
    });
    return { ok: true };
  },
  async fields() {
    const s = await studio.hwpctrl.call('GetFieldList', [0, 0]);
    return { names: [...new Set(String(s ?? '').split(FS).filter(Boolean))] };
  },
  async get_fields({ names }) {
    if (!names.length) return { values: {} };
    const s = await studio.hwpctrl.call('GetFieldText', [names.join(FS)]);
    const vals = String(s ?? '').split(FS);
    return { values: Object.fromEntries(names.map((n, i) => [n, vals[i] ?? ''])) };
  },
  async put_fields({ values }) {
    const have = new Set((await ops.fields()).names);
    const applied = [];
    const missing = [];
    const entries = [];
    for (const [k, v] of Object.entries(values)) {
      if (have.has(k)) { applied.push(k); entries.push([k, String(v ?? '')]); } else missing.push(k);
    }
    if (entries.length) {
      await studio.hwpctrl.batch((h) => { for (const [k, v] of entries) h.PutFieldText(k, v); });
    }
    return { applied, missing };
  },
  async find({ text }) {
    const needle = String(text ?? '').trim();
    if (!needle) return { found: false };
    const d = await snapshotDoc();
    try {
      for (let s = 0; s < d.getSectionCount(); s += 1) {
        for (let p = 0; p < d.getParagraphCount(s); p += 1) {
          if (!paraText(d, s, p).includes(needle)) continue;
          const r = await studio.focusTarget({ kind: 'body_paragraph', section: s, paragraph: p, charOffset: 0, length: paraLen(d, s, p) });
          return { found: !!r.focused };
        }
      }
      return { found: false };
    } finally {
      d.free?.();
    }
  },
  async command({ id, params: p, allow_dialog }) {
    const r = await studio.commands.execute(id, p || {}, { allowDialog: !!allow_dialog });
    return { ok: !!r?.ok, reason: r?.reason };
  },
  async undo() {
    const r = await studio.commands.execute('edit:undo');
    return { ok: !!r?.ok };
  },
  async redo() {
    const r = await studio.commands.execute('edit:redo');
    return { ok: !!r?.ok };
  },
  async saved({ name }) {
    try { await studio.notifySaved(name); } catch { /* notify-saved 를 모르는 스튜디오 */ }
    return { ok: true };
  },
  async chrome(v) {
    await studio.chrome.set(v);
    return { ok: true };
  },
  async watch({ on }) {
    watching = !!on;
    if (watching) schedulePoll(0);
    else clearTimeout(pollTimer);
    return { ok: true };
  },
  async agent({ method, args }) {
    if (typeof method !== 'string' || !AGENT_METHODS.has(method)) throw new Error(`모르는 편집기 도구: ${method}`);
    // 처음 부를 때 한 번 올린다. 실패하면 다음 호출이 다시 올린다
    if (!agentLoaded) {
      agentLoaded = studio.plugins.load(AGENT_PLUGIN);
      agentLoaded.catch(() => { agentLoaded = null; });
    }
    await agentLoaded;
    return { result: await studio.plugins.invoke(AGENT_PLUGIN, method, Array.isArray(args) ? args : []) };
  },
};

window.addEventListener('message', async (e) => {
  if (e.source !== window.parent || !parentOk) return;
  if (parentOrigin !== 'null' && e.origin !== parentOrigin) return;
  const msg = e.data;
  if (!msg || msg.kd !== 'req' || typeof msg.op !== 'string') return;
  const fn = ops[msg.op];
  if (!fn || !studio) {
    send({ kd: 'res', id: msg.id, ok: false, error: studio ? `모르는 동작: ${msg.op}` : '편집기가 아직 준비되지 않았습니다' });
    return;
  }
  try {
    const out = await fn(msg.args ?? {});
    if (out && out.transfer) send({ kd: 'res', id: msg.id, ok: true, result: out.result }, out.transfer);
    else send({ kd: 'res', id: msg.id, ok: true, result: out });
  } catch (err) {
    send({ kd: 'res', id: msg.id, ok: false, error: err?.message || String(err) });
  }
});

// 사용자가 직접 고친 것도 앱이 알게 — 상태를 보고 바뀌었으면 알림.
// 다음 확인은 앞 확인이 끝난 뒤에 잡고, 오래 걸렸으면 그 20배를 쉰다(최소 1초). 앱이 watch 로 끄면 멈춘다.
function schedulePoll(ms) {
  clearTimeout(pollTimer);
  if (watching && !polling) pollTimer = setTimeout(poll, ms);
}

async function poll() {
  if (!watching || !studio || !docLoaded) return;
  polling = true;
  const gen = docGen;
  const t0 = performance.now();
  try {
    const s = await docState();
    if (gen === docGen && docLoaded && (s.changeSeq !== lastSeq || s.dirty !== lastDirty)) {
      lastSeq = s.changeSeq;
      lastDirty = s.dirty;
      send({ kd: 'event', type: 'changed', state: s });
    }
  } catch { /* 문서 교체 중 */ }
  polling = false;
  schedulePoll(Math.max(1000, (performance.now() - t0) * 20));
}

// 편집기 안 Ctrl/⌘+S, Windows 에선 한컴의 Alt+S 도 → 앱이 저장 (embed 프로필의 스튜디오는 이 키를 삼키기만 한다)
const onMac = /Mac/.test(navigator.platform);
function forwardSaveKey(win) {
  win.addEventListener('keydown', (e) => {
    const key = String(e.key).toLowerCase();
    const ctrlS = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (key === 's' || key === 'ㄴ');
    const altS = !onMac && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyS';
    if (!ctrlS && !altS) return;
    e.preventDefault();
    if (!e.repeat) send({ kd: 'event', type: 'save_request' });
  }, true);
}

// 스튜디오 상태 줄의 개발자용 시간 표시 "(138.6ms)" 를 지운다 — 스튜디오 파일은 그대로 두고 같은 출처 iframe 의 글만 다듬는다
function hideTimings(win) {
  const doc = win.document;
  const clean = (el) => {
    const t = el.textContent || '';
    const c = t.replace(/\s*\(\d+(?:\.\d+)?\s*ms\)/g, '');
    if (c !== t) el.textContent = c;
  };
  const attach = () => {
    const el = doc.getElementById('sb-message');
    if (!el) return false;
    clean(el);
    new win.MutationObserver(() => clean(el)).observe(el, { childList: true, characterData: true, subtree: true });
    return true;
  };
  if (!attach()) {
    const mo = new win.MutationObserver(() => { if (attach()) mo.disconnect(); });
    mo.observe(doc.documentElement, { childList: true, subtree: true });
  }
}

(async () => {
  if (!parentOk) {
    document.getElementById('boot').textContent = '허용되지 않은 위치에서 열렸습니다.';
    return;
  }
  try {
    const version = await fetch('./version.json').then((r) => r.json()).catch(() => ({ studio: 'unknown' }));
    studio = await createStudio('#app', { studioUrl: new URL('./studio/?chrome=embed', location.href).href, plugins: ['hwpctrl'] });
    forwardSaveKey(studio.element.contentWindow);
    try { hideTimings(studio.element.contentWindow); } catch { /* 상태 줄 다듬기는 덤 */ }
    document.getElementById('boot').remove();
    // 앱 플러그인은 처음부터 올린다: AI 를 부르기 전에도 도구 줄의 스타일 목록을 문서에 맞추고 한컴 키를 건다
    agentLoaded = studio.plugins.load(AGENT_PLUGIN);
    agentLoaded.catch(() => { agentLoaded = null; });
    send({ kd: 'event', type: 'ready', studioVersion: version.studio });
  } catch (err) {
    document.getElementById('boot').textContent = `한글 편집기를 열지 못했습니다: ${err?.message || err}`;
    send({ kd: 'event', type: 'error', message: err?.message || String(err) });
  }
})();
