/** 엔진 관문 — 설치본 번들을 실제로 띄워서
 *  ① 도구 전수: 작업 에이전트 도구를 모두 실행 → 원본 해시 불변·결과는 결과 폴더에만·엔진이 죽지 않음
 *  ② 원본 보호 기본값: 출력 폴더를 안 정한 새 설치에서 결과가 원본 옆이 아님
 *  ③ MCP: 핸드셰이크·도구 목록·실행·허용 폴더 탈출 차단·stdout 순도
 *  ④ (--models) 실모델 에이전트: 같은 회신 기안문 작업을 모델마다 끝까지
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { SAMPLES, hashTree, record, startEngine } from './lib.mjs';

const A = '엔진';
const ORG = { name: '가온시', dept: '총무과', person: '김가온', position: '주무관', phone: '031-000-0000' };

function sandbox(settings) {
  const base = mkdtempSync(join(tmpdir(), 'kordoc-gate-'));
  const data = join(base, 'data');
  const out = join(base, 'out');
  const home = join(base, 'home');
  const docs = join(base, 'samples');
  for (const d of [data, out, home]) mkdirSync(d, { recursive: true });
  cpSync(SAMPLES, docs, { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ org: ORG, ...settings(out) }));
  // 홈은 기본 저장 위치 검사(defaultOutput)에서만 임시로 바꾼다: 홈을 바꾸면 Edge 가 200초 멈췄다 실패한다(실측)
  return { base, data, out, home, docs, env: {}, homeEnv: { USERPROFILE: home, HOME: home } };
}

export async function engineChecks({ models = [] }) {
  const repoBefore = hashTree(SAMPLES);
  await toolSweep();
  await defaultOutput();
  await mcpChecks();
  for (const m of models) await modelRun(m);
  const repoAfter = hashTree(SAMPLES);
  const changed = [...repoBefore].filter(([p, h]) => repoAfter.get(p) !== h).map(([p]) => relative(SAMPLES, p));
  record(A, '레포 예제 파일 불변', changed.length ? 'FAIL' : 'PASS', changed.join(', '));
}

const P = (s, ...rel) => join(s.docs, ...rel);
const LETTER = '1-받은공문_도민체육대회 참가 협조 요청.hwpx';
const LETTER_PDF = '1-받은공문_도민체육대회 참가 협조 요청.pdf';
const CLAIM = '3-민원서류_정보공개 청구서.hwpx';
const REPORT = '4-보고서_디지털 행정 혁신 추진계획.hwpx';

/** 도구마다 입력과 기대 — ok: 성공해야 함, any: 실패해도 되지만 엔진이 죽거나 원본을 건드리면 안 됨 */
function cases(s, written) {
  return [
    ['list_documents', { paths: [s.docs] }, 'ok'],
    ['read_document', { path: P(s, REPORT) }, 'ok'],
    ['search_documents', { paths: [s.docs], query: '디지털' }, 'ok'],
    ['read_incoming_letter', { paths: [P(s, LETTER)] }, 'ok'],
    ['find_versions', { path: P(s, REPORT) }, 'ok'],
    ['document_guide', { preset: 'official' }, 'ok'],
    ['org_format', {}, 'ok'],
    ['write_document', { markdown: '# 관문 시험 공문\n\n1. 관문 시험입니다.  끝.', preset: 'official' }, 'ok'],
    ['convert_to_hwp', { path: P(s, LETTER_PDF) }, 'ok'],
    ['form_fields', { path: P(s, CLAIM) }, 'ok'],
    ['fill_form', { path: P(s, CLAIM), values: { 성명: '홍길동' } }, 'any'],
    ['mail_merge', { template_path: P(s, CLAIM), data_path: join(s.base, '명부.csv') }, 'any'],
    ['collect_submissions', { paths: [P(s, '취합')], roster: ['총무과', '기획예산과', '감사과'] }, 'ok'],
    ['compare_documents', { old_path: P(s, REPORT), new_path: P(s, LETTER) }, 'ok'],
    ['extract_tables', { path: P(s, REPORT) }, 'ok'],
    ['precheck', { path: P(s, REPORT) }, 'ok'],
    ['fix_notation', { path: P(s, REPORT), fixes: [{ from: '디지털', to: '디지털' }] }, 'any'],
    ['check_law_citations', { path: P(s, REPORT) }, 'ok'],
    ['redact_personal_info', { path: P(s, CLAIM) }, 'ok'],
    ['make_pdf', { path: P(s, REPORT) }, 'ok'],
    ['bundle_pdf', { paths: [P(s, REPORT), P(s, LETTER_PDF)], page_numbers: true }, 'ok'],
    ['shrink_pdf', { path: P(s, LETTER_PDF) }, 'ok'],
  ];
}

