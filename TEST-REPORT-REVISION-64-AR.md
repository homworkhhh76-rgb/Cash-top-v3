# تقرير اختبار Revision 64

## الاختبارات المنفذة

- فحص صياغة جميع ملفات JavaScript باستخدام `node --check`.
- التحقق من صحة جميع ملفات JSON.
- التأكد من وجود جميع الملفات المحلية المذكورة في `LOCAL_ASSETS` داخل Service Worker.
- اختبار اختيار نوع القاعدة آليًا في `firebase-config.js`:
  - Firestore عند استخدام `firestore://PROJECT_ID`.
  - Realtime Database عند استخدام رابط `https://...firebaseio.com`.
  - Firestore لقاعدة شركة محفوظة من نظام القواعد المتعددة.
- التحقق من أن كل مراجع `firebase-config.js` و`firestore-bridge.js` و`firebase-sync.js` و`login.js` تستخدم إصدار الكاش `v=64`.
- التحقق من أن Firestore يستخدم `getDocFromServer` و`getDocsFromServer` أولًا، مع fallback للكاش عند انقطاع الشبكة فقط.
- التحقق من أن Service Worker يستثني Firebase RTDB وFirestore APIs من Cache Storage.
- التحقق من أن تسجيل الدخول في وضع RTDB يستدعي تحميل الشركة البعيد ثم يحفظ نفس `tenantId` على الجهاز الجديد.

## النتيجة

نجحت اختبارات الصياغة والإعدادات ومسارات الملفات. الاختبار الحقيقي بين جهازين يتطلب نشر القواعد والنسخة على مشروع Firebase الفعلي، ثم تسجيل الدخول بنفس مفتاح الشركة من الجهازين.
