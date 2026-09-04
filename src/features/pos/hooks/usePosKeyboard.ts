import { useEffect } from 'react';

export interface PosKeyboardHandlers {
  onSearchFocus?: () => void;
  onFocusSearch?: () => void;
  onHold?: () => void;
  onHoldOrder?: () => void;
  onDiscount?: () => void;
  onTriggerDiscount?: () => void;
  onPay?: () => void;
  onProceedToPay?: () => void;
  onPrint?: () => void;
  onPrintReceipt?: () => void;
  onCloseModal?: () => void;
  onEscape?: () => void;
  onNewOrder?: () => void;
  enabled?: boolean;
}

export function usePosKeyboard(handlers: PosKeyboardHandlers, isEnabled = true) {
  const active = handlers.enabled !== undefined ? handlers.enabled : isEnabled;

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputField =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';

      // Always allow F-keys and Escape even inside input fields
      if (e.key === 'F2') {
        e.preventDefault();
        (handlers.onSearchFocus || handlers.onFocusSearch)?.();
      } else if (e.key === 'F4') {
        e.preventDefault();
        (handlers.onHold || handlers.onHoldOrder)?.();
      } else if (e.key === 'F6') {
        e.preventDefault();
        (handlers.onDiscount || handlers.onTriggerDiscount)?.();
      } else if (e.key === 'F8') {
        e.preventDefault();
        (handlers.onPay || handlers.onProceedToPay)?.();
      } else if (e.key === 'F9') {
        e.preventDefault();
        (handlers.onPrint || handlers.onPrintReceipt)?.();
      } else if (e.key === 'Escape') {
        (handlers.onCloseModal || handlers.onEscape)?.();
      } else if (!isInputField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handlers.onNewOrder?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers, active]);
}

