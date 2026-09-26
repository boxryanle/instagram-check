import React, { useEffect, useId, useRef } from 'react';

interface ModalProps { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  const titleId = useId();
  const content = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    content.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(content.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []);
      const first = controls[0]; const last = controls.at(-1);
      if (!first) { event.preventDefault(); content.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === content.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [isOpen]);
  if (!isOpen) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={content} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-lg m-4 max-h-[90vh] overflow-y-auto">
      <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700"><h2 id={titleId} className="text-lg font-semibold">{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose} className="p-2 text-gray-600 dark:text-gray-300"><svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg></button></div>
      <div className="p-4">{children}</div>
    </div>
  </div>;
};
