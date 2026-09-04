# تقرير P7 — الإزالة الآمنة للواجهة القديمة + البوابات النهائية

> **الفرع:** `ui-visual-rebuild-6h` — **PR #4** — **HEAD:** `192f9ed`
> **التاريخ:** 2026-08-14

## 1) Consumer Audit (تدقيق كامل للمستهلكين — تم قبل أي حذف)

### DashboardFoodicsPage
- **المستهلكون في المصدر:** 4 ملفات إعادة تصدير فقط:
  - `DashboardPage.tsx` (يُصدّر `DashboardFoodicsPage` كـ `DashboardPage`)
  - `DashboardControlCenterPage.tsx` (Compat export)
  - `DashboardFinalPage.tsx` (Compat export)
  - `DashboardModernPage.tsx` (Compat export)
- **الراوتر:** لا يستخدمها إطلاقًا. مسار `/dashboard` → `DashboardEnhancedPage` → `VisualDashboardPage`.
- **الاختبارات:** `tests/unit/navigationRegression.test.ts` يقرأ محتوى الملف لإثبات عقد لوحة المعلومات.
- **الخلاصة:** لا routes ولا handlers ولا Supabase contracts مرتبطة بالقديم — كل عقد اللوحة أصبح في البديل الحي.

### TypeChangePicker / OrderTypeQuickPicker (مكوّنا POS)
- صفر مستوردات في `src` و`tests` (لا imports مباشرة ولا ديناميكية).
- لا testids مسجّلة لهما في `src/lib/interactionIdentity.ts`.
- لا ملفات barrel تصدّرهما.
- **الخلاصة:** مكوّنان يتيمان (orphans) بدون أي مستهلك.

### حزمة src/ui (AppCard / AppStatCard / index)
- صفر مستوردات في `src` و`tests` (فحص عبر عدة أنماط مسار).
- **الخلاصة:** حزمة كاملة يتيمة.

### Legacy surfaces إضافية
- `DashboardChrome.tsx`: المستهلك الوحيد له هو `DashboardFoodicsPage` القديمة (المحذوفة). كان adapter قشرة قبل أن يحل محله `Layout` كقشرة موحّدة.

## 2) إثبات أن البديل الجديد يحافظ على العقد (قبل كل حذف)

### عقد لوحة المعلومات في VisualDashboardPage (الحيّة)
| العلامة المطلوبة | موجودة في VisualDashboardPage؟ |
|---|---|
| `reportType=sales` | ✅ (خطوط 295, 310, 312, 313) |
| `reportType=sales_by_payment` | ✅ (خطوط 296, 311) |
| `reportType=sales_by_product` | ✅ (خط 390) |
| `reportType=detailed_invoices` | ✅ (خطوط 309, 397) |
| `to="/inventory"` | ✅ (خط 409) |
| `setCompareEnabled` | ✅ (خط 132) |
| `setFilterOpen` | ✅ (خط 133) |
| لا يوجد `sales_by_branch` | ✅ |
| لا يوجد `/pos/active` | ✅ |

### سجل الهوية التفاعلية (interactionIdentity.ts)
- كل testids لوحة المعلومات (`dashboard-surface`, `dashboard-branch-filter`, `dashboard-compare-toggle`, ...) مثبّتة على `VisualDashboardPage`.
- عقد POS السفلية (`onClick={() => setOrdersOpen(true)}` + aria-label) مثبّتة على `OrderTypeBottomBar` — **مُبقى**.

## 3) الملفات المحذوفة (11 ملفًا — كلها مثبت orphan/legacy)

| الملف | السبب |
|---|---|
| `src/features/dashboard/pages/DashboardFoodicsPage.tsx` | لوحة قديمة؛ البديل `VisualDashboardPage` حي ويثبت كل العقد |
| `src/features/dashboard/pages/DashboardPage.tsx` | غلاف توافق بلا مستهلك (عدا اختبار أُعيد توجيهه) |
| `src/features/dashboard/pages/DashboardControlCenterPage.tsx` | غلاف توافق، صفر مستهلكين |
| `src/features/dashboard/pages/DashboardFinalPage.tsx` | غلاف توافق، صفر مستهلكين |
| `src/features/dashboard/pages/DashboardModernPage.tsx` | غلاف توافق، صفر مستهلكين |
| `src/features/dashboard/components/DashboardChrome.tsx` | قشرة قديمة؛ مستهلكها الوحيد محذوف |
| `src/features/pos/components/order/TypeChangePicker.tsx` | مكوّن POS يتيم، صفر مستهلكين |
| `src/features/pos/components/order/OrderTypeQuickPicker.tsx` | مكوّن POS يتيم، صفر مستهلكين |
| `src/ui/AppCard.tsx` | حزمة يتيمة |
| `src/ui/AppStatCard.tsx` | حزمة يتيمة |
| `src/ui/index.ts` | حزمة يتيمة |

