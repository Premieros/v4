# تقرير P0 — إصلاح خطأ الإنتاج `get_stock_valuation` (PGRST202) + بوابة ترابط النشر

> **الفرع:** `development/master-log2` — **HEAD:** `50bbde3`
> **التاريخ:** 2026-08-15
> **الحالة:** الإصلاح الهندسي + بوابة السلسلة مكتملة ومتحقَّق منها في CI؛ **ترحيل Production معلّق على توفر بيانات اتصال Postgres الرسمية.**

---

## 1) الأعراض (Symptom)

صفحة `/stock-valuation` الحية فشلت برسالة PGRST202 المنشورة:

```
Could not find the function public.get_stock_valuation(p_branch_id, p_warehouse_id)
in the schema cache
```

نفس الاستجابة بالضبط أعادها REST probe مباشرة على Production:

```
POST https://lwnsdsncmlsroiswgoga.supabase.co/rest/v1/rpc/get_stock_valuation
  -> 404 {"code":"PGRST202", ...}
```

---

## 2) السبب الجذري (Root Cause)

| # | الحقيقة المؤكدة | الدليل |
|---|---|---|
| 1 | **الواجهة المنشورة أحدث من قاعدة بيانات Production.** البندل المنشور `assets/index-NdNTpBAi.js` يحتوي نفس `SUPABASE_URL` والـanon key ⇒ الواجهة الحية تتصل بنفس الـDB المقصودة (لا يوجد انفصال DB). | فحص البندل المنشور + تطابق متغيرات البيئة في `deploy.yml`. |
| 2 | `main` (آخر خط أساس منشور سابقًا) لا يحتوي على ميجريشنات 071–075 إطلاقًا؛ التطوير الحديث (على `development/master-log2`) أضافها، والـDB الإنتاجي لم يُرحَّل إليها أبدًا. | `git log`؛ الفروق بين الفرعين. |
| 3 | **حدّ الـschema الإنتاجي الحالي يتوقف عند حدود ~022–035** — أقدم من أي شيء يطلبه `development/master-log2`. | مسح REST شامل (جدول 3 أدناه). |
| 4 | ميجريشن `072_stock_valuation.sql` نفسه به خلل SQL: `RETURNS TABLE(... branch_id ...)` يجعل `branch_id` متغير PL/pgSQL، فمسار الـstaff (`SELECT branch_id INTO v_user_branch FROM public.users`) يفشل بـ`column reference "branch_id" is ambiguous`. | تطبيقه على الكتلة المعزولة وكشف الخطأ الحي. |

### مسح جداول Production (REST، قراءة فقط)

| موجود في Production | غير موجود في Production |
|---|---|
| `branches`, `warehouses`, `products`, `inventory_batches`, `orders`, `system_settings`, `journal_entries`, `treasury_transactions`, `inventory_ledger`, `warehouse_transfers`, `audit_log`, `shifts`, + 20 جدولًا أساسيًا | `floorplan_tables/orders`, `kitchen_orders`, `subscriptions`, `instapay_payments`, `stock_counts`, `inventory_counts`, `procurement_*`, `costing_snapshots`, `costing_history`, `purchase_orders`, `purchase_requests`, `purchase_request_items` |

### مسح RPC في Production (منها، عبر بوابة الترابط)

| نوع | العدد |
|---|---|
| دوال موجودة (متطابقة مع الواجهة) | 57 |
| دوال **مفقودة (PGRST202)** | **33** |

المفقودة تشمل: `get_stock_valuation`, `get_stock_valuation_summary`, `get_costing_overview`, `get_product_costing_detail`, `get_cost_history`, `get_supplier_price_impact`, `get_order_margin`, `get_expiring_batches`, `get_low_stock_alerts/summary`, `add_inventory_batch`, دورة الجرد الكاملة (8 دوال)، سلسلة المشتريات الكاملة (13 دالة)، `register_branch`.

> `get_active_shift` موجود لكنه يرفض جلسة anon ⇒ يؤكد أن الـschema يتوقف عند حدود متوسطة وليس حتى 036.

---

## 3) الإصلاحات (Fixes)

