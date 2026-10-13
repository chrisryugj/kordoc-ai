/** 개인정보 가리기 — 쓰임(정보공개 공개본·번호만) → 미리 찾아보기(dry_run) → 가린 사본 저장 (+ 남은 곳 다시 검사, 안 본 항목 밝히기)
 *
 * 한글 문서는 서식 그대로 가린 사본, PDF·스캔·그림은 개인정보 자리를 검게 칠한 PDF(글자층 없음), 그 밖은 가린 글(.md).
 * 남길 것(기관 대표번호·내 이름)은 설정에서 미리 채운다. 저장하면 가린 사본을 작업대에 열어 바로 보인다.
 */

import { useEffect, useRef, useState } from "react";
import { EyeOff, ScanSearch } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import type { RedactResult, RedactRule } from "../../../lib/contract";
import { rpc } from "../../../lib/rpc";
import { useApp } from "../../../state/app";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { Check, Field } from "../../common/Field";
import { ErrorLine, Note, SavedFile, Working } from "../../common/Status";
import { num } from "../../../lib/format";
import { keepFromSettings } from "./ReviewTool";

export const RULES: Array<{ id: RedactRule; label: string; on: boolean }> = [
  { id: "rrn", label: "주민등록번호", on: true },
  { id: "phone", label: "전화번호", on: true },
  { id: "email", label: "전자우편", on: true },
  { id: "card", label: "카드번호", on: true },
  { id: "account", label: "계좌번호", on: true },
  { id: "passport", label: "여권번호", on: true },
  { id: "driver", label: "운전면허번호", on: true },
  { id: "brn", label: "사업자등록번호", on: true },
  { id: "crn", label: "법인등록번호", on: false },
  { id: "ip", label: "IP 주소", on: false },
  { id: "name", label: "사람 이름", on: false },
  { id: "address", label: "주소", on: false },
];

/** 정보공개 공개본 기준 — 번호형 기본 + 사람 이름·주소 */
export const DISCLOSURE_RULES: RedactRule[] = [...RULES.filter((r) => r.on).map((r) => r.id), "name", "address"];

export const RULE_LABEL = Object.fromEntries(RULES.map((r) => [r.id, r.label])) as Record<RedactRule, string>;

export function RuleChecks({ rules, onChange }: { rules: Set<RedactRule>; onChange: (r: Set<RedactRule>) => void }) {
  return (
    <div className="kd-rulegrid">
      {RULES.map((r) => (
        <Check key={r.id} label={r.label} checked={rules.has(r.id)}
          onChange={(v) => { const next = new Set(rules); if (v) next.add(r.id); else next.delete(r.id); onChange(next); }} />
      ))}
    </div>
  );
}

/** 이번에 보지 않은 개인정보 항목 문장 ("이름·주소는 검사하지 않았습니다.") */
function uncheckedLine(r: RedactResult): string {
  const left = (r.unchecked_rules ?? []).map((id) => (id === "name" ? "이름" : RULE_LABEL[id]));
  const last = left[left.length - 1];
  return last ? ` ${left.join("·")}${hasBatchim(last) ? "은" : "는"} 검사하지 않았습니다.` : "";
}
function hasBatchim(word: string): boolean {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 !== 0;
}

const splitKeep = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter((x) => x.length >= 2);

