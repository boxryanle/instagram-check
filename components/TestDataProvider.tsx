
import React from 'react';
import { Button } from './ui/Button';
import { processAndParseFile } from '../utils/csvParser';
import { ProcessedFileData } from '../types';

interface TestDataProviderProps {
    onSave: (data: ProcessedFileData) => void;
}

const baselineCSV = `username,full_name,list_type
alice,,follower
bob,,follower
cody,,following
dina,,following`;

const targetCSV = `username,full_name,list_type
alice,,follower
eric,,follower
cody,,following
eric,,following`;


export const TestDataProvider: React.FC<TestDataProviderProps> = ({ onSave }) => {
    
    const loadBaseline = async () => {
        const file = new File([baselineCSV], 'baseline_test_data.csv', { type: 'text/csv' });
        const data = await processAndParseFile(file);
        onSave(data);
    };

    const loadTarget = async () => {
        const file = new File([targetCSV], 'target_test_data.csv', { type: 'text/csv' });
        const data = await processAndParseFile(file);
        onSave(data);
    };
    
    return (
        <details className="my-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <summary className="p-3 cursor-pointer font-semibold text-gray-700 dark:text-gray-200">
                Quick Demo Data
            </summary>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    Use these buttons to quickly populate the app with sample data for demonstration.
                </p>
                <div className="flex gap-4">
                    <Button onClick={loadBaseline}>Load Baseline Snapshot</Button>
                    <Button onClick={loadTarget}>Load Target Snapshot</Button>
                </div>
            </div>
        </details>
    )
}
