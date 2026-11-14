/** 개인정보 가림 (redact·redact_batch)
 *
 * HWPX·HWP 는 kordoc CLI `redact --json` — 본문·표·머리말·각주·미리보기·문서 정보까지 같은 길이로 가리고
 * 가린 뒤 다시 검사(잔존)한다. 남길 것(keep: 기관 대표번호·담당 공무원 이름 등)은 가린 사본에서 되살린다.
 * PDF·스캔·그림은 쪽 그림에 검은 상자를 칠한 새 PDF(글자층 없음, ./pdf.ts). 워드·엑셀 등은 원본을 건드리지 않고 가린 Markdown(.md).
 * 결과·로그에는 원본 개인정보를 싣지 않는다 — samples 는 가려진 문자열, 파일 이름 속 개인정보도 가린다.
 */

import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_REDACT_RULES, parse, type RedactHit } from 'kordoc';
import type { BatchItemResult, RedactResult, RedactRule } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { renameRetry } from '../../infra/rename.js';
import { errorText } from '../errors.js';
import { parseDoc } from '../converter/index.js';
import { formatOf } from '../files/format.js';
import { parseCliJson, runKordocCli } from '../kordoc-cli.js';
import { outputDir, outputFile, stemOf } from '../output/index.js';
import { patchDocument } from '../hwpx-tools/index.js';
import { withVersionXml } from '../merge/hwpx-merge.js';
import { exportPdf } from '../export/index.js';
import { imageToPdf, redactPdf } from './pdf.js';
import { pictureNotes, scanPictures, type PictureScan } from './pictures.js';
import { sealPreview } from './preview.js';
import { missedAddressHits, redactMarkdown, redactText } from './rules.js';

export const ALL_RULES: readonly RedactRule[] = ['rrn', 'phone', 'email', 'card', 'account', 'passport', 'driver', 'brn', 'crn', 'ip', 'name', 'address'];
export const RULE_LABELS: Record<RedactRule, string> = {
  rrn: '주민등록번호', phone: '전화번호', email: '전자우편', card: '카드번호', account: '계좌번호', passport: '여권번호',
  driver: '운전면허번호', brn: '사업자등록번호', crn: '법인등록번호', ip: 'IP 주소', name: '사람 이름', address: '주소',
};
/** "가린 뒤 남은 곳 없음"이라 말할 때 함께 밝힐, 이번에 보지 않은 항목 (개인정보 갈래만 — 법인번호·IP 는 개인정보가 아니라 뺀다) */
const PERSONAL: readonly RedactRule[] = ['rrn', 'phone', 'email', 'card', 'account', 'passport', 'driver', 'name', 'address'];

export interface RedactParams {
  path: string;
  rules?: RedactRule[];
  mask_char?: string;
  dry_run?: boolean;
  output_path?: string;
  output_dir?: string;
  /** 가리지 않고 남길 글 (기관 대표번호·담당 공무원 이름 등) — 띄어쓰기·하이픈은 무시하고 비교 */
  keep?: string[];
  /** 한글 문서를 가린 뒤 PDF 로도 저장 */
  also_pdf?: boolean;
  /** 결과 이름 뒷말 (`<이름>_<뒷말>.<확장자>`, 기본 "가림") */
  suffix?: string;
}

interface CliHit { rule: RedactRule; masked: string }
interface CliReport {
  format: string;
  hits: CliHit[];
  fileHits: CliHit[];
  residual: CliHit[];
  unscanned: string[];
  /** 엔진이 검사·가리기를 못 한 것들의 안내 (삽입 그림·삽입 개체·문서 이력·미리보기 그림) */
  warnings?: string[];
  output: string | null;
}

/** 엔진 안내에서 "가렸다고 말하면 안 되는 것"을 센다: 삽입 개체(OLE·EMF)·문서 이력·지우지 못한 미리보기 그림.
 *  이것을 버리면 가리지 못한 것이 있는데 "못 본 곳 0"으로 나간다. 삽입 그림(pictures)은 수만 돌려준다:
 *  그림 속 글자는 scanPictures 가 따로 읽어, 걸리는 글이 있거나 읽지 못한 그림만 알린다 */
