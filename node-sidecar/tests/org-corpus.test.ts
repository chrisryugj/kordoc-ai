/** 우리 기관 서식 묶음 — 넣기(HWPX·HWP·폴더·중복·한글 아닌 것)·갈래·대표 견본·구성·표현·생성에 더할 값·견본 모드 생성·AI 초안 지시문 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { markdownToHwpx, parse } from 'kordoc';
import { call, setupEnv } from './doc-helpers.js';
import { startFakeOpenAi, lastUser, type ChatBody, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn(), sendToken: vi.fn() }));

import { updateSettings } from '../src/infra/config.js';
import { sendProgress } from '../src/infra/progress.js';
import { draftDocument } from '../src/core/ai/draft.js';
import { orgCorpusAdd, phraseLines, skeletonOf } from '../src/core/org-corpus/index.js';
import { rhwpConvert } from '../src/core/render/rhwp.js';

const report = (title: string, extra: string) => `# ${title}

> ${title}을 보고하고자 함

## 추진 배경

□ 시민 불편 해소 필요
  ㅇ 관련 민원 해마다 늘어남
    - 2025년 민원 120건

## 추진 계획

□ 추진 일정: 2026. 11.
  ㅇ ${extra}

※ 소요 예산은 기정 예산으로 집행함
`;

const official = `# 직원 정보화 교육 실시 알림

수신 내부결재

1. 관련: 가온시 총무과-1234(2026. 10. 5.)
2. 직원 정보화 역량을 높이기 위하여 다음과 같이 교육을 실시하니 참석하여 주시기 바랍니다.
  가. 일시: 2026. 11. 6.(금) 14:00~17:00
  나. 장소: 시청 대회의실

붙임  교육 일정표 1부.  끝.
`;

let env: ReturnType<typeof setupEnv>;
let dir: string;
let fake: FakeServer;
let reply: (b: ChatBody) => string = () => '# 초안\n\n□ 내용';

beforeAll(async () => {
  env = setupEnv();
  dir = join(env.work, '기관문서');
  mkdirSync(join(dir, '하위'), { recursive: true });
  writeFileSync(join(dir, '보고1.hwpx'), Buffer.from(await markdownToHwpx(report('민원 처리 개선 보고', '처리 기간 단축'), { gongmun: { preset: 'report' } })));
  // HWP 도 넣는다 (rhwp 로 HWPX 사본)
  const hwpx2 = new Uint8Array(await markdownToHwpx(report('누리집 개편 결과 보고', '화면 정비'), { gongmun: { preset: 'report' } }));
  writeFileSync(join(dir, '하위', '보고2.hwp'), await rhwpConvert(hwpx2, 'hwp'));
  // 같은 문서의 HWPX (폴더 밖: 뒤에서 따로 넣어 본다)
  writeFileSync(join(env.work, '보고2 사본.hwpx'), hwpx2);
  writeFileSync(join(dir, '메모.txt'), '한글 문서가 아님');
  fake = await startFakeOpenAi({ reply: (b) => reply(b) });
});
afterAll(async () => { await fake?.close(); });

describe('구성 뼈대·표현 후보 (엔진)', () => {
  it('뼈대는 제목·항목부호 줄만, 글은 28자까지', () => {
    const sk = skeletonOf('# 제목\n\n□ 추진 배경\n  ㅇ 아주 긴 설명 문장이 여기에 길게 이어져서 스물여덟 자를 넘깁니다\n일반 문단\n| 표 | 칸 |');
    expect(sk[0]).toBe('# 제목');
    expect(sk[1]).toBe('□ 추진 배경');
    expect(sk[2].trim().length).toBeLessThanOrEqual(31);
    expect(sk).toHaveLength(3);
    // HWP 를 다시 읽은 글: # 없는 로마 숫자 장, 부호 뒤 탭
    expect(skeletonOf('누리집 개편\n\nⅠ 추진 배경\n\n□\t시민 불편\n\nⅡ. 추진 계획')).toEqual(['Ⅰ 추진 배경', '□ 시민 불편', 'Ⅱ. 추진 계획']);
  });
  it('뼈대·표현에 사람·연락처·결재란·HTML 표 줄은 넣지 않는다 (문의 줄은 이름표만)', () => {
    const md = '# 보고\n\n□ 문의: 정보화팀 주무관 홍길동 ☎ 031-123-4567\n□ 추진 배경\n과장 류○○ 차장 이○○ 부장 김○○\n김가온 이가온 박가온\n<table><tr><td>정보화팀</td></tr></table>\n위 호와 관련하여 다음과 같이 보고합니다.';
    const sk = skeletonOf(md);
    expect(sk).toEqual(['# 보고', '□ 문의:', '□ 추진 배경']);
    const ph = phraseLines(md);
    expect(ph.join('\n')).not.toMatch(/류○○|이가온|<table|홍길동|031/);
    expect(ph).toContain('위 호와 관련하여 다음과 같이 보고합니다.');
  });
  it('표현 후보는 숫자를 ○ 로, 사람·연락처 줄은 뺀다', () => {
    const l = phraseLines('2026. 11. 6. 시행\n담당: 주무관 김가온 ☎ 031-000-0000\n위 호와 관련하여 다음과 같이 회신합니다.');
    expect(l).toContain('○. ○. ○. 시행');
    expect(l.some((x) => x.includes('김가온'))).toBe(false);
    expect(l).toContain('위 호와 관련하여 다음과 같이 회신합니다.');
  });
});

describe('org_corpus_* (RPC)', () => {
  it('폴더째 넣기 — 한글 문서만, HWP 는 HWPX 사본, 갈래마다 처음 문서가 대표', async () => {
    const r = await call('org_corpus_add', { paths: [dir] });
    expect(r.added).toBe(2);
    expect(r.skipped.map((s: { path: string }) => s.path)).toEqual([join(dir, '메모.txt')]);
    expect(r.corpus.kinds).toEqual([{ kind: 'report', label: '보고서', count: 2, exemplar_id: expect.any(String) }]);
    const first = r.corpus.docs.find((d: { name: string }) => d.name === '보고1.hwpx');
    expect(first).toMatchObject({ kind: 'report', exemplar: true, title: '민원 처리 개선 보고' });
    expect(first.summary).toBeTruthy();
    const again = await call('org_corpus_add', { paths: [join(dir, '보고1.hwpx')] });
    expect(again.added).toBe(0);
    expect(again.skipped[0].reason).toContain('이미 넣은');
  });

  it('참고 — 대표 견본 사본(HWPX)·뼈대·둘 다 나온 표현, 보고서는 견본 모드로 만든다', async () => {
    const ref = await call('org_corpus_reference', { kind: 'report' });
    expect(ref).toMatchObject({ kind: 'report', label: '보고서', count: 2, exemplar: { title: '민원 처리 개선 보고' } });
    expect(existsSync(ref.exemplar.template_path)).toBe(true);
    expect(ref.exemplar.template_path.startsWith(env.data)).toBe(true);
    expect(ref.skeleton.some((l: string) => l.includes('추진 배경'))).toBe(true);
    expect(ref.phrases).toContain('※ 소요 예산은 기정 예산으로 집행함');
    expect(ref.phrases.some((l: string) => l.includes('처리 기간 단축'))).toBe(false); // 한 문서에만 나온 줄
    expect(ref.apply).toEqual({ template_path: ref.exemplar.template_path });
    expect(await call('org_corpus_reference', { kind: 'press' })).toBeNull();
    // HWP 로 넣은 문서도 HWPX 사본
    const list = await call('org_corpus_list');
    const hwp = list.docs.find((d: { name: string }) => d.name === '보고2.hwp');
    const other = await call('org_corpus_set', { id: hwp.id, exemplar: true });
    expect(other.docs.find((d: { id: string }) => d.id === hwp.id).exemplar).toBe(true);
    const ref2 = await call('org_corpus_reference', { kind: 'report' });
    expect(readFileSync(ref2.exemplar.template_path).subarray(0, 2).toString()).toBe('PK');
  });

  it('견본 모드 생성 — 견본 사본으로, 미리보기도 같은 길, 경고에 영문 머리가 없다', async () => {
    const ref = await call('org_corpus_reference', { kind: 'report' });
    const md = '# 새 사업 계획\n\n> 새 사업을 보고하고자 함\n\n## 현황\n\n□ 새 항목\n  ㅇ 새 중항목\n    - 새 세부\n';
    const pre = await call('generate_hwpx', { markdown: md, preset: 'report', ...ref.apply, preview_only: true, preview_hwpx: true });
    expect(pre.preview_hwpx_b64.length).toBeGreaterThan(100);
    expect(pre.warnings.every((w: string) => !w.startsWith('template:'))).toBe(true);
    const out = await call('generate_hwpx', { markdown: md, preset: 'report', ...ref.apply, output_path: join(env.out, '새 사업 계획.hwpx') });
    const back = await parse(readFileSync(out.output_path));
    expect(back.success && back.markdown).toContain('새 세부');
    expect(back.success && back.markdown).not.toContain('누리집 개편'); // 견본 글은 남지 않는다
  });

  it('갈래 바꾸기·빼기 — 대표 견본이 옮겨 가고 사본도 지운다', async () => {
    const list = await call('org_corpus_list');
    const [a, b] = list.docs;
    const moved = await call('org_corpus_set', { id: a.id, kind: 'plan' });
    expect(moved.kinds.map((k: { kind: string; count: number }) => [k.kind, k.count])).toEqual([['report', 1], ['plan', 1]]);
    expect(moved.docs.every((d: { exemplar: boolean }) => d.exemplar)).toBe(true);
    const ref = await call('org_corpus_reference', { kind: 'plan' });
    const after = await call('org_corpus_remove', { id: a.id });
    expect(after.docs.map((d: { id: string }) => d.id)).toEqual([b.id]);
    expect(existsSync(ref.exemplar.template_path)).toBe(false);
    await expect(call('org_corpus_set', { id: a.id, exemplar: true })).rejects.toThrow(/목록에 없는/);
    await expect(call('org_corpus_set', { id: b.id, kind: 'nope' })).rejects.toThrow(/모르는 갈래/);
  });

  it('기안문 — 공문 모드 그대로에 견본 표어(우리 기관 이름이 같을 때만)', async () => {
    const made = await call('generate_hwpx', { markdown: official, preset: 'official', slogan: '시민과 함께 여는 가온', output_path: join(env.work, '기안1.hwpx') });
    const r = await call('org_corpus_add', { paths: [made.output_path] });
    expect(r.added).toBe(1);
    expect(r.corpus.docs.find((d: { name: string }) => d.name === '기안1.hwpx').kind).toBe('official');
    const ref = await call('org_corpus_reference', { kind: 'official' });
    expect(ref.apply.template_path).toBeUndefined();
    expect(ref.apply.slogan).toBe('시민과 함께 여는 가온');
    await updateSettings({ org: { name: '다른시' } });
    expect((await call('org_corpus_reference', { kind: 'official' })).apply.slogan).toBeUndefined();
    await updateSettings({ org: { name: '가온시' } });
  });
});

describe('AI 초안 — 우리 기관 문서 구성', () => {
  beforeAll(async () => {
    await updateSettings({ ai: { provider: 'openai', openai: { base_url: `${fake.url}/v1`, model: 'test-model' } }, privacy: { offline: false } });
  });

  it('그 갈래 문서가 있으면 지시문에 구성·표현, 결과에 따른 문서. 끄면 넣지 않는다', async () => {
    reply = () => '# 청렴 교육 계획\n\n## 추진 배경\n\n□ 청렴 의식 높이기\n  ㅇ 교육 필요';
    const r = await draftDocument({ instruction: '청렴 교육 계획', preset: 'report', org: true }, new AbortController().signal);
    const msg = lastUser(fake.chats().at(-1)!);
    expect(msg).toContain('[우리 기관 문서 구성]');
    expect(msg).toContain('추진 배경');
    expect(r.org).toMatchObject({ kind: 'report', label: '보고서', count: 1 });
    const off = await draftDocument({ instruction: '청렴 교육 계획', preset: 'report', org: false }, new AbortController().signal);
    expect(lastUser(fake.chats().at(-1)!)).not.toContain('[우리 기관 문서 구성]');
    expect(off.org).toBeUndefined();
    const none = await draftDocument({ instruction: '보도자료', preset: 'press', org: true }, new AbortController().signal);
    expect(none.org).toBeUndefined();
  });
});

describe('문서 모음 지키기 (RPC)', () => {
  const doc = async (name: string, title: string) => {
    const r = await call('generate_hwpx', { markdown: report(title, `${title} 세부`), preset: 'report', output_path: join(env.work, name) });
    return r.output_path as string;
  };

  it('같은 문서를 HWP·HWPX 로 둘 다 넣으면 하나만, HWP 3.0·없는 경로·이상한 갈래는 까닭을 알린다', async () => {
    const r = await call('org_corpus_add', { paths: [join(env.work, '보고2 사본.hwpx')] });
    expect(r.added).toBe(0);
    expect(r.skipped[0].reason).toMatch(/같은 내용: 보고2\.hwp/);
    const old = join(env.work, '옛 문서.hwp');
    writeFileSync(old, Buffer.concat([Buffer.from('HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05', 'latin1'), Buffer.alloc(200)]));
    const r3 = await call('org_corpus_add', { paths: [old] });
    expect(r3.skipped[0].reason).toMatch(/HWP 3\.0/);
    await expect(call('org_corpus_add', { paths: [join(env.work, '없는 폴더')] })).rejects.toThrow(/찾지 못했습니다/);
    const id = (await call('org_corpus_list')).docs[0].id;
    await expect(call('org_corpus_set', { id, kind: 'constructor' })).rejects.toThrow(/모르는 갈래/);
  });

  it('동시에 넣고 빼도 목록이 어긋나지 않고, 사본이 지워진 문서는 견본에서 빠진다', async () => {
    const a = await doc('동시1.hwpx', '도로 정비 결과 보고');
    const b = await doc('동시2.hwpx', '공원 조성 결과 보고');
    const victim = (await call('org_corpus_list')).docs.find((d: { kind: string }) => d.kind === 'report');
    await Promise.all([call('org_corpus_add', { paths: [a] }), call('org_corpus_add', { paths: [b] }), call('org_corpus_remove', { id: victim.id })]);
    const list = await call('org_corpus_list');
    const names = list.docs.map((d: { name: string }) => d.name);
    expect(names).toEqual(expect.arrayContaining(['동시1.hwpx', '동시2.hwpx']));
    expect(names).not.toContain(victim.name);
    const one = list.docs.find((d: { name: string }) => d.name === '동시1.hwpx');
    rmSync(join(env.data, 'org-corpus', 'files', `${one.id}.hwpx`));
    expect((await call('org_corpus_list')).docs.find((d: { id: string }) => d.id === one.id).missing).toBe(true);
    const ref = await call('org_corpus_reference', { kind: one.kind });
    expect(ref.exemplar.id).not.toBe(one.id);
    expect(existsSync(ref.exemplar.template_path)).toBe(true);
    // 받아 둔 견본 경로의 사본이 그사이 지워지면 사용자가 본 적 없는 파일 이름 대신 할 일을 알린다
    await expect(call('generate_hwpx', { markdown: '# 새 보고\n\n□ 항목', preset: 'report', template_path: join(env.data, 'org-corpus', 'files', `${one.id}.hwpx`), preview_only: true })).rejects.toThrow(/견본 사본이 지워졌습니다/);
  });

  it('같은 제목·같은 틀이어도 표의 숫자가 다른 정기 보고는 따로 들어간다', async () => {
    const monthly = (n: number) => `# 시설 점검 결과 보고\n\n□ 점검 개요\n  ㅇ 대상: 관내 시설\n\n| 구분 | 건수 |\n| --- | --- |\n| 점검 | ${n * 10} |\n| 지적 | ${n} |\n| 조치 | ${n - 1} |\n\n※ 다음 점검은 다음 달에 함\n`;
    const paths: string[] = [];
    for (const n of [9, 10, 11]) {
      const r = await call('generate_hwpx', { markdown: monthly(n), preset: 'report', output_path: join(env.work, `${n}월 점검.hwpx`) });
      paths.push(r.output_path);
    }
    const r = await call('org_corpus_add', { paths });
    expect(r.added).toBe(3);
  });

  it('멈추면 그때까지 읽은 문서는 목록에 남는다', async () => {
    const folder = join(env.work, '멈춤');
    mkdirSync(folder, { recursive: true });
    for (const [i, t] of ['하천 정비 결과 보고', '경로당 냉방 결과 보고', '도서관 개관 결과 보고'].entries()) {
      writeFileSync(join(folder, `${i + 1}.hwpx`), readFileSync(await doc(`멈춤${i + 1}.hwpx`, t)));
    }
    const ac = new AbortController();
    vi.mocked(sendProgress).mockImplementation((p) => { if (p.current === 2) ac.abort(); });
    await expect(orgCorpusAdd([folder], ac.signal)).rejects.toBeTruthy();
    vi.mocked(sendProgress).mockImplementation(() => undefined);
    const names = (await call('org_corpus_list')).docs.map((d: { name: string; path: string }) => d.path);
    expect(names).toContain(join(folder, '1.hwpx'));
    expect(names).not.toContain(join(folder, '3.hwpx'));
  });

  it('목록 파일이 깨지면 옮겨 두고 새로 시작한다고 저장 전까지 알리고, 읽지 못한 목록은 덮어쓰지 않는다', async () => {
    const idx = join(env.data, 'org-corpus', 'index.json');
    const before = readFileSync(idx, 'utf8');
    writeFileSync(idx, before.slice(0, 20));
    const v = await call('org_corpus_list');
    expect(v.docs).toEqual([]);
    expect(v.notice).toMatch(/깨져/);
    expect(readdirSync(dirname(idx)).some((f) => f.startsWith('index.json.broken-'))).toBe(true);
    // 다른 화면(서식함·편집기 AI)이 먼저 읽어도 설정 화면에 남는다
    expect((await call('org_corpus_list')).notice).toMatch(/깨져/);
    // JSON 은 맞지만 목록 꼴이 아니어도 깨진 목록
    writeFileSync(idx, '{"version":1}');
    expect((await call('org_corpus_list')).notice).toMatch(/깨져/);
    writeFileSync(idx, before);
    const id = JSON.parse(before).docs[0].id;
    await call('org_corpus_set', { id, exemplar: true });
    expect((await call('org_corpus_list')).notice).toBeUndefined();
    // 권한 문제로 못 읽으면 빈 목록으로 보지 않고 알린다 (다음 저장이 덮어쓰지 않게)
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      chmodSync(idx, 0o000);
      try {
        await expect(call('org_corpus_list')).rejects.toThrow(/읽지 못했습니다/);
        await expect(call('org_corpus_add', { paths: [join(env.work, '9월 점검.hwpx')] })).rejects.toThrow(/읽지 못했습니다/);
      } finally {
        chmodSync(idx, 0o644);
      }
      expect(JSON.parse(readFileSync(idx, 'utf8')).docs.length).toBe(JSON.parse(before).docs.length);
    }
    expect(basename(idx)).toBe('index.json');
  });
});
