/**
 * 3. 출력 — 한글 파일 저장 · PDF · 인쇄 · 도장 찍은 사본 · 공개용 사본 · 붙임 합본 PDF.
 * 비워 둔 누름틀의 안내 글자는 인쇄·PDF 에 찍히므로, 내보내기 전에 지울지 묻는다(한 문서에 한 번, 답은 기억).
 * 묻는 것·저장 창은 작업을 시작하기 전에 끝낸다(뒤에서 진행 표시가 돌지 않게).
 * PDF·인쇄·사본은 한글 파일 저장을 요구하지 않는다: 지금 편집기 내용을 작업 사본으로 써서 만든다(session.outputFile).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Combine, EyeOff, FilePlus2, FileText, FolderOpen, Printer, Save, Stamp } from "lucide-react";
import { useApp } from "../../state/app";
import { useCreate, visibleField } from "./session";
import { rpc } from "../../lib/rpc";
import { pickFiles, pickSavePath } from "../../lib/native";
import { formatOf, joinPath, stem } from "../../lib/format";
import { firstPage, previewOf, RhwpPreview } from "../../lib/rhwp-preview";
import { useTask } from "../../hooks/useTask";
import type { PagePreview, RedactResult } from "../../lib/contract";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Check, SelectField } from "../common/Field";
import { ErrorLine, Note, SavedFile, Working } from "../common/Status";
import { OrderList } from "../common/OrderList";
import { RULES } from "../workbench/tools/RedactTool";

type GuideAnswer = "clear" | "keep" | "cancel";
/** 작업 전에 정한 것 — 지울 빈칸 이름들 */
interface Prep { clear: string[] }

function Row({ mark, title, desc, children }: { mark: string; title: string; desc: string; children: ReactNode }) {
  return (
    <section className="kd-out-row">
      <span className="kd-section-mark">{mark}</span>
      <div className="min-w-0 flex-1">
        <h3 className="kd-row-title">{title}</h3>
        <p className="kd-row-desc">{desc}</p>
        <div className="mt-3 flex flex-col gap-2.5">{children}</div>
      </div>
    </section>
  );
}

