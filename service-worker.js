'use strict';

const CACHE_VERSION = 'v70-firestore-cost-cache-queue';
const APP_CACHE = `cash-top-2-app-${CACHE_VERSION}`;
const REMOTE_STATIC_CACHE = `cash-top-2-remote-static-${CACHE_VERSION}`;

/*
 * حزمة التطبيق المحلية كاملة. التثبيت لا ينجح إلا بعد حفظ كل ملف محلي،
 * لذلك لا يستبدل الإصدار الجديد الكاش القديم بنسخة ناقصة.
 */
const LOCAL_ASSETS = [
  './accounting-engine.js',
  './accounts.html',
  './admin.html',
  './admin.js',
  './app-icon.png',
  './barcode-generator.html',
  './barcode-tools.js',
  './branches.html',
  './cashier.html',
  './cashtop-core.css',
  './cashtop-core.js',
  './cashtop-export.js',
  './cashtop-download-fix.js',
  './cashtop-logo.png',
  './cashtop-printer.js',
  './cashtop-worker.js',
  './customer-groups.html',
  './customers.html',
  './firebase-config.js',
  './firestore-bridge.js',
  './firebase-sync.js',
  './icon-192.png',
  './icon-512.png',
  './index.html',
  './invoice-document.js',
  './invoices.html',
  './invoices.js',
  './journal.html',
  './login.js',
  './manifest.webmanifest',
  './manufacturing.js',
  './materials.html',
  './multi-system.js',
  './multi-database.js',
  './notifications.html',
  './admin-notifications.html',
  './push-client.js',
  './push-config.js',
  './transient-notifications.js',
  './offline.html',
  './printer-settings.html',
  './invoice-designer.html',
  './customer-portal.html',
  './products.html',
  './qr.mp3',
  './sales-offers.html',
  './sands.html',
  './setting.html',
  './shortages.html',
  './storage-settings.html',
  './suppliers.html',
  './tax-settings.html',
  './units.html',
  './warehouses.html',
  './ادارة التصنيع.html',
  './استيراد وتصدير ل كل قسم.html',
  './التقارير.html',
  './العمال والاجور.html',
  './المشتريات.html',
  './المصاريف.html',
  './المناديب.html',
  './الموظفين.html',
  './صفحة تسجيل الدخول.html',
  './لوحة التحكم.html',
  './مرجع المشتريات.html'
];

/* مكتبات العرض فقط. فشل أي مكتبة خارجية لا يمنع تثبيت التطبيق المحلي. */
const REMOTE_STATIC_ASSETS = [
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore-lite.js',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
];

const REMOTE_STATIC_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'www.gstatic.com'
]);

/* Prevent background network refreshes from competing with UI rendering.
 * HTML can refresh relatively often; immutable app assets refresh much less. */
const LOCAL_REFRESH_AT = new Map();
const HTML_REFRESH_MS = 12 * 60 * 60 * 1000;
const STATIC_REFRESH_MS = 48 * 60 * 60 * 1000;
let shellVerificationPromise = null;
let remoteWarmPromise = null;

function localRefreshInterval(request) {
  const url = new URL(request.url);
  return request.mode === 'navigate' || request.destination === 'document' || /\.html$/i.test(url.pathname)
    ? HTML_REFRESH_MS
    : STATIC_REFRESH_MS;
}

function shouldRefreshLocalInBackground(request) {
  const key = canonicalLocalRequest(request).url;
  const now = Date.now();
  const last = Number(LOCAL_REFRESH_AT.get(key) || 0);
  if (now - last < localRefreshInterval(request)) return false;
  LOCAL_REFRESH_AT.set(key, now);
  return true;
}

/*
 * هذه نطاقات بيانات حية. لا يجوز وضع استجاباتها في Cache Storage مطلقاً.
 * كان تخزين GET الخاص بـ Firebase هو سبب قراءة نسخة قديمة من بيانات الشركة
 * وعدم ظهور تعديلات الأجهزة الأخرى.
 */
