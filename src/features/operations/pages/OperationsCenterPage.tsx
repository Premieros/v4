import { ArrowLeftRight, Boxes, ChefHat, ClipboardCheck, PackageSearch, ShoppingCart, Truck, Warehouse } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { CenterGrid, type CenterTileItem } from '@/components/design/CenterTile';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';

export function OperationsCenterPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const ar = lang === 'ar';

  const cards: CenterTileItem[] = [
    { id: 'pos', ar: 'نقطة البيع والطلبات', en: 'POS & Orders', descriptionAr: 'فتح نقطة البيع ومتابعة الطلبات النشطة.', descriptionEn: 'Open POS and monitor active orders.', route: APP_ROUTES.pos, permission: can('pos.sell'), icon: ShoppingCart },
    { id: 'inventory-center', ar: 'مركز المخزون', en: 'Inventory Center', descriptionAr: 'الوصول الموحد لكل وظائف المخزون.', descriptionEn: 'Unified access to all inventory functions.', route: APP_ROUTES.inventoryCenter, permission: can('inventory.view'), icon: Boxes },
    { id: 'inventory', ar: 'المخزون', en: 'Inventory', descriptionAr: 'الرصيد الحالي وحالة الأصناف.', descriptionEn: 'Current stock and item status.', route: APP_ROUTES.inventory, permission: can('inventory.view'), icon: Boxes },
    { id: 'warehouses', ar: 'المستودعات', en: 'Warehouses', descriptionAr: 'إدارة المستودعات والأرصدة.', descriptionEn: 'Manage warehouses and balances.', route: APP_ROUTES.warehouses, permission: can('warehouses.view'), icon: Warehouse },
    { id: 'transfers', ar: 'التحويلات المخزنية', en: 'Stock Transfers', descriptionAr: 'نقل الأصناف بين المستودعات والفروع.', descriptionEn: 'Move stock between warehouses and branches.', route: APP_ROUTES.transfers, permission: can('inventory.transfers'), icon: ArrowLeftRight },
    { id: 'counts', ar: 'الجرد والتسويات', en: 'Counts & Adjustments', descriptionAr: 'الجرد الفعلي وتسويات المخزون.', descriptionEn: 'Physical counts and stock adjustments.', route: APP_ROUTES.stockCounts, permission: can('inventory.manage'), icon: ClipboardCheck },
    { id: 'low-stock', ar: 'تنبيهات المخزون', en: 'Low Stock Alerts', descriptionAr: 'الأصناف التي تحتاج إلى إعادة طلب.', descriptionEn: 'Items that need replenishment.', route: APP_ROUTES.lowStockAlerts, permission: can('inventory.view'), icon: PackageSearch },
    { id: 'purchases', ar: 'المشتريات', en: 'Purchasing', descriptionAr: 'الفواتير وطلبات الشراء والاستلام.', descriptionEn: 'Purchases, requests, and receiving.', route: APP_ROUTES.purchases, permission: can('purchases.view'), icon: Truck },
    { id: 'kitchen', ar: 'المطبخ والطلبات', en: 'Kitchen & Orders', descriptionAr: 'متابعة الطلبات التشغيلية من نقطة البيع.', descriptionEn: 'Follow operational orders from POS.', route: APP_ROUTES.floorPlan, permission: can('floor_plan.view'), icon: ChefHat },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={ar ? 'مركز العمليات' : 'Operations Center'}
        subtitle={ar ? 'وصول موحد للوظائف التشغيلية الموجودة في النظام' : 'A stable hub for the operational capabilities already supported by Premier.'}
      />
      <CenterGrid items={cards} testIdPrefix="operations-center" columns={4} />
    </div>
  );
}
