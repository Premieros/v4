import { APP_ROUTES } from '@/core/navigation/routes';
import type {
  OperationalActionKey,
  PrerequisiteStepKey,
  PrerequisiteStep,
  OperationalValidationContext,
  PrerequisiteValidationResult,
} from './types';

export const PREREQUISITE_STEPS: Record<PrerequisiteStepKey, PrerequisiteStep> = {
  create_branch: {
    key: 'create_branch',
    titleAr: 'إنشاء فرع تشغيلي',
    titleEn: 'Create Operational Branch',
    descriptionAr: 'لا يمكن بدء هذه العملية لعدم وجود أي فرع مسجل في النظام. يجب إنشاء فرعك الأول أولاً.',
    descriptionEn: 'Cannot proceed because no operational branch exists. Please create your first branch first.',
    targetRoute: APP_ROUTES.branches,
    actionLabelAr: 'الانتقال إلى الفروع',
    actionLabelEn: 'Go to Branches',
    requiredPermission: 'branches.manage',
    iconName: 'store',
  },
  select_branch: {
    key: 'select_branch',
    titleAr: 'تحديد الفرع الحالي',
    titleEn: 'Select Active Branch',
    descriptionAr: 'هذه العملية تتطلب تحديد الفرع الذي ستتم عليه المعاملة لعزل البيانات والمخزون بدقة.',
    descriptionEn: 'This operation requires selecting an active branch to isolate records and inventory properly.',
    targetRoute: APP_ROUTES.branches,
    actionLabelAr: 'اختيار الفرع',
    actionLabelEn: 'Select Branch',
    iconName: 'store',
  },
  assign_user_branch: {
    key: 'assign_user_branch',
    titleAr: 'ربط حساب المستخدم بفرع',
    titleEn: 'Assign User to Branch',
    descriptionAr: 'حسابك غير مرتبط بفرع تشغيلي محدد. يرجى مراجعة مسؤول النظام لتعيين فرعك أو اختيار الفرع.',
    descriptionEn: 'Your account is not assigned to a branch. Please contact your administrator or select a branch.',
    targetRoute: APP_ROUTES.users,
    actionLabelAr: 'إدارة المستخدمين',
    actionLabelEn: 'Manage Users',
    iconName: 'users',
  },
  create_warehouse: {
    key: 'create_warehouse',
    titleAr: 'إنشاء وتعيين مخزن للفرع',
    titleEn: 'Create Branch Warehouse',
    descriptionAr: 'لا يمكن إتمام هذه العملية لعدم وجود مخزن مفعل في هذا الفرع لحفظ واستلام البضائع والمكونات.',
    descriptionEn: 'Cannot proceed because there is no active warehouse for this branch to store inventory.',
    targetRoute: APP_ROUTES.warehouses,
    actionLabelAr: 'الانتقال إلى المخازن',
    actionLabelEn: 'Go to Warehouses',
    requiredPermission: 'warehouses.manage',
    iconName: 'warehouse',
  },
  create_second_warehouse: {
    key: 'create_second_warehouse',
    titleAr: 'إنشاء مخزن ثانٍ للتحويل',
    titleEn: 'Create Second Warehouse for Transfer',
    descriptionAr: 'عمليات التحويل المخزني تتطلب وجود مخزنين نشطين على الأقل (مخزن المصدر ومخزن الوجهة).',
    descriptionEn: 'Inventory transfer requires at least two active warehouses (source and destination).',
    targetRoute: APP_ROUTES.warehouses,
    actionLabelAr: 'إضافة مخزن جديد',
    actionLabelEn: 'Add New Warehouse',
    requiredPermission: 'warehouses.manage',
    iconName: 'warehouse',
  },
  create_supplier: {
    key: 'create_supplier',
    titleAr: 'إضافة مورد للمشتريات',
    titleEn: 'Add Supplier for Purchases',
    descriptionAr: 'لا يمكن تسجيل فاتورة مشتريات بدون تحديد المورد المعتمد الذي تم الشراء منه.',
    descriptionEn: 'Cannot register a purchase invoice without at least one registered supplier.',
    targetRoute: APP_ROUTES.suppliers,
    actionLabelAr: 'الانتقال إلى الموردين',
    actionLabelEn: 'Go to Suppliers',
    requiredPermission: 'suppliers.manage',
    iconName: 'building',
  },
  create_customer: {
    key: 'create_customer',
    titleAr: 'تسجيل عملاء',
    titleEn: 'Register Customers',
    descriptionAr: 'هذه المعاملة تتطلب اختيار عميل مسجل لإصدار الفاتورة أو متابعة الحساب.',
    descriptionEn: 'This transaction requires a registered customer to issue the invoice or track balances.',
    targetRoute: APP_ROUTES.customers,
    actionLabelAr: 'الانتقال إلى العملاء',
    actionLabelEn: 'Go to Customers',
    requiredPermission: 'customers.manage',
    iconName: 'users',
  },
  create_unit: {
    key: 'create_unit',
    titleAr: 'تعريف وحدات القياس',
    titleEn: 'Define Units of Measure',
    descriptionAr: 'يلزم أولاً تعريف وحدات القياس (كيلو، جرام، لتر، قطعة) قبل ربط الخامات والمنتجات والوصفات.',
    descriptionEn: 'Units of measure (kg, g, l, piece) must be defined before configuring items and recipes.',
    targetRoute: APP_ROUTES.inventoryUnits,
    actionLabelAr: 'الانتقال إلى الوحدات',
    actionLabelEn: 'Go to Units',
    requiredPermission: 'raw_materials.view',
    iconName: 'scale',
  },
  create_category: {
    key: 'create_category',
    titleAr: 'إضافة تصنيف للأصناف',
    titleEn: 'Add Product Category',
    descriptionAr: 'يلزم إنشاء تصنيف واحد على الأقل لتنظيم قائمة المنتجات وتسهيل الوصول إليها في الكاشير.',
    descriptionEn: 'At least one category is needed to organize your product catalog and POS menu.',
    targetRoute: APP_ROUTES.categories,
    actionLabelAr: 'الانتقال إلى التصنيفات',
    actionLabelEn: 'Go to Categories',
    requiredPermission: 'categories.manage',
    iconName: 'tags',
  },
  create_product: {
    key: 'create_product',
    titleAr: 'إضافة منتجات للكتالوج',
    titleEn: 'Add Products to Catalog',
    descriptionAr: 'لا توجد منتجات مسجلة في قائمة الأصناف للبيع أو الشراء. يرجى إضافة المنتجات أولاً.',
    descriptionEn: 'No products are registered in the catalog for sales or purchases. Please add products first.',
    targetRoute: `${APP_ROUTES.products}/setup`,
    actionLabelAr: 'معالج إضافة المنتجات',
    actionLabelEn: 'Product Setup Wizard',
    requiredPermission: 'products.manage',
    iconName: 'package',
  },
  create_raw_material: {
    key: 'create_raw_material',
    titleAr: 'إضافة خامات ومواد أولية',
    titleEn: 'Add Raw Materials',
    descriptionAr: 'يتطلب التصنيع والوصفات تسجيل المواد الأولية والخامات الداخلة في إعداد الأصناف.',
    descriptionEn: 'Manufacturing and recipes require adding raw materials and inventory ingredients first.',
    targetRoute: APP_ROUTES.rawMaterials,
    actionLabelAr: 'الانتقال إلى الخامات',
    actionLabelEn: 'Go to Raw Materials',
    requiredPermission: 'raw_materials.manage',
    iconName: 'flask',
  },
  create_recipe: {
    key: 'create_recipe',
    titleAr: 'بناء وصفة تصنيع (BOM)',
    titleEn: 'Create Manufacturing Recipe',
    descriptionAr: 'المنتج المصنع يتطلب تعريف وصفة مكونات (BOM) تحدد كميات الخامات المستهلكة ونسب الهدر.',
    descriptionEn: 'Manufactured products require defining a recipe (Bill of Materials) for raw material consumption.',
    targetRoute: APP_ROUTES.recipes,
    actionLabelAr: 'الانتقال إلى الوصفات',
    actionLabelEn: 'Go to Recipes',
    requiredPermission: 'recipes.manage',
    iconName: 'chefHat',
  },
  open_shift: {
    key: 'open_shift',
    titleAr: 'فتح وردية كاشير / يومية',
    titleEn: 'Open Cashier Shift',
    descriptionAr: 'لا يمكن إتمام البيع أو تحصيل النقدية بدون وجود وردية مفتوحة للكاشير مع رصيد افتتاحي محدد.',
    descriptionEn: 'Cannot complete sales or accept cash without an active open shift and initial drawer balance.',
    targetRoute: APP_ROUTES.shifts,
    actionLabelAr: 'فتح الوردية الآن',
    actionLabelEn: 'Open Shift Now',
    requiredPermission: 'shifts.manage',
    iconName: 'timer',
  },
  need_permission: {
    key: 'need_permission',
    titleAr: 'صلاحيات غير كافية',
    titleEn: 'Insufficient Permissions',
    descriptionAr: 'دورك الحالي لا يمتلك الصلاحية المطلوبة لتنفيذ هذا الإجراء التشغيلي.',
    descriptionEn: 'Your current role does not have the required permission to perform this operational action.',
    targetRoute: APP_ROUTES.dashboard,
    actionLabelAr: 'العودة للرئيسية',
    actionLabelEn: 'Return to Dashboard',
    iconName: 'shield',
  },
  configure_kitchen_station: {
    key: 'configure_kitchen_station',
    titleAr: 'إعداد محطات المطبخ (KDS)',
    titleEn: 'Configure Kitchen Stations',
    descriptionAr: 'يلزم تعيين محطة مطبخ واحدة على الأقل وتوجيه الأصناف إليها لتفعيل شاشة المطبخ.',
    descriptionEn: 'At least one kitchen station must be configured to enable kitchen display routing.',
    targetRoute: APP_ROUTES.kitchenStations,
    actionLabelAr: 'إعداد محطات المطبخ',
    actionLabelEn: 'Setup Kitchen Stations',
    requiredPermission: 'settings.manage',
    iconName: 'chefHat',
  },
  configure_company_settings: {
    key: 'configure_company_settings',
    titleAr: 'استكمال بيانات المؤسسة والعملة',
    titleEn: 'Configure Organization Settings',
    descriptionAr: 'يلزم ضبط إعدادات المؤسسة والعملة الافتراضية والضريبة قبل بدء الفواتير والحسابات.',
    descriptionEn: 'Please configure organization details, default currency, and tax rates before issuing invoices.',
    targetRoute: APP_ROUTES.settings,
    actionLabelAr: 'الانتقال إلى الإعدادات',
    actionLabelEn: 'Go to Settings',
    requiredPermission: 'settings.manage',
    iconName: 'settings',
  },
};

