// 이음오피스(IeumOffice, https://github.com/pblsketch/openoffice, Apache-2.0, Copyright 2026 Mainfunc, Inc.)의
// apps/hwp/src/main/tab-widths.ts(커밋 a907a88c)에서 옮겼다. 바꾼 것: 가져오기 경로(.js), 공유 IPC 타입을 이 파일에 둠.
// 판단 근거는 그 저장소의 결정 기록 0026.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'
import {
  CTRL_HEADER,
  LIST_HEADER,
  PARA_HEADER,
  PARA_TEXT,
  SECTION,
  openHwp,
  recordsOf,
  rewriteStreams,
  sectionCount,
  streamOf,
} from './hwp5-file.js'
import type { HwpRecord } from './hwp5-file.js'

export type HwpFormat = 'hwp' | 'hwpx'

/** 저장 결과에서 폭 없이 쓰인 탭 하나의 자리: 구역, 문단, 거쳐 가는 표 칸들, 문단의 몇째 탭인지(문단 탭 수) */
export interface TabSpot {
  sec: number
  para: number
  cells: { table: number; cell: number; para: number }[]
  tab: number
  tabs: number
}

/** 편집기가 그 탭을 배치한 모양: 폭(HWPUNIT), 탭 정지의 종류(0 왼쪽·1 오른쪽·2 가운데·3 소수점)와 채움 */
export interface TabMeasure {
  width: number
  type: number
  fill: number
}

export type MeasuredTab = TabSpot & TabMeasure

/**
 * Hangul keeps, inside every tab character, how far that tab reaches and how it is drawn
 * (its kind and its leader), and draws the tab with those values when it opens the file.
 * rhwp 0.8.7 lays a tab out from the paragraph's tab stops, and a tab typed in the editor
 * is written with none of those values: Hangul then draws it with no width at all. So on
 * save the tabs the engine wrote without values are found, the editor measures them as it
 * lays them out, and the values are written into those tabs (decision 0026). Nothing else
 * of the file changes.
 *
 * Tabs are looked for in body paragraphs and in the cells of tables in them, at any depth.
 * Tabs in headers, footers, notes and text boxes keep what the engine wrote.
 */

/** A save measures at most this many tabs; a document typed in the editor has far fewer. */
export const MAX_NEW_TABS = 5000
/** No tab reaches further than a page is wide; this bounds what is written. */
const MAX_TAB_WIDTH = 0x7fffffff
const MAX_TAB_KIND = 3
const MAX_TAB_FILL = 0xff

const keyOf = (spot: TabSpot): string =>
  [spot.sec, spot.para, ...spot.cells.map((s) => `${s.table}.${s.cell}.${s.para}`), spot.tab].join(
    '/',
  )

const validMeasure = (tab: TabMeasure): boolean =>
  Number.isInteger(tab.width) &&
  tab.width > 0 &&
  tab.width <= MAX_TAB_WIDTH &&
  Number.isInteger(tab.type) &&
  tab.type >= 0 &&
  tab.type <= MAX_TAB_KIND &&
  Number.isInteger(tab.fill) &&
  tab.fill >= 0 &&
  tab.fill <= MAX_TAB_FILL

// ---- HWP 5 ----

/** A table's control: its id, four characters, read as a little-endian number. */
const TABLE_CONTROL = 0x74626c20 // 'tbl '
const TAB = 9
/** Characters of the paragraph text that take eight code units (a control and its data). */
const LONG_CHARS = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
])

/**
 * Where the code units after a tab character start in a paragraph text, for each tab, and
 * whether the engine wrote it without values: width zero, and no kind or the left kind.
 */
function tabsInText(data: Buffer, text: HwpRecord): { at: number; empty: boolean }[] {
  const tabs: { at: number; empty: boolean }[] = []
  let at = text.body
  while (at + 1 < text.end) {
    const unit = data.readUInt16LE(at)
    if (unit < 32 && LONG_CHARS.has(unit)) {
      if (at + 16 > text.end) break
      if (unit === TAB) {
        const ext = at + 2
        const kind = data.readUInt16LE(ext + 4)
        const empty =
          data.readUInt32LE(ext) === 0 &&
          (kind === 0 || kind === 0x0100) &&
          data.readUInt16LE(ext + 6) === 0 &&
          data.readUInt16LE(ext + 8) === 0 &&
          data.readUInt16LE(ext + 10) === 0
        tabs.push({ at: ext, empty })
      }
      at += 16
    } else {
      at += 2
    }
  }
  return tabs
}