async function toolSweep() {
  const s = sandbox((out) => ({ convert: { output_dir: out, ocr: 'off' }, privacy: { offline: true } }));
  writeFileSync(join(s.base, '명부.csv'), '성명,주소\n홍길동,가온시 1\n김가온,가온시 2\n');
  const before = hashTree(s.docs);
  const e = startEngine({ dataDir: s.data, env: s.env });
  try {
    const { tools } = await e.call('agent_tools', {});
    let written = null;
    const list = cases(s, () => written);
    const missing = tools.map((t) => t.name).filter((n) => n !== 'open_result' && !list.some(([c]) => c === n));
    record(A, '도구 전수 목록이 도구 정의와 맞음', missing.length ? 'FAIL' : 'PASS', missing.length ? `시험 안 한 도구: ${missing.join(', ')}` : `${list.length}개`);
    const outside = [];
    for (const [name, input, want] of list) {
      const t0 = Date.now();
      let r;
      try { r = await e.call('agent_tool_run', { name, input }, 240_000); } catch (err) {
        record(A, `도구 ${name}`, 'FAIL', `엔진 응답 없음: ${err.message}`, Date.now() - t0);
        continue;
      }
      if (name === 'write_document' && r.files?.[0]) written = r.files[0];
      for (const f of r.files ?? []) if (!f.startsWith(s.out)) outside.push(`${name}: ${f}`);
      const status = r.isError ? (want === 'ok' ? 'FAIL' : 'WARN') : 'PASS';
      // 심사위원이 누르고 기다리는 시간: 한 도구가 30초를 넘으면 경고 (PDF 가 대체 경로로 빠져도 여기서 보인다)
      const slow = !r.isError && Date.now() - t0 > 30_000;
      record(A, `도구 ${name}`, slow ? 'WARN' : status, `${r.isError ? r.output : r.summary}${slow ? ' (30초 넘음)' : ''}`, Date.now() - t0);
    }
    record(A, '결과 파일은 모두 결과 폴더 안', outside.length ? 'FAIL' : 'PASS', outside.join('\n'));
    const after = hashTree(s.docs);
    const changed = [...before].filter(([p, h]) => after.get(p) !== h).map(([p]) => relative(s.docs, p));
    const added = [...after.keys()].filter((p) => !before.has(p)).map((p) => relative(s.docs, p));
    record(A, '원본 불변 (도구 전수 뒤 해시)', changed.length ? 'FAIL' : 'PASS', changed.join(', '));
    record(A, '원본 폴더에 새 파일 없음', added.length ? 'FAIL' : 'PASS', added.join(', '));
    const ping = await e.call('ping', {}).catch(() => null);
    record(A, '전수 뒤에도 엔진 살아 있음', ping === 'pong' ? 'PASS' : 'FAIL');
  } finally { await e.stop(); rmSync(s.base, { recursive: true, force: true }); }
}

/** 출력 폴더를 안 정한 새 설치: 결과가 원본 옆이 아니라 (임시 홈의) KorDoc AI 결과 */
async function defaultOutput() {
  const s = sandbox(() => ({}));
  const e = startEngine({ dataDir: s.data, env: s.homeEnv });
  try {
    // Chromium 을 쓰지 않는 도구로 (홈을 바꾼 채 Edge 를 띄우면 멈춘다)
    const r = await e.call('agent_tool_run', { name: 'extract_tables', input: { path: P(s, REPORT) } }, 240_000);
    const f = r.files?.[0] ?? '';
    const ok = !!f && !f.startsWith(s.docs) && f.includes('KorDoc AI 결과');
    record(A, '새 설치 기본 저장 위치 = KorDoc AI 결과 (원본 옆 아님)', ok ? 'PASS' : 'FAIL', f || r.output);
  } finally { await e.stop(); rmSync(s.base, { recursive: true, force: true }); }
}

