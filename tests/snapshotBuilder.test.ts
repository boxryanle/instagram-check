import { afterEach, describe, expect, it, vi } from 'vitest';
import Papa from 'papaparse';
import type { ImportContext, ProcessedFileData, RelationshipRole, User } from '../types';
import { buildSnapshot } from '../utils/snapshotBuilder';
import { csvCell, exportAsCSV } from '../utils/fileUtils';

const NOW = '2026-09-26T12:00:00.000Z';
const context: ImportContext = { accountUsername: 'sample_owner', confirmedComplete: true };
const file = (role: RelationshipRole, people: [string, string, string?][] = [], overrides: Partial<ProcessedFileData> = {}): ProcessedFileData => ({
  role,
  source: 'csv',
  users: new Map(people.map(([id, username, fullName]) => [id, { username, fullName: fullName || null }])),
  followers: new Set(role === 'followers' ? people.map(([id]) => id) : []),
  following: new Set(role === 'following' ? people.map(([id]) => id) : []),
  coverage: { followers: role === 'followers' ? 'complete' : 'missing', following: role === 'following' ? 'complete' : 'missing' },
  fileInfo: { name: `${role}.csv`, size: 100, hash: `synthetic-${role}-hash` },
  rowCount: people.length,
  hasIds: people.length > 0 && people.every(([id]) => /^\d+$/.test(id)),
  warnings: [],
  ...overrides,
});
const build = (files: ProcessedFileData[], inputContext = context, users: User[] = []) => buildSnapshot(files, inputContext, users, NOW, '00000000-0000-4000-8000-000000000001');
const oldUser = (): User => ({ id: '101', currentUsername: 'sample_old', usernames: ['sample_old'], fullNames: ['Synthetic Original'], firstSeenAt: '2026-09-01T12:00:00.000Z', lastSeenAt: '2026-09-20T12:00:00.000Z' });

