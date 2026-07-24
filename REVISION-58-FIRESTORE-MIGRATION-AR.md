# Revision 58 — نقل قاعدة البيانات إلى Cloud Firestore

- استبدال MongoDB API بجسر مباشر إلى Firebase Cloud Firestore باستخدام إعدادات مشروع `ahmed-97701`.
- إضافة IndexedDB persistent multi-tab cache لبيانات Firestore.
- إغلاق شبكة Firestore تلقائياً بعد انتهاء دفعة العمليات عبر `disableNetwork`، وإعادة فتحها عند المهمة التالية.
- تخزين كل Dataset بصورة مستقلة ومجزأة إلى chunks آمنة للبيانات الكبيرة.
- إضافة زر داخل `admin.html` لقراءة فهرس الإدارة وجميع الشركات من MongoDB القديمة ورفعها إلى Firestore.
- إبقاء تصدير/استيراد النسخة الشاملة متوافقاً كمسار نقل احتياطي.
- تحديث Service Worker إلى Cache First فعلي لجميع الصفحات حتى مع توفر الإنترنت، مع تسخين وحدات Firebase SDK الخارجية.
- إزالة MongoDB Driver وواجهة `api/rtdb.js` من الحزمة.
- تحويل مثال Web Push إلى Firebase Admin + Firestore.

## خطوات النشر

1. فعّل Firestore. Anonymous Authentication اختياري، ولا يلزم إذا كانت قواعدك الحالية تسمح لكود الاختبار المباشر.
2. انشر `firestore.rules`.
3. ارفع الحزمة كاملة.
4. افتح الأدمن الجديد واضغط زر النقل المباشر قبل إيقاف MongoDB القديم.
