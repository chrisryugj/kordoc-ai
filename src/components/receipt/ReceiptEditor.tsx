/**
 * 영수증 → 지출조서: 읽은 값 표(칸마다 고칠 수 있고, 확실하지 않은 칸은 노란색) → 지출조서 미리보기 → 표 복사·HWPX 저장.
 * 문서 카드(우클릭 "영수증으로 지출조서 만들기")와 여러 파일 한꺼번에(서무 도구) 결과가 같이 쓴다.
 * 미리보기·복사 글은 엔진(receipt_report save:false)이 만든 것 그대로라 저장 파일과 칸이 같다.
 */

import "./receipt.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ClipboardCheck, Copy, FileDown, Sparkles, Trash2 } from "lucide-react";
import type { ReceiptRead, ReceiptRow } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { copyTable } from "../../lib/clipboard";
import { baseName } from "../../lib/format";
import { Button } from "../ui/Button";
import { Note, SavedFile } from "../common/Status";

/** 화면에서 고치는 칸 */
const EDIT = ["date", "vendor", "brn", "purpose", "amount", "payment", "note"] as const;
type EditKey = (typeof EDIT)[number];
const HEAD: Record<EditKey, string> = { date: "지출일자", vendor: "거래처", brn: "사업자등록번호", purpose: "적요(품목)", amount: "금액", payment: "결제", note: "비고" };
const LOW = 0.8;

interface Line {
  key: string;
  path: string;
  page?: number;
  row: ReceiptRow;
  /** 확실하지 않은 칸 (비었거나 신뢰도 낮음) */
  low: Partial<Record<EditKey, boolean>>;
  /** 칸마다 근거 */
  tips: Partial<Record<EditKey, string>>;
  /** 사람이 고친 칸 (AI 제안으로 덮지 않는다) */
  touched: Set<EditKey>;
}

const digits = (s: string) => s.replace(/[^\d]/g, "");
const comma = (s: string) => (digits(s) ? Number(digits(s)).toLocaleString("en-US") : "");

function lineOf(r: ReceiptRead, i: number): Line {
  const f = r.fields;
  const pick = (v?: { value: string }) => v?.value ?? "";
  const row: ReceiptRow = {
    date: pick(f.date), vendor: pick(f.vendor), brn: pick(f.brn), purpose: r.purpose.value, amount: pick(f.total), payment: pick(f.payment), note: "",
    supply: pick(f.supply), vat: pick(f.vat), approval: pick(f.approval), owner: pick(f.owner), address: pick(f.address),
  };
  const src: Partial<Record<EditKey, { value: string; confidence: number; source?: string }>> = {
    date: f.date, vendor: f.vendor, brn: f.brn, purpose: r.purpose, amount: f.total, payment: f.payment,
  };
  const low: Line["low"] = {};
  const tips: Line["tips"] = {};
  for (const k of EDIT) {
    if (k === "note") continue;
    const v = src[k];
    low[k] = !v?.value || v.confidence < LOW;
    tips[k] = !v?.value ? "읽지 못했습니다. 영수증을 보고 적으세요"
      : `읽은 줄: ${v.source ?? ""} · 확실도 ${Math.round(v.confidence * 100)}%${v.confidence < LOW ? ". 영수증과 견줘 확인하세요" : ""}`;
  }
  if (r.items.length) tips.purpose = `${tips.purpose}\n품목: ${r.items.map((it) => `${it.name}${it.amount ? ` ${it.amount.toLocaleString("en-US")}원` : ""}`).join(", ")}`;
  return { key: `${r.path}#${r.page ?? 0}#${i}`, path: r.path, page: r.page, row, low, tips, touched: new Set() };
}

