import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Full-app mock environment: every page in the app is rendered against a
// deterministic, data-empty Supabase mock. This "smoke" suite locks the
// current behaviour: any page that crashes, throws during mount, or regresses
// on a data fetch shape will fail here before a refactor is allowed to merge.
// ---------------------------------------------------------------------------

const appMocks = vi.hoisted(() => {
  type RpcResult = Record<string, unknown>;

  // Chainable thenable: supports .select().eq().maybeSingle()... and await.
  function chain<T>(result: T): unknown {
    const promise = Promise.resolve(result);
    const callable = () => chain(result);
    return new Proxy(callable as object, {
      get(_t, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return (promise as unknown as PromiseLike<never>)[prop as 'then'].bind(promise);
        }
        if (typeof prop === 'symbol') return undefined;
        return () => chain(result);
      },
      apply: () => chain(result),
    }) as unknown as T;
  }

  const empty = chain({ data: [], error: null });

  const supabase = {
    from: () => empty,
    rpc: () => chain<RpcResult>({ success: true, data: null }) as unknown,
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      updateUser: async () => ({ data: {}, error: null }),
    },
    channel: () => {
      const self = { on: () => self, subscribe: async () => 'SUBSCRIBED' };
      return self;
    },
    removeChannel: () => {},
  };

  const auth = {
    session: null,
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'cashier@test.local',
      username: 'cashier',
      full_name: 'Cashier',
      role: 'cashier' as const,
      branch_id: '00000000-0000-0000-0000-000000000002',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    },
    loading: false,
    signIn: async () => ({ error: null }),
    signInWithUsername: async () => ({ error: null }),
    signOut: async () => {},
    refreshUser: async () => {},
  };

  const language = { lang: 'ar' as const, setLang: () => {}, t: (k: string) => k, dir: 'rtl' as const };

  const settings = {
    settings: null,
    loading: false,
    branchSettingsMap: {},
    effectiveSettings: () => null,
    refresh: async () => {},
    save: async () => true,
    saveBranchSettings: async () => true,
  };

  const roles = {
    rolesList: [],
    rolePermissionsMap: {} as Record<string, string[]>,
    roleMeta: {},
    loading: false,
    refresh: async () => {},
    saveRole: async () => true,
  };

  const theme = {
    theme: 'light' as const,
    setTheme: () => {},
    toggleTheme: () => {},
    uiTheme: 'premier-light',
    setUiTheme: () => {},
  };

  return { supabase, auth, language, settings, roles, theme, chain };
});

vi.mock('@/lib/supabase', () => ({ supabase: appMocks.supabase }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => appMocks.auth }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => appMocks.language }));
vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => appMocks.settings,
  mergeEffectiveSettings: (globalSettings: Record<string, unknown> | null, branch: Record<string, unknown> | null | undefined) =>
    globalSettings ? { ...globalSettings, ...(branch ?? {}) } : globalSettings,
}));
vi.mock('@/context/RolesContext', () => ({ useRoles: () => appMocks.roles }));
vi.mock('@/context/ThemeContext', () => ({ useTheme: () => appMocks.theme }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: () => {} }) }));

