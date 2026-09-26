import React, { useRef, useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

interface SettingsPanelProps {
  onClearAll: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onAssignAccount: (username: string) => void;
  unassignedCount: number;
  isBusy: boolean;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClearAll, onExport, onImport, onAssignAccount, unassignedCount, isBusy }) => {
  const input = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState('');
  return <div className="max-w-2xl mx-auto space-y-6">
    <Card title="Local data and backups">
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Your history is stored in this browser on this device. Clearing browser data or changing the app address can make it unavailable. Export a backup before moving to another browser or app address.</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={onExport} disabled={isBusy}>Export backup (.json)</Button>
        <Button variant="secondary" disabled={isBusy} onClick={() => input.current?.click()}>Restore backup (.json)</Button>
        <input type="file" ref={input} hidden accept=".json" aria-label="Choose backup file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onImport(file); }} />
      </div>
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">A restore is validated before you confirm replacing local history. Legacy Insta Tracker backups are supported. Keep backups private; they contain your relationship data.</p>
    </Card>
    {unassignedCount > 0 && <Card title="Identify existing history">
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{unassignedCount} older {unassignedCount === 1 ? 'snapshot has' : 'snapshots have'} no account name. Comparisons stay unavailable until you confirm whose history this is. Only assign these together if all are from the same account.</p>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); onAssignAccount(account); }}>
        <label htmlFor="history-account" className="block text-sm font-medium">Instagram username for all unassigned history</label>
        <input id="history-account" required pattern="@?(?!\.)(?!.*\.\.)(?!.*\.$)[A-Za-z0-9._]{1,30}" maxLength={31} value={account} onChange={e => setAccount(e.target.value)} className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" />
        <Button type="submit" disabled={isBusy}>Review account assignment</Button>
      </form>
    </Card>}
    <Card title="Privacy">
      <p className="text-sm text-gray-600 dark:text-gray-300">Imports and comparisons stay on this device. This release has no cloud sync, Instagram login, scraping, remote avatar lookup, or AI processing. Opening the export instructions takes you to Instagram’s website.</p>
    </Card>
    <Card title="Remove local history">
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">Export a backup first. Clearing history removes all snapshots and user records from this browser.</p>
      <Button variant="danger" onClick={onClearAll} disabled={isBusy}>Clear all data</Button>
    </Card>
  </div>;
};