interface FoundTab {
  spot: TabSpot
  /** where its values go in the section stream */
  at: number
}

/** The tabs without values in the paragraphs of one list (a section body or a cell). */
function walkHwpList(
  data: Buffer,
  records: HwpRecord[],
  from: number,
  to: number,
  level: number,
  spotOf: (k: number) => Omit<TabSpot, 'tab' | 'tabs'>,
  out: FoundTab[],
): void {
  let k = -1
  let i = from
  while (i < to) {
    const record = records[i]!
    if (record.tag !== PARA_HEADER || record.level !== level) {
      i++
      continue
    }
    k++
    let end = i + 1
    while (end < to && records[end]!.level > level) end++
    const place = spotOf(k)
    let tables = 0
    for (let j = i + 1; j < end; j++) {
      const child = records[j]!
      if (child.level !== level + 1) continue
      if (child.tag === PARA_TEXT) {
        const tabs = tabsInText(data, child)
        tabs.forEach((tab, nth) => {
          if (tab.empty) out.push({ spot: { ...place, tab: nth, tabs: tabs.length }, at: tab.at })
        })
      } else if (
        child.tag === CTRL_HEADER &&
        child.end - child.body >= 4 &&
        data.readUInt32LE(child.body) === TABLE_CONTROL
      ) {
        const table = tables++
        let tableEnd = j + 1
        while (tableEnd < end && records[tableEnd]!.level > level + 1) tableEnd++
        // each cell: a list header, then its paragraphs, all one level below the control
        let cell = -1
        let m = j + 1
        while (m < tableEnd) {
          const head = records[m]!
          if (head.level !== level + 2 || head.tag !== LIST_HEADER) {
            m++
            continue
          }
          cell++
          let cellEnd = m + 1
          while (
            cellEnd < tableEnd &&
            !(records[cellEnd]!.level === level + 2 && records[cellEnd]!.tag === LIST_HEADER)
          ) {
            cellEnd++
          }
          const thisCell = cell
          walkHwpList(
            data,
            records,
            m + 1,
            cellEnd,
            level + 2,
            (p) => ({
              sec: place.sec,
              para: place.para,
              cells: [...place.cells, { table, cell: thisCell, para: p }],
            }),
            out,
          )
          m = cellEnd
        }
      }
    }
    i = end
  }
}

function hwpTabs(file: Uint8Array): { section: number; found: FoundTab[] }[] | null {
  const opened = openHwp(file)
  if (!opened) return null
  const sections: { section: number; found: FoundTab[] }[] = []
  const count = sectionCount(opened)
  for (let sec = 0; sec < count; sec++) {
    const data = streamOf(opened, SECTION(sec))
    const records = data ? recordsOf(data) : null
    if (!data || !records) return null
    const found: FoundTab[] = []
    walkHwpList(data, records, 0, records.length, 0, (k) => ({ sec, para: k, cells: [] }), found)
    sections.push({ section: sec, found })
  }
  return sections
}

function writeHwpTabs(file: Uint8Array, measured: Map<string, TabMeasure>): Uint8Array | null {
  const opened = openHwp(file)
  const sections = hwpTabs(file)
  if (!opened || !sections) return null
  const changed = new Map<string, Buffer>()
  for (const { section, found } of sections) {
    const due = found.filter((tab) => measured.has(keyOf(tab.spot)))
    if (due.length === 0) continue
    const data = Buffer.from(streamOf(opened, SECTION(section))!)
    for (const tab of due) {
      const value = measured.get(keyOf(tab.spot))!
      data.writeUInt32LE(value.width, tab.at)
      // the kind one above how tab stops number it, in the high byte; the leader in the low one
      data.writeUInt16LE(((value.type + 1) << 8) | value.fill, tab.at + 4)
    }
    changed.set(SECTION(section), data)
  }
  if (changed.size === 0) return file
  const written = rewriteStreams(opened, changed)
  return written ? new Uint8Array(written.buffer, written.byteOffset, written.byteLength) : null
}

// ---- HWPX ----

