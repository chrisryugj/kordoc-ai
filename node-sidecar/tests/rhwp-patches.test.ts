/** 편집기 빌드 패치 — 플러그인 허용 줄은 한 번만 들어가고, 자리가 없으면 크게 실패한다 */
import { describe, it, expect } from 'vitest';
import { applyPluginAllow, missingPluginHooks } from '../../scripts/rhwp-patches.mjs';

const MAIN = "async function resolvePlugin(id) {\n  if (import.meta.env.DEV && id === 'dev-probe') {\n    return x;\n  }\n}\n";

describe('rhwp-patches', () => {
  it('kordoc-agent 를 허용 목록에 넣는다', () => {
    const out = applyPluginAllow(MAIN);
    expect(out).toContain("if (id === 'kordoc-agent')");
    expect(out).toContain("import('./kordoc-agent-plugin.mjs')");
  });
  it('자리가 없거나 둘이면 실패한다', () => {
    expect(() => applyPluginAllow('nothing')).toThrow(/플러그인 허용 패치/);
    expect(() => applyPluginAllow(MAIN + MAIN)).toThrow();
  });
  it('플러그인이 쓰는 스튜디오 이름이 빠지면 알린다', () => {
    expect(missingPluginHooks(() => null).length).toBeGreaterThan(10);
    expect(missingPluginHooks(() => 'getZoom(): number').some((m) => m.includes('cursor.ts'))).toBe(true);
  });
});
