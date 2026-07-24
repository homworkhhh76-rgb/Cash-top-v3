# Revision 61 — إصلاح FIRESTORE INTERNAL ASSERTION

- تحديث Firebase JavaScript SDK من `10.12.2` إلى `12.16.0`.
- فصل صفحة `admin.html` عن `firestore-bridge.js` حتى لا تعمل طبقتان Firestore مستقلتان داخل لوحة الإدارة الرئيسية.
- تهيئة قواعد الإدارة المتعددة عبر `initializeFirestore` مع Memory Cache و`ignoreUndefinedProperties`.
- استخدام Long Polling تلقائياً داخل Android WebView/Alif IDE لتجنب مشاكل WebChannel والـ proxy buffering.
- إضافة استرداد تلقائي: عند ظهور `INTERNAL ASSERTION FAILED / Unexpected state` يتم إنهاء عميل Firestore التالف، حذف تطبيق Firebase المسمى، إنشاء سياق جديد، ثم إعادة العملية مرة واحدة فقط.
- تطبيق الحماية نفسها على `firestore-bridge.js` للصفحات التشغيلية.
- رفع رقم كاش Service Worker لمنع استمرار تحميل ملفات Revision 60 القديمة.
