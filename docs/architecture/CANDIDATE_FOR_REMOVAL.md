# CANDIDATE FOR REMOVAL — Premier

> هذه القائمة تحصر العناصر التي **يُشتبه** بأنها غير مستخدمة، مع الدليل. القاعدة: لا حذف لأي عنصر مشكوك فيه حتى يتم التحقق من كل الاستيرادات/المراجع. عنصر يوضع هنا ثم يُنقل لحذفه في PHASE 3 بعد التأكيد النهائي.

> **حالة PHASE 3 (تم التنفيذ):** أُزيلت الحزم غير المستخدمة، وأُخرجت الملفات الحساسة/بقايا scaffold من التتبع وحُذفت من القرص. تبقّى «دوال/أنواع غير مستخدمة» و«مشكوك فيه» للفصل في PHASES 5–17 حسب الحاجة.

## الحزم (package.json)

| الحزمة | السبب | التحقق | الحالة |
|---|---|---|---|
| `date-fns@^4.4.0` | صفر imports في src/ وtests/ | confirmed by grep | ✅ أُزيلت |
| `@testing-library/user-event@^14.6.3` | صفر imports في src/ وtests/ | confirmed by grep | ✅ أُزيلت |

## ملفات مرفوعة في git (يجب إزالتها من التتبع)

| الملف | السبب | التحقق | الحالة |
|---|---|---|---|
| `.env.production` | متتبع رغم `.gitignore` (`d483eb6`)؛ tripwire للتسريب | `git ls-files` | ✅ أُخرج من التتبع وحُذف |
| `START SERVER.bat` | مسار جهاز مخصوص (`cd /d D:\pos3\project`) | committed | ✅ حُذف |
| `.bolt/config.json` + `.bolt/prompt` | بقايا scaffold من bolt.new | committed | ✅ حُذف |

## ملفات على القرص غير متتبعة (مؤهلة لحذف القرص فقط)

| الملف | السبب | الحالة |
|---|---|---|
| `dist/` | ناتج build قديم؛ CI يعيد بناؤه | ⏳ يُحذف في PHASE 4 مع build جديد |
| `tsconfig.app.tsbuildinfo` | بقايا في الجذر؛ الإعداد الحالي يكتب لـ `node_modules/.tmp` | ✅ حُذف |
| `tsconfig.node.tsbuildinfo` | نفس السبب | ✅ حُذف |

## دوال/أنواع غير مستخدمة (لا حذف قبل تأكيد)

| العنصر | الملف | الاستخدام |
|---|---|---|
| `downloadTemplate` | `src/lib/excel.ts` | غير مستورد |
| `applyBrandHex` | `src/lib/brandColor.ts` | غير مستورد |
| `StatementLineInput` | `src/api/types.ts` | غير مستورد |
| 29 نوعًا | `src/lib/types.ts` | غير مستوردة خارج الملف (انظر FULL_AUDIT §8) |
| `translations` | `src/lib/i18n.ts` | مستخدم داخليًا فقط — **لا تحذف** (مصدَّر بلا حاجة) |

## يُحتفظ بها عمدًا (لا تحذف)

| العنصر | السبب |
|---|---|
| `supabase/legacy/*` | أرشيف مرجعي مقصود، لا يُطبَّق |
| `supabase/migrations/*` | سجل تاريخ قاعدة البيانات — ممنوع الحذف (القاعدة 3) |
| `dist/` (في CI) | ناتج build الجديد |
