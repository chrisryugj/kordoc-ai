/** 공문서 작성실 — 메타(gongmun_meta) · HWPX 생성(generate_hwpx, 저장 또는 실시간 미리보기)
 *
 * 견본 단계 서식(levels_from)은 kordoc CLI `levels --json`, 표 서식(profile_from)은 hwpxToProfile.
 * 둘 다 (경로·수정 시각·크기) 로 캐시 — 작성실은 입력할 때마다 부르니 같은 견본을 다시 재지 않는다.
 */

import { existsSync } from 'node:fs';
import { stat, readFile, writeFile } from 'node:fs/promises';
import { rhwpCompat } from './rhwp-compat.js';
import { rhwpConvert } from '../render/rhwp.js';
import {
  AGENCY_COMMON_NAME, BUILTIN_TEMPLATES, PRESET_ALIAS, agencyNames, extractClickHereFields, hwpxToProfile,
  incompatibleGongmunWarnings, markdownToHwpx, muncheLintWarnings, readBuiltinTemplate, renderDocument,
  unknownFontWarnings, usesGaejosikMunche,
  type FormatProfile, type GongmunOptions, type GongmunPreset,
} from 'kordoc';
import type { GenerateParams, GongmunMeta, LintFinding, PagePreview } from '../../types/rpc-contract.js';
import { cleanMessage } from '../errors.js';
import { formatOf } from '../files/format.js';
import { parseCliJson, runKordocCli } from '../kordoc-cli.js';
import { outputFile, safeFileName } from '../output/index.js';
import { lintText } from './lint.js';
import { KIND_PRESET } from '../ai/draft-guides.js';
import { getSettings } from '../../infra/config.js';
import { orgDocFoot } from '../template/org.js';

type GongmunLevelStyle = NonNullable<GongmunOptions['levels']>[string];

/** 한 줄 맞춤 여유 — 장평 맞춤이 98%까지 채운 줄은 한컴·rhwp 에서 두 글자가 넘쳤다(생성 보고서 9건 25곳). 96%까지만 채운다 */
export const AUTO_FIT = { safety: 0.96 } as const;

export const PRESETS: Array<{ id: GongmunPreset; label: string; description: string }> = [
  { id: 'official', label: '기안문', description: '대외 시행문·협조문. 법정 항목부호(1. 가. 1))와 끝 표시' },
  { id: 'report', label: '보고서', description: '□ ○ - 개조식 보고서. 장 제목 띠와 쪽번호' },
  { id: 'plan', label: '계획서', description: '추진 계획·기본계획. 장 제목 띠와 □ ○ - 항목' },
  { id: 'notice', label: '통지·안내', description: '공고·알림·안내문. ㅇ 항목부호' },
  { id: 'minutes', label: '회의록', description: '회의 결과 정리. 좁은 줄간격' },
  { id: 'gaejosik', label: '개조식 보고서', description: '정부 표준 개조식. 표지·목차·로마숫자 장 머리 자동' },
  { id: 'press', label: '보도자료', description: '보도시점·담당 표·부제가 있는 보도자료' },
  { id: 'ministry', label: '업무보고', description: '중앙부처 업무보고. 장 띠·절 숫자칸·소제목 상자' },
  { id: 'bangchim', label: '서울 방침서', description: '서울시 방침서. 제목표·파랑 부제·요약 상자' },
];

/** 영문 키·한글 별칭 → 프리셋 (모르는 이름은 오류) */
export function presetOf(input?: string): GongmunPreset {
  if (!input?.trim()) return 'official';
  const key = PRESET_ALIAS[input.trim()];
  if (!key) throw new Error(`모르는 문서 종류입니다: ${input}. ${PRESETS.map((p) => p.label).join('·')} 중에서 고르세요.`);
  return key;
}

