import Papa from 'papaparse';
import { Coverage, ProcessedFileData, RelationshipRole } from '../types';

export const MAX_LIST_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_LIST_ROWS = 100_000;

export const calculateFileHash = async (file: File): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
};

export const textToHash = async (text: string): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
};

export const normalizeUsername = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/^@/, '').toLowerCase();
  return /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/.test(name) ? name : null;
};

export const relationshipFile = (name: string): { role: RelationshipRole; part?: number } | null => {
  const match = /^(followers|following)(?:_([1-9]\d*))?\.(json|csv)$/i.exec(name.split(/[\\/]/).pop() || '');
  if (!match) return null;
  const part = match[2] ? Number(match[2]) : undefined;
  if (part !== undefined && !Number.isSafeInteger(part)) return null;
  return { role: match[1].toLowerCase() as RelationshipRole, part };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const ID_FIELDS = ['id', 'user_id', 'pk', 'instagram_id'];
const USERNAME_HEADERS = ['username', 'user name', 'handle', 'profile'];
const NAME_HEADERS = ['full_name', 'full name', 'fullname', 'name'];

const stableId = (value: unknown, location: string): string | undefined => {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return undefined;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${location}: IDs must be positive safe integers or digit strings. Export large IDs as strings.`);
    }
    return String(value);
  }
  if (typeof value !== 'string' || !/^\d{1,100}$/.test(value.trim()) || /^0+$/.test(value.trim())) {
    throw new Error(`${location}: invalid user ID. Use a positive integer stored as a string.`);
  }
  return value.trim().replace(/^0+(?=\d)/, '');
};

const recordId = (item: Record<string, unknown>, location: string): string | undefined => {
  const ids = ID_FIELDS.filter(key => hasOwn(item, key)).map(key => stableId(item[key], location)).filter(Boolean);
  if (new Set(ids).size > 1) throw new Error(`${location}: conflicting user ID fields.`);
  return ids[0];
};

interface ParsedUser { username: string; id?: string; fullName: string | null }

const simpleUser = (value: unknown, location: string): ParsedUser => {
  const username = normalizeUsername(typeof value === 'string' ? value : isObject(value) ? value.username : null);
  if (!username) throw new Error(`${location}: missing or invalid Instagram username.`);
  let fullName: string | null = null;
  if (isObject(value)) {
    const name = value.fullName ?? value.full_name ?? null;
    if (name !== null && typeof name !== 'string') throw new Error(`${location}: full name must be text.`);
    fullName = typeof name === 'string' ? name.trim() || null : null;
  }
  return { username, fullName, id: isObject(value) ? recordId(value, location) : undefined };
};

const usernameFromHref = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
    const match = /^\/(?:_u\/)?([^/]+)\/?$/.exec(url.pathname);
    return match ? normalizeUsername(decodeURIComponent(match[1])) : null;
  } catch { return null; }
};

const officialUser = (value: unknown, location: string): ParsedUser => {
  if (!isObject(value) || !Array.isArray(value.string_list_data) || value.string_list_data.length !== 1 || !isObject(value.string_list_data[0])) {
    throw new Error(`${location}: expected one Instagram string_list_data entry.`);
  }
  const entry = value.string_list_data[0];
  const hasValue = entry.value !== undefined && entry.value !== null && entry.value !== '';
  const hrefName = entry.href === undefined ? null : usernameFromHref(entry.href);
  if (entry.href !== undefined && !hrefName) throw new Error(`${location}: invalid Instagram profile link.`);
  const username = hasValue ? normalizeUsername(entry.value) : hrefName ? normalizeUsername(value.title) || hrefName : null;
  if (!username) throw new Error(`${location}: missing or invalid Instagram username.`);
  if (hrefName && hrefName !== username) throw new Error(`${location}: username and profile link disagree.`);
  return { username, id: recordId(value, location), fullName: null };
};

class ListCollector {
  coverage: Coverage = { followers: 'missing', following: 'missing' };
  rows = 0;
  duplicateCount = 0;
  records = new Map<string, ParsedUser>();
  stableNames = new Map<string, string>();
  lists: Record<RelationshipRole, Set<string>> = { followers: new Set(), following: new Set() };

  present(role: RelationshipRole) { this.coverage[role] = 'complete'; }

  add(user: ParsedUser, role: RelationshipRole, location: string) {
    if (++this.rows > MAX_LIST_ROWS) throw new Error(`Too many relationship rows. Maximum ${MAX_LIST_ROWS.toLocaleString()} per file.`);
    const previous = this.records.get(user.username);
    if (previous?.id && user.id && previous.id !== user.id) throw new Error(`${location}: one username has conflicting IDs.`);
    if (user.id && this.stableNames.has(user.id) && this.stableNames.get(user.id) !== user.username) {
      throw new Error(`${location}: one ID has conflicting usernames.`);
    }
    if (user.id) this.stableNames.set(user.id, user.username);
    this.records.set(user.username, { username: user.username, id: user.id || previous?.id, fullName: user.fullName || previous?.fullName || null });
    if (this.lists[role].has(user.username)) this.duplicateCount++;
    this.lists[role].add(user.username);
    this.present(role);
  }

  async finish(file: File, source: ProcessedFileData['source']): Promise<ProcessedFileData> {
    const warnings: string[] = [];
    if (this.duplicateCount) warnings.push(`Removed ${this.duplicateCount} duplicate relationship row(s).`);
    const entries = [...this.records.values()];
    const sourceIdCount = entries.filter(user => user.id).length;
    if (sourceIdCount > 0 && sourceIdCount < entries.length) warnings.push('Some entries lack stable IDs; identity comparisons may be uncertain.');
    const ids = new Map<string, string>();
    const users: ProcessedFileData['users'] = new Map();
    for (let offset = 0; offset < entries.length; offset += 256) {
      await Promise.all(entries.slice(offset, offset + 256).map(async user => {
        const id = user.id || await textToHash(user.username);
        ids.set(user.username, id);
        users.set(id, { username: user.username, fullName: user.fullName });
      }));
    }
    const role = this.coverage.followers === 'complete' && this.coverage.following === 'complete' ? 'combined'
      : this.coverage.followers === 'complete' ? 'followers' : 'following';
    return {
      followers: new Set([...this.lists.followers].map(name => ids.get(name)!)),
      following: new Set([...this.lists.following].map(name => ids.get(name)!)),
      users, warnings, role, coverage: this.coverage, source,
      fileInfo: { name: file.name, size: file.size, hash: await calculateFileHash(file) },
      rowCount: this.rows, hasIds: entries.length > 0 && sourceIdCount === entries.length,
    };
  }
}

const processJSON = async (file: File, content: string): Promise<ProcessedFileData> => {
  let data: unknown;
  try { data = JSON.parse(content); } catch { throw new Error('Invalid JSON. Download a fresh Instagram export in JSON format.'); }
  const collector = new ListCollector();
  let official = false;
  let recognized = false;
  const parseList = (list: unknown, role: RelationshipRole, format: 'official' | 'simple' | 'auto') => {
    if (!Array.isArray(list)) throw new Error(`The ${role} field must be an array.`);
    if (list.length > MAX_LIST_ROWS) throw new Error(`Too many relationship rows. Maximum ${MAX_LIST_ROWS.toLocaleString()} per file.`);
    recognized = true;
    collector.present(role); // [] is positive evidence of an explicitly empty list.
    for (const [index, item] of list.entries()) {
      const location = `${role} row ${index + 1}`;
      const isOfficial = format === 'official' || (format === 'auto' && isObject(item) && hasOwn(item, 'string_list_data'));
      official ||= isOfficial;
      collector.add(isOfficial ? officialUser(item, location) : simpleUser(item, location), role, location);
    }
  };
  if (Array.isArray(data)) {
    const identified = relationshipFile(file.name);
    if (!identified) throw new Error('Name a list file followers.json or following.json so its role is unambiguous.');
    parseList(data, identified.role, 'auto');
    // The official empty-array format has no per-row marker.
    official ||= data.length === 0;
  } else if (isObject(data)) {
    for (const role of ['followers', 'following'] as const) {
      const officialKey = `relationships_${role}`;
      if (hasOwn(data, officialKey) && hasOwn(data, role)) throw new Error(`Duplicate ${role} containers. Import one representation per list.`);
      if (hasOwn(data, officialKey)) { official = true; parseList(data[officialKey], role, 'official'); }
      if (hasOwn(data, role)) parseList(data[role], role, 'simple');
    }
  }
  if (!recognized) throw new Error('No followers or following list found. Choose the Instagram Followers and following JSON export.');
  const identified = relationshipFile(file.name);
  if (identified && collector.coverage[identified.role] === 'missing') throw new Error('The list contents disagree with the file name.');
  return collector.finish(file, official ? 'instagram-json' : 'simple-json');
};

const processCSV = async (file: File, content: string): Promise<ProcessedFileData> => {
  const parsed = Papa.parse<string[]>(content, { dynamicTyping: false, skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t'] });
  const errors = parsed.errors.filter(error => error.code !== 'UndetectableDelimiter');
  if (errors.length) throw new Error('Malformed CSV quoting or structure. Export a fresh CSV file.');
  if (parsed.data.length < 2) throw new Error('CSV contains no data rows. Use an explicit empty JSON array to represent an empty list.');
  const headers = parsed.data[0].map(value => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length || headers.some(value => !value)) throw new Error('CSV headers must be unique and non-empty.');
  const oneColumn = (aliases: string[]) => {
    const matches = headers.map((value, index) => aliases.includes(value) ? index : -1).filter(index => index >= 0);
    if (matches.length > 1) throw new Error('CSV has ambiguous duplicate user columns.');
    return matches[0] ?? -1;
  };
  const usernameIndex = oneColumn(USERNAME_HEADERS);
  const nameIndex = oneColumn(NAME_HEADERS);
  const idIndex = oneColumn(ID_FIELDS);
  const listIndex = headers.indexOf('list_type');
  const fileRole = relationshipFile(file.name)?.role;
  if (usernameIndex < 0) throw new Error('CSV needs a username column (username, user name, handle, or profile).');
  if (!fileRole && listIndex < 0) throw new Error('Name the CSV followers.csv or following.csv, or include a list_type column.');
  const collector = new ListCollector();
  for (const [index, cells] of parsed.data.slice(1).entries()) {
    const location = `CSV record ${index + 2}`;
    if (cells.length !== headers.length) throw new Error(`${location}: column count does not match the header.`);
    let role = fileRole;
    if (listIndex >= 0) {
      const value = cells[listIndex].trim().toLowerCase();
      role = value === 'follower' || value === 'followers' ? 'followers' : value === 'following' ? 'following' : undefined;
      if (!role) throw new Error(`${location}: list_type must be follower, followers, or following.`);
      if (fileRole && fileRole !== role) throw new Error(`${location}: list_type disagrees with the file name.`);
    }
    const username = normalizeUsername(cells[usernameIndex]);
    if (!username) throw new Error(`${location}: missing or invalid Instagram username.`);
    collector.add({ username, id: idIndex >= 0 ? stableId(cells[idIndex], location) : undefined, fullName: nameIndex >= 0 ? cells[nameIndex].trim() || null : null }, role!, location);
  }
  return collector.finish(file, 'csv');
};

export const processAndParseFile = async (file: File): Promise<ProcessedFileData> => {
  if (/\.html?$/i.test(file.name)) throw new Error('HTML exports are not supported. Request JSON format from Instagram.');
  if (!/\.(json|csv)$/i.test(file.name)) throw new Error('Choose a JSON or CSV relationship file. Use the archive importer for ZIP files.');
  if (file.size > MAX_LIST_FILE_BYTES) throw new Error('Relationship file exceeds the 20 MiB size limit.');
  if (!file.size) throw new Error('The file is empty. Use an explicit empty JSON array to represent an empty list.');
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, ''); }
  catch { throw new Error('The file is not valid UTF-8 text. Export a fresh JSON or CSV file.'); }
  if (/^\s*</.test(content)) throw new Error('This appears to be HTML. Request JSON format from Instagram.');
  return /\.json$/i.test(file.name) ? processJSON(file, content) : processCSV(file, content);
};
