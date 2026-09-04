export type ImportExportEntity =
  | 'products'
  | 'categories'
  | 'components'
  | 'prices'
  | 'suppliers'
  | 'customers'
  | 'purchases'
  | 'opening_inventory'
  | 'recipes'
  | 'production'
  | 'transfers'
  | 'expenses'
  | 'users';

export type CollisionPolicy = 'add_only' | 'update_existing' | 'skip_existing' | 'stop_on_error';

export type ExportFormat = 'xlsx' | 'csv';

export interface ColumnDefinition {
  key: string;
  labelAr: string;
  labelEn: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'select';
  required: boolean;
  example: string | number | boolean;
  descriptionAr: string;
  descriptionEn: string;
  options?: string[];
  aliases: string[];
}

export interface EntityConfig {
  id: ImportExportEntity;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: string;
  requiredPermission: string;
  primaryKeyColumn: string;
  columns: ColumnDefinition[];
  sampleRows: Record<string, unknown>[];
  instructionsAr: string[];
  instructionsEn: string[];
}

export interface ValidationError {
  rowNumber: number;
  column: string;
  value: unknown;
  message: string;
  messageEn: string;
  remedy: string;
  remedyEn: string;
  severity: 'error' | 'warning';
}

export interface ValidationSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  errors: ValidationError[];
  warnings: ValidationError[];
  canProceed: boolean;
  validRowIndices?: number[];
  invalidRowIndices?: number[];
  groupedEntitiesCount?: number;
  groupedSummary?: { id: string; name: string; count: number; valid: boolean }[];
}

export interface ImportProgress {
  current: number;
  total: number;
  percentage: number;
  currentStep: string;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
}

export interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  warningCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: ValidationError[];
  timeTakenMs: number;
  entity: ImportExportEntity;
  fileName: string;
}

export interface ImportExportOperationLog {
  id: string;
  timestamp: string;
  operation: 'import' | 'export';
  entity: ImportExportEntity;
  fileName: string;
  totalRecords: number;
  successCount: number;
  errorCount: number;
  status: 'completed' | 'failed' | 'partial';
  performedBy: string;
  performedByName?: string;
  branchName?: string;
  errors?: ValidationError[];
}

export interface ExportFilters {
  branchId?: string;
  warehouseId?: string;
  categoryId?: string;
  supplierId?: string;
  startDate?: string;
  endDate?: string;
  status?: 'all' | 'active' | 'inactive';
}
