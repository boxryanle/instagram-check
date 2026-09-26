import React, { useState, useEffect, useCallback } from 'react';
import { Snapshot, ProcessedFileData, SnapshotFileData, User } from './types';
import * as db from './services/db';
import { Header } from './components/Header';
import { UploadPanel } from './components/UploadPanel';
import { SnapshotManager } from './components/SnapshotManager';
import { AnalysisDashboard } from './components/AnalysisDashboard';
import { Modal } from './components/ui/Modal';
import { Button } from './components/ui/Button';
import { Toast } from './components/ui/Toast';
import { Spinner } from './components/ui/Spinner';
import { TestDataProvider } from './components/TestDataProvider';
import { union } from './utils/setUtils';
import { SettingsPanel } from './components/SettingsPanel';
import { Icon } from './components/ui/Icon';
import { exportAsJSON } from './utils/fileUtils';

type ToastState = {
    message: string;
    type: 'success' | 'error';
} | null;

type ModalState = {
    isOpen: boolean;
    title: string;
    body: string;
    onConfirm: () => void;
}

const App: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({ isOpen: false, title: '', body: '', onConfirm: () => {} });
  const [toast, setToast] = useState<ToastState>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activeTab, setActiveTab] = useState('analysis');

  useEffect(() => {
    // Theme setup
    const storedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(storedTheme || (prefersDark ? 'dark' : 'light'));
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };
  
  const showModal = (title: string, body: string, onConfirm: () => void) => {
    setModal({ isOpen: true, title, body, onConfirm });
  };
  const closeModal = () => setModal(prev => ({...prev, isOpen: false}));

  const loadSnapshots = useCallback(async () => {
    setIsLoading(true);
    try {
      await db.initDB();
      const loadedSnapshots = await db.getAllSnapshots();
      setSnapshots(loadedSnapshots);
      if (loadedSnapshots.length > 0) {
        setTargetId(prev => loadedSnapshots.some(s => s.id === prev) ? prev : loadedSnapshots[loadedSnapshots.length - 1].id);
        if (loadedSnapshots.length > 1) {
          setBaselineId(prev => loadedSnapshots.some(s => s.id === prev) ? prev : loadedSnapshots[loadedSnapshots.length - 2].id);
        } else {
          setBaselineId(null);
        }
      } else {
          setTargetId(null);
          setBaselineId(null);
      }
    } catch (error) {
      console.error(error);
      showToast('Failed to load snapshots from the database.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleSetBaseline = (id: string | null) => {
       setBaselineId(id);
       if (id && targetId) setActiveTab('analysis');
  }

  const handleSetTarget = (id: string | null) => {
       setTargetId(id);
       if (id) setActiveTab('analysis');
  }

  const handleSaveSnapshot = async (files: ProcessedFileData[]) => {
    setIsLoading(true);
    const now = new Date().toISOString();

    try {
        const allUsersFromFile = new Map<string, { username: string; fullName: string | null; }>();
        const allFollowers = new Set<string>();
        const allFollowing = new Set<string>();
        const allWarnings: string[] = [];
        const fileMetas: SnapshotFileData[] = [];
        let totalFollowerRows = 0;
        let totalFollowingRows = 0;
        let hasIds = false;

        files.forEach(file => {
            file.users.forEach((data, id) => allUsersFromFile.set(id, data));
            file.followers.forEach(id => allFollowers.add(id));
            file.following.forEach(id => allFollowing.add(id));
            allWarnings.push(...file.warnings);
            if (file.hasIds) hasIds = true;
            
            if (file.role === 'followers') {
                totalFollowerRows += file.rowCount;
                fileMetas.push({ role: 'followers', fileName: file.fileInfo.name, fileSize: file.fileInfo.size, fileHash: file.fileInfo.hash });
            } else if (file.role === 'following') {
                totalFollowingRows += file.rowCount;
                fileMetas.push({ role: 'following', fileName: file.fileInfo.name, fileSize: file.fileInfo.size, fileHash: file.fileInfo.hash });
            } else if (file.role === 'combined') {
                 if(file.followers.size > 0) {
                    totalFollowerRows += file.rowCount;
                    fileMetas.push({ role: 'followers', fileName: file.fileInfo.name, fileSize: file.fileInfo.size, fileHash: file.fileInfo.hash });
                }
                if(file.following.size > 0) {
                    totalFollowingRows += file.rowCount;
                    if (!fileMetas.some(m => m.fileHash === file.fileInfo.hash)) {
                        fileMetas.push({ role: 'following', fileName: file.fileInfo.name, fileSize: file.fileInfo.size, fileHash: file.fileInfo.hash });
                    }
                }
            }
        });

        const userIds = Array.from(allUsersFromFile.keys());
        const existingUsersMap = await db.getUsersByIds(userIds);
        const usersToUpdate: User[] = [];

        userIds.forEach(id => {
            const fileUser = allUsersFromFile.get(id)!;
            const dbUser = existingUsersMap.get(id);

            if (!dbUser) { // New user
                const user: User = {
                    id,
                    currentUsername: fileUser.username,
                    usernames: [fileUser.username],
                    fullNames: fileUser.fullName ? [fileUser.fullName] : [],
                    firstSeenAt: now,
                    lastSeenAt: now,
                };
                usersToUpdate.push(user);
            } else { // Existing user, check for changes
                if (dbUser.currentUsername !== fileUser.username) {
                    dbUser.currentUsername = fileUser.username;
                    if (!dbUser.usernames.includes(fileUser.username)) {
                        dbUser.usernames.push(fileUser.username);
                    }
                }
                if (fileUser.fullName && dbUser.fullNames[dbUser.fullNames.length -1] !== fileUser.fullName) {
                    dbUser.fullNames.push(fileUser.fullName);
                }
                dbUser.lastSeenAt = now;
                usersToUpdate.push(dbUser);
            }
        });
        
        const isPartial = !(allFollowers.size > 0 && allFollowing.size > 0);
        const newSnapshot: Snapshot = {
            id: crypto.randomUUID(),
            createdAt: now,
            isPartial,
            meta: {
                files: fileMetas,
                rowCount: { followers: totalFollowerRows, following: totalFollowingRows },
                parseWarnings: allWarnings,
                hasIds: hasIds,
            },
            data: {
                followersById: Array.from(allFollowers),
                followingById: Array.from(allFollowing),
                followersUsernames: Array.from(allFollowers).map(id => allUsersFromFile.get(id)!.username),
                followingUsernames: Array.from(allFollowing).map(id => allUsersFromFile.get(id)!.username),
            },
        };

        await db.putUsers(usersToUpdate);
        await db.addSnapshot(newSnapshot);
        showToast(`Snapshot saved at ${new Date(newSnapshot.createdAt).toLocaleTimeString()}`);
        
        await loadSnapshots();
    } catch (error) {
        console.error(error);
        showToast('Failed to save snapshot.', 'error');
    } finally {
        setIsLoading(false);
    }
  };
  
  const handleRenameSnapshot = async (id: string, newName: string) => {
    const snapshotToUpdate = snapshots.find(s => s.id === id);
    if (snapshotToUpdate) {
        const updatedSnapshot = { ...snapshotToUpdate, name: newName };
        try {
            await db.updateSnapshot(updatedSnapshot);
            showToast('Snapshot renamed.');
            await loadSnapshots();
        } catch (error) {
            console.error(error);
            showToast('Failed to rename snapshot.', 'error');
        }
    }
  };

  const handleDeleteSnapshot = (id: string) => {
    showModal('Delete Snapshot?', 'Are you sure you want to permanently delete this snapshot? Note: This does not delete the associated user records.', async () => {
        try {
            await db.deleteSnapshot(id);
            showToast('Snapshot deleted.');
            await loadSnapshots();
        } catch (error) {
            console.error(error);
            showToast('Failed to delete snapshot.', 'error');
        } finally {
            closeModal();
        }
    });
  };
  
  const handleClearAllData = () => {
     showModal('Clear All Data?', 'This will permanently remove all saved snapshots and user records. This action cannot be undone.', async () => {
        try {
            await db.clearDB();
            showToast('All data has been cleared.');
            setSnapshots([]);
            setBaselineId(null);
            setTargetId(null);
        } catch (error) {
            console.error(error);
            showToast('Failed to clear data.', 'error');
        } finally {
            closeModal();
        }
    });
  }

  const findLatestPartialToComplete = (file: ProcessedFileData): Snapshot | undefined => {
    const sortedPartials = snapshots.filter(s => s.isPartial).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sortedPartials.find(s => {
        const hasFollowers = s.data.followersById.length > 0;
        const hasFollowing = s.data.followingById.length > 0;
        return (file.role === 'followers' && !hasFollowers) || (file.role === 'following' && !hasFollowing);
    });
  }

  const handleMerge = (partialSnapshot: Snapshot, file: ProcessedFileData) => {
    showModal('Complete Partial Snapshot?', `A partial snapshot from ${new Date(partialSnapshot.createdAt).toLocaleString()} is missing a ${file.role} list. Do you want to add this file to it?`, async () => {
        const followers = new Set([...partialSnapshot.data.followersById, ...file.followers]);
        const following = new Set([...partialSnapshot.data.followingById, ...file.following]);
        const now = new Date().toISOString();
        const fileUserIds = Array.from(file.users.keys());
        const existingUsersMap = await db.getUsersByIds(fileUserIds);
        const usersToUpdate: User[] = [];
        file.users.forEach((data, id) => {
             const dbUser = existingUsersMap.get(id);
             if (!dbUser) {
                 usersToUpdate.push({
                    id: id,
                    currentUsername: data.username,
                    usernames: [data.username],
                    fullNames: data.fullName ? [data.fullName] : [],
                    firstSeenAt: now,
                    lastSeenAt: now,
                });
             } else {
                dbUser.lastSeenAt = now;
                usersToUpdate.push(dbUser);
             }
        });
        await db.putUsers(usersToUpdate);
        
        const allUserIdsInSnapshot = Array.from(union(followers, following));
        const allUsersMap = await db.getUsersByIds(allUserIdsInSnapshot);

        const updatedSnapshot: Snapshot = {
            ...partialSnapshot,
            isPartial: false,
            updatedAt: now,
            data: {
                followersById: Array.from(followers),
                followingById: Array.from(following),
                followersUsernames: Array.from(followers).map(id => (allUsersMap.get(id)?.currentUsername || file.users.get(id)?.username) || 'N/A'),
                followingUsernames: Array.from(following).map(id => (allUsersMap.get(id)?.currentUsername || file.users.get(id)?.username) || 'N/A'),
            },
            meta: { ...partialSnapshot.meta, files: [...partialSnapshot.meta.files, { role: file.role as 'followers' | 'following', fileName: file.fileInfo.name, fileSize: file.fileInfo.size, fileHash: file.fileInfo.hash }], rowCount: { followers: partialSnapshot.meta.rowCount.followers + (file.role === 'followers' || file.role === 'combined' ? file.rowCount : 0), following: partialSnapshot.meta.rowCount.following + (file.role === 'following' || file.role === 'combined' ? file.rowCount : 0), }, parseWarnings: [...partialSnapshot.meta.parseWarnings, ...file.warnings], hasIds: partialSnapshot.meta.hasIds || file.hasIds, }
        };

        try {
            await db.updateSnapshot(updatedSnapshot);
            showToast('Snapshot completed!');
            await loadSnapshots();
        } catch (e) {
            showToast('Failed to merge snapshot.', 'error');
        } finally {
            closeModal();
        }
    })
  }
  
  const handleExport = async () => {
    const [users, snapshots] = await Promise.all([db.getAllUsers(), db.getAllSnapshots()]);
    exportAsJSON({ users, snapshots }, `insta_tracker_backup_${new Date().toISOString().split('T')[0]}.json`);
    showToast('Backup exported.');
  };

  const handleImport = async (file: File) => {
    try {
        if (file.name.endsWith('.json')) {
            const content = await file.text();
            const data = JSON.parse(content);
            if (data.snapshots && data.users) {
                showModal('Import JSON Backup?', `This will add ${data.snapshots.length} snapshots and ${data.users.length} users. Existing data with the same ID will be overwritten.`, async () => {
                  try {
                    await db.addSnapshots(data.snapshots);
                    await db.putUsers(data.users);
                    showToast('Backup imported successfully!');
                    await loadSnapshots();
                  } catch (e) { showToast('Failed to import data.', 'error'); } finally { closeModal(); }
                });
            } else { showToast('Invalid JSON backup file format.', 'error'); }
        } else {
            showToast('Unsupported file type. Please select a .json backup.', 'error');
        }
    } catch (e) {
      showToast('Failed to read or parse backup file.', 'error');
    }
  };

  const TABS: {id: string, label: string, icon: React.ComponentProps<typeof Icon>['name']}[] = [
       { id: 'analysis', label: 'Analysis', icon: 'compare' },
       { id: 'snapshots', label: 'Snapshots', icon: 'chart' },
       { id: 'settings', label: 'Settings', icon: 'edit' },
  ];

  const renderActiveTabContent = () => {
       if (isLoading && snapshots.length === 0) {
           return <div className="flex justify-center items-center h-64"><Spinner /></div>;
       }

       switch(activeTab) {
           case 'snapshots':
               return (
                   <div className="space-y-6">
                       <UploadPanel onSave={handleSaveSnapshot} onMerge={handleMerge} findLatestPartialToComplete={findLatestPartialToComplete} isLoading={isLoading} />
                       <SnapshotManager snapshots={snapshots} baselineId={baselineId} targetId={targetId} onSetBaseline={handleSetBaseline} onSetTarget={handleSetTarget} onDelete={handleDeleteSnapshot} onRename={handleRenameSnapshot} />
                       <TestDataProvider onSave={(data) => handleSaveSnapshot([data])} />
                   </div>
               );
           case 'settings':
               return <SettingsPanel onClearAll={handleClearAllData} onExport={handleExport} onImport={handleImport} onRestoreComplete={loadSnapshots} showModal={showModal} closeModal={closeModal} onShowToast={showToast}/>;
           case 'analysis':
           default:
               return snapshots.length > 0 ? (
                   <AnalysisDashboard snapshots={snapshots} baselineId={baselineId} targetId={targetId} onShowToast={showToast} />
               ) : (
                   <div className="text-center py-20 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                        <h2 className="text-2xl font-bold text-gray-800 dark:bg-gray-200">Welcome to Insta Tracker</h2>
                        <p className="mt-2 text-gray-500 dark:text-gray-400">Go to the 'Snapshots' tab to upload your first CSV.</p>
                   </div>
               );
       }
   }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
      <Header theme={theme} toggleTheme={toggleTheme} />
      
      <main className="container mx-auto p-4 lg:p-6">
        <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
           <nav className="-mb-px flex space-x-2 sm:space-x-6" aria-label="Tabs">
               {TABS.map(tab => (
                   <button
                       key={tab.id}
                       onClick={() => setActiveTab(tab.id)}
                       className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                           activeTab === tab.id
                           ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                           : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600'
                       }`}
                       aria-current={activeTab === tab.id ? 'page' : undefined}
                   >
                       <Icon name={tab.icon} className="w-5 h-5" />
                       <span className="hidden sm:inline">{tab.label}</span>
                   </button>
               ))}
           </nav>
        </div>

        {renderActiveTabContent()}
      </main>
      
      <Modal isOpen={modal.isOpen} onClose={closeModal} title={modal.title}>
          <p className="text-gray-600 dark:text-gray-300 mb-6">{modal.body}</p>
          <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={closeModal}>Cancel</Button>
              <Button variant="danger" onClick={modal.onConfirm}>Confirm</Button>
          </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default App;