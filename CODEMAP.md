# CODEMAP — دليل مطوّر Premier POS/ERP

> **قاعدة ذهبية:** أي تطوير مستقبلي يبدأ بقراءة هذا الملف قبل فحص المشروع كاملًا.
> الهيكل: `src/features/<module>/pages/*` لكل وحدة، والوصول للبيانات يمر إجباريًا عبر `src/api/`.
> قاعدة البيانات: `supabase/migrations/001..047` (تغيير هجرة مطبَّقة مرفوض؛ أضف هجرة جديدة).

---

## 1. شجرة المشروع الكاملة

```
D:\pos3\project\
├── .github\workflows\deploy.yml      # CI/CD: build + db (postgres:18) + deploy-pages
├── .env / .env.production            # مفاتيح Supabase (VITE_SUPABASE_URL / ANON_KEY)
├── netlify.toml / public\            # نشر بديل + static (favicon, 404)
├── scripts\db\
│   ├── apply-migration.js            # تطبيق الهجرات (--file | --dir) مع checksum + schema_migrations
│   └── verify-schema.js              # تحقق من وجود 51 جدولًا + 50 دالة
├── supabase\
│   ├── migrations\001..047           # مصدر الحقيقة الوحيد (لا تعدّل المطبَّق)
│   ├── legacy\                       # ملفات قديمة لا تُطبَّق (مرجعية فقط)
│   └── ci\stub_auth.sql              # محاكاة Auth لـ CI فقط (لا يُطبَّق على Supabase حقيقي)
├── tests\
│   ├── unit\lib\                     # unit: format, brandColor, permissionDefs, posMath
│   ├── unit\hooks\                   # unit: usePaginatedRows, useBranches
│   ├── components\pages.smoke.test.tsx  # Smoke لكل 31 صفحة (mocked supabase)
│   └── integration\                  # node + Postgres حقيقي: rls harness, process_sale pricing
├── src\
│   ├── main.tsx                      # نقطة الدخول (ErrorBoundary يغلّف كل شيء)
│   ├── api\                          # حدود الوصول الوحيدة للبيانات (يمنع eslint الاستيراد المباشر)
│   │   ├── client.ts                 # re-export للـ supabase client
│   │   ├── modules.ts                # 52 RPC فريدة (بعد إزالة التكرارات) في 10 namespaces (pos, floorPlan, trade...)
│   │   ├── types.ts                  # ApiError/ApiResult + DTOs (SaleItemInput...)
│   │   └── index.ts                  # barrel
│   ├── app\
│   │   ├── App.tsx                   # الجذر
│   │   ├── providers.tsx             # ترتيب الـ providers (انظر DEPENDENCY_MAP)
│   │   └── routes.tsx                # 31 مسار Lazy + ProtectedRoute(permission) + PublicRoute
│   ├── components\                   # مكوّنات مشتركة (لا تستورد supabase مباشرة)
│   │   ├── Layout.tsx                # القائمة الجانبية (6 مجموعات) + تبديل اللغة/الثيم
│   │   ├── DataTable.tsx  Button.tsx  Input.tsx  Modal.tsx  Toast.tsx
│   │   ├── PageHeader.tsx  ConfirmDialog.tsx  Logo.tsx  ErrorBoundary.tsx
│   │   └── PaginationBar.tsx         # load-more footer (مع usePaginatedRows)
│   ├── context\
│   │   ├── AuthContext.tsx           # session + user + signIn(PIN/email) + signOut
│   │   ├── RolesContext.tsx          # roles table -> rolePermissionsMap + saveRole
│   │   ├── SettingsContext.tsx       # settings + branch_settings -> effectiveSettings
│   │   ├── LanguageContext.tsx       # ar/en + dir + t(key) (مفاتيح i18n)
│   │   └── ThemeContext.tsx          # light/dark + ui theme preset
│   ├── hooks\
│   │   ├── useBranches.ts            # كاش وحدات للفروع (branches + refresh)
│   │   └── usePaginatedRows.ts       # ترقيم موحّد (range-capped + count) لكل القوائم
│   ├── lib\
│   │   ├── types.ts                  # النموذج المركزي (~87 نوعًا)
│   │   ├── i18n.ts                   # جداول الترجمة ar/en (مفاتيح مُتحقَّق منها بالأنواع)
│   │   ├── permissionDefs.ts         # 62 إذنًا + 19 مجموعة + أدوار افتراضية
│   │   ├── permissions.ts            # useCan()
│   │   ├── supabase.ts               # createClient + persistSession
│   │   ├── useBranchFilter.ts        # branch_id للمستخدم غير-المدير (null للمدير)
│   │   ├── posMath.ts                # حساب إجماليات POS الخالص (قابل للاختبار)
│   │   ├── format.ts  excel.ts  barcode.ts  audit.ts  brandColor.ts  themes.ts
│   └── features\                     # 11 وحدة × 31 صفحة (كاملة التنفيذ)
│       ├── auth\pages\LoginPage.tsx  # تسجيل دخول PIN + كلمة مرور
│       ├── dashboard\pages\DashboardPage.tsx   # KPIs + رسوم بيانية + تنبيهات
│       ├── pos\pages\PosPage.tsx     # نقطة البيع (طباعة حرارية، خصم، شيفت)
│       ├── pos\pages\FloorPlanPage.tsx  # خريطة طاولات + طلبات (realtime)
│       ├── catalog\pages\            # ProductsPage, CategoriesPage, ComponentsPage
│       ├── inventory\pages\          # InventoryPage, WarehousesPage, TransfersPage, InventoryLedgerPage
│       ├── manufacturing\pages\      # RawMaterialsPage, RecipesPage, ProductionOrdersPage
│       ├── trade\pages\              # SalesPage, PurchasesPage, ExpensesPage, ShiftsPage
│       ├── parties\pages\            # CustomersPage, SuppliersPage
│       ├── accounting\pages\         # AccountsPage, PaymentsPage, JournalPage, TreasuryPage,
│       │                             # ReconciliationPage, FinancialReportsPage
│       ├── reporting\pages\          # ReportsPage, AuditLogPage
│       └── admin\pages\              # BranchesPage, UsersPage, SettingsPage
```