export function OutputStep({ active }: { active: boolean }) {
  const { settings, go } = useApp();
  const { session, editorState, docSeq, call, saveTo, outputFile, saveDir, syncDirty, suggestedName } = useCreate();
  const [fileName, setFileName] = useState("");
  const [ask, setAsk] = useState<{ count: number; resolve: (a: GuideAnswer) => void } | null>(null);
  const [attach, setAttach] = useState<string[]>([]);
  const [watermark, setWatermark] = useState("");
  const [pageNums, setPageNums] = useState(true);
  const [thumb, setThumb] = useState<PagePreview | null>(null);
  const save = useTask<string>();
  const pdf = useTask<string>();
  const print = useTask<string>();
  const seal = useTask<{ output_path: string; placed: number }>();
  const redact = useTask<RedactResult>();
  const bundle = useTask<{ output_path: string; page_count: number }>();
  const lastSession = useRef("");
  /** 안내 글자 질문의 답 — 편집기에 같은 문서가 열려 있는 동안(docSeq) 다시 묻지 않는다 */
  const guideAnswer = useRef<{ seq: number; answer: "clear" | "keep" } | null>(null);
  const ready = editorState === "ready";
  const [printers, setPrinters] = useState<Array<{ name: string; isDefault: boolean }> | null>(null);
  const [printer, setPrinter] = useState("");

  // 프린터 목록은 출력 단계를 처음 열 때 한 번
  useEffect(() => {
    if (!active || printers) return;
    rpc("list_printers", {}).then((list) => {
      setPrinters(list);
      setPrinter(list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? "");
    }).catch(() => setPrinters([]));
  }, [active, printers]);

  useEffect(() => {
    if (session && session.path !== lastSession.current) { lastSession.current = session.path; setFileName(suggestedName); }
  }, [session, suggestedName]);

  // 다른 문서를 열면 앞 문서의 저장·PDF 결과를 지운다 (새 문서 결과로 잘못 읽히지 않게)
  const seenSeq = useRef(docSeq);
  useEffect(() => {
    if (docSeq === seenSeq.current) return;
    seenSeq.current = docSeq;
    for (const t of [save, pdf, print, seal, redact, bundle]) t.reset();
    setAttach([]);
    // 문서가 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docSeq]);

  // 들어올 때 고친 게 있는지 편집기에 직접 묻는다 (편집 화면을 떠나면 주기 확인이 멈춘다)
  useEffect(() => {
    if (active) void syncDirty();
    // 출력 단계에 들어올 때마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 저장된 그대로일 때 첫 쪽 그림 — 한글 문서는 rhwp(편집기·PDF 와 같은 조판), 안 되면 엔진 렌더.
  // 편집기가 열려 있으면 편집기 내용을 그대로 그린다(방금 지운 안내 글자까지 맞게)
  useEffect(() => {
    if (!active || !session || session.dirty) return;
    let cancelled = false;
    const fromEditor = async (): Promise<PagePreview | null> => {
      const { bytes } = await call("export", { format: "hwpx" });
      const p = new RhwpPreview();
      try {
        const meta = await p.open(await previewOf(new Uint8Array(bytes)));
        return { page: 1, width: meta.sizes[0], height: meta.sizes[1], data_url: URL.createObjectURL(await p.render(0)) };
      } finally {
        p.dispose();
      }
    };
    const fromFile = () => firstPage(session.path, formatOf(session.path));
    (ready ? fromEditor().catch(fromFile) : fromFile()).then((p) => {
      if (cancelled) { if (p?.data_url.startsWith("blob:")) URL.revokeObjectURL(p.data_url); return; }
      setThumb(p);
    }).catch(() => { if (!cancelled) setThumb(null); });
    return () => { cancelled = true; };
  }, [active, session, ready, call]);

  // 바뀐 첫 쪽 그림의 Blob 주소는 놓아 준다
  useEffect(() => () => { if (thumb?.data_url.startsWith("blob:")) URL.revokeObjectURL(thumb.data_url); }, [thumb]);

  /** 빈 누름틀 안내 글자를 지울지 먼저 묻는다 (작업 시작 전) — 지울 칸 이름들, 취소면 null */
  const askGuides = async (): Promise<Prep | null> => {
    if (!ready) return { clear: [] };
    const names = (await call("fields", {})).names.filter(visibleField);
    if (!names.length) return { clear: [] };
    const vals = (await call("get_fields", { names })).values;
    // 이미 지운 칸(공백 한 칸)은 빼고 센다
    const empty = names.filter((n) => vals[n] !== " " && !(vals[n] ?? "").trim());
    if (!empty.length) return { clear: [] };
    let answer: GuideAnswer;
    if (guideAnswer.current?.seq === docSeq) answer = guideAnswer.current.answer;
    else {
      answer = await new Promise<GuideAnswer>((resolve) => setAsk({ count: empty.length, resolve }));
      setAsk(null);
      if (answer !== "cancel") guideAnswer.current = { seq: docSeq, answer };
    }
    if (answer === "cancel") return null;
    return { clear: answer === "clear" ? empty : [] };
  };

  /** 정한 대로 안내 글자를 지운다 (작업 안에서) */
  const applyGuides = async (p: Prep) => {
    if (p.clear.length) await call("put_fields", { values: Object.fromEntries(p.clear.map((n) => [n, " "])) });
  };

  /** 출력에 쓸 최신 파일 — 안내 글자 정리 뒤 지금 내용 (한글 파일 저장 창 없음) */
  const latest = async (p: Prep) => {
    await applyGuides(p);
    return outputFile();
  };

  const name = (fileName || stem(session?.name ?? "문서")).trim();
  const near = session ? (settings?.convert.output_dir || saveDir) : "";
  /** 저장 창 — 처음 위치는 출력 폴더 또는 사용자 파일 옆 (작업 사본 폴더가 아니다) */
  const askTarget = (file: string, filter: { name: string; extensions: string[] }) => pickSavePath(near ? joinPath(near, file) : file, [filter]);

  const saveAs = (format: "hwp" | "hwpx") => void (async () => {
    const p = await askGuides();
    if (!p) return;
    const target = await askTarget(`${name}.${format}`, { name: format === "hwp" ? "HWP 문서" : "HWPX 문서", extensions: [format] });
    if (!target) return;
    void save.run(async () => {
      await applyGuides(p);
      return saveTo(target, format);
    });
  })();

  // PDF·인쇄는 편집기가 열려 있어도 엔진으로 — 편집기 안의 브라우저 인쇄 창·팝업은 앱 창(WebView)에서 뜨지 않을 수 있다.
  // 엔진도 같은 rhwp 조판으로 그려서 결과 모양은 같다.
  const toPdf = () => void (async () => {
    const p = await askGuides();
    if (!p) return;
    const target = await askTarget(`${name}.pdf`, { name: "PDF", extensions: ["pdf"] });
    if (!target) return;
    void pdf.run(async ({ signal }) => {
      const path = await latest(p);
      return (await rpc("export_pdf", { path, output_path: target, overwrite: true }, { signal })).output_path;
    });
  })();

  const doPrint = () => void (async () => {
    const p = await askGuides();
    if (!p) return;
    void print.run(async () => {
      const path = await latest(p);
      const r = await rpc("print_files", { files: [path], ...(printer ? { printer } : {}) });
      if (r.failed.length) throw new Error(r.failed[0].reason);
      return printer || "기본 프린터";
    });
  })();

  /** 사본 저장 자리 — 출력 폴더·사용자 파일 옆이 있으면 거기(같은 이름은 (2)), 초안이면 저장 창 */
  const copyTarget = async (suffix: string, ext: string) => (near ? joinPath(near, `${name}_${suffix}.${ext}`) : askTarget(`${name}_${suffix}.${ext}`, { name: ext.toUpperCase(), extensions: [ext] }));

  const doSeal = () => void (async () => {
    const p = await askGuides();
    if (!p) return;
    const target = await copyTarget("날인", "hwpx");
    if (!target) return;
    void seal.run(async () => {
      const path = await latest(p);
      if (!path.toLowerCase().endsWith(".hwpx")) throw new Error("도장은 HWPX 문서에 찍습니다. 위에서 HWPX로 저장한 뒤 그 파일로 다시 누르세요.");
      return rpc("seal", { path, image_path: sealImage, anchor: "(인)", output_path: target });
    });
  })();

  const doRedact = () => void (async () => {
    const p = await askGuides();
    if (!p) return;
    const ext = session?.format ?? "hwpx";
    const target = near ? null : await askTarget(`${name}_공개용.${ext}`, { name: ext.toUpperCase(), extensions: [ext] });
    if (!near && !target) return;
    void redact.run(async () => {
      const path = await latest(p);
      return rpc("redact", { path, rules: RULES.filter((r) => r.on).map((r) => r.id), ...(target ? { output_path: target } : { output_dir: near }) });
    });
  })();

  const doBundle = () => void (async () => {
    const p = await askGuides();
    if (!p) return;
    const target = await askTarget(`${name}_합본.pdf`, { name: "PDF", extensions: ["pdf"] });
    if (!target) return;
    void bundle.run(async ({ signal }) => {
      const path = await latest(p);
      return rpc("bundle_pdf", { paths: [path, ...attach], output_path: target, page_numbers: pageNums, ...(watermark ? { watermark } : {}) }, { signal });
    });
  })();

  /** 작업 사본만 있는 초안이면 한글 파일도 저장하라고 권한다 */
  const keepHangul = session?.working && !save.result && (
    <div className="flex flex-wrap items-center gap-2">
      <span className="kd-small kd-muted">한글 파일은 아직 저장하지 않았습니다.</span>
      <Button variant="secondary" size="sm" onClick={() => saveAs("hwpx")}><Save size={13} /> 한글 파일도 저장</Button>
    </div>
  );

  const sealImage = settings?.org.seal_image ?? "";

  return (
    <div className="kd-output">
      <div className="kd-output-main">
        {!session ? <Note tone="info">아직 만든 문서가 없습니다. 작성 단계에서 시작점을 고르세요.</Note> : (
          <>
            <div className="kd-field">
              <label className="kd-label" htmlFor="out-name">파일 이름</label>
              <input id="out-name" className="kd-input" value={fileName} onChange={(e) => setFileName(e.target.value)} />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="kd-small kd-muted">이름 규칙 제안</span>
                {[suggestedName, stem(session.name)].filter((s, i, a) => s && a.indexOf(s) === i).map((s) => (
                  <button key={s} type="button" className="kd-chip" aria-pressed={fileName === s} onClick={() => setFileName(s)}>{s}</button>
                ))}
              </div>
              <p className="kd-field-hint">날짜_부서_제목 순서로 지으면 나중에 찾기 쉽습니다. 부서는 내 기관 정보에서 가져옵니다.</p>
            </div>

            <Row mark="가." title="한글 파일로 저장" desc="받는 곳이 옛 한글을 쓰면 HWP, 그 밖에는 HWPX를 권합니다.">
              {save.busy ? <Working label="저장하는 중" /> : (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => saveAs("hwpx")}><Save size={14} /> HWPX로 저장</Button>
                  <Button variant="secondary" onClick={() => saveAs("hwp")}><Save size={14} /> HWP로 저장</Button>
                </div>
              )}
              <ErrorLine message={save.error} />
              {save.result && <SavedFile path={save.result} />}
            </Row>

            <Row mark="나." title="PDF로 저장" desc="지금 편집기 내용을 편집기와 같은 조판으로 PDF를 만듭니다. 한글 파일을 따로 저장하지 않아도 됩니다.">
              {pdf.busy ? <Working label="PDF를 만드는 중" onCancel={pdf.cancel} /> : <div><Button variant="secondary" onClick={toPdf}><FileText size={14} /> PDF로 저장</Button></div>}
              <ErrorLine message={pdf.error} />
              {pdf.result && <SavedFile path={pdf.result} />}
              {pdf.result && keepHangul}
            </Row>

            <Row mark="다." title="인쇄" desc="고른 프린터로 한 부를 바로 보냅니다. 여러 부·양면은 PDF로 저장해 열어서 인쇄하세요.">
              {printers && !printers.length ? <Note tone="info">이 PC에 연결된 프린터가 없습니다.</Note> : print.busy ? <Working label="인쇄를 준비하는 중" /> : (
                <div className="flex flex-wrap items-end gap-2">
                  {printers && printers.length > 1 && (
                    <div style={{ width: 240 }}>
                      <SelectField label="프린터" value={printer} onChange={setPrinter} options={printers.map((p) => ({ value: p.name, label: p.isDefault ? `${p.name} (기본)` : p.name }))} />
                    </div>
                  )}
                  <Button variant="secondary" disabled={!printers} onClick={doPrint}><Printer size={14} /> 인쇄</Button>
                </div>
              )}
              <ErrorLine message={print.error} />
              {print.result && <Note tone="ok">인쇄를 보냈습니다: {print.result}</Note>}
            </Row>

            <Row mark="라." title="도장 찍은 사본" desc="문서의 (인) 자리에 관인이나 서명 그림을 찍은 사본을 만듭니다.">
              {!sealImage ? (
                <Note tone="info">관인·서명 그림이 없습니다. <button type="button" className="kd-link" onClick={() => go("settings")}>내 기관 정보</button>에서 그림을 등록하세요.</Note>
              ) : seal.busy ? <Working label="도장을 찍는 중" /> : (
                <div><Button variant="secondary" onClick={doSeal}><Stamp size={14} /> 도장 찍기</Button></div>
              )}
              <ErrorLine message={seal.error} />
              {seal.result && (seal.result.placed > 0 ? <SavedFile path={seal.result.output_path} label={`${seal.result.placed}곳에 찍은 사본을 저장했습니다`} /> : <Note tone="warn">문서에서 (인) 자리를 찾지 못했습니다.</Note>)}
            </Row>

            <Row mark="마." title="공개용 사본" desc="정보공개·누리집 게시용으로 개인정보를 가린 사본을 만들고 남은 곳이 없는지 다시 검사합니다.">
              {redact.busy ? <Working label="개인정보를 가리는 중" /> : (
                <div><Button variant="secondary" onClick={doRedact}><EyeOff size={14} /> 공개용 사본 만들기</Button></div>
              )}
              <ErrorLine message={redact.error} />
              {redact.result?.output_path && (
                <>
                  <SavedFile path={redact.result.output_path} label={`개인정보 ${redact.result.total}건을 가린 사본을 저장했습니다`} />
                  {redact.result.residual > 0 && <Note tone="warn">다시 검사했더니 의심 {redact.result.residual}곳이 남았습니다. 사본을 열어 확인하세요.</Note>}
                </>
              )}
            </Row>

            <Row mark="바." title="붙임 합본 PDF" desc="본문 뒤에 붙임 문서를 순서대로 이어 PDF 한 권으로 만듭니다.">
              <OrderList items={attach} onChange={setAttach} />
              <div className="flex flex-wrap items-end gap-3">
                <Button variant="ghost" size="sm" onClick={() => void pickFiles().then((p) => setAttach([...new Set([...attach, ...p])]))}><FilePlus2 size={13} /> 붙임 추가</Button>
                <div style={{ width: 150 }}>
                  <SelectField label="워터마크" value={watermark} onChange={setWatermark} options={[{ value: "", label: "없음" }, { value: "대외비", label: "대외비" }, { value: "사본", label: "사본" }, { value: "공개용", label: "공개용" }]} />
                </div>
                <Check label="쪽 번호" checked={pageNums} onChange={setPageNums} />
              </div>
              {bundle.busy ? <Working label="합본을 만드는 중" onCancel={bundle.cancel} /> : (
                <div><Button variant="secondary" onClick={doBundle}><Combine size={14} /> 합본 만들기{attach.length ? ` (본문 + 붙임 ${attach.length}건)` : ""}</Button></div>
              )}
              <ErrorLine message={bundle.error} />
              {bundle.result && <SavedFile path={bundle.result.output_path} label={`${bundle.result.page_count}쪽짜리 합본을 저장했습니다`} />}
            </Row>
          </>
        )}
      </div>

      <aside className="kd-output-side" aria-label="지금 문서">
        <h2 className="kd-label">지금 문서</h2>
        {session ? (
          <>
            <p className="kd-h3" style={{ overflowWrap: "anywhere" }}>{session.name}</p>
            <p className="kd-small kd-muted">{session.dirty ? "고친 내용이 아직 저장되지 않았습니다" : session.savedAt ? "저장한 그대로입니다" : session.working ? "만든 초안 그대로입니다" : "연 그대로입니다"}</p>
            {session.working ? (
              <div className="kd-inset flex flex-col gap-2 p-3">
                <p className="kd-small">작업 사본으로 앱 작업 폴더에만 있습니다. 남겨 두려면 한글 파일로도 저장하세요.</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => saveAs("hwpx")}><Save size={13} /> 한글 파일도 저장</Button>
                  <Button variant="ghost" size="sm" onClick={() => void rpc("reveal_file", { path: session.path }).catch(() => undefined)}><FolderOpen size={13} /> 작업 폴더</Button>
                </div>
              </div>
            ) : <p className="kd-path">{session.path}</p>}
            <div className="kd-desk kd-output-thumb">
              {thumb && !session.dirty ? <img className="kd-page" src={thumb.data_url} alt="첫 쪽" /> : <p className="kd-small kd-muted p-4 text-center">저장하면 첫 쪽이 여기에 보입니다</p>}
            </div>
          </>
        ) : <p className="kd-small kd-muted">없음</p>}
      </aside>

      <Modal isOpen={!!ask} title="빈칸 안내 글자" closable={false} size="sm" onClose={() => ask?.resolve("cancel")}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => ask?.resolve("clear")}>지우고 계속</Button>
            <Button variant="secondary" onClick={() => ask?.resolve("keep")}>그대로 두고 계속</Button>
            <Button variant="ghost" onClick={() => ask?.resolve("cancel")}>취소</Button>
          </div>
        )}>
        <p className="kd-text">빈칸 {ask?.count}곳의 안내 글자를 지울까요?</p>
        <p className="kd-small kd-muted mt-2">비워 둔 칸의 회색·빨간 안내 글자가 인쇄와 PDF에 그대로 찍힙니다. 지우면 그 칸을 빈칸으로 둡니다.</p>
        <p className="kd-small kd-muted mt-1">고른 대로 이 문서의 저장·PDF·인쇄에 모두 씁니다.</p>
      </Modal>
    </div>
  );
}

