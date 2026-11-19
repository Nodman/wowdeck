import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { isWowClientExecutable, isWowLauncherExecutable } from "../installation/WowExecutables";

/**
 * Read a Windows executable's own icon into an ICO, without Windows.
 *
 * A PE file carries icons as two resource types:
 *   - RT_GROUP_ICON (14): the directory — one GRPICONDIRENTRY per image,
 *     naming each image by its RT_ICON id;
 *   - RT_ICON (3): the images themselves, BMP or PNG payloads.
 * Windows' icon loader joins them at runtime; this module joins them the same
 * way into the ICONDIR an `<img src="data:image/x-icon;base64,…">` accepts.
 *
 * Only the resource tree is parsed: no section is loaded, nothing executes,
 * and the bytes come from the player's own client or launcher executable. Every malformed
 * shape returns undefined; the caller falls back to our glyph.
 *
 * Tests build a synthetic PE; they never read a Blizzard binary.
 */

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const GROUP_ICON_HEADER = 6;
const GROUP_ICON_ENTRY = 14;
const ICO_HEADER = 6;
const ICO_ENTRY = 16;
const MAX_ICONS = 64;
const MAX_ICON_BYTES = 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;

type Section = {
  virtualAddress: number;
  rawSize: number;
  rawPointer: number;
};

type ResourceData = { rva: number; size: number };

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function fits(bytes: Uint8Array, at: number, length: number): boolean {
  return at >= 0 && length >= 0 && at + length <= bytes.length;
}

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  if (!fits(bytes, at, text.length)) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** A section table maps an RVA to a file offset; nothing outside a section. */
function sectionsOf(bytes: Uint8Array, peOffset: number): Section[] | undefined {
  if (!fits(bytes, peOffset, 24)) return undefined;
  const count = u16(bytes, peOffset + 6);
  const optionalSize = u16(bytes, peOffset + 20);
  const table = peOffset + 24 + optionalSize;
  if (count === 0 || count > 96 || !fits(bytes, table, count * 40)) return undefined;
  const sections: Section[] = [];
  for (let i = 0; i < count; i++) {
    const at = table + i * 40;
    sections.push({
      virtualAddress: u32(bytes, at + 12),
      rawSize: u32(bytes, at + 16),
      rawPointer: u32(bytes, at + 20),
    });
  }
  return sections;
}

function fileOffset(sections: Section[], rva: number, length: number): number | undefined {
  for (const section of sections) {
    if (rva < section.virtualAddress || rva + length > section.virtualAddress + section.rawSize)
      continue;
    return section.rawPointer + (rva - section.virtualAddress);
  }
  return undefined;
}

/** The resource directory's `(rva, size)` from the optional header's data table. */
function resourceDirectory(bytes: Uint8Array, peOffset: number): ResourceData | undefined {
  const optional = peOffset + 24;
  if (!fits(bytes, peOffset, 24) || !fits(bytes, optional, 2)) return undefined;
  const optionalEnd = optional + u16(bytes, peOffset + 20);
  const magic = u16(bytes, optional);
  const dataBase = magic === 0x10b ? optional + 96 : magic === 0x20b ? optional + 112 : undefined;
  if (dataBase === undefined || dataBase + 3 * 8 > optionalEnd || !fits(bytes, dataBase - 4, 28))
    return undefined;
  if (u32(bytes, dataBase - 4) < 3) return undefined;
  const rva = u32(bytes, dataBase + 2 * 8);
  const size = u32(bytes, dataBase + 2 * 8 + 4);
  return rva === 0 || size === 0 ? undefined : { rva, size };
}

/**
 * Walk one directory level and return the entry whose id (or name) matches.
 * A resource tree is three levels deep: type, name/id, language.
 */
function resourceEntry(bytes: Uint8Array, dir: number, id: number): ResourceData | undefined {
  if (!fits(bytes, dir, 16)) return undefined;
  const count = u16(bytes, dir + 12) + u16(bytes, dir + 14);
  if (count === 0 || count > 4096 || !fits(bytes, dir + 16, count * 8)) return undefined;
  for (let i = 0; i < count; i++) {
    const at = dir + 16 + i * 8;
    const name = u32(bytes, at);
    if (name !== id) continue;
    // A subdirectory is marked in the offset field, not the name field.
    const offset = u32(bytes, at + 4);
    if (!(offset & 0x80000000)) return undefined;
    return { rva: offset & 0x7fffffff, size: 0 };
  }
  return undefined;
}

function readDataEntry(bytes: Uint8Array, dir: number): ResourceData | undefined {
  if (!fits(bytes, dir, 16)) return undefined;
  const rva = u32(bytes, dir);
  const size = u32(bytes, dir + 4);
  return size === 0 ? undefined : { rva, size };
}

