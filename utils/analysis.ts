import { AnalysisData, Coverage, RelationshipRole, Snapshot } from '../types';

const ROLES: RelationshipRole[] = ['followers', 'following'];
const normalize = (value: string | undefined) => value?.trim().replace(/^@/, '').toLowerCase() || '';
const stableId = (id: string) => /^\d{1,100}$/.test(id);
const PROBABLE_MATCH_WARNING = 'Username-only matches are probable. Renamed or reassigned handles cannot be verified; differences between exports do not prove a follow or unfollow action.';
const difference = (a: Set<string>, b: Set<string>) => new Set([...a].filter(id => !b.has(id)));
const intersection = (a: Set<string>, b: Set<string>) => new Set([...a].filter(id => b.has(id)));
const union = (a: Set<string>, b: Set<string>) => new Set([...a, ...b]);
type Availability = AnalysisData['availability']['followers'];
const available = (): Availability => ({ available: true });
const unavailable = (reason: string): Availability => ({ available: false, reason });
const both = (a: Availability, b: Availability): Availability => !a.available ? a : b;

export const snapshotTimestamp = (snapshot: Snapshot): number => Date.parse(snapshot.capturedAt ?? snapshot.createdAt);

/** Legacy files are never promoted to complete solely because their arrays contain rows. */
export function snapshotCoverage(snapshot: Snapshot): Coverage {
  if (snapshot.coverage) return snapshot.coverage;
  const roleCoverage = (role: RelationshipRole) => {
    const hasFile = snapshot.meta.files.some(file => file.role === role);
    if (!hasFile) return 'missing';
    return snapshot.isPartial ? 'uncertain' : 'complete';
  };
  return { followers: roleCoverage('followers'), following: roleCoverage('following') };
}

type Entry = { id: string; username: string; role: RelationshipRole; snapshot: Snapshot };
function entries(snapshot: Snapshot): Entry[] {
  return ROLES.flatMap(role => snapshot.data[`${role}ById`].map((id, index) => ({
    id, username: normalize(snapshot.data[`${role}Usernames`][index]), role, snapshot,
  })));
}

/** This index is ephemeral: matching never rewrites IDs or historical names in storage. */
function identityIndex(snapshots: Snapshot[]) {
  const observations = snapshots.flatMap(entries);
  const idsByUsername = new Map<string, Set<string>>();
  for (const entry of observations) {
    if (entry.username && stableId(entry.id)) {
      const ids = idsByUsername.get(entry.username) ?? new Set<string>();
      ids.add(entry.id);
      idsByUsername.set(entry.username, ids);
    }
  }
  const conflictedNames = new Set([...idsByUsername].filter(([, ids]) => ids.size > 1).map(([name]) => name));
  // All observations of an implicated stable ID are excluded, even under a different name.
  const conflictedIds = new Set([...conflictedNames].flatMap(name => [...idsByUsername.get(name)!]));
  const isConflict = (entry: Entry) => conflictedNames.has(entry.username) || conflictedIds.has(entry.id) || (!stableId(entry.id) && !entry.username);
  const key = (entry: Entry) => stableId(entry.id)
    ? `id:${entry.id}`
    : idsByUsername.get(entry.username)?.size === 1
      ? `id:${[...idsByUsername.get(entry.username)!][0]}`
      : `username:${entry.username}`;
  const list = (snapshot: Snapshot, role: RelationshipRole) => {
    const source = observations.filter(entry => entry.snapshot === snapshot && entry.role === role);
    const byKey = new Map(source.filter(entry => !isConflict(entry)).map(entry => [key(entry), entry.id]));
    return { set: new Set(byKey.keys()), byKey, conflict: source.some(isConflict) };
  };
  return {
    list,
    hasConflict: observations.some(isConflict),
    hasUsernameOnly: observations.some(entry => !stableId(entry.id)),
  };
}

function listAvailability(snapshot: Snapshot, role: RelationshipRole, conflict: boolean, label: string): Availability {
  const coverage = snapshotCoverage(snapshot)[role];
  if (coverage !== 'complete') return unavailable(`${label} ${role} list is ${coverage === 'missing' ? 'missing' : 'not confirmed complete'}. Import a complete list to enable this report.`);
  if (conflict) return unavailable(`${label} ${role} list contains conflicting or unverifiable identities. This report is withheld to avoid false changes.`);
  return available();
}

