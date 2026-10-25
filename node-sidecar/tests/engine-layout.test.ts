// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/engine-layout.test.ts(커밋 63e2a636)에서 옮겼다. 바꾼 것: 가져오기 경로, 명령 이름(ieum → kordoc).
/**
 * The patched rhwp engine in vendor/rhwp-core (decision 0050), run in node like
 * the editor runs it. Each case is a public reproduction saved by Hangul 2024
 * (its text replaced by filler): the page layout must keep the relations Hangul
 * draws, not pixel positions. The title-table-then-inline-table case is the
 * first reproduction with its inline table moved into the next paragraph. Both
 * title-table files then lost two white labels that stripping the pictures had
 * left invisible on white paper (rhwp's hidden-text check flagged them). The
 * title-table-zone-fill case is the first reproduction with a gray face on the
 * cell zone border fill, whose picture fill the stripping had emptied. The
 * header-footer-paper-tables, header-footer-paper-shapes and
 * master-page-next-section cases are built on the title-table-then-inline-table
 * reproduction (its body replaced by a few lines) and saved by Hangul 2024: one
 * framed table or rectangle in the header and one in the footer, and a second
 * section that declares no master page.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)
const CORE = dirname(require.resolve('@rhwp/core'))

beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(CORE, 'rhwp_bg.wasm')) })
})

interface Node {
  type: string
  pi?: number
  ci?: number
  row?: number
  bbox?: { x: number; y: number; w: number; h: number }
  children?: Node[]
}

interface Box {
  type: string
  pi: number
  ci?: number
  top: number
  bottom: number
}

/** Tables, pictures and body text lines of one page; nothing inside a table. */
function boxes(doc: HwpDocument, page: number): Box[] {
  const out: Box[] = []
  const walk = (node: Node) => {
    const owned = node.pi !== undefined && node.pi < 1e9 && node.bbox
    if (owned && ['Table', 'Image', 'TextLine'].includes(node.type)) {
      out.push({
        type: node.type,
        pi: node.pi!,
        ci: node.ci,
        top: node.bbox!.y,
        bottom: node.bbox!.y + node.bbox!.h,
      })
    }
    if (node.type !== 'Table') for (const child of node.children ?? []) walk(child)
  }
  walk(JSON.parse(doc.getPageRenderTree(page)) as Node)
  return out
}

/** The footnote separator's top and the body text lines' bottoms on one page. */
function footnoteAndBody(doc: HwpDocument, page: number) {
  const root = JSON.parse(doc.getPageRenderTree(page)) as Node
  const area = root.children?.find((child) => child.type === 'FootnoteArea')
  const separator = area?.children?.find((child) => child.type === 'Line')?.bbox?.y
  const bottoms: number[] = []
  const walk = (node: Node) => {
    if (node.type === 'TextLine' && node.bbox) bottoms.push(node.bbox.y + node.bbox.h)
    else if (node.type !== 'Table') for (const child of node.children ?? []) walk(child)
  }
  for (const body of root.children?.filter((child) => child.type === 'Body') ?? []) walk(body)
  return { separator, bottoms }
}

function open(name: string): HwpDocument {
  return new HwpDocument(new Uint8Array(readFileSync(join(__dirname, 'fixtures', name))))
}

/** The first node of a type under a node, depth first. */
function first(node: Node, type: string): Node | undefined {
  if (node.type === type) return node
  for (const child of node.children ?? []) {
    const found = first(child, type)
    if (found) return found
  }
  return undefined
}

/** The top-level area of a page's render tree (Header, Body, Footer, MasterPage). */
function area(root: Node, type: string): Node | undefined {
  return root.children?.find((child) => child.type === type)
}

const px = (hwpunit: number) => (hwpunit * 96) / 7200

