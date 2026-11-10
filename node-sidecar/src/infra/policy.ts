/** 기관 배포 설정 — 정보통신 담당자가 파일 하나로 여러 PC에 같은 설정을 미리 넣고 일부는 고정한다
 *
 * 찾는 곳(처음 찾은 하나만): 환경변수 KORDOC_AI_POLICY → 기계 전체(Windows %ProgramData%\KorDoc AI\policy.json,
 * macOS /Library/Application Support/KorDoc AI/policy.json) → 설치 폴더(동봉 Node <resources>/node/node 의 위 폴더 policy.json).
 * 형식 v1: { "version": 1, "notice": "…", "defaults": { 설정 일부 }, "locked": { 설정 일부 } }
 * 값은 기본 설정과 같은 자리·같은 타입만 받고 나머지는 그 값만 버린다(로그).
 * 파일 자체가 깨졌으면(못 읽음·UTF-8 아님·JSON 아님·version 다름) 통째로 무시하고 error 로 화면에 알린다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { logger } from './logger.js';

const isUncLike = (v: string) => v.startsWith('\\\\') || v.startsWith('//') || win32.normalize(v).startsWith('\\\\');

type Obj = Record<string, unknown>;

export interface Policy {
  source: string;
  notice?: string;
  /** 검사를 통과한 값만 */
  defaults: Obj;
  locked: Obj;
  /** 고정된 항목 경로 ("privacy.offline" 꼴) */
  lockedPaths: string[];
  /** 파일을 쓰지 못한 까닭 — 있으면 defaults·locked 는 비어 있다 */
  error?: string;
}

/** 합칠 때 절대 쓰지 않는 키 (프로토타입 오염) */
export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** 찾을 자리, 앞에서부터 */
export function policyCandidates(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, execPath = process.execPath): string[] {
  const path = platform === 'win32' ? win32 : posix;
  const out: string[] = [];
  const fromEnv = env.KORDOC_AI_POLICY?.trim();
  if (fromEnv) out.push(fromEnv);
  if (platform === 'win32' && env.ProgramData) out.push(path.join(env.ProgramData, 'KorDoc AI', 'policy.json'));
  if (platform === 'darwin') out.push('/Library/Application Support/KorDoc AI/policy.json');
  // 설치본은 동봉 Node(<resources>/node/node[.exe])로 돈다 → <resources>/policy.json (Windows 는 설치 폴더)
  const nodeDir = path.dirname(execPath);
  if (path.basename(nodeDir) === 'node' && /^node(\.exe)?$/i.test(path.basename(execPath))) out.push(path.join(path.dirname(nodeDir), 'policy.json'));
  return out;
}

/** 보안 설명자(SDDL)의 소유자가 관리자 쪽인가 — Administrators(BA)·SYSTEM(SY)·TrustedInstaller */
export function adminOwned(sddl: string): boolean {
  const owner = /^\s*O:(S-[\d-]+|[A-Z]{2})/.exec(sddl)?.[1] ?? '';
  return owner === 'BA' || owner === 'SY' || owner === 'S-1-5-32-544' || owner === 'S-1-5-18' || owner.startsWith('S-1-5-80-956008885-');
}

/** 파일 소유자의 SDDL 을 읽는다 (Windows). 경로는 환경 변수로 넘겨 따옴표·특수 문자 문제를 피한다 */
function readOwnerSddl(path: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Acl -LiteralPath $env:KORDOC_POLICY_FILE).Sddl'], {
    env: { ...process.env, KORDOC_POLICY_FILE: path }, encoding: 'utf-8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
}

const ownerSeen = new Map<string, boolean>();

/** 기계 전체 자리(%ProgramData%·/Library)의 정책 파일을 믿어도 되는가 — 소유자가 관리자·시스템일 때만.
 *  %ProgramData% 는 일반 사용자도 폴더와 파일을 만들 수 있다. 소유자를 보지 않으면 여럿이 쓰는 PC 에서 한 사용자가 정책 파일을 심어
 *  다른 사용자의 앱이 엉뚱한 실행 파일을 띄우거나(구독 프로그램 위치) 문서를 엉뚱한 서버로 보내게(AI 서버 주소) 할 수 있다.
 *  확인하지 못하면(확인 도구가 막힘) 믿지 않는다 */
export function machinePolicyTrusted(path: string, platform: NodeJS.Platform = process.platform, readSddl: (p: string) => string = readOwnerSddl): boolean {
  try {
    const st = statSync(path);
    if (platform !== 'win32') return st.uid === 0;
    const key = `${path}|${st.mtimeMs}|${st.size}`;
    const hit = ownerSeen.get(key);
    if (hit !== undefined) return hit;
    const ok = adminOwned(readSddl(path));
    ownerSeen.set(key, ok);
    return ok;
  } catch {
    return false;
  }
}

/** 이 자리는 기계 전체 정책 자리인가 (환경 변수로 준 자리·설치 폴더는 아니다: 그 사용자 자신만 바꿀 수 있다) */
function isMachineSpot(source: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (env.KORDOC_AI_POLICY?.trim() === source) return false;
  if (platform === 'win32') return !!env.ProgramData && win32.normalize(source).toLowerCase() === win32.join(env.ProgramData, 'KorDoc AI', 'policy.json').toLowerCase();
  return platform === 'darwin' && source === '/Library/Application Support/KorDoc AI/policy.json';
}

