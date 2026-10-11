/** 개인정보 — 룰 고르기 → 미리 찾아보기(dry_run) → 가린 사본 저장 (+ 남은 곳 다시 검사) */

import { useEffect, useRef, useState } from "react";
import { EyeOff, ScanSearch } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import type { RedactResult, RedactRule } from "../../../lib/contract";
import { rpc } from "../../../lib/rpc";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { Check, Field } from "../../common/Field";
import { ErrorLine, Note, SavedFile, Working } from "../../common/Status";
import { num } from "../../../lib/format";

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

export function RedactTool({ doc, info, autoPreview }: ToolProps & { autoPreview: number }) {
  const [rules, setRules] = useState<Set<RedactRule>>(() => new Set(RULES.filter((r) => r.on).map((r) => r.id)));
  const [mask, setMask] = useState("●");
  const preview = useTask<RedactResult>();
  const save = useTask<RedactResult>();
  const lastAuto = useRef(0);
  const savedRef = useRef<HTMLDivElement>(null);

  // 저장 결과(남은 의심 경고 포함)는 패널 아래로 밀려 안 보이기 쉬워 바로 보이는 자리로 올린다
  useEffect(() => {
    if (save.result) savedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [save.result]);

  const params = () => ({ path: doc.path, rules: [...rules], mask_char: mask || "●" });
  const runPreview = () => { save.reset(); void preview.run(() => rpc("redact", { ...params(), dry_run: true })); };

  useEffect(() => {
    if (autoPreview && autoPreview !== lastAuto.current) { lastAuto.current = autoPreview; runPreview(); }
    // 예제 흐름에서 넘어오면 미리 찾아보기까지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPreview]);

  const people = rules.has("name") && rules.has("address");
  const keeps = info.format === "hwpx" || info.format === "hwp";
  const r = preview.result;

  return (
    <div className="flex flex-col gap-4">
      <p className="kd-small kd-muted">
        {keeps ? "한글 문서는 서식을 그대로 두고 글자만 가린 사본을 만듭니다." : "이 형식은 가린 글을 글 파일(.md)로 만듭니다."} 원본은 건드리지 않습니다.
      </p>
      <Field label="가릴 것">
        <div className="flex flex-col gap-1.5 pb-1">
          <div>
            <button type="button" className="kd-chip kd-chip-lg" aria-pressed={people}
              onClick={() => {
                const next = new Set(rules);
                for (const id of ["name", "address"] as const) { if (people) next.delete(id); else next.add(id); }
                setRules(next);
                preview.reset();
              }}>
              정보공개용 (이름·주소까지)
            </button>
          </div>
          <span className="kd-small kd-muted">
            {people ? "이름·주소는 자동으로 다 찾지 못하거나 엉뚱한 곳을 가릴 수 있습니다. 가린 사본을 사람이 한 번 더 읽어 확인하세요." : "정보공개 청구 문서처럼 사람 이름과 주소도 가려야 하면 누르세요. 기본은 꺼져 있습니다."}
          </span>
        </div>
        <RuleChecks rules={rules} onChange={(n) => { setRules(n); preview.reset(); }} />
      </Field>
      <Field label="가림 글자" hint="가린 자리에 넣을 글자 하나">
        <input className="kd-input" style={{ width: 80 }} maxLength={1} value={mask} onChange={(e) => setMask(e.target.value)} aria-label="가림 글자" />
      </Field>

      {preview.busy ? <Working label="개인정보를 찾는 중" /> : (
        <Button variant="secondary" onClick={runPreview} disabled={!rules.size}><ScanSearch size={14} /> 미리 찾아보기</Button>
      )}
      <ErrorLine message={preview.error} />

      {r && (
        <div className="flex flex-col gap-3">
          {r.total === 0 ? <Note tone="ok">고른 항목에서 개인정보를 찾지 못했습니다.</Note> : (
            <table className="kd-table">
              <caption className="kd-label text-left pb-1">찾은 개인정보 {num(r.total)}건</caption>
              <thead><tr><th>항목</th><th className="text-right">건수</th><th>보기</th></tr></thead>
              <tbody>
                {r.hits.map((h) => (
                  <tr key={h.rule}><td>{RULE_LABEL[h.rule]}</td><td className="text-right kd-num">{num(h.count)}</td><td className="kd-small">{h.samples.slice(0, 2).join(", ")}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {r.total > 0 && (save.busy ? <Working label="가린 사본을 만드는 중" /> : (
            <Button onClick={() => void save.run(() => rpc("redact", params()))}><EyeOff size={14} /> 가린 사본 저장</Button>
          ))}
        </div>
      )}
      <ErrorLine message={save.error} />
      {save.result?.output_path && (
        <div ref={savedRef} className="flex flex-col gap-3 kd-redact-saved" role="status">
          {save.result.residual > 0 && (
            <Note tone="warn">
              <span className="block font-semibold">아직 다 가려지지 않았을 수 있습니다: 의심 {num(save.result.residual)}곳</span>
              <span className="block mt-0.5">가린 뒤 다시 검사했더니 개인정보로 보이는 곳이 남았습니다. 아래 열기로 사본을 열어 직접 확인한 뒤 내보내세요.</span>
            </Note>
          )}
          <SavedFile path={save.result.output_path} label={`${num(save.result.total)}건을 가린 사본을 저장했습니다`} />
          {save.result.residual === 0 && <Note tone="ok">가린 뒤 다시 검사했더니 남은 곳이 없습니다.</Note>}
          {!save.result.preserved && <Note tone="info">이 형식은 서식을 지킬 수 없어 글 파일(.md)로 저장했습니다.</Note>}
        </div>
      )}
    </div>
  );
}
