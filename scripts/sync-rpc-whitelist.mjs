/**
 * Rust RPC 허용 목록을 계약(node-sidecar/src/types/rpc-contract.ts)에서 만든다 — 정본은 계약 하나.
 * 계약에 없는 기존 메서드(양식 작업대·편집 세션 등 v1 모양 유지분)는 아래 LEGACY 에.
 *
 * 사용: node scripts/sync-rpc-whitelist.mjs          (생성)
 *       node scripts/sync-rpc-whitelist.mjs --check  (CI: 어긋나면 실패)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const LEGACY = [
  'cancel',
  'form_schema', 'form_fill', 'patch_blocks', 'render_preview',
  'edit_open', 'edit_patch', 'edit_undo', 'edit_redo', 'edit_save', 'edit_close',
];

const src = readFileSync('node-sidecar/src/types/rpc-contract.ts', 'utf-8');
const start = src.indexOf('export interface RpcMethods {');
const end = src.indexOf('\n}\n', start);
if (start < 0 || end < 0) throw new Error('RpcMethods 를 찾지 못했다');
const body = src.slice(start, end);
const names = [...body.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*\[/gm)].map((m) => m[1]);
const all = [...new Set([...names, ...LEGACY])].sort();

const out = `// 자동 생성 — scripts/sync-rpc-whitelist.mjs (정본: node-sidecar/src/types/rpc-contract.ts). 손으로 고치지 말 것.
pub const ALLOWED_METHODS: &[&str] = &[
${all.map((n) => `    "${n}",`).join('\n')}
];
`;
const target = 'src-tauri/src/commands/rpc_methods.rs';
if (process.argv.includes('--check')) {
  const cur = existsSync(target) ? readFileSync(target, 'utf-8') : '';
  if (cur !== out) {
    console.error(`[rpc-whitelist] ${target} 가 계약과 다르다 — node scripts/sync-rpc-whitelist.mjs 로 다시 만들어라`);
    process.exit(1);
  }
  console.log(`[rpc-whitelist] 일치 (${all.length}개)`);
} else {
  writeFileSync(target, out);
  console.log(`[rpc-whitelist] ${all.length}개 → ${target}`);
}