/** 이미 있는 문서를 한글로 다시 짤 때 문서 모양을 보고 갈래를 고른다. 확실하지 않으면 undefined (서식을 억지로 입히지 않고 꾸밈 없이) */
export function guessPreset(markdown: string): GongmunPreset | undefined {
  const head = markdown.slice(0, 4000);
  const title = (/^#\s+(.+)$/m.exec(head)?.[1] ?? head.split('\n').find((l) => l.trim()) ?? '').trim();
  const has = (re: RegExp) => re.test(head);
  // 수신 줄 + (제목 줄·시행 번호·"1. 관련:") = 시행문·기안문. 옛 서식은 "수 신"·"제 목".
  // 보도자료를 보고하는 내부결재 공문("제목 언론보도 자료 보고")이 보도자료로 잡히지 않게 보도자료보다 먼저 본다 (실공문 210건 모두 기안문)
  if (has(/^\s*수\s?신\s*[:：]?\s*\S/m) && (has(/^\s*제\s?목\s*[:：]?\s*\S/m) || has(/시\s?행\s+\S+-\d+/) || has(/^\s*1\.\s*관련\s*[:：]/m))) return 'official';
  if (has(/보도\s*자료|보도\s*일시|배포\s*일시|엠바고/)) return 'press';
  if (/회의록|회의\s*결과/.test(title) || (has(/참석자?\s*[:：]/) && has(/안건/))) return 'minutes';
  const items = (head.match(/^\s*[□■○◦ㅇ❍]\s/gm) ?? []).length;
  if (items >= 4) return /계획/.test(title) ? 'plan' : 'report';
  if (/공고|안내|알림|통지/.test(title)) return 'notice';
  return undefined;
}

export function checkAgency(name: string): string {
  const n = name.trim();
  if (n !== AGENCY_COMMON_NAME && !agencyNames().includes(n)) throw new Error(`기관 서식 목록에 없는 기관입니다: ${n}. 목록에서 고르거나 공통을 쓰세요.`);
  return n;
}

/** (경로·수정 시각·크기) 캐시 */
function fileCache<T>(limit = 20) {
  const map = new Map<string, T>();
  return async (path: string, load: () => Promise<T>): Promise<T> => {
    const st = await stat(path);
    const key = `${path}|${st.mtimeMs}|${st.size}`;
    const hit = map.get(key);
    if (hit) return hit;
    const v = await load();
    map.set(key, v);
    if (map.size > limit) map.delete(map.keys().next().value!);
    return v;
  };
}

const levelsCache = fileCache<Record<string, GongmunLevelStyle>>();
const profileCache = fileCache<FormatProfile>();

/** 견본 HWPX 의 항목부호 단계별 대표 글꼴·크기·굵기 (없으면 빈 객체) */
export function levelsFrom(path: string, signal?: AbortSignal): Promise<Record<string, GongmunLevelStyle>> {
  if (formatOf(path) !== 'hwpx') throw new Error('견본 서식은 HWPX만 됩니다. 한글에서 HWPX로 저장해 넣으세요.');
  return levelsCache(path, async () => {
    const r = await runKordocCli(['levels', path, '--json'], { signal });
    return parseCliJson<{ levels?: Record<string, GongmunLevelStyle> }>(r, '견본 서식을 읽지 못했습니다.').levels ?? {};
  });
}

function profileFrom(path: string): Promise<FormatProfile> {
  if (formatOf(path) !== 'hwpx') throw new Error('표 서식 참조 문서는 HWPX만 됩니다. 한글에서 HWPX로 저장해 넣으세요.');
  return profileCache(path, async () => hwpxToProfile(await readFile(path)));
}

let metaCache: Promise<GongmunMeta> | null = null;

export function gongmunMeta(): Promise<GongmunMeta> {
  metaCache ??= (async () => ({
    presets: PRESETS.map(({ id, label, description }) => ({ id, label, description })),
    agencies: [AGENCY_COMMON_NAME, ...agencyNames()],
    kind_presets: { ...KIND_PRESET },
    templates: await Promise.all(BUILTIN_TEMPLATES.map(async (t) => ({
      id: t.id,
      name: t.aliases[0] ?? t.id,
      description: cleanMessage(t.title),
      fields: (await extractClickHereFields(readBuiltinTemplate(t))).map((f) => f.name),
    }))),
  }))();
  return metaCache;
}

const firstHeading = (md: string) => /^#\s+(.+)$/m.exec(md)?.[1].replace(/[*_`\\]/g, '').trim();

/** 생성 결과 앞쪽을 그림으로 — 조판 캐시 없는 생성본은 kordoc reflow 로 그린다 */
export async function previewPages(buf: ArrayBuffer | Buffer, pages = 2, maxWidth = 900): Promise<PagePreview[]> {
  const n = Math.min(Math.max(Math.round(pages), 1), 10);
  const r = await renderDocument(Buffer.from(buf as ArrayBuffer), { format: 'png', pages: `1-${n}`, maxWidthPx: maxWidth });
  return r.assets.flatMap((a) => {
    if (!a.page || !Buffer.isBuffer(a.data)) return [];
    const size = r.scene.pages.find((sp) => sp.page === a.page);
    return [{ page: a.page, width: size?.width ?? 0, height: size?.height ?? 0, data_url: `data:image/png;base64,${a.data.toString('base64')}` }];
  });
}

/** 붙임 둘째 줄부터("2. …") 앞 6칸(= "붙임  " 폭) — 생성기가 같은 붙임의 다음 줄로 이어 그린다(안 띄우면 본문 항목 번호로 읽혀 번호가 바뀌고 끝 앞 두 칸이 사라진다) */
export function indentAttachments(md: string): string {
  const lines = md.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (/^\s*붙\s?임\s/.test(lines[i - 1]) || (/^ {6}\d{1,2}\.\s/.test(lines[i - 1]) && i > 1)) {
      if (/^\s{0,5}\d{1,2}\.\s/.test(lines[i])) lines[i] = `      ${lines[i].trim()}`;
    }
  }
  return lines.join('\n');
}

