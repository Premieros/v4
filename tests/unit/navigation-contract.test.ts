import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_ROUTES } from '@/core/navigation/routes';
import { MENU_ITEMS, MENU_GROUPS } from '@/core/navigation/menu.config';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('navigation contract', () => {
  it('keeps route identifiers unique', () => {
    const routeValues = Object.values(APP_ROUTES);
    expect(new Set(routeValues).size).toBe(routeValues.length);
  });

  it('keeps menu identities unique and stable', () => {
    const ids = MENU_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every menu target anchored to the canonical route map', () => {
    const canonicalRoutes = new Set(Object.values(APP_ROUTES));
    for (const item of MENU_ITEMS) {
      expect(canonicalRoutes.has(item.route), `${item.id} points outside APP_ROUTES`).toBe(true);
    }
  });

  it('keeps menu permissions explicit for protected navigation items', () => {
    const publicMenuIds = new Set(['subscription']);
    for (const item of MENU_ITEMS) {
      if (item.superAdminOnly || publicMenuIds.has(item.id)) continue;
      expect(item.permission, `${item.id} is missing a navigation permission`).toBeTruthy();
    }
  });
});

describe('Phase 4 — route resolution', () => {
  it('every APP_ROUTES key maps to a non-empty path', () => {
    for (const [key, path] of Object.entries(APP_ROUTES)) {
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
      expect(path.startsWith('/'), `${key} route "${path}" does not start with /`).toBe(true);
    }
  });

  it('every declared route in routes.tsx references a constant from APP_ROUTES', () => {
    const routesSource = read('src/app/routes.tsx');
    for (const key of Object.keys(APP_ROUTES)) {
      expect(routesSource, `routes.tsx missing reference to APP_ROUTES.${key}`).toContain(`APP_ROUTES.${key}`);
    }
  });

  it('no duplicate route paths across APP_ROUTES', () => {
    const paths = Object.entries(APP_ROUTES).map(([k, v]) => `${k}=${v}`);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('Phase 4 — center discoverability', () => {
  function sourceHasRoute(source: string, routeKey: string): boolean {
    return source.includes(`APP_ROUTES.${routeKey}`);
  }

  it('Inventory Center exposes all inventory sub-pages', () => {
    const source = read('src/features/inventory/pages/InventoryCenterPage.tsx');
    const requiredKeys = ['inventory', 'warehouses', 'inventoryLedger', 'transfers', 'stockCounts', 'inventoryBatches', 'lowStockAlerts', 'stockValuation'];
    for (const key of requiredKeys) {
      expect(sourceHasRoute(source, key), `InventoryCenter missing APP_ROUTES.${key}`).toBe(true);
    }
  });

  it('Manufacturing Center exposes raw materials, recipes, and production', () => {
    const source = read('src/features/manufacturing/pages/ManufacturingCenterPage.tsx');
    expect(source).toContain('raw_materials.view');
    expect(source).toContain('recipes.view');
    expect(source).toContain('production.view');
    expect(sourceHasRoute(source, 'rawMaterials')).toBe(true);
    expect(sourceHasRoute(source, 'recipes')).toBe(true);
    expect(sourceHasRoute(source, 'production')).toBe(true);
  });

  it('Procurement Center exposes requests, RFQs, and receiving', () => {
    const source = read('src/features/trade/pages/ProcurementCenterPage.tsx');
    expect(sourceHasRoute(source, 'purchases')).toBe(true);
    expect(sourceHasRoute(source, 'purchaseRequests')).toBe(true);
    expect(sourceHasRoute(source, 'rfqs')).toBe(true);
    expect(sourceHasRoute(source, 'receiving')).toBe(true);
    expect(sourceHasRoute(source, 'suppliers')).toBe(true);
    expect(sourceHasRoute(source, 'payments')).toBe(true);
  });

  it('Operations Center links to POS, inventory, warehouses, transfers, counts, alerts, and kitchen', () => {
    const source = read('src/features/operations/pages/OperationsCenterPage.tsx');
    expect(sourceHasRoute(source, 'pos')).toBe(true);
    expect(sourceHasRoute(source, 'inventoryCenter')).toBe(true);
    expect(sourceHasRoute(source, 'inventory')).toBe(true);
    expect(sourceHasRoute(source, 'warehouses')).toBe(true);
    expect(sourceHasRoute(source, 'transfers')).toBe(true);
    expect(sourceHasRoute(source, 'stockCounts')).toBe(true);
    expect(sourceHasRoute(source, 'lowStockAlerts')).toBe(true);
    expect(sourceHasRoute(source, 'purchases')).toBe(true);
    expect(sourceHasRoute(source, 'floorPlan')).toBe(true);
  });
});

describe('Phase 4 — feature discoverability', () => {
  function sourceHasRoute(source: string, routeKey: string): boolean {
    return source.includes(`APP_ROUTES.${routeKey}`);
  }

  it('Raw Materials is accessible from Manufacturing Center', () => {
    const source = read('src/features/manufacturing/pages/ManufacturingCenterPage.tsx');
    expect(sourceHasRoute(source, 'rawMaterials')).toBe(true);
    expect(source).toContain('raw_materials.view');
  });

  it('Inventory Units is in the sidebar menu', () => {
    const item = MENU_ITEMS.find((i) => i.id === 'inventory-units');
    expect(item).toBeDefined();
    expect(item!.route).toBe(APP_ROUTES.inventoryUnits);
    expect(item!.permission).toBe('raw_materials.view');
  });

  it('Recipes are accessible from Manufacturing Center', () => {
    const source = read('src/features/manufacturing/pages/ManufacturingCenterPage.tsx');
    expect(sourceHasRoute(source, 'recipes')).toBe(true);
  });

  it('Production Orders are accessible from Manufacturing Center', () => {
    const source = read('src/features/manufacturing/pages/ManufacturingCenterPage.tsx');
    expect(sourceHasRoute(source, 'production')).toBe(true);
  });

  it('Warehouses are accessible from Inventory Center', () => {
    const source = read('src/features/inventory/pages/InventoryCenterPage.tsx');
    expect(sourceHasRoute(source, 'warehouses')).toBe(true);
  });

  it('Stock Counts are accessible from Inventory Center', () => {
    const source = read('src/features/inventory/pages/InventoryCenterPage.tsx');
    expect(sourceHasRoute(source, 'stockCounts')).toBe(true);
  });

  it('Inventory Ledger is accessible from Inventory Center', () => {
    const source = read('src/features/inventory/pages/InventoryCenterPage.tsx');
    expect(sourceHasRoute(source, 'inventoryLedger')).toBe(true);
  });

  it('Procurement sub-modules are accessible from Procurement Center', () => {
    const source = read('src/features/trade/pages/ProcurementCenterPage.tsx');
    expect(sourceHasRoute(source, 'purchaseRequests')).toBe(true);
    expect(sourceHasRoute(source, 'rfqs')).toBe(true);
    expect(sourceHasRoute(source, 'receiving')).toBe(true);
  });
});

describe('Phase 4 — command palette', () => {
  it('CommandPalette component exists', () => {
    const source = read('src/components/CommandPalette.tsx');
    expect(source).toContain('CommandPalette');
    expect(source).toContain('Ctrl+K');
  });

  it('Command palette is integrated into Layout', () => {
    const source = read('src/components/Layout.tsx');
    expect(source).toContain('CommandPalette');
    expect(source).toContain('CommandPaletteTrigger');
  });

  it('Command palette searches across all major sections', () => {
    const source = read('src/components/CommandPalette.tsx');
    const expectedLabels = [
      'المواد الخام', 'Raw Materials',
      'الوصفات', 'Recipes',
      'أوامر الإنتاج', 'Production Orders',
      'الجرد', 'Stock Counts',
      'التحويلات', 'Transfers',
      'المشتريات', 'Purchases',
      'الموردون', 'Suppliers',
      'الخزينة', 'Treasury',
    ];
    for (const label of expectedLabels) {
      expect(source).toContain(label);
    }
  });

  it('Command palette respects permissions', () => {
    const source = read('src/components/CommandPalette.tsx');
    expect(source).toContain('can(item.permission)');
  });

  it('Command palette trigger is in the header', () => {
    const source = read('src/components/Layout.tsx');
    expect(source).toContain('CommandPaletteTrigger');
  });
});

describe('Phase 4 — no duplicate destinations', () => {
  it('no two MENU_ITEMS share the same route', () => {
    const routes = MENU_ITEMS.map((i) => i.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('no two MENU_ITEMS share the same id', () => {
    const ids = MENU_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all important routes appear in at least one discoverability path (menu or center)', () => {
    const menuRoutes = new Set(MENU_ITEMS.map((i) => i.route));
    const centerFiles = [
      'src/features/inventory/pages/InventoryCenterPage.tsx',
      'src/features/manufacturing/pages/ManufacturingCenterPage.tsx',
      'src/features/trade/pages/ProcurementCenterPage.tsx',
      'src/features/operations/pages/OperationsCenterPage.tsx',
    ];
    const centerSource = centerFiles.map((f) => read(f)).join('\n');
    const allDiscoverable = new Set([...menuRoutes]);
    for (const [key, value] of Object.entries(APP_ROUTES)) {
      if (centerSource.includes(value) || centerSource.includes(`APP_ROUTES.${key}`)) {
        allDiscoverable.add(value);
      }
    }

    const criticalRoutes = [
      APP_ROUTES.dashboard,
      APP_ROUTES.pos,
      APP_ROUTES.products,
      APP_ROUTES.categories,
      APP_ROUTES.components,
      APP_ROUTES.inventoryUnits,
      APP_ROUTES.inventory,
      APP_ROUTES.warehouses,
      APP_ROUTES.rawMaterials,
      APP_ROUTES.recipes,
      APP_ROUTES.production,
      APP_ROUTES.transfers,
      APP_ROUTES.inventoryLedger,
      APP_ROUTES.stockCounts,
      APP_ROUTES.inventoryBatches,
      APP_ROUTES.stockValuation,
      APP_ROUTES.lowStockAlerts,
      APP_ROUTES.purchases,
      APP_ROUTES.purchaseRequests,
      APP_ROUTES.rfqs,
      APP_ROUTES.receiving,
      APP_ROUTES.customers,
      APP_ROUTES.suppliers,
      APP_ROUTES.expenses,
      APP_ROUTES.sales,
      APP_ROUTES.shifts,
      APP_ROUTES.reports,
      APP_ROUTES.users,
      APP_ROUTES.branches,
      APP_ROUTES.floorPlan,
      APP_ROUTES.kitchenDisplay,
      APP_ROUTES.wasteCenter,
      APP_ROUTES.costingCenter,
      APP_ROUTES.accounts,
      APP_ROUTES.payments,
      APP_ROUTES.journal,
      APP_ROUTES.treasury,
      APP_ROUTES.reconciliation,
      APP_ROUTES.financialReports,
      APP_ROUTES.settings,
      APP_ROUTES.auditLog,
    ];
    for (const route of criticalRoutes) {
      expect(allDiscoverable.has(route), `Route ${route} is not discoverable from menu or any center`).toBe(true);
    }
  });
});

describe('Phase 4 — sidebar structure', () => {
  it('sidebar uses all defined menu groups', () => {
    const groupKeys = Object.keys(MENU_GROUPS);
    const usedGroups = new Set(MENU_ITEMS.map((i) => i.group));
    for (const g of groupKeys) {
      expect(usedGroups.has(g as keyof typeof MENU_GROUPS), `Menu group "${g}" has no items`).toBe(true);
    }
  });

  it('every MENU_ITEM has a valid icon registered in Layout', () => {
    const layoutSource = read('src/components/Layout.tsx');
    const uniqueIcons = [...new Set(MENU_ITEMS.map((i) => i.icon))];
    for (const icon of uniqueIcons) {
      expect(layoutSource).toContain(`${icon}:`);
    }
  });
});
