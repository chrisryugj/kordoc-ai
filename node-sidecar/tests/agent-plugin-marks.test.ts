// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/agent-plugin-marks.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로, 플러그인·명령 이름(ieum → kordoc).
// @vitest-environment jsdom
/**
 * The marks the plugin draws on the pages over the places it changed, against the real
 * rhwp engine. The editor's view (where pages sit, the zoom) is a stand-in: pages one under
 * another, 2000 pixels apart, 10 pixels from the left, at zoom 2.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const PAGE_GAP = 2000
const PAGE_LEFT = 10
const ZOOM = 2

interface Rect {
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

function open(lines: string[]) {
  document.body.innerHTML = '<div id="scroll-container"><div id="scroll-content"></div></div>'
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, k) => {
    if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
    doc.insertText(0, k, 0, line)
  })
  const listeners: (() => void)[] = []
  const commands = new Map<string, (services: unknown) => void>()
  const services = {
    getInputHandler: () => ({
      virtualScroll: {
        getPageOffset: (page: number) => page * PAGE_GAP,
        getPageLeftResolved: () => PAGE_LEFT,
      },
    }),
    getViewportManager: () => ({ getZoom: () => ZOOM }),
  }
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
      for (const listener of listeners) listener()
      return result
    },
    events: { on: (_name: string, handler: () => void) => listeners.push(handler) },
    automation: {
      registerCommand: (def: { id: string; execute: (services: unknown) => void }) =>
        commands.set(def.id, def.execute),
      execute: (id: string) => commands.get(id)?.(services) ?? null,
    },
  } as unknown as AgentPluginHost
  const plugin = agentPlugin.activate(host)
  /** an edit the user makes: the editor says the document changed */
  const userEdit = () => {
    doc.insertText(0, 0, 0, '손')
    for (const listener of listeners) listener()
  }
  return { plugin, doc, userEdit }
}

/** The marks on the page, as page rectangles again. */
function marksOnPage(): Rect[] {
  return [...document.querySelectorAll<HTMLElement>('.kordoc-change-marks > div')].map((box) => {
    const top = parseFloat(box.style.top)
    const pageIndex = Math.floor(top / PAGE_GAP)
    return {
      pageIndex,
      x: Math.round((parseFloat(box.style.left) - PAGE_LEFT) / ZOOM),
      y: Math.round((top - pageIndex * PAGE_GAP) / ZOOM),
      width: Math.round(parseFloat(box.style.width) / ZOOM),
      height: Math.round(parseFloat(box.style.height) / ZOOM),
    }
  })
}

/** Where the engine lays out a run of a body paragraph, rounded as marksOnPage rounds. */
function rectsOf(doc: HwpDocument, para: number, start: number, end: number): Rect[] {
  return (JSON.parse(doc.getSelectionRects(0, para, start, para, end)) as Rect[]).map((r) => ({
    pageIndex: r.pageIndex,
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  }))
}

const textOf = (doc: HwpDocument, para: number) =>
  doc.getTextRange(0, para, 0, doc.getParagraphLength(0, para))

afterEach(() => {
  agentPlugin.deactivate?.()
})

describe('marks of changes', () => {
  it('marks the text a replacement put in', () => {
    const { plugin, doc } = open(['제출 기한은 3월 2일', '담당자: 홍길동'])
    plugin.replaceText('홍길동', '김철수', null)
    expect(marksOnPage()).toEqual(rectsOf(doc, 1, 5, 8))
  })

  it('marks every place of a replace-all, a later one in a paragraph where it moved to', () => {
    const { plugin, doc } = open(['가 가 가', '가'])
    plugin.replaceAllText('가', '나다')
    expect(textOf(doc, 0)).toBe('나다 나다 나다')
    expect(marksOnPage()).toEqual([
      ...rectsOf(doc, 0, 0, 2),
      ...rectsOf(doc, 0, 3, 5),
      ...rectsOf(doc, 0, 6, 8),
      ...rectsOf(doc, 1, 0, 2),
    ])
  })

  it('marks each paragraph it added, and moves the marks of earlier changes below them', () => {
    const { plugin, doc } = open(['첫째', '둘째', '셋째'])
    plugin.replaceText('셋째', '세 번째', null)
    plugin.insertParagraphs('첫째', null, 'after', ['새 하나', '새 둘'])
    expect(textOf(doc, 4)).toBe('세 번째')
    expect(marksOnPage()).toEqual([
      ...rectsOf(doc, 4, 0, 4),
      ...rectsOf(doc, 1, 0, 4),
      ...rectsOf(doc, 2, 0, 3),
    ])
  })

  it('marks nothing for a removed paragraph, and moves the marks below it up', () => {
    const { plugin, doc } = open(['첫째', '둘째', '셋째'])
    plugin.replaceText('둘째', '두 번째', null)
    plugin.replaceText('셋째', '세 번째', null)
    plugin.deleteParagraph('두 번째', null)
    expect(textOf(doc, 1)).toBe('세 번째')
    // the removed paragraph's mark went with it
    expect(marksOnPage()).toEqual(rectsOf(doc, 1, 0, 4))
  })

  it('takes the marks off when the panel asks, or when the user edits the document', () => {
    const first = open(['가격 표', '금액'])
    first.plugin.replaceText('금액', '합계', null)
    expect(marksOnPage().length).toBeGreaterThan(0)
    first.plugin.clearMarks()
    expect(marksOnPage()).toEqual([])

    const second = open(['가격 표', '금액'])
    second.plugin.replaceText('금액', '합계', null)
    second.userEdit()
    expect(marksOnPage()).toEqual([])
  })

  it('gives the panel no list of marks in what a change returns', () => {
    const { plugin } = open(['가 가'])
    const result = plugin.replaceAllText('가', '나')
    expect(result).not.toHaveProperty('marks')
  })
})
