import { Snapshot, User } from '../types';

const DB_NAME = 'insta-tracker';
const SNAPSHOT_STORE_NAME = 'snapshots';
const USER_STORE_NAME = 'users';
const DB_VERSION = 4;

let db: IDBDatabase;

const textToHash = async (text: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}


export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve(db);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject('Error opening database');
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = request.result;
      const transaction = (event.target as IDBOpenDBRequest).transaction;
      if (!transaction) return;

      if (!dbInstance.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
        dbInstance.createObjectStore(SNAPSHOT_STORE_NAME, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(USER_STORE_NAME)) {
        dbInstance.createObjectStore(USER_STORE_NAME, { keyPath: 'id' });
      }

      if (event.oldVersion < 2) {
        // Migration from v1 to v2
        const store = transaction.objectStore(SNAPSHOT_STORE_NAME);
        
        store.openCursor().onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const oldSnapshotV1 = cursor.value;

            // Check if this snapshot has already been migrated
            if (oldSnapshotV1.isPartial !== undefined) {
                 cursor.continue();
                 return;
            }

            const files: any[] = [];
            if(oldSnapshotV1.data.followers.length > 0) {
                 files.push({
                    role: 'followers',
                    fileName: oldSnapshotV1.meta.sourceFileName || 'migrated_followers.csv',
                    fileSize: 0,
                    fileHash: '',
                 });
            }
            if(oldSnapshotV1.data.following.length > 0) {
                 files.push({
                    role: 'following',
                    fileName: oldSnapshotV1.meta.sourceFileName || 'migrated_following.csv',
                    fileSize: 0,
                    fileHash: '',
                 });
            }


            const newSnapshotV2: Snapshot = {
              id: oldSnapshotV1.id,
              createdAt: oldSnapshotV1.createdAt,
              updatedAt: oldSnapshotV1.createdAt,
              isPartial: false,
              name: oldSnapshotV1.name,
              data: { // This part is tricky as it's pre-v3 schema
                followersById: [], // Placeholder
                followingById: [], // Placeholder
                followersUsernames: oldSnapshotV1.data.followers,
                followingUsernames: oldSnapshotV1.data.following,
              },
              meta: {
                ...oldSnapshotV1.meta,
                files: files,
                rowCount: {
                  followers: oldSnapshotV1.data.followers.length,
                  following: oldSnapshotV1.data.following.length,
                },
                parseWarnings: oldSnapshotV1.meta.parseWarnings || [],
                hasIds: false,
              },
            };
            cursor.update(newSnapshotV2);
            cursor.continue();
          }
        };
      }
      if (event.oldVersion < 3) {
        // Migration from v2 (username-based) to v3 (ID-based)
        console.log("Migrating database from v2 to v3...");
        const snapshotStore = transaction.objectStore(SNAPSHOT_STORE_NAME);
        const userStore = transaction.objectStore(USER_STORE_NAME);
        
        const userMapByUsername = new Map<string, User>();

        snapshotStore.getAll().onsuccess = async (e) => {
            const oldSnapshots = (e.target as IDBRequest<any[]>).result;
            const newSnapshots: Snapshot[] = [];

            for (const s of oldSnapshots) {
                // Skip if already migrated
                if (s.data.followersById && s.data.followersById.length > 0) continue;
                const oldFollowers = s.data.followers || s.data.followersUsernames || [];
                const oldFollowing = s.data.following || s.data.followingUsernames || [];

                const allUsernames = new Set([...oldFollowers, ...oldFollowing]);
                
                for (const username of allUsernames) {
                    if (!userMapByUsername.has(username)) {
                        const syntheticId = await textToHash(username);
                        const newUser: User = {
                            id: syntheticId,
                            currentUsername: username,
                            usernames: [username],
                            fullNames: [],
                            firstSeenAt: s.createdAt,
                            lastSeenAt: s.createdAt,
                        };
                        userMapByUsername.set(username, newUser);
                    } else {
                        const user = userMapByUsername.get(username)!;
                        user.lastSeenAt = s.createdAt;
                    }
                }

                const followersById = oldFollowers.map((u: string) => userMapByUsername.get(u)!.id);
                const followingById = oldFollowing.map((u: string) => userMapByUsername.get(u)!.id);

                const newSnapshot: Snapshot = {
                    ...s,
                    meta: {
                        ...s.meta,
                        hasIds: false, // Mark as migrated from a username-only source
                    },
                    data: {
                        followersById,
                        followingById,
                        followersUsernames: oldFollowers,
                        followingUsernames: oldFollowing,
                    }
                };
                newSnapshots.push(newSnapshot);
            }

            // Write all users and updated snapshots
            for (const user of userMapByUsername.values()) {
                userStore.put(user);
            }
            for (const snapshot of newSnapshots) {
                snapshotStore.put(snapshot);
            }
            console.log("Database migration to v3 complete.");
        };
      }
      if (event.oldVersion < 4) {
        // V4 migration removed avatar store, but we keep this check for existing users
        // to prevent errors. If an 'avatars' store exists, this version is considered current.
        // New users will not create the store.
      }
    };
  });
};

