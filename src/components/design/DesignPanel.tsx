import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Card } from '@/components/PageHeader';

/**
 * Panel surface (6F): a Card with an optional consistent header row
 * (icon + title + description + actions) and a body area with stable test
 * identity. Used wherever repeated card headers used to be hand-rolled.
 */
export function DesignPanel({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  testId,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}) {
  const hasHeader = title !== undefined || description !== undefined || icon !== undefined || actions !== undefined;
  return (
    <Card className={className}>
      {hasHeader ? (
        <div className="flex flex-col gap-3 border-b border-ui-border p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {icon ? <span className="shrink-0">{icon}</span> : null}
            <div className="min-w-0">
              {title ? <h2 className="font-bold text-ui-text">{title}</h2> : null}
              {description ? <p className="mt-0.5 text-xs text-ui-subtle">{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div data-testid={testId} className={clsx(bodyClassName ?? 'p-4')}>
        {children}
      </div>
    </Card>
  );
}
