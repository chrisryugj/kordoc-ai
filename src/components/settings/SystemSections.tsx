/** 마. 엔진과 모델 · 바. 저장과 연결(저장 위치·우클릭 메뉴·AI 도구 연결) · 사. 화면과 정보 */

import { useCallback, useEffect, useState } from "react";
import { Activity, BarChart3, FileText, FolderInput, FolderOpen, MousePointerClick, Plug, Stethoscope } from "lucide-react";
import { resolveResource } from "@tauri-apps/api/path";
import type { RpcResult } from "../../lib/contract";
import { useApp, type ThemePref } from "../../state/app";
import { rpc, errorText, invokeCmd, isTauri } from "../../lib/rpc";
import { notifyQuick, pickFolder } from "../../lib/native";
import { applyZoom, currentZoom, maxZoom, zoomLabel, ZOOM_STEPS } from "../../lib/zoom";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Check, Field, Section, Seg } from "../common/Field";
import { ErrorLine, Note, StatusLine, Working } from "../common/Status";
import { MCPSetupDialog } from "../mcp/MCPSetupDialog";
import { Advanced } from "./dirty";

/** 엔진 점검 단계 이름 (엔진은 기록·CI 용 영어 식별자를 준다) */
const STEP_LABEL: Record<string, string> = {
  hwpx_generate_parse: "한글(HWPX) 만들고 다시 읽기",
  pdf_parse: "PDF 읽기",
  worker_parse: "큰 문서 따로 처리",
  render_png: "쪽 그림 그리기",
  kordoc_cli: "서식 보존 도구 실행",
  ocr_image: "글자 읽기(OCR)",
  llama_binding: "내장 AI 엔진",
};

