
import React, { useState, useCallback, useReducer, useEffect, useRef } from 'react';
import { ProcessedFileData, Snapshot } from '../types';
import { processAndParseFile } from '../utils/csvParser';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Icon } from './ui/Icon';
import { Spinner } from './ui/Spinner';
import { Modal } from './ui/Modal';

const PENDING_SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

type UploadState = {
    followersFile: ProcessedFileData | null;
    followingFile: ProcessedFileData | null;
    isProcessing: boolean;
    error: string | null;
    warnings: string[];
}
type UploadAction = 
    | { type: 'START_PROCESSING' }
    | { type: 'ADD_FILE', payload: ProcessedFileData }
    | { type: 'SET_ERROR', payload: string }
    | { type: 'CLEAR_FILE', payload: 'followers' | 'following' }
    | { type: 'RESET' }

const initialState: UploadState = {
    followersFile: null,
    followingFile: null,
    isProcessing: false,
    error: null,
    warnings: [],
}

const uploadReducer = (state: UploadState, action: UploadAction): UploadState => {
    switch (action.type) {
        case 'START_PROCESSING':
            return { ...state, isProcessing: true, error: null };
        case 'ADD_FILE': {
            const file = action.payload;
            let newState = {...state, isProcessing: false, warnings: [...state.warnings, ...file.warnings] };
            if (file.role === 'followers') newState.followersFile = file;
            if (file.role === 'following') newState.followingFile = file;
            if (file.role === 'combined') {
                newState.followersFile = file;
                newState.followingFile = file;
            }
            if (file.role === 'unknown') {
                return { ...state, isProcessing: false, error: file.warnings[0] || 'Could not determine file role.' }
            }
            return newState;
        }
        case 'SET_ERROR':
            return { ...state, isProcessing: false, error: action.payload };
        case 'CLEAR_FILE':
            return { ...state, [action.payload === 'followers' ? 'followersFile' : 'followingFile']: null };
        case 'RESET':
            return initialState;
        default:
            return state;
    }
}

const FileCard: React.FC<{fileData: ProcessedFileData, onClear: () => void}> = ({ fileData, onClear }) => (
    <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm relative">
        <button onClick={onClear} className="absolute top-1 right-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><Icon name="x" className="w-4 h-4" /></button>
        <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{fileData.fileInfo.name}</p>
        <p className="capitalize text-primary-600 dark:text-primary-400 font-medium">{fileData.role}</p>
        <div className="text-gray-600 dark:text-gray-300 grid grid-cols-2 gap-x-2 text-xs">
            <span>Followers:</span><span>{fileData.followers.size}</span>
            <span>Following:</span><span>{fileData.following.size}</span>
        </div>
    </div>
);

const DropZone: React.FC<{onDrop: (files: FileList) => void}> = ({onDrop}) => {
    const [isDragging, setIsDragging] = useState(false);
    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(false); };
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); };
    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        onDrop(e.dataTransfer.files);
    };

    return (
        <div 
            onDragEnter={handleDragEnter} 
            onDragLeave={handleDragLeave} 
            onDragOver={handleDragOver} 
            onDrop={handleDrop}
            className={`p-6 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${isDragging ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-300 dark:border-gray-600 hover:border-primary-400'}`}
        >
            <Icon name="upload" className="mx-auto h-10 w-10 text-gray-400" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Drag & drop CSV or JSON files here</p>
            <p className="text-xs text-gray-500 dark:text-gray-500">Supports Official Instagram Export (JSON/CSV)</p>
        </div>
    )
}

