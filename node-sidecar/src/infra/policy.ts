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
import { winTool } from './win-tools.js';

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

/** 윈도의 기계 전체 자료 폴더. MCP 서버로 뜬 엔진은 AI 프로그램이 넘기는 좁은 환경만 받아 ProgramData 변수가 없을 수 있다.
 *  그때 이 자리를 후보에서 빼면 기관이 고정한 폐쇄망 모드·AI 서버 주소가 MCP 쪽에서만 풀린다 → 다른 변수와 기본 자리로 찾는다 */
const programData = (env: NodeJS.ProcessEnv): string => env.ProgramData || env.PROGRAMDATA || env.ALLUSERSPROFILE || `${env.SystemDrive || 'C:'}\\ProgramData`;

/** 찾을 자리, 앞에서부터 */
export function policyCandidates(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, execPath = process.execPath): string[] {
  const path = platform === 'win32' ? win32 : posix;
  const out: string[] = [];
  const fromEnv = env.KORDOC_AI_POLICY?.trim();
  if (fromEnv) out.push(fromEnv);
  if (platform === 'win32') out.push(path.join(programData(env), 'KorDoc AI', 'policy.json'));
  if (platform === 'darwin') out.push('/Library/Application Support/KorDoc AI/policy.json');
  // 설치본은 동봉 Node(<resources>/node/node[.exe])로 돈다 → <resources>/policy.json (Windows 는 설치 폴더)
  const nodeDir = path.dirname(execPath);
  if (path.basename(nodeDir) === 'node' && /^node(\.exe)?$/i.test(path.basename(execPath))) out.push(path.join(path.dirname(nodeDir), 'policy.json'));
  return out;
}

/** 관리자 쪽 계정 — Administrators(BA)·SYSTEM(SY)·TrustedInstaller·기본 관리자 계정(LA)·도메인·엔터프라이즈 관리자(DA·EA) */
const isAdminSid = (sid: string) => ['BA', 'SY', 'LA', 'DA', 'EA', 'S-1-5-32-544', 'S-1-5-18'].includes(sid)
  || sid.startsWith('S-1-5-80-956008885-') || /^S-1-5-21-[\d-]+-(?:500|512|519)$/.test(sid);

/** 보안 설명자(SDDL)의 소유자가 관리자 쪽인가 */
export function adminOwned(sddl: string): boolean {
  return isAdminSid(/^\s*O:(S-[\d-]+|[A-Z]{2})/.exec(sddl)?.[1] ?? '');
}

/** SDDL 권한 이름 → 비트 */
const RIGHT_BITS: Record<string, number> = {
  CC: 0x1, DC: 0x2, LC: 0x4, SW: 0x8, RP: 0x10, WP: 0x20, DT: 0x40, LO: 0x80, CR: 0x100,
  SD: 0x10000, RC: 0x20000, WD: 0x40000, WO: 0x80000,
  GA: 0x10000000, GX: 0x20000000, GW: 0x40000000, GR: 0x80000000,
  FA: 0x1f01ff, FR: 0x120089, FW: 0x120116, FX: 0x1200a0,
};
/** 파일: 내용 쓰기·덧붙이기·지우기·권한 바꾸기·소유자 바꾸기·모든 권한 */
const FILE_WRITE = 0x2 | 0x4 | 0x10000 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000;
/** 폴더: 안의 파일 지우기·폴더 지우기(이름 바꾸기)·권한 바꾸기·소유자 바꾸기·모든 권한. 새 파일 만들기는 뺀다(%ProgramData% 기본값이고, 만든 파일은 소유자 검사에 걸린다) */
const DIR_WRITE = 0x40 | 0x10000 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000;

/** 관리자 쪽이 아닌 계정이 고칠 수 있는가 — 허용 항목(ACE) 가운데 쓰기·지우기·권한 바꾸기가 든 것이 있으면 true.
 *  소유자만 보면 모자라다: 일반 사용자가 폴더를 먼저 만들어 물려줄 권한을 넣어 두면, 관리자가 넣은 파일이 "관리자 소유"이면서 그 사용자가 고칠 수 있다.
 *  읽지 못하는 권한 표기는 위험한 것으로 본다 */
export function writableByOthers(sddl: string, folder = false): boolean {
  const from = sddl.indexOf('D:');
  if (from < 0) return true; // 권한 목록이 없으면(읽지 못했으면) 믿지 않는다
  // 감사 목록(S:)의 시작은 괄호 밖에서만 찾는다. 조건식 글자 안의 "S:" 에서 자르면 그 뒤의 허용 항목을 못 본다
  let sacl = -1;
  for (let i = from + 2, depth = 0; i < sddl.length - 1; i++) {
    if (sddl[i] === '(') depth++;
    else if (sddl[i] === ')') depth = Math.max(0, depth - 1);
    else if (!depth && sddl[i] === 'S' && sddl[i + 1] === ':') { sacl = i; break; }
  }
  const dacl = sddl.slice(from, sacl < 0 ? undefined : sacl);
  // 권한 목록이 아예 없는 꼴(널 DACL)은 누구나 모든 권한이다
  if (/NO_ACCESS_CONTROL/i.test(dacl)) return true;
  const danger = folder ? DIR_WRITE : FILE_WRITE;
  for (const m of dacl.matchAll(/\(([^)]*)\)/g)) {
    const [type = '', flags = '', rights = '', , , sid = ''] = m[1].split(';').map((x, i) => (i === 2 && /^0x/i.test(x) ? x : x.toUpperCase()));
    if (type !== 'A' && type !== 'XA') continue;
    // 파일에서는 "물려주기 전용" 항목이 그 파일에 적용되지 않는다. 폴더에서는 물려줄 권한도 본다
    if (!folder && flags.includes('IO')) continue;
    // 소유자 권한(OW)은 소유자 검사가 따로 막는다.
    // 만든 사람(CO)에게 주는 권한은 그 사람이 만든 것에만 붙는다(%ProgramData% 기본값) → 남이 만든 파일은 소유자 검사에 걸린다
    if (isAdminSid(sid) || sid === 'OW' || sid === 'CO') continue;
    let mask = 0;
    if (/^0x[0-9a-f]+$/i.test(rights)) mask = parseInt(rights, 16);
    else for (const code of rights.match(/../g) ?? []) mask |= RIGHT_BITS[code] ?? danger;
    if (rights.length % 2 && !/^0x/i.test(rights)) mask |= danger;
    if (mask & danger) return true;
  }
  return false;
}

