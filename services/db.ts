import type { Snapshot, User } from '../types';
import { createBackup, normalizeAccountUsername } from './backup';

const DB_NAME = 'insta-tracker';
const SNAPSHOT_STORE_NAME = 'snapshots';
const USER_STORE_NAME = 'users';
const DB_VERSION = 5;
const STORES = [SNAPSHOT_STORE_NAME, USER_STORE_NAME];
let db: IDBDatabase | undefined;
let opening: Promise<IDBDatabase> | undefined;

// Legacy username IDs were SHA-256. A synchronous implementation keeps the
// version-change transaction active; awaiting Web Crypto here can commit it early.
const legacyUsernameId = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(size);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(size - 4, bytes.length * 8);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits));
  const words = new Uint32Array(64);
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotate(words[i - 15], 7) ^ rotate(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotate(words[i - 2], 17) ^ rotate(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = words[i - 16] + s0 + words[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const t1 = (h + s1 + ((e & f) ^ (~e & g)) + constants[i] + words[i]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => { state[i] += value; });
  }
  return Array.from(state, value => value.toString(16).padStart(8, '0')).join('');
};

type LegacySnapshot = Record<string, any>;
const migrateRecords = (snapshots: LegacySnapshot[], users: User[]): { snapshots: Snapshot[]; users: User[] } => {
  const userMap = new Map(users.map(user => [user.id, user]));
  if (userMap.size !== users.length) throw new Error('Duplicate stored user IDs.');
  const migrated = [...snapshots].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map(snapshot => {
    if (!snapshot || !snapshot.data || !snapshot.meta) throw new Error('Unsupported stored snapshot.');
    const data = snapshot.data;
    const roles = ['followers', 'following'] as const;
    const requiresMigration = roles.some(role =>
      data[role] !== undefined || data[`${role}ById`] === undefined ||
      (Array.isArray(data[`${role}ById`]) && data[`${role}ById`].length === 0 && data[`${role}Usernames`]?.length > 0));
    if (!requiresMigration) return snapshot as Snapshot;
    const nextData: Snapshot['data'] = { followersById: [], followingById: [], followersUsernames: [], followingUsernames: [] };
    for (const role of roles) {
      const names = data[role] ?? data[`${role}Usernames`];
      if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !name.trim() || name.length > 256)) throw new Error('Unsupported stored usernames.');
      const oldIds = data[`${role}ById`];
      const hasExistingIds = Array.isArray(oldIds) && oldIds.length === names.length;
      if (oldIds !== undefined && (!Array.isArray(oldIds) || (oldIds.length !== 0 && !hasExistingIds))) throw new Error('Stored IDs and usernames do not align.');
      const ids = hasExistingIds ? oldIds : names.map(name => legacyUsernameId(name));
      nextData[`${role}ById`] = ids;
      nextData[`${role}Usernames`] = names;
      if (!hasExistingIds) names.forEach((name, index) => {
        const id = ids[index];
        const existing = userMap.get(id);
        if (!existing) {
          userMap.set(id, { id, currentUsername: name, usernames: [name], fullNames: [], firstSeenAt: snapshot.createdAt, lastSeenAt: snapshot.createdAt });
        } else {
          if (!existing.usernames.includes(name)) throw new Error('Stored username identity is inconsistent.');
          userMap.set(id, {
            ...existing,
            firstSeenAt: Date.parse(snapshot.createdAt) < Date.parse(existing.firstSeenAt) ? snapshot.createdAt : existing.firstSeenAt,
            lastSeenAt: Date.parse(snapshot.createdAt) > Date.parse(existing.lastSeenAt) ? snapshot.createdAt : existing.lastSeenAt,
          });
        }
      });
    }
    return {
      ...snapshot,
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      isPartial: snapshot.isPartial ?? false,
      data: nextData,
      meta: {
        ...snapshot.meta,
        files: snapshot.meta.files ?? roles.filter(role => nextData[`${role}ById`].length > 0).map(role => ({ role, fileName: snapshot.meta.sourceFileName || `migrated_${role}.csv`, fileSize: 0, fileHash: '' })),
        rowCount: snapshot.meta.rowCount ?? { followers: nextData.followersById.length, following: nextData.followingById.length },
        parseWarnings: snapshot.meta.parseWarnings ?? [],
        hasIds: snapshot.meta.hasIds ?? false,
      },
    } as Snapshot;
  });
  // Validation happens before any migration writes; an error aborts the complete
  // version upgrade, preserving both old records and the previous DB version.
  createBackup(migrated, Array.from(userMap.values()));
  return { snapshots: migrated, users: Array.from(userMap.values()) };
};

