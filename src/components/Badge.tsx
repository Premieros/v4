import type { ReactNode } from 'react';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-ui-page-alt text-ui-muted',
  primary: 'bg-ui-primary-soft text-ui-primary',
  success: 'bg-ui-success-soft text-ui-success',
  warning: 'bg-ui-warning-soft text-ui-warning',
  danger: 'bg-ui-danger-soft text-ui-danger',
  info: 'bg-ui-info-soft text-ui-info',
};

const dotStyles: Record<BadgeVariant, string> = {
  default: 'bg-ui-subtle',
  primary: 'bg-ui-primary',
  success: 'bg-ui-success',
  warning: 'bg-ui-warning',
  danger: 'bg-ui-danger',
  info: 'bg-ui-info',
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-xs',
};

export function Badge({ children, variant = 'default', size = 'md', dot = false, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold rounded-full ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[variant]}`} />}
      {children}
    </span>
  );
}
