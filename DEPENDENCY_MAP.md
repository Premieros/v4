# DEPENDENCY_MAP — خرائط التبعيات في Premier POS/ERP

> اتجاه القراءة: **صفحة/وحدة ← api ← RPC PostgreSQL ← جداول**. لا يوجد استيراد مباشر لـ `@/lib/supabase` خارج `api/` و`context/` و`lib/` (قاعدة ESLint).

---

## 1. شجرة الاعتماد من الأعلى إلى الأسفل

```
main.tsx
 └─ ErrorBoundary (لا يعتمد على أي Provider — خارج الشجرة)
     └─ App.tsx
         └─ app/providers.tsx  (ترتيب تنازلي للاعتمادية)
             ├─ ThemeProvider
             ├─ LanguageProvider
             ├─ AuthProvider
             ├─ SettingsProvider ── يعتمد على Theme, Language, Auth
             ├─ RolesProvider    ── يعتمد على Auth
             ├─ ToastProvider
                 └─ HashRouter → AppRoutes
                 └─ 31 مسار Lazy → pages (كل صفحة داخل Layout أو fullscreen)
                     └─ كل صفحة تعتمد على:
                         ├─ context hooks: useAuth, useLanguage, useSettings, useRoles, useToast
                         ├─ hooks: useBranches, usePaginatedRows, useCan, useBranchFilter
                         ├─ api/* (RPCs) و/أو supabase.from('table')
                         └─ components: DataTable, Button, Input, Modal, Toast, PageHeader, PaginationBar
```

**ترتيب الـ Providers (من `app/providers.tsx`):** `Theme > Language > Auth > Settings > Roles > Toast > Router`. لا تعتمد `Theme`/`Language` على أي Provider آخر. `Settings` يعتمد على الثلاثة الأولى. `Roles` يعتمد على `Auth`.

---

## 2. تبعيات السياقات (context)

| السياق | يعتمد على | المستهلكون الرئيسيون |
|---|---|---|
| `ThemeContext` | — | Settings, Language (قراءة `data.theme`), Layout, pages (أزرار الثيم) |
| `LanguageContext` | — | كل شيء (يوفر `t()` و`dir`) |
| `AuthContext` | Language? لا، لكنه يبني AppUser من `users` | Settings, Roles, routes, Layout, Login |
| `SettingsContext` | Theme, Language, Auth | كل الصفحات (عبر `effectiveSettings`) |
| `RolesContext` | Auth | SettingsPage (مصفوفة الأدوار), useCan عبر permissionDefs |

> `useCan()` في `lib/permissions.ts` يعتمد على `RolesContext` + `AuthContext` (`user.role`). كل حارس مسار وأي بند في `Layout` يستخدمه.

---

## 3. تبعيات البيانات لكل صفحة (Page → API → DB)

**الرمز:** `from(X)` = قراءة مباشرة على جدول X عبر `supabase.from('X')`. `rpc(Y)` = استدعاء دالة Y عبر `api.<ns>`.

### 3.1 أعمدة القائمة (Layout/routes)
لا بيانات. `routes.tsx` + `Layout.tsx` + `useCan()` فقط.

### 3.2 POS والمبيعات
```
PosPage
 ├─ from: products, categories, product_components, inventory, customers, warehouses, branches, settings
 └─ rpc: get_active_shift → api.pos.getActiveShift
        next_document_number → api.pos.nextDocumentNumber
        process_sale → api.pos.processSale  (يكتب sales, sale_items, inventory, inventory_batches,
                                             stock_transactions, inventory_ledger, journal_entries,
                                             journal_entry_lines, shifts, shift_operations, document_sequences)
```
```
FloorPlanPage
 ├─ from: dining_tables, orders, products, branches (is_active), categories
 ├─ realtime: postgres_changes على orders/dining_tables (نطاق فرع)
 └─ rpc: create_order, set_order_status, set_table_status, update_order, detach_order (api.floorplan.*)
```
> إجماليات POS (subtotal/خصم/ضريبة/باقي) تُحسب عبر `src/lib/posMath.ts` (خالص، مُختبَر).

```
SalesPage
 ├─ from: sales, sale_items, customers (settings عبر useSettings)
 └─ rpc: process_refund → api.trade.processRefund
```

### 3.3 الشراء والمصروفات
```
PurchasesPage
 ├─ from: purchases, purchase_items, products, raw_materials, suppliers, warehouses
 │        (settings/branches عبر useSettings + useBranches)
 └─ rpc: process_purchase → api.trade.processPurchase
        next_document_number → api.trade.nextDocumentNumber
```

```
ExpensesPage
 └─ from: expenses (settings/branches عبر hooks)        (لا RPCs)
```

### 3.4 الشيفتات
```
ShiftsPage
 ├─ from: shifts, users (settings/branches عبر hooks)
 └─ rpc: open_shift → api.shifts.open
        close_shift → api.shifts.close
```

