/**
 * 빠른 작업 — 기능 이름 대신 하려는 일로 바로 시작한다 (이름 + 짧은 한 줄, 자세한 설명은 툴팁).
 * 쉬운 화면은 아홉 가지를 큰 카드로(3×3), 전체 화면은 여섯 가지를 촘촘하게(나머지는 "모든 기능" 목차).
 * 합치기·나누기는 형식을 묻지 않는다: 파일을 두 개 이상 고르면 합치기, 하나면 나누기. 한글끼리는 HWPX로, 섞이면 PDF로(여러 파일 한꺼번에가 판정).
 */

import type { ReactNode } from "react";
import { ClipboardCheck, EyeOff, FilePlus2, FileOutput, FileType2, Layers, Combine, ReceiptText, Reply } from "lucide-react";
import { useApp } from "../../state/app";
import { FILTERS, pickFiles } from "../../lib/native";
import "./home.css";

interface Task { id: string; icon: ReactNode; title: string; sub: string; tip: string; ai?: boolean; easyOnly?: boolean; run: () => void }

export function HomeTasks() {
  const { ai, openDocs, startCreate, startBatch, uiMode } = useApp();
  const easy = uiMode === "easy";
  const pickOne = async (fn: (path: string) => void) => {
    const [p] = await pickFiles({ multiple: false });
    if (p) fn(p);
  };
  const tasks: Task[] = [
    {
      id: "write", icon: <FilePlus2 size={20} />, title: "공문 작성", sub: "서식 선택 · 기관 정보 자동 입력",
      tip: "서식함에서 서식을 고르면 기관명·부서·담당자 칸을 채워 한글 편집기로 엽니다",
      run: () => startCreate({ route: "library" }),
    },
    {
      id: "reply", icon: <Reply size={20} />, title: "회신 작성", sub: "받은 공문 → 회신 초안", ai: true,
      tip: "받은 공문을 고르면 AI가 요청 사항을 읽고 회신 기안문 초안을 한글 파일로 만듭니다",
      run: () => void pickOne((p) => startCreate({ route: "ai", kind: "reply", references: [p] })),
    },
    {
      id: "check", icon: <ClipboardCheck size={20} />, title: "결재 전 점검", sub: "표기법 · 날짜 · 합계 · 개인정보",
      tip: "쓴 문서를 고르면 공문서 표기법, 날짜와 요일, 표 합계, 개인정보를 점검해 고칠 곳을 보입니다",
      run: () => void pickOne((p) => openDocs([p], { tool: "review", run: "precheck" })),
    },
    {
      id: "topdf", icon: <FileOutput size={20} />, title: "PDF 변환", sub: "한글 · 워드 · 엑셀 · 그림", easyOnly: true,
      tip: "고른 파일을 인쇄 모양 그대로 PDF로 저장합니다. 원본은 그대로 둡니다",
      run: () => void pickFiles().then((p) => p.length && startBatch({ paths: p, task: "pdf" })),
    },
    {
      id: "join", icon: <Combine size={20} />, title: "합치기 · 나누기", sub: "한글은 HWPX로 · PDF는 PDF로",
      tip: "파일을 두 개 이상 고르면 하나로 합치고, 하나만 고르면 나눕니다. 한글 문서끼리는 서식 그대로 HWPX 한 파일, 다른 형식이 섞이면 PDF 한 권으로 만듭니다",
      run: () => void pickFiles().then((p) => p.length && startBatch({ paths: p, task: p.length > 1 ? "join" : "split" })),
    },
    {
      id: "tohwp", icon: <FileType2 size={20} />, title: "한글 변환", sub: "PDF · 워드 · 스캔본 → HWPX",
      tip: "PDF·워드·엑셀·스캔본을 고쳐 쓸 수 있는 한글 문서(HWPX)로 바꿉니다",
      run: () => startCreate({ route: "convert" }),
    },
    {
      id: "redact", icon: <EyeOff size={20} />, title: "개인정보 가리기", sub: "주민번호 · 연락처 · 계좌", easyOnly: true,
      tip: "공개할 문서에서 주민등록번호·전화번호·계좌번호 등을 찾아 가린 사본을 만듭니다",
      run: () => void pickOne((p) => openDocs([p], { tool: "redact", run: "redact" })),
    },
    {
      id: "collect", icon: <Layers size={20} />, title: "제출물 취합", sub: "부서 제출물 → 엑셀 한 장",
      tip: "부서들이 낸 파일이나 폴더를 넣으면 엑셀 한 장으로 모으고, 안 낸 부서와 독촉 글까지 만듭니다",
      run: () => startBatch({ paths: [], task: "collect" }),
    },
    {
      id: "receipt", icon: <ReceiptText size={20} />, title: "영수증 → 지출조서", sub: "사진·PDF → 지출조서 · 표 복사", easyOnly: true,
      tip: "영수증 사진이나 PDF를 고르면 이 PC에서 글자를 읽어 날짜·거래처·금액을 뽑고, 고친 뒤 지출조서 한글 파일과 붙여 넣을 표를 만듭니다",
      run: () => void pickFiles({ filters: FILTERS.receipt }).then((p) => p.length && startBatch({ paths: p, task: "receipt", autoRun: true })),
    },
  ].filter((t) => easy || !t.easyOnly);
  const aiOff = !ai?.configured;

  return (
    <section className="kd-tasks" data-size={easy ? "lg" : "md"} data-count={tasks.length} aria-labelledby="tasks-t">
      <h2 id="tasks-t" className="kd-tasks-h">빠른 작업</h2>
      <div className="kd-tasks-row">
        {tasks.map((t) => (
          <button key={t.id} type="button" className="kd-task" data-task={t.id} onClick={t.run} data-tip={t.tip}>
            <span className="kd-task-icon" aria-hidden="true">{t.icon}</span>
            <span className="kd-task-title">{t.title}{t.ai && aiOff && <span className="kd-badge kd-task-ai" data-tone="warn">AI 필요</span>}</span>
            <span className="kd-task-sub">{t.sub}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
