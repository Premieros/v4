# FULL PROJECT AUDIT — Premier POS/ERP

> **Baseline:** branch `main` @ `107a9ae` (`feat(rbac): gate CRUD UI by *.manage + wire login lockout RPCs`) — clean working tree.
> **Branch for work:** `stabilization/refactor`.
> **Date:** 2026-08-08
> **Method:** full read of `src/` (70 files), all migrations 001–047, scripts, tests, configs; cross-device flow tracing for POS Tables/Orders.

---

## 1. Project structure

```
D:\pos3\project\
├── .github\workflows\deploy.yml        # CI/CD: lint + typecheck + unit + build + db(postgres:18) + pages deploy
├── .env / .env.production              # (NOTA: .env.production مُتتبَّع في git — مشكلة)
├── netlify.toml / public\              # نشر بديل + static assets
├── scripts\db\                         # apply-migration.js + verify-schema.js (51 جدولًا / 50 دالة)
├── supabase\
│   ├── migrations\001..047             # السلسلة الكاملة (47 migration) — مصدر الحقيقة
│   ├── legacy\                         # مرجعي فقط (لا يُطبَّق)
│   └── ci\stub_auth.sql                # محاكاة Auth للـ CI
├── tests\
│   ├── unit\lib\                       # format / brandColor / permissionDefs / posMath
│   ├── unit\hooks\                     # usePaginatedRows / useBranches
│   ├── components\pages.smoke.test.tsx # 31 صفحة (بما فيها FloorPlanPage)
│   └── integration\                    # RLS matrix + floorplan orders + process_sale pricing
├── src\
│   ├── main.tsx / index.css
│   ├── api\        (client.ts, modules.ts, types.ts, index.ts)   # RPC wrappers
│   ├── app\        (App.tsx, providers.tsx, routes.tsx — 31 مسار Lazy)
│   ├── components\ (11 مكوّنات مشتركة + PaginationBar)
│   ├── context\    (Auth, Roles, Settings, Language, Theme)
│   ├── hooks\      (useBranches, usePaginatedRows)
│   ├── lib\        (types.ts 1003 سطرًا، i18n.ts 1210، permissionDefs.ts 391، posMath.ts، + أدوات)
│   └── features\   (31 صفحة عبر 11 وحدة)
```

**كل ملف في `src/` قابل للوصول** — لا توجد ملفات يتيمة بالكامل. لا يوجد `src/types/` (النماذج في `lib/types.ts` + `api/types.ts`).

---

## 2. Unused files

**لا يوجد ملف كامل غير مستخدم.** كل ملفات `src/` مستوردة من مكان ما (routes.tsx / tests / providers).

**غير متتبع لكنه موجود في شجرة العمل:**
- `dist/` — ناتج build قديم (gitignored).
- `tsconfig.app.tsbuildinfo` / `tsconfig.node.tsbuildinfo` — بقايا في الجذر (الإعداد الحالي يكتب لـ `node_modules/.tmp`).

**ملفات مرفوعة رغم عدم ضرورتها (candidates for removal — انظر CANDIDATE_FOR_REMOVAL.md):**
- `.env.production` — **مُتتبَّع في git** (`d483eb6`).
- `START SERVER.bat` — مسار جهاز مخصوص.
- `.bolt/config.json` + `.bolt/prompt` — بقايا scaffold.

---

## 3. Duplicate files

لا توجد ملفات مكررة حقيقية. `supabase/legacy/*` مرجعية مقصودة (مؤرشفة، لا تُطبَّق).

**ازدواج بيانات (وليس ملفات):** `FloorPlanPage` و`PosPage` يجلبان `dining_tables`, `branches`, `products` كلٌّ على حدة بلا كاش مشترك.

---

## 4. Duplicate components

لا توجد مكوّنات مكررة. `ConfirmDialog` يغلّف `Modal` (تركيب سليم). `StatCard`/`Card` مخرَجة من `PageHeader.tsx` (لا ملفات منفصلة).

---

## 5. Dead code

