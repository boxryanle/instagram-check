// @vitest-environment jsdom
import React from 'react';
import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { strToU8, zipSync } from 'fflate';
import App from '../App';
import * as db from '../services/db';
import { createBackup } from '../services/backup';
import { processImportFiles } from '../utils/importArchive';
import { buildSnapshot } from '../utils/snapshotBuilder';

const file = (content: string | Uint8Array, name: string) => new NodeFile([content], name) as unknown as File;
const record = (value: string) => ({ string_list_data: [{ value, href: `https://www.instagram.com/${value}/`, timestamp: 1 }] });
const json = (content: unknown, name: string) => file(JSON.stringify(content), name);
const select = (label: RegExp, files: File[]) => fireEvent.change(screen.getByLabelText(label), { target: { files } });

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('File', NodeFile);
  window.localStorage.clear();
});
afterEach(() => { cleanup(); db.closeDB(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture(id: string) {
  const files = await processImportFiles([json({ followers: ['sample_a'], following: ['sample_a'] }, 'lists.json')]);
  return buildSnapshot(files, { accountUsername: 'sample_owner', confirmedComplete: true }, [], '2026-01-01T12:00:00.000Z', id);
}
async function openApp() {
  render(<App />);
  await screen.findByLabelText(/Choose a ZIP/);
}

describe('local import and backup workflow', () => {
  it('previews multipart ZIP without writing, then saves only after explicit review', async () => {
    await openApp();
    const archive = zipSync({
      'connections/followers_and_following/followers_1.json': strToU8(JSON.stringify([record('sample_a')])),
      'connections/followers_and_following/followers_2.json': strToU8(JSON.stringify([record('sample_b')])),
      'connections/followers_and_following/following.json': strToU8(JSON.stringify({ relationships_following: [record('sample_a')] })),
      'messages/ignored.json': strToU8('not relationship data'),
    });
    select(/Choose a ZIP/, [file(archive, 'instagram.zip')]);
    await screen.findByLabelText('Your Instagram username');
    expect((await db.readBackup()).snapshots).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Your Instagram username'), { target: { value: '@Sample_Owner' } });
    fireEvent.input(screen.getByLabelText('Export date and time (optional)'), { target: { value: '2026-01-02T12:00' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }));
    await screen.findByText('Snapshot saved on this device.');
    const saved = await db.readBackup();
    expect(saved.snapshots).toHaveLength(1);
    expect(saved.snapshots[0]).toMatchObject({ accountUsername: 'sample_owner', coverage: { followers: 'complete', following: 'complete' }, meta: { rowCount: { followers: 2, following: 1 } } });
    expect(saved.users).toHaveLength(2);
    expect(saved.snapshots[0].capturedAt).toBe(new Date('2026-01-02T12:00').toISOString());
    expect(screen.queryByLabelText('Your Instagram username')).toBeNull();
  });

  it('does not invite a duplicate import when saving succeeds but refreshing fails', async () => {
    await openApp();
    select(/Choose a ZIP/, [json([record('sample_a')], 'followers_1.json')]);
    await screen.findByLabelText('Your Instagram username');
    fireEvent.change(screen.getByLabelText('Your Instagram username'), { target: { value: 'sample_owner' } });
    vi.spyOn(db, 'getAllSnapshots').mockRejectedValueOnce(new Error('Synthetic read failure'));
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }));
    await screen.findByText('Snapshot saved. Reload this page to refresh the history view.');
    expect(screen.queryByLabelText('Your Instagram username')).toBeNull();
    expect((await db.readBackup()).snapshots).toHaveLength(1);
  });

  it('discards a preview without creating history', async () => {
    await openApp();
    select(/Choose a ZIP/, [json([record('sample_a')], 'followers_1.json')]);
    await screen.findByLabelText('Your Instagram username');
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }));
    expect(screen.queryByLabelText('Your Instagram username')).toBeNull();
    expect((await db.readBackup()).snapshots).toHaveLength(0);
  });

  it('keeps unconfirmed and missing lists distinct when saving', async () => {
    await openApp();
    select(/Choose a ZIP/, [json([], 'followers_1.json')]);
    await screen.findByLabelText('Your Instagram username');
    fireEvent.change(screen.getByLabelText('Your Instagram username'), { target: { value: 'sample_owner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }));
    await screen.findByText('Snapshot saved on this device.');
    expect((await db.readBackup()).snapshots[0]).toMatchObject({ coverage: { followers: 'uncertain', following: 'missing' }, isPartial: true });
  });

  it('validates a backup before replacement, and cancellation keeps current history', async () => {
    await db.initDB();
    const original = await fixture('original');
    await db.saveSnapshotWithUsers(original.snapshot, original.users);
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const replacement = await fixture('replacement');
    const backupFile = json(createBackup([replacement.snapshot], replacement.users), 'backup.json');
    select(/Choose backup file/, [backupFile]);
    await screen.findByRole('dialog', { name: 'Replace local history with this backup?' });
    expect((await db.readBackup()).snapshots[0].id).toBe('original');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((await db.readBackup()).snapshots[0].id).toBe('original');
    select(/Choose backup file/, [backupFile]);
    await screen.findByRole('dialog', { name: 'Replace local history with this backup?' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Backup restored.');
    expect((await db.readBackup()).snapshots.map(s => s.id)).toEqual(['replacement']);
  });

  it('rejects a malformed backup without opening a destructive confirmation', async () => {
    await db.initDB();
    const original = await fixture('original');
    await db.saveSnapshotWithUsers(original.snapshot, original.users);
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    select(/Choose backup file/, [json({ snapshots: [{}], users: [] }, 'bad.json')]);
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await db.readBackup()).snapshots.map(s => s.id)).toEqual(['original']);
  });
});
