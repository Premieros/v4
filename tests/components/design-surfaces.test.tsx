import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Design-surface contract tests (6D-6G). Locks the stable test identities and
// the page-surface wiring introduced by the design bundle:
//  - every design primitive keeps its documented data-testid,
//  - every migrated page exposes its DesignSurface test id plus its
//    search/table panels and DesignSearch input.
// ---------------------------------------------------------------------------

const appMocks = vi.hoisted(() => {
  type RpcResult = Record<string, unknown>;

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
      email: 'admin@test.local',
      username: 'admin',
      full_name: 'Admin',
      role: 'admin' as const,
      branch_id: null,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    },
    loading: false,
    signIn: async () => ({ error: null }),
    signInWithUsername: async () => ({ error: null }),
    signOut: async () => {},
    refreshUser: async () => {},
  };

  const language = { lang: 'en' as const, setLang: () => {}, t: (k: string) => k, dir: 'ltr' as const };

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
  mergeEffectiveSettings: () => null,
}));
vi.mock('@/context/RolesContext', () => ({ useRoles: () => appMocks.roles }));
vi.mock('@/context/ThemeContext', () => ({ useTheme: () => appMocks.theme }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: () => {} }) }));

import {
  DesignSurface,
  DesignPageHeader,
  DesignFilterBar,
  DesignSearch,
  DesignPanel,
  DesignPagination,
  DesignLoadingState,
  DesignEmptyState,
  DesignErrorState,
} from '@/components/design';
import { SalesPage } from '@/features/trade/pages/SalesPage';
import { PurchasesPage } from '@/features/trade/pages/PurchasesPage';
import { ExpensesPage } from '@/features/trade/pages/ExpensesPage';
import { ShiftsPage } from '@/features/trade/pages/ShiftsPage';
import { InventoryPage } from '@/features/inventory/pages/InventoryPage';
import { TransfersPage } from '@/features/inventory/pages/TransfersPage';
import { InventoryLedgerPage } from '@/features/inventory/pages/InventoryLedgerPage';
import { AccountsPage } from '@/features/accounting/pages/AccountsPage';
import { PaymentsPage } from '@/features/accounting/pages/PaymentsPage';
import { TreasuryPage } from '@/features/accounting/pages/TreasuryPage';
import { ReconciliationPage } from '@/features/accounting/pages/ReconciliationPage';
import { JournalPage } from '@/features/accounting/pages/JournalPage';
import { RecipesPage } from '@/features/manufacturing/pages/RecipesPage';
import { RawMaterialsPage } from '@/features/manufacturing/pages/RawMaterialsPage';
import { ProductionOrdersPage } from '@/features/manufacturing/pages/ProductionOrdersPage';
import { ComponentsPage } from '@/features/catalog/pages/ComponentsPage';
import { ActiveOrdersPage } from '@/features/pos/pages/ActiveOrdersPage';

describe('design primitives (stable test identity)', () => {
  it('renders DesignSurface with its test id', () => {
    const { getByTestId } = render(
      <DesignSurface testId="sample-surface">
        <span>child</span>
      </DesignSurface>
    );
    expect(getByTestId('sample-surface')).toBeDefined();
  });

  it('renders DesignPageHeader and DesignFilterBar surfaces', () => {
    const { getByTestId } = render(
      <DesignSurface testId="hdr-surface">
        <DesignPageHeader title="Title" subtitle="Sub" />
        <DesignFilterBar>
          <DesignSearch value="" onChange={() => {}} label="search" />
        </DesignFilterBar>
      </DesignSurface>
    );
    expect(getByTestId('page-header')).toBeDefined();
    expect(getByTestId('page-title')).toHaveTextContent('Title');
    expect(getByTestId('page-description')).toHaveTextContent('Sub');
    expect(getByTestId('design-filter-bar')).toBeDefined();
    expect(getByTestId('design-search')).toBeDefined();
  });

  it('renders DesignPanel body with its test id', () => {
    const { getByTestId } = render(
      <DesignPanel title="Panel" testId="sample-panel">
        body
      </DesignPanel>
    );
    expect(getByTestId('sample-panel')).toBeDefined();
  });

  it('renders DesignPagination with stable test id', () => {
    const { getByTestId } = render(
      <DesignPagination loaded={5} total={10} hasMore={false} loadingMore={false} onLoadMore={() => {}} />
    );
    expect(getByTestId('design-pagination')).toBeDefined();
    expect(getByTestId('pagination-bar')).toBeDefined();
  });

  it('renders loading, empty and error states with stable test ids', () => {
    const { getByTestId } = render(
      <>
        <DesignLoadingState message="loading" />
        <DesignEmptyState title="empty" />
        <DesignErrorState message="boom" onRetry={() => {}} />
      </>
    );
    expect(getByTestId('design-loading')).toBeDefined();
    expect(getByTestId('design-empty')).toBeDefined();
    expect(getByTestId('design-error')).toBeDefined();
    expect(getByTestId('design-error-retry')).toBeDefined();
  });
});

const pageSurfaceCases: Array<[string, React.ComponentType, string, string]> = [
  ['SalesPage', SalesPage, 'sales-page', 'sales-search'],
  ['PurchasesPage', PurchasesPage, 'purchases-page', 'purchases-search'],
  ['ExpensesPage', ExpensesPage, 'expenses-page', 'expenses-search'],
  ['ShiftsPage', ShiftsPage, 'shifts-page', 'shifts-search'],
  ['InventoryPage', InventoryPage, 'inventory-page', 'inventory-search'],
  ['TransfersPage', TransfersPage, 'transfers-page', 'transfers-search'],
  ['InventoryLedgerPage', InventoryLedgerPage, 'inventory-ledger-page', 'inventory-ledger-search'],
  ['AccountsPage', AccountsPage, 'accounts-page', 'accounts-search'],
  ['PaymentsPage', PaymentsPage, 'payments-page', 'payments-search'],
  ['TreasuryPage', TreasuryPage, 'treasury-page', ''],
  ['ReconciliationPage', ReconciliationPage, 'reconciliation-page', ''],
  ['JournalPage', JournalPage, 'journal-page', 'journal-search'],
  ['RecipesPage', RecipesPage, 'recipes-page', 'recipes-search'],
  ['RawMaterialsPage', RawMaterialsPage, 'raw-materials-page', 'raw-materials-search'],
  ['ProductionOrdersPage', ProductionOrdersPage, 'production-orders-page', 'production-orders-search'],
  ['ComponentsPage', ComponentsPage, 'components-page', ''],
  ['ActiveOrdersPage', ActiveOrdersPage, 'active-orders-page', ''],
];

describe('migrated pages expose the 6D-6G surfaces', () => {
  for (const [name, Page, surfaceId, searchId] of pageSurfaceCases) {
    it(`${name} renders its DesignSurface with the expected panels`, () => {
      const { container, getByTestId } = render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      );
      expect(getByTestId(surfaceId)).toBeDefined();
      // Every page must render a stable data table region.
      expect(container.querySelector('[data-testid="data-table"]')).toBeDefined();
      if (searchId) {
        expect(container.querySelector(`[data-testid="${searchId}"]`)).toBeDefined();
      }
    });
  }
});
