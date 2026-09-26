
import React from 'react';
import { AnalysisData } from '../../types';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';

interface ReciprocationReportProps {
  analysis: AnalysisData;
  onViewList: (listType: string) => void;
}

const StatCard: React.FC<{ 
    title: string; 
    value: number | string; 
    description?: string; 
    onAction?: () => void;
    actionLabel?: string;
}> = ({ title, value, description, onAction, actionLabel }) => (
    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg flex flex-col h-full">
        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</h4>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex-grow">{description}</p>}
        {onAction && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                <Button variant="ghost" size="sm" onClick={onAction} className="w-full text-xs">
                    {actionLabel || 'View List'}
                </Button>
            </div>
        )}
    </div>
)

export const ReciprocationReport: React.FC<ReciprocationReportProps> = ({ analysis, onViewList }) => {
  return (
    <Card title="Relationship Status" icon={<Icon name="users" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard 
                title="Mutuals" 
                value={analysis.mutuals.length} 
                description="You follow each other." 
                onAction={() => onViewList('mutuals')}
            />
            <StatCard 
                title="Not Following Me Back" 
                value={analysis.notFollowingMeBack.length} 
                description="You follow them, they don't follow you."
                onAction={() => onViewList('not-following-back')}
            />
            <StatCard 
                title="I Don't Follow Back" 
                value={analysis.iDontFollowBack.length} 
                description="They follow you, you don't follow them."
                onAction={() => onViewList('i-dont-follow-back')}
            />
            <StatCard 
                title="Follow-Back Ratio" 
                value={`${(analysis.followBackRatio * 100).toFixed(1)}%`} 
                description="The percentage of your followers that you also follow."
            />
        </div>
    </Card>
  );
};
