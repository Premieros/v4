import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Reporting system components (Phase 1-5)', () => {

  // --- reportRegistry.ts ---
  const registrySource = read('src/features/reporting/reportRegistry.ts');

  it('defines all 11 report categories', () => {
    const categories = ['overview', 'sales', 'purchases_expenses', 'inventory', 'manufacturing_costing', 'customers_suppliers', 'employees_shifts', 'treasury_payments', 'financial', 'analytics', 'audit'];
    for (const cat of categories) {
      expect(registrySource).toContain(`'${cat}'`);
    }
  });

  it('has REPORT_REGISTRY with all 17 report definitions (14 original + 3 new)', () => {
    expect(registrySource).toContain('REPORT_REGISTRY');
    const reportKeys = ['sales', 'sales_by_payment', 'sales_by_employee', 'sales_by_product', 'detailed_invoices', 'purchases', 'expenses', 'profit', 'inventory', 'component_consumption', 'recipe_costs', 'top_consumed_components', 'top_consumed_products', 'low_stock', 'cashier_performance', 'returns', 'production_waste'];
    for (const key of reportKeys) {
      expect(registrySource).toContain(`key: '${key}'`);
    }
  });

  it('exports search and filter helper functions', () => {
    expect(registrySource).toContain('export function getReportsByCategory');
    expect(registrySource).toContain('export function getReportByKey');
    expect(registrySource).toContain('export function filterReportsByPermission');
    expect(registrySource).toContain('export function searchReports');
  });

  it('each report definition has required fields', () => {
    expect(registrySource).toContain('category:');
    expect(registrySource).toContain('title:');
    expect(registrySource).toContain('description:');
    expect(registrySource).toContain('icon:');
    expect(registrySource).toContain('permissions:');
    expect(registrySource).toContain('filterDimensions:');
    expect(registrySource).toContain('dateDriven:');
  });

  // --- ReportingShell.tsx ---
  const shellSource = read('src/features/reporting/ReportingShell.tsx');

  it('ReportingShell renders search bar, categories, favorites, and recent sections', () => {
    expect(shellSource).toContain('searchQuery');
    expect(shellSource).toContain('activeCategory');
    expect(shellSource).toContain('favorites');
    expect(shellSource).toContain('recent');
  });

  it('ReportingShell supports localStorage for favorites and recent', () => {
    expect(shellSource).toContain('localStorage');
    expect(shellSource).toContain('FAVORITES_KEY');
    expect(shellSource).toContain('RECENT_KEY');
  });

  it('ReportingShell handles deep links via searchParams', () => {
    expect(shellSource).toContain("searchParams.get('type')");
    expect(shellSource).toContain("searchParams.get('reportType')");
  });

  // --- ReportCard.tsx ---
  const cardSource = read('src/features/reporting/ReportCard.tsx');

  it('ReportCard renders icon, title, description, and favorite button', () => {
    expect(cardSource).toContain('ICON_MAP');
    expect(cardSource).toContain('onToggleFavorite');
    expect(cardSource).toContain('isFavorite');
    expect(cardSource).toContain('Star');
  });

  // --- useColumnPreferences.ts ---
  const colPrefsSource = read('src/features/reporting/useColumnPreferences.ts');

  it('useColumnPreferences persists per-report column visibility', () => {
    expect(colPrefsSource).toContain('premire_report_columns');
    expect(colPrefsSource).toContain('toggleColumn');
    expect(colPrefsSource).toContain('showAllColumns');
    expect(colPrefsSource).toContain('visibleColumns');
  });

  // --- useCustomReports.ts ---
  const customReportsSource = read('src/features/reporting/useCustomReports.ts');

  it('useCustomReports manages saved report configs', () => {
    expect(customReportsSource).toContain('premire_custom_reports');
    expect(customReportsSource).toContain('saveReport');
    expect(customReportsSource).toContain('deleteReport');
    expect(customReportsSource).toContain('getReport');
    expect(customReportsSource).toContain('SavedReportConfig');
  });

  // --- ReportFilterBar.tsx ---
  const filterBarSource = read('src/features/reporting/ReportFilterBar.tsx');

  it('ReportFilterBar encapsulates all filter UI', () => {
    expect(filterBarSource).toContain('ReportFilterBar');
    expect(filterBarSource).toContain('filterDimensions');
    expect(filterBarSource).toContain('onFilterChange');
    expect(filterBarSource).toContain('onReportTypeChange');
    expect(filterBarSource).toContain('report-contextual-filters');
  });

  // --- ReportsCenterPage.tsx ---
  const centerSource = read('src/features/reporting/pages/ReportsCenterPage.tsx');

  it('ReportsCenterPage wraps ReportsPage in ReportingShell', () => {
    expect(centerSource).toContain('ReportingShell');
    expect(centerSource).toContain('ReportsPage');
    expect(centerSource).toContain('activeReport');
  });

  // --- ColumnPicker.tsx ---
  const colPickerSource = read('src/features/reporting/ColumnPicker.tsx');

  it('ColumnPicker provides column visibility toggle UI', () => {
    expect(colPickerSource).toContain('onToggle');
    expect(colPickerSource).toContain('visibleColumns');
    expect(colPickerSource).toContain('onShowAll');
    expect(colPickerSource).toContain('hiddenCount');
  });
});