export function blindSpots(warnings: readonly string[] = []): { count: number; notes: string[]; pictures: number } {
  const num = (re: RegExp) => warnings.reduce((n, w) => n + Number(re.exec(w)?.[1] ?? 0), 0);
  const pictures = num(/삽입 그림 (\d+)개/);
  const objects = num(/삽입 개체 (\d+)개/);
  const history = warnings.some((w) => /문서 이력/.test(w));
  const preview = warnings.some((w) => /미리보기 이미지.*지우지 못했/.test(w));
  // 파일 안의 빈 자리(옛 판의 글 조각이 남을 수 있다)를 못 비웠거나, 무엇인지 모르는 부품을 검사하지 못했다
  const slack = warnings.some((w) => /미할당 섹터.*비우지 못했/.test(w));
  const unknown = warnings.some((w) => /알 수 없는 바이너리.*검사하지 못했/.test(w));
  const notes: string[] = [];
  if (objects) notes.push(`문서 안 개체 ${objects}개(다른 프로그램으로 넣은 문서·그림)는 가리지 못했습니다.`);
  if (history) notes.push('문서 이력이 들어 있습니다. 이전 판의 글은 조각 단위로만 검사했습니다.');
  if (preview) notes.push('첫 쪽 미리보기 그림을 지우지 못했습니다. 한글에서 다시 저장하면 새로 만들어집니다.');
  if (slack) notes.push('파일 안의 빈 자리를 비우지 못했습니다. 고치기 전 글 조각이 남아 있을 수 있으니, 한글에서 다른 이름으로 저장한 뒤 내보내세요.');
  if (unknown) notes.push('파일 안에 무엇인지 알 수 없는 부품이 있어 검사하지 못했습니다.');
  return { count: objects + (history ? 1 : 0) + (preview ? 1 : 0) + (slack ? 1 : 0) + (unknown ? 1 : 0), notes, pictures };
}

const norm = (s: string) => s.replace(/[\s\-–.()·,]/g, '').toLowerCase();

/** 남길 것인가 — 같은 글이거나(띄어쓰기·하이픈 무시) 남길 글 안에 들어 있으면 */
export function keepMatcher(keep?: string[]): (s: string) => boolean {
  const list = (keep ?? []).map(norm).filter((k) => k.length >= 2);
  if (!list.length) return () => false;
  return (s: string) => {
    const n = norm(s);
    return n.length >= 2 && list.some((k) => k === n || k.includes(n));
  };
}

/** 룰별 건수 + 가려진 견본 (최대 3개) */
function summarize(hits: Array<{ rule: RedactRule; masked: string }>): RedactResult['hits'] {
  const by = new Map<RedactRule, { count: number; samples: Set<string> }>();
  for (const h of hits) {
    const e = by.get(h.rule) ?? { count: 0, samples: new Set<string>() };
    e.count++;
    if (e.samples.size < 3) e.samples.add(h.masked);
    by.set(h.rule, e);
  }
  return [...by].map(([rule, e]) => ({ rule, count: e.count, samples: [...e.samples] }));
}

