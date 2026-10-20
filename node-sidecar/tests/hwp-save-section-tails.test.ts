// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/section-tails.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로.
/**
 * Keeping the lists an HWP file holds after a section's body (master pages beyond the
 * first, memos) across a save. The files are built from a document the real engine
 * exports, with records added the way Hangul writes them.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import * as CFB from 'cfb'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { restoreSectionTails, sectionTailsOf } from '../src/core/hwp-save/section-tails.js'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const PARA_HEADER = 66
const PARA_CHAR_SHAPE = 68
const PARA_LINE_SEG = 69
const LIST_HEADER = 72
const MEMO_LIST = 93
const ID_MAPPINGS = 17
const FACE_NAME = 19
const CHAR_SHAPE = 21

/** One record: its header word, then the payload. */
function record(tag: number, level: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head.writeUInt32LE((tag | (level << 10) | (payload.length << 20)) >>> 0)
  return Buffer.concat([head, payload])
}

/** An empty paragraph one level down, as the lists after the body hold them. */
function paragraph(level: number): Buffer {
  const header = Buffer.alloc(24)
  header.writeUInt32LE(0x80000001, 0) // one character (the paragraph end), last of its list
  header.writeUInt16LE(1, 12) // one character shape
  header.writeUInt16LE(1, 16) // one line
  const shape = Buffer.alloc(8)
  const line = Buffer.alloc(36)
  line.writeUInt32LE(1000, 8)
  line.writeUInt32LE(1000, 12)
  line.writeUInt32LE(850, 16)
  return Buffer.concat([
    record(PARA_HEADER, level, header),
    record(PARA_CHAR_SHAPE, level + 1, shape),
    record(PARA_LINE_SEG, level + 1, line),
  ])
}

/** A master page beyond the first: `kind` is what tells one from another. */
function masterPage(kind: number, paragraphs = 1): Buffer {
  const header = Buffer.alloc(34)
  header.writeUInt32LE(paragraphs, 0)
  header.writeUInt32LE(67180, 8)
  header.writeUInt32LE(51024, 12)
  header.writeUInt8(kind, 18)
  return Buffer.concat([
    record(LIST_HEADER, 1, header),
    ...Array.from({ length: paragraphs }, () => paragraph(1)),
  ])
}

function memo(number: number): Buffer {
  const id = Buffer.alloc(4)
  id.writeUInt32LE(number)
  const header = Buffer.alloc(16)
  header.writeUInt32LE(1, 0)
  return Buffer.concat([record(MEMO_LIST, 1, id), record(LIST_HEADER, 1, header), paragraph(1)])
}

const SECTION0 = '/BodyText/Section0'

/** The file with one of its streams rewritten (inflated for `change`, deflated back). */
function withStream(file: Uint8Array, path: string, change: (data: Buffer) => Buffer): Uint8Array {
  const cfb = CFB.read(Buffer.from(file), { type: 'buffer' })
  const entry = CFB.find(cfb, path)
  if (!entry) throw new Error(`no stream ${path}`)
  const data = change(inflateRawSync(Buffer.from(entry.content as Uint8Array)))
  CFB.utils.cfb_add(cfb, path, deflateRawSync(data))
  return new Uint8Array(CFB.write(cfb, { type: 'buffer' }) as Buffer)
}

const withTail = (file: Uint8Array, ...lists: Buffer[]): Uint8Array =>
  withStream(file, SECTION0, (data) => Buffer.concat([data, ...lists]))

function streamOf(file: Uint8Array, path: string): Buffer {
  const cfb = CFB.read(Buffer.from(file), { type: 'buffer' })
  return inflateRawSync(Buffer.from(CFB.find(cfb, path)!.content as Uint8Array))
}

/** The storages and streams of a container, by path. */
function streamNames(file: Uint8Array): string[] {
  const cfb = CFB.read(Buffer.from(file), { type: 'buffer' })
  return cfb.FullPaths.filter((_path, index) => cfb.FileIndex[index]?.type !== 0)
}

/** A document of the engine: some lines of text, exported as HWP. */
function exported(...lines: string[]): Uint8Array {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  const bytes = doc.exportHwp()
  doc.free()
  return bytes
}

