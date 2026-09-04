import { Suspense, lazy, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Layout } from '../components/Layout';
import { useCan, isAdminRole, type Permission } from '../lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';

const LoginPage = lazy(() => import('../features/auth/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('../features/auth/pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const DashboardPage = lazy(() => import('../features/dashboard/pages/DashboardEnhancedPage').then(m => ({ default: m.DashboardEnhancedPage })));
const OperationsCenterPage = lazy(() => import('../features/operations/pages/OperationsCenterPage').then(m => ({ default: m.OperationsCenterPage })));
const InventoryCenterPage = lazy(() => import('../features/inventory/pages/InventoryCenterPage').then(m => ({ default: m.InventoryCenterPage })));
const ProcurementCenterPage = lazy(() => import('../features/trade/pages/ProcurementCenterPage').then(m => ({ default: m.ProcurementCenterPage })));
const PosWorkspacePage = lazy(() => import('../features/pos/pages/PosWorkspacePage').then(m => ({ default: m.PosWorkspacePage })));
const ActiveOrdersPage = lazy(() => import('../features/pos/pages/ActiveOrdersPage').then(m => ({ default: m.ActiveOrdersPage })));
const ProductsPage = lazy(() => import('../features/catalog/pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const ProductSetupWizardPage = lazy(() => import('../features/catalog/pages/ProductSetupWizardPage').then(m => ({ default: m.ProductSetupWizardPage })));
const CategoriesPage = lazy(() => import('../features/catalog/pages/CategoriesPage').then(m => ({ default: m.CategoriesPage })));
const ComponentsPage = lazy(() => import('../features/catalog/pages/ComponentsPage').then(m => ({ default: m.ComponentsPage })));
const InventoryPage = lazy(() => import('../features/inventory/pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const WarehousesPage = lazy(() => import('../features/inventory/pages/WarehousesPage').then(m => ({ default: m.WarehousesPage })));
const RawMaterialsPage = lazy(() => import('../features/manufacturing/pages/RawMaterialsPage').then(m => ({ default: m.RawMaterialsPage })));
const RecipesPage = lazy(() => import('../features/manufacturing/pages/RecipesPage').then(m => ({ default: m.RecipesPage })));
const TransfersPage = lazy(() => import('../features/inventory/pages/TransfersPage').then(m => ({ default: m.TransfersPage })));
const InventoryLedgerPage = lazy(() => import('../features/inventory/pages/InventoryLedgerPage').then(m => ({ default: m.InventoryLedgerPage })));
const StockCountsPage = lazy(() => import('../features/inventory/pages/StockCountsPage').then(m => ({ default: m.StockCountsPage })));
const InventoryBatchesPage = lazy(() => import('../features/inventory/pages/InventoryBatchesPage').then(m => ({ default: m.InventoryBatchesPage })));
const StockValuationPage = lazy(() => import('../features/inventory/pages/StockValuationPage').then(m => ({ default: m.StockValuationPage })));
const LowStockAlertsPage = lazy(() => import('../features/inventory/pages/LowStockAlertsPage').then(m => ({ default: m.LowStockAlertsPage })));
const CostingCenterPage = lazy(() => import('../features/costing/pages/CostingCenterPage').then(m => ({ default: m.CostingCenterPage })));
const InventoryUnitsPage = lazy(() => import('../features/catalog/pages/InventoryUnitsPage').then(m => ({ default: m.InventoryUnitsPage })));
const WasteCenterPage = lazy(() => import('../features/inventory/pages/WasteCenterPage').then(m => ({ default: m.WasteCenterPage })));
const KitchenDisplayPage = lazy(() => import('../features/inventory/pages/KitchenDisplayPage').then(m => ({ default: m.KitchenDisplayPage })));
const KitchenStationsPage = lazy(() => import('../features/catalog/pages/KitchenStationsPage').then(m => ({ default: m.KitchenStationsPage })));
const BranchesPage = lazy(() => import('../features/admin/pages/BranchesPage').then(m => ({ default: m.BranchesPage })));
const PurchasesPage = lazy(() => import('../features/trade/pages/PurchasesPage').then(m => ({ default: m.PurchasesPage })));
const PurchaseRequestsPage = lazy(() => import('../features/trade/pages/PurchaseRequestsPage').then(m => ({ default: m.PurchaseRequestsPage })));
const RfqsPage = lazy(() => import('../features/trade/pages/RfqsPage').then(m => ({ default: m.RfqsPage })));
const ReceivingPage = lazy(() => import('../features/trade/pages/ReceivingPage').then(m => ({ default: m.ReceivingPage })));
const CustomersPage = lazy(() => import('../features/parties/pages/CustomersPage').then(m => ({ default: m.CustomersPage })));
const SuppliersPage = lazy(() => import('../features/parties/pages/SuppliersPage').then(m => ({ default: m.SuppliersPage })));
const ExpensesPage = lazy(() => import('../features/trade/pages/ExpensesPage').then(m => ({ default: m.ExpensesPage })));
const SalesPage = lazy(() => import('../features/trade/pages/SalesPage').then(m => ({ default: m.SalesPage })));
const ShiftsPage = lazy(() => import('../features/trade/pages/ShiftsPage').then(m => ({ default: m.ShiftsPage })));

const ReportsCenterPage = lazy(() => import('../features/reporting/pages/ReportsCenterPage').then(m => ({ default: m.ReportsCenterPage })));
const FinancialReportsPage = lazy(() => import('../features/accounting/pages/FinancialReportsPage').then(m => ({ default: m.FinancialReportsPage })));
const AccountsPage = lazy(() => import('../features/accounting/pages/AccountsPage').then(m => ({ default: m.AccountsPage })));
const PaymentsPage = lazy(() => import('../features/accounting/pages/PaymentsPage').then(m => ({ default: m.PaymentsPage })));
const JournalPage = lazy(() => import('../features/accounting/pages/JournalPage').then(m => ({ default: m.JournalPage })));
const TreasuryPage = lazy(() => import('../features/accounting/pages/TreasuryPage').then(m => ({ default: m.TreasuryPage })));
const ReconciliationPage = lazy(() => import('../features/accounting/pages/ReconciliationPage').then(m => ({ default: m.ReconciliationPage })));
const UsersPage = lazy(() => import('../features/admin/pages/UsersPage').then(m => ({ default: m.UsersPage })));
const AuditLogPage = lazy(() => import('../features/reporting/pages/AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const SettingsControlCenterPage = lazy(() => import('../features/admin/pages/SettingsControlCenterPage').then(m => ({ default: m.SettingsControlCenterPage })));
const SuperAdminConsolePage = lazy(() => import('../features/admin/pages/SuperAdminConsolePage').then(m => ({ default: m.SuperAdminConsolePage })));
const SystemHealthPage = lazy(() => import('../features/admin/pages/SystemHealthPage').then(m => ({ default: m.SystemHealthPage })));
const ImportExportCenterPage = lazy(() => import('../features/import-export/pages/ImportExportCenterPage').then(m => ({ default: m.ImportExportCenterPage })));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ui-page">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ui-primary" />
    </div>
  );
}

function ProtectedRoute({
  children,
  permission,
  fullscreen,
  superAdminOnly = false,
  ownerOnly = false,
}: {
  children: ReactNode;
  permission?: Permission;
  fullscreen?: boolean;
  superAdminOnly?: boolean;
  ownerOnly?: boolean;
}) {
  const { session, loading, user } = useAuth();
  const can = useCan();

  if (loading) return <PageLoader />;
  if (!session) return <Navigate to={APP_ROUTES.login} replace />;
  if (superAdminOnly && user?.role !== 'super_admin') return <Navigate to={APP_ROUTES.dashboard} replace />;
  if (ownerOnly && !isAdminRole(user?.role)) return <Navigate to={APP_ROUTES.dashboard} replace />;
  if (permission && !can(permission)) return <Navigate to={APP_ROUTES.dashboard} replace />;

  if (fullscreen) return <>{children}</>;
  return <Layout>{children}</Layout>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to={APP_ROUTES.dashboard} replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path={APP_ROUTES.login} element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path={APP_ROUTES.register} element={<PublicRoute><RegisterPage /></PublicRoute>} />
        <Route path={APP_ROUTES.subscription} element={<Navigate to={APP_ROUTES.dashboard} replace />} />
        <Route path={APP_ROUTES.subscriptions} element={<Navigate to={APP_ROUTES.superAdmin} replace />} />
        <Route path={APP_ROUTES.dashboard} element={<ProtectedRoute permission="dashboard.view"><DashboardPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.operationsCenter} element={<ProtectedRoute permission="dashboard.view"><OperationsCenterPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.inventoryCenter} element={<ProtectedRoute permission="inventory.view"><InventoryCenterPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.procurementCenter} element={<ProtectedRoute permission="purchases.view"><ProcurementCenterPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.manufacturingCenter} element={<Navigate to={APP_ROUTES.recipes} replace />} />
        <Route path={APP_ROUTES.pos} element={<ProtectedRoute permission="pos.sell" fullscreen><PosWorkspacePage /></ProtectedRoute>} />
        <Route path={`${APP_ROUTES.pos}/:orderId`} element={<ProtectedRoute permission="pos.sell" fullscreen><PosWorkspacePage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.floorPlan} element={<ProtectedRoute permission="floor_plan.view"><ActiveOrdersPage /></ProtectedRoute>} />
        <Route path="/kitchen" element={<Navigate to={APP_ROUTES.pos} replace />} />
        <Route path="/tables" element={<ProtectedRoute permission="floor_plan.view"><Navigate to={APP_ROUTES.floorPlan} replace /></ProtectedRoute>} />
        <Route path={APP_ROUTES.products} element={<ProtectedRoute permission="products.view"><ProductsPage /></ProtectedRoute>} />
        <Route path={`${APP_ROUTES.products}/setup`} element={<ProtectedRoute permission="products.manage"><ProductSetupWizardPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.categories} element={<ProtectedRoute permission="categories.view"><CategoriesPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.components} element={<ProtectedRoute permission="components.view"><ComponentsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.inventoryUnits} element={<ProtectedRoute permission="raw_materials.view"><InventoryUnitsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.wasteCenter} element={<ProtectedRoute permission="production.waste"><WasteCenterPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.kitchenDisplay} element={<ProtectedRoute permission="pos.sell"><KitchenDisplayPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.kitchenStations} element={<ProtectedRoute permission="settings.manage"><KitchenStationsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.inventory} element={<ProtectedRoute permission="inventory.view"><InventoryPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.warehouses} element={<ProtectedRoute permission="warehouses.view"><WarehousesPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.rawMaterials} element={<ProtectedRoute permission="raw_materials.view"><RawMaterialsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.recipes} element={<ProtectedRoute permission="recipes.view"><RecipesPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.production} element={<Navigate to={APP_ROUTES.recipes} replace />} />
        <Route path={APP_ROUTES.productionUnits} element={<Navigate to={APP_ROUTES.recipes} replace />} />
        <Route path={APP_ROUTES.transfers} element={<ProtectedRoute permission="inventory.transfers"><TransfersPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.inventoryLedger} element={<ProtectedRoute permission="inventory.ledger.view"><InventoryLedgerPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.stockCounts} element={<ProtectedRoute permission="inventory.manage"><StockCountsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.inventoryBatches} element={<ProtectedRoute permission="inventory.view"><InventoryBatchesPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.stockValuation} element={<ProtectedRoute permission="inventory.ledger.view"><StockValuationPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.lowStockAlerts} element={<ProtectedRoute permission="inventory.view"><LowStockAlertsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.costingCenter} element={<ProtectedRoute permission="reports.costing"><CostingCenterPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.branches} element={<ProtectedRoute permission="branches.manage"><BranchesPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.purchases} element={<ProtectedRoute permission="purchases.view"><PurchasesPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.purchaseRequests} element={<ProtectedRoute permission="purchases.requests"><PurchaseRequestsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.rfqs} element={<ProtectedRoute permission="purchases.rfq"><RfqsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.receiving} element={<ProtectedRoute permission="purchases.receiving"><ReceivingPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.customers} element={<ProtectedRoute permission="customers.view"><CustomersPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.suppliers} element={<ProtectedRoute permission="suppliers.view"><SuppliersPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.expenses} element={<ProtectedRoute permission="expenses.view"><ExpensesPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.sales} element={<ProtectedRoute permission="sales.view"><SalesPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.shifts} element={<ProtectedRoute permission="shifts.view"><ShiftsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.reports} element={<ProtectedRoute permission="reports.view"><ReportsCenterPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.financialReports} element={<ProtectedRoute permission="reports.financial"><FinancialReportsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.accounting} element={<ProtectedRoute permission="reports.financial"><Navigate to={APP_ROUTES.financialReports} replace /></ProtectedRoute>} />
        <Route path={APP_ROUTES.accounts} element={<ProtectedRoute permission="accounts.view"><AccountsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.payments} element={<ProtectedRoute permission="accounts.view"><PaymentsPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.journal} element={<ProtectedRoute permission="accounts.view"><JournalPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.treasury} element={<ProtectedRoute permission="accounts.view"><TreasuryPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.reconciliation} element={<ProtectedRoute permission="accounts.view"><ReconciliationPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.users} element={<ProtectedRoute permission="users.view"><UsersPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.employees} element={<ProtectedRoute permission="users.view"><Navigate to={APP_ROUTES.users} replace /></ProtectedRoute>} />
        <Route path={APP_ROUTES.auditLog} element={<ProtectedRoute permission="audit.view"><AuditLogPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.settings} element={<ProtectedRoute permission="settings.manage"><SettingsControlCenterPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.superAdmin} element={<ProtectedRoute superAdminOnly><SuperAdminConsolePage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.basicSettings} element={<ProtectedRoute permission="settings.manage"><Navigate to={APP_ROUTES.settings} replace /></ProtectedRoute>} />
        <Route path={APP_ROUTES.systemHealth} element={<ProtectedRoute permission="settings.manage"><SystemHealthPage /></ProtectedRoute>} />
        <Route path={APP_ROUTES.importExport} element={<ProtectedRoute><ImportExportCenterPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={APP_ROUTES.dashboard} replace />} />
      </Routes>
    </Suspense>
  );
}
