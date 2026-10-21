/**
 * 공문서 만들기 세션 — 단계(작성·편집·출력), 지금 문서, 내장 한글 편집기(rhwp) 연결을 한곳에.
 * 편집기 iframe 은 한 번 붙으면 DOM 안에서 옮기지 않는다(옮기면 편집 상태가 사라짐). 숨길 땐 display:none.
 * 저장은 실제로 파일을 쓴 뒤에만 성공이다. 편집기가 열리는 중이면 저장·출력을 막고(canSave),
 * 고친 게 있는지는 편집기에 직접 묻는다(syncDirty). 편집기가 혼자 지운 dirty 는 믿지 않는다.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorTimeoutError, HwpEditorClient } from "../../lib/hwp-editor";
import type { EditorDocState } from "../../../node-sidecar/src/types/editor-bridge";
import { rpc, errorText } from "../../lib/rpc";
import { b64ToBuffer, bytesToB64, pickSavePath } from "../../lib/native";
import { baseName, dirName, extOf, joinPath, stem, suggestFileName } from "../../lib/format";
import { RHWP_MAX_PAGES } from "../../lib/rhwp-preview";
import { useApp } from "../../state/app";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { onQuitGuard } from "../../lib/quit";

/** 편집기에서 새로 넣은 탭의 폭 — rhwp 가 0 으로 써서 한글에서 붙어 나온다. 편집기가 배치한 대로 잰다. 못 재면 저장은 그대로 */
async function measuredTabs(ed: HwpEditorClient, data_b64: string, format: "hwp" | "hwpx") {
  try {
    const { spots } = await rpc("editor_tab_spots", { data_b64, format });
    if (!spots.length) return [];
    const { result } = await ed.call("agent", { method: "measureTabs", args: [spots] });
    const measures = (result as { tabs: Array<{ width: number; type: number; fill: number } | null> }).tabs;
    return spots.flatMap((spot, i) => (measures[i] ? [{ ...spot, ...measures[i]! }] : []));
  } catch {
    return [];
  }
}

export type Step = "compose" | "edit" | "output";
export type EditorState = "idle" | "starting" | "ready" | "unavailable" | "error";

export interface DocSession {
  /** 디스크에 있는 지금 파일 (불러온 원본·만든 초안·마지막 저장) */
  path: string;
  name: string;
  format: "hwp" | "hwpx";
  title: string;
  dirty: boolean;
  savedAt?: number;
  /** 칸 값을 편집기에서 넣기로 하고 열었는데 아직 못 넣었다 — 디스크 파일엔 그 값이 없다 */
  withFields?: boolean;
  /** path 가 앱의 작업 사본 폴더에 있다 (새로 쓰기에서 만든 초안). 한글 파일로 저장하기 전까지는 거기에만 있다 */
  working?: boolean;
  /** 사용자가 연 기존 문서 (작업대·끌어 놓기) — 단계는 편집·내보내기만 */
  existing?: boolean;
  /** 편집기로 연 원본의 표 — 저장할 때 rhwp 가 빠뜨린 것을 원본에서 되붙인다 (editor_write) */
  token?: string;
  /** HWP 로 저장하면 안 되는 까닭 (추적 기록을 뺄 수 없었던 변경 추적 문서) */
  hwpSaveBlock?: string;
}

/** 새로 쓰기 초안을 둘 작업 사본 경로 (앱 데이터 폴더, 문서 폴더에 쌓이지 않게) */
export const workingFile = async (name: string) => (await rpc("working_path", { name })).path;

const NOT_READY = "한글 편집기가 아직 열리지 않았습니다. 잠시 뒤 다시 시도하세요.";
const FIELDS_LOST = "한글 편집기가 열리지 않아 채운 칸 값을 저장할 수 없습니다. 앱을 다시 켠 뒤 서식을 다시 채우세요.";
const OPEN_FAILED = "한글 편집기가 이 문서를 열지 못해 편집기를 닫았습니다. 고치지 않은 그대로 저장·출력하거나, 문서를 다시 열어 보세요.";
const BIG_STOPPED = "한글 편집기가 2분 안에 이 문서를 열지 못해 멈췄습니다. 고치지 않은 그대로 저장·출력하거나 문서 화면에서 내용을 보세요.";

