/**
 * 엔진 층 전수 검증 — 설치본과 같은 사이드카 번들을 앱처럼 JSON-RPC 로 불러 기능을 하나씩 실제로 돌린다.
 * 결과 파일은 kordoc 으로 다시 읽어 내용까지 대조한다. 보고서: <work>/e2e-engine-report.md
 *
 * 사용: node scripts/e2e-engine.mjs [--only 그룹,그룹] [--ai] [--keep]
 *   --ai     AI 기능까지 (로컬 Ollama gemma4:e4b + 내장 GGUF — 무료, 유료 클라우드는 부르지 않는다)
 *   --keep   작업 폴더를 지우지 않음
 * 앞서 필요: node scripts/build-sidecar.mjs (dist/bundle.mjs·dist/node_modules·models), 편집기는 build-rhwp-studio.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve('.');
const SIDECAR = join(ROOT, 'node-sidecar');
const requireSidecar = createRequire(join(SIDECAR, 'package.json'));
const k = await import(pathToFileURL(requireSidecar.resolve('kordoc')).href);
const { PDFDocument } = await import(pathToFileURL(requireSidecar.resolve('pdf-lib')).href);
const sharp = (await import(pathToFileURL(requireSidecar.resolve('sharp')).href)).default;

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const withAi = argv.includes('--ai');
const keep = argv.includes('--keep');

const WORK = mkdtempSync(join(tmpdir(), 'kordoc-e2e-'));
const FIX = join(WORK, 'fixtures');
const OUT = join(WORK, 'out');
mkdirSync(FIX, { recursive: true });
mkdirSync(OUT, { recursive: true });
const CORPUS = join(homedir(), 'workspace', 'kordoc', 'bench', 'corpus');
const SAMPLES = join(SIDECAR, 'samples');

// ── 사이드카 ──

const bundledNode = join(ROOT, 'src-tauri', 'resources', 'node', process.platform === 'win32' ? 'node.exe' : 'node');

class Sidecar {
  constructor(env = {}) {
    this.dataDir = mkdtempSync(join(WORK, 'appdata-'));
    this.child = spawn(existsSync(bundledNode) ? bundledNode : process.execPath, ['dist/bundle.mjs'], {
      cwd: SIDECAR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, KORDOC_AI_DATA_DIR: this.dataDir, KORDOC_MODEL_CACHE: '', ...env },
    });
    this.next = 1;
    this.pending = new Map();
    this.notes = [];
    this.stderr = '';
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id == null) { this.notes.push(m); continue; }
        const p = this.pending.get(m.id);
        if (!p) continue;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-20000); });
  }
  call(method, params = {}, timeoutMs = 300_000) {
    const id = this.next++;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method}: ${timeoutMs / 1000}초 시간 초과`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  kill() { this.child.kill('SIGKILL'); }
}

// ── 검증 도구 ──

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const exists = (p, label = p) => { assert(p && existsSync(p), `파일 없음: ${label}`); return statSync(p).size; };
async function parseFile(p, opts = {}) {
  const r = await k.parse(readFileSync(p), opts);
  assert(r.success, `kordoc 재파싱 실패(${basename(p)}): ${r.error}`);
  return r;
}
const norm = (s) => String(s).replace(/\s+/g, '');
async function pdfPages(p) { return (await PDFDocument.load(readFileSync(p))).getPageCount(); }

// ── 픽스처 ──

async function makeFixtures() {
  cpSync(SAMPLES, join(FIX, 'samples'), { recursive: true });
  const pick = (dir, re) => {
    const d = join(CORPUS, dir);
    if (!existsSync(d)) return null;
    const f = readdirSync(d).find((n) => re.test(n));
    return f ? join(d, f) : null;
  };
  const files = {
    received_pdf: join(FIX, 'samples', '1-받은공문_도민체육대회 참가 협조 요청.pdf'),
    received_hwpx: join(FIX, 'samples', '1-받은공문_도민체육대회 참가 협조 요청.hwpx'),
    collect: readdirSync(join(FIX, 'samples', '취합')).map((f) => join(FIX, 'samples', '취합', f)),
    pii: join(FIX, 'samples', '3-민원서류_정보공개 청구서.hwpx'),
    report: join(FIX, 'samples', '4-보고서_디지털 행정 혁신 추진계획.hwpx'),
    hwp5: pick('hwp5', /\.hwp$/),
    hwp_small: pick('korea-kr-pairs2', /AI_기반_사이버보안.*\.hwp$/),
    pdf_text: pick('korea-kr', /\.pdf$/),
    hwpx_real: pick('korea-kr', /\.hwpx$/),
    docx: pick(join('formats', 'docx'), /\.docx$/),
    xlsx: pick(join('formats', 'xlsx'), /\.xlsx$/),
    xls: pick(join('formats', 'xls'), /\.xls$/),
    hml: pick(join('formats', 'hml'), /\.hml$/),
  };
  // PPTX: LibreOffice 로 받은 공문 PDF → PPTX
  const soffice = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
  if (existsSync(soffice)) {
    try {
      execFileSync(soffice, ['--headless', '--infilter=impress_pdf_import', '--convert-to', 'pptx', files.received_pdf, '--outdir', FIX], { stdio: 'ignore', timeout: 120_000 });
      const p = join(FIX, `${basename(files.received_pdf, '.pdf')}.pptx`);
      if (existsSync(p)) files.pptx = p;
    } catch { /* PPTX 없이 */ }
  }
  // 스캔본: 보고서 1쪽을 PNG 로 그려 이미지만 든 PDF 로
  const r = await k.renderDocument(readFileSync(files.collect[0]), { format: 'png', pages: '1' });
  const png = Buffer.from(r.assets[0].data ?? r.assets[0].bytes);
  files.scan_png = join(FIX, 'scan.png');
  writeFileSync(files.scan_png, png);
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([595, 842]);
  page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  files.scan_pdf = join(FIX, 'scan.pdf');
  writeFileSync(files.scan_pdf, await doc.save());
  // 도장 이미지
  files.seal = join(FIX, 'seal.png');
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="90" fill="none" stroke="#c00" stroke-width="12"/><text x="100" y="125" font-size="80" text-anchor="middle" fill="#c00">印</text></svg>')).png().toFile(files.seal);
  // CP949 글 (한국어 윈도우 엑셀 CSV 저장본) — '제목,본문,파일명\n똠양꿍 행사 협조,안내 본문,셋째\n', 똠 = 0x8C63 (EUC-KR 밖 확장 한글)
  files.cp949_csv = join(FIX, 'cp949.csv');
  writeFileSync(files.cp949_csv, Buffer.from('c1a6b8f12cbabbb9ae2cc6c4c0cfb8ed0a8c63bee7b2e120c7e0bbe720c7f9c1b62cbec8b3bb20babbb9ae2cbcc2c2b00a', 'hex'));
  // 명부
  files.roster = join(FIX, '명부.csv');
  writeFileSync(files.roster, '\uFEFF수신자,제목,본문,시행번호\n가온시 총무과장,체육대회 참가 협조,1. 관련: 가온도 체육진흥과-2203,행정지원과-100\n가온시 기획예산과장,체육대회 참가 협조,1. 관련: 가온도 체육진흥과-2203,행정지원과-101\n가온시 민원봉사과장,체육대회 참가 협조,1. 관련: 가온도 체육진흥과-2203,행정지원과-102\n');
  return files;
}

