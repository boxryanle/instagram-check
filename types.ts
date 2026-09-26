
export interface User {
  id: string; // canonical user id (or synthetic if CSV lacks id)
  usernames: string[]; // history, newest last
  currentUsername: string; // last seen normalized username
  fullNames: string[]; // optional history, newest last
  firstSeenAt: string; // ISOString
  lastSeenAt: string; // ISOString
}

export interface SnapshotData {
  followersById: string[];
  followingById: string[];
  // Keep usernames for display purposes and simpler exports
  followersUsernames: string[];
  followingUsernames: string[];
}

export interface SnapshotFileData {
  role: 'followers' | 'following';
  fileName: string;
  fileSize: number;
  fileHash: string;
}

export interface SnapshotMeta {
  files: SnapshotFileData[];
  label?: string; // Optional user-provided note
  rowCount: {
    followers: number;
    following: number;
  };
  parseWarnings: string[];
  hasIds: boolean; // Did the source files for this snapshot contain user IDs?
}

export interface Snapshot {
  id: string;
  createdAt: string;
  updatedAt?: string; // For tracking merges into partial snapshots
  isPartial: boolean;
  name?: string; // Keeping for rename functionality
  meta: SnapshotMeta;
  data: SnapshotData;
}

export interface ParsedCSVData {
  followers: Set<string>;
  following: Set<string>;
  warnings: string[];
  rowCount: number;
}

export interface ProcessedFileData {
    followers: Set<string>; // Set of user IDs
    following: Set<string>; // Set of user IDs
    users: Map<string, { username: string; fullName: string | null; }>; // Map of id -> user details from this file
    warnings: string[];
    role: 'followers' | 'following' | 'combined' | 'unknown';
    fileInfo: {
        name: string;
        size: number;
        hash: string;
    };
    rowCount: number;
    hasIds: boolean; // Flag to know if the source CSV had IDs
}


export interface AnalysisData {
  newFollowers: string[];
  lostFollowers: string[];
  newlyFollowedByMe: string[];
  noLongerFollowedByMe: string[];
  mutuals: string[];
  notFollowingMeBack: string[];
  iDontFollowBack: string[];
  netFollowerChange: number;
  netFollowingChange: number;
  followBackRatio: number;
  reciprocityRate: number;
  // New detailed metrics
  becameMutual: string[];
  lostMutualTheyUnfollowed: string[];
  lostMutualIUnfollowed: string[];
  unfollowedEachOther: string[];
  unchangedFollowers: string[];
  unchangedFollowing: string[];
  // New ID-based metrics
  usernameChanged: Array<{ id: string, from: string, to: string }>;
}

export type ChartDataPoint = {
    name: string;
    followers: number;
    following: number;
    mutuals: number;
};

export type DeltaChartDataPoint = {
    name: string;
    newFollowers: number;
    lostFollowers: number;
    newlyFollowed: number;
    unfollowed: number;
};