/**
 * 공문서 만들기 세션 — 단계(작성·편집·출력), 지금 문서, 내장 한글 편집기(rhwp) 연결을 한곳에.
 * 편집기 iframe 은 한 번 붙으면 DOM 안에서 옮기지 않는다(옮기면 편집 상태가 사라짐). 숨길 땐 display:none.
 * 저장은 실제로 파일을 쓴 뒤에만 성공이다. 편집기가 열리는 중이면 저장·출력을 막고(canSave),
 * 고친 게 있는지는 편집기에 직접 묻는다(syncDirty). 편집기가 혼자 지운 dirty 는 믿지 않는다.
 * 저장하지 않은 문서는 30초마다(입력이 2초 멈췄을 때만) 복구 사본으로 남긴다(recovery_write). 저장하거나 버리면 지운다
 * (출력하느라 작업 사본에만 쓴 것은 저장이 아니다: 사본을 같은 내용으로 새로 쓴다).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorTimeoutError, HwpEditorClient, isPdfInput } from "../../lib/hwp-editor";
import type { EditorDocState } from "../../../node-sidecar/src/types/editor-bridge";
import { rpc, errorText } from "../../lib/rpc";
import { b64ToBuffer, bytesToB64, pickSavePath } from "../../lib/native";
import { baseName, dirName, extOf, joinPath, stem, suggestFileName } from "../../lib/format";
import { RHWP_MAX_PAGES } from "../../lib/rhwp-preview";
import { useApp, type AgentTask } from "../../state/app";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { onQuitGuard } from "../../lib/quit";

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
  /** 고친 내용을 작업 사본에만 써 두었다 (PDF 저장·인쇄·검토를 하려고). dirty 는 내려갔지만 사용자가 저장한 것은 아니다 →
   *  다른 문서를 열거나 앱을 끄기 전에 물어야 한다 (안 물으면 한 시간 고친 초안이 사용자 폴더 어디에도 없이 사라진다) */
  parked?: boolean;
  /** 사용자가 연 기존 문서 (작업대·끌어 놓기) — 단계는 편집·내보내기만 */
  existing?: boolean;
  /** 편집기로 연 원본의 표 — 저장할 때 rhwp 가 빠뜨린 것을 원본에서 되붙인다 (editor_write) */
  token?: string;
}

/** 새로 쓰기 초안을 둘 작업 사본 경로 (앱 데이터 폴더, 문서 폴더에 쌓이지 않게) */
export const workingFile = async (name: string) => (await rpc("working_path", { name })).path;

const NOT_READY = "한글 편집기가 아직 열리지 않았습니다. 잠시 뒤 다시 시도하세요.";
const FIELDS_LOST = "한글 편집기가 열리지 않아 채운 칸 값을 저장할 수 없습니다. 앱을 다시 켠 뒤 서식을 다시 채우세요.";
const OPEN_FAILED = "한글 편집기가 이 문서를 열지 못해 편집기를 닫았습니다. 고치지 않은 그대로 저장·출력하거나, 문서를 다시 열어 보세요.";
const BIG_STOPPED = "한글 편집기가 2분 안에 이 문서를 열지 못해 멈췄습니다. 고치지 않은 그대로 저장·출력하거나 문서 화면에서 내용을 보세요.";
const PDF_STOPPED = "PDF 가져오기가 10분 안에 끝나지 않아 편집기를 닫았습니다. 다시 열어 가져오기 창에서 가져오기를 누르세요.";

export type PendingAgentTask = AgentTask & { seq: number };

type OpenOpts = { title?: string; fields?: Record<string, string>; working?: boolean; existing?: boolean; recover?: boolean; agentTask?: AgentTask };