## 4) الملفات المُبقاة (مع السبب)

| الملف | السبب |
|---|---|
| `src/features/dashboard/pages/VisualDashboardPage.tsx` | اللوحة الحية (عقد 6H-C) |
| `src/features/dashboard/pages/DashboardEnhancedPage.tsx` | مكوّن المسار الحي `/dashboard` |
| `src/features/pos/components/order/OrderTypePill.tsx` | مستخدم في الواجهة الحية |
| `src/features/pos/components/order/OrderStageBadge.tsx` | مستخدم في الواجهة الحية |
| `src/features/pos/components/order/OrderStatusBadge.tsx` | مستخدم في الواجهة الحية |
| `src/features/pos/components/order/CurrentOrderPanel.tsx` | لوحة الطلب الحالية |
| مكوّنات wizard/الطاولات/الطلبات/المطبخ | جميعها بمستهلكين أحياء |
| `orderLabels.ts` / `orderStage.ts` / `orderState.ts` / `orderTypes.ts` | خرائط أنماط تُستخدم من مكونات حية |

## 5) تعديلات الاختبارات والإعداد (لا إضعاف لأي عقد)

| الملف | التعديل |
|---|---|
| `tests/unit/navigationRegression.test.ts` | أصبح يقرأ `VisualDashboardPage.tsx` (نفس الـ 9 تأكيدات، كلها تنجح). حُذف قراءة `DashboardChrome` البائدة (عقد القشرة الموحدة ما زال مثبّتًا عبر تأكيدات `Layout` + سجل `interactionIdentity`). |
| `tests/components/pages.smoke.test.tsx` | يعرض الآن `DashboardEnhancedPage` (مكوّن المسار الحي) بدل الغلاف القديم. |
| `eslint.config.js` | حذف كتلة الاستثناءات الخاصة بالأغلفة المحذوفة. |

## 6) نتائج الاختبارات

| الفحص | قبل الحذف | بعد الحذف |
|---|---|---|
| Contract tests (7 ملفات) | 117/117 ✅ | 117/117 ✅ |
| lint | 0 أخطاء | 0 أخطاء (16 تحذيرات سابقة الوجود) |
| typecheck:all | ✅ | ✅ |
| test:unit | 213/213 | 213/213 ✅ |
| build | ✅ | ✅ |
| DB/RLS (integration) | — | 153 تخطي محلي (لا DB URL) — يُشغَّل في CI ✅ |
| browser-smoke / E2E | — | يعمل في CI (لا تشغيل محلي) ✅ |

## 7) CI على PR #4 (HEAD `192f9ed`)

| الفحص | النتيجة |
|---|---|
| verify | ✅ success |
| db | ✅ success |
| browser-smoke | ✅ success |
| Redirect rules | ✅ success |
| Header rules / Pages changed | neutral |

**حالة PR #4:** `open` + `draft: True` + `mergeable: True` — **لم يُحوَّل من Draft**، ينتظر نقطة الدمج النهائية وفق قاعدة العمل 3.

## 8) المخاطر / الملاحظات المتبقية

1. `src/features/pos/hooks/usePosSummary.ts` — **غير مستخدم** لكنه hook خارج قائمة P7 الموثّقة؛ لم يُحذف ويحتاج قرار تنظيف مستقبلي.
2. مفتاح i18n `changeOrderType` أصبح بلا مستخدم بعد حذف `TypeChangePicker` (غير خطير).
3. لم يتم الدمج في `main` بعد — التفعيل التلقائي على GitHub Pages يحدث فقط عند دمج PR في نقطة خضراء كاملة.

## 9) ما لم يتغيّر

- لا تغيير في Business Logic، RBAC/RLS، database schema، أو سلوك POS.
- كل الـtestids والـhandlers والـaria والـroutes وSupabase contracts محفوظة وموثّقة في سجل الهوية.

## مراجع
- `docs/REBUILD_MASTER_LOG.md` — سجل الخطط والتقدم (محدَّث بـ P7).
- الالتزام: `192f9ed` — `feat(ui): P7 safe legacy removal + final gate (11 orphan files deleted)`
