import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, Printer, Barcode as BarcodeIcon, AlertTriangle, Timer } from 'lucide-react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useOffline } from '@/context/OfflineContext';
import { offlinePosManager } from '../services/offlinePos';
import { Modal } from '@/components/Modal';
import { Logo } from '@/components/Logo';
import { formatCurrency } from '@/lib/format';
import { mergeEffectiveSettings, useSettings } from '@/context/SettingsContext';
import { useOperationalGuard, PrerequisiteAlertBanner, PREREQUISITE_STEPS } from '@/core/guard';
import type { Product, Customer, Settings, Branch, Category, ProductComponent, Order, CartItem, DiningArea, DiningTable } from '@/lib/types';
import { usePosOrder } from '../hooks/usePosOrder';
import { useActiveOrders } from '../hooks/useActiveOrders';
import { usePosPermissions } from '../hooks/usePosPermissions';
import { usePosKeyboard } from '../hooks/usePosKeyboard';
import { OrderStartWizard, type StartStep, type StartOrderOptions } from '../components/start/OrderStartWizard';
import { FullScreenTableOrderSelector } from '../components/start/FullScreenTableOrderSelector';
import { ProductBrowser } from '../components/catalog/ProductBrowser';
import { ProductConfigModal } from '../components/catalog/ProductConfigModal';
import { CustomerQuickModal } from '../components/customers/CustomerQuickModal';
import { TableSelectModal } from '../components/tables/TableSelectModal';
import { ShiftModal } from '../components/shift/ShiftModal';
import { PosTopBar, type PosPanelId } from '../components/topbar/PosTopBar';
import { PosBottomNav } from '../components/bottom/PosBottomNav';
import { ActiveOrdersDrawer, type ActiveCategory } from '../components/orders/ActiveOrdersDrawer';
import { TablesPanel } from '../components/tables/TablesPanel';
import { KitchenPanel } from '../components/kitchen/KitchenPanel';
import { CurrentOrderPanel } from '../components/order/CurrentOrderPanel';
import { PaymentPanel } from '../components/checkout/PaymentPanel';
import { PosTablesSidebar } from '../components/tables/PosTablesSidebar';
import { PosOrderHeaderBar } from '../components/order/PosOrderHeaderBar';
import { TransferOrderModal } from '../components/tables/TransferOrderModal';
import { VoidItemModal } from '../components/order/VoidItemModal';
import { CancelOrderModal } from '../components/order/CancelOrderModal';
import { RawAndManufacturedMaterialsPanel } from '@/features/inventory/components/RawAndManufacturedMaterialsPanel';
import { RequestApprovalDialog } from '../components/approvals/RequestApprovalDialog';
import { fetchBranchRawMaterialsStock, fetchBranchRecipes, computeManufacturedSellableStock, type RecipeWithItems, type RawMaterialStockInfo } from '../services/kitchenInventory';

interface WorkspaceState {
  tableId?: string | null;
  branchId?: string | null;
  guestCount?: number | null;
  pay?: number | null;
}

