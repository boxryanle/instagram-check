import React from 'react';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

interface HeaderProps {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({ theme, toggleTheme }) => {
  return (
    <header className="bg-white dark:bg-gray-800 shadow-md p-4">
      <div className="container mx-auto flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary-600 dark:text-primary-400">Insta Tracker</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Analyze your Instagram follower data over time.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
           <Button onClick={toggleTheme} variant="ghost" title="Toggle theme">
             <Icon name={theme === 'light' ? 'moon' : 'sun'} />
           </Button>
        </div>
      </div>
    </header>
  );
};
