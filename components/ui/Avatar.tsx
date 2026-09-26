import React from 'react';
import { generateInitials } from '../../utils/imageUtils';

export const Avatar: React.FC<{ userId: string; username: string }> = ({ username }) => (
  <span aria-hidden="true" className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-100 font-semibold text-xs">
    {generateInitials(username)}
  </span>
);
