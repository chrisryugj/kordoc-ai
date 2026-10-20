// 이음오피스(IeumOffice, https://github.com/pblsketch/openoffice, Apache-2.0, Copyright 2026 Mainfunc, Inc.)의
// apps/hwp/src/main/field-kinds.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로(.js)만. 판단 근거는 그 저장소의
// 결정 기록 0026. 라이선스 고지는 저장소 루트 NOTICE·licenses/IeumOffice-Apache-2.0.txt.
import { createHash } from 'node:crypto'
import {
  CTRL_HEADER,
  PARA_TEXT,
  SECTION,
  openHwp,
  recordsOf,
  rewriteStreams,
  sectionCount,
  streamOf,
} from './hwp5-file.js'
import type { HwpRecord } from './hwp5-file.js'

/**
 * Some fields Hangul writes with the kind "unknown" in their control record and the real
 * kind only in the character that opens the field in the text: a memo's field says `%%me`
 * there (others seen: `%%*d`, `%sig`). rhwp 0.8.7 writes that character with the control
 * record's kind, and Hangul then no longer reads the field as a memo: the text around it
 * runs together (decision 0026). So the kinds of the opened file are kept, by the content
 * of the field's control record, and written back into the saved one.
 */

/** A field's control: its id, four characters, read as a little-endian number. */
const UNKNOWN_FIELD = 0x25756e6b // '%unk'
const FIELD_BEGIN = 3
/** Characters of the paragraph text that take eight code units (a control and its data). */
const LONG_CHARS = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
])
/** Of those, the ones that have a control record of their own, in the same order. */
const EXTENDED_CHARS = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23])

/** By digest of the field's control record: the kind its opening character had. */
export type FieldKinds = Map<string, number>

interface FieldBegin {
  /** where the kind is in the section stream */
  at: number
  kind: number
  control: HwpRecord
}

/** The field-opening characters of an unknown-kind field, with their control records. */
function unknownFieldsIn(data: Buffer, records: HwpRecord[]): FieldBegin[] {
  const out: FieldBegin[] = []
  records.forEach((text, index) => {
    if (text.tag !== PARA_TEXT) return
    // the paragraph's control records follow its text, at the same level
    const controls: HwpRecord[] = []
    for (let j = index + 1; j < records.length && records[j]!.level >= text.level; j++) {
      if (records[j]!.level === text.level && records[j]!.tag === CTRL_HEADER) {
        controls.push(records[j]!)
      }
    }
    let at = text.body
    let nth = 0
    while (at + 1 < text.end) {
      const unit = data.readUInt16LE(at)
      if (unit < 32 && LONG_CHARS.has(unit)) {
        if (at + 16 > text.end) break
        if (EXTENDED_CHARS.has(unit)) {
          const control = controls[nth++]
          if (
            unit === FIELD_BEGIN &&
            control &&
            control.end - control.body >= 4 &&
            data.readUInt32LE(control.body) === UNKNOWN_FIELD
          ) {
            out.push({ at: at + 2, kind: data.readUInt32LE(at + 2), control })
          }
        }
        at += 16
      } else {
        at += 2
      }
    }
  })
  return out
}

const digestOf = (data: Buffer, control: HwpRecord): string =>
  createHash('sha1').update(data.subarray(control.body, control.end)).digest('hex')

/**
 * The kinds the opened file gives its unknown-kind fields in the text, where that is not
 * "unknown"; null when it has none (the common case) or cannot be read here. Never throws.
 */
export function fieldKindsOf(file: Uint8Array): FieldKinds | null {
  try {
    const opened = openHwp(file)
    if (!opened) return null
    const kinds: FieldKinds = new Map()
    for (let sec = 0; sec < sectionCount(opened); sec++) {
      const data = streamOf(opened, SECTION(sec))
      const records = data ? recordsOf(data) : null
      if (!data || !records) return null
      for (const field of unknownFieldsIn(data, records)) {
        if (field.kind !== UNKNOWN_FIELD) kinds.set(digestOf(data, field.control), field.kind)
      }
    }
    return kinds.size > 0 ? kinds : null
  } catch {
    return null
  }
}

/**
 * The saved bytes with the kept kinds written back into the fields the engine wrote as
 * "unknown", each found by the content of its control record; fields without a kept kind
 * stay as written. The saved bytes come back untouched when there is nothing to write or the
 * result cannot be read back as meant. Never throws: a save does not fail on this.
 */
export function restoreFieldKinds(
  saved: Uint8Array,
  kept: FieldKinds,
): { bytes: Uint8Array; restored: number } {
  try {
    const opened = openHwp(saved)
    if (!opened) return { bytes: saved, restored: 0 }
    const changed = new Map<string, Buffer>()
    let restored = 0
    for (let sec = 0; sec < sectionCount(opened); sec++) {
      const stream = streamOf(opened, SECTION(sec))
      const records = stream ? recordsOf(stream) : null
      if (!stream || !records) return { bytes: saved, restored: 0 }
      const data = Buffer.from(stream)
      let any = false
      for (const field of unknownFieldsIn(data, records)) {
        const kind = kept.get(digestOf(data, field.control))
        if (field.kind !== UNKNOWN_FIELD || kind === undefined) continue
        data.writeUInt32LE(kind, field.at)
        restored += 1
        any = true
      }
      if (any) changed.set(SECTION(sec), data)
    }
    if (changed.size === 0) return { bytes: saved, restored: 0 }
    const written = rewriteStreams(opened, changed)
    return written
      ? {
          bytes: new Uint8Array(written.buffer, written.byteOffset, written.byteLength),
          restored,
        }
      : { bytes: saved, restored: 0 }
  } catch {
    return { bytes: saved, restored: 0 }
  }
}
