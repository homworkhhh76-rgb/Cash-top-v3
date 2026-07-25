# Revision 69 — مزامنة Firestore بين الأجهزة على أساس Revision 63

تم الاحتفاظ بطريقة تسجيل الدخول الأصلية من Revision 63 كما هي.

## ما تم إصلاحه

1. استبدال جسر المزامنة في صفحات النظام بـ Firestore Lite لتجنب حالة SDK الداخلية `Cannot read properties of null (reading database)`.
2. أول دخول من كل هاتف ينفذ سحباً كاملاً لكل datasets الخاصة بالشركة.
3. ترتيب النسخ يعتمد أولاً على رقم `revision` المتزايد في Firestore، وليس على `Date.now()` الخاص بكل هاتف.
4. لا تُحذف عملية الرفع من الطابور إلا بعد إعادة قراءة المستند والتأكد من وصول التعديل.
5. استعادة النسخة الاحتياطية تستخدم `forceReplace` وتبقى معلقة حتى يتم تثبيت كل dataset في Firestore.
6. عمليات الحذف القادمة من Firestore تحذف القيمة المحلية فعلياً.

## الملفات الرئيسية المعدلة

- `firestore-bridge.js`
- `firebase-sync.js`
- `cashtop-core.js`
- `service-worker.js`
- مراجع الإصدارات داخل صفحات HTML

## ملفات تسجيل الدخول غير المعدلة

- `login.js`
- `multi-database.js`
- `firebase-config.js`
