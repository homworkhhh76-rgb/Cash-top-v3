# إعداد إشعارات Push عبر Firestore

الإشعارات الداخلية تعمل عبر Service Worker بعد منح المتصفح الصلاحية. الإشعارات العامة التي يرسلها المشرف من `admin-notifications.html` تحتاج خدمة Web Push على الخادم.

## المتطلبات

1. نشر مساري `/api/push/subscribe` و`/api/push/send` من مجلد `push-api-example`.
2. ضبط: `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_ADMIN_SECRET`.
3. وضع `VAPID_PUBLIC_KEY` في `push-config.js` وضبط `apiBase`.
4. منح المستخدم صلاحية الإشعارات.

تُخزن اشتراكات الأجهزة في مجموعة `pushSubscriptions` بواسطة Firebase Admin SDK. محتوى الإشعار لا يُحفظ في قاعدة البيانات.
