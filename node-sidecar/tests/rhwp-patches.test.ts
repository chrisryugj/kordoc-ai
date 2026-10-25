/** 편집기 빌드 패치 — 허용 목록에 kordoc-ai 한 줄, 자리가 없거나 둘이면 크게 실패, 받아 둔 스튜디오 소스가 있으면 실제 파일에 걸린다 */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ALLOW_FILE, allowAiPlugin } from '../../scripts/rhwp-patches.mjs';

const MAIN = "async function resolvePlugin(id) {\n  if (import.meta.env.DEV && id === 'dev-probe') {\n    return x;\n  }\n}\n";
const STUDIO = join(tmpdir(), 'kordoc-rhwp-build-0.8.7', 'rhwp', 'rhwp-studio');

describe('rhwp-patches', () => {
  it('kordoc-ai 를 허용 목록에 넣는다', () => {
    const out = allowAiPlugin(MAIN);
    expect(out).toContain("if (id === 'kordoc-ai')");
    expect(out).toContain("import('./kordoc-ai-plugin.mjs')).aiPlugin");
    expect(out.indexOf("'kordoc-ai'")).toBeLessThan(out.indexOf("'dev-probe'"));
  });
  it('자리가 없거나 둘이면 실패한다', () => {
    expect(() => allowAiPlugin('nothing')).toThrow(/허용 자리/);
    expect(() => allowAiPlugin(MAIN + MAIN)).toThrow();
  });
  it.skipIf(!existsSync(join(STUDIO, ALLOW_FILE)))('받아 둔 스튜디오 소스에 걸린다', () => {
    expect(allowAiPlugin(readFileSync(join(STUDIO, ALLOW_FILE), 'utf-8'))).toContain("'kordoc-ai'");
  });
});