describe('snapshot preparation', () => {
  it('unifies an unambiguous numeric and username-only identity within an import', () => {
    const result = build([file('followers', [['hash-sample-a', 'sample_a']]), file('following', [['900719925474099312345', 'sample_a']])]);
    expect(result.snapshot.data.followersById).toEqual(['900719925474099312345']);
    expect(result.snapshot.data.followingById).toEqual(['900719925474099312345']);
    expect(result.snapshot.data.followersUsernames).toEqual(['sample_a']);
    expect(result.users).toHaveLength(1);
    expect(result.snapshot.meta.hasIds).toBe(true);
    expect(result.snapshot.meta.parseWarnings.join(' ')).toMatch(/matched by username/);
  });

  it('makes the same identity choice regardless of which format appears first', () => {
    const files = [file('followers', [['101', 'sample_a']]), file('following', [['hash-sample-a', 'sample_a']])];
    const original = structuredClone(files);
    const forward = build(files);
    const reverse = build([...files].reverse());
    expect(reverse.snapshot.data).toEqual(forward.snapshot.data);
    expect(files).toEqual(original);
  });

  it('rejects two stable IDs for one username without merging either identity', () => {
    expect(() => build([file('followers', [['101', 'sample_a']]), file('following', [['102', 'sample_a']])])).toThrow(/conflicting account identities/);
  });

  it('rejects one source ID with conflicting usernames', () => {
    expect(() => build([file('followers', [['101', 'sample_a']]), file('following', [['101', 'sample_b']])])).toThrow(/conflicting usernames/);
  });

  it('normalizes a supplied owner handle and keeps capture time separate from import time', () => {
    const result = build([file('followers')], { accountUsername: '  @Sample.Owner  ', capturedAt: '2026-09-24T08:00:00.000Z', confirmedComplete: true });
    expect(result.snapshot.accountUsername).toBe('sample.owner');
    expect(result.snapshot.capturedAt).toBe('2026-09-24T08:00:00.000Z');
    expect(result.snapshot.createdAt).toBe(NOW);
  });

  it.each(['', '@', 'with space', 'https://instagram.com/sample_owner', 'a'.repeat(31), '.', '.owner', 'owner.', 'owner..name'])('rejects invalid owner handle %j before constructing a snapshot', accountUsername => {
    expect(() => build([file('followers')], { ...context, accountUsername })).toThrow(/valid account username/);
  });

  it.each(['invalid date', '2027-01-01T00:00:00.000Z'])('rejects invalid or future export date %s', capturedAt => {
    expect(() => build([file('followers')], { ...context, capturedAt })).toThrow(/export date/);
  });

  it('retains explicitly empty lists as complete when the owner confirms them', () => {
    const result = build([file('followers'), file('following')]);
    expect(result.snapshot.coverage).toEqual({ followers: 'complete', following: 'complete' });
    expect(result.snapshot.isPartial).toBe(false);
    expect(result.snapshot.meta.rowCount).toEqual({ followers: 0, following: 0 });
    expect(result.snapshot.meta.files.map(entry => entry.role).sort()).toEqual(['followers', 'following']);
  });

  it('never turns an absent list into a confirmed zero', () => {
    const result = build([file('followers', [['101', 'sample_a']])]);
    expect(result.snapshot.coverage).toEqual({ followers: 'complete', following: 'missing' });
    expect(result.snapshot.isPartial).toBe(true);
    expect(result.snapshot.meta.files).toHaveLength(1);
  });

  it('uses coverage rather than a combined label to preserve missing-list evidence', () => {
    const result = build([file('followers', [['101', 'sample_a']], { role: 'combined' })]);
    expect(result.snapshot.coverage?.following).toBe('missing');
    expect(result.snapshot.meta.files).toHaveLength(1);
  });

  it('withholds complete status before confirmation, including explicitly empty lists', () => {
    const result = build([file('followers'), file('following')], { ...context, confirmedComplete: false });
    expect(result.snapshot.coverage).toEqual({ followers: 'uncertain', following: 'uncertain' });
    expect(result.snapshot.isPartial).toBe(true);
  });

  it('cannot override uncertain source coverage merely by confirming the import', () => {
    const result = build([
      file('followers', [['101', 'sample_a']], { coverage: { followers: 'uncertain', following: 'missing' } }),
      file('followers', [['102', 'sample_b']]),
      file('following'),
    ]);
    expect(result.snapshot.coverage).toEqual({ followers: 'uncertain', following: 'complete' });
    expect(result.snapshot.data.followersById).toEqual(['101', '102']);
  });

  it('unions all parts, counts unique relationships, and deduplicates repeated warnings', () => {
    const result = build([
      file('followers', [['101', 'sample_a']], { warnings: ['Synthetic warning'] }),
      file('followers', [['101', 'sample_a'], ['102', 'sample_b']], { warnings: ['Synthetic warning'] }),
    ]);
    expect(result.snapshot.data.followersById).toEqual(['101', '102']);
    expect(result.snapshot.meta.rowCount.followers).toBe(2);
    expect(result.snapshot.meta.parseWarnings).toEqual(['Synthetic warning']);
  });

  it('prepares independent user histories without changing the prior state before commit', () => {
    const previous = [oldUser()];
    const original = structuredClone(previous);
    Object.freeze(previous[0].usernames);
    Object.freeze(previous[0].fullNames);
    Object.freeze(previous[0]);
    Object.freeze(previous);
    const result = build([file('followers', [['101', 'sample_new', 'Synthetic Updated']])], context, previous);
    expect(previous).toEqual(original);
    expect(result.users[0]).not.toBe(previous[0]);
    expect(result.users[0].usernames).toEqual(['sample_old', 'sample_new']);
    expect(result.users[0].fullNames).toEqual(['Synthetic Original', 'Synthetic Updated']);
    expect(result.users[0].firstSeenAt).toBe(original[0].firstSeenAt);
    expect(result.users[0].lastSeenAt).toBe(NOW);
    result.users[0].usernames.push('synthetic_later');
    expect(previous).toEqual(original);
  });

  it('leaves all source files and user records untouched when validation fails late', () => {
    const previous = [oldUser()];
    const files = [file('followers', [['101', 'sample_new']]), file('following', [], { following: new Set(['missing-identity']) })];
    const original = structuredClone({ previous, files });
    expect(() => build(files, context, previous)).toThrow(/no matching identity/);
    expect({ previous, files }).toEqual(original);
  });

  it('requires input and rejects unknown roles before a snapshot can be committed', () => {
    expect(() => build([])).toThrow(/at least one/);
    expect(() => build([file('followers', [], { role: 'unknown' })])).toThrow(/unknown relationship type/);
  });
});

describe('CSV export safety', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '\t=1+1', '\r=1+1', '\n=1+1'])('treats formula/control-prefixed content as text: %j', value => {
    const decoded = Papa.parse<string[]>(csvCell(value)).data[0][0];
    expect(decoded).toBe(`'${value}`);
  });

  it.each(['sample_a', 'Synthetic, Example', 'Synthetic "Quoted" Example', 'Synthetic\nMultiline', ''])('preserves benign data and quotes every cell correctly: %j', value => {
    expect(csvCell(value).startsWith('"')).toBe(true);
    expect(csvCell(value).endsWith('"')).toBe(true);
    expect(Papa.parse<string[]>(csvCell(value)).data).toEqual([[value]]);
  });

  it('keeps an attempted delimiter/quote breakout within a single text cell', () => {
    const value = 'Synthetic",=HYPERLINK("https://example.invalid")';
    const result = Papa.parse<string[]>(`${csvCell(value)},${csvCell('sample_b')}`);
    expect(result.data).toEqual([[value, 'sample_b']]);
    expect(result.errors).toEqual([]);
  });

  it('escapes headers and rows in the downloaded CSV, then revokes the object URL', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-export');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { appendChild } });
    exportAsCSV({ headers: ['=header', 'full_name'], rows: [['@sample', 'Synthetic, "Example"\nSecond line']] }, 'synthetic-export.csv');
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8;');
    const content = await blob.text();
    expect(Papa.parse<string[]>(content).data).toEqual([["'=header", 'full_name'], ["'@sample", 'Synthetic, "Example"\nSecond line']]);
    expect(content).toContain('\r\n');
    expect(link.download).toBe('synthetic-export.csv');
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-export');
  });
});
