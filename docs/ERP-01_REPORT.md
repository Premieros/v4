# ERP-01 — تقرير التنفيذ والتحقق

- الحالة: **VERIFICATION PENDING** — لم تُغلق ERP-01 بعد؛ الإغلاق يتوقف على إكمال بوابات CI (التي كشفت خللين وعولجا أدناه) ثم المراجعة والدمج.
- الفرع: `erp-01-settings-organization` (قاعدة `main` بعد دمج P7).
- `main`: لم يُلمس. **PR #5 مفتوح** (https://github.com/Premieros/Premier/pull/5) — لم يُدمج. لم يُبدأ ERP-02.
- التاريخ: 2026-08-14 (إعادة تحقق نهائية + أول تشغيل حي للـDB suite في CI عبر PR #5).

---

## 1. البوابات المحلية — ✅ VERIFIED (أُعيد تشغيلها اليوم على تثبيت نظيف)

شُغِّلت جميع البوابات المحلية من جديد في هذه الجلسة على الفرع `erp-01-settings-organization` بعد `npm ci` نظيف. النتائج الفعلية:

| البوابة | النتيجة الفعلية (2026-08-14) |
|---|---|
| `npm ci` | ✅ added 480 packages (audited 481). انتباه غير مُعطِّل: تحذير `allow-scripts` حول postinstall الخاص بـ`esbuild` — لم يؤثر على أي بوابة لاحقة |
| `npm run lint` | ✅ 0 أخطاء / 16 تحذيرًا (كلها سابقة الوجود، مطابقة لما هو موثّق) |
| `npm run typecheck` | ✅ (tsconfig.app.json) |
| `npm run typecheck:all` | ✅ (app + tsconfig.test.json، يشمل `tests/e2e`) |
| `npm run test:unit` | ✅ 236/236 عبر 19 ملفًا (tests/unit + tests/components) |
| `npm run build` | ✅ built in ~25s (vite build) |

> ملاحظة تسجيل: عدد الحزم الفعلي بعد `npm ci` اليوم هو 480 (التقرير السابق دوّن 477). الفرق نتيجة اختلاف دقّة إصدار npm في الحل، وليس تغييرًا في التبعيات.

## 2. `npm run test:integration` — ✅ VERIFIED في CI (المحلي: BLOCKED BY ENVIRONMENT)

- أُعيد تشغيله اليوم: **10 ملفات / 154 اختبارًا، كلها skipped (154/154)**.
- السبب: لا يوجد `.env` في الشجرة (مُستثنى عبر git)، ولا Postgres محلي مثبّت، ولا Docker، ولا قيمة `SUPABASE_DB_URL`/`DATABASE_URL`/`POSTGRES_URL`. `getDbUrl()` (tests/integration/db.ts) يقرأ من البيئة أو `.env` فقط، و`describe.skipIf(skip)` يُسكّت المجموعة كاملة عند غيابها.
- **لذلك لا يُحسب هذا البوابة ناجحًا.** يُسجَّل رسميًا: `NOT EXECUTED — ENVIRONMENT BLOCKED`.
- ما يغطيه عند تشغيله الحي/CI: `kitchen_sends` (069)، `update_order` (046)، `rls_branch_isolation` (110)، `rbac_hardening`، `phase4_security_contract`، `process_sale_pricing`، `process_sale_order_settlement`، `p0_security_hardening`، `floorplan_orders`، `order_lifecycle_guards`.
- الطريق المُصادق عليه في هذا المستودع لتشغيله محليًا هو نهج CI نفسه (`.github/workflows/verify-main.yml` `db` job): Postgres محلي + `stub_auth.sql` + الهجرات + `verify-schema.js` + `disable_subscription_guard.sql` + `seed_raw_material_branch.sql` ثم `npm run test:integration`. لا يُنسخ في `.env` أي قيمة مخترَعة.

### 2.1. أول تشغيل حي في CI (عبر PR #5) — كشف خللين وعولجا

- **`npm ci` فشل في `verify` job** رغم نجاحه محليًا: lockfile المولّد محليًا بـ npm 11 فقد حزم `esbuild@0.28.x` المطلوبة من rolldown-vite (الذي يجره vitest 4.x)، وnpm 10 في CI (Node 22) يرفضها (EUSAGE). **الإصلاح:** أُعيد توليد `package-lock.json` بـ npm 10.9.9 → `npm ci` متوافق محليًا وفي CI (commit `2382280`).
- **`db` job شغّل حزمة integration حيًا: 154 اختبارًا → 153 نجحت / 1 فشل** — «resume + add item + send + payment: only the new line reaches KDS (ERP-01)». لم تلتقطها القراءة الثابتة (القسم 4):
  - السبب: في إعادة كتابة 069، الأسطر **الجديدة** المدرَجة في `order_items` لم تُسجَّل في `_upd_matched`، فحذفها سَيرُ الحذف فورًا (`DELETE ... NOT EXISTS (_upd_matched)`) → اختفت السلعة المضافة من السلة → `items_sent_count` = 0 بدل 1.
  - **الإصلاح:** `INSERT ... RETURNING id INTO v_matched_id` ثم تسجيل السطر الجديد في `_upd_matched` (commit `d4c5e84`). **إعادة تشغيل CI النهائية: 154/154 ✅ (run 31813850004).**

### 2.2. أول تشغيل لـ browser-smoke (E2E) — فشل 9/50 بسبب مواصفة قديمة → حُدِّثت

- **41/50 نجحت** (public-smoke 38 + dashboard-navigation 3)؛ فشلت الـ9 في `pos-actions.spec.ts` كلها في نفس السطر (`beforeEach`): كانت تنتظر `pos-order-type-picker` فور الدخول إلى `/pos`.
- السبب: تغيير ERP-01 (بند B) جعل الـPOS يفتح مباشرة على Takeaway، والمُنتقي (`OrderStartWizard` → `OrderTypePicker`) لا يظهر إلا عبر زر **New Order** (`setStartStep('type')`). المواصفة كُتبت قبل التغيير.
- **الإصلاح:** أُضيف `data-testid="pos-action-new-order"` إلى زر New Order في `PosTopBar`، وحدّث `beforeEach` لفتح المُنتقي عبره قبل تأكيد ظهوره. كل testids المستخدمة في المواصفة موجودة في الكود الجديد (تحقّق بالقراءة). **إعادة تشغيل CI النهائية: 50/50 ✅ (run 31813850004).**

## 3. E2E — ⚠️ BLOCKED BY ENVIRONMENT (المتطلبات محددّة بالضبط)

توجد 3 ملفات: `tests/e2e/pos-actions.spec.ts` (9 اختبارات)، `public-smoke.spec.ts` (38 اختبارًا: صفحة الدخول + التحقق + 36 مسارًا محميًا)، `dashboard-navigation.spec.ts` (3 اختبارات) — إجمالي **50 اختبارًا**.

**السبب الدقيق للحجب:** `src/lib/supabase.ts` ينفّذ `createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)` عند تحميل الوحدة، و`@supabase/supabase-js` يرمي خطأً متزامنًا (`supabaseUrl is required.` / `supabaseKey is required.`) عند غياب أي منهما. هذا الملف مستورد بشكل حتمي من `AuthContext`/`SettingsContext`/`RolesContext`/`api/client.ts` — وبالتالي **التطبيق كله (حتى صفحة الدخول في `public-smoke`) لا يُقلع دون القيمتين في وقت البناء**، لا لأن الشبكة غير مضمّنة بل لأن العميل نفسه يفشل في الإنشاء.

**ما يلزم بالضبط لتشغيلها محليًا:**

1. ملف `.env` (git-ignored، يُقرؤه Vite تلقائيًا) يحتوي:
   - `VITE_SUPABASE_URL` — **يجب أن يكون مساويًا حرفيًا** `https://lwnsdsncmlsroiswgoga.supabase.co` لأنه ثابت `SUPABASE_ORIGIN` الذي تلتقطه `page.route()` في `pos-actions` و`dashboard-navigation`؛ أي قيمة مختلفة تعني عدم اعتراض الشبكة.
   - `VITE_SUPABASE_ANON_KEY` — أي قيمة غير فارغة تكفي للتدفقات المقلّدة بالكامل (CI يستخدم مفتاح النشر العام الحقيقي من `.github/workflows`).
2. `npm run build` مع توفر القيمتين أعلاه (يُنتج `dist/`).
3. `npm run preview -- --host 127.0.0.1 --port 4173` — يشغّله Playwright تلقائيًا عبر `webServer` في `playwright.config.ts`، لذلك ليس خطوة يدوية.
4. `@playwright/test` مصرَّح به كـdevDependency (`^1.62.1`, commit `32d2faa`) ✅ ومثبّت، وchromium revision 1234 مثبّت محليًا ومطابق لما يتوقعه الإصدار ✅.
5. التشغيل: `npx playwright test` (project chromium؛ في CI: `npx playwright test --project=chromium`).

لا تُستخدم قيم CI هذه في هذه الجلسة لأن التعليمات صريحة بعدم استخدام/اختراع قيم البيئة — يُترَك ذلك للبيئة المؤهلة (CI أو `.env` يوفره المستخدم).

## 4. مراجعة الهجرة 069 وRLS/RBAC — ✅ VERIFIED (قراءة ثابتة)

- الهجرة `supabase/migrations/069_resume_order_kitchen_incremental.sql` تُعيد تعريف **فقط** `public.update_order` بنفس التوقيع (additive). لا تغيير في الجداول/الأعمدة/المنح/الـRLS/كائنات schema.
- مقارنة 046 ↔ 069 سطرًا بسطر:
  - **محفوظ بالكامل**: تحققات EMPTY_CART / INVALID_STATUS / ORDER_NOT_FOUND / ORDER_NOT_EDITABLE / BRANCH_MISMATCH / TABLE_NOT_IN_BRANCH / INVALID_QUANTITY / PRODUCT_NOT_IN_BRANCH، تحديث `orders`، مزامنة إشغال الطاولة (تحرير القديمة/شغل الجديدة)، وبنية `RETURN`/`EXCEPTION`.
  - **التغيير الوحيد**: إعادة كتابة الأسطر تحفظ `order_item_id` للأسطر المتطابقة (نفس product/unit/price/discount/bonus) عبر جدول مؤقت `_upd_matched ... ON COMMIT DROP` مع `TRUNCATE` في كل نداء؛ الأسطر الجديدة تُدرج، والمحذوفة تُحذف. هذا هو الإصلاح المقصود (C2): لا إعادة إرسال لأصناف مُرسَلة سابقًا، وإعادة حفظ السلة نفسها = no-op للمطبخ.
  - **حدود الإرسال لم تُمس**: `order_kitchen_sends` (UNIQUE على `order_item_id`) + `send_to_kitchen` (ON CONFLICT DO NOTHING) كما في 048 — بقيا كما هما.
  - **عزل الفرع/RBAC**: الحراس `is_pos_admin()` / `get_branch_id()` (مُعرَّفان في 001/004/006) لم تُمس؛ شرط `BRANCH_MISMATCH` في 069 مطابق حرفيًا لـ046.
- **توافق الواجهة الأمامية**: `src/api/modules.ts` ينادي `update_order` بنفس أسماء المعاملات → لا انحراف تعاقدي. `verify-schema.js` لا يتضمن `update_order` بالاسم → لا أثر على فحص schema.
- **التغطية**: `tests/integration/kitchen_sends.test.ts` (7) — إرسال أول، إعادة إرسال no-op، حفظ نفس السلة لا يُعيد الإرسال، resume+إضافة يُرسل الجديد فقط ثم `process_sale` يسوّي السلة كاملة، رفض completed، H4، قراءة RLS داخل الفرع؛ `update_order.test.ts` (7) — C2/H2/M4/H4؛ بجانب `rls_branch_isolation` (110) و`floorplan_orders` (3) وغيرها.
- **الخلاصة**: القراءة الثابتة لم ترصد regression، لكن **التشغيل الحي في CI (القسم 2.1) رصد خللًا حقيقيًا في مسار «الأسطر الجديدة»** (سَير الحذف كان يمسح السطر المُضاف) وعولج بتسجيله في `_upd_matched`. **إعادة التحقق النهائية في CI: 154/154 ✅.**

## 5. ملخص الحالات الثلاث

| البوابة | الحالة |
|---|---|
| `npm ci` | ✅ VERIFIED |
| `npm run lint` | ✅ VERIFIED (0 errors / 16 warnings سابقة) |
| `npm run typecheck` | ✅ VERIFIED |
| `npm run typecheck:all` | ✅ VERIFIED |
| `npm run test:unit` | ✅ VERIFIED (236/236, 19 ملفًا) |
| `npm run build` | ✅ VERIFIED |
| `npm run test:integration` | ✅ **VERIFIED في CI: 154/154** (run 31813850004)؛ محليًا BLOCKED BY ENVIRONMENT (لا DB) |
| E2E (`pos-actions`/`public-smoke`/`dashboard-navigation`) | ✅ **VERIFIED في CI: 50/50** (run 31813850004)؛ محليًا BLOCKED BY ENVIRONMENT |
| مراجعة هجرة 069 + RLS/RBAC | ✅ قراءة ثابتة سليمة لكنها لم تكشف الخلل؛ **التشغيل الحي في CI كشفه وعولج (154/154)** |
| ❌ FAILED (سجل) | أول تشغيل CI: db 1 ❌ (069 — سطر جديد يُمحى) و browser-smoke 9 ❌ (مواصفة قديمة) → كلاهما مُصلَح والتحقق النهائي أخضر |

## 6. الالتزامات المحفوظة

- لا قيمة `SUPABASE_DB_URL`/`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` مخترَعة أو مضافة إلى `.env` أو إلى أي commit.
- لم يُطلب أي secret داخل Git.
- `main` لم يُلمس؛ **PR #5 مفتوح وغير مدمج**؛ ERP-02 لم يُبدأ.
- خللان كشفهما CI وعولجا: lockfile (esbuild@0.28.x) + 069 (مسح السطر الجديد) + مواصفة E2E قديمة (pos-actions) — وكلها مثبّتة بتحقق CI أخضر (run 31813850004).
- توثيق هذه الجلسة committed على الفرع (التحقق النهائي الأخضر يسجَّل بهذا commit).

## 7. الحالة والتالي

- **ERP-01: ✅ COMPLETE** — كل بوابات CI خضراء: `verify` ✅ (unit 236/236)، `db` ✅ (integration 154/154)، `browser-smoke` ✅ (E2E 50/50)، وNetlify deploy preview ✅ (run 31813850004). **PR #5 دُمج في `main` بتاريخ 2026-08-14 (merge commit `0c2d812`).**
- ERP-02 (Product & Recipe Costing) يبدأ الآن من `main` المُحدَّث وفق الخارطة.
