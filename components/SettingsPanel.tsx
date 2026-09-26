import React, { useRef } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { GoogleDriveSync } from './GoogleDriveSync';

interface SettingsPanelProps {
  onClearAll: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onRestoreComplete: () => void;
  showModal: (title: string, body: string, onConfirm: () => void) => void;
  closeModal: () => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClearAll, onExport, onImport, onRestoreComplete, showModal, closeModal, onShowToast }) => {
    const importRef = useRef<HTMLInputElement>(null);

    const handleImportClick = () => {
        importRef.current?.click();
    };

    const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onImport(file);
        }
        e.target.value = '';
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <Card title="Data Management" icon={<Icon name="edit" />}>
                <div className="space-y-6">
                    <div className="p-4 border dark:border-gray-700 rounded-md">
                        <h4 className="font-semibold">Cloud Backup (Google Drive)</h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                            Securely back up and restore your data using your Google Drive account.
                            The app will only have access to the backup file it creates.
                        </p>
                        <GoogleDriveSync 
                            onRestoreComplete={onRestoreComplete}
                            showModal={showModal}
                            closeModal={closeModal}
                            onShowToast={onShowToast}
                        />
                    </div>

                    <div className="p-4 border dark:border-gray-700 rounded-md">
                        <h4 className="font-semibold">Local Backup</h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Save a local backup of all your snapshots and user data, or import a previous backup.</p>
                        <div className="flex gap-2 flex-wrap">
                            <input type="file" ref={importRef} className="hidden" accept=".json" onChange={handleFileImport} />
                            <Button onClick={handleImportClick} variant="secondary">
                                <Icon name="upload" className="w-4 h-4 mr-2" />
                                Import Backup (.json)
                            </Button>
                            <Button onClick={onExport} variant="secondary">
                                <Icon name="download" className="w-4 h-4 mr-2" />
                                Export Backup (.json)
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>

            <Card>
                <div className="p-4 border border-red-500/50 dark:border-red-500/30 rounded-md">
                    <h4 className="font-semibold text-red-700 dark:text-red-400">Danger Zone</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">This action will permanently delete all your data (snapshots and users) and cannot be undone.</p>
                    <Button onClick={onClearAll} variant="danger">
                        <Icon name="trash" className="w-4 h-4 mr-2"/>
                        Clear All Data
                    </Button>
                </div>
            </Card>
        </div>
    );
};