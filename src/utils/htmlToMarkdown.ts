/**
 * 간이 HTML → Markdown 변환기
 * 클립보드에서 text/html 캡처 시 서식 보존용
 */

export function htmlToMarkdown(html: string): string {
  // DOMParser로 안전하게 파싱
  const doc = new DOMParser().parseFromString(html, "text/html")
  const body = doc.body
  if (!body) return ""
  return nodeToMarkdown(body).trim()
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || "").replace(/\n\s*/g, " ")
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ""

  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  const children = () => Array.from(el.childNodes).map(nodeToMarkdown).join("")

  switch (tag) {
    // 헤딩
    case "h1": return `\n# ${children().trim()}\n\n`
    case "h2": return `\n## ${children().trim()}\n\n`
    case "h3": return `\n### ${children().trim()}\n\n`
    case "h4": return `\n#### ${children().trim()}\n\n`
    case "h5": return `\n##### ${children().trim()}\n\n`
    case "h6": return `\n###### ${children().trim()}\n\n`

    // 인라인 서식
    case "strong":
    case "b":
      return `**${children().trim()}**`
    case "em":
    case "i":
      return `*${children().trim()}*`
    case "code":
      return `\`${children().trim()}\``
    case "s":
    case "del":
    case "strike":
      return `~~${children().trim()}~~`

    // 블록
    case "p":
    case "div":
      return `\n${children().trim()}\n`
    case "br":
      return "\n"
    case "hr":
      return "\n---\n"
    case "blockquote": {
      const lines = children().trim().split("\n")
      return "\n" + lines.map(l => `> ${l}`).join("\n") + "\n"
    }

    // 리스트
    case "ul":
    case "ol":
      return "\n" + processListItems(el, tag === "ol") + "\n"

    // 코드블록
    case "pre": {
      const codeEl = el.querySelector("code")
      const text = (codeEl || el).textContent || ""
      const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || ""
      return `\n\`\`\`${lang}\n${text.trim()}\n\`\`\`\n`
    }

    // 테이블
    case "table":
      return "\n" + processTable(el) + "\n"

    // 링크
    case "a": {
      const href = el.getAttribute("href") || ""
      const text = children().trim()
      // 텍스트가 없거나 URL과 동일하면 텍스트만 출력
      if (!text || text === href) return href ? href : ""
      return text
    }

    // 이미지
    case "img": {
      const alt = el.getAttribute("alt") || ""
      const src = el.getAttribute("src") || ""
      return `![${alt}](${src})`
    }

    // 스크립트/스타일 무시
    case "script":
    case "style":
    case "head":
      return ""

    // 그 외는 자식 처리
    default:
      return children()
  }
}

function processListItems(listEl: HTMLElement, ordered: boolean, depth = 0): string {
  const items: string[] = []
  const indent = "  ".repeat(depth)
  let idx = 1

  for (const child of Array.from(listEl.children)) {
    if (child.tagName.toLowerCase() !== "li") continue

    // li 내부에서 중첩 리스트 분리
    const parts: string[] = []
    let subList = ""
    for (const node of Array.from(child.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as HTMLElement).tagName.toLowerCase()
        if (tag === "ul" || tag === "ol") {
          subList += processListItems(node as HTMLElement, tag === "ol", depth + 1)
          continue
        }
      }
      parts.push(nodeToMarkdown(node))
    }

    const marker = ordered ? `${idx}. ` : "- "
    const text = parts.join("").trim()
    items.push(`${indent}${marker}${text}`)
    if (subList) items.push(subList.trimEnd())
    idx++
  }

  return items.join("\n")
}

function processTable(tableEl: HTMLElement): string {
  const rows: string[][] = []

  for (const tr of Array.from(tableEl.querySelectorAll("tr"))) {
    const cells: string[] = []
    for (const cell of Array.from(tr.querySelectorAll("th, td"))) {
      cells.push(Array.from(cell.childNodes).map(nodeToMarkdown).join("").trim().replace(/\|/g, "\\|"))
    }
    if (cells.length > 0) rows.push(cells)
  }

  if (rows.length === 0) return ""

  const colCount = Math.max(...rows.map(r => r.length))
  const lines: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const padded = rows[i].concat(Array(colCount - rows[i].length).fill(""))
    lines.push("| " + padded.join(" | ") + " |")
    // 첫 번째 행 뒤에 구분선
    if (i === 0) {
      lines.push("| " + padded.map(() => "---").join(" | ") + " |")
    }
  }

  return lines.join("\n")
}

/** HTML이 의미 있는 서식을 포함하는지 판별 */
export function hasRichFormatting(html: string): boolean {
  return /<(h[1-6]|strong|b|em|i|code|pre|ul|ol|table|blockquote)\b/i.test(html)
}
