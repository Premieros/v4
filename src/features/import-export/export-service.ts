import { supabase } from '@/api';
import { ImportExportEntity, ExportFilters, ExportFormat } from './types';
import { ExcelService } from './excel-service';
import { ENTITY_CONFIGS } from './entity-configs';

interface ProductExportRow {
  sku?: string;
  barcode?: string;
  name?: string;
  name_en?: string;
  cost_price?: number;
  sale_price?: number;
  tax_rate?: number;
  is_active?: boolean;
  category?: { name?: string; name_en?: string } | null;
  product_units?: Array<{ unit_name?: string }>;
}

interface CategoryExportRow {
  code?: string;
  name?: string;
  name_en?: string;
  is_active?: boolean;
}

interface RawMaterialExportRow {
  sku?: string;
  name?: string;
  unit?: string;
  cost_price?: number;
  min_stock?: number;
  is_active?: boolean;
}

interface RecipeItemExportRow {
  quantity?: number;
  recipe?: { product?: { sku?: string; name?: string }; name?: string };
  raw_material?: { sku?: string; name?: string; unit?: string };
}

interface SupplierExportRow {
  code?: string;
  name?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  address?: string;
  is_active?: boolean;
}

interface CustomerExportRow {
  code?: string;
  name?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  credit_limit?: number;
  is_active?: boolean;
}

interface PurchaseItemExportRow {
  quantity?: number;
  unit_cost?: number;
  total_cost?: number;
  purchase?: { purchase_number?: string; invoice_date?: string; supplier?: { name?: string }; warehouse?: { name?: string } };
  product?: { sku?: string; name?: string };
  raw_material?: { sku?: string; name?: string };
}

