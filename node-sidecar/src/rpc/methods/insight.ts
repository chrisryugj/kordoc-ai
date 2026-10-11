/** RPC 메서드 — 효과 집계·보안 상태 (리드) */

import type { RpcRouter } from '../router.js';
import { usageReport, usageReset } from '../../infra/usage.js';
import { netLogSnapshot } from '../../infra/net-guard.js';
import { dataDir, getSettings } from '../../infra/config.js';
import { aiConfigured, getProvider } from '../../infra/llm/index.js';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 설치본: <sidecar>/dist/bundle.mjs → <sidecar>/samples · 개발(tsc): dist/rpc/methods → ../../../samples */
function bundledSamples(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, '..', 'samples'), join(here, '..', '..', '..', 'samples')].find((d) => existsSync(join(d, 'index.json'))) ?? null;
}

/** 예제는 앱 데이터 폴더로 복사해서 쓴다 — 사용자가 고쳐도 설치본 원본은 그대로 */
function samplesList() {
  const src = bundledSamples();
  if (!src) throw new Error('예제 문서가 설치돼 있지 않습니다.');
  const dst = join(dataDir(), 'samples');
  const srcIndex = JSON.parse(readFileSync(join(src, 'index.json'), 'utf-8')) as { version: number; note: string; scenarios: Array<{ id: string; title: string; description: string; files: string[] }> };
  let fresh = true;
  try { fresh = JSON.parse(readFileSync(join(dst, 'index.json'), 'utf-8')).version !== srcIndex.version; } catch { /* 처음 */ }
  if (fresh) cpSync(src, dst, { recursive: true });
  return {
    dir: dst,
    note: srcIndex.note,
    scenarios: srcIndex.scenarios.map((sc) => ({ ...sc, files: sc.files.map((f) => join(dst, f)).filter((f) => existsSync(f)) })),
  };
}

export function registerInsight(router: RpcRouter): void {
  router.register('usage_report', (params) => usageReport(params.range === 'all' ? 'all' : 'month'));
  router.register('usage_reset', async () => {
    await usageReset();
    return true;
  });
  router.register('samples_list', () => samplesList());
  router.register('security_status', () => {
    const s = getSettings();
    let isCloud = false;
    if (aiConfigured()) isCloud = getProvider().isCloud;
    const net = netLogSnapshot();
    return {
      offline: s.privacy.offline,
      ai_provider: s.ai.provider,
      ai_is_cloud: isCloud,
      redact_before_cloud: s.ai.redact_before_cloud,
      external_sent: net.external_sent,
      recent: net.entries.slice(0, 50),
      data_dir: dataDir(),
      telemetry: false,
    };
  });
}