export function ReceiptEditor({ receipts, aiUsed = false, warnings = [], autoCopy = false, outputDir, actions }: {
  receipts: ReceiptRead[];
  aiUsed?: boolean;
  warnings?: string[];
  /** 미리보기가 처음 나오면 표를 클립보드에 넣는다 (카드 창) */
  autoCopy?: boolean;
  /** 저장 폴더 (없으면 설정의 저장 폴더) */
  outputDir?: string;
  /** 아래 단추 줄에 더할 것 (본창에서 열기 등) */
  actions?: ReactNode;
}) {
  const { ai, toast } = useApp();
  const [lines, setLines] = useState<Line[]>(() => receipts.filter((r) => r.ok).map(lineOf));
  const failed = receipts.filter((r) => !r.ok);
  const [preview, setPreview] = useState<{ tsv: string; html: string; total: number; template?: string; warnings: string[] } | null>(null);
  const [copied, setCopied] = useState<"" | "auto" | "manual" | "failed">("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDone, setAiDone] = useState(aiUsed);
  const autoTried = useRef(false);
  const rows = useMemo(() => lines.map((l) => l.row), [lines]);

  // 고칠 때마다 (잠깐 멈추면) 미리보기·복사 글을 다시
  useEffect(() => {
    if (!rows.length) { setPreview(null); return; }
    let stop = false;
    const t = setTimeout(() => {
      rpc("receipt_report", { rows, save: false }).then((r) => { if (!stop) setPreview(r); }, (e) => { if (!stop) toast(errorText(e), "error"); });
    }, 300);
    return () => { stop = true; clearTimeout(t); };
  }, [rows, toast]);

  const copy = useCallback(async (how: "auto" | "manual") => {
    if (!preview) return;
    try {
      await copyTable(preview.tsv, preview.html);
      setCopied(how);
      if (how === "manual") toast("표를 복사했습니다. 한글·엑셀에 붙여 넣으세요", "success");
    } catch {
      setCopied("failed");
      if (how === "manual") toast("클립보드에 넣지 못했습니다. 창을 한 번 누른 뒤 다시 복사하세요", "error");
    }
  }, [preview, toast]);

  useEffect(() => {
    if (!autoCopy || !preview || autoTried.current) return;
    autoTried.current = true;
    void copy("auto");
  }, [autoCopy, preview, copy]);

  const edit = (key: string, k: EditKey, v: string) => {
    setSaved("");
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, row: { ...l.row, [k]: v }, low: { ...l.low, [k]: false }, touched: new Set(l.touched).add(k) } : l)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await rpc("receipt_report", { rows, ...(outputDir ? { output_dir: outputDir } : {}) });
      if (r.output_path) {
        setSaved(r.output_path);
        void rpc("open_file", { path: r.output_path }).catch(() => undefined);
      }
      for (const w of r.warnings) toast(w, "info");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  // 외부 AI 는 누를 때만 (영수증 글을 개인정보를 가린 뒤 보낸다)
  const aiSuggest = async () => {
    setAiBusy(true);
    try {
      const paths = [...new Set(lines.map((l) => l.path))];
      const r = await rpc("receipt_read", { paths, ai: true });
      for (const w of r.warnings) toast(w, "info");
      if (!r.ai_used) return;
      const by = new Map(r.receipts.filter((x) => x.ok).map((x) => [`${x.path}#${x.page ?? 0}`, x.purpose]));
      setLines((ls) => ls.map((l) => {
        const p = by.get(`${l.path}#${l.page ?? 0}`);
        if (!p?.value || l.touched.has("purpose")) return l;
        return { ...l, row: { ...l.row, purpose: p.value }, low: { ...l.low, purpose: true }, tips: { ...l.tips, purpose: "AI 제안입니다. 맞는지 확인하세요" } };
      }));
      setAiDone(true);
      toast("AI가 적요를 제안했습니다. 노란 칸을 확인하세요", "success");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setAiBusy(false);
    }
  };

  const lowCount = lines.reduce((n, l) => n + Object.values(l.low).filter(Boolean).length, 0);

  return (
    <div className="kd-receipt">
      {warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
      {failed.length > 0 && (
        <Note tone="warn">
          <p>읽지 못한 파일 {failed.length}개</p>
          <ul className="kd-small mt-1">{failed.map((f) => <li key={`${f.path}#${f.page ?? 0}`}><b>{baseName(f.path)}</b>: {f.error}</li>)}</ul>
        </Note>
      )}
      {lines.length > 0 && (
        <>
          <div className="kd-receipt-bar">
            <p className="kd-receipt-sum">영수증 {lines.length}장 · 합계 <b className="kd-num">{preview ? preview.total.toLocaleString("en-US") : "…"}원</b></p>
            <p className="kd-small kd-muted">{lowCount ? `노란 칸 ${lowCount}곳은 읽은 값이 확실하지 않습니다. 영수증과 견줘 고치세요.` : "읽은 값을 확인하고 필요하면 칸을 눌러 고치세요."}</p>
          </div>
          <div className="kd-receipt-scroll">
            <table className="kd-receipt-table">
              <thead>
                <tr><th>영수증</th>{EDIT.map((k) => <th key={k} data-k={k}>{HEAD[k]}</th>)}<th aria-label="빼기" /></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td className="kd-receipt-file" title={l.path}>{baseName(l.path)}{l.page ? ` (${l.page}쪽)` : ""}</td>
                    {EDIT.map((k) => (
                      <td key={k} data-k={k}>
                        <input className="kd-receipt-input" data-low={l.low[k] || undefined} value={k === "amount" ? comma(l.row[k] ?? "") : (l.row[k] ?? "")}
                          onChange={(e) => edit(l.key, k, k === "amount" ? digits(e.target.value) : e.target.value)}
                          aria-label={`${baseName(l.path)} ${HEAD[k]}`} title={l.tips[k]} inputMode={k === "amount" ? "numeric" : undefined}
                          placeholder={k === "date" ? "2026-11-04" : k === "note" ? "" : "읽지 못함"} />
                      </td>
                    ))}
                    <td>
                      <button type="button" className="kd-icon-btn" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`${baseName(l.path)} 빼기`}
                        data-tip="이 영수증을 지출조서에서 뺍니다"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="kd-receipt-preview-wrap" aria-label="지출조서 미리보기">
            <h3 className="kd-label">지출조서 미리보기 · {preview?.template ? `기관 서식(${preview.template})` : "기본 서식"}</h3>
            {/* 엔진이 칸 글을 모두 이스케이프한 표 */}
            {preview && <div className="kd-receipt-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />}
          </section>

          {copied === "auto" && <Note tone="ok"><span className="flex items-center gap-1.5"><ClipboardCheck size={15} /> 표를 클립보드에 넣었습니다. 한글·엑셀에서 Ctrl+V로 붙여 넣으세요.</span></Note>}
          {copied === "failed" && <Note tone="info">표를 클립보드에 넣지 못했습니다. 아래 [표 복사]를 누르세요.</Note>}
          {saved && <SavedFile path={saved} label="지출조서를 저장했습니다" />}

          <div className="kd-receipt-actions">
            <Button variant={copied === "failed" ? "primary" : "secondary"} onClick={() => void copy("manual")} disabled={!preview}
              data-tip="한글·워드에는 표로, 엑셀에는 칸마다 붙습니다. 고친 값이 그대로 들어갑니다"><Copy size={14} /> 표 복사</Button>
            <Button onClick={() => void save()} isLoading={saving} disabled={!preview}
              data-tip={preview?.template ? "등록한 기관 서식 사본에 채워 새 HWPX로 저장하고 엽니다. 서식 원본은 그대로입니다" : "지출조서를 새 HWPX로 저장하고 엽니다. 영수증 원본은 그대로입니다"}>
              <FileDown size={14} /> HWPX 저장·열기
            </Button>
            {ai?.configured && ai.is_cloud && !aiDone && (
              <Button variant="ghost" onClick={() => void aiSuggest()} isLoading={aiBusy}
                data-tip="영수증 글의 개인정보를 가린 뒤 외부 AI로 보내 적요 한 줄을 받습니다. 금액·날짜는 바꾸지 않습니다"><Sparkles size={14} /> 외부 AI로 적요 제안</Button>
            )}
            {actions}
          </div>
        </>
      )}
      {!lines.length && !failed.length && <p className="kd-small kd-muted">지출조서에 넣을 영수증이 없습니다.</p>}
    </div>
  );
}
