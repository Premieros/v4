import type { Permission } from '@/lib/permissions';
import type { TranslationKey } from '@/lib/i18n';
import { APP_ROUTES, type AppRoute } from './routes';

export type MenuGroup = 'main' | 'catalog' | 'operations' | 'centers' | 'people' | 'finance' | 'admin';
export type MenuIcon =
  | 'dashboard' | 'pos' | 'products' | 'categories' | 'components' | 'rawMaterials' | 'recipes' | 'inventory' | 'warehouses' | 'transfers'
  | 'inventoryLedger' | 'stockCounts' | 'inventoryBatches' | 'stockValuation' | 'lowStockAlerts' | 'inventoryUnits' | 'wasteCenter' | 'kitchenDisplay' | 'kitchenStations' | 'costingCenter' | 'branches' | 'purchases' | 'customers' | 'suppliers' | 'expenses'
  | 'accounts' | 'payments' | 'journal' | 'treasury' | 'reconciliation' | 'financialReports' | 'sales' | 'shifts' | 'reports' | 'users' | 'auditLog' | 'settings' | 'superAdmin' | 'importExport';

export interface MenuItemConfig {
  id: string;
  route: AppRoute;
  icon: MenuIcon;
  labelKey: TranslationKey;
  permission?: Permission;
  group: MenuGroup;
  superAdminOnly?: boolean;
  ownerOnly?: boolean;
}

export const MENU_GROUPS: Record<MenuGroup, { ar: string; en: string }> = {
  main: { ar: 'الرئيسية', en: 'Main' },
  catalog: { ar: 'الكتالوج والوصفات', en: 'Catalog & Recipes' },
  operations: { ar: 'العمليات', en: 'Operations' },
  centers: { ar: 'مراكز الإدارة', en: 'Management Centers' },
  people: { ar: 'الأطراف', en: 'People' },
  finance: { ar: 'المالية', en: 'Finance' },
  admin: { ar: 'الإدارة', en: 'Admin' },
};

export const MENU_ITEMS: MenuItemConfig[] = [
  { id: 'dashboard', route: APP_ROUTES.dashboard, icon: 'dashboard', labelKey: 'dashboard', permission: 'dashboard.view', group: 'main' },
  { id: 'pos', route: APP_ROUTES.pos, icon: 'pos', labelKey: 'pos', permission: 'pos.sell', group: 'main' },
  { id: 'kitchen-display', route: APP_ROUTES.kitchenDisplay, icon: 'kitchenDisplay', labelKey: 'kitchenDisplay', permission: 'pos.sell', group: 'main' },
  
  { id: 'operations-center', route: APP_ROUTES.operationsCenter, icon: 'pos', labelKey: 'orders', permission: 'dashboard.view', group: 'centers' },
  { id: 'inventory-center', route: APP_ROUTES.inventoryCenter, icon: 'inventory', labelKey: 'inventory', permission: 'inventory.view', group: 'centers' },
  { id: 'procurement-center', route: APP_ROUTES.procurementCenter, icon: 'purchases', labelKey: 'purchases', permission: 'purchases.view', group: 'centers' },
  { id: 'waste-center', route: APP_ROUTES.wasteCenter, icon: 'wasteCenter', labelKey: 'wasteCenter', permission: 'production.waste', group: 'centers' },
  
  { id: 'products', route: APP_ROUTES.products, icon: 'products', labelKey: 'products', permission: 'products.view', group: 'catalog' },
  { id: 'recipes', route: APP_ROUTES.recipes, icon: 'recipes', labelKey: 'recipes', permission: 'recipes.view', group: 'catalog' },
  { id: 'raw-materials', route: APP_ROUTES.rawMaterials, icon: 'rawMaterials', labelKey: 'rawMaterials', permission: 'raw_materials.view', group: 'catalog' },
  { id: 'categories', route: APP_ROUTES.categories, icon: 'categories', labelKey: 'categories', permission: 'categories.view', group: 'catalog' },
  { id: 'components', route: APP_ROUTES.components, icon: 'components', labelKey: 'components', permission: 'components.view', group: 'catalog' },
  { id: 'inventory-units', route: APP_ROUTES.inventoryUnits, icon: 'inventoryUnits', labelKey: 'inventoryUnits', permission: 'raw_materials.view', group: 'catalog' },
  
  { id: 'branches', route: APP_ROUTES.branches, icon: 'branches', labelKey: 'branches', permission: 'branches.manage', group: 'operations' },
  { id: 'import-export', route: APP_ROUTES.importExport, icon: 'importExport', labelKey: 'importExport', permission: 'settings.manage', group: 'operations' },
  
  { id: 'customers', route: APP_ROUTES.customers, icon: 'customers', labelKey: 'customers', permission: 'customers.view', group: 'people' },
  { id: 'suppliers', route: APP_ROUTES.suppliers, icon: 'suppliers', labelKey: 'suppliers', permission: 'suppliers.view', group: 'people' },
  
  { id: 'expenses', route: APP_ROUTES.expenses, icon: 'expenses', labelKey: 'expenses', permission: 'expenses.view', group: 'finance' },
  { id: 'costing-center', route: APP_ROUTES.costingCenter, icon: 'costingCenter', labelKey: 'costingCenter', permission: 'reports.costing', group: 'finance' },
  { id: 'accounts', route: APP_ROUTES.accounts, icon: 'accounts', labelKey: 'chartOfAccounts', permission: 'accounts.view', group: 'finance' },
  { id: 'payments', route: APP_ROUTES.payments, icon: 'payments', labelKey: 'receivePayment', permission: 'accounts.view', group: 'finance' },
  { id: 'journal', route: APP_ROUTES.journal, icon: 'journal', labelKey: 'journalEntries', permission: 'accounts.view', group: 'finance' },
  { id: 'treasury', route: APP_ROUTES.treasury, icon: 'treasury', labelKey: 'treasury', permission: 'accounts.view', group: 'finance' },
  { id: 'reconciliation', route: APP_ROUTES.reconciliation, icon: 'reconciliation', labelKey: 'bankReconciliation', permission: 'accounts.view', group: 'finance' },
  { id: 'financial-reports', route: APP_ROUTES.financialReports, icon: 'financialReports', labelKey: 'financialReports', permission: 'reports.financial', group: 'finance' },
  { id: 'sales', route: APP_ROUTES.sales, icon: 'sales', labelKey: 'salesInvoices', permission: 'sales.view', group: 'finance' },
  { id: 'shifts', route: APP_ROUTES.shifts, icon: 'shifts', labelKey: 'shifts', permission: 'shifts.view', group: 'finance' },
  { id: 'reports', route: APP_ROUTES.reports, icon: 'reports', labelKey: 'reports', permission: 'reports.view', group: 'finance' },
  
  { id: 'super-admin', route: APP_ROUTES.superAdmin, icon: 'superAdmin', labelKey: 'superAdmin', permission: 'settings.manage', group: 'admin', superAdminOnly: true },
  { id: 'users', route: APP_ROUTES.users, icon: 'users', labelKey: 'users', permission: 'users.view', group: 'admin' },
  { id: 'audit-log', route: APP_ROUTES.auditLog, icon: 'auditLog', labelKey: 'auditLog', permission: 'audit.view', group: 'admin' },
  { id: 'settings', route: APP_ROUTES.settings, icon: 'settings', labelKey: 'settings', permission: 'settings.manage', group: 'admin' },
];
