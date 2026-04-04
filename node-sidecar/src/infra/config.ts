/** YAML 설정 로더 — 원자적 쓰기, LRU 캐시 */

import { readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import type { Settings } from '../types/index.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'config', 'settings.yaml');

let cached: Settings | null = null;

/** 설정 전체 로드 (캐시 — 불변 참조) */
export function getSettings(): Readonly<Settings> {
  if (cached) return cached;
  return reload();
}

/** 캐시 무효화 후 재로드 */
export function reload(): Settings {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    cached = Object.freeze(parse(raw) as Settings);
    logger.info(`[config] loaded: ${CONFIG_PATH}`);
    return cached;
  } catch (err) {
    logger.error(`[config] load failed: ${err}`);
    throw err;
  }
}

/** 특정 섹션 조회 */
export function getConfig<K extends keyof Settings>(section: K): Settings[K] {
  return getSettings()[section];
}

/** 허용된 설정 최상위 키 (화이트리스트) */
const ALLOWED_SECTIONS = new Set(['gemini', 'convert', 'general']);

/** 프로토타입 오염 방지 키 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 마스킹된 API 키 감지 (get_settings가 반환한 값의 역전파 방지) */
function isMaskedApiKey(value: unknown): boolean {
  return typeof value === 'string' && value.includes('****');
}

/** 설정 업데이트 (원자적 쓰기: tmp → rename) */
export async function updateSettings(patch: Record<string, unknown>): Promise<Settings> {
  // 허용된 섹션만 필터
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (!ALLOWED_SECTIONS.has(key)) continue;
    sanitized[key] = patch[key];
  }

  // 마스킹된 API 키 역전파 방지 — "AIza****" 같은 값이 들어오면 해당 필드 제외
  const geminiPatch = sanitized.gemini as Record<string, unknown> | undefined;
  if (geminiPatch && isMaskedApiKey(geminiPatch.api_key)) {
    delete geminiPatch.api_key;
  }

  const prevApiKey = cached?.gemini?.api_key;
  const current = getSettings();
  const merged = deepMerge(current as unknown as Record<string, unknown>, sanitized) as unknown as Settings;

  const tmp = CONFIG_PATH + '.tmp';
  await writeFile(tmp, stringify(merged), 'utf-8');
  await rename(tmp, CONFIG_PATH);

  cached = Object.freeze(merged);
  logger.info('[config] updated');

  // API 키 변경 감지 시 Gemini 클라이언트 자동 리셋
  if (merged.gemini?.api_key && merged.gemini.api_key !== prevApiKey) {
    try {
      const { resetClient } = await import('./gemini.js');
      resetClient();
      logger.info('[config] Gemini client reset (API key changed)');
    } catch { /* gemini 모듈 로드 실패 시 무시 */ }
  }

  return merged;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      result[key] = sv;
    }
  }
  return result;
}
