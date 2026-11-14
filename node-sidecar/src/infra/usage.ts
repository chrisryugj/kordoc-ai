/** 효과 집계 — 어떤 일을 몇 건 처리했는지 이 PC(앱 데이터 폴더)에만 기록한다
 *
 * 아낀 시간 = 건수 × 기준 시간(분). 기준 시간은 "손으로 할 때 걸리는 시간"의 **가정치**라
 * 화면에 가정임을 밝히고 설정(impact.baselines)에서 기관 실정에 맞게 바꾸게 한다.
 * 밖으로는 아무것도 보내지 않는다.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, getSettings } from './config.js';
import { logger } from './logger.js';
import { renameRetry } from './rename.js';

type Params = Record<string, unknown>;
type Counter = (params: Params, result: unknown) => number;

const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const okCount = (result: unknown) => {
  const r = result as { results?: Array<{ ok?: boolean }> } | undefined;
  return r?.results ? r.results.filter((x) => x.ok).length : 1;
};

/** 집계할 일 — key 는 화면·보고서에 쓰는 이름, baseline 은 손으로 할 때의 가정치(분/단위) */
export const TASKS: Record<string, { key: string; label: string; unit: string; baseline: number; count: Counter }> = {
  generate_hwpx: { key: 'draft', label: '공문서 작성', unit: '건', baseline: 30, count: (p) => (p.preview_only || p.no_usage ? 0 : 1) },
  ai_draft: { key: 'ai_draft', label: 'AI 초안', unit: '건', baseline: 20, count: () => 1 },
  template_fill: { key: 'fill', label: '서식 칸 채우기', unit: '건', baseline: 10, count: () => 1 },
  mail_merge: { key: 'merge_docs', label: '명부로 문서 만들기', unit: '장', baseline: 5, count: (_p, r) => len((r as { outputs?: unknown[] })?.outputs) },
  collect_run: { key: 'collect', label: '문서 수합', unit: '문서', baseline: 5, count: (_p, r) => (r as { rows?: number })?.rows ?? 0 },
  redact: { key: 'redact', label: '개인정보 가리기', unit: '문서', baseline: 15, count: (p) => (p.dry_run ? 0 : 1) },
  redact_batch: { key: 'redact', label: '개인정보 가리기', unit: '문서', baseline: 15, count: (_p, r) => okCount(r) },
  convert: { key: 'convert', label: '문서를 글로 바꾸기', unit: '문서', baseline: 5, count: (p) => (p.save === false ? 0 : 1) },
  convert_batch: { key: 'convert', label: '문서를 글로 바꾸기', unit: '문서', baseline: 5, count: (_p, r) => okCount(r) },
  to_hwpx: { key: 'to_hwpx', label: 'PDF·스캔을 한글로', unit: '문서', baseline: 20, count: () => 1 },
  to_hwpx_batch: { key: 'to_hwpx', label: 'PDF·스캔을 한글로', unit: '문서', baseline: 20, count: (_p, r) => okCount(r) },
  ocr: { key: 'ocr', label: '스캔 읽기(OCR)', unit: '쪽', baseline: 3, count: (_p, r) => (r as { page_count?: number })?.page_count ?? 1 },
  tables_extract: { key: 'tables', label: '표를 엑셀로', unit: '문서', baseline: 10, count: () => 1 },
  // 화면에 띄운 비교만 센다 (같은 비교를 HTML·엑셀로 저장할 때 또 세지 않게)
  compare: { key: 'compare', label: '문서 비교', unit: '건', baseline: 20, count: (p) => (p.export ? 0 : 1) },
  compare_hwpx: { key: 'compare_hwpx', label: '신구대조표 만들기', unit: '건', baseline: 60, count: () => 1 },
  bundle_pdf: { key: 'bundle', label: '결재·공개용 합본 PDF', unit: '파일', baseline: 2, count: (p) => len(p.paths) },
  ai_summarize: { key: 'summary', label: 'AI 요약', unit: '건', baseline: 15, count: () => 1 },
  ai_review: { key: 'review', label: 'K팀장 검토', unit: '건', baseline: 15, count: () => 1 },
  lint: { key: 'lint', label: '표기법 검사', unit: '건', baseline: 10, count: (p) => (p.path ? 1 : 0) },
  ai_extract: { key: 'ai_extract', label: '여러 문서에서 항목 뽑기', unit: '문서', baseline: 5, count: (_p, r) => len((r as { rows?: unknown[] })?.rows) },
  seal: { key: 'seal', label: '도장 찍기', unit: '건', baseline: 3, count: (_p, r) => ((r as { placed?: number })?.placed ? 1 : 0) },
  export_pdf: { key: 'pdf', label: 'PDF로 저장', unit: '문서', baseline: 2, count: () => 1 },
  inbox_add: { key: 'inbox', label: '받은 공문 정리', unit: '문서', baseline: 5, count: (_p, r) => len((r as { items?: unknown[] })?.items) },
  // 저장한 지출조서만 (클립보드 표만 만들 때는 세지 않는다). 영수증 한 장 = 지출조서 한 줄 옮겨 적기
  receipt_report: { key: 'receipt', label: '영수증으로 지출조서', unit: '장', baseline: 5, count: (p, r) => (p.save === false ? 0 : (r as { count?: number })?.count ?? 0) },
  law_check: { key: 'law', label: '법령 근거 확인', unit: '건', baseline: 10, count: (_p, r) => ((r as { checked?: boolean })?.checked ? 1 : 0) },
};

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 이 PC 시각 기준 달 YYYY-MM (UTC 로 자르면 한국은 매달 1일 0~9시 기록이 지난달로 간다) */
const localMonth = (now = new Date()) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
const localDay = (d: Date) => (Number.isNaN(d.getTime()) ? '' : `${localMonth(d)}-${pad2(d.getDate())}`);

