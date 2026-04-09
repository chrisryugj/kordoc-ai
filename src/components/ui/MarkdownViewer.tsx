import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Copy, Check, Eye, Code, Sparkles } from "lucide-react";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { ContextMenu } from "./ContextMenu";

interface MarkdownViewerProps {
  markdown: string;
  onSummarize?: () => void;
  isSummarizing?: boolean;
  maxHeight?: number;
  /** true이면 maxHeight 무시, 부모 flex 컨테이너 높이를 채움 */
  fillHeight?: boolean;
}

export function MarkdownViewer({ markdown, onSummarize, isSummarizing, maxHeight = 500, fillHeight }: MarkdownViewerProps) {
  const [view, setView] = useState<"rendered" | "source">("rendered");
  const [copied, setCopied] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string } | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = markdown;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [markdown]);

  if (!markdown) return null;

  return (
    <div className={`card overflow-hidden${fillHeight ? " flex flex-col flex-1 min-h-0" : ""}`}>
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView("rendered")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md ts-2xs font-semibold transition-colors"
            style={{
              backgroundColor: view === "rendered" ? "var(--color-accent-subtle)" : "transparent",
              color: view === "rendered" ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
          >
            <Eye size={13} /> 미리보기
          </button>
          <button
            type="button"
            onClick={() => setView("source")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md ts-2xs font-semibold transition-colors"
            style={{
              backgroundColor: view === "source" ? "var(--color-accent-subtle)" : "transparent",
              color: view === "source" ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
          >
            <Code size={13} /> 소스
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
            {markdown.length.toLocaleString()}자
          </span>
          <Tooltip content="마크다운 원본을 클립보드에 복사">
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            <span className="flex items-center gap-1">
              {copied ? <><Check size={13} /> 복사됨</> : <><Copy size={13} /> 복사</>}
            </span>
          </Button>
          </Tooltip>
          {onSummarize && (
            <Tooltip content="Gemini AI로 핵심 내용 요약 (온라인 모드 필요)">
            <Button variant="secondary" size="sm" onClick={onSummarize} disabled={isSummarizing}>
              <span className="flex items-center gap-1">
                {isSummarizing ? (
                  <><span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> 요약 중...</>
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
          const sel = window.getSelection()?.toString();
          if (sel && sel.trim()) {
            e.preventDefault();
            e.stopPropagation();
            setCtxMenu({ x: e.clientX, y: e.clientY, text: sel });
          }
        }}
      >
        {view === "rendered" ? (
          <div className="markdown-body p-5 ts-sm">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              rehypePlugins={[[rehypeSanitize, {
                ...defaultSchema,
                tagNames: [...(defaultSchema.tagNames ?? []), "br"],
              }]]}
              components={{
                h1: (props) => <h1 style={{ fontSize: "1.5em", fontWeight: "bold", marginTop: "0.8em", marginBottom: "0.4em", color: "var(--color-text-primary)" }} {...props} />,
                h2: (props) => <h2 style={{ fontSize: "1.3em", fontWeight: "bold", marginTop: "0.7em", marginBottom: "0.3em", color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", paddingBottom: "0.2em" }} {...props} />,
                h3: (props) => <h3 style={{ fontSize: "1.1em", fontWeight: "bold", marginTop: "0.6em", marginBottom: "0.2em", color: "var(--color-text-primary)" }} {...props} />,
                p: (props) => <p style={{ marginBottom: "0.75em", lineHeight: "1.7", color: "var(--color-text-secondary)" }} {...props} />,
                ul: (props) => <ul style={{ marginLeft: "1.5em", marginBottom: "0.75em", listStyleType: "disc", color: "var(--color-text-secondary)" }} {...props} />,
                ol: (props) => <ol style={{ marginLeft: "1.5em", marginBottom: "0.75em", listStyleType: "decimal", color: "var(--color-text-secondary)" }} {...props} />,
                li: (props) => <li style={{ marginBottom: "0.25em", lineHeight: "1.6" }} {...props} />,
                table: (props) => (
                  <div style={{ overflowX: "auto", marginBottom: "1em" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.875em" }} {...props} />
                  </div>
                ),
                thead: (props) => <thead style={{ backgroundColor: "var(--color-bg-tertiary)" }} {...props} />,
                th: (props) => <th style={{ border: "1px solid var(--color-border)", padding: "0.5em 0.75em", fontWeight: 600, textAlign: "left", color: "var(--color-text-primary)", whiteSpace: "nowrap" }} {...props} />,
                td: (props) => <td style={{ border: "1px solid var(--color-border)", padding: "0.5em 0.75em", color: "var(--color-text-secondary)" }} {...props} />,
                code: ({ className, children, ...props }) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return (
                      <pre style={{ backgroundColor: "var(--color-bg-tertiary)", padding: "1em", borderRadius: "6px", overflow: "auto", marginBottom: "1em", fontSize: "0.9em" }}>
                        <code className={className} style={{ fontFamily: "var(--font-mono)" }} {...props}>{children}</code>
                      </pre>
                    );
                  }
                  return <code style={{ backgroundColor: "var(--color-bg-tertiary)", padding: "0.15em 0.35em", borderRadius: "3px", fontFamily: "var(--font-mono)", fontSize: "0.9em", color: "var(--color-accent)" }} {...props}>{children}</code>;
                },
                pre: (props) => <>{props.children}</>,
                blockquote: (props) => <blockquote style={{ borderLeft: "3px solid var(--color-accent)", paddingLeft: "1em", margin: "0.75em 0", color: "var(--color-text-muted)", fontStyle: "italic" }} {...props} />,
                hr: () => <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "1.5em 0" }} />,
                a: (props) => <a style={{ color: "var(--color-accent)", textDecoration: "underline" }} {...props} />,
                strong: (props) => <strong style={{ fontWeight: 600, color: "var(--color-text-primary)" }} {...props} />,
              }}
            >
              {markdown}
            </ReactMarkdown>
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

      {ctxMenu && (
        <ContextMenu
          position={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: "선택 텍스트 복사", icon: <Copy size={13} />, onClick: () => { navigator.clipboard.writeText(ctxMenu.text); } },
          ]}
        />
      )}
    </div>
  );
}
