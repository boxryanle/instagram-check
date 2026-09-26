import { useMemo } from 'react';
import { Snapshot, AnalysisData, User } from '../types';
import { analyzeSnapshots } from '../utils/analysis';

export const useAnalysis = (baseline: Snapshot | null, target: Snapshot | null, userMap: Map<string, User>): AnalysisData =>
  useMemo(() => analyzeSnapshots(baseline, target), [baseline, target, userMap]);
