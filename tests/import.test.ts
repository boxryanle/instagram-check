import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { MAX_LIST_FILE_BYTES, normalizeUsername, processAndParseFile, textToHash } from '../utils/csvParser';
import { IMPORT_LIMITS, processImportFiles } from '../utils/importArchive';

const json = (data: unknown, name = 'followers.json') => new File([JSON.stringify(data)], name, { type: 'application/json' });
const csv = (text: string, name = 'followers.csv') => new File([text], name, { type: 'text/csv' });
const official = (username: string) => ({ title: '', media_list_data: [], string_list_data: [{ value: username, href: `https://www.instagram.com/${username}`, timestamp: 1_700_000_000 }] });
const archive = (entries: Record<string, unknown>, options: { level?: 0 | 6 } = {}) => {
  const data = zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(typeof value === 'string' ? value : JSON.stringify(value))])), options);
  return new File([data.buffer as ArrayBuffer], 'instagram-export.zip', { type: 'application/zip' });
};
const names = (result: Awaited<ReturnType<typeof processAndParseFile>>, role: 'followers' | 'following') => [...result[role]].map(id => result.users.get(id)!.username).sort();
const patchZip = async (file: File, mutate: (data: Uint8Array, central: number, local: number) => void) => {
  const data = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(data.buffer);
  const central = view.getUint32(data.length - 22 + 16, true);
  const local = view.getUint32(central + 42, true);
  mutate(data, central, local);
  return new File([data.buffer], 'patched.zip');
};