interface ZipEntry {
  name: string
  /** the central directory record */
  central: Buffer
  /** where its local header starts, and where the next entry's does */
  start: number
  end: number
  method: number
  compressedSize: number
  dataStart: number
  /** its place in the central directory */
  order: number
}

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const END_SIZE = 22
const MAX_COMMENT = 0xffff
const STORED = 0
const DEFLATED = 8
/** general purpose flags: sizes follow the data; encrypted */
const DATA_DESCRIPTOR = 0x8
const ENCRYPTED_ENTRY = 0x1
const SECTION_PART = /^Contents\/section(\d+)\.xml$/

/** The entries of a zip in the order of the file, or null for one this does not handle. */
function zipEntries(zip: Buffer): { entries: ZipEntry[]; centralStart: number } | null {
  let endAt = -1
  for (
    let at = zip.length - END_SIZE;
    at >= Math.max(0, zip.length - END_SIZE - MAX_COMMENT);
    at--
  ) {
    if (zip.readUInt32LE(at) === END_SIGNATURE) {
      endAt = at
      break
    }
  }
  if (endAt < 0) return null
  const count = zip.readUInt16LE(endAt + 10)
  const centralSize = zip.readUInt32LE(endAt + 12)
  const centralStart = zip.readUInt32LE(endAt + 16)
  // zip64 and archives split over disks are not written by the engine
  if (count === 0xffff || centralStart === 0xffffffff || zip.readUInt16LE(endAt + 4) !== 0) {
    return null
  }
  if (centralStart + centralSize > endAt) return null
  const entries: ZipEntry[] = []
  let at = centralStart
  for (let n = 0; n < count; n++) {
    if (at + 46 > endAt || zip.readUInt32LE(at) !== CENTRAL_SIGNATURE) return null
    const flags = zip.readUInt16LE(at + 8)
    const method = zip.readUInt16LE(at + 10)
    const compressedSize = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const length = 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    const start = zip.readUInt32LE(at + 42)
    if (flags & ENCRYPTED_ENTRY) return null
    if (start + 30 > centralStart || zip.readUInt32LE(start) !== LOCAL_SIGNATURE) return null
    const dataStart = start + 30 + zip.readUInt16LE(start + 26) + zip.readUInt16LE(start + 28)
    entries.push({
      name: zip.toString('utf8', at + 46, at + 46 + nameLength),
      central: Buffer.from(zip.subarray(at, at + length)),
      start,
      end: 0,
      method,
      compressedSize,
      dataStart,
      order: n,
    })
    at += length
  }
  const ordered = [...entries].sort((a, b) => a.start - b.start)
  ordered.forEach((entry, index) => {
    entry.end = ordered[index + 1]?.start ?? centralStart
  })
  if (ordered.some((entry) => entry.dataStart + entry.compressedSize > entry.end)) return null
  return { entries: ordered, centralStart }
}

function entryData(zip: Buffer, entry: ZipEntry): Buffer | null {
  const raw = zip.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
  if (entry.method === STORED) return Buffer.from(raw)
  if (entry.method === DEFLATED) return inflateRawSync(raw)
  return null
}

/** The zip with some entries' content replaced; every other entry's bytes are copied as they were. */
function rewriteZip(
  zip: Buffer,
  parts: { entries: ZipEntry[] },
  changed: Map<string, Buffer>,
): Buffer {
  const pieces: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of parts.entries) {
    const content = changed.get(entry.name)
    const record = Buffer.from(entry.central)
    record.writeUInt32LE(offset, 42)
    if (!content) {
      const piece = zip.subarray(entry.start, entry.end)
      pieces.push(piece)
      offset += piece.length
    } else {
      const data = entry.method === STORED ? content : deflateRawSync(content)
      const crc = crc32(content)
      const nameAndExtra = zip.subarray(entry.start + 30, entry.dataStart)
      const local = Buffer.from(zip.subarray(entry.start, entry.start + 30))
      // the sizes go in the header now, so no descriptor follows the data
      local.writeUInt16LE(local.readUInt16LE(6) & ~DATA_DESCRIPTOR, 6)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(data.length, 18)
      local.writeUInt32LE(content.length, 22)
      record.writeUInt16LE(record.readUInt16LE(8) & ~DATA_DESCRIPTOR, 8)
      record.writeUInt32LE(crc, 16)
      record.writeUInt32LE(data.length, 20)
      record.writeUInt32LE(content.length, 24)
      pieces.push(local, nameAndExtra, data)
      offset += local.length + nameAndExtra.length + data.length
    }
    central.push(record)
  }
  // the central directory in its own order, as it was
  const directory = Buffer.concat(
    parts.entries
      .map((entry, index) => ({ order: entry.order, record: central[index]! }))
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.record),
  )
  const end = Buffer.alloc(END_SIZE)
  end.writeUInt32LE(END_SIGNATURE, 0)
  end.writeUInt16LE(parts.entries.length, 8)
  end.writeUInt16LE(parts.entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...pieces, directory, end])
}