function isLiveApiRequest(url) {
  const host = String(url.hostname || '').toLowerCase();
  return     host.endsWith('.firebaseio.com') ||
    host.endsWith('.firebasedatabase.app') ||
    host === 'identitytoolkit.googleapis.com' ||
    host === 'securetoken.googleapis.com' ||
    host === 'firestore.googleapis.com' ||
    host === 'firebaseinstallations.googleapis.com' ||
    host === 'fcmregistrations.googleapis.com';
}

function isCacheableRemoteStatic(request, url) {
  if (!REMOTE_STATIC_HOSTS.has(url.hostname)) return false;
  if (request.destination && ['style', 'script', 'font', 'image', 'audio'].includes(request.destination)) return true;
  return /\.(?:css|js|woff2?|ttf|otf|png|jpe?g|svg|webp|gif|mp3)(?:$|\?)/i.test(url.pathname + url.search);
}

async function putIfUsable(cache, request, response) {
  if (!response) return response;
  if (response.ok || response.type === 'opaque') {
    try { await cache.put(request, response.clone()); } catch (_) {}
  }
  return response;
}

async function fetchWithDeadline(request, options = {}, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(request, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLocalAsset(asset) {
  const url = new URL(asset, self.registration.scope).href;
  const request = new Request(url, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin'
  });
  const response = await fetch(request);
  if (!response || !response.ok) throw new Error(`تعذر تخزين ملف التطبيق: ${asset}`);
  return { request, response };
}

async function installCompleteLocalShell() {
  const cache = await caches.open(APP_CACHE);
  const results = await Promise.all(LOCAL_ASSETS.map(fetchLocalAsset));
  await Promise.all(results.map(({ request, response }) => cache.put(request, response)));
}

async function cacheRemoteCssDependencies(cache, styleUrl, response) {
  if (!response || response.type === 'opaque' || !response.ok) return;
  const css = await response.clone().text();
  const urls = [...css.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)]
    .map(match => match[2])
    .filter(Boolean)
    .filter(value => !value.startsWith('data:'))
    .map(value => new URL(value, styleUrl).href);
  await Promise.allSettled([...new Set(urls)].map(async assetUrl => {
    const req = new Request(assetUrl, { mode: 'cors', cache: 'reload' });
    const res = await fetchWithDeadline(req);
    await putIfUsable(cache, req, res);
  }));
}

async function warmRemoteStaticAssets() {
  const cache = await caches.open(REMOTE_STATIC_CACHE);
  await Promise.allSettled(REMOTE_STATIC_ASSETS.map(async url => {
    const lookupRequest = new Request(url, { mode: 'cors' });
    const existing = await cache.match(lookupRequest, { ignoreSearch: false });
    if (existing) return;
    const request = new Request(url, { mode: 'cors', cache: 'reload' });
    const response = await fetchWithDeadline(request, {}, 6000);
    await putIfUsable(cache, request, response);
    if (url.includes('fonts.googleapis.com') || url.endsWith('.css')) {
      await cacheRemoteCssDependencies(cache, url, response);
    }
  }));
}

async function refreshCompleteLocalShell() {
  const cache = await caches.open(APP_CACHE);
  const results = await Promise.allSettled(LOCAL_ASSETS.map(fetchLocalAsset));
  let updated = 0;
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    await cache.put(result.value.request, result.value.response);
    updated += 1;
  }
  return { updated, total: LOCAL_ASSETS.length, complete: updated === LOCAL_ASSETS.length };
}

async function verifyLocalShellOnce() {
  const cache = await caches.open(APP_CACHE);
  const missing = [];
  for (const asset of LOCAL_ASSETS) {
    const url = new URL(asset, self.registration.scope).href;
    const hit = await cache.match(url, { ignoreSearch: true });
    if (!hit) missing.push(asset);
  }
  if (!missing.length) return { complete: true, missing: [] };
  const results = await Promise.allSettled(missing.map(fetchLocalAsset));
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    await cache.put(result.value.request, result.value.response);
  }
  const remaining = [];
  for (const asset of missing) {
    const url = new URL(asset, self.registration.scope).href;
    if (!(await cache.match(url, { ignoreSearch: true }))) remaining.push(asset);
  }
  return { complete: remaining.length === 0, missing: remaining };
}

