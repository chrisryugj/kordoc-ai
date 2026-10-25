/** 편집기 빌드 패치 — 찾을 글이 없거나 두 번이면 크게 실패하고, 받아 둔 스튜디오 소스가 있으면 패치마다 실제 파일에 한 번씩 걸린다 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PATCHED_FILES, STUDIO_PATCHES, missingHancomCommands, missingPluginHooks, patchFile } from '../../scripts/rhwp-patches.mjs';

const MAIN = "async function resolvePlugin(id) {\n  if (import.meta.env.DEV && id === 'dev-probe') {\n    return x;\n  }\n}\n";
// scripts/build-rhwp-studio.mjs 가 받아 두는 자리
const STUDIO = join(tmpdir(), 'kordoc-rhwp-build-0.8.7', 'rhwp', 'rhwp-studio');

describe('rhwp-patches', () => {
  it('찾을 글이 없거나 둘이면 실패한다', () => {
    expect(() => patchFile('src/main.ts', MAIN)).toThrow(/패치 .* 자리를 찾지 못했습니다/);
    expect(() => patchFile('src/command/registry.ts', 'nothing')).toThrow(/studio-hancom-labels/);
  });
  it('패치하지 않는 파일은 그대로 둔다', () => {
    expect(patchFile('src/view/canvas.ts', 'same')).toBe('same');
  });
  it('플러그인·한컴 키가 쓰는 스튜디오 이름이 빠지면 알린다', () => {
    expect(missingPluginHooks(() => null).length).toBeGreaterThan(30);
    expect(missingPluginHooks(() => 'getZoom(): number').some((m) => m.includes('cursor.ts'))).toBe(true);
    expect(missingHancomCommands('')).toContain('table:create');
  });

  describe.skipIf(!existsSync(join(STUDIO, 'src', 'main.ts')))('받아 둔 스튜디오 소스', () => {
    const read = (f: string) => readFileSync(join(STUDIO, f), 'utf-8');
    it('기대는 이름과 명령이 다 있다', () => {
      expect(missingPluginHooks((f) => (existsSync(join(STUDIO, f)) ? read(f) : null))).toEqual([]);
      const dir = join(STUDIO, 'src', 'command', 'commands');
      expect(missingHancomCommands(readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf-8')).join('\n'))).toEqual([]);
    });
    it('패치가 모두 실제 파일에 걸린다', () => {
      const out = Object.fromEntries(PATCHED_FILES.map((f) => [f, patchFile(f, read(f))]));
      expect(out['src/main.ts']).toContain("if (id === 'kordoc-agent')");
      expect(out['src/main.ts']).toContain("from '@/kordoc-hancom-keys.mjs'");
      expect(out['src/core/wasm-bridge.ts']).toContain('deleteTableAt(ref');
      expect(out['src/core/wasm-bridge.ts']).toContain('memoSubstituteCssFontFamily(String(value))');
      expect(out['src/engine/input-handler-keyboard.ts']).toContain('hancomChordStart(this, e)');
      expect(STUDIO_PATCHES.length).toBe(12);
    });
  });
});
