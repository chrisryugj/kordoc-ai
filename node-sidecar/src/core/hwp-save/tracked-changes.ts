// 이음오피스(IeumOffice, https://github.com/pblsketch/openoffice, Apache-2.0, Copyright 2026 Mainfunc, Inc.)의
// apps/hwp/src/main/tracked-changes.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로(.js)만. 판단 근거는 그 저장소의
// 결정 기록 0027. 라이선스 고지는 저장소 루트 NOTICE·licenses/IeumOffice-Apache-2.0.txt.
import * as CFB from 'cfb'
import { SECTION, openHwp, sectionCount, writeContainer } from './hwp5-file.js'

const SIGNATURE = 'HWP Document File'
/** FileHeader property: the document keeps a record of changes */
const TRACKED = 0x4000
const VIEW_TEXT = /\/ViewText\//i

/** A directory entry with its links to its siblings and first child, which cfb's types leave out. */
type LinkedEntry = CFB.CFB$Entry & { L: number; R: number; C: number }

/** The file's header and container when it is an HWP file with tracked changes, else null. */
function trackedContainer(file: Uint8Array): { cfb: CFB.CFB$Container; header: Buffer } | null {
  const cfb = CFB.read(Buffer.from(file.buffer, file.byteOffset, file.byteLength), {
    type: 'buffer',
  })
  const header = CFB.find(cfb, '/FileHeader')
  if (!header?.content || header.content.length < 40) return null
  const bytes = Buffer.from(header.content as Uint8Array)
  if (bytes.toString('latin1', 0, SIGNATURE.length) !== SIGNATURE) return null
  if ((bytes.readUInt32LE(36) & TRACKED) === 0) return null
  if (!cfb.FullPaths.some((path) => VIEW_TEXT.test(path))) return null
  return { cfb, header: bytes }
}

/**
 * Whether an HWP file carries tracked changes: the property in its header, and the second
 * copy of the body (`ViewText`) Hangul keeps for them. Never throws; a file that cannot be
 * read here is taken to have none.
 */
export function hasTrackedChanges(file: Uint8Array): boolean {
  try {
    return trackedContainer(file) !== null
  } catch {
    return false
  }
}

/**
 * The file as the editor is to get it: without the record of changes (decision 0025).
 *
 * Hangul keeps the document as it reads now in the body (`BodyText`) and the document with
 * every change still marked, deleted text included, in a second copy (`ViewText`). rhwp
 * 0.8.7 reads the second copy, as ordinary text, and writes neither it nor the record, so
 * an HWP it saves keeps the property without the copy and Hangul refuses it. Without the
 * copy and the property the engine reads the body, which Hangul draws the same, and what it
 * saves is a plain document Hangul opens: the text as it reads now, without the record.
 *
 * Null when the file has no tracked changes, or when the result is not a plain HWP file
 * whose body is the one the file had (an encrypted or distribution copy, for one). Never
 * throws.
 */
export function withoutTrackedChanges(file: Uint8Array): Uint8Array | null {
  try {
    const tracked = trackedContainer(file)
    if (!tracked) return null
    const { cfb, header } = tracked
    const bodies = new Map<string, Buffer>()
    for (let index = 0; ; index++) {
      const entry = CFB.find(cfb, SECTION(index))
      if (!entry?.content) break
      bodies.set(SECTION(index), Buffer.from(entry.content as Uint8Array))
    }
    if (bodies.size === 0) return null
    // the copy's storage and its streams are taken out of the directory as they are: the
    // library's own delete puts a marker stream of its own into the file, which
    // writeContainer then cannot keep out. The links between entries were read from the
    // file and point past what is left; marked unknown, the library builds them anew
    for (let index = cfb.FullPaths.length - 1; index >= 0; index--) {
      if (VIEW_TEXT.test(cfb.FullPaths[index]!)) {
        cfb.FullPaths.splice(index, 1)
        cfb.FileIndex.splice(index, 1)
      }
    }
    for (const entry of cfb.FileIndex as LinkedEntry[]) entry.L = entry.R = entry.C = Number.NaN
    header.writeUInt32LE((header.readUInt32LE(36) & ~TRACKED) >>> 0, 36)
    const headerEntry = CFB.find(cfb, '/FileHeader')!
    headerEntry.content = header
    const written = writeContainer(cfb)
    // read back: a plain HWP file (no second copy, not encrypted), the body as it was
    const check = openHwp(written)
    if (!check || sectionCount(check) !== bodies.size) return null
    for (const [path, body] of bodies) {
      const entry = CFB.find(check.cfb, path)
      if (!entry?.content || !Buffer.from(entry.content as Uint8Array).equals(body)) return null
    }
    return new Uint8Array(written.buffer, written.byteOffset, written.byteLength)
  } catch {
    return null
  }
}