function comparisonAvailability(baseline: Snapshot | null, target: Snapshot): Availability {
  if (!baseline) return unavailable('Select an earlier baseline snapshot to see changes.');
  if (!normalize(baseline.accountUsername) || !normalize(target.accountUsername)) return unavailable('Assign both snapshots to your Instagram account in Settings before comparing them.');
  if (normalize(baseline.accountUsername) !== normalize(target.accountUsername)) return unavailable('The selected snapshots belong to different Instagram accounts.');
  const start = snapshotTimestamp(baseline);
  const end = snapshotTimestamp(target);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || baseline.id === target.id) return unavailable('The baseline export date must be earlier than the target export date.');
  return available();
}

function emptyAnalysis(reason: string): AnalysisData {
  return {
    availability: Object.fromEntries(['followers', 'following', 'relationships', 'followerChanges', 'followingChanges', 'relationshipChanges', 'usernameChanges'].map(key => [key, unavailable(reason)])) as AnalysisData['availability'],
    counts: { followers: null, following: null, mutuals: null }, warnings: [],
    newFollowers: [], lostFollowers: [], newlyFollowedByMe: [], noLongerFollowedByMe: [],
    mutuals: [], notFollowingMeBack: [], iDontFollowBack: [], netFollowerChange: 0,
    netFollowingChange: 0, followBackRatio: 0, reciprocityRate: 0, becameMutual: [],
    lostMutualTheyUnfollowed: [], lostMutualIUnfollowed: [], unfollowedEachOther: [],
    unchangedFollowers: [], unchangedFollowing: [], usernameChanged: [],
  };
}

