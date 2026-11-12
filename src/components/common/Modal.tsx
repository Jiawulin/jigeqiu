import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
  showCloseButton?: boolean;
  contained?: boolean;
  closeLabel?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'lg',
  showCloseButton = true,
  contained = false,
  closeLabel = '关闭窗口 (Esc)',
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen || !contained) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
    ) ?? []).filter(element => element.getClientRects().length > 0);
    if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); return; }
      const index = elements.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === elements.length - 1)) {
        event.preventDefault(); elements[0]?.focus();
      }
    };
    dialog?.addEventListener('keydown', trap);
    return () => {
      dialog?.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [isOpen, contained]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !e.defaultPrevented && !e.isComposing) {
        const activeDialog = e.target instanceof Element ? e.target.closest('[role="dialog"]') : null;
        if (activeDialog && activeDialog !== dialogRef.current) return;
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
  }[maxWidth];

  return (
    <div className={`fixed inset-0 ${contained ? 'z-[1300]' : 'z-50'} flex items-center justify-center p-4 sm:p-6 overflow-y-auto`}>
      {/* Backdrop */}
      <div
        className="desktop-dialog-backdrop fixed inset-0 transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div
        ref={dialogRef}
        className={`desktop-dialog-surface relative w-full ${maxWidthClass} ${contained ? 'max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain' : ''} liquid-glass rounded-lg p-6 z-10 transition-all transform duration-200 animate-in fade-in zoom-in-95`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200/80 dark:border-white/10">
            {title && (
              <div className="text-base font-bold text-slate-950 dark:text-slate-100 tracking-tight">
                {title}
              </div>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-full text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors ml-auto cursor-pointer"
                aria-label={closeLabel}
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        <div className="text-slate-900 dark:text-slate-200">{children}</div>
      </div>
    </div>
  );
};
