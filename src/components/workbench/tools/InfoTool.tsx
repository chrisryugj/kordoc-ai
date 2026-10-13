/** 정보 — 형식·쪽수·만든 사람 + 글자 수 통계(공백 포함·제외, 원고지 200자 매수). 받은 공문이면 접수함에 넣기.
 *  쪽수는 미리보기가 센 값(rhwp, DocWorkspace 가 info 에 맞춰 둔다) 하나만 쓴다 */

import { useEffect } from "react";
import { Calculator } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import { rpc } from "../../../lib/rpc";
import { FORMAT_KIND, FORMAT_LABEL, charStats, fileSize, num } from "../../../lib/format";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { ErrorLine, Note, Working } from "../../common/Status";
import { FollowUp } from "./FollowUp";
import { docText, useLooksReceived } from "../docText";

/** 이만큼 작은 문서만 열자마자 센다. 큰 문서는 글을 다 뽑느라 엔진을 오래 붙잡아(800쪽 PDF 약 45초) 다른 작업이 밀리므로 단추로 */
const AUTO_PAGES = 30;
/** 쪽 구분이 없는 문서(엑셀·워드·글 파일)는 파일 크기로 */
const AUTO_BYTES = 2 * 1024 * 1024;

function when(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

export function InfoTool({ doc, info }: ToolProps) {
  const stats = useTask<ReturnType<typeof charStats>>();
  // 스캔한 쪽이 있으면 세면서 글자 읽기(OCR)까지 돌아 오래 걸리니 단추로
  const auto = !info.needs_ocr && (info.page_count ? info.page_count <= AUTO_PAGES : info.size <= AUTO_BYTES);

  const received = useLooksReceived(doc);
  // 글자만 센다: 파일로 저장하지 않는다 (저장하면 문서를 열 때마다 원본 옆에 사본이 생긴다).
  // 작은 문서는 받은 공문 알아보기와 같은 글을 나눠 쓰고, 큰 문서는 누를 때만 (멈추기 되게 따로)
  const count = () => void stats.run(async ({ signal }) => {
    if (auto) return charStats(await docText(doc, info));
    const r = await rpc("convert", { path: doc.path, format: "txt", save: false, ...(doc.password ? { password: doc.password } : {}) }, { signal });
    return charStats(r.content);
  });

  useEffect(() => {
    if (auto) count();
    // 문서마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path]);

  const rows: Array<[string, string]> = [
    ["형식", `${FORMAT_KIND[info.format]} (${FORMAT_LABEL[info.format]})`],
    ["쪽수", info.page_count ? `${num(info.page_count)}쪽` : "쪽 구분 없음"],
    ["크기", fileSize(info.size)],
    ["제목", info.title ?? ""],
    // 한글 편집기(rhwp)로 저장한 문서는 작성자 자리에 편집기 이름이 들어간다
    ["작성자", info.author && !/^rhwp/i.test(info.author.trim()) ? info.author.trim() : ""],
    ["만든 날", when(info.created)],
    ["고친 날", when(info.modified)],
  ];

  return (
    <div className="flex flex-col gap-5">
      {received && <FollowUp doc={doc} />}
      <dl className="kd-dl">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>

      <div>
        <h3 className="kd-label mb-2">글자 수</h3>
        {stats.busy ? <Working label="글자를 세는 중" onCancel={stats.cancel} /> : !stats.result && (!auto || stats.error) && (
          <div className="flex flex-col items-start gap-1.5">
            <Button variant="secondary" size="sm" onClick={count}><Calculator size={13} /> 글자 수 세기</Button>
            {!auto && <span className="kd-small kd-muted">{info.needs_ocr ? "스캔한 쪽이 있어 누를 때만 셉니다. 글자 읽기까지 하느라 오래 걸릴 수 있습니다." : "큰 문서라 누를 때만 셉니다. 세는 동안 다른 작업이 늦어질 수 있습니다."}</span>}
          </div>
        )}
        <ErrorLine message={stats.error} />
        {stats.result && (
          <dl className="kd-stats">
            <div><dt>공백 포함</dt><dd className="kd-num">{num(stats.result.withSpaces)}자</dd></div>
            <div><dt>공백 제외</dt><dd className="kd-num">{num(stats.result.noSpaces)}자</dd></div>
            <div><dt>원고지(200자)</dt><dd className="kd-num">약 {num(stats.result.manuscript)}매</dd></div>
            <div><dt>쪽수</dt><dd className="kd-num">{info.page_count ? `${num(info.page_count)}쪽` : "없음"}</dd></div>
          </dl>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {info.encrypted && <Note tone="info">암호가 걸린 문서라 보기·글자 수·글로 내보내기만 됩니다. AI·검토·개인정보·표 같은 도구는 암호를 푼 사본을 저장해 열면 씁니다. 넣은 암호는 이 화면을 닫으면 잊습니다.</Note>}
        {info.needs_ocr && <Note tone="info">스캔한 쪽이 있습니다. 가운데 미리보기 위의 글자 읽기를 누르면 글로 바꿉니다.</Note>}
        {info.warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
      </div>
    </div>
  );
}
