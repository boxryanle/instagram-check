import React, { useState, useEffect, useMemo } from 'react';
import { Snapshot, User, AnalysisData } from '../types';
import { useAnalysis } from '../hooks/useAnalysis';
import { OverviewReport } from './reports/OverviewReport';
import { ReciprocationReport } from './reports/ReciprocationReport';
import { TrendsReport } from './reports/TrendsReport';
import { Card } from './ui/Card';
import { UserTable } from './ui/UserTable';
import { Icon } from './ui/Icon';
import * as db from '../services/db';
import { Spinner } from './ui/Spinner';

interface AnalysisDashboardProps {
  snapshots: Snapshot[];
  baselineId: string | null;
  targetId: string | null;
  onShowToast: (message: string, type: 'success' | 'error') => void;
}
const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'relationships', label: 'Relationships' },
  { id: 'changes', label: 'Change Details' }, { id: 'trends', label: 'Trends' },
];
const Unavailable: React.FC<{ reason?: string }> = ({ reason }) => <p className="text-sm text-gray-600 dark:text-gray-400">{reason || 'This report is unavailable.'}</p>;

export const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({ snapshots, baselineId, targetId, onShowToast }) => {
  const [storedUsers, setStoredUsers] = useState<Map<string, User>>(new Map());
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [relationshipFilter, setRelationshipFilter] = useState<string | null>(null);
  const baseline = snapshots.find(snapshot => snapshot.id === baselineId) || null;
  const target = snapshots.find(snapshot => snapshot.id === targetId) || null;

  useEffect(() => {
    let cancelled = false;
    const fetchUsers = async () => {
      if (!target) { setStoredUsers(new Map()); setIsLoadingUsers(false); return; }
      setIsLoadingUsers(true);
      const ids = new Set<string>();
      [baseline, target].filter(Boolean).forEach(snapshot => {
        snapshot!.data.followersById.forEach(id => ids.add(id));
        snapshot!.data.followingById.forEach(id => ids.add(id));
      });
      try {
        const users = await db.getUsersByIds([...ids]);
        if (!cancelled) setStoredUsers(users);
      } catch {
        if (!cancelled) { setStoredUsers(new Map()); onShowToast('Some saved profile details could not be loaded. Snapshot usernames are still available.', 'error'); }
      } finally { if (!cancelled) setIsLoadingUsers(false); }
    };
    void fetchUsers();
    return () => { cancelled = true; };
  }, [baseline, target, onShowToast]);

  // Prefer the names recorded in the selected exports over a later global profile name.
  const userMap = useMemo(() => {
    const users = new Map(storedUsers);
    [baseline, target].filter(Boolean).forEach(snapshot => {
      (['followers', 'following'] as const).forEach(role => snapshot!.data[`${role}ById`].forEach((id, index) => {
        const username = snapshot!.data[`${role}Usernames`][index];
        if (!username) return;
        const stored = users.get(id);
        users.set(id, { id, usernames: stored?.usernames ?? [username], currentUsername: username, fullNames: stored?.fullNames ?? [], firstSeenAt: stored?.firstSeenAt ?? snapshot!.createdAt, lastSeenAt: stored?.lastSeenAt ?? snapshot!.createdAt });
      }));
    });
    return users;
  }, [storedUsers, baseline, target]);
  const baselineUserMap = useMemo(() => {
    const users = new Map(userMap);
    if (baseline) (['followers', 'following'] as const).forEach(role => baseline.data[`${role}ById`].forEach((id, index) => {
      const user = users.get(id);
      const username = baseline.data[`${role}Usernames`][index];
      if (user && username) users.set(id, { ...user, currentUsername: username });
    }));
    return users;
  }, [userMap, baseline]);
  const analysis = useAnalysis(baseline, target, userMap);
  const handleCopy = (text: string) => { void navigator.clipboard.writeText(text).then(() => onShowToast('Copied to clipboard!', 'success')).catch(() => onShowToast('Failed to copy.', 'error')); };
  const handleQuickViewList = (listType: string) => { setRelationshipFilter(listType); setActiveTab('relationships'); };
  if (!target) return <div className="text-center py-10"><h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">No snapshot selected.</h2><p className="text-gray-500 dark:text-gray-400">Import your Instagram export or select a target snapshot to begin.</p></div>;
  if (isLoadingUsers) return <div className="flex justify-center items-center h-64"><Spinner /></div>;

  const userTableProps = { userMap, onCopy: handleCopy, usernameChanges: analysis.usernameChanged };
  const relationships = [
    { id: 'not-following-back', title: 'Not Following Me Back', users: analysis.notFollowingMeBack },
    { id: 'i-dont-follow-back', title: "I Don't Follow Back", users: analysis.iDontFollowBack },
    { id: 'mutuals', title: 'Mutual Connections', users: analysis.mutuals },
  ];
  const changes: { title: string; users: string[]; availability: keyof AnalysisData['availability']; historical?: boolean }[] = [
    { title: 'Newly Listed Followers', users: analysis.newFollowers, availability: 'followerChanges' },
    { title: 'No Longer Listed Followers', users: analysis.lostFollowers, availability: 'followerChanges', historical: true },
    { title: 'Newly Following', users: analysis.newlyFollowedByMe, availability: 'followingChanges' },
    { title: 'No Longer Following', users: analysis.noLongerFollowedByMe, availability: 'followingChanges', historical: true },
  ];
  const transitions = [
    { title: 'Became Mutual', users: analysis.becameMutual },
    { title: 'Lost Mutual: No Longer Follows Me', users: analysis.lostMutualTheyUnfollowed },
    { title: 'Lost Mutual: I No Longer Follow', users: analysis.lostMutualIUnfollowed },
    { title: 'Both Relationships Removed', users: analysis.unfollowedEachOther, historical: true },
  ];
  return <div className="space-y-6">
    <div>
      <h2 className="text-xl font-semibold">{target.accountUsername ? `@${target.accountUsername}` : 'Unassigned account'} · Analysis</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Target: {target.name || new Date(target.capturedAt ?? target.createdAt).toLocaleString()} ({target.capturedAt ? 'export time' : 'import time'}).</p>
      <p className="text-sm text-gray-600 dark:text-gray-300">{baseline ? `Baseline: ${baseline.name || new Date(baseline.capturedAt ?? baseline.createdAt).toLocaleString()} (${baseline.capturedAt ? 'export time' : 'import time'}).` : 'No baseline selected. Showing this snapshot only.'} Choose snapshots in the Snapshots tab.</p>
    </div>
    {analysis.warnings.map(warning => <div key={warning} className="p-4 text-sm text-yellow-800 rounded-lg bg-yellow-50 dark:bg-gray-800 dark:text-yellow-300 flex items-start gap-2" role="status"><Icon name="warning" className="w-5 h-5 flex-shrink-0" /><p>{warning}</p></div>)}
    <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto overflow-y-hidden">
      <nav className="-mb-px flex space-x-4 sm:space-x-8 min-w-max" aria-label="Analysis reports">
        {TABS.map(tab => <button key={tab.id} onClick={() => { setActiveTab(tab.id); if (tab.id !== 'relationships') setRelationshipFilter(null); }} className={`whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === tab.id ? 'border-primary-500 text-primary-600 dark:text-primary-400' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'}`} aria-current={activeTab === tab.id ? 'page' : undefined}>{tab.label}</button>)}
      </nav>
    </div>
    {activeTab === 'overview' && <div className="space-y-6"><OverviewReport analysis={analysis} hasBaseline={!!baseline} /><ReciprocationReport analysis={analysis} onViewList={handleQuickViewList} /></div>}
    {activeTab === 'relationships' && <Card title="Account Relationships" icon={<Icon name="users" />}>
      {!analysis.availability.relationships.available ? <Unavailable reason={analysis.availability.relationships.reason} /> : <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 border-b dark:border-gray-700 pb-6">
          {relationships.map(item => <button key={item.id} onClick={() => setRelationshipFilter(item.id)} className={`p-4 rounded-lg border text-left transition-colors ${relationshipFilter === item.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}><p className="text-sm font-medium text-gray-500 dark:text-gray-400">{item.title}</p><p className="text-2xl font-bold">{item.users.length}</p></button>)}
        </div>
        {relationships.filter(item => item.id === relationshipFilter).map(item => <div key={`${target.id}-${item.id}`}><h4 className="font-semibold mb-4">{item.title} ({item.users.length})</h4><UserTable title={item.title} userIds={item.users} {...userTableProps} /></div>)}
        {!relationshipFilter && <p className="text-center py-8 text-gray-500">Select a relationship type above to view the list.</p>}
      </>}
    </Card>}
    {activeTab === 'trends' && <TrendsReport snapshots={snapshots} accountUsername={target.accountUsername} />}
    {activeTab === 'changes' && <Card title="Changes Between Exports" icon={<Icon name="users" />}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-8">
        {changes.map(group => <div key={`${baseline?.id}-${target.id}-${group.title}`}><h4 className="font-semibold mb-2">{group.title}{analysis.availability[group.availability].available ? ` (${group.users.length})` : ''}</h4>{analysis.availability[group.availability].available ? <UserTable title={group.title} userIds={group.users} {...userTableProps} userMap={group.historical ? baselineUserMap : userMap} /> : <Unavailable reason={analysis.availability[group.availability].reason} />}</div>)}
        <div className="lg:col-span-2"><h4 className="font-semibold mb-4 pt-4 border-t dark:border-gray-700">Relationship Transitions</h4>
          {!analysis.availability.relationshipChanges.available ? <Unavailable reason={analysis.availability.relationshipChanges.reason} /> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {transitions.map(group => <details key={`${baseline?.id}-${target.id}-${group.title}`} className="p-3 border dark:border-gray-700 rounded-lg"><summary className="cursor-pointer font-semibold text-sm">{group.title} ({group.users.length})</summary><div className="mt-4"><UserTable title={group.title} userIds={group.users} {...userTableProps} userMap={group.historical ? baselineUserMap : userMap} /></div></details>)}
            <details className="p-3 border dark:border-gray-700 rounded-lg"><summary className="cursor-pointer font-semibold text-sm">Verified Username Changes ({analysis.usernameChanged.length})</summary><div className="mt-4"><UserTable key={`${baseline?.id}-${target.id}-renames`} title="Username Changes" userIds={analysis.usernameChanged.map(change => change.id)} {...userTableProps} /></div></details>
          </div>}
        </div>
      </div>
    </Card>}
  </div>;
};
