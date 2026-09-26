import type { Coverage, Snapshot, SnapshotFileData, User } from '../types';

export const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
const MAX_USERS = 200_000;
const MAX_SNAPSHOTS = 2_000;
const MAX_RELATIONSHIPS = 2_000_000;

export interface ValidatedBackup {
  format: 'insta-tracker';
  version: 1;
  exportedAt: string;
  snapshots: Snapshot[];
  users: User[];
}

type RecordValue = Record<string, unknown>;
const invalid = (message: string): never => { throw new Error(`Invalid backup: ${message}`); };
const record = (value: unknown, label: string): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label} must be an object.`);
  return value as RecordValue;
};
const text = (value: unknown, label: string, max = 256, allowEmpty = false): string => {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    invalid(`${label} is not a valid string.`);
  }
  return value as string;
};
const identifier = (value: unknown, label: string): string => {
  const id = text(value, label);
  if (id !== id.trim() || /\s/.test(id)) invalid(`${label} is not a valid ID.`);
  return id;
};
const array = (value: unknown, label: string, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) invalid(`${label} must be an array with at most ${max.toLocaleString('en-US')} entries.`);
  return value as unknown[];
};
const strings = (value: unknown, label: string, max: number, maxLength = 256): string[] =>
  array(value, label, max).map(item => text(item, label, maxLength));
const boolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') invalid(`${label} must be a boolean.`);
  return value as boolean;
};
const count = (value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) invalid(`${label} must be a nonnegative integer.`);
  return value as number;
};
const date = (value: unknown, label: string): string => {
  const result = text(value, label, 40);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(result);
  if (!parts || !Number.isFinite(Date.parse(result))) invalid(`${label} must be a valid ISO date with a time zone.`);
  const [, year, month, day, hour, minute, second] = parts!;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 ||
      calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) invalid(`${label} is not a valid calendar date.`);
  return result;
};

export const normalizeAccountUsername = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Enter a valid Instagram account username.');
  const username = value.trim().replace(/^@/, '').toLowerCase();
  if (!/^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/.test(username)) throw new Error('Enter a valid Instagram account username.');
  return username;
};

const parseUser = (value: unknown): User => {
  const user = record(value, 'User');
  const result: User = {
    id: identifier(user.id, 'User ID'),
    currentUsername: text(user.currentUsername, 'Username'),
    usernames: strings(user.usernames, 'Username history', 1_000),
    fullNames: array(user.fullNames, 'Name history', 1_000).map(item => text(item, 'Name', 1_000, true)),
    firstSeenAt: date(user.firstSeenAt, 'First-seen date'),
    lastSeenAt: date(user.lastSeenAt, 'Last-seen date'),
  };
  if (!result.usernames.includes(result.currentUsername)) invalid('Username history must contain the current username.');
  if (Date.parse(result.firstSeenAt) > Date.parse(result.lastSeenAt)) invalid('First-seen date must not follow last-seen date.');
  return result;
};

const parseFile = (value: unknown): SnapshotFileData => {
  const file = record(value, 'Source file');
  if (file.role !== 'followers' && file.role !== 'following') invalid('Source file has an unsupported role.');
  return {
    role: file.role as SnapshotFileData['role'],
    fileName: text(file.fileName, 'Source filename', 1_024),
    fileSize: count(file.fileSize, 'Source file size'),
    fileHash: text(file.fileHash, 'Source file hash', 256, true),
  };
};

const parseSnapshot = (value: unknown, users: Set<string>, onRelationships: (count: number) => void): Snapshot => {
  const snapshot = record(value, 'Snapshot');
  const data = record(snapshot.data, 'Snapshot data');
  const meta = record(snapshot.meta, 'Snapshot metadata');
  const rowCount = record(meta.rowCount, 'Source row counts');
  const followersById = array(data.followersById, 'Follower IDs', MAX_USERS).map(item => identifier(item, 'Follower ID'));
  const followingById = array(data.followingById, 'Following IDs', MAX_USERS).map(item => identifier(item, 'Following ID'));
  const followersUsernames = strings(data.followersUsernames, 'Follower usernames', MAX_USERS);
  const followingUsernames = strings(data.followingUsernames, 'Following usernames', MAX_USERS);
  onRelationships(followersById.length + followingById.length);
  for (const [ids, usernames] of [[followersById, followersUsernames], [followingById, followingUsernames]]) {
    if (ids.length !== usernames.length) invalid('Snapshot IDs and usernames must align.');
    if (new Set(ids).size !== ids.length) invalid('A relationship list contains duplicate IDs.');
    if (ids.some(id => !users.has(id))) invalid('A snapshot references a missing user.');
  }
  const result: Snapshot = {
    id: identifier(snapshot.id, 'Snapshot ID'),
    createdAt: date(snapshot.createdAt, 'Snapshot creation date'),
    isPartial: boolean(snapshot.isPartial, 'Partial snapshot status'),
    data: { followersById, followingById, followersUsernames, followingUsernames },
    meta: {
      files: array(meta.files, 'Source files', 1_000).map(parseFile),
      rowCount: { followers: count(rowCount.followers, 'Follower row count'), following: count(rowCount.following, 'Following row count') },
      parseWarnings: strings(meta.parseWarnings, 'Parse warnings', 10_000, 2_000),
      hasIds: boolean(meta.hasIds, 'Source ID status'),
    },
  };
  if (snapshot.name !== undefined) result.name = text(snapshot.name, 'Snapshot name', 1_000, true);
  if (meta.label !== undefined) result.meta.label = text(meta.label, 'Snapshot label', 1_000, true);
  if (snapshot.updatedAt !== undefined) {
    result.updatedAt = date(snapshot.updatedAt, 'Snapshot update date');
    if (Date.parse(result.updatedAt) < Date.parse(result.createdAt)) invalid('Snapshot update date must not precede creation date.');
  }
  if (snapshot.capturedAt !== undefined) result.capturedAt = date(snapshot.capturedAt, 'Capture date');
  if (snapshot.accountUsername !== undefined) result.accountUsername = normalizeAccountUsername(snapshot.accountUsername);
  if (snapshot.coverage !== undefined) {
    const coverage = record(snapshot.coverage, 'List coverage');
    if (![coverage.followers, coverage.following].every(state => ['complete', 'missing', 'uncertain'].includes(state as string))) invalid('List coverage is unsupported.');
    result.coverage = { followers: coverage.followers, following: coverage.following } as Coverage;
    if (result.isPartial !== (result.coverage.followers !== 'complete' || result.coverage.following !== 'complete')) invalid('List coverage and partial status disagree.');
    if ((result.coverage.followers === 'missing' && followersById.length) || (result.coverage.following === 'missing' && followingById.length)) invalid('A missing list cannot contain relationships.');
  }
  return result;
};

/** Validates and copies all persisted fields before any database mutation. */
export const parseBackup = (value: unknown): ValidatedBackup => {
  const input = record(value, 'Backup');
  const legacy = input.format === undefined && input.version === undefined;
  if (!legacy && (input.format !== 'insta-tracker' || input.version !== 1)) invalid('This backup format or version is not supported.');
  let json: string;
  try { json = JSON.stringify(input); } catch { return invalid('Backup must contain serializable data.'); }
  if (new TextEncoder().encode(json).byteLength > BACKUP_MAX_BYTES) invalid('Backup exceeds the 50 MB size limit.');
  const users = array(input.users, 'Users', MAX_USERS).map(parseUser);
  const userIds = new Set(users.map(user => user.id));
  if (userIds.size !== users.length) invalid('Duplicate user IDs.');
  let relationshipCount = 0;
  const snapshots = array(input.snapshots, 'Snapshots', MAX_SNAPSHOTS).map(value => parseSnapshot(value, userIds, count => {
    relationshipCount += count;
    if (relationshipCount > MAX_RELATIONSHIPS) invalid('Backup exceeds the 2,000,000 relationship limit.');
  }));
  if (new Set(snapshots.map(snapshot => snapshot.id)).size !== snapshots.length) invalid('Duplicate snapshot IDs.');
  return {
    format: 'insta-tracker', version: 1,
    exportedAt: legacy ? new Date().toISOString() : date(input.exportedAt, 'Backup export date'),
    snapshots, users,
  };
};

export const createBackup = (snapshots: Snapshot[], users: User[]): ValidatedBackup =>
  parseBackup({ format: 'insta-tracker', version: 1, exportedAt: new Date().toISOString(), snapshots, users });