### 3.5 المخزون
```
InventoryPage     from: inventory, product_components, warehouses | rpc: adjust_stock
WarehousesPage    from: warehouses (branches عبر useBranches)
TransfersPage     from: warehouse_transfers, products, inventory_batches, warehouses, branches (is_active)
                  | rpc: create_warehouse_transfer, approve_warehouse_transfer, reject_warehouse_transfer
InventoryLedgerPage  from: inventory_ledger, branches (is_active)
```

### 3.6 التصنيع
```
RawMaterialsPage     from: raw_materials, raw_material_inventory, raw_material_batches, units, branches (is_active)
                     | rpc: adjust_raw_stock
RecipesPage          from: recipes, recipe_items, products, raw_materials, branches (is_active)
ProductionOrdersPage from: production_orders, recipes, recipe_items, products, warehouses, branches (is_active)
                     | rpc: create_production_order, start_production_order,
                            complete_production_order (مع هالك), cancel_production_order
```

### 3.7 الكتالوج والأطراف
```
ProductsPage   from: products, categories, product_units, product_components, inventory, warehouses
               | settings/branches عبر hooks | rpc: replace_product_units
CategoriesPage from: categories (branches عبر useBranches)
ComponentsPage from: product_components, products, inventory (settings عبر useSettings)
CustomersPage  from: customers (settings/branches عبر hooks)
SuppliersPage  from: suppliers (settings/branches عبر hooks)
```

### 3.8 المحاسبة (تعتمد بالكامل على RPCs للكتابة والقراءات المالية)
```
AccountsPage        from: chart_of_accounts  | rpc: get_trial_balance, seed_opening_balances
PaymentsPage        from: customer_payments, supplier_payments, sales, purchases
                    | rpc: get_ar_aging, get_ap_aging, receive_payment, pay_supplier
JournalPage         from: chart_of_accounts (اختيار الحسابات)
                    | rpc: get_journals, post_manual_journal
TreasuryPage        from: treasury_accounts, treasury_transactions
                    | rpc: get_treasury_balances, process_transfer,
                           process_treasury_deposit, process_treasury_withdrawal
ReconciliationPage  from: bank_reconciliations, treasury_accounts
                    | rpc: create_bank_reconciliation, get_bank_reconciliation,
                           add_statement_line, match_bank_line, complete_bank_reconciliation
FinancialReportsPage from: chart_of_accounts, customers, suppliers
                    | rpc: كل دوال reporting (get_trial_balance[_summary], get_general_ledger,
                           get_income_statement, get_balance_sheet, get_ar_aging, get_ap_aging,
                           get_aging_summary, get_cash_flow, get_party_statement)
```

### 3.9 التقارير والإدارة
```
ReportsPage   from: sales, sale_items, purchases, expenses, inventory, product_components,
                    products, stock_transactions (settings/branches عبر hooks)     (لا RPCs)
AuditLogPage  from: audit_log (مرقّم عبر usePaginatedRows)
BranchesPage  from: branches
UsersPage     from: users (branches عبر useBranches) | rpc: create_user, update_user_password, delete_user, get_login_email
SettingsPage  from: settings, branch_settings, branches  | يعتمد على RolesContext (مصفوفة الأدوار)
LoginPage     يعتمد على: supabase.auth.* | rpc: get_login_email
DashboardPage from: sales, sale_items, products, purchases, expenses, customers, inventory
                    (settings/branches عبر hooks)                    (لا RPCs)
```
> **قاعدة الترقيم (PHASE 6):** أي قائمة صفوف تُعرض في صفحة تمر عبر `usePaginatedRows` (range + count موحّد) — لا `limit()`/`range()` يدوية. فقط استعلامات التقارير المقيدة بالتاريخ والـ lookups البسيطة تبقى بدون ترقيم.

---

## 4. تبعيات قاعدة البيانات (Schema → RPC → جداول الكتابة)

**دوال المعاملات (SECURITY DEFINER) تكتب عبر جداول متعددة:**

| RPC | يكتب/يقرأ |
|---|---|
| `process_sale` | sales, sale_items, inventory, inventory_batches, stock_transactions, inventory_ledger, journal_entries, journal_entry_lines, customer_payments, shifts, shift_operations, document_sequences |
| `process_purchase` | purchases, purchase_items, inventory, inventory_batches, stock_transactions, inventory_ledger, journal_entries, journal_entry_lines, supplier_payments, document_sequences |
| `process_refund` | sale_items (كميات), inventory, inventory_batches, stock_transactions, inventory_ledger, journal_entries, journal_entry_lines |
| `create/start/complete/cancel_production_order` | production_orders, production_waste, raw_material_inventory, raw_material_batches, inventory, inventory_batches, stock_transactions, inventory_ledger, journal_entries, journal_entry_lines |
| `create/approve/reject_warehouse_transfer` | warehouse_transfers, warehouse_transfer_items, inventory, inventory_batches, stock_transactions, inventory_ledger |
| `create_order / set_order_status / set_table_status / update_order / detach_order` | orders, dining_tables (حالة الاحتلال، guards) |
| `receive_payment` / `pay_supplier` | customer_payments / supplier_payments, journal_entries, journal_entry_lines |
| `post_manual_journal` | journal_entries, journal_entry_lines, document_sequences |
| `process_treasury_deposit/withdrawal/transfer` | treasury_transactions, journal_entries, journal_entry_lines |
| `seed_opening_balances` | chart_of_accounts (بذور) |
| `ensure_chart_of_accounts` (تلقائي) | chart_of_accounts لكل فرع جديد |

