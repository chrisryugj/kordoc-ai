/**
 * 도움말 — 사용설명서(docs/manual/*.md)를 앱 안에서 읽는다. 왼쪽은 장 목차와 찾기, 오른쪽은 본문.
 * 설명서 그림은 docs/manual/img 에 두고 본문에서 `img/파일.png` 로 부른다. 앱에 함께 묶여 폐쇄망에서도 열린다.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Search, X } from "lucide-react";
import { ScreenHeader } from "../shell/ScreenHeader";
import "./help.css";

const PAGES = import.meta.glob("../../../docs/manual/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const IMAGES = import.meta.glob("../../../docs/manual/img/*", { query: "?url", import: "default", eager: true }) as Record<string, string>;

interface Chapter { id: string; title: string; body: string; heads: string[] }

const CHAPTERS: Chapter[] = Object.entries(PAGES)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, body]) => {
    const id = path.split("/").pop()!.replace(/\.md$/, "");
    const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id;
    const heads = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
    return { id, title, body, heads };
  });

const imageUrl = (src = "") => {
  const name = src.replace(/^\.?\/?img\//, "");
  return IMAGES[`../../../docs/manual/img/${name}`] ?? src;
};

const slug = (s: string) => s.replace(/\s+/g, "-");

export function HelpScreen({ active }: { active: boolean }) {
  const [cur, setCur] = useState(CHAPTERS[0]?.id ?? "");
  const [q, setQ] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const chapter = CHAPTERS.find((c) => c.id === cur) ?? CHAPTERS[0];

  const hits = useMemo(() => {
    const t = q.trim();
    if (!t) return null;
    return CHAPTERS.filter((c) => c.body.includes(t)).map((c) => {
      const i = c.body.indexOf(t);
      const line = c.body.slice(Math.max(0, i - 30), i + t.length + 40).replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim();
      return { c, line };
    });
  }, [q]);

  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [cur]);

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="도움말" sub="기능마다 무엇을 하는지, 어떻게 쓰는지, 막혔을 때 어떻게 하는지 적었습니다." />
      <div className="kd-help">
        <nav className="kd-help-toc" aria-label="설명서 목차">
          <label className="kd-help-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="설명서에서 찾기" aria-label="설명서에서 찾기" />
            {q && <button type="button" onClick={() => setQ("")} aria-label="찾기 지우기"><X size={14} /></button>}
          </label>
          {hits ? (
            <ul className="kd-help-hits">
              {hits.length === 0 && <li className="kd-small kd-muted px-2 py-2">찾는 말이 설명서에 없습니다.</li>}
              {hits.map(({ c, line }) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { setCur(c.id); setQ(""); }}>
                    <b>{c.title}</b><span>…{line}…</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ol className="kd-help-list">
              {CHAPTERS.map((c, i) => (
                <li key={c.id}>
                  <button type="button" aria-current={c.id === chapter?.id ? "true" : undefined} onClick={() => setCur(c.id)}>
                    <span className="kd-help-n">{i + 1}</span>{c.title}
                  </button>
                  {c.id === chapter?.id && c.heads.length > 0 && (
                    <ul className="kd-help-heads">
                      {c.heads.map((h) => (
                        <li key={h}><button type="button" onClick={() => document.getElementById(`h-${slug(h)}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{h}</button></li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </nav>
        <div className="kd-help-scroll" ref={body}>
          {chapter && (
            <article className="kd-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ src, alt }) => <img src={imageUrl(typeof src === "string" ? src : "")} alt={alt ?? ""} loading="lazy" />,
                  h2: ({ children }) => <h2 id={`h-${slug(String(children))}`}>{children}</h2>,
                  a: ({ href, children }) => {
                    // 다른 장으로 가는 고리: (02-홈.md) 꼴
                    const to = href?.match(/^\.?\/?([^/#]+)\.md/)?.[1];
                    if (to && CHAPTERS.some((c) => c.id === to)) return <button type="button" className="kd-link" onClick={() => setCur(to)}>{children}</button>;
                    return <span>{children}</span>;
                  },
                }}>
                {chapter.body}
              </ReactMarkdown>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