// --- User Store Functions ---
export const getUsersByIds = (ids: string[]): Promise<Map<string, User>> => {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject("DB not initialized");
        }
        const transaction = db.transaction([USER_STORE_NAME], 'readonly');
        const store = transaction.objectStore(USER_STORE_NAME);
        const userMap = new Map<string, User>();
        if (ids.length === 0) return resolve(userMap);

        const uniqueIds = [...new Set(ids)];
        let count = 0;
        uniqueIds.forEach(id => {
            const request = store.get(id);
            request.onsuccess = () => {
                if(request.result) userMap.set(id, request.result);
                count++;
                if (count === uniqueIds.length) resolve(userMap);
            }
        });
        transaction.onerror = () => reject('Error fetching users by IDs');
    });
}

export const getAllUsers = (): Promise<User[]> => {
     return new Promise((resolve, reject) => {
        const transaction = db.transaction([USER_STORE_NAME], 'readonly');
        const store = transaction.objectStore(USER_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject('Error fetching all users');
    });
}

export const putUsers = (users: User[]): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (users.length === 0) return resolve();
        if (!db) return reject("DB not initialized");

        const transaction = db.transaction([USER_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(USER_STORE_NAME);
        
        users.forEach(user => {
            store.put(user);
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(`Error putting users: ${(event.target as IDBTransaction).error}`);
    });
}


// --- Snapshot Store Functions ---

export const addSnapshot = (snapshot: Snapshot): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("DB not initialized");
    const transaction = db.transaction([SNAPSHOT_STORE_NAME], 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE_NAME).add(snapshot);

    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => reject(`Error adding snapshot: ${(event.target as IDBTransaction).error}`);
  });
};

export const addSnapshots = (snapshots: Snapshot[]): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (snapshots.length === 0) return resolve();
        if (!db) return reject("DB not initialized");

        const transaction = db.transaction([SNAPSHOT_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(SNAPSHOT_STORE_NAME);
        
        snapshots.forEach(snapshot => {
            store.put(snapshot); // Use put to overwrite if importing
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(`Error adding multiple snapshots: ${(event.target as IDBTransaction).error}`);
    });
};

export const updateSnapshot = (snapshot: Snapshot): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("DB not initialized");
    const transaction = db.transaction([SNAPSHOT_STORE_NAME], 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE_NAME).put(snapshot);

    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => reject(`Error updating snapshot: ${(event.target as IDBTransaction).error}`);
  });
};


export const getAllSnapshots = (): Promise<Snapshot[]> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SNAPSHOT_STORE_NAME], 'readonly');
    const store = transaction.objectStore(SNAPSHOT_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
        const sorted = request.result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        resolve(sorted);
    };
    request.onerror = () => reject('Error fetching snapshots');
  });
};

export const deleteSnapshot = (id: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("DB not initialized");
    const transaction = db.transaction([SNAPSHOT_STORE_NAME], 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE_NAME).delete(id);

    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => reject(`Error deleting snapshot: ${(event.target as IDBTransaction).error}`);
  });
};

export const clearDB = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("DB not initialized");
    const transaction = db.transaction([SNAPSHOT_STORE_NAME, USER_STORE_NAME], 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE_NAME).clear();
    transaction.objectStore(USER_STORE_NAME).clear();
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => reject(`Error clearing database: ${(event.target as IDBTransaction).error}`);
  });
};