### 3.1 `supabase/migrations/076_fix_stock_valuation_ambiguity.sql` (additive-only)
- يعيد تعريف نفس التوقيع `(p_branch_id uuid, p_warehouse_id uuid)` مع تأهيل `u.branch_id` لكسر الغموض.
- لم يُطبَّق على أي بيئة قبل الآن ⇒ التعديل قانوني تحت قاعدة additive migrations.
- طُبّق على الكتلة المعزولة المحلية: `Done: 1 applied, 0 skipped`؛ وتحقق مباشر أن `get_stock_valuation(NULL,NULL)` يعمل.

### 3.2 `tests/integration/stock_valuation.test.ts` (5 اختبارات، كلها خضراء)
1. توقيع الدوال عبر `pg_get_function_identity_arguments` = `p_branch_id uuid, p_warehouse_id uuid`.
2. حساب weighted-average للمسؤول عبر كل الفروع.
3. تصفية الفرع للمسؤول.
4. **Regression 076**: قفل الموظف على فرعه (كان يكشف خطأ الغموض).
5. اتساق `get_stock_valuation_summary` مع التفاصيل.

### 3.3 `scripts/db/check-production-parity.js` — بوابة ترابط الإنتاج
- يستخرج من الكود الفعلي **أسماء دوال الـRPC + معاملاتها** (`src/api/modules.ts`) و**جداول `supabase.from()`** في كل `src`.
- يفحص Production عبر REST بنفس الحجج التي يرسلها التطبيق (POST `/rpc/<name>`، GET `/rest/v1/<table>`).
- قاعدة الحكم: `404 PGRST202/PGRST205` = كائن غائب = **فشل بوابة**؛ أي استجابة أخرى (200/400/401/403/500) = الكائن موجود.
- **قراءة فقط فقط** — لا يعدّل Production أبدًا.

### 3.4 `.github/workflows/deploy.yml` — السلسلة أصبحت:

```
verify → db → e2e → parity → deploy
```

باب `parity` (needs: e2e) يسبق `deploy` مباشرة؛ أي كائن ناقص في Production يُجهض النشر — **تستحيل الآن نشر واجهة أحدث من قاعدة البيانات.**

---

## 4) النتائج والأدلة (Evidence)

### محليًا (قبل الدفع)
| الفحص | النتيجة |
|---|---|
| `npm run verify:full` | ✅ typecheck:all، lint (0 errors)، build، **257 unit** |
| `npm run test:integration` | ✅ **167 integration (12 files)** متضمنة `stock_valuation.test.ts` |
| `npx playwright test` | ✅ **50 passed (2.0m)** |
| بوابة الترابط ضد Production | ✅ تعمل: ترصد بدقة **33 RPC + 2 جدول** ناقصين (exit 1) |

### CI (GitHub Actions run 31907293156 على `50bbde3`)
| job | الحالة |
|---|---|
| `verify` | ✅ success |
| `db` | ✅ success |
| `e2e` | ✅ success |
| `parity` | ❌ **failure** (القائمة الكاملة للـ33/2 ناقصًا في سجل الخطوة) |
| `deploy` | ⏭️ **skipped** — لم يُنشر البندل الأحدث على قاعدة متخلفة ✅ |

**هذا هو السلوك المطلوب بالضبط:** البوابة تمنع النشر حتى يصبح الـDB في ترابط مع الواجهة.

---

## 5) المتبقي (Remaining) — يحتاج صلاحية Production رسمية

| الخطوة | الأداة | الملاحظة |
|---|---|---|
| ترحيل Production إلى 036→075 + 076 | `scripts/db/apply-migration.js` | additive-only، checksum، `--dry-run` متاح؛ يتطلب `SUPABASE_DB_URL` **الإنتاجي** (غير متوفر حاليًا في `.env` المحلي) |
| إعادة التحقق | `node scripts/db/check-production-parity.js` | يجب أن تنتهي بـ exit 0 |
| النشر | push إلى `development/master-log2` | ستعبر السلسلة `parity`→`deploy` بنجاح |

> لم تُمسّ Production إطلاقًا؛ لم يُنفَّذ أي SQL يدوي؛ بوابة النشر تحمي الآن من أي تراجع مستقبلي.
