// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/page-number.test.ts(커밋 63e2a636)에서 옮겼다. 바꾼 것: 가져오기 경로, 명령 이름(ieum → kordoc).
/**
 * Hangul's 쪽 번호 매기기 through the engine (vendor/rhwp-core patch 0014): the page number position
 * control is set in the section's first paragraph, replaced when the section has one, written to
 * HWP and HWPX the way Hancom Hangul 2024 writes it, and read back.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** One entry of a zip, read through its central directory. */
function zipEntry(zip: Uint8Array, name: string): string {
  const buf = Buffer.from(zip)
  let end = buf.length - 22
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end -= 1
  let at = buf.readUInt32LE(end + 16)
  const count = buf.readUInt16LE(end + 10)
  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    if (buf.toString('utf8', at + 46, at + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    }
    at += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`no ${name}`)
}

function document(text = '첫 문단') {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, text)
  return doc
}

const pageNumber = (doc: HwpDocument) => JSON.parse(doc.getPageNumberPos(0)).pageNumber

describe('setPageNumberPos', () => {
  it('puts a page number into a section that has none, and reads it back', () => {
    const doc = document()
    expect(pageNumber(doc)).toBeNull()
    const result = JSON.parse(doc.setPageNumberPos(0, 0, 5, true))
    expect(result).toEqual({ ok: true, replaced: false })
    expect(pageNumber(doc)).toEqual({ format: 0, position: 5, dash: true })
  })

  it('keeps the text of the paragraph it goes into', () => {
    const doc = document('가나다 라마바')
    doc.setPageNumberPos(0, 0, 5, true)
    const again = new HwpDocument(doc.exportHwp())
    expect(again.getTextRange(0, 0, 0, 7)).toBe('가나다 라마바')
  })

  it('replaces the one the section has instead of adding a second, as Hangul does', () => {
    const doc = document()
    doc.setPageNumberPos(0, 0, 5, true)
    expect(JSON.parse(doc.setPageNumberPos(0, 2, 2, false))).toEqual({ ok: true, replaced: true })
    expect(pageNumber(doc)).toEqual({ format: 2, position: 2, dash: false })
    const xml = zipEntry(doc.exportHwpx(), 'Contents/section0.xml')
    expect(xml.match(/<hp:pageNum /g)).toHaveLength(1)
  })

  it('survives saving as HWP and opening again', () => {
    const doc = document()
    doc.setPageNumberPos(0, 1, 6, true)
    const again = new HwpDocument(doc.exportHwp())
    expect(JSON.parse(again.getPageNumberPos(0)).pageNumber).toEqual({
      format: 1,
      position: 6,
      dash: true,
    })
  })

  it('writes HWPX the way Hangul does, with sideChar="" for no dashes', () => {
    const doc = document()
    doc.setPageNumberPos(0, 2, 0, false)
    const xml = zipEntry(doc.exportHwpx(), 'Contents/section0.xml')
    expect(xml).toContain('<hp:pageNum pos="NONE" formatType="ROMAN_CAPITAL" sideChar=""/>')
    doc.setPageNumberPos(0, 0, 5, true)
    expect(zipEntry(doc.exportHwpx(), 'Contents/section0.xml')).toContain(
      '<hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/>',
    )
  })

  it('reads a page number without dashes from HWPX as having none (it read them as "-")', () => {
    const doc = document()
    doc.setPageNumberPos(0, 0, 5, false)
    const again = new HwpDocument(doc.exportHwpx())
    expect(JSON.parse(again.getPageNumberPos(0)).pageNumber.dash).toBe(false)
  })

  it('reads a page number Hancom Hangul 2024 saved without dashes as it is, and writes it back so', () => {
    // a two-line document with "1, 2, 3" at the bottom center, dashes off (sideChar="")
    const fixture = readFileSync(join(__dirname, 'fixtures', 'hancom-page-number-no-dash.hwpx'))
    const doc = new HwpDocument(new Uint8Array(fixture))
    expect(pageNumber(doc)).toEqual({ format: 0, position: 5, dash: false })
    expect(doc.renderPageSvg(0)).not.toMatch(/>-</)
    expect(zipEntry(doc.exportHwpx(), 'Contents/section0.xml')).toContain(
      '<hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar=""/>',
    )
  })

  it('draws the number on the page', () => {
    const doc = document()
    doc.setPageNumberPos(0, 0, 5, true)
    expect(doc.renderPageSvg(0)).toMatch(/>-<[\s\S]*>1<[\s\S]*>-</)
  })

  it('refuses shapes HWPX cannot hold and positions that do not exist', () => {
    const doc = document()
    expect(() => doc.setPageNumberPos(0, 8, 5, true)).toThrow()
    expect(() => doc.setPageNumberPos(0, 0, 11, true)).toThrow()
    expect(() => doc.setPageNumberPos(3, 0, 5, true)).toThrow()
  })
})
