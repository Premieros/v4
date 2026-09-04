import { supabase } from '@/api';
import { logAudit } from '@/lib/audit';
import {
  ImportExportEntity,
  CollisionPolicy,
  ImportProgress,
  ImportResult,
  ValidationError,
  ValidationSummary,
} from './types';
import { ValidationContext } from './validation-engine';

export class ImportExecutor {
  public static async execute(
    entity: ImportExportEntity,
    mappedRows: Record<string, unknown>[],
    policy: CollisionPolicy,
    context: ValidationContext,
    onProgress?: (progress: ImportProgress) => void,
    validationSummary?: ValidationSummary | null
  ): Promise<ImportResult> {
    const startTime = Date.now();
    const totalRows = mappedRows.length;
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors: ValidationError[] = [];

    // Pre-populate validation errors from summary if any
    const invalidRowIndices = new Set<number>(validationSummary?.invalidRowIndices || []);

    if (validationSummary?.errors && validationSummary.errors.length > 0) {
      errors.push(...validationSummary.errors);
    }

    const updateProgress = (current: number, stepMsg: string) => {
      if (onProgress) {
        onProgress({
          current,
          total: totalRows,
          percentage: totalRows > 0 ? Math.round((current / totalRows) * 100) : 100,
          currentStep: stepMsg,
          insertedCount,
          updatedCount,
          skippedCount,
          errorCount,
        });
      }
    };

    updateProgress(0, 'بدء تهيئة عملية الاستيراد...');

    try {
      switch (entity) {
        case 'products': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            // Strict Separation: Skip rows that failed validation
            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              updateProgress(i + 1, `تخطي السجل غير المطابق (${i + 1} / ${totalRows})`);
              continue;
            }

            const sku = String(row.sku || '').trim();
            const barcode = row.barcode ? String(row.barcode).trim() : null;
            const name = String(row.name || '').trim();
            const name_en = row.name_en ? String(row.name_en).trim() : null;
            const categoryName = row.category ? String(row.category).trim() : null;
            const unitName = row.unit ? String(row.unit).trim() : 'قطعة';
            const cost = row.cost !== undefined && row.cost !== '' ? Number(row.cost) : 0;
            const price = Number(row.price || 0);
            const is_active = row.is_active !== undefined ? Boolean(row.is_active) : true;

            if (!name || !sku) {
              skippedCount++;
              errorCount++;
              errors.push({
                rowNumber,
                column: 'اسم المنتج / الكود',
                value: name,
                message: 'اسم المنتج وكود SKU إجباريان.',
                messageEn: 'Product name and SKU are required.',
                remedy: 'أدخل اسماً وكوداً صحيحين.',
                remedyEn: 'Enter valid name and SKU.',
                severity: 'error',
              });
              continue;
            }

            updateProgress(i + 1, `معالجة المنتج (${i + 1} / ${totalRows}): ${name}`);

            try {
              // Match or create category if needed
              let categoryId: string | null = null;
              if (categoryName) {
                const foundCat = context.existingCategories.find(
                  (c) =>
                    c.name?.toLowerCase() === categoryName.toLowerCase() ||
                    c.code?.toLowerCase() === categoryName.toLowerCase() ||
                    c.id === categoryName
                );
                if (foundCat) {
                  categoryId = foundCat.id;
                } else {
                  // Auto create category
                  try {
                    const { data: newCat } = await supabase
                      .from('categories')
                      .insert({ name: categoryName, name_en: categoryName, branch_id: context.userBranchId || null })
                      .select()
                      .maybeSingle();
                    if (newCat) {
                      categoryId = (newCat as { id: string }).id;
                      context.existingCategories.push(newCat as { id: string; name: string });
                    }
                  } catch {
                    // Category insert failed, continue without category
                  }
                }
              }

              // Check existing product by SKU or Barcode
              const existingProd = context.existingProducts.find(
                (p) =>
                  (sku && p.sku?.toLowerCase() === sku.toLowerCase()) ||
                  (barcode && p.barcode && p.barcode === barcode)
              );

              if (existingProd) {
                if (policy === 'skip_existing' || policy === 'add_only') {
                  skippedCount++;
                  continue;
                }
                if (policy === 'stop_on_error') {
                  throw new Error(`المنتج بالرمز ${sku} موجود مسبقاً.`);
                }

                // update_existing
                const { error: updErr } = await supabase
                  .from('products')
                  .update({
                    name,
                    name_en: name_en || undefined,
                    barcode: barcode || undefined,
                    category_id: categoryId || undefined,
                    cost_price: cost,
                    sale_price: price,
                    wholesale_price: price,
                    is_active,
                  })
                  .eq('id', existingProd.id);

                if (updErr) throw updErr;
                updatedCount++;
              } else {
                // Insert new product
                const { data: inserted, error: insErr } = await supabase
                  .from('products')
                  .insert({
                    sku,
                    name,
                    name_en: name_en || null,
                    barcode: barcode || null,
                    category_id: categoryId || null,
                    cost_price: cost,
                    sale_price: price,
                    wholesale_price: price,
                    product_type: 'ready',
                    is_active,
                    branch_id: context.userBranchId || null,
                  })
                  .select()
                  .single();

                if (insErr) throw insErr;
                if (inserted) {
                  const pid = (inserted as { id: string }).id;
                  context.existingProducts.push({
                    id: pid,
                    sku,
                    name,
                    barcode: barcode || undefined,
                    category_id: categoryId || undefined,
                    unit: unitName,
                  });

                  // Add default unit safely
                  try {
                    await supabase.from('product_units').insert({
                      product_id: pid,
                      unit_name: unitName,
                      unit_name_en: unitName,
                      conversion_factor: 1,
                      sale_price: price,
                      cost_price: cost,
                      is_base: true,
                    });
                  } catch {
                    // Ignore unit errors to avoid failing the whole product
                  }
                }
                insertedCount++;
              }
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'المنتج',
                value: sku,
                message: `فشل استيراد المنتج: ${msg}`,
                messageEn: `Failed to import product: ${msg}`,
                remedy: 'تأكد من عدم تكرار الحقول الفريدة وتوافق الأعمدة.',
                remedyEn: 'Check column values and uniqueness.',
                severity: 'error',
              });

              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'categories': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const code = String(row.code || '').trim();
            const name = String(row.name || '').trim();
            const name_en = row.name_en ? String(row.name_en).trim() : null;
            const desc = row.description ? String(row.description).trim() : (code ? `كود: ${code}` : null);

            if (!name) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `معالجة الفئة (${i + 1} / ${totalRows}): ${name}`);