describe('what is kept of an opened file', () => {
  it('is nothing for a document without lists after its body', () => {
    expect(sectionTailsOf(exported('본문'))).toBeNull()
  })

  it('is the master pages after the body, one list each', () => {
    const kept = sectionTailsOf(withTail(exported('본문'), masterPage(4), masterPage(5, 2)))
    expect(kept?.sections).toBe(1)
    expect(kept?.tails.get(0)?.map((list) => list.bytes.length)).toEqual([
      masterPage(4).length,
      masterPage(5, 2).length,
    ])
  })

  it('is nothing for bytes that are not an HWP file', () => {
    expect(sectionTailsOf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toBeNull()
    expect(sectionTailsOf(new Uint8Array(0))).toBeNull()
  })

  it('is nothing for a file whose streams are encrypted', () => {
    const file = withTail(exported('본문'), masterPage(4))
    const cfb = CFB.read(Buffer.from(file), { type: 'buffer' })
    const header = Buffer.from(CFB.find(cfb, '/FileHeader')!.content as Uint8Array)
    header.writeUInt32LE(header.readUInt32LE(36) | 0x2, 36)
    CFB.utils.cfb_add(cfb, '/FileHeader', header)
    expect(sectionTailsOf(new Uint8Array(CFB.write(cfb, { type: 'buffer' }) as Buffer))).toBeNull()
  })

  it('is nothing when something else than a list follows the body', () => {
    const stray = record(PARA_CHAR_SHAPE + 100, 1, Buffer.alloc(4))
    expect(sectionTailsOf(withTail(exported('본문'), stray, masterPage(4)))).toBeNull()
  })
})

describe('why the lists have to be put back', () => {
  it('the engine writes a changed section without a master page it read', () => {
    // When this fails, rhwp keeps the lists itself (edwardkim/rhwp#7899): see whether
    // section-tails.ts can go.
    const first = exported('본문')
    const file = restoreSectionTails(first, sectionTailsOf(withTail(first, masterPage(4)))!).bytes
    expect(sectionTailsOf(file)?.tails.get(0)).toHaveLength(1)
    const doc = new HwpDocument(file)
    // not changed: the section goes out as it came in
    expect(sectionTailsOf(doc.exportHwp())?.tails.get(0)).toHaveLength(1)
    doc.insertText(0, 0, 0, '또 ')
    const saved = doc.exportHwp()
    doc.free()
    expect(sectionTailsOf(saved)).toBeNull()
  })
})

describe('saving a document whose file had lists after the body', () => {
  it('puts a master page back after the body the engine wrote', () => {
    const opened = withTail(exported('본문'), masterPage(4))
    const saved = exported('본문', '새 문단')
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result).toMatchObject({ restored: 1 })
    expect(result.skipped).toBeUndefined()
    expect(streamOf(result.bytes, SECTION0)).toEqual(
      Buffer.concat([streamOf(saved, SECTION0), masterPage(4)]),
    )
    // nothing else of the file changed
    expect(streamOf(result.bytes, '/DocInfo')).toEqual(streamOf(saved, '/DocInfo'))
  })

  it('writes the streams the engine wrote and none of its own', () => {
    const opened = withTail(exported('본문'), masterPage(4))
    const saved = exported('본문', '새 문단')
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result.restored).toBe(1)
    expect(streamNames(result.bytes)).toEqual(streamNames(saved))
    expect(streamNames(result.bytes).join(' ')).not.toContain('Sh33tJ5')
  })

  it('writes a container the engine reads in full: its next save keeps every stream', () => {
    const opened = withTail(exported('본문'), masterPage(4))
    const saved = exported('본문', '새 문단')
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    // the engine drops the preview picture, the scripts and the summary of a container it
    // can only read leniently
    const doc = new HwpDocument(result.bytes)
    doc.insertText(0, 0, 0, '또 ')
    const next = doc.exportHwp()
    doc.free()
    expect(streamNames(next)).toEqual(streamNames(saved))
    expect(streamNames(next).join(' ')).toContain('PrvImage')
  })

  it('leaves the saved bytes alone when the engine kept the lists itself', () => {
    const opened = withTail(exported('본문'), masterPage(4))
    const saved = withTail(exported('본문', '새 문단'), masterPage(4))
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result.restored).toBe(0)
    expect(result.bytes).toBe(saved)
  })

  it('puts back only the lists the saved section lacks, in their old order', () => {
    const opened = withTail(exported('본문'), masterPage(4), masterPage(5), masterPage(6))
    // the engine wrote the third one itself, and wrote it its own way
    const saved = withTail(exported('본문', '새 문단'), masterPage(6, 2))
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result.restored).toBe(2)
    expect(streamOf(result.bytes, SECTION0)).toEqual(
      Buffer.concat([
        streamOf(exported('본문', '새 문단'), SECTION0),
        masterPage(4),
        masterPage(5),
        masterPage(6, 2),
      ]),
    )
  })

  it('writes a file the engine reads as it read the saved one', () => {
    const opened = withTail(exported('본문'), masterPage(4))
    const saved = exported('본문', '새 문단')
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    const before = new HwpDocument(saved)
    const after = new HwpDocument(result.bytes)
    expect(after.pageCount()).toBe(before.pageCount())
    expect(after.getTextFileText()).toBe(before.getTextFileText())
    // opening what was written keeps the same lists again
    expect(sectionTailsOf(result.bytes)?.tails.get(0)).toHaveLength(1)
  })

  it('puts a memo back while its field is still in the document', () => {
    const opened = withTail(exported('본문 MEMO/65535/3/1769959632/2'), memo(3))
    const saved = exported('본문 MEMO/65535/3/1769959632/2', '새 문단')
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result.restored).toBe(1)
    expect(streamOf(result.bytes, SECTION0)).toEqual(
      Buffer.concat([streamOf(saved, SECTION0), memo(3)]),
    )
  })

  it('leaves a memo out when the text it hung on was deleted', () => {
    const opened = withTail(exported('본문 MEMO/65535/3/1769959632/2'), memo(3), masterPage(4))
    const saved = exported('본문', '새 문단')
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result.restored).toBe(1)
    expect(streamOf(result.bytes, SECTION0)).toEqual(
      Buffer.concat([streamOf(saved, SECTION0), masterPage(4)]),
    )
  })

  it('does not take another memo number for the one a field names', () => {
    const opened = withTail(exported('본문 MEMO/65535/13/1/2'), memo(3))
    const saved = exported('본문 MEMO/65535/13/1/2', '새 문단')
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result.restored).toBe(0)
    expect(result.bytes).toBe(saved)
  })
})