/** 파일·폴더의 SDDL 을 읽는다 (Windows). 경로는 환경 변수로 넘겨 따옴표·특수 문자 문제를 피한다 */
function readOwnerSddl(path: string): string {
  return execFileSync(winTool('powershell'), ['-NoProfile', '-NonInteractive', '-Command', '(Get-Acl -LiteralPath $env:KORDOC_POLICY_FILE).Sddl'], {
    env: { ...process.env, KORDOC_POLICY_FILE: path }, encoding: 'utf-8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** 판정 기억 — 소유자·권한은 파일 수정 시각을 바꾸지 않으므로 잠깐만 기억한다(오래 떠 있는 MCP 서버가 고친 권한을 다시 본다) */
const ownerSeen = new Map<string, { ok: boolean; at: number }>();
const SEEN_MS = 60_000;

/** 기계 전체 자리(%ProgramData%·/Library)의 정책 파일을 믿어도 되는가 — 파일과 그 폴더의 소유자가 관리자·시스템이고,
 *  관리자 쪽이 아닌 계정이 고칠 수 없을 때만.
 *  %ProgramData% 는 일반 사용자도 폴더와 파일을 만들 수 있다. 이것을 보지 않으면 여럿이 쓰는 PC 에서 한 사용자가 정책 파일을 심거나 고쳐
 *  다른 사용자의 앱이 엉뚱한 실행 파일을 띄우거나(구독 프로그램 위치) 문서를 엉뚱한 서버로 보내게(AI 서버 주소) 할 수 있다.
 *  확인하지 못하면(확인 도구가 막힘) 믿지 않는다 */
export function machinePolicyTrusted(path: string, platform: NodeJS.Platform = process.platform, readSddl: (p: string) => string = readOwnerSddl, now = Date.now()): boolean {
  try {
    const st = statSync(path);
    if (platform !== 'win32') return st.uid === 0 && (st.mode & 0o022) === 0;
    const key = `${path}|${st.mtimeMs}|${st.size}`;
    const hit = ownerSeen.get(key);
    if (hit && now - hit.at < SEEN_MS) return hit.ok;
    const file = readSddl(path);
    const dir = readSddl(win32.dirname(path));
    const ok = adminOwned(file) && !writableByOthers(file) && adminOwned(dir) && !writableByOthers(dir, true);
    ownerSeen.set(key, { ok, at: now });
    return ok;
  } catch {
    return false;
  }
}

/** 이 자리는 기계 전체 정책 자리인가 (환경 변수로 준 자리·설치 폴더는 아니다: 그 사용자 자신만 바꿀 수 있다) */
function isMachineSpot(source: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (env.KORDOC_AI_POLICY?.trim() === source) return false;
  if (platform === 'win32') return win32.normalize(source).toLowerCase() === win32.join(programData(env), 'KorDoc AI', 'policy.json').toLowerCase();
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

/** 정책 파일을 찾아 읽는다. 없으면 null. shape 는 정할 수 있는 구획의 기본값.
 *  앞 자리의 파일을 못 쓰면(믿지 못하는 소유자·권한, 깨진 파일) 다음 자리로 넘어간다: 일반 사용자가 %ProgramData% 에 아무 파일이나
 *  만들어 두는 것만으로 설치 폴더의 기관 정책(폐쇄망 모드·AI 서버 주소 고정)이 통째로 풀리면 안 된다 */
export function loadPolicy(shape: Obj): Policy | null {
  let failed: Policy | null = null;
  for (const source of policyCandidates().filter((p) => existsSync(p))) {
    const one = readPolicy(source, shape);
    if (!one.error) return one;
    failed ??= one;
  }
  return failed;
}

function readPolicy(source: string, shape: Obj): Policy {
  let raw: Obj;
  try {
    if (isMachineSpot(source) && !machinePolicyTrusted(source)) {
      throw new Error(process.platform === 'win32'
        ? '파일이나 그 폴더의 소유자가 관리자(Administrators)·SYSTEM이 아니거나, 일반 사용자가 고칠 수 있는 권한이 있어 적용하지 않았습니다. 관리자 권한 명령 프롬프트에서 폴더를 새로 만들어 파일을 넣고 권한을 관리자·SYSTEM만 쓰도록 맞추세요(배포 안내 문서의 명령 참고)'
        : '파일 소유자가 root가 아니거나 다른 사용자가 고칠 수 있어 적용하지 않았습니다. sudo chown root 와 chmod 644 로 맞추세요');
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
