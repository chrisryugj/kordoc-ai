/**
 * 홈 맨 위 — "무엇을 할까요?" 입력창. 문서를 홈 어디에 놓아도 여기 붙고, 보내면 새 대화를 열어 AI 대화 화면으로 넘어간다.
 * 시켜 볼 문장 칩은 AI 대화 화면의 빈 대화에만 둔다(홈은 할 일 카드와 겹침).
 */

import { useState } from "react";
import { BookOpenText, History } from "lucide-react";
import { useApp } from "../../state/app";
import { useChats } from "../../state/chats";
import { AgentComposer } from "../agent/AgentComposer";
import { Button } from "../ui/Button";

export function HomeAgent() {
  const { openDocs, go } = useApp();
  const chat = useChats();
  const [paths, setPaths] = useState<string[]>([]);

  const send = (text: string) => {
    void chat.start(text, paths);
    setPaths([]);
    go("chat");
  };

  return (
    <section className="kd-home-ask" aria-labelledby="home-ask-t">
      <div className="kd-home-top">
        <h1 id="home-ask-t" className="kd-home-h">AI에게 맡기기</h1>
        <span className="kd-home-meta">결과는 새 파일로 저장 · 원본은 그대로</span>
      </div>
      <AgentComposer
        paths={paths}
        onPaths={setPaths}
        onSend={send}
        onStop={chat.stop}
        busy={false}
        locked={chat.busy}
        onLockedOpen={() => { if (chat.runningId) chat.openChat(chat.runningId); go("chat"); }}
        dropName="home"
        offHint="AI 없이 쓰는 기능은 아래 빠른 작업에서."
        extra={<Button size="sm" variant="ghost" onClick={() => openDocs(paths)}><BookOpenText size={14} /> 문서 화면에서 보기</Button>}
      />
      {chat.chats.length > 0 && (
        <button type="button" className="kd-home-resume" onClick={() => { chat.openChat(chat.chats[0].id); go("chat"); }}>
          <History size={15} />
          <span>최근 대화 이어 하기: <b>{chat.chats[0].title}</b></span>
        </button>
      )}
    </section>
  );
}