interface Ask { title: string; body: ReactNode; choices: Array<{ id: string; label: string; variant?: "secondary" | "ghost" }>; resolve: (id: string) => void }

interface CreateValue {
  step: Step;
  setStep: (s: Step) => void;
  session: DocSession | null;
  editorState: EditorState;
  editorError: string;
  docState: EditorDocState | null;
  /** 편집기에 문서를 새로 연 횟수 — 칸 목록 등은 이 값이 바뀔 때 다시 읽는다 */
  docSeq: number;
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  frameSrc: string;
  /** 파일을 편집기로 열고 편집 단계로 (칸 값이 있으면 채워 넣는다) */
  openInEditor: (path: string, opts?: { title?: string; fields?: Record<string, string>; working?: boolean; existing?: boolean }) => Promise<void>;
  call: HwpEditorClient["call"];
  focusEditor: () => void;
  saveTo: (path: string, format?: "hwp" | "hwpx") => Promise<string>;
  /** 저장된 최신 파일 경로 — 고친 게 있으면 저장 대화상자부터 */
  ensureSaved: () => Promise<string | null>;
  /** 출력(PDF·인쇄 등)에 쓸 지금 문서 파일 — 사용자 파일을 덮지 않고 저장 창도 띄우지 않는다.
   *  고친 게 없으면 디스크 파일 그대로, 작업 사본이면 거기에 쓰고, 그 밖엔 작업 사본 폴더에 새 사본 */
  outputFile: () => Promise<string>;
  /** 저장 창이 처음 열릴 폴더 — 사용자 파일이면 그 옆, 초안·서식함 서식이면 설정 출력 폴더(없으면 비움) */
  saveDir: string;
  /** 편집기에 직접 물어 고친 게 있는지 (주기 알림을 기다리지 않는다) */
  syncDirty: () => Promise<boolean>;
  /** 지금 저장·출력할 수 있나 — 편집기가 열리는 중이거나, 못 열려서 디스크 파일이 문서와 다르면 아니다 */
  canSave: boolean;
  /** canSave 가 아닌 까닭 (사용자 문장) */
  saveBlock: string;
  /** 지금 문서 저장: 저장한 적 있으면 그 자리에, 아니면 저장 창부터 (편집 단계 저장 단추·편집기 안 Ctrl/⌘+S) */
  saveCurrent: () => Promise<void>;
  saving: boolean;
  suggestedName: string;
  busyText: string;
}

const Ctx = createContext<CreateValue | null>(null);

export function useCreate(): CreateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("CreateProvider 밖입니다");
  return v;
}

/** 칸 이름 중 kordoc 내부 표지는 숨긴다 */
export const visibleField = (name: string) => !name.startsWith("__kordoc_");

