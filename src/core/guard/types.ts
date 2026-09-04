export type OperationalActionKey =
  | 'purchase_create'
  | 'pos_checkout'
  | 'production_create'
  | 'transfer_create'
  | 'stock_count_create'
  | 'product_create'
  | 'recipe_create'
  | 'raw_material_create'
  | 'category_create'
  | 'unit_create'
  | 'warehouse_create'
  | 'supplier_create'
  | 'customer_create'
  | 'shift_open'
  | 'kds_view'
  | 'reports_view';

export type PrerequisiteStepKey =
  | 'create_branch'
  | 'select_branch'
  | 'assign_user_branch'
  | 'create_warehouse'
  | 'create_second_warehouse'
  | 'create_supplier'
  | 'create_customer'
  | 'create_unit'
  | 'create_category'
  | 'create_product'
  | 'create_raw_material'
  | 'create_recipe'
  | 'open_shift'
  | 'need_permission'
  | 'configure_kitchen_station'
  | 'configure_company_settings';

export interface PrerequisiteStep {
  key: PrerequisiteStepKey;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  targetRoute: string;
  actionLabelAr: string;
  actionLabelEn: string;
  requiredPermission?: string;
  iconName?: string;
}

export interface GuidedContextState {
  sourceRoute: string;
  sourceAction: OperationalActionKey;
  sourceLabelAr: string;
  sourceLabelEn: string;
  missingStep: PrerequisiteStep;
  draftData?: Record<string, unknown>;
  timestamp: number;
}

export interface OperationalValidationContext {
  branchId?: string | null;
  userRole?: string;
  hasPermission?: boolean;
  warehousesCount?: number;
  suppliersCount?: number;
  customersCount?: number;
  productsCount?: number;
  rawMaterialsCount?: number;
  recipesCount?: number;
  unitsCount?: number;
  categoriesCount?: number;
  activeShiftId?: string | null;
  kitchenStationsCount?: number;
  customCheck?: () => boolean | Promise<boolean>;
  formData?: Record<string, unknown>;
}

export interface PrerequisiteValidationResult {
  allowed: boolean;
  missingStep?: PrerequisiteStep;
  reasonAr?: string;
  reasonEn?: string;
}
