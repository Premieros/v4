import { type ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
};

export function Modal({ open, isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const isModalOpen = open ?? isOpen ?? false;
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = 'hidden';
      const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('keydown', handleEsc);
      return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', handleEsc); };
    }
  }, [isModalOpen, onClose]);

  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-ui-text/40 backdrop-blur-md" onClick={onClose} aria-hidden="true" />
      <div
        ref={modalRef}
        className={`relative w-full ${sizes[size]} liquid-glass-card rounded-ui-xl shadow-2xl max-h-[90vh] flex flex-col animate-scale-in`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border">
          <h2 className="text-lg font-bold text-ui-text tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-ui flex items-center justify-center text-ui-subtle hover:text-ui-text hover:bg-ui-page-alt transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
