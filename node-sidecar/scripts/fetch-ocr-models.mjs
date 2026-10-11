/**
 * 내장 OCR 모델(PP-OCRv5 korean, ~18MB)을 node-sidecar/models/ppocr 로 받는다 — 설치본에 실려
 * 폐쇄망 PC 에서도 첫 실행부터 OCR 이 된다. kordoc 의 다운로더(SHA-256 검증)를 그대로 쓴다.
 *
 * 사용: node scripts/fetch-ocr-models.mjs   (node-sidecar 에서)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILES = ['det.onnx', 'rec_korean.onnx', 'rec_korean.yml'];
const dir = resolve('models');
if (FILES.every((f) => existsSync(join(dir, 'ppocr', f)))) {
  console.log('[ocr-models] 이미 있음');
  process.exit(0);
}
execFileSync(process.execPath, [join('node_modules', 'kordoc', 'dist', 'cli.js'), 'check-ocr-models'], {
  stdio: 'inherit',
  env: { ...process.env, KORDOC_MODEL_CACHE: dir, KORDOC_OFFLINE: '' },
});
const missing = FILES.filter((f) => !existsSync(join(dir, 'ppocr', f)));
if (missing.length) throw new Error(`[ocr-models] 받지 못한 파일: ${missing.join(', ')}`);
console.log(`[ocr-models] ✅ ${join(dir, 'ppocr')}`);
