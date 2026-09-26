import React, { useMemo, useRef, useState } from 'react';
import type { ImportContext, ProcessedFileData } from '../types';
import { processImportFiles } from '../utils/importArchive';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Icon } from './ui/Icon';

interface UploadPanelProps {
  onSave: (files: ProcessedFileData[], context: ImportContext) => Promise<boolean>;
  isLoading: boolean;
  initialAccount?: string;
}

export const UploadPanel: React.FC<UploadPanelProps> = ({ onSave, isLoading, initialAccount = '' }) => {
  const [files, setFiles] = useState<ProcessedFileData[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [account, setAccount] = useState(initialAccount);
  const [capturedAt, setCapturedAt] = useState('');
  const [complete, setComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const busy = processing || saving || isLoading;
  const summary = useMemo(() => {
    const followers = new Set<string>();
    const following = new Set<string>();
    let hasFollowers = false;
    let hasFollowing = false;
    const warnings = new Set<string>();
    for (const file of files) {
      file.followers.forEach(id => followers.add(file.users.get(id)?.username ?? id));
      file.following.forEach(id => following.add(file.users.get(id)?.username ?? id));
      hasFollowers ||= file.role === 'followers' || file.role === 'combined';
      hasFollowing ||= file.role === 'following' || file.role === 'combined';
      file.warnings.forEach(warning => warnings.add(warning));
    }
    return { followers: followers.size, following: following.size, hasFollowers, hasFollowing, warnings: [...warnings] };
  }, [files]);

  const process = async (selection: File[]) => {
    if (!selection.length || busy) return;
    const current = ++generation.current;
    setProcessing(true);
    setError('');
    setFiles([]);
    setComplete(false);
    try {
      const parsed = await processImportFiles(selection);
      if (current === generation.current) setFiles(parsed);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : 'Unable to read this export.');
    } finally {
      if (current === generation.current) setProcessing(false);
      if (input.current) input.current.value = '';
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !files.length) return;
    const username = account.trim().replace(/^@/, '').toLowerCase();
    if (!/^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/.test(username)) {
      setError('Enter the Instagram username this export belongs to.');
      return;
    }
    const date = capturedAt ? new Date(capturedAt) : undefined;
    if (date && (!Number.isFinite(date.getTime()) || date.getTime() > Date.now())) {
      setError('Choose an export date and time that is not in the future.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await onSave(files, { accountUsername: username, capturedAt: date?.toISOString(), confirmedComplete: complete });
      if (saved) { setFiles([]); setComplete(false); setCapturedAt(''); }
      else setError('The snapshot was not saved. Your import preview is still here.');
    } catch {
      setError('The snapshot was not saved. Your import preview is still here.');
    } finally { setSaving(false); }
  };

  return (
    <Card title="Import Instagram export" icon={<Icon name="upload" />}>
      <div className="space-y-5">
        <p className="text-sm text-gray-600 dark:text-gray-300">Import your own downloaded archive. Files are processed on this device; Instagram login is not needed here.</p>
        <details className="border border-gray-300 dark:border-gray-600 rounded-md p-3">
          <summary className="cursor-pointer font-medium">How to get your Instagram export</summary>
          <ol className="list-decimal pl-5 mt-3 space-y-2 text-sm">
            <li>In Instagram settings, open Meta Account or Accounts Center, then Your information and permissions.</li>
            <li>Choose Export your information, create an export for your account, and select Export to device.</li>
            <li>Select Followers and following, the All time date range, and JSON format.</li>
            <li>Download the archive when Instagram makes it available, then choose that ZIP below.</li>
          </ol>
          <p className="mt-3 text-sm"><a className="text-primary-700 dark:text-primary-300 underline" href="https://help.instagram.com/181231772500920/" target="_blank" rel="noopener noreferrer">Instagram’s official export instructions</a></p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Menu names may vary. This app does not scrape Instagram or collect session cookies.</p>
        </details>
        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void process(Array.from(e.dataTransfer.files)); }} className="p-5 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md">
          <label htmlFor="relationship-files" className="block font-medium mb-2">Choose a ZIP, or all related JSON / CSV files together</label>
          <input id="relationship-files" ref={input} type="file" multiple accept=".zip,.json,.csv" disabled={busy} onChange={e => void process(Array.from(e.target.files ?? []))} className="block w-full text-sm file:mr-3 file:px-3 file:py-2 file:rounded-md file:border file:border-gray-300 file:bg-white file:text-gray-800" />
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">You can also drop files here. A new selection replaces the import preview. Backups belong in Settings.</p>
        </div>
        {processing && <p role="status" className="text-sm">Reading your files…</p>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        {files.length > 0 && <form onSubmit={save} className="space-y-4">
          <div className="flex flex-wrap gap-6 text-sm" aria-label="Import preview">
            <p>Followers: <strong>{summary.hasFollowers ? summary.followers.toLocaleString() : 'Missing'}</strong></p>
            <p>Following: <strong>{summary.hasFollowing ? summary.following.toLocaleString() : 'Missing'}</strong></p>
            <p>{files.length} relationship {files.length === 1 ? 'file' : 'files'}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="import-account" className="block text-sm font-medium mb-1">Your Instagram username</label><input id="import-account" autoComplete="off" required maxLength={31} value={account} disabled={busy} onChange={e => setAccount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800" /><p className="text-xs mt-1 text-gray-600 dark:text-gray-300">Confirm which of your accounts this export belongs to.</p></div>
            <div><label htmlFor="export-time" className="block text-sm font-medium mb-1">Export date and time (optional)</label><input id="export-time" type="datetime-local" value={capturedAt} disabled={busy} onChange={e => setCapturedAt(e.target.value)} onInput={e => setCapturedAt(e.currentTarget.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800" /><p className="text-xs mt-1 text-gray-600 dark:text-gray-300">Your local time. If unknown, charts use the import time.</p></div>
          </div>
          <label className="flex gap-3 items-start text-sm"><input type="checkbox" checked={complete} disabled={busy} onChange={e => setComplete(e.target.checked)} className="mt-1" /><span>I included all files for each supplied list, selected All time, and reviewed the counts. These lists are complete for this export.</span></label>
          {(!complete || !summary.hasFollowers || !summary.hasFollowing) && <p className="text-sm text-amber-800 dark:text-amber-200">You can save this import, but comparisons that require missing or unconfirmed lists will stay unavailable.</p>}
          {summary.warnings.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-medium">Review {summary.warnings.length} import {summary.warnings.length === 1 ? 'warning' : 'warnings'}</summary><ul className="list-disc pl-5 mt-2 space-y-1">{summary.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
          <div className="flex gap-3"><Button type="submit" disabled={busy}>{saving ? 'Saving…' : 'Save snapshot'}</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => { setFiles([]); setError(''); setComplete(false); }}>Discard preview</Button></div>
        </form>}
      </div>
    </Card>
  );
};
