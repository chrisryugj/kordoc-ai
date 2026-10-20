// 이음오피스(IeumOffice, https://github.com/pblsketch/openoffice, Apache-2.0, Copyright 2026 Mainfunc, Inc.)의
// apps/hwp/src/main/hwp5-file.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로(.js)만. 판단 근거는 그 저장소의
// 결정 기록 0024·0026·0027. 라이선스 고지는 저장소 루트 NOTICE·licenses/IeumOffice-Apache-2.0.txt.
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import * as CFB from 'cfb'

/**
 * Reading and rewriting HWP 5 files (a compound file whose DocInfo and BodyText streams are
 * deflated lists of tagged records, as the public HWP 5.0 format describes them), for the
 * few things the module puts right in the bytes rhwp wrote (decisions 0024 and 0026).
 */

export const SECTION = (index: number): string => `/BodyText/Section${index}`
export const FILE_HEADER = '/FileHeader'
export const DOC_INFO = '/DocInfo'
export const SIGNATURE = 'HWP Document File'
/** FileHeader properties: the streams are deflated / encrypted / a distribution copy */
export const COMPRESSED = 0x1
export const ENCRYPTED = 0x2
export const DISTRIBUTION = 0x4
export const PARA_HEADER = 66
export const PARA_TEXT = 67
export const CTRL_HEADER = 71
export const LIST_HEADER = 72
/** A document has few sections; this only bounds the walk over a malformed container. */
export const MAX_SECTIONS = 4096

export interface HwpRecord {
  tag: number
  level: number
  start: number
  /** where its payload starts */
  body: number
  end: number
}

/** The records of a stream, or null when the bytes are not a whole list of records. */
export function recordsOf(data: Buffer): HwpRecord[] | null {
  const out: HwpRecord[] = []
  let at = 0
  while (at < data.length) {
    if (at + 4 > data.length) return null
    const start = at
    const word = data.readUInt32LE(at)
    let size = word >>> 20
    at += 4
    if (size === 0xfff) {
      if (at + 4 > data.length) return null
      size = data.readUInt32LE(at)
      at += 4
    }
    const body = at
    at += size
    if (at > data.length) return null
    out.push({ tag: word & 0x3ff, level: (word >>> 10) & 0x3ff, start, body, end: at })
  }
  return out
}

export interface OpenedHwp {
  cfb: CFB.CFB$Container
  compressed: boolean
}

