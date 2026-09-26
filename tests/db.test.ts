import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import type { Snapshot, User } from '../types';
import * as db from '../services/db';
import { createBackup, parseBackup } from '../services/backup';

const DATE = '2026-09-01T12:00:00.000Z';
const LATER = '2026-09-02T12:00:00.000Z';
const user = (id = '123', username = 'demo_alpha'): User => ({ id, currentUsername: username, usernames: [username], fullNames: [], firstSeenAt: DATE, lastSeenAt: DATE });
const snapshot = (id = 'snapshot-1', users: User[] = [user()]): Snapshot => ({
  id, createdAt: DATE, isPartial: false,
  data: { followersById: users.map(u => u.id), followingById: users.map(u => u.id), followersUsernames: users.map(u => u.currentUsername), followingUsernames: users.map(u => u.currentUsername) },
  meta: { files: [], rowCount: { followers: users.length, following: users.length }, parseWarnings: [], hasIds: true },
});

const seed = (version: number, snapshots: unknown[], users: User[] = [], extraStore = false): Promise<void> => new Promise((resolve, reject) => {
  const request = indexedDB.open('insta-tracker', version);
  request.onupgradeneeded = () => {
    const connection = request.result;
    const store = connection.createObjectStore('snapshots', { keyPath: 'id' });
    snapshots.forEach(value => store.put(value));
    if (version > 1 || users.length) {
      const userStore = connection.createObjectStore('users', { keyPath: 'id' });
      users.forEach(value => userStore.put(value));
    }
    if (extraStore) connection.createObjectStore('avatars').put('keep-this', 'synthetic-avatar');
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => { request.result.close(); resolve(); };
});

const rawRead = (): Promise<{ version: number; snapshots: unknown[] }> => new Promise((resolve, reject) => {
  const request = indexedDB.open('insta-tracker');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const connection = request.result;
    const transaction = connection.transaction('snapshots');
    const rows = transaction.objectStore('snapshots').getAll();
    transaction.oncomplete = () => { resolve({ version: connection.version, snapshots: rows.result }); connection.close(); };
  };
});