---

## 2. الطبقة المركزية (src/)

### 2.1 api — حدود البيانات
| ملف | الدور |
|---|---|
| `client.ts` | يمرر `supabase` من `lib/supabase` |
| `modules.ts` | 10 namespaces: `pos, floorPlan, trade, shifts, inventory, manufacturing, catalog, accounting, reporting, admin` — كلها تستدعي `supabase.rpc()` على دوال PostgreSQL (قائمة كاملة في القسم 5) |
| `types.ts` | `ApiResult<T> = { data, error }` + DTOs لمدخلات الفواتير والقيود |

**قاعدة:** لا تستورد `@/lib/supabase` خارج `api/` و`context/` و`lib/` (يفرضها `eslint.config.js` — `no-restricted-imports`). العمليات المالية/المخزونية المعقدة = RPC؛ القراءات البسيطة يمكن أن تذهب مباشرة `from(table)` من الصفحة.

### 2.2 app — التوجيه والصلاحيات
- `routes.tsx`: 31 مسارًا، كل مسار محمي بإذن محدد (`Permission`) في `ProtectedRoute`. الملفات `routes.tsx` ترسم كل مسار → إذن.
- مسار `/pos` يعرض `fullscreen` بدون `Layout`؛ الباقي داخل `Layout`.

### 2.3 lib — أدوات أساسية
| ملف | الدور |
|---|---|
| `useBranchFilter()` | يرجع `branch_id` للمستخدم (أو `null` للمدير ليصفي عبر select يدوي) — الأساس لعزل الفروع في الواجهة |
| `permissions.ts` / `useCan()` | `can('module.action')` — الأدمن (super_admin/owner) يرون كل شيء |
| `posMath.ts` | `computePosTotals`/`computeLineDiscount` — منطق إجماليات POS خالص (يستخدمه PosPage + اختبارات) |
| `i18n.ts` | `t('key')` مع `TranslationKey` = مفاتيح ar؛ أضف المفتاح في **ar وen معًا** |
| `audit.ts` | `logAudit(action, entity, id?)` — إدراج `fire-and-forget` في `audit_log` |
| `format.ts` | عملة/أرقام/تواريخ (ar-SA)، `generateInvoiceNumber`, `generateBarcode` |
| `excel.ts` | تصدير/استيراد xlsx (تحميل كسول — SheetJS 0.20.3 مُعرّف عبر tarball في `vendor/`) |
| `barcode.ts` | JsBarcode CODE128 + QR data URL |
| `brandColor.ts` / `themes.ts` | 11 لون علامة + 10 ثيمات واجهة |

