// 이음오피스(IeumOffice, Apache-2.0) apps/hwp/tests/tracked-changes.test.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로.
/**
 * Telling an HWP file with tracked changes from one without: the header property and the
 * second copy of the body, on files built from a document the real engine exports.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as CFB from 'cfb'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { hasTrackedChanges, withoutTrackedChanges } from '../src/core/hwp-save/tracked-changes.js'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

function exported(): Uint8Array {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '본문')
  const bytes = doc.exportHwp()
  doc.free()
  return bytes
}

/** The file with the tracked-changes property set and/or a view copy of the body added. */
function variant(
  file: Uint8Array,
  options: { property?: boolean; viewCopy?: boolean },
): Uint8Array {
  const cfb = CFB.read(Buffer.from(file), { type: 'buffer' })
  if (options.property) {
    const header = Buffer.from(CFB.find(cfb, '/FileHeader')!.content as Uint8Array)
    header.writeUInt32LE(header.readUInt32LE(36) | 0x4000, 36)
    CFB.utils.cfb_add(cfb, '/FileHeader', header)
  }
  if (options.viewCopy) {
    const body = Buffer.from(CFB.find(cfb, '/BodyText/Section0')!.content as Uint8Array)
    CFB.utils.cfb_add(cfb, '/ViewText/Section0', body)
  }
  return new Uint8Array(CFB.write(cfb, { type: 'buffer' }) as Buffer)
}

describe('hasTrackedChanges', () => {
  it('is false for an ordinary document', () => {
    expect(hasTrackedChanges(exported())).toBe(false)
  })

  it('is true when the header says so and the view copy of the body is there', () => {
    expect(hasTrackedChanges(variant(exported(), { property: true, viewCopy: true }))).toBe(true)
  })

  it('takes both: the property alone or the copy alone is not it', () => {
    expect(hasTrackedChanges(variant(exported(), { property: true }))).toBe(false)
    expect(hasTrackedChanges(variant(exported(), { viewCopy: true }))).toBe(false)
  })

  it('is false for bytes that are not an HWP file', () => {
    expect(hasTrackedChanges(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false)
    expect(hasTrackedChanges(new Uint8Array(0))).toBe(false)
  })
})

/** The text the engine reads from a file, paragraph by paragraph. */
function textOf(file: Uint8Array): string[] {
  const doc = new HwpDocument(file)
  const out: string[] = []
  for (let k = 0; k < doc.getParagraphCount(0); k++) {
    const length = doc.getParagraphLength(0, k)
    out.push(length > 0 ? doc.getTextRange(0, k, 0, length) : '')
  }
  doc.free()
  return out
}

/** A view copy that says something else than the body: what the engine would read if it had it. */
function viewCopyOf(text: string): Buffer {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, text)
  const cfb = CFB.read(Buffer.from(doc.exportHwp()), { type: 'buffer' })
  doc.free()
  return Buffer.from(CFB.find(cfb, '/BodyText/Section0')!.content as Uint8Array)
}

describe('withoutTrackedChanges', () => {
  function tracked(): Uint8Array {
    const cfb = CFB.read(Buffer.from(variant(exported(), { property: true })), { type: 'buffer' })
    CFB.utils.cfb_add(cfb, '/ViewText/Section0', viewCopyOf('본문 지운 글'))
    return new Uint8Array(CFB.write(cfb, { type: 'buffer' }) as Buffer)
  }

  it('gives the body, without the view copy and the property', () => {
    const file = tracked()
    // with the copy, the engine reads the copy
    expect(textOf(file)[0]).toBe('본문 지운 글')
    const current = withoutTrackedChanges(file)!
    expect(current).not.toBeNull()
    expect(hasTrackedChanges(current)).toBe(false)
    const cfb = CFB.read(Buffer.from(current), { type: 'buffer' })
    expect(cfb.FullPaths.some((path) => /ViewText/.test(path))).toBe(false)
    const header = Buffer.from(CFB.find(cfb, '/FileHeader')!.content as Uint8Array)
    expect(header.readUInt32LE(36) & 0x4000).toBe(0)
    expect(textOf(current)[0]).toBe('본문')
  })

  it('keeps the body bytes and every other stream as they were', () => {
    const file = tracked()
    const before = CFB.read(Buffer.from(file), { type: 'buffer' })
    const after = CFB.read(Buffer.from(withoutTrackedChanges(file)!), { type: 'buffer' })
    for (const path of ['/BodyText/Section0', '/DocInfo']) {
      expect(
        Buffer.from(CFB.find(after, path)!.content as Uint8Array).equals(
          Buffer.from(CFB.find(before, path)!.content as Uint8Array),
        ),
      ).toBe(true)
    }
  })

  it('is null for a file without tracked changes, and for what is not an HWP file', () => {
    expect(withoutTrackedChanges(exported())).toBeNull()
    expect(withoutTrackedChanges(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('is null for a distribution copy, whose body is not readable here', () => {
    const cfb = CFB.read(Buffer.from(tracked()), { type: 'buffer' })
    const header = Buffer.from(CFB.find(cfb, '/FileHeader')!.content as Uint8Array)
    header.writeUInt32LE(header.readUInt32LE(36) | 0x4, 36)
    CFB.utils.cfb_add(cfb, '/FileHeader', header)
    expect(
      withoutTrackedChanges(new Uint8Array(CFB.write(cfb, { type: 'buffer' }) as Buffer)),
    ).toBeNull()
  })
})
