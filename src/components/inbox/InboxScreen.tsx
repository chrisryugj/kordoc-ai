/** 받은 공문 — 받은 공문의 보낸 곳·제목·요청 사항·기한을 한 표로, 기한 배지와 회신 초안으로 잇는다 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePlus2, FlaskConical, Inbox } from "lucide-react";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName, num } from "../../lib/format";
import { readPref, writePref } from "../../lib/recent";
import { useTask } from "../../hooks/useTask";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Seg } from "../common/Field";
import { Empty, ErrorLine, Note, Working } from "../common/Status";
import { daysLeft, sortItems, todayIso, urgentCount, type InboxItem } from "./dday";
import { InboxRow, type InboxPatch } from "./InboxRow";
import "./inbox.css";

type Filter = "todo" | "done" | "all";
type Failed = Array<{ path: string; error: string }>;

const LETTER_FILTER = [{ name: "받은 공문", extensions: ["hwp", "hwpx", "hml", "pdf", "docx", "png", "jpg", "jpeg", "webp", "txt", "md"] }];

export function InboxScreen({ active }: { active: boolean }) {
  const { ready, registerDrop, dragTarget, setBadge, toast } = useApp();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilterState] = useState<Filter>(() => readPref<Filter>("kordoc-inbox-filter", "todo"));
  const [openId, setOpenId] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failed>([]);
  const adding = useTask<number>();
  const today = todayIso();

  const setFilter = (f: Filter) => { setFilterState(f); writePref("kordoc-inbox-filter", f); };

  const load = useCallback(async () => {
    try {
      setItems(sortItems((await rpc("inbox_list", {})).items));
      setLoadError("");
    } catch (e) {
      setLoadError(`목록을 읽지 못했습니다: ${errorText(e)}. 잠시 뒤 다시 열어 보세요.`);
    }
  }, []);

  // 화면에 들어올 때마다 다시 읽기 (작업대에서 "받은 공문에 넣기"로 넣은 것도 보이게)
  useEffect(() => { if (ready && active) void load(); }, [ready, active, load]);
  useEffect(() => {
    if (!items) return;
    const n = urgentCount(items, today);
    setBadge("inbox", n ? String(n) : undefined);
  }, [items, today, setBadge]);

  const add = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    setFailed([]);
    const added = await adding.run(async ({ signal, onProgress }) => {
      const files = (await rpc("scan_paths", { paths })).files.map((f) => f.path);
      if (!files.length) throw new Error("넣을 문서를 찾지 못했습니다. HWP·HWPX·PDF 파일을 넣으세요.");
      const r = await rpc("inbox_add", { paths: files }, { signal, onProgress });
      setFailed(r.failed);
      if (r.items.length === 1) setOpenId(r.items[0].id);
      return r.items.length;
    });
    await load();
    if (added) {
      toast(`공문 ${num(added)}건을 정리했습니다`, "success");
      setFilterState("todo");
      writePref("kordoc-inbox-filter", "todo");
    }
  }, [adding, load, toast]);

  useEffect(() => registerDrop("inbox", (p) => void add(p)), [registerDrop, add]);

  const pick = () => void pickFiles({ filters: LETTER_FILTER }).then((p) => add(p));

  const trySample = async () => {
    try {
      const reply = (await rpc("samples_list", {})).scenarios.find((s) => s.id === "reply");
      const file = reply?.files.find((f) => f.toLowerCase().endsWith(".hwpx")) ?? reply?.files[0];
      if (!file) throw new Error("예제 공문이 없습니다. 앱을 다시 설치해 보세요.");
      await add([file]);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const update = async (id: string, patch: InboxPatch) => {
    // 끝냄 칸은 바로 바뀌어 보이게 (자리 옮김은 엔진 답을 받은 뒤)
    if (patch.status) setItems((prev) => prev?.map((x) => (x.id === id ? { ...x, status: patch.status! } : x)) ?? prev);
    try {
      const next = await rpc("inbox_update", { id, ...patch });
      setItems((prev) => (prev ? sortItems(prev.map((x) => (x.id === id ? next : x))) : prev));
    } catch (e) {
      toast(`바꾸지 못했습니다: ${errorText(e)}`, "error");
      void load();
    }
  };

  const remove = async (it: InboxItem) => {
    try {
      await rpc("inbox_remove", { id: it.id });
      setItems((prev) => prev?.filter((x) => x.id !== it.id) ?? prev);
      toast("목록에서 뺐습니다. 파일은 그대로 둡니다.", "info");
    } catch (e) {
      toast(`빼지 못했습니다: ${errorText(e)}`, "error");
    }
  };

  const counts = useMemo(() => {
    const list = items ?? [];
    const todo = list.filter((x) => x.status === "todo");
    const left = todo.filter((x) => x.due).map((x) => daysLeft(x.due!, today));
    return {
      todo: todo.length, done: list.length - todo.length, all: list.length,
      over: left.filter((n) => n < 0).length, today: left.filter((n) => n === 0).length, soon: left.filter((n) => n > 0 && n <= 3).length,
    };
  }, [items, today]);
  const shown = (items ?? []).filter((x) => filter === "all" || x.status === filter);
  const summary = [counts.over && `기한 지남 ${num(counts.over)}건`, counts.today && `오늘 ${num(counts.today)}건`, counts.soon && `3일 안 ${num(counts.soon)}건`].filter(Boolean).join(" · ");

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="받은 공문" sub="받은 공문의 요청 사항과 제출 기한을 한눈에 보고, 바로 회신을 씁니다."
        actions={<Button variant="secondary" onClick={pick} disabled={adding.busy}><FilePlus2 size={15} /> 공문 추가</Button>} />
      <div className="kd-body kd-inbox-drop" data-drop="inbox" data-over={dragTarget === "inbox" && !!items?.length}>
        <div className="kd-inbox">
          {adding.busy && <Working label="공문을 읽는 중" progress={adding.progress} onCancel={adding.cancel} />}
          <ErrorLine message={adding.error || loadError} />
          {failed.length > 0 && (
            <Note tone="warn">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold">읽지 못한 파일 {num(failed.length)}개</span>
                <button type="button" className="kd-link kd-small" onClick={() => setFailed([])}>닫기</button>
              </div>
              <ul className="mt-1 kd-small">
                {failed.map((f) => <li key={f.path}><b>{baseName(f.path)}</b>: {f.error}</li>)}
              </ul>
            </Note>
          )}

          {items === null ? (
            !loadError && <p className="kd-text kd-muted py-6">{ready ? "목록을 읽는 중입니다." : "문서 엔진을 켜는 중입니다."}</p>
          ) : items.length === 0 ? (
            <div className="kd-dropzone mt-2" data-over={dragTarget === "inbox"}>
              <Empty icon={<Inbox size={30} />} title="받은 공문이 없습니다"
                action={(
                  <>
                    <Button onClick={pick} disabled={adding.busy}><FilePlus2 size={14} /> 공문 추가</Button>
                    <Button variant="secondary" onClick={() => void trySample()} disabled={adding.busy}><FlaskConical size={14} /> 예제 공문으로 해 보기</Button>
                  </>
                )}>
                공문을 끌어다 놓거나 공문 추가를 누르세요. 보낸 곳·요청 사항·제출 기한을 뽑아 기한 순으로 정리하고, 회신 초안으로 바로 이어 줍니다.
              </Empty>
            </div>
          ) : (
            <>
              <div className="kd-inbox-bar">
                <Seg label="보기" value={filter} onChange={setFilter} options={[
                  { value: "todo", label: `할 일 ${num(counts.todo)}` },
                  { value: "done", label: `끝남 ${num(counts.done)}` },
                  { value: "all", label: `전체 ${num(counts.all)}` },
                ]} />
                {summary && <span className="kd-small kd-num kd-inbox-summary">{summary}</span>}
              </div>
              {shown.length === 0 ? (
                <p className="kd-text kd-muted py-6">{filter === "todo" ? "남은 할 일이 없습니다. 끝낸 공문은 끝남에서 봅니다." : "끝낸 공문이 없습니다."}</p>
              ) : (
                <table className="kd-table kd-inbox-table" aria-label="받은 공문 목록 (기한 순)">
                  <thead>
                    <tr>
                      <th className="kd-inbox-w-due">기한</th><th>제목</th><th className="kd-inbox-c-from kd-inbox-w-from">보낸 곳</th><th>요청 사항</th>
                      <th className="kd-inbox-w-state">상태</th><th className="kd-inbox-w-act" aria-label="동작" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((it) => (
                      <InboxRow key={it.id} item={it} today={today} open={openId === it.id}
                        onToggle={() => setOpenId((cur) => (cur === it.id ? null : it.id))}
                        onUpdate={(p) => void update(it.id, p)} onRemove={() => void remove(it)} />
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
