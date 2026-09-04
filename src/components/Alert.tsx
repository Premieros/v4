import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle, Info, XCircle, X } from 'lucide-react';

type AlertVariant = 'success' | 'warning' | 'danger' | 'info';

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
}

const variantConfig: Record<AlertVariant, { bg: string; border: string; icon: ReactNode; iconColor: string }> = {
  success: {
    bg: 'bg-ui-success-soft',
    border: 'border-ui-success/20',
    icon: <CheckCircle className="w-5 h-5" />,
    iconColor: 'text-ui-success',
  },
  warning: {
    bg: 'bg-ui-warning-soft',
    border: 'border-ui-warning/20',
    icon: <AlertTriangle className="w-5 h-5" />,
    iconColor: 'text-ui-warning',
  },
  danger: {
    bg: 'bg-ui-danger-soft',
    border: 'border-ui-danger/20',
    icon: <XCircle className="w-5 h-5" />,
    iconColor: 'text-ui-danger',
  },
  info: {
    bg: 'bg-ui-info-soft',
    border: 'border-ui-info/20',
    icon: <Info className="w-5 h-5" />,
    iconColor: 'text-ui-info',
  },
};

export function Alert({ variant = 'info', title, children, dismissible = false, onDismiss, className = '' }: AlertProps) {
  const config = variantConfig[variant];
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${config.bg} ${config.border} ${className}`}>
      <span className={`mt-0.5 shrink-0 ${config.iconColor}`}>{config.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-bold text-ui-text">{title}</p>}
        <div className="text-sm text-ui-text leading-relaxed">{children}</div>
      </div>
      {dismissible && (
        <button type="button" onClick={onDismiss} className="shrink-0 rounded-lg p-1 text-ui-subtle hover:text-ui-text transition-colors" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
