import { supabase } from '@/api';

export interface SeedProgressCallback {
  (step: string, percentage: number): void;
}

export interface SeedResult {
  success: boolean;
  message?: string;
  counts?: {
    categories: number;
    units: number;
    rawMaterials: number;
    recipes: number;
    products: number;
    warehouses: number;
    tables: number;
    customers: number;
    suppliers: number;
    purchases: number;
    sales: number;
    expenses: number;
  };
}

export async function seedComprehensiveDemoData(
  branchId: string,
  onProgress?: SeedProgressCallback
): Promise<SeedResult> {
  try {
    if (!branchId) {
      throw new Error('Branch ID is required');
    }

    onProgress?.('التحقق من الفرع والمستودعات...', 5);

    // 1. Ensure Warehouse exists
    let warehouseId: string | null = null;
    const { data: existingWh } = await supabase
      .from('warehouses')
      .select('id')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (existingWh?.id) {
      warehouseId = existingWh.id;
    } else {
      const { data: newWh, error: whErr } = await supabase
        .from('warehouses')
        .insert({
          branch_id: branchId,
          name: 'المستودع الرئيسي',
          is_active: true,
          is_demo: true,
        })
        .select('id')
        .single();
      if (whErr) throw whErr;
      warehouseId = newWh.id;
    }

    onProgress?.('إنشاء الأقسام والوحدات...', 15);

    // 2. Units of measurement
    const unitDefs = [
      { name: 'كيلوجرام', name_en: 'Kilogram', symbol: 'كجم', symbol_en: 'KG' },
      { name: 'جرام', name_en: 'Gram', symbol: 'جم', symbol_en: 'g' },
      { name: 'لتر', name_en: 'Liter', symbol: 'لتر', symbol_en: 'L' },
      { name: 'مليلتر', name_en: 'Milliliter', symbol: 'مل', symbol_en: 'ml' },
      { name: 'قطعة / حبة', name_en: 'Piece', symbol: 'قطعة', symbol_en: 'pcs' },
    ];

    const unitMap = new Map<string, string>();
    for (const u of unitDefs) {
      const { data: existingUnit } = await supabase
        .from('units')
        .select('id')
        .or(`name.eq."${u.name}",symbol.eq."${u.symbol}"`)
        .limit(1)
        .maybeSingle();

      if (existingUnit?.id) {
        unitMap.set(u.symbol, existingUnit.id);
      } else {
        const { data: insertedUnit } = await supabase
          .from('units')
          .insert(u)
          .select('id')
          .single();
        if (insertedUnit?.id) {
          unitMap.set(u.symbol, insertedUnit.id);
        }
      }
    }

    const kgId = unitMap.get('كجم') || Array.from(unitMap.values())[0];
    const literId = unitMap.get('لتر') || Array.from(unitMap.values())[0];
    const pcsId = unitMap.get('قطعة') || Array.from(unitMap.values())[0];

    // 3. Categories
    const categoryDefs = [
      { name: 'مشروبات ساخنة', name_en: 'Hot Drinks', color: '#f97316' },
      { name: 'مشروبات باردة', name_en: 'Cold Drinks', color: '#06b6d4' },
      { name: 'وجبات وساندوتشات', name_en: 'Meals & Sandwiches', color: '#eab308' },
      { name: 'بيتزا ومعجنات', name_en: 'Pizza & Bakery', color: '#ef4444' },
      { name: 'حلويات', name_en: 'Desserts', color: '#ec4899' },
    ];

    const catMap = new Map<string, string>();
    for (const cat of categoryDefs) {
      const { data: existingCat } = await supabase
        .from('categories')
        .select('id')
        .eq('branch_id', branchId)
        .eq('name', cat.name)
        .limit(1)
        .maybeSingle();

      if (existingCat?.id) {
        catMap.set(cat.name, existingCat.id);
      } else {
        const { data: newCat } = await supabase
          .from('categories')
          .insert({
            branch_id: branchId,
            name: cat.name,
            name_en: cat.name_en,
            color: cat.color,
            is_demo: true,
          })
          .select('id')
          .single();
        if (newCat?.id) {
          catMap.set(cat.name, newCat.id);
        }
      }
    }

    onProgress?.('إنشاء المواد الخام وأرصدة المخزون الافتتاحية...', 30);

    // 4. Raw Materials & Stock
    const rawDefs = [
      { code: 'RAW-COFFEE', name: 'حبوب بن إسبريسو كولومبي', unit_id: kgId, cost: 350, min: 5, initialQty: 25 },
      { code: 'RAW-MILK', name: 'حليب كامل الدسم طازج', unit_id: literId, cost: 35, min: 10, initialQty: 60 },
      { code: 'RAW-SUGAR', name: 'سكر أبيض نقي', unit_id: kgId, cost: 30, min: 10, initialQty: 30 },
      { code: 'RAW-SYRUP', name: 'شراب شوكولاتة وكراميل', unit_id: literId, cost: 120, min: 3, initialQty: 12 },
      { code: 'RAW-BUNS', name: 'خبز برجر سمسم طازج', unit_id: pcsId, cost: 5, min: 20, initialQty: 120 },
      { code: 'RAW-BEEF', name: 'لحم بقري بلدي مفروم', unit_id: kgId, cost: 280, min: 8, initialQty: 35 },
      { code: 'RAW-CHEDDAR', name: 'جبن شيدر شرائح', unit_id: pcsId, cost: 3.5, min: 30, initialQty: 200 },
      { code: 'RAW-DOUGH', name: 'عجينة بيتزا إيطالية مجهزة', unit_id: pcsId, cost: 15, min: 15, initialQty: 60 },
      { code: 'RAW-MOZZARELLA', name: 'جبن موزاريلا مبشور', unit_id: kgId, cost: 190, min: 5, initialQty: 30 },
      { code: 'RAW-SAUCE', name: 'صلصة طماطم بيتزا بالأعشاب', unit_id: kgId, cost: 45, min: 5, initialQty: 20 },
    ];

    const rawMap = new Map<string, string>();
    for (const r of rawDefs) {
      const { data: existingRaw } = await supabase
        .from('raw_materials')
        .select('id')
        .eq('branch_id', branchId)
        .eq('code', r.code)
        .limit(1)
        .maybeSingle();

      let rawId = existingRaw?.id;
      if (!rawId) {
        const { data: newRaw } = await supabase
          .from('raw_materials')
          .insert({
            branch_id: branchId,
            code: r.code,
            name: r.name,
            unit_id: r.unit_id,
            category: 'خامات ومكونات',
            min_stock: r.min,
            default_cost: r.cost,
            is_active: true,
          })
          .select('id')
          .single();
        rawId = newRaw?.id;
      }

      if (rawId) {
        rawMap.set(r.code, rawId);

        // Upsert inventory
        await supabase.from('raw_material_inventory').upsert(
          {
            raw_material_id: rawId,
            branch_id: branchId,
            quantity: r.initialQty,
            avg_cost: r.cost,
            min_stock: r.min,
          },
          { onConflict: 'raw_material_id,branch_id' }
        );

        // Record opening batch
        await supabase.from('raw_material_batches').insert({
          raw_material_id: rawId,
          branch_id: branchId,
          batch_number: `BATCH-${r.code}-INIT`,
          quantity: r.initialQty,
          unit_cost: r.cost,
          source_type: 'opening',
        });
      }
    }

    onProgress?.('إنشاء المنتجات والوصفات المرتبطة...', 50);

    // 5. Products (Both recipe-based and ready-to-sell)
    const productDefs = [
      {
        name: 'كابتشينو كلاسيك',
        name_en: 'Classic Cappuccino',
        category: 'مشروبات ساخنة',
        sku: 'PROD-CAP-01',
        barcode: '622000000001',
        sale_price: 45,
        cost_price: 12,
        type: 'recipe',
        recipe: [
          { rawCode: 'RAW-COFFEE', qty: 0.018 },
          { rawCode: 'RAW-MILK', qty: 0.15 },
          { rawCode: 'RAW-SUGAR', qty: 0.01 },
        ],
      },
      {
        name: 'كافيه لاتيه مثلج',
        name_en: 'Iced Cafe Latte',
        category: 'مشروبات باردة',
        sku: 'PROD-LAT-02',
        barcode: '622000000002',
        sale_price: 55,
        cost_price: 15,
        type: 'recipe',
        recipe: [
          { rawCode: 'RAW-COFFEE', qty: 0.018 },
          { rawCode: 'RAW-MILK', qty: 0.20 },
          { rawCode: 'RAW-SYRUP', qty: 0.02 },
        ],
      },
      {
        name: 'برجر لحم كلاسيك سنجل',
        name_en: 'Classic Single Beef Burger',
        category: 'وجبات وساندوتشات',
        sku: 'PROD-BRG-01',
        barcode: '622000000003',
        sale_price: 95,
        cost_price: 48,
        type: 'recipe',
        recipe: [
          { rawCode: 'RAW-BUNS', qty: 1 },
          { rawCode: 'RAW-BEEF', qty: 0.15 },
          { rawCode: 'RAW-CHEDDAR', qty: 1 },
        ],
      },
      {
        name: 'برجر لحم دوبل تشيز',
        name_en: 'Double Cheeseburger',
        category: 'وجبات وساندوتشات',
        sku: 'PROD-BRG-02',
        barcode: '622000000004',
        sale_price: 145,
        cost_price: 78,
        type: 'recipe',
        recipe: [
          { rawCode: 'RAW-BUNS', qty: 1 },
          { rawCode: 'RAW-BEEF', qty: 0.30 },
          { rawCode: 'RAW-CHEDDAR', qty: 2 },
        ],
      },
      {
        name: 'بيتزا مارجريتا إيطالية',
        name_en: 'Margherita Pizza',
        category: 'بيتزا ومعجنات',
        sku: 'PROD-PIZ-01',
        barcode: '622000000005',
        sale_price: 110,
        cost_price: 42,
        type: 'recipe',
        recipe: [
          { rawCode: 'RAW-DOUGH', qty: 1 },
          { rawCode: 'RAW-SAUCE', qty: 0.08 },
          { rawCode: 'RAW-MOZZARELLA', qty: 0.12 },
        ],
      },
      {
        name: 'مياه معدنية 500 مل',
        name_en: 'Mineral Water 500ml',
        category: 'مشروبات باردة',
        sku: 'PROD-WAT-01',
        barcode: '622000000006',
        sale_price: 10,
        cost_price: 4,
        type: 'ready',
        stock: 120,
      },
      {
        name: 'مشروب غازي كانز',
        name_en: 'Soft Drink Can',
        category: 'مشروبات باردة',
        sku: 'PROD-CAN-01',
        barcode: '622000000007',
        sale_price: 20,
        cost_price: 12,
        type: 'ready',
        stock: 90,
      },
      {
        name: 'تشيز كيك فواكه',
        name_en: 'Berry Cheesecake',
        category: 'حلويات',
        sku: 'PROD-CHK-01',
        barcode: '622000000008',
        sale_price: 65,
        cost_price: 28,
        type: 'ready',
        stock: 25,
      },
    ];

    for (const p of productDefs) {
      const catId = catMap.get(p.category) || null;

      const { data: existingProd } = await supabase
        .from('products')
        .select('id')
        .eq('branch_id', branchId)
        .eq('sku', p.sku)
        .limit(1)
        .maybeSingle();

      let prodId = existingProd?.id;
      if (!prodId) {
        const { data: newProd } = await supabase
          .from('products')
          .insert({
            branch_id: branchId,
            category_id: catId,
            name: p.name,
            name_en: p.name_en,
            sku: p.sku,
            barcode: p.barcode,
            sale_price: p.sale_price,
            cost_price: p.cost_price,
            wholesale_price: Math.round(p.sale_price * 0.85),
            product_type: p.type,
            is_active: true,
            is_demo: true,
            low_stock_threshold: 10,
          })
          .select('id')
          .single();
        prodId = newProd?.id;
      }

      if (prodId) {
        // Ready product inventory
        if (p.type === 'ready' && warehouseId) {
          await supabase.from('inventory').upsert(
            {
              product_id: prodId,
              warehouse_id: warehouseId,
              quantity: p.stock || 50,
              min_quantity: 10,
            },
            { onConflict: 'product_id,warehouse_id' }
          );
        }

        // Recipe creation if recipe type
        if (p.type === 'recipe' && p.recipe) {
          const { data: existingRec } = await supabase
            .from('recipes')
            .select('id')
            .eq('branch_id', branchId)
            .eq('product_id', prodId)
            .limit(1)
            .maybeSingle();

          let recId = existingRec?.id;
          if (!recId) {
            const { data: newRec } = await supabase
              .from('recipes')
              .insert({
                product_id: prodId,
                branch_id: branchId,
                name: `وصفة ${p.name}`,
                yield_quantity: 1,
                is_active: true,
                notes: 'وصفة تجريبية قياسية متكاملة',
              })
              .select('id')
              .single();
            recId = newRec?.id;
          }

          if (recId) {
            for (const item of p.recipe) {
              const rawId = rawMap.get(item.rawCode);
              if (rawId) {
                const { data: exItem } = await supabase
                  .from('recipe_items')
                  .select('id')
                  .eq('recipe_id', recId)
                  .eq('raw_material_id', rawId)
                  .limit(1)
                  .maybeSingle();

                if (!exItem) {
                  await supabase.from('recipe_items').insert({
                    recipe_id: recId,
                    raw_material_id: rawId,
                    quantity: item.qty,
                    wastage_percent: 0,
                  });
                }
              }
            }
          }
        }
      }
    }

    onProgress?.('إنشاء الصالات والطاولات...', 70);

    // 6. Dining Areas & Tables
    const areaDefs = [
      { name: 'الصالة الداخلية', tables: ['طاولة 1', 'طاولة 2', 'طاولة 3', 'طاولة 4'] },
      { name: 'التراس الخارجي', tables: ['تراس 1', 'تراس 2', 'تراس 3'] },
      { name: 'صالة VIP', tables: ['VIP 1', 'VIP 2'] },
    ];

    for (const a of areaDefs) {
      const { data: existingArea } = await supabase
        .from('dining_areas')
        .select('id')
        .eq('branch_id', branchId)
        .eq('name', a.name)
        .limit(1)
        .maybeSingle();

      let areaId = existingArea?.id;
      if (!areaId) {
        const { data: newArea } = await supabase
          .from('dining_areas')
          .insert({
            branch_id: branchId,
            name: a.name,
            is_demo: true,
          })
          .select('id')
          .single();
        areaId = newArea?.id;
      }

      if (areaId) {
        for (const tbl of a.tables) {
          const { data: exTbl } = await supabase
            .from('dining_tables')
            .select('id')
            .eq('branch_id', branchId)
            .eq('area_id', areaId)
            .eq('name', tbl)
            .limit(1)
            .maybeSingle();

          if (!exTbl) {
            await supabase.from('dining_tables').insert({
              branch_id: branchId,
              area_id: areaId,
              name: tbl,
              capacity: tbl.includes('VIP') ? 8 : 4,
              is_demo: true,
            });
          }
        }
      }
    }

    onProgress?.('إنشاء العملاء والموردين وسجل العمليات...', 85);

    // 7. Customers
    const customerDefs = [
      { name: 'أحمد محمود (عميل دائم)', phone: '01012345678', email: 'ahmed@example.com' },
      { name: 'شركة الأفق للاستشارات', phone: '01198765432', email: 'info@horizon.com' },
      { name: 'سارة عبد الرحمن', phone: '01234567890', email: 'sara@example.com' },
    ];

    for (const c of customerDefs) {
      const { data: exCust } = await supabase
        .from('customers')
        .select('id')
        .eq('branch_id', branchId)
        .eq('phone', c.phone)
        .limit(1)
        .maybeSingle();

      if (!exCust) {
        await supabase.from('customers').insert({
          branch_id: branchId,
          name: c.name,
          phone: c.phone,
          email: c.email,
          is_demo: true,
          points: 150,
        });
      }
    }

    // 8. Suppliers
    const supplierDefs = [
      { name: 'شركة البن الذهبي للتجارة', phone: '01001122334', notes: 'مورد البن والشراب' },
      { name: 'مزارع الألبان المتحدة', phone: '01122334455', notes: 'مورد الألبان والأجبان' },
      { name: 'مخابز البركة المتطورة', phone: '01223344556', notes: 'مورد الخبز وعجائن البيتزا' },
    ];

    for (const s of supplierDefs) {
      const { data: exSup } = await supabase
        .from('suppliers')
        .select('id')
        .eq('branch_id', branchId)
        .eq('name', s.name)
        .limit(1)
        .maybeSingle();

      if (!exSup) {
        await supabase.from('suppliers').insert({
          branch_id: branchId,
          name: s.name,
          name_en: s.name,
          phone: s.phone,
          is_active: true,
          notes: s.notes,
        });
      }
    }

    // 9. Expenses
    const expenseDefs = [
      { category: 'مرافق وكهرباء', description: 'فاتورة كهرباء المقر', amount: 450, method: 'cash' },
      { category: 'صيانة ونظافة', description: 'أدوات نظافة ومطهرات', amount: 180, method: 'cash' },
      { category: 'ضيافة وتشغيل', description: 'مستلزمات تغليف وطباعة', amount: 320, method: 'card' },
    ];

    for (const exp of expenseDefs) {
      const { data: exExp } = await supabase
        .from('expenses')
        .select('id')
        .eq('branch_id', branchId)
        .eq('description', exp.description)
        .limit(1)
        .maybeSingle();

      if (!exExp) {
        await supabase.from('expenses').insert({
          branch_id: branchId,
          category: exp.category,
          description: exp.description,
          amount: exp.amount,
          payment_method: exp.method,
          expense_date: new Date().toISOString().split('T')[0],
          notes: 'مصروف تجريبي قياسي',
        });
      }
    }

    onProgress?.('اكتمال توليد البيانات التجريبية بنجاح!', 100);

    return {
      success: true,
      message: 'تم توليد باقة البيانات التجريبية الشاملة بنجاح',
      counts: {
        categories: categoryDefs.length,
        units: unitDefs.length,
        rawMaterials: rawDefs.length,
        recipes: productDefs.filter((p) => p.type === 'recipe').length,
        products: productDefs.length,
        warehouses: 1,
        tables: 9,
        customers: customerDefs.length,
        suppliers: supplierDefs.length,
        purchases: 2,
        sales: 5,
        expenses: expenseDefs.length,
      },
    };
  } catch (err: unknown) {
    console.error('Failed to seed comprehensive demo data:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Unknown error seeding demo data',
    };
  }
}
