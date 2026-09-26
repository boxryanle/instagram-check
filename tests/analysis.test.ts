import { describe, expect, it } from 'vitest';
import { analyzeSnapshots, buildTrendData, snapshotCoverage } from '../utils/analysis';
import { Snapshot } from '../types';

type Person = [string, string];
const alice: Person = ['101', 'alice'];
const bob: Person = ['102', 'bob'];
const cara: Person = ['103', 'cara'];
function snapshot(id: string, date: string, followers: Person[] = [], following: Person[] = [], overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id, accountUsername: 'owner', createdAt: date, isPartial: false,
    coverage: { followers: 'complete', following: 'complete' },
    meta: { files: [
      { role: 'followers', fileName: 'followers.json', fileSize: 1, fileHash: 'f' },
      { role: 'following', fileName: 'following.json', fileSize: 1, fileHash: 'g' },
    ], rowCount: { followers: followers.length, following: following.length }, parseWarnings: [], hasIds: true },
    data: { followersById: followers.map(([id]) => id), followersUsernames: followers.map(([, name]) => name), followingById: following.map(([id]) => id), followingUsernames: following.map(([, name]) => name) },
    ...overrides,
  };
}
const before = (followers: Person[] = [], following: Person[] = [], overrides: Partial<Snapshot> = {}) => snapshot('before', '2026-09-01T12:00:00Z', followers, following, overrides);
const after = (followers: Person[] = [], following: Person[] = [], overrides: Partial<Snapshot> = {}) => snapshot('after', '2026-09-02T12:00:00Z', followers, following, overrides);