/** DocInfo with one record changed or added; `at` counts records of that tag. */
function withDocInfo(
  file: Uint8Array,
  change: (records: { tag: number; bytes: Buffer }[]) => { tag: number; bytes: Buffer }[],
): Uint8Array {
  return withStream(file, '/DocInfo', (data) => {
    const records: { tag: number; bytes: Buffer }[] = []
    let at = 0
    while (at < data.length) {
      const word = data.readUInt32LE(at)
      let size = word >>> 20
      let head = 4
      if (size === 0xfff) {
        size = data.readUInt32LE(at + 4)
        head = 8
      }
      records.push({ tag: word & 0x3ff, bytes: data.subarray(at, at + head + size) })
      at += head + size
    }
    return Buffer.concat(change(records).map((entry) => entry.bytes))
  })
}

describe('what the lists refer to by number', () => {
  it('stops the lists from going back when a shape is no longer where it was', () => {
    const opened = withTail(exported('본문'), masterPage(4))
    const saved = withDocInfo(exported('본문', '새 문단'), (records) => {
      const first = records.find((entry) => entry.tag === CHAR_SHAPE)!
      const changed = Buffer.from(first.bytes)
      changed.writeUInt8(changed.readUInt8(changed.length - 1) ^ 0xff, changed.length - 1)
      first.bytes = changed
      return records
    })
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result).toMatchObject({ restored: 0, skipped: 'ids' })
    expect(result.bytes).toBe(saved)
  })

  it('lets them go back when shapes were only added', () => {
    const opened = withTail(exported('본문'), masterPage(4))
    const doc = new HwpDocument(exported('본문', '새 문단'))
    doc.applyCharFormat(0, 1, 0, 2, JSON.stringify({ bold: true, fontSize: 1400 }))
    const saved = doc.exportHwp()
    doc.free()
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result).toMatchObject({ restored: 1 })
  })

  it('counts fonts within their language: a font added to the first language moves none', () => {
    const opened = withTail(exported('본문'), masterPage(4))
    const saved = withDocInfo(exported('본문', '새 문단'), (records) => {
      const mappings = records.find((entry) => entry.tag === ID_MAPPINGS)!
      const counts = Buffer.from(mappings.bytes)
      const firstLanguage = counts.readInt32LE(4 + 4)
      counts.writeInt32LE(firstLanguage + 1, 4 + 4)
      mappings.bytes = counts
      // the new font goes after the first language's fonts, before the second language's
      const fonts = records.filter((entry) => entry.tag === FACE_NAME)
      const added = { tag: FACE_NAME, bytes: Buffer.from(fonts[0]!.bytes) }
      added.bytes.writeUInt8(
        added.bytes.readUInt8(added.bytes.length - 1) ^ 0x01,
        added.bytes.length - 1,
      )
      records.splice(records.indexOf(fonts[firstLanguage - 1]!) + 1, 0, added)
      return records
    })
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result).toMatchObject({ restored: 1 })
  })

  it('does not fail a save on bytes it cannot read', () => {
    const opened = withTail(exported('본문'), masterPage(4))
    const garbage = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3])
    const result = restoreSectionTails(garbage, sectionTailsOf(opened)!)
    expect(result).toMatchObject({ restored: 0, skipped: 'unreadable' })
    expect(result.bytes).toBe(garbage)
  })
})