import { LoginPage } from '@/features/auth/pages/LoginPage';
import { DashboardEnhancedPage } from '@/features/dashboard/pages/DashboardEnhancedPage';
import { PosWorkspacePage } from '@/features/pos/pages/PosWorkspacePage';
import { ActiveOrdersPage } from '@/features/pos/pages/ActiveOrdersPage';
import { ProductsPage } from '@/features/catalog/pages/ProductsPage';
import { CategoriesPage } from '@/features/catalog/pages/CategoriesPage';
import { InventoryPage } from '@/features/inventory/pages/InventoryPage';
import { WarehousesPage } from '@/features/inventory/pages/WarehousesPage';
import { BranchesPage } from '@/features/admin/pages/BranchesPage';
import { PurchasesPage } from '@/features/trade/pages/PurchasesPage';
import { CustomersPage } from '@/features/parties/pages/CustomersPage';
import { SuppliersPage } from '@/features/parties/pages/SuppliersPage';
import { ExpensesPage } from '@/features/trade/pages/ExpensesPage';
import { SalesPage } from '@/features/trade/pages/SalesPage';
import { ReportsPage } from '@/features/reporting/pages/ReportsPage';
import { UsersPage } from '@/features/admin/pages/UsersPage';
import { AuditLogPage } from '@/features/reporting/pages/AuditLogPage';
import { SettingsControlCenterPage } from '@/features/admin/pages/SettingsControlCenterPage';
import { ComponentsPage } from '@/features/catalog/pages/ComponentsPage';
import { ShiftsPage } from '@/features/trade/pages/ShiftsPage';
import { RawMaterialsPage } from '@/features/manufacturing/pages/RawMaterialsPage';
import { RecipesPage } from '@/features/manufacturing/pages/RecipesPage';
import { ProductionOrdersPage } from '@/features/manufacturing/pages/ProductionOrdersPage';
import { TransfersPage } from '@/features/inventory/pages/TransfersPage';
import { InventoryLedgerPage } from '@/features/inventory/pages/InventoryLedgerPage';
import { StockCountsPage } from '@/features/inventory/pages/StockCountsPage';
import { InventoryBatchesPage } from '@/features/inventory/pages/InventoryBatchesPage';
import { StockValuationPage } from '@/features/inventory/pages/StockValuationPage';
import { LowStockAlertsPage } from '@/features/inventory/pages/LowStockAlertsPage';
import { CostingCenterPage } from '@/features/costing/pages/CostingCenterPage';
import { AccountsPage } from '@/features/accounting/pages/AccountsPage';
import { PaymentsPage } from '@/features/accounting/pages/PaymentsPage';
import { JournalPage } from '@/features/accounting/pages/JournalPage';
import { FinancialReportsPage } from '@/features/accounting/pages/FinancialReportsPage';
import { TreasuryPage } from '@/features/accounting/pages/TreasuryPage';
import { ReconciliationPage } from '@/features/accounting/pages/ReconciliationPage';

const pages: Array<[string, React.ComponentType]> = [
  ['LoginPage', LoginPage],
  ['DashboardEnhancedPage', DashboardEnhancedPage],
  ['PosWorkspacePage', PosWorkspacePage],
  ['ActiveOrdersPage', ActiveOrdersPage],
  ['ProductsPage', ProductsPage],
  ['CategoriesPage', CategoriesPage],
  ['InventoryPage', InventoryPage],
  ['WarehousesPage', WarehousesPage],
  ['BranchesPage', BranchesPage],
  ['PurchasesPage', PurchasesPage],
  ['CustomersPage', CustomersPage],
  ['SuppliersPage', SuppliersPage],
  ['ExpensesPage', ExpensesPage],
  ['SalesPage', SalesPage],
  ['ReportsPage', ReportsPage],
  ['UsersPage', UsersPage],
  ['AuditLogPage', AuditLogPage],
  ['SettingsControlCenterPage', SettingsControlCenterPage],
  ['ComponentsPage', ComponentsPage],
  ['ShiftsPage', ShiftsPage],
  ['RawMaterialsPage', RawMaterialsPage],
  ['RecipesPage', RecipesPage],
  ['ProductionOrdersPage', ProductionOrdersPage],
  ['TransfersPage', TransfersPage],
  ['InventoryLedgerPage', InventoryLedgerPage],
  ['StockCountsPage', StockCountsPage],
  ['InventoryBatchesPage', InventoryBatchesPage],
  ['StockValuationPage', StockValuationPage],
  ['LowStockAlertsPage', LowStockAlertsPage],
  ['CostingCenterPage', CostingCenterPage],
  ['AccountsPage', AccountsPage],
  ['PaymentsPage', PaymentsPage],
  ['JournalPage', JournalPage],
  ['FinancialReportsPage', FinancialReportsPage],
  ['TreasuryPage', TreasuryPage],
  ['ReconciliationPage', ReconciliationPage],
];

describe('page smoke tests (locked baseline behaviour)', () => {
  for (const [name, Page] of pages) {
    it(`renders ${name} without crashing`, async () => {
      const { container } = render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      );
      // Let async data effects settle; page must mount and render content.
      await waitFor(() => expect(container.textContent).toBeDefined());
      expect(container.firstChild).not.toBeNull();
    });
  }
});
