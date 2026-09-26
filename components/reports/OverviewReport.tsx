
import React from 'react';
import { AnalysisData } from '../../types';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';

interface OverviewReportProps {
  analysis: AnalysisData;
  hasBaseline: boolean;
}

// FIX: Add optional description prop to StatCard and render it.
const StatCard: React.FC<{ title: string; value: number | string; change?: number; delta?: {gained: number, lost: number}; description?: string }> = ({ title, value, change, delta, description }) => {
    const isNumberChange = typeof change === 'number';
    const changeColor = isNumberChange ? (change > 0 ? 'text-green-500' : change < 0 ? 'text-red-500' : 'text-gray-500') : 'text-gray-500';
    const changeSign = isNumberChange && change > 0 ? '+' : '';

    return (
        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</h4>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
            {isNumberChange && (
                 <p className={`text-sm font-semibold ${changeColor}`}>{changeSign}{change}</p>
            )}
             {delta && (
                <div className="text-sm flex gap-2">
                    <span className="text-green-500">+{delta.gained}</span>
                    <span className="text-red-500">-{delta.lost}</span>
                </div>
            )}
            {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
        </div>
    )
}

export const OverviewReport: React.FC<OverviewReportProps> = ({ analysis, hasBaseline }) => {
  // To avoid double-counting, we show pure changes and mutual changes separately.
  const pureUnfollowers = analysis.lostFollowers.length - analysis.unfollowedEachOther.length;
  const pureNoLongerFollowing = analysis.noLongerFollowedByMe.length - analysis.unfollowedEachOther.length;

  return (
    <Card title="Overview" icon={<Icon name="compare" />}>
        {!hasBaseline && <p className="text-gray-500 dark:text-gray-400">Select a baseline snapshot to see a comparison.</p>}
        {hasBaseline && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard 
                    title="Follower Change" 
                    value={analysis.netFollowerChange >= 0 ? `+${analysis.netFollowerChange}` : analysis.netFollowerChange}
                    delta={{gained: analysis.newFollowers.length, lost: analysis.lostFollowers.length}}
                />
                <StatCard 
                    title="Following Change" 
                    value={analysis.netFollowingChange >= 0 ? `+${analysis.netFollowingChange}` : analysis.netFollowingChange}
                    delta={{gained: analysis.newlyFollowedByMe.length, lost: analysis.noLongerFollowedByMe.length}}
                />
                <StatCard title="New Followers" value={analysis.newFollowers.length} />
                <StatCard title="Unfollowers" value={pureUnfollowers} description="Excludes mutual unfollows" />
                <StatCard title="Newly Followed" value={analysis.newlyFollowedByMe.length} />
                <StatCard title="No Longer Following" value={pureNoLongerFollowing} description="Excludes mutual unfollows" />
                <StatCard title="Became Mutual" value={analysis.becameMutual.length} />
                <StatCard title="Unfollowed Each Other" value={analysis.unfollowedEachOther.length} />
            </div>
        )}
    </Card>
  );
};
