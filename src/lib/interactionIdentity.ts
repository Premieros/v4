/**
 * Interaction-Identity Registry (6H-P5).
 *
 * Central, machine-readable list of every stable `data-testid` / handler
 * contract that the visual rebuild must preserve. The contract test
 * (`tests/unit/interactionIdentity.test.ts`) reads this registry and fails if
 * any registered identity or its documented behavior marker disappears from
 * the owning source file.
 *
 * Adding or renaming a stable identity during future work MUST update this
 * registry in the same commit — never ship an unregistered identity.
 */

export interface InteractionContract {
  testId: string;
  file: string;
  label: string;
  marker: string;
}

export const INTERACTION_CONTRACTS: InteractionContract[] = [
  // App shell (Layout.tsx)
  { testId: 'app-shell', file: 'src/components/Layout.tsx', label: 'App shell root surface', marker: 'data-testid="app-shell"' },
  { testId: 'app-sidebar', file: 'src/components/Layout.tsx', label: 'Sidebar surface', marker: 'data-testid="app-sidebar"' },
  { testId: 'app-navigation', file: 'src/components/Layout.tsx', label: 'Navigation container', marker: 'data-testid="app-navigation"' },
  { testId: 'nav-group-{group}', file: 'src/components/Layout.tsx', label: 'Navigation group', marker: 'data-testid={`nav-group-${group}`}' },
  { testId: 'nav-group-toggle-{group}', file: 'src/components/Layout.tsx', label: 'Collapsible group toggle', marker: 'data-testid={`nav-group-toggle-${group}`}' },
  { testId: 'nav-item-{id}', file: 'src/components/Layout.tsx', label: 'Navigation item', marker: 'data-testid={`nav-item-${item.id}`}' },
  { testId: 'sidebar-close', file: 'src/components/Layout.tsx', label: 'Close sidebar on mobile', marker: 'data-testid="sidebar-close"' },
  { testId: 'sidebar-open', file: 'src/components/Layout.tsx', label: 'Open sidebar on mobile', marker: 'data-testid="sidebar-open"' },
  { testId: 'mobile-sidebar-backdrop', file: 'src/components/Layout.tsx', label: 'Mobile sidebar backdrop closes the menu', marker: 'data-testid="mobile-sidebar-backdrop"' },
  { testId: 'assistant-card', file: 'src/components/Layout.tsx', label: 'Assistant / help card', marker: 'data-testid="assistant-card"' },
  { testId: 'app-header', file: 'src/components/Layout.tsx', label: 'Top app header', marker: 'data-testid="app-header"' },
  { testId: 'top-navigation', file: 'src/components/Layout.tsx', label: 'Top navigation rail', marker: 'data-testid="top-navigation"' },
  { testId: 'top-tab-{key}', file: 'src/components/Layout.tsx', label: 'Top navigation tab', marker: 'data-testid={`top-tab-${tab.key}`}' },
  { testId: 'active-orders-button', file: 'src/components/Layout.tsx', label: 'Active orders shortcut navigates to floor plan', marker: "data-testid=\"active-orders-button\" type=\"button\" onClick={() => navigate('/floor-plan')}" },
  { testId: 'active-orders-count', file: 'src/components/Layout.tsx', label: 'Active orders count badge', marker: 'data-testid="active-orders-count"' },
  { testId: 'user-menu-button', file: 'src/components/Layout.tsx', label: 'User menu opens settings', marker: 'data-testid="user-menu-button"' },
  { testId: 'language-toggle', file: 'src/components/Layout.tsx', label: 'Language toggle (ar/en)', marker: 'data-testid="language-toggle"' },
  { testId: 'theme-toggle', file: 'src/components/Layout.tsx', label: 'Theme toggle', marker: 'data-testid="theme-toggle"' },
  { testId: 'sign-out-button', file: 'src/components/Layout.tsx', label: 'Sign out action', marker: 'data-testid="sign-out-button"' },
  { testId: 'app-main', file: 'src/components/Layout.tsx', label: 'Main content region', marker: 'data-testid="app-main"' },
  { testId: 'design-content-surface', file: 'src/components/Layout.tsx', label: 'Design content surface', marker: 'data-testid="design-content-surface"' },
  { testId: 'branch-indicator', file: 'src/components/Layout.tsx', label: 'Active branch indicator', marker: 'data-testid="branch-indicator"' },
  { testId: 'branch-menu', file: 'src/components/Layout.tsx', label: 'Branch switcher menu', marker: 'data-testid="branch-menu"' },
  { testId: 'branch-option-all', file: 'src/components/Layout.tsx', label: 'Branch switcher: all branches', marker: 'data-testid="branch-option-all"' },
  { testId: 'branch-option-{id}', file: 'src/components/Layout.tsx', label: 'Branch switcher: single branch', marker: 'data-testid={`branch-option-${b.id}`}' },

  // Dashboard (VisualDashboardPage.tsx)
  { testId: 'dashboard-surface', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Dashboard surface', marker: 'data-testid="dashboard-surface"' },
  { testId: 'dashboard-branch-filter', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Admin branch picker (wired to setActiveBranchId)', marker: 'data-testid="dashboard-branch-filter"' },
  { testId: 'dashboard-compare-toggle', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Previous-period comparison toggle', marker: 'data-testid="dashboard-compare-toggle"' },
  { testId: 'dashboard-filter-button', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Order-type filter trigger', marker: 'data-testid="dashboard-filter-button"' },
  { testId: 'dashboard-filter-menu', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Order-type filter menu', marker: 'data-testid="dashboard-filter-menu"' },
  { testId: 'dashboard-export-button', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Export trigger', marker: 'data-testid="dashboard-export-button"' },
  { testId: 'dashboard-export-menu', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Export menu', marker: 'data-testid="dashboard-export-menu"' },
  { testId: 'kpi-orders', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Orders KPI', marker: 'testId="kpi-orders"' },
  { testId: 'kpi-net-sales', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Net sales KPI', marker: 'testId="kpi-net-sales"' },
  { testId: 'kpi-net-payments', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Net payments KPI', marker: 'testId="kpi-net-payments"' },
  { testId: 'kpi-returns', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Returns KPI', marker: 'testId="kpi-returns"' },
  { testId: 'kpi-discounts', file: 'src/features/dashboard/pages/VisualDashboardPage.tsx', label: 'Discounts KPI', marker: 'testId="kpi-discounts"' },

  // Reports Center (ReportFilterBar.tsx + ReportsPage.tsx)
  { testId: 'report-type-select', file: 'src/features/reporting/ReportFilterBar.tsx', label: 'Report type dropdown (14 operational + 9 financial)', marker: 'data-testid="report-type-select"' },
  { testId: 'report-context-filter', file: 'src/features/reporting/ReportFilterBar.tsx', label: 'Contextual period filter dropdown', marker: 'data-testid="report-context-filter"' },
  { testId: 'button[data-report-type]', file: 'src/features/reporting/ReportFilterBar.tsx', label: 'Report-type quick-access buttons (deep-link contract)', marker: 'data-report-type={rt.key}' },
  { testId: 'button[data-report-type] (financial)', file: 'src/features/reporting/ReportFilterBar.tsx', label: 'Financial report-type buttons', marker: 'data-report-type={ft.key}' },
  { testId: 'financial deep link', file: 'src/features/reporting/pages/ReportsPage.tsx', label: 'Financial selection navigates with view + period context', marker: 'navigate(`/financial-reports?view=${value}&from=${from}&to=${to}`)' },

  // Deep-link resolver (ReportDeepLinkPage.tsx)
  { testId: 'reportType deep link', file: 'src/features/reporting/pages/ReportDeepLinkPage.tsx', label: '/reports?reportType=… resolves via button[data-report-type]', marker: 'button[data-report-type="' },

  // Financial reports (FinancialReportsPage.tsx)
  { testId: 'financial-reports-page', file: 'src/features/accounting/pages/FinancialReportsPage.tsx', label: 'Financial reports surface', marker: 'testId="financial-reports-page"' },
  { testId: 'financial-reports-filters', file: 'src/features/accounting/pages/FinancialReportsPage.tsx', label: 'Financial reports filter panel', marker: 'testId="financial-reports-filters"' },
  { testId: 'financial view deep link', file: 'src/features/accounting/pages/FinancialReportsPage.tsx', label: '?view/from/to deep-link parameters', marker: "searchParams.get('view')" },

  // Shared table (DataTable.tsx)
  { testId: 'data-table', file: 'src/components/DataTable.tsx', label: 'Stable data-table region', marker: 'data-testid="data-table"' },
  { testId: 'table-loading', file: 'src/components/DataTable.tsx', label: 'Table loading state', marker: 'data-testid="table-loading"' },
  { testId: 'table-error', file: 'src/components/DataTable.tsx', label: 'Table error state', marker: 'data-testid="table-error"' },
  { testId: 'table-empty', file: 'src/components/DataTable.tsx', label: 'Table empty state', marker: 'data-testid="table-empty"' },

  // Design primitives (design package)
  { testId: 'page-header', file: 'src/components/PageHeader.tsx', label: 'Page header surface', marker: 'data-testid="page-header"' },
  { testId: 'page-title', file: 'src/components/PageHeader.tsx', label: 'Page title', marker: 'data-testid="page-title"' },
  { testId: 'design-filter-bar', file: 'src/components/design/DesignSurface.tsx', label: 'Design filter bar', marker: 'data-testid="design-filter-bar"' },
  { testId: 'design-search', file: 'src/components/design/DesignSearch.tsx', label: 'Design search input', marker: 'data-testid={testId}' },
  { testId: 'design-pagination', file: 'src/components/design/DesignPagination.tsx', label: 'Design pagination wrapper', marker: 'data-testid="design-pagination"' },
  { testId: 'pagination-bar', file: 'src/components/PaginationBar.tsx', label: 'Pagination load-more bar', marker: 'data-testid="pagination-bar"' },
  { testId: 'design-loading', file: 'src/components/design/DesignStates.tsx', label: 'Shared loading state', marker: 'testId = \'design-loading\'' },
  { testId: 'design-empty', file: 'src/components/design/DesignStates.tsx', label: 'Shared empty state', marker: 'testId = \'design-empty\'' },
  { testId: 'design-error', file: 'src/components/design/DesignStates.tsx', label: 'Shared error state', marker: 'testId = \'design-error\'' },

  // POS bottom navigation (PosBottomNav.tsx)
  { testId: 'pos active-orders nav', file: 'src/features/pos/components/bottom/PosBottomNav.tsx', label: 'Bottom nav opens the active-orders drawer', marker: "onOpenOrders('all')" },
  { testId: 'pos active-orders aria', file: 'src/features/pos/components/bottom/PosBottomNav.tsx', label: 'Bottom nav keeps the Active-orders aria label', marker: "'الطلبات النشطة' : 'Active orders'" },
];