/** 파일 이름 속 개인정보도 가린다 (예: 홍길동_900101-1234567.hwpx) */
function maskName(name: string, rules: readonly RedactRule[], maskChar: string): string {
  const probe = name.replace(/_/g, ' ');
  const out = [...name];
  const mask = /[*?\\/:"<>|]/.test(maskChar) ? '●' : maskChar;
  for (const h of redactText(probe, { rules, maskChar: mask }).hits) {
    for (let k = 0; k < h.length; k++) if (h.masked[k] !== probe[h.index + k]) out[h.index + k] = mask;
  }
  return out.join('');
}

/** count: 되살리기 패치에 쓰는 출력(views[0])에서 센 수. shared: 남기지 않을 다른 원문도 같은 가린 모양을 가진다 */
interface KeptForm { orig: string; count: number; shared: boolean }

/** 남길 원문 → 가린 모양. views[0] 은 되살리기 패치에 쓰는 출력(keep), 나머지는 엔진(CLI)이 가릴 곳을 찾는 기본 출력:
 *  테두리 없는 틀 표 속 명단처럼 기본 출력에서만 머리글 문맥이 보여 가려지는 이름이 있다. 남길 원문이 둘인 모양은 되살리지 않고,
 *  남기지 않을 원문도 가진 모양(shared)은 통째로 되살리면 그것까지 드러나거나 남의 자리에 남길 글이 들어간다 */
function keptForms(views: readonly string[], rules: readonly RedactRule[], maskChar: string, keep: (s: string) => boolean): Map<string, KeptForm> {
  const forms = new Map<string, KeptForm | null>();
  const shared = new Set<string>();
  views.forEach((markdown, v) => {
    for (const h of redactMarkdown(markdown, { rules, maskChar }).hits) {
      const orig = markdown.slice(h.index, h.index + h.length);
      const cur = forms.get(h.masked);
      if (!keep(orig)) { shared.add(h.masked); continue; }
      if (cur === null) continue;
      if (cur && cur.orig !== orig) forms.set(h.masked, null);
      else forms.set(h.masked, { orig, count: (cur?.count ?? 0) + (v === 0 ? 1 : 0), shared: false });
    }
  });
  return new Map([...forms].flatMap(([m, f]): Array<[string, KeptForm]> => (f ? [[m, { ...f, shared: shared.has(m) }]] : [])));
}

/** 견본 목록에서 남길 것을 뺀다 (그 가린 모양은 남길 원문에서만 나온다 — keptForms 가 확인) */
function dropKept(hits: CliHit[], forms: Map<string, unknown>): CliHit[] {
  return hits.filter((h) => !forms.has(h.masked));
}

const unchecked = (rules: readonly RedactRule[]) => PERSONAL.filter((r) => !rules.includes(r));

/** 가린 사본의 글을 고친 마크다운대로 서식 그대로 바꿔 넣는다 (임시 파일에 쓰고 바꿔치기) */
async function patchInPlace(path: string, markdown: string, format: 'hwp' | 'hwpx'): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}_가림.${format}`);
  try {
    await patchDocument({ path, markdown, output_path: tmp });
    await renameRetry(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function redactHangul(p: RedactParams, rules: readonly RedactRule[], maskChar: string, stem: string, signal?: AbortSignal): Promise<RedactResult> {
  const format = formatOf(p.path) as 'hwp' | 'hwpx';
  const keep = keepMatcher(p.keep);
  // 이름은 엔진(CLI)이 도는 동안 빈 파일로 잡아 둔다(claim): 같은 원본을 둘이 가리면 둘이 같은 이름을 골라, 뒤 작업이 앞 사본을 덮거나
  // 실패해 지우면서 앞 작업의 사본을 지웠다. 엔진이 사본을 안 만들면(가릴 것 없음) 아래에서 잡은 빈 파일을 지운다
  const outPath = p.dry_run ? undefined : outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stem}_${p.suffix || '가림'}.${format}`, claim: true });
  const args = ['redact', p.path, '--json', '--silent', `--rules=${rules.join(',')}`, `--mask-char=${maskChar}`, ...(outPath ? [`--output=${outPath}`] : ['--dry-run'])];
  let report: CliReport;
  try {
    report = parseCliJson<CliReport>(await runKordocCli(args, { signal }), '개인정보를 가리지 못했습니다.');
  } catch (err) {
    if (outPath) await rm(outPath, { force: true }).catch(() => undefined);
    throw err;
  }
  let listed = report.fileHits.length ? report.fileHits : report.hits;
  let keptCount = 0;
  const more: string[] = [];
  let leftover = 0;
  let pdfPath: string | undefined;
  const blind = blindSpots(report.warnings);
  let pics: PictureScan | null = null;
  try {
  if (p.keep?.length) {
    // 되살리기 패치는 keep 출력으로 (틀 표 문서에서 기본 출력은 엔진이 거부). 원본·사본을 같은 출력으로 맞춘다.
    // 같은 가린 모양을 남의 글도 가졌는지는 엔진이 가릴 곳을 찾은 기본 출력에서도 본다
    const buf = await readFile(p.path);
    const orig = await parse(buf, { layoutTables: 'keep' });
    const seen = orig.success ? await parse(buf) : null;
    const forms = orig.success ? keptForms([orig.markdown, ...(seen?.success ? [seen.markdown] : [])], rules, maskChar, keep) : new Map<string, KeptForm>();
    if (orig.success && forms.size) {
      // 남의 글과 같은 모양으로 가려진 것은 찾은 곳에서 빼지 않는다 (빼면 그 사람 것까지 "찾지 못했습니다"로 나온다)
      const own = new Map([...forms].filter(([, f]) => !f.shared));
      listed = dropKept(listed, own);
      keptCount = [...own.values()].reduce((a, f) => a + f.count, 0);
      // 가린 사본에서 남길 글을 되살린다 (본문·표 — 서식 그대로 패치)
      if (report.output && !report.output.toLowerCase().endsWith('.md')) {
        const masked = await parse(await readFile(report.output), { layoutTables: 'keep' });
        if (masked.success) {
          const before = orig.markdown;
          let md = masked.markdown;
          // 사본은 같은 길이로 가려 원본과 글자 자리가 맞는다 → 원본 그 자리가 남길 원문인 곳만 되살린다 (남의 "김●●" 자리에 남길 이름을 넣지 않게).
          // 자리가 안 맞으면(가림 글자가 마크다운 기호라 \ 가 붙는 등) 남길 원문에서만 나오는 모양만 되살리고 나머지는 가린 채로 둔다
          const aligned = md.length === before.length;
          // 가린 모양이 더 긴 가림의 앞부분과 같을 수 있다: 남길 이름 "김민"(김●)을 되살리다 다른 사람의 "김●●"까지 "김민●"로 바꾸면
          // 가린 글에 엉뚱한 글자가 들어간다 → 앞뒤가 가림 글자가 아닌 자리만 되살린다
          const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          let restored = 0;
          let left = 0;
          for (const [form, f] of forms) {
            if (!aligned && f.shared) { left += f.count; continue; }
            md = md.replace(new RegExp(`(?<!${esc(maskChar)})${esc(form)}(?!${esc(maskChar)})`, 'g'), (m: string, at: number) => {
              if (aligned && !before.startsWith(f.orig, at)) return m;
              restored++;
              return f.orig;
            });
          }
          keptCount = restored;
          if (left) more.push(`남길 것 ${left}곳은 다른 글과 같은 모양으로 가려져 가린 채로 두었습니다. 가린 사본에서 직접 고치세요.`);
          if (md !== masked.markdown) await patchInPlace(report.output, md, format);
        }
      }
    }
  }
  // kordoc 주소 규칙이 놓친 도로명·지번 주소(rules.ts): 가린 사본에서 마저 가리고(미리 찾아보기면 원본에서 세기만) 목록에 더한다
  if (rules.includes('address')) {
    const target = report.output ?? p.path;
    const isMd = target.toLowerCase().endsWith('.md');
    const md = isMd ? await readFile(target, 'utf-8') : await parse(await readFile(target), { layoutTables: 'keep' }).then((r) => (r.success ? r.markdown : ''), () => '');
    const extra = missedAddressHits(md, maskChar).filter((h) => !keep(md.slice(h.index, h.index + h.length)));
    if (extra.length) {
      listed = [...listed, ...extra.map((h) => ({ rule: h.rule, masked: h.masked }))];
      // 엔진 규칙에 걸린 것이 없으면 엔진은 사본을 만들지 않는다 → 원본을 복사해 거기서 가린다 (안 그러면 찾았다고만 하고 파일이 없다)
      const fresh = !report.output && Boolean(outPath);
      if (fresh) { await copyFile(p.path, outPath!); report.output = outPath!; }
      if (report.output) {
        let out = md;
        for (const h of extra) out = out.slice(0, h.index) + h.masked + out.slice(h.index + h.length);
        if (isMd) await writeFile(report.output, out, 'utf-8');
        else {
          await patchInPlace(report.output, out, format);
          // 본문 패치는 첫 쪽 미리보기 글·그림을 건드리지 않는다 → 거기 남은 주소를 마저 가린다
          const pairs = extra.map((h) => [md.slice(h.index, h.index + h.length), h.masked] as const);
          const { imageLeft } = await sealPreview(report.output, format, pairs, fresh);
          if (imageLeft) { leftover++; more.push('첫 쪽 미리보기 그림에 주소가 남아 있을 수 있습니다. 한글에서 다시 저장하면 새로 만들어집니다.'); }
          // 본문·표가 아닌 곳(머리말·글상자 등)에 있어 패치가 닿지 않은 주소
          const back = await parse(await readFile(report.output), { layoutTables: 'keep' }).then((r) => (r.success ? r.markdown : ''), () => '');
          const still = missedAddressHits(back, maskChar).filter((h) => !keep(back.slice(h.index, h.index + h.length))).length;
          if (still) { leftover += still; more.push(`주소 ${still}곳은 가리지 못했습니다. 눈으로 확인하세요.`); }
        }
      }
    }
  }
  // 예전 판으로 만든 문서에는 version.xml 이 없다 → 가린 사본에는 넣어 둔다 (엄격한 판독기가 거부하지 않게)
  if (report.output && !p.dry_run && format === 'hwpx') {
    const bytes = new Uint8Array(await readFile(report.output));
    const fixed = await withVersionXml(bytes);
    if (fixed !== bytes) await writeFile(report.output, fixed);
  }
  if (report.output && p.also_pdf && !report.output.toLowerCase().endsWith('.md')) {
    // PDF 를 못 만들어도 가린 한글 사본은 온전하다 → 그것까지 버리지 않고 알리기만 한다
    try {
      pdfPath = (await exportPdf({ path: report.output, output_path: report.output.replace(/\.(hwpx|hwp)$/i, '.pdf') }, signal)).output_path;
    } catch (err) {
      if (signal?.aborted) throw err;
      more.push(`PDF로는 저장하지 못했습니다: ${errorText(err)}`);
    }
  }
  // 엔진이 삽입 그림이 있다고 알리면 그림 속 글자를 읽어 본다 (엔진은 화소를 보지 않는다). 걸리는 글이 없으면 조용히
  pics = blind.pictures ? await scanPictures(p.path, rules, keep, signal) : null;
  // 그림을 읽는 도중의 멈춤은 엔진이 오류 없이 삼키기도 한다 → 멈췄으면 그림을 다 보지 않은 결과를 내지 않는다
  signal?.throwIfAborted();
  } catch (err) {
    // 사본을 만든 뒤의 손질(남길 글 되살리기·주소 마저 가리기)이 실패하거나, PDF 저장·그림 속 글자 읽기 도중에 멈추면 반쯤 가린 사본,
    // 원본을 복사만 한 사본, 그림을 보지 않은 사본이 "가림" 이름으로 폴더에 남는다 → 그 파일(과 PDF)을 지우고 실패를 알린다
    // (가리지 않은 파일을 가린 것으로 알고 내보내지 않게)
    if (report.output && !p.dry_run) await rm(report.output, { force: true }).catch(() => undefined);
    if (outPath) await rm(outPath, { force: true }).catch(() => undefined);
    if (pdfPath) await rm(pdfPath, { force: true }).catch(() => undefined);
    throw err;
  }
  if (outPath && !report.output) await rm(outPath, { force: true }).catch(() => undefined);
  const picNotes = pics ? pictureNotes(pics) : [];
  const notes = [...picNotes, ...blind.notes, ...more];
  const unseen = report.unscanned.length + blind.count + (pics?.unread ?? 0);
  return {
    ...(report.output ? { output_path: report.output } : {}),
    ...(pdfPath ? { pdf_path: pdfPath } : {}),
    hits: summarize(listed),
    total: listed.length,
    residual: report.residual.length + unseen + (pics?.hits ?? 0) + leftover,
    unscanned: unseen,
    ...(notes.length ? { notes } : {}),
    preserved: !report.output || !report.output.toLowerCase().endsWith('.md'),
    unchecked_rules: unchecked(rules),
    ...(keptCount ? { kept: keptCount } : {}),
  };
}