describe('Instagram and simple JSON imports', () => {
  it('reads the official top-level follower array and normalizes usernames', async () => {
    const result = await processAndParseFile(json([official('Sample.A')], 'followers_1.JSON'));
    expect(names(result, 'followers')).toEqual(['sample.a']);
    expect(result.coverage).toEqual({ followers: 'complete', following: 'missing' });
    expect(result.source).toBe('instagram-json');
    expect(result.hasIds).toBe(false);
    expect(result.followers.has(await textToHash('sample.a'))).toBe(true);
  });

  it('reads official wrapped lists including following title fallback', async () => {
    const result = await processAndParseFile(json({
      relationships_followers: [official('sample_a')],
      relationships_following: [{ title: 'Sample_B', string_list_data: [{ href: 'https://www.instagram.com/_u/sample_b/' }] }],
    }, 'relationships.json'));
    expect(result.role).toBe('combined');
    expect(names(result, 'following')).toEqual(['sample_b']);
    expect(result.coverage).toEqual({ followers: 'complete', following: 'complete' });
  });

  it('distinguishes an explicitly empty list from a missing list', async () => {
    const empty = await processAndParseFile(json([]));
    const combined = await processAndParseFile(json({ followers: [], following: [] }, 'lists.json'));
    expect(empty.role).toBe('followers');
    expect(empty.followers.size).toBe(0);
    expect(empty.coverage?.following).toBe('missing');
    expect(combined.coverage).toEqual({ followers: 'complete', following: 'complete' });
    await expect(processAndParseFile(json({}))).rejects.toThrow('No followers');
  });

  it('reads simple strings and objects, normalizing numeric/string stable IDs', async () => {
    const result = await processAndParseFile(json({ followers: [{ username: '@SAMPLE_A', id: 42 }, { username: 'sample_b', id: '000123' }], following: [{ username: 'sample_a', id: '42' }] }, 'lists.json'));
    expect([...result.followers]).toEqual(['42', '123']);
    expect([...result.following]).toEqual(['42']);
    expect(result.hasIds).toBe(true);
  });

  it('deduplicates normalized usernames and emits aggregate warnings', async () => {
    const result = await processAndParseFile(json(['sample_a', '@SAMPLE_A', { username: 'sample_b' }]));
    expect(result.followers.size).toBe(2);
    expect(result.rowCount).toBe(3);
    expect(result.warnings).toContain('Removed 1 duplicate relationship row(s).');
  });

  it('marks mixed stable/synthetic identity data conservatively', async () => {
    const result = await processAndParseFile(json([{ username: 'sample_a', id: '42' }, 'sample_b']));
    expect(result.hasIds).toBe(false);
    expect(result.warnings.join(' ')).toContain('lack stable IDs');
  });

  it.each([
    null, 2, 'not an export', { followers: null }, { followers: {} }, [null], [{}], ['bad/name'],
    [{ username: 'valid_name', id: 9007199254740992 }],
    [{ string_list_data: [] }],
    [{ string_list_data: [{ value: 'sample_a', href: 'https://evil.example/sample_a' }] }],
    [{ string_list_data: [{ value: 'sample_a', href: 'https://www.instagram.com/sample_b' }] }],
    { relationships_followers: [], followers: [] },
    { relationships_follow_requests_sent: [] },
  ])('rejects malformed or unrelated JSON rather than creating empty relationships: %j', async value => {
    await expect(processAndParseFile(json(value))).rejects.toThrow();
  });

  it('rejects ambiguous roles, identity conflicts, and incomplete official records', async () => {
    await expect(processAndParseFile(json([], 'unknown.json'))).rejects.toThrow('role is unambiguous');
    await expect(processAndParseFile(json({ following: [] }))).rejects.toThrow('disagree');
    await expect(processAndParseFile(json([{ username: 'sample_a', id: '1' }, { username: 'sample_a', id: '2' }]))).rejects.toThrow('conflicting IDs');
    await expect(processAndParseFile(json([{ username: 'sample_a', id: '1' }, { username: 'sample_b', id: '1' }]))).rejects.toThrow('conflicting usernames');
    await expect(processAndParseFile(json([{ title: 'sample_a', string_list_data: [{}] }]))).rejects.toThrow('missing or invalid');
  });

  it('rejects invalid JSON, zero bytes, HTML, and invalid UTF-8', async () => {
    await expect(processAndParseFile(new File(['{'], 'followers.json'))).rejects.toThrow('Invalid JSON');
    await expect(processAndParseFile(new File([], 'followers.json'))).rejects.toThrow('empty');
    await expect(processAndParseFile(new File(['<html>'], 'followers.html'))).rejects.toThrow('JSON format');
    await expect(processAndParseFile(new File(['<html>'], 'followers.json'))).rejects.toThrow('HTML');
    await expect(processAndParseFile(new File([new Uint8Array([0xff])], 'followers.json'))).rejects.toThrow('UTF-8');
  });

  it.each(['', '.', '.sample', 'sample.', 'sample..a', 'bad name', 'bad/name', 'https://instagram.com/a', '@@sample', 'a'.repeat(31), '\u0000sample'])('rejects invalid username %j', value => {
    expect(normalizeUsername(value)).toBeNull();
  });
});

describe('CSV imports', () => {
  it('parses quoted commas, escaped quotes, and multiline names without splitting records', async () => {
    const result = await processAndParseFile(csv('username,full_name,id\r\n"sample_a","Synthetic, \"\"Example\"\"\nSecond line",900719925474099312345\r\n'));
    expect([...result.followers]).toEqual(['900719925474099312345']);
    expect(result.users.get('900719925474099312345')?.fullName).toBe('Synthetic, "Example"\nSecond line');
    expect(result.hasIds).toBe(true);
  });

  it('parses semicolon-delimited and one-column CSV', async () => {
    const semicolon = await processAndParseFile(csv('username;full_name;id\nsample_a;"Synthetic; Example";42'));
    const single = await processAndParseFile(csv('username\nsample_b'));
    expect(semicolon.users.get('42')?.fullName).toBe('Synthetic; Example');
    expect(names(single, 'followers')).toEqual(['sample_b']);
  });

  it('preserves a missing list in combined long-form CSV', async () => {
    const result = await processAndParseFile(csv('username,list_type\nsample_a,following', 'snapshot.csv'));
    expect(result.coverage).toEqual({ followers: 'missing', following: 'complete' });
  });

  it('retains existing combined demo support', async () => {
    const result = await processAndParseFile(csv('username,full_name,list_type\nsample_a,,follower\nsample_b,,following', 'demo.csv'));
    expect(result.role).toBe('combined');
    expect(result.followers.size).toBe(1);
    expect(result.following.size).toBe(1);
  });

  it.each([
    'username\n', 'name\nExample', 'username,id\nsample_a,1,extra', 'username,username\nsample_a,sample_b',
    'username,name\nsample_a,"unterminated', 'username\nbad/name', 'username,list_type\nsample_a,pending',
    'username,id\nsample_a,1e30', 'username,list_type\nsample_a,following',
  ])('rejects malformed CSV or uncertain empty data: %s', async content => {
    await expect(processAndParseFile(csv(content))).rejects.toThrow();
  });
});