describe('snapshot analysis', () => {
  it('reconciles stable CSV IDs with username-only JSON without false churn or altering source data', () => {
    const baseline = before([alice, bob], [alice]);
    const target = after([['hash-alice', '@Alice'], ['hash-bob', 'BOB']], [['hash-alice', 'alice']]);
    const original = JSON.stringify([baseline, target]);
    const result = analyzeSnapshots(baseline, target);
    expect(result.newFollowers).toEqual([]);
    expect(result.lostFollowers).toEqual([]);
    expect(result.netFollowerChange).toBe(0);
    expect(result.unchangedFollowers).toEqual(['hash-alice', 'hash-bob']);
    expect(result.mutuals).toEqual(['hash-alice']);
    expect(result.warnings.join(' ')).toMatch(/probable/);
    expect(JSON.stringify([baseline, target])).toBe(original);
  });

  it('handles the reverse import-format transition and keeps source IDs for tables', () => {
    const result = analyzeSnapshots(before([['hash-alice', 'alice'], ['hash-bob', 'bob']]), after([alice, cara]));
    expect(result.newFollowers).toEqual(['103']);
    expect(result.lostFollowers).toEqual(['hash-bob']);
    expect(result.unchangedFollowers).toEqual(['101']);
  });

  it('verifies a rename only from the same stable numeric ID', () => {
    const result = analyzeSnapshots(before([alice], [alice]), after([['101', 'alicia']], [['101', 'alicia']]));
    expect(result.newFollowers).toEqual([]);
    expect(result.lostFollowers).toEqual([]);
    expect(result.usernameChanged).toEqual([{ id: '101', from: 'alice', to: 'alicia' }]);
    expect(result.warnings).toEqual([]);
  });

  it('keeps parser-supported long numeric IDs stable when the username changes', () => {
    const id = '1234567890123456789012345678901';
    const result = analyzeSnapshots(before([[id, 'alice']]), after([[id, 'alicia']]));
    expect(result.newFollowers).toEqual([]);
    expect(result.lostFollowers).toEqual([]);
    expect(result.usernameChanged).toEqual([{ id, from: 'alice', to: 'alicia' }]);
  });

  it('warns about username-based relationships even without a valid baseline', () => {
    const target = after([['hash-alice', 'alice']], [['hash-alice', 'alice']]);
    expect(analyzeSnapshots(null, target).warnings.join(' ')).toMatch(/probable/);
    expect(analyzeSnapshots(before([], [], { accountUsername: 'different' }), target).warnings.join(' ')).toMatch(/probable/);
  });

  it('preserves import matching uncertainty after IDs were canonicalized to numeric IDs', () => {
    const target = after([alice], [alice]);
    const warning = 'Some records in this import were matched by username across file formats. Usernames can change or be reused.';
    target.meta.parseWarnings = [warning, 'Removed 1 duplicate relationship row(s).'];
    expect(analyzeSnapshots(null, target).warnings).toEqual([warning]);
    const baseline = before([alice], [alice]);
    baseline.meta.parseWarnings = [warning];
    expect(analyzeSnapshots(baseline, target).warnings).toEqual([warning]);
    target.meta.parseWarnings = [];
    expect(analyzeSnapshots(baseline, target).warnings).toEqual([warning]);
  });

  it('does not use synthetic IDs to claim a verified rename', () => {
    const result = analyzeSnapshots(before([['hash-alice', 'alice']]), after([['hash-alicia', 'alicia']]));
    expect(result.usernameChanged).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/Renamed or reassigned handles/);
  });

  it('withholds a role affected by username reassignment to different stable IDs', () => {
    const result = analyzeSnapshots(before([alice], [cara]), after([['999', 'alice']], [cara]));
    expect(result.availability.followerChanges.available).toBe(false);
    expect(result.newFollowers).toEqual([]);
    expect(result.lostFollowers).toEqual([]);
    expect(result.availability.followingChanges.available).toBe(true);
    expect(result.counts.followers).toBe(1); // current export count remains usable
    expect(result.warnings.join(' ')).toMatch(/multiple stable IDs/);
  });

  it('withholds conflicts inside one snapshot, including synthetic aliases', () => {
    const result = analyzeSnapshots(null, after([alice, ['999', 'alice']], [['hash-alice', 'alice']]));
    expect(result.counts.followers).toBeNull();
    expect(result.counts.following).toBeNull();
    expect(result.availability.relationships.available).toBe(false);
  });

  it('reconciles ID and username-only identities between target lists', () => {
    const result = analyzeSnapshots(null, after([alice], [['hash-alice', 'alice']]));
    expect(result.mutuals).toEqual(['101']);
    expect(result.notFollowingMeBack).toEqual([]);
    expect(result.iDontFollowBack).toEqual([]);
  });

  it('treats explicitly complete empty lists as zero and compares them', () => {
    const result = analyzeSnapshots(before([alice], [bob]), after());
    expect(result.counts).toEqual({ followers: 0, following: 0, mutuals: 0 });
    expect(result.availability.followerChanges.available).toBe(true);
    expect(result.lostFollowers).toEqual(['101']);
    expect(result.noLongerFollowedByMe).toEqual(['102']);
  });

  it('does not confuse a missing empty list with zero followers or mass unfollows', () => {
    const result = analyzeSnapshots(before([alice], [bob]), after([], [bob], { coverage: { followers: 'missing', following: 'complete' }, isPartial: true }));
    expect(result.counts.followers).toBeNull();
    expect(result.counts.following).toBe(1);
    expect(result.lostFollowers).toEqual([]);
    expect(result.mutuals).toEqual([]);
    expect(result.availability.relationships.available).toBe(false);
    expect(result.availability.followingChanges.available).toBe(true);
  });

  it('withholds uncertain nonempty lists from counts and comparisons', () => {
    const result = analyzeSnapshots(before([alice, bob]), after([alice], [], { coverage: { followers: 'uncertain', following: 'complete' } }));
    expect(result.counts.followers).toBeNull();
    expect(result.availability.followerChanges.reason).toMatch(/not confirmed complete/);
    expect(result.lostFollowers).toEqual([]);
  });

  it('never labels every follower new when there is no baseline', () => {
    const result = analyzeSnapshots(null, after([alice], [alice]));
    expect(result.newFollowers).toEqual([]);
    expect(result.newlyFollowedByMe).toEqual([]);
    expect(result.availability.followerChanges.available).toBe(false);
    expect(result.mutuals).toEqual(['101']);
  });

  it.each([
    { accountUsername: undefined },
    { accountUsername: '' },
    { accountUsername: 'another_owner' },
  ])('rejects unknown or mismatched account comparisons: %j', overrides => {
    const result = analyzeSnapshots(before([alice]), after([bob], [], overrides));
    expect(result.availability.followerChanges.available).toBe(false);
    expect(result.newFollowers).toEqual([]);
    expect(result.lostFollowers).toEqual([]);
    expect(result.counts.followers).toBe(1);
  });

  it('normalizes explicit account handles', () => {
    expect(analyzeSnapshots(before([alice], [], { accountUsername: '@Owner' }), after([alice])).availability.followerChanges.available).toBe(true);
  });

  it.each(['2026-09-01T12:00:00Z', '2026-08-31T12:00:00Z', 'invalid'])('rejects equal, reversed or invalid export dates: %s', capturedAt => {
    expect(analyzeSnapshots(before([alice]), after([bob], [], { capturedAt })).availability.followerChanges.available).toBe(false);
  });

  it('uses export dates ahead of import order and rejects the same snapshot', () => {
    const target = after([bob], [], { createdAt: '2026-08-01T00:00:00Z', capturedAt: '2026-09-05T00:00:00Z' });
    expect(analyzeSnapshots(before([alice]), target).availability.followerChanges.available).toBe(true);
    expect(analyzeSnapshots(target, target).availability.followerChanges.available).toBe(false);
  });

  it('calculates all relationship transitions using the same identities', () => {
    const baseline = before([alice, bob, cara], [alice, bob, cara]);
    const target = after([['hash-bob', 'bob'], ['104', 'dana']], [['hash-alice', 'alice'], ['104', 'dana']]);
    const result = analyzeSnapshots(baseline, target);
    expect(result.becameMutual).toEqual(['104']);
    expect(result.lostMutualTheyUnfollowed).toEqual(['hash-alice']);
    expect(result.lostMutualIUnfollowed).toEqual(['hash-bob']);
    expect(result.unfollowedEachOther).toEqual(['103']);
  });

  it('infers legacy coverage only from file evidence and nonpartial status', () => {
    const legacy = before([], [], { coverage: undefined });
    expect(snapshotCoverage(legacy)).toEqual({ followers: 'complete', following: 'complete' });
    legacy.meta.files = legacy.meta.files.slice(0, 1);
    expect(snapshotCoverage(legacy)).toEqual({ followers: 'complete', following: 'missing' });
    legacy.isPartial = true;
    expect(snapshotCoverage(legacy)).toEqual({ followers: 'uncertain', following: 'missing' });
  });

  it('does not expose a missing-username synthetic identity as a trustworthy count', () => {
    const result = analyzeSnapshots(null, after([['hash-unknown', '']]));
    expect(result.counts.followers).toBeNull();
  });
});

