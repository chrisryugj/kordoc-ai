/** 기관 배포 설정(policy.json) — 찾는 순서·defaults·locked·update 가 고정값을 못 바꿈·깨진 파일·금지 키·정책 제거
 *
 * 실제 사용자 설정 폴더·/Library·ProgramData 는 건드리지 않는다: 앱 데이터는 KORDOC_AI_DATA_DIR, 정책은 KORDOC_AI_POLICY 로 임시 폴더.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSettings, maskSecrets, reload, updateSettings } from '../src/infra/config.js';
import { policyCandidates } from '../src/infra/policy.js';
import { RpcRouter } from '../src/rpc/router.js';
import { registerSystem } from '../src/rpc/methods/system.js';

const root = mkdtempSync(join(tmpdir(), 'kordoc-policy-'));
let n = 0;
let data = '';
let policyPath = '';

beforeEach(() => {
  n += 1;
  data = join(root, `data-${n}`);
  policyPath = join(root, `policy-${n}.json`);
  process.env.KORDOC_AI_DATA_DIR = data;
  process.env.KORDOC_AI_POLICY = policyPath;
});
afterAll(() => {
  delete process.env.KORDOC_AI_POLICY;
  rmSync(root, { recursive: true, force: true });
});

const writePolicy = (p: unknown) => writeFileSync(policyPath, typeof p === 'string' || Buffer.isBuffer(p) ? p : JSON.stringify(p));
const writeUser = (u: unknown) => {
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify(u));
};
const userFile = () => JSON.parse(readFileSync(join(data, 'settings.json'), 'utf-8'));
const sorted = (a: string[] | undefined) => [...(a ?? [])].sort();

describe('찾기', () => {
  it('KORDOC_AI_POLICY 경로의 파일을 읽어 source·notice·locked 를 붙인다', () => {
    writePolicy({ version: 1, notice: '가온시 정보통신과 배포', locked: { privacy: { offline: true } } });
    const s = reload();
    expect(s.policy).toEqual({ source: policyPath, notice: '가온시 정보통신과 배포', locked: ['privacy.offline'] });
    expect(s.privacy.offline).toBe(true);
  });

  it('찾는 순서: 환경변수 → 기계 전체 → 설치 폴더(동봉 Node 의 위 폴더)', () => {
    expect(policyCandidates({ KORDOC_AI_POLICY: 'D:\\배포\\policy.json', ProgramData: 'C:\\ProgramData' }, 'win32', 'C:\\Program Files\\KorDoc AI\\node\\node.exe'))
      .toEqual(['D:\\배포\\policy.json', 'C:\\ProgramData\\KorDoc AI\\policy.json', 'C:\\Program Files\\KorDoc AI\\policy.json']);
    expect(policyCandidates({}, 'darwin', '/Applications/KorDoc AI.app/Contents/Resources/node/node'))
      .toEqual(['/Library/Application Support/KorDoc AI/policy.json', '/Applications/KorDoc AI.app/Contents/Resources/policy.json']);
    // 시스템 Node(개발 실행)는 설치 폴더 후보가 없다
    expect(policyCandidates({ KORDOC_AI_POLICY: ' ' }, 'darwin', '/opt/homebrew/bin/node')).toEqual(['/Library/Application Support/KorDoc AI/policy.json']);
  });

  it('레포 루트 policy.example.json 은 버리는 값 없이 그대로 적용된다', () => {
    const example = readFileSync(join(__dirname, '..', '..', 'policy.example.json'), 'utf-8');
    writePolicy(example);
    const s = reload();
    expect(s.policy?.error).toBeUndefined();
    expect(sorted(s.policy?.locked)).toEqual(['ai.openai.base_url', 'ai.redact_before_cloud', 'privacy.offline']);
    expect(s.ai.provider).toBe('openai');
    expect(s.org.approval_line).toEqual(['담당', '팀장', '과장']);
  });

  it('정책 파일이 없으면 policy 를 붙이지 않고 예전처럼 저장·다시 읽기', async () => {
    expect(reload().policy).toBeUndefined();
    await updateSettings({ org: { name: '가온시' }, privacy: { offline: true } });
    const s = reload();
    expect(s.policy).toBeUndefined();
    expect(s.org.name).toBe('가온시');
    expect(s.privacy.offline).toBe(true);
    expect(userFile().version).toBe(2);
  });
});

describe('적용 순서: 기본값 < defaults < 사용자 값 < locked', () => {
  it('defaults 는 사용자가 정하지 않은 값의 기본이고 사용자 값이 이긴다', () => {
    writePolicy({
      version: 1,
      defaults: {
        ai: { provider: 'openai', openai: { base_url: 'http://10.0.0.5:8000/v1', model: 'gemma4' } },
        org: { name: '가온시', address: '가온시 시청로 1', approval_line: ['담당', '팀장', '과장'] },
      },
    });
    writeUser({ org: { name: '나온구' } });
    const s = reload();
    expect(s.ai.provider).toBe('openai');
    expect(s.ai.openai.base_url).toBe('http://10.0.0.5:8000/v1');
    expect(s.org.name).toBe('나온구');
    expect(s.org.address).toBe('가온시 시청로 1');
    expect(s.org.approval_line).toEqual(['담당', '팀장', '과장']);
    expect(s.ai.gemini.model).toBe('gemini-3.8-flash');
    expect(s.policy?.locked).toEqual([]);
  });

  it('화면이 구획째 돌려보내도 바꾸지 않은 기관 기본값은 settings.json 에 굳히지 않는다', async () => {
    writePolicy({ version: 1, defaults: { org: { name: '가온시', address: '가온시 시청로 1' } } });
    reload();
    // 내 기관 정보 화면처럼 org 전체를 보낸다
    await updateSettings({ org: { ...getSettings().org, person: '김가온' } });
    expect(userFile().org).toEqual({ person: '김가온' });
    // 담당자가 기본 주소를 바꾸면 이 PC 도 따라간다
    writePolicy({ version: 1, defaults: { org: { name: '가온시', address: '가온시 새청사로 2' } } });
    const s = reload();
    expect(s.org.address).toBe('가온시 새청사로 2');
    expect(s.org.person).toBe('김가온');
  });

  it('locked 는 사용자 값보다 우선하고, 고정 안 된 옆 칸은 사용자 값', () => {
    writePolicy({ version: 1, locked: { privacy: { offline: true }, ai: { openai: { base_url: 'http://10.0.0.5:8000/v1' } } } });
    writeUser({ privacy: { offline: false }, ai: { openai: { base_url: 'http://127.0.0.1:11434/v1', model: 'mine' } } });
    const s = reload();
    expect(s.privacy.offline).toBe(true);
    expect(s.ai.openai.base_url).toBe('http://10.0.0.5:8000/v1');
    expect(s.ai.openai.model).toBe('mine');
    expect(sorted(s.policy?.locked)).toEqual(['ai.openai.base_url', 'privacy.offline']);
  });

  it('고정된 비밀값(api_key)도 화면으로 보낼 때는 가린다', () => {
    writePolicy({ version: 1, locked: { ai: { openai: { api_key: 'sk-gaon-internal-0001' } } } });
    expect(reload().ai.openai.api_key).toBe('sk-gaon-internal-0001');
    const shown = maskSecrets(getSettings());
    expect(shown.ai.openai.api_key).toBe('sk-g****');
    expect(JSON.stringify(shown)).not.toContain('internal');
    expect(shown.policy?.locked).toEqual(['ai.openai.api_key']);
  });
});

describe('update_settings', () => {
  it('고정된 경로는 무시하고 나머지만 저장, settings.json 에 고정값을 써 넣지 않는다', async () => {
    writePolicy({ version: 1, locked: { privacy: { offline: true }, org: { name: '가온시' } } });
    writeUser({ privacy: { offline: false } });
    reload();
    const next = await updateSettings({ privacy: { offline: false }, org: { name: '바꾼시', dept: '총무과' } });
    expect(next.privacy.offline).toBe(true);
    expect(next.org.name).toBe('가온시');
    expect(next.org.dept).toBe('총무과');
    expect(sorted(next.policy?.locked)).toEqual(['org.name', 'privacy.offline']);
    const file = userFile();
    expect(file.privacy).toEqual({ offline: false });
    expect(file.org).toEqual({ dept: '총무과' });
    expect(file.policy).toBeUndefined();
  });

  it('RPC: get_settings 는 policy 를 붙이고 키를 가린다, update_settings 는 실제 적용된 설정을 돌려준다', async () => {
    writePolicy({ version: 1, notice: '정보통신과', locked: { privacy: { offline: true }, ai: { openai: { api_key: 'sk-gaon-internal-0001' } } } });
    reload();
    const router = new RpcRouter();
    registerSystem(router);
    const got = (await router.dispatch('get_settings', {}, 1)).result as ReturnType<typeof getSettings>;
    expect(got.policy).toEqual({ source: policyPath, notice: '정보통신과', locked: ['privacy.offline', 'ai.openai.api_key'] });
    expect(got.ai.openai.api_key).toBe('sk-g****');
    const r = await router.dispatch('update_settings', { settings: { privacy: { offline: false }, ai: { openai: { api_key: 'sk-mine-9999', model: 'gemma4' } } } }, 2);
    const next = r.result as ReturnType<typeof getSettings>;
    expect(r.error).toBeUndefined();
    expect(next.privacy.offline).toBe(true);
    expect(next.ai.openai.api_key).toBe('sk-g****');
    expect(next.ai.openai.model).toBe('gemma4');
    expect(next.policy?.locked).toHaveLength(2);
    expect(getSettings().ai.openai.api_key).toBe('sk-gaon-internal-0001');
    expect(JSON.stringify(userFile())).not.toContain('sk-');
  });
});

describe('잘못된 정책 파일', () => {
  it('깨진 JSON 은 무시하고 사용자 설정으로 연다, 줄 번호와 할 일을 policy.error 로', () => {
    writePolicy('{\n  "version": 1,\n  "locked": { "privacy": { "offline": true }, }\n}');
    writeUser({ org: { name: '나온구' } });
    const s = reload();
    expect(s.privacy.offline).toBe(false);
    expect(s.org.name).toBe('나온구');
    expect(s.policy?.source).toBe(policyPath);
    expect(s.policy?.locked).toEqual([]);
    expect(s.policy?.error).toMatch(/3번째 줄.*확인하세요/);
    expect(s.policy?.error).not.toContain('offline'); // 파일 원문 조각(키가 있을 수 있음)을 싣지 않는다
  });

  it.each([
    ['version 없음', JSON.stringify({ locked: { privacy: { offline: true } } }), /version/],
    ['맨 바깥이 배열', '[{"version":1}]', /\{ \}/],
    ['UTF-8 이 아님(ANSI 저장)', Buffer.from([0x7b, 0x22, 0xb0, 0xa1, 0x22, 0x3a, 0x31, 0x7d]), /UTF-8/],
  ])('%s → 통째로 무시하고 알린다', (_, content, msg) => {
    writePolicy(content);
    const s = reload();
    expect(s.privacy.offline).toBe(false);
    expect(s.policy?.locked).toEqual([]);
    expect(s.policy?.error).toMatch(msg);
  });

  it('메모장이 붙이는 UTF-8 BOM 은 읽는다', () => {
    writePolicy(`\uFEFF${JSON.stringify({ version: 1, locked: { privacy: { offline: true } } })}`);
    const s = reload();
    expect(s.policy?.error).toBeUndefined();
    expect(s.privacy.offline).toBe(true);
  });

  it('금지 키(__proto__ 등)·허용 밖 구획·모르는 항목·타입이 다른 값은 그 값만 버린다', () => {
    writePolicy(`{"version":1,
      "defaults":{"__proto__":{"polluted":true},"org":{"constructor":{"x":1},"name":"가온시"}},
      "locked":{"version":3,"policy":{"locked":["x"]},"privacy":{"offline":"true"},
        "ai":{"timeout_ms":"60000","openai":{"base_url":"http://10.0.0.5:8000/v1","nope":1}},
        "impact":{"baselines":{"draft":30,"__proto__":{"x":1},"memo":"20"}}}}`);
    const s = reload();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(s.org.name).toBe('가온시');
    expect(s.privacy.offline).toBe(false);
    expect(s.ai.timeout_ms).toBe(180_000);
    expect(s.version).toBe(2);
    expect(s.impact.baselines).toEqual({ draft: 30 });
    expect(sorted(s.policy?.locked)).toEqual(['ai.openai.base_url', 'impact.baselines.draft']);
    expect(s.policy?.error).toBeUndefined();
  });
});

describe('정책 제거', () => {
  it('정책 파일을 빼면 사용자 값이 돌아온다 (고정 중에 저장했어도)', async () => {
    writePolicy({ version: 1, locked: { privacy: { offline: true }, ai: { openai: { base_url: 'http://10.0.0.5:8000/v1' } } } });
    writeUser({ privacy: { offline: false }, ai: { openai: { base_url: 'http://127.0.0.1:11434/v1' } } });
    reload();
    // 화면은 보이는 값(고정값)을 그대로 돌려보낸다
    await updateSettings({ privacy: { offline: true }, ai: { openai: { base_url: 'http://10.0.0.5:8000/v1', model: 'gemma4' } } });
    rmSync(policyPath);
    const s = reload();
    expect(s.policy).toBeUndefined();
    expect(s.privacy.offline).toBe(false);
    expect(s.ai.openai.base_url).toBe('http://127.0.0.1:11434/v1');
    expect(s.ai.openai.model).toBe('gemma4');
  });

  it('v1 이관은 옮긴 값만 사용자 값으로 둔다 (기관 기본값을 가리지 않음)', () => {
    const before = process.env.APPDATA;
    const appdata = join(root, `appdata-${n}`);
    mkdirSync(join(appdata, 'com.kordoc-ai.app', 'config'), { recursive: true });
    writeFileSync(join(appdata, 'com.kordoc-ai.app', 'config', 'settings.yaml'), 'convert:\n  output_dir: D:/out\n');
    process.env.APPDATA = appdata;
    try {
      writePolicy({ version: 1, defaults: { ai: { provider: 'openai', openai: { base_url: 'http://10.0.0.5:8000/v1' } } } });
      const s = reload();
      expect(s.convert.output_dir).toBe('D:/out');
      expect(s.ai.provider).toBe('openai');
      expect(s.ai.openai.base_url).toBe('http://10.0.0.5:8000/v1');
    } finally {
      if (before === undefined) delete process.env.APPDATA; else process.env.APPDATA = before;
    }
  });
});

describe('정책: 공유 폴더 저장 위치', () => {
  it('저장 위치를 UNC 로 고정하면 그 값만 빼고 나머지는 적용', async () => {
    const { loadPolicy } = await import('../src/infra/policy.js');
    const dir = mkdtempSync(join(tmpdir(), 'kordoc-policy-unc-'));
    const file = join(dir, 'policy.json');
    writeFileSync(file, JSON.stringify({ version: 1, locked: { convert: { output_dir: '\\\\nas01\\공유\\결과', format: 'md' } } }));
    const prev = process.env.KORDOC_AI_POLICY;
    process.env.KORDOC_AI_POLICY = file;
    try {
      const p = loadPolicy({ convert: { output_dir: '', format: 'md' } })!;
      expect(p.locked).toEqual({ convert: { format: 'md' } });
    } finally {
      if (prev === undefined) delete process.env.KORDOC_AI_POLICY; else process.env.KORDOC_AI_POLICY = prev;
    }
  });
});

describe('설정 파일이 깨졌을 때', () => {
  it('깨진 파일은 옆으로 옮겨 남기고 기본값으로 연다 (다음 저장이 키·기관 정보를 지우지 않게)', () => {
    const dir = process.env.KORDOC_AI_DATA_DIR!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), '{"version":2,"org":{"name":"가온시",},}');
    reload();
    const kept = readdirSync(dir).filter((n) => n.startsWith('settings.json.broken-'));
    expect(kept.length).toBeGreaterThan(0);
    expect(readFileSync(join(dir, kept[0]), 'utf-8')).toContain('가온시');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('쓸 수 없는 데이터 폴더: 문서 저장 위치가 아니라 설정 파일 권한을 안내한다', async () => {
    const dir = process.env.KORDOC_AI_DATA_DIR!;
    mkdirSync(dir, { recursive: true });
    reload();
    chmodSync(dir, 0o555);
    try {
      await expect(updateSettings({ org: { name: '가온시' } })).rejects.toThrow(/설정 파일을 저장할 권한이 없습니다/);
    } finally {
      chmodSync(dir, 0o755);
    }
  });
});