function ensureLocalShell() {
  if (!shellVerificationPromise) {
    shellVerificationPromise = verifyLocalShellOnce().catch(error => {
      shellVerificationPromise = null;
      throw error;
    });
  }
  return shellVerificationPromise;
}

function warmRemoteStaticAssetsOnce() {
  if (!remoteWarmPromise) {
    remoteWarmPromise = warmRemoteStaticAssets().catch(error => {
      remoteWarmPromise = null;
      throw error;
    });
  }
  return remoteWarmPromise;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // الصفحات والملفات المحلية أولاً حتى يصبح الإصدار الجديد جاهزاً بسرعة.
    await installCompleteLocalShell();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([APP_CACHE, REMOTE_STATIC_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter(name => !keep.has(name)).map(name => caches.delete(name)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (_) {}
    }
    await self.clients.claim();
    // تأكد من اكتمال كاش التطبيق ثم سخّن مكتبات العرض في الخلفية.
    await ensureLocalShell().catch(() => null);
    warmRemoteStaticAssetsOnce().catch(() => null);
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.postMessage({ type: 'CASHTOP_CACHE_READY', cache: APP_CACHE, version: CACHE_VERSION }));
  })());
});

function canonicalLocalRequest(request) {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  return new Request(url.href, {
    method: 'GET',
    credentials: 'same-origin'
  });
}

async function refreshLocalCache(request, cache) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      // نحفظ دائماً تحت رابط ثابت بلا ?v= حتى تستبدل النسخة القديمة فعلياً.
      await cache.put(canonicalLocalRequest(request), response.clone());
    }
    return response;
  } catch (_) {
    return null;
  }
}

async function localCacheFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const cacheKey = canonicalLocalRequest(request);
  const cached = await cache.match(cacheKey, { ignoreSearch: true });

  // اعرض النسخة المحلية فوراً حتى مع وجود الإنترنت؛ لا تنتظر الشبكة مطلقاً عند توفر الكاش.
  if (cached) return cached;

  const response = await refreshLocalCache(request, cache);
  if (response) return response;
  if (request.mode === 'navigate') {
    return (await cache.match(new URL('./offline.html', self.registration.scope).href, { ignoreSearch: true })) || Response.error();
  }
  return Response.error();
}

async function refreshCachedLocalInBackground(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(canonicalLocalRequest(request));
  if (!cached) return;
  await refreshLocalCache(request, cache);
}

async function remoteStaticCacheFirst(request) {
  const cache = await caches.open(REMOTE_STATIC_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    return await putIfUsable(cache, request, response);
  } catch (_) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  /* بيانات قاعدة البيانات والـ APIs الحية تمر مباشرة بلا أي كاش. */
  if (isLiveApiRequest(url)) return;

  if (url.origin === self.location.origin) {
    // Always return Cache Storage immediately, even while online. Network refresh
    // is throttled and happens after the response so it cannot delay navigation.
    event.respondWith(localCacheFirst(request));
    if (shouldRefreshLocalInBackground(request)) {
      event.waitUntil(refreshCachedLocalInBackground(request));
    }
    return;
  }

  if (isCacheableRemoteStatic(request, url)) {
    event.respondWith(remoteStaticCacheFirst(request));
  }
  /* الروابط الخارجية الأخرى، مثل WhatsApp، تمر إلى الشبكة كما هي. */
});