**التبعية الرئيسية (نقطة تشغيل واحدة):** `next_document_number`/`document_sequences` هو المصدر الوحيد لأرقام الفواتير (`invoice_prefix` + counter).

---

## 5. التبعيات عبر الحقول (FKs مختصرة)

```
branches ─┬─ warehouses.branch_id
          ├─ products/categories/customers/suppliers.branch_id
          ├─ users.branch_id / shifts.branch_id / audit_log.branch_id
          └─ chart_of_accounts / journal_entries / treasury_accounts... (كل جداول المحاسبة)

sales ──┬─ sale_items.sale_id ── product_id → products
        ├─ customers.customer_id
        └─ shifts.shift_id

purchases ── purchase_items.purchase_id ── product_id→products / raw_material_id→raw_materials

products ── product_components.component_product_id (BOM ذاتي المرجع)
products ── inventory(product_id, warehouse_id) ── warehouses

recipes ── recipe_items(recipe_id, raw_material_id, product_id)

production_orders ── production_waste.order_id

warehouse_transfers ── warehouse_transfer_items.transfer_id

chart_of_accounts ──┬─ journal_entry_lines.account_id
                    ├─ account_mappings (ربط حسابات تلقائية)
                    └─ treasury_accounts.account_id

journal_entries ── journal_entry_lines.journal_entry_id

bank_reconciliations ── bank_statement_lines.reconciliation_id
```

---

## 6. تبعيات وحدات القائمة الجانبية (Layout)

```
main       → /dashboard, /pos
catalog    → /products, /categories, /components, /raw-materials, /recipes
operations → /inventory, /warehouses, /production, /transfers, /inventory-ledger, /branches, /purchases
people     → /customers, /suppliers
finance    → /expenses, /accounts, /payments, /journal, /treasury, /reconciliation,
             /financial-reports, /sales, /shifts, /reports
admin      → /users, /audit-log, /settings
```

---

## 7. تبعيات الأدوات (lib)

```
i18n.ts      ← كل الصفحات والمكونات (عبر LanguageContext.t)
types.ts     ← api/ وكل الصفحات (نماذج مشتركة) — لا يعتمد على أحد
permissionDefs.ts ← permissions.ts (useCan) ← routes.tsx, Layout, SettingsPage
posMath.ts   ← PosPage (إجماليات السلة) — خالص بلا تبعيات
format.ts    ← صفحات الفواتير والتقارير والمحاسبة
brandColor.ts + themes.ts ← SettingsContext, SettingsPage, PosPage (طباعة)
audit.ts     ← كل صفحات الكتابة (بعد أي mutation)
useBranchFilter.ts ← كل الصفحات ذات النطاق الفرعي
useBranches.ts ← كل صفحات الإدارة/الفلاتر (كاش وحدات)
usePaginatedRows.ts ← كل قوائم الصفحات (ترقيم موحّد)
excel.ts / barcode.ts ← صفحات الكتالوج والجرد
```

---

## 8. قواعد أساسية عند التطوير

1. **لا تستورد `supabase` مباشرة من صفحة** إذا كان يمكن أن يكون عبر `api/*` — أضف دالة RPC عند الحاجة (القراءات البسيطة عبر `from()` مقبولة داخل الصفحة).
2. **أي عملية متعددة الجداول (نقدية/مخزونية)** يجب أن تكون دالة PostgreSQL (`SECURITY DEFINER` + `SET search_path`) لا سلسلة عمليات من الواجهة.
3. **أضف إذنًا جديدًا في 4 أماكن معًا:** `Permission` union + `ALL_PERMISSIONS` + `PERMISSION_GROUPS` + `PERMISSION_LABELS` (كلها في `permissionDefs.ts`)، ثم اربطه في `routes.tsx`.
4. **أضف مفتاح i18n في `ar` و`en` معًا** (يشتق `TranslationKey` من ar فقط).
5. **تغيير RLS/سكيما = هجرة جديدة** (`supabase/migrations/03X_*.sql`) + إعادة بناء قاعدة الاختبار + تشغيل مصفوفة عزل الفروع.
6. **بعد أي تغيير:** `npm run typecheck` ثم `npm run lint` ثم `npm run test:unit` ثم `npm run build`.
