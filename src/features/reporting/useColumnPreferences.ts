import { useState, useCallback } from 'react';

const STORAGE_KEY = 'premire_report_columns';

function readAll(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function useColumnPreferences(reportType: string) {
  const [stored, setStored] = useState<Record<string, string[]>>(() => readAll());

  const visibleColumns: string[] | null = stored[reportType] ?? null;

  const toggleColumn = useCallback((key: string) => {
    setStored((prev) => {
      const current = prev[reportType] ?? null;
      let next: string[] | null;
      if (current === null) {
        next = [key];
      } else if (current.includes(key)) {
        next = current.filter((c) => c !== key);
        if (next.length === 0) next = null;
      } else {
        next = [...current, key];
      }
      const updated = next === null ? { ...prev } : { ...prev, [reportType]: next };
      if (next === null) delete updated[reportType];
      writeAll(updated);
      return updated;
    });
  }, [reportType]);

  const showAllColumns = useCallback(() => {
    setStored((prev) => {
      const updated = { ...prev };
      delete updated[reportType];
      writeAll(updated);
      return updated;
    });
  }, [reportType]);

  return { visibleColumns, toggleColumn, showAllColumns };
}