interface XmlTab {
  spot: Omit<TabSpot, 'tab' | 'tabs'> & { tab: number }
  /** the tab element in the section text */
  start: number
  end: number
  /** where its paragraph's tab count is kept until the paragraph closes */
  counter: { tabs: number }
}

const TAG = /<(\/?)([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
const attrOf = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1]

/**
 * The tabs without values of one section part: `width="0"` (the engine's way of writing a
 * tab with none) in body paragraphs and the cells of tables in them.
 */
function xmlTabs(xml: string, sec: number): XmlTab[] {
  interface Frame {
    name: string
    /** for a paragraph: where it is, or null when it is not one looked at */
    place?: Omit<TabSpot, 'tab' | 'tabs'> | null
    counter?: { tabs: number }
    tables?: number
    /** for a table: its place among its paragraph's tables, and its cells so far */
    table?: number
    cells?: number
    /** for a cell: which one, and its paragraphs so far */
    cell?: number
    paras?: number
  }
  const stack: Frame[] = []
  const out: XmlTab[] = []
  let bodyParas = 0
  const nearest = (name: string): Frame | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.name === name) return stack[i]
    return undefined
  }
  for (const match of xml.matchAll(TAG)) {
    const [whole, closing, , name, attrs, selfClosing] = match
    if (whole.startsWith('<?') || whole.startsWith('<!')) continue
    if (closing) {
      // close up to the matching element
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.name === name) {
          stack.length = i
          break
        }
      }
      continue
    }
    const frame: Frame = { name: name! }
    if (name === 'p') {
      const parent = stack[stack.length - 1]
      if (parent?.name === 'sec') {
        frame.place = { sec, para: bodyParas++, cells: [] }
      } else if (parent?.name === 'subList' && stack[stack.length - 2]?.name === 'tc') {
        const cell = stack[stack.length - 2]!
        const table = nearest('tbl')
        // the paragraph the table sits in: the nearest one below the table
        let outer: Frame | undefined
        for (let i = table ? stack.lastIndexOf(table) - 1 : -1; i >= 0; i--) {
          if (stack[i]!.name === 'p') {
            outer = stack[i]
            break
          }
        }
        const k = cell.paras ?? 0
        cell.paras = k + 1
        frame.place =
          outer?.place && table?.table !== undefined && cell.cell !== undefined
            ? {
                sec,
                para: outer.place.para,
                cells: [...outer.place.cells, { table: table.table, cell: cell.cell, para: k }],
              }
            : null
      } else {
        frame.place = null
      }
      frame.counter = { tabs: 0 }
      frame.tables = 0
    } else if (name === 'tbl') {
      const para = nearest('p')
      if (para) {
        frame.table = para.tables ?? 0
        para.tables = frame.table + 1
      }
      frame.cells = 0
    } else if (name === 'tc') {
      const table = nearest('tbl')
      if (table) {
        frame.cell = table.cells ?? 0
        table.cells = frame.cell + 1
      }
    } else if (name === 'tab') {
      const para = nearest('p')
      if (para?.counter) {
        const nth = para.counter.tabs++
        if (para.place && attrOf(attrs!, 'width') === '0') {
          out.push({
            spot: { ...para.place, tab: nth },
            start: match.index,
            end: match.index + whole.length,
            counter: para.counter,
          })
        }
      }
    }
    if (!selfClosing) stack.push(frame)
  }
  return out
}

function hwpxSections(zip: Buffer): {
  parts: { entries: ZipEntry[] }
  sections: { name: string; sec: number; xml: string; tabs: XmlTab[] }[]
} | null {
  const parts = zipEntries(zip)
  if (!parts) return null
  const sections: { name: string; sec: number; xml: string; tabs: XmlTab[] }[] = []
  for (const entry of parts.entries) {
    const match = SECTION_PART.exec(entry.name)
    if (!match) continue
    const data = entryData(zip, entry)
    if (!data) return null
    const xml = data.toString('utf8')
    const sec = Number(match[1])
    sections.push({ name: entry.name, sec, xml, tabs: xmlTabs(xml, sec) })
  }
  return { parts, sections }
}

