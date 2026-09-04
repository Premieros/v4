import { ImportExportEntity, ValidationError, ValidationSummary } from './types';
import { ENTITY_CONFIGS } from './entity-configs';

export interface ValidationContext {
  existingProducts: Array<{ id: string; sku: string; name: string; barcode?: string | null; category_id?: string | null; unit?: string | null; cost_price?: number; sale_price?: number }>;
  existingCategories: Array<{ id: string; code?: string; name: string; name_ar?: string }>;
  existingComponents: Array<{ id: string; sku: string; name: string; unit: string; cost?: number }>;
  existingSuppliers: Array<{ id: string; code?: string; name: string; phone?: string }>;
  existingCustomers: Array<{ id: string; code?: string; name: string; phone?: string }>;
  existingWarehouses: Array<{ id: string; code?: string; name: string; branch_id?: string }>;
  existingBranches: Array<{ id: string; code?: string; name: string }>;
  existingUsers: Array<{ id: string; username: string; email?: string }>;
  userBranchId?: string | null;
  isSuperAdmin: boolean;
  allowedBranchIds: string[];
  allowedWarehouseIds: string[];
}

export class ValidationEngine {
  public static validate(
    entity: ImportExportEntity,
    rawRows: Record<string, unknown>[],
    context: ValidationContext
  ): ValidationSummary {
    const config = ENTITY_CONFIGS[entity];
    if (!config) {
      return {
        totalRows: rawRows.length,
        validRows: 0,
        errorRows: rawRows.length,
        warningRows: 0,
        errors: [
          {
            rowNumber: 0,
            column: 'general',
            value: entity,
            message: `نوع البيانات ${entity} غير مدعوم`,
            messageEn: `Unsupported entity type ${entity}`,
            remedy: 'اختر نوع بيانات صحيح من القائمة',
            remedyEn: 'Select a valid data type from the list',
            severity: 'error',
          },
        ],
        warnings: [],
        canProceed: false,
      };
    }

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const seenPrimaryKeys = new Set<string>();
    const seenBarcodes = new Map<string, number>();

    // Entity-specific duplicate trackers
    const recipeProductComponents = new Map<string, Set<string>>(); // product_sku -> Set of component_sku
    const groupedSummaryMap = new Map<string, { id: string; name: string; count: number; valid: boolean }>();

    rawRows.forEach((row, index) => {
      const rowNumber = index + 2; // Excel row 2 is first data row after header

      // 1. Validate required columns & data types according to ColumnDefinition
      config.columns.forEach((col) => {
        const val = row[col.key];
        const isEmpty = val === undefined || val === null || String(val).trim() === '';

        if (col.required && isEmpty) {
          errors.push({
            rowNumber,
            column: col.labelAr,
            value: String(val ?? ''),
            message: `الحقل المطلوب "${col.labelAr}" فارغ.`,
            messageEn: `Required field "${col.labelEn}" is empty.`,
            remedy: `أدخل قيمة صحيحة في عمود "${col.labelAr}" في الصف رقم ${rowNumber}.`,
            remedyEn: `Provide a valid value for column "${col.labelEn}" at row ${rowNumber}.`,
            severity: 'error',
          });
          return;
        }

        if (!isEmpty) {
          if (col.type === 'number') {
            const num = Number(val);
            if (isNaN(num)) {
              errors.push({
                rowNumber,
                column: col.labelAr,
                value: val,
                message: `القيمة "${val}" ليست رقماً صحيحاً في عمود "${col.labelAr}".`,
                messageEn: `Value "${val}" is not a valid number in "${col.labelEn}".`,
                remedy: `قم بتعديل القيمة إلى رقم عشري أو صحيح في الصف ${rowNumber}.`,
                remedyEn: `Change the value to a number at row ${rowNumber}.`,
                severity: 'error',
              });
            } else if ((col.key === 'quantity' || col.key === 'price' || col.key === 'cost' || col.key === 'unit_cost' || col.key === 'amount') && num < 0) {
              errors.push({
                rowNumber,
                column: col.labelAr,
                value: num,
                message: `لا يمكن أن تكون قيمة "${col.labelAr}" أقل من الصفر (${num}).`,
                messageEn: `"${col.labelEn}" cannot be negative (${num}).`,
                remedy: `أدخل رقماً موجباً أكبر من أو يساوي الصفر.`,
                remedyEn: `Enter a positive number.`,
                severity: 'error',
              });
            }
          }

          if (col.type === 'date') {
            const dateStr = String(val).trim();
            const isValidDate = !isNaN(Date.parse(dateStr)) || /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
            if (!isValidDate) {
              warnings.push({
                rowNumber,
                column: col.labelAr,
                value: val,
                message: `صيغة التاريخ "${val}" قد تحتاج لتعديل (الصيغة المفضلة YYYY-MM-DD).`,
                messageEn: `Date format "${val}" should preferably be YYYY-MM-DD.`,
                remedy: `تأكد من كتابة التاريخ بصيغة السنة-الشهر-اليوم مثل: 2026-08-29.`,
                remedyEn: `Format date as YYYY-MM-DD.`,
                severity: 'warning',
              });
            }
          }
        }
      });

      // 2. Specific Entity Validations
      switch (entity) {
        case 'products': {
          const sku = String(row.sku || '').trim();
          const barcode = row.barcode ? String(row.barcode).trim() : '';
          const name = String(row.name || '').trim();
          const price = Number(row.price || 0);

          if (sku) {
            if (seenPrimaryKeys.has(sku.toLowerCase())) {
              errors.push({
                rowNumber,
                column: 'رمز المنتج (SKU)',
                value: sku,
                message: `رمز المنتج (SKU) "${sku}" مكرر أكثر من مرة داخل نفس الملف.`,
                messageEn: `Product SKU "${sku}" is duplicated inside the file.`,
                remedy: `لكل منتج يجب أن يكون SKU فريد تماماً. غير الرمز في الصف ${rowNumber}.`,
                remedyEn: `Ensure every product has a unique SKU.`,
                severity: 'error',
              });
            } else {
              seenPrimaryKeys.add(sku.toLowerCase());
            }
          }

          if (barcode) {
            if (seenBarcodes.has(barcode)) {
              const prevRow = seenBarcodes.get(barcode);
              errors.push({
                rowNumber,
                column: 'الباركود',
                value: barcode,
                message: `الباركود "${barcode}" مكرر في الصف ${rowNumber} و الصف ${prevRow}.`,
                messageEn: `Barcode "${barcode}" is repeated at row ${rowNumber} and row ${prevRow}.`,
                remedy: `قم بتعيين باركود مختلف أو اترك الخانة فارغة لتوليده تلقائياً.`,
                remedyEn: `Assign a unique barcode or leave blank for auto-generation.`,
                severity: 'error',
              });
            } else {
              seenBarcodes.set(barcode, rowNumber);
            }
          }

          if (price <= 0) {
            warnings.push({
              rowNumber,
              column: 'سعر البيع',
              value: price,
              message: `سعر البيع للمنتج "${name}" يساوي صفر أو غير محدد.`,
              messageEn: `Sale price for product "${name}" is zero.`,
              remedy: `إذا كان الصنف مجانياً أو مخصصاً للإنتاج فقط يمكنك المتابعة.`,
              remedyEn: `Acceptable if item is promotional or raw material only.`,
              severity: 'warning',
            });
          }
          break;
        }

        case 'categories': {
          const code = String(row.code || '').trim();
          if (code) {
            if (seenPrimaryKeys.has(code.toLowerCase())) {
              errors.push({
                rowNumber,
                column: 'كود الفئة',
                value: code,
                message: `كود الفئة "${code}" مكرر داخل الملف.`,
                messageEn: `Category code "${code}" is duplicated.`,
                remedy: `عين كوداً فريداً لكل فئة.`,
                remedyEn: `Set a unique code for each category.`,
                severity: 'error',
              });
            } else {
              seenPrimaryKeys.add(code.toLowerCase());
            }
          }
          break;
        }

        case 'components': {
          const sku = String(row.sku || '').trim();
          const unit = String(row.unit || '').trim();

          if (sku) {
            if (seenPrimaryKeys.has(sku.toLowerCase())) {
              errors.push({
                rowNumber,
                column: 'كود المكون (SKU)',
                value: sku,
                message: `كود المادة الخام "${sku}" مكرر في الملف.`,
                messageEn: `Material SKU "${sku}" is duplicated.`,
                remedy: `عين كوداً مستقلاً لكل مادة خام.`,
                remedyEn: `Assign a unique SKU for each raw material.`,
                severity: 'error',
              });
            } else {
              seenPrimaryKeys.add(sku.toLowerCase());
            }
          }

          if (!unit) {
            errors.push({
              rowNumber,
              column: 'وحدة القياس',
              value: '',
              message: `يجب تحديد وحدة قياس المادة الخام (كجم، جم، لتر، مل، قطعة).`,
              messageEn: `Measurement unit is required for raw materials.`,
              remedy: `حدد وحدة القياس في الصف ${rowNumber}.`,
              remedyEn: `Enter measurement unit at row ${rowNumber}.`,
              severity: 'error',
            });
          }
          break;
        }

        case 'recipes': {
          // One Row Per Component Validation Rules:
          // 1. Repeating Product SKU is ALLOWED and EXPECTED.
          // 2. Product SKU must exist in products catalog (or be provided).
          // 3. Component SKU must exist in components / raw materials.
          // 4. Quantity must be > 0.
          // 5. Same component cannot be added twice to the SAME product in the sheet.
          const prodSku = String(row.product_sku || '').trim();
          const prodName = String(row.product_name || prodSku).trim();
          const compSku = String(row.component_sku || '').trim();
          const compName = String(row.component_name || compSku).trim();
          const qty = Number(row.quantity || 0);

          if (!prodSku) {
            errors.push({
              rowNumber,
              column: 'كود المنتج التام',
              value: '',
              message: `كود المنتج التام (Product SKU) فارغ.`,
              messageEn: `Product SKU is missing.`,
              remedy: `أدخل رمز المنتج المراد ربط الوصفة به في الصف ${rowNumber}.`,
              remedyEn: `Enter Product SKU at row ${rowNumber}.`,
              severity: 'error',
            });
          } else {
            // Check if product exists in system
            const productExists = context.existingProducts.some(
              (p) => p.sku?.toLowerCase() === prodSku.toLowerCase() || p.id === prodSku
            );
            if (!productExists) {
              warnings.push({
                rowNumber,
                column: 'كود المنتج التام',
                value: prodSku,
                message: `المنتج التام "${prodSku}" غير مسجل مسبقاً، سيتم إنشاؤه تلقائياً كمنتج تصنيعي.`,
                messageEn: `Finished Product "${prodSku}" not found. Will be auto-created as a manufactured item.`,
                remedy: `لا يتطلب إجراء، سيقوم النظام بتسجيله أثناء الاستيراد.`,
                remedyEn: `No action required, auto-registration will proceed.`,
                severity: 'warning',
              });
            }
          }

          if (!compSku) {
            errors.push({
              rowNumber,
              column: 'كود المكون',
              value: '',
              message: `كود المكون / المادة الخام (Component SKU) فارغ.`,
              messageEn: `Component SKU is missing.`,
              remedy: `حدد كود المادة الخام المستخدمة في هذا السطر.`,
              remedyEn: `Specify raw material SKU.`,
              severity: 'error',
            });
          } else {
            // Check if component exists in system
            const compExists = context.existingComponents.some(
              (c) => c.sku?.toLowerCase() === compSku.toLowerCase() || c.id === compSku
            ) || context.existingProducts.some((p) => p.sku?.toLowerCase() === compSku.toLowerCase());

            if (!compExists) {
              warnings.push({
                rowNumber,
                column: 'كود المكون',
                value: compSku,
                message: `المادة الخام "${compSku}" غير مسجلة مسبقاً، سيتم إنشاؤها تلقائياً في دليل المواد الخام.`,
                messageEn: `Raw material "${compSku}" not found. Will be auto-created in raw materials master.`,
                remedy: `لا يتطلب إجراء، سيقوم النظام بإنشائها أثناء الاستيراد.`,
                remedyEn: `No action needed, will be auto-created.`,
                severity: 'warning',
              });
            }
          }

          if (qty <= 0) {
            errors.push({
              rowNumber,
              column: 'الكمية المطلوبة للوحدة',
              value: qty,
              message: `الكمية المستهلكة للمكون "${compName}" يجب أن تكون أكبر من 0 (القيمة الحالية: ${qty}).`,
              messageEn: `Component consumption quantity must be > 0.`,
              remedy: `حدد كمية موجبة مثل 0.15 كجم أو 1 قطعة في الصف ${rowNumber}.`,
              remedyEn: `Specify a quantity > 0 at row ${rowNumber}.`,
              severity: 'error',
            });
          }

          // Check duplicate component within same product
          if (prodSku && compSku) {
            if (!recipeProductComponents.has(prodSku)) {
              recipeProductComponents.set(prodSku, new Set());
            }
            const set = recipeProductComponents.get(prodSku)!;
            if (set.has(compSku.toLowerCase())) {
              warnings.push({
                rowNumber,
                column: 'كود المكون',
                value: compSku,
                message: `المكون "${compSku}" مكرر لنفس المنتج "${prodSku}". سيتم دمج الكميات معاً.`,
                messageEn: `Component "${compSku}" repeated for same product. Quantities will be aggregated.`,
                remedy: `من الأفضل دمج أسطر المكون المتكررة في سطر واحد بإجمالي الكمية.`,
                remedyEn: `Combine duplicate ingredient rows into a single entry.`,
                severity: 'warning',
              });
            } else {
              set.add(compSku.toLowerCase());
            }

            // Track Grouped Summary for UI preview e.g. "BUR001 — برجر لحم — 4 مكونات"
            const currentSummary = groupedSummaryMap.get(prodSku) || {
              id: prodSku,
              name: prodName,
              count: 0,
              valid: true,
            };
            currentSummary.count += 1;
            groupedSummaryMap.set(prodSku, currentSummary);
          }
          break;
        }

        case 'purchases': {
          // Grouped by Purchase No
          const purchaseNo = String(row.purchase_no || '').trim();
          const supplierStr = String(row.supplier_code || '').trim();
          const warehouseStr = String(row.warehouse || '').trim();
          const itemSku = String(row.sku || '').trim();
          const qty = Number(row.quantity || 0);
          const unitCost = Number(row.unit_cost || 0);

          if (!purchaseNo) {
            errors.push({
              rowNumber,
              column: 'رقم الفاتورة',
              value: '',
              message: `رقم فاتورة الشراء (Purchase No) إجباري لتجميع الأصناف.`,
              messageEn: `Purchase No is required.`,
              remedy: `أدخل رقم الفاتورة المشترك للأصناف التابعة لنفس الفاتورة في الصف ${rowNumber}.`,
              remedyEn: `Provide invoice number at row ${rowNumber}.`,
              severity: 'error',
            });
          }

          // Validate Supplier
          if (supplierStr) {
            const supplierExists = context.existingSuppliers.some(
              (s) =>
                s.code?.toLowerCase() === supplierStr.toLowerCase() ||
                s.name?.toLowerCase() === supplierStr.toLowerCase() ||
                s.id === supplierStr
            );
            if (!supplierExists) {
              errors.push({
                rowNumber,
                column: 'كود / اسم المورد',
                value: supplierStr,
                message: `المورد "${supplierStr}" غير مسجل في دليل الموردين.`,
                messageEn: `Supplier "${supplierStr}" not found in suppliers registry.`,
                remedy: `قم بتسجيل المورد "${supplierStr}" في شاشة الموردين أو استيراد ملف الموردين أولاً.`,
                remedyEn: `Register supplier "${supplierStr}" first before purchasing.`,
                severity: 'error',
              });
            }
          }

          // Validate Warehouse & Branch Isolation
          if (warehouseStr) {
            const warehouse = context.existingWarehouses.find(
              (w) =>
                w.code?.toLowerCase() === warehouseStr.toLowerCase() ||
                w.name?.toLowerCase() === warehouseStr.toLowerCase() ||
                w.id === warehouseStr
            );

            if (!warehouse) {
              errors.push({
                rowNumber,
                column: 'المستودع المستلم',
                value: warehouseStr,
                message: `المستودع "${warehouseStr}" غير موجود بالنظام.`,
                messageEn: `Warehouse "${warehouseStr}" not found.`,
                remedy: `تأكد من كتابة اسم المستودع بشكل صحيح كما هو مسجل في إعدادات المستودعات.`,
                remedyEn: `Verify warehouse name in system settings.`,
                severity: 'error',
              });
            } else if (!context.isSuperAdmin && context.allowedWarehouseIds.length > 0 && !context.allowedWarehouseIds.includes(warehouse.id)) {
              errors.push({
                rowNumber,
                column: 'المستودع المستلم',
                value: warehouseStr,
                message: `غير مصرح لك بإيداع المشتريات في مستودع "${warehouseStr}" التابع لفرع آخر (Branch Isolation).`,
                messageEn: `Permission denied: Warehouse "${warehouseStr}" belongs to another unauthorized branch.`,
                remedy: `اختر مستودعاً تابعاً لفرعك المصرح لك بالوصول إليه.`,
                remedyEn: `Select a warehouse within your assigned branch.`,
                severity: 'error',
              });
            }
          }

          // Validate SKU existence (product or raw material)
          if (itemSku) {
            const itemExists =
              context.existingProducts.some((p) => p.sku?.toLowerCase() === itemSku.toLowerCase() || p.id === itemSku) ||
              context.existingComponents.some((c) => c.sku?.toLowerCase() === itemSku.toLowerCase() || c.id === itemSku);

            if (!itemExists) {
              errors.push({
                rowNumber,
                column: 'كود الصنف / المادة',
                value: itemSku,
                message: `الصنف أو المادة الخام "${itemSku}" غير مسجلة في النظام.`,
                messageEn: `Item or material SKU "${itemSku}" does not exist.`,
                remedy: `أضف الصنف في دليل الأصناف أو المواد الخام قبل إدراجه في فاتورة الشراء.`,
                remedyEn: `Add item "${itemSku}" to master data before importing purchases.`,
                severity: 'error',
              });
            }
          }

          if (qty <= 0) {
            errors.push({
              rowNumber,
              column: 'الكمية المشتراة',
              value: qty,
              message: `الكمية المشتراة في الصف ${rowNumber} يجب أن تكون أكبر من الصفر.`,
              messageEn: `Quantity must be > 0.`,
              remedy: `حدد كمية الشراء الفعلية.`,
              remedyEn: `Specify valid quantity.`,
              severity: 'error',
            });
          }

          if (unitCost < 0) {
            errors.push({
              rowNumber,
              column: 'سعر شراء الوحدة',
              value: unitCost,
              message: `سعر التكلفة لا يمكن أن يكون سالباً (${unitCost}).`,
              messageEn: `Unit cost cannot be negative.`,
              remedy: `أدخل سعر الشراء الصحيح للوحدة.`,
              remedyEn: `Enter a valid unit cost.`,
              severity: 'error',
            });
          }

          if (purchaseNo) {
            const currentGrp = groupedSummaryMap.get(purchaseNo) || {
              id: purchaseNo,
              name: `فاتورة شراء: ${purchaseNo} (المورد: ${supplierStr || 'غير محدد'})`,
              count: 0,
              valid: true,
            };
            currentGrp.count += 1;
            groupedSummaryMap.set(purchaseNo, currentGrp);
          }
          break;
        }

        case 'opening_inventory': {
          const itemSku = String(row.sku || '').trim();
          const warehouseStr = String(row.warehouse || '').trim();
          const qty = Number(row.quantity || 0);

          if (itemSku) {
            const itemExists =
              context.existingProducts.some((p) => p.sku?.toLowerCase() === itemSku.toLowerCase() || p.id === itemSku) ||
              context.existingComponents.some((c) => c.sku?.toLowerCase() === itemSku.toLowerCase() || c.id === itemSku);

            if (!itemExists) {
              errors.push({
                rowNumber,
                column: 'كود الصنف',
                value: itemSku,
                message: `الصنف "${itemSku}" غير مسجل في المنتجات أو المواد الخام.`,
                messageEn: `Item "${itemSku}" not found in products or materials.`,
                remedy: `استورد بطاقات المنتجات أو المواد أولاً ثم استورد رصيدها الافتتاحي.`,
                remedyEn: `Import products/components master data before opening stock.`,
                severity: 'error',
              });
            }
          }

          if (warehouseStr) {
            const warehouse = context.existingWarehouses.find(
              (w) =>
                w.code?.toLowerCase() === warehouseStr.toLowerCase() ||
                w.name?.toLowerCase() === warehouseStr.toLowerCase() ||
                w.id === warehouseStr
            );

            if (!warehouse) {
              errors.push({
                rowNumber,
                column: 'المستودع',
                value: warehouseStr,
                message: `المستودع "${warehouseStr}" غير مسجل في النظام.`,
                messageEn: `Warehouse "${warehouseStr}" does not exist.`,
                remedy: `تحقق من اسم المستودع أو أضفه في شاشة المستودعات.`,
                remedyEn: `Check warehouse name or create it in warehouse settings.`,
                severity: 'error',
              });
            } else if (!context.isSuperAdmin && context.allowedWarehouseIds.length > 0 && !context.allowedWarehouseIds.includes(warehouse.id)) {
              errors.push({
                rowNumber,
                column: 'المستودع',
                value: warehouseStr,
                message: `غير مصرح لك بإدخال مخزون في مستودع "${warehouseStr}" التابع لفرع آخر.`,
                messageEn: `Permission denied: Unauthorized warehouse branch isolation.`,
                remedy: `اختر مستودعاً تابعاً لفرعك المصرح لك به.`,
                remedyEn: `Choose a warehouse inside your authorized branch.`,
                severity: 'error',
              });
            }
          }

          if (qty < 0) {
            errors.push({
              rowNumber,
              column: 'الكمية الافتتاحية',
              value: qty,
              message: `الرصيد الافتتاحي لا يمكن أن يكون سالباً (${qty}).`,
              messageEn: `Opening quantity cannot be negative.`,
              remedy: `أدخل كمية الرصيد الفعلي في المستودع.`,
              remedyEn: `Enter actual stock quantity.`,
              severity: 'error',
            });
          }
          break;
        }

        case 'prices': {
          const sku = String(row.sku || '').trim();
          const branchStr = String(row.branch || '').trim();
          const salePrice = Number(row.sale_price || 0);

          if (sku) {
            const prodExists = context.existingProducts.some(
              (p) => p.sku?.toLowerCase() === sku.toLowerCase() || p.id === sku
            );
            if (!prodExists) {
              errors.push({
                rowNumber,
                column: 'كود المنتج (SKU)',
                value: sku,
                message: `المنتج "${sku}" غير موجود في قائمة المنتجات.`,
                messageEn: `Product SKU "${sku}" does not exist.`,
                remedy: `أضف المنتج في شاشة المنتجات قبل محاولة تعديل سعره.`,
                remedyEn: `Create product before modifying branch pricing.`,
                severity: 'error',
              });
            }
          }

          if (branchStr) {
            const branch = context.existingBranches.find(
              (b) =>
                b.code?.toLowerCase() === branchStr.toLowerCase() ||
                b.name?.toLowerCase() === branchStr.toLowerCase() ||
                b.id === branchStr
            );

            if (!branch) {
              warnings.push({
                rowNumber,
                column: 'اسم أو كود الفرع',
                value: branchStr,
                message: `الفرع "${branchStr}" غير موجود، سيتم تطبيق السعر كسعر عام إذا تُرك فارغاً.`,
                messageEn: `Branch "${branchStr}" not found.`,
                remedy: `اكتب اسم الفرع بشكل دقيق أو اتركه فارغاً لتطبيق السعر على كل الفروع.`,
                remedyEn: `Type exact branch name or leave empty for global price.`,
                severity: 'warning',
              });
            } else if (!context.isSuperAdmin && context.allowedBranchIds.length > 0 && !context.allowedBranchIds.includes(branch.id)) {
              errors.push({
                rowNumber,
                column: 'اسم أو كود الفرع',
                value: branchStr,
                message: `ليس لديك صلاحية لتعديل أسعار الفرع "${branchStr}" (Branch Security).`,
                messageEn: `Unauthorized branch access for price override.`,
                remedy: `يمكنك تعديل أسعار الفروع المصرح لك بها فقط.`,
                remedyEn: `Only modify prices for your authorized branches.`,
                severity: 'error',
              });
            }
          }

          if (salePrice <= 0) {
            errors.push({
              rowNumber,
              column: 'سعر البيع الجديد',
              value: salePrice,
              message: `سعر البيع الجديد يجب أن يكون أكبر من الصفر.`,
              messageEn: `Sale price must be greater than zero.`,
              remedy: `أدخل سعر بيع صحيح بالريال السعودي.`,
              remedyEn: `Enter valid sale price in SAR.`,
              severity: 'error',
            });
          }
          break;
        }

        case 'users': {
          const username = String(row.username || '').trim();
          const role = String(row.role || '').trim().toLowerCase();

          if (username) {
            const userExists = context.existingUsers.some(
              (u) => u.username?.toLowerCase() === username.toLowerCase()
            );
            if (userExists) {
              warnings.push({
                rowNumber,
                column: 'اسم المستخدم',
                value: username,
                message: `اسم المستخدم "${username}" موجود مسبقاً. سيتم تحديث بياناته إذا اخترت سياسة التحديث.`,
                messageEn: `Username "${username}" already exists.`,
                remedy: `إذا كنت تريد إنشاء مستخدم جديد اختر اسماً فريداً.`,
                remedyEn: `Use unique username for new accounts.`,
                severity: 'warning',
              });
            }
          }

          if (role === 'super_admin' && !context.isSuperAdmin) {
            errors.push({
              rowNumber,
              column: 'الدور الوظيفي (Role)',
              value: role,
              message: `لا تملك صلاحية إنشاء حساب برتبة مدير عام (Super Admin) عبر الاستيراد.`,
              messageEn: `Privilege escalation blocked: Cannot assign Super Admin role.`,
              remedy: `اختر دوراً مثل: cashier أو branch_manager أو accountant.`,
              remedyEn: `Assign standard operational roles.`,
              severity: 'error',
            });
          }
          break;
        }
      }
    });

    const errorRowIndices = new Set(errors.map((e) => e.rowNumber));
    const warningRowIndices = new Set(warnings.map((w) => w.rowNumber));
    const validRowIndices: number[] = [];
    const invalidRowIndices: number[] = [];

    rawRows.forEach((_, idx) => {
      const rowNum = idx + 2;
      if (errorRowIndices.has(rowNum)) {
        invalidRowIndices.push(idx);
      } else {
        validRowIndices.push(idx);
      }
    });

    const errorRowCount = errorRowIndices.size;
    const warningRowCount = warningRowIndices.size;
    const validRowCount = validRowIndices.length;

    const groupedSummary = Array.from(groupedSummaryMap.values());

    return {
      totalRows: rawRows.length,
      validRows: validRowCount,
      errorRows: errorRowCount,
      warningRows: warningRowCount,
      errors,
      warnings,
      canProceed: validRowCount > 0,
      validRowIndices,
      invalidRowIndices,
      groupedEntitiesCount: groupedSummary.length > 0 ? groupedSummary.length : undefined,
      groupedSummary: groupedSummary.length > 0 ? groupedSummary : undefined,
    };
  }
}
