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
import { baseName, num } from "../../../lib/format";
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
  const { settings, openDocs, uiMode, screen, docs, toast } = useApp();
  const where = useRef({ screen, docs });
  where.current = { screen, docs };
  /** 이 패널이 아직 붙어 있나 — 문서를 닫으면 내려가고, where 는 닫기 직전 값(그 문서가 열린 목록)에서 멈춘다 */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const easy = uiMode === "easy";
  // 검토 탭의 가리기는 정보공개 공개본이 기본 (이름·주소까지). 번호만 가릴 때는 아래에서 고른다
  const [rules, setRules] = useState<Set<RedactRule>>(() => new Set(DISCLOSURE_RULES));
  const [mask, setMask] = useState("●");
  /** 가린 사본을 문서 화면에 열었는가 (다른 화면에 가 있었으면 열지 않았다 → 열었다고 적지 않는다) */
  const [opened, setOpened] = useState(true);
  const [keepText, setKeepText] = useState<string | null>(null);
  const [alsoPdf, setAlsoPdf] = useState(false);
  const preview = useTask<RedactResult>();
  const save = useTask<RedactResult>();
  const lastAuto = useRef(0);
  const savedRef = useRef<HTMLDivElement>(null);
  const keepDefault = keepFromSettings(settings?.org).join(", ");
  // 쉬운 화면은 세부 칸(가릴 것·남길 것·가림 글자)을 숨기고 기본값으로 한다
  const keepValue = easy ? keepDefault : keepText ?? keepDefault;

  // 저장 결과(남은 의심 경고 포함)는 패널 아래로 밀려 안 보이기 쉬워 바로 보이는 자리로 올린다
  useEffect(() => {
    if (save.result) savedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [save.result]);

  const fmt = info.format;
  const keeps = fmt === "hwpx" || fmt === "hwp";
  const asPdf = fmt === "pdf" || fmt === "image";
  const params = () => ({ path: doc.path, rules: [...rules], mask_char: (easy ? "" : mask) || "●", keep: splitKeep(keepValue) });
  // 스캔 쪽·그림 속 글자를 읽는 문서는 오래 걸린다 → 진행을 보이고 멈출 수 있게
  const runPreview = () => { save.reset(); void preview.run(({ signal, onProgress }) => rpc("redact", { ...params(), dry_run: true }, { signal, onProgress })); };
  const runSave = () => void save.run(({ signal, onProgress }) => rpc("redact", { ...params(), ...(keeps && alsoPdf ? { also_pdf: true } : {}) }, { signal, onProgress })).then((r) => {
    if (!r?.output_path) return;
    // 가린 사본을 작업대에 열어 미리보기로 바로 보인다 (원본 탭은 그대로 남는다).
    // 오래 걸리는 사이 다른 화면으로 갔거나 이 문서를 닫았으면 끌고 오지 않고 알리기만 한다 (하던 일·저장 안 한 설정을 밀어내지 않게)
    const { screen: now, docs: open } = where.current;
    const here = mounted.current && now === "workbench" && open.some((d) => d.path === doc.path);
    setOpened(here);
    // 사본을 열면 이 패널(원본 문서의 자리)은 가려진다. 남은 의심 곳·엔진 안내가 같이 숨으면 다 끝난 것처럼 보이니 알림으로도 띄운다
    const left = r.residual > 0
      ? `가린 사본에 아직 확인할 곳이 ${num(r.residual)}곳 있습니다. 내보내기 전에 사본을 직접 읽어 확인하세요.`
      : r.notes?.[0] ?? "";
    if (here) {
      openDocs([r.output_path]);
      if (left) toast(left, "error");
    } else if (left) toast(`가린 사본을 저장했습니다(${baseName(r.output_path)}). ${left}`, "error");
    else toast(`가린 사본을 저장했습니다: ${baseName(r.output_path)}`, "success");
  });
  // 찾는 중에 가릴 것을 바꾸면 도는 찾기도 끊는다(reset 이 끊는다). 결과만 비우면 옛 규칙의 표가 떠서, 표에 보인 것과 저장되는 것이 어긋난다
  const changed = () => preview.reset();

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
      <Field label="쓰임">
        <div className="flex flex-wrap gap-1.5 pb-1">
          <button type="button" className="kd-chip kd-chip-lg" aria-pressed={people}
            onClick={() => { setRules(new Set(DISCLOSURE_RULES)); changed(); }}>
            정보공개 공개본 (이름·주소까지)
          </button>
          <button type="button" className="kd-chip kd-chip-lg" aria-pressed={!people && !rules.has("name") && !rules.has("address")}
            onClick={() => { setRules(new Set(RULES.filter((x) => x.on).map((x) => x.id))); changed(); }}>
            번호만 가리기
          </button>
        </div>
        <span className="kd-small kd-muted text-pretty">
          {people ? "이름·주소는 다 찾지 못하거나 엉뚱한 곳을 가릴 수 있습니다. 가린 사본을 사람이 한 번 더 읽어 확인하세요." : "사람 이름과 주소는 가리지 않습니다. 정보공개 청구 문서라면 정보공개 공개본을 고르세요."}
        </span>
      </Field>
      <div className="kd-adv flex flex-col gap-4">
      <Field label="가릴 것">
        <RuleChecks rules={rules} onChange={(n) => { setRules(n); changed(); }} />
      </Field>
      <Field label="남길 것" hint="쉼표로 나눠 적습니다. 설정의 기관 전화·팩스와 내 이름을 미리 넣었습니다.">
        <input className="kd-input" value={keepValue} onChange={(e) => { setKeepText(e.target.value); changed(); }} placeholder="예: 031-000-0000, 김가온" aria-label="남길 것" />
      </Field>
      {!asPdf && (
        <Field label="가림 글자" hint="가린 자리에 넣을 글자 하나">
          <input className="kd-input" style={{ width: 80 }} maxLength={1} value={mask} onChange={(e) => setMask(e.target.value)} aria-label="가림 글자" />
        </Field>
      )}
      </div>
      {keeps && <Check label="가린 사본을 PDF로도 저장" checked={alsoPdf} onChange={setAlsoPdf} />}

      {preview.busy ? <Working label="개인정보를 찾는 중" progress={preview.progress} onCancel={preview.cancel} /> : (
        <div><Button variant="secondary" onClick={runPreview} disabled={!rules.size}
          data-tip={`${keeps ? "서식을 그대로 두고 글자만 가린 사본을 만듭니다." : asPdf ? "개인정보 자리를 검게 칠하고 글자층을 지운 PDF를 만듭니다." : "가린 글을 글 파일(.md)로 만듭니다."} 먼저 찾은 곳을 보여 주고, 원본은 그대로 둡니다.`}><ScanSearch size={14} /> 미리 찾아보기</Button></div>
      )}
      <ErrorLine message={preview.error} />

      {r && (
        <div className="flex flex-col gap-3">
          {r.total === 0 ? (
            <Note tone={r.residual ? "warn" : "ok"}>
              고른 항목에서 개인정보를 찾지 못했습니다.{uncheckedLine(r)}
              {r.unscanned ? <span className="block mt-0.5">글자를 읽지 못한 곳이 {num(r.unscanned)}곳 있습니다{r.unscanned_pages?.length ? `(${r.unscanned_pages.join("·")}쪽)` : ""}. 그 부분은 직접 확인하세요.</span> : null}
              {r.notes?.map((n) => <span key={n} className="block mt-0.5">{n}</span>)}
            </Note>
          ) : (<>
            {r.notes?.length ? <Note tone="warn">{r.notes.map((n) => <span key={n} className="block">{n}</span>)}</Note> : null}
            <table className="kd-table">
              <caption className="kd-label text-left pb-1">찾은 개인정보 {num(r.total)}건{r.kept ? ` (남길 것 ${num(r.kept)}곳은 뺐습니다)` : ""}</caption>
              <thead><tr><th>항목</th><th className="text-right">건수</th><th>보기</th></tr></thead>
              <tbody>
                {r.hits.map((h) => (
                  <tr key={h.rule}><td>{RULE_LABEL[h.rule]}</td><td className="text-right kd-num">{num(h.count)}</td><td className="kd-small text-balance">{h.samples.slice(0, 2).join(", ")}</td></tr>
                ))}
              </tbody>
            </table>
          </>)}
          {/* PDF 는 미리 찾기에서 0곳이어도 확인할 곳(양식 칸·그림 속 글자)이 있으면 가린 사본을 만들 수 있게: 그 글자는 사본을 만들 때 읽어 가린다 */}
          {(r.total > 0 || (asPdf && r.residual > 0 && !r.unscanned)) && (save.busy ? <Working label="가린 사본을 만드는 중" progress={save.progress} onCancel={save.cancel} /> : (
            <div><Button onClick={runSave}><EyeOff size={14} /> 가린 사본 저장</Button></div>
          ))}
        </div>
      )}
      <ErrorLine message={save.error} />
      {/* 사본이 만들어지지 않았으면 그렇다고 알린다 (눌렀는데 아무 일도 없는 것처럼 보이지 않게) */}
      {s && !s.output_path && !save.busy && (
        <Note tone="warn">
          가릴 곳을 찾지 못해 사본을 만들지 않았습니다.
          {s.notes?.map((n) => <span key={n} className="block mt-0.5">{n}</span>)}
          <span className="block mt-0.5">개인정보가 있는데 걸리지 않았다면 원본을 그대로 내보내지 말고 눈으로 확인하세요.</span>
        </Note>
      )}
      {s?.output_path && (
        <div ref={savedRef} className="flex flex-col gap-3 kd-redact-saved" role="status">
          {s.residual > 0 && (
            <Note tone="warn">
              <span className="block font-semibold">아직 다 가려지지 않았을 수 있습니다: 확인할 곳 {num(s.residual)}곳</span>
              {s.notes?.map((n) => <span key={n} className="block mt-0.5">{n}</span>)}
              <span className="block mt-0.5">
                {s.unscanned && !s.notes?.length ? `글자를 읽지 못한 곳이 ${num(s.unscanned)}곳${s.unscanned_pages?.length ? `(${s.unscanned_pages.join("·")}쪽)` : ""} 있습니다. ` : ""}
                {s.unscanned_pages?.length && s.notes?.length ? `${s.unscanned_pages.join("·")}쪽은 글자를 읽지 못했습니다. ` : ""}
                {s.residual > (s.unscanned ?? 0) && !s.notes?.length ? "가린 뒤 다시 검사했더니 개인정보로 보이는 곳이 남았습니다. " : ""}
                {opened ? "문서 화면에 연 사본을" : "저장한 사본을 열어"} 직접 확인한 뒤 내보내세요.
              </span>
            </Note>
          )}
          <SavedFile path={s.output_path} label={`${num(s.total)}건을 가린 사본을 저장${opened ? "하고 문서 화면에 열었습니다" : "했습니다"}`} />
          {s.pdf_path && <SavedFile path={s.pdf_path} label="PDF로도 저장했습니다" />}
          {s.residual === 0 && <Note tone="ok">가린 뒤 다시 검사했더니 고른 항목에서 남은 곳이 없습니다.{uncheckedLine(s)}</Note>}
          {/* 남은 곳이 없어도 엔진이 알릴 것이 있으면 보인다 ("PDF로도 저장"이 안 됐을 때 등) */}
          {s.residual === 0 && s.notes?.map((n) => <Note key={n} tone="warn">{n}</Note>)}
          {s.kept ? <p className="kd-small kd-muted kd-num">남길 것 {num(s.kept)}곳은 가리지 않았습니다.</p> : null}
          {!s.preserved && !asPdf && <Note tone="info">이 형식은 서식을 지킬 수 없어 글 파일(.md)로 저장했습니다.</Note>}
        </div>
      )}
    </div>
  );
}
