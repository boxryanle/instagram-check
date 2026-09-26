import React, { useState } from 'react';
import { Snapshot } from '../types';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { exportAsJSON } from '../utils/fileUtils';

interface SnapshotManagerProps {
  snapshots: Snapshot[];
  baselineId: string | null;
  targetId: string | null;
  onSetBaseline: (id: string | null) => void;
  onSetTarget: (id: string | null) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
}

const SnapshotItem: React.FC<{
    snapshot: Snapshot,
    isBaseline: boolean,
    isTarget: boolean,
    onSetBaseline: (id: string) => void,
    onSetTarget: (id: string) => void,
    onDelete: (id: string) => void,
    onRename: (id: string, newName: string) => void,
    previousSnapshotId: string | null,
    onCompareToPrevious: () => void,
}> = ({ snapshot, isBaseline, isTarget, onSetBaseline, onSetTarget, onDelete, onRename, previousSnapshotId, onCompareToPrevious }) => {
    const [isRenaming, setIsRenaming] = useState(false);
    const [name, setName] = useState(snapshot.name || '');
    
    const handleRename = () => {
        onRename(snapshot.id, name);
        setIsRenaming(false);
    }

    const fileNames = snapshot.meta.files.map(f => f.fileName).join(', ');
    
    return (
         <li className="relative pl-8">
            {/* Timeline Dot */}
            <div className="absolute left-0 top-5 -translate-x-1/2 w-4 h-4 bg-white dark:bg-gray-800 rounded-full border-2 border-primary-500"></div>
            
            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex-grow min-w-0">
                 {isRenaming ? (
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            value={name} 
                            onChange={(e) => setName(e.target.value)} 
                            className="px-2 py-1 border border-gray-300 rounded-md dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                            autoFocus
                        />
                        <Button onClick={handleRename}><Icon name="check"/></Button>
                        <Button onClick={() => setIsRenaming(false)} variant="secondary"><Icon name="x"/></Button>
                    </div>
                 ) : (
                    <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-800 dark:text-gray-100 truncate" title={snapshot.name || `Snapshot @ ${new Date(snapshot.createdAt).toLocaleString()}`}>
                            {snapshot.name || `Snapshot @ ${new Date(snapshot.createdAt).toLocaleString()}`}
                        </p>
                         <button onClick={() => setIsRenaming(true)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                <Icon name="edit" className="w-4 h-4" />
                        </button>
                        {snapshot.isPartial ? (
                             <span className="px-2 py-0.5 text-xs font-medium text-yellow-800 bg-yellow-100 rounded-full dark:bg-yellow-900 dark:text-yellow-200">Partial</span>
                        ) : (
                             <span className="px-2 py-0.5 text-xs font-medium text-green-800 bg-green-100 rounded-full dark:bg-green-900 dark:text-green-200">Complete</span>
                        )}
                    </div>
                 )}
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={fileNames}>{fileNames}</p>
                <div className="flex gap-4 text-sm mt-1 text-gray-600 dark:text-gray-300">
                    <span>Followers: {snapshot.data.followersById.length}</span>
                    <span>Following: {snapshot.data.followingById.length}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end sm:justify-start">
                  {previousSnapshotId && (
                      <Button onClick={onCompareToPrevious} variant="secondary" title="Compare to previous snapshot">
                          <Icon name="compare" />
                      </Button>
                  )}
                  <Button onClick={() => onSetBaseline(snapshot.id)} variant={isBaseline ? 'primary' : 'secondary'}>Baseline</Button>
                  <Button onClick={() => onSetTarget(snapshot.id)} variant={isTarget ? 'primary' : 'secondary'}>Target</Button>
                  <Button onClick={() => exportAsJSON(snapshot, `snapshot_${snapshot.id}.json`)} variant="ghost" title="Download JSON"><Icon name="download"/></Button>
                  <Button onClick={() => onDelete(snapshot.id)} variant="ghost" className="text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50" title="Delete"><Icon name="trash"/></Button>
              </div>
            </div>
        </li>
    )
}

export const SnapshotManager: React.FC<SnapshotManagerProps> = ({ snapshots, baselineId, targetId, onSetBaseline, onSetTarget, onDelete, onRename }) => {
  return (
    <div className="p-4 bg-white dark:bg-gray-800 shadow-md rounded-lg">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">Snapshot History ({snapshots.length})</h2>

        {snapshots.length > 0 ? (
            <div className="relative">
              {/* Vertical timeline bar */}
              <div className="absolute left-2 top-5 bottom-5 w-0.5 bg-gray-200 dark:bg-gray-600"></div>
              <ul className="space-y-4">
                  {snapshots.slice().reverse().map((s, index, arr) => {
                      const previousSnapshotId = index < arr.length - 1 ? arr[index + 1].id : null;
                      return (
                          <SnapshotItem 
                              key={s.id} 
                              snapshot={s}
                              isBaseline={s.id === baselineId}
                              isTarget={s.id === targetId}
                              onSetBaseline={onSetBaseline}
                              onSetTarget={onSetTarget}
                              onDelete={onDelete}
                              onRename={onRename}
                              previousSnapshotId={previousSnapshotId}
                              onCompareToPrevious={() => {
                                  if (previousSnapshotId) {
                                      onSetTarget(s.id);
                                      onSetBaseline(previousSnapshotId);
                                  }
                              }}
                          />
                      )
                  })}
              </ul>
            </div>
        ) : (
            <p className="text-gray-500 dark:text-gray-400">No snapshots yet. Upload a CSV to get started.</p>
        )}
    </div>
  );
};
