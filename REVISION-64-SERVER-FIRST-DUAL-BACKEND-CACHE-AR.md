# Revision 64 — مزامنة بين الأجهزة + Firestore/Realtime Database + Cache First

## إصلاح عدم ظهور البيانات على جهاز آخر
- قراءات Firestore التشغيلية أصبحت Server First عبر `getDocFromServer` و`getDocsFromServer`.
- يرجع النظام إلى كاش Firestore المحلي فقط عند انقطاع الشبكة أو تعذر الخادم.
- بيانات Firebase وFirestore الحية لا تدخل في Service Worker Cache.
- التحقق بعد الرفع يقرأ من الخادم، فلا تُعلن المزامنة بناءً على IndexedDB قديم.

## دعم Firestore وRealtime Database
- رابط `firestore://PROJECT_ID` أو `backendMode: firestore-sdk` يشغل Firestore.
- رابط `https://...firebaseio.com` أو `https://...firebasedatabase.app` يشغل Realtime Database تلقائياً.
- أضيف `database.rules.json` مع قواعد Firestore الحالية.
- أضيف قسم `database` إلى `firebase.json`.

## Cache First
- صفحات التطبيق المحلية تفتح من Cache Storage فوراً حتى مع وجود الإنترنت.
- تحديث الملفات يتم في الخلفية ولا يؤخر التنقل.
- المسار `/` يستخدم `index.html` المخزن.
- إصدار Service Worker الجديد هو v74.

## إعداد Realtime Database
عدّل `MASTER_CONFIG` داخل `firebase-config.js`:

```js
databaseURL: 'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
backendMode: 'firebase-rtdb-rest'
```

وفعّل Anonymous Authentication لأن قواعد RTDB المرفقة تعتمد `auth != null`.
