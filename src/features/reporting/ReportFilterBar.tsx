import React from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { Card } from '@/components/PageHeader';
import { Input } from '@/components/Input';
import { formatCurrency } from '@/lib/format';
import type { Language } from '@/lib/types';
import type { ReportFilterKey, ReportFilters } from './reportFilters';

interface FilterOption {
  value: string;
  label: string;
}

export interface ReportFilterBarProps {
  reportType: string;
  filters: ReportFilters;
  onFilterChange: (dim: ReportFilterKey, value: string) => void;
  showDate: boolean;
  period: string;
  onPeriodChange: (key: string) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  showBranchFilter: boolean;
  branches: Array<{ id: string; name: string; name_en: string | null }>;
  branchFilterValue: string;
  onBranchFilterChange: (value: string) => void;
  filterOptions: (dim: ReportFilterKey) => FilterOption[];
  filterLabel: (dim: ReportFilterKey) => string;
  allLabel: (dim: ReportFilterKey) => string;
  filterDimensions: ReportFilterKey[];
  total: number;
  count: number;
  currency: string;
  lang: Language;
  financialTypes?: Array<{ key: string; label: string }>;
  canFinancial?: boolean;
  onFinancialSelect?: (key: string) => void;
  reportTypes?: Array<{ key: string; label: string; icon: React.ReactNode }>;
  onReportTypeChange?: (key: string) => void;
}

export function ReportFilterBar({
  reportType,
  filters,
  onFilterChange,
  showDate,
  period,
  onPeriodChange,
  from,
  to,
  onFromChange,
  onToChange,
  showBranchFilter,
  branches,
  branchFilterValue,
  onBranchFilterChange,
  filterOptions,
  filterLabel,
  allLabel,
  filterDimensions,
  total,
  count,
  currency,
  lang,
  financialTypes = [],
  canFinancial = false,
  onFinancialSelect,
  reportTypes = [],
  onReportTypeChange,
}: ReportFilterBarProps) {
  const { t } = useLanguage();
  return (
    <Card className="mb-4 p-4 border-ui-border bg-ui-surface shadow-ui">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px]">
            <label className="block text-sm font-medium text-ui-muted mb-1.5">{t('reports')}</label>
            <select data-testid="report-type-select" value={reportType} onChange={(e) => onReportTypeChange?.(e.target.value)}
              className="h-10 w-full rounded-ui border border-ui-border bg-ui-surface-raised px-3 text-sm font-semibold text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring">
              <optgroup label={lang === 'ar' ? 'التقارير التشغيلية' : 'Operational reports'}>
                {reportTypes.map((rt) => <option key={rt.key} value={rt.key}>{rt.label}</option>)}
              </optgroup>
              {canFinancial && financialTypes.length > 0 && (
                <optgroup label={lang === 'ar' ? 'التقارير المالية' : 'Financial reports'}>
                  {financialTypes.map((ft) => <option key={ft.key} value={ft.key}>{ft.label}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          {showDate && (
            <div className="min-w-[200px]">
              <label className="block text-sm font-medium text-ui-muted mb-1.5">{t('filterByPeriod')}</label>
              <select data-testid="report-context-filter" value={period} onChange={(e) => onPeriodChange(e.target.value)}
                className="h-10 w-full rounded-ui border border-ui-border bg-ui-surface-raised px-3 text-sm font-semibold text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring">
                <option value="custom">{lang === 'ar' ? 'مخصص' : 'Custom'}</option>
                <option value="today">{lang === 'ar' ? 'اليوم' : 'Today'}</option>
                <option value="yesterday">{lang === 'ar' ? 'أمس' : 'Yesterday'}</option>
                <option value="last7">{lang === 'ar' ? 'آخر 7 أيام' : 'Last 7 days'}</option>
                <option value="last30">{lang === 'ar' ? 'آخر 30 يومًا' : 'Last 30 days'}</option>
                <option value="this_month">{lang === 'ar' ? 'هذا الشهر' : 'This month'}</option>
                <option value="last_month">{lang === 'ar' ? 'الشهر الماضي' : 'Last month'}</option>
                <option value="this_year">{lang === 'ar' ? 'هذه السنة' : 'This year'}</option>
              </select>
            </div>
          )}
          {showDate && <Input label={t('from')} type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />}
          {showDate && <Input label={t('to')} type="date" value={to} onChange={(e) => onToChange(e.target.value)} />}
          {showBranchFilter && (
            <div>
              <label className="block text-sm font-medium text-ui-muted mb-1.5">{t('filterByBranch')}</label>
              <select value={branchFilterValue} onChange={(e) => onBranchFilterChange(e.target.value)}
                className="h-10 min-w-[180px] rounded-ui border border-ui-border bg-ui-surface-raised px-3 text-sm font-semibold text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring">
                <option value="">{t('allBranches')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{lang === 'ar' ? b.name : (b.name_en || b.name)}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-4 text-sm">
            <div className="rounded-ui-lg bg-ui-page-alt px-4 py-2 border border-ui-border">
              <span className="text-ui-muted">{t('total')}: </span>
              <span className="font-bold text-ui-accent">{formatCurrency(total, currency, lang)}</span>
            </div>
            <div className="rounded-ui-lg bg-ui-page-alt px-4 py-2 border border-ui-border">
              <span className="text-ui-muted">{t('count')}: </span>
              <span className="font-bold text-ui-text">{count}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-ui-border pt-3">
          {reportTypes.map((rt) => (
            <button key={rt.key} data-report-type={rt.key} onClick={() => onReportTypeChange?.(rt.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-ui-lg text-sm font-medium transition-colors ${reportType === rt.key ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'bg-ui-page-alt text-ui-muted border border-ui-border hover:bg-ui-primary-soft hover:text-ui-primary'}`}>
              {rt.icon} {rt.label}
            </button>
          ))}
          {canFinancial && financialTypes.map((ft) => (
            <button key={ft.key} data-report-type={ft.key} onClick={() => onFinancialSelect?.(ft.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-ui-lg text-sm font-medium transition-colors bg-ui-page-alt text-ui-muted border border-ui-border hover:bg-ui-primary-soft hover:text-ui-primary`}>
              {ft.label}
            </button>
          ))}
        </div>
        {filterDimensions.length > 0 && (
          <div data-testid="report-contextual-filters" className="flex flex-wrap items-end gap-4 border-t border-ui-border pt-3">
            {filterDimensions.map((dim) => (
              <div key={dim} className="min-w-[180px]">
                <label className="block text-sm font-medium text-ui-muted mb-1.5">{filterLabel(dim)}</label>
                <select data-filter-dim={dim} value={filters[dim] || ''} onChange={(e) => onFilterChange(dim, e.target.value)}
                  className="h-10 w-full rounded-ui border border-ui-border bg-ui-surface-raised px-3 text-sm font-semibold text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring">
                  <option value="">{allLabel(dim)}</option>
                  {filterOptions(dim).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