const FAST_IMPORT_SCRIPT = `
/* Insta Tracker - Fast Import Script */
/* Copy and paste this entire block into the Console tab of Developer Tools (F12) while on your Instagram profile page. */
(async () => {
    console.log("⏳ Starting Insta Tracker import...");
    const username = window.location.pathname.replace(/\\//g, '');
    if(!username) return alert("Please go to your Instagram profile page first.");
    
    alert("Note: This script is experimental. If it fails, please use the official 'Download Your Information' feature in Instagram Settings.");

    // Simple extraction from shared data if available, otherwise warns user
    // Real-time scraping code is complex and brittle. We will provide a link to the repo or instructions.
    // For now, we will attempt to detect if the user has data loaded.
    
    // This is a placeholder for the actual fetching logic which is too large to embed reliably in a string without external deps.
    // However, we can guide the user to a robust solution.
    
    const data = {
        followers: [],
        following: [],
        timestamp: new Date().toISOString()
    };

    const confirmDownload = confirm("To get your data instantly without API access, you need to use a browser extension or a more advanced script. \\n\\nWould you like to download a template JSON that works with Insta Tracker instead?");
    
    if(confirmDownload) {
       const blob = new Blob([JSON.stringify(data, null, 2)], {type : 'application/json'});
       const a = document.createElement('a');
       a.href = URL.createObjectURL(blob);
       a.download = \`insta_tracker_\${username}.json\`;
       a.click();
    }
})();
`;

// A more useful instruction set
const SCRIPT_INSTRUCTIONS = `
1. Go to instagram.com and log in.
2. Navigate to your own profile page.
3. Open Developer Tools (Press F12, or right-click > Inspect).
4. Go to the "Console" tab.
5. Copy the code below, paste it into the console, and press Enter.
6. **Note:** Due to Instagram security, you may need to scroll down your followers list manually to load them before running a simple scraper, or use a dedicated Browser Extension like "IG Exporter" to generate a CSV/JSON file, which this app supports.
`;


interface UploadPanelProps {
  onSave: (files: ProcessedFileData[]) => void;
  onMerge: (partialSnapshot: Snapshot, file: ProcessedFileData) => void;
  findLatestPartialToComplete: (file: ProcessedFileData) => Snapshot | undefined;
  isLoading: boolean;
}

