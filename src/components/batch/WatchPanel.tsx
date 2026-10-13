/** 폴더 지켜보기 — 받은 문서 폴더에 새 파일이 들어오면 자동으로 글로 바꾼다 (watch_*) */

import { useCallback, useEffect, useState } from "react";
import { Eye, FolderOpen, Square } from "lucide-react";
import { useApp } from "../../state/app";
import { rpc, errorText, onNotify } from "../../lib/rpc";
import { pickFolder } from "../../lib/native";
import { baseName, num } from "../../lib/format";
import { Button } from "../ui/Button";
import { Field, Seg } from "../common/Field";
import { ErrorLine, Note, StatusLine } from "../common/Status";

const FORMAT_LABEL: Record<string, string> = { md: "제목·표 살린 글", html: "웹 페이지", txt: "글자만" };

type Watch = { id: string; dir: string; out_dir: string; format: string; processed: number; started_at: string };
type Event = { id: string; path: string; ok: boolean; output_path?: string; error?: string; at: number };

export function WatchPanel({ active, onCount }: { active: boolean; onCount: (n: number) => void }) {
  const { ready } = useApp();
  const [list, setList] = useState<Watch[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [dir, setDir] = useState("");
  const [outDir, setOutDir] = useState("");
  const [format, setFormat] = useState<"md" | "html" | "txt">("md");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try { setList(await rpc("watch_list", {})); } catch (e) { setError(errorText(e)); }
  }, []);

  useEffect(() => { if (ready) void refresh(); }, [ready, refresh]);
  useEffect(() => onCount(list.length), [list.length, onCount]);
  useEffect(() => onNotify("watch_event", (p) => {
    setEvents((prev) => [{ id: String(p.id), path: String(p.path), ok: !!p.ok, output_path: p.output_path as string | undefined, error: p.error as string | undefined, at: Date.now() }, ...prev].slice(0, 50));
    void refresh();
  }), [refresh]);

  const start = async () => {
    setError("");
    try {
      await rpc("watch_start", { dir, format, ...(outDir ? { out_dir: outDir } : {}) });
      setDir("");
      void refresh();
    } catch (e) { setError(errorText(e)); }
  };
  const stop = async (id: string) => {
    try { await rpc("watch_stop", { id }); void refresh(); } catch (e) { setError(errorText(e)); }
  };

  if (!active) return null;
  return (
    <div className="flex flex-col gap-5">
      <p className="kd-text">받은 문서가 쌓이는 폴더를 고르면, 새 문서가 들어올 때마다 글 파일로 바꿔 둡니다. 앱 창을 닫아도 알림 영역에서 계속 지켜봅니다.</p>
      <div className="kd-panel flex flex-col gap-3 p-4">
        <Field label="지켜볼 폴더">
          <div className="kd-inset flex items-center gap-2 px-3 py-2">
            <FolderOpen size={14} className="kd-muted flex-none" />
            <span className="kd-path flex-1" title={dir || undefined}>{dir ? baseName(dir) : "아직 고르지 않았습니다"}</span>
            <button type="button" className="kd-link kd-small flex-none" onClick={() => void pickFolder().then((d) => d && setDir(d))}>고르기</button>
          </div>
        </Field>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="바꿀 형식"><Seg label="바꿀 형식" value={format} onChange={setFormat} options={[{ value: "md", label: "제목·표 살린 글" }, { value: "html", label: "웹 페이지" }, { value: "txt", label: "글자만" }]} /></Field>
          <Field label="담을 폴더">
            <div className="flex items-center gap-2">
              <span className="kd-path" title={outDir || undefined}>{outDir ? baseName(outDir) : "지켜볼 폴더 안 “변환 결과”"}</span>
              <button type="button" className="kd-link kd-small" onClick={() => void pickFolder().then((d) => d && setOutDir(d))}>바꾸기</button>
            </div>
          </Field>
        </div>
        <div><Button disabled={!dir} onClick={() => void start()}><Eye size={14} /> 지켜보기 시작</Button></div>
        <ErrorLine message={error} />
      </div>

      <section aria-labelledby="watch-list-t">
        <h3 id="watch-list-t" className="kd-h3 mb-2">지켜보는 폴더 {list.length}</h3>
        {list.length === 0 ? <p className="kd-small kd-muted">아직 없습니다.</p> : (
          <div className="kd-rows">
            {list.map((w) => (
              <div key={w.id} className="kd-row">
                <span className="kd-row-main">
                  <span className="kd-row-title block" title={w.dir}>{baseName(w.dir)}</span>
                  <span className="kd-row-desc block kd-num">{FORMAT_LABEL[w.format] ?? w.format}로 바꿈 · 지금까지 {num(w.processed)}개</span>
                </span>
                <span className="kd-row-aside"><Button variant="secondary" size="sm" onClick={() => void stop(w.id)}><Square size={12} /> 그만 보기</Button></span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="watch-ev-t">
        <h3 id="watch-ev-t" className="kd-h3 mb-2">최근 처리</h3>
        {events.length === 0 ? <p className="kd-small kd-muted">새 문서가 들어오면 여기에 남습니다.</p> : (
          <ul className="kd-rows">
            {events.map((ev, i) => (
              <li key={i} className="kd-row">
                <StatusLine tone={ev.ok ? "ok" : "err"}>{ev.ok ? "바꿈" : "실패"}</StatusLine>
                <span className="kd-row-main">
                  <span className="kd-row-title block">{baseName(ev.path)}</span>
                  {ev.error && <span className="kd-row-desc block">{ev.error}</span>}
                </span>
                <span className="kd-small kd-muted kd-num">{new Date(ev.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
        {list.length > 0 && <div className="mt-3"><Note tone="info">지켜보기는 앱을 완전히 끄면 멈춥니다. 다시 켜면 이 화면에서 다시 시작하세요.</Note></div>}
      </section>
    </div>
  );
}