// ── 검사 목록 ──

const checks = [];
const check = (group, name, fn, opts = {}) => checks.push({ group, name, fn, ...opts });

function defineChecks(f, sc) {
  // 시스템
  check('system', 'ping·system_info', async () => {
    assert((await sc.call('ping')) === 'pong', 'ping');
    const i = await sc.call('system_info');
    // 정본: node-sidecar/package.json 의 정확 버전
    const want = JSON.parse(readFileSync(join(SIDECAR, 'package.json'), 'utf-8')).dependencies.kordoc;
    assert(i.kordoc_version === want, `kordoc ${i.kordoc_version} (package.json ${want})`);
    assert(i.ocr_models_ready, 'OCR 모델 없음');
    return `kordoc ${i.kordoc_version}, node ${i.node_version}, ${i.platform}`;
  });
  check('system', 'engine_selftest', async () => {
    const r = await sc.call('engine_selftest', {});
    assert(r.ok, r.steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.detail}`).join('; '));
    return r.steps.map((s) => `${s.name} ${s.ms}ms`).join(', ');
  });
  check('system', '설정 저장·키 가림·폐쇄망 토글', async () => {
    await sc.call('update_settings', { settings: { org: { name: '가온시', dept: '행정지원과', person: '홍길동', phone: '000-111-2222', approval_line: ['주무관', '팀장', '과장'] }, ai: { gemini: { api_key: 'AIzaSECRET123456' } } } });
    const s = await sc.call('get_settings');
    assert(s.org.name === '가온시' && s.org.approval_line.length === 3, 'org 저장 안 됨');
    assert(s.ai.gemini.api_key.includes('****') && !s.ai.gemini.api_key.includes('SECRET'), '키가 가려지지 않음');
    await sc.call('update_settings', { settings: { ai: { gemini: { api_key: s.ai.gemini.api_key } } } }); // 가린 값 되돌림 방지 확인
    const raw = JSON.parse(readFileSync(join(sc.dataDir, 'settings.json'), 'utf-8'));
    assert(raw.ai.gemini.api_key === 'AIzaSECRET123456', '가린 키가 원래 키를 덮어씀');
    return '기관 정보 저장, 키 가림·역전파 차단 확인';
  });
  check('system', 'scan_paths', async () => {
    const r = await sc.call('scan_paths', { paths: [join(FIX, 'samples')] });
    assert(r.files.length >= 9, `파일 ${r.files.length}개`);
    return `${r.files.length}개 (${[...new Set(r.files.map((x) => x.format))].join('·')})`;
  });
  check('system', 'models_status', async () => {
    const r = await sc.call('models_status');
    assert(r.ocr.ready, 'OCR 모델 준비 안 됨');
    return `ocr ${r.ocr.dir}`;
  });
  check('system', 'samples_list', async () => {
    const r = await sc.call('samples_list');
    assert(r.scenarios.length === 4 && r.scenarios.every((s) => s.files.length > 0), '시나리오 파일 누락');
    return r.scenarios.map((s) => `${s.id}:${s.files.length}`).join(' ');
  });

  // 문서 읽기
  const readTargets = [['hwpx', f.hwpx_real], ['hwp5', f.hwp5], ['pdf', f.pdf_text], ['docx', f.docx], ['xlsx', f.xlsx], ['xls', f.xls], ['pptx', f.pptx], ['hml', f.hml]];
  for (const [label, p] of readTargets) {
    check('read', `doc_info·convert ${label}`, async () => {
      assert(p, `${label} 픽스처 없음`);
      const info = await sc.call('doc_info', { path: p });
      const md = await sc.call('convert', { path: p, format: 'md', save: false });
      assert(md.content && md.content.length > 30, `글이 거의 없음(${md.content?.length})`);
      const ref = await k.parse(readFileSync(p));
      assert(ref.success && norm(md.content).slice(0, 60) === norm(ref.markdown).slice(0, 60), '직접 kordoc 결과와 다름');
      return `${info.format}, ${info.page_count ?? '-'}쪽, ${md.content.length}자, layout=${info.has_layout}`;
    });
  }
  check('read', 'CP949 CSV 읽기 (확장 한글 똠)', async () => {
    const r = await sc.call('convert', { path: f.cp949_csv, format: 'md', save: false });
    assert(r.content.includes('똠양꿍 행사 협조'), `글자 깨짐: ${JSON.stringify(r.content.slice(0, 60))}`);
    return JSON.stringify(r.content.split('\n')[1]);
  });
  check('read', 'convert 형식 5종 + 저장', async () => {
    const out = [];
    for (const format of ['md', 'html', 'json', 'chunks', 'txt']) {
      const r = await sc.call('convert', { path: f.report, format, output_dir: OUT });
      exists(r.output_path, `${format} 결과`);
      if (format === 'json' || format === 'chunks') JSON.parse(r.content);
      out.push(`${format} ${r.content.length}자`);
    }
    return out.join(', ');
  });
  check('read', 'convert_batch', async () => {
    const r = await sc.call('convert_batch', { paths: f.collect, format: 'md', output_dir: join(OUT, 'batch') });
    assert(r.results.length === f.collect.length && r.results.every((x) => x.ok), JSON.stringify(r.results.filter((x) => !x.ok)));
    return `${r.results.length}개 성공`;
  });
  check('read', 'ocr 로컬 (스캔 PDF·이미지)', async () => {
    const a = await sc.call('ocr', { input_path: f.scan_pdf, output_path: join(OUT, 'scan-ocr.md') });
    assert(a.success && /직무교육|수요조사/.test(a.markdown), `OCR 결과에 기대 글 없음: ${a.markdown?.slice(0, 80)}`);
    const b = await sc.call('convert', { path: f.scan_png, format: 'md', save: false });
    assert(/직무교육|수요조사/.test(b.content), `이미지 OCR 실패: ${b.content.slice(0, 80)}`);
    return `PDF ${a.markdown.length}자, PNG ${b.content.length}자`;
  });
  check('read', 'render_pages (HWPX·HWP·PDF·이미지, DOCX 는 NO_LAYOUT)', async () => {
    const res = [];
    for (const [label, p] of [['hwpx', f.report], ['hwp', f.hwp5], ['pdf', f.received_pdf], ['png', f.scan_png]]) {
      const r = await sc.call('render_pages', { path: p, pages: '1', max_width: 800 });
      assert(r.pages[0]?.data_url?.startsWith('data:image/'), `${label} 미리보기 없음`);
      res.push(`${label} ${r.page_count}쪽`);
    }
    let noLayout = false;
    try { await sc.call('render_pages', { path: f.docx }); } catch (e) { noLayout = e.message.startsWith('NO_LAYOUT'); }
    assert(noLayout, 'DOCX 가 NO_LAYOUT 오류를 안 냄');
    return res.join(', ') + ', docx NO_LAYOUT';
  });

  // 만들기
  check('create', 'gongmun_meta', async () => {
    const m = await sc.call('gongmun_meta');
    assert(m.presets.length >= 9 && m.agencies.length >= 52 && m.templates.length >= 2, `프리셋 ${m.presets.length}·기관 ${m.agencies.length}·서식 ${m.templates.length}`);
    return `프리셋 ${m.presets.length}, 기관 ${m.agencies.length}, 서식 ${m.templates.length}`;
  });
  check('create', 'generate_hwpx (프리셋·기관·표지·결재란) + 미리보기', async () => {
    const md = '# 2026년 직원 체육대회 개최 계획\n\n> 직원 화합을 위해 체육대회를 개최하고자 함\n\n## 추진 개요\n\n- 일시: 2026. 11. 6.(금)\n- 장소: 구민체육센터\n';
    const pv = await sc.call('generate_hwpx', { markdown: md, preset: '보고서', preview_only: true, preview_pages: 1 });
    assert(pv.preview?.[0]?.data_url?.startsWith('data:image/png'), '미리보기 없음');
    const meta = await sc.call('gongmun_meta');
    const agency = meta.agencies.find((a) => a !== '공통') ?? meta.agencies[0];
    const r = await sc.call('generate_hwpx', { markdown: md, preset: '보고서', agency, cover: { org: '가온시', date: '2026. 10. 10.' }, approval: ['주무관', '팀장', '과장'], output_path: join(OUT, 'gen.hwpx') });
    exists(r.output_path);
    const v = await k.validateHwpx(readFileSync(r.output_path));
    assert(v.ok, `구조 검증 실패: ${JSON.stringify(v.issues).slice(0, 200)}`);
    assert(norm((await parseFile(r.output_path)).markdown).includes(norm('구민체육센터')), '본문 누락');
    return `기관 ${agency}, 경고 ${r.warnings.length}, 표기법 ${r.lint.length}`;
  });
  check('create', 'template_fields·template_fill (표준 기안문)', async () => {
    const fl = await sc.call('template_fields', { template: 'gian' });
    assert(fl.fields.length >= 20, `칸 ${fl.fields.length}`);
    const r = await sc.call('template_fill', { template: 'gian', values: { 행정기관명: '가온시', 제목: '체육대회 참가 회신', 본문: '1. 관련: 가온도 체육진흥과-2203\n2. 우리 시는 참가합니다.' }, output_path: join(OUT, 'gian.hwpx') });
    const md = (await parseFile(r.output_path)).markdown;
    assert(md.includes('체육대회 참가 회신') && md.includes('우리 시는 참가합니다'), '채운 값이 문서에 없음');
    return `칸 ${fl.fields.length}, 채움 ${r.filled.length}`;
  });
  check('create', 'mail_merge (수신처별 공문 3장 + 안 맞는 명부 거절)', async () => {
    const r = await sc.call('mail_merge', { template: 'gian', data_path: f.roster, name_column: '수신자', output_dir: join(OUT, 'merge') });
    assert(r.outputs.length === 3 && r.failed.length === 0, `출력 ${r.outputs.length}, 실패 ${JSON.stringify(r.failed)}`);
    for (const [i, p] of r.outputs.entries()) {
      const md = (await parseFile(p)).markdown;
      assert(md.includes(['총무과장', '기획예산과장', '민원봉사과장'][i]) && md.includes(`행정지원과-10${i}`), `${basename(p)} 값 누락`);
    }
    // 칸 이름이 하나도 안 맞는 명부는 친절한 오류로 실패해야 한다
    writeFileSync(join(FIX, 'bad-roster.csv'), '이름,부서\n홍길동,총무과\n');
    const bad = await sc.call('mail_merge', { template: 'gian', data_path: join(FIX, 'bad-roster.csv'), output_dir: join(OUT, 'merge-bad') });
    assert(bad.outputs.length === 0 && /칸 이름/.test(bad.failed[0]?.error ?? ''), '안 맞는 명부를 거르지 않음');
    return r.outputs.map((p) => basename(p)).join(', ');
  });
  check('create', 'template_library·add·analyze·starter·remove', async () => {
    const lib = await sc.call('template_library');
    assert(lib.templates.some((t) => t.source === 'builtin'), '내장 서식 없음');
    const an = await sc.call('template_analyze', { path: f.received_hwpx });
    assert(an.fields.length >= 10 && an.strategy === 'fill_fields', `분석: 칸 ${an.fields.length}, ${an.strategy}`);
    const added = await sc.call('template_add', { path: f.received_hwpx, name: '가온도 시행문', category: '기안문' });
    assert((await sc.call('template_library')).templates.some((t) => t.id === added.id), '등록 안 됨');
    const st = await sc.call('template_starter', { preset: '보고서', output_path: join(OUT, 'starter.hwpx') });
    exists(st.output_path);
    assert(await sc.call('template_remove', { id: added.id }), '삭제 실패');
    return `내장 ${lib.templates.length}, 분석 칸 ${an.fields.length}, 시작 서식 OK`;
  });
  check('create', 'org_autofill', async () => {
    await sc.call('update_settings', { settings: { org: { name: '가온시', dept: '행정지원과', person: '홍길동', phone: '000-111-2222', approval_line: ['주무관', '팀장', '과장'] } } });
    const r = await sc.call('org_autofill', { fields: ['행정기관명', '담당부서', '기안자', '담당자전화번호', '시행일', '결재직위1', '결재직위2', '없는칸'] });
    assert(r.values['행정기관명'] === '가온시' && r.values['결재직위1'] === '주무관' && /\d{4}\. \d{1,2}\. \d{1,2}\./.test(r.values['시행일'] ?? ''), JSON.stringify(r.values));
    assert(!r.matched.includes('없는칸'), '없는 칸을 채움');
    return `${r.matched.length}칸: ${JSON.stringify(r.values).slice(0, 120)}`;
  });
  check('create', 'to_hwpx (PDF·DOCX → 한글)', async () => {
    const a = await sc.call('to_hwpx', { path: f.received_pdf, output_path: join(OUT, 'from-pdf.hwpx') });
    assert(norm((await parseFile(a.output_path)).markdown).includes(norm('한마음 체육대회')), 'PDF→HWPX 본문 누락');
    const b = await sc.call('to_hwpx', { path: f.docx, output_path: join(OUT, 'from-docx.hwpx') });
    exists(b.output_path);
    return 'PDF·DOCX → HWPX 재파싱 OK';
  });

  // 고치기
  check('edit', 'patch_document (서식 보존 패치)', async () => {
    const src = join(OUT, 'patch-src.hwpx');
    copyFileSync(f.report, src);
    const md = (await sc.call('convert', { path: src, format: 'md', keep_layout: true, save: false })).content;
    assert(md.includes('1,200만 원'), '원문에 바꿀 글 없음');
    const r = await sc.call('patch_document', { path: src, markdown: md.replace('1,200만 원', '1,500만 원'), output_path: join(OUT, 'patched.hwpx') });
    assert(r.applied >= 1, `적용 ${r.applied}, 건너뜀 ${JSON.stringify(r.skipped).slice(0, 120)}`);
    assert((await parseFile(r.output_path)).markdown.includes('1,500만 원'), '패치가 반영 안 됨');
    return `적용 ${r.applied}, 건너뜀 ${r.skipped.length}`;
  });
  check('edit', 'seal (도장 찍기)', async () => {
    const r = await sc.call('seal', { path: join(OUT, 'gian.hwpx'), image_path: f.seal, anchor: '가온시', output_path: join(OUT, 'sealed.hwpx') });
    assert(r.placed >= 1, `찍은 수 ${r.placed}`);
    assert((await k.validateHwpx(readFileSync(r.output_path))).ok, '구조 깨짐');
    return `${r.placed}곳`;
  });
  check('edit', 'validate_hwpx', async () => {
    const r = await sc.call('validate_hwpx', { path: f.report });
    assert(r.ok, JSON.stringify(r.issues).slice(0, 200));
    return 'ok';
  });
  check('edit', 'edit 세션 (열기·패치·되돌리기·저장·닫기)', async () => {
    const o = await sc.call('edit_open', { input_path: f.report });
    assert(o.session_id, '세션 없음');
    const blk = (o.blocks ?? []).find((b) => (b.text ?? '').includes('추진 배경') || b.capability === 'text');
    assert(blk, '편집할 블록 없음');
    await sc.call('edit_save', { session_id: o.session_id, output_path: join(OUT, 'edit-saved.hwpx') });
    exists(join(OUT, 'edit-saved.hwpx'));
    await sc.call('edit_close', { session_id: o.session_id });
    return `블록 ${(o.blocks ?? []).length}`;
  });

  // 검토·보안
  check('review', 'lint (글·문서)', async () => {
    const t = await sc.call('lint', { text: '회의는 2026.10.10 에 개최함\n금 1000원\n끝' });
    assert(t.findings.length >= 1, '오류를 못 잡음');
    const p = await sc.call('lint', { path: f.report, numbers: true, styles: true });
    return `글 ${t.findings.length}건(${[...new Set(t.findings.map((x) => x.rule))].join(',')}), 문서 ${p.findings.length}건`;
  });
  check('review', 'redact (서식 보존 + 잔존 재검사)', async () => {
    const dry = await sc.call('redact', { path: f.pii, dry_run: true });
    assert(dry.total >= 3, `미리보기 건수 ${dry.total}`);
    assert(!JSON.stringify(dry).includes('1234568'), '결과에 원본 주민번호가 실림');
    const r = await sc.call('redact', { path: f.pii, output_path: join(OUT, 'redacted.hwpx') });
    assert(r.preserved && r.residual === 0, `서식 보존 ${r.preserved}, 잔존 ${r.residual}`);
    const md = (await parseFile(r.output_path)).markdown;
    assert(!md.includes('900101-1234568') && !md.includes('010-2345-6789'), '가린 문서에 개인정보가 남음');
    return `${r.total}건 가림, 룰 ${r.hits.map((h) => `${h.rule}:${h.count}`).join(' ')}`;
  });
  check('review', 'redact_batch', async () => {
    const r = await sc.call('redact_batch', { paths: [f.pii, f.received_hwpx], output_dir: join(OUT, 'redact-batch') });
    assert(r.results.every((x) => x.ok), JSON.stringify(r.results));
    return `${r.results.length}개`;
  });

  // 비교·모으기
  check('compare', 'compare (교차 형식) + 내보내기 3종', async () => {
    const r = await sc.call('compare', { old_path: f.report, new_path: join(OUT, 'patched.hwpx'), export: 'html', output_path: join(OUT, 'diff.html') });
    assert(r.stats.modified + r.stats.added + r.stats.removed >= 1, '차이를 못 찾음');
    exists(r.output_path);
    for (const ex of ['md', 'xlsx']) exists((await sc.call('compare', { old_path: f.report, new_path: join(OUT, 'patched.hwpx'), export: ex, output_path: join(OUT, `diff.${ex}`) })).output_path);
    const x = await sc.call('compare', { old_path: f.received_hwpx, new_path: f.received_pdf });
    return `수정 ${r.stats.modified}·추가 ${r.stats.added}·삭제 ${r.stats.removed}; HWPX↔PDF 같음 ${x.stats.unchanged}`;
  });
  check('compare', 'compare_hwpx (신구대조표 한글 표)', async () => {
    const r = await sc.call('compare_hwpx', { old_path: f.report, new_path: join(OUT, 'patched.hwpx'), title: '예산 변경 신구대조표', output_path: join(OUT, 'sinku.hwpx') });
    const md = (await parseFile(r.output_path)).markdown;
    assert(md.includes('1,200') && md.includes('1,500'), '현행·개정 값이 표에 없음');
    return `수정 ${r.stats.modified}`;
  });
  check('compare', 'tables_extract (xlsx·csv·md)', async () => {
    const out = [];
    for (const format of ['xlsx', 'csv', 'md']) {
      const r = await sc.call('tables_extract', { path: f.report, format, output_path: join(OUT, `tables.${format}`) });
      exists(r.output_path);
      out.push(`${format}: 표 ${r.tables.length}`);
    }
    const x = await parseFile(join(OUT, 'tables.xlsx'));
    assert(x.markdown.includes('서식 등록'), 'xlsx 내용 누락');
    return out.join(', ');
  });
  check('compare', 'collect_fields·collect_run (취합)', async () => {
    const c = await sc.call('collect_fields', { paths: f.collect });
    assert(c.fields.some((x) => x.label.includes('부서')), `칸 후보: ${c.fields.map((x) => x.label).join(',')}`);
    const fields = c.fields.slice(0, 7).map((x) => x.label);
    const r = await sc.call('collect_run', { paths: f.collect, fields, output_path: join(OUT, 'collect.xlsx') });
    assert(r.rows === 5, `행 ${r.rows}`);
    const x = (await parseFile(r.output_path)).markdown;
    for (const d of ['총무과', '기획예산과', '민원봉사과', '복지정책과', '도시계획과']) assert(x.includes(d), `${d} 누락`);
    return `칸 ${fields.join('·')} × 5행`;
  });
  check('compare', 'search_files', async () => {
    const r = await sc.call('search_files', { paths: [...f.collect, f.report], query: '개인정보' });
    assert(r.results.reduce((s, x) => s + x.hits.length, 0) >= 2, '찾은 곳이 적음');
    return `${r.results.length}개 문서에서 ${r.results.reduce((s, x) => s + x.hits.length, 0)}곳`;
  });
  check('compare', 'extract_images', async () => {
    const r = await sc.call('extract_images', { path: f.hwpx_real, output_dir: join(OUT, 'images') });
    assert(r.count >= 1, '그림 없음');
    return `${r.count}개`;
  });

  // 출력
  check('output', 'export_pdf (HWPX·MD 원본)', async () => {
    const r = await sc.call('export_pdf', { path: f.received_hwpx, output_path: join(OUT, 'received.pdf') });
    const n = await pdfPages(r.output_path);
    const txt = (await parseFile(r.output_path, { ocr: false })).markdown;
    assert(/1\.\s*관련/.test(txt) && /2\.\s*우리 도는/.test(txt), 'PDF 본문 줄바꿈·글 누락');
    return `${n}쪽`;
  });
  check('output', 'bundle_pdf (합본·워터마크·쪽번호)·pdf_stamp', async () => {
    const r = await sc.call('bundle_pdf', { paths: [f.received_hwpx, f.report, f.received_pdf], watermark: '사본', page_numbers: true, output_path: join(OUT, 'bundle.pdf') });
    assert(r.failed.length === 0, JSON.stringify(r.failed));
    const n = await pdfPages(r.output_path);
    assert(n === r.page_count && n >= 4, `쪽 ${n}/${r.page_count}`);
    const s = await sc.call('pdf_stamp', { path: f.received_pdf, watermark: '대외비', page_numbers: true, output_path: join(OUT, 'stamped.pdf') });
    exists(s.output_path);
    return `합본 ${n}쪽`;
  });
  check('output', 'merge_files·split_pdf·pdf_page_count·pdf_extract_pages', async () => {
    assert(f.hwp_small, 'HWP 픽스처 없음');
    const m = await sc.call('merge_files', { files: [f.received_hwpx, f.hwp_small, f.pii], output_path: join(OUT, 'merged.hwpx'), mode: 'native' });
    const mp = m.output_path ?? join(OUT, 'merged.hwpx');
    assert(mp.endsWith('.hwpx'), `서식 유지 HWPX 가 아님: ${mp}`);
    assert((await k.validateHwpx(readFileSync(mp))).ok, '합본 구조 검증 실패');
    const md = (await parseFile(mp)).markdown;
    assert(md.includes('한마음 체육대회') && md.includes('사이버보안') && md.includes('정보공개 청구서'), '합친 문서에 세 문서가 다 없음');
    const pc = await sc.call('pdf_page_count', { input_path: join(OUT, 'bundle.pdf') });
    const ex = await sc.call('pdf_extract_pages', { input_path: join(OUT, 'bundle.pdf'), pages: '1-2', mode: 'include', output_path: join(OUT, 'extract.pdf') });
    const ep = ex.output_path ?? join(OUT, 'extract.pdf');
    assert((await pdfPages(ep)) === 2, '추출 쪽 수');
    const sp = await sc.call('split_pdf', { input_path: join(OUT, 'bundle.pdf'), output_dir: join(OUT, 'split'), mode: 'each' });
    return `합침 OK, 쪽 ${pc.page_count}, 추출 2쪽, 나눔 ${JSON.stringify(sp).slice(0, 60)}`;
  });
  check('output', 'write_file·read_file_b64 (확장자 제한)', async () => {
    const p = join(OUT, 'wf.hwpx');
    await sc.call('write_file', { path: p, data_b64: readFileSync(f.report).toString('base64') });
    const back = await sc.call('read_file_b64', { path: p });
    assert(back.size === statSync(f.report).size, '크기 다름');
    let blocked = false;
    try { await sc.call('write_file', { path: join(OUT, 'evil.sh'), data_b64: 'ZWNobw==' }); } catch { blocked = true; }
    assert(blocked, '.sh 저장을 막지 않음');
    let noOverwrite = false;
    try { await sc.call('write_file', { path: p, data_b64: 'AA==' }); } catch { noOverwrite = true; }
    assert(noOverwrite, '덮어쓰기를 묻지 않고 함');
    return '왕복·확장자 차단·덮어쓰기 보호';
  });
  check('output', 'list_printers (인쇄는 실제 출력이라 실행 안 함)', async () => {
    const r = await sc.call('list_printers');
    return `프린터 ${JSON.stringify(r).slice(0, 80)}`;
  });

  // 자동화
  check('auto', 'watch_start → 파일 넣기 → 자동 변환 → watch_stop', async () => {
    const dir = join(WORK, 'inbox');
    const out = join(WORK, 'inbox-out');
    mkdirSync(dir, { recursive: true });
    const { id } = await sc.call('watch_start', { dir, out_dir: out, format: 'md' });
    const before = sc.notes.length;
    copyFileSync(f.pii, join(dir, '새민원.hwpx'));
    const t0 = Date.now();
    while (Date.now() - t0 < 20_000 && !sc.notes.slice(before).some((n) => n.method === 'watch_event' && n.params.ok)) await new Promise((r) => setTimeout(r, 300));
    const ev = sc.notes.slice(before).find((n) => n.method === 'watch_event');
    assert(ev?.params.ok, `감시 이벤트 없음/실패: ${JSON.stringify(ev?.params ?? null)}`);
    exists(ev.params.output_path);
    const list = await sc.call('watch_list');
    assert(list.some((w) => w.id === id), '목록에 없음');
    await sc.call('watch_stop', { id });
    return `${((Date.now() - t0) / 1000).toFixed(1)}초 만에 변환`;
  });

  // 편집기·효과·보안
  check('insight', 'editor_server (편집기 파일 응답)', async () => {
    const r = await sc.call('editor_server');
    const h = await fetch(r.host_url);
    const w = await fetch(new URL('./studio/rhwp_bg.wasm', r.host_url), { method: 'HEAD' });
    assert(h.ok && w.ok, '편집기 파일 응답 이상');
    return `${r.host_url} studio ${r.studio_version}`;
  });
  check('insight', 'usage_report (앞선 작업이 집계됐는가)', async () => {
    const u = await sc.call('usage_report', { range: 'month' });
    const keys = u.items.filter((i) => i.count > 0).map((i) => `${i.key}:${i.count}`);
    assert(u.total_count >= 10, `집계 ${u.total_count}`);
    return `${u.total_count}건, ${u.total_saved_min}분: ${keys.join(' ')}`;
  });
  check('insight', 'security_status (인터넷 요청 0)', async () => {
    const s = await sc.call('security_status');
    assert(s.external_sent === 0 && s.telemetry === false, `외부 요청 ${s.external_sent}`);
    return `외부 ${s.external_sent}, 기록 ${s.recent.length}`;
  });
}

// ── AI (로컬 무료 모델만) ──

function defineAiChecks(f, sc) {
  const OLLAMA = 'http://127.0.0.1:11434/v1';
  check('ai', 'ai_list_models·ai_test (Ollama)', async () => {
    await sc.call('update_settings', { settings: { ai: { provider: 'openai', openai: { base_url: OLLAMA, model: 'gemma4:e4b', api_key: '' } } } });
    const m = await sc.call('ai_list_models', { base_url: OLLAMA });
    assert(m.models.includes('gemma4:e4b'), `모델 목록 ${m.models}`);
    const t = await sc.call('ai_test', {}, 600_000);
    assert(t.ok, t.error);
    const st = await sc.call('ai_status');
    assert(st.configured && !st.is_cloud, 'ai_status');
    return `${t.latency_ms}ms "${t.sample?.slice(0, 30)}"`;
  });
  check('ai', 'ai_summarize', async () => {
    const r = await sc.call('ai_summarize', { path: f.report, style: 'briefing', length: 'short' }, 900_000);
    assert(r.summary.length > 50 && /1,200|30%|디지털/.test(r.summary), `요약: ${r.summary.slice(0, 100)}`);
    return `${r.summary.length}자: ${r.summary.replace(/\s+/g, ' ').slice(0, 80)}`;
  });
  check('ai', 'ai_chat (근거 인용·검증)', async () => {
    const r = await sc.call('ai_chat', { paths: [f.report], question: '소요 예산은 얼마이고 어디에 쓰나요?' }, 900_000);
    assert(r.answer.includes('1,200') || r.answer.includes('1200'), `답: ${r.answer.slice(0, 120)}`);
    assert(r.citations.length >= 1, '인용 없음');
    const v = r.citations.filter((c) => c.verified !== false).length;
    return `인용 ${r.citations.length}(검증 ${v}): ${r.answer.replace(/\s+/g, ' ').slice(0, 80)}`;
  });
  check('ai', 'ai_draft kind=reply (받은 공문 → 회신) → generate_hwpx', async () => {
    const r = await sc.call('ai_draft', { instruction: '체육대회에 우리 시 직원 25명이 참가한다고 회신', kind: 'reply', preset: '기안문', references: [f.received_pdf] }, 900_000);
    // 회신의 관련은 받은 공문 자기 번호(시행 체육진흥과-2203), 받은 공문 본문의 관련(-2187)이 아니다
    const rel = r.markdown.split('\n').find((l) => /^\s*1\.\s*관련/.test(l)) ?? '';
    assert(rel.includes('체육진흥과-2203') && /체육/.test(r.markdown), `관련 줄: ${rel || '(없음)'} / 초안: ${r.markdown.slice(0, 120)}`);
    assert(!/발전을 기원/.test(r.markdown), '지시에 없는 안부 인사를 넣음');
    const g = await sc.call('generate_hwpx', { markdown: r.markdown, preset: '기안문', output_path: join(OUT, 'reply.hwpx') });
    exists(g.output_path);
    return `${r.markdown.length}자, 표기법 ${g.lint.length}건`;
  });
  check('ai', 'ai_rewrite (개조식·쉬운 공공언어)', async () => {
    const a = await sc.call('ai_rewrite', { text: '직원들의 화합과 건강 증진을 도모하기 위하여 체육대회를 개최하고자 합니다.', mode: 'gaejosik' }, 600_000);
    const b = await sc.call('ai_rewrite', { text: '금번 사업의 제반 사항을 면밀히 검토하여 차질 없이 추진할 예정임.', mode: 'public' }, 600_000);
    assert(a.text.length > 5 && b.text.length > 5, '빈 결과');
    return `개조식 "${a.text.slice(0, 40)}" / 쉬운말 "${b.text.slice(0, 40)}"`;
  });
  check('ai', 'ai_review (K팀장)', async () => {
    const r = await sc.call('ai_review', { path: f.report }, 900_000);
    assert(typeof r.summary === 'string' && Array.isArray(r.issues) && Array.isArray(r.lint), '모양');
    return `이슈 ${r.issues.length}, 표기법 ${r.lint.length}`;
  });
  check('ai', 'ai_fill_suggest (받은 공문 → 기안문 칸)', async () => {
    const r = await sc.call('ai_fill_suggest', { fields: ['제목', '본문'], references: [f.received_pdf], instruction: '참가 회신 공문', guides: { 제목: '제목을 입력하세요' } }, 900_000);
    assert((r.values['제목'] ?? '').length > 3, `칸 값 ${JSON.stringify(r.values).slice(0, 100)}`);
    const body = r.values['본문'] ?? '';
    assert(!/발전을 기원/.test(body), `지시에 없는 안부 인사: ${body.slice(0, 80)}`);
    assert(!/체육진흥과-2187/.test(body), `받은 공문 본문의 관련 번호를 베낌: ${body.slice(0, 80)}`);
    return JSON.stringify(r.values).slice(0, 140);
  });
  check('ai', 'ai_extract (취합 5장 → 표)', async () => {
    const r = await sc.call('ai_extract', { paths: f.collect, columns: ['부서명', '희망 인원'], output_path: join(OUT, 'ai-extract.xlsx') }, 1_800_000);
    assert(r.rows.length === 5, `행 ${r.rows.length}`);
    return r.rows.map((x) => `${x['부서명']}:${x['희망 인원']}`).join(', ');
  });
  check('ai', '폐쇄망 모드: 인터넷 AI 차단·내부 주소 허용·외부 0', async () => {
    await sc.call('update_settings', { settings: { privacy: { offline: true } } });
    const t = await sc.call('ai_test', {}, 600_000);
    assert(t.ok, `내부 주소가 막힘: ${t.error}`);
    await sc.call('update_settings', { settings: { ai: { provider: 'gemini' } } });
    const st = await sc.call('ai_status');
    assert(!st.configured || st.error, '폐쇄망에서 인터넷 AI 가 켜져 있음');
    await sc.call('update_settings', { settings: { ai: { provider: 'openai' }, privacy: { offline: false } } });
    const s = await sc.call('security_status');
    assert(s.external_sent === 0, `외부 요청 ${s.external_sent}`);
    return `차단 문구: ${st.error?.slice(0, 50) ?? '설정 불가'}`;
  });
  check('ai', '내장 엔진 (GGUF) ai_warmup·ai_rewrite', async () => {
    // Ollama 묶음 파일(비전·오디오 같이 든 GGUF)은 node-llama-cpp 가 못 읽는다 → 카탈로그 추천 모델(Qwen3 4B)
    const gguf = process.env.KORDOC_E2E_GGUF;
    assert(gguf && existsSync(gguf), 'KORDOC_E2E_GGUF 에 GGUF 모델 경로를 넣어라 (llm_download 로 받은 Qwen3 4B 등)');
    await sc.call('update_settings', { settings: { ai: { provider: 'embedded', embedded: { model_path: gguf, context_size: 4096, gpu: 'auto' } } } });
    const w = await sc.call('ai_warmup', {}, 900_000);
    const t0 = Date.now();
    const r = await sc.call('ai_rewrite', { text: '회의를 개최하고자 함.', mode: 'polish' }, 900_000);
    assert(r.text.length > 2, '빈 결과');
    await sc.call('update_settings', { settings: { ai: { provider: 'openai' } } });
    return `gpu=${w.gpu}, ctx ${w.context_size}, ${Date.now() - t0}ms "${r.text.slice(0, 30)}"`;
  });
  check('ai', 'llm 받기(이어받기)·가져오기·목록·지우기 (가짜 GGUF·로컬 서버)', async () => {
    const fake = Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(1024 * 64, 7)]);
    const src = join(FIX, 'tiny.gguf');
    writeFileSync(src, fake);
    const imp = await sc.call('llm_import', { path: src });
    exists(imp.path);
    let rejected = false;
    writeFileSync(join(FIX, 'bad.gguf'), Buffer.from('NOTGGUF'));
    try { await sc.call('llm_import', { path: join(FIX, 'bad.gguf') }); } catch { rejected = true; }
    assert(rejected, 'GGUF 아닌 파일을 받아들임');
    const list = await sc.call('llm_list');
    assert(list.some((m) => m.path === imp.path), '목록에 없음');
    assert(await sc.call('llm_delete', { path: imp.path }), '삭제 실패');
    const cat = await sc.call('llm_catalog');
    assert(cat.length >= 2 && cat.every((c) => c.url.startsWith('https://')), '카탈로그');
    return `가져오기·거절·삭제 OK, 카탈로그 ${cat.length}종`;
  });
}

// ── MCP (가짜 홈 폴더에서 — 진짜 Claude 설정을 건드리지 않게) ──

async function mcpCheck() {
  const fakeHome = mkdtempSync(join(WORK, 'home-'));
  mkdirSync(join(fakeHome, 'Library', 'Application Support', 'Claude'), { recursive: true });
  mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
  const sc = new Sidecar({ HOME: fakeHome, USERPROFILE: fakeHome, APPDATA: join(fakeHome, 'AppData', 'Roaming') });
  try {
    const env = await sc.call('detect_mcp_env');
    const ids = env.clients.map((c) => c.id);
    const target = ids.filter((id) => /claude|cursor/.test(id)).slice(0, 2);
    const r = await sc.call('install_mcp_config', { clients: target });
    assert(r.installed.length >= 1, `설치 ${JSON.stringify(r)}`);
    const conf = env.clients.filter((c) => r.installed.includes(c.id)).map((c) => c.config_path.replace(homedir(), fakeHome));
    const text = conf.map((p) => (existsSync(p) ? readFileSync(p, 'utf-8') : '')).join('\n');
    assert(/mcp\.js/.test(text) && !/npx/.test(text), `설정에 동봉 mcp.js 경로가 없음: ${text.slice(0, 200)}`);
    return `${r.installed.join(',')} 등록, 설정에 mcp.js 절대경로`;
  } finally {
    sc.kill();
  }
}

// ── 실행 ──

const results = [];
const f = await makeFixtures();
const sc = new Sidecar();
defineChecks(f, sc);
if (withAi) defineAiChecks(f, sc);
check('system', 'MCP 연결 (가짜 홈)', () => mcpCheck());

for (const c of checks) {
  if (only && !only.includes(c.group)) continue;
  const t0 = Date.now();
  try {
    const detail = await c.fn();
    results.push({ ...c, ok: true, ms: Date.now() - t0, detail });
    console.log(`✓ [${c.group}] ${c.name} (${Date.now() - t0}ms) ${detail ?? ''}`);
  } catch (err) {
    results.push({ ...c, ok: false, ms: Date.now() - t0, detail: err.message });
    console.log(`✗ [${c.group}] ${c.name} — ${err.message}`);
  }
}
sc.kill();

const pass = results.filter((r) => r.ok).length;
const report = [`# 엔진 층 전수 검증 (${new Date().toISOString()})`, '', `통과 ${pass} / ${results.length}`, '', '| 결과 | 그룹 | 기능 | 시간 | 근거 |', '| --- | --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.ok ? '✓' : '✗'} | ${r.group} | ${r.name} | ${r.ms}ms | ${String(r.detail ?? '').replace(/\|/g, '/').slice(0, 300)} |`)].join('\n');
writeFileSync(join(WORK, 'e2e-engine-report.md'), report);
if (sc.stderr && results.some((r) => !r.ok)) writeFileSync(join(WORK, 'sidecar-stderr.log'), sc.stderr);
console.log(`\n통과 ${pass} / ${results.length} — 보고서 ${join(WORK, 'e2e-engine-report.md')}`);
if (!keep && pass === results.length) rmSync(WORK, { recursive: true, force: true });
process.exit(pass === results.length ? 0 : 1);