export const UploadPanel: React.FC<UploadPanelProps> = ({ onSave, onMerge, findLatestPartialToComplete, isLoading }) => {
    const [state, dispatch] = useReducer(uploadReducer, initialState);
    const [sessionTimeoutId, setSessionTimeoutId] = useState<number | null>(null);
    const [timeLeft, setTimeLeft] = useState(0);
    const [showScriptModal, setShowScriptModal] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Countdown timer effect
    useEffect(() => {
        if (timeLeft > 0) {
            const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
            return () => clearTimeout(timer);
        } else if (sessionTimeoutId) {
            handleSave();
        }
    }, [timeLeft]);
    
    const startPendingSession = () => {
        if (sessionTimeoutId) clearTimeout(sessionTimeoutId);
        setTimeLeft(PENDING_SESSION_TIMEOUT / 1000);
        const timeoutId = window.setTimeout(() => {}, PENDING_SESSION_TIMEOUT);
        setSessionTimeoutId(timeoutId);
    }

    const clearPendingSession = () => {
        if (sessionTimeoutId) clearTimeout(sessionTimeoutId);
        setSessionTimeoutId(null);
        setTimeLeft(0);
    }

    const handleFileProcess = async (file: File) => {
        try {
            const processed = await processAndParseFile(file);
            
            const partialToComplete = findLatestPartialToComplete(processed);
            if (partialToComplete) {
                onMerge(partialToComplete, processed);
                dispatch({type: 'RESET'});
                return;
            }

            dispatch({ type: 'ADD_FILE', payload: processed });
        } catch (err: any) {
            dispatch({ type: 'SET_ERROR', payload: `Failed to process ${file.name}: ${err.message}` });
        }
    }

    const handleFileDrop = async (files: FileList) => {
        if (files.length === 0 || files.length > 2) {
            dispatch({ type: 'SET_ERROR', payload: 'Please upload 1 or 2 files.' });
            return;
        }
        dispatch({ type: 'START_PROCESSING' });
        await Promise.all(Array.from(files).map(handleFileProcess));
    }

    useEffect(() => {
        const hasOneFile = (state.followersFile && !state.followingFile) || (!state.followersFile && state.followingFile);
        const hasTwoFiles = state.followersFile && state.followingFile;

        if (hasTwoFiles) {
            clearPendingSession();
        } else if (hasOneFile) {
            if (!sessionTimeoutId) startPendingSession();
        } else {
            clearPendingSession();
        }
    }, [state.followersFile, state.followingFile]);


    const handleSave = () => {
        const filesToSave = [state.followersFile, state.followingFile].filter(Boolean) as ProcessedFileData[];
        if (filesToSave.length > 0) {
            onSave(filesToSave);
            dispatch({ type: 'RESET' });
            clearPendingSession();
        }
    };
  
    const isReadyToSave = state.followersFile || state.followingFile;
    const missingRole = !state.followersFile ? 'Followers' : 'Following';

    return (
        <Card title="Upload New Snapshot" icon={<Icon name="upload" />}>
            <div className="space-y-4">
                <div className="flex justify-end">
                    <button onClick={() => setShowScriptModal(true)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1">
                        <Icon name="users" className="w-3 h-3"/>
                        Can't wait for export?
                    </button>
                </div>

                <input type="file" multiple accept=".csv,.json" ref={fileInputRef} onChange={e => e.target.files && handleFileDrop(e.target.files)} className="hidden" />
                <div onClick={() => fileInputRef.current?.click()}>
                    <DropZone onDrop={handleFileDrop} />
                </div>
                
                {state.isProcessing && <Spinner />}
                {state.error && <p className="text-red-500 text-sm">{state.error}</p>}
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {state.followersFile ? <FileCard fileData={state.followersFile} onClear={() => dispatch({type: 'CLEAR_FILE', payload: 'followers'})} /> : <div />}
                    {state.followingFile ? <FileCard fileData={state.followingFile} onClear={() => dispatch({type: 'CLEAR_FILE', payload: 'following'})} /> : <div />}
                </div>

                {sessionTimeoutId && timeLeft > 0 && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-center">
                        <p className="text-sm text-blue-700 dark:text-blue-300">Waiting for {missingRole} file...</p>
                        <p className="text-lg font-mono font-bold text-blue-800 dark:text-blue-200">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</p>
                        <p className="text-xs text-blue-600 dark:text-blue-400">Snapshot will save as partial if time runs out.</p>
                    </div>
                )}
                
                {state.warnings.length > 0 && (
                    <details className="text-sm">
                        <summary className="cursor-pointer font-medium text-yellow-600 dark:text-yellow-400">
                            {state.warnings.length} Parsing Warnings <span className="text-xs">(click to view)</span>
                        </summary>
                        <ul className="mt-2 list-disc pl-5 max-h-32 overflow-y-auto bg-white dark:bg-gray-800 p-2 rounded">
                        {state.warnings.map((w, i) => <li key={i} className="text-yellow-700 dark:text-yellow-500">{w}</li>)}
                        </ul>
                    </details>
                )}

                <Button onClick={handleSave} disabled={!isReadyToSave || isLoading} className="w-full">
                    {isLoading ? 'Saving...' : 'Save Snapshot'}
                </Button>
            </div>

            <Modal isOpen={showScriptModal} onClose={() => setShowScriptModal(false)} title="Instant Data Import">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        Instagram restricts direct access to your data. The official way is to request a <strong>JSON</strong> export from "Your Activity" settings, which this app supports.
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        To get data <strong>instantly</strong>, we recommend using a browser extension like <em>"IG Exporter"</em> or <em>"Growman"</em> to download your followers as a CSV/JSON, then drop that file here.
                    </p>
                    
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
                        <p className="text-xs text-yellow-800 dark:text-yellow-200 font-medium">
                             We now support <strong>JSON files</strong>! You can upload the `followers_1.json` and `following.json` files directly from the official Instagram zip export.
                        </p>
                    </div>
                </div>
            </Modal>
        </Card>
    );
};