export class ExportService {
  public static async exportEntity(
    entity: ImportExportEntity,
    filters: ExportFilters,
    format: ExportFormat,
    lang: 'ar' | 'en' = 'ar'
  ): Promise<{ recordCount: number; fileName: string }> {
    let rows: Record<string, unknown>[] = [];
    const isAr = lang === 'ar';

    switch (entity) {
      case 'products': {
        let query = supabase
          .from('products')
          .select('*, category:categories(name, name_en), product_units(*)');

        if (filters.branchId) query = query.eq('branch_id', filters.branchId);
        if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
        if (filters.status === 'active') query = query.eq('is_active', true);
        if (filters.status === 'inactive') query = query.eq('is_active', false);

        const { data, error } = await query;
        if (error) throw error;

        rows = ((data as unknown as ProductExportRow[]) || []).map((p) => ({
          [isAr ? 'رمز المنتج (SKU)' : 'SKU']: p.sku || '',
          [isAr ? 'الباركود' : 'Barcode']: p.barcode || '',
          [isAr ? 'اسم المنتج' : 'Product Name']: p.name || '',
          [isAr ? 'الاسم الإنجليزي' : 'English Name']: p.name_en || '',
          [isAr ? 'الفئة' : 'Category']: p.category?.name || '',
          [isAr ? 'وحدة القياس' : 'Unit']: p.product_units?.[0]?.unit_name || 'قطعة',
          [isAr ? 'التكلفة' : 'Cost']: Number(p.cost_price || 0),
          [isAr ? 'سعر البيع' : 'Sale Price']: Number(p.sale_price || 0),
          [isAr ? 'نسبة الضريبة %' : 'Tax Rate %']: Number(p.tax_rate || 15),
          [isAr ? 'نشط' : 'Active']: p.is_active ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No'),
        }));
        break;
      }

      case 'categories': {
        const { data, error } = await supabase.from('categories').select('*').order('name');
        if (error) throw error;
        rows = ((data as unknown as CategoryExportRow[]) || []).map((c) => ({
          [isAr ? 'كود الفئة' : 'Category Code']: c.code || '',
          [isAr ? 'اسم الفئة' : 'Category Name']: c.name || '',
          [isAr ? 'الاسم الإنجليزي' : 'English Name']: c.name_en || '',
          [isAr ? 'نشط' : 'Active']: c.is_active ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No'),
        }));
        break;
      }

      case 'components': {
        let query = supabase.from('raw_materials').select('*');
        if (filters.branchId) query = query.eq('branch_id', filters.branchId);
        if (filters.status === 'active') query = query.eq('is_active', true);
        if (filters.status === 'inactive') query = query.eq('is_active', false);

        const { data, error } = await query;
        if (error) throw error;

        rows = ((data as unknown as RawMaterialExportRow[]) || []).map((m) => ({
          [isAr ? 'كود المكون (SKU)' : 'Component SKU']: m.sku || '',
          [isAr ? 'اسم المكون' : 'Component Name']: m.name || '',
          [isAr ? 'وحدة القياس' : 'Unit']: m.unit || '',
          [isAr ? 'سعر التكلفة' : 'Cost']: Number(m.cost_price || 0),
          [isAr ? 'حد الطلب الأدنى' : 'Min Stock']: Number(m.min_stock || 0),
          [isAr ? 'نشط' : 'Active']: m.is_active ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No'),
        }));
        break;
      }

      case 'recipes': {
        const { data, error } = await supabase
          .from('recipe_items')
          .select('*, recipe:recipes(*, product:products(*)), raw_material:raw_materials(*)');
        if (error) throw error;

        rows = ((data as unknown as RecipeItemExportRow[]) || []).map((it) => ({
          [isAr ? 'كود المنتج التام (Product SKU)' : 'Product SKU']: it.recipe?.product?.sku || '',
          [isAr ? 'اسم المنتج' : 'Product Name']: it.recipe?.product?.name || it.recipe?.name || '',
          [isAr ? 'كود المكون' : 'Component SKU']: it.raw_material?.sku || '',
          [isAr ? 'اسم المكون' : 'Component Name']: it.raw_material?.name || '',
          [isAr ? 'الكمية المطلوبة' : 'Quantity']: Number(it.quantity || 0),
          [isAr ? 'وحدة الاستهلاك' : 'Unit']: it.raw_material?.unit || '',
        }));
        break;
      }

      case 'suppliers': {
        const { data, error } = await supabase.from('suppliers').select('*').order('name');
        if (error) throw error;
        rows = ((data as unknown as SupplierExportRow[]) || []).map((s) => ({
          [isAr ? 'كود المورد' : 'Supplier Code']: s.code || '',
          [isAr ? 'اسم المورد' : 'Supplier Name']: s.name || '',
          [isAr ? 'المسؤول' : 'Contact Person']: s.contact_person || '',
          [isAr ? 'رقم الهاتف' : 'Phone']: s.phone || '',
          [isAr ? 'البريد الإلكتروني' : 'Email']: s.email || '',
          [isAr ? 'الرقم الضريبي' : 'Tax Number']: s.tax_number || '',
          [isAr ? 'العنوان' : 'Address']: s.address || '',
          [isAr ? 'نشط' : 'Active']: s.is_active ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No'),
        }));
        break;
      }

      case 'customers': {
        const { data, error } = await supabase.from('customers').select('*').order('name');
        if (error) throw error;
        rows = ((data as unknown as CustomerExportRow[]) || []).map((c) => ({
          [isAr ? 'كود العميل' : 'Customer Code']: c.code || '',
          [isAr ? 'اسم العميل' : 'Customer Name']: c.name || '',
          [isAr ? 'رقم الجوال' : 'Phone']: c.phone || '',
          [isAr ? 'البريد الإلكتروني' : 'Email']: c.email || '',
          [isAr ? 'الرقم الضريبي' : 'Tax Number']: c.tax_number || '',
          [isAr ? 'الحد الائتماني' : 'Credit Limit']: Number(c.credit_limit || 0),
          [isAr ? 'نشط' : 'Active']: c.is_active ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No'),
        }));
        break;
      }

      case 'purchases': {
        let query = supabase
          .from('purchase_items')
          .select('*, purchase:purchases(*, supplier:suppliers(name), warehouse:warehouses(name)), product:products(sku, name), raw_material:raw_materials(sku, name)');

        if (filters.startDate) query = query.gte('purchase.invoice_date', filters.startDate);
        if (filters.endDate) query = query.lte('purchase.invoice_date', filters.endDate);

        const { data, error } = await query;
        if (error) throw error;

        rows = ((data as unknown as PurchaseItemExportRow[]) || []).map((pi) => ({
          [isAr ? 'رقم الفاتورة' : 'Purchase No']: pi.purchase?.purchase_number || '',
          [isAr ? 'التاريخ' : 'Date']: pi.purchase?.invoice_date || '',
          [isAr ? 'المورد' : 'Supplier']: pi.purchase?.supplier?.name || '',
          [isAr ? 'المستودع' : 'Warehouse']: pi.purchase?.warehouse?.name || '',
          [isAr ? 'كود الصنف' : 'Item SKU']: pi.product?.sku || pi.raw_material?.sku || '',
          [isAr ? 'اسم الصنف' : 'Item Name']: pi.product?.name || pi.raw_material?.name || '',
          [isAr ? 'الكمية' : 'Quantity']: Number(pi.quantity || 0),
          [isAr ? 'سعر الوحدة' : 'Unit Cost']: Number(pi.unit_cost || 0),
          [isAr ? 'إجمالي السطر' : 'Line Total']: Number(pi.total_cost || 0),
        }));
        break;
      }

      case 'opening_inventory':
      case 'production':
      case 'transfers':
      case 'expenses':
      case 'users':
      case 'prices': {
        const config = ENTITY_CONFIGS[entity];
        const tableName = entity === 'prices' ? 'branch_prices' : entity === 'opening_inventory' ? 'inventory_movements' : entity;
        const { data } = await supabase.from(tableName).select('*').limit(500);
        rows = ((data as unknown as Record<string, unknown>[]) || []).map((r) => {
          const formatted: Record<string, unknown> = {};
          config.columns.forEach((col) => {
            const header = isAr ? col.labelAr : col.labelEn;
            formatted[header] = r[col.key] ?? '';
          });
          return formatted;
        });
        break;
      }
    }

    const config = ENTITY_CONFIGS[entity];
    const fileName = `${config?.id || entity}_export_${new Date().toISOString().slice(0, 10)}`;
    await ExcelService.exportData(rows, fileName, format, config?.titleAr || 'Export');

    return {
      recordCount: rows.length,
      fileName: `${fileName}.${format}`,
    };
  }
}
