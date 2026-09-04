import { useState, useCallback } from 'react';
import { ReportingShell } from '../ReportingShell';
import { ReportsPage } from './ReportsPage';
import type { ReportType } from '../reportFilters';

export function ReportsCenterPage() {
  const [activeReport, setActiveReport] = useState<ReportType>('sales');
  const handleSelect = useCallback((type: ReportType) => setActiveReport(type), []);

  return (
    <ReportingShell activeReport={activeReport} onSelectReport={handleSelect}>
      <ReportsPage controlledReportType={activeReport} onReportTypeChange={handleSelect} />
    </ReportingShell>
  );
}
