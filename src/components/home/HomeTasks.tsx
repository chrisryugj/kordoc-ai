/** 자주 하는 일 넷 — 처음 쓰는 사람이 기능 이름을 몰라도 하려는 일로 바로 시작한다 (준비물 → 결과 한 줄씩) */

import type { ReactNode } from "react";
import { ClipboardCheck, FilePlus2, Layers, Reply } from "lucide-react";
import { useApp } from "../../state/app";
import { pickFiles } from "../../lib/native";

interface Task { id: string; icon: ReactNode; title: string; need: string; get: string; ai?: boolean; run: () => void }

export function HomeTasks() {
  const { ai, openDocs, startCreate, startBatch } = useApp();
  const pickOne = async (fn: (path: string) => void) => {
    const [p] = await pickFiles({ multiple: false });
    if (p) fn(p);
  };
  const tasks: Task[] = [
    {
      id: "reply", icon: <Reply size={20} />, title: "받은 공문에 회신 쓰기", need: "받은 공문 파일", get: "회신 공문 초안(한글 파일)", ai: true,
      run: () => void pickOne((p) => startCreate({ route: "ai", kind: "reply", references: [p] })),
    },
    {
      id: "check", icon: <ClipboardCheck size={20} />, title: "결재 올리기 전 점검", need: "내가 쓴 문서", get: "표기법·날짜·합계·개인정보 고칠 곳",
      run: () => void pickOne((p) => openDocs([p], { tool: "review", run: "precheck" })),
    },
    {
      id: "write", icon: <FilePlus2 size={20} />, title: "새 공문 쓰기", need: "서식 하나 고르기", get: "기관 칸이 채워진 공문 서식",
      run: () => startCreate({ route: "library" }),
    },
    {
      id: "collect", icon: <Layers size={20} />, title: "부서 제출 문서 모으기", need: "부서들이 낸 파일이나 폴더", get: "엑셀 한 장과 미제출 부서 목록",
      run: () => startBatch({ paths: [], task: "collect" }),
    },
  ];
  const aiOff = !ai?.configured;

  return (
    <section className="kd-tasks" aria-labelledby="tasks-t">
      <h2 id="tasks-t" className="kd-tasks-h">자주 하는 일</h2>
      <div className="kd-tasks-row">
        {tasks.map((t) => (
          <button key={t.id} type="button" className="kd-task" data-task={t.id} onClick={t.run}>
            <span className="kd-task-icon" aria-hidden="true">{t.icon}</span>
            <span className="kd-task-title">{t.title}</span>
            <span className="kd-task-line"><span className="kd-task-k">준비물</span>{t.need}</span>
            <span className="kd-task-line"><span className="kd-task-k">결과</span>{t.get}</span>
            {t.ai && aiOff && <span className="kd-task-note">AI를 켜야 합니다</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