export function CreateProvider({ children }: { children: ReactNode }) {
  const { settings, toast } = useApp();
  const [step, setStep] = useState<Step>("compose");
  const [session, setSession] = useState<DocSession | null>(null);
  const [editorState, setEditorState] = useState<EditorState>("idle");
  const [editorError, setEditorError] = useState("");
  const [docState, setDocState] = useState<EditorDocState | null>(null);
  const [frameSrc, setFrameSrc] = useState("");
  const [busyText, setBusyText] = useState("");
  const [docSeq, setDocSeq] = useState(0);
  const [saving, setSaving] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const client = useRef<HwpEditorClient | null>(null);
  const starting = useRef<Promise<boolean> | null>(null);
  /** 편집기에 문서를 여는 중 — 그동안 편집기 상태는 앞 문서 것이라 믿지 않는다 */
  const opening = useRef(false);
  const savingNow = useRef(false);
  /** 편집기 안 Ctrl/⌘+S 가 부를 최신 저장 함수 (편집기 이벤트 연결은 한 번만 한다) */
  const saveRequest = useRef<() => void>(() => undefined);

  useEffect(() => () => client.current?.destroy(), []);

  const askUser = useCallback((a: Omit<Ask, "resolve">) => new Promise<string>((resolve) => {
    setAsk({ ...a, resolve: (id) => { setAsk(null); resolve(id); } });
  }), []);

  /** 편집기를 내린다 — iframe 을 비워야 스튜디오가 하던 일(큰 문서 열기)을 멈추고 CPU 를 놓는다. 다음에 열 때 다시 띄운다 */
  const stopEditor = useCallback((message: string) => {
    client.current?.destroy();
    client.current = null;
    starting.current = null;
    setFrameSrc("about:blank");
    setDocState(null);
    setEditorError(message);
    setEditorState("error");
  }, []);

  /** 편집기 띄우기 — 쓸 수 없으면(브라우저 미리보기 등) false */
  const ensureEditor = useCallback((): Promise<boolean> => {
    if (starting.current) return starting.current;
    starting.current = (async () => {
      setEditorState("starting");
      try {
        const { host_url } = await rpc("editor_server", {});
        if (!host_url) { setEditorState("unavailable"); return false; }
        for (let i = 0; i < 50 && !frameRef.current; i++) await new Promise((r) => setTimeout(r, 40));
        if (!frameRef.current) throw new Error("편집기 자리를 찾지 못했습니다");
        client.current?.destroy(); // 앞서 실패한 연결이 남아 있으면 정리
        const ed = new HwpEditorClient();
        client.current = ed;
        ed.on((ev) => {
          if (ev.type === "changed") {
            setDocState(ev.state);
            // dirty 는 올리기만 한다. 내리는 건 앱이 저장하거나 새로 열었을 때뿐
            if (ev.state.dirty && !opening.current) setSession((s) => (s && !s.dirty ? { ...s, dirty: true } : s));
          }
          if (ev.type === "save_request") saveRequest.current();
        });
        setFrameSrc(ed.attach(frameRef.current, host_url));
        // 중계 페이지가 끝내 준비 신호를 안 주면(주소 오류 등) 기다리기를 멈춘다
        await Promise.race([
          ed.ready(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("한글 편집기가 열리지 않습니다. 앱을 다시 켜 보세요.")), 45_000)),
        ]);
        await ed.call("chrome", { menu: true, toolbar: true, statusbar: true }).catch(() => undefined);
        setEditorState("ready");
        return true;
      } catch (e) {
        // iframe 도 비운다: 같은 주소가 그대로면 다시 시도할 때 편집기가 다시 뜨지 않는다
        stopEditor(`${errorText(e)} 앱을 다시 켜도 같으면 설정의 엔진 점검을 눌러 보세요.`);
        return false;
      }
    })();
    return starting.current;
  }, [stopEditor]);

  const call = useCallback<HwpEditorClient["call"]>((op, args, transfer) => {
    if (!client.current) return Promise.reject(new Error("한글 편집기가 아직 열리지 않았습니다"));
    return client.current.call(op, args, transfer);
  }, []);

  /** 편집기에 직접 물어 고친 게 있는지 — 주기 알림(1초쯤 늦고, 편집 화면을 떠나면 멈춘다)을 기다리지 않는다 */
  const syncDirty = useCallback(async (): Promise<boolean> => {
    if (!session) return false;
    if (session.dirty || editorState !== "ready" || !client.current || opening.current) return session.dirty;
    const st = await client.current.call("state", {}).catch(() => null);
    if (!st?.dirty) return false;
    setSession((s) => (s && !s.dirty ? { ...s, dirty: true } : s));
    return true;
  }, [session, editorState]);

  const saveTo = useCallback(async (path: string, format?: "hwp" | "hwpx") => {
    const fmt = format ?? (extOf(path) === "hwp" ? "hwp" : "hwpx");
    if (!session) throw new Error("저장할 문서가 없습니다. 작성 단계에서 시작점을 고르세요.");
    const ed = client.current;
    if (editorState === "ready" && ed && !opening.current) {
      if (fmt === "hwp" && session.hwpSaveBlock) throw new Error(session.hwpSaveBlock);
      const before = await ed.call("state", {}).catch(() => null);
      const bytes = await ed.save(fmt);
      const data_b64 = bytesToB64(bytes.buffer as ArrayBuffer);
      const tabs = await measuredTabs(ed, data_b64, fmt);
      // 앱 작업 사본(새로 쓰기 초안)을 다시 쓸 때는 .bak 을 남기지 않는다
      const backup = !(session.working && path === session.path);
      const r = await rpc("editor_write", { path, data_b64, overwrite: true, backup, ...(tabs.length ? { tabs } : {}), ...(session.token ? { token: session.token } : {}) });
      if (r.backup_path) toast(`덮어쓰기 전 파일은 ${baseName(r.backup_path)} 로 남겼습니다`, "info");
      if (r.tails_lost) toast("바탕쪽이나 메모 일부를 옮기지 못했습니다. 한글에서 열어 확인하세요.", "error");
      await ed.call("saved", { name: baseName(r.path) }).catch(() => undefined);
      // 내보낸 뒤에 고친 게 있으면(저장하는 사이 입력) 그건 아직 저장 안 된 것으로 둔다
      const after = before ? await ed.call("state", {}).catch(() => null) : null;
      const editedMeanwhile = !!before && !!after && after.changeSeq !== before.changeSeq;
      // 작업 사본에 쓴 것은 사용자가 저장한 게 아니다 (작업 사본 표시·저장 창 위치를 그대로 둔다)
      setSession((s) => (s ? { ...s, path: r.path, name: baseName(r.path), format: fmt, dirty: editedMeanwhile, ...(s.working && r.path === s.path ? {} : { working: false, savedAt: Date.now() }) } : s));
      return r.path;
    }
    // 편집기가 없거나 못 열렸으면 고칠 수도 없었으니 디스크의 지금 파일이 곧 문서다: 그대로 복사해 쓴다
    if ((editorState === "unavailable" || editorState === "error") && !session.withFields) {
      const src = extOf(session.path);
      if (src !== fmt) throw new Error(`한글 편집기가 열리지 않아 ${fmt.toUpperCase()}로 바꿔 저장할 수 없습니다. ${src.toUpperCase()}로 저장하세요.`);
      const r = path === session.path ? { path } : await rpc("write_file", { path, data_b64: (await rpc("read_file_b64", { path: session.path })).data_b64, overwrite: true });
      setSession((s) => (s ? { ...s, path: r.path, name: baseName(r.path), dirty: false, ...(s.working && r.path === s.path ? {} : { working: false, savedAt: Date.now() }) } : s));
      return r.path;
    }
    throw new Error(editorState === "unavailable" || editorState === "error" ? FIELDS_LOST : NOT_READY);
  }, [session, editorState, toast]);

  const suggestedName = useMemo(
    () => (session ? suggestFileName(session.title, settings?.org.dept ?? "") : ""),
    [session, settings?.org.dept],
  );

  const saveDir = !session ? "" : session.existing || session.savedAt ? dirName(session.path) : settings?.convert.output_dir ?? "";

  const ensureSaved = useCallback(async () => {
    if (!session) return null;
    if (!(await syncDirty()) && session.savedAt) return session.path;
    const name = `${suggestedName || stem(session.name)}.${session.format}`;
    const target = await pickSavePath(saveDir ? joinPath(saveDir, name) : name, [{ name: "한글 문서", extensions: [session.format] }]);
    if (!target) return null;
    return saveTo(target);
  }, [session, suggestedName, saveTo, syncDirty, saveDir]);

  const outputFile = useCallback(async () => {
    if (!session) throw new Error("내보낼 문서가 없습니다. 작성 단계에서 시작점을 고르세요.");
    if (!(await syncDirty())) return session.path;
    if (session.working) return saveTo(session.path);
    // 사용자 파일·서식함 서식은 덮지 않는다: 지금 편집기 내용을 작업 사본으로
    const ed = client.current;
    if (editorState !== "ready" || !ed || opening.current) throw new Error(NOT_READY);
    const target = await workingFile(session.name);
    const r = await rpc("write_file", { path: target, data_b64: bytesToB64((await ed.save(session.format)).buffer as ArrayBuffer), overwrite: true });
    return r.path;
  }, [session, syncDirty, saveTo, editorState]);

  const editorUsable = editorState === "ready" || ((editorState === "unavailable" || editorState === "error") && !session?.withFields);
  const canSave = !!session && !busyText && editorUsable;
  const saveBlock = !session || canSave ? "" : (editorState === "unavailable" || editorState === "error") && !busyText ? FIELDS_LOST : "한글 편집기가 열리면 저장하고 출력할 수 있습니다.";

  const saveCurrent = useCallback(async () => {
    if (!session || savingNow.current) return;
    if (!canSave) { toast(saveBlock, "info"); return; }
    savingNow.current = true;
    setSaving(true);
    try {
      const path = session.savedAt ? await saveTo(session.path) : await ensureSaved();
      if (path) toast("저장했습니다", "success");
    } catch (e) {
      toast(`저장하지 못했습니다: ${errorText(e)}`, "error");
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }, [session, canSave, saveBlock, saveTo, ensureSaved, toast]);
  useEffect(() => { saveRequest.current = () => void saveCurrent(); }, [saveCurrent]);

  /** 고친 내용이 남은 지금 문서를 다른 문서로 바꾸기 전에 묻는다 — 바꿔도 되면 true */
  const settleCurrent = useCallback(async (before = "새 문서를 열기 전에"): Promise<boolean> => {
    if (!session || !(await syncDirty())) return true;
    const a = await askUser({
      title: "저장하지 않은 문서",
      body: <p className="kd-text" style={{ overflowWrap: "anywhere" }}>{session.name}에서 고친 내용이 아직 저장되지 않았습니다. {before} 저장할까요? 버리면 고친 내용은 사라집니다.</p>,
      choices: [{ id: "cancel", label: "취소", variant: "ghost" }, { id: "discard", label: "버리기", variant: "secondary" }, { id: "save", label: "저장" }],
    });
    if (a === "discard") {
      // 버린 문서는 편집기에서도 저장한 것으로 — 나중에 편집기를 내릴 때(열기 시간 초과) 스튜디오가 "사이트를 나가시겠습니까"를 띄우지 않게
      await client.current?.call("saved", { name: "" }).catch(() => undefined);
      return true;
    }
    if (a !== "save") return false;
    try {
      const saved = session.savedAt ? await saveTo(session.path) : await ensureSaved();
      if (saved) toast("저장했습니다", "success");
      return !!saved;
    } catch (e) {
      toast(`저장하지 못했습니다: ${errorText(e)}`, "error");
      return false;
    }
  }, [session, syncDirty, askUser, saveTo, ensureSaved, toast]);

  const openInEditor = useCallback(async (path: string, opts?: { title?: string; fields?: Record<string, string>; working?: boolean; existing?: boolean }) => {
    // 쪽이 아주 많은 문서는 열기 전에 묻는다 (rhwp 는 쪽 수에 따라 여는 시간이 가파르게 는다)
    const pages = await rpc("doc_info", { path }).then((d) => d.page_count ?? 0, () => 0);
    if (pages > RHWP_MAX_PAGES && (await askUser({
      title: "쪽이 아주 많은 문서",
      body: <p className="kd-text">이 문서는 {pages.toLocaleString("ko-KR")}쪽입니다. 한글 편집기로 열면 오래 걸릴 수 있고, 2분 안에 열리지 않으면 멈춥니다. 내용만 보려면 문서 화면에서 여세요.</p>,
      choices: [{ id: "cancel", label: "취소", variant: "ghost" }, { id: "open", label: "그래도 열기" }],
    })) !== "open") return;
    if (!(await settleCurrent())) return;
    const format: "hwp" | "hwpx" = extOf(path) === "hwp" ? "hwp" : "hwpx";
    const fields = opts?.fields && Object.keys(opts.fields).length ? opts.fields : null;
    opening.current = true;
    setSession({ path, name: baseName(path), format, title: opts?.title ?? stem(path), dirty: false, ...(fields ? { withFields: true } : {}), ...(opts?.working ? { working: true } : {}), ...(opts?.existing ? { existing: true } : {}) });
    setStep("edit");
    setBusyText("한글 편집기를 여는 중");
    // 편집기에 이 문서가 실제로 들어갔는지 — 못 들어갔는데 편집기를 그대로 두면 앞 문서 내용이 이 경로로 저장된다
    let loaded = false;
    try {
      if (!(await ensureEditor())) return;
      const ed = client.current!;
      const file = await rpc("editor_open", { path });
      setSession((s) => (s && s.path === path ? { ...s, token: file.token, ...(file.save_blocked ? { hwpSaveBlock: file.save_blocked } : {}) } : s));
      if (file.tracking_dropped) toast("변경 내용 추적이 든 문서라 지금 내용으로 열었습니다. 저장하면 추적 기록 없이 저장되고, 처음 덮어쓸 때 원본은 .bak 으로 남습니다.", "info");
      if (file.save_blocked) toast(file.save_blocked, "error");
      try {
        await ed.open(new Uint8Array(b64ToBuffer(file.data_b64)), file.name);
      } catch (e) {
        // 제때 못 열면 iframe 을 내려야 편집기가 열기를 멈춘다 (그대로 두면 몇 분씩 CPU 를 쓴다)
        if (e instanceof EditorTimeoutError) { stopEditor(BIG_STOPPED); throw new Error(BIG_STOPPED); }
        throw e;
      }
      loaded = true;
      if (fields) await ed.call("put_fields", { values: fields });
      // 연 뒤 상태를 직접 확인한다 (칸을 넣었으면 디스크 파일과 달라졌다)
      const st = await ed.call("state", {}).catch(() => null);
      setSession((s) => (s && s.path === path ? { ...s, withFields: false, dirty: s.dirty || !!st?.dirty } : s));
      setDocSeq((n) => n + 1);
    } catch (e) {
      if (!loaded && client.current) stopEditor(OPEN_FAILED);
      toast(`문서를 편집기로 열지 못했습니다: ${errorText(e)}`, "error");
    } finally {
      opening.current = false;
      setBusyText("");
    }
  }, [askUser, settleCurrent, ensureEditor, stopEditor, toast]);

  // 트레이 "완전 종료" 전에 편집 중인 문서를 묻는다
  useEffect(() => onQuitGuard(() => settleCurrent("앱을 끄기 전에")), [settleCurrent]);

  const focusEditor = useCallback(() => frameRef.current?.focus(), []);

  const value = useMemo<CreateValue>(() => ({
    step, setStep, session, editorState, editorError, docState, docSeq, frameRef, frameSrc,
    openInEditor, call, focusEditor, saveTo, ensureSaved, outputFile, saveDir, syncDirty, canSave, saveBlock, saveCurrent, saving, suggestedName, busyText,
  }), [step, session, editorState, editorError, docState, docSeq, frameSrc, openInEditor, call, focusEditor, saveTo, ensureSaved, outputFile, saveDir, syncDirty, canSave, saveBlock, saveCurrent, saving, suggestedName, busyText]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal isOpen={!!ask} title={ask?.title ?? ""} closable={false} size="sm" onClose={() => ask?.resolve("cancel")}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            {ask?.choices.map((c) => <Button key={c.id} variant={c.variant} onClick={() => ask.resolve(c.id)}>{c.label}</Button>)}
          </div>
        )}>
        {ask?.body}
      </Modal>
    </Ctx.Provider>
  );
}