async function mcpChecks() {
  const s = sandbox((out) => ({ convert: { output_dir: out } }));
  const e = startEngine({ dataDir: s.data, mcp: true, env: { ...s.env, KORDOC_ROOT: s.docs } });
  try {
    const init = await e.raw('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gate', version: '1' } });
    record(A, 'MCP initialize', init.result?.serverInfo?.name === 'kordoc-ai' ? 'PASS' : 'FAIL', JSON.stringify(init.result?.serverInfo ?? init.error));
    e.notify('notifications/initialized', {});
    const list = await e.raw('tools/list', {});
    const names = (list.result?.tools ?? []).map((t) => t.name);
    record(A, 'MCP tools/list (앱 전용 도구 없음)', names.length >= 20 && !names.includes('open_result') ? 'PASS' : 'FAIL', `${names.length}개`);
    const call = await e.raw('tools/call', { name: 'precheck', arguments: { path: P(s, REPORT) } }, 240_000);
    record(A, 'MCP tools/call precheck', call.result && !call.result.isError ? 'PASS' : 'FAIL', call.result?.content?.[0]?.text?.split('\n')[0]);
    const esc = await e.raw('tools/call', { name: 'read_document', arguments: { path: `${s.docs}/../data/settings.json` } });
    record(A, 'MCP 허용 폴더 탈출(..) 차단', esc.result?.isError && /허용한 폴더/.test(esc.result.content[0].text) ? 'PASS' : 'FAIL', esc.result?.content?.[0]?.text?.slice(0, 80));
    record(A, 'MCP stdout 에 JSON 아닌 줄 없음', e.nonJson.length ? 'FAIL' : 'PASS', e.nonJson.slice(0, 3).join(' | '));
  } finally { await e.stop(); rmSync(s.base, { recursive: true, force: true }); }
}

/** 실모델 — "local:gemma4:e4b"(Ollama) · "claude-code" · "codex" */
async function modelRun(spec) {
  const [provider, ...rest] = spec.split(':');
  const model = rest.join(':');
  const ai = provider === 'local'
    ? { provider: 'local', local: { base_url: 'http://127.0.0.1:11434/v1', api_key: '', model }, timeout_ms: 300_000 }
    : { provider, allow_subscription: true, [provider.replace('-', '_')]: { model, cli_path: '' }, timeout_ms: 300_000 };
  const s = sandbox((out) => ({ ai, convert: { output_dir: out, ocr: 'off' } }));
  const e = startEngine({ dataDir: s.data, env: s.env });
  const t0 = Date.now();
  try {
    const { system, tools } = await e.call('agent_tools', {});
    const events = [{ role: 'user', text: '붙인 받은 공문에 회신하는 기안문을 만들어 줘. 우리 시는 선수 20명이 참가한다.', context: `사용자가 붙인 파일·폴더:\n- ${P(s, LETTER)}` }];
    const files = [];
    const used = [];
    for (let i = 0; i < 14; i++) {
      const turn = await e.call('ai_agent_step', { system, tools, events }, 300_000);
      events.push({ role: 'assistant', text: turn.text, calls: turn.calls.map(({ id, name, input }) => ({ id, name, input })) });
      if (!turn.calls.length) break;
      const results = [];
      for (const c of turn.calls) {
        if (c.inputError) { results.push({ id: c.id, name: c.name, output: c.inputError, isError: true }); continue; }
        const r = await e.call('agent_tool_run', { name: c.name, input: c.input }, 240_000);
        used.push(c.name);
        files.push(...(r.files ?? []));
        results.push({ id: c.id, name: c.name, output: r.output, ...(r.isError ? { isError: true } : {}) });
      }
      events.push({ role: 'tool', results });
    }
    const hwpx = files.find((f) => f.endsWith('.hwpx') && existsSync(f));
    const ok = !!hwpx && readFileSync(hwpx).subarray(0, 2).toString() === 'PK';
    record('모델', `${spec} 회신 기안문 끝까지`, ok ? 'PASS' : 'FAIL', `${used.join(' → ')}${hwpx ? '' : ' (한글 파일 없음)'}`, Date.now() - t0);
  } catch (err) {
    record('모델', `${spec} 회신 기안문 끝까지`, 'FAIL', err.message, Date.now() - t0);
  } finally { await e.stop(); rmSync(s.base, { recursive: true, force: true }); }
}
