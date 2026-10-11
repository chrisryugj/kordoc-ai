/** 작업대 — 연 문서 목록 · 쪽 미리보기 · 도구 패널 */

import { useEffect, useState } from "react";
import { FileUp, FilePen, PanelLeftClose, PanelLeftOpen, X, BookOpenText, Reply } from "lucide-react";
import { useApp } from "../../state/app";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { FormatBadge } from "../common/FormatBadge";
import { Empty } from "../common/Status";
import { DocWorkspace } from "./DocWorkspace";
import { pickFiles } from "../../lib/native";
import { FORMAT_KIND, fileSize, isHangul, num, stem } from "../../lib/format";

export function WorkbenchScreen({ active }: { active: boolean }) {
  const { docs, activePath, setActive, closeDoc, openDocs, registerDrop, dragTarget, setBadge, startCreate } = useApp();
  const [listOpen, setListOpen] = useState(true);
  const current = docs.find((d) => d.path === activePath) ?? null;
  // 쪽 그림 일꾼(rhwp WASM)·쪽 그림은 지금 문서와 바로 전 문서만 들고 있는다 (연 문서마다 남지 않게)
  const [prevPath, setPrevPath] = useState<string | null>(null);
  const [lastActive, setLastActive] = useState(activePath);
  if (activePath !== lastActive) { setPrevPath(lastActive); setLastActive(activePath); }

  useEffect(() => registerDrop("workbench", (paths) => openDocs(paths)), [registerDrop, openDocs]);
  useEffect(() => setBadge("workbench", docs.length ? String(docs.length) : undefined), [docs.length, setBadge]);

  const open = () => void pickFiles().then((p) => p.length && openDocs(p));
  const info = current?.info;
  const sub = current
    ? [FORMAT_KIND[current.format], info?.page_count ? `${num(info.page_count)}쪽` : "", info?.size ? fileSize(info.size) : ""].filter(Boolean).join(" · ")
    : "문서를 열어 보고 바꾸고 검토하고 고칩니다.";

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader
        title={current ? current.name : "작업대"}
        sub={sub}
        actions={(
          <>
            {/* 암호 문서는 회신 초안·편집기가 아직 암호를 받지 못해 숨긴다 (정보 탭에 안내) */}
            {current && !info?.encrypted && <Button variant="secondary" onClick={() => startCreate({ route: "ai", kind: "reply", references: [current.path] })}><Reply size={15} /> 이 공문에 회신 쓰기</Button>}
            {current && isHangul(current.format) && !info?.encrypted && <Button variant="secondary" onClick={() => startCreate({ path: current.path })}><FilePen size={15} /> 한글 편집기로 열기</Button>}
            <Button variant="secondary" onClick={open}><FileUp size={15} /> 문서 열기</Button>
          </>
        )}
      />
      {docs.length === 0 ? (
        <div className="kd-body kd-dropzone m-6" data-drop="workbench" data-over={dragTarget === "workbench"}>
          <Empty icon={<BookOpenText size={30} />} title="열린 문서가 없습니다" action={<Button size="lg" onClick={open}><FileUp size={15} /> 문서 열기</Button>}>
            문서를 이 화면에 끌어다 놓거나 문서 열기를 누르세요. 여러 개를 열어 두고 옮겨 다녀도 됩니다.
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
              <button type="button" className="kd-icon-btn kd-list-reopen" onClick={() => setListOpen(true)} aria-label="연 문서 목록 펼치기"><PanelLeftOpen size={15} /></button>
            )}
            {docs.map((d) => <DocWorkspace key={d.path} doc={d} active={active && d.path === activePath} hidden={d.path !== activePath} live={d.path === activePath || d.path === prevPath} />)}
          </div>
        </div>
      )}
    </div>
  );
}