export function PosWorkspacePage() {
  const { orderId: orderIdParam } = useParams<{ orderId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { branchSettingsMap } = useSettings();
  const perms = usePosPermissions();
  const {
    guardPos,
    startGuidance,
  } = useOperationalGuard();

  const initState = useMemo<WorkspaceState>(() => (location.state || {}) as WorkspaceState, [location.state]);
  const { cachePosData, loadCachedPosData } = useOffline();
  const [reloadKey, setReloadKey] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [diningAreas, setDiningAreas] = useState<DiningArea[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [recipeMap, setRecipeMap] = useState<Record<string, ProductComponent[]>>({});
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBranch, setSelectedBranch] = useState(initState.branchId || branchFilter || '');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeShift, setActiveShift] = useState<{ id: string; expected: number; opened_at: string; opening_amount: number } | null>(null);
  const [shiftChecked, setShiftChecked] = useState(false);
  const [panel, setPanel] = useState<PosPanelId>(null);
  const [ordersCategory, setOrdersCategory] = useState<ActiveCategory>('all');
  const [mobileOrderOpen, setMobileOrderOpen] = useState(false);
  const [startStep, setStartStep] = useState<StartStep | null>(null);
  const [preselectedTableId, setPreselectedTableId] = useState<string | null>(initState.tableId || null);

  // Fullscreen Table / Products View State
  const [viewMode, setViewMode] = useState<'tables' | 'products'>(orderIdParam ? 'products' : 'tables');
  const [showCartManual, setShowCartManual] = useState(false);
  const [rawMaterialsOpen, setRawMaterialsOpen] = useState(false);
  const [rawStock, setRawStock] = useState<RawMaterialStockInfo[]>([]);
  const [recipesList, setRecipesList] = useState<RecipeWithItems[]>([]);
  const [approvalDialog, setApprovalDialog] = useState<{
    open: boolean;
    type: 'discount' | 'reprint' | 'cancel';
    initialAmount?: number;
    onApproved: () => void;
  }>({
    open: false,
    type: 'discount',
    onApproved: () => {},
  });

  // Quick Modals State
  const [configProduct, setConfigProduct] = useState<Product | null>(null);
  const [configItem, setConfigItem] = useState<CartItem | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [tablesCollapsed, setTablesCollapsed] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferOrder, setTransferOrder] = useState<Order | null>(null);
  const [transferSourceTable, setTransferSourceTable] = useState<DiningTable | null>(null);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidItem, setVoidItem] = useState<CartItem | null>(null);
  const [voidSentQty, setVoidSentQty] = useState(1);
  const [cancelModalOrder, setCancelModalOrder] = useState<{ id: string; orderNumber?: string | null } | null>(null);

  const barcodeRef = useRef<HTMLInputElement>(null);
  const payConsumed = useRef(false);
  const effectiveBranch = selectedBranch || branchFilter || user?.branch_id || '';
  const effSettings: Settings | null = settings ? mergeEffectiveSettings(settings, effectiveBranch ? branchSettingsMap[effectiveBranch] : null) : null;
  const isCashier = user?.role === 'cashier';

  const reloadShift = useCallback(() => {
    if (!isCashier || !effectiveBranch) {
      setShiftChecked(true);
      setActiveShift(null);
      return;
    }
    setShiftChecked(false);
    api.pos.getActiveShift({ p_branch_id: effectiveBranch }).then(({ data }) => {
      const res = data as unknown as { open?: boolean; shift?: { id: string; expected: number; opened_at: string; opening_amount: number } } | null;
      setActiveShift(res?.open ? (res.shift ?? null) : null);
      setShiftChecked(true);
    });
  }, [isCashier, effectiveBranch]);

  useEffect(() => {
    reloadShift();
  }, [reloadShift]);

  const loadStock = useCallback(async (branchId: string) => {
    if (!branchId) {
      setStockMap({});
      setRawStock([]);
      setRecipesList([]);
      return;
    }
    const { data: warehouses } = await supabase.from('warehouses').select('id').eq('branch_id', branchId).eq('is_active', true);
    const warehouseIds = (warehouses || []).map((w: { id: string }) => w.id);
    if (warehouseIds.length === 0) {
      setStockMap({});
    } else {
      const { data: inv } = await supabase.from('inventory').select('product_id, quantity').in('warehouse_id', warehouseIds);
      const map: Record<string, number> = {};
      for (const row of (inv || []) as { product_id: string; quantity: number }[]) {
        map[row.product_id] = (map[row.product_id] || 0) + Number(row.quantity);
      }
      setStockMap(map);
    }

    try {
      const [rawMap, recipes] = await Promise.all([
        fetchBranchRawMaterialsStock(branchId),
        fetchBranchRecipes(branchId),
      ]);
      setRawStock(rawMap);
      setRecipesList(recipes);
    } catch {
      // best-effort
    }
  }, []);

  const sellableStock = useMemo(() => {
    const fromRecipes = computeManufacturedSellableStock(recipesList, rawStock);
    const map: Record<string, number> = {};
    for (const p of products) {
      if (p.product_type !== 'manufactured') continue;
      if (fromRecipes[p.id] !== undefined) {
        map[p.id] = fromRecipes[p.id].portions;
        continue;
      }
      const comps = recipeMap[p.id] || [];
      if (comps.length === 0) {
        map[p.id] = 0;
        continue;
      }
      let min = Infinity;
      for (const c of comps) {
        const perUnit = Number(c.quantity) || 0;
        if (perUnit <= 0) {
          min = 0;
          break;
        }
        const possible = (stockMap[c.component_product_id] || 0) / perUnit;
        if (possible < min) min = possible;
      }
      map[p.id] = min === Infinity ? 0 : Math.floor(min);
    }
    return map;
  }, [products, recipesList, rawStock, recipeMap, stockMap]);

  const pos = usePosOrder({
    branchId: effectiveBranch,
    orderId: orderIdParam || null,
    customers,
    effSettings,
    isCashier,
    activeShift,
    products,
    stockMap,
    sellableStock,
    recipeMap,
  });

  const live = useActiveOrders(effectiveBranch);

  useEffect(() => {
    if (!effSettings?.pos_barcode_autofocus) return;
    if (panel || pos.checkoutOpen || mobileOrderOpen || configProduct || configItem || customerModalOpen || tableModalOpen || shiftModalOpen) return;
    const timer = setTimeout(() => barcodeRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [effSettings?.pos_barcode_autofocus, panel, pos.checkoutOpen, mobileOrderOpen, configProduct, configItem, customerModalOpen, tableModalOpen, shiftModalOpen]);

  const { orders, tables, counts, ordersByTable, itemsByOrder, kitchenSendsByOrder, sentOrderItemIds, tableById } = live;
  const customerById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);
  const productNames = useMemo(() => Object.fromEntries(products.map((p) => [p.id, isAr ? p.name : p.name_en || p.name])), [products, isAr]);
  const kitchenOrders = useMemo(() => orders.filter((o) => (kitchenSendsByOrder[o.id]?.length || 0) > 0).length, [orders, kitchenSendsByOrder]);
  const activeOrderCreatedAt = useMemo(() => orders.find((o) => o.id === pos.activeOrderId)?.created_at || null, [orders, pos.activeOrderId]);
  const orderItemsForActive = useMemo(() => (pos.activeOrderId ? itemsByOrder[pos.activeOrderId] || [] : []), [pos.activeOrderId, itemsByOrder]);
  const kitchenSendsForActive = useMemo(() => (pos.activeOrderId ? kitchenSendsByOrder[pos.activeOrderId] || [] : []), [pos.activeOrderId, kitchenSendsByOrder]);
  const sentItemIds = useMemo(() => new Set(kitchenSendsForActive.map((s) => s.order_item_id)), [kitchenSendsForActive]);

  const hasUnsentItems = useMemo(() => {
    if (pos.cart.length === 0) return false;
    if (kitchenSendsForActive.length === 0) return true;
    return pos.cart.some((cItem) => {
      const orderItem = orderItemsForActive.find((oi) => oi.product_id === cItem.product.id);
      if (!orderItem) return true;
      return !sentItemIds.has(orderItem.id);
    });
  }, [pos.cart, kitchenSendsForActive, orderItemsForActive, sentItemIds]);

  const handlePay = useCallback(() => {
    if (pos.cart.length === 0) return;
    const allowed = guardPos({
      productsCount: products.length,
      activeShiftId: isCashier ? activeShift?.id || null : 'shift_exempt',
      formData: { cart: pos.cart, orderType: pos.orderType },
    });
    if (!allowed) return;
    pos.setPaymentMethod('cash');
    pos.setPaidAmount(pos.total);
    pos.setCheckoutOpen(true);
    setMobileOrderOpen(false);
  }, [pos, guardPos, products.length, isCashier, activeShift?.id]);

  // Keyboard Shortcuts Hook
  usePosKeyboard({
    onFocusSearch: () => barcodeRef.current?.focus(),
    onHoldOrder: () => {
      if (pos.cart.length > 0 && !pos.orderLoading) void pos.holdOrder();
    },
    onTriggerDiscount: () => {
      if (perms.canDiscount) {
        // Toggle or focus
      }
    },
    onProceedToPay: handlePay,
    onPrintReceipt: () => {
      if (pos.cart.length > 0) pos.printKitchenTicket();
    },
    onEscape: () => {
      if (configProduct) setConfigProduct(null);
      else if (configItem) setConfigItem(null);
      else if (customerModalOpen) setCustomerModalOpen(false);
      else if (tableModalOpen) setTableModalOpen(false);
      else if (shiftModalOpen) setShiftModalOpen(false);
      else if (panel) setPanel(null);
      else if (pos.checkoutOpen) pos.setCheckoutOpen(false);
      else if (mobileOrderOpen) setMobileOrderOpen(false);
    },
    enabled: true,
  });

  const {
    checkoutOpen,
    orderLoading,
    activeOrderId,
    cart,
    total,
    setPaymentMethod,
    setPaidAmount,
    setCheckoutOpen,
  } = pos;

  useEffect(() => {
    if (orderIdParam) {
      setStartStep(null);
      return;
    }
    if (initState.tableId) {
      setPreselectedTableId(initState.tableId);
      setStartStep('table');
    } else setStartStep(null);
  }, [orderIdParam, initState.tableId]);

  useEffect(() => {
    if (payConsumed.current || !initState.pay || checkoutOpen || orderLoading || !activeOrderId || cart.length === 0) return;
    payConsumed.current = true;
    setPaymentMethod('cash');
    setPaidAmount(total);
    setCheckoutOpen(true);
  }, [initState.pay, checkoutOpen, orderLoading, activeOrderId, cart.length, total, setPaymentMethod, setPaidAmount, setCheckoutOpen]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setLoadError('');
      try {
        const fixedBranch = effectiveBranch;
        
        // If navigator is offline, immediately try offline cache first
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          const offlineData = await loadCachedPosData(fixedBranch || undefined);
          const catalogFallback = offlinePosManager.getCatalogCache(fixedBranch || 'default');

          const prodList = offlineData.products.length > 0 ? offlineData.products : catalogFallback?.products || [];
          const catList = offlineData.categories.length > 0 ? offlineData.categories : catalogFallback?.categories || [];

          if (prodList.length > 0) {
            if (!cancelled) {
              setProducts(prodList);
              setCategories(catList);
              if (offlineData.customers.length > 0) setCustomers(offlineData.customers);
              if (offlineData.settings) setSettings(offlineData.settings);
              if (offlineData.stockMap) setStockMap(offlineData.stockMap);
              setLoading(false);
            }
            return;
          }
        }

        let cusq = supabase.from('customers').select('*');
        let catq = supabase.from('categories').select('*');
        let areaq = supabase.from('dining_areas').select('*');
        const productQuery = fixedBranch
          ? supabase.from('products').select('*, category:categories(*)').eq('branch_id', fixedBranch).eq('is_active', true)
          : supabase.from('products').select('*, category:categories(*)').eq('is_active', true).order('name');
        if (fixedBranch) {
          cusq = cusq.eq('branch_id', fixedBranch);
          catq = catq.eq('branch_id', fixedBranch);
          areaq = areaq.eq('branch_id', fixedBranch);
        }
        const [pRes, cRes, sRes, bRes, catRes, aRes] = await Promise.allSettled([
          productQuery,
          cusq.order('name'),
          supabase.from('settings').select('*').maybeSingle(),
          supabase.from('branches').select('*').eq('is_active', true).order('name'),
          catq.order('name'),
          areaq.order('name'),
        ]);
        if (cancelled) return;
        
        const errors: string[] = [];
        let loadedProds: Product[] = [];
        let loadedCats: Category[] = [];
        let loadedCusts: Customer[] = [];
        let loadedSettings: Settings | null = null;
        let loadedBranches: Branch[] = [];

        if (pRes.status === 'fulfilled' && pRes.value.error) errors.push('products: ' + pRes.value.error.message);
        else if (pRes.status === 'fulfilled') {
          loadedProds = (pRes.value.data as Product[]) || [];
          setProducts(loadedProds);
        }

        if (cRes.status === 'fulfilled' && cRes.value.error) errors.push('customers: ' + cRes.value.error.message);
        else if (cRes.status === 'fulfilled') {
          loadedCusts = (cRes.value.data as Customer[]) || [];
          setCustomers(loadedCusts);
        }

        if (sRes.status === 'fulfilled' && sRes.value.error) errors.push('settings: ' + sRes.value.error.message);
        else if (sRes.status === 'fulfilled') {
          loadedSettings = sRes.value.data as Settings;
          setSettings(loadedSettings);
        }

        if (bRes.status === 'fulfilled' && bRes.value.error) errors.push('branches: ' + bRes.value.error.message);
        else if (bRes.status === 'fulfilled') {
          loadedBranches = (bRes.value.data as Branch[]) || [];
          setBranches(loadedBranches);
        }

        if (catRes.status === 'fulfilled' && catRes.value.error) errors.push('categories: ' + catRes.value.error.message);
        else if (catRes.status === 'fulfilled') {
          loadedCats = (catRes.value.data as Category[]) || [];
          setCategories(loadedCats);
        }

        if (aRes.status === 'fulfilled' && aRes.value.data) setDiningAreas((aRes.value.data as DiningArea[]) || []);

        // Cache online data for offline use
        if (loadedProds.length > 0) {
          offlinePosManager.saveCatalogCache(fixedBranch || 'default', loadedProds, loadedCats);
          void cachePosData({
            branchId: fixedBranch || 'default',
            products: loadedProds,
            categories: loadedCats,
            customers: loadedCusts,
            settings: loadedSettings,
            branches: loadedBranches,
          });
        }

        // If online query had errors or zero products, attempt offline fallback gracefully
        if (errors.length > 0 || loadedProds.length === 0) {
          const offlineData = await loadCachedPosData(fixedBranch || undefined);
          const catalogFallback = offlinePosManager.getCatalogCache(fixedBranch || 'default');
          const fallbackProds = offlineData.products.length > 0 ? offlineData.products : catalogFallback?.products || [];
          const fallbackCats = offlineData.categories.length > 0 ? offlineData.categories : catalogFallback?.categories || [];

          if (fallbackProds.length > 0) {
            setProducts(fallbackProds);
            setCategories(fallbackCats);
            if (offlineData.customers.length > 0) setCustomers(offlineData.customers);
            if (offlineData.settings) setSettings(offlineData.settings);
            // Clear errors because we successfully recovered with offline catalog
          } else if (errors.length > 0) {
            setLoadError(errors.join('\n'));
          }
        }
      } catch (err: unknown) {
        // Try offline fallback on exception
        try {
          const offlineData = await loadCachedPosData(effectiveBranch || undefined);
          const catalogFallback = offlinePosManager.getCatalogCache(effectiveBranch || 'default');
          const fallbackProds = offlineData.products.length > 0 ? offlineData.products : catalogFallback?.products || [];
          const fallbackCats = offlineData.categories.length > 0 ? offlineData.categories : catalogFallback?.categories || [];

          if (fallbackProds.length > 0) {
            if (!cancelled) {
              setProducts(fallbackProds);
              setCategories(fallbackCats);
              if (offlineData.customers.length > 0) setCustomers(offlineData.customers);
              if (offlineData.settings) setSettings(offlineData.settings);
            }
            return;
          }
        } catch {
          // ignore
        }
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [effectiveBranch, reloadKey, cachePosData, loadCachedPosData]);

  useEffect(() => {
    if (effectiveBranch) void loadStock(effectiveBranch);
  }, [effectiveBranch, loadStock]);

  useEffect(() => {
    let cancelled = false;
    const manufactured = products.filter((p) => p.product_type === 'manufactured');
    if (manufactured.length === 0) {
      setRecipeMap({});
      return;
    }
    supabase
      .from('product_components')
      .select('*')
      .in(
        'product_id',
        manufactured.map((p) => p.id)
      )
      .then(({ data }) => {
        if (cancelled) return;
        const map: Record<string, ProductComponent[]> = {};
        for (const row of (data || []) as ProductComponent[]) (map[row.product_id] = map[row.product_id] || []).push(row);
        setRecipeMap(map);
      });
    return () => {
      cancelled = true;
    };
  }, [products]);

  const openOrderWorkspace = (orderId: string, opts: { pay?: boolean } = {}) => {
    if (pos.activeOrderId === orderId) {
      if (opts.pay) {
        pos.setPaymentMethod('cash');
        pos.setPaidAmount(pos.total);
        pos.setCheckoutOpen(true);
      }
      setPanel(null);
      setMobileOrderOpen(false);
      return;
    }
    navigate(`/pos/${orderId}`, { state: { branchId: effectiveBranch, ...(opts.pay ? { pay: 1 } : {}) } });
  };

  const startOrderAtTable = (tableId: string) => {
    if (pos.activeOrderId || pos.cart.length > 0) {
      const ok = window.confirm(isAr ? 'سيتم إغلاق الطلب الحالي محلياً وبدء طلب جديد على الطاولة. متابعة؟' : 'The current workspace order will be cleared. Continue?');
      if (!ok) return;
      pos.resetWorkspace();
    }
    setStartStep('table');
    setPreselectedTableId(tableId);
    setPanel(null);
    setMobileOrderOpen(false);
  };

  const handleStartOrder = (opts: StartOrderOptions) => {
    pos.resetWorkspace();
    pos.setOrderType(opts.orderType);
    if (opts.tableId) pos.setTableId(opts.tableId);
    pos.setGuestCount(opts.guestCount ?? null);
    if (opts.customerId) pos.setCustomerId(opts.customerId);
    pos.setOrderNotes(opts.notes || '');
    setStartStep(null);
    setPreselectedTableId(null);
    setPanel(null);
    setMobileOrderOpen(false);
  };

  const handleWizardResume = (order: Order, pay = false) => {
    setStartStep(null);
    setPreselectedTableId(null);
    setPanel(null);
    setMobileOrderOpen(false);
    openOrderWorkspace(order.id, pay ? { pay: true } : {});
  };

  const handleCancelOrder = (orderId: string, orderNumber?: string | null) => {
    setCancelModalOrder({ id: orderId, orderNumber: orderNumber || null });
  };

  const handleBranchChange = (v: string) => {
    if (v !== effectiveBranch && (pos.cart.length > 0 || pos.activeOrderId)) {
      const ok = window.confirm(isAr ? 'تبديل الفرع سيمسح السلة الحالية. متابعة؟' : 'Switching branch will clear the current cart. Continue?');
      if (!ok) return;
    }
    setSelectedBranch(v);
    pos.resetWorkspace();
    void loadStock(v);
  };

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-ui-page gap-4">
        <Logo variant="mark" size={56} tone="auto" />
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-ui-primary border-t-transparent" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-screen flex items-center justify-center bg-ui-page">
        <div className="text-center max-w-md px-4">
          <div className="flex justify-center mb-4">
            <Logo variant="mark" size={56} tone="auto" />
          </div>
          <div className="w-16 h-16 rounded-full bg-ui-danger/20 border border-ui-danger/30 flex items-center justify-center mx-auto mb-4">
            <ShoppingCart className="w-8 h-8 text-ui-danger" />
          </div>
          <p className="text-lg font-semibold text-ui-text mb-2">{isAr ? 'خطأ في تحميل البيانات' : 'Error Loading Data'}</p>
          <p className="text-sm text-ui-muted mb-4 whitespace-pre-line">{loadError}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="px-6 py-2.5 rounded-xl bg-ui-primary hover:bg-ui-primary-hover text-ui-primary-fg font-bold transition-colors"
          >
            {isAr ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  const currentBranchName = branches.find((b) => b.id === effectiveBranch)?.name || '';
  const isCheckout = pos.checkoutOpen;

  const handleSidebarSelectTable = (table: DiningTable) => {
    const tableOrders = ordersByTable[table.id] || [];
    if (tableOrders.length > 0) {
      const ord = tableOrders[0];
      openOrderWorkspace(ord.id);
    } else {
      if (pos.activeOrderId || pos.cart.length > 0) {
        const ok = window.confirm(
          isAr
            ? `سيتم إغلاق مساحة العمل الحالية وبدء طلب جديد على طاولة (${table.name}). متابعة؟`
            : `Switch to start a new order on Table (${table.name})? Current cart will be cleared.`
        );
        if (!ok) return;
      }
      pos.startTableOrder(table);
      if (orderIdParam) navigate('/pos');
    }
  };

  const handleConfirmTransfer = async (orderId: string, fromTableId: string, toTableId: string) => {
    return await pos.transferOrderToTable(orderId, fromTableId, toTableId);
  };

  const handleConfirmVoid = async (productId: string, voidQuantity: number, reason: string) => {
    await pos.voidSentItem(productId, voidQuantity, reason);
  };

  const rightPanel = isCheckout ? (
    <PaymentPanel
      currentBranchName={currentBranchName}
      orderType={pos.orderType}
      activeTable={pos.activeTable}
      activeOrderNumber={pos.activeOrderNumber}
      guestCount={pos.guestCount}
      onGuestCountChange={pos.setGuestCount}
      customerId={pos.customerId}
      customers={customers}
      onCustomerChange={pos.setCustomerId}
      discountType={pos.discountType}
      discountAmount={pos.discountAmount}
      onDiscountTypeChange={pos.setDiscountType}
      onDiscountAmountChange={pos.setDiscountAmount}
      paymentMethod={pos.paymentMethod}
      onPaymentMethodChange={pos.setPaymentMethod}
      paidAmount={pos.paidAmount}
      onPaidAmountChange={pos.setPaidAmount}
      subtotal={pos.subtotal}
      discountValue={pos.discountValue}
      taxAmount={pos.taxAmount}
      total={pos.total}
      change={pos.change}
      completing={pos.completing}
      canComplete={!!effectiveBranch}
      onComplete={() => void pos.completeSale()}
      onBack={() => pos.setCheckoutOpen(false)}
      currency={pos.effCurrency}
      cart={pos.cart}
      orderNotes={pos.orderNotes}
    />
  ) : (
    <CurrentOrderPanel
      cart={pos.cart}
      currency={pos.effCurrency}
      subtotal={pos.subtotal}
      discountValue={pos.discountValue}
      discountType={pos.discountType}
      discountAmount={pos.discountAmount}
      taxRate={effSettings?.tax_enabled ? effSettings.tax_rate || 0 : 0}
      taxAmount={pos.taxAmount}
      total={pos.total}
      completing={pos.completing}
      orderLoading={pos.orderLoading}
      kitchenSending={pos.kitchenSending}
      orderType={pos.orderType}
      activeOrderNumber={pos.activeOrderNumber}
      activeOrderId={pos.activeOrderId}
      activeTable={pos.activeTable}
      guestCount={pos.guestCount}
      customerId={pos.customerId}
      customerById={customerById}
      orderNotes={pos.orderNotes}
      activeOrderCreatedAt={activeOrderCreatedAt}
      orderItems={orderItemsForActive}
      sentOrderItemIds={sentOrderItemIds}
      sessionSent={pos.kitchenSentItems}
      canDiscount={perms.canDiscount}
      canDeleteItem={perms.canDeleteItem}
      onSwitchOrderType={(ot) => void pos.switchOrderType(ot)}
      onGuestCountChange={pos.setGuestCount}
      onDiscountTypeChange={pos.setDiscountType}
      onDiscountAmountChange={pos.setDiscountAmount}
      onUpdateQty={pos.updateQty}
      onSetQty={pos.setQty}
      onRemove={pos.removeFromCart}
      onClear={pos.clearCart}
      onSetItemDiscount={pos.setItemDiscount}
      onHold={() => void pos.holdOrder()}
      onSendKitchen={() => void pos.sendToKitchen()}
      onPrint={pos.printKitchenTicket}
      onPay={handlePay}
      onAddItem={() => barcodeRef.current?.focus()}
      onConfigureItem={(item) => setConfigItem(item)}
      onOpenCustomerModal={() => setCustomerModalOpen(true)}
      onOpenTableModal={() => setTableModalOpen(true)}
      onVoidItem={(item, sentQty) => {
        setVoidItem(item);
        setVoidSentQty(sentQty);
        setVoidModalOpen(true);
      }}
    />
  );

  return (
    <div className="h-screen flex flex-col bg-ui-page text-ui-text overflow-hidden pb-[calc(56px+env(safe-area-inset-bottom))]">
      <PosTopBar
        panel={panel}
        onPanel={(p) => {
          setStartStep(null);
          if (p === 'orders') setOrdersCategory('all');
          setPanel(p);
        }}
        counts={{
          activeOrders: counts.active,
          occupiedTables: tables.filter((tb) => tb.status === 'occupied').length,
          kitchenOrders,
          heldOrders: counts.held,
          deliveryOrders: counts.delivery,
          takeawayOrders: counts.takeaway,
        }}
        branchId={effectiveBranch}
        branches={branches}
        canChangeBranch={perms.canChangeBranch}
        onBranchChange={handleBranchChange}
        isCashier={isCashier}
        shiftChecked={shiftChecked}
        activeShift={activeShift}
        onOpenShiftModal={() => setShiftModalOpen(true)}
        onNewOrder={() => {
          pos.resetWorkspace();
          setStartStep('type');
          setPreselectedTableId(null);
          setPanel(null);
          setMobileOrderOpen(false);
          if (orderIdParam) navigate('/pos');
        }}
        onExit={() => navigate('/dashboard')}
      />

      {products.length === 0 && !loading && (
        <div className="p-3 bg-ui-surface border-b border-ui-border">
          <PrerequisiteAlertBanner
            step={PREREQUISITE_STEPS.create_product}
            onAction={() =>
              startGuidance(
                PREREQUISITE_STEPS.create_product,
                'pos_checkout',
                location.pathname,
                { cart: pos.cart, orderType: pos.orderType },
                'شاشة نقطة البيع POS',
                'POS Workspace'
              )
            }
          />
        </div>
      )}

      {/* Fullscreen Table & Fast Order Selector Mode vs Products Browser Mode */}
      {viewMode === 'tables' ? (
        <div className="flex-1 flex flex-col min-h-0 bg-ui-page overflow-hidden">
          <FullScreenTableOrderSelector
            tables={tables}
            ordersByTable={ordersByTable}
            currency={pos.effCurrency}
            branchName={branches.find((b) => b.id === effectiveBranch)?.name || ''}
            onSelectTakeaway={() => {
              pos.resetWorkspace();
              pos.setOrderType('takeaway');
              setViewMode('products');
            }}
            onSelectDelivery={() => {
              pos.resetWorkspace();
              pos.setOrderType('delivery');
              setViewMode('products');
            }}
            onSelectTable={(table) => {
              const tableOrders = ordersByTable[table.id] || [];
              if (tableOrders.length > 0) {
                openOrderWorkspace(tableOrders[0].id);
              } else {
                pos.startTableOrder(table);
                if (orderIdParam) navigate('/pos');
              }
              setViewMode('products');
            }}
            onResumeOrder={(orderId) => {
              openOrderWorkspace(orderId);
              setViewMode('products');
            }}
            onBackToProducts={pos.cart.length > 0 || pos.activeOrderId ? () => setViewMode('products') : undefined}
          />
        </div>
      ) : (
        /* Main Split-Screen Workspace */
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Side: Dedicated Tables & Open Orders Sidebar (Desktop/Tablet) */}
          <div className="hidden md:flex shrink-0 h-full">
            <PosTablesSidebar
              tables={tables}
              ordersByTable={ordersByTable}
              itemsByOrder={itemsByOrder}
              kitchenSendsByOrder={kitchenSendsByOrder}
              currency={pos.effCurrency}
              activeTableId={pos.tableId || pos.activeTable?.id || null}
              activeOrderId={pos.activeOrderId}
              collapsed={tablesCollapsed}
              onToggleCollapse={() => setTablesCollapsed((prev) => !prev)}
              onSelectTable={handleSidebarSelectTable}
              onTransferOrder={(ord, tb) => {
                setTransferOrder(ord);
                setTransferSourceTable(tb);
                setTransferModalOpen(true);
              }}
              onSelectTakeaway={() => void pos.switchOrderType('takeaway')}
              onSelectDelivery={() => void pos.switchOrderType('delivery')}
              activeOrderType={pos.orderType}
            />
          </div>

          {/* Center: Product Browser with Fast Order Header Bar */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-ui-page">
            {/* Shift Closed Warning Banner */}
            {isCashier && !activeShift && (
              <div className="bg-rose-500/10 border-b border-rose-500/30 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
                <div className="flex items-center gap-2 font-bold">
                  <Timer className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  <span>
                    {isAr
                      ? '⚠️ الشفت مغلق: يجب فتح شفت عمل كاشير للتمكن من تسجيل الطلبات والبيع.'
                      : 'Shift closed: You must open a cashier shift to register orders and sales.'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShiftModalOpen(true)}
                  className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs shadow-sm active:scale-95 transition"
                >
                  {isAr ? 'فتح شفت الآن' : 'Open Shift Now'}
                </button>
              </div>
            )}

            {/* Shift Isolation Warning Banner */}
            {!pos.isOrderOwner && (
              <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-700 dark:text-amber-300">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span>
                    {isAr
                      ? `⚠️ عزل الطلبات: هذا الطلب تابع للمستخدم (${pos.orderCashierName || 'كاشير آخر'}). التعديل مقفل إلا لصاحبه أو المشرف.`
                      : `Shift Isolation: This order belongs to ${pos.orderCashierName || 'another cashier'}. Only the owner or manager can modify.`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    pos.resetWorkspace();
                    setViewMode('tables');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs shadow-sm active:scale-95 transition"
                >
                  {isAr ? 'بدء طلب جديد' : 'New Order'}
                </button>
              </div>
            )}

            <PosOrderHeaderBar
              orderNumber={pos.activeOrderNumber}
              orderId={pos.activeOrderId}
              activeTable={pos.activeTable}
              orderType={pos.orderType}
              itemsCount={pos.cart.reduce((s, it) => s + it.quantity, 0)}
              total={pos.total}
              currency={pos.effCurrency}
              createdAt={activeOrderCreatedAt}
              kitchenSends={kitchenSendsForActive}
              orderItems={orderItemsForActive}
              kitchenSending={pos.kitchenSending}
              completing={pos.completing}
              canDiscount={perms.canDiscount}
              canDeleteItem={perms.canDeleteItem}
              hasUnsentItems={hasUnsentItems}
              isOrderOwner={pos.isOrderOwner}
              orderCashierName={pos.orderCashierName}
              onOpenTablesView={() => setViewMode('tables')}
              onOpenRawMaterials={() => setRawMaterialsOpen(true)}
              onOpenTransferModal={() => {
                if (pos.activeTable && pos.activeOrderId) {
                  const currentOrd =
                    orders.find((o) => o.id === pos.activeOrderId) ||
                    ({
                      id: pos.activeOrderId,
                      order_number: pos.activeOrderNumber || '000',
                      table_id: pos.activeTable.id,
                      total: pos.total,
                      created_at: new Date().toISOString(),
                    } as Order);
                  setTransferOrder(currentOrd);
                  setTransferSourceTable(pos.activeTable);
                  setTransferModalOpen(true);
                }
              }}
              onHoldOrder={() => void pos.holdOrder()}
              onSendKitchen={() => void pos.sendToKitchen()}
              onPay={handlePay}
              onClear={pos.clearCart}
              onNewOrder={() => {
                pos.resetWorkspace();
                if (orderIdParam) navigate('/pos');
                setViewMode('tables');
              }}
            />

            <div className="flex-1 min-h-0">
              <ProductBrowser
                products={products}
                categories={categories}
                stockMap={stockMap}
                sellableStock={sellableStock}
                recipeMap={recipeMap}
                search={search}
                selectedCategory={selectedCategory}
                currency={pos.effCurrency}
                hasBranch={!!effectiveBranch}
                onSearch={setSearch}
                onSelectCategory={setSelectedCategory}
                onAddToCart={pos.addToCart}
                onConfigureProduct={(p) => setConfigProduct(p)}
                inputRef={barcodeRef}
              />
            </div>
          </div>

          {/* Right Side: Cart / Order Panel / Checkout - Visible with first item added or manually shown */}
          {pos.cart.length > 0 || isCheckout || showCartManual ? (
            <div className="hidden lg:flex w-[380px] xl:w-[410px] 2xl:w-[440px] flex-shrink-0 flex-col border-s border-ui-border bg-ui-surface shadow-ui-md transition-all">
              {rightPanel}
            </div>
          ) : (
            <div
              onClick={() => setShowCartManual(true)}
              title={isAr ? 'فتح السلة (فارغة)' : 'Open Cart (Empty)'}
              className="hidden lg:flex flex-col items-center justify-center w-12 border-s border-ui-border bg-ui-surface hover:bg-ui-page-alt py-6 text-center cursor-pointer transition-colors shrink-0 select-none group"
            >
              <div className="p-2 rounded-xl bg-ui-page group-hover:bg-ui-primary/10 transition-colors mb-2">
                <ShoppingCart className="w-4 h-4 text-ui-muted group-hover:text-ui-primary" />
              </div>
              <span className="text-[10px] font-bold text-ui-muted [writing-mode:vertical-rl] tracking-wider">
                {isAr ? 'السلة فارغة' : 'Empty Cart'}
              </span>
            </div>
          )}
        </div>
      )}

      {pos.cart.length > 0 && !mobileOrderOpen && !isCheckout && (
        <button
          onClick={() => setMobileOrderOpen(true)}
          className="lg:hidden fixed bottom-[calc(56px+env(safe-area-inset-bottom)+8px)] start-4 end-4 z-30 flex items-center justify-between gap-2 px-5 py-3.5 rounded-2xl bg-ui-primary text-ui-primary-fg border border-ui-border-strong shadow-ui-lg active:scale-[0.98] transition-all"
        >
          <span className="flex items-center gap-2 font-bold text-sm">
            <ShoppingCart className="w-5 h-5 text-ui-accent" />
            {isAr ? 'عرض السلة' : 'View Cart'}
            <span className="px-2 py-0.5 rounded-full bg-ui-accent text-ui-primary-fg text-xs font-bold">
              {pos.cart.length}
            </span>
          </span>
          <span className="font-bold text-ui-accent">
            {formatCurrency(pos.total, pos.effCurrency, lang)}
          </span>
        </button>
      )}

      {mobileOrderOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex items-end justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOrderOpen(false)} />
          <div className="relative w-full max-h-[92vh] bg-ui-surface rounded-t-2xl shadow-ui-xl overflow-hidden animate-slide-up flex flex-col">
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-ui-border">
              <button
                onClick={() => setMobileOrderOpen(false)}
                className="p-2 rounded-lg text-ui-muted hover:bg-ui-page-alt"
              >
                <ShoppingCart className="w-5 h-5" />
              </button>
              <span className="text-xs font-bold text-ui-muted">
                {isAr ? 'اسحب لأسفل للإغلاق' : 'Order'}
              </span>
              <span className="text-sm font-black text-ui-accent">
                {formatCurrency(pos.total, pos.effCurrency, lang)}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">{rightPanel}</div>
          </div>
        </div>
      )}

      <PosBottomNav
        disabled={isCheckout}
        panel={panel}
        category={ordersCategory}
        counts={{
          activeOrders: counts.active,
          deliveryOrders: counts.delivery,
          takeawayOrders: counts.takeaway,
          occupiedTables: tables.filter((tb) => tb.status === 'occupied').length,
        }}
        onOpenOrders={(c) => {
          setStartStep(null);
          setOrdersCategory(c);
          setPanel('orders');
        }}
        onOpenTables={() => {
          setStartStep(null);
          setPanel('tables');
        }}
      />

      <ActiveOrdersDrawer
        open={panel === 'orders'}
        onClose={() => setPanel(null)}
        initialCategory={ordersCategory}
        orders={orders}
        itemsByOrder={itemsByOrder}
        kitchenSendsByOrder={kitchenSendsByOrder}
        tableById={tableById}
        customerById={customerById}
        currency={pos.effCurrency}
        onResume={(o) => openOrderWorkspace(o.id)}
        onPay={(o) => openOrderWorkspace(o.id, { pay: true })}
        onCancel={(o) => handleCancelOrder(o.id, o.order_number)}
      />

      <TablesPanel
        open={panel === 'tables'}
        onClose={() => setPanel(null)}
        tables={tables}
        ordersByTable={ordersByTable}
        currency={pos.effCurrency}
        onResume={(o) => openOrderWorkspace(o.id)}
        onPay={(o) => openOrderWorkspace(o.id, { pay: true })}
        onStart={(tb) => startOrderAtTable(tb.id)}
      />

      <KitchenPanel
        open={panel === 'kitchen'}
        onClose={() => setPanel(null)}
        orders={orders}
        itemsByOrder={itemsByOrder}
        kitchenSendsByOrder={kitchenSendsByOrder}
        tableById={tableById}
        productNames={productNames}
      />

      {startStep && (
        <OrderStartWizard
          step={startStep}
          tables={tables}
          ordersByTable={ordersByTable}
          itemsByOrder={itemsByOrder}
          kitchenSendsByOrder={kitchenSendsByOrder}
          customers={customers}
          preselectedTableId={preselectedTableId}
          currency={pos.effCurrency}
          onStepChange={setStartStep}
          onBack={() => setStartStep('type')}
          onStart={handleStartOrder}
          onResume={handleWizardResume}
          onActiveOrders={() => {
            setStartStep(null);
            setPreselectedTableId(null);
            setPanel('orders');
          }}
        />
      )}

      {/* Product Config Modal */}
      {(configProduct || configItem) && (
        <ProductConfigModal
          isOpen={!!(configProduct || configItem)}
          onClose={() => {
            setConfigProduct(null);
            setConfigItem(null);
          }}
          product={configProduct || configItem?.product || null}
          initialItem={configItem}
          currency={pos.effCurrency}
          onConfirm={(item) => {
            if (configItem) {
              pos.setQty(item.product.id, item.quantity);
              pos.setItemDiscount(item.product.id, item.discount_amount);
            } else {
              pos.addToCart(item.product, item.quantity, item.modifiers || [], item.discount_amount);
            }
            setConfigProduct(null);
            setConfigItem(null);
          }}
          canDiscount={perms.canDiscount}
        />
      )}

      {/* Customer Quick Modal */}
      <CustomerQuickModal
        isOpen={customerModalOpen}
        onClose={() => setCustomerModalOpen(false)}
        customers={customers}
        selectedCustomerId={pos.customerId}
        onSelectCustomer={(c) => pos.setCustomerId(c.id)}
        onCustomerCreated={(c) => {
          setCustomers((prev) => [c, ...prev]);
          pos.setCustomerId(c.id);
        }}
        branchId={effectiveBranch}
      />

      {/* Table Select Modal */}
      <TableSelectModal
        isOpen={tableModalOpen}
        onClose={() => setTableModalOpen(false)}
        tables={tables}
        areas={diningAreas}
        selectedTableId={pos.activeTable?.id || null}
        onSelectTable={(table) => pos.setTableId(table.id)}
      />

      {/* Transfer Order Modal */}
      <TransferOrderModal
        open={transferModalOpen}
        onClose={() => {
          setTransferModalOpen(false);
          setTransferOrder(null);
          setTransferSourceTable(null);
        }}
        order={transferOrder}
        sourceTable={transferSourceTable}
        tables={tables}
        areas={diningAreas}
        ordersByTable={ordersByTable}
        onConfirmTransfer={handleConfirmTransfer}
      />

      {/* Void Sent Item Modal */}
      <VoidItemModal
        open={voidModalOpen}
        onClose={() => {
          setVoidModalOpen(false);
          setVoidItem(null);
        }}
        item={voidItem}
        sentQty={voidSentQty}
        onConfirmVoid={handleConfirmVoid}
      />

      {/* Shift Modal */}
      <ShiftModal
        isOpen={shiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        branchId={effectiveBranch}
        activeShift={activeShift}
        currency={pos.effCurrency}
        onShiftClosed={() => {
          reloadShift();
        }}
      />

      {/* Receipt Modal */}
      <Modal open={!!pos.receiptSaleId} onClose={pos.closeReceipt} title={t('printReceipt')} size="sm">
        {pos.lastReceipt && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-ui-success/15 ring-2 ring-ui-border-strong flex items-center justify-center mx-auto mb-3">
                <BarcodeIcon className="w-8 h-8 text-ui-success" />
              </div>
              <p className="text-base font-semibold text-ui-text">{t('saleCompleted')}</p>
              <p className="text-sm text-ui-muted mt-1">{pos.lastReceipt.invoice}</p>
            </div>
            <button
              onClick={() => void pos.printReceipt()}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-ui-primary hover:bg-ui-primary-hover text-ui-primary-fg font-bold transition-colors"
            >
              <Printer className="w-5 h-5" /> {t('printReceipt')}
            </button>
          </div>
        )}
      </Modal>

      {/* Raw and Manufactured Materials Stock Modal */}
      <RawAndManufacturedMaterialsPanel
        open={rawMaterialsOpen}
        onClose={() => setRawMaterialsOpen(false)}
        branchId={effectiveBranch}
        branchName={branches.find((b) => b.id === effectiveBranch)?.name}
        currency={pos.effCurrency}
      />

      {/* Cancel Order with Inventory Handling Modal */}
      {cancelModalOrder && (
        <CancelOrderModal
          open={!!cancelModalOrder}
          onClose={() => setCancelModalOrder(null)}
          orderId={cancelModalOrder.id}
          orderNumber={cancelModalOrder.orderNumber}
          branchId={effectiveBranch}
          onSuccess={() => {
            if (pos.activeOrderId === cancelModalOrder.id) {
              pos.resetWorkspace();
              setViewMode('tables');
            }
            setCancelModalOrder(null);
          }}
        />
      )}

      {/* POS Action Approval Dialog */}
      <RequestApprovalDialog
        open={approvalDialog.open}
        onClose={() => setApprovalDialog((prev) => ({ ...prev, open: false }))}
        branchId={effectiveBranch}
        orderId={pos.activeOrderId || undefined}
        orderNumber={pos.activeOrderNumber || undefined}
        type={approvalDialog.type}
        initialAmount={approvalDialog.initialAmount}
        currency={pos.effCurrency}
        onApproved={() => {
          approvalDialog.onApproved();
          setApprovalDialog((prev) => ({ ...prev, open: false }));
        }}
      />
    </div>
  );
}