export function validateActionPrerequisites(
  action: OperationalActionKey,
  ctx: OperationalValidationContext
): PrerequisiteValidationResult {
  const isSuper = ctx.userRole === 'super_admin' || ctx.userRole === 'owner';

  // 1. Permission check
  if (ctx.hasPermission === false && !isSuper) {
    return {
      allowed: false,
      missingStep: PREREQUISITE_STEPS.need_permission,
      reasonAr: 'لا تملك الصلاحية المطلوبة لتنفيذ هذه العملية.',
      reasonEn: 'You do not have permission to execute this operation.',
    };
  }

  // 2. Action specific validations
  switch (action) {
    case 'purchase_create': {
      if (!ctx.branchId && !isSuper) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.select_branch,
          reasonAr: 'لا يمكن إتمام عملية الشراء لعدم تحديد الفرع الذي ستتم عليه المعاملة.',
          reasonEn: 'Cannot complete purchase: please select an active branch.',
        };
      }
      if (typeof ctx.warehousesCount === 'number' && ctx.warehousesCount === 0) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.create_warehouse,
          reasonAr: 'لا يمكن إتمام عملية الشراء: يلزم أولاً إنشاء وتحديد المخزن الذي سيتم استلام المشتريات إليه.',
          reasonEn: 'Cannot complete purchase: please create a warehouse to receive inventory items.',
        };
      }
      if (typeof ctx.suppliersCount === 'number' && ctx.suppliersCount === 0) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.create_supplier,
          reasonAr: 'لا يمكن إتمام عملية الشراء: لا يوجد موردين مسجلين بالنظام لاختيار المورد.',
          reasonEn: 'Cannot complete purchase: no suppliers registered. Please add a supplier first.',
        };
      }
      if (
        typeof ctx.productsCount === 'number' &&
        typeof ctx.rawMaterialsCount === 'number' &&
        ctx.productsCount === 0 &&
        ctx.rawMaterialsCount === 0
      ) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.create_product,
          reasonAr: 'لا يمكن تسجيل الشراء لعدم وجود أي أصناف أو خامات مسجلة للشراء.',
          reasonEn: 'Cannot record purchase: no products or raw materials available to purchase.',
        };
      }
      break;
    }

    case 'pos_checkout': {
      if (!ctx.branchId && !isSuper) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.select_branch,
          reasonAr: 'لا يمكن البيع بدون تحديد فرع العمل ونقطة البيع.',
          reasonEn: 'Cannot checkout without an active branch selection.',
        };
      }
      if (typeof ctx.warehousesCount === 'number' && ctx.warehousesCount === 0) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.create_warehouse,
          reasonAr: 'لا يمكن إتمام البيع: لا يوجد مخزن مسجل لخصم المبيعات والمكونات منه.',
          reasonEn: 'Cannot complete sale: no warehouse found to deduct inventory from.',
        };
      }
      if (typeof ctx.productsCount === 'number' && ctx.productsCount === 0) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.create_product,
          reasonAr: 'لا توجد منتجات مسجلة في قائمة نقطة البيع (POS).',
          reasonEn: 'No products registered in the POS catalog.',
        };
      }
      if (ctx.activeShiftId === null && ctx.userRole === 'cashier') {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.open_shift,
          reasonAr: 'يجب فتح وردية كاشير وإدخال رصيد الافتتاح قبل إتمام أي عملية بيع.',
          reasonEn: 'A cashier shift must be opened before processing sales.',
        };
      }
      break;
    }

    case 'production_create': {
      if (!ctx.branchId && !isSuper) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.select_branch,
          reasonAr: 'يلزم تحديد الفرع لتنفيذ أوامر الإنتاج والتصنيع.',
          reasonEn: 'Select branch to execute manufacturing orders.',
        };
      }
      if (typeof ctx.warehousesCount === 'number' && ctx.warehousesCount === 0) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.create_warehouse,
          reasonAr: 'يلزم وجود مخزن معتمد لصرف الخامات واستلام المنتجات المصنعة.',
          reasonEn: 'A warehouse is required to issue raw materials and receive manufactured goods.',
        };
      }
      if (typeof ctx.recipesCount === 'number' && ctx.recipesCount === 0) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.create_recipe,
          reasonAr: 'لا توجد وصفات تصنيع (BOM) مسجلة لتنفيذ عملية الإنتاج.',
          reasonEn: 'No manufacturing recipes found. Please create a recipe first.',
        };
      }
      break;
    }

    case 'transfer_create': {
      if (typeof ctx.warehousesCount === 'number' && ctx.warehousesCount < 2) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.create_second_warehouse,
          reasonAr: 'لا يمكن التحويل المخزني لوجود أقل من مخزنين. يلزم وجود مخزن مصدر ومخزن وجهة.',
          reasonEn: 'Inventory transfer requires at least two active warehouses.',
        };
      }
      break;
    }

    case 'recipe_create': {
      if (typeof ctx.rawMaterialsCount === 'number' && ctx.rawMaterialsCount === 0) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.create_raw_material,
          reasonAr: 'يلزم أولاً تسجيل الخامات والمكونات الأولية لإضافتها في الوصفة.',
          reasonEn: 'Please create raw materials and ingredients before assembling recipes.',
        };
      }
      break;
    }

    case 'kds_view': {
      if (typeof ctx.kitchenStationsCount === 'number' && ctx.kitchenStationsCount === 0) {
        return {
          allowed: false,
          missingStep: PREREQUISITE_STEPS.configure_kitchen_station,
          reasonAr: 'لا توجد محطات مطبخ معرّفة بعد لتوجيه الطلبات إليها.',
          reasonEn: 'No kitchen stations configured yet.',
        };
      }
      break;
    }

    default:
      break;
  }

  return { allowed: true };
}