const xmlSpot = (tab: XmlTab): TabSpot => ({ ...tab.spot, tabs: tab.counter.tabs })

function writeHwpxTabs(file: Uint8Array, measured: Map<string, TabMeasure>): Uint8Array | null {
  const zip = Buffer.from(file.buffer, file.byteOffset, file.byteLength)
  const read = hwpxSections(zip)
  if (!read) return null
  const changed = new Map<string, Buffer>()
  for (const section of read.sections) {
    let xml = ''
    let at = 0
    let any = false
    for (const tab of section.tabs) {
      const value = measured.get(keyOf(xmlSpot(tab)))
      if (!value) continue
      const element = section.xml
        .slice(tab.start, tab.end)
        .replace(/\swidth="[^"]*"/, ` width="${value.width}"`)
        .replace(/\sleader="[^"]*"/, ` leader="${value.fill}"`)
        .replace(/\stype="[^"]*"/, ` type="${value.type + 1}"`)
      xml += section.xml.slice(at, tab.start) + element
      at = tab.end
      any = true
    }
    if (any) changed.set(section.name, Buffer.from(xml + section.xml.slice(at), 'utf8'))
  }
  if (changed.size === 0) return file
  const written = rewriteZip(zip, read.parts, changed)
  // read back: every other entry as it was, the changed ones as meant
  const check = zipEntries(written)
  if (!check || check.entries.length !== read.parts.entries.length) return null
  for (const [index, entry] of check.entries.entries()) {
    const was = read.parts.entries[index]!
    if (entry.name !== was.name) return null
    const meant = changed.get(entry.name)
    const now = entryData(written, entry)
    const before = meant ?? entryData(zip, was)
    if (!now || !before || !now.equals(before)) return null
  }
  return new Uint8Array(written.buffer, written.byteOffset, written.byteLength)
}

// ---- both ----

/**
 * The tabs the engine wrote without values, in the order of the file; at most
 * MAX_NEW_TABS. Empty for a file without any, or one that cannot be read here. Never throws.
 */
export function newTabsOf(file: Uint8Array, format: HwpFormat): TabSpot[] {
  try {
    if (format === 'hwp') {
      return (hwpTabs(file) ?? [])
        .flatMap((section) => section.found.map((tab) => tab.spot))
        .slice(0, MAX_NEW_TABS)
    }
    const read = hwpxSections(Buffer.from(file.buffer, file.byteOffset, file.byteLength))
    return (read?.sections ?? [])
      .sort((a, b) => a.sec - b.sec)
      .flatMap((section) => section.tabs.map(xmlSpot))
      .slice(0, MAX_NEW_TABS)
  } catch {
    return []
  }
}

/**
 * The file with the measured values written into the tabs that have none. Only such tabs
 * are written, each one found again by its place in the file; a measure for a place that
 * holds no such tab is dropped. The file comes back as it was when nothing can be written,
 * and when the result cannot be read back as meant. Never throws: a save does not fail on
 * this.
 */
export function writeTabWidths(
  file: Uint8Array,
  format: HwpFormat,
  measured: readonly MeasuredTab[],
): { bytes: Uint8Array; written: number } {
  try {
    if (measured.length === 0) return { bytes: file, written: 0 }
    const spots = new Map(newTabsOf(file, format).map((spot) => [keyOf(spot), spot]))
    const wanted = new Map<string, TabMeasure>()
    for (const tab of measured.slice(0, MAX_NEW_TABS)) {
      const spot = spots.get(keyOf(tab))
      // the paragraph's tab count is part of the place: one that does not match is not written
      if (spot && spot.tabs === tab.tabs && validMeasure(tab)) {
        wanted.set(keyOf(tab), { width: tab.width, type: tab.type, fill: tab.fill })
      }
    }
    if (wanted.size === 0) return { bytes: file, written: 0 }
    const bytes = format === 'hwp' ? writeHwpTabs(file, wanted) : writeHwpxTabs(file, wanted)
    return bytes && bytes !== file ? { bytes, written: wanted.size } : { bytes: file, written: 0 }
  } catch {
    return { bytes: file, written: 0 }
  }
}
