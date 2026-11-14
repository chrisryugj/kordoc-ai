import { memo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Copy, Check, Sparkles, MessageSquareText } from "lucide-react";
import { Button } from "./Button";
import { Seg } from "../common/Field";
import { Tooltip } from "./Tooltip";
import { showMenu } from "./menu";
import { useAsk } from "./useAsk";
import { openExternal } from "../../lib/native";
import { displayHref, isExternalHref, linkMismatch, showsOwnHref } from "../../lib/links";
// "글만" 저장과 같은 변환 (엔진 정본, 의존 없는 순수 함수): 표시를 걷고 표는 탭으로 이은 줄
import { markdownToPlain } from "../../../node-sidecar/src/core/converter/plain";

interface MarkdownViewerProps {
  markdown: string;
  onSummarize?: () => void;
  isSummarizing?: boolean;
  maxHeight?: number;
  /** true이면 maxHeight 무시, 부모 flex 컨테이너 높이를 채움 */
  fillHeight?: boolean;
  /** 글 파일(.txt 등): 마크다운으로 해석하지 않고 그대로 보인다 */
  plain?: boolean;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col", "br",
  ],
  attributes: {
    ...defaultSchema.attributes,
    th: [...(defaultSchema.attributes?.th ?? []), "colSpan", "rowSpan", "colspan", "rowspan"],
    td: [...(defaultSchema.attributes?.td ?? []), "colSpan", "rowSpan", "colspan", "rowspan"],
  },
};
// 그릴 때마다 새 배열을 주면 react-markdown 이 처리기를 다시 만든다
const REMARK = [remarkGfm];
const REHYPE: React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"] = [rehypeRaw, [rehypeSanitize, sanitizeSchema]];

