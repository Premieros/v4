import { useState, useRef, type ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'start' | 'end';
  className?: string;
}

const sideStyles: Record<string, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  start: 'end-full top-1/2 -translate-y-1/2 me-2',
  end: 'start-full top-1/2 -translate-y-1/2 ms-2',
};

export function Tooltip({ content, children, side = 'top', className = '' }: TooltipProps) {
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const open = () => { clearTimeout(timeoutRef.current); setShow(true); };
  const close = () => { timeoutRef.current = setTimeout(() => setShow(false), 100); };

  return (
    <span className={`relative inline-flex ${className}`} onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}>
      {children}
      {show && (
        <span role="tooltip" className={`absolute z-[60] whitespace-nowrap rounded-lg bg-ui-text px-2.5 py-1.5 text-xs font-medium text-ui-surface shadow-ui-md animate-fade-in pointer-events-none ${sideStyles[side]}`}>
          {content}
        </span>
      )}
    </span>
  );
}
