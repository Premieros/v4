import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const source = readFileSync(resolve(root, 'src/features/dashboard/pages/VisualDashboardPage.tsx'), 'utf8');

describe('VisualDashboardPage contract (6H-C)', () => {
  it('derives currency from effectiveSettings().currency, not a hardcoded value', () => {
    expect(source).toContain('effectiveSettings(effectiveBranch)');
    expect(source).toContain('settings?.currency');
    expect(source).toContain("'EGP'");
  });

  it('keeps a working admin branch picker wired to the global active branch', () => {
    expect(source).toContain('useActiveBranchId');
    expect(source).toContain('isAdmin ? activeBranchId : branchFilter');
    expect(source).toContain('data-testid="dashboard-branch-filter"');
    expect(source).toContain('setActiveBranchId');
  });

  it('keeps KPI deep links to the canonical report destinations', () => {
    expect(source).toContain('/reports?reportType=sales');
    expect(source).toContain('/reports?reportType=sales_by_payment');
    expect(source).toContain('/reports?reportType=sales_by_product');
    expect(source).toContain('/reports?reportType=detailed_invoices');
    expect(source).toContain('testId="kpi-net-sales"');
    expect(source).toContain('testId="kpi-net-payments"');
    expect(source).toContain('testId="kpi-orders"');
  });

  it('supports year range, previous-period comparison, order-type filter and export shortcuts', () => {
    expect(source).toContain("'year'");
    expect(source).toContain('compareEnabled');
    expect(source).toContain('data-testid="dashboard-compare-toggle"');
    expect(source).toContain('orderTypeFilter');
    expect(source).toContain('data-testid="dashboard-filter-button"');
    expect(source).toContain('data-testid="dashboard-export-button"');
  });

  it('never regresses to a no-op branch expression', () => {
    expect(source).not.toContain('isAdminRole(user?.role) ? branchFilter : branchFilter');
  });
});
