import React from 'react';
import { AnalysisData } from '../../types';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';

interface OverviewReportProps { analysis: AnalysisData; hasBaseline: boolean; }
const StatCard: React.FC<{ title: string; value: number | string; description?: string }> = ({ title, value, description }) => (
  <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</h4>
    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
  </div>
);

export const OverviewReport: React.FC<OverviewReportProps> = ({ analysis }) => {
  const { availability, counts } = analysis;
  const signed = (value: number) => value >= 0 ? `+${value}` : String(value);
  const reasons = [...new Set([availability.followerChanges, availability.followingChanges, availability.relationshipChanges].filter(value => !value.available).map(value => value.reason))];
  return (
    <Card title="Overview" icon={<Icon name="compare" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Followers" value={counts.followers ?? 'Unavailable'} description={!availability.followers.available ? availability.followers.reason : undefined} />
        <StatCard title="Following" value={counts.following ?? 'Unavailable'} description={!availability.following.available ? availability.following.reason : undefined} />
        <StatCard title="Follower Change" value={availability.followerChanges.available ? signed(analysis.netFollowerChange) : 'Unavailable'} />
        <StatCard title="Following Change" value={availability.followingChanges.available ? signed(analysis.netFollowingChange) : 'Unavailable'} />
        <StatCard title="Newly Listed Followers" value={availability.followerChanges.available ? analysis.newFollowers.length : 'Unavailable'} />
        <StatCard title="No Longer Listed Followers" value={availability.followerChanges.available ? analysis.lostFollowers.length : 'Unavailable'} />
        <StatCard title="Became Mutual" value={availability.relationshipChanges.available ? analysis.becameMutual.length : 'Unavailable'} />
        <StatCard title="Both Relationships Removed" value={availability.relationshipChanges.available ? analysis.unfollowedEachOther.length : 'Unavailable'} />
      </div>
      {reasons.map(reason => <p key={reason} className="mt-3 text-sm text-gray-600 dark:text-gray-400">{reason}</p>)}
    </Card>
  );
};
