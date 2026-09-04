import { Boxes, ClipboardList, Factory, FlaskConical, Gauge, Layers3, Trash2, ChefHat } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { CenterGrid, type CenterTileItem } from '@/components/design/CenterTile';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';

export function ManufacturingCenterPage() {
  const { lang } = useLanguage();
  const can = useCan();
  const ar = lang === 'ar';

  const actions: CenterTileItem[] = [
    { id: 'materials', ar: 'المواد الخام', en: 'Raw Materials', descriptionAr: 'تعريف المواد الخام ومتابعة الأرصدة والدفعات.', descriptionEn: 'Manage raw materials, stock and batches.', route: APP_ROUTES.rawMaterials, permission: can('raw_materials.view'), icon: Boxes },
    { id: 'recipes', ar: 'الوصفات والمكونات', en: 'Recipes & Components', descriptionAr: 'إدارة الوصفات ومكونات المنتجات وتكلفتها.', descriptionEn: 'Manage recipes, components and recipe costs.', route: APP_ROUTES.recipes, permission: can('recipes.view'), icon: FlaskConical },
    { id: 'production', ar: 'أوامر الإنتاج', en: 'Production Orders', descriptionAr: 'إنشاء ومتابعة أوامر الإنتاج واستهلاك المواد.', descriptionEn: 'Create and monitor production orders and consumption.', route: APP_ROUTES.production, permission: can('production.view'), icon: Factory },
    { id: 'costing', ar: 'مركز التكلفة', en: 'Costing Center', descriptionAr: 'تحليل تكلفة المنتج والوصفة ومقارنتها بسعر البيع.', descriptionEn: 'Analyze product and recipe costs against selling price.', route: APP_ROUTES.costingCenter, permission: can('reports.costing'), icon: Gauge },
    { id: 'components', ar: 'مكونات المنتجات', en: 'Product Components', descriptionAr: 'مراجعة المكونات المرتبطة بالمنتجات.', descriptionEn: 'Review components linked to products.', route: APP_ROUTES.components, permission: can('components.view'), icon: Layers3 },
    { id: 'inventory', ar: 'مخزون المواد', en: 'Material Stock', descriptionAr: 'الانتقال مباشرة إلى المخزون لمتابعة تأثير التصنيع.', descriptionEn: 'Open inventory to monitor manufacturing impact.', route: APP_ROUTES.inventoryCenter, permission: can('inventory.view'), icon: ClipboardList },
    { id: 'waste', ar: 'مركز الهالك', en: 'Waste Center', descriptionAr: 'تسجيل ومراجعة هالك المواد والمنتجات.', descriptionEn: 'Record and review material and product waste.', route: APP_ROUTES.wasteCenter, permission: can('production.waste'), icon: Trash2 },
    { id: 'kitchen', ar: 'شاشة المطبخ', en: 'Kitchen Display', descriptionAr: 'متابعة الطلبات حسب محطة المطبخ.', descriptionEn: 'Track orders by kitchen station.', route: APP_ROUTES.kitchenDisplay, permission: can('pos.sell'), icon: ChefHat },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={ar ? 'مركز التصنيع والتكلفة' : 'Manufacturing & Costing Center'}
        subtitle={ar ? 'دورة التصنيع من المادة الخام والوصفة حتى الإنتاج والتكلفة' : 'Manufacturing flow from raw materials and recipes through production and costing.'}
      />
      <CenterGrid
        items={actions.filter((a) => a.permission)}
        testIdPrefix="manufacturing-center"
        columns={3}
      />
    </div>
  );
}
