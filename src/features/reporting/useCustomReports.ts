import { useCallback, useMemo, useState } from 'react';
import type { ReportFilters } from './reportFilters';

const STORAGE_KEY = 'premire_custom_reports';

export interface SavedReportConfig {
  id: string;
  name: string;
  reportType: string;
  visibleColumns: string[] | null;
  filters: ReportFilters;
  createdAt: string;
}

function loadAll(): Record<string, SavedReportConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, SavedReportConfig>;
  } catch {
    return {};
  }
}

function persist(all: Record<string, SavedReportConfig>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function useCustomReports() {
  const [all, setAll] = useState<Record<string, SavedReportConfig>>(loadAll);

  const savedReports = useMemo(() => Object.values(all).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [all]);

  const saveReport = useCallback(
    (name: string, reportType: string, visibleColumns: string[] | null, filters: ReportFilters) => {
      const id = crypto.randomUUID();
      const config: SavedReportConfig = { id, name, reportType, visibleColumns, filters, createdAt: new Date().toISOString() };
      setAll((prev) => {
        const next = { ...prev, [id]: config };
        persist(next);
        return next;
      });
    },
    [],
  );

  const deleteReport = useCallback((id: string) => {
    setAll((prev) => {
      const rest = Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id));
      persist(rest);
      return rest;
    });
  }, []);

  const getReport = useCallback((id: string) => all[id], [all]);

  return { savedReports, saveReport, deleteReport, getReport };
}