const NOTIFICATION_META_CACHE = 'cash-top-2-notification-meta-v1';
const NOTIFICATION_META_KEY = new URL('./__cashtop_notification_meta__', self.registration.scope).href;
async function saveNotificationMeta(payload){const c=await caches.open(NOTIFICATION_META_CACHE);await c.put(NOTIFICATION_META_KEY,new Response(JSON.stringify(payload||{}),{headers:{'Content-Type':'application/json'}}));}
async function readNotificationMeta(){try{const c=await caches.open(NOTIFICATION_META_CACHE),r=await c.match(NOTIFICATION_META_KEY);return r?await r.json():{};}catch(_){return{}}}
async function displayNotification(payload={}){const title=String(payload.title||'كاش توب');const options={body:String(payload.body||''),icon:payload.icon||'app-icon.png',badge:payload.badge||payload.icon||'app-icon.png',image:payload.image||undefined,tag:payload.tag||`ct-${Date.now()}`,renotify:payload.renotify===true,data:{...(payload.data||{}),url:payload.url||payload.data?.url||'notifications.html'}};return self.registration.showNotification(title,options)}
self.addEventListener('push',event=>{event.waitUntil((async()=>{let payload={};try{payload=event.data?.json?.()||{body:event.data?.text?.()||''}}catch(_){payload={body:event.data?.text?.()||''}}await displayNotification(payload)})())});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const target=new URL(event.notification?.data?.url||'notifications.html',self.registration.scope).href;const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(c=>c.url===target)||windows.find(c=>c.url.startsWith(self.registration.scope));if(existing){await existing.focus();try{existing.navigate(target)}catch(_){}return}await self.clients.openWindow(target)})())});
self.addEventListener('periodicsync',event=>{if(event.tag!=='cashtop-daily-summary')return;event.waitUntil((async()=>{const meta=await readNotificationMeta();const now=new Date();if(meta.enabled!==true||meta.dailySummaryEnabled===false||meta.role!=='manager'||now.getHours()<23)return;const s=meta.summary||{};const today=now.toISOString().slice(0,10);if(s.dayKey!==today)return;const c=await caches.open(NOTIFICATION_META_CACHE),sentKey=new URL(`./__ct_daily_sent_${encodeURIComponent(meta.companyId||'company')}_${today}`,self.registration.scope).href;if(await c.match(sentKey))return;await displayNotification({title:'مبيعات اليوم والأرباح',icon:meta.icon||'app-icon.png',badge:meta.icon||'app-icon.png',body:`المبيعات: ${Number(s.sales||0).toFixed(2)} ${s.symbol||''} — الأرباح: ${Number(s.profit||0).toFixed(2)} ${s.symbol||''} — عدد الفواتير: ${Number(s.count||0)}`,tag:`daily-profit-${meta.companyId||'company'}-${today}`,url:'التقارير.html'});await c.put(sentKey,new Response('1'))})())});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SHOW_NOTIFICATION') { event.waitUntil(displayNotification(data.payload || {})); return; }
  if (data.type === 'CASHTOP_NOTIFICATION_META') { event.waitUntil(saveNotificationMeta(data.payload || {})); return; }
  if (data === 'SKIP_WAITING' || data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (data.type === 'WARM_CACHE' || data.type === 'VERIFY_CACHE') {
    event.waitUntil((async () => {
      const result = await ensureLocalShell();
      const source = event.source;
      if (source && typeof source.postMessage === 'function') {
        source.postMessage({ type: 'CASHTOP_CACHE_STATUS', ...result, cache: APP_CACHE });
      }
      // لا نعيد تنزيل حزمة التطبيق كاملة عند فتح كل صفحة. كل تنقل محلي
      // يُخدم فوراً من Cache Storage حتى مع وجود الإنترنت، والتحديث الشبكي
      // المحدود يحدث بعد الاستجابة فقط كي لا ينافس فتح الصفحة أو الرسم.
      await warmRemoteStaticAssetsOnce();
    })());
    return;
  }
  if (data.type === 'REFRESH_CACHE') {
    event.waitUntil((async () => {
      const source = event.source;
      const refreshed = await refreshCompleteLocalShell().catch(() => ({ updated: 0, total: LOCAL_ASSETS.length, complete: false }));
      if (source && typeof source.postMessage === 'function') {
        source.postMessage({ type: 'CASHTOP_CACHE_REFRESHED', ...refreshed, cache: APP_CACHE });
      }
    })());
  }
});