### 2.4 المكوّنات المشتركة
| مكوّن | الدور |
|---|---|
| `Layout` | القائمة الجانبية (المجموعات: main/catalog/operations/people/finance/admin) + حراسة الإذن لكل بند |
| `DataTable` | جدول عام (تحديد، صف قابل للنقر، حالات تحميل/فارغة) |
| `PaginationBar` | تذييل «عرض X / الإجمالي» + زر Load more + حالة «عرض الكل» |
| `PageHeader` | `PageHeader`, `Card`, `StatCard` |
| `Toast` | إشعارات (`useToast().show`) |
| `Modal` / `ConfirmDialog` / `Button` / `Input` | عناصر تحكم مشتركة |
| `ErrorBoundary` | يغلّف التطبيق في `main.tsx` (خارج الـ providers) |

---

## 3. الوحدات (features/) — الدليل الكامل

> **مفاتيح الاختصار:** `from(...)` = قراءة/كتابة مباشرة على جدول عبر supabase. `api.<ns>.<fn>` = RPC على PostgreSQL. جميع الصفحات تستخدم `useBranchFilter()` + (اختياريًا) select فرع يدوي للمديرين.

### 3.1 auth — المصادقة
- **الهدف:** دخول بـ PIN (username) أو email/password.
- **الصفحات:** `LoginPage.tsx`.
- **الجداول:** `users`, `auth.users` (جهة Supabase).
- **الخدمات:** `api.admin.getLoginEmail` (تحويل username → email)، `supabase.auth.*`.
- **الإعدادات:** لا شيء.

### 3.2 dashboard — لوحة التحكم
- **الهدف:** KPIs، اتجاه المبيعات، الربح، أفضل المنتجات، الفئات، المبيعات الأخيرة، تنبيهات المخزون.
- **الصفحات:** `DashboardPage.tsx` (أكبر ملف: ~1050 سطر).
- **الجداول:** `sales, sale_items, products, purchases, expenses, customers, inventory, branches, settings, branch_settings` (settings/branches عبر `useSettings`/`useBranches`).
- **الخدمات:** قراءات مباشرة فقط (لا RPCs).
- **الصلاحيات:** `dashboard.view`.
- **الإعدادات:** `currency`, `tax_rate`, `tax_enabled`, `low_stock_threshold` (عبر `effectiveSettings(branch)`).
- **وضع مُبسَّط** للكاشير (`isSimple`).

### 3.3 pos — نقطة البيع
- **الهدف:** بيع سريع: مسح باركود، سلة مع خصم/هدية، دفع (نقدي/بطاقة/تحويل/آجل)، طباعة حرارية، شيفت كاشير.
- **الصفحات:** `PosPage.tsx` (~1630 سطرًا)، `FloorPlanPage.tsx` (~698 سطرًا).
- **الجداول:** `products, categories, product_components, inventory, customers, warehouses, branches, settings, dining_tables, orders` (real-time على orders/dining_tables في FloorPlan).
- **الخدمات:** `api.pos.getActiveShift`, `api.pos.nextDocumentNumber`, `api.pos.processSale` + floorplan RPCs (`create_order, set_order_status, set_table_status, update_order, detach_order`).
- **المنطق الخالص:** إجماليات السلة/الخصم/الضريبة/الباقي عبر `src/lib/posMath.ts` (يُستخدم من PosPage ومُختبَر في unit).
- **الصلاحيات:** `pos.sell` (مسار `/pos` fullscreen)؛ `floor_plan.view/manage` (مسار `/floor-plan`).
- **الإعدادات:** `pos_default_payment_method`, `pos_barcode_autofocus`, `pos_line_discount`, `invoice_prefix`, `invoice_decimal_places`, `receipt_width_mm`, `receipt_copies`, `receipt_auto_print`, `receipt_show_tax`, `receipt_show_qr`, `logo_url`, `receipt_header`, `receipt_footer`, `currency`.

