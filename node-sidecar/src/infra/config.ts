/** 설정 로더 — 앱 데이터 폴더의 settings.json, 원자적 쓰기
 *
 * 위치: KORDOC_AI_DATA_DIR(Tauri 가 OS 앱 데이터 폴더를 넘김) → 없으면 OS 기본 경로.
 * v1(YAML, %APPDATA%/com.kordoc-ai.app/config/settings.yaml) 이 있으면 키·출력 폴더만 옮겨 온다.
 * 적용 순서: 기본값 < 기관 배포 설정 defaults < 사용자 값(settings.json) < 기관 배포 설정 locked (policy.ts).
 * settings.json 에는 사용자가 정한 값만 쓴다 — 고정값·기관 기본값을 굳혀 두지 않아야 정책을 고치거나 빼면 그대로 따라간다.
 */

import { readFileSync, existsSync, mkdirSync, chmodSync, renameSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir, totalmem } from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { Settings } from '../types/index.js';
import { logger } from './logger.js';
import { FORBIDDEN_KEYS, isObj, loadPolicy, type Policy } from './policy.js';
import { hasSecretKey, isSealed, seal, unseal } from './secret-box.js';

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  ai: {
    provider: 'none',
    // 메모리 8GB 이하 PC 는 4천 토큰. 8천이면 4B 모델이 4.4GB(실측)라 한글·브라우저와 같이 쓰기 빠듯하다
    embedded: { model_path: '', context_size: totalmem() <= 8 * 1024 ** 3 ? 4096 : 8192, gpu: 'auto' },
    openai: { base_url: 'http://127.0.0.1:11434/v1', api_key: '', model: '', vision_model: '' },
    gemini: { api_key: '', model: 'gemini-3.8-flash' },
    anthropic: { api_key: '', model: 'claude-opus-5-5' },
    local: { base_url: 'http://127.0.0.1:11434/v1', api_key: '', model: '' },
    claude_code: { model: '', cli_path: '' },
    codex: { model: '', cli_path: '' },
    allow_subscription: false,
    redact_before_cloud: true,
    timeout_ms: 180_000,
  },
  privacy: { offline: false },
  org: {
    name: '', dept: '', position: '', person: '', phone: '', fax: '', email: '', address: '', homepage: '',
    approval_line: [], agency: '', seal_image: '', doc_number_prefix: '',
  },
  convert: { output_dir: '', ocr: 'auto' },
  general: { log_level: 'info' },
  impact: { baselines: {} },
  law: { oc: '' },
};

/** 앱 데이터 폴더 (설정·모델·로그) */
export function dataDir(): string {
  const env = process.env.KORDOC_AI_DATA_DIR;
  if (env && env.trim()) return env;
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'com.kordoc-ai.app');
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'com.kordoc-ai.app');
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'com.kordoc-ai.app');
}

const configPath = () => join(dataDir(), 'settings.json');

type Obj = Record<string, unknown>;

let cached: Settings | null = null;
/** 사용자가 정한 값 — settings.json 그대로 (없으면 v1 이관분) */
let user: Obj = {};
let policy: Policy | null = null;
/** API 키가 든 구획 — settings.json 에는 secret-box 로 암호화해 쓴다(Windows) */
const KEY_SECTIONS = ['openai', 'gemini', 'anthropic', 'local'] as const;
/** 풀지 못한 암호문(키가 바뀜 등) — 빈 칸으로 쓰되 파일에서는 지우지 않는다(사용자가 새 키를 넣기 전까지) */
const unreadable = new Map<string, string>();

const aiSection = (o: Obj, k: string): Obj | undefined => {
  const ai = isObj(o.ai) ? o.ai : undefined;
  return ai && isObj(ai[k]) ? (ai[k] as Obj) : undefined;
};

/** 읽은 사용자 값의 암호문을 푼다. 평문 키가 남아 있고 암호화할 수 있으면 true(다시 저장해 암호화) */
function openSecrets(o: Obj): boolean {
  unreadable.clear();
  let plain = false;
  for (const k of KEY_SECTIONS) {
    const sec = aiSection(o, k);
    const v = sec?.api_key;
    if (!sec || typeof v !== 'string' || !v) continue;
    if (!isSealed(v)) { plain = true; continue; }
    const opened = unseal(v);
    if (opened === null) {
      unreadable.set(k, v);
      sec.api_key = '';
      logger.warn(`[config] 저장한 ${k} API 키를 풀지 못했습니다. 설정 › AI 연결에서 키를 다시 넣으세요`);
    } else sec.api_key = opened;
  }
  return plain && hasSecretKey();
}

