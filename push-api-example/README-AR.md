# API إشعارات Push لكاش توب عبر Firestore

تُخزن اشتراكات Web Push في مجموعة `pushSubscriptions` داخل مشروع Firestore. تستخدم خدمة الخادم Firebase Admin SDK، لذلك لا تعتمد على قواعد واجهة الويب.

المتغيرات المطلوبة: `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_ADMIN_SECRET`.

بعد نشر `subscribe.js` و`send.js` كمساري `/api/push/subscribe` و`/api/push/send` ضع VAPID Public Key في `push-config.js`.
