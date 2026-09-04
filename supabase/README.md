# قاعدة البيانات (Supabase)

يحتوي هذا المجلد على ملفات SQL المطلوبة لبناء قاعدة بيانات تطبيق نقاط البيع،
وأدوات لتطبيقها والتحقق منها تلقائيًا.

## البنية

- `migrations/` — الترتيب الكنسي (001–047). هذا هو مصدر الحقيقة الوحيد:
  كل جدول/دالة يُبنى منها قاعدة كاملة قابلة للتكرار.
- `legacy/` — ملفات قديمة استُبدلت بالترقيم الجديد، محفوظة للمرجعية فقط ولا تُطبَّق.
- `ci/stub_auth.sql` — يحاكي الحد الأدنى من بيئة Supabase Auth (أدوار
  `anon/authenticated/service_role` + جداول `auth.*` + `auth.uid()`/`auth.jwt()`)
  لتمكين التحقق في حاوية PostgreSQL عادية. في نسخة الاختبارات، `auth.uid()`
  يقرأ GUC `app.user_id` لانتحال هوية المستخدم عبر اختبارات RLS. **لا يُطبَّق على
  قاعدة Supabase حقيقية** — في CI فقط.

## التطبيق

استخدم `scripts/db/apply-migration.js` (لا تلصق الملفات في SQL Editor بعد الآن):

```bash
# من مجلد الجذر، بعد ضبط SUPABASE_DB_URL (أو DATABASE_URL) في .env
node scripts/db/apply-migration.js --dir supabase/migrations   # كل المهاجرات
node scripts/db/apply-migration.js --file supabase/ci/stub_auth.sql  # CI/محلي فقط
node scripts/db/apply-migration.js --dir supabase/migrations --dry-run  # تجربة داخل BEGIN/ROLLBACK
```

- المسار يُحفظ في `schema_migrations` مع SHA-256؛ إعادة التشغيل تتخطى المطبَّق.
- تعديل مهاجرة مطبَّقة مرفوض (خطأ `42P13`). لتغيير قاعدة حية، أضف مهاجرة جديدة.
- كل الملفات **إضافية فقط** (additive-only): لا تعديل لمهاجرة مطبَّقة، ولا حذف
  بيانات — إن استدعى الأمر إسقاط توقيع دالة قديم (مثل overload متجاوز)، يُوثَّق
  داخل المهاجرة الجديدة مع سبب الإسقاط.
- الاتصال المحلي بلا SSL؛ لـ Supabase pooler استخدم `sslmode=require` في الرابط.

## التحقق

```bash
node scripts/db/verify-schema.js        # عدد الجداول/الدوال مقابل القاعدة
npm run test:integration                # اختبارات تكامل (داخل BEGIN/ROLLBACK، آمنة على الحية)
```

اختبارات التكامل تعمل داخل معاملة واحدة وتُتراجع، فلا تترك أثرًا على قاعدة حية.
عند غياب رابط قاعدة في `.env` تُتخطى تلقائيًا.

## ملاحظات

- أي تغيير بنيوي على قاعدة حية = مهاجرة جديدة مرقّمة في `migrations/`.
- بعد تطبيق تغييرات عبر PostgREST، أعد تحميل الكاش (`NOTIFY pgrst, 'reload schema'`).
