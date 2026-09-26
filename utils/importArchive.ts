import { Inflate } from 'fflate';
import { ProcessedFileData, RelationshipRole } from '../types';
import { MAX_LIST_FILE_BYTES, MAX_LIST_ROWS, processAndParseFile, relationshipFile } from './csvParser';

export const IMPORT_LIMITS = Object.freeze({
  inputBytes: 50 * 1024 * 1024,
  extractedBytes: 50 * 1024 * 1024,
  entryBytes: MAX_LIST_FILE_BYTES,
  archiveEntries: 2_000,
  relationshipFiles: 100,
});

interface ZipEntry {
  name: string;
  compressedSize: number;
  originalSize: number;
  crc: number;
  method: number;
  start: number;
}

const invalidZip = () => new Error('Invalid or unsupported ZIP archive. Download a fresh Instagram JSON export.');

// Nothing is extracted to the filesystem. Paths are nevertheless validated before any decompression.
const validPath = (name: string) => {
  const parts = name.replace(/\/$/, '').split('/');
  return name.length > 0 && name.length <= 1_024 && !/[\\\x00-\x1f\x7f:]/.test(name) &&
    !name.startsWith('/') && parts.every(part => part && part !== '.' && part !== '..');
};

const readEntries = (bytes: Uint8Array): ZipEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw invalidZip();
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw invalidZip();
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count ||
      count === 0xffff || centralStart === 0xffffffff || centralSize === 0xffffffff || centralStart + centralSize !== end) throw invalidZip();
  if (count > IMPORT_LIMITS.archiveEntries) throw new Error('ZIP contains too many entries. Export only Followers and following.');
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  const ranges: [number, number][] = [];
  let offset = centralStart;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalidZip();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const originalSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const disk = view.getUint16(offset + 34, true);
    const attributes = view.getUint32(offset + 38, true);
    const local = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end || disk || compressedSize === 0xffffffff || originalSize === 0xffffffff || local === 0xffffffff ||
        flags & 1 || ![0, 8].includes(method) || ((attributes >>> 16) & 0xf000) === 0xa000) throw invalidZip();
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); }
    catch { throw new Error('ZIP filenames must use UTF-8. Export a fresh archive.'); }
    if (!validPath(name)) throw new Error('ZIP contains an unsafe path. Import the original Instagram export.');
    const canonical = name.toLowerCase();
    if (names.has(canonical)) throw new Error('ZIP contains duplicate paths. Import one export at a time.');
    names.add(canonical);
    if (local + 30 > centralStart || view.getUint32(local, true) !== 0x04034b50 ||
        view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw invalidZip();
    const localNameLength = view.getUint16(local + 26, true);
    const start = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (localNameLength !== nameLength || start + compressedSize > centralStart) throw invalidZip();
    for (let char = 0; char < nameLength; char++) {
      if (bytes[local + 30 + char] !== bytes[offset + 46 + char]) throw invalidZip();
    }
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressedSize || view.getUint32(local + 22, true) !== originalSize)) throw invalidZip();
    if (method === 0 && compressedSize !== originalSize) throw invalidZip();
    ranges.push([local, start + compressedSize]);
    entries.push({ name, compressedSize, originalSize, crc, method, start });
    offset = next;
  }
  if (offset !== end) throw invalidZip();
  ranges.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ranges.length; index++) if (ranges[index][0] < ranges[index - 1][1]) throw invalidZip();
  return entries;
};

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const checkParts = (names: string[]) => {
  for (const role of ['followers', 'following'] as const) {
    const group = names.map(name => relationshipFile(name)).filter(item => item?.role === role);
    if (!group.length) continue;
    if (group.length > 1 && group.some(item => item.part === undefined)) throw new Error(`Overlapping ${role} files. Choose one export, including all its numbered parts.`);
    const parts = group.map(item => item.part).filter((part): part is number => part !== undefined).sort((a, b) => a - b);
    if (parts.some((part, index) => part !== index + 1)) throw new Error(`Missing or duplicate ${role} parts. Select every numbered file starting with part 1.`);
  }
};

