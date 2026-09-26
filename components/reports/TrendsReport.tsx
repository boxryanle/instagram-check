
import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Snapshot, ChartDataPoint, DeltaChartDataPoint } from '../../types';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { useAnalysis } from '../../hooks/useAnalysis';

interface TrendsReportProps {
  snapshots: Snapshot[];
}

const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const TrendsReport: React.FC<TrendsReportProps> = ({ snapshots }) => {
    if (snapshots.length < 2) {
        return (
            <Card title="Trends" icon={<Icon name="chart" />}>
                <p className="text-gray-500 dark:text-gray-400">Need at least two snapshots to show trends.</p>
            </Card>
        )
    }

    const lineChartData: ChartDataPoint[] = snapshots.map(s => {
        const followers = new Set(s.data.followersById);
        const following = new Set(s.data.followingById);
        const mutuals = new Set([...followers].filter(id => following.has(id)));
        return {
            name: formatDate(s.createdAt),
            followers: followers.size,
            following: following.size,
            mutuals: mutuals.size,
        };
    });
    
    // useAnalysis is a hook, so it needs to be called at the top level.
    // We can't call it inside a map. We need to compute this manually or refactor.
    // For simplicity, let's create a temporary analysis function here.
    const barChartData = useMemo(() => {
        const data: DeltaChartDataPoint[] = [];
        for (let i = 1; i < snapshots.length; i++) {
            const baseline = snapshots[i - 1];
            const target = snapshots[i];
            
            const bFollowers = new Set(baseline.data.followersById);
            const tFollowers = new Set(target.data.followersById);
            const bFollowing = new Set(baseline.data.followingById);
            const tFollowing = new Set(target.data.followingById);

            const newFollowers = [...tFollowers].filter(id => !bFollowers.has(id));
            const lostFollowers = [...bFollowers].filter(id => !tFollowers.has(id));
            const newlyFollowed = [...tFollowing].filter(id => !bFollowing.has(id));
            const unfollowed = [...bFollowing].filter(id => !tFollowing.has(id));

            data.push({
                name: `${formatDate(baseline.createdAt)} -> ${formatDate(target.createdAt)}`,
                newFollowers: newFollowers.length,
                lostFollowers: -lostFollowers.length,
                newlyFollowed: newlyFollowed.length,
                unfollowed: -unfollowed.length,
            });
        }
        return data;
    }, [snapshots]);


    return (
        <Card title="Trends" icon={<Icon name="chart" />}>
            <div className="space-y-8">
                <div>
                    <h4 className="font-semibold mb-4 text-gray-800 dark:text-gray-200">Counts Over Time</h4>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={lineChartData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700"/>
                            <XAxis dataKey="name" className="text-xs" />
                            <YAxis />
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', border: 'none', color: '#fff' }}/>
                            <Legend />
                            <Line type="monotone" dataKey="followers" stroke="#3b82f6" />
                            <Line type="monotone" dataKey="following" stroke="#8b5cf6" />
                            <Line type="monotone" dataKey="mutuals" stroke="#10b981" />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                 <div>
                    <h4 className="font-semibold mb-4 text-gray-800 dark:text-gray-200">Changes Between Snapshots</h4>
                    <ResponsiveContainer width="100%" height={300}>
                         <BarChart data={barChartData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700"/>
                            <XAxis dataKey="name" className="text-xs" />
                            <YAxis />
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', border: 'none', color: '#fff' }}/>
                            <Legend />
                            <Bar dataKey="newFollowers" fill="#22c55e" stackId="followers" name="+ New Followers" />
                            <Bar dataKey="lostFollowers" fill="#ef4444" stackId="followers" name="- Lost Followers" />
                            <Bar dataKey="newlyFollowed" fill="#8b5cf6" stackId="following" name="+ New Following" />
                            <Bar dataKey="unfollowed" fill="#f97316" stackId="following" name="- Unfollowed" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </Card>
    );
};
