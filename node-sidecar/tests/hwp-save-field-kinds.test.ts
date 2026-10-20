// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/field-kinds.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로.
/**
 * Writing back the kind Hangul gives a field in the character that opens it, where the
 * engine wrote the control record's "unknown" kind. The files are an engine export with a
 * paragraph added the way Hangul writes a memo's field.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import * as CFB from 'cfb'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { fieldKindsOf, restoreFieldKinds } from '../src/core/hwp-save/field-kinds.js'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const PARA_HEADER = 66
const PARA_TEXT = 67
const CTRL_HEADER = 71
const SECTION0 = '/BodyText/Section0'

function record(tag: number, level: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head.writeUInt32LE((tag | (level << 10) | (payload.length << 20)) >>> 0)
  return Buffer.concat([head, payload])
}

/** An eight-unit character: the code, the kind (four bytes), six bytes, the code again. */
function longChar(code: number, kind: string): Buffer {
  const unit = Buffer.alloc(16)
  unit.writeUInt16LE(code, 0)
  unit.write(kind, 2, 'latin1')
  unit.writeUInt16LE(code, 14)
  return unit
}

/**
 * A paragraph with a field around one character: the opening character says `textKind`, its
 * control record "unknown" with `command` (a memo's is MEMO/<n>/<memo>/).
 */
function fieldParagraph(textKind: string, command: string): Buffer {
  const text = Buffer.concat([
    longChar(3, textKind),
    Buffer.from('가', 'utf16le'),
    longChar(4, 'em%\u0000'),
    Buffer.from('\r', 'utf16le'),
  ])
  const header = Buffer.alloc(24)
  header.writeUInt32LE(text.length / 2, 0)
  const control = Buffer.concat([
    Buffer.from('knu%', 'latin1'),
    Buffer.alloc(5),
    Buffer.from(command, 'utf16le'),
  ])
  return Buffer.concat([
    record(PARA_HEADER, 0, header),
    record(PARA_TEXT, 1, text),
    record(CTRL_HEADER, 1, control),
  ])
}

function withParagraphs(file: Uint8Array, ...paragraphs: Buffer[]): Uint8Array {
  const cfb = CFB.read(Buffer.from(file), { type: 'buffer' })
  const entry = CFB.find(cfb, SECTION0)!
  const data = inflateRawSync(Buffer.from(entry.content as Uint8Array))
  CFB.utils.cfb_add(cfb, SECTION0, deflateRawSync(Buffer.concat([data, ...paragraphs])))
  return new Uint8Array(CFB.write(cfb, { type: 'buffer' }) as Buffer)
}

function exported(): Uint8Array {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '본문')
  return doc.exportHwp()
}

const section = (file: Uint8Array): Buffer => {
  const cfb = CFB.read(Buffer.from(file), { type: 'buffer' })
  return inflateRawSync(Buffer.from(CFB.find(cfb, SECTION0)!.content as Uint8Array))
}

const kindsIn = (file: Uint8Array): string[] => {
  const data = section(file)
  const out: string[] = []
  for (let at = data.indexOf(longChar(3, '').subarray(0, 2)); at >= 0;) {
    out.push(data.toString('latin1', at + 2, at + 6))
    at = data.indexOf(Buffer.from([3, 0]), at + 16)
  }
  return out.filter((kind) => kind.includes('%'))
}

describe('field kinds', () => {
  let base: Uint8Array
  beforeAll(() => {
    base = exported()
  })
  const MEMO_1 = 'MEMO/1/1/'
  const MEMO_2 = 'MEMO/1/2/'

  it('keeps nothing for a file whose fields say their kind in both places', () => {
    expect(fieldKindsOf(base)).toBeNull()
    expect(fieldKindsOf(withParagraphs(base, fieldParagraph('knu%', MEMO_1)))).toBeNull()
  })

  it('writes the kept kind back where the engine wrote "unknown", by the field', () => {
    const opened = withParagraphs(
      base,
      fieldParagraph('em%%', MEMO_1),
      fieldParagraph('d*%%', MEMO_2),
    )
    const kept = fieldKindsOf(opened)!
    expect(kept.size).toBe(2)
    // as the engine saves it: both opening characters say the control's kind
    const saved = withParagraphs(
      base,
      fieldParagraph('knu%', MEMO_1),
      fieldParagraph('knu%', MEMO_2),
    )
    expect(kindsIn(saved)).toEqual(['knu%', 'knu%'])
    const result = restoreFieldKinds(saved, kept)
    expect(result.restored).toBe(2)
    expect(kindsIn(result.bytes)).toEqual(['em%%', 'd*%%'])
  })

  it('leaves a field the opened file did not have as the engine wrote it', () => {
    const kept = fieldKindsOf(withParagraphs(base, fieldParagraph('em%%', MEMO_1)))!
    const saved = withParagraphs(base, fieldParagraph('knu%', MEMO_2))
    const result = restoreFieldKinds(saved, kept)
    expect(result.restored).toBe(0)
    expect(result.bytes).toBe(saved)
  })

  it('changes nothing else of the section', () => {
    const kept = fieldKindsOf(withParagraphs(base, fieldParagraph('em%%', MEMO_1)))!
    const saved = withParagraphs(base, fieldParagraph('knu%', MEMO_1))
    const result = restoreFieldKinds(saved, kept)
    const before = section(saved)
    const after = section(result.bytes)
    expect(after.length).toBe(before.length)
    const differing = [...after.keys()].filter((index) => after[index] !== before[index])
    // within the four bytes of the kind and nothing else ('knu%' and 'em%%' end alike)
    const at = differing[0]!
    expect(differing.every((index) => index < at + 4)).toBe(true)
    expect(after.toString('latin1', at, at + 4)).toBe('em%%')
  })

  it('reads nothing from what is not an HWP file', () => {
    expect(fieldKindsOf(new Uint8Array([1, 2, 3]))).toBeNull()
    const junk = new Uint8Array([1, 2, 3])
    expect(restoreFieldKinds(junk, new Map([['x', 1]])).bytes).toBe(junk)
  })
})
