إعداد المزامنة — كاش توب 2 / Revision 64

يدعم المشروع نوعين من قواعد Firebase:
1) Google Cloud Firestore.
2) Firebase Realtime Database عبر REST.

اختيار النوع:
- Firestore: اجعل databaseURL بالشكل firestore://PROJECT_ID، أو backendMode = firestore-sdk.
- Realtime Database: ضع رابط القاعدة الحقيقي مثل:
  https://PROJECT_ID-default-rtdb.firebaseio.com
  ويمكن وضع backendMode = firebase-rtdb-rest، أو ترك backendMode = auto.

إعداد Firestore:
- قاعدة الإدارة الرئيسية تستخدم firestore.rules.
- قواعد الشركات تستخدم firestore-company.rules مع firebase-company.json.
- فعّل Anonymous Authentication إذا كانت القواعد تتطلب request.auth.
- بيانات الشركة تحفظ داخل companies/{tenantId}/datasets/{datasetKey}.

إعداد Realtime Database:
- انشر database.rules.json باستخدام firebase-rtdb.json، أو من قسم database داخل firebase.json.
- فعّل Anonymous Authentication لأن القواعد المرفقة تستخدم auth != null.
- بيانات الشركة تحفظ داخل:
  cashTopExchange/cashTopPOS/{tenantId}/datasets/{datasetKey}
- فهرس المفاتيح يحفظ داخل:
  cashTopExchange/cashTopAdmin/keyIndex/{companyKey}

إصلاح المزامنة بين الأجهزة:
- قراءة Firestore تتم من الخادم أولاً، وليس من IndexedDB القديم.
- عند انقطاع الشبكة فقط يرجع النظام إلى كاش Firestore المحلي.
- Service Worker لا يخزن أي استجابة تخص Firebase أو Firestore APIs.
- الرفع يليه تحقق بقراءة بعيدة، لذلك لا تظهر رسالة نجاح اعتماداً على كاش قديم.

Cache First:
- جميع صفحات وملفات التطبيق المحلية مخزنة مسبقاً.
- أي صفحة تفتح من Cache Storage فوراً حتى مع توفر الإنترنت.
- تحديث الملفات يحدث في الخلفية ولا يؤخر فتح الصفحة.
- إصدار Service Worker الحالي: v74-server-sync-dual-backend-cache-first.