export function analyzeSnapshots(baseline: Snapshot | null, target: Snapshot | null): AnalysisData {
  const result = emptyAnalysis('Select a target snapshot.');
  if (!target) return result;
  const current = identityIndex([target]);
  const tf = current.list(target, 'followers');
  const tg = current.list(target, 'following');
  result.availability.followers = listAvailability(target, 'followers', tf.conflict, 'Target');
  result.availability.following = listAvailability(target, 'following', tg.conflict, 'Target');
  result.availability.relationships = both(result.availability.followers, result.availability.following);
  result.counts.followers = result.availability.followers.available ? tf.set.size : null;
  result.counts.following = result.availability.following.available ? tg.set.size : null;
  const sourceWarnings = [target, ...(baseline ? [baseline] : [])].flatMap(snapshot =>
    snapshot.meta.parseWarnings.filter(warning => /match|identit|username|stable|uncertain/i.test(warning))
  );
  result.warnings.push(...new Set(sourceWarnings));
  if (current.hasUsernameOnly || (baseline && entries(baseline).some(entry => !stableId(entry.id)))) result.warnings.push(PROBABLE_MATCH_WARNING);
  if (current.hasConflict) result.warnings.push('Conflicting identities were found. Affected reports are unavailable until the source data can be verified.');
  const sourceIds = (keys: Set<string>, ...maps: Map<string, string>[]) => [...keys].map(key => maps.find(map => map.has(key))!.get(key)!);
  if (result.availability.relationships.available) {
    const mutuals = intersection(tf.set, tg.set);
    result.mutuals = sourceIds(mutuals, tf.byKey, tg.byKey);
    result.notFollowingMeBack = sourceIds(difference(tg.set, tf.set), tg.byKey);
    result.iDontFollowBack = sourceIds(difference(tf.set, tg.set), tf.byKey);
    result.counts.mutuals = mutuals.size;
    result.followBackRatio = tf.set.size ? mutuals.size / tf.set.size : 0;
    result.reciprocityRate = tg.set.size ? mutuals.size / tg.set.size : 0;
  }
  const comparison = comparisonAvailability(baseline, target);
  for (const key of ['followerChanges', 'followingChanges', 'relationshipChanges', 'usernameChanges'] as const) result.availability[key] = comparison;
  if (!comparison.available || !baseline) return result;

  const compared = identityIndex([baseline, target]);
  const bFollowers = compared.list(baseline, 'followers');
  const bFollowing = compared.list(baseline, 'following');
  const tFollowers = compared.list(target, 'followers');
  const tFollowing = compared.list(target, 'following');
  const followerAvailability = both(listAvailability(baseline, 'followers', bFollowers.conflict, 'Baseline'), listAvailability(target, 'followers', tFollowers.conflict, 'Target'));
  const followingAvailability = both(listAvailability(baseline, 'following', bFollowing.conflict, 'Baseline'), listAvailability(target, 'following', tFollowing.conflict, 'Target'));
  result.availability.followerChanges = followerAvailability;
  result.availability.followingChanges = followingAvailability;
  result.availability.relationshipChanges = both(followerAvailability, followingAvailability);
  result.availability.usernameChanges = result.availability.relationshipChanges;
  if (compared.hasConflict && !current.hasConflict) result.warnings.push('A username refers to multiple stable IDs across these exports. Affected comparisons are withheld to avoid false changes.');
  if (followerAvailability.available) {
    result.newFollowers = sourceIds(difference(tFollowers.set, bFollowers.set), tFollowers.byKey);
    result.lostFollowers = sourceIds(difference(bFollowers.set, tFollowers.set), bFollowers.byKey);
    result.unchangedFollowers = sourceIds(intersection(tFollowers.set, bFollowers.set), tFollowers.byKey);
    result.netFollowerChange = tFollowers.set.size - bFollowers.set.size;
  }
  if (followingAvailability.available) {
    result.newlyFollowedByMe = sourceIds(difference(tFollowing.set, bFollowing.set), tFollowing.byKey);
    result.noLongerFollowedByMe = sourceIds(difference(bFollowing.set, tFollowing.set), bFollowing.byKey);
    result.unchangedFollowing = sourceIds(intersection(tFollowing.set, bFollowing.set), tFollowing.byKey);
    result.netFollowingChange = tFollowing.set.size - bFollowing.set.size;
  }
  if (result.availability.relationshipChanges.available) {
    const before = intersection(bFollowers.set, bFollowing.set);
    const after = intersection(tFollowers.set, tFollowing.set);
    result.becameMutual = sourceIds(difference(after, before), tFollowers.byKey, tFollowing.byKey);
    result.lostMutualTheyUnfollowed = sourceIds(intersection(before, difference(tFollowing.set, tFollowers.set)), tFollowing.byKey);
    result.lostMutualIUnfollowed = sourceIds(intersection(before, difference(tFollowers.set, tFollowing.set)), tFollowers.byKey);
    result.unfollowedEachOther = sourceIds(difference(before, union(tFollowers.set, tFollowing.set)), bFollowers.byKey, bFollowing.byKey);
    // A rename requires a stable ID in both snapshots. Username-only hashes cannot prove one.
    const beforeNames = new Map(entries(baseline).filter(entry => stableId(entry.id)).map(entry => [entry.id, entry.username]));
    const afterNames = new Map(entries(target).filter(entry => stableId(entry.id)).map(entry => [entry.id, entry.username]));
    for (const [id, from] of beforeNames) {
      const to = afterNames.get(id);
      if (from && to && from !== to) result.usernameChanged.push({ id, from, to });
    }
  }
  return result;
}

export function buildTrendData(snapshots: Snapshot[], accountUsername?: string) {
  const account = normalize(accountUsername);
  const ordered = snapshots.filter(snapshot => account && normalize(snapshot.accountUsername) === account && Number.isFinite(snapshotTimestamp(snapshot))).slice().sort((a, b) => snapshotTimestamp(a) - snapshotTimestamp(b));
  const warnings = new Set<string>();
  const counts = ordered.map(snapshot => {
    const analysis = analyzeSnapshots(null, snapshot);
    analysis.warnings.forEach(warning => warnings.add(warning));
    return { date: snapshot.capturedAt ?? snapshot.createdAt, ...analysis.counts };
  });
  const changes = ordered.slice(1).map((target, index) => {
    const analysis = analyzeSnapshots(ordered[index], target);
    analysis.warnings.forEach(warning => warnings.add(warning));
    return {
      from: ordered[index].capturedAt ?? ordered[index].createdAt,
      to: target.capturedAt ?? target.createdAt,
      newFollowers: analysis.availability.followerChanges.available ? analysis.newFollowers.length : null,
      lostFollowers: analysis.availability.followerChanges.available ? -analysis.lostFollowers.length : null,
      newlyFollowed: analysis.availability.followingChanges.available ? analysis.newlyFollowedByMe.length : null,
      unfollowed: analysis.availability.followingChanges.available ? -analysis.noLongerFollowedByMe.length : null,
    };
  });
  return { counts, changes, warnings: [...warnings] };
}
