# Revision 59 — إصلاح مزامنة Firestore

## سبب التعطل

طبقة Firestore في Revision 58 كانت تنفذ `signInAnonymously()` كشرط إجباري قبل أول قراءة أو كتابة. كود الاختبار الذي زوده المستخدم يعمل مباشرة عبر `initializeApp()` و`getFirestore()` من دون Firebase Authentication؛ لذلك عند عدم تفعيل Anonymous كانت المزامنة تتوقف قبل الوصول إلى Firestore.

## الإصلاح

- بدء Firestore مباشرة بنفس تسلسل كود الاختبار الناجح.
- عدم استدعاء Anonymous Authentication ما دامت قواعد Firestore تقبل الطلب.
- عند ظهور `permission-denied` أو `unauthenticated` فقط، يحاول النظام Anonymous مرة واحدة ثم يعيد العملية.
- فشل Anonymous لا يسمم تهيئة Firestore ولا يمنع المحاولات المباشرة اللاحقة.
- إبقاء IndexedDB persistent cache.
- فتح شبكة Firestore عند المهمة وإغلاقها بعد اكتمال القراءات والكتابات المعلقة.
- رفع إصدار Service Worker إلى v69 لمنع استمرار تحميل ملفات Revision 58 من الكاش القديم.

## الاختبارات المحلية

- PUT/GET لبيانات Dataset.
- بيانات كبيرة مجزأة إلى أكثر من Chunk.
- PUT/PATCH/GET لبيانات meta.
- PUT/GET لبيانات الأدمن والشركات.
- نجاح المسار المباشر من دون أي محاولة Anonymous.
- نجاح إعادة المحاولة بعد `permission-denied` عند توفر Anonymous.