### 3.4 catalog — الكتالوج
| صفحة | الهدف | الجداول | الخدمات | الصلاحية |
|---|---|---|---|---|
| `ProductsPage` | إدارة المنتجات (وحدات، باركود/QR، استيراد/تصدير Excel، مكونات) | `products, categories, units, product_units, product_components, inventory, warehouses` (settings/branches عبر hooks) | `api.catalog.replaceProductUnits` | `products.view`/`products.manage` |
| `CategoriesPage` | إدارة الأصناف | `categories` (branches عبر `useBranches`) | — | `categories.view`/`manage` |
| `ComponentsPage` | قائمة مكونات (BOM) للمنتجات المصنّعة | `product_components, products, inventory` (settings عبر `useSettings`) | — | `components.view`/`manage` |

### 3.5 inventory — المخزون
| صفحة | الهدف | الجداول | الخدمات | الصلاحية |
|---|---|---|---|---|
| `InventoryPage` | رصيد المخزون + تعديل يدوي | `inventory, product_components, warehouses` | `api.inventory.adjustStock` | `inventory.view`/`manage` |
| `WarehousesPage` | إدارة المخازن | `warehouses` (branches عبر `useBranches`) | — | `warehouses.view`/`manage` |
| `TransfersPage` | تحويل بين المخازن (إنشاء/اعتماد/رفض) | `warehouse_transfers, products, inventory_batches, warehouses` (branches نشطة عبر fetch فرعي) | `api.inventory.createTransfer/approveTransfer/rejectTransfer` | `inventory.transfers` / `inventory.transfers.approve` |
| `InventoryLedgerPage` | دفتر المخزون (قراءة فقط) | `inventory_ledger` (branches نشطة عبر fetch فرعي) | — | `inventory.ledger.view` |

### 3.6 manufacturing — التصنيع
| صفحة | الهدف | الجداول | الخدمات | الصلاحية |
|---|---|---|---|---|
| `RawMaterialsPage` | مواد خام + أرصدة + دفعات (3 تبويبات) | `raw_materials, raw_material_inventory, raw_material_batches, units` (branches نشطة عبر fetch فرعي) | `api.inventory.adjustRawStock` | `raw_materials.view`/`manage` |
| `RecipesPage` | وصفات الإنتاج (خامة + كمية + نسبة هالك) | `recipes, recipe_items, products, raw_materials` (branches نشطة عبر fetch فرعي) | — | `recipes.view`/`manage` |
| `ProductionOrdersPage` | دورة أمر الإنتاج (إنشاء/بدء/إتمام مع هالك/إلغاء) | `production_orders, recipes, recipe_items, products, warehouses` (branches نشطة عبر fetch فرعي) | `api.manufacturing.createOrder/startOrder/completeOrder/cancelOrder` | `production.view`/`manage`/`production.waste` |

### 3.7 trade — التجارة
| صفحة | الهدف | الجداول | الخدمات | الصلاحية |
|---|---|---|---|---|
| `SalesPage` | فواتير المبيعات + تفاصيل + مرتجع | `sales, sale_items, customers` (settings عبر `useSettings`) | `api.trade.processRefund` | `sales.view`, `refunds.approve` |
| `PurchasesPage` | فواتير الشراء (منتجات + خامات) | `purchases, purchase_items, products, raw_materials, suppliers, warehouses` (settings/branches عبر hooks) | `api.trade.processPurchase`, `api.trade.nextDocumentNumber` | `purchases.view`/`manage` |
| `ExpensesPage` | المصروفات + فئاتها + تصدير | `expenses` (settings/branches عبر hooks) | — | `expenses.view`/`manage` |
| `ShiftsPage` | فتح/إغلاق شيفت + طباعة تقرير | `shifts, users` (settings/branches عبر hooks) | `api.shifts.open/close` | `shifts.view`/`open`/`close`/`manage` |

### 3.8 parties — الأطراف
| صفحة | الهدف | الجداول | الخدمات | الصلاحية |
|---|---|---|---|---|
| `CustomersPage` | عملاء + أرصدة + استيراد/تصدير | `customers` (settings/branches عبر hooks) | — | `customers.view`/`manage` |
| `SuppliersPage` | موردون | `suppliers` (settings/branches عبر hooks) | — | `suppliers.view`/`manage` |