/** 파일에 쓸 모양 — 키는 암호화, 풀지 못한 암호문은 새 키가 없으면 그대로 */
function sealedForFile(o: Obj): Obj {
  const out = structuredClone(o);
  for (const k of KEY_SECTIONS) {
    const sec = aiSection(out, k);
    const v = sec?.api_key;
    if (sec && typeof v === 'string' && v) { sec.api_key = seal(v); unreadable.delete(k); }
    else if (unreadable.has(k)) {
      const ai = (isObj(out.ai) ? out.ai : (out.ai = {})) as Obj;
      const target = (isObj(ai[k]) ? ai[k] : (ai[k] = {})) as Obj;
      target.api_key = unreadable.get(k);
    }
  }
  return out;
}

/** v1 YAML 에서 쓸 만한 값만 옮김 — 옮긴 값만 둬야 기관 기본값을 가리지 않는다 */
function migrateV1(): Obj | null {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  const v1 = join(appData, 'com.kordoc-ai.app', 'config', 'settings.yaml');
  if (!existsSync(v1)) return null;
  try {
    const old = parseYaml(readFileSync(v1, 'utf-8')) as {
      gemini?: { api_key?: string };
      convert?: { output_dir?: string };
    };
    const key = old.gemini?.api_key?.trim() ?? '';
    logger.info(`[config] v1 설정 이관: ${v1}`);
    const out: Obj = {};
    if (key) out.ai = { provider: 'gemini', gemini: { api_key: key } };
    if (old.convert?.output_dir) out.convert = { output_dir: old.convert.output_dir };
    return out;
  } catch {
    return null;
  }
}

export function getSettings(): Readonly<Settings> {
  if (cached) return cached;
  return reload();
}

let tmpSeq = 0;

