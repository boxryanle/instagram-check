
import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ children, className = '', title, icon, actions }) => {
  return (
    <div className={`bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-hidden ${className}`}>
        {(title || actions) && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                {title && (
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                        {icon}
                        {title}
                    </h3>
                )}
                {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
        )}
      <div className="p-4">
        {children}
      </div>
    </div>
  );
};
