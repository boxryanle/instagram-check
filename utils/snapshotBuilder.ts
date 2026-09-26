import type { Coverage, ImportContext, ProcessedFileData, RelationshipRole, Snapshot, SnapshotFileData, User } from '../types';

const roles: RelationshipRole[] = ['followers', 'following'];
const stableId = (id: string) => /^\d{1,100}$/.test(id);

export function buildSnapshot(files: ProcessedFileData[], context: ImportContext, existingUsers: User[], now: string = new Date().toISOString(), id: string = crypto.randomUUID()): { snapshot: Snapshot; users: User[] } {
  if (!files.length) throw new Error('Choose at least one relationship file.');
  const accountUsername = context.accountUsername.trim().replace(/^@/, '').toLowerCase();
  if (!/^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/.test(accountUsername)) throw new Error('Enter a valid account username.');
  if (context.capturedAt && (!Number.isFinite(Date.parse(context.capturedAt)) || Date.parse(context.capturedAt) > Date.parse(now))) throw new Error('The export date must be valid and cannot be in the future.');
  const rawUsers = new Map<string, { username: string; fullName: string | null }>();
  const byUsername = new Map<string, Set<string>>();
  const warnings = new Set<string>();
  for (const file of files) {
    if (file.role === 'unknown') throw new Error('A file has an unknown relationship type.');
    file.warnings.forEach(w => warnings.add(w));
    for (const [sourceId, user] of file.users) {
      if (rawUsers.has(sourceId) && rawUsers.get(sourceId)!.username !== user.username) throw new Error('These files assign conflicting usernames to the same identity. Import files from a single export.');
      rawUsers.set(sourceId, user);
      const group = byUsername.get(user.username) ?? new Set<string>();
      group.add(sourceId);
      byUsername.set(user.username, group);
    }
  }
  const canonical = new Map<string, string>();
  for (const group of byUsername.values()) {
    const stable = [...group].filter(stableId);
    if (stable.length > 1) throw new Error('These files contain conflicting account identities. Keep this export separate and check the source files.');
    const chosen = stable[0] ?? [...group][0];
    group.forEach(sourceId => canonical.set(sourceId, chosen));
    if (group.size > 1) warnings.add('Some records in this import were matched by username across file formats. Usernames can change or be reused.');
  }
  const combined: Record<RelationshipRole, Set<string>> = { followers: new Set(), following: new Set() };
  const coverage: Coverage = { followers: 'missing', following: 'missing' };
  const metadata: SnapshotFileData[] = [];
  const uncertain = new Set<RelationshipRole>();
  for (const file of files) {
    for (const role of roles) {
      const present = file.role === role || file.role === 'combined';
      if (!present || file.coverage?.[role] === 'missing') continue;
      coverage[role] = 'complete';
      if (file.coverage?.[role] === 'uncertain') uncertain.add(role);
      metadata.push({ role, fileName: file.fileInfo.name, fileSize: file.fileInfo.size, fileHash: file.fileInfo.hash });
      file[role].forEach(sourceId => {
        const canonicalId = canonical.get(sourceId);
        if (!canonicalId) throw new Error('A relationship record has no matching identity.');
        combined[role].add(canonicalId);
      });
    }
  }
  for (const role of roles) if (coverage[role] !== 'missing' && (!context.confirmedComplete || uncertain.has(role))) coverage[role] = 'uncertain';
  const usedIds = new Set([...combined.followers, ...combined.following]);
  const existing = new Map(existingUsers.map(user => [user.id, user]));
  const users = [...usedIds].map(userId => {
    const record = rawUsers.get(userId)!;
    const old = existing.get(userId);
    return {
      id: userId,
      currentUsername: record.username,
      usernames: [...new Set([...(old?.usernames ?? []), record.username])],
      fullNames: [...new Set([...(old?.fullNames ?? []), ...(record.fullName ? [record.fullName] : [])])],
      firstSeenAt: old?.firstSeenAt ?? now,
      lastSeenAt: now,
    };
  });
  const followersById = [...combined.followers];
  const followingById = [...combined.following];
  const hasIds = usedIds.size > 0 && [...usedIds].every(stableId);
  if (!hasIds && usedIds.size) warnings.add('This export uses usernames for some identities. A changed or reused username cannot always be resolved.');
  return {
    users,
    snapshot: {
      id, createdAt: now, ...(context.capturedAt ? { capturedAt: context.capturedAt } : {}), accountUsername, coverage,
      isPartial: coverage.followers !== 'complete' || coverage.following !== 'complete',
      meta: { files: metadata, rowCount: { followers: followersById.length, following: followingById.length }, parseWarnings: [...warnings], hasIds },
      data: { followersById, followingById, followersUsernames: followersById.map(userId => rawUsers.get(userId)!.username), followingUsernames: followingById.map(userId => rawUsers.get(userId)!.username) },
    },
  };
}