### 3.9 accounting — المحاسبة
| صفحة | الهدف | الجداول | الخدمات | الصلاحية |
|---|---|---|---|---|
| `AccountsPage` | شجرة الحسابات + رصيد ميزان المراجعة + بذر أرصدة افتتاحية | `chart_of_accounts` | `api.accounting.getTrialBalance`, `seedOpeningBalances` | `accounts.view`/`manage` |
| `PaymentsPage` | تحصيل عملاء / سداد موردين (tab نهاية مدين/دائن) | `customer_payments, supplier_payments, sales, purchases` | `api.accounting.getArAging/getApAging`, `receivePayment`, `paySupplier` | `accounts.view`/`manage` |
| `JournalPage` | دفتر اليومية + قيد يدوي (توازن مدين=دائن) | `journal_entries, chart_of_accounts` | `api.accounting.getJournals`, `postManualJournal` | `accounts.view`/`manage` |
| `TreasuryPage` | أرصدة خزينة + إيداع/سحب/تحويل | `treasury_accounts, treasury_transactions` | `api.accounting.getTreasuryBalances`, `processTransfer`, `processTreasuryDeposit/Withdrawal` | `accounts.view`/`manage` |
| `ReconciliationPage` | تسوية بنكية (بيان + مطابقة + إتمام) | `bank_reconciliations, treasury_accounts` | `api.accounting.createBankReconciliation`, `addStatementLine`, `matchBankLine`, `completeBankReconciliation`, `getBankReconciliation` | `accounts.view`/`manage` |
| `FinancialReportsPage` | 9 تقارير مالية (انظر القسم 8) | `chart_of_accounts, customers, suppliers` | `api.reporting.*` (كلها) | `reports.financial` |

### 3.10 reporting — التقارير
| صفحة | الهدف | الجداول | الخدمات | الصلاحية |
|---|---|---|---|---|
| `ReportsPage` | 14 تقرير تشغيلي (مبيعات/شراء/مصروفات/ربح/مخزون/استهلاك...) | `sales, sale_items, purchases, expenses, inventory, product_components, products, stock_transactions` (settings/branches عبر hooks) | قراءات مباشرة فقط | `reports.view` |
| `AuditLogPage` | سجل العمليات (مرقّم بـ usePaginatedRows) | `audit_log` | — | `audit.view` |

### 3.11 admin — الإدارة
| صفحة | الهدف | الجداول | الخدمات | الصلاحية |
|---|---|---|---|---|
| `BranchesPage` | إدارة الفروع | `branches` | — | `branches.manage` |
| `UsersPage` | مستخدمون (إنشاء/حذف/كلمة مرور/دور/فرع) | `users` (branches عبر `useBranches`) | `api.admin.createUser`, `updateUserPassword`, `deleteUser` | `users.view`/`manage` |
| `SettingsPage` | 8 تبويبات: عام/مظهر/POS/فواتير/إيصال/مخزون/فروع/أدوار | `settings, branch_settings, branches` | — | `settings.manage` |

---

## 4. جدول قاعدة البيانات (51 جدولًا)

| النطاق | الجداول |
|---|---|
| الأساس/الكتالوج | `branches, warehouses, categories, products, product_units, units, customers, suppliers, users, roles, settings, branch_settings` |
| المبيعات/المشتريات | `sales, sale_items, purchases, purchase_items, expenses, shifts, shift_operations, stock_transactions` |
| المخزون | `inventory, inventory_batches, inventory_ledger` |
| التصنيع | `raw_materials, raw_material_inventory, raw_material_batches, recipes, recipe_items, production_orders, production_waste, warehouse_transfers, warehouse_transfer_items, product_components` |
| المحاسبة | `chart_of_accounts, account_mappings, journal_entries, journal_entry_lines, customer_payments, supplier_payments, treasury_accounts, treasury_transactions, bank_reconciliations, bank_statement_lines` |
| المطاعم/الطلبات | `dining_areas, dining_tables, orders, order_items` |
| الأمان | `document_sequences, audit_log, login_as_log, schema_migrations` |

**ملاحظة عزل الفروع:** الجداول ذات عمود `branch_id` تعزل مباشرة (SELECT = admin-or-own-branch). الجداول الفرعية (child) مثل `sale_items`, `journal_entry_lines` تعزل عبر الأصل (لا عمود فرع خاص بها). `document_sequences` مقفلة تمامًا على أي كتابة من `authenticated`.

---

## 5. قائمة RPCs (الدوال المغلفة في `src/api/modules.ts`)