/** 기안문 두문·결문 — 내 기관 정보가 있을 때: "# 제목"은 두문 제목으로, 본문 앞쪽 "수신: …"(·"수신 …") 줄은 두문 수신으로 옮기고 본문에서 뺀다.
 *  결문은 orgDocFoot (발신명의 = 기관장, 결재선 = 기안자 + 결재 라인, 시행 "처리과명-" 번호·시행일은 결재 뒤). 기관 정보가 없으면 그대로 */
export function officialFrame(md: string, org = getSettings().org): { markdown: string; docHead?: GongmunOptions['docHead']; docFoot?: GongmunOptions['docFoot'] } {
  const docFoot = orgDocFoot(org);
  if (!org.name?.trim() && !docFoot) return { markdown: md };
  const lines = md.split('\n');
  let title: string | undefined;
  let to: string | undefined;
  // 제목 줄과 그 앞뒤 빈 줄·수신 줄까지만 (본문 첫 항목이 나오면 멈춘다)
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const h = /^#\s+(.+)$/.exec(t);
    if (h && title === undefined) { title = h[1].trim(); lines[i] = '\u0000'; continue; }
    const r = /^수\s?신(?!자)\s*[:：]?\s*(\S.*)$/.exec(t);
    if (r && to === undefined) { to = r[1].trim(); lines[i] = '\u0000'; continue; }
    break;
  }
  const body = lines.filter((l) => l !== '\u0000').join('\n').replace(/^\n+/, '');
  const head = Object.fromEntries(Object.entries({ org: org.name?.trim(), to, title }).filter(([, v]) => v)) as GongmunOptions['docHead'];
  return { markdown: body, docHead: head, ...(docFoot ? { docFoot } : {}) };
}

const templateCache = fileCache<Uint8Array>(8);

/** 견본 HWPX 바이트 (HWP 는 rhwp 로 HWPX 로 바꿔 캐시) */
function templateBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> {
  const fmt = formatOf(path);
  if (fmt !== 'hwpx' && fmt !== 'hwp') throw new Error('견본은 한글 문서(HWPX·HWP)만 됩니다. 우리 기관에서 쓴 한글 파일을 고르세요.');
  // 우리 기관 문서 모음의 사본(앱 데이터)이 지워졌으면 사용자가 본 적 없는 파일 이름 대신 할 일을 알린다
  if (!existsSync(path) && /[\\/]org-corpus[\\/]files[\\/]/.test(path)) {
    throw new Error('우리 기관 견본 사본이 지워졌습니다. 설정 › 우리 기관 문서 모음에서 그 문서를 빼고 다시 넣으세요.');
  }
  return templateCache(path, async () => {
    const raw = new Uint8Array(await readFile(path));
    return fmt === 'hwpx' ? raw : rhwpConvert(raw, 'hwpx', signal);
  });
}

