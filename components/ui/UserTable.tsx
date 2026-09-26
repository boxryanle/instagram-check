import React, { useState, useMemo } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { exportAsCSV, exportAsJSON } from '../../utils/fileUtils';
import { User } from '../../types';
import { Avatar } from './Avatar';

interface UserTableProps {
  title: string;
  userIds: string[];
  userMap: Map<string, User>;
  onCopy: (text: string) => void;
  badgeMap?: Record<string, string>;
  badgeTooltip?: string;
  usernameChanges?: Array<{ id: string, from: string, to: string }>;
}

const ITEMS_PER_PAGE = 10;

export const UserTable: React.FC<UserTableProps> = ({ title, userIds, userMap, onCopy, badgeMap = {}, badgeTooltip, usernameChanges = [] }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  const users = useMemo(() => {
      return userIds.map(id => userMap.get(id)).filter(Boolean) as User[];
  }, [userIds, userMap]);

  const filteredUsers = useMemo(() => {
    return users.filter(user => user.currentUsername.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [users, searchTerm]);

  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handleExportCSV = () => {
    exportAsCSV({ headers: ['id', 'username'], rows: filteredUsers.map(u => [u.id, u.currentUsername]) }, `${title.replace(/\s+/g, '_')}.csv`);
  };

  const handleExportJSON = () => {
    exportAsJSON(filteredUsers, `${title.replace(/\s+/g, '_')}.json`);
  };

  const handleCopy = () => {
    onCopy(filteredUsers.map(u => u.currentUsername).join('\n'));
  };

  if (userIds.length === 0 && !searchTerm) {
    return <p className="text-gray-500 dark:text-gray-400">No users to display.</p>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          placeholder="Search..."
          value={searchTerm}
          onChange={e => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          className="w-full sm:w-1/2 px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
        <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={handleCopy} title="Copy list to clipboard"><Icon name="copy" /></Button>
            <Button variant="secondary" onClick={handleExportCSV} title="Export as CSV"><Icon name="download" /> CSV</Button>
            <Button variant="secondary" onClick={handleExportJSON} title="Export as JSON"><Icon name="download" /> JSON</Button>
        </div>
      </div>
      
      {filteredUsers.length > 0 ? (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {paginatedUsers.map(user => {
                const usernameChange = usernameChanges.find(c => c.id === user.id);
                const usernameTitle = user.usernames.length > 1 ? `History: ${[...user.usernames].reverse().slice(1).join(', ')}` : user.currentUsername;
                return (
                    <li key={user.id} className="py-2 flex justify-between items-center">
                        <div className="flex items-center gap-3 min-w-0">
                            <Avatar userId={user.id} username={user.currentUsername} />
                            <div className="font-mono text-sm text-gray-700 dark:text-gray-300 truncate" title={usernameTitle}>
                                {user.currentUsername}
                            </div>
                            {badgeMap[user.id] && (
                                <span title={badgeTooltip} className="flex-shrink-0 px-2 py-0.5 text-xs font-semibold text-orange-800 bg-orange-100 rounded-full dark:bg-orange-900 dark:text-orange-200 cursor-default">
                                    {badgeMap[user.id]}
                                </span>
                            )}
                             {usernameChange && (
                                <span title={`Formerly: ${usernameChange.from}`} className="flex-shrink-0 px-2 py-0.5 text-xs font-semibold text-blue-800 bg-blue-100 rounded-full dark:bg-blue-900 dark:text-blue-200 cursor-default">
                                    name changed
                                </span>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
      ) : (
         <p className="text-gray-500 dark:text-gray-400">No matching users found.</p>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex justify-between items-center">
          <Button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
            Previous
          </Button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Page {currentPage} of {totalPages}
          </span>
          <Button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
};