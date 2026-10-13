/** 서식함 — 내장(표준 기안문 2종 + 프리셋별 시작 서식) + 사용자 등록(앱 데이터 폴더 templates/, index.json)
 *
 * template_analyze 로 작성 방식을 고른다: 누름틀 칸 → fill_fields, 라벨-값 빈칸 → fill_labels, 그 밖 → style_sample(견본 서식으로 새로 작성).
 * template_starter 는 프리셋·기관 서식 + 내 기관 정보(설정 org)로 머리·끝을 채운 빈 시작 문서를 만든다.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { BUILTIN_TEMPLATES, extractClickHereFields, extractFormSchema, markdownToHwpx, readBuiltinTemplate, type GongmunOptions, type GongmunPreset } from 'kordoc';
import { rhwpCompat } from '../gongmun/rhwp-compat.js';
import type { TemplateAnalysis, TemplateEntry } from '../../types/rpc-contract.js';
import { dataDir, getSettings } from '../../infra/config.js';
import { cleanMessage } from '../errors.js';
import { parseDoc } from '../converter/index.js';
import { formatOf } from '../files/format.js';
import { checkAgency, levelsFrom, presetOf, PRESETS } from '../gongmun/index.js';
import { outputFile, stemOf } from '../output/index.js';
import { gongmunDate, orgDocFoot } from './org.js';

const libDir = () => join(dataDir(), 'templates');
const indexPath = () => join(libDir(), 'index.json');

type StoredEntry = TemplateEntry & { analysis?: TemplateAnalysis };

async function readIndex(): Promise<StoredEntry[]> {
  try {
    const j = JSON.parse(await readFile(indexPath(), 'utf-8')) as { templates?: StoredEntry[] };
    return Array.isArray(j.templates) ? j.templates.filter((t) => t && typeof t.id === 'string' && typeof t.path === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(templates: StoredEntry[]): Promise<void> {
  await mkdir(libDir(), { recursive: true });
  const tmp = `${indexPath()}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, templates }, null, 2), 'utf-8');
  await rename(tmp, indexPath());
}

let builtinCache: Promise<TemplateEntry[]> | null = null;

function builtinEntries(): Promise<TemplateEntry[]> {
  builtinCache ??= Promise.all(BUILTIN_TEMPLATES.map(async (t): Promise<TemplateEntry> => {
    const fields = await extractClickHereFields(readBuiltinTemplate(t));
    return {
      id: `builtin:${t.id}`, name: t.aliases[0] ?? t.id, category: '기안문', source: 'builtin', template: t.id,
      format: 'hwpx', has_fields: true, field_count: fields.length, description: cleanMessage(t.title),
    };
  }));
  return builtinCache;
}

const STRATEGY_TEXT: Record<TemplateAnalysis['strategy'], string> = {
  fill_fields: '누름틀 칸을 채워 완성하는 서식',
  fill_labels: '표의 빈칸을 채워 완성하는 서식',
  style_sample: '이 문서의 글꼴·항목 서식으로 새 문서를 쓰는 견본',
};

function guessCategory(name: string): string {
  const rules: Array<[RegExp, string]> = [[/기안|시행문/, '기안문'], [/보고/, '보고서'], [/계획/, '계획서'], [/보도/, '보도자료'], [/회의/, '회의록'], [/공고|안내|알림/, '공고·안내']];
  return rules.find(([re]) => re.test(name))?.[1] ?? '서식';
}

export async function templateLibrary(): Promise<{ templates: TemplateEntry[] }> {
  const starters = PRESETS.map((p): TemplateEntry => ({
    id: `starter:${p.id}`, name: `${p.label} 시작 서식`, category: p.label, source: 'starter', template: p.id,
    format: 'hwpx', has_fields: false, field_count: 0, description: `${p.description}. 내 기관 정보로 머리·끝을 채운 빈 문서`,
  }));
  const user = (await readIndex()).filter((t) => existsSync(t.path!));
  return { templates: [...(await builtinEntries()), ...starters, ...user] };
}

export async function templateAnalyze(path: string, signal?: AbortSignal): Promise<TemplateAnalysis> {
  const format = formatOf(path);
  if (format !== 'hwp' && format !== 'hwpx') throw new Error('서식은 HWP·HWPX 파일만 됩니다.');
  const r = await parseDoc(path, { images: false, ocr: 'off', keepLayout: true, signal });
  const schema = extractFormSchema(r.blocks).fields;
  const seen = new Set<string>();
  const label_fields = schema
    .map((f) => ({ label: f.label.replace(/\s*\n\s*/g, ' ').trim(), type: f.type, empty: f.empty }))
    .filter((f) => f.label && !seen.has(f.label) && !!seen.add(f.label));
  let fields: TemplateAnalysis['fields'] = [];
  let has_levels = false;
  if (format === 'hwpx') {
    const buf = await readFile(path);
    const names = new Set<string>();
    fields = (await extractClickHereFields(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer))
      .filter((f) => !names.has(f.name) && !!names.add(f.name))
      .map((f) => ({ name: f.name, ...(f.placeholder?.trim() ? { guide: f.placeholder.trim() } : {}), ...(/본문|내용|요약|설명/.test(f.name) ? { multiline: true } : {}) }));
    has_levels = Object.keys(await levelsFrom(path, signal).catch(() => ({}))).length > 0;
  }
  const strategy: TemplateAnalysis['strategy'] = fields.length ? 'fill_fields' : label_fields.filter((f) => f.empty).length >= 2 ? 'fill_labels' : 'style_sample';
  return {
    format,
    fields,
    label_fields: label_fields.map(({ label, type }) => ({ label, type })),
    has_levels,
    page_count: r.pageCount ?? r.metadata?.pageCount,
    strategy,
  };
}

