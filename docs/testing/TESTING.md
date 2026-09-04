# اختبارات Premier POS/ERP — الدليل

> آخر تحديث: 2026-08-08 (PHASE 8 — بعد توسعة الغطاء).

## الطبقات الثلاث

| الطبقة | الأداة | متى تُشغَّل | ماذا تتحقق |
|---|---|---|---|
| **Unit** | Vitest + jsdom | `npm run test:unit` (دائمًا) | دوال خالصة + hooks + نموذج الصلاحيات + تنسيقات |
| **Smoke (مكوّنات)** | Vitest + Testing Library + supabase mock | `npm run test:unit` | كل صفحة تُجمَّع وتُعرض بلا انهيار (31 صفحة) |
| **Integration** | Vitest node + Postgres حقيقي (معاملة تُتراجع) | `npm run test:integration` (يتطلب `SUPABASE_DB_URL` في `.env` وإلا تُتخطى) | RLS isolation matrix + دوال PostgreSQL (pricing، floorplan orders) |

## أين الاختبارات

```
tests/
├── unit/
│   ├── lib/
│   │   ├── format.test.ts            # عملة/أرقام/تواريخ (ar-SA)، أرقام فواتير
│   │   ├── brandColor.test.ts        # ألوان العلامة التجارية
│   │   ├── permissionDefs.test.ts    # 62 إذنًا: consistency + matrix roles
│   │   └── posMath.test.ts           # إجماليات POS: خصم مبلغ/نسبة، ضريبة، باقي، آجل، سلة فارغة
│   └── hooks/
│       ├── usePaginatedRows.test.ts  # ترقيم: page1، filters، loadMore، refresh، setRows، enabled، error
│       └── useBranches.test.ts       # كاش وحدات، refresh، استرداد خطأ
├── components/
│   └── pages.smoke.test.tsx          # 31 صفحة ضد mock ثابت {data:[],error:null}
└── integration/
    ├── db.ts / rls.ts                # مساعدو اتصال/انتحال (SET LOCAL ROLE + app.user_id + SAVEPOINT)
    ├── rls_branch_isolation.test.ts  # 92+ حالة عزل فروع
    ├── floorplan_orders.test.ts      # دورة طاولة/طلب + guards (create_order/set_order_status/update_order/detach)
    └── process_sale_pricing.test.ts  # تسعير قسري + كبس الخصم + فشل التسوية لا يكتب sale (C1)
```

## قواعد إضافة اختبار جديد

1. **منطق خالص → Unit:** استخرج الحسابات المعقدة من المكوّنات إلى `src/lib/*` (مثل `posMath.ts`) ثم اختبرها.
   لا تختبر الحساب من داخل DOM — بطيء وهشّ.
2. **hooks → `renderHook` من Testing Library** مع mock لـ `@/api` (وليس `@/lib/supabase` مباشرة — لتغطية الـ barrel).
3. **تغيير شكل استعلام → أضِف أو حدِّث اختبار Integration** (الـ smoke لا يلتقط شكل البيانات؛ mock ثابت).
4. **أي منطق DB جديد (RPC/RLS) → اختبار integration** داخل معاملة تُتراجع: `SET LOCAL ROLE authenticated` + `app.user_id`
   وانتحال، مع إعادة تعيين بعد الاختبار وSAVEPOINT للاسترداد.
5. **اختبار يمسك خطأً = خطأ حقيقي:** إذا فشل اختبار جديد بشكل مشروع، أصلح الشيفرة (لا تُضعِف الاختبار).
   مثال فعلي: اختبار `useBranches` كشف أن `error` لا يُصفّر عند نجاح refresh — أُصلح الـ hook.

## الأوامر

```bash
npm run typecheck        # tsc -p tsconfig.app.json
npm run lint             # eslint (0 أخطاء)
npm run test:unit        # 90/90
npm run test:integration # 132/132 عند توفر SUPABASE_DB_URL
npm run verify           # schema 51 جدولًا / 50 دالة
npm run build
```

## ملاحظات بيئة

- بيئة Windows/PowerShell: النصوص الطويلة تُكتب بحذر؛ استخدم `workdir` بدل `cd` في الأوامر المتعددة.
- `test:integration` في CI: تُطبَّق `supabase/ci/stub_auth.sql` + كل المهاجرات ثم تعمل المصفوفة (لا تترك أثرًا).
- بعد تغيير schema على قاعدة حية: `NOTIFY pgrst, 'reload schema'`.