| namespace | الدوال (اسم PostgreSQL) |
|---|---|
| `pos` | `get_active_shift, next_document_number, process_sale` |
| `trade` | `next_document_number, process_purchase, process_refund` |
| `shifts` | `open_shift, close_shift` |
| `inventory` | `adjust_stock, adjust_raw_stock, create_warehouse_transfer, approve_warehouse_transfer, reject_warehouse_transfer` |
| `manufacturing` | `create_production_order, start_production_order, complete_production_order, cancel_production_order` |
| `catalog` | `replace_product_units` |
| `floorplan` | `create_order, set_order_status, set_table_status, update_order, detach_order` |
| `accounting` | `get_trial_balance, seed_opening_balances, get_journals, post_manual_journal, get_ar_aging, get_ap_aging, receive_payment, pay_supplier, get_treasury_balances, process_transfer, process_treasury_deposit, process_treasury_withdrawal, get_bank_reconciliation, create_bank_reconciliation, add_statement_line, match_bank_line, complete_bank_reconciliation` |
| `reporting` | `get_trial_balance, get_trial_balance_summary, get_general_ledger, get_income_statement, get_balance_sheet, get_ar_aging, get_ap_aging, get_aging_summary, get_cash_flow, get_party_statement` |
| `admin` | `create_user, update_user_password, delete_user, get_login_email, record_login_failure, record_login_success` |

---

## 6. الصلاحيات (62 إذنًا — `src/lib/permissionDefs.ts`)

**القواعد:** `super_admin` و`owner` يملكان كل شيء ضمنيًا. الباقي من `roles` في القاعدة (RolesContext) مع fallback للافتراضات البرمجية.

| المجموعة | الأذونات |
|---|---|
| dashboard | `dashboard.view` |
| pos | `pos.sell`, `pos.discount`, `pos.change_price`, `pos.reprint`, `floor_plan.view`, `floor_plan.manage` |
| products | `products.view`, `products.manage`, `products.print`, `products.export`, `products.import` |
| categories | `categories.view`, `categories.manage` |
| components | `components.view`, `components.manage` |
| purchases | `purchases.view`, `purchases.manage`, `purchases.print` |
| inventory | `inventory.view`, `inventory.manage`, `inventory.transfers`, `inventory.transfers.approve`, `inventory.ledger.view` |
| raw_materials | `raw_materials.view`, `raw_materials.manage` |
| recipes | `recipes.view`, `recipes.manage` |
| production | `production.view`, `production.manage`, `production.waste` |
| warehouses | `warehouses.view`, `warehouses.manage` |
| customers | `customers.view`, `customers.manage`, `customers.print`, `customers.export` |
| suppliers | `suppliers.view`, `suppliers.manage`, `suppliers.print` |
| sales | `sales.view`, `refunds.approve`, `sales.print`, `sales.export` |
| expenses | `expenses.view`, `expenses.manage`, `expenses.print` |
| accounts | `accounts.view`, `accounts.manage` |
| shifts | `shifts.view`, `shifts.open`, `shifts.close`, `shifts.manage` |
| reports | `reports.view`, `reports.financial`, `reports.print`, `reports.export` |
| admin | `users.view`, `users.manage`, `audit.view`, `settings.manage`, `branches.manage` |

**الأدوار (8 قيم CHECK على `users.role`):** `super_admin, owner, branch_manager, cashier, warehouse_manager, kitchen, accountant, customer_display`. الإعدادات الافتراضية في `DEFAULT_ROLE_PERMISSIONS`.

---

## 7. الإعدادات (`settings` + `branch_settings`)

**عامة (Settings):** `store_name, store_name_en, store_address, store_phone, currency, tax_rate, tax_enabled, receipt_header, receipt_footer, logo_url, language, theme, brand_color, pos_default_payment_method, pos_barcode_autofocus, pos_line_discount, invoice_prefix, invoice_next_number, invoice_decimal_places, receipt_width_mm, receipt_copies, receipt_auto_print, receipt_show_tax, receipt_show_qr, low_stock_threshold`.

**لكل فرع (BranchSettings — تُدمج عبر `effectiveSettings(branchId)` في SettingsContext):** `receipt_header, receipt_footer, logo_url, tax_rate, tax_enabled, currency, low_stock_threshold`.

---

## 8. التقارير

