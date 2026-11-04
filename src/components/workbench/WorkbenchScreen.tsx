/** 문서(작업대) — 연 문서 목록 · 쪽 미리보기 · 도구 패널(읽기·고치기·검토·내보내기) */

import { useEffect, useState } from "react";
import { FileUp, FilePen, FileStack, PanelLeftClose, PanelLeftOpen, X, BookOpenText, Reply } from "lucide-react";
import { useApp } from "../../state/app";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { FormatBadge } from "../common/FormatBadge";
import { Empty } from "../common/Status";
import { DocWorkspace } from "./DocWorkspace";
import { useLooksReceived } from "./docText";
import { useReply } from "./reply";
import { pickFiles } from "../../lib/native";
import { FORMAT_KIND, fileSize, isHangul, num, stem } from "../../lib/format";

export function WorkbenchScreen({ active }: { active: boolean }) {
  const { docs, activePath, setActive, closeDoc, openDocs, registerDrop, dragTarget, setBadge, startCreate, startPdf } = useApp();
  // 연 문서 목록: 사용자가 접거나 펴기 전에는 문서가 둘 이상일 때만 편다 (하나면 미리보기를 넓게)
  const [listPref, setListOpen] = useState<boolean | null>(null);
  const listOpen = listPref ?? docs.length > 1;
  const current = docs.find((d) => d.path === activePath) ?? null;
  // 쪽 그림 일꾼(rhwp WASM)·쪽 그림은 지금 문서와 바로 전 문서만 들고 있는다 (연 문서마다 남지 않게)
  const [prevPath, setPrevPath] = useState<string | null>(null);
  const [lastActive, setLastActive] = useState(activePath);
  if (activePath !== lastActive) { setPrevPath(lastActive); setLastActive(activePath); }

  useEffect(() => registerDrop("workbench", (paths) => openDocs(paths)), [registerDrop, openDocs]);
  useEffect(() => setBadge("workbench", docs.length ? String(docs.length) : undefined), [docs.length, setBadge]);

  const open = () => void pickFiles().then((p) => p.length && openDocs(p));
  const info = current?.info;
  // 머리에는 문서 열기와 이 문서에 맞는 주 행동 하나만. 나머지는 도구 탭 안에
  // (읽기: 최종본 찾기·AI에게 시키기, 고치기: 한글 편집기·PDF 쪽 정리). 다 읽기 전·암호를 묻는 중·못 연 문서는 info 가 없어 숨는다.
  // 암호 문서는 회신 초안·편집기가 아직 암호를 받지 못해 뺀다 (정보 탭에 안내)
  const received = useLooksReceived(current);
  const reply = useReply();
  const primary = !current || !info ? null
    : received && !info.encrypted
      ? { label: reply.aiOn ? "이 공문에 회신 쓰기" : "서식으로 회신 쓰기", icon: <Reply size={15} />, run: () => reply.start(current.path), tip: reply.tip }
      : isHangul(current.format) && !info.encrypted
        ? { label: "한글 편집기로 열기", icon: <FilePen size={15} />, run: () => startCreate({ path: current.path }), tip: "글·표·서식을 직접 고칩니다. 저장하기 전에는 파일이 바뀌지 않습니다." }
        : current.format === "pdf"
          ? { label: "쪽 정리·나누기", icon: <FileStack size={15} />, run: () => startPdf({ paths: [current.path] }), tip: "쪽을 빼고 돌리고 순서를 바꿔 새 PDF로 저장합니다. 원본은 그대로 둡니다." }
          : null;
  const sub = current
    ? [FORMAT_KIND[current.format], info?.page_count ? `${num(info.page_count)}쪽` : "", info?.size ? fileSize(info.size) : ""].filter(Boolean).join(" · ")
    : "문서를 열어 읽고, 고치고, 검토하고, 내보냅니다.";

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader
        title={current ? current.name : "문서 보기"}
        sub={sub}
        actions={(
          <>
            {primary && <Button onClick={primary.run} data-tip={primary.tip}>{primary.icon} {primary.label}</Button>}
            {docs.length > 0 && <Button variant={primary ? "ghost" : "secondary"} onClick={open} data-tip="다른 문서를 더 엽니다. 연 문서끼리는 왼쪽 목록에서 옮겨 다닙니다."><FileUp size={15} /> 문서 열기</Button>}
          </>
        )}
      />
      {docs.length === 0 ? (
        <div className="kd-body kd-dropzone m-6" data-drop="workbench" data-over={dragTarget === "workbench"}>
          <Empty icon={<BookOpenText size={30} />} title="열린 문서 없음" action={<Button size="lg" onClick={open}><FileUp size={15} /> 문서 열기</Button>}>
            파일을 여기에 끌어다 놓아도 됩니다.
          </Empty>
        </div>
      ) : (
        <div className="kd-wb" data-list={listOpen}>
          {listOpen && (
            <aside className="kd-doclist" aria-label="연 문서">
              <div className="kd-doclist-head">
                <span className="kd-label">연 문서 {docs.length}</span>
                <button type="button" className="kd-icon-btn" onClick={() => setListOpen(false)} aria-label="연 문서 목록 접기"><PanelLeftClose size={15} /></button>
              </div>
              <ul className="kd-doclist-items">
                {docs.map((d) => (
                  <li key={d.path} className="kd-docitem" aria-current={d.path === activePath ? "true" : undefined}>
                    <button type="button" className="kd-docitem-main" onClick={() => setActive(d.path)}>
                      <FormatBadge format={d.format} />
                      <span className="min-w-0">
                        <span className="kd-docitem-name" title={d.name}>{stem(d.name)}</span>
                        <span className="kd-row-desc block">{d.info?.page_count ? `${num(d.info.page_count)}쪽` : FORMAT_KIND[d.format]}</span>
                      </span>
                    </button>
                    <button type="button" className="kd-icon-btn kd-docitem-x" onClick={() => closeDoc(d.path)} aria-label={`${d.name} 닫기`}><X size={14} /></button>
                  </li>
                ))}
              </ul>
              <div className="kd-doclist-foot" data-drop="workbench">
                <Button variant="ghost" size="sm" onClick={open} className="w-full"><FileUp size={13} /> 더 열기</Button>
              </div>
            </aside>
          )}
          <div className="kd-wb-main">
            {!listOpen && (
              <button type="button" className="kd-icon-btn kd-list-reopen" onClick={() => setListOpen(true)} aria-label={`연 문서 목록 펼치기 (${docs.length}개)`}><PanelLeftOpen size={15} /></button>
            )}
            {docs.map((d) => <DocWorkspace key={d.path} doc={d} active={active && d.path === activePath} hidden={d.path !== activePath} live={d.path === activePath || d.path === prevPath} />)}
          </div>
        </div>
      )}
    </div>
  );
}