export async function templateAdd(p: { path: string; name?: string; category?: string }, signal?: AbortSignal): Promise<TemplateEntry> {
  const analysis = await templateAnalyze(p.path, signal);
  const id = randomUUID().slice(0, 8);
  await mkdir(libDir(), { recursive: true });
  const dest = join(libDir(), `${id}${extname(p.path).toLowerCase()}`);
  await copyFile(p.path, dest);
  const name = p.name?.trim() || stemOf(p.path);
  const entry: StoredEntry = {
    id: `user:${id}`, name, category: p.category?.trim() || guessCategory(name), source: 'user', path: dest, format: analysis.format,
    has_fields: analysis.fields.length > 0, field_count: analysis.fields.length || analysis.label_fields.length,
    description: STRATEGY_TEXT[analysis.strategy], added_at: new Date().toISOString(), analysis,
  };
  await writeIndex([...(await readIndex()), entry]);
  return entry;
}

export async function templateRemove(id: string): Promise<boolean> {
  if (!id.startsWith('user:')) throw new Error('내장 서식은 지울 수 없습니다.');
  const list = await readIndex();
  const hit = list.find((t) => t.id === id);
  if (!hit) return false;
  await unlink(hit.path!).catch(() => undefined);
  await writeIndex(list.filter((t) => t.id !== id));
  return true;
}

/** 빈 값은 빼고, 다 비면 undefined (엔진이 빈 칸을 그리지 않게) */
function compact<T extends Record<string, unknown>>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => (Array.isArray(v) ? v.length : v !== undefined && v !== '')));
  return Object.keys(out).length ? (out as T) : undefined;
}

const SKELETON: Record<GongmunPreset, string> = {
  official: '# (제목을 적으세요)\n\n1. 관련: \n\n2. (내용을 적으세요)\n',
  report: '# (제목을 적으세요)\n\n> (보고 목적을 한 문장으로 적으세요)\n\n## 추진 배경\n\n- (내용)\n\n## 추진 계획\n\n- (내용)\n\n## 행정 사항\n\n- (내용)\n',
  plan: '# (계획 이름을 적으세요)\n\n> (계획 목적을 한 문장으로 적으세요)\n\n## 추진 배경\n\n- (내용)\n\n## 추진 방향\n\n- (내용)\n\n## 세부 추진 계획\n\n- (내용)\n\n## 소요 예산\n\n- (내용)\n',
  notice: '# (제목을 적으세요)\n\n(안내 내용을 적으세요)\n\n- 일시: \n- 장소: \n- 대상: \n- 문의: \n',
  minutes: '# (회의 이름) 회의록\n\n- 일시: \n- 장소: \n- 참석: \n\n## 논의 내용\n\n1. (안건)\n\n## 결정 사항\n\n- (내용)\n',
  gaejosik: '# (보고서 제목을 적으세요)\n\n## 추진 배경\n\n- (내용)\n\n## 추진 현황\n\n- (내용)\n\n## 향후 계획\n\n- (내용)\n',
  press: '# (보도자료 제목을 적으세요)\n\n(첫 문단: 누가·언제·어디서·무엇을 했는지)\n\n(둘째 문단: 자세한 내용)\n',
  ministry: '# (업무보고 제목을 적으세요)\n\n## 추진 실적\n\n- (내용)\n\n## 중점 추진 과제\n\n- (내용)\n',
  bangchim: '# (방침 제목을 적으세요)\n\n> (요약을 적으세요)\n\n## 추진 배경\n\n- (내용)\n\n## 추진 계획\n\n- (내용)\n',
};

export async function templateStarter(p: { preset: string; agency?: string; output_path?: string }): Promise<{ output_path: string }> {
  const preset = presetOf(p.preset);
  const org = getSettings().org;
  const agencyName = p.agency?.trim() || org.agency?.trim();
  const today = gongmunDate();
  const gongmun: GongmunOptions = { preset, ...(agencyName ? { agency: checkAgency(agencyName) } : {}) };
  if (preset === 'official') {
    gongmun.docHead = compact({ org: org.name });
    gongmun.docFoot = orgDocFoot(org);
  } else if (preset === 'press') {
    gongmun.press = compact({ sub: ['(부제를 적으세요)'], contact: compact({ dept: org.dept, manager: org.person, phone: org.phone }) });
  } else if (preset === 'notice') {
    gongmun.noticeHead = compact({ date: today, sender: org.name });
  } else if (preset !== 'minutes') {
    if (preset === 'gaejosik' || preset === 'ministry') gongmun.cover = compact({ org: org.name, dept: org.dept, date: today }) ?? true;
    const who = [org.dept, org.position, org.person].filter(Boolean).join(' ');
    if (who) gongmun.reportInfo = `(${today}, ${who}${org.phone ? `, ☎${org.phone}` : ''})`;
    if (org.approval_line.length) gongmun.approval = org.approval_line;
  }
  const buf = await markdownToHwpx(SKELETON[preset], { gongmun, warnings: [] });
  const label = PRESETS.find((x) => x.id === preset)?.label ?? preset;
  const outPath = outputFile({ output_path: p.output_path, name: `${label} 시작 서식.hwpx` });
  await writeFile(outPath, Buffer.from(await rhwpCompat(buf)));
  return { output_path: outPath };
}