/** A plain HWP 5 container, or null: not one, or one whose streams are not readable here. */
export function openHwp(file: Uint8Array): OpenedHwp | null {
  const cfb = CFB.read(Buffer.from(file.buffer, file.byteOffset, file.byteLength), {
    type: 'buffer',
  })
  const header = CFB.find(cfb, FILE_HEADER)
  if (!header?.content || header.content.length < 40) return null
  const bytes = Buffer.from(header.content as Uint8Array)
  if (bytes.toString('latin1', 0, SIGNATURE.length) !== SIGNATURE) return null
  const flags = bytes.readUInt32LE(36)
  if (flags & (ENCRYPTED | DISTRIBUTION)) return null
  // a second copy of the body for viewing: which copy the engine reads is not known here
  if (cfb.FullPaths.some((path) => /\/ViewText\//i.test(path))) return null
  return { cfb, compressed: (flags & COMPRESSED) !== 0 }
}

export function streamOf(opened: OpenedHwp, path: string): Buffer | null {
  const entry = CFB.find(opened.cfb, path)
  if (!entry?.content) return null
  const raw = Buffer.from(entry.content as Uint8Array)
  return opened.compressed ? inflateRawSync(raw) : raw
}

export function sectionCount(opened: OpenedHwp): number {
  let count = 0
  while (count < MAX_SECTIONS && CFB.find(opened.cfb, SECTION(count))) count++
  return count
}

const SECTOR = 512
const MINI_SECTOR = 64
const FAT_PER_SECTOR = SECTOR / 4
const END_OF_CHAIN = 0xfffffffe
const FREE = 0xffffffff
/** FAT sectors the header itself lists; more are listed in a chain of sectors of their own */
const HEADER_FAT_SLOTS = 109
/** The library puts a stream of its own, by this name, into every container it writes. */
const LIBRARY_MARKER = 'Sh33tJ5'

/**
 * The container as a file. Two things the library does are undone, because the document
 * is the user's and rhwp must read it back whole:
 * - it adds a marker stream of its own unless it finds one. An unused entry by that name
 *   at the end of the directory is found, and dropped again before anything is written.
 * - it fills the unused entries of the sector tables with "end of chain" rather than
 *   "free". Hangul reads that; rhwp's strict reader does not, and falls back to a reader
 *   that leaves out the preview picture, the summary and the scripts on the next save.
 */
export function writeContainer(cfb: CFB.CFB$Container): Buffer {
  cfb.FileIndex.push({ name: LIBRARY_MARKER, type: 0 } as CFB.CFB$Entry)
  cfb.FullPaths.push(cfb.FullPaths[0] + LIBRARY_MARKER)
  const file = CFB.write(cfb, { type: 'buffer' }) as Buffer
  const sectors = (file.length - SECTOR) / SECTOR
  const sectorAt = (index: number): number => SECTOR + index * SECTOR
  const freeFrom = (tableSectors: number[], used: number): void => {
    tableSectors.forEach((sector, nth) => {
      for (let slot = 0; slot < FAT_PER_SECTOR; slot++) {
        const at = sectorAt(sector) + slot * 4
        if (nth * FAT_PER_SECTOR + slot >= used && file.readUInt32LE(at) === END_OF_CHAIN) {
          file.writeUInt32LE(FREE, at)
        }
      }
    })
  }
  // the sectors of the FAT: the header lists the first ones, a chain of sectors the rest
  const fatSectors: number[] = []
  for (let slot = 0; slot < HEADER_FAT_SLOTS; slot++) {
    const sector = file.readUInt32LE(76 + slot * 4)
    if (sector < sectors) fatSectors.push(sector)
  }
  let more = file.readUInt32LE(68)
  for (let guard = 0; more < sectors && guard < sectors; guard++) {
    for (let slot = 0; slot < FAT_PER_SECTOR - 1; slot++) {
      const sector = file.readUInt32LE(sectorAt(more) + slot * 4)
      if (sector < sectors) fatSectors.push(sector)
    }
    more = file.readUInt32LE(sectorAt(more) + (FAT_PER_SECTOR - 1) * 4)
  }
  const next = (sector: number): number => {
    const table = fatSectors[Math.floor(sector / FAT_PER_SECTOR)]
    return table === undefined
      ? END_OF_CHAIN
      : file.readUInt32LE(sectorAt(table) + (sector % FAT_PER_SECTOR) * 4)
  }
  // the mini FAT is a chain in the FAT; the size of the root entry says how much of it is used
  const miniSectors: number[] = []
  let mini = file.readUInt32LE(60)
  for (let guard = 0; mini < sectors && guard < sectors; guard++) {
    miniSectors.push(mini)
    mini = next(mini)
  }
  const rootSize = file.readUInt32LE(sectorAt(file.readUInt32LE(48)) + 120)
  freeFrom(miniSectors, Math.ceil(rootSize / MINI_SECTOR))
  freeFrom(fatSectors, sectors)
  return file
}

/** The storages and streams of a container; its unused directory entries are not among them. */
export const pathsOf = (opened: OpenedHwp): string[] =>
  opened.cfb.FullPaths.filter((_path, index) => opened.cfb.FileIndex[index]?.type !== 0)

/** The two containers hold the same streams with the same bytes; `changed` ones hold these. */
export function sameStreams(
  before: OpenedHwp,
  after: OpenedHwp,
  changed: Map<string, Buffer>,
): boolean {
  const paths = pathsOf(before)
  const now = pathsOf(after)
  if (paths.length !== now.length || !paths.every((path) => now.includes(path))) return false
  const root = paths[0] ?? ''
  for (const path of paths) {
    // a storage holds no bytes of its own: that it is still there was checked above
    if (path.endsWith('/')) continue
    const name = `/${path.slice(root.length)}`
    const was = CFB.find(before.cfb, name)
    const is = CFB.find(after.cfb, name)
    if (!was || !is || was.type !== is.type) return false
    const meant = changed.get(name)
    if (meant) {
      const back = streamOf(after, name)
      if (!back || !back.equals(meant)) return false
    } else if (
      !Buffer.from((was.content ?? []) as Uint8Array).equals(
        Buffer.from((is.content ?? []) as Uint8Array),
      )
    ) {
      return false
    }
  }
  return true
}

/**
 * The file with some streams replaced (`changed`: path → uncompressed bytes), written and
 * read back: null unless every other stream came back as it was and the changed ones as
 * meant.
 */
export function rewriteStreams(opened: OpenedHwp, changed: Map<string, Buffer>): Buffer | null {
  for (const [path, data] of changed) {
    const entry = CFB.find(opened.cfb, path)
    if (!entry) return null
    const content = opened.compressed ? deflateRawSync(data) : data
    entry.content = content
    entry.size = content.length
  }
  const written = writeContainer(opened.cfb)
  const check = openHwp(written)
  return check && sameStreams(opened, check, changed) ? written : null
}
