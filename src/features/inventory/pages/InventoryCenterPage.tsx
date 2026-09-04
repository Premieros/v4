import { ArrowLeftRight, ClipboardCheck, FileBarChart, Layers3, Package, PackageSearch, Warehouse, Boxes } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { CenterGrid, type CenterTileItem } from '@/components/design/CenterTile';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';

export function InventoryCenterPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const ar = lang === 'ar';

  const actions: CenterTileItem[] = [
    { id: 'stock', ar: 'الرصيد الحالي', en: 'Current Stock', descriptionAr: 'عرض أرصدة الأصناف وحالتها.', descriptionEn: 'View current stock balances and status.', route: APP_ROUTES.inventory, permission: can('inventory.view'), icon: Boxes },
    { id: 'warehouses', ar: 'المستودعات', en: 'Warehouses', descriptionAr: 'إدارة المستودعات والأرصدة.', descriptionEn: 'Manage warehouses and balances.', route: APP_ROUTES.warehouses, permission: can('warehouses.view'), icon: Warehouse },
    { id: 'ledger', ar: 'دفتر حركة المخزون', en: 'Inventory Ledger', descriptionAr: 'تتبع كل حركة دخول وخروج وتحويل.', descriptionEn: 'Trace stock receipts, issues, and transfers.', route: APP_ROUTES.inventoryLedger, permission: can('inventory.ledger.view'), icon: FileBarChart },
    { id: 'transfers', ar: 'التحويلات', en: 'Transfers', descriptionAr: 'نقل المخزون بين المستودعات والفروع.', descriptionEn: 'Move stock between warehouses and branches.', route: APP_ROUTES.transfers, permission: can('inventory.transfers'), icon: ArrowLeftRight },
    { id: 'counts', ar: 'الجرد والتسويات', en: 'Counts & Adjustments', descriptionAr: 'الجرد الفعلي ومراجعة الفروقات.', descriptionEn: 'Physical counts and variance adjustments.', route: APP_ROUTES.stockCounts, permission: can('inventory.manage'), icon: ClipboardCheck },
    { id: 'batches', ar: 'التشغيلات والصلاحية', en: 'Batches & Expiry', descriptionAr: 'متابعة التشغيلات وتواريخ الصلاحية.', descriptionEn: 'Track batches and expiry dates.', route: APP_ROUTES.inventoryBatches, permission: can('inventory.view'), icon: Layers3 },
    { id: 'low-stock', ar: 'تنبيهات النقص', en: 'Low Stock Alerts', descriptionAr: 'الأصناف التي تحتاج إلى إعادة طلب.', descriptionEn: 'Items requiring replenishment.', route: APP_ROUTES.lowStockAlerts, permission: can('inventory.view'), icon: PackageSearch },
    { id: 'valuation', ar: 'تقييم المخزون', en: 'Stock Valuation', descriptionAr: 'قيمة المخزون وتكلفته حسب البيانات الحالية.', descriptionEn: 'Current inventory value and cost.', route: APP_ROUTES.stockValuation, permission: can('inventory.ledger.view'), icon: Package },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={ar ? 'مركز المخزون' : 'Inventory Center'}
        subtitle={ar ? 'مركز موحد لكل وظائف المخزون المدعومة في Premier' : 'A stable hub for the inventory capabilities already supported by Premier.'}
      />
      <CenterGrid items={actions} testIdPrefix="inventory-center" columns={4} />
      <div className="rounded-2xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
        <h2 className="font-bold text-ui-text">{ar ? 'دورة المخزون' : 'Inventory flow'}</h2>
        <p className="mt-2 text-sm leading-6 text-ui-muted">
          {ar
            ? 'يمكن متابعة المخزون من الرصيد الحالي إلى الحركة والجرد والتحويلات والتقييم، مع بقاء كل عملية مرتبطة بمسار ثابت وصلاحية مستقلة.'
            : 'Follow inventory from current balances through ledger, counts, transfers, and valuation. Each action uses a stable route and independent permission.'}
        </p>
      </div>
    </div>
  );
}