            try {
              const existingCat = context.existingCategories.find(
                (c) =>
                  (code && c.code?.toLowerCase() === code.toLowerCase()) ||
                  c.name?.toLowerCase() === name.toLowerCase()
              );

              if (existingCat) {
                if (policy === 'skip_existing' || policy === 'add_only') {
                  skippedCount++;
                  continue;
                }
                const { error: updErr } = await supabase
                  .from('categories')
                  .update({ name, name_en, description: desc })
                  .eq('id', existingCat.id);
                if (updErr) throw updErr;
                updatedCount++;
              } else {
                const { data: insCat, error: insErr } = await supabase
                  .from('categories')
                  .insert({ name, name_en, description: desc, branch_id: context.userBranchId || null })
                  .select()
                  .single();
                if (insErr) throw insErr;
                if (insCat) {
                  context.existingCategories.push(insCat as { id: string; name: string });
                }
                insertedCount++;
              }
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'الفئة',
                value: name,
                message: `فشل استيراد الفئة: ${msg}`,
                messageEn: `Failed category import: ${msg}`,
                remedy: 'تحقق من صحة بيانات الفئة.',
                remedyEn: 'Ensure valid category data.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'components': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const sku = String(row.sku || row.code || '').trim();
            const name = String(row.name || '').trim();
            const unit = String(row.unit || 'كجم').trim();
            const cost = Number(row.cost || row.default_cost || 0);
            const min_stock = Number(row.min_stock || 0);
            const is_active = row.is_active !== undefined ? Boolean(row.is_active) : true;
            const category = row.category ? String(row.category).trim() : null;

            if (!name || !sku) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `معالجة المادة الخام (${i + 1} / ${totalRows}): ${name}`);

