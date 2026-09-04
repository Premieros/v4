import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { APP_ROUTES } from '@/core/navigation/routes';
import { MENU_ITEMS } from '@/core/navigation/menu.config';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = join(dir, entry.name);
  if (entry.name === 'node_modules' || entry.name === 'dist') return [];
  if (entry.isDirectory()) return sourceFiles(full);
  return /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
});

describe('navigation regressions', () => {
  it('keeps dashboard KPI and report links mapped to intended destinations', () => {
    const source = read('src/features/dashboard/pages/VisualDashboardPage.tsx');
    expect(source).toContain('reportType=sales');
    expect(source).toContain('reportType=sales_by_payment');
    expect(source).toContain('reportType=sales_by_product');
    expect(source).toContain('reportType=detailed_invoices');
    expect(source).toContain('to="/inventory"');
    expect(source).toContain('setCompareEnabled');
    expect(source).toContain('setFilterOpen');
    expect(source).not.toContain('sales_by_branch');
    expect(source).not.toContain('/pos/active');
  });

  it('keeps the POS bottom navigation opening the active orders drawer', () => {
    const source = read('src/features/pos/components/bottom/PosBottomNav.tsx');
    expect(source).toContain("'الطلبات النشطة' : 'Active orders'");
    expect(source).toContain("onOpenOrders('all')");
    expect(source).not.toContain('onSelect(type)');
  });

  it('uses one shared shell and declarative navigation configuration', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('MENU_ITEMS');
    expect(layout).toContain('APP_ROUTES');
    expect(layout).toContain('MENU_GROUPS');
    expect(layout).toContain("navigate('/floor-plan')");
    expect(layout).toContain("user?.role === 'super_admin'");
    expect(MENU_ITEMS.length).toBeGreaterThan(0);
  });

  it('keeps legacy navigation aliases backed by canonical route constants', () => {
    const routes = read('src/app/routes.tsx');
    expect(routes).toContain('APP_ROUTES.accounting');
    expect(routes).toContain('APP_ROUTES.employees');
    expect(routes).toContain('APP_ROUTES.financialReports');
    expect(routes).toContain('APP_ROUTES.users');
    expect(APP_ROUTES.accounting).toBe('/accounting');
    expect(APP_ROUTES.employees).toBe('/employees');
  });

  it('rejects obvious dead navigation placeholders across the application', () => {
    const files = sourceFiles(resolve(root, 'src'));
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (/href\s*=\s*["']#|to\s*=\s*["']#|javascript:/i.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('sidebar uses logical inline positioning for RTL/LTR correctness', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain("ar ? 'start-0' : 'end-0'");
    expect(layout).not.toMatch(/fixed[^`]*\bright-0\b/);
    expect(layout).not.toMatch(/fixed[^`]*\bleft-0\b/);
    expect(layout).toContain('fixed top-0 bottom-0');
    expect(layout).toContain('fixed top-0 start-0 end-0');
    expect(layout).toContain('pt-[64px]');
  });
});
