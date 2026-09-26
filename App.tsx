import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportContext, ProcessedFileData, Snapshot } from './types';
import * as db from './services/db';
import { parseBackup, createBackup, BACKUP_MAX_BYTES } from './services/backup';
import { buildSnapshot } from './utils/snapshotBuilder';
import { Header } from './components/Header';
import { UploadPanel } from './components/UploadPanel';
import { SnapshotManager } from './components/SnapshotManager';
const AnalysisDashboard = React.lazy(() => import('./components/AnalysisDashboard').then(module => ({ default: module.AnalysisDashboard })));
import { SettingsPanel } from './components/SettingsPanel';
import { Modal } from './components/ui/Modal';
import { Button } from './components/ui/Button';
import { Toast } from './components/ui/Toast';
import { Spinner } from './components/ui/Spinner';
import { Icon } from './components/ui/Icon';
import { exportAsJSON } from './utils/fileUtils';

type ToastState = { message: string; type: 'success' | 'error' } | null;
type Confirmation = { title: string; body: string; action: () => Promise<void> } | null;
const snapshotTime = (s: Snapshot) => Date.parse(s.capturedAt ?? s.createdAt);

const App: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [activeTab, setActiveTab] = useState('snapshots');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { const saved = localStorage.getItem('theme'); if (saved === 'dark' || saved === 'light') return saved; } catch { /* Browser storage may be restricted. */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => setToast({ message, type }), []);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); try { localStorage.setItem('theme', theme); } catch { /* Theme need not block local data use. */ } }, [theme]);

  const reload = useCallback(async () => {
    const all = (await db.getAllSnapshots()).sort((a, b) => snapshotTime(a) - snapshotTime(b));
    setSnapshots(all);
    setTargetId(previous => all.some(s => s.id === previous) ? previous : all.at(-1)?.id ?? null);
    setBaselineId(previous => all.some(s => s.id === previous) ? previous : all.at(-2)?.id ?? null);
  }, []);
  const initialize = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try { await db.initDB(); await reload(); } catch { setLoadError(true); } finally { setLoading(false); }
  }, [reload]);
  useEffect(() => { void initialize(); }, [initialize]);

  const saveSnapshot = async (files: ProcessedFileData[], context: ImportContext): Promise<boolean> => {
    if (operation.current) return false;
    operation.current = true; setBusy(true);
    try {
      const { snapshot, users } = buildSnapshot(files, context, await db.getAllUsers());
      await db.saveSnapshotWithUsers(snapshot, users);
      let refreshed = true;
      try { await reload(); } catch { refreshed = false; setSnapshots(previous => [...previous, snapshot].sort((a, b) => snapshotTime(a) - snapshotTime(b))); }
      setTargetId(snapshot.id);
      const previous = snapshots.filter(s => s.accountUsername === snapshot.accountUsername && snapshotTime(s) < snapshotTime(snapshot)).at(-1);
      setBaselineId(previous?.id ?? null);
      notify(refreshed ? 'Snapshot saved on this device.' : 'Snapshot saved. Reload this page to refresh the history view.', refreshed ? 'success' : 'error');
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to save the snapshot. Your existing history is unchanged.', 'error');
      return false;
    } finally { operation.current = false; setBusy(false); }
  };

  const refreshAfterCommit = async (message: string) => {
    try { await reload(); notify(message); } catch { notify(`${message} Reload this page to refresh the history view.`, 'error'); }
  };

  const confirm = async () => {
    if (!confirmation || operation.current) return;
    operation.current = true; setBusy(true);
    try { await confirmation.action(); setConfirmation(null); } catch (e) { notify(e instanceof Error ? e.message : 'The operation failed. Please try again.', 'error'); } finally { operation.current = false; setBusy(false); }
  };
  const exportBackup = async () => {
    try { const data = await db.readBackup(); exportAsJSON(createBackup(data.snapshots, data.users), `insta_tracker_backup_${new Date().toISOString().slice(0, 10)}.json`); notify('Backup download started. Keep it in a private location.'); } catch { notify('Unable to export a backup.', 'error'); }
  };
  const importBackup = async (file: File) => {
    if (operation.current) return;
    operation.current = true; setBusy(true);
    try {
      if (!/\.json$/i.test(file.name) || file.size > BACKUP_MAX_BYTES) throw new Error('Choose a JSON backup smaller than 50 MB.');
      const backup = parseBackup(JSON.parse(await file.text()));
      setConfirmation({ title: 'Replace local history with this backup?', body: `The validated backup contains ${backup.snapshots.length} snapshots and ${backup.users.length} user records. It will replace the ${snapshots.length} snapshots currently on this device. Export your current backup first if you want to keep it. No data is changed until you confirm.`, action: async () => { await db.replaceDatabase(backup.snapshots, backup.users); await refreshAfterCommit('Backup restored.'); } });
    } catch (e) { notify(e instanceof Error ? e.message : 'Invalid backup. Your history is unchanged.', 'error'); } finally { operation.current = false; setBusy(false); }
  };
  const assignAccount = (value: string) => {
    const username = value.trim().replace(/^@/, '').toLowerCase();
    if (!/^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/.test(username)) { notify('Enter a valid Instagram username.', 'error'); return; }
    setConfirmation({ title: 'Assign an account to existing history?', body: `Only continue if every unassigned snapshot belongs to @${username}. Snapshot lists and dates will stay unchanged. Export a backup first if you are unsure.`, action: async () => { const count = await db.assignAccountToUnassigned(username); await refreshAfterCommit(`Account assigned to ${count} snapshots.`); } });
  };
  const renameSnapshot = async (id: string, name: string) => {
    if (operation.current) return;
    const snapshot = snapshots.find(s => s.id === id);
    if (!snapshot) return;
    operation.current = true; setBusy(true);
    try { await db.renameSnapshot(id, name.trim().slice(0, 120)); await refreshAfterCommit('Snapshot renamed.'); } catch { notify('Unable to rename this snapshot.', 'error'); } finally { operation.current = false; setBusy(false); }
  };
  const deleteSnapshot = (id: string) => setConfirmation({ title: 'Delete this snapshot?', body: 'This removes one snapshot from this browser. Download a backup first if you might need it again. Associated user records are retained.', action: async () => { await db.deleteSnapshot(id); await refreshAfterCommit('Snapshot deleted.'); } });
  const clearAll = () => setConfirmation({ title: 'Clear all local history?', body: 'This removes every snapshot and user record from this browser. You will need a previously downloaded backup to recover them.', action: async () => { await db.clearDB(); await refreshAfterCommit('Local history cleared.'); } });

  const tabs: { id: string; label: string; icon: React.ComponentProps<typeof Icon>['name'] }[] = [ { id: 'snapshots', label: 'Snapshots', icon: 'chart' }, { id: 'analysis', label: 'Analysis', icon: 'compare' }, { id: 'settings', label: 'Settings', icon: 'edit' } ];
  return <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
    <Header theme={theme} toggleTheme={() => setTheme(previous => previous === 'light' ? 'dark' : 'light')} />
    <main className="container max-w-6xl mx-auto p-4 lg:p-6">
      <nav className="flex gap-5 border-b border-gray-200 dark:border-gray-700 mb-6" aria-label="Main navigation">{tabs.map(tab => <button key={tab.id} disabled={busy} onClick={() => setActiveTab(tab.id)} aria-current={activeTab === tab.id ? 'page' : undefined} className={`py-3 border-b-2 flex items-center gap-2 text-sm font-medium ${activeTab === tab.id ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-gray-600 dark:text-gray-300'}`}><Icon name={tab.icon} className="w-4 h-4" />{tab.label}</button>)}</nav>
      {loading ? <div role="status" aria-label="Loading local history" className="py-16 flex justify-center"><Spinner /></div> : loadError ? <div role="alert" className="space-y-3"><h2 className="text-lg font-semibold">Local history could not be opened</h2><p>Your data has not been cleared. Close other Insta Tracker tabs and try again. Keep any existing backup.</p><Button onClick={() => void initialize()}>Try again</Button></div> : <>
        {activeTab === 'snapshots' && <div className="space-y-6"><UploadPanel onSave={saveSnapshot} isLoading={busy} initialAccount={snapshots.at(-1)?.accountUsername} /><SnapshotManager snapshots={snapshots} baselineId={baselineId} targetId={targetId} onSetBaseline={id => { setBaselineId(id); setActiveTab('analysis'); }} onSetTarget={id => { setTargetId(id); setActiveTab('analysis'); }} onDelete={deleteSnapshot} onRename={renameSnapshot} /></div>}
        {activeTab === 'analysis' && (snapshots.length ? <React.Suspense fallback={<div role="status" className="py-12">Loading analysis…</div>}><AnalysisDashboard snapshots={snapshots} baselineId={baselineId} targetId={targetId} onShowToast={notify} /></React.Suspense> : <div className="space-y-3 py-8"><h2 className="text-xl font-semibold">Import your first snapshot</h2><p className="text-gray-600 dark:text-gray-300">Use your Instagram export to start a private history on this device.</p><Button onClick={() => setActiveTab('snapshots')}>Import an export</Button></div>)}
        {activeTab === 'settings' && <SettingsPanel onClearAll={clearAll} onExport={() => void exportBackup()} onImport={file => void importBackup(file)} onAssignAccount={assignAccount} unassignedCount={snapshots.filter(s => !s.accountUsername).length} isBusy={busy} />}
      </>}
    </main>
    <Modal isOpen={!!confirmation} title={confirmation?.title ?? ''} onClose={() => { if (!busy) setConfirmation(null); }}>
      <p className="text-sm mb-5 text-gray-700 dark:text-gray-200">{confirmation?.body}</p>
      <div className="flex flex-wrap justify-end gap-3"><Button variant="secondary" disabled={busy} onClick={() => void exportBackup()}>Export current backup</Button><Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void confirm()}>{busy ? 'Working…' : 'Confirm'}</Button></div>
    </Modal>
    {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
  </div>;
};

export default App;