describe('vendored rhwp engine', () => {
  it('is the build its manifest records', () => {
    const manifest = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8'))
    expect(manifest.version).toMatch(/^0\.8\.7-kordoc\.\d+$/)
    const wasm = readFileSync(join(CORE, 'rhwp_bg.wasm'))
    expect(createHash('sha256').update(wasm).digest('hex')).toBe(manifest.rhwp.wasmSha256)
  })

  it('puts an inline table below the paper-anchored Square table of the same paragraph', () => {
    // A title table anchored to the paper with Square wrap fills the body
    // width; the paragraph's own treat-as-char table cannot sit beside it, so
    // Hangul puts that line below the title's outer box and continues there.
    const doc = open('paper-square-table-tac-host.hwpx')
    expect(doc.pageCount()).toBe(1)
    const page = boxes(doc, 0)
    const hostTables = page.filter((b) => b.type === 'Table' && b.pi === 0)
    expect(hostTables).toHaveLength(2)
    const [square, inline] = [...hostTables].sort((a, b) => a.top - b.top)
    // the title's outer bottom margin is 4251 HWPUNIT
    expect(inline.top).toBeGreaterThanOrEqual(square.bottom + (4251 * 96) / 7200 - 0.5)

    const after = page.filter((b) => b.pi > 0).sort((a, b) => a.top - b.top)
    expect(after.some((b) => b.type === 'Table')).toBe(true)
    for (const box of after) expect(box.top).toBeGreaterThanOrEqual(inline.bottom - 0.5)
    for (let i = 1; i < after.length; i++) {
      expect(after[i].top).toBeGreaterThanOrEqual(after[i - 1].bottom - 0.5)
    }

    // the page's footnote stays below the body text
    const { separator, bottoms } = footnoteAndBody(doc, 0)
    expect(separator).toBeDefined()
    expect(bottoms.length).toBeGreaterThan(0)
    for (const bottom of bottoms) expect(bottom).toBeLessThanOrEqual(separator! + 0.5)
  })

  it('starts a page below its title table when the first stored line says so', () => {
    // The page opens with a paragraph that holds only the paper-anchored Square
    // title table. Its stored line starts at the title's outer bottom and the
    // next paragraph's treat-as-char table one line lower; Hangul draws both
    // there instead of at the body top, where the table covered the title.
    const doc = open('title-table-then-inline-table.hwpx')
    expect(doc.pageCount()).toBe(1)
    const page = boxes(doc, 0)
    const square = page.find((b) => b.type === 'Table' && b.pi === 0)
    const inline = page.find((b) => b.type === 'Table' && b.pi === 1)
    expect(square).toBeDefined()
    expect(inline).toBeDefined()
    // the title's outer bottom margin (4251) plus the host's stored line (1600), in HWPUNIT
    expect(inline!.top).toBeCloseTo(square!.bottom + ((4251 + 1600) * 96) / 7200, 0)

    const after = page.filter((b) => b.pi > 1).sort((a, b) => a.top - b.top)
    expect(after.length).toBeGreaterThan(0)
    for (const box of after) expect(box.top).toBeGreaterThanOrEqual(inline!.bottom - 0.5)
    for (let i = 1; i < after.length; i++) {
      expect(after[i].top).toBeGreaterThanOrEqual(after[i - 1].bottom - 0.5)
    }
  })

  it('fills a cell zone to the end of the merged cell it ends on', () => {
    // The title table's cell zone covers row 1, cells 0 and 1, and cell 1 spans
    // the last two columns. Hangul paints the zone to the table's right edge;
    // stopping at the grid end of column 1 left half the title undecorated, and
    // an earlier title table left under it showed through.
    const doc = open('title-table-zone-fill.hwpx')
    const tables: Node[] = []
    const walk = (node: Node) => {
      if (node.type === 'Table' && node.pi === 0) tables.push(node)
      else for (const child of node.children ?? []) walk(child)
    }
    walk(JSON.parse(doc.getPageRenderTree(0)) as Node)
    const title = tables.sort((a, b) => a.bbox!.y - b.bbox!.y)[0]
    const row = title.children!.find((c) => c.type === 'Cell' && c.row === 1)!.bbox!
    const zone = title.children!.find(
      (c) => c.type === 'Rect' && Math.abs(c.bbox!.y - row.y) < 0.5,
    )?.bbox
    expect(zone).toBeDefined()
    expect(zone!.x).toBeCloseTo(title.bbox!.x, 0)
    expect(zone!.x + zone!.w).toBeCloseTo(title.bbox!.x + title.bbox!.w, 0)
    expect(zone!.h).toBeCloseTo(row.h, 0)
  })

  it('moves a picture after a stored page reset to the next page with its lines', () => {
    // Paragraph 10 restarts its stored line positions at its third line: Hangul
    // breaks the page there, and its Square picture (anchored after that line)
    // goes to the next page instead of being drawn over the first page.
    const doc = open('square-picture-after-page-reset.hwpx')
    expect(doc.pageCount()).toBe(2)
    const [first, second] = [boxes(doc, 0), boxes(doc, 1)]
    const lines = (page: Box[]) => page.filter((b) => b.type === 'TextLine' && b.pi === 10)
    expect(lines(first)).toHaveLength(2)
    expect(lines(second)).toHaveLength(2)
    expect(first.some((b) => b.type === 'Image')).toBe(false)
    const picture = second.filter((b) => b.type === 'Image' && b.pi === 10)
    expect(picture).toHaveLength(1)
    const lastLine = Math.max(...lines(second).map((b) => b.bottom))
    expect(picture[0].top).toBeGreaterThanOrEqual(lastLine - 0.5)
  })

  it('measures paper-anchored header and footer tables from their own frames', () => {
    // Hangul measures a floating table in a header or footer from that frame:
    // the body's left edge and width, the top margin for a header, the body's
    // bottom and the footer margin for a footer. The header table is moved up
    // by the top margin, like the textbook's chapter header, so it sits on the
    // paper's top edge; anchored to the paper itself it was cut off above the
    // page. The footer table is aligned to the bottom right of its frame, which
    // ends at the footer margin (1417), not at the bottom margin below it.
    const doc = open('header-footer-paper-tables.hwpx')
    expect(doc.pageCount()).toBe(1)
    const root = JSON.parse(doc.getPageRenderTree(0)) as Node
    const body = area(root, 'Body')!.bbox!
    const header = first(area(root, 'Header')!, 'Table')!.bbox!
    expect(header.x).toBeCloseTo(body.x, 0)
    expect(header.y).toBeCloseTo(0, 0)

    const footer = first(area(root, 'Footer')!, 'Table')!.bbox!
    expect(footer.x + footer.w).toBeCloseTo(body.x + body.w, 0)
    // the table's declared height is 1200, in HWPUNIT
    expect(footer.y).toBeCloseTo(body.y + body.h + px(1417) - px(1200), 0)
  })

  it('measures paper-anchored header and footer text boxes from their own frames', () => {
    // The same rule for rectangles (a footer's page number box is often one):
    // the header box is moved up by the top margin, the footer box is offset
    // (3000, 1000) from the footer frame. From the paper they were drawn above
    // the page and at the page's top.
    const doc = open('header-footer-paper-shapes.hwpx')
    const root = JSON.parse(doc.getPageRenderTree(0)) as Node
    const body = area(root, 'Body')!.bbox!
    const header = first(area(root, 'Header')!, 'Rect')!.bbox!
    expect(header.x).toBeCloseTo(body.x, 0)
    expect(header.y).toBeCloseTo(0, 0)
    const footer = first(area(root, 'Footer')!, 'Rect')!.bbox!
    expect(footer.x).toBeCloseTo(body.x + px(3000), 0)
    expect(footer.y).toBeCloseTo(body.y + body.h + px(1000), 0)
  })

  it('draws the previous section master page on a section that has none', () => {
    // Only the first section declares a master page (a framed band 4000 above
    // the paper's bottom). Hangul draws it on the second section's page too,
    // as on the textbook whose later sections carry its page number band.
    const doc = open('master-page-next-section.hwpx')
    expect(doc.pageCount()).toBe(2)
    const bands = [0, 1].map((page) => {
      const root = JSON.parse(doc.getPageRenderTree(page)) as Node
      const master = area(root, 'MasterPage')
      return { root, band: master && first(master, 'Table')?.bbox }
    })
    for (const { root, band } of bands) {
      expect(band).toBeDefined()
      // the band's declared height is 1500, in HWPUNIT
      expect(band!.y).toBeCloseTo(root.bbox!.h - px(4000) - px(1500), 0)
    }
  })
})