/**
 * The first language under a name directory; the tree is type → id → language.
 * Directory offsets are relative to the resource section.
 */
function leafData(bytes: Uint8Array, nameDir: number): ResourceData | undefined {
  if (!fits(bytes, nameDir, 16)) return undefined;
  const count = u16(bytes, nameDir + 12) + u16(bytes, nameDir + 14);
  if (count === 0 || count > 4096 || !fits(bytes, nameDir + 16, count * 8)) return undefined;
  for (let i = 0; i < count; i++) {
    const at = nameDir + 16 + i * 8;
    if (u32(bytes, at) & 0x80000000) continue;
    const offset = u32(bytes, at + 4);
    if (offset & 0x80000000) continue;
    const data = readDataEntry(bytes, offset);
    if (data) return data;
  }
  return undefined;
}

function firstId(bytes: Uint8Array, dir: number): number | undefined {
  if (!fits(bytes, dir, 16)) return undefined;
  const count = u16(bytes, dir + 12) + u16(bytes, dir + 14);
  if (count === 0 || count > 4096 || !fits(bytes, dir + 16, count * 8)) return undefined;
  for (let i = 0; i < count; i++) {
    const at = dir + 16 + i * 8;
    const name = u32(bytes, at);
    if (name & 0x80000000) continue;
    return name;
  }
  return undefined;
}

type GroupEntry = {
  width: number;
  height: number;
  colors: number;
  planes: number;
  bits: number;
  size: number;
  id: number;
};

function readGroup(bytes: Uint8Array): GroupEntry[] | undefined {
  if (!fits(bytes, 0, GROUP_ICON_HEADER)) return undefined;
  if (u16(bytes, 0) !== 0 || u16(bytes, 2) !== 1) return undefined;
  const count = u16(bytes, 4);
  if (count === 0 || count > MAX_ICONS || !fits(bytes, GROUP_ICON_HEADER, count * GROUP_ICON_ENTRY))
    return undefined;
  const entries: GroupEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = GROUP_ICON_HEADER + i * GROUP_ICON_ENTRY;
    entries.push({
      width: bytes[at],
      height: bytes[at + 1],
      colors: bytes[at + 2],
      planes: u16(bytes, at + 4),
      bits: u16(bytes, at + 6),
      size: u32(bytes, at + 8),
      id: u16(bytes, at + 12),
    });
  }
  return entries;
}

function isIconImage(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, "\x89PNG\r\n\x1a\n")) {
    // PNG IHDR has a fixed 13-byte payload. Chromium validates the image data.
    return fits(bytes, 0, 33) && u32(bytes, 8) === 0x0d000000 && ascii(bytes, 12, "IHDR");
  }
  // Icon bitmaps start with a DIB header, without a BMP file header.
  if (!fits(bytes, 0, 12)) return false;
  const size = u32(bytes, 0);
  if (!fits(bytes, 0, size + 1)) return false;
  if (size === 12) return u16(bytes, 8) === 1;
  return size >= 40 && u16(bytes, 12) === 1;
}

/**
 * The ICO for a PE's first icon group, or undefined when the file has no
 * readable icons. A group that names an image it does not contain is treated
 * as malformed: half an ICO is worse than our glyph.
 */