/** kordoc 견본 모드 — 서식은 견본이 정하므로 공문 옵션은 쓰지 않는다. 경고의 "template:" 머리는 뗀다 */
async function fromTemplate(md: string, path: string, warnings: string[], signal?: AbortSignal): Promise<ArrayBuffer> {
  const template = await templateBytes(path, signal);
  signal?.throwIfAborted();
  const genWarnings: string[] = [];
  const buf = await markdownToHwpx(md, { template, warnings: genWarnings });
  warnings.push(...genWarnings.map((w) => w.replace(/^template:\s*/, '')));
  return buf;
}

export async function generateHwpx(p: GenerateParams, signal?: AbortSignal): Promise<{ output_path?: string; warnings: string[]; lint: LintFinding[]; preview?: PagePreview[]; preview_hwpx_b64?: string }> {
  const md = p.markdown ?? '';
  if (!md.trim()) throw new Error('본문이 비어 있습니다. 내용을 적으세요.');
  const preset = presetOf(p.preset);
  const warnings: string[] = [];
  const buf = p.template_path ? await fromTemplate(md, p.template_path, warnings, signal) : await fromPreset(md, preset, p, warnings, signal);
  if (usesGaejosikMunche(preset)) warnings.push(...muncheLintWarnings(md, 5));
  // 끝 표시는 엔진이 붙이므로 원고 단위 규칙("끝." 누락 등)은 빼고 검사
  const lint = lintText(md, { document: false });
  const clean = [...new Set(warnings.map(cleanMessage))];

  if (p.preview_only) {
    // 화면이 rhwp 로 그릴 HWPX — 저장본과 같은 다듬기(rhwpCompat)를 거쳐 편집기·PDF 와 같은 모양으로
    if (p.preview_hwpx) return { warnings: clean, lint, preview_hwpx_b64: Buffer.from(await rhwpCompat(buf)).toString('base64') };
    return { warnings: clean, lint, preview: await previewPages(buf, p.preview_pages ?? 2) };
  }
  const outPath = outputFile({ output_path: p.output_path, name: `${safeFileName(firstHeading(md) ?? '', '공문서')}.hwpx` });
  await writeFile(outPath, Buffer.from(await rhwpCompat(buf)));
  return { output_path: outPath, warnings: clean, lint };
}

/** 공문 프리셋 모드 — 갈래·기관 서식·견본 단계 서식·표 서식·표지·결재란 */
async function fromPreset(md: string, preset: GongmunPreset, p: GenerateParams, warnings: string[], signal?: AbortSignal): Promise<ArrayBuffer> {
  const gongmun: GongmunOptions = { preset, autoFit: { ...AUTO_FIT } };
  let body = md;
  if (preset === 'official') {
    const frame = officialFrame(indentAttachments(md));
    body = frame.markdown;
    if (frame.docHead) gongmun.docHead = { ...frame.docHead, ...(p.slogan?.trim() ? { slogan: p.slogan.trim() } : {}) };
    if (frame.docFoot) gongmun.docFoot = frame.docFoot;
  }
  if (p.agency?.trim()) gongmun.agency = checkAgency(p.agency);
  if (p.levels_from) {
    const levels = await levelsFrom(p.levels_from, signal);
    if (Object.keys(levels).length) gongmun.levels = levels;
    else warnings.push('견본에서 단계별 서식을 정하지 못했습니다(단계마다 같은 서식 문단 3개 이상 필요). 기본 서식으로 만듭니다.');
  }
  if (p.cover) gongmun.cover = { ...(p.cover.org ? { org: p.cover.org } : {}), ...(p.cover.date ? { date: p.cover.date } : {}) };
  if (p.toc !== undefined) gongmun.toc = p.toc;
  if (p.approval?.length) gongmun.approval = p.approval;
  if (p.page_numbers !== undefined) gongmun.pageNumbers = p.page_numbers;
  if (p.end_mark !== undefined) gongmun.endMark = p.end_mark;
  const profile = p.profile_from ? await profileFrom(p.profile_from) : undefined;
  signal?.throwIfAborted();

  warnings.push(...incompatibleGongmunWarnings(gongmun));
  if (gongmun.levels) {
    warnings.push(...unknownFontWarnings(Object.fromEntries(Object.entries(gongmun.levels).map(([d, s]) => [`${Number(d) + 1}단계`, s.font]))));
  }
  const genWarnings: string[] = [];
  const buf = await markdownToHwpx(body, { gongmun, ...(profile ? { profile } : {}), warnings: genWarnings });
  warnings.push(...genWarnings);
  return buf;
}