- `src/lib/excel.ts`: `downloadTemplate` — **غير مستورد أبدًا**.
- `src/lib/brandColor.ts`: `applyBrandHex` — **غير مستورد أبدًا**.
- `src/lib/i18n.ts`: `translations` — مُصدَّر لكن يُستخدم داخليًا فقط.
- `PosPage.tsx:205`: حقول `cash_sales`/`total_sales` في `activeShift` غير مقروءة أبدًا.
- `src/api/types.ts`: `StatementLineInput` — غير مستورد (لا حتى في modules.ts).

---

## 6. Unused functions

| الدالة | الملف | الحالة |
|---|---|---|
| `downloadTemplate` | `lib/excel.ts` | غير مستخدمة |
| `applyBrandHex` | `lib/brandColor.ts` | غير مستخدمة |
| `detachOrder` | `PosPage.tsx:577` | تستخدم فعليًا لكن سلوكها خاطئ (تفصل الـ refs المحلية فقط بلا تسوية DB) |

---

## 7. Unused hooks

لا يوجد hook كامل غير مستخدم. `useBranches` مستخدم في 7 صفحات. `useBranchFilter` في 8 صفحات.

---

## 8. Unused types

`src/lib/types.ts` (88 نوعًا): **29 نوعًا غير مستوردة خارج الملف**:
`ShiftStatus, ShiftOperationType, ShiftOperation, ProductType, Sale, SaleItem, PurchaseItem, OrderStatus, DiningTableLayout, ProductionStatus, ProductionWaste, WasteInput, TransferStatus, WarehouseTransferItem, TransferItemInput, InventoryBatch, LedgerEntryType, StockTransaction, JournalEntry, JournalEntryLine, OpenInvoice, AgingBucket, TreasuryTransactionType, ReconciliationStatus, BankStatementLine, BookCandidate, JournalLineDto, AuditTrailRow, PartyStatementRow`.

أنواع مستخدمة داخليًا فقط: `BrandPreset, BrandValue, DEFAULT_BRAND, DEFAULT_SURFACE, UiThemeMode, UiThemePreset, PermissionGroup, LogoTone, LogoVariant`.

> ملاحظة: بعض هذه الأنواع تختبر تحقق schema (مثل `AuditTrailRow`) — لا حذف منفّذ؛ توثيق فقط.

---

## 9. Unused imports

لا توجد imports يتيمة في الصفحات (ESLint نظيف). المشكلة المعمارية هي **الاستيراد من `@/api` ثم استدعاء `supabase.from()` مباشرة** (انظر §15).

---

## 10. Unused npm packages

| الحزمة | الحالة |
|---|---|
| `date-fns@^4.4.0` | **غير مستخدمة** (صفر imports) |
| `@testing-library/user-event` | **غير مستخدمة** (صفر imports) |
| `xlsx@0.18.5` | مستخدمة (lazy import) لكن **لديها CVEs معروفة** |

---

## 11. Unused assets

- `public/` — كل الملفات مستخدمة (`404.html`, `app-icon.svg`, `favicon.svg`, `_redirects`).
- لا توجد صور/أصول يتيمة داخل src.

---

## 12. Large files (مسؤوليات متعددة / حجم كبير)

| الملف | الأسطر | ملاحظة |
|---|---|---|
| `src/features/pos/pages/PosPage.tsx` | 1526 | **الأهم للتقسيم** — cart, checkout, receipt, shift, barcode, orders, tables |
| `src/features/dashboard/pages/DashboardPage.tsx` | 1050 | KPIs + charts + alerts + settings |
| `src/lib/i18n.ts` | 1210 | ملف ترجمة كبير (طبيعي لكن يمكن تجزيئه) |
| `src/lib/types.ts` | 1003 | 88 نوعًا + 29 غير مستخدمة |
| `src/features/admin/pages/SettingsPage.tsx` | 727 | 8 تبويبات إعدادات |
| `src/features/pos/pages/FloorPlanPage.tsx` | 668 | map + orders + actions |
| `src/features/accounting/pages/FinancialReportsPage.tsx` | 532 | 9 تقارير مالية |
| `src/features/catalog/pages/ProductsPage.tsx` | 480 | CRUD + units + barcode + import/export |