const unpack = async (file: File): Promise<File[]> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readEntries(bytes);
  // Strict basenames exclude pending requests, close friends, recently unfollowed, and other lists.
  const chosen = entries.filter(entry => !entry.name.startsWith('__MACOSX/') && relationshipFile(entry.name));
  if (!chosen.length) {
    if (entries.some(entry => /(?:^|\/)(?:followers|following)(?:_\d+)?\.html?$/i.test(entry.name))) {
      throw new Error('This ZIP contains HTML lists. Request JSON format from Instagram.');
    }
    throw new Error('No followers or following JSON/CSV files found in the ZIP. Export Followers and following.');
  }
  if (chosen.length > IMPORT_LIMITS.relationshipFiles) throw new Error('ZIP contains too many relationship files. Import one account export at a time.');
  if (new Set(chosen.map(entry => entry.name.slice(0, entry.name.lastIndexOf('/') + 1))).size > 1) {
    throw new Error('Relationship files occur in multiple folders. Import one account export at a time.');
  }
  checkParts(chosen.map(entry => entry.name));
  let declaredBytes = 0;
  for (const entry of chosen) {
    if (entry.originalSize > IMPORT_LIMITS.entryBytes) throw new Error('A relationship file exceeds the 20 MiB decompressed limit.');
    declaredBytes += entry.originalSize;
    if (declaredBytes > IMPORT_LIMITS.extractedBytes) throw new Error('ZIP relationship data exceeds the 50 MiB decompressed limit.');
  }
  const files: File[] = [];
  let actualBytes = 0;
  for (const entry of chosen) {
    const output = new Uint8Array(entry.originalSize);
    let written = 0;
    let finished = false;
    const append = (chunk: Uint8Array, final: boolean) => {
      actualBytes += chunk.length;
      if (written + chunk.length > entry.originalSize || actualBytes > IMPORT_LIMITS.extractedBytes) throw new Error('ZIP decompressed data exceeds its declared size or the import limit.');
      output.set(chunk, written);
      written += chunk.length;
      finished = final;
    };
    try {
      if (entry.method === 0) append(bytes.subarray(entry.start, entry.start + entry.compressedSize), true);
      else {
        const inflater = new Inflate(append);
        // Bound each inflation step so dishonest size metadata cannot trigger an unbounded allocation.
        if (!entry.compressedSize) throw invalidZip();
        for (let position = 0; position < entry.compressedSize; position += 4_096) {
          const next = Math.min(position + 4_096, entry.compressedSize);
          inflater.push(bytes.subarray(entry.start + position, entry.start + next), next === entry.compressedSize);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('ZIP decompressed')) throw error;
      throw invalidZip();
    }
    if (!finished || written !== entry.originalSize || crc32(output) !== entry.crc) throw new Error('ZIP integrity check failed. Download a fresh Instagram export.');
    files.push(new File([output.buffer], entry.name, { type: /\.json$/i.test(entry.name) ? 'application/json' : 'text/csv' }));
  }
  return files;
};

export const processImportFiles = async (files: File[]): Promise<ProcessedFileData[]> => {
  if (!files.length) throw new Error('Choose an Instagram ZIP, JSON, or CSV export.');
  if (files.length > IMPORT_LIMITS.relationshipFiles) throw new Error('Too many input files. Import one account export at a time.');
  if (files.reduce((sum, file) => sum + file.size, 0) > IMPORT_LIMITS.inputBytes) throw new Error('Import exceeds the 50 MiB input limit. Export only Followers and following.');
  const zipFiles = files.filter(file => /\.zip$/i.test(file.name));
  if (zipFiles.length && files.length !== 1) throw new Error('Import one ZIP by itself, or select its JSON/CSV files. Do not mix archives and loose files.');
  const inputs = zipFiles.length ? await unpack(zipFiles[0]) : files;
  if (new Set(inputs.map(file => file.name.toLowerCase())).size !== inputs.length) throw new Error('Duplicate input filenames. Select one copy of each file.');
  checkParts(inputs.map(file => file.name));
  const results: ProcessedFileData[] = [];
  const rows: Record<RelationshipRole, number> = { followers: 0, following: 0 };
  for (const input of inputs) {
    const parsed = await processAndParseFile(input);
    for (const role of ['followers', 'following'] as const) {
      rows[role] += parsed[role].size;
      if (rows[role] > MAX_LIST_ROWS) throw new Error(`Too many ${role} entries in this import. Maximum ${MAX_LIST_ROWS.toLocaleString()}.`);
    }
    results.push(parsed);
  }
  for (const role of ['followers', 'following'] as const) {
    const contributors = results.filter(result => (result.role === role || result.role === 'combined') && result.coverage?.[role] !== 'missing');
    if (contributors.length < 2) continue;
    const validParts = contributors.every(result => {
      const identified = relationshipFile(result.fileInfo.name);
      return result.role === role && identified?.role === role && identified.part !== undefined;
    });
    if (!validParts) throw new Error(`Overlapping ${role} inputs. Import one export; only its numbered parts may contribute to the same list.`);
    checkParts(contributors.map(result => result.fileInfo.name));
  }
  // File presence is not proof of completeness: the UI separately asks the owner to confirm the export scope.
  return results;
};
