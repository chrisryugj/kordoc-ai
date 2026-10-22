/** 엔진 상태·셀프테스트·모델 관리
 *
 * selftest 는 설치본이 사용자 PC 에서 실제로 도는지 확인하는 관문이다 — 번들 스모크·설정 화면이 같이 쓴다.
 * 각 단계는 실제 기능 경로를 한 바퀴 돈다 (HWPX 생성→파싱, PDF 파싱, 이미지 OCR, 렌더, llama 바인딩).
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, markdownToHwpx, parse, renderDocument } from 'kordoc';
import { dataDir, getSettings } from '../../infra/config.js';
import { logger } from '../../infra/logger.js';
import { cliErrorMessage, runKordocCli } from '../kordoc-cli.js';
import { parseInWorker } from '../converter/index.js';

export const OCR_MODEL_FILES = ['det.onnx', 'rec_korean.onnx', 'rec_korean.yml'];

export function modelCacheDir(): string {
  const env = process.env.KORDOC_MODEL_CACHE;
  return env && env.trim() ? env : join(homedir(), '.cache', 'kordoc', 'models');
}

export function ocrModelsReady(): boolean {
  return OCR_MODEL_FILES.every((f) => existsSync(join(modelCacheDir(), 'ppocr', f)));
}

/** 수식 OCR(Pix2Text) 모델 — 설치본에 싣지 않고 가져오기만 */
export const FORMULA_MODEL_FILES = ['mfd.onnx', 'encoder_model.onnx', 'decoder_model.onnx', 'tokenizer.json'];

export function modelsStatus(): { ocr: { ready: boolean; dir: string }; formula: { ready: boolean; dir: string } } {
  const formulaDir = join(modelCacheDir(), 'pix2text');
  return {
    ocr: { ready: ocrModelsReady(), dir: join(modelCacheDir(), 'ppocr') },
    formula: { ready: FORMULA_MODEL_FILES.every((f) => existsSync(join(formulaDir, f))), dir: formulaDir },
  };
}

/** 폐쇄망 반입 — kordoc `models --import`(SHA-256 검증)는 <폴더>/ppocr·pix2text 묶음 구조라,
 *  파일만 모아 둔 폴더면 임시 묶음을 만들어 넘긴다 */
export async function modelsImport(dir: string): Promise<{ imported: string[] }> {
  let src = dir;
  let tmp: string | undefined;
  if (!existsSync(join(dir, 'ppocr')) && !existsSync(join(dir, 'pix2text'))) {
    tmp = mkdtempSync(join(tmpdir(), 'kordoc-models-'));
    for (const [sub, files] of [['ppocr', OCR_MODEL_FILES], ['pix2text', FORMULA_MODEL_FILES]] as const) {
      const have = files.filter((f) => existsSync(join(dir, f)));
      if (!have.length) continue;
      mkdirSync(join(tmp, sub), { recursive: true });
      for (const f of have) copyFileSync(join(dir, f), join(tmp, sub, f));
    }
    src = tmp;
  }
  try {
    const r = await runKordocCli(['models', '--import', src]);
    const imported = [...r.stderr.matchAll(/^\s*\+\s+(\S+)/gm)].map((m) => m[1]);
    const invalid = [...r.stderr.matchAll(/^\s*!\s+(\S+)/gm)].map((m) => m[1]);
    if (invalid.length) throw new Error(`모델 파일 검증(SHA-256)에 실패했습니다: ${invalid.join(', ')}. 원본 파일을 다시 받아 넣으세요.`);
    if (!imported.length) {
      if (r.code !== 0 && !/번들에 없음/.test(r.stderr)) throw new Error(cliErrorMessage(r, '모델을 가져오지 못했습니다.'));
      throw new Error('가져올 모델 파일이 없습니다. det.onnx·rec_korean.onnx·rec_korean.yml이 든 폴더를 고르세요.');
    }
    return { imported };
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/** 앱 데이터 폴더를 모델 캐시로 쓰고, 설치본에 실린 OCR 모델을 처음 한 번 복사 */
export function seedBundledModels(): void {
  if (!process.env.KORDOC_MODEL_CACHE) process.env.KORDOC_MODEL_CACHE = join(dataDir(), 'models');
  if (ocrModelsReady()) return;
  const here = dirname(fileURLToPath(import.meta.url));
  // 번들: <sidecar>/dist/bundle.mjs → <sidecar>/models/ppocr · tsc: dist/core/system → ../../../models
  const candidates = [join(here, '..', 'models', 'ppocr'), join(here, '..', '..', '..', 'models', 'ppocr')];
  const src = candidates.find((d) => OCR_MODEL_FILES.every((f) => existsSync(join(d, f))));
  if (!src) return;
  const dst = join(modelCacheDir(), 'ppocr');
  mkdirSync(dst, { recursive: true });
  for (const f of OCR_MODEL_FILES) copyFileSync(join(src, f), join(dst, f));
  logger.info(`[system] 동봉 OCR 모델 시드: ${src} → ${dst}`);
}

/** 내장 AI 모델 폴더의 .gguf 목록 */
export function listLocalLlmModels(): Array<{ path: string; name: string; size: number }> {
  const dir = join(dataDir(), 'models', 'llm');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.gguf'))
    .map((name) => ({ path: join(dir, name), name, size: statSync(join(dir, name)).size }));
}

export function systemInfo() {
  const s = getSettings();
  return {
    app_version: '2.1.2',
    kordoc_version: VERSION,
    node_version: process.version,
    platform: `${process.platform}-${process.arch}`,
    data_dir: dataDir(),
    model_cache: modelCacheDir(),
    ocr_models_ready: ocrModelsReady(),
    offline: s.privacy.offline,
    ai_provider: s.ai.provider,
    llm_models: listLocalLlmModels(),
  };
}

type Step = { name: string; ok: boolean; ms: number; detail?: string };

async function step(steps: Step[], name: string, fn: () => Promise<string | void>): Promise<void> {
  const t = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) });
  } catch (err) {
    steps.push({ name, ok: false, ms: Date.now() - t, detail: err instanceof Error ? err.message : String(err) });
  }
}