export const initDB = (): Promise<IDBDatabase> => {
  if (db) return Promise.resolve(db);
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    let failed = false;
    let migrationFailed = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onblocked = () => {
      failed = true;
      reject(new Error('Close other Insta Tracker tabs, then reload to update local storage.'));
    };
    request.onerror = () => reject(new Error(migrationFailed
      ? 'Local history could not be safely upgraded. Existing data was kept unchanged. Restore a valid backup or contact support.'
      : 'Could not open local storage.'));
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      const connection = request.result;
      db = connection;
      connection.onversionchange = () => { connection.close(); if (db === connection) db = undefined; };
      connection.onclose = () => { if (db === connection) db = undefined; };
      resolve(connection);
    };
    request.onupgradeneeded = () => {
      const connection = request.result;
      const transaction = request.transaction!;
      for (const name of STORES) if (!connection.objectStoreNames.contains(name)) connection.createObjectStore(name, { keyPath: 'id' });
      const snapshotStore = transaction.objectStore(SNAPSHOT_STORE_NAME);
      const userStore = transaction.objectStore(USER_STORE_NAME);
      const snapshotRequest = snapshotStore.getAll();
      const userRequest = userStore.getAll();
      let finished = 0;
      const migrate = () => {
        if (++finished !== 2) return;
        try {
          const records = migrateRecords(snapshotRequest.result, userRequest.result);
          records.users.forEach(user => userStore.put(user));
          records.snapshots.forEach(snapshot => snapshotStore.put(snapshot));
        } catch {
          migrationFailed = true;
          transaction.abort();
        }
      };
      snapshotRequest.onsuccess = migrate;
      userRequest.onsuccess = migrate;
    };
  }).finally(() => { opening = undefined; });
  return opening;
};

/** Close this app's connection only; primarily useful before a controlled reload. */
export const closeDB = (): void => { db?.close(); db = undefined; };

const connection = (): IDBDatabase => {
  if (!db) throw new Error('Local storage is not initialized.');
  return db;
};

const write = (stores: string[], enqueue: (transaction: IDBTransaction, abort: (reason?: string) => void) => void): Promise<void> => new Promise((resolve, reject) => {
  const transaction = connection().transaction(stores, 'readwrite');
  let failure = 'Local storage could not be updated. Existing data was kept unchanged.';
  const abort = (reason?: string) => {
    if (reason) failure = `${reason} Existing data was kept unchanged.`;
    transaction.abort();
  };
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(new Error(failure));
  try { enqueue(transaction, abort); } catch { abort(); }
});

// Validator messages contain field labels and limits, never values from an import.
const validationFailure = (error: unknown): string | undefined => error instanceof Error && error.message.startsWith('Invalid backup:')
  ? error.message.replace('Invalid backup:', 'Local history cannot be updated:')
  : undefined;

export const readBackup = (): Promise<{ snapshots: Snapshot[]; users: User[] }> => new Promise((resolve, reject) => {
  const transaction = connection().transaction(STORES, 'readonly');
  const snapshots = transaction.objectStore(SNAPSHOT_STORE_NAME).getAll();
  const users = transaction.objectStore(USER_STORE_NAME).getAll();
  transaction.oncomplete = () => resolve({ snapshots: snapshots.result.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), users: users.result });
  transaction.onabort = () => reject(new Error('Could not read local history.'));
});

export const replaceDatabase = (snapshots: Snapshot[], users: User[]): Promise<void> => {
  const backup = createBackup(snapshots, users);
  return write(STORES, transaction => {
    const snapshotStore = transaction.objectStore(SNAPSHOT_STORE_NAME);
    const userStore = transaction.objectStore(USER_STORE_NAME);
    snapshotStore.clear();
    userStore.clear();
    backup.users.forEach(user => userStore.put(user));
    backup.snapshots.forEach(snapshot => snapshotStore.put(snapshot));
  });
};

export const saveSnapshotWithUsers = (snapshot: Snapshot, users: User[]): Promise<void> => write(STORES, (transaction, abort) => {
  const userStore = transaction.objectStore(USER_STORE_NAME);
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE_NAME);
  const readUsers = userStore.getAll();
  const readSnapshots = snapshotStore.getAll();
  let finished = 0;
  const save = () => {
    if (++finished !== 2) return;
    try {
      const allUsers = new Map<string, User>(readUsers.result.map(user => [user.id, user]));
      const incomingUsers = createBackup([], users).users;
      // A second tab may have saved newer observations since the import preview.
      // Merge against records read inside this write transaction, never replace
      // their history with the stale copy passed by the caller.
      incomingUsers.forEach(incoming => {
        const existing = allUsers.get(incoming.id);
        if (!existing) { allUsers.set(incoming.id, incoming); return; }
        const currentUsername = Date.parse(incoming.lastSeenAt) >= Date.parse(existing.lastSeenAt) ? incoming.currentUsername : existing.currentUsername;
        const usernames = [...new Set([...existing.usernames, ...incoming.usernames])].filter(name => name !== currentUsername);
        usernames.push(currentUsername);
        allUsers.set(incoming.id, {
          ...incoming, currentUsername, usernames,
          fullNames: [...new Set([...existing.fullNames, ...incoming.fullNames])],
          firstSeenAt: Date.parse(existing.firstSeenAt) < Date.parse(incoming.firstSeenAt) ? existing.firstSeenAt : incoming.firstSeenAt,
          lastSeenAt: Date.parse(existing.lastSeenAt) > Date.parse(incoming.lastSeenAt) ? existing.lastSeenAt : incoming.lastSeenAt,
        });
      });
      const allSnapshots = new Map<string, Snapshot>(readSnapshots.result.map(value => [value.id, value]));
      allSnapshots.set(snapshot.id, snapshot);
      // Every successful save must leave a complete history that can still be
      // exported and restored within the same supported backup limits.
      const validated = createBackup(Array.from(allSnapshots.values()), Array.from(allUsers.values()));
      const validatedUsers = new Map(validated.users.map(user => [user.id, user]));
      incomingUsers.forEach(user => userStore.put(validatedUsers.get(user.id)!));
      snapshotStore.put(validated.snapshots.find(value => value.id === snapshot.id)!);
    } catch (error) { abort(validationFailure(error)); }
  };
  readUsers.onsuccess = save;
  readSnapshots.onsuccess = save;
});