/**
 * Parses raw Postgres / Supabase errors and returns the most suitable operational prerequisite guidance
 */
export function interpretDbError(
  err: unknown,
  ctx?: OperationalValidationContext
): { step: PrerequisiteStep; friendlyMessageAr: string; friendlyMessageEn: string } | null {
  if (!err) return null;
  const msg = typeof err === 'string' ? err : (err as { message?: string; detail?: string })?.message || (err as { detail?: string })?.detail || '';
  const lower = msg.toLowerCase();

  // 1. RLS Violation
  if (lower.includes('violates row-level security policy') || lower.includes('rls')) {
    if (!ctx?.branchId && ctx?.userRole !== 'super_admin') {
      return {
        step: PREREQUISITE_STEPS.select_branch,
        friendlyMessageAr: 'تم منع العملية لأن حسابك يحتاج إلى تحديد الفرع التشغيلي المعين لك.',
        friendlyMessageEn: 'Operation prevented by security policy: active branch selection is required.',
      };
    }
    return {
      step: PREREQUISITE_STEPS.need_permission,
      friendlyMessageAr: 'تم منع العملية من نظام الصلاحيات: ليس لديك صلاحية كافية لتنفيذ هذا الإجراء على هذا الفرع.',
      friendlyMessageEn: 'Operation prevented: insufficient permissions for this branch.',
    };
  }

  // 2. Foreign Key: warehouse_id
  if (lower.includes('warehouse_id') || lower.includes('warehouses_fkey') || lower.includes('null value in column "warehouse_id"')) {
    return {
      step: PREREQUISITE_STEPS.create_warehouse,
      friendlyMessageAr: 'لا يمكن إتمام العملية لعدم وجود مخزن صالح مرتبط بالعملية.',
      friendlyMessageEn: 'Cannot complete operation: missing or invalid warehouse reference.',
    };
  }

  // 3. Foreign Key: supplier_id
  if (lower.includes('supplier_id') || lower.includes('suppliers_fkey')) {
    return {
      step: PREREQUISITE_STEPS.create_supplier,
      friendlyMessageAr: 'لا يمكن إتمام المعاملة بدون اختيار مورد مسجل وصالح.',
      friendlyMessageEn: 'Cannot complete transaction without a valid registered supplier.',
    };
  }

  // 4. Foreign Key: branch_id
  if (lower.includes('branch_id') || lower.includes('branches_fkey') || lower.includes('null value in column "branch_id"')) {
    return {
      step: PREREQUISITE_STEPS.create_branch,
      friendlyMessageAr: 'لا يمكن حفظ البيانات لعدم تحديد الفرع التابع له السجل.',
      friendlyMessageEn: 'Cannot save data: missing branch reference.',
    };
  }

  // 5. Shift required error
  if (lower.includes('shift') || lower.includes('وردية') || lower.includes('closed shift')) {
    return {
      step: PREREQUISITE_STEPS.open_shift,
      friendlyMessageAr: 'يجب فتح وردية كاشير نشطة قبل إتمام أي معاملات مالية.',
      friendlyMessageEn: 'An active cashier shift is required before processing transactions.',
    };
  }

  return null;
}
