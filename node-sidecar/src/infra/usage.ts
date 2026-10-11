/** 효과 집계 — 어떤 일을 몇 건 처리했는지 이 PC(앱 데이터 폴더)에만 기록한다
 *
 * 아낀 시간 = 건수 × 기준 시간(분). 기준 시간은 "손으로 할 때 걸리는 시간"의 **가정치**라
 * 화면에 가정임을 밝히고 설정(impact.baselines)에서 기관 실정에 맞게 바꾸게 한다.
 * 밖으로는 아무것도 보내지 않는다.
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, getSettings } from './config.js';
import { logger } from './logger.js';

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
  collect_run: { key: 'collect', label: '취합', unit: '문서', baseline: 5, count: (_p, r) => (r as { rows?: number })?.rows ?? 0 },
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
  seal: { key: 'seal', label: '도장 찍기', unit: '건', baseline: 3, count: () => 1 },
  export_pdf: { key: 'pdf', label: 'PDF로 내보내기', unit: '문서', baseline: 2, count: () => 1 },
  inbox_add: { key: 'inbox', label: '받은 공문 정리', unit: '문서', baseline: 5, count: (_p, r) => len((r as { items?: unknown[] })?.items) },
  law_check: { key: 'law', label: '법령 근거 확인', unit: '건', baseline: 10, count: (_p, r) => ((r as { checked?: boolean })?.checked ? 1 : 0) },
};

interface UsageFile {
  version: 1;
  since: string;
  /** 'YYYY-MM' → key → 건수 */
  months: Record<string, Record<string, number>>;
}

const file = () => join(dataDir(), 'usage.json');
let data: UsageFile | null = null;
let saveTimer: NodeJS.Timeout | null = null;

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

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      mkdirSync(dataDir(), { recursive: true });
      const tmp = `${file()}.tmp`;
      await writeFile(tmp, JSON.stringify(data), 'utf-8');
      await rename(tmp, file());
    } catch (err) {
      logger.warn(`[usage] 저장 실패: ${err}`);
    }
  }, 2000);
  saveTimer.unref();
}

/** 라우터가 성공한 호출마다 부른다 */
export function recordUsage(method: string, params: Params, result: unknown): void {
  const task = TASKS[method];
  if (!task) return;
  const n = task.count(params, result);
  if (!n) return;
  const d = load();
  const month = new Date().toISOString().slice(0, 7);
  const m = (d.months[month] ??= {});
  m[task.key] = (m[task.key] ?? 0) + n;
  scheduleSave();
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
  const month = new Date().toISOString().slice(0, 7);
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
    since: range === 'month' ? `${month}-01` : d.since.slice(0, 10),
    items,
    total_count: items.reduce((s, i) => s + i.count, 0),
    total_saved_min: items.reduce((s, i) => s + i.saved_min, 0),
  };
}

export async function usageReset(): Promise<void> {
  data = { version: 1, since: new Date().toISOString(), months: {} };
  scheduleSave();
}