export const assignAccountToUnassigned = (accountUsername: string): Promise<number> => {
  const normalized = normalizeAccountUsername(accountUsername);
  let count = 0;
  return write(STORES, (transaction, abort) => {
    const store = transaction.objectStore(SNAPSHOT_STORE_NAME);
    const readSnapshots = store.getAll();
    const readUsers = transaction.objectStore(USER_STORE_NAME).getAll();
    let finished = 0;
    const assign = () => {
      if (++finished !== 2) return;
      try {
        const snapshots = readSnapshots.result.map(snapshot => snapshot.accountUsername === undefined ? { ...snapshot, accountUsername: normalized } : snapshot);
        const validated = createBackup(snapshots, readUsers.result);
        const assigned = new Map(validated.snapshots.map(snapshot => [snapshot.id, snapshot]));
        readSnapshots.result.forEach(snapshot => {
          if (snapshot.accountUsername === undefined) { store.put(assigned.get(snapshot.id)!); count++; }
        });
      } catch (error) { abort(validationFailure(error)); }
    };
    readSnapshots.onsuccess = assign;
    readUsers.onsuccess = assign;
  }).then(() => count);
};

/** Update the current stored record, so a stale tab cannot overwrite its account or resurrect a deletion. */
export const renameSnapshot = (id: string, name: string): Promise<void> => write(STORES, (transaction, abort) => {
  const store = transaction.objectStore(SNAPSHOT_STORE_NAME);
  const readSnapshots = store.getAll();
  const readUsers = transaction.objectStore(USER_STORE_NAME).getAll();
  let finished = 0;
  const rename = () => {
    if (++finished !== 2) return;
    const current = readSnapshots.result.find(snapshot => snapshot.id === id);
    if (!current) { abort('This snapshot is no longer available. Refresh your history.'); return; }
    try {
      const snapshots = readSnapshots.result.map(snapshot => snapshot.id === id ? { ...snapshot, name } : snapshot);
      const validated = createBackup(snapshots, readUsers.result);
      store.put(validated.snapshots.find(snapshot => snapshot.id === id)!);
    } catch (error) { abort(validationFailure(error)); }
  };
  readSnapshots.onsuccess = rename;
  readUsers.onsuccess = rename;
});

export const getUsersByIds = (ids: string[]): Promise<Map<string, User>> => new Promise((resolve, reject) => {
  const transaction = connection().transaction([USER_STORE_NAME], 'readonly');
  const result = new Map<string, User>();
  for (const id of new Set(ids)) {
    const request = transaction.objectStore(USER_STORE_NAME).get(id);
    request.onsuccess = () => { if (request.result) result.set(id, request.result); };
  }
  transaction.oncomplete = () => resolve(result);
  transaction.onabort = () => reject(new Error('Could not read user records.'));
});

export const getAllUsers = async (): Promise<User[]> => (await readBackup()).users;
export const getAllSnapshots = async (): Promise<Snapshot[]> => (await readBackup()).snapshots;
export const putUsers = (users: User[]): Promise<void> => write([USER_STORE_NAME], transaction => { users.forEach(user => transaction.objectStore(USER_STORE_NAME).put(user)); });
export const addSnapshot = (snapshot: Snapshot): Promise<void> => write([SNAPSHOT_STORE_NAME], transaction => { transaction.objectStore(SNAPSHOT_STORE_NAME).add(snapshot); });
export const addSnapshots = (snapshots: Snapshot[]): Promise<void> => write([SNAPSHOT_STORE_NAME], transaction => { snapshots.forEach(snapshot => transaction.objectStore(SNAPSHOT_STORE_NAME).put(snapshot)); });
export const updateSnapshot = (snapshot: Snapshot): Promise<void> => saveSnapshotWithUsers(snapshot, []);
export const deleteSnapshot = (id: string): Promise<void> => write([SNAPSHOT_STORE_NAME], transaction => { transaction.objectStore(SNAPSHOT_STORE_NAME).delete(id); });
export const clearDB = (): Promise<void> => write(STORES, transaction => { STORES.forEach(store => transaction.objectStore(store).clear()); });