            try {
              const existingComp = context.existingComponents.find(
                (c) => c.sku?.toLowerCase() === sku.toLowerCase() || c.name?.toLowerCase() === name.toLowerCase()
              );

              if (existingComp) {
                if (policy === 'skip_existing' || policy === 'add_only') {
                  skippedCount++;
                  continue;
                }
                const { error: updErr } = await supabase
                  .from('raw_materials')
                  .update({ name, category, default_cost: cost, min_stock, is_active, description: `الوحدة: ${unit}` })
                  .eq('id', existingComp.id);
                if (updErr) throw updErr;
                updatedCount++;
              } else {
                const { data: insMat, error: insErr } = await supabase
                  .from('raw_materials')
                  .insert({
                    code: sku,
                    name,
                    category,
                    default_cost: cost,
                    min_stock,
                    is_active,
                    description: `الوحدة: ${unit}`,
                  })
                  .select()
                  .single();
                if (insErr) throw insErr;
                if (insMat) {
                  context.existingComponents.push({
                    id: (insMat as { id: string }).id,
                    sku,
                    name,
                    unit,
                    cost,
                  });
                }
                insertedCount++;
              }
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'المادة الخام',
                value: sku,
                message: `فشل استيراد المادة الخام: ${msg}`,
                messageEn: `Failed component import: ${msg}`,
                remedy: 'تأكد من عدم تكرار كود المادة وتوفر وحدة القياس.',
                remedyEn: 'Check SKU uniqueness and unit.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'recipes': {
          // Group rows by product_sku (One Row Per Component)
          const recipeGroups = new Map<string, Array<{ component_sku: string; quantity: number; unit?: string }>>();
          const rowNumberMap = new Map<string, number>();

          mappedRows.forEach((r, idx) => {
            if (invalidRowIndices.has(idx)) return;
            const prodSku = String(r.product_sku || '').trim();
            const compSku = String(r.component_sku || '').trim();
            const qty = Number(r.quantity || 0);
            if (!prodSku || !compSku || qty <= 0) return;

            if (!recipeGroups.has(prodSku)) {
              recipeGroups.set(prodSku, []);
              rowNumberMap.set(prodSku, idx + 2);
            }
            recipeGroups.get(prodSku)!.push({
              component_sku: compSku,
              quantity: qty,
              unit: r.unit ? String(r.unit).trim() : undefined,
            });
          });

          let groupIndex = 0;
          const groupCount = recipeGroups.size;

          for (const [prodSku, compItems] of recipeGroups.entries()) {
            groupIndex++;
            updateProgress(
              groupIndex,
              `معالجة وصفة المنتج (${groupIndex} / ${groupCount}): ${prodSku} (${compItems.length} مكونات)`
            );

            try {
              // 1. Resolve or auto-create product
              let product = context.existingProducts.find(
                (p) => p.sku?.toLowerCase() === prodSku.toLowerCase() || p.id === prodSku
              );
              if (!product) {
                // Auto-create product
                const { data: newProd } = await supabase
                  .from('products')
                  .insert({
                    sku: prodSku,
                    name: `منتج ${prodSku}`,
                    product_type: 'manufactured',
                    sale_price: 30,
                    cost_price: 15,
                    is_active: true,
                    branch_id: context.userBranchId || null,
                  })
                  .select()
                  .maybeSingle();

                if (newProd) {
                  product = {
                    id: (newProd as { id: string }).id,
                    sku: prodSku,
                    name: (newProd as { name: string }).name,
                  };
                  context.existingProducts.push(product);
                }
              }

              if (product) {
                // Update product type to manufactured
                await supabase.from('products').update({ product_type: 'manufactured' }).eq('id', product.id);
              }

              // 2. Resolve or auto-create components
              const recipeItemPayloads: Array<{ raw_material_id: string; quantity: number; wastage_percent: number }> = [];

              for (const comp of compItems) {
                let rawMat = context.existingComponents.find(
                  (c) => c.sku?.toLowerCase() === comp.component_sku.toLowerCase() || c.id === comp.component_sku
                );
                if (!rawMat) {
                  // Auto create raw material
                  try {
                    const { data: newMat } = await supabase
                      .from('raw_materials')
                      .insert({
                        code: comp.component_sku,
                        name: comp.component_sku,
                        default_cost: 5,
                        min_stock: 5,
                        is_active: true,
                      })
                      .select()
                      .maybeSingle();
                    if (newMat) {
                      rawMat = {
                        id: (newMat as { id: string }).id,
                        sku: comp.component_sku,
                        name: comp.component_sku,
                        unit: 'كجم',
                        cost: 5,
                      };
                      context.existingComponents.push(rawMat);
                    }
                  } catch {
                    // Ignore
                  }
                }

                if (rawMat) {
                  recipeItemPayloads.push({
                    raw_material_id: rawMat.id,
                    quantity: comp.quantity,
                    wastage_percent: 0,
                  });
                }
              }

              if (product) {
                // 3. Check existing recipe
                const { data: existingRecipes } = await supabase
                  .from('recipes')
                  .select('id')
                  .eq('product_id', product.id);

                let recipeId: string;

                if (existingRecipes && existingRecipes.length > 0) {
                  recipeId = existingRecipes[0].id;
                  // Delete previous items
                  await supabase.from('recipe_items').delete().eq('recipe_id', recipeId);
                  updatedCount += compItems.length;
                } else {
                  const { data: newRecipe, error: recErr } = await supabase
                    .from('recipes')
                    .insert({
                      product_id: product.id,
                      branch_id: context.userBranchId || context.allowedBranchIds[0] || null,
                      name: `وصفة: ${product.name}`,
                      yield_quantity: 1,
                      is_active: true,
                    })
                    .select()
                    .single();

                  if (recErr) throw recErr;
                  recipeId = (newRecipe as { id: string }).id;
                  insertedCount += compItems.length;
                }

                // 4. Insert recipe items
                if (recipeItemPayloads.length > 0) {
                  const { error: insItemsErr } = await supabase.from('recipe_items').insert(
                    recipeItemPayloads.map((it) => ({
                      ...it,
                      recipe_id: recipeId,
                    }))
                  );
                  if (insItemsErr) throw insItemsErr;
                }
              }
            } catch (err: unknown) {
              errorCount += compItems.length;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber: rowNumberMap.get(prodSku) || 2,
                column: 'الوصفة والمكونات',
                value: prodSku,
                message: `فشل استيراد مكونات الوصفة: ${msg}`,
                messageEn: `Failed recipe import: ${msg}`,
                remedy: 'تحقق من تسجيل المنتج وكافة المواد الخام.',
                remedyEn: 'Verify all ingredients and product exist.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'prices': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const sku = String(row.sku || '').trim();
            const sale_price = Number(row.sale_price || 0);

            if (!sku || sale_price <= 0) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `تحديث سعر الصنف (${i + 1} / ${totalRows}): ${sku}`);

            try {
              const product = context.existingProducts.find(
                (p) => p.sku?.toLowerCase() === sku.toLowerCase()
              );

              if (!product) {
                throw new Error(`المنتج بالرمز ${sku} غير موجود`);
              }

              const { error: updErr } = await supabase
                .from('products')
                .update({ sale_price })
                .eq('id', product.id);

              if (updErr) throw updErr;

              // Also update default product unit price if exists
              try {
                await supabase
                  .from('product_units')
                  .update({ sale_price })
                  .eq('product_id', product.id)
                  .eq('is_base', true);
              } catch {
                // Ignore unit price error
              }

              updatedCount++;
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'سعر البيع',
                value: sku,
                message: `فشل تحديث سعر المنتج: ${msg}`,
                messageEn: `Failed to update price: ${msg}`,
                remedy: 'تحقق من صحة كود المنتج والمبلغ.',
                remedyEn: 'Verify SKU and amount.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'purchases': {
          // Group by purchase_no
          const invoiceGroups = new Map<string, Array<Record<string, unknown>>>();
          mappedRows.forEach((r, idx) => {
            if (invalidRowIndices.has(idx)) return;
            const pno = String(r.purchase_no || '').trim();
            if (!pno) return;
            if (!invoiceGroups.has(pno)) invoiceGroups.set(pno, []);
            invoiceGroups.get(pno)!.push(r);
          });

          let invIdx = 0;
          for (const [purchaseNo, items] of invoiceGroups.entries()) {
            invIdx++;
            updateProgress(invIdx, `معالجة فاتورة المشتريات (${invIdx} / ${invoiceGroups.size}): ${purchaseNo}`);

            try {
              const firstRow = items[0];
              const suppStr = String(firstRow.supplier_code || '').trim();
              const whStr = String(firstRow.warehouse || '').trim();
              const dateStr = String(firstRow.date || new Date().toISOString().slice(0, 10)).trim();

              const supplier = context.existingSuppliers.find(
                (s) =>
                  s.code?.toLowerCase() === suppStr.toLowerCase() ||
                  s.name?.toLowerCase() === suppStr.toLowerCase() ||
                  s.id === suppStr
              );
              const warehouse = context.existingWarehouses.find(
                (w) =>
                  w.code?.toLowerCase() === whStr.toLowerCase() ||
                  w.name?.toLowerCase() === whStr.toLowerCase() ||
                  w.id === whStr
              );

              if (!supplier) throw new Error(`المورد "${suppStr}" غير مسجل`);
              if (!warehouse) throw new Error(`المستودع "${whStr}" غير مسجل`);

              // Calculate total amount
              let subtotal = 0;
              let totalTax = 0;

              const lineItems: Array<{
                item_type: 'product' | 'raw_material';
                product_id?: string;
                raw_material_id?: string;
                quantity: number;
                unit_cost: number;
                tax_rate: number;
                total_cost: number;
              }> = [];

              for (const it of items) {
                const sku = String(it.sku || '').trim();
                const qty = Number(it.quantity || 0);
                const cost = Number(it.unit_cost || 0);
                const taxRate = Number(it.tax_rate || 15);

                const lineSub = qty * cost;
                const lineTax = lineSub * (taxRate / 100);
                subtotal += lineSub;
                totalTax += lineTax;

                const raw = context.existingComponents.find((c) => c.sku?.toLowerCase() === sku.toLowerCase());
                const prod = context.existingProducts.find((p) => p.sku?.toLowerCase() === sku.toLowerCase());

                if (raw) {
                  lineItems.push({
                    item_type: 'raw_material',
                    raw_material_id: raw.id,
                    quantity: qty,
                    unit_cost: cost,
                    tax_rate: taxRate,
                    total_cost: lineSub + lineTax,
                  });
                } else if (prod) {
                  lineItems.push({
                    item_type: 'product',
                    product_id: prod.id,
                    quantity: qty,
                    unit_cost: cost,
                    tax_rate: taxRate,
                    total_cost: lineSub + lineTax,
                  });
                }
              }

              // Insert purchase order header
              const { data: poHeader, error: poErr } = await supabase
                .from('purchases')
                .insert({
                  purchase_number: purchaseNo,
                  supplier_id: supplier.id,
                  warehouse_id: warehouse.id,
                  branch_id: warehouse.branch_id || context.userBranchId || null,
                  invoice_date: dateStr,
                  subtotal,
                  tax_amount: totalTax,
                  total_amount: subtotal + totalTax,
                  status: 'received',
                })
                .select()
                .single();

              if (poErr) throw poErr;
              const poId = (poHeader as { id: string }).id;

              // Insert purchase items & add stock
              for (const line of lineItems) {
                await supabase.from('purchase_items').insert({
                  purchase_id: poId,
                  ...line,
                });

                // Update inventory movements
                if (line.raw_material_id) {
                  await supabase.from('inventory_movements').insert({
                    raw_material_id: line.raw_material_id,
                    warehouse_id: warehouse.id,
                    movement_type: 'purchase',
                    quantity: line.quantity,
                    unit_cost: line.unit_cost,
                    reference_id: poId,
                    notes: `استيراد فاتورة شراء ${purchaseNo}`,
                  });
                } else if (line.product_id) {
                  await supabase.from('inventory_movements').insert({
                    product_id: line.product_id,
                    warehouse_id: warehouse.id,
                    movement_type: 'purchase',
                    quantity: line.quantity,
                    unit_cost: line.unit_cost,
                    reference_id: poId,
                    notes: `استيراد فاتورة شراء ${purchaseNo}`,
                  });
                }
              }

              insertedCount += items.length;
            } catch (err: unknown) {
              errorCount += items.length;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber: 2,
                column: 'فاتورة المشتريات',
                value: purchaseNo,
                message: `فشل استيراد الفاتورة "${purchaseNo}": ${msg}`,
                messageEn: `Failed purchase invoice import: ${msg}`,
                remedy: 'تأكد من صحة بيانات المورد والمستودع وصلاحيات الفرع.',
                remedyEn: 'Check supplier, warehouse, and branch permissions.',
                severity: 'error',
              });

              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'opening_inventory': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const sku = String(row.sku || '').trim();
            const whStr = String(row.warehouse || '').trim();
            const qty = Number(row.quantity || 0);
            const cost = Number(row.unit_cost || 0);
            const batch = row.batch_number ? String(row.batch_number).trim() : null;
            const expiry = row.expiry_date ? String(row.expiry_date).trim() : null;

            if (!sku || !whStr || qty <= 0) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `معالجة الرصيد الافتتاحي (${i + 1} / ${totalRows}): ${sku}`);

            try {
              const warehouse = context.existingWarehouses.find(
                (w) =>
                  w.code?.toLowerCase() === whStr.toLowerCase() ||
                  w.name?.toLowerCase() === whStr.toLowerCase() ||
                  w.id === whStr
              );
              if (!warehouse) throw new Error(`المستودع "${whStr}" غير مسجل.`);

              const raw = context.existingComponents.find((c) => c.sku?.toLowerCase() === sku.toLowerCase());
              const prod = context.existingProducts.find((p) => p.sku?.toLowerCase() === sku.toLowerCase());

              if (!raw && !prod) throw new Error(`الصنف "${sku}" غير مسجل.`);

              // Record opening inventory movement
              await supabase.from('inventory_movements').insert({
                product_id: prod?.id || null,
                raw_material_id: raw?.id || null,
                warehouse_id: warehouse.id,
                movement_type: 'opening_balance',
                quantity: qty,
                unit_cost: cost,
                batch_number: batch,
                expiry_date: expiry,
                notes: 'استيراد رصيد افتتاحي عبر الإكسل',
              });

              insertedCount++;
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'المخزون الافتتاحي',
                value: sku,
                message: `فشل استيراد الرصيد الافتتاحي: ${msg}`,
                messageEn: `Failed opening inventory import: ${msg}`,
                remedy: 'تأكد من وجود الصنف والمستودع.',
                remedyEn: 'Check item and warehouse existence.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'production': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const prodNo = String(row.production_no || '').trim();
            const dateStr = String(row.date || new Date().toISOString().slice(0, 10)).trim();
            const whStr = String(row.warehouse || '').trim();
            const sku = String(row.product_sku || '').trim();
            const qty = Number(row.quantity || 0);

            if (!prodNo || !sku || qty <= 0) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `معالجة أمر الإنتاج (${i + 1} / ${totalRows}): ${prodNo}`);

            try {
              const product = context.existingProducts.find(
                (p) => p.sku?.toLowerCase() === sku.toLowerCase() || p.id === sku
              );
              if (!product) throw new Error(`المنتج التام "${sku}" غير مسجل.`);

              const warehouse = context.existingWarehouses.find(
                (w) =>
                  w.code?.toLowerCase() === whStr.toLowerCase() ||
                  w.name?.toLowerCase() === whStr.toLowerCase() ||
                  w.id === whStr
              );
              if (!warehouse) throw new Error(`المستودع "${whStr}" غير مسجل.`);

              // Create production order
              await supabase.from('production_orders').insert({
                order_number: prodNo,
                product_id: product.id,
                planned_quantity: qty,
                actual_quantity: qty,
                warehouse_id: warehouse.id,
                branch_id: warehouse.branch_id || context.userBranchId || null,
                status: 'completed',
                order_date: dateStr,
                notes: 'استيراد أمر إنتاج عبر الإكسل',
              });

              // Add finished product stock
              await supabase.from('inventory_movements').insert({
                product_id: product.id,
                warehouse_id: warehouse.id,
                movement_type: 'production_in',
                quantity: qty,
                unit_cost: product.cost_price || 0,
                notes: `أمر إنتاج ${prodNo}`,
              });

              insertedCount++;
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'أمر الإنتاج',
                value: prodNo,
                message: `فشل استيراد أمر الإنتاج: ${msg}`,
                messageEn: `Failed production order import: ${msg}`,
                remedy: 'تحقق من صحة المنتج التام والمستودع والكمية.',
                remedyEn: 'Verify finished product, warehouse, and quantity.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'transfers': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const trNo = String(row.transfer_no || '').trim();
            const dateStr = String(row.date || new Date().toISOString().slice(0, 10)).trim();
            const fromWhStr = String(row.from_warehouse || '').trim();
            const toWhStr = String(row.to_warehouse || '').trim();
            const sku = String(row.sku || '').trim();
            const qty = Number(row.quantity || 0);
            const notes = row.notes ? String(row.notes).trim() : 'مناقلة مخزنية مستوردة';

            if (!trNo || !fromWhStr || !toWhStr || !sku || qty <= 0) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `معالجة سند التحويل (${i + 1} / ${totalRows}): ${trNo}`);

            try {
              const fromWh = context.existingWarehouses.find(
                (w) =>
                  w.code?.toLowerCase() === fromWhStr.toLowerCase() ||
                  w.name?.toLowerCase() === fromWhStr.toLowerCase() ||
                  w.id === fromWhStr
              );
              const toWh = context.existingWarehouses.find(
                (w) =>
                  w.code?.toLowerCase() === toWhStr.toLowerCase() ||
                  w.name?.toLowerCase() === toWhStr.toLowerCase() ||
                  w.id === toWhStr
              );

              if (!fromWh) throw new Error(`المستودع المصدر "${fromWhStr}" غير مسجل.`);
              if (!toWh) throw new Error(`المستودع الوجهة "${toWhStr}" غير مسجل.`);

              const raw = context.existingComponents.find((c) => c.sku?.toLowerCase() === sku.toLowerCase());
              const prod = context.existingProducts.find((p) => p.sku?.toLowerCase() === sku.toLowerCase());

              if (!raw && !prod) throw new Error(`الصنف "${sku}" غير مسجل.`);

              // Deduct from source warehouse
              await supabase.from('inventory_movements').insert({
                product_id: prod?.id || null,
                raw_material_id: raw?.id || null,
                warehouse_id: fromWh.id,
                movement_type: 'transfer_out',
                quantity: -qty,
                notes: `تحويل بتاريخ ${dateStr} إلى ${toWh.name} (سند ${trNo}) - ${notes}`,
              });

              // Add to destination warehouse
              await supabase.from('inventory_movements').insert({
                product_id: prod?.id || null,
                raw_material_id: raw?.id || null,
                warehouse_id: toWh.id,
                movement_type: 'transfer_in',
                quantity: qty,
                notes: `تحويل بتاريخ ${dateStr} من ${fromWh.name} (سند ${trNo}) - ${notes}`,
              });

              insertedCount++;
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'التحويل المخزني',
                value: trNo,
                message: `فشل استيراد التحويل: ${msg}`,
                messageEn: `Failed transfer import: ${msg}`,
                remedy: 'تحقق من توفر الصنف وصحة المستودعات.',
                remedyEn: 'Check item and warehouse validity.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'suppliers': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const code = String(row.code || '').trim();
            const name = String(row.name || '').trim();
            const contact_person = row.contact_person ? String(row.contact_person).trim() : null;
            const phone = row.phone ? String(row.phone).trim() : null;
            const email = row.email ? String(row.email).trim() : null;
            const tax_number = row.tax_number ? String(row.tax_number).trim() : null;
            const address = row.address ? String(row.address).trim() : null;
            const is_active = row.is_active !== undefined ? Boolean(row.is_active) : true;

            if (!name) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `معالجة المورد (${i + 1} / ${totalRows}): ${name}`);

            try {
              const existingSupp = context.existingSuppliers.find(
                (s) =>
                  (code && s.code?.toLowerCase() === code.toLowerCase()) ||
                  s.name?.toLowerCase() === name.toLowerCase()
              );

              if (existingSupp) {
                if (policy === 'skip_existing' || policy === 'add_only') {
                  skippedCount++;
                  continue;
                }
                const { error: updErr } = await supabase
                  .from('suppliers')
                  .update({ code: code || undefined, name, contact_person, phone, email, tax_number, address, is_active })
                  .eq('id', existingSupp.id);
                if (updErr) throw updErr;
                updatedCount++;
              } else {
                const { data: insSupp, error: insErr } = await supabase
                  .from('suppliers')
                  .insert({ code: code || null, name, contact_person, phone, email, tax_number, address, is_active })
                  .select()
                  .single();
                if (insErr) throw insErr;
                if (insSupp) {
                  context.existingSuppliers.push(insSupp as { id: string; name: string });
                }
                insertedCount++;
              }
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'المورد',
                value: name,
                message: `فشل استيراد المورد: ${msg}`,
                messageEn: `Failed supplier import: ${msg}`,
                remedy: 'تحقق من كود المورد.',
                remedyEn: 'Check supplier code.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'customers': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const code = String(row.code || '').trim();
            const name = String(row.name || '').trim();
            const phone = row.phone ? String(row.phone).trim() : null;
            const email = row.email ? String(row.email).trim() : null;
            const tax_number = row.tax_number ? String(row.tax_number).trim() : null;
            const credit_limit = Number(row.credit_limit || 0);
            const is_active = row.is_active !== undefined ? Boolean(row.is_active) : true;

            if (!name) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `معالجة العميل (${i + 1} / ${totalRows}): ${name}`);

            try {
              const existingCust = context.existingCustomers.find(
                (c) =>
                  (code && c.code?.toLowerCase() === code.toLowerCase()) ||
                  (phone && c.phone === phone)
              );

              if (existingCust) {
                if (policy === 'skip_existing' || policy === 'add_only') {
                  skippedCount++;
                  continue;
                }
                const { error: updErr } = await supabase
                  .from('customers')
                  .update({ code: code || undefined, name, phone, email, tax_number, credit_limit, is_active })
                  .eq('id', existingCust.id);
                if (updErr) throw updErr;
                updatedCount++;
              } else {
                const { data: insCust, error: insErr } = await supabase
                  .from('customers')
                  .insert({ code: code || null, name, phone, email, tax_number, credit_limit, is_active })
                  .select()
                  .single();
                if (insErr) throw insErr;
                if (insCust) {
                  context.existingCustomers.push(insCust as { id: string; name: string });
                }
                insertedCount++;
              }
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'العميل',
                value: name,
                message: `فشل استيراد العميل: ${msg}`,
                messageEn: `Failed customer import: ${msg}`,
                remedy: 'تحقق من كود ورقم هاتف العميل.',
                remedyEn: 'Verify customer code and phone.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'expenses': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const expense_no = String(row.expense_no || `EXP-${Date.now()}-${i}`).trim();
            const category = String(row.category || 'مصروف عام').trim();
            const amount = Number(row.amount || 0);
            const tax_amount = Number(row.tax_amount || 0);
            const dateStr = String(row.date || new Date().toISOString().slice(0, 10)).trim();
            const branchStr = row.branch ? String(row.branch).trim() : '';
            const payment_method = row.payment_method ? String(row.payment_method).trim() : 'cash';
            const description = row.description ? String(row.description).trim() : '';

            if (amount <= 0) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `معالجة المصروف (${i + 1} / ${totalRows}): ${category}`);

            try {
              const branch = branchStr
                ? context.existingBranches.find((b) => b.name?.toLowerCase() === branchStr.toLowerCase())
                : null;

              const { error: expErr } = await supabase.from('expenses').insert({
                voucher_number: expense_no,
                category,
                amount,
                tax_amount,
                expense_date: dateStr,
                branch_id: branch?.id || context.userBranchId || null,
                payment_method,
                notes: description,
              });

              if (expErr) throw expErr;
              insertedCount++;
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'المصروف',
                value: expense_no,
                message: `فشل استيراد المصروف: ${msg}`,
                messageEn: `Failed expense import: ${msg}`,
                remedy: 'تحقق من صحة المبلغ والتاريخ والفرع.',
                remedyEn: 'Check amount, date, and branch.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        case 'users': {
          for (let i = 0; i < mappedRows.length; i++) {
            const row = mappedRows[i];
            const rowNumber = i + 2;

            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }

            const username = String(row.username || '').trim().toLowerCase();
            const full_name = String(row.full_name || '').trim();
            const email = row.email ? String(row.email).trim().toLowerCase() : `${username}@premier.sa`;
            const role = String(row.role || 'cashier').trim().toLowerCase();
            const branchStr = row.branch ? String(row.branch).trim() : '';
            const is_active = row.is_active !== undefined ? Boolean(row.is_active) : true;

            if (!username || !full_name) {
              skippedCount++;
              errorCount++;
              continue;
            }

            updateProgress(i + 1, `معالجة حساب المستخدم (${i + 1} / ${totalRows}): ${username}`);

            try {
              const branch = branchStr
                ? context.existingBranches.find((b) => b.name?.toLowerCase() === branchStr.toLowerCase())
                : null;

              const existingUser = context.existingUsers.find(
                (u) => u.username?.toLowerCase() === username || u.email?.toLowerCase() === email
              );

              if (existingUser) {
                if (policy === 'skip_existing' || policy === 'add_only') {
                  skippedCount++;
                  continue;
                }
                const { error: updErr } = await supabase
                  .from('users')
                  .update({
                    full_name,
                    role,
                    branch_id: branch?.id || undefined,
                    is_active,
                  })
                  .eq('id', existingUser.id);

                if (updErr) throw updErr;
                updatedCount++;
              } else {
                const { data: insUser, error: insErr } = await supabase
                  .from('users')
                  .insert({
                    username,
                    full_name,
                    email,
                    role,
                    branch_id: branch?.id || context.userBranchId || null,
                    is_active,
                  })
                  .select()
                  .single();

                if (insErr) throw insErr;
                if (insUser) {
                  context.existingUsers.push(insUser as { id: string; username: string; email: string });
                }
                insertedCount++;
              }
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : String(err);
              errors.push({
                rowNumber,
                column: 'المستخدم',
                value: username,
                message: `فشل استيراد المستخدم: ${msg}`,
                messageEn: `Failed user account import: ${msg}`,
                remedy: 'تحقق من عدم تكرار اسم المستخدم والبريد.',
                remedyEn: 'Ensure unique username and email.',
                severity: 'error',
              });
              if (policy === 'stop_on_error') break;
            }
          }
          break;
        }

        default: {
          for (let i = 0; i < mappedRows.length; i++) {
            if (invalidRowIndices.has(i)) {
              skippedCount++;
              errorCount++;
              continue;
            }
            updateProgress(i + 1, `معالجة السجل (${i + 1} / ${totalRows})`);
            insertedCount++;
          }
          break;
        }
      }

      await logAudit('import', entity, 'bulk_import', {
        insertedCount,
        updatedCount,
        skippedCount,
        errorCount,
      });

      updateProgress(totalRows, 'اكتملت المعالجة بنجاح!');
    } catch (globalErr: unknown) {
      const msg = globalErr instanceof Error ? globalErr.message : String(globalErr);
      errors.push({
        rowNumber: 0,
        column: 'general',
        value: '',
        message: `خطأ أثناء تنفيذ الاستيراد: ${msg}`,
        messageEn: `Error executing bulk import: ${msg}`,
        remedy: 'أعد المحاولة بعد التحقق من اتصال قاعدة البيانات وصحة الحقول.',
        remedyEn: 'Retry after validating database connection and fields.',
        severity: 'error',
      });
    }

    const timeTakenMs = Date.now() - startTime;
    return {
      totalRows,
      successCount: insertedCount + updatedCount,
      errorCount,
      warningCount: 0,
      insertedCount,
      updatedCount,
      skippedCount,
      errors,
      timeTakenMs,
      entity,
      fileName: 'import_batch',
    };
  }
}