const EQ_EDIT = 88

/**
 * A body paragraph holding an equation whose control record says `instance`, with or
 * without a caption (a list of one empty paragraph right under the control).
 */
function equationParagraph(instance: number, caption: boolean, level = 0): Buffer {
  const text = Buffer.alloc(18)
  text.writeUInt16LE(11, 0) // an object's character, eight units
  text.write('deqe', 2, 'latin1')
  text.writeUInt16LE(11, 14)
  text.writeUInt16LE(13, 16)
  const header = Buffer.alloc(24)
  header.writeUInt32LE(9, 0)
  const control = Buffer.alloc(46)
  control.write('deqe', 0, 'latin1')
  control.writeUInt32LE(instance, 36)
  const list = Buffer.alloc(30)
  list.writeUInt32LE(1, 0)
  const script = Buffer.concat([Buffer.alloc(4), Buffer.from('x^2', 'utf16le')])
  return Buffer.concat([
    record(PARA_HEADER, level, header),
    record(67, level + 1, text),
    record(71, level + 1, control),
    ...(caption ? [record(LIST_HEADER, level + 2, list), paragraph(level + 2)] : []),
    record(EQ_EDIT, level + 2, script),
  ])
}

describe('the caption of an equation', () => {
  it('is kept by the equation it belongs to', () => {
    const kept = sectionTailsOf(
      withTail(exported('본문'), equationParagraph(7, true), equationParagraph(8, false)),
    )
    expect(kept?.tails.size).toBe(0)
    expect(kept?.captions.size).toBe(1)
  })

  it('goes back under that equation when the engine left it out', () => {
    const opened = withTail(
      exported('본문'),
      equationParagraph(7, false),
      equationParagraph(8, true),
    )
    const saved = withTail(
      exported('본문'),
      equationParagraph(7, false),
      equationParagraph(8, false),
    )
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result).toMatchObject({ restored: 1 })
    expect(streamOf(result.bytes, SECTION0).equals(streamOf(opened, SECTION0))).toBe(true)
  })

  it('takes the level of the place the equation is at now', () => {
    const opened = withTail(exported('본문'), equationParagraph(8, true))
    // the same equation, written one level down (as in a table cell)
    const deeper = equationParagraph(8, false, 1)
    const saved = withTail(exported('본문'), deeper)
    const result = restoreSectionTails(saved, sectionTailsOf(opened)!)
    expect(result.restored).toBe(1)
    expect(
      streamOf(result.bytes, SECTION0).includes(
        Buffer.concat([
          record(
            LIST_HEADER,
            3,
            (() => {
              const list = Buffer.alloc(30)
              list.writeUInt32LE(1, 0)
              return list
            })(),
          ),
          paragraph(3),
        ]),
      ),
    ).toBe(true)
  })

  it('is left alone when the engine wrote it, or the equation is gone', () => {
    const opened = withTail(exported('본문'), equationParagraph(8, true))
    const kept = sectionTailsOf(opened)!
    const same = withTail(exported('본문'), equationParagraph(8, true))
    expect(restoreSectionTails(same, kept).bytes).toBe(same)
    const other = withTail(exported('본문'), equationParagraph(9, false))
    expect(restoreSectionTails(other, kept).bytes).toBe(other)
  })
})