export function MarkdownViewer({ markdown, onSummarize, isSummarizing, maxHeight = 500, fillHeight, plain }: MarkdownViewerProps) {
  const [view, setView] = useState<"rendered" | "source">("rendered");
  const [copied, setCopied] = useState<"" | "md" | "plain">("");

  const handleCopy = useCallback(async (kind: "md" | "plain") => {
    // 메신저용: 마크다운 표시(#·|·**·\~)를 걷고 표는 칸을 탭으로 이은 줄로. 글 파일은 이미 꾸밈이 없다
    await copyText(kind === "plain" && !plain ? markdownToPlain(markdown) : markdown);
    setCopied(kind);
    setTimeout(() => setCopied(""), 2000);
  }, [markdown, plain]);

  // 문서 속 링크: 글이 곧 그 주소면 바로 열고, 아니면 실제로 갈 주소를 보이고 묻는다 (밖에서 온 문서의 링크는 글과 다른 곳으로 갈 수 있다)
  const { ask, dialog } = useAsk();
  const openLink = useCallback(async (href: string | undefined, text: string) => {
    if (!isExternalHref(href)) return;
    if (showsOwnHref(text, href)) { void openExternal(href); return; }
    const fake = linkMismatch(text, href);
    const a = await ask({
      title: fake ? "보이는 주소와 다른 링크" : "링크 열기",
      body: (
        <div className="flex flex-col gap-2">
          <p className="kd-text">{fake
            ? <>링크 글에 보이는 곳은 <b>{fake.shown}</b>인데 실제로는 아래 주소({fake.real})로 갑니다. 속이는 링크일 수 있으니 문서를 보낸 곳에 확인한 뒤 여세요.</>
            : /^mailto:/i.test(href) ? "메일 프로그램으로 아래 주소에 보낼 메일을 엽니다." : "기본 브라우저로 아래 주소를 엽니다. 믿을 수 있는 곳인지 확인한 뒤 여세요."}</p>
          <p className="kd-inset kd-small px-3 py-2" style={{ overflowWrap: "anywhere" }}>{displayHref(href)}</p>
        </div>
      ),
      choices: [{ id: "cancel", label: "취소", variant: "ghost" }, { id: "open", label: fake ? "그래도 열기" : "열기" }],
    });
    if (a === "open") void openExternal(href);
  }, [ask]);

  if (!markdown) return null;

  return (
    <div className={`card overflow-hidden${fillHeight ? " flex flex-col flex-1 min-h-0" : ""}`}>
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-1">
          {/* 보기 바꾸기는 앱의 다른 갈래 고르기와 같은 부품 (고른 칸 표시·누름 크기·화면 읽기 상태가 같다) */}
          {plain ? <span className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>글 파일 그대로</span> : (
            <Seg label="글 보기 방식" value={view} onChange={setView} options={[{ value: "rendered", label: "미리보기" }, { value: "source", label: "원문" }]} />
          )}
        </div>

        <div className="flex items-center gap-2">
          <Tooltip content="메신저·메일에 붙이기 좋게 표시 없이 복사합니다. 표는 칸마다 탭으로 나눕니다">
          <Button variant="ghost" size="sm" onClick={() => void handleCopy("plain")}>
            <span className="flex items-center gap-1">
              {copied === "plain" ? <><Check size={13} /> 복사됨</> : <><MessageSquareText size={13} /> 메신저용 복사</>}
            </span>
          </Button>
          </Tooltip>
          {!plain && (
          <Tooltip content="#·| 같은 표시가 붙은 마크다운 글 그대로 복사">
          <Button variant="ghost" size="sm" onClick={() => void handleCopy("md")}>
            <span className="flex items-center gap-1">
              {copied === "md" ? <><Check size={13} /> 복사됨</> : <><Copy size={13} /> 글(마크다운) 복사</>}
            </span>
          </Button>
          </Tooltip>
          )}
          {onSummarize && (
            <Tooltip content="AI로 핵심 내용 요약">
            <Button variant="secondary" size="sm" onClick={onSummarize} disabled={isSummarizing}>
              <span className="flex items-center gap-1">
                {isSummarizing ? (
                  <><span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> 요약하는 중</>
                ) : (
                  <><Sparkles size={13} /> AI 요약</>
                )}
              </span>
            </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className={`overflow-y-auto${fillHeight ? " flex-1 min-h-0" : ""}`}
        style={fillHeight ? undefined : { maxHeight }}
        onContextMenu={(e) => {
          const picked = window.getSelection()?.toString() ?? "";
          showMenu(e, [
            { label: "고른 글 복사", icon: <Copy size={14} />, shortcut: "Ctrl+C", disabled: !picked.trim(), hint: picked.trim() ? undefined : "먼저 글을 끌어서 고르세요", onClick: () => void copyText(picked) },
            { type: "separator" },
            { label: "글 전체 복사", icon: <MessageSquareText size={14} />, onClick: () => void handleCopy("plain") },
            ...(plain ? [] : [{ label: "글(마크다운) 전체 복사", onClick: () => void handleCopy("md") }]),
          ], { label: "본문 메뉴" });
        }}
      >
        {plain ? (
          <pre className="p-5 ts-sm whitespace-pre-wrap" style={{ color: "var(--color-text-secondary)", fontFamily: "inherit", lineHeight: 1.7, overflowWrap: "anywhere" }}>{markdown}</pre>
        ) : view === "rendered" ? (
          <div className="markdown-body p-5 ts-sm">
            <Rendered markdown={markdown} onLink={openLink} />
          </div>
        ) : (
          <pre
            className="p-5 ts-2xs text-mono whitespace-pre-wrap overflow-x-auto"
            style={{ color: "var(--color-text-secondary)", backgroundColor: "var(--color-bg-primary)" }}
          >
            {markdown}
          </pre>
        )}
      </div>
      {dialog}
    </div>
  );
}

/** 마크다운을 그린 본문 — 글이 바뀔 때만 다시 푼다. 긴 문서는 푸는 데 오래 걸려, 복사됨 표시나 메뉴 같은 작은 변화마다 다시 풀면 화면이 버벅인다.
 *  onLink: 링크를 눌렀을 때 (주소, 보이는 글). 바뀌지 않는 함수를 넘겨야 다시 풀지 않는다 */
const Rendered = memo(function Rendered({ markdown, onLink }: { markdown: string; onLink: (href: string | undefined, text: string) => void }) {
  return (
            <ReactMarkdown
              remarkPlugins={REMARK}
              rehypePlugins={REHYPE}
              components={{
                h1: (props) => <h1 style={{ fontSize: "var(--fs-h2)", fontWeight: 700, marginTop: "0.8em", marginBottom: "0.4em", color: "var(--color-text-primary)" }} {...props} />,
                h2: (props) => <h2 style={{ fontSize: "var(--fs-h3)", fontWeight: 700, marginTop: "0.7em", marginBottom: "0.3em", color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", paddingBottom: "0.2em" }} {...props} />,
                h3: (props) => <h3 style={{ fontSize: "var(--fs-body)", fontWeight: 700, marginTop: "0.6em", marginBottom: "0.2em", color: "var(--color-text-primary)" }} {...props} />,
                p: (props) => <p style={{ marginBottom: "0.75em", lineHeight: "1.7", color: "var(--color-text-secondary)", whiteSpace: "pre-line" }} {...props} />,
                ul: (props) => <ul style={{ marginLeft: "1.5em", marginBottom: "0.75em", listStyleType: "disc", color: "var(--color-text-secondary)" }} {...props} />,
                ol: (props) => <ol style={{ marginLeft: "1.5em", marginBottom: "0.75em", listStyleType: "decimal", color: "var(--color-text-secondary)" }} {...props} />,
                li: (props) => <li style={{ marginBottom: "0.25em", lineHeight: "1.6", whiteSpace: "pre-line" }} {...props} />,
                table: (props) => (
                  <div style={{ overflowX: "auto", marginBottom: "1em" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--fs-small)" }} {...props} />
                  </div>
                ),
                thead: (props) => <thead style={{ backgroundColor: "var(--color-bg-tertiary)" }} {...props} />,
                th: (props) => <th style={{ border: "1px solid var(--color-border)", padding: "0.5em 0.75em", fontWeight: 600, textAlign: "left", color: "var(--color-text-primary)", whiteSpace: "nowrap" }} {...props} />,
                td: (props) => <td style={{ border: "1px solid var(--color-border)", padding: "0.5em 0.75em", color: "var(--color-text-secondary)" }} {...props} />,
                code: ({ className, children, ...props }) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return (
                      <pre style={{ backgroundColor: "var(--color-bg-tertiary)", padding: "1em", borderRadius: "6px", overflow: "auto", marginBottom: "1em", fontSize: "var(--fs-small)" }}>
                        <code className={className} style={{ fontFamily: "var(--font-mono)" }} {...props}>{children}</code>
                      </pre>
                    );
                  }
                  return <code style={{ backgroundColor: "var(--color-bg-tertiary)", padding: "0.15em 0.35em", borderRadius: "3px", fontFamily: "var(--font-mono)", fontSize: "0.9em", color: "var(--color-accent)" }} {...props}>{children}</code>;
                },
                pre: (props) => <>{props.children}</>,
                blockquote: (props) => <blockquote style={{ borderLeft: "3px solid var(--color-accent)", paddingLeft: "1em", margin: "0.75em 0", color: "var(--color-text-muted)", fontStyle: "italic" }} {...props} />,
                hr: () => <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "1.5em 0" }} />,
                // 말풍선에 실제로 갈 주소 (링크 글만 보고 누르지 않게)
                a: ({ href, ...props }) => <a style={{ color: "var(--color-accent)", textDecoration: "underline" }} href={href} {...props}
                  data-tip={isExternalHref(href) ? [props.title, displayHref(href)].filter(Boolean).join(" · ") : undefined}
                  onClick={(e) => { e.preventDefault(); onLink(href, e.currentTarget.textContent ?? ""); }} />,
                strong: (props) => <strong style={{ fontWeight: 600, color: "var(--color-text-primary)" }} {...props} />,
              }}
            >
              {markdown}
            </ReactMarkdown>
  );
});
