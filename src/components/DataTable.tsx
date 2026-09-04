import { type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  error?: ReactNode | null;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  showCheckbox?: boolean;
}

export function DataTable<T extends { id?: string }>({ columns, data, loading, error, emptyMessage, onRowClick, selectedIds, onSelectionChange, showCheckbox }: DataTableProps<T>) {
  if (loading) {
    return (
      <div data-testid="table-loading" className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-3 border-ui-primary border-t-transparent" />
          <p className="text-sm text-ui-subtle">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="table-error" className="flex flex-col items-center justify-center py-16 text-ui-muted">
        <div className="w-16 h-16 rounded-full bg-ui-danger-soft flex items-center justify-center mb-3">
          <svg className="w-8 h-8 text-ui-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-ui-text">{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div data-testid="table-empty" className="flex flex-col items-center justify-center py-16 text-ui-muted">
        <div className="w-16 h-16 rounded-full bg-ui-page-alt flex items-center justify-center mb-3">
          <svg className="w-8 h-8 text-ui-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
        </div>
        <p className="text-sm font-medium text-ui-text">{emptyMessage || 'No data'}</p>
      </div>
    );
  }

  const allSelected = showCheckbox && selectedIds && data.length > 0 && data.every((r) => r.id && selectedIds.has(r.id));

  const toggleAll = () => {
    if (!onSelectionChange || !selectedIds) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(data.map((r) => r.id!).filter(Boolean)));
    }
  };

  const toggleRow = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  };

  return (
    <div data-testid="data-table" className="overflow-x-auto rounded-xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ui-border bg-ui-page-alt/70">
            {showCheckbox && (
              <th className="px-4 py-3 w-10">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  className="w-4 h-4 rounded border-ui-border-strong text-ui-primary focus:ring-ui-ring" />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-start font-semibold text-ui-muted text-xs uppercase tracking-wider ${col.className || ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ui-border">
          {data.map((row, i) => (
            <tr
              key={row.id || i}
              onClick={(e) => {
                if (showCheckbox && (e.target as HTMLElement).closest('input[type="checkbox"]')) return;
                onRowClick?.(row);
              }}
              className={`hover:bg-ui-page-alt/60 transition-colors duration-150 ${onRowClick ? 'cursor-pointer' : ''} ${selectedIds?.has(row.id || '') ? 'bg-ui-primary-soft/50' : ''}`}
            >
              {showCheckbox && (
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={!!(row.id && selectedIds?.has(row.id))}
                    onChange={() => row.id && toggleRow(row.id)}
                    className="w-4 h-4 rounded border-ui-border-strong text-ui-primary focus:ring-ui-ring" />
                </td>
              )}
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-3 text-ui-text ${col.className || ''}`}>
                  {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as ReactNode}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