export function RedactTool({ doc, info, autoPreview }: ToolProps & { autoPreview: number }) {
  const { settings, openDocs } = useApp();
  // 검토 탭의 가리기는 정보공개 공개본이 기본 (이름·주소까지). 번호만 가릴 때는 아래에서 고른다
  const [rules, setRules] = useState<Set<RedactRule>>(() => new Set(DISCLOSURE_RULES));
  const [mask, setMask] = useState("●");
  const [keepText, setKeepText] = useState<string | null>(null);
  const [alsoPdf, setAlsoPdf] = useState(false);
  const preview = useTask<RedactResult>();
  const save = useTask<RedactResult>();
  const lastAuto = useRef(0);
  const savedRef = useRef<HTMLDivElement>(null);
  const keepValue = keepText ?? keepFromSettings(settings?.org).join(", ");

  // 저장 결과(남은 의심 경고 포함)는 패널 아래로 밀려 안 보이기 쉬워 바로 보이는 자리로 올린다
  useEffect(() => {
    if (save.result) savedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [save.result]);

  const fmt = info.format;
  const keeps = fmt === "hwpx" || fmt === "hwp";
  const asPdf = fmt === "pdf" || fmt === "image";
  const params = () => ({ path: doc.path, rules: [...rules], mask_char: mask || "●", keep: splitKeep(keepValue) });
  const runPreview = () => { save.reset(); void preview.run(() => rpc("redact", { ...params(), dry_run: true })); };
  const runSave = () => void save.run(() => rpc("redact", { ...params(), ...(keeps && alsoPdf ? { also_pdf: true } : {}) })).then((r) => {
    // 가린 사본을 작업대에 열어 미리보기로 바로 보인다 (원본 탭은 그대로 남는다)
    if (r?.output_path) openDocs([r.output_path]);
  });

  useEffect(() => {
    if (autoPreview && autoPreview !== lastAuto.current) { lastAuto.current = autoPreview; runPreview(); }
    // 예제 흐름에서 넘어오면 미리 찾아보기까지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPreview]);

  const people = rules.has("name") && rules.has("address");
  const r = preview.result;
  const s = save.result;

  return (
    <div className="flex flex-col gap-4">
      <p className="kd-small kd-muted text-pretty">
        {keeps ? "한글 문서는 서식을 그대로 두고 글자만 가린 사본을 만듭니다."
          : asPdf ? "PDF·스캔·그림은 개인정보 자리를 검게 칠한 PDF를 만듭니다. 글자층을 지워 가린 글이 복사되지 않습니다."
          : "이 형식은 가린 글을 글 파일(.md)로 만듭니다."} 원본은 건드리지 않습니다.
      </p>
      <Field label="쓰임">
        <div className="flex flex-wrap gap-1.5 pb-1">
          <button type="button" className="kd-chip kd-chip-lg" aria-pressed={people}
            onClick={() => { setRules(new Set(DISCLOSURE_RULES)); preview.reset(); }}>
            정보공개 공개본 (이름·주소까지)
          </button>
          <button type="button" className="kd-chip kd-chip-lg" aria-pressed={!people && !rules.has("name") && !rules.has("address")}
            onClick={() => { setRules(new Set(RULES.filter((x) => x.on).map((x) => x.id))); preview.reset(); }}>
            번호만 가리기
          </button>
        </div>
        <span className="kd-small kd-muted text-pretty">
          {people ? "이름·주소는 다 찾지 못하거나 엉뚱한 곳을 가릴 수 있습니다. 가린 사본을 사람이 한 번 더 읽어 확인하세요." : "사람 이름과 주소는 가리지 않습니다. 정보공개 청구 문서라면 정보공개 공개본을 고르세요."}
        </span>
      </Field>
      <Field label="가릴 것">
        <RuleChecks rules={rules} onChange={(n) => { setRules(n); preview.reset(); }} />
      </Field>
      <Field label="남길 것" hint="쉼표로 나눠 적습니다. 설정의 기관 전화·팩스와 내 이름을 미리 넣었습니다.">
        <input className="kd-input" value={keepValue} onChange={(e) => { setKeepText(e.target.value); preview.reset(); }} placeholder="예: 031-000-0000, 김가온" aria-label="남길 것" />
      </Field>
      {!asPdf && (
        <Field label="가림 글자" hint="가린 자리에 넣을 글자 하나">
          <input className="kd-input" style={{ width: 80 }} maxLength={1} value={mask} onChange={(e) => setMask(e.target.value)} aria-label="가림 글자" />
        </Field>
      )}
      {keeps && <Check label="가린 사본을 PDF로도 저장" checked={alsoPdf} onChange={setAlsoPdf} />}

      {preview.busy ? <Working label="개인정보를 찾는 중" /> : (
        <div><Button variant="secondary" onClick={runPreview} disabled={!rules.size}><ScanSearch size={14} /> 미리 찾아보기</Button></div>
      )}
      <ErrorLine message={preview.error} />

      {r && (
        <div className="flex flex-col gap-3">
          {r.total === 0 ? (
            <Note tone={r.residual ? "warn" : "ok"}>
              고른 항목에서 개인정보를 찾지 못했습니다.{uncheckedLine(r)}
              {r.unscanned ? <span className="block mt-0.5">글자를 읽지 못한 곳이 {num(r.unscanned)}곳 있습니다{r.unscanned_pages?.length ? `(${r.unscanned_pages.join("·")}쪽)` : ""}. 그 부분은 직접 확인하세요.</span> : null}
            </Note>
          ) : (
            <table className="kd-table">
              <caption className="kd-label text-left pb-1">찾은 개인정보 {num(r.total)}건{r.kept ? ` (남길 것 ${num(r.kept)}곳은 뺐습니다)` : ""}</caption>
              <thead><tr><th>항목</th><th className="text-right">건수</th><th>보기</th></tr></thead>
              <tbody>
                {r.hits.map((h) => (
                  <tr key={h.rule}><td>{RULE_LABEL[h.rule]}</td><td className="text-right kd-num">{num(h.count)}</td><td className="kd-small text-balance">{h.samples.slice(0, 2).join(", ")}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {r.total > 0 && (save.busy ? <Working label="가린 사본을 만드는 중" progress={save.progress} /> : (
            <div><Button onClick={runSave}><EyeOff size={14} /> 가린 사본 저장</Button></div>
          ))}
        </div>
      )}
      <ErrorLine message={save.error} />
      {s?.output_path && (
        <div ref={savedRef} className="flex flex-col gap-3 kd-redact-saved" role="status">
          {s.residual > 0 && (
            <Note tone="warn">
              <span className="block font-semibold">아직 다 가려지지 않았을 수 있습니다: 의심 {num(s.residual)}곳</span>
              <span className="block mt-0.5">
                {s.unscanned ? `글자를 읽지 못한 곳이 ${num(s.unscanned)}곳${s.unscanned_pages?.length ? `(${s.unscanned_pages.join("·")}쪽)` : ""} 있습니다. ` : ""}
                가린 뒤 다시 검사했더니 개인정보로 보이는 곳이 남았습니다. 작업대에 연 사본을 직접 확인한 뒤 내보내세요.
              </span>
            </Note>
          )}
          <SavedFile path={s.output_path} label={`${num(s.total)}건을 가린 사본을 저장하고 작업대에 열었습니다`} />
          {s.pdf_path && <SavedFile path={s.pdf_path} label="PDF로도 저장했습니다" />}
          {s.residual === 0 && <Note tone="ok">가린 뒤 다시 검사했더니 고른 항목에서 남은 곳이 없습니다.{uncheckedLine(s)}</Note>}
          {s.kept ? <p className="kd-small kd-muted kd-num">남길 것 {num(s.kept)}곳은 가리지 않았습니다.</p> : null}
          {!s.preserved && !asPdf && <Note tone="info">이 형식은 서식을 지킬 수 없어 글 파일(.md)로 저장했습니다.</Note>}
        </div>
      )}
    </div>
  );
}