/** 최소 PDF (Helvetica "KORDOC 2026") — pdf 파서 경로 확인용 */
function tinyPdf(): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 24 Tf 40 70 Td (KORDOC 2026) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export async function selftest(opts: { ocr?: boolean; llama?: boolean } = {}): Promise<{ ok: boolean; steps: Step[] }> {
  const steps: Step[] = [];
  let hwpx: Uint8Array | null = null;

  await step(steps, 'hwpx_generate_parse', async () => {
    hwpx = new Uint8Array(await markdownToHwpx('# 셀프테스트\n\n| 항목 | 값 |\n| --- | --- |\n| 엔진 | 정상 |'));
    const r = await parse(Buffer.from(hwpx));
    if (!r.success || !r.markdown.includes('정상')) throw new Error(r.success ? '왕복 결과에 글자가 없음' : r.error);
    return `${hwpx.byteLength}B`;
  });

  await step(steps, 'pdf_parse', async () => {
    const r = await parse(Buffer.from(tinyPdf()), { ocr: false });
    if (!r.success || !r.markdown.includes('KORDOC')) throw new Error(r.success ? `글자 없음: ${r.markdown.slice(0, 60)}` : r.error);
  });

  // 큰 PDF 읽기·rhwp 는 이 엔진 파일을 작업자 스레드로 한 번 더 띄워 돈다 (infra/worker). 설치본에서 작업자가 뜨는지
  await step(steps, 'worker_parse', async () => {
    const r = await parseInWorker(tinyPdf(), { ocr: false });
    if (!r.success || !r.markdown.includes('KORDOC')) throw new Error(r.success ? `글자 없음: ${r.markdown.slice(0, 60)}` : r.error);
  });

  await step(steps, 'render_png', async () => {
    if (!hwpx) throw new Error('앞 단계 실패');
    const r = await renderDocument(Buffer.from(hwpx), { format: 'png', pages: '1' } as Parameters<typeof renderDocument>[1]);
    const n = r.assets?.length ?? 0;
    if (!n) throw new Error('쪽 이미지가 없음');
    return `${n}쪽`;
  });

  // 서식 보존 마스킹·수치 대조·모델 반입·MCP 연결이 쓰는 길: 동봉 Node(process.execPath)로 스테이징된 kordoc CLI 실행
  await step(steps, 'kordoc_cli', async () => {
    const r = await runKordocCli(['--version'], { timeoutMs: 60_000 });
    if (r.code !== 0 || !r.stdout.includes(VERSION)) throw new Error(cliErrorMessage(r, `kordoc CLI를 실행하지 못했습니다 (code ${r.code})`));
    return r.stdout.trim();
  });

  if (opts.ocr !== false) {
    await step(steps, 'ocr_image', async () => {
      if (!ocrModelsReady()) throw new Error(`OCR 모델 없음 (${modelCacheDir()})`);
      const sharp = (await import('sharp')).default;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120"><rect width="100%" height="100%" fill="white"/><text x="20" y="78" font-size="56" font-family="Arial, Helvetica, sans-serif" fill="black">KORDOC 2026</text></svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      // 이 PC 스레드와 작업자 스레드(큰 스캔 PDF) 둘 다
      for (const r of [await parse(png, { ocr: true }), await parseInWorker(png, { ocr: true })]) {
        if (!r.success) throw new Error(r.error);
        if (!/KORDOC|2026/i.test(r.markdown)) throw new Error(`인식 실패: "${r.markdown.slice(0, 60)}"`);
      }
      return 'OCR 정상(작업자 포함)';
    });
  }

  if (opts.llama !== false) {
    await step(steps, 'llama_binding', async () => {
      const { getLlama } = await import('node-llama-cpp');
      const llama = await getLlama({ gpu: 'auto', build: 'never', skipDownload: true, progressLogs: false });
      const gpu = llama.gpu;
      await llama.dispose();
      return `gpu=${gpu}`;
    });
  }

  return { ok: steps.every((s) => s.ok), steps };
}
