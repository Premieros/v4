# KNOWN ISSUES — Premier POS/ERP

> آخر تحديث: 2026-08-08 — فرع `stabilization/refactor`.
> الحالة: بعد PHASES 0–9 (أخطاء النواة الحرجة C1/C2 أُصلحت في 045/046؛ الباقي ملاحظات مقبولة أو مقترحات مستقبلية).

## حرجة (CRITICAL)

لا توجد أخطاء حرجة مفتوحة. C1 (`process_sale` يكتب قبل التحقق من الطلب) وC2 (`holdOrder` يكرّر الطلب) أُصلحا في الهجرات 045/046 مع اختبارات regression.

## متوسطة (MEDIUM)

| # | الوصف | المكان | الحالة |
|---|---|---|---|
| M1 | `PosPage` و`FloorPlanPage` يحتفظان بحالة طاولة/طلب منفصلة محليًا (لا مخزن مشترك)؛ التنقل بينهما عبر `location.state` يضيع عند refresh مباشر | `features/pos/*` | مفتوح — مقترح: مخزن POS مشترك |
| M2 | `PosPage` (~1630 سطرًا) لا يزال ضخمًا؛ تقسيمه الكامل خارج النطاق (استُخرج `posMath.ts` فقط) | `PosPage.tsx` | مفتوح — تحسين مقترح |
| M3 | استعلامات تقارير/داشبورد مقيدة بالتاريخ لكنها قد تجلب آلاف الصفوف في نطاق «سنة» | `ReportsPage`, `DashboardPage` | مفتوح — مقترح: ترقيم خادم أو تصدير مباشر |
| M4 | فحص شكل البيانات في smoke test ضعيف (mock يرد `{data:[],error:null}`) — تغيير شكل الاستعلام لا يُكتشف | `tests/components/pages.smoke.test.tsx` | مفتوح — تحسين مقترح |

## منخفضة (LOW)

| # | الوصف | المكان | الحالة |
|---|---|---|---|
| L1 | `get_login_email` أنون-callable (SECURITY DEFINER) — سطح تعرّف مستخدمين خفيف (مقبول لخدمة PIN login) | migration `007/008` | مقبول |
| L2 | `loadStock`/`loadSummary` في PosPage تُعاد عند تغيير الفرع بلا debounce | `PosPage.tsx` | مقبول |
| L3 | دوال/أنواع غير مستخدمة توثّق في `CANDIDATE_FOR_REMOVAL.md` (لا تُحذف بدون تأكيد) | `src/lib/*` | مقبول |

## أمان

- لا توجد قيم سرية مكشوفة في الشيفرة أو git history. `.env` غير متتبع؛ `.env.production` أُخرج من التتبع وحُذف.
- `xlsx` رُقّي إلى SheetJS `0.20.3` (إغلاق CVE-2023-30533 + CVE-2024-22363) عبر `vendor/xlsx-0.20.3.tgz` — لا يعتمد على السجل npm الرسمي، ويبقى lazy chunk.

## عمليات/نشر

- `npm run test:integration` يتطلب `SUPABASE_DB_URL` (أو `DATABASE_URL`) في `.env`؛ عند غيابه تُتخطى الاختبارات تلقائيًا. الاختبارات تعمل داخل معاملة واحدة تُتراجع — لا أثر على قاعدة حية.
- بعد تغيير schema، يجب إعادة تحميل كاش PostgREST: `NOTIFY pgrst, 'reload schema'`.