export function reload(): Settings {
  const p = configPath();
  let loaded: unknown = {};
  if (existsSync(p)) {
    try {
      loaded = JSON.parse(readFileSync(p, 'utf-8'));
    } catch (err) {
      // 깨진 파일을 그대로 두면 다음 저장 한 번에 AI 키·기관 정보가 기본값으로 덮인다 → 옆으로 옮겨 남긴다
      const kept = `${p}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { renameSync(p, kept); } catch { /* 옮기지 못해도 기본값으로 연다 */ }
      logger.error(`[config] 설정 파일이 깨져 기본값으로 엽니다 (${basename(kept)} 에 남김): ${err}`);
    }
  } else {
    loaded = migrateV1() ?? {};
  }
  user = isObj(loaded) ? loaded : {};
  const migrate = openSecrets(user);
  policy = loadPolicy(POLICY_SHAPE);
  const s = compose();
  // 예전에 평문으로 저장한 키는 한 번 다시 써서 암호화한다
  if (migrate) void persist(user).catch((e) => logger.warn(`[config] 키 암호화 저장 실패: ${e}`));
  return s;
}

/** 기관 배포 설정으로만 정하는 값 — 띄울 실행 파일 경로. 화면(update_settings)·settings.json 의 값은 쓰지 않는다
 *  (화면이 뚫려도 아무 실행 파일이나 띄우게 되지 않게. 평소에는 자동으로 찾는다) */
const ADMIN_ONLY: ReadonlyArray<[string, string]> = [['claude_code', 'cli_path'], ['codex', 'cli_path']];

function dropAdminOnly(layer: Obj): Obj {
  const ai = isObj(layer.ai) ? layer.ai : undefined;
  for (const [section, key] of ADMIN_ONLY) {
    const sec = ai && isObj(ai[section]) ? (ai[section] as Obj) : undefined;
    if (sec && Object.hasOwn(sec, key)) delete sec[key];
  }
  return layer;
}

/** 기본값 < 기관 기본값 < 사용자 값 < 기관 고정값, 그리고 화면용 policy 표지 */
function compose(): Settings {
  let s = structuredClone(DEFAULT_SETTINGS) as unknown as Obj;
  for (const layer of [policy?.defaults, dropAdminOnly(structuredClone(user)), policy?.locked]) if (layer) s = deepMerge(s, structuredClone(layer));
  delete s.policy; // settings.json 을 손으로 고쳐 넣은 표지는 버린다
  if (policy) {
    s.policy = {
      source: policy.source,
      ...(policy.notice ? { notice: policy.notice } : {}),
      locked: [...policy.lockedPaths],
      ...(policy.error ? { error: policy.error } : {}),
    };
  }
  cached = Object.freeze(s as unknown as Settings);
  return cached;
}

export function getConfig<K extends keyof Settings>(section: K): Settings[K] {
  return getSettings()[section];
}

const ALLOWED_SECTIONS = new Set(['ai', 'privacy', 'org', 'convert', 'general', 'impact', 'law']);
/** 기관 배포 설정이 정할 수 있는 모양 — 허용 구획의 기본값 */
const POLICY_SHAPE: Obj = Object.fromEntries([...ALLOWED_SECTIONS].map((k) => [k, DEFAULT_SETTINGS[k as keyof Settings]]));
const SECRET_FIELDS = ['api_key'];

/** 프론트로 보낼 때 키 마스킹 */
export function maskSecrets(settings: Readonly<Settings>): Settings {
  const s = structuredClone(settings) as Settings;
  for (const p of ['openai', 'local', 'gemini', 'anthropic'] as const) {
    const k = s.ai[p].api_key;
    if (k && k.trim()) s.ai[p].api_key = k.length > 4 ? `${k.slice(0, 4)}****` : '****';
  }
  return s;
}

const isMasked = (v: unknown) => typeof v === 'string' && v.includes('****');

/** 마스킹된 키가 되돌아오면 버림 (재귀) */
function dropMaskedSecrets(obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_FIELDS.includes(k) && isMasked(v)) delete obj[k];
    else if (v && typeof v === 'object' && !Array.isArray(v)) dropMaskedSecrets(v as Record<string, unknown>);
  }
}

/** 고정 경로는 버리고 실제 적용된 설정을 돌려준다. settings.json 에는 사용자 값만 쓴다 */
export async function updateSettings(patch: Record<string, unknown>): Promise<Settings> {
  const shown = getSettings() as unknown as Obj;
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_KEYS.has(key) || !ALLOWED_SECTIONS.has(key)) continue;
    sanitized[key] = patch[key];
  }
  dropMaskedSecrets(sanitized);
  dropAdminOnly(sanitized);

  const next = structuredClone(user);
  applyPatch(next, sanitized, shown, new Set(policy?.lockedPaths), '');
  await persist(next);

  user = next;
  logger.info('[config] updated');
  return compose();
}

/** settings.json 쓰기 — 임시 파일 뒤 바꿔 넣기, 키는 암호화(sealedForFile) */
async function persist(next: Obj): Promise<void> {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const p = configPath();
  // 동시에 두 번 저장해도 같은 임시 파일을 두고 다투지 않게
  const tmp = `${p}.${process.pid}.${++tmpSeq}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify({ version: 2, ...sealedForFile(next) }, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await rename(tmp, p);
  } catch (err) {
    // 문서 저장 오류 안내("설정 > 저장 위치를 바꾸세요")는 여기와 맞지 않는다
    if (/^(EACCES|EPERM|EROFS)$/.test((err as NodeJS.ErrnoException).code ?? '')) {
      throw new Error(`설정 파일을 저장할 권한이 없습니다. 앱 데이터 폴더(${dir})에 쓸 수 있는지 확인하거나 IT 담당자에게 문의하세요.`);
    }
    throw err;
  }
  try { chmodSync(p, 0o600); } catch { /* Windows 는 무시 */ }
}

/** 사용자 값에 patch 를 얹는다. 고정 경로는 버리고(정책을 빼면 원래 값이 돌아오게),
 *  사용자가 정한 적 없는 값을 보이는 그대로 돌려보낸 것도 굳히지 않는다(화면은 구획째 보낸다 — 기관 기본값이 바뀌면 따라가게) */
function applyPatch(target: Obj, patch: Obj, shown: Obj | undefined, locked: Set<string>, prefix: string): void {
  for (const [k, v] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    const path = prefix + k;
    if (locked.has(path)) { logger.info(`[config] ${path} 는 기관 배포 설정으로 고정돼 바꾸지 않습니다`); continue; }
    const own = Object.hasOwn(target, k);
    const cur = shown && Object.hasOwn(shown, k) ? shown[k] : undefined;
    if (isObj(v) && (!own || isObj(target[k]))) {
      const sub = own ? target[k] as Obj : {};
      applyPatch(sub, v, isObj(cur) ? cur : undefined, locked, `${path}.`);
      if (!own && Object.keys(sub).length) target[k] = sub;
    } else if (own || JSON.stringify(v) !== JSON.stringify(cur)) {
      target[k] = v;
    }
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      target[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else if (sv !== undefined) {
      target[key] = sv;
    }
  }
  return target;
}
