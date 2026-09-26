import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { Spinner } from './ui/Spinner';
import * as db from '../services/db';

declare const window: any;
declare const google: any;
declare const gapi: any;

// These credentials must be configured in your Google Cloud project.
// For security, they should be stored as environment variables.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'YOUR_GOOGLE_API_KEY';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FILE_NAME = 'insta-tracker-backup.json';
const BACKUP_FILE_MIME_TYPE = 'application/json';

interface GoogleDriveSyncProps {
  onRestoreComplete: () => void;
  showModal: (title: string, body: string, onConfirm: () => void) => void;
  closeModal: () => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
}

export const GoogleDriveSync: React.FC<GoogleDriveSyncProps> = ({ onRestoreComplete, showModal, closeModal, onShowToast }) => {
  const [isGapiReady, setIsGapiReady] = useState(false);
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [gapiToken, setGapiToken] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(null);

  const getBackupFileId = useCallback(async (): Promise<string | null> => {
    try {
        const response = await gapi.client.drive.files.list({
            q: `name='${BACKUP_FILE_NAME}' and mimeType='${BACKUP_FILE_MIME_TYPE}' and trashed=false`,
            spaces: 'drive',
            fields: 'files(id, modifiedTime)',
        });
        const file = response.result.files?.[0];
        if (file) {
            setLastBackupTime(new Date(file.modifiedTime).toLocaleString());
            return file.id;
        }
        return null;
    } catch (e) {
        console.error('Error finding backup file:', e);
        onShowToast('Could not access Google Drive.', 'error');
        return null;
    }
  }, [onShowToast]);
  
  const handleAuthResponse = useCallback(async (tokenResponse: any) => {
    if (tokenResponse.error) {
        console.error('Google Auth Error:', tokenResponse.error);
        onShowToast('Authentication failed.', 'error');
        return;
    }
    setGapiToken(tokenResponse);
    gapi.client.setToken(tokenResponse);
    try {
        const profile = await gapi.client.oauth2.userinfo.get();
        setUser(profile.result);
        await getBackupFileId();
    } catch (e) {
        console.error("Error fetching user profile", e);
    }
  }, [onShowToast, getBackupFileId]);

  const initGapiClient = useCallback(async () => {
    await gapi.client.init({ apiKey: GOOGLE_API_KEY, discoveryDocs: [DISCOVERY_DOC] });
    setIsGapiReady(true);
  }, []);

  const initGisClient = useCallback(() => {
    try {
        const client = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: handleAuthResponse,
        });
        setTokenClient(client);
    } catch (e) {
        console.error("Error initializing GIS client", e);
    }
  }, [handleAuthResponse]);

  useEffect(() => {
    if (window.gapi) {
        gapi.load('client:oauth2', initGapiClient);
    }
    if (window.google) {
        initGisClient();
    }
  }, [initGapiClient, initGisClient]);


  const handleAuthClick = () => {
    if (tokenClient) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    }
  };

  const handleSignoutClick = () => {
    if(gapiToken) {
        google.accounts.oauth2.revoke(gapiToken.access_token, () => {});
        gapi.client.setToken(null);
    }
    setGapiToken(null);
    setUser(null);
    setLastBackupTime(null);
  };

  const handleBackup = async () => {
    setIsBusy(true);
    try {
      const [users, snapshots] = await Promise.all([db.getAllUsers(), db.getAllSnapshots()]);
      const backupData = { users, snapshots, savedAt: new Date().toISOString() };
      const backupContent = JSON.stringify(backupData);
      
      const fileId = await getBackupFileId();

      const metadata = { name: BACKUP_FILE_NAME, mimeType: BACKUP_FILE_MIME_TYPE };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', new Blob([backupContent], { type: 'application/json' }));

      const uploadUrl = fileId 
          ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
          : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
      const method = fileId ? 'PATCH' : 'POST';
      
      const response = await gapi.client.request({ path: uploadUrl, method, body: form });
      setLastBackupTime(new Date(response.result.modifiedTime).toLocaleString());
      onShowToast('Backup successful!', 'success');
    } catch (e: any) {
        console.error('Backup failed:', e);
        onShowToast(`Backup failed: ${e.result?.error?.message || e.message}`, 'error');
    } finally {
        setIsBusy(false);
    }
  };
  
  const handleRestore = () => {
    showModal('Restore from Google Drive?', 'This will overwrite your current local data with the data from your Google Drive backup. This action cannot be undone.', async () => {
        closeModal();
        setIsBusy(true);
        try {
            const fileId = await getBackupFileId();
            if (!fileId) {
                onShowToast('No backup file found in your Google Drive.', 'error');
                return;
            }
            const response = await gapi.client.drive.files.get({ fileId, alt: 'media' });
            const data = JSON.parse(response.body);

            if (data.snapshots && data.users) {
                await db.clearDB();
                await db.addSnapshots(data.snapshots);
                await db.putUsers(data.users);
                onShowToast('Data restored successfully!', 'success');
                onRestoreComplete();
            } else {
                onShowToast('Invalid backup file format.', 'error');
            }
        } catch (e: any) {
            console.error('Restore failed:', e);
            onShowToast(`Restore failed: ${e.result?.error?.message || e.message}`, 'error');
        } finally {
            setIsBusy(false);
        }
    });
  }

  if (!isGapiReady || !tokenClient) {
    return <div className="py-4"><Spinner /></div>
  }

  if (!user) {
    return (
      <Button onClick={handleAuthClick} disabled={isBusy}>
        Connect to Google Drive
      </Button>
    )
  }

  return (
    <div className="space-y-4">
        <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 p-2 rounded-md">
            <img src={user.picture} alt="user avatar" className="w-8 h-8 rounded-full" />
            <div className="text-sm">
                <p className="font-semibold">{user.name}</p>
                <p className="text-gray-600 dark:text-gray-400">{user.email}</p>
            </div>
            <Button onClick={handleSignoutClick} variant="ghost" className="ml-auto">Disconnect</Button>
        </div>
        {lastBackupTime && (
            <p className="text-xs text-center text-gray-500 dark:text-gray-400">Last backup: {lastBackupTime}</p>
        )}
        <div className="flex gap-2 flex-wrap">
            <Button onClick={handleBackup} disabled={isBusy} className="flex-1">
                {isBusy ? <Spinner/> : <><Icon name="upload" className="w-4 h-4 mr-2" /> Backup to Drive</>}
            </Button>
            <Button onClick={handleRestore} disabled={isBusy || !lastBackupTime} variant="secondary" className="flex-1">
                {isBusy ? <Spinner/> : <><Icon name="download" className="w-4 h-4 mr-2" /> Restore from Drive</>}
            </Button>
        </div>
    </div>
  );
};