export function readExecutableIcon(pe: Uint8Array): Uint8Array | undefined {
  if (!fits(pe, 0, 0x40) || !ascii(pe, 0, "MZ")) return undefined;
  const peOffset = u32(pe, 0x3c);
  if (!fits(pe, peOffset, 4) || !ascii(pe, peOffset, "PE\0\0")) return undefined;

  const sections = sectionsOf(pe, peOffset);
  const directory = resourceDirectory(pe, peOffset);
  if (!sections || !directory) return undefined;

  const root = fileOffset(sections, directory.rva, directory.size);
  if (root === undefined || !fits(pe, root, directory.size)) return undefined;

  const resources = pe.subarray(root, root + directory.size);
  const groups = resourceEntry(resources, 0, RT_GROUP_ICON);
  const icons = resourceEntry(resources, 0, RT_ICON);
  if (!groups || !icons) return undefined;

  const groupId = firstId(resources, groups.rva);
  if (groupId === undefined) return undefined;
  const groupDir = resourceEntry(resources, groups.rva, groupId);
  if (!groupDir) return undefined;
  const groupData = leafData(resources, groupDir.rva);
  if (!groupData) return undefined;
  const groupOffset = fileOffset(sections, groupData.rva, groupData.size);
  if (groupOffset === undefined || !fits(pe, groupOffset, groupData.size)) return undefined;

  const group = readGroup(pe.subarray(groupOffset, groupOffset + groupData.size));
  if (!group) return undefined;

  const images: Uint8Array[] = [];
  let payloadBytes = 0;
  for (const entry of group) {
    const nameDir = resourceEntry(resources, icons.rva, entry.id);
    if (!nameDir) return undefined;
    const data = leafData(resources, nameDir.rva);
    if (!data || data.size !== entry.size) return undefined;
    payloadBytes += data.size;
    if (payloadBytes > MAX_ICON_BYTES) return undefined;
    const offset = fileOffset(sections, data.rva, data.size);
    if (offset === undefined || !fits(pe, offset, data.size)) return undefined;
    const image = pe.subarray(offset, offset + data.size);
    if (!isIconImage(image)) return undefined;
    images.push(image);
  }

  const total = ICO_HEADER + ICO_ENTRY * images.length;
  const ico = new Uint8Array(total + payloadBytes);
  const directoryView = new DataView(ico.buffer);
  directoryView.setUint16(2, 1, true);
  directoryView.setUint16(4, images.length, true);

  let imageOffset = total;
  for (let i = 0; i < images.length; i++) {
    const entry = group[i];
    const image = images[i];
    const at = ICO_HEADER + i * ICO_ENTRY;
    ico[at] = entry.width;
    ico[at + 1] = entry.height;
    ico[at + 2] = entry.colors;
    directoryView.setUint16(at + 4, entry.planes, true);
    directoryView.setUint16(at + 6, entry.bits, true);
    directoryView.setUint32(at + 8, image.length, true);
    directoryView.setUint32(at + 12, imageOffset, true);
    ico.set(image, imageOffset);
    imageOffset += image.length;
  }
  return ico;
}

type FileVersion = { size: number; mtimeMs: number };
type CachedIcon = FileVersion & { icon: Promise<Uint8Array | undefined> };

/**
 * The icon per executable file, keyed by the facts that make it stale
 * (path, size, mtime). A failed read is cached too: an iconless executable
 * must not be stat-and-parsed again on every page open.
 */
export class ExecutableIconCache {
  private readonly entries = new Map<string, CachedIcon>();

  constructor(
    private readonly stat: (
      path: string,
    ) => FileVersion | undefined | Promise<FileVersion | undefined>,
    private readonly read: (
      path: string,
      size: number,
    ) => Uint8Array | undefined | Promise<Uint8Array | undefined>,
  ) {}

  async icon(path: string): Promise<Uint8Array | undefined> {
    const file = await this.stat(path);
    if (!file || file.size > MAX_EXECUTABLE_BYTES) return undefined;
    const hit = this.entries.get(path);
    if (hit && hit.size === file.size && hit.mtimeMs === file.mtimeMs) return hit.icon;
    const icon = this.load(path, file.size);
    this.entries.set(path, { size: file.size, mtimeMs: file.mtimeMs, icon });
    if (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!);
    return icon;
  }

  private async load(path: string, size: number) {
    const bytes = await this.read(path, size);
    return bytes ? readExecutableIcon(bytes) : undefined;
  }
}

/** What the frontend puts in `<img src>`; the engine stays base64-agnostic. */
export function iconDataUrl(ico: Uint8Array): string {
  return `data:image/x-icon;base64,${Buffer.from(ico).toString("base64")}`;
}

const cache = new ExecutableIconCache(
  async (path) => {
    const file = await stat(path).catch(() => undefined);
    return file?.isFile() ? file : undefined;
  },
  async (path, size) => {
    try {
      return new Uint8Array(await Bun.file(path).slice(0, size).arrayBuffer());
    } catch {
      return undefined;
    }
  },
);

export async function executableIcon(directory: string): Promise<string | undefined> {
  const files = await readdir(directory).catch(() => []);
  for (const name of files.filter(isWowClientExecutable).sort()) {
    const path = await realpath(join(directory, name)).catch(() => undefined);
    if (!path || dirname(path) !== directory || !isWowClientExecutable(basename(path))) continue;
    const icon = await cache.icon(path);
    if (icon) return iconDataUrl(icon);
  }
  return undefined;
}

/** The icon of the launcher a shortcut starts: Battle.net's own, read like a client's. */
export async function launcherIcon(executable: string): Promise<string | undefined> {
  if (!isAbsolute(executable)) return undefined;
  const path = await realpath(executable).catch(() => undefined);
  if (!path || !isWowLauncherExecutable(basename(path))) return undefined;
  const icon = await cache.icon(path);
  return icon && iconDataUrl(icon);
}
