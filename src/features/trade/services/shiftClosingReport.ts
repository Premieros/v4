import { supabase } from '@/api';
import { formatCurrency, formatDateTime, escapeHtml } from '@/lib/format';
import type { Language } from '@/lib/types';

export interface ShiftClosingSummary {
  shiftId: string;
  branchId: string;
  branchName: string;
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  openingAmount: number;
  expectedAmount: number;
  actualAmount: number;
  difference: number;
  notes: string | null;

  // Sales metrics
  totalInvoices: number;
  grossSales: number;
  totalDiscounts: number;
  totalTaxes: number;
  netSales: number;
  avgTicket: number;

  // Order types
  orderTypes: {
    type: string;
    label: string;
    count: number;
    total: number;
  }[];

  // Payment methods
  paymentMethods: {
    method: string;
    label: string;
    count: number;
    total: number;
  }[];

  // Products sold
  productsSold: {
    productId: string;
    productName: string;
    quantity: number;
    unitName: string;
    total: number;
  }[];

  // Raw materials / ingredients consumed
  ingredientsConsumed: {
    materialId: string;
    materialName: string;
    quantity: number;
    unit: string;
    estimatedCost: number;
  }[];
}

export async function fetchShiftClosingDetails(shiftId: string, branchId?: string): Promise<ShiftClosingSummary> {
  // 1. Fetch shift
  const { data: shift, error: shiftErr } = await supabase
    .from('shifts')
    .select('*')
    .eq('id', shiftId)
    .single();

  if (shiftErr || !shift) {
    throw new Error(shiftErr?.message || 'Shift not found');
  }

  const effectiveBranchId = shift.branch_id || branchId || '';

  // 2. Fetch Branch & Cashier Info
  const [branchRes, cashierRes] = await Promise.all([
    effectiveBranchId ? supabase.from('branches').select('name, name_en').eq('id', effectiveBranchId).maybeSingle() : Promise.resolve({ data: null }),
    shift.cashier_id ? supabase.from('users').select('full_name, email').eq('id', shift.cashier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const branchName = branchRes.data?.name || branchRes.data?.name_en || 'الفرع الرئيسي';
  const cashierName = cashierRes.data?.full_name || cashierRes.data?.email || 'كاشير';

  // 3. Fetch all sales for this shift
  const { data: sales } = await supabase
    .from('sales')
    .select('*, sale_items(*, product:products(*))')
    .eq('shift_id', shiftId);

  const salesList = (sales || []) as Array<{
    id: string;
    invoice_number: string;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total: number;
    payment_method: string;
    order_type: string;
    sale_items?: Array<{
      product_id: string;
      unit_name?: string;
      quantity: number;
      unit_price: number;
      total: number;
      product?: { name?: string; name_en?: string };
    }>;
  }>;

  // Compute sales stats
  let grossSales = 0;
  let totalDiscounts = 0;
  let totalTaxes = 0;
  let netSales = 0;

  const paymentMap = new Map<string, { count: number; total: number }>();
  const orderTypeMap = new Map<string, { count: number; total: number }>();
  const productMap = new Map<string, { name: string; quantity: number; unitName: string; total: number }>();

  for (const s of salesList) {
    grossSales += Number(s.subtotal || s.total || 0);
    totalDiscounts += Number(s.discount_amount || 0);
    totalTaxes += Number(s.tax_amount || 0);
    netSales += Number(s.total || 0);

    // Payment methods
    const pMethod = s.payment_method || 'cash';
    const currPay = paymentMap.get(pMethod) || { count: 0, total: 0 };
    currPay.count += 1;
    currPay.total += Number(s.total || 0);
    paymentMap.set(pMethod, currPay);

    // Order types
    const oType = s.order_type || 'takeaway';
    const currOT = orderTypeMap.get(oType) || { count: 0, total: 0 };
    currOT.count += 1;
    currOT.total += Number(s.total || 0);
    orderTypeMap.set(oType, currOT);

    // Sale items
    if (s.sale_items && Array.isArray(s.sale_items)) {
      for (const it of s.sale_items) {
        const pId = it.product_id || 'unknown';
        const pName = it.product?.name || it.product?.name_en || 'منتج';
        const currP = productMap.get(pId) || { name: pName, quantity: 0, unitName: it.unit_name || 'قطعة', total: 0 };
        currP.quantity += Number(it.quantity || 0);
        currP.total += Number(it.total || (it.quantity * it.unit_price) || 0);
        productMap.set(pId, currP);
      }
    }
  }

  // 4. Fetch Recipes and calculate Raw Material / Ingredients Consumption
  const ingredientsMap = new Map<string, { name: string; quantity: number; unit: string; estimatedCost: number }>();

  if (productMap.size > 0 && effectiveBranchId) {
    const productIds = Array.from(productMap.keys()).filter((id) => id !== 'unknown');
    if (productIds.length > 0) {
      const { data: recipes } = await supabase
        .from('recipes')
        .select('product_id, yield_quantity, recipe_items(raw_material_id, quantity, wastage_percent, raw_material:raw_materials(name, unit_id, default_cost, unit:units(name, name_en, symbol)))')
        .in('product_id', productIds)
        .eq('branch_id', effectiveBranchId);

      if (recipes && Array.isArray(recipes)) {
        for (const recipe of recipes) {
          const soldProd = productMap.get(recipe.product_id);
          if (!soldProd) continue;

          const yieldQty = Number(recipe.yield_quantity) || 1;
          const soldCount = soldProd.quantity;
          const multiplier = soldCount / yieldQty;

          if (recipe.recipe_items && Array.isArray(recipe.recipe_items)) {
            for (const rItem of recipe.recipe_items) {
              const raw = rItem.raw_material as { name?: string; default_cost?: number; unit?: { name?: string; symbol?: string } } | null;
              const matId = rItem.raw_material_id;
              const matName = raw?.name || 'مادة خام';
              const unitStr = raw?.unit?.symbol || raw?.unit?.name || 'جرام/كجم';
              const unitCost = Number(raw?.default_cost) || 0;

              const baseQty = Number(rItem.quantity) * multiplier;
              const wastagePct = Number(rItem.wastage_percent) || 0;
              const totalConsumed = baseQty * (1 + wastagePct / 100);
              const cost = totalConsumed * unitCost;

              const currMat = ingredientsMap.get(matId) || { name: matName, quantity: 0, unit: unitStr, estimatedCost: 0 };
              currMat.quantity += totalConsumed;
              currMat.estimatedCost += cost;
              ingredientsMap.set(matId, currMat);
            }
          }
        }
      }
    }
  }

  // Payment method labels map
  const methodLabelMap: Record<string, string> = {
    cash: 'نقدي (Cash)',
    card: 'بطاقة مدى / ائتمان (Card)',
    credit: 'آجل / ذمم (Credit)',
    instapay: 'إنستاباي / محفظة (InstaPay)',
    bank_transfer: 'تحويل بنكي (Bank Transfer)',
  };

  const orderTypeLabelMap: Record<string, string> = {
    dine_in: 'صالة (Dine-in)',
    takeaway: 'سفري / تيك أواي (Takeaway)',
    delivery: 'توصيل (Delivery)',
    drive_thru: 'خدمة السيارات (Drive-thru)',
  };

  const totalInvoices = salesList.length;
  const avgTicket = totalInvoices > 0 ? netSales / totalInvoices : 0;

  return {
    shiftId: shift.id,
    branchId: effectiveBranchId,
    branchName,
    cashierName,
    openedAt: shift.opened_at,
    closedAt: shift.closed_at || null,
    openingAmount: Number(shift.opening_amount || 0),
    expectedAmount: Number(shift.expected_amount || shift.opening_amount || 0),
    actualAmount: Number(shift.actual_amount || 0),
    difference: Number(shift.difference || 0),
    notes: shift.notes || null,

    totalInvoices,
    grossSales,
    totalDiscounts,
    totalTaxes,
    netSales,
    avgTicket,

    orderTypes: Array.from(orderTypeMap.entries()).map(([type, data]) => ({
      type,
      label: orderTypeLabelMap[type] || type,
      count: data.count,
      total: data.total,
    })),

    paymentMethods: Array.from(paymentMap.entries()).map(([method, data]) => ({
      method,
      label: methodLabelMap[method] || method,
      count: data.count,
      total: data.total,
    })),

    productsSold: Array.from(productMap.entries()).map(([productId, data]) => ({
      productId,
      productName: data.name,
      quantity: data.quantity,
      unitName: data.unitName,
      total: data.total,
    })),

    ingredientsConsumed: Array.from(ingredientsMap.entries()).map(([materialId, data]) => ({
      materialId,
      materialName: data.name,
      quantity: parseFloat(data.quantity.toFixed(3)),
      unit: data.unit,
      estimatedCost: parseFloat(data.estimatedCost.toFixed(2)),
    })),
  };
}

/**
 * Generates an 80mm / 58mm Thermal Z-Report Receipt HTML
 */
export function buildThermalZReportHtml(summary: ShiftClosingSummary, currency = 'EGP', lang: Language = 'ar'): string {
  const isAr = lang === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';

  const diffColor = Math.abs(summary.difference) > 0.01 ? '#dc2626' : '#16a34a';

  return `<!doctype html>
<html dir="${dir}" lang="${isAr ? 'ar' : 'en'}">
<head>
<meta charset="utf-8">
<title>${isAr ? 'تقرير إغلاق الوردية Z-Report' : 'Shift Z-Report'}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", sans-serif;
    font-size: 11px;
    line-height: 1.35;
    color: #000;
    background: #fff;
    padding: 6px;
    width: 80mm;
    margin: 0 auto;
  }
  .text-center { text-align: center; }
  .text-end { text-align: ${isAr ? 'left' : 'right'}; }
  .font-bold { font-weight: bold; }
  .font-black { font-weight: 900; }
  .border-b { border-bottom: 1px dashed #000; }
  .border-t { border-top: 1px dashed #000; }
  .border-double { border-bottom: 3px double #000; }
  .my-1 { margin-top: 4px; margin-bottom: 4px; }
  .my-2 { margin-top: 8px; margin-bottom: 8px; }
  .py-1 { padding-top: 3px; padding-bottom: 3px; }
  .py-2 { padding-top: 6px; padding-bottom: 6px; }
  .flex { display: flex; }
  .justify-between { justify-content: space-between; }
  .section-title {
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 6px;
    margin-bottom: 3px;
    padding-bottom: 2px;
    border-bottom: 1px solid #000;
  }
  table { width: 100%; border-collapse: collapse; margin-top: 2px; }
  th, td { font-size: 10px; padding: 2px 0; }
  th { border-bottom: 1px solid #000; }
  @media print {
    body { width: 100%; margin: 0; padding: 2px; }
    @page { margin: 0; }
  }
</style>
</head>
<body onload="window.print();">
  <div class="text-center">
    <h2 class="font-black" style="font-size: 14px;">${escapeHtml(summary.branchName)}</h2>
    <p class="font-bold my-1" style="font-size: 12px; letter-spacing: 1px;">*** ${isAr ? 'تقرير إغلاق الوردية Z-REPORT' : 'SHIFT Z-REPORT'} ***</p>
    <p style="font-size: 9px;">#${summary.shiftId.slice(0, 8).toUpperCase()}</p>
  </div>

  <div class="border-b my-1"></div>

  <div class="flex justify-between py-1">
    <span>${isAr ? 'الكاشير:' : 'Cashier:'}</span>
    <span class="font-bold">${escapeHtml(summary.cashierName)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${isAr ? 'تاريخ الفتح:' : 'Opened:'}</span>
    <span>${formatDateTime(summary.openedAt, lang)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${isAr ? 'تاريخ الإغلاق:' : 'Closed:'}</span>
    <span>${summary.closedAt ? formatDateTime(summary.closedAt, lang) : (isAr ? 'مستمر' : 'Active')}</span>
  </div>

  <div class="border-t my-1"></div>

  <!-- Sales Summary -->
  <div class="section-title">${isAr ? 'ملخص المبيعات' : 'SALES SUMMARY'}</div>
  <div class="flex justify-between py-1">
    <span>${isAr ? 'عدد الفواتير:' : 'Invoices Count:'}</span>
    <span class="font-bold">${summary.totalInvoices}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${isAr ? 'إجمالي المبيعات:' : 'Gross Sales:'}</span>
    <span>${formatCurrency(summary.grossSales, currency, lang)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${isAr ? 'إجمالي الخصومات:' : 'Discounts:'}</span>
    <span>-${formatCurrency(summary.totalDiscounts, currency, lang)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${isAr ? 'إجمالي الضرائب:' : 'Taxes:'}</span>
    <span>+${formatCurrency(summary.totalTaxes, currency, lang)}</span>
  </div>
  <div class="flex justify-between py-1 font-black border-t border-b" style="font-size: 12px;">
    <span>${isAr ? 'صافي المبيعات:' : 'Net Sales:'}</span>
    <span>${formatCurrency(summary.netSales, currency, lang)}</span>
  </div>

  <!-- Payment Methods Breakdown -->
  <div class="section-title">${isAr ? 'طرق الدفع' : 'PAYMENT METHODS'}</div>
  ${summary.paymentMethods.map((pm) => `
    <div class="flex justify-between py-1">
      <span>${escapeHtml(pm.label)} (${pm.count}):</span>
      <span class="font-bold">${formatCurrency(pm.total, currency, lang)}</span>
    </div>
  `).join('')}

  <!-- Cash Drawer Balancing -->
  <div class="section-title">${isAr ? 'تسوية الدرج والنقدية' : 'CASH RECONCILIATION'}</div>
  <div class="flex justify-between py-1">
    <span>${isAr ? 'رصيد الافتتاح:' : 'Opening Cash:'}</span>
    <span>${formatCurrency(summary.openingAmount, currency, lang)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${isAr ? 'المتوقع بالدرج:' : 'Expected Cash:'}</span>
    <span class="font-bold">${formatCurrency(summary.expectedAmount, currency, lang)}</span>
  </div>
  <div class="flex justify-between py-1">
    <span>${isAr ? 'الفعلي بالدرج:' : 'Actual Counted:'}</span>
    <span class="font-bold">${formatCurrency(summary.actualAmount, currency, lang)}</span>
  </div>
  <div class="flex justify-between py-1 font-black" style="color: ${diffColor};">
    <span>${isAr ? 'الفارق (عجز / زيادة):' : 'Difference:'}</span>
    <span>${formatCurrency(summary.difference, currency, lang)}</span>
  </div>

  <!-- Products Sold -->
  ${summary.productsSold.length > 0 ? `
    <div class="section-title">${isAr ? 'المنتجات المباعة' : 'PRODUCTS SOLD'}</div>
    <table>
      <thead>
        <tr>
          <th style="text-align: ${isAr ? 'right' : 'left'};">${isAr ? 'الصنف' : 'Item'}</th>
          <th class="text-center">${isAr ? 'الكمية' : 'Qty'}</th>
          <th class="text-end">${isAr ? 'الإجمالي' : 'Total'}</th>
        </tr>
      </thead>
      <tbody>
        ${summary.productsSold.map((p) => `
          <tr>
            <td>${escapeHtml(p.productName)}</td>
            <td class="text-center font-bold">${p.quantity}</td>
            <td class="text-end font-bold">${formatCurrency(p.total, currency, lang)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}

  <!-- Ingredients Consumed -->
  ${summary.ingredientsConsumed.length > 0 ? `
    <div class="section-title">${isAr ? 'المكونات والمواد الخام المستهلكة' : 'INGREDIENTS CONSUMED'}</div>
    <table>
      <thead>
        <tr>
          <th style="text-align: ${isAr ? 'right' : 'left'};">${isAr ? 'المادة' : 'Material'}</th>
          <th class="text-center">${isAr ? 'الكمية' : 'Qty'}</th>
          <th class="text-end">${isAr ? 'التكلفة المقدرة' : 'Est. Cost'}</th>
        </tr>
      </thead>
      <tbody>
        ${summary.ingredientsConsumed.map((m) => `
          <tr>
            <td>${escapeHtml(m.materialName)}</td>
            <td class="text-center font-bold">${m.quantity} ${escapeHtml(m.unit)}</td>
            <td class="text-end">${formatCurrency(m.estimatedCost, currency, lang)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}

  <div class="border-double my-2"></div>
  <div class="text-center" style="font-size: 9px;">
    <p>${isAr ? 'تم استخراج التقرير بواسطة النظام' : 'Generated by ERP System'}</p>
    <p>${new Date().toLocaleString(isAr ? 'ar-EG' : 'en-US')}</p>
  </div>
</body>
</html>`;
}

/**
 * Generates an A4 Full Report HTML for Accounting & Management
 */
export function buildA4ZReportHtml(summary: ShiftClosingSummary, currency = 'EGP', lang: Language = 'ar'): string {
  const isAr = lang === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const diffColor = Math.abs(summary.difference) > 0.01 ? '#dc2626' : '#16a34a';

  return `<!doctype html>
<html dir="${dir}" lang="${isAr ? 'ar' : 'en'}">
<head>
<meta charset="utf-8">
<title>${isAr ? 'تقرير إغلاق الوردية واليوم' : 'Day & Shift Closing Report'}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", sans-serif;
    color: #1e293b;
    background: #f8fafc;
    padding: 24px;
    font-size: 13px;
    line-height: 1.5;
  }
  .container {
    max-width: 900px;
    margin: 0 auto;
    background: #fff;
    padding: 32px;
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 20px;
    margin-bottom: 24px;
  }
  .header h1 { font-size: 22px; font-weight: 900; color: #0f172a; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px;
  }
  .card .label { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; }
  .card .val { font-size: 16px; font-weight: 900; color: #0f172a; }
  .section-heading {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    margin: 20px 0 10px 0;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 6px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  th {
    background: #f1f5f9;
    text-align: ${isAr ? 'right' : 'left'};
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 800;
    color: #475569;
    border: 1px solid #e2e8f0;
  }
  td {
    padding: 8px 12px;
    font-size: 12px;
    border: 1px solid #e2e8f0;
  }
  .text-end { text-align: ${isAr ? 'left' : 'right'}; }
  .text-center { text-align: center; }
  @media print {
    body { background: #fff; padding: 0; }
    .container { box-shadow: none; padding: 0; width: 100%; max-width: 100%; }
  }
</style>
</head>
<body onload="window.print();">
  <div class="container">
    <div class="header">
      <div>
        <h1>${escapeHtml(summary.branchName)}</h1>
        <p style="font-weight: 700; color: #64748b; margin-top: 4px;">
          ${isAr ? 'تقرير إغلاق الوردية واليوم الشامل' : 'Comprehensive Day & Shift Closing Report'} (Z-Report)
        </p>
      </div>
      <div style="text-align: ${isAr ? 'left' : 'right'}; font-size: 12px;">
        <p><strong>${isAr ? 'رقم الوردية:' : 'Shift ID:'}</strong> #${summary.shiftId.slice(0, 8).toUpperCase()}</p>
        <p><strong>${isAr ? 'الكاشير:' : 'Cashier:'}</strong> ${escapeHtml(summary.cashierName)}</p>
        <p><strong>${isAr ? 'تاريخ الفتح:' : 'Opened:'}</strong> ${formatDateTime(summary.openedAt, lang)}</p>
        <p><strong>${isAr ? 'تاريخ الإغلاق:' : 'Closed:'}</strong> ${summary.closedAt ? formatDateTime(summary.closedAt, lang) : '-'}</p>
      </div>
    </div>

    <!-- Top KPI Cards -->
    <div class="grid-4">
      <div class="card">
        <div class="label">${isAr ? 'صافي المبيعات' : 'Net Sales'}</div>
        <div class="val" style="color: #2563eb;">${formatCurrency(summary.netSales, currency, lang)}</div>
      </div>
      <div class="card">
        <div class="label">${isAr ? 'عدد الفواتير' : 'Invoices Count'}</div>
        <div class="val">${summary.totalInvoices}</div>
      </div>
      <div class="card">
        <div class="label">${isAr ? 'متوسط الفاتورة' : 'Avg Ticket'}</div>
        <div class="val">${formatCurrency(summary.avgTicket, currency, lang)}</div>
      </div>
      <div class="card">
        <div class="label">${isAr ? 'فارق الصندوق' : 'Drawer Difference'}</div>
        <div class="val" style="color: ${diffColor};">${formatCurrency(summary.difference, currency, lang)}</div>
      </div>
    </div>

    <!-- Sales & Drawer Reconciliation Tables Grid -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
      <div>
        <h3 class="section-heading">${isAr ? 'ملخص الإيرادات والضرائب' : 'Revenue & Tax Summary'}</h3>
        <table>
          <tbody>
            <tr><td>${isAr ? 'إجمالي المبيعات (Gross):' : 'Gross Sales:'}</td><td class="text-end font-bold">${formatCurrency(summary.grossSales, currency, lang)}</td></tr>
            <tr><td>${isAr ? 'إجمالي الخصومات:' : 'Total Discounts:'}</td><td class="text-end font-bold" style="color: #dc2626;">-${formatCurrency(summary.totalDiscounts, currency, lang)}</td></tr>
            <tr><td>${isAr ? 'إجمالي الضرائب:' : 'Total Taxes:'}</td><td class="text-end font-bold">+${formatCurrency(summary.totalTaxes, currency, lang)}</td></tr>
            <tr style="background: #f1f5f9; font-weight: 900;"><td>${isAr ? 'صافي الإيراد (Net):' : 'Net Revenue:'}</td><td class="text-end font-bold">${formatCurrency(summary.netSales, currency, lang)}</td></tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3 class="section-heading">${isAr ? 'تسوية عهدة النقدية' : 'Cash Reconciliation'}</h3>
        <table>
          <tbody>
            <tr><td>${isAr ? 'رصيد الافتتاح:' : 'Opening Cash:'}</td><td class="text-end">${formatCurrency(summary.openingAmount, currency, lang)}</td></tr>
            <tr><td>${isAr ? 'المتوقع بالدرج:' : 'Expected Cash:'}</td><td class="text-end font-bold">${formatCurrency(summary.expectedAmount, currency, lang)}</td></tr>
            <tr><td>${isAr ? 'الفعلي بالدرج (العد):' : 'Actual Counted:'}</td><td class="text-end font-bold">${formatCurrency(summary.actualAmount, currency, lang)}</td></tr>
            <tr style="background: #f8fafc; font-weight: 900; color: ${diffColor};"><td>${isAr ? 'الفارق (عجز / زيادة):' : 'Difference:'}</td><td class="text-end">${formatCurrency(summary.difference, currency, lang)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Payment Methods -->
    <h3 class="section-heading">${isAr ? 'تفصيل طرق الدفع المحصلة' : 'Payment Methods Breakdown'}</h3>
    <table>
      <thead>
        <tr>
          <th>${isAr ? 'طريقة الدفع' : 'Payment Method'}</th>
          <th class="text-center">${isAr ? 'عدد العمليات' : 'Transactions'}</th>
          <th class="text-end">${isAr ? 'إجمالي المبلغ' : 'Total Amount'}</th>
        </tr>
      </thead>
      <tbody>
        ${summary.paymentMethods.map((pm) => `
          <tr>
            <td style="font-weight: 700;">${escapeHtml(pm.label)}</td>
            <td class="text-center">${pm.count}</td>
            <td class="text-end font-bold">${formatCurrency(pm.total, currency, lang)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- Products Sold -->
    <h3 class="section-heading">${isAr ? 'المنتجات والأصناف المباعة' : 'Products Sold Summary'}</h3>
    <table>
      <thead>
        <tr>
          <th>${isAr ? 'اسم المنتج' : 'Product Name'}</th>
          <th class="text-center">${isAr ? 'الكمية المباعة' : 'Qty Sold'}</th>
          <th class="text-end">${isAr ? 'إجمالي المبيعات' : 'Total Sales'}</th>
        </tr>
      </thead>
      <tbody>
        ${summary.productsSold.map((p) => `
          <tr>
            <td>${escapeHtml(p.productName)}</td>
            <td class="text-center font-bold">${p.quantity} ${escapeHtml(p.unitName)}</td>
            <td class="text-end font-bold">${formatCurrency(p.total, currency, lang)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- Ingredients Consumed -->
    ${summary.ingredientsConsumed.length > 0 ? `
      <h3 class="section-heading">${isAr ? 'المكونات والمواد الخام المستهلكة (الخصم التلقائي للوصفات)' : 'Raw Materials & Ingredients Consumed (Recipe Deductions)'}</h3>
      <table>
        <thead>
          <tr>
            <th>${isAr ? 'المادة الخام / المكون' : 'Raw Material'}</th>
            <th class="text-center">${isAr ? 'الكمية المستهلكة' : 'Consumed Qty'}</th>
            <th class="text-end">${isAr ? 'التكلفة التقديرية' : 'Estimated Cost'}</th>
          </tr>
        </thead>
        <tbody>
          ${summary.ingredientsConsumed.map((m) => `
            <tr>
              <td>${escapeHtml(m.materialName)}</td>
              <td class="text-center font-bold">${m.quantity} ${escapeHtml(m.unit)}</td>
              <td class="text-end font-bold">${formatCurrency(m.estimatedCost, currency, lang)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : ''}

    ${summary.notes ? `
      <div style="margin-top: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
        <strong style="color: #475569;">${isAr ? 'ملاحظات الإغلاق:' : 'Closing Notes:'}</strong>
        <p style="margin-top: 4px;">${escapeHtml(summary.notes)}</p>
      </div>
    ` : ''}

    <div style="margin-top: 40px; display: flex; justify-content: space-between; padding-top: 20px; border-top: 1px dashed #cbd5e1; font-size: 12px; color: #64748b;">
      <div>${isAr ? 'توقيع الكاشير: _______________________' : 'Cashier Signature: _______________________'}</div>
      <div>${isAr ? 'توقيع مدير الفرع / المحاسب: _______________________' : 'Manager Signature: _______________________'}</div>
    </div>
  </div>
</body>
</html>`;
}
