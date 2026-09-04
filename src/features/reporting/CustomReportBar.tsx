import { Plus, X } from 'lucide-react';
import type { SavedReportConfig } from './useCustomReports';
import type { ReportFilters } from './reportFilters';

interface CustomReportBarProps {
  savedReports: SavedReportConfig[];
  currentReportType: string;
  currentVisibleColumns: string[] | null;
  currentFilters: ReportFilters;
  onSelect: (config: SavedReportConfig) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  lang: string;
}

function arraysEqual(a: string[] | null, b: string[] | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function filtersEqual(a: ReportFilters, b: ReportFilters) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k as keyof ReportFilters] === b[k as keyof ReportFilters]);
}

export function CustomReportBar({
  savedReports,
  currentReportType,
  currentVisibleColumns,
  currentFilters,
  onSelect,
  onSave,
  onDelete,
  lang,
}: CustomReportBarProps) {
  if (savedReports.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button onClick={onSave}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ui text-xs font-medium bg-ui-page-alt border border-ui-border text-ui-text hover:bg-ui-primary-soft hover:text-ui-primary transition-colors">
        <Plus className="w-3.5 h-3.5" />
        {lang === 'ar' ? 'حفظ العرض الحالي' : 'Save Current View'}
      </button>
      {savedReports.map((cfg) => {
        const active = cfg.reportType === currentReportType && arraysEqual(cfg.visibleColumns, currentVisibleColumns) && filtersEqual(cfg.filters, currentFilters);
        return (
          <span key={cfg.id}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-ui text-xs font-medium cursor-pointer transition-colors ${active ? 'bg-ui-primary text-ui-primary-fg' : 'bg-ui-page-alt border border-ui-border text-ui-text hover:bg-ui-primary-soft'}`}>
            <button onClick={() => onSelect(cfg)} className="outline-none">
              {cfg.name}
            </button>
            <button onClick={() => onDelete(cfg.id)} className="ml-0.5 p-0.5 rounded hover:bg-black/10 text-ui-muted" aria-label={lang === 'ar' ? 'حذف' : 'Delete'}>
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
