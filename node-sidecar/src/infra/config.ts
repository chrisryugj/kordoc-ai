/** YAML 설정 로더 — 원자적 쓰기, LRU 캐시 */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import type { Settings } from '../types/index.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'config', 'settings.yaml');

let cached: Settings | null = null;

/** 설정 전체 로드 (캐시) */
export function getSettings(): Settings {
  if (cached) return cached;
  return reload();
}

/** 캐시 무효화 후 재로드 */
export function reload(): Settings {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    cached = parse(raw) as Settings;
    logger.info(`[config] loaded: ${CONFIG_PATH}`);
    return cached!;
  } catch (err) {
    logger.error(`[config] load failed: ${err}`);
    throw err;
  }
}

/** 특정 섹션 조회 */
export function getConfig<K extends keyof Settings>(section: K): Settings[K] {
  return getSettings()[section];
}

/** 설정 업데이트 (원자적 쓰기: tmp → rename) */
export function updateSettings(patch: Record<string, unknown>): Settings {
  const current = getSettings();
  const merged = deepMerge(current as unknown as Record<string, unknown>, patch) as unknown as Settings;

  const tmp = CONFIG_PATH + '.tmp';
  writeFileSync(tmp, stringify(merged), 'utf-8');
  renameSync(tmp, CONFIG_PATH);

  cached = merged;
  logger.info('[config] updated');
  return merged;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
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
