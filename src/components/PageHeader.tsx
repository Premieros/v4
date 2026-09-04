import { type HTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div data-testid="page-header" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav data-testid="page-breadcrumbs" aria-label="Breadcrumbs" className="mb-1.5 flex flex-wrap items-center gap-1 text-xs">
            {breadcrumbs.map((crumb, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <span key={crumb.label + i} className="flex items-center gap-1">
                  {crumb.href && !last ? (
                    <Link to={crumb.href} className="font-medium text-ui-subtle hover:text-ui-primary">{crumb.label}</Link>
                  ) : (
                    <span className={clsx(last ? 'font-semibold text-ui-muted' : 'text-ui-subtle')}>{crumb.label}</span>
                  )}
                  {!last && <ChevronRight className="h-3 w-3 text-ui-subtle [dir='rtl']:rotate-180" />}
                </span>
              );
            })}
          </nav>
        )}
        <h1 data-testid="page-title" className="text-2xl font-bold text-ui-text tracking-tight">{title}</h1>
        {subtitle && <p data-testid="page-description" className="text-sm text-ui-muted mt-1.5">{subtitle}</p>}
      </div>
      {actions && <div data-testid="page-actions" className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-ui-border bg-ui-surface shadow-ui-sm transition-all duration-150',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  color?: string;
  trend?: string;
}

export function StatCard({ title, value, icon, color = 'navy', trend }: StatCardProps) {
  const colorMap: Record<string, { bg: string; icon: string; border: string }> = {
    navy: { bg: 'bg-ui-page-alt', icon: 'text-ui-muted', border: 'border-ui-border' },
    gold: { bg: 'bg-ui-accent/10', icon: 'text-ui-accent', border: 'border-ui-accent/25' },
    brand: { bg: 'bg-ui-primary-soft', icon: 'text-ui-accent', border: 'border-ui-primary/25' },
    blue: { bg: 'bg-ui-info/10', icon: 'text-ui-info', border: 'border-ui-info/25' },
    amber: { bg: 'bg-ui-warning/10', icon: 'text-ui-warning', border: 'border-ui-warning/25' },
    red: { bg: 'bg-ui-danger/10', icon: 'text-ui-danger', border: 'border-ui-danger/25' },
    purple: { bg: 'bg-ui-primary-soft', icon: 'text-ui-accent', border: 'border-ui-primary/25' },
    green: { bg: 'bg-ui-success/10', icon: 'text-ui-success', border: 'border-ui-success/25' },
  };

  const c = colorMap[color] || colorMap.navy;

  return (
    <Card className="p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ui-subtle">{title}</p>
          <p className="text-2xl font-bold text-ui-text mt-2 tracking-tight">{value}</p>
          {trend && <p className="text-xs text-ui-subtle mt-2">{trend}</p>}
        </div>
        <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center border', c.bg, c.icon, c.border)}>
          {icon}
        </div>
      </div>
    </Card>
  );
}
