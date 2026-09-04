import type { ReactNode } from 'react';
import clsx from 'clsx';
import { PageHeader, type BreadcrumbItem } from '@/components/PageHeader';

export type DesignBreadcrumb = BreadcrumbItem;

export function DesignSurface({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId: string;
}) {
  return (
    <section data-testid={testId} className={clsx('min-w-0 space-y-4', className)}>
      {children}
    </section>
  );
}

// Delegates to the canonical 6D page-header surface (PageHeader) so there is a
// single implementation while the design package keeps its own stable API.
export function DesignPageHeader({
  title,
  subtitle,
  description,
  actions,
  breadcrumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: DesignBreadcrumb[];
}) {
  return <PageHeader title={title} subtitle={subtitle ?? description} actions={actions} breadcrumbs={breadcrumbs} />;
}

export function DesignFilterBar({ children }: { children: ReactNode }) {
  return (
    <div data-testid="design-filter-bar" className="flex flex-col gap-2 rounded-xl border border-ui-border bg-ui-surface p-3 shadow-ui-sm sm:flex-row sm:flex-wrap sm:items-center">
      {children}
    </div>
  );
}
