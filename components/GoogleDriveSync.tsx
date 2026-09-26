import React from 'react';

// Cloud sync is intentionally inactive in the local-only release.
// Existing local history and downloadable backups are managed in Settings.
export const GoogleDriveSync: React.FC = () => (
  <p className="text-sm text-gray-600 dark:text-gray-300">Use a local JSON backup to transfer your history between browsers or devices.</p>
);