interface UsageFile {
  version: 1;
  since: string;
  /** 'YYYY-MM' → key → 건수 */
  months: Record<string, Record<string, number>>;
}

const file = () => join(dataDir(), 'usage.json');
let data: UsageFile | null = null;
let saveTimer: NodeJS.Timeout | null = null;
/** 마지막 저장 뒤 이 엔진이 더한 건수 — 저장할 때 파일의 지금 기록에 얹는다. 앱 엔진과 MCP 엔진이 같은 파일에 저장해서, 통째로 쓰면
 *  서로의 건수를 지웠다(기록 파일을 잠깐 못 읽고 빈 기록으로 시작한 때도 같다) */
let pending: Record<string, Record<string, number>> = {};
/** 기록 지우기 — 다음 저장은 파일과 합치지 않고 비운 기록으로 덮는다 */
let cleared = false;
/** 저장 한 번에 실은 것: 더한 건수, 기록 지우기였는지 */
interface Unsaved { counts: Record<string, Record<string, number>>; cleared: boolean }

function load(): UsageFile {
  if (data) return data;
  try {
    if (existsSync(file())) data = JSON.parse(readFileSync(file(), 'utf-8')) as UsageFile;
  } catch (err) {
    logger.warn(`[usage] 기록 파일을 못 읽어 새로 시작: ${err}`);
  }
  if (!data || data.version !== 1) data = { version: 1, since: new Date().toISOString(), months: {} };
  return data;
}

/** 저장할 기록 — 파일의 지금 기록(다른 엔진이 그사이 저장한 몫 포함)에 이 엔진이 더한 몫을 얹는다. 파일을 못 읽으면(다른 프로세스가 쥠)
 *  null: 이번 저장은 건너뛰고 더한 몫은 다음 저장으로. 깨진 파일·없는 파일은 이 엔진의 기록으로 쓴다.
 *  돌려주는 것은 이번 저장에 실은 몫: 쓰기가 실패하면 keep 으로 되돌린다 */
function mergeDisk(): Unsaved | null {
  if (!data) return { counts: {}, cleared: false };
  if (cleared) {
    cleared = false;
    pending = {};
    return { counts: {}, cleared: true };
  }
  let disk: UsageFile | null = null;
  try {
    if (existsSync(file())) disk = JSON.parse(readFileSync(file(), 'utf-8')) as UsageFile;
  } catch (err) {
    if (!(err instanceof SyntaxError)) return null;
  }
  if (disk?.version === 1) {
    disk.months ??= {};
    for (const [mon, counts] of Object.entries(pending)) {
      const m = (disk.months[mon] ??= {});
      for (const [k, v] of Object.entries(counts)) m[k] = (m[k] ?? 0) + v;
    }
    if (data.since < disk.since) disk.since = data.since;
    data = disk;
  }
  const counts = pending;
  pending = {};
  return { counts, cleared: false };
}

/** 쓰지 못한 몫을 다음 저장으로 넘긴다. 저장 전에 비우기만 하면, 다른 프로그램이 파일을 쥔 순간의 건수가 다음 저장 때 파일 값에 덮여 사라졌다 */
function keep(sent: Unsaved): void {
  for (const [mon, counts] of Object.entries(sent.counts)) {
    const p = (pending[mon] ??= {});
    for (const [k, v] of Object.entries(counts)) p[k] = (p[k] ?? 0) + v;
  }
  if (sent.cleared) cleared = true;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const sent = mergeDisk();
    if (!sent) return;
    try {
      mkdirSync(dataDir(), { recursive: true });
      // 앱 엔진과 MCP 엔진이 같이 저장할 수 있다 — 임시 이름이 같으면 덜 쓴 파일이 바꿔 넣어져 다음 읽기가 기록을 지웠다
      const tmp = `${file()}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(data), 'utf-8');
      await renameRetry(tmp, file());
    } catch (err) {
      keep(sent);
      logger.warn(`[usage] 저장 실패: ${err}`);
    }
  }, 2000);
  saveTimer.unref();
}

/** 미뤄 둔 저장을 기다리지 않고 지금 한다. 엔진이 꺼지는 길에서 부른다 (기록 2초 안에 꺼지면 그 건수가 사라졌다).
 *  시험도 임시 폴더를 지우기 전에 부른다: 2초 뒤 저장이 지운 폴더를 다시 만들지 않게 */
export function flushUsage(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const sent = mergeDisk();
  if (!sent) return;
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(file(), JSON.stringify(data), 'utf-8');
  } catch (err) {
    keep(sent);
    logger.warn(`[usage] 저장 실패: ${err}`);
  }
}

/** 라우터가 성공한 호출마다 부른다 */
export function recordUsage(method: string, params: Params, result: unknown): void {
  const task = TASKS[method];
  if (!task) return;
  const n = task.count(params, result);
  if (!n) return;
  const d = load();
  const month = localMonth();
  const m = (d.months[month] ??= {});
  m[task.key] = (m[task.key] ?? 0) + n;
  const p = (pending[month] ??= {});
  p[task.key] = (p[task.key] ?? 0) + n;
  scheduleSave();
}

/** 이 호출 하나로 아낀 시간(분, 가정치 — 설정 impact.baselines 로 바꿈). 작업 에이전트가 결과 옆에 보인다 */
export function savedMinutes(method: string, params: Params, result: unknown): number {
  const task = TASKS[method];
  if (!task) return 0;
  const n = task.count(params, result);
  if (!n) return 0;
  const custom = getSettings().impact?.baselines ?? {};
  return n * (typeof custom[task.key] === 'number' ? custom[task.key] : task.baseline);
}

export interface UsageItem {
  key: string;
  label: string;
  unit: string;
  count: number;
  /** 손으로 할 때 1단위당 분 (가정치 — 설정에서 바꿈) */
  baseline_min: number;
  saved_min: number;
}

export function usageReport(range: 'month' | 'all' = 'month'): { range: string; since: string; items: UsageItem[]; total_count: number; total_saved_min: number } {
  const d = load();
  const month = localMonth();
  const custom = getSettings().impact?.baselines ?? {};
  const sums = new Map<string, number>();
  for (const [mon, counts] of Object.entries(d.months)) {
    if (range === 'month' && mon !== month) continue;
    for (const [k, v] of Object.entries(counts)) sums.set(k, (sums.get(k) ?? 0) + v);
  }
  const seen = new Set<string>();
  const items: UsageItem[] = [];
  for (const t of Object.values(TASKS)) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    const count = sums.get(t.key) ?? 0;
    const baseline = typeof custom[t.key] === 'number' ? custom[t.key] : t.baseline;
    items.push({ key: t.key, label: t.label, unit: t.unit, count, baseline_min: baseline, saved_min: count * baseline });
  }
  items.sort((a, b) => b.saved_min - a.saved_min);
  return {
    range,
    since: range === 'month' ? `${month}-01` : localDay(new Date(d.since)),
    items,
    total_count: items.reduce((s, i) => s + i.count, 0),
    total_saved_min: items.reduce((s, i) => s + i.saved_min, 0),
  };
}

export async function usageReset(): Promise<void> {
  data = { version: 1, since: new Date().toISOString(), months: {} };
  pending = {};
  cleared = true;
  scheduleSave();
}