beforeEach(() => {
  db.closeDB();
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => { db.closeDB(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('preserving local history during upgrades', () => {
  it('migrates v1 without async crypto and preserves legacy SHA-256 identities', async () => {
    const names = ['demo_alpha', 'demo_beta', 'é'.repeat(40), 'a'.repeat(100)];
    await seed(1, [{ id: 'old-1', createdAt: DATE, name: 'Old history', data: { followers: names, following: ['demo_alpha'] }, meta: { sourceFileName: 'synthetic.csv' } }], [], true);
    const connection = await db.initDB();
    expect(connection.version).toBe(5);
    expect(connection.objectStoreNames.contains('avatars')).toBe(true);
    const records = await db.readBackup();
    expect(records.snapshots[0].data.followersById).toEqual(names.map(name => createHash('sha256').update(name).digest('hex')));
    expect(records.snapshots[0].data.followersUsernames).toEqual(names);
    expect(records.snapshots[0].name).toBe('Old history');
    expect(records.users).toHaveLength(4);
    expect(records.snapshots[0].accountUsername).toBeUndefined();
    expect(() => createBackup(records.snapshots, records.users)).not.toThrow();
  });

  it('does not invent an empty complete role when v1 records have no source evidence', async () => {
    await seed(1, [{ id: 'partial-v1', createdAt: DATE, data: { followers: ['demo_alpha'], following: [] }, meta: { sourceFileName: 'synthetic.csv' } }]);
    await db.initDB();
    const records = await db.readBackup();
    expect(records.snapshots[0].meta.files.map(file => file.role)).toEqual(['followers']);
    expect(records.snapshots[0].data.followingById).toEqual([]);
    expect(records.snapshots[0].coverage).toBeUndefined();
  });

  it('preserves explicit legacy source evidence for an empty role', async () => {
    const files = [{ role: 'following', fileName: 'synthetic.csv', fileSize: 0, fileHash: '' }];
    await seed(1, [{ id: 'empty-v1', createdAt: DATE, data: { followers: [], following: [] }, meta: { files } }]);
    await db.initDB();
    const records = await db.readBackup();
    expect(records.snapshots[0].meta.files).toEqual(files);
    expect(records.snapshots[0].data.followingById).toEqual([]);
  });

  it.each([2, 4])('repairs a username-only v%s snapshot, including an interrupted old migration', async version => {
    await seed(version, [{
      id: 'old-2', createdAt: DATE, isPartial: true,
      data: { followersById: [], followingById: [], followersUsernames: ['demo_alpha'], followingUsernames: [] },
      meta: { files: [], rowCount: { followers: 1, following: 0 }, parseWarnings: [], hasIds: false },
    }]);
    await db.initDB();
    const records = await db.readBackup();
    expect(records.snapshots[0].data.followersById).toEqual([createHash('sha256').update('demo_alpha').digest('hex')]);
    expect(records.snapshots[0].data.followingById).toEqual([]);
    expect(records.users[0].currentUsername).toBe('demo_alpha');
  });

  it('preserves existing v4 IDs, history and verified empty lists', async () => {
    const full = { ...snapshot(), accountUsername: 'demo_owner', capturedAt: DATE, coverage: { followers: 'complete', following: 'complete' } } as Snapshot;
    const empty = { ...snapshot('empty', []), coverage: { followers: 'complete', following: 'complete' } } as Snapshot;
    await seed(4, [full, empty], [user()]);
    await db.initDB();
    const records = await db.readBackup();
    expect(records.snapshots.find(s => s.id === full.id)).toEqual(full);
    expect(records.snapshots.find(s => s.id === 'empty')).toEqual(empty);
    expect(records.users).toEqual([user()]);
  });

  it('aborts a malformed upgrade without changing records or the database version', async () => {
    const malformed = { ...snapshot(), data: { ...snapshot().data, followersUsernames: [] } };
    await seed(4, [malformed], [user()]);
    await expect(db.initDB()).rejects.toThrow('Existing data was kept unchanged');
    expect(await rawRead()).toEqual({ version: 4, snapshots: [malformed] });
  });

  it('does not invent user records for dangling modern IDs', async () => {
    await seed(4, [snapshot()]);
    await expect(db.initDB()).rejects.toThrow('safely upgraded');
    expect((await rawRead()).version).toBe(4);
  });

  it('shares a connection for concurrent initialization', async () => {
    const [first, second] = await Promise.all([db.initDB(), db.initDB()]);
    expect(first).toBe(second);
  });
});

describe('versioned backup validation', () => {
  it('round-trips current account/capture/coverage metadata and accepts legacy backups', () => {
    const record: Snapshot = { ...snapshot(), accountUsername: 'demo_owner', capturedAt: DATE, coverage: { followers: 'complete', following: 'complete' } };
    const backup = createBackup([record], [user()]);
    expect(backup.format).toBe('insta-tracker');
    expect(backup.version).toBe(1);
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup);
    expect(parseBackup({ snapshots: [snapshot()], users: [user()] }).snapshots[0].accountUsername).toBeUndefined();
  });

  it('accepts real empty complete lists and copies the validated records', () => {
    const empty: Snapshot = { ...snapshot('empty', []), coverage: { followers: 'complete', following: 'complete' } };
    const backup = createBackup([empty], []);
    empty.data.followersById.push('later-mutation');
    expect(backup.snapshots[0].data.followersById).toEqual([]);
    expect(backup.snapshots[0].isPartial).toBe(false);
  });

  it.each([
    ['unsupported version', (b: any) => { b.version = 99; }],
    ['duplicate users', (b: any) => { b.users.push(b.users[0]); }],
    ['duplicate snapshots', (b: any) => { b.snapshots.push(b.snapshots[0]); }],
    ['missing user reference', (b: any) => { b.users = []; }],
    ['misaligned username arrays', (b: any) => { b.snapshots[0].data.followersUsernames = []; }],
    ['duplicate relationship IDs', (b: any) => { b.snapshots[0].data.followersById.push('123'); b.snapshots[0].data.followersUsernames.push('demo_alpha'); }],
    ['invalid date', (b: any) => { b.snapshots[0].createdAt = '2026-02-30T12:00:00.000Z'; }],
    ['unsupported coverage', (b: any) => { b.snapshots[0].coverage = { followers: 'yes', following: 'complete' }; }],
    ['negative file size', (b: any) => { b.snapshots[0].meta.files = [{ role: 'followers', fileName: 'synthetic.json', fileSize: -1, fileHash: '' }]; }],
    ['invalid user shape', (b: any) => { b.users[0].usernames = 'demo_alpha'; }],
    ['too many snapshots', (b: any) => { b.snapshots = Array(2001).fill(b.snapshots[0]); }],
  ])('rejects %s before touching existing storage', async (_label, mutate) => {
    await db.initDB();
    await db.replaceDatabase([snapshot()], [user()]);
    const prior = await db.readBackup();
    const candidate = createBackup([snapshot()], [user()]);
    mutate(candidate);
    expect(() => parseBackup(candidate)).toThrow();
    expect(await db.readBackup()).toEqual(prior);
  });
});

describe('atomic storage changes', () => {
  it('replaces both stores and exports them from one consistent read transaction', async () => {
    await db.initDB();
    await db.replaceDatabase([snapshot()], [user()]);
    const otherUser = user('456', 'demo_beta');
    const replacing = db.replaceDatabase([snapshot('snapshot-2', [otherUser])], [otherUser]);
    const reading = db.readBackup();
    await replacing;
    expect(await reading).toEqual({ snapshots: [snapshot('snapshot-2', [otherUser])], users: [otherUser] });
  });

  it('does not clear existing data when replacement validation fails', async () => {
    await db.initDB();
    await db.replaceDatabase([snapshot()], [user()]);
    expect(() => db.replaceDatabase([snapshot()], [])).toThrow('missing user');
    expect(await db.readBackup()).toEqual({ snapshots: [snapshot()], users: [user()] });
  });

  it('rolls back clears and user writes if a later snapshot write fails', async () => {
    await db.initDB();
    await db.replaceDatabase([snapshot()], [user()]);
    const original = FakeObjectStore.prototype.put;
    const mock = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      if (this.name === 'snapshots') throw new DOMException('Synthetic quota error', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    await expect(db.replaceDatabase([snapshot('replacement')], [user()])).rejects.toThrow('kept unchanged');
    mock.mockRestore();
    expect(await db.readBackup()).toEqual({ snapshots: [snapshot()], users: [user()] });
  });

  it('saves one snapshot with new users atomically and can update it with existing users', async () => {
    await db.initDB();
    await db.saveSnapshotWithUsers(snapshot(), [user()]);
    const renamed = { ...snapshot(), name: 'Reviewed', updatedAt: LATER };
    await db.saveSnapshotWithUsers(renamed, []);
    expect(await db.readBackup()).toEqual({ snapshots: [renamed], users: [user()] });
  });

  it('rolls back a user update when the associated snapshot cannot be saved', async () => {
    await db.initDB();
    await db.saveSnapshotWithUsers(snapshot(), [user()]);
    const original = FakeObjectStore.prototype.put;
    const mock = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      if (this.name === 'snapshots') throw new DOMException('Synthetic write error', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    const changedUser = { ...user(), lastSeenAt: LATER };
    await expect(db.saveSnapshotWithUsers(snapshot('new'), [changedUser])).rejects.toThrow('kept unchanged');
    mock.mockRestore();
    expect(await db.readBackup()).toEqual({ snapshots: [snapshot()], users: [user()] });
  });

  it('rejects a snapshot with missing references without adding any users', async () => {
    await db.initDB();
    await expect(db.saveSnapshotWithUsers(snapshot(), [])).rejects.toThrow('kept unchanged');
    expect(await db.readBackup()).toEqual({ snapshots: [], users: [] });
  });

  it('rejects a new save at the full-history limit and keeps the existing history exportable', async () => {
    await db.initDB();
    const history = Array.from({ length: 2_000 }, (_, index) => snapshot(`history-${index}`, []));
    await db.replaceDatabase(history, []);
    await expect(db.saveSnapshotWithUsers(snapshot('one-too-many'), [user()])).rejects.toThrow('at most 2,000 entries');
    const retained = await db.readBackup();
    expect(retained.snapshots).toHaveLength(2_000);
    expect(retained.users).toEqual([]);
    expect(() => createBackup(retained.snapshots, retained.users)).not.toThrow();
    await db.updateSnapshot({ ...history[0], name: 'Still editable at the limit' });
    expect((await db.getAllSnapshots()).find(value => value.id === history[0].id)?.name).toBe('Still editable at the limit');
  });

  it('merges stale multi-tab user histories without losing newer observations', async () => {
    await db.initDB();
    await db.saveSnapshotWithUsers(snapshot(), [user()]);
    const newer: User = { ...user(), currentUsername: 'demo_newer', usernames: ['demo_alpha', 'demo_newer'], fullNames: ['Newer synthetic name'], lastSeenAt: LATER };
    const stale: User = { ...user(), currentUsername: 'demo_middle', usernames: ['demo_alpha', 'demo_middle'], fullNames: ['Another synthetic name'], lastSeenAt: '2026-09-01T18:00:00.000Z' };
    await Promise.all([
      db.saveSnapshotWithUsers(snapshot('newer', [newer]), [newer]),
      db.saveSnapshotWithUsers(snapshot('stale', [stale]), [stale]),
    ]);
    const records = await db.readBackup();
    expect(records.snapshots).toHaveLength(3);
    expect(records.users[0]).toMatchObject({ currentUsername: 'demo_newer', firstSeenAt: DATE, lastSeenAt: LATER });
    expect(records.users[0].usernames).toEqual(['demo_alpha', 'demo_middle', 'demo_newer']);
    expect(records.users[0].fullNames).toEqual(['Newer synthetic name', 'Another synthetic name']);
    expect(records.snapshots.find(value => value.id === 'stale')?.data.followersUsernames).toEqual(['demo_middle']);
  });

  it.each(['.', '.demo', 'demo.', 'demo..alpha'])('rejects invalid account assignment %s without a write', async account => {
    await db.initDB();
    await db.saveSnapshotWithUsers(snapshot(), [user()]);
    expect(() => db.assignAccountToUnassigned(account)).toThrow('valid Instagram');
    expect((await db.getAllSnapshots())[0].accountUsername).toBeUndefined();
  });

  it('renames the current record without overwriting an account assigned by another tab', async () => {
    await db.initDB();
    const staleView = snapshot();
    await db.saveSnapshotWithUsers(staleView, [user()]);
    await db.assignAccountToUnassigned('demo_owner');
    await db.renameSnapshot(staleView.id, 'Reviewed history');
    expect((await db.getAllSnapshots())[0]).toEqual({ ...staleView, accountUsername: 'demo_owner', name: 'Reviewed history' });
  });

  it('does not resurrect a snapshot deleted since the rename form opened', async () => {
    await db.initDB();
    const staleView = snapshot();
    await db.saveSnapshotWithUsers(staleView, [user()]);
    await db.deleteSnapshot(staleView.id);
    await expect(db.renameSnapshot(staleView.id, 'Stale rename')).rejects.toThrow('no longer available');
    expect((await db.readBackup()).snapshots).toEqual([]);
  });

  it('assigns only unassigned history, normalizes the account, and retains completeness metadata', async () => {
    await db.initDB();
    const assigned = { ...snapshot('assigned'), accountUsername: 'another_owner' };
    const unassigned = { ...snapshot('unassigned'), capturedAt: DATE, coverage: { followers: 'complete', following: 'complete' } } as Snapshot;
    await db.replaceDatabase([assigned, unassigned], [user()]);
    expect(await db.assignAccountToUnassigned(' @Demo_Owner ')).toBe(1);
    const records = await db.readBackup();
    expect(records.snapshots.find(s => s.id === 'assigned')).toEqual(assigned);
    expect(records.snapshots.find(s => s.id === 'unassigned')).toEqual({ ...unassigned, accountUsername: 'demo_owner' });
    expect(await db.assignAccountToUnassigned('demo_owner')).toBe(0);
    expect(() => db.assignAccountToUnassigned('not a username')).toThrow();
  });
});