export function EngineSection() {
  const { system } = useApp();
  const [ocr, setOcr] = useState(true);
  const [llama, setLlama] = useState(false);
  const test = useTask<RpcResult<"engine_selftest">>();
  const [models, setModels] = useState<RpcResult<"models_status"> | null>(null);
  const imp = useTask<string[]>();

  const loadModels = useCallback(() => { rpc("models_status", {}).then(setModels).catch(() => setModels(null)); }, []);
  useEffect(loadModels, [loadModels]);

  // 관리자에게 전할 버전·환경은 고급에 (평소엔 앱 버전만)
  const rows: Array<[string, string]> = system ? [["앱", `KorDoc AI ${system.app_version}`]] : [];
  const techRows: Array<[string, string]> = system ? [
    ["문서 엔진", `kordoc ${system.kordoc_version}`],
    ["실행 환경", `Node ${system.node_version} (앱에 들어 있음)`],
    ["운영체제", system.platform],
  ] : [];

  return (
    <Section id="set-engine" mark="마." title="엔진과 모델" sub="문제가 생기면 엔진 점검을 눌러 어느 단계에서 막히는지 확인하세요.">
      <dl className="kd-dl kd-dl-wide">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {test.busy ? <div className="min-w-[260px] flex-1"><Working label="엔진을 점검하는 중" progress={test.progress} /></div> : (
          <Button variant="secondary" onClick={() => void test.run(({ onProgress }) => rpc("engine_selftest", { ocr, llama }, { onProgress }))}><Stethoscope size={14} /> 엔진 점검</Button>
        )}
        <Check label="글자 읽기(OCR) 포함" checked={ocr} onChange={setOcr} disabled={test.busy} />
        <Check label="내장 AI 포함" checked={llama} onChange={setLlama} disabled={test.busy} />
      </div>
      <ErrorLine message={test.error} />
      {test.result && (
        <div className="mt-3 flex flex-col gap-2">
          <Note tone={test.result.ok ? "ok" : "err"}>{test.result.ok ? "모든 단계를 통과했습니다." : "통과하지 못한 단계가 있습니다. 아래 내용을 관리자에게 전하세요."}</Note>
          <ul className="kd-rows">
            {test.result.steps.map((st) => (
              <li key={st.name} className="kd-row">
                <StatusLine tone={st.ok ? "ok" : "err"}>{st.ok ? "통과" : "실패"}</StatusLine>
                <span className="kd-row-main"><span className="kd-row-title block">{STEP_LABEL[st.name] ?? st.name}</span>{st.detail && <span className="kd-row-desc block">{st.detail}</span>}</span>
                <span className="kd-small kd-muted kd-num">{st.ms}ms</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="kd-h3 mt-6 mb-2">글자 읽기(OCR) 모델</h3>
      {models && (
        <dl className="kd-dl kd-dl-wide">
          <div><dt>한글 글자 읽기</dt><dd>{models.ocr.ready ? <StatusLine tone="ok">준비됨</StatusLine> : <StatusLine tone="warn">없음</StatusLine>}</dd></div>
          <div><dt>수식 읽기</dt><dd>{models.formula.ready ? <StatusLine tone="ok">준비됨</StatusLine> : <span className="kd-small kd-muted">없음 (필요할 때 가져오기)</span>}</dd></div>
        </dl>
      )}
      <p className="kd-small kd-muted mt-2">인터넷이 없는 PC는 글자 읽기 모델 파일이 든 폴더를 USB로 옮겨 가져오세요.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={imp.busy} onClick={() => void imp.run(async () => {
          const dir = await pickFolder();
          if (!dir) return [];
          const r = await rpc("models_import", { dir });
          loadModels();
          return r.imported;
        })}><FolderInput size={14} /> 폴더에서 가져오기</Button>
      </div>
      <ErrorLine message={imp.error} />
      {imp.result && imp.result.length > 0 && <Note tone="ok">{imp.result.join(", ")} 파일을 가져왔습니다.</Note>}
      <Advanced title="고급: 버전과 모델 파일">
        <dl className="kd-dl kd-dl-wide">
          {techRows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <p className="kd-small kd-muted">글자 읽기 모델 폴더에는 det.onnx, rec_korean.onnx, rec_korean.yml 세 파일이 있어야 합니다.</p>
      </Advanced>
    </Section>
  );
}

export function StorageSection() {
  const { settings, saveSettings } = useApp();
  const [mcp, setMcp] = useState(false);
  const [shell, setShell] = useState<{ supported: boolean; installed: boolean; kind: string } | null>(null);
  const [shellErr, setShellErr] = useState("");
  const [shellBusy, setShellBusy] = useState(false);
  const toast = useApp().toast;

  const loadShell = useCallback(() => {
    invokeCmd<{ supported: boolean; installed: boolean; kind: string }>("shell_menu_status").then(setShell).catch((e) => setShellErr(errorText(e)));
  }, []);
  useEffect(loadShell, [loadShell]);

  // 넣기·빼기 뒤에 상태를 다시 읽어 실제로 바뀐 것만 알린다 (실패하면 오류 줄)
  const toggleShell = async () => {
    const removing = !!shell?.installed;
    setShellBusy(true);
    setShellErr("");
    try {
      await invokeCmd(removing ? "shell_menu_uninstall" : "shell_menu_install");
      // 빠른 동작은 끝나면 알림으로 알린다: 넣을 때 알림 권한을 미리 묻는다 (맥은 묻기 전엔 꺼져 있다)
      if (!removing) await notifyQuick("KorDoc AI", "우클릭 메뉴를 넣었습니다. 빠른 동작이 끝나면 이렇게 알립니다.");
      const now = await invokeCmd<{ supported: boolean; installed: boolean; kind: string }>("shell_menu_status");
      setShell(now);
      if (now.installed === removing) setShellErr(removing ? "메뉴를 빼지 못했습니다. 앱을 다시 켠 뒤 해 보세요." : "메뉴를 넣지 못했습니다. 앱을 다시 켠 뒤 해 보세요.");
      else toast(removing ? "메뉴를 뺐습니다" : "메뉴를 넣었습니다", "success");
    } catch (e) {
      setShellErr(`${removing ? "메뉴를 빼지" : "메뉴를 넣지"} 못했습니다: ${errorText(e)}`);
    }
    setShellBusy(false);
  };
  // macOS 는 Finder 빠른 동작(kind "quick-action"), Windows 는 레지스트리
  const isMac = shell?.kind === "quick-action";

  return (
    <Section id="set-store" mark="바." title="저장과 연결">
      <Field label="저장 위치" hint="바꾼 문서를 담을 폴더. 비우면 원본 파일 옆에 저장합니다.">
        <div className="kd-inset flex items-center gap-2 px-3 py-2">
          <FolderOpen size={14} className="kd-muted flex-none" />
          <span className="kd-path flex-1">{settings!.convert.output_dir || "원본 파일 옆"}</span>
          {settings!.convert.output_dir && <button type="button" className="kd-link kd-small" onClick={() => void saveSettings({ convert: { output_dir: "" } })}>원래대로</button>}
          <button type="button" className="kd-link kd-small" onClick={() => void pickFolder().then((d) => { if (d) void saveSettings({ convert: { output_dir: d } }); })}>바꾸기</button>
        </div>
      </Field>
      <div className="mt-4">
        <Field label="스캔한 쪽 글자 읽기 기본값">
          <Seg label="글자 읽기 기본값" value={settings!.convert.ocr} onChange={(v) => void saveSettings({ convert: { ocr: v } })}
            options={[{ value: "auto", label: "필요한 쪽만" }, { value: "force", label: "모든 쪽" }, { value: "off", label: "안 함" }]} />
        </Field>
      </div>

      <div className="kd-row mt-6 items-start">
        <MousePointerClick size={18} className="kd-muted mt-0.5 flex-none" />
        <span className="kd-row-main">
          <span className="kd-row-title block">{isMac ? "Finder 빠른 동작" : "탐색기 우클릭 메뉴"}</span>
          <span className="kd-row-desc block" style={{ textWrap: "balance" }}>{isMac
            ? "Finder에서 파일을 우클릭해 PDF 합치기·용량 줄이기, 한글 문서로 바꾸기를 창 없이 끝냅니다. 끝나면 알림이 뜹니다."
            : "파일·폴더를 우클릭해 PDF 합치기·나누기, 한글 문서로 바꾸기, 개인정보 가리기를 창 없이 끝냅니다. 끝나면 알림이 뜹니다."}</span>
          {shell && !shell.supported && <span className="kd-row-desc block">이 운영체제에서는 지원하지 않습니다.</span>}
          {shellErr && <span className="block mt-1"><StatusLine tone="err">{shellErr}</StatusLine></span>}
        </span>
        {shell?.supported && (
          <span className="kd-row-aside">
            {shell.installed && <StatusLine tone="ok">넣어 둠</StatusLine>}
            <Button variant="secondary" size="sm" disabled={shellBusy} onClick={() => void toggleShell()}>{shell.installed ? "메뉴 빼기" : "메뉴 넣기"}</Button>
          </span>
        )}
      </div>
      <Advanced>
        <div className="kd-row items-start">
          <Plug size={18} className="kd-muted mt-0.5 flex-none" />
          <span className="kd-row-main">
            <span className="kd-row-title block">다른 AI 프로그램과 연결 (MCP)</span>
            <span className="kd-row-desc block">Claude Desktop·Cursor 같은 AI 프로그램이 이 앱의 문서 엔진으로 한글 문서를 읽게 합니다.</span>
          </span>
          <span className="kd-row-aside"><Button variant="secondary" size="sm" onClick={() => setMcp(true)}>연결 설정</Button></span>
        </div>
      </Advanced>
      <MCPSetupDialog isOpen={mcp} onClose={() => setMcp(false)} showToast={toast} />
    </Section>
  );
}

export function AboutSection() {
  const { theme, setTheme, system, go, toast } = useApp();
  const [zoom, setZoom] = useState(() => currentZoom());
  // 창이 좁으면 더 큰 단계는 못 고른다 (키우면 화면 오른쪽이 잘린다)
  const [maxZ, setMaxZ] = useState(maxZoom);
  // 단축키(App.tsx)로 바꾸거나 창 크기를 바꿔도 여기 표시를 맞춘다
  useEffect(() => {
    const sync = () => { setZoom(currentZoom()); setMaxZ(maxZoom()); };
    window.addEventListener("keyup", sync);
    window.addEventListener("resize", sync);
    return () => { window.removeEventListener("keyup", sync); window.removeEventListener("resize", sync); };
  }, []);
  const mod = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
  const pickZoom = (v: string) => {
    const z = Number(v);
    setZoom(z);
    void applyZoom(z).catch(() => toast("화면 크기를 바꾸지 못했습니다. 앱을 다시 켠 뒤 해 보세요.", "error"));
  };
  // 설치본에 함께 싣는 제3자 고지 모음(tauri.conf.json bundle.resources). 열지 못하면 위치를 알려 준다
  const openNotices = async () => {
    let path = "";
    try {
      if (!isTauri) throw new Error("미리보기");
      path = (await resolveResource("THIRD_PARTY_NOTICES.txt")).replace(/^\\\\\?\\/, "");
      await rpc("open_file", { path });
    } catch {
      toast(path ? `오픈소스 고지를 열지 못했습니다. 이 파일을 직접 여세요: ${path}` : "오픈소스 고지는 설치 폴더의 THIRD_PARTY_NOTICES.txt 에 있습니다.", "info");
    }
  };
  return (
    <Section id="set-about" mark="사." title="화면과 정보">
      <Field label="화면 밝기">
        <Seg<ThemePref> label="화면 밝기" value={theme} onChange={setTheme} options={[{ value: "light", label: "밝게" }, { value: "dark", label: "어둡게" }, { value: "system", label: "컴퓨터 설정대로" }]} />
      </Field>
      <div className="mt-4">
        <Field label="화면 크기" hint={`글씨와 단추를 함께 키웁니다. ${mod} + 더하기·빼기로도 바꾸고, ${mod} + 0은 100%로 돌아갑니다.${maxZ < ZOOM_STEPS[ZOOM_STEPS.length - 1] ? ` 지금 창 폭에서는 ${zoomLabel(maxZ)}까지 됩니다. 창을 넓히면 더 키울 수 있습니다.` : ""}`}>
          <Seg label="화면 크기" value={String(zoom)} onChange={pickZoom} options={ZOOM_STEPS.map((z) => ({ value: String(z), label: zoomLabel(z), disabled: z > maxZ }))} />
        </Field>
      </div>
      <div className="kd-row mt-5">
        <BarChart3 size={18} className="kd-muted flex-none" />
        <span className="kd-row-main">
          <span className="kd-row-title block">효과</span>
          <span className="kd-row-desc block">처리한 문서 수와 아낀 시간을 일 종류별로 봅니다. 기관 보고용 HWPX로도 저장합니다.</span>
        </span>
        <span className="kd-row-aside"><Button variant="secondary" size="sm" onClick={() => go("impact")}><Activity size={13} /> 효과 보기</Button></span>
      </div>
      <dl className="kd-dl kd-dl-wide mt-4">
        <div><dt>버전</dt><dd>KorDoc AI {system?.app_version ?? ""}</dd></div>
      </dl>
      <div className="kd-row mt-4">
        <FileText size={18} className="kd-muted flex-none" />
        <span className="kd-row-main">
          <span className="kd-row-title block">오픈소스 고지</span>
          <span className="kd-row-desc block">앱에 들어 있는 오픈소스의 이름·버전·라이선스 전문입니다.</span>
        </span>
        <span className="kd-row-aside"><Button variant="secondary" size="sm" onClick={() => void openNotices()}><FileText size={13} /> 열기</Button></span>
      </div>
      <Advanced title="고급: 라이선스">
      <dl className="kd-dl kd-dl-wide">
        <div><dt>라이선스</dt><dd>MIT</dd></div>
        <div><dt>문서 엔진</dt><dd>kordoc {system?.kordoc_version ?? ""} (MIT)</dd></div>
        <div><dt>한글 편집기</dt><dd>rhwp (MIT)</dd></div>
        <div><dt>글꼴</dt><dd>Pretendard (SIL Open Font License 1.1)</dd></div>
        <div><dt>편집기 글꼴</dt><dd>글꼴마다 다릅니다 (대부분 SIL Open Font License 1.1, 자세한 것은 오픈소스 고지)</dd></div>
        <div><dt>내장 AI 모델</dt><dd>받은 모델마다 그 모델의 라이선스를 따릅니다</dd></div>
      </dl>
      <p className="kd-small kd-muted">오픈소스 고지는 설치 폴더의 THIRD_PARTY_NOTICES.txt 이고, 요약은 같은 폴더의 NOTICE 에 있습니다.</p>
      </Advanced>
    </Section>
  );
}
