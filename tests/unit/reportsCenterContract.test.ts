import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const reportsSource = read('src/features/reporting/pages/ReportsPage.tsx');
const reportFilterBarSource = read('src/features/reporting/ReportFilterBar.tsx');
const deepLinkSource = read('src/features/reporting/pages/ReportDeepLinkPage.tsx');
const financialSource = read('src/features/accounting/pages/FinancialReportsPage.tsx');
const reportFiltersSource = read('src/features/reporting/reportFilters.ts');
const reportExportSource = read('src/lib/reportExport.ts');
const excelSource = read('src/lib/excel.ts');

const OPERATIONAL_KEYS = [
  'sales', 'sales_by_payment', 'sales_by_employee', 'sales_by_product', 'detailed_invoices',
  'purchases', 'expenses', 'profit', 'inventory', 'component_consumption', 'recipe_costs',
  'top_consumed_components', 'top_consumed_products', 'low_stock',
];

const FINANCIAL_KEYS = [
  'trial_balance', 'ledger', 'income', 'balance_sheet', 'ar_aging', 'ap_aging',
  'aging_summary', 'cash_flow', 'party_statement',
];

describe('Reports Center contract (6H-P4)', () => {
  it('provides a report-type dropdown covering all 14 operational types', () => {
    expect(reportFilterBarSource).toContain('data-testid="report-type-select"');
    expect(reportFilterBarSource).toContain('data-testid="report-context-filter"');
    expect(reportFilterBarSource).toContain('key={rt.key} value={rt.key}');
    expect(reportFilterBarSource).toContain('key={ft.key} value={ft.key}');
    for (const key of OPERATIONAL_KEYS) {
      expect(reportsSource).toContain(`{ key: '${key}',`);
    }
  });

  it('exposes financial report types in the dropdown only behind reports.financial permission', () => {
    expect(reportsSource).toContain("can('reports.financial')");
    for (const key of FINANCIAL_KEYS) expect(reportsSource).toContain(`{ key: '${key}'`);
  });

  it('preserves the stable button[data-report-type="<key>"] contract for every report', () => {
    expect(reportFilterBarSource).toContain('data-report-type={rt.key}');
    expect(reportFilterBarSource).toContain('data-report-type={ft.key}');
    expect(deepLinkSource).toContain('button[data-report-type="');
    expect(reportFilterBarSource).toContain('reportTypes.map((rt)');
    expect(reportFilterBarSource).toContain('financialTypes.map((ft)');
  });

  it('keeps /reports?reportType=… deep links resolving to the reports route', () => {
    expect(deepLinkSource).toContain("searchParams.get('reportType')");
    expect(deepLinkSource).toContain('ReportsPage');
  });

  it('navigates financial selections to the financial reports page with view + period context', () => {
    expect(reportsSource).toContain('navigate(`/financial-reports?view=${value}&from=${from}&to=${to}`)');
    expect(financialSource).toContain('useSearchParams');
    expect(financialSource).toContain("searchParams.get('view')");
    expect(financialSource).toContain("searchParams.get('from')");
    expect(financialSource).toContain("searchParams.get('to')");
    expect(financialSource).toContain('data-report-type={v.key}');
  });

  it('provides a contextual period filter that drives from/to', () => {
    expect(reportFilterBarSource).toContain('value="custom"');
    expect(reportFilterBarSource).toContain('value="today"');
    expect(reportFilterBarSource).toContain('value="yesterday"');
    expect(reportFilterBarSource).toContain('value="last7"');
    expect(reportFilterBarSource).toContain('value="last30"');
    expect(reportFilterBarSource).toContain('value="this_month"');
    expect(reportFilterBarSource).toContain('value="last_month"');
    expect(reportFilterBarSource).toContain('value="this_year"');
    expect(reportFilterBarSource).toContain('onPeriodChange');
  });

  it('shows only the filters relevant to the selected report (ERP-01 §6)', () => {
    expect(reportFilterBarSource).toContain('data-testid="report-contextual-filters"');
    expect(reportFilterBarSource).toContain('data-filter-dim={dim}');
    expect(reportFilterBarSource).toContain('filterDimensions');
    expect(reportFilterBarSource).toContain('showDate');
    expect(reportFiltersSource).toContain('REPORT_FILTER_DIMS');
    expect(reportFiltersSource).toContain('DATE_DRIVEN_REPORTS');
  });

  it('applies contextual filters to real queries via column-scoped builders', () => {
    expect(reportFiltersSource).toContain('applySalesFilters');
    expect(reportFiltersSource).toContain('applySaleItemFilters');
    expect(reportFiltersSource).toContain('applyPurchaseFilters');
    expect(reportFiltersSource).toContain('applyExpenseFilters');
    expect(reportFiltersSource).toContain('applyProductScopedFilters');
    expect(reportsSource).toContain('filterQ(q, filters, applySalesFilters)');
    expect(reportsSource).toContain('filterQ(q, filters, applyPurchaseFilters)');
    expect(reportsSource).toContain('filterQ(q, filters, applyExpenseFilters)');
  });

  it('offers Excel, CSV and print/PDF output from the report page', () => {
    expect(reportsSource).toContain('exportToExcel');
    expect(reportsSource).toContain('downloadCSV');
    expect(reportsSource).toContain('openPrintWindow');
    expect(reportsSource).toContain("t('exportExcel')");
    expect(reportsSource).toContain("t('exportCsv')");
    expect(reportsSource).toContain("t('print')");
    expect(reportExportSource).toContain('downloadCSV');
    expect(reportExportSource).toContain('openPrintWindow');
    expect(reportExportSource).toContain('text/csv;charset=utf-8');
  });

  it('provides compact grouped navigation and column customization', () => {
    expect(deepLinkSource).toContain('مركز التقارير');
    expect(deepLinkSource).toContain('data-report-nav={key}');
    expect(deepLinkSource).toContain('تخصيص الأعمدة');
    expect(deepLinkSource).toContain('premier.report.columns.');
  });

  it('keeps Excel exports spreadsheet-friendly with widths, filters and frozen headers', () => {
    expect(excelSource).toContain("ws['!cols']");
    expect(excelSource).toContain("ws['!autofilter']");
    expect(excelSource).toContain("ws['!freeze']");
  });

  it('resets contextual filters when switching report type', () => {
    expect(reportsSource).toContain('setFilters({})');
  });
});