/** 파일 → JSON 객체. 실패하면 화면에 그대로 보일 문장(무엇이 틀렸는지 + 할 일)으로 던진다 */
function readPolicyFile(source: string): Obj {
  let buf: Buffer;
  try {
    buf = readFileSync(source);
  } catch (err) {
    throw new Error(`파일을 열 수 없습니다(${(err as NodeJS.ErrnoException).code ?? err}). 파일 위치와 읽기 권한을 확인하세요`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf); // 메모장이 붙이는 BOM 은 여기서 떨어진다
  } catch {
    throw new Error('UTF-8로 저장된 파일이 아닙니다. 메모장의 다른 이름으로 저장에서 인코딩을 UTF-8로 고르세요');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    // V8 오류 문장에는 파일 원문 조각(키가 있을 수 있음)이 섞이므로 줄·칸만 옮긴다
    const at = /line (\d+) column (\d+)/.exec((err as Error).message);
    throw new Error(`${at ? `${at[1]}번째 줄 ${at[2]}번째 칸 근처의 ` : ''}JSON 문법이 틀렸습니다. 쉼표·따옴표·괄호를 확인하세요`);
  }
  if (!isObj(raw)) throw new Error('{ }로 감싼 JSON이 아닙니다. 맨 앞은 {, 맨 끝은 }여야 합니다');
  if (raw.version !== 1) throw new Error('"version": 1이 없습니다. 맨 위에 "version": 1을 넣으세요');
  return raw;
}

const KIND: Record<string, string> = { string: '글자', number: '숫자', boolean: 'true·false' };

/** shape(기본 설정)와 같은 자리·같은 타입인 값만 남긴다 */
function pick(raw: Obj, shape: Obj, at: string, drop: (path: string, why: string) => void): Obj {
  const out: Obj = {};
  const free = Object.keys(shape).length === 0; // 자유 키 맵 — 지금은 impact.baselines(일 종류 → 분)뿐
  for (const [k, v] of Object.entries(raw)) {
    const path = `${at}.${k}`;
    if (FORBIDDEN_KEYS.has(k)) drop(path, '쓸 수 없는 이름');
    else if (free) {
      if (typeof v === 'number') out[k] = v;
      else drop(path, '숫자가 아님');
    } else if (!Object.hasOwn(shape, k)) drop(path, '없는 항목');
    else if (isObj(shape[k])) {
      if (!isObj(v)) { drop(path, '{ } 묶음이 아님'); continue; }
      const sub = pick(v, shape[k] as Obj, path, drop);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (Array.isArray(shape[k])) {
      // 배열은 결재선(직위 글자 목록)뿐
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = [...v];
      else drop(path, '글자 목록이 아님');
    } else if (typeof v === 'string' && /dir$/.test(k) && isUncLike(v)) {
      // 저장 위치를 공유 폴더(UNC)로 고정하면 모든 저장이 막힌다 → 그 값만 빼고 기본 위치(문서\KorDoc AI 결과)로
      drop(path, '네트워크 경로(UNC)는 쓸 수 없음: 드라이브 문자(Z:)로 연결한 폴더를 쓰세요');
    } else if (typeof v === typeof shape[k]) out[k] = v;
    else drop(path, `${KIND[typeof shape[k]]}여야 함`);
  }
  return out;
}

/** 값이 든 맨 끝 경로들 (배열·자유 키 맵의 값은 끝으로 본다) */
function leafPaths(o: Obj, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (isObj(v) ? leafPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

/** 정책 파일을 찾아 읽는다. 없으면 null. shape 는 정할 수 있는 구획의 기본값 */
export function loadPolicy(shape: Obj): Policy | null {
  const source = policyCandidates().find((p) => existsSync(p));
  if (!source) return null;
  let raw: Obj;
  try {
    if (isMachineSpot(source) && !machinePolicyTrusted(source)) {
      throw new Error(process.platform === 'win32'
        ? '파일 소유자가 관리자(Administrators)나 SYSTEM이 아니어서 적용하지 않았습니다. 관리자 권한 명령 프롬프트에서 복사하거나 icacls "<파일>" /setowner Administrators 를 실행하세요'
        : '파일 소유자가 root가 아니어서 적용하지 않았습니다. sudo chown root 로 소유자를 바꾸세요');
    }
    raw = readPolicyFile(source);
  } catch (err) {
    const error = (err as Error).message;
    logger.error(`[policy] 기관 배포 설정을 읽지 못해 무시합니다: ${source}: ${error}`);
    return { source, defaults: {}, locked: {}, lockedPaths: [], error };
  }

  const drop = (path: string, why: string) => logger.warn(`[policy] ${path} 무시: ${why}`);
  const part = (name: 'defaults' | 'locked'): Obj => {
    if (raw[name] === undefined) return {};
    if (isObj(raw[name])) return pick(raw[name] as Obj, shape, name, drop);
    drop(name, '{ } 묶음이 아님');
    return {};
  };
  for (const k of Object.keys(raw)) if (!['version', 'notice', 'defaults', 'locked'].includes(k)) drop(k, '없는 항목');
  if (raw.notice !== undefined && typeof raw.notice !== 'string') drop('notice', '글자여야 함');
  const notice = typeof raw.notice === 'string' && raw.notice.trim() ? raw.notice.trim() : undefined;
  const defaults = part('defaults');
  const locked = part('locked');
  const lockedPaths = leafPaths(locked);
  logger.info(`[policy] 기관 배포 설정 적용: ${source} (기본값 ${leafPaths(defaults).length}개, 고정 ${lockedPaths.length}개)`);
  return { source, notice, defaults, locked, lockedPaths };
}