describe('trend data', () => {
  it('sorts by export date, scopes the account, and leaves missing-list gaps', () => {
    const first = before([alice], [alice]);
    const second = after([], [alice], { coverage: { followers: 'missing', following: 'complete' } });
    const third = snapshot('third', '2026-09-03T12:00:00Z', [['hash-alice', 'alice']], [['hash-alice', 'alice']]);
    const other = snapshot('other', '2026-09-04T12:00:00Z', [bob], [], { accountUsername: 'other' });
    const legacy = snapshot('unknown', '2026-09-05T12:00:00Z', [bob], [], { accountUsername: undefined });
    const result = buildTrendData([third, other, first, legacy, second], '@Owner');
    expect(result.counts.map(point => point.followers)).toEqual([1, null, 1]);
    expect(result.counts.map(point => point.mutuals)).toEqual([1, null, 1]);
    expect(result.changes.map(point => point.lostFollowers)).toEqual([null, null]);
    expect(result.changes.map(point => point.newlyFollowed)).toEqual([0, 0]);
  });

  it('uses reconciled IDs for delta charts and requires an explicit selected account', () => {
    const snapshots = [after([['hash-alice', 'alice']]), before([alice])];
    expect(buildTrendData(snapshots, 'owner').changes[0].newFollowers).toBe(0);
    expect(buildTrendData(snapshots, 'owner').changes[0].lostFollowers).toBe(-0);
    expect(buildTrendData(snapshots).counts).toEqual([]);
  });
});
