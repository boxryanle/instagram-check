import React, { useState } from 'react';
import type { Snapshot } from '../types';
import { Button } from './ui/Button';
import { snapshotCoverage, snapshotTimestamp } from '../utils/analysis';

interface SnapshotManagerProps {
  snapshots: Snapshot[]; baselineId: string | null; targetId: string | null;
  onSetBaseline: (id: string | null) => void; onSetTarget: (id: string | null) => void;
  onDelete: (id: string) => void; onRename: (id: string, name: string) => void;
}

const SnapshotItem: React.FC<{ snapshot: Snapshot; previous?: Snapshot } & Omit<SnapshotManagerProps, 'snapshots'>> = ({ snapshot, previous, baselineId, targetId, onSetBaseline, onSetTarget, onDelete, onRename }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(snapshot.name ?? '');
  const coverage = snapshotCoverage(snapshot);
  const counts = (role: 'followers' | 'following') => coverage[role] === 'missing' ? 'Not supplied' : `${snapshot.data[role === 'followers' ? 'followersById' : 'followingById'].length.toLocaleString()}${coverage[role] !== 'complete' ? ' (unconfirmed)' : ''}`;
  return <li className="py-4 border-b last:border-b-0 border-gray-200 dark:border-gray-700 space-y-3">
    <div className="flex flex-wrap gap-2 items-center justify-between">
      {editing ? <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); onRename(snapshot.id, name); setEditing(false); }}><input aria-label="Snapshot label" maxLength={120} autoFocus value={name} onChange={e => setName(e.target.value)} className="px-2 py-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md" /><Button type="submit">Save label</Button><Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></form> : <div><p className="font-semibold">{snapshot.name || new Date(snapshot.capturedAt ?? snapshot.createdAt).toLocaleString()}</p><p className="text-sm text-gray-600 dark:text-gray-300">{snapshot.accountUsername ? `@${snapshot.accountUsername}` : 'Account unassigned — identify in Settings'} · {snapshot.capturedAt ? 'Export time' : 'Import time; export time unknown'}</p></div>}
      {!editing && <button type="button" onClick={() => setEditing(true)} className="text-sm underline text-primary-700 dark:text-primary-300">Edit label</button>}
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm"><span>Followers: {counts('followers')}</span><span>Following: {counts('following')}</span></div>
    <p className="text-xs text-gray-600 dark:text-gray-300 break-words">{snapshot.meta.files.map(file => file.fileName).filter((name, i, all) => all.indexOf(name) === i).join(', ')}</p>
    <div className="flex gap-2 flex-wrap">
      {previous && <Button variant="secondary" onClick={() => { onSetTarget(snapshot.id); onSetBaseline(previous.id); }}>Compare to previous</Button>}
      <Button variant={baselineId === snapshot.id ? 'primary' : 'secondary'} onClick={() => onSetBaseline(snapshot.id)}>Baseline</Button>
      <Button variant={targetId === snapshot.id ? 'primary' : 'secondary'} onClick={() => onSetTarget(snapshot.id)}>Target</Button>
      <Button variant="ghost" onClick={() => onDelete(snapshot.id)}>Delete</Button>
    </div>
  </li>;
};

export const SnapshotManager: React.FC<SnapshotManagerProps> = props => {
  const [account, setAccount] = useState('');
  const accounts = [...new Set(props.snapshots.map(s => s.accountUsername).filter(Boolean))].sort();
  const ordered = props.snapshots.slice().sort((a, b) => snapshotTimestamp(a) - snapshotTimestamp(b));
  const visible = ordered.filter(s => !account || (account === 'unassigned' ? !s.accountUsername : s.accountUsername === account));
  return <section className="p-4 sm:p-5 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700" aria-labelledby="snapshot-history-title">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3"><h2 id="snapshot-history-title" className="text-xl font-semibold">Snapshot history ({props.snapshots.length})</h2>{props.snapshots.length > 0 && <label className="text-sm flex gap-2 items-center">Account<select value={account} onChange={e => setAccount(e.target.value)} className="px-2 py-1 border rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"><option value="">All accounts</option>{accounts.map(value => <option key={value} value={value}>@{value}</option>)}<option value="unassigned">Unassigned</option></select></label>}</div>
    {visible.length ? <ul>{visible.slice().reverse().map(snapshot => {
      const previous = snapshot.accountUsername ? ordered.filter(s => s.accountUsername === snapshot.accountUsername && snapshotTimestamp(s) < snapshotTimestamp(snapshot)).at(-1) : undefined;
      return <SnapshotItem key={snapshot.id} {...props} snapshot={snapshot} previous={previous} />;
    })}</ul> : <p className="text-sm text-gray-600 dark:text-gray-300">{props.snapshots.length ? 'No snapshots for this account.' : 'Your saved imports will appear here.'}</p>}
  </section>;
};