---

## 13. Duplicate database queries

- **جدول الاشغال مكرر:** `PosPage.loadSummary` (`:303-321`) يستعلم `dining_tables` count و`orders`؛ `FloorPlanPage.load` (`:95-129`) يستعلم الكامل. لا كاش مشترك.
- **`products` يجلب مرتين:** PosPage (`:396-401`) وFloorPlanPage (`:111-113`) كلاهما بنفس فرع.
- **`branches`:** يجلبها Layout/PosPage/FloorPlanPage/كل صفحة إدارة بشكل مستقل.
- **`warehouses`:** PosPage `loadStock` (`:239-258`) و`completeSale` (`:670-671`) يستفسران نفس القائمة في كل عملية.
- **`getStock`** تُحسب من `stockMap` لكن `loadStock` تُعاد بناءه بالكامل عند أي تغيير فرع.

---

## 14. Duplicate business logic

- **الاحتلال/التحرير مكرر منطقيًا:** `set_table_status` (037) + `create_order` (037) + `set_order_status` (037) + `process_sale` (038) جميعها تعالج حالة الطاولة بطرق متوازية غير منسقة → مصدر التناقضات.
- **حساب إجماليات البيع مكرر:** `PosPage` (`:594-600`) و`process_sale` (`038:142-152`) يحسبان subtotal/discount/tax/total بصيغتين قد تختلفان (الواجهة تعرض، الخادم يفرض — فرق ممكن بسبب تقريب).
- **`change` يحسب من `paidAmount`** في `:600` و`687` بينما البيع يستخدم `paidAmountToUse` — حالة آجل تعرض تغييرًا غير مدفوع.

---

## 15. Context problems

- **حدود البيانات اسمية:** 30/31 صفحة تستورد `@/api` لكنها تستدعي `supabase.from(...)` مباشرة في جسم الصفحة (DashboardPage: 22 استدعاء، ReportsPage: 19، ProductsPage: 14). `no-restricted-imports` مستوى `warn` ويحظر الاسم `supabase` من `@/lib/supabase` فقط — والاستيراد عبر `@/api` يتجاوزه.
- **حالة POS موزعة بلا مخزن مشترك:** `tableId/orderId/orderType/guestCount` مكررة في PosPage وFloorPlanPage كـ local state، لا sync بينهما.

---

## 16. State management problems

- لا يوجد state manager (zustand/Redux) — مناسب لمعظم المشروع، لكن **POS يحتاج مخزن مشترك** بين PosPage وFloorPlanPage (حالة الطاولات/الطلبات المفتوحة).
- `useState` محلي في صفحات ضخمة (PosPage ~20 useState) يجعل الفهم والاختبار صعبين.
- `location.state` يُستخدم لنقل حالة الطلب بين الصفحات — هشّ (يفقد عند refresh مباشر).

---

## 17. Performance problems

- استعلامات مكررة بين صفحات (انظر §13).
- `loadStock`/`loadSummary` تُعاد عند كل تغيير branch بلا debounce.
- الاشتراك realtime الوحيد (`PosPage:323-350`) يستدعي `loadSummary` لكل حدث orders/dining_tables (mutable مع debounce 300ms — مقبول لكن بدون فائدة للـ FloorPlan).
- re-renders غير ضرورية: `setCart` بـ `.map` إنشاء مصفوفة جديدة في كل تفاعل.
- `buildItemsPayload`/`subtotal` useMemo صحيحان.

---

## 18. Error handling problems

- **C1 (حرج):** `process_sale` (038:192-207) يتحقق من الطلب **بعد** كتابة الفاتورة + الأصناف + خصم المخزون. `RETURN` لا يلغي المعاملة → نجاح فعلي مع رسالة فشل، وإعادة المحاولة = بيع مزدوج.
- `setTableStatus(...).catch(()=>{})` يبتلع الفشل (PosPage:568, 742) → تحرير طاولة قد يفشل بصمت.
- `setOrderStatus('held')` بدون فحص النتيجة (PosPage:647).
- `loadOrder` لا يتحقق من `order.status`/الفرع (PosPage:261-300) ويستأنف طلبات منتهية.
- `loadError` في PosPage يظهر لكن بعض المسارات لا تتعامل معه.

