
import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Snapshot } from '../../types';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { buildTrendData } from '../../utils/analysis';

interface TrendsReportProps {
  snapshots: Snapshot[];
  accountUsername?: string;
}

const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const TrendsReport: React.FC<TrendsReportProps> = ({ snapshots, accountUsername }) => {
    const trendData = useMemo(() => buildTrendData(snapshots, accountUsername), [snapshots, accountUsername]);
    const lineChartData = trendData.counts.map(point => ({ ...point, name: formatDate(point.date) }));
    const barChartData = trendData.changes.map(point => ({ ...point, name: `${formatDate(point.from)} → ${formatDate(point.to)}` }));
    if (!accountUsername || lineChartData.length < 2) {
        return <Card title="Trends" icon={<Icon name="chart" />}>
            <p className="text-gray-500 dark:text-gray-400">{!accountUsername ? 'Assign the selected snapshot to your Instagram account in Settings to show account-specific trends.' : 'Need at least two snapshots for this account to show trends.'}</p>
        </Card>;
    }

    return (
        <Card title="Trends" icon={<Icon name="chart" />}>
            <div className="space-y-8">
                <p className="text-sm text-gray-600 dark:text-gray-400">History for @{accountUsername}. Missing or unverified lists appear as gaps; changes require consecutive complete lists.</p>
                {trendData.warnings.map(warning => <p key={warning} className="text-sm text-yellow-800 dark:text-yellow-300">{warning}</p>)}
                <div>
                    <h4 className="font-semibold mb-4 text-gray-800 dark:text-gray-200">Counts Over Time</h4>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={lineChartData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700"/>
                            <XAxis dataKey="name" className="text-xs" />
                            <YAxis />
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', border: 'none', color: '#fff' }}/>
                            <Legend />
                            <Line connectNulls={false} type="linear" dataKey="followers" stroke="#3b82f6" />
                            <Line connectNulls={false} type="linear" dataKey="following" stroke="#8b5cf6" />
                            <Line connectNulls={false} type="linear" dataKey="mutuals" stroke="#10b981" />
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
                            <Bar dataKey="lostFollowers" fill="#ef4444" stackId="followers" name="- No Longer Listed Followers" />
                            <Bar dataKey="newlyFollowed" fill="#8b5cf6" stackId="following" name="+ New Following" />
                            <Bar dataKey="unfollowed" fill="#f97316" stackId="following" name="- No Longer Following" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </Card>
    );
};