async function redactPdfLike(p: RedactParams, rules: readonly RedactRule[], stem: string, signal?: AbortSignal): Promise<RedactResult> {
  const raw = new Uint8Array(await readFile(p.path));
  const bytes = formatOf(p.path) === 'image' ? await imageToPdf(raw) : raw;
  const r = await redactPdf(bytes, { rules, keep: keepMatcher(p.keep), dryRun: p.dry_run, signal });
  let outPath: string | undefined;
  // 다시 읽어 마저 칠한 곳만 있어도(처음 읽기에서는 0곳) 가린 사본을 만든다: 안 만들면 칠했다고 알리고 파일은 없다
  if (!p.dry_run && r.pdf && (r.hits.length || r.repainted)) {
    outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stem}_${p.suffix || '가림'}.pdf` });
    await writeFile(outPath, r.pdf);
  }
  return {
    ...(outPath ? { output_path: outPath } : {}),
    hits: summarize(r.hits),
    total: r.hits.length,
    residual: r.residual,
    unscanned: r.unscanned.length,
    ...(r.unscanned.length ? { unscanned_pages: r.unscanned } : {}),
    ...(r.notes.length ? { notes: r.notes } : {}),
    preserved: false,
    unchecked_rules: unchecked(rules),
  };
}

export async function redact(p: RedactParams, signal?: AbortSignal): Promise<RedactResult> {
  const rules = p.rules?.length ? p.rules : [...DEFAULT_REDACT_RULES];
  const maskChar = p.mask_char || '●';
  redactText('', { rules, maskChar }); // 마스크 문자·룰 검사 (잘못되면 여기서 오류)
  const format = formatOf(p.path);
  const stem = maskName(stemOf(p.path), rules, maskChar);

  if (format === 'hwp' || format === 'hwpx') return redactHangul(p, rules, maskChar, stem, signal);
  if (format === 'pdf' || format === 'image') return redactPdfLike(p, rules, stem, signal);

  const r = await parseDoc(p.path, { images: false, signal });
  const keep = keepMatcher(p.keep);
  const masked = redactMarkdown(r.markdown, { rules, maskChar });
  const hits = masked.hits.filter((h) => !keep(r.markdown.slice(h.index, h.index + h.length)));
  // 남길 것은 원문으로 되돌린다 (같은 길이라 자리 그대로)
  let text = masked.text;
  for (const h of masked.hits) if (!hits.includes(h)) text = text.slice(0, h.index) + r.markdown.slice(h.index, h.index + h.length) + text.slice(h.index + h.length);
  const residual: RedactHit[] = hits.length ? redactMarkdown(text, { rules, maskChar }).hits.filter((h) => !keep(text.slice(h.index, h.index + h.length))) : [];
  let outPath: string | undefined;
  if (!p.dry_run && hits.length) {
    outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: `${stem}_${p.suffix || '가림'}.md` });
    await writeFile(outPath, text, 'utf-8');
  }
  return { ...(outPath ? { output_path: outPath } : {}), hits: summarize(hits), total: hits.length, residual: residual.length, preserved: false, unchecked_rules: unchecked(rules) };
}

export async function redactBatch(
  p: { paths: string[]; rules?: RedactRule[]; mask_char?: string; output_dir?: string; keep?: string[] },
  signal: AbortSignal,
): Promise<{ results: Array<BatchItemResult & { total?: number; residual?: number }>; output_dir: string }> {
  const results: Array<BatchItemResult & { total?: number; residual?: number }> = [];
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    const step = { current: i + 1, total: p.paths.length, message: `${i + 1}/${p.paths.length} 가리는 중` };
    sendProgress(step);
    try {
      const r = await redact({ path, rules: p.rules, mask_char: p.mask_char, output_dir: p.output_dir, keep: p.keep }, signal);
      results.push({ path, ok: true, output_path: r.output_path, total: r.total, residual: r.residual });
    } catch (err) {
      if (signal.aborted) throw err;
      results.push({ path, ok: false, error: errorText(err) });
    }
    // 끝난 파일마다 결과를 알린다 (멈춰도 화면이 만든 사본과 남은 의심 곳 수를 안다)
    sendProgress({ ...step, item: results[results.length - 1] });
  }
  return { results, output_dir: outputDir({ output_dir: p.output_dir, source: p.paths[0] }) };
}