---

## 19. Security concerns

- **`.env.production` مُتتبَّع في git** (`d483eb6`) — يحتوي `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon key عام بالتصميم) لكنه tripwire للـ service-role/DB URL مستقبلًا.
- **`get_login_email`** أنون-callable (SECURITY DEFINER) → سطح تعرّف مستخدمين خفيف (يخدّم PIN login فقط، لا يجيب عن الحسابات المقفلة).
- **`xlsx@0.18.5`** CVE-2023-30533 (prototype pollution) + CVE-2024-22363 (ReDoS) يُستخدمان في رفع ملفات (ProductsPage/CustomersPage).
- **لا توجد قيم سرية مكشوفة** في الكود المصدري أو git history للفروع الحالية (فحص grep). `.env` غير متتبع.

### SECRET DETECTED
```
FILE: .env.production (committed in git, d483eb6)
TYPE: Supabase anon key + project URL (public by design; NO service_role / DB URL present)
RISK: LOW now — HIGH as a leak tripwire if secrets are ever added to it
ACTION REQUIRED: git rm --cached .env.production + remove from git history + add to .gitignore
```

---

## 20. Testing gaps

- **Smoke test يغطي 30 صفحة فقط** — `FloorPlanPage` (راوتينغ `/floor-plan`) مستبعدة. → ✅ (PHASE 8) أُضيفت FloorPlanPage إلى smoke (31 صفحة الآن).
- **Smoke test لا يتحقق من شكل البيانات:** mock يعيد `{data:[],error:null}` ثابتًا → تغيير شكل الاستعلام لا يُكتشف. الادعاء في تعليقه مبالغ فيه. (ملاحظة مستمرة)
- **لا يوجد اختبار وظيفي لـ PosPage** (cart/checkout/discount/payment flows) — فقط smoke mount. → جزئيًا (PHASE 8): استُخرج منطق الإجماليات إلى `src/lib/posMath.ts` مع 14 اختبار unit (خصم/ضريبة/باقي/آجل)؛ التدفق الكامل للواجهة يبقى خارج نطاق unit.
- **C1 بدون اختبار:** لا يوجد اختبار يثبت أن فشل تسوية الطلب لا يكتب sale. (مستمر — يتطلب harness أعمق)
- **لا يوجد اختبار لـ C2** (إعادة hold مكررة). (مستمر)
- **لا يوجد اختبار لـ detachTable** (تحرير الطاولة مع طلب مفتوح). (مستمر)
- **Integration قوي:** RLS matrix (92+ حالة)، floorplan orders، pricing — لكن لا يغطي حالات C1/C2. (مستمر)

---

## 21. Documentation gaps

| الملف | المشكلة |
|---|---|
| `CODEMAP.md` | ✅ (PHASE 9) حُدّث: migrations `001..047`، 51 جدولًا/50 دالة، 31 مسارًا، FloorPlanPage، hooks الجديدة، أقسام 62 إذنًا/طبقة البيانات. |
| `DEPENDENCY_MAP.md` | ✅ (PHASE 9) حُدّث: realtime/042، floorplan RPCs، usePaginatedRows/posMath، قاعدة الترقيم. |
| `README.md` | ✅ أُصلح في PHASE 4: `base: './'` أصبح مطابقًا + يذكر Netlify |
| `supabase/README.md` | ✅ (PHASE 9) حُدّث: 001–047 |
| — | ✅ (PHASE 9) أُنشئ `KNOWN_ISSUES.md` و`FINAL_PROJECT_REPORT.md` |

---

## تصنيف المشاكل

### CRITICAL
- **C1** — `process_sale` يكتب البيع ثم يرجع `ORDER_NOT_FOUND` (038:192-207): بيع وهمي + خصم مزدوج. خاصة لطلبات takeaway/delivery المحفوظة (بلا table) أو عند الدفع من جهازين.
- **C2** — `holdOrder` ينشئ طلبًا مكررًا عند إعادة الحفظ لطلب مستأنف (PosPage:620-662): طلبان أحياء على نفس الطاولة.

### HIGH
- **H1** — ✅ (PHASE 5) `detachTable` يحرر الطاولة مع بقاء الطلب مفتوحًا مربوطًا. `detachOrder` بدون أي كتابة DB. → أُصلح: RPC `detach_order` (047) يفرّغ `orders.table_id` ويحرر الطاولة فقط إن لم توجد طلبات أخرى؛ `PosPage.performDetach` يستخدمه ويُبرز الأخطاء.
- **H2** — لا حارس اشغال: `create_order`/`set_table_status` لا تتحقق من تناقض الحالات (037). → أُصلح في PHASE 2b (046): `create_order` يرفض table مشغول، `set_table_status` يرفض تحرير طاولة عليها طلبات.
- **H3** — تحرير الطاولة في البيع المباشر غير ذرّي + `.catch(()=>{})` (PosPage:741-743). → ✅ (PHASE 5) أُصلح: `process_sale` (047) يحرر الطاولة ذرّيًا (إنشاء/ربط/تحرير في نفس المعاملة مع إعادة فحص الطلبات)؛ أُزيل تحرير العميل؛ لا `.catch(()=>{})` صامت.
- **H4** — `process_sale` يحرر الطاولة بأول طلب فقط ولا يفحص طلبات أخرى على نفس الطاولة (038:205-206). → ✅ (PHASE 5) أُصلح في 047: يتحرر فقط إن لم تبقَ طلبات open/held أخرى على الطاولة (اختبار تغطية H4).
- **H5** — `xlsx@0.18.5` CVEs في رفع الملفات. → ✅ (PHASE 5d) أُصلح: ترقية إلى SheetJS `0.20.3` (إصلاح Prototype Pollution + ReDoS) عبر tarball مُستضاف في `vendor/xlsx-0.20.3.tgz` (بديل npm الرسمي — المرجع الرسمي هو CDN SheetJS)؛ التحميل يبقى lazy chunk.
- **H6** — `.env.production` متتبع في git. → أُصلح في PHASE 3: `git rm --cached` + إزالة من المحفوظات.

### MEDIUM
- **M1** — FloorPlanPage بلا realtime/refetch بين الأجهزة. → ✅ (PHASE 5) أُصلح: اشتراك `postgres_changes` على orders/dining_tables (فرع) مع reload مجمَّع.
- **M2** — `loadOrder` يستأنف طلبات منتهية ويعيد احتلال الطاولة. → ✅ (PHASE 5) أُصلح: يرفض غير `open/held`، ولا يعيد احتلال سوى `vacant`.
- **M3** — `holdOrder` يضبط held بلا فحص النتيجة. → أُصلح في PHASE 2b (046): `update_order` + فحص النتيجة.
- **M4** — `deleteTable` يحذف طاولة عليها طلبات مفتوحة (ON DELETE SET NULL). → أُصلح في PHASE 2b (046): trigger `BEFORE DELETE` يرفع خطأ.
- **M5** — `ordersByTable` يأخذ أول طلب فقط لكل طاولة (يخفي الثاني). → ✅ (PHASE 5) أُصلح: يبني مصفوفة طلبات ويعرض الكل (+N على البطاقة).
- **M6** — `vite.config.ts` base مطلق يكسر Netlify + يناقض README. → أُصلح في PHASE 4: `base: './'`.
- **M7** — حد البيانات غير مفروض (30/31 صفحة تستدعي `from()` مباشرة). → ✅ (PHASE 6) أُصلح: طبقة `usePaginatedRows` موحّدة (range + count) لكل قوائم الصفحات (~30 صفحة) + `PaginationBar`؛ أُزيلت السقوف الصامتة الخمسة (AuditLog/Payments/Reconciliation/Treasury/InventoryLedger). الجداول المنتهية المتبقية للقراءات المباشرة كلها مقيدة بالتاريخ (تقارير) أو lookups (لا قوائم مفتوحة).
- **M8** — `change` يُحسب من `paidAmount` لا `paidAmountToUse` (آجل). → ✅ (PHASE 5) أُصلح: `change = max(0, (credit ? 0 : paidAmount || total) - total)`.
- **M9** — `guestCount` لا يُخزَّن في sales. → ✅ (PHASE 5) أُصلح: عمود `sales.guest_count` + وسيط `p_guest_count` في `process_sale` (047) + تمريره من PosPage.
- **M10** — حزم غير مستخدمة (date-fns, user-event). → أُصلح في PHASE 3: أُزيلتا من package.json.

### LOW
- **L1** — `dine_in` قابل للاختيار بلا طاولة في الـ checkout → طلب بلا table → يقع في C1. → ✅ (PHASE 5) أُصلح: حارس في `switchOrderType`/`holdOrder`/`completeSale`.
- **L2** — لا CHECK constraints على `orders.status/order_type` و`dining_tables.status`. → ✅ (PHASE 5) أُصلح في 047.
- **L3** — تغيير الفرع يمسح `orderId` محليًا بلا تسوية DB (PosPage:1020-1027). → ✅ (PHASE 5) أُصلح: تحذير مؤكد عند وجود طلب نشط، دون تحرير خاطئ للطاولة.
- **L4** — `loadOrder` جلب منتجات غير مقيد بفرع؛ الأصناف غير الموجودة تُسقط بصمت. → ✅ (PHASE 5) أُصلح: تقييد `branch_id` للطلب.
- **L5** — `FloorPlanPage` لا يفلتر `is_active` للطاولات. → ✅ (PHASE 5) أُصلح: الاستعلامات تفلتر `is_active=true` (كانت سليمة عند المراجعة، تحقّق إضافي فقط).
- **L6** — حقول `cash_sales/total_sales` غير مستخدمة (PosPage:205). → ✅ (PHASE 5) أُزيلت من نوع الحالة.
- **L7** — `switchOrderType`/`loadOrder` يكتبان `occupied` فوق `reserved`. → ✅ (PHASE 5) أُصلح: الإصلاح فقط لصفوف `vacant`.
- **L8** — انجراف توثيقي (CODEMAP/DEPENDENCY_MAP/README/supabase README).

---

## أهداف المراحل القادمة (ملخص)

1. **Migration 045** — ✅ إصلاح C1: تحقق الطلب قبل الكتابة + `RAISE` بدل `RETURN` + regression test.
2. **إصلاح C2** — ✅ `holdOrder` يحدّث الطلب الحالي (046).
3. **Cleanup** — ✅ حزم/ملفات غير مستخدمة + `.env.production` من git.
4. **Deployment** — ✅ `base: './'`.
5. **Services** — ✅ (PHASE 6) طبقة بيانات موحّدة: `usePaginatedRows` للقوائم + `useSettings`/`useBranches` للميتاداتا المشتركة. استعلامات الطاولات/الطلبات المشتركة بين PosPage/FloorPlan تبقى متاحة كخطوة مستقبلية.
6. **تقسيم PosPage** تدريجيًا. → جزئيًا (PHASE 8): استُخرج منطق الإجماليات إلى `posMath.ts`؛ التقسيم الكامل يبقى خارج النطاق.
7. **دورة Tables/Orders** — ✅ حارس اشغال (H2)، detach سليم (H1)، deleteTable آمن (M4)، realtime للـ FloorPlan (M1)، guards الحالة (L2)، تفريغ ذرّي (H3/H4).
8. **Testing** — ✅ (PHASE 8): FloorPlanPage في smoke، 14 اختبار posMath، 4 اختبار useBranches (أصلح اختبارها خطأً حقيقيًا في استرداد الخطأ). C1/C2 regression تبقى مقترحة.
9. **توثيق** — ✅ (PHASE 9): تحديث CODEMAP/DEPENDENCY_MAP/README/supabase README + KNOWN_ISSUES + FINAL_PROJECT_REPORT.
