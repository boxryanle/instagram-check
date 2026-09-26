
import React, { useState, useEffect } from 'react';
import { Snapshot, User } from '../types';
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

export const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({ snapshots, baselineId, targetId, onShowToast }) => {
  const [userMap, setUserMap] = useState<Map<string, User>>(new Map());
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [relationshipFilter, setRelationshipFilter] = useState<string | null>(null);

  const baseline = snapshots.find(s => s.id === baselineId) || null;
  const target = snapshots.find(s => s.id === targetId) || null;
  
  useEffect(() => {
    const fetchUsers = async () => {
        if (!target) {
            setUserMap(new Map());
            setIsLoadingUsers(false);
            return;
        }
        setIsLoadingUsers(true);
        const userIds = new Set<string>();
        snapshots.forEach(s => {
            s.data.followersById.forEach(id => userIds.add(id));
            s.data.followingById.forEach(id => userIds.add(id));
        });

        try {
            const fetchedUsers = await db.getUsersByIds(Array.from(userIds));
            setUserMap(fetchedUsers);
        } catch (error) {
            console.error("Failed to fetch users", error);
            onShowToast('Failed to load user data.', 'error');
        } finally {
            setIsLoadingUsers(false);
        }
    };
    fetchUsers();
  }, [snapshots, baselineId, targetId, onShowToast]);
  
  const analysis = useAnalysis(baseline, target, userMap);
  
  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => onShowToast('Copied to clipboard!', 'success'))
      .catch(() => onShowToast('Failed to copy.', 'error'));
  };

  const handleQuickViewList = (listType: string) => {
      setRelationshipFilter(listType);
      setActiveTab('relationships');
  };

  if (!target) {
    return (
      <div className="text-center py-10">
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">No snapshots selected for analysis.</h2>
        <p className="text-gray-500 dark:text-gray-400">Upload a CSV or select a target snapshot to begin.</p>
      </div>
    );
  }
  
  if (isLoadingUsers) {
      return <div className="flex justify-center items-center h-64"><Spinner/></div>
  }

  const isAnalysisPartial = (baseline?.isPartial || target.isPartial) && baseline;
  const partialWarning = 
    (baseline?.isPartial ? `Baseline is missing its ${baseline.data.followersById.length === 0 ? 'followers' : 'following'} list. ` : '') +
    (target.isPartial ? `Target is missing its ${target.data.followersById.length === 0 ? 'followers' : 'following'} list.` : '');

  const unfollowedEachOtherBadgeMap = analysis.unfollowedEachOther.reduce((acc, id) => ({...acc, [id]: 'mutual → none'}), {});

  const TABS = [
       { id: 'overview', label: 'Overview', icon: 'compare' },
       { id: 'relationships', label: 'Relationships', icon: 'users' },
       { id: 'changes', label: 'Change Details', icon: 'chart' },
       { id: 'trends', label: 'Trends', icon: 'chart' },
  ];
  
  const userTableProps = {
      userMap,
      onCopy: handleCopyToClipboard,
      usernameChanges: analysis.usernameChanged,
  };

  return (
    <div className="space-y-6">
      {isAnalysisPartial && (
          <div className="p-4 text-sm text-yellow-800 rounded-lg bg-yellow-50 dark:bg-gray-800 dark:text-yellow-300 flex items-start gap-2" role="alert">
            <Icon name="warning" className="w-5 h-5 flex-shrink-0"/>
            <div className="min-w-0">
                <span className="font-medium">Incomplete Analysis:</span> {partialWarning}
            </div>
          </div>
      )}

       <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
           <nav className="-mb-px flex space-x-4 sm:space-x-8 min-w-max" aria-label="Tabs">
               {TABS.map(tab => (
                   <button
                       key={tab.id}
                       onClick={() => {
                           setActiveTab(tab.id);
                           if (tab.id !== 'relationships') setRelationshipFilter(null);
                       }}
                       className={`whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                           activeTab === tab.id
                           ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                           : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600'
                       }`}
                       aria-current={activeTab === tab.id ? 'page' : undefined}
                   >
                       {tab.label}
                   </button>
               ))}
           </nav>
       </div>
       
        {activeTab === 'overview' && (
           <div className="space-y-6">
               <OverviewReport analysis={analysis} hasBaseline={!!baseline} />
               <ReciprocationReport analysis={analysis} onViewList={handleQuickViewList} />
           </div>
       )}

       {activeTab === 'relationships' && (
           <Card title="Account Relationships" icon={<Icon name="users" />}>
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 border-b dark:border-gray-700 pb-6">
                    <button 
                        onClick={() => setRelationshipFilter('not-following-back')}
                        className={`p-4 rounded-lg border-2 text-left transition-all ${relationshipFilter === 'not-following-back' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-100 dark:border-gray-700 hover:border-gray-300'}`}
                    >
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Not Following Back</p>
                        <p className="text-2xl font-bold">{analysis.notFollowingMeBack.length}</p>
                    </button>
                    <button 
                        onClick={() => setRelationshipFilter('i-dont-follow-back')}
                        className={`p-4 rounded-lg border-2 text-left transition-all ${relationshipFilter === 'i-dont-follow-back' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-100 dark:border-gray-700 hover:border-gray-300'}`}
                    >
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">I Don't Follow Back</p>
                        <p className="text-2xl font-bold">{analysis.iDontFollowBack.length}</p>
                    </button>
                    <button 
                        onClick={() => setRelationshipFilter('mutuals')}
                        className={`p-4 rounded-lg border-2 text-left transition-all ${relationshipFilter === 'mutuals' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-100 dark:border-gray-700 hover:border-gray-300'}`}
                    >
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Mutual Connections</p>
                        <p className="text-2xl font-bold">{analysis.mutuals.length}</p>
                    </button>
               </div>

               {relationshipFilter === 'not-following-back' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500"></span>
                            Not Following Me Back ({analysis.notFollowingMeBack.length})
                        </h4>
                        <UserTable title="Not Following Me Back" userIds={analysis.notFollowingMeBack} {...userTableProps} />
                    </div>
               )}

               {relationshipFilter === 'i-dont-follow-back' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
                             <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                            I Don't Follow Back ({analysis.iDontFollowBack.length})
                        </h4>
                        <UserTable title="I Don't Follow Back" userIds={analysis.iDontFollowBack} {...userTableProps} />
                    </div>
               )}

               {relationshipFilter === 'mutuals' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
                             <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            Mutual Connections ({analysis.mutuals.length})
                        </h4>
                        <UserTable title="Mutual Connections" userIds={analysis.mutuals} {...userTableProps} />
                    </div>
               )}

               {!relationshipFilter && (
                   <div className="text-center py-12 text-gray-500">
                       <Icon name="users" className="w-12 h-12 mx-auto mb-3 opacity-20" />
                       <p>Select a relationship type above to view the detailed list.</p>
                   </div>
               )}
           </Card>
       )}

       {activeTab === 'trends' && (
           <TrendsReport snapshots={snapshots} />
       )}

       {activeTab === 'changes' && (
           <Card title="Recent Changes (Delta)" icon={<Icon name="users" />}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-8">
                    <div>
                      <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">New Followers (+{analysis.newFollowers.length})</h4>
                      <UserTable title="New Followers" userIds={analysis.newFollowers} {...userTableProps} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">Unfollowers (-{analysis.lostFollowers.length})</h4>
                      <UserTable title="Unfollowers" userIds={analysis.lostFollowers} badgeMap={unfollowedEachOtherBadgeMap} badgeTooltip="Was a mutual connection" {...userTableProps} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">Newly Followed By Me (+{analysis.newlyFollowedByMe.length})</h4>
                      <UserTable title="Newly Followed" userIds={analysis.newlyFollowedByMe} {...userTableProps} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">No Longer Followed By Me (-{analysis.noLongerFollowedByMe.length})</h4>
                      <UserTable title="No Longer Followed" userIds={analysis.noLongerFollowedByMe} badgeMap={unfollowedEachOtherBadgeMap} badgeTooltip="Was a mutual connection" {...userTableProps} />
                    </div>
                     <div className="lg:col-span-2">
                      <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-4 pt-4 border-t dark:border-gray-700">Detailed Relationship Transitions</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {analysis.usernameChanged.length > 0 && <details className="p-3 border dark:border-gray-700 rounded-lg">
                            <summary className="cursor-pointer font-semibold text-sm">Username Changes ({analysis.usernameChanged.length})</summary>
                            <div className="mt-4">
                                <UserTable title="Username Changes" userIds={analysis.usernameChanged.map(c => c.id)} {...userTableProps} />
                            </div>
                        </details>}
                        <details className="p-3 border dark:border-gray-700 rounded-lg">
                            <summary className="cursor-pointer font-semibold text-sm">Became Mutual (+{analysis.becameMutual.length})</summary>
                             <div className="mt-4">
                                <UserTable title="Became Mutual" userIds={analysis.becameMutual} {...userTableProps} />
                            </div>
                        </details>
                         <details className="p-3 border dark:border-gray-700 rounded-lg">
                            <summary className="cursor-pointer font-semibold text-sm">Lost Mutual: They Unfollowed (-{analysis.lostMutualTheyUnfollowed.length})</summary>
                             <div className="mt-4">
                                <UserTable title="Lost Mutual (They Unfollowed)" userIds={analysis.lostMutualTheyUnfollowed} {...userTableProps} />
                            </div>
                        </details>
                         <details className="p-3 border dark:border-gray-700 rounded-lg">
                            <summary className="cursor-pointer font-semibold text-sm">Lost Mutual: I Unfollowed (-{analysis.lostMutualIUnfollowed.length})</summary>
                             <div className="mt-4">
                                <UserTable title="Lost Mutual (I Unfollowed)" userIds={analysis.lostMutualIUnfollowed} {...userTableProps} />
                            </div>
                        </details>
                         <details className="p-3 border dark:border-gray-700 rounded-lg">
                            <summary className="cursor-pointer font-semibold text-sm">Unfollowed Each Other (-{analysis.unfollowedEachOther.length})</summary>
                             <div className="mt-4">
                                <UserTable title="Unfollowed Each Other" userIds={analysis.unfollowedEachOther} {...userTableProps} />
                            </div>
                        </details>
                      </div>
                    </div>
                </div>
              </Card>
        )}
    </div>
  );
};