describe('ZIP and multipart import', () => {
  it('reads only follower/following parts and leaves unrelated information unparsed', async () => {
    const results = await processImportFiles([archive({
      'connections/followers_and_following/followers_1.json': [official('sample_a')],
      'connections/followers_and_following/followers_2.json': [official('sample_b')],
      'connections/followers_and_following/following.json': { relationships_following: [official('sample_b')] },
      'connections/followers_and_following/close_friends.json': 'intentionally invalid, ignored',
      'connections/followers_and_following/pending_follow_requests.json': 'ignored',
      'messages/inbox/example/message_1.json': 'ignored',
    })]);
    expect(results).toHaveLength(3);
    expect(new Set(results.flatMap(result => names(result, 'followers')))).toEqual(new Set(['sample_a', 'sample_b']));
    expect(results.flatMap(result => names(result, 'following'))).toEqual(['sample_b']);
  });

  it('supports stored ZIP files and explicit empty official lists', async () => {
    const results = await processImportFiles([archive({ 'followers.json': [], 'following.json': { relationships_following: [] } }, { level: 0 })]);
    expect(results.map(result => result.role)).toEqual(['followers', 'following']);
    expect(results.every(result => result.rowCount === 0)).toBe(true);
  });

  it('rejects missing, duplicate, overlapping, and mixed-source parts', async () => {
    await expect(processImportFiles([json([], 'followers_2.json')])).rejects.toThrow('Missing or duplicate');
    await expect(processImportFiles([json([], 'followers_1.json'), json([], 'followers_3.json')])).rejects.toThrow('Missing or duplicate');
    await expect(processImportFiles([json([]), json([], 'followers_1.json')])).rejects.toThrow('Overlapping');
    await expect(processImportFiles([json([]), json([])])).rejects.toThrow('Duplicate');
    await expect(processImportFiles([archive({ 'followers.json': [] }), json([])])).rejects.toThrow('Do not mix');
    await expect(processImportFiles([archive({ 'a/followers.json': [], 'b/following.json': [] })])).rejects.toThrow('multiple folders');
  });

  it('rejects overlapping combined snapshots even when one export explicitly empties the list', async () => {
    await expect(processImportFiles([
      json({ followers: ['sample_a'], following: [] }, 'older.json'),
      json({ followers: [], following: [] }, 'newer.json'),
    ])).rejects.toThrow('Overlapping followers inputs');
  });

  it('rejects combined/general inputs overlapping role-specific data', async () => {
    await expect(processImportFiles([
      json({ followers: ['sample_a'], following: [] }, 'snapshot.json'),
      json(['sample_b'], 'followers_1.json'),
    ])).rejects.toThrow('Overlapping followers inputs');
    await expect(processImportFiles([
      csv('username,list_type\nsample_a,follower', 'first.csv'),
      csv('username,list_type\nsample_b,follower', 'second.csv'),
    ])).rejects.toThrow('Overlapping followers inputs');
  });

  it('allows disjoint explicit list roles from arbitrarily named CSV files', async () => {
    const result = await processImportFiles([
      csv('username,list_type\nsample_a,follower', 'export_a.csv'),
      csv('username,list_type\nsample_b,following', 'export_b.csv'),
    ]);
    expect(result.map(item => item.role)).toEqual(['followers', 'following']);
  });

  it('does not accept combined containers masquerading as numbered same-role parts', async () => {
    await expect(processImportFiles([
      json({ followers: ['sample_a'], following: [] }, 'followers_1.json'),
      json(['sample_b'], 'followers_2.json'),
    ])).rejects.toThrow('Overlapping followers inputs');
  });

  it.each(['../followers.json', '/followers.json', 'a/../followers.json', 'a\\followers.json', 'C:/followers.json', 'a//followers.json'])('rejects unsafe archive path %s', async path => {
    await expect(processImportFiles([archive({ [path]: [] })])).rejects.toThrow('unsafe path');
  });

  it('rejects a corrupt CRC, fake ZIP, and HTML archive', async () => {
    const corrupt = await patchZip(archive({ 'followers.json': [] }, { level: 0 }), (data, central, local) => {
      const view = new DataView(data.buffer);
      data[local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)] ^= 1;
    });
    await expect(processImportFiles([corrupt])).rejects.toThrow('integrity');
    await expect(processImportFiles([new File(['not zip'], 'fake.zip')])).rejects.toThrow('Invalid');
    await expect(processImportFiles([archive({ 'followers.html': '<html>' })])).rejects.toThrow('JSON format');
  });

  it('rejects archives with no supported lists or case-colliding paths', async () => {
    await expect(processImportFiles([archive({ 'pending_follow_requests.json': [] })])).rejects.toThrow('No followers');
    await expect(processImportFiles([archive({ 'followers.json': [], 'FOLLOWERS.JSON': [] })])).rejects.toThrow('duplicate paths');
  });

  it('checks declared decompression size before allocating a file buffer', async () => {
    const oversized = await patchZip(archive({ 'followers.json': [] }), (data, central, local) => {
      const view = new DataView(data.buffer);
      view.setUint32(central + 24, MAX_LIST_FILE_BYTES + 1, true);
      view.setUint32(local + 22, MAX_LIST_FILE_BYTES + 1, true);
    });
    await expect(processImportFiles([oversized])).rejects.toThrow('20 MiB');
  });

  it('rejects deflated data larger than its dishonest size metadata', async () => {
    const deceptive = await patchZip(archive({ 'followers.json': 'x'.repeat(100_000) }), (data, central, local) => {
      const view = new DataView(data.buffer);
      view.setUint32(central + 24, 2, true);
      view.setUint32(local + 22, 2, true);
    });
    await expect(processImportFiles([deceptive])).rejects.toThrow('decompressed data exceeds');
  });

  it('bounds input size, file count, and archive entry count', async () => {
    const oversized = json([]);
    Object.defineProperty(oversized, 'size', { value: IMPORT_LIMITS.inputBytes + 1 });
    await expect(processImportFiles([oversized])).rejects.toThrow('50 MiB');
    const tooMany = Array.from({ length: IMPORT_LIMITS.relationshipFiles + 1 }, (_, index) => json([], `followers_${index + 1}.json`));
    await expect(processImportFiles(tooMany)).rejects.toThrow('Too many input files');
    const manyEntries = archive(Object.fromEntries(Array.from({ length: IMPORT_LIMITS.archiveEntries + 1 }, (_, index) => [`other_${index}.json`, []])));
    await expect(processImportFiles([manyEntries])).rejects.toThrow('too many entries');
  });

  it('requires at least one file and does not report success for unsupported inputs', async () => {
    await expect(processImportFiles([])).rejects.toThrow('Choose');
    await expect(processImportFiles([new File(['data'], 'followers.txt')])).rejects.toThrow('Choose a JSON');
  });
});
