
import { ProcessedFileData } from '../types';

export const calculateFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

export const textToHash = async (text: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const normalizeUsername = (username: string | undefined | null): string | null => {
  if (!username || typeof username !== 'string') return null;
  return username.trim().toLowerCase().replace(/^@/, '');
};

const detectDelimiter = (text: string): ',' | ';' => {
    const firstLine = text.slice(0, text.indexOf('\n'));
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    return semicolonCount > commaCount ? ';' : ',';
};

const detectRoleFromFilename = (fileName: string): 'followers' | 'following' | 'unknown' => {
    if (/follower/i.test(fileName)) return 'followers';
    if (/following/i.test(fileName)) return 'following';
    return 'unknown';
};

const ID_HEADER_ALIASES = ['user_id', 'id', 'pk', 'instagram_id'];
const USERNAME_HEADER_ALIASES = ['username', 'user name', 'handle', 'profile'];
const FULLNAME_HEADER_ALIASES = ['full_name', 'name'];

const processJSON = async (file: File, fileHash: string): Promise<ProcessedFileData> => {
    const text = await file.text();
    let data: any;
    const warnings: string[] = [];
    const followers = new Set<string>();
    const following = new Set<string>();
    const users = new Map<string, { username: string, fullName: string | null }>();
    let role: ProcessedFileData['role'] = 'unknown';
    let rowCount = 0;

    try {
        data = JSON.parse(text);
    } catch (e) {
        return { followers, following, users, warnings: ['Invalid JSON file.'], role: 'unknown', fileInfo: { name: file.name, size: file.size, hash: fileHash }, rowCount: 0, hasIds: false };
    }

    // 1. Handle Official Instagram Export (relationships_followers, relationships_following)
    // Structure: { relationships_followers: [ { string_list_data: [{ value: 'username', ... }] } ] }
    
    const processOfficialList = async (list: any[], listRole: 'followers' | 'following') => {
         for (const item of list) {
            // Sometimes the item is the data, sometimes it's wrapped
            const entry = item.string_list_data?.[0];
            if (entry && entry.value) {
                const username = normalizeUsername(entry.value);
                if (username) {
                    const id = await textToHash(username); // Official export usually lacks IDs in this specific JSON, mostly just usernames
                    if (!users.has(id)) {
                        users.set(id, { username, fullName: null });
                    }
                    if (listRole === 'followers') followers.add(id);
                    else following.add(id);
                    rowCount++;
                }
            }
        }
    };

    if (Array.isArray(data.relationships_followers)) {
        await processOfficialList(data.relationships_followers, 'followers');
        if (role === 'unknown') role = 'followers';
        else role = 'combined';
    }
    
    if (Array.isArray(data.relationships_following)) {
        await processOfficialList(data.relationships_following, 'following');
        if (role === 'unknown') role = 'following';
        else role = 'combined';
    }

    // 2. Handle "Fast Import" Script Format (Simple Arrays)
    // Structure: { followers: [{username: 'a', fullName: 'b'}], following: [...] }
    
    const processSimpleList = async (list: any[], listRole: 'followers' | 'following') => {
        for (const item of list) {
            const rawUsername = typeof item === 'string' ? item : item.username;
            const rawFullName = typeof item === 'object' ? item.fullName : null;
            const rawId = typeof item === 'object' ? item.id : null;

            const username = normalizeUsername(rawUsername);
            if (username) {
                const id = rawId || await textToHash(username);
                if (!users.has(id)) {
                    users.set(id, { username, fullName: rawFullName });
                }
                if (listRole === 'followers') followers.add(id);
                else following.add(id);
                rowCount++;
            }
        }
    }

    if (Array.isArray(data.followers)) {
        await processSimpleList(data.followers, 'followers');
        if (role === 'unknown') role = 'followers';
        else role = 'combined';
    }

    if (Array.isArray(data.following)) {
        await processSimpleList(data.following, 'following');
        if (role === 'unknown') role = 'following';
        else role = 'combined';
    }

    // Fallback detection by filename if parsing didn't strictly identify role but we have a simple list
    if (role === 'unknown') {
         const detectedRole = detectRoleFromFilename(file.name);
         // If it's a simple array of strings/objects and we know the role from filename
         if (Array.isArray(data) && detectedRole !== 'unknown') {
             await processSimpleList(data, detectedRole);
             role = detectedRole;
         }
    }

    if (rowCount === 0) {
        warnings.push('No recognized user data found in JSON.');
    }

    return {
        followers,
        following,
        users,
        warnings,
        role,
        fileInfo: { name: file.name, size: file.size, hash: fileHash },
        rowCount,
        hasIds: false // JSON exports usually don't expose the internal ID easily unless scraped
    };
}

export const processAndParseFile = async (file: File): Promise<ProcessedFileData> => {
  const fileHash = await calculateFileHash(file);
  
  if (file.name.endsWith('.json')) {
      return processJSON(file, fileHash);
  }

  // CSV Processing logic
  const fileContent = await file.text();
  const followers = new Set<string>();
  const following = new Set<string>();
  const users = new Map<string, { username: string, fullName: string | null }>();
  const warnings: string[] = [];

  const role = detectRoleFromFilename(file.name);
  let finalRole: ProcessedFileData['role'] = role === 'unknown' ? 'combined' : role;

  const delimiter = detectDelimiter(fileContent);
  const rows = fileContent.split('\n').map(row => row.trim());

  if (rows.length < 2) {
    return { followers, following, users, warnings: ['CSV is empty or has only a header.'], role: 'unknown', fileInfo: { name: file.name, size: file.size, hash: fileHash }, rowCount: 0, hasIds: false };
  }
  
  const header = rows[0].toLowerCase().split(delimiter).map(h => h.trim().replace(/"/g, ''));
  const dataRows = rows.slice(1);
  let rowCount = 0;
  
  const idIndex = header.findIndex(h => ID_HEADER_ALIASES.includes(h));
  const usernameIndex = header.findIndex(h => USERNAME_HEADER_ALIASES.includes(h));
  const fullNameIndex = header.findIndex(h => FULLNAME_HEADER_ALIASES.includes(h));
  const listTypeIndex = header.indexOf('list_type');
  
  const hasIds = idIndex !== -1;

  if (usernameIndex === -1) {
    warnings.push('Could not find a valid username column (e.g., "username", "profile").');
    finalRole = 'unknown';
  } else {
    for (const [i, row] of dataRows.entries()) {
        if (!row) continue;
        rowCount++;
        
        const cells = row.split(delimiter);
        const username = normalizeUsername(cells[usernameIndex]);
        if (!username) {
            warnings.push(`Row ${i + 2}: Username is empty.`);
            continue;
        }

        const id = hasIds ? cells[idIndex]?.trim() : await textToHash(username);
        const fullName = fullNameIndex !== -1 ? cells[fullNameIndex]?.trim().replace(/"/g, '') || null : null;

        if (!users.has(id)) {
            users.set(id, { username, fullName });
        }

        let currentRole = finalRole;
        if (listTypeIndex !== -1) { // Long format
            finalRole = 'combined';
            const listType = cells[listTypeIndex]?.toLowerCase().trim();
            if (listType === 'follower') currentRole = 'followers';
            else if (listType === 'following') currentRole = 'following';
            else {
                warnings.push(`Row ${i + 2}: Invalid list_type "${listType}" for user ${username}.`);
                continue;
            }
        }

        if (currentRole === 'followers') {
            if (followers.has(id)) warnings.push(`Duplicate follower found: ${username}`);
            followers.add(id);
        } else if (currentRole === 'following') {
            if (following.has(id)) warnings.push(`Duplicate following found: ${username}`);
            following.add(id);
        }
    }
  }

  if (role === 'unknown' && listTypeIndex === -1) {
     warnings.push('File is not named "followers" or "following" and has no "list_type" column. Could not determine role.');
     finalRole = 'unknown';
  }
  
  return { followers, following, users, warnings, role: finalRole, fileInfo: { name: file.name, size: file.size, hash: fileHash }, rowCount, hasIds };
};