**تشغيلية (ReportsPage — 14):** `sales, sales_by_payment, sales_by_employee, sales_by_product, detailed_invoices, purchases, expenses, profit, inventory, component_consumption, recipe_costs, top_consumed_components, top_consumed_products, low_stock`.

**مالية (FinancialReportsPage — 9):** ميزان مراجعة (trial balance + summary)، دفتر الأستاذ العام، قائمة الدخل، الميزانية العمومية، تقادم مدين/دائن (AR/AP aging + summary)، التدفق النقدي، كشف حساب طرف.

---

## 9. الاختبارات

| الملف | البيئة | الغطاء |
|---|---|---|
| `tests/unit/lib/format.test.ts` | jsdom | أدوات التنسيق |
| `tests/unit/lib/brandColor.test.ts` | jsdom | ألوان العلامة |
| `tests/unit/lib/permissionDefs.test.ts` | jsdom | نموذج الصلاحيات (62 إذنًا) |
| `tests/unit/lib/posMath.test.ts` | jsdom | إجماليات POS (خصم/ضريبة/باقي/آجل) |
| `tests/unit/hooks/usePaginatedRows.test.ts` | jsdom | ترقيم القوائم (range + count + filters + append) |
| `tests/unit/hooks/useBranches.test.ts` | jsdom | كاش الفروع + refresh + error recovery |
| `tests/components/pages.smoke.test.tsx` | jsdom (mocked) | تجميع 31 صفحة بلا انهيار |
| `tests/integration/process_sale_pricing.test.ts` | node + Postgres | تسعير قسري + كبس الخصم |
| `tests/integration/rls_branch_isolation.test.ts` | node + Postgres + stub | مصفوفة 92 اختبار عزل فروع |
| `tests/integration/floorplan_orders.test.ts` | node + Postgres + stub | دورة طاولات/طلبات + guards |
| `tests/integration/db.ts` / `rls.ts` | — | مساعدو الاتصال/الانتحال |

**الأوامر:** `npm run typecheck` · `npm run lint` · `npm run test:unit` · `npm run test:integration` (يحتاج `SUPABASE_DB_URL` نحو قاعدة حقيقية، وإلا تُتخطى) · `npm run verify` · `npm run build`.

---

## 10. طبقة البيانات الموحّدة (PHASE 6)

### 10.1 ترقيم القوائم (usePaginatedRows + PaginationBar)
- **المشكلة المعالجة (M7):** 219 استدعاء `supabase.from(` مباشر؛ 151 `.select()` غير مرقَّم؛ 5 حدود صامتة (AuditLog `.limit(200)` + Payments/Reconciliation/Treasury/InventoryLedger `.limit(100)`).
- **الحل:** `src/hooks/usePaginatedRows.ts` يفرض `range()` محدودًا (افتراضي 200) + استعلام count دقيق `head`، ويطبّق الفلاتر على الاستعلامين معًا، مع حارس نسخة (generator) ضد سباقات التحميل، و`loadMore()` للإلحاق.
- **المستخدمون:** كل قوائم الصفحات (~30 صفحة) من الكتالوج/المخزون/التصنيع/التجارة/الأطراف/المحاسبة/التقارير/الإدارة. `PaginationBar` يعرض «عرض X / الإجمالي» + Load more.
- **النتيجة:** صفر `.limit()`/`.range()` مبعثرة؛ كل قراءة قائمة محدودة الباوند تلقائيًا.

### 10.2 الإعدادات والفروع المشتركة (useSettings + useBranches)
- **المشكلة:** كل صفحة كانت تجلب `settings` و`branches` بنفسها (10+ نسخ).
- **الحل:** `useSettings()` (من SettingsContext — جلب `settings` + `branch_settings` مرة واحدة وتجميع `effectiveSettings(branchId)`) و`useBranches()` (كاش على مستوى الوحدة). الصفحات تستهلك `currency`/`storeName`/`branches` عبر الـ hooks؛ الاستثناء المقصود: الفروع `is_active=true` فقط (PosPage/FloorPlan/Transfers/InventoryLedger/Recipes/RawMaterials/ProductionOrders) تحتفظ بجلبها الفرعي، و`SettingsPage` (محرر الإعدادات نفسه) وPosPage (دولة `settings` محلية مستخدمة على نطاق واسع) تبقى كما هي.
