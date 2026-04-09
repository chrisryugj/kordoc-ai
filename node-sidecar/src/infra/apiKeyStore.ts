/** API 키 저장소 — 순환 참조 없이 config↔gemini 간 키 공유 */

let _key = '';

export function setApiKey(key: string): void {
  const prev = _key ? `${_key.slice(0, 4)}****` : '(empty)';
  _key = key;
  const next = _key ? `${_key.slice(0, 4)}****` : '(empty)';
  console.error(`[apiKeyStore] setApiKey: ${prev} → ${next}`);
}

export function getApiKey(): string {
  return _key;
}
