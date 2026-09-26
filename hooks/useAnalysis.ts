
import { useMemo } from 'react';
import { Snapshot, AnalysisData, User } from '../types';
import { difference, intersection, union } from '../utils/setUtils';

const EMPTY_ANALYSIS: AnalysisData = {
  newFollowers: [],
  lostFollowers: [],
  newlyFollowedByMe: [],
  noLongerFollowedByMe: [],
  mutuals: [],
  notFollowingMeBack: [],
  iDontFollowBack: [],
  netFollowerChange: 0,
  netFollowingChange: 0,
  followBackRatio: 0,
  reciprocityRate: 0,
  becameMutual: [],
  lostMutualIUnfollowed: [],
  lostMutualTheyUnfollowed: [],
  unfollowedEachOther: [],
  unchangedFollowers: [],
  unchangedFollowing: [],
  usernameChanged: [],
};

export const useAnalysis = (baseline: Snapshot | null, target: Snapshot | null, userMap: Map<string, User>): AnalysisData => {
  return useMemo(() => {
    if (!target) {
      return EMPTY_ANALYSIS;
    }

    const tFollowers = new Set(target.data.followersById);
    const tFollowing = new Set(target.data.followingById);
    
    const tMutuals = intersection(tFollowers, tFollowing);
    const notFollowingMeBackSet = difference(tFollowing, tFollowers);
    const iDontFollowBackSet = difference(tFollowers, tFollowing);
    
    const followBackRatio = tFollowers.size > 0 ? tMutuals.size / tFollowers.size : 0;
    const reciprocityRate = tFollowing.size > 0 ? tMutuals.size / tFollowing.size : 0;

    const targetAnalysis = {
      mutuals: Array.from(tMutuals),
      notFollowingMeBack: Array.from(notFollowingMeBackSet),
      iDontFollowBack: Array.from(iDontFollowBackSet),
      followBackRatio,
      reciprocityRate,
    };
    
    if (!baseline || !userMap) {
      return {
        ...EMPTY_ANALYSIS,
        ...targetAnalysis,
        newFollowers: Array.from(tFollowers),
        newlyFollowedByMe: Array.from(tFollowing),
      };
    }

    const bFollowers = new Set(baseline.data.followersById);
    const bFollowing = new Set(baseline.data.followingById);
    const bMutuals = intersection(bFollowers, bFollowing);

    const newFollowersSet = difference(tFollowers, bFollowers);
    const lostFollowersSet = difference(bFollowers, tFollowers);
    const newlyFollowedByMeSet = difference(tFollowing, bFollowing);
    const noLongerFollowedByMeSet = difference(bFollowing, tFollowing);
    
    const becameMutualSet = difference(tMutuals, bMutuals);
    const lostMutualTheyUnfollowedSet = new Set([...bMutuals].filter(id => tFollowing.has(id) && !tFollowers.has(id)));
    const lostMutualIUnfollowedSet = new Set([...bMutuals].filter(id => tFollowers.has(id) && !tFollowing.has(id)));
    const unfollowedEachOtherSet = difference(bMutuals, union(tFollowers, tFollowing));

    const netFollowerChange = tFollowers.size - bFollowers.size;
    const netFollowingChange = tFollowing.size - bFollowing.size;
    
    const usernameChanged: AnalysisData['usernameChanged'] = [];
    const commonUsers = intersection(
        union(bFollowers, bFollowing), 
        union(tFollowers, tFollowing)
    );

    const baselineUsers = new Map<string, string>();
    baseline.data.followersById.forEach((id, i) => baselineUsers.set(id, baseline.data.followersUsernames[i]));
    baseline.data.followingById.forEach((id, i) => baselineUsers.set(id, baseline.data.followingUsernames[i]));

    const targetUsers = new Map<string, string>();
    target.data.followersById.forEach((id, i) => targetUsers.set(id, target.data.followersUsernames[i]));
    target.data.followingById.forEach((id, i) => targetUsers.set(id, target.data.followingUsernames[i]));

    for(const id of commonUsers) {
        const from = baselineUsers.get(id);
        const to = targetUsers.get(id);
        if (from && to && from !== to) {
            usernameChanged.push({ id, from, to });
        }
    }
    
    return {
      ...targetAnalysis,
      newFollowers: Array.from(newFollowersSet),
      lostFollowers: Array.from(lostFollowersSet),
      newlyFollowedByMe: Array.from(newlyFollowedByMeSet),
      noLongerFollowedByMe: Array.from(noLongerFollowedByMeSet),
      netFollowerChange,
      netFollowingChange,
      becameMutual: Array.from(becameMutualSet),
      lostMutualTheyUnfollowed: Array.from(lostMutualTheyUnfollowedSet),
      lostMutualIUnfollowed: Array.from(lostMutualIUnfollowedSet),
      unfollowedEachOther: Array.from(unfollowedEachOtherSet),
      unchangedFollowers: Array.from(intersection(bFollowers, tFollowers)),
      unchangedFollowing: Array.from(intersection(bFollowing, tFollowing)),
      usernameChanged,
    };
  }, [baseline, target, userMap]);
};
