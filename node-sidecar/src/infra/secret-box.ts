/** 설정 파일 속 API 키 암호화 — Windows 앱(Rust)이 자격 증명 관리자에 둔 앱 전용 키를 KORDOC_SECRET_KEY 로 넘긴다
 *
 * settings.json 에는 `enc:v1:` + base64(iv 12 · tag 16 · 암호문) 로 쓴다(AES-256-GCM). 키가 없으면(macOS·개발 중계기·시험)
 * 지금처럼 평문 — macOS 는 파일 권한 0600 으로 막고, 키체인을 쓰면 서명이 바뀌는 업데이트마다 접근 허용 창이 떠서 쓰지 않는다.
 * 키는 처음 읽을 때 환경 변수에서 지워 엔진이 띄우는 다른 프로그램(kordoc CLI·구독 계정 프로그램)에 넘어가지 않게 한다.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
let key: Buffer | null | undefined;

function secretKey(): Buffer | null {
  if (key !== undefined) return key;
  const raw = process.env.KORDOC_SECRET_KEY;
  delete process.env.KORDOC_SECRET_KEY;
  const b = raw ? Buffer.from(raw, 'base64') : null;
  key = b && b.length === 32 ? b : null;
  return key;
}

/** 시험용: 키를 다시 읽게 한다 */
export function resetSecretKey(): void {
  key = undefined;
}

export const hasSecretKey = (): boolean => !!secretKey();
export const isSealed = (v: unknown): v is string => typeof v === 'string' && v.startsWith(PREFIX);

/** 평문 → 저장용. 키가 없거나 빈 값이면 그대로 */
export function seal(plain: string): string {
  const k = secretKey();
  if (!k || !plain || isSealed(plain)) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

/** 저장 값 → 평문. 암호문인데 풀 수 없으면(키 없음·키 바뀜) null */
export function unseal(stored: string): string | null {
  if (!isSealed(stored)) return stored;
  const k = secretKey();
  if (!k) return null;
  try {
    const b = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
