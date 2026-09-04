import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/Button';

/**
 * Shared state surfaces (6E/6F): loading, empty and error. Keeping these
 * primitives in one place lets every list/table surface show the same
 * feedback without duplicating markup.
 */

export function DesignLoadingState({
  message,
  className,
  testId = 'design-loading',
}: {
  message?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={clsx('flex items-center justify-center py-12', className)}>
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-ui-primary border-t-transparent" />
        {message ? <p className="text-sm text-ui-muted">{message}</p> : null}
      </div>
    </div>
  );
}

export function DesignEmptyState({
  icon,
  title,
  description,
  action,
  className,
  testId = 'design-empty',
}: {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={clsx('flex flex-col items-center justify-center py-16 text-center text-ui-muted', className)}>
      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-ui-page-alt">
        {icon}
      </div>
      {title ? <p className="text-sm font-medium text-ui-muted">{title}</p> : null}
      {description ? <p className="mt-1 max-w-sm text-xs text-ui-subtle">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DesignErrorState({
  message,
  onRetry,
  retryLabel,
  className,
  testId = 'design-error',
}: {
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={clsx('flex flex-col items-center justify-center py-12 text-center', className)}>
      <AlertCircle aria-hidden="true" className="mb-3 h-10 w-10 text-ui-danger" />
      <p className="text-sm text-ui-danger">{message}</p>
      {onRetry ? (
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={onRetry} data-testid={`${testId}-retry`}>
            {retryLabel ?? 'Retry'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