/** 복구 사본을 쓰는 간격과, 입력이 멈춰야 하는 시간 (치는 중엔 내보내지 않는다) */
const RECOVERY_EVERY_MS = 30_000;
const RECOVERY_IDLE_MS = 2_000;

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
  /** 편집기에 문서를 열기 시작한 횟수 (다 열리기 전에 오른다). 돌던 편집기 AI 는 이때 멈춘다. 저장으로 경로만 바뀐 것과 구분한다 */
  openSeq: number;
  /** 이 문서를 연 뒤 편집기 AI 에 보낼 요청 (보낼 때 takeAgentTask 로 꺼내면 지워진다) */
  agentTask: PendingAgentTask | null;
  takeAgentTask: (seq: number) => PendingAgentTask | null;
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  frameSrc: string;
  /** 파일을 편집기로 열고 편집 단계로 (칸 값이 있으면 채워 넣는다). recover: 그 경로의 복구 사본을 연다.
   *  그 문서가 지금 세션이 됐으면 true (묻기에서 취소했거나 PDF 가져오기를 취소·실패해 이 문서를 세션에 두지 않았으면 false) */
  openInEditor: (path: string, opts?: OpenOpts) => Promise<boolean>;
  call: HwpEditorClient["call"];
  focusEditor: () => void;
  /** overwrite: 저장 창이 덮어쓰기를 확인한 자리인가 (아니면 있는 파일을 덮지 않고 실패로 알린다) */
  saveTo: (path: string, format?: "hwp" | "hwpx", overwrite?: boolean) => Promise<string>;
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
  /** 지금 세션 (열기 도중 앞 문서를 저장했으면 그 뒤 값 — PDF 가져오기를 취소하면 이리로 되돌린다) */
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [editorState, setEditorState] = useState<EditorState>("idle");
  const [editorError, setEditorError] = useState("");
  const [docState, setDocState] = useState<EditorDocState | null>(null);
  const [frameSrc, setFrameSrc] = useState("");
  const [busyText, setBusyText] = useState("");
  const [docSeq, setDocSeq] = useState(0);
  const [openSeq, setOpenSeq] = useState(0);
  /** 열기 준비(쪽 수 확인·묻기) 중 — 그사이 두 번째 열기가 끼어들지 않게 */
  const entering = useRef(false);
  const seqRef = useRef(0);
  // 문서를 다 연 뒤 편집기 AI 에 한 번 보낼 요청 (결재 전 점검 지적 고치기). seq = 그 문서를 연 번호
  const [agentTask, setAgentTask] = useState<PendingAgentTask | null>(null);
  const agentTaskRef = useRef<PendingAgentTask | null>(null);
  const putAgentTask = useCallback((t: PendingAgentTask | null) => { agentTaskRef.current = t; setAgentTask(t); }, []);
  const takeAgentTask = useCallback((seq: number) => {
    const t = agentTaskRef.current;
    if (!t || t.seq !== seq) return null;
    putAgentTask(null);
    return t;
  }, [putAgentTask]);
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
  /** 복구 사본: 마지막 변경 알림 시각 · 마지막으로 사본에 쓴 변경 번호와 시각 */
  const lastChangeAt = useRef(0);
  /** gen: 저장·버리기·새 문서 열기 때마다 +1 — 그 전에 시작한 사본 쓰기는 버린다 (버린 사본이 되살아나지 않게) */
  const recovery = useRef({ seq: -1, at: 0, busy: false, gen: 0 });
  const dropRecovery = useCallback((path: string) => {
    recovery.current.gen++;
    recovery.current.seq = -1;
    void rpc("recovery_discard", { path }).catch(() => undefined);
  }, []);
  /** 작업 사본에만 쓴 초안(parked)의 복구 사본을 같은 내용으로 새로 쓴다 (seq: 그 내용의 변경 번호).
   *  r·gen 은 그 내용을 내보내기 전에 잡은 것: 그 뒤 버리기·저장·다른 문서 열기가 있었으면 쓰지 않는다.
   *  돌던 주기 쓰기(그보다 옛 내용)가 끝난 뒤에 쓴다: 그 쓰기가 나중에 끝나 새 내용을 덮지 않게 */
  const keepRecovery = useCallback(async (r: typeof recovery.current, gen: number, path: string, data_b64: string, title: string, seq?: number) => {
    const same = () => recovery.current === r && r.gen === gen;
    while (r.busy) await new Promise((res) => setTimeout(res, 50));
    if (!same()) return;
    r.busy = true;
    try {
      await rpc("recovery_write", { path, data_b64, title, working: true });
      // 쓰는 사이에 지웠다면 방금 쓴 것도 지운다
      if (!same()) { void rpc("recovery_discard", { path }).catch(() => undefined); return; }
      if (seq !== undefined) r.seq = seq;
      r.at = Date.now();
    } catch {
      // 사본은 덤: 못 써도 앞서 쓴 사본은 남아 있다
    } finally {
      r.busy = false;
    }
  }, []);

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
            lastChangeAt.current = Date.now();
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

  const saveTo = useCallback(async (path: string, format?: "hwp" | "hwpx", overwrite = true) => {
    const fmt = format ?? (extOf(path) === "hwp" ? "hwp" : "hwpx");
    if (!session) throw new Error("저장할 문서가 없습니다. 작성 단계에서 시작점을 고르세요.");
    const ed = client.current;
    if (editorState === "ready" && ed && !opening.current) {
      // 이 문서의 복구 사본 상태 (내보내는 사이 다른 문서를 열면 바뀐다)
      const rec = recovery.current;
      const recGen = rec.gen;
      const before = await ed.call("state", {}).catch(() => null);
      const bytes = await ed.save(fmt);
      const data_b64 = bytesToB64(bytes.buffer as ArrayBuffer);
      // 앱 작업 사본(새로 쓰기 초안)을 다시 쓸 때는 .bak 을 남기지 않는다
      const backup = !(session.working && path === session.path);
      const r = await rpc("editor_write", { path, data_b64, overwrite, backup, ...(session.token ? { token: session.token } : {}) });
      if (r.backup_path) toast(`덮어쓰기 전 파일을 ${baseName(r.backup_path)} 이름으로 남겼습니다`, "info");
      if (r.tails_lost) toast("바탕쪽이나 메모 일부를 옮기지 못했습니다. 한글에서 열어 확인하세요.", "error");
      await ed.call("saved", { name: baseName(r.path) }).catch(() => undefined);
      // 내보낸 뒤에 고친 게 있으면(저장하는 사이 입력) 그건 아직 저장 안 된 것으로 둔다
      const after = before ? await ed.call("state", {}).catch(() => null) : null;
      const editedMeanwhile = !!before && !!after && after.changeSeq !== before.changeSeq;
      // 작업 사본(새로 쓰기 초안)에 쓴 것은 사용자가 저장한 게 아니다: 복구 사본을 지우지 않고 같은 내용으로 새로 쓴다.
      // 지우면 그 뒤 PC 가 꺼졌을 때 홈 "저장하지 않고 꺼진 문서"에 안 보이고, 초안은 숨은 작업 사본 폴더에만 있다가 14일 뒤 지워진다.
      // 사용자 자리에 저장했으면 디스크에 지금 내용이 있으니 사본은 지운다 (저장하는 사이 고친 것은 다음 차례에 다시 쓴다)
      if (session.working && r.path === session.path) void keepRecovery(rec, recGen, session.path, data_b64, session.title, before?.changeSeq);
      else dropRecovery(session.path);
      // 작업 사본에 쓴 것은 사용자가 저장한 게 아니다 (작업 사본 표시·저장 창 위치를 그대로 둔다)
      setSession((s) => (s ? { ...s, path: r.path, name: baseName(r.path), format: fmt, dirty: editedMeanwhile, ...(s.working && r.path === s.path ? { parked: true } : { working: false, parked: false, savedAt: Date.now() }) } : s));
      return r.path;
    }
    // 편집기가 없거나 못 열렸으면 고칠 수도 없었으니 디스크의 지금 파일이 곧 문서다: 그대로 복사해 쓴다
    if ((editorState === "unavailable" || editorState === "error") && !session.withFields) {
      const src = extOf(session.path);
      if (src !== fmt) throw new Error(`한글 편집기가 열리지 않아 ${fmt.toUpperCase()}로 바꿔 저장할 수 없습니다. ${src.toUpperCase()}로 저장하세요.`);
      const r = path === session.path ? { path } : await rpc("write_file", { path, data_b64: (await rpc("read_file_b64", { path: session.path })).data_b64, overwrite });
      setSession((s) => (s ? { ...s, path: r.path, name: baseName(r.path), dirty: false, ...(s.working && r.path === s.path ? {} : { working: false, parked: false, savedAt: Date.now() }) } : s));
      return r.path;
    }
    throw new Error(editorState === "unavailable" || editorState === "error" ? FIELDS_LOST : NOT_READY);
  }, [session, editorState, toast, dropRecovery, keepRecovery]);

  const suggestedName = useMemo(
    () => (session ? suggestFileName(session.title, settings?.org.dept ?? "") : ""),
    [session, settings?.org.dept],
  );

  // 원본 보호: 사용자가 연 기존 파일은 처음 저장할 때 산출 폴더의 "이름_수정" 이 기본값 (원본을 덮으려면 저장 창에서 직접 고른다)
  const saveDir = !session ? "" : session.savedAt ? dirName(session.path) : settings?.convert.output_dir || (session.existing ? dirName(session.path) : "");

  const ensureSaved = useCallback(async () => {
    if (!session) return null;
    if (!(await syncDirty()) && session.savedAt) return session.path;
    const name = `${session.existing ? `${stem(session.name)}_수정` : suggestedName || stem(session.name)}.${session.format}`;
    const target = await pickSavePath(saveDir ? joinPath(saveDir, name) : name, [{ name: "한글 문서", extensions: [session.format] }]);
    if (!target) return null;
    return saveTo(target.path, undefined, target.overwrite);
  }, [session, suggestedName, saveTo, syncDirty, saveDir]);

  const outputFile = useCallback(async () => {
    if (!session) throw new Error("내보낼 문서가 없습니다. 작성 단계에서 시작점을 고르세요.");
    // PDF 를 가져와 연 문서(아직 한글 파일로 저장 전): 디스크 파일은 PDF 이고 문서는 편집기 안에만 있다.
    // 고치지 않았어도 늘 편집기 내용을 한글 형식 이름의 작업 사본으로 낸다 (PDF 경로·.pdf 이름으로 내면 PDF 저장·인쇄·합본이 깨진다)
    const imported = extOf(session.path) !== session.format;
    if (!imported && !(await syncDirty())) return session.path;
    if (session.working) return saveTo(session.path);
    // 사용자 파일·서식함 서식은 덮지 않는다: 지금 편집기 내용을 작업 사본으로
    const ed = client.current;
    if (editorState !== "ready" || !ed || opening.current) throw new Error(NOT_READY);
    const target = await workingFile(imported ? `${stem(session.name)}.${session.format}` : session.name);
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
    if (!session) return true;
    // parked: 출력하느라 작업 사본에만 써 둔 초안 (편집기는 저장된 것으로 알지만 사용자는 저장한 적이 없다)
    if (!(await syncDirty()) && !session.parked) return true;
    const a = await askUser({
      title: "저장하지 않은 문서",
      body: <p className="kd-text" style={{ overflowWrap: "anywhere" }}>{session.name}에서 고친 내용이 아직 한글 파일로 저장되지 않았습니다. {before} 저장할까요? 버리면 고친 내용은 사라집니다.</p>,
      choices: [{ id: "cancel", label: "취소", variant: "ghost" }, { id: "discard", label: "버리기", variant: "secondary" }, { id: "save", label: "저장" }],
    });
    if (a === "discard") {
      dropRecovery(session.path);
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
  }, [session, syncDirty, askUser, saveTo, ensureSaved, toast, dropRecovery]);

  const openInEditor = useCallback(async (path: string, opts?: OpenOpts): Promise<boolean> => {
    // 앞 열기가 아직 끝나지 않았다 (PDF 가져오기 창은 답을 최대 10분 기다린다): 겹쳐 열면 두 열기가 서로를 끊는다
    if (opening.current) { toast("앞 문서를 여는 중입니다. 편집기의 가져오기 창을 먼저 끝내세요.", "info"); return false; }
    // 열기 준비(쪽 수 확인·묻기)를 기다리는 사이 또 눌렀다: 두 열기가 함께 들어가면 서로를 끊는다
    if (entering.current) { toast("앞 문서를 여는 중입니다. 잠시 뒤 다시 누르세요.", "info"); return false; }
    entering.current = true;
    let recover = !!opts?.recover;
    try {
      // 쪽이 아주 많은 문서는 열기 전에 묻는다 (rhwp 는 쪽 수에 따라 여는 시간이 가파르게 는다)
      const pages = await rpc("doc_info", { path }).then((d) => d.page_count ?? 0, () => 0);
      if (pages > RHWP_MAX_PAGES && (await askUser({
        title: "쪽이 아주 많은 문서",
        body: <p className="kd-text">이 문서는 {pages.toLocaleString("ko-KR")}쪽입니다. 한글 편집기로 열면 오래 걸릴 수 있고, 2분 안에 열리지 않으면 멈춥니다. 내용만 보려면 문서 화면에서 여세요.</p>,
        choices: [{ id: "cancel", label: "취소", variant: "ghost" }, { id: "open", label: "그래도 열기" }],
      })) !== "open") return false;
      if (!(await settleCurrent())) return false;
      recovery.current.gen++; // 앞 문서의 사본 쓰기가 아직 돌고 있으면 버린다
      // 이 파일에 저장하지 않고 꺼진 사본이 있으면 무엇을 열지 묻는다
      if (!recover) {
        const copy = (await rpc("recovery_list", { path }).catch(() => ({ entries: [] }))).entries[0];
        if (copy) {
          const a = await askUser({
            title: "저장하지 않은 사본이 있습니다",
            body: <p className="kd-text" style={{ overflowWrap: "anywhere" }}>{baseName(path)}을 고치다 저장하지 않은 채 앱이 꺼졌습니다({new Date(copy.saved_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}). 그때 고친 내용으로 열까요? 원본으로 열면 사본은 지웁니다.</p>,
            choices: [{ id: "cancel", label: "취소", variant: "ghost" }, { id: "original", label: "원본 열기", variant: "secondary" }, { id: "recover", label: "고친 내용으로 열기" }],
          });
          if (a === "cancel") return false;
          if (a === "original") dropRecovery(path);
          recover = a === "recover";
        }
      }
    } finally {
      entering.current = false;
    }
    const format: "hwp" | "hwpx" = extOf(path) === "hwp" ? "hwp" : "hwpx";
    const fields = opts?.fields && Object.keys(opts.fields).length ? opts.fields : null;
    opening.current = true;
    setOpenSeq((n) => n + 1);
    putAgentTask(null);
    recovery.current = { seq: -1, at: 0, busy: false, gen: recovery.current.gen + 1 };
    // PDF 가져오기를 취소하면 되돌아갈 곳 (편집기에는 앞 문서가 그대로 남는다).
    // 묻기에서 앞 문서를 저장했으면 저장한 뒤의 세션이다 (이 함수를 만들 때의 세션은 저장 전 경로·고침 표시라 되살리면 어긋난다)
    const back = { session: sessionRef.current, step };
    setSession({ path, name: baseName(path), format, title: opts?.title ?? stem(path), dirty: false, ...(fields ? { withFields: true } : {}), ...(opts?.working ? { working: true } : {}), ...(opts?.existing ? { existing: true } : {}) });
    setStep("edit");
    setBusyText("한글 편집기를 여는 중");
    // 편집기에 이 문서가 실제로 들어갔는지 — 못 들어갔는데 편집기를 그대로 두면 앞 문서 내용이 이 경로로 저장된다
    let loaded = false;
    /** 이 문서가 지금 세션으로 남았나 (돌려줄 값: 취소·실패로 앞 세션으로 되돌리거나 비우면 false) */
    let held = true;
    try {
      if (!(await ensureEditor())) return true;
      const ed = client.current!;
      const file = await rpc("editor_open", { path, ...(recover ? { recover: true } : {}) });
      setSession((s) => (s && s.path === path ? { ...s, token: file.token } : s));
      if (file.tracked) toast("변경 내용 추적이 든 문서입니다. 고친 흔적이 함께 보일 수 있고, 저장하면 보이는 그대로 본문이 되며 추적 기록은 남지 않습니다. 처음 덮어쓸 때 원본은 .bak 파일로 남습니다.", "info");
      const bytes = new Uint8Array(b64ToBuffer(file.data_b64));
      // PDF 는 가져오기 창이 답을 기다리는 10분, 그 밖은 2분: 안내 문장도 그에 맞춘다
      const stopped = isPdfInput(bytes, file.name) ? PDF_STOPPED : BIG_STOPPED;
      try {
        await ed.open(bytes, file.name);
      } catch (e) {
        // 제때 못 열면 iframe 을 내려야 편집기가 열기를 멈춘다 (그대로 두면 몇 분씩 CPU 를 쓴다)
        if (e instanceof EditorTimeoutError) { stopEditor(stopped); throw new Error(stopped); }
        throw e;
      }
      loaded = true;
      if (fields) await ed.call("put_fields", { values: fields });
      // 연 뒤 상태를 직접 확인한다 (칸을 넣었으면 디스크 파일과 달라졌다)
      const st = await ed.call("state", {}).catch(() => null);
      // 되살린 사본은 디스크 파일과 다르다. 원본 보호: 사용자 파일이어도 저장은 저장 창(기본값 산출 폴더의 "이름_수정")으로
      setSession((s) => (s && s.path === path ? { ...s, withFields: false, dirty: s.dirty || !!st?.dirty || recover } : s));
      if (recover) toast(opts?.working ? "저장하지 않았던 초안을 되살렸습니다." : "저장하지 않았던 고친 내용으로 열었습니다. 저장하면 원본은 두고 새 파일로 저장합니다.", "info");
      const seq = ++seqRef.current;
      setDocSeq(seq);
      // 다 연 뒤에야 건다: 앞 문서가 열려 있는 동안 요청이 앞 문서로 가지 않게
      if (opts?.agentTask) putAgentTask({ seq, ...opts.agentTask });
    } catch (e) {
      if (/PDF_IMPORT_CANCELLED/.test(errorText(e))) {
        // PDF 가져오기 설정 창에서 취소했다: 오류가 아니다. 편집기는 앞 문서를 그대로 들고 있으니 앞 문서·앞 단계로 되돌린다
        // (PDF 세션을 남기면 "편집기를 열지 못했습니다" 화면에 저장 단추가 켜진 채 갇힌다)
        setSession(back.session);
        setStep(back.session ? back.step : "compose");
        held = false;
        toast("PDF 가져오기를 취소했습니다.", "info");
      } else {
        if (!loaded && client.current) stopEditor(OPEN_FAILED);
        // 가져오지 못한 PDF 는 "고치지 않은 그대로 저장"할 한글 문서가 없다: 세션을 남기지 않고 작성 단계로
        if (!loaded && extOf(path) === "pdf") { setSession(null); setStep("compose"); held = false; }
        toast(`문서를 편집기로 열지 못했습니다: ${errorText(e)}`, "error");
      }
    } finally {
      opening.current = false;
      setBusyText("");
    }
    return held;
  }, [askUser, settleCurrent, ensureEditor, stopEditor, toast, dropRecovery, step]);

  // 트레이 "완전 종료" 전에 편집 중인 문서를 묻는다
  useEffect(() => onQuitGuard(() => settleCurrent("앱을 끄기 전에")), [settleCurrent]);

  // 복구 사본: 저장하지 않은 동안 30초마다, 입력이 멈췄을 때만 내보내 앱 데이터 폴더에 둔다 (원본·.bak 은 그대로)
  const dirtyDoc = session?.dirty && editorState === "ready" ? session : null;
  useEffect(() => {
    if (!dirtyDoc) return;
    const { path, format, title, working } = dirtyDoc;
    const t = setInterval(async () => {
      const r = recovery.current;
      const ed = client.current;
      if (!ed || r.busy || opening.current || savingNow.current) return;
      const now = Date.now();
      if (now - r.at < RECOVERY_EVERY_MS || now - lastChangeAt.current < RECOVERY_IDLE_MS) return;
      r.busy = true;
      const gen = r.gen;
      try {
        const st = await ed.call("state", {});
        if (!st.dirty || st.changeSeq === r.seq) return;
        const bytes = await ed.save(format);
        // 그사이 저장·버리기·다른 문서 열기가 있었다
        if (opening.current || r.gen !== gen) return;
        await rpc("recovery_write", { path, data_b64: bytesToB64(bytes.buffer as ArrayBuffer), title, ...(working ? { working: true } : {}) });
        // 쓰는 사이에 지웠다면 방금 쓴 것도 지운다
        if (r.gen !== gen) { void rpc("recovery_discard", { path }).catch(() => undefined); return; }
        r.seq = st.changeSeq;
        r.at = Date.now();
      } catch {
        // 사본은 덤: 실패하면 다음 차례에 다시
      } finally {
        r.busy = false;
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [dirtyDoc?.path, dirtyDoc?.format, dirtyDoc?.title, dirtyDoc?.working, !!dirtyDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusEditor = useCallback(() => frameRef.current?.focus(), []);

  const value = useMemo<CreateValue>(() => ({
    step, setStep, session, editorState, editorError, docState, docSeq, openSeq, agentTask, takeAgentTask, frameRef, frameSrc,
    openInEditor, call, focusEditor, saveTo, ensureSaved, outputFile, saveDir, syncDirty, canSave, saveBlock, saveCurrent, saving, suggestedName, busyText,
  }), [step, session, editorState, editorError, docState, docSeq, openSeq, agentTask, takeAgentTask, frameSrc, openInEditor, call, focusEditor, saveTo, ensureSaved, outputFile, saveDir, syncDirty, canSave, saveBlock, saveCurrent, saving, suggestedName, busyText]);

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
