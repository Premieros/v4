import { useEffect, useMemo, useState } from 'react';
import { Plus, Play, CheckCircle, XCircle } from 'lucide-react';
import { supabase, manufacturing } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination, DesignFilterBar } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency, formatNumber, formatDate } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { Product, Warehouse, Branch } from '@/lib/types';

export interface ProductionOrder {
  id: string;
  order_number: string;
  product_id: string;
  branch_id: string;
  warehouse_id: string | null;
  quantity: number;
  batch_number: string | null;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  total_cost: number;
  planned_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_at: string;
  product?: Product;
  branch?: Branch;
  warehouse?: Warehouse;
}

export function ProductionOrdersPage() {
  const { lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const isAr = lang === 'ar';

  const { rows: rawOrders, loading, total, hasMore, loadMore, loadingMore, refresh: reloadOrders } = usePaginatedRows<ProductionOrder>({
    table: 'production_orders',
    select: '*, product:products(*), branch:branches(*), warehouse:warehouses(*)',
    order: { column: 'created_at', ascending: false },
    pageSize: 50,
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Create Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    product_id: '',
    branch_id: '',
    warehouse_id: '',
    quantity: 1,
    batch_number: '',
    planned_at: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  // Complete / Waste Modal
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [activeOrder, setActiveOrder] = useState<ProductionOrder | null>(null);
  const [wasteQty, setWasteQty] = useState(0);
  const [wasteReason, setWasteReason] = useState('');

  // Cancel Dialog
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelOrderTarget, setCancelOrderTarget] = useState<ProductionOrder | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState('');

  useEffect(() => {
    async function loadMetadata() {
      try {
        const [prodRes, whRes] = await Promise.all([
          supabase.from('products').select('*').order('name'),
          supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
        ]);
        if (prodRes.data) setProducts(prodRes.data as Product[]);
        if (whRes.data) setWarehouses(whRes.data as Warehouse[]);
      } catch (err) {
        console.error('Failed to load production metadata', err);
      }
    }
    void loadMetadata();
  }, []);

  const branchFilteredOrders = useMemo(() => {
    if (!branchFilter) return rawOrders;
    return rawOrders.filter((o) => o.branch_id === branchFilter);
  }, [rawOrders, branchFilter]);

  const filteredOrders = useMemo(() => {
    return branchFilteredOrders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      const numMatch = o.order_number?.toLowerCase().includes(s);
      const prodMatch = o.product?.name?.toLowerCase().includes(s);
      const batchMatch = o.batch_number?.toLowerCase().includes(s);
      return Boolean(numMatch || prodMatch || batchMatch);
    });
  }, [branchFilteredOrders, statusFilter, search]);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.product_id) {
      show(isAr ? 'يرجى اختيار المنتج المراد تصنيعه' : 'Please select a product', 'error');
      return;
    }
    if (createForm.quantity <= 0) {
      show(isAr ? 'الكمية يجب أن تكون أكبر من صفر' : 'Quantity must be greater than 0', 'error');
      return;
    }

    const branchId = createForm.branch_id || user?.branch_id || '';
    if (!branchId) {
      show(isAr ? 'يرجى تحديد الفرع' : 'Please specify a branch', 'error');
      return;
    }

    const res = await manufacturing.createOrder({
      p_product_id: createForm.product_id,
      p_branch_id: branchId,
      p_warehouse_id: createForm.warehouse_id || null,
      p_quantity: Number(createForm.quantity),
      p_batch_number: createForm.batch_number || null,
      p_planned_at: createForm.planned_at || null,
      p_notes: createForm.notes || null,
    });

    if (res.error || !res.data?.success) {
      show(res.data?.error || (isAr ? 'فشل إنشاء أمر الإنتاج' : 'Failed to create production order'), 'error');
      return;
    }

    show(isAr ? 'تم إنشاء أمر الإنتاج بنجاح' : 'Production order created successfully', 'success');
    logAudit({
      action: 'create',
      entity: 'production_orders',
      entityId: res.data.order_id,
      details: { order_number: res.data.order_number, quantity: createForm.quantity },
    });
    setCreateOpen(false);
    setCreateForm({
      product_id: '',
      branch_id: '',
      warehouse_id: '',
      quantity: 1,
      batch_number: '',
      planned_at: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    reloadOrders();
  };

  const handleStartOrder = async (order: ProductionOrder) => {
    const res = await manufacturing.startOrder({ p_order_id: order.id });
    if (res.error || !res.data?.success) {
      show(res.data?.error || (isAr ? 'فشل بدء أمر الإنتاج' : 'Failed to start order'), 'error');
      return;
    }
    show(isAr ? 'تم بدء أمر الإنتاج' : 'Production order started', 'success');
    logAudit({ action: 'update', entity: 'production_orders', entityId: order.id, details: { status: 'in_progress' } });
    reloadOrders();
  };

  const handleCompleteOrder = async () => {
    if (!activeOrder) return;
    const res = await manufacturing.completeOrder({
      p_order_id: activeOrder.id,
      p_waste: wasteQty > 0 ? [{ raw_material_id: '', quantity: wasteQty, reason: wasteReason || null }] : null,
    });

    if (res.error || !res.data?.success) {
      show(res.data?.error || (isAr ? 'فشل إتمام أمر الإنتاج' : 'Failed to complete order'), 'error');
      return;
    }

    show(isAr ? 'تم إتمام أمر الإنتاج وخصم الخامات بنجاح' : 'Production order completed and materials deducted', 'success');
    logAudit({ action: 'update', entity: 'production_orders', entityId: activeOrder.id, details: { status: 'completed' } });
    setCompleteModalOpen(false);
    setActiveOrder(null);
    setWasteQty(0);
    setWasteReason('');
    reloadOrders();
  };

  const handleCancelOrder = async () => {
    if (!cancelOrderTarget) return;
    const res = await manufacturing.cancelOrder({
      p_order_id: cancelOrderTarget.id,
      p_reason: cancelReasonText || null,
    });

    if (res.error || !res.data?.success) {
      show(res.data?.error || (isAr ? 'فشل إلغاء أمر الإنتاج' : 'Failed to cancel order'), 'error');
      return;
    }

    show(isAr ? 'تم إلغاء أمر الإنتاج' : 'Production order cancelled', 'success');
    logAudit({ action: 'update', entity: 'production_orders', entityId: cancelOrderTarget.id, details: { status: 'cancelled' } });
    setCancelDialogOpen(false);
    setCancelOrderTarget(null);
    setCancelReasonText('');
    reloadOrders();
  };

  const getStatusBadge = (status: ProductionOrder['status']) => {
    switch (status) {
      case 'planned':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">{isAr ? 'مخطط' : 'Planned'}</span>;
      case 'in_progress':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{isAr ? 'قيد التشغيل' : 'In Progress'}</span>;
      case 'completed':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">{isAr ? 'مكتمل' : 'Completed'}</span>;
      case 'cancelled':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">{isAr ? 'ملغي' : 'Cancelled'}</span>;
    }
  };

  const columns: Column<ProductionOrder>[] = [
    {
      key: 'order_number',
      header: isAr ? 'رقم الأمر' : 'Order #',
      render: (o) => (
        <div>
          <span className="font-mono font-semibold text-ui-primary text-sm">{o.order_number}</span>
          {o.batch_number && <div className="text-xs text-ui-subtle">{isAr ? `تشغيلة: ${o.batch_number}` : `Batch: ${o.batch_number}`}</div>}
        </div>
      ),
    },
    {
      key: 'product',
      header: isAr ? 'المنتج' : 'Product',
      render: (o) => (
        <div>
          <div className="font-medium text-ui-strong">{o.product?.name || isAr ? 'منتج غير محدد' : 'Unknown'}</div>
          <div className="text-xs text-ui-subtle">{o.product?.sku}</div>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: isAr ? 'الكمية' : 'Quantity',
      render: (o) => <span className="font-semibold">{formatNumber(o.quantity)}</span>,
    },
    {
      key: 'branch',
      header: isAr ? 'الفرع / المخزن' : 'Branch / Warehouse',
      render: (o) => (
        <div className="text-xs">
          <div className="font-medium text-ui-strong">{o.branch?.name || '-'}</div>
          <div className="text-ui-subtle">{o.warehouse?.name || '-'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: isAr ? 'الحالة' : 'Status',
      render: (o) => getStatusBadge(o.status),
    },
    {
      key: 'total_cost',
      header: isAr ? 'إجمالي التكلفة' : 'Total Cost',
      render: (o) => <span>{o.total_cost > 0 ? formatCurrency(o.total_cost) : '-'}</span>,
    },
    {
      key: 'planned_at',
      header: isAr ? 'تاريخ التخطيط' : 'Planned Date',
      render: (o) => <span className="text-xs text-ui-subtle">{o.planned_at ? formatDate(o.planned_at) : '-'}</span>,
    },
    {
      key: 'actions',
      header: isAr ? 'إجراءات' : 'Actions',
      render: (o) => {
        const canManage = can('production.manage');
        if (!canManage) return null;

        return (
          <div className="flex items-center gap-1">
            {o.status === 'planned' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleStartOrder(o)}
                title={isAr ? 'بدء الإنتاج' : 'Start Production'}
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                {isAr ? 'بدء' : 'Start'}
              </Button>
            )}
            {o.status === 'in_progress' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setActiveOrder(o);
                  setCompleteModalOpen(true);
                }}
                title={isAr ? 'إتمام الإنتاج' : 'Complete Production'}
              >
                <CheckCircle className="w-3.5 h-3.5 mr-1" />
                {isAr ? 'إتمام' : 'Complete'}
              </Button>
            )}
            {(o.status === 'planned' || o.status === 'in_progress') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCancelOrderTarget(o);
                  setCancelDialogOpen(true);
                }}
                className="text-red-600 hover:text-red-700"
                title={isAr ? 'إلغاء الأمر' : 'Cancel Order'}
              >
                <XCircle className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <DesignSurface testId="production-orders-page">
      <DesignPageHeader
        title={isAr ? 'أوامر الإنتاج والتصنيع' : 'Production Orders'}
        subtitle={isAr ? 'متابعة أوامر التشغيل والإنتاج واستهلاك المواد الخام عبر الوصفات' : 'Manage production cycles, raw material consumption, and recipe yields'}
        actions={
          can('production.manage') && (
            <Button
              variant="primary"
              onClick={() => {
                setCreateForm({
                  product_id: '',
                  branch_id: user?.branch_id || '',
                  warehouse_id: '',
                  quantity: 1,
                  batch_number: '',
                  planned_at: new Date().toISOString().slice(0, 10),
                  notes: '',
                });
                setCreateOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              {isAr ? 'أمر إنتاج جديد' : 'New Production Order'}
            </Button>
          )
        }
      />

      <DesignFilterBar>
        <div className="flex-1 min-w-[240px]">
          <DesignSearch
            value={search}
            onChange={setSearch}
            placeholder={isAr ? 'بحث برقم الأمر أو المنتج أو رقم التشغيلة...' : 'Search order #, product, or batch...'}
            label="production-orders-search"
            testId="production-orders-search"
          />
        </div>
        <div className="w-44">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'all', label: isAr ? 'جميع الحالات' : 'All Statuses' },
              { value: 'planned', label: isAr ? 'مخطط' : 'Planned' },
              { value: 'in_progress', label: isAr ? 'قيد التشغيل' : 'In Progress' },
              { value: 'completed', label: isAr ? 'مكتمل' : 'Completed' },
              { value: 'cancelled', label: isAr ? 'ملغي' : 'Cancelled' },
            ]}
          />
        </div>
      </DesignFilterBar>

      <DesignPanel testId="production-orders-panel" title={isAr ? 'سجل أوامر الإنتاج' : 'Production Orders Ledger'}>
        <DataTable
          columns={columns}
          data={filteredOrders}
          loading={loading}
          emptyMessage={isAr ? 'لا توجد أوامر إنتاج مطابقة' : 'No production orders found'}
        />
        <DesignPagination
          loaded={filteredOrders.length}
          total={total}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
        />
      </DesignPanel>

      {/* Create Order Modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title={isAr ? 'إنشاء أمر إنتاج جديد' : 'New Production Order'}
      >
        <form onSubmit={handleCreateOrder} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ui-subtle mb-1">
              {isAr ? 'المنتج المراد تصنيعه' : 'Target Product'} *
            </label>
            <Select
              value={createForm.product_id}
              onChange={(e) => setCreateForm({ ...createForm, product_id: e.target.value })}
              options={[
                { value: '', label: isAr ? '-- اختر المنتج --' : '-- Select Product --' },
                ...products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku || 'No SKU'})` })),
              ]}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ui-subtle mb-1">
                {isAr ? 'الكمية المطلوبة' : 'Quantity'} *
              </label>
              <Input
                type="number"
                min="0.01"
                step="any"
                value={createForm.quantity}
                onChange={(e) => setCreateForm({ ...createForm, quantity: Number(e.target.value) })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ui-subtle mb-1">
                {isAr ? 'رقم التشغيلة (Batch)' : 'Batch Number'}
              </label>
              <Input
                type="text"
                placeholder="BATCH-001"
                value={createForm.batch_number}
                onChange={(e) => setCreateForm({ ...createForm, batch_number: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ui-subtle mb-1">
                {isAr ? 'مستودع الاستلام' : 'Destination Warehouse'}
              </label>
              <Select
                value={createForm.warehouse_id}
                onChange={(e) => setCreateForm({ ...createForm, warehouse_id: e.target.value })}
                options={[
                  { value: '', label: isAr ? '-- المستودع الافتراضي --' : '-- Default Warehouse --' },
                  ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                ]}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ui-subtle mb-1">
                {isAr ? 'التاريخ المخطط' : 'Planned Date'}
              </label>
              <Input
                type="date"
                value={createForm.planned_at}
                onChange={(e) => setCreateForm({ ...createForm, planned_at: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ui-subtle mb-1">
              {isAr ? 'ملاحظات' : 'Notes'}
            </label>
            <Input
              type="text"
              value={createForm.notes}
              onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              placeholder={isAr ? 'أي تعليمات تشغيلية خاصة...' : 'Any special notes...'}
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>
              {isAr ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button variant="primary" type="submit">
              {isAr ? 'إنشاء الأمر' : 'Create Order'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Complete Order Modal */}
      <Modal
        isOpen={completeModalOpen}
        onClose={() => {
          setCompleteModalOpen(false);
          setActiveOrder(null);
        }}
        title={isAr ? `إتمام أمر الإنتاج: ${activeOrder?.order_number || ''}` : `Complete Order: ${activeOrder?.order_number || ''}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-ui-subtle">
            {isAr
              ? 'سيتم استهلاك المواد الخام من مخزون الفرع آليًا وفق وصفة المنتج، وإضافة الكمية المكتملة إلى مخزون المنتج النهائي.'
              : 'Raw materials will be deducted from branch inventory according to the product recipe, and the finished product stock will be increased.'}
          </p>

          <div className="bg-ui-surface-subtle p-3 rounded-md space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-ui-subtle">{isAr ? 'المنتج:' : 'Product:'}</span>
              <span className="font-semibold">{activeOrder?.product?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ui-subtle">{isAr ? 'الكمية المنتجة:' : 'Produced Quantity:'}</span>
              <span className="font-semibold">{formatNumber(activeOrder?.quantity || 0)}</span>
            </div>
          </div>

          {can('production.waste') && (
            <div className="border-t pt-3 space-y-3">
              <h4 className="text-xs font-bold text-ui-strong">{isAr ? 'تسجيل هالك إنتاج (اختياري)' : 'Record Production Waste (Optional)'}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ui-subtle mb-1">{isAr ? 'كمية الهالك' : 'Waste Quantity'}</label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={wasteQty}
                    onChange={(e) => setWasteQty(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ui-subtle mb-1">{isAr ? 'سبب الهالك' : 'Reason'}</label>
                  <Input
                    type="text"
                    value={wasteReason}
                    onChange={(e) => setWasteReason(e.target.value)}
                    placeholder={isAr ? 'عطل ماكينة، حرق، تلف...' : 'Machine fault, burnt, etc.'}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="secondary" onClick={() => setCompleteModalOpen(false)}>
              {isAr ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button variant="primary" onClick={() => void handleCompleteOrder()}>
              <CheckCircle className="w-4 h-4 mr-1.5" />
              {isAr ? 'تأكيد وإتمام الإنتاج' : 'Confirm & Complete'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cancel Order Dialog */}
      <ConfirmDialog
        isOpen={cancelDialogOpen}
        onClose={() => setCancelDialogOpen(false)}
        onConfirm={() => void handleCancelOrder()}
        title={isAr ? 'إلغاء أمر الإنتاج' : 'Cancel Production Order'}
        message={
          isAr
            ? `هل أنت متأكد من إلغاء أمر الإنتاج رقم ${cancelOrderTarget?.order_number || ''}؟`
            : `Are you sure you want to cancel production order ${cancelOrderTarget?.order_number || ''}?`
        }
        confirmText={isAr ? 'نعم، إلغاء الأمر' : 'Yes, Cancel Order'}
        cancelText={isAr ? 'تراجع' : 'Back'}
        variant="danger"
      />
    </DesignSurface>
  );
}
