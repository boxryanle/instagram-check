
import React, { useEffect } from 'react';
import { Icon } from './Icon';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const baseClasses = 'fixed top-5 right-5 z-50 flex items-center w-full max-w-xs p-4 text-gray-500 bg-white rounded-lg shadow dark:text-gray-400 dark:bg-gray-800';
  const typeClasses = {
    success: 'bg-green-100 dark:bg-green-800 text-green-500 dark:text-green-200',
    error: 'bg-red-100 dark:bg-red-800 text-red-500 dark:text-red-200',
  };
  const iconClasses = {
    success: 'text-green-500 dark:text-green-200',
    error: 'text-red-500 dark:text-red-200',
  }

  return (
    <div className={baseClasses} role="alert">
        <div className={`inline-flex items-center justify-center flex-shrink-0 w-8 h-8 ${typeClasses[type]} rounded-lg`}>
            <Icon name={type === 'success' ? 'check' : 'x'} className={`w-5 h-5 ${iconClasses[type]}`} />
        </div>
        <div className="ml-3 text-sm font-normal">{message}</div>
        <button type="button" onClick={onClose} className="ml-auto -mx-1.5 -my-1.5 bg-white text-gray-400 hover:text-gray-900 rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-gray-100 inline-flex h-8 w-8 dark:text-gray-500 dark:hover:text-white dark:bg-gray-800 dark:hover:bg-gray-700" aria-label="Close">
            <span className="sr-only">Close</span>
            <Icon name="x" className="w-5 h-5" />
        </button>
    </div>
  );
};
