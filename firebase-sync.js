(() => {
'use strict';
const settings = window.CASHTOP_FIREBASE || {};
const core = window.Cashtop;

if (settings.enabled && core && settings.config?.databaseURL) {
  const cfg = settings.config;
  const AUTH_KEY = `ct_firebase_rest_auth_v3::${cfg.projectId || 'default'}`;
  const STATE_KEY_PREFIX = 'ct_firebase_state_rest_v3';
  const LOCATION_KEY_PREFIX = 'ct_firebase_location_v3';
  const primaryRoot = String(settings.rootPath || 'cashTopExchange/cashTopPOS').replace(/^\/+|\/+$/g, '');
  const legacyRoots = Array.isArray(settings.legacyRootPaths) ? settings.legacyRootPaths : [];
  const session = core.getSession() || {};
  const baseUrl = String(cfg.databaseURL || '').replace(/\/+$/, '');
  const isFirestoreBridge = settings.backendMode === 'firestore-sdk';
  const backendAuthMode = token => isFirestoreBridge ? 'firestore-sdk' : (token ? 'anonymous' : 'database-rules');
  const backendSource = isFirestoreBridge ? 'firestore-sdk' : 'firebase-rtdb-rest';
  const CLOUD_DATA_KEYS = core.DATA_KEYS.filter(key => key !== 'cashtop_audit_log');
  const rawStorage = {
    get: key => Storage.prototype.getItem.call(localStorage, key),
    set: (key, value) => Storage.prototype.setItem.call(localStorage, key, String(value)),
    remove: key => Storage.prototype.removeItem.call(localStorage, key)
  };

  function sanitizeSegment(value) {
    return String(value || '').trim().replace(/[.#$\[\]\/]/g, '_');
  }

  /*
   * كل شركة تملك مساراً وحيداً وثابتاً مبنياً على companyId. في الإصدارات
   * السابقة كان الفحص يجرب companyId وcompanyKey وlicenseId ثم يختار المسار
   * الأحدث؛ وهذا قد يربط مفتاحاً جديداً بمسار غير مقصود أو يقسم بيانات الشركة
   * بين أكثر من عقدة. نحتفظ بالأسماء القديمة للترحيل فقط، ولا نختارها إلا إذا
   * كانت بياناتها نفسها تثبت أنها تخص المفتاح الحالي.
   */
  const canonicalCompanyId = sanitizeSegment(
    session.tenantId || session.companyId || session.licenseId || session.companyKey || 'unassigned'
  ) || 'unassigned';
  const normalizedCompanyKey = String(session.companyKey || '').trim().toUpperCase();
  // لا نزامن أبداً إلى عقدة تحمل معرفاً مختلفاً عن tenantId الحالي.
  // الجذور القديمة مسموحة فقط إذا كان اسم عقدة الشركة نفسه هو tenantId الثابت.
  const legacyCompanyIds = [];
  const companyIds = [canonicalCompanyId];

  const stateKey = `${STATE_KEY_PREFIX}::${encodeURIComponent(canonicalCompanyId)}`;
  const locationKey = `${LOCATION_KEY_PREFIX}::${encodeURIComponent(canonicalCompanyId)}`;
  let syncing = false;
  let scheduledSync = null;
  let pollTimer = null;
  let selectedLocation = null;
  let authFallbackReason = '';
  let backgroundPullTimer = null;
  let backgroundPullRunning = false;
  let realtimeSource = null;
  let realtimeLocationPath = '';
  let realtimePullTimer = null;
  let syncSerial = Promise.resolve();
  const datasetRetryState = new Map();

  function readState() {
    try { return JSON.parse(sessionStorage.getItem(stateKey) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function writeState(patch) {
    const next = { ...readState(), ...patch };
    try { sessionStorage.setItem(stateKey, JSON.stringify(next)); } catch (_) {}
    return next;
  }

  function errorMessage(error) {
    return String(error?.message || error?.code || error || 'تعذر الاتصال بقاعدة البيانات.');
  }

  function isTransientNetworkError(error) {
    const message = errorMessage(error).toLowerCase();
    const status = Number(error?.httpStatus || 0);
    return error?.name === 'TypeError' || error?.name === 'AbortError' ||
      [408, 425, 429, 500, 502, 503, 504].includes(status) ||
      /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|مهلة الاتصال|تعذر الاتصال|temporarily unavailable|service unavailable|bad gateway|gateway timeout/.test(message);
  }

  function safeSyncMessage(error) {
    if (!isTransientNetworkError(error)) return errorMessage(error);
    if (navigator.onLine === false) {
      return 'تعذر الوصول إلى خادم المزامنة حالياً. البيانات محفوظة محلياً وستُعاد المحاولة تلقائياً.';
    }
    return 'الإنترنت متوفر، لكن خادم المزامنة لم يستجب لهذه المحاولة. ستتم إعادة المحاولة تلقائياً دون فقدان أي عملية.';
  }

  const CLOUD_OMIT = Symbol('cashtop-cloud-omit');
  function containsDeviceLocalImage(value) {
    return typeof value === 'string' && (/^(?:data:image\/|blob:)/i.test(value.trim()) || /(?:data:image\/[^;]+;base64,|blob:)/i.test(value));
  }
  function imageRecordId(value) {
    if (!value || typeof value !== 'object') return '';
    return String(value.id ?? value.productId ?? value.uuid ?? value.code ?? value.barcode ?? value.key ?? '').trim();
  }
  function cloudSafeValue(localValue, remoteValue) {
    if (typeof localValue === 'string') {
      if (/^(?:data:image\/|blob:)/i.test(localValue.trim())) {
        return typeof remoteValue === 'string' && !containsDeviceLocalImage(remoteValue) ? remoteValue : CLOUD_OMIT;
      }
      if (containsDeviceLocalImage(localValue)) {
        // HTML التصميم قد يحتوي صورة Base64 داخله؛ نحذف بايتات الصورة فقط ونزامن بقية التصميم.
        const cleaned = localValue
          .replace(/data:image\/[^;,'")]+;base64,[A-Za-z0-9+/=\s]+/gi, '')
          .replace(/blob:[^'")\s]+/gi, '');
        return cleaned || (typeof remoteValue === 'string' && !containsDeviceLocalImage(remoteValue) ? remoteValue : CLOUD_OMIT);
      }
      return localValue;
    }
    if (Array.isArray(localValue)) {
      const remoteRows = Array.isArray(remoteValue) ? remoteValue : [];
      const remoteById = new Map(remoteRows.map(item => [imageRecordId(item), item]).filter(([id]) => id));
      return localValue.map((item, index) => {
        const id = imageRecordId(item);
        return cloudSafeValue(item, (id && remoteById.get(id)) ?? remoteRows[index]);
      }).filter(item => item !== CLOUD_OMIT);
    }
    if (localValue && typeof localValue === 'object') {
      const remoteObject = remoteValue && typeof remoteValue === 'object' && !Array.isArray(remoteValue) ? remoteValue : {};
      const output = {};
      for (const [field, fieldValue] of Object.entries(localValue)) {
        const safe = cloudSafeValue(fieldValue, remoteObject[field]);
        if (safe !== CLOUD_OMIT) output[field] = safe;
      }
      return output;
    }
    return localValue;
  }
  function makeCloudSafePayload(key, localPayload, remotePayload) {
    if (!localPayload || localPayload.deleted || typeof localPayload.value !== 'string') return localPayload;
    const localValue = payloadJsonValue(localPayload);
    if (localValue == null || typeof localValue !== 'object') {
      if (!containsDeviceLocalImage(localPayload.value)) return localPayload;
    }
    const remoteValue = remotePayload ? payloadJsonValue(remotePayload) : undefined;
    const safe = cloudSafeValue(localValue, remoteValue);
    if (safe === CLOUD_OMIT) return { ...localPayload, value: JSON.stringify(null), localImagesOmitted: true };
    return { ...localPayload, value: JSON.stringify(safe), localImagesOmitted: JSON.stringify(safe) !== JSON.stringify(localValue) };
  }


  function reportSyncProgress(current, total, label = '', extra = {}) {
    window.dispatchEvent(new CustomEvent('cashtop:sync-progress', {
      detail: { active: extra.active !== false, current, total, label, ...extra }
    }));
  }

  function reportPullStart(key = '', current = 0, total = 0) {
    window.dispatchEvent(new CustomEvent('cashtop:pull-start', { detail: { key, current, total } }));
  }

  function reportPullEnd(key = '', current = 0, total = 0) {
    window.dispatchEvent(new CustomEvent('cashtop:pull-end', { detail: { key, current, total } }));
  }

  function canRetryDatasetNow(key, manual = false) {
    if (manual) return true;
    const state = datasetRetryState.get(key);
    return !state || Number(state.nextAt || 0) <= Date.now();
  }

  function noteDatasetFailure(key, error) {
    const previous = datasetRetryState.get(key) || { count: 0 };
    const count = Math.min(8, Number(previous.count || 0) + 1);
    const delay = Math.min(60000, 2500 * (2 ** Math.max(0, count - 1)));
    datasetRetryState.set(key, { count, nextAt: Date.now() + delay, message: safeSyncMessage(error) });
  }

  function clearDatasetFailure(key) {
    datasetRetryState.delete(key);
  }

  function readAuth() {
    try { return JSON.parse(rawStorage.get(AUTH_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function saveAuth(auth) {
    rawStorage.set(AUTH_KEY, JSON.stringify(auth));
  }

  function transportUrl(url) { return url; }

  function transportCandidates(url) { return [url]; }

  function transportFetchOptions(options = {}) { return options; }

  async function fetchAttempt(targetUrl, options, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(targetUrl, { ...transportFetchOptions(options), signal: controller.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchWithTimeout(url, options = {}, timeout = 22000) {
    const candidates = transportCandidates(url);
    const method = String(options.method || 'GET').toUpperCase();
    const attemptsPerCandidate = navigator.onLine === false ? 1 : 2;
    let lastError = null;

    for (const targetUrl of candidates) {
      for (let attempt = 0; attempt < attemptsPerCandidate; attempt += 1) {
        try {
          const response = await fetchAttempt(targetUrl, options, timeout);
          // أخطاء الخادم المؤقتة يعاد طلبها سريعاً بدلاً من اعتبار الجهاز بلا إنترنت.
          const transientStatus = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
          if (transientStatus && attempt + 1 < attemptsPerCandidate) {
            await new Promise(resolve => setTimeout(resolve, 180 + (attempt * 320)));
            continue;
          }
          if (targetUrl !== candidates[candidates.length - 1] && (transientStatus || [404, 405].includes(response.status))) {
            lastError = new Error(`تعذر الوصول إلى نقطة المزامنة الأساسية (${response.status}).`);
            lastError.httpStatus = response.status;
            break;
          }
          writeState({ backendReachable: true, backendReachableAt: Date.now(), lastTransportUrl: targetUrl });
          return response;
        } catch (error) {
          lastError = error;
          writeState({ backendReachable: false, backendErrorAt: Date.now(), backendError: errorMessage(error) });
          if (attempt + 1 < attemptsPerCandidate) {
            await new Promise(resolve => setTimeout(resolve, 180 + (attempt * 320)));
            continue;
          }
        }
      }
    }

    if (lastError?.name === 'AbortError') {
      const error = new Error('انتهت مهلة استجابة خادم قاعدة البيانات.');
      error.name = 'SyncTimeoutError';
      throw error;
    }
    throw lastError || new Error(`${method} request failed`);
  }

  async function firebaseError(response) {
    const payload = await response.json().catch(() => null);
    const code = String(payload?.error?.message || payload?.error || '').trim();
    let message = `خطأ قاعدة البيانات (${response.status})${code ? `: ${code}` : ''}`;
    if (response.status === 401 || response.status === 403 || code.includes('PERMISSION_DENIED')) {
      message = authFallbackReason
        ? 'رفض خادم قاعدة البيانات الوصول إلى هذا المسار.'
        : 'رفض خادم قاعدة البيانات الوصول. راجع صلاحيات API والمسار.';
    } else if (code.includes('OPERATION_NOT_ALLOWED')) {
      message = 'تسجيل الدخول المجهول Anonymous غير مفعّل في مشروع Firebase.';
    } else if (code.includes('CONFIGURATION_NOT_FOUND')) {
      message = 'خدمة Firebase Authentication غير مهيأة في هذا المشروع.';
    }
    const error = new Error(message);
    error.firebaseCode = code;
    error.httpStatus = response.status;
    return error;
  }

  function isAuthConfigurationError(error) {
    const code = String(error?.firebaseCode || error?.message || '');
    return code.includes('CONFIGURATION_NOT_FOUND') ||
      code.includes('OPERATION_NOT_ALLOWED') ||
      code.includes('INVALID_PROVIDER_ID') ||
      code.includes('API_KEY_SERVICE_BLOCKED');
  }


  function isPermissionError(error) {
    const code = String(error?.firebaseCode || error?.message || '');
    const status = Number(error?.httpStatus || 0);
    return status === 401 || status === 403 || code.includes('PERMISSION_DENIED');
  }

  async function refreshToken(refreshTokenValue) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenValue
    });
    const response = await fetchWithTimeout(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body
      }
    );
    if (!response.ok) throw await firebaseError(response);
    const data = await response.json();
    const auth = {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      uid: data.user_id,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000
    };
    saveAuth(auth);
    return auth.idToken;
  }

  async function createAnonymousToken() {
    const response = await fetchWithTimeout(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({ returnSecureToken: true })
      }
    );
    if (!response.ok) throw await firebaseError(response);
    const data = await response.json();
    const auth = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      uid: data.localId,
      expiresAt: Date.now() + Math.max(60, Number(data.expiresIn || 3600) - 120) * 1000
    };
    saveAuth(auth);
    return auth.idToken;
  }

  // المشروع المرفق كان يتابع إلى RTDB حتى عندما لا تتوفر Anonymous Auth.
  // هذا يمنع خطأ CONFIGURATION_NOT_FOUND من إيقاف المزامنة بالكامل، ويترك
  // قواعد قاعدة البيانات الفعلية تقرر إن كان الوصول بدون token مسموحاً.
  async function getIdToken() {
    if (isFirestoreBridge) return '';
    const auth = readAuth();
    if (auth?.idToken && Number(auth.expiresAt || 0) > Date.now()) return auth.idToken;
    if (auth?.refreshToken) {
      try {
        return await refreshToken(auth.refreshToken);
      } catch (error) {
        rawStorage.remove(AUTH_KEY);
        if (!isAuthConfigurationError(error)) console.warn('[CASH TOP 2] Firebase token refresh:', error);
      }
    }
    try {
      return await createAnonymousToken();
    } catch (error) {
      if (isAuthConfigurationError(error)) {
        authFallbackReason = String(error.firebaseCode || error.message || 'AUTH_UNAVAILABLE');
        writeState({ authMode: backendAuthMode(''), authFallbackReason, authCheckedAt: Date.now() });
        console.warn('[CASH TOP 2] Firebase Authentication unavailable; continuing with RTDB rules only.');
        return '';
      }
      throw error;
    }
  }


  async function requireDatabaseToken() {
    if (isFirestoreBridge) return '';
    const token = await getIdToken();
    if (token) return token;
    throw new Error('قاعدة Firebase تطلب تسجيل دخول، لكن خدمة Authentication غير مهيأة. انشر قواعد التوافق المرفقة أو فعّل Anonymous Authentication.');
  }

  function exactLocation() {
    return { root: primaryRoot, companyId: canonicalCompanyId };
  }

  function legacyCandidateLocations() {
    const roots = [...new Set([
      primaryRoot,
      ...legacyRoots.map(root => String(root || '').replace(/^\/+|\/+$/g, ''))
    ].filter(Boolean))];
    const locations = [];
    roots.forEach(root => {
      if (root !== primaryRoot) locations.push({ root, companyId: canonicalCompanyId });
      legacyCompanyIds.forEach(companyId => locations.push({ root, companyId }));
    });
    return locations.filter((location, index, all) =>
      all.findIndex(item => item.root === location.root && item.companyId === location.companyId) === index
    );
  }

  function locationPath(location) {
    return `${location.root}/${location.companyId}`;
  }

  function databaseEndpoint(location, token = '') {
    const query = token ? `?auth=${encodeURIComponent(token)}` : '';
    return `${baseUrl}/${locationPath(location)}.json${query}`;
  }


  function datasetEndpoint(location, key, token = '') {
    const query = token ? `?auth=${encodeURIComponent(token)}` : '';
    return `${baseUrl}/${locationPath(location)}/datasets/${sanitizeSegment(key)}.json${query}`;
  }

  function auditTrailEndpoint(location, day, hour = '', recordId = '', token = '') {
    const query = token ? `?auth=${encodeURIComponent(token)}` : '';
    const hourPath = hour === '' ? '' : `/${sanitizeSegment(hour)}`;
    const suffix = recordId ? `/${sanitizeSegment(recordId)}` : '';
    return `${baseUrl}/${locationPath(location)}/auditTrail/${sanitizeSegment(day)}${hourPath}${suffix}.json${query}`;
  }

  function auditTrailRecentEndpoint(location, recordId = '', token = '') {
    const query = token ? `?auth=${encodeURIComponent(token)}` : '';
    const suffix = recordId ? `/${sanitizeSegment(recordId)}` : '';
    return `${baseUrl}/${locationPath(location)}/auditTrailRecent${suffix}.json${query}`;
  }

  function auditTrailLegacyRootEndpoint(location, token = '') {
    const query = token ? `?auth=${encodeURIComponent(token)}` : '';
    return `${baseUrl}/${locationPath(location)}/auditTrail.json${query}`;
  }

  function metaEndpoint(location, token = '') {
    const query = token ? `?auth=${encodeURIComponent(token)}` : '';
    return `${baseUrl}/${locationPath(location)}/meta.json${query}`;
  }


  const realtimePendingKeys = new Set();

  function stopRealtimeStream() {
    clearTimeout(realtimePullTimer);
    realtimePullTimer = null;
    realtimePendingKeys.clear();
    if (realtimeSource) {
      try { realtimeSource.close(); } catch (_) {}
      realtimeSource = null;
    }
    realtimeLocationPath = '';
  }

  function realtimeDatasetKey(pathValue) {
    const path = String(pathValue || '/').replace(/^\/+/, '');
    if (!path) return '';
    const segment = path.split('/')[0];
    return CLOUD_DATA_KEYS.find(key => sanitizeSegment(key) === segment) || '';
  }

  function scheduleRealtimePull(key = '') {
    if (key) realtimePendingKeys.add(key);
    clearTimeout(realtimePullTimer);
    realtimePullTimer = setTimeout(async () => {
      // لا نعتمد على navigator.onLine كحكم نهائي؛ بعض الأجهزة تعطي حالة خاطئة.
      const keys = [...realtimePendingKeys];
      realtimePendingKeys.clear();
      try {
        if (core.getSyncQueue().length) {
          await syncAll({ manual: false, forceCheck: false, realtime: true });
        } else if (keys.length) {
          await pullDatasetKeys(keys, { concurrency: 8 });
        } else {
          await pullPriorityDatasets({ concurrency: 8, silentProgress: true });
        }
      } catch (error) {
        console.warn('[CASH TOP 2] realtime pull deferred:', error);
      }
    }, 70);
  }

  function startRealtimeStream(location, token = '') {
    if (isFirestoreBridge || typeof EventSource !== 'function' || !location) return false;
    const path = locationPath(location);
    if (realtimeSource && realtimeLocationPath === path && realtimeSource.readyState !== EventSource.CLOSED) return true;
    stopRealtimeStream();
    const query = token ? `?auth=${encodeURIComponent(token)}` : '';
    const url = `${baseUrl}/${path}/datasets.json${query}`;
    try {
      const source = new EventSource(url);
      realtimeSource = source;
      realtimeLocationPath = path;
      source.addEventListener('open', () => {
        writeState({ realtimeConnected: true, realtimeAt: Date.now(), remotePath: path });
      });
      const onData = event => {
        try {
          const payload = JSON.parse(event.data || '{}');
          const key = realtimeDatasetKey(payload.path);
          // حدث path=/ هو لقطة الاتصال الأولى؛ سحب الصفحة يكفي بدلاً من تنزيل كل الشركة.
          scheduleRealtimePull(key);
        } catch (_) {
          scheduleRealtimePull('');
        }
      };
      source.addEventListener('put', onData);
      source.addEventListener('patch', onData);
      source.addEventListener('cancel', () => writeState({ realtimeConnected: false, realtimeAt: Date.now() }));
      source.onerror = () => {
        writeState({ realtimeConnected: false, realtimeAt: Date.now() });
        if (source.readyState === EventSource.CLOSED) {
          setTimeout(async () => {
            try {
              const access = await openLightDatabaseAccess();
              startRealtimeStream(access.location, access.token);
            } catch (_) {}
          }, 2200);
        }
      };
      return true;
    } catch (error) {
      console.warn('[CASH TOP 2] realtime stream unavailable:', error);
      return false;
    }
  }

  async function readDatasetLocation(location, key, token = '') {
    const response = await fetchWithTimeout(datasetEndpoint(location, key, token), {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache, no-store, max-age=0', 'Pragma': 'no-cache' }
    }, 16000);
    if (!response.ok) throw await firebaseError(response);
    return await response.json();
  }

  async function readMetaLocation(location, token = '') {
    const response = await fetchWithTimeout(metaEndpoint(location, token), {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache, no-store, max-age=0', 'Pragma': 'no-cache' }
    }, 10000);
    if (!response.ok) throw await firebaseError(response);
    return (await response.json()) || {};
  }

  async function writeDatasetLocation(location, key, token = '', payload = null) {
    const response = await fetchWithTimeout(datasetEndpoint(location, key, token), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-cache, no-store, max-age=0' },
      body: JSON.stringify(payload)
    }, 18000);
    if (!response.ok) throw await firebaseError(response);
    return { ok: true, data: await response.json().catch(() => payload) };
  }

  async function writeMetaLocation(location, token = '', patch = {}) {
    const current = await readMetaLocation(location, token).catch(() => ({}));
    const next = { ...(current || {}), ...(patch || {}), updatedAt: Date.now() };
    const response = await fetchWithTimeout(metaEndpoint(location, token), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-cache, no-store, max-age=0' },
      body: JSON.stringify(next)
    }, 12000);
    if (!response.ok) throw await firebaseError(response);
    return next;
  }

  function pagePriorityDatasets() {
    const common = ['cashtop_company_access', 'cashtop_branches', 'cashtop_employees', 'cashtop_settings', 'cashtop_db', 'cashtop_printer_settings', 'cashtop_barcode_settings', 'cashtop_invoice_design', 'cashtop_tax_settings', 'cashtop_notification_settings', 'cashtop_sms_template', 'cashtop_invoice_message_template'];
    const map = {
      'لوحة التحكم.html': ['cashtop_invoices', 'cashtop_products', 'cashtop_customers', 'cashtop_expenses', 'cashtop_funds_db'],
      'cashier.html': ['cashtop_products', 'cashtop_customers', 'cashtop_customer_groups', 'cashtop_funds_db', 'cashtop_sales_offers', 'cashtop_tax_settings', 'cashtop_units', 'cashtop_stores'],
      'products.html': ['cashtop_products', 'cashtop_units', 'cashtop_stores', 'cashtop_suppliers', 'cashtop_purchases', 'cashtop_funds_db'],
      'materials.html': ['cashtop_materials', 'cashtop_material_purchases', 'cashtop_units', 'cashtop_stores', 'cashtop_suppliers', 'cashtop_funds_db'],
      'invoices.html': ['cashtop_invoices', 'cashtop_products', 'cashtop_customers', 'cashtop_funds_db', 'cashtop_sales_offers'],
      'customers.html': ['cashtop_customers', 'cashtop_customer_groups', 'cashtop_invoices', 'cashtop_vouchers'],
      'customer-groups.html': ['cashtop_customer_groups', 'cashtop_customers', 'cashtop_products'],
      'suppliers.html': ['cashtop_suppliers', 'cashtop_supplier_movements', 'cashtop_purchases'],
      'المشتريات.html': ['cashtop_purchases', 'cashtop_products', 'cashtop_suppliers', 'cashtop_funds_db', 'cashtop_stores'],
      'مرجع المشتريات.html': ['cashtop_purchase_returns', 'cashtop_purchases', 'cashtop_products', 'cashtop_suppliers'],
      'المصاريف.html': ['cashtop_expenses', 'cashtop_expense_types', 'cashtop_funds_db'],
      'accounts.html': ['cashtop_funds_db', 'cashtop_vouchers', 'cashtop_transfer_history'],
      'journal.html': ['cashtop_journal', 'cashtop_funds_db'],
      'branches.html': ['cashtop_branches', 'cashtop_stores', 'cashtop_employees', 'cashtop_products'],
      'warehouses.html': ['cashtop_stores', 'cashtop_products', 'cashtop_transfer_history'],
      'units.html': ['cashtop_units', 'cashtop_products'],
      'shortages.html': ['cashtop_products', 'cashtop_stores'],
      'الموظفين.html': ['cashtop_employees', 'cashtop_branches', 'cashtop_salary_payments'],
      'العمال والاجور.html': ['cashtop_workers', 'cashtop_salary_payments', 'cashtop_funds_db'],
      'المناديب.html': ['cashtop_sales_agents', 'cashtop_agent_movements', 'cashtop_invoices'],
      'sales-offers.html': ['cashtop_sales_offers', 'cashtop_products'],
      'sands.html': ['cashtop_vouchers', 'cashtop_funds_db'],
      'notifications.html': ['cashtop_notification_settings', 'cashtop_products', 'cashtop_invoices', 'cashtop_funds_db'],
      'barcode-generator.html': ['cashtop_products', 'cashtop_barcode_settings', 'cashtop_settings'],
      'printer-settings.html': ['cashtop_printer_settings', 'cashtop_barcode_settings', 'cashtop_settings', 'cashtop_invoice_design'],
      'invoice-designer.html': ['cashtop_invoice_design', 'cashtop_printer_settings', 'cashtop_settings', 'cashtop_invoices'],
      'tax-settings.html': ['cashtop_tax_settings', 'cashtop_settings'],
      'storage-settings.html': ['cashtop_archive_index', 'cashtop_invoices', 'cashtop_transfer_history', 'cashtop_branch_transfer_history', 'cashtop_settings'],
      'setting.html': ['cashtop_company_access', 'cashtop_settings', 'cashtop_db', 'cashtop_branches', 'cashtop_employees', 'cashtop_sms_template', 'cashtop_invoice_message_template'],
      'ادارة التصنيع.html': ['cashtop_manufacturing_recipes', 'cashtop_manufacturing_orders', 'cashtop_products', 'cashtop_materials', 'cashtop_stores'],
      'التقارير.html': ['cashtop_invoices', 'cashtop_purchases', 'cashtop_expenses', 'cashtop_products', 'cashtop_customers', 'cashtop_funds_db']
    };
    return [...new Set([...common, ...(map[core.FILE] || [])])].filter(key => CLOUD_DATA_KEYS.includes(key));
  }

  function assertAccessIdentity(rawPayload, location) {
    if (rawPayload == null) return true;
    const access = decodeDatasetObject(rawPayload);
    const remoteTenant = sanitizeSegment(access.tenantId || access.companyId || location.companyId || '');
    const remoteKey = String(access.companyKey || '').trim().toUpperCase();
    if (remoteTenant && remoteTenant !== canonicalCompanyId) throw new Error('تم منع مزامنة بيانات شركة أخرى مع الجلسة الحالية.');
    if (normalizedCompanyKey && remoteKey && remoteKey !== normalizedCompanyKey) throw new Error('مفتاح الشركة في قاعدة البيانات لا يطابق جلسة الدخول الحالية.');
    return true;
  }

  async function openLightDatabaseAccess() {
    const location = exactLocation();
    try {
      const accessPayload = await readDatasetLocation(location, 'cashtop_company_access', '');
      assertAccessIdentity(accessPayload, location);
      saveSelectedLocation(location);
      return { token: '', location, accessPayload };
    } catch (error) {
      if (!isPermissionError(error)) throw error;
      const token = await requireDatabaseToken();
      const accessPayload = await readDatasetLocation(location, 'cashtop_company_access', token);
      assertAccessIdentity(accessPayload, location);
      saveSelectedLocation(location);
      return { token, location, accessPayload };
    }
  }

  async function readLocation(location, token) {
    const response = await fetchWithTimeout(databaseEndpoint(location, token), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Firebase-ETag': 'true',
        'Cache-Control': 'no-cache, no-store, max-age=0',
        'Pragma': 'no-cache'
      }
    });
    if (!response.ok) throw await firebaseError(response);
    return {
      data: (await response.json()) || {},
      etag: response.headers.get('ETag') || '*'
    };
  }

  async function writeLocation(location, token, data, etag = '*') {
    const headers = {
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': 'no-cache, no-store, max-age=0'
    };
    headers['If-Match'] = etag;
    const response = await fetchWithTimeout(databaseEndpoint(location, token), {
      method: 'PUT', headers, body: JSON.stringify(data)
    });
    if (response.status === 412) return { conflict: true };
    if (!response.ok) throw await firebaseError(response);
    return { ok: true, data: await response.json().catch(() => data) };
  }

  function remoteStats(data) {
    const datasets = data?.datasets && typeof data.datasets === 'object' ? data.datasets : {};
    const times = Object.values(datasets).map(item => Number(item?.updatedAt || 0));
    const updatedAt = Math.max(Number(data?.meta?.updatedAt || 0), ...times, 0);
    const count = Object.keys(datasets).length;
    return { count, updatedAt, hasData: count > 0 || Boolean(data?.meta) };
  }

  function remoteIdentity(data) {
    const meta = data?.meta && typeof data.meta === 'object' ? data.meta : {};
    const rawAccess = data?.datasets?.cashtop_company_access;
    let access = {};
    try {
      const payload = normalizeRemotePayload(rawAccess);
      const decoded = payload?.valueEncoding === VALUE_ENCODING && typeof payload.value === 'string'
        ? JSON.parse(payload.value)
        : payload?.value;
      if (decoded && typeof decoded === 'object') access = decoded;
    } catch (_) {}
    return {
      tenantId: sanitizeSegment(access.tenantId || access.companyId || meta.tenantId || meta.companyId || ''),
      companyId: sanitizeSegment(access.tenantId || access.companyId || meta.tenantId || meta.companyId || ''),
      companyKey: String(access.companyKey || meta.companyKey || '').trim().toUpperCase()
    };
  }

  function locationBelongsToCurrentCompany(location, data) {
    const stats = remoteStats(data);
    if (!stats.hasData) return location.root === primaryRoot && location.companyId === canonicalCompanyId;
    const identity = remoteIdentity(data);
    // أي عقدة تحتوي بيانات يجب أن تعلن نفس tenantId الثابت. لا نعتمد على المفتاح
    // وحده لأن المفتاح يمكن تغييره أو إعادة استخدامه لاحقاً لشركة أخرى.
    if (!identity.tenantId || identity.tenantId !== canonicalCompanyId) return false;
    if (normalizedCompanyKey && identity.companyKey && identity.companyKey !== normalizedCompanyKey) return false;
    return true;
  }

  function loadCachedLocation() {
    try {
      const cached = JSON.parse(rawStorage.get(locationKey) || 'null');
      if (cached?.root && cached?.companyId) return { root: cached.root, companyId: cached.companyId };
    } catch (_) {}
    return null;
  }

  function saveSelectedLocation(location) {
    selectedLocation = location;
    rawStorage.set(locationKey, JSON.stringify({ ...location, selectedAt: Date.now() }));
    writeState({ remotePath: locationPath(location), canonicalCompanyId });
  }

  async function resolveLocation(token, forceProbe = false) {
    const isExact = location => location?.root === primaryRoot && location?.companyId === canonicalCompanyId;
    if (selectedLocation && !forceProbe && isExact(selectedLocation)) {
      const read = await readLocation(selectedLocation, token);
      if (locationBelongsToCurrentCompany(selectedLocation, read.data)) {
        return { location: selectedLocation, read };
      }
      selectedLocation = null;
    }

    let permissionError = null;
    const cached = loadCachedLocation();
    if (cached && !forceProbe && isExact(cached)) {
      try {
        const read = await readLocation(cached, token);
        if (locationBelongsToCurrentCompany(cached, read.data)) {
          saveSelectedLocation(cached);
          return { location: cached, read };
        }
        rawStorage.remove(locationKey);
      } catch (error) {
        if (isPermissionError(error)) permissionError = error;
        else console.warn('[CASH TOP 2] database cached path:', locationPath(cached), error);
      }
    }

    /* المسار الرسمي للشركة هو الخيار الأول دائماً حتى لو كان هناك مسار تاريخي محفوظ. */
    const exact = exactLocation();
    let exactRead = null;
    try {
      exactRead = await readLocation(exact, token);
      if (remoteStats(exactRead.data).hasData) {
        if (!locationBelongsToCurrentCompany(exact, exactRead.data)) {
          throw new Error('تعارض هوية مسار قاعدة البيانات: المسار الحالي يحتوي بيانات شركة أخرى. تم إيقاف المزامنة لحماية البيانات.');
        }
        saveSelectedLocation(exact);
        return { location: exact, read: exactRead };
      }
    } catch (error) {
      if (isPermissionError(error)) permissionError = error;
      else throw error;
    }

    /*
     * ترحيل اختياري من المسارات التاريخية: لا نستخدم أي عقدة إلا عندما يثبت
     * companyId أو companyKey داخلها أنها تخص الجلسة الحالية.
     */
    let legacyMatch = null;
    const legacyLocations = legacyCandidateLocations();
    if (cached && !isExact(cached)) legacyLocations.unshift(cached);
    if (selectedLocation && !isExact(selectedLocation)) legacyLocations.unshift(selectedLocation);
    for (const location of legacyLocations.filter((item, index, all) =>
      all.findIndex(other => other.root === item.root && other.companyId === item.companyId) === index
    )) {
      try {
        const read = await readLocation(location, token);
        const stats = remoteStats(read.data);
        if (!stats.hasData || !locationBelongsToCurrentCompany(location, read.data)) continue;
        if (!legacyMatch || stats.updatedAt > legacyMatch.stats.updatedAt) {
          legacyMatch = { location, read, stats };
        }
      } catch (error) {
        if (isPermissionError(error)) permissionError ||= error;
        else console.warn('[CASH TOP 2] database legacy path probe:', locationPath(location), error);
      }
    }

    if (legacyMatch) {
      saveSelectedLocation(legacyMatch.location);
      return { location: legacyMatch.location, read: legacyMatch.read };
    }
    if (!exactRead && permissionError) throw permissionError;

    saveSelectedLocation(exact);
    return { location: exact, read: exactRead || { data: {}, etag: '*' } };
  }

  // نجرب Realtime Database مباشرة أولاً. بذلك لا يتم استدعاء خدمة
  // Authentication غير المهيأة ولا يظهر CONFIGURATION_NOT_FOUND. لا نحاول
  // Anonymous Auth إلا إذا كانت قواعد قاعدة البيانات نفسها ترفض الوصول.
  async function openDatabaseAccess(forceProbe = false) {
    try {
      return {
        token: '',
        authMode: backendAuthMode(''),
        resolved: await resolveLocation('', forceProbe)
      };
    } catch (error) {
      if (!isPermissionError(error)) throw error;
      const token = await requireDatabaseToken();
      selectedLocation = null;
      return {
        token,
        authMode: 'anonymous',
        resolved: await resolveLocation(token, forceProbe)
      };
    }
  }

  function localMetaFor(key) {
    return core.safeJson(core.rawGet(core.metaKey(key)), {}) || {};
  }

  /*
   * Firebase Realtime Database يمنع أي مفتاح متداخل يحتوي . # $ [ ] /.
   * صلاحيات الموظفين تستخدم مفاتيح دقيقة مثل sales.create ولذلك كان رفع
   * كائن الموظف مباشرة يفشل برسالة Invalid data. نحفظ قيمة كل dataset كنص
   * JSON واحد داخل Firebase ثم نعيدها كما هي إلى localStorage. هذا يحافظ على
   * جميع المفاتيح الأصلية ويمنع الخطأ لأي بيانات مستقبلية أيضاً.
   */
  const VALUE_ENCODING = 'local-storage-json-v1';

  function normalizeRemotePayload(payload) {
    if (payload && typeof payload === 'object' && (
      Object.prototype.hasOwnProperty.call(payload, 'value') ||
      Object.prototype.hasOwnProperty.call(payload, 'updatedAt') ||
      Object.prototype.hasOwnProperty.call(payload, 'revision') ||
      payload.deleted === true
    )) {
      const encoded = payload.valueEncoding === VALUE_ENCODING;
      return {
        value: payload.deleted === true ? null : payload.value,
        valueEncoding: encoded ? VALUE_ENCODING : '',
        deleted: payload.deleted === true,
        updatedAt: Number(payload.updatedAt || 0),
        revision: Math.max(1, Number(payload.revision || 1)),
        deviceId: payload.deviceId || null,
        page: payload.page || ''
      };
    }
    return {
      value: payload,
      valueEncoding: '',
      deleted: payload == null,
      updatedAt: 0,
      revision: 1,
      deviceId: null,
      page: ''
    };
  }

  function makeLocalPayload(key, remoteRevision = 0) {
    const raw = core.getRawCompanyDataset ? core.getRawCompanyDataset(key) : localStorage.getItem(key);
    const meta = localMetaFor(key);
    return {
      value: raw == null ? null : String(raw),
      valueEncoding: VALUE_ENCODING,
      deleted: raw == null,
      updatedAt: Math.max(1, Number(meta.updatedAt || 0), Date.now()),
      revision: Math.max(1, Number(meta.revision || 0), Number(remoteRevision || 0) + 1),
      deviceId: core.rawGet('cashtop_device_id') || '',
      page: core.FILE || ''
    };
  }

  function decodeDatasetObject(payload) {
    try {
      const normalized = normalizeRemotePayload(payload);
      if (normalized.deleted) return {};
      let value = normalized.value;
      if (normalized.valueEncoding === VALUE_ENCODING && typeof value === 'string') value = JSON.parse(value);
      else if (typeof value === 'string') value = JSON.parse(value);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) {
      return {};
    }
  }

  function mergeAdminControlledAccess(remotePayload) {
    const key = 'cashtop_company_access';
    const remoteAccess = decodeDatasetObject(remotePayload);
    if (!Object.keys(remoteAccess).length) return false;
    const localRaw = core.getRawCompanyDataset ? core.getRawCompanyDataset(key) : localStorage.getItem(key);
    let localAccess = {};
    try { localAccess = JSON.parse(localRaw || '{}') || {}; } catch (_) { localAccess = {}; }
    const protectedFields = [
      'companyId', 'companyKey', 'companyName', 'status', 'plan', 'startAt', 'endAt',
      'durationUnit', 'durationQuantity', 'backupImportEnabled', 'authVersion', 'deleted'
    ];
    const merged = { ...localAccess };
    protectedFields.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(remoteAccess, field)) merged[field] = remoteAccess[field];
    });
    /* حالة المدير من لوحة الإدارة تبقى مرجعية، بينما نحتفظ بكلمة مرور أحدث غُيرت من إعدادات الشركة. */
    if (remoteAccess.manager && typeof remoteAccess.manager === 'object') {
      merged.manager = { ...(remoteAccess.manager || {}), ...(localAccess.manager || {}) };
      ['id', 'username', 'displayName', 'role', 'active', 'authVersion'].forEach(field => {
        if (Object.prototype.hasOwnProperty.call(remoteAccess.manager, field)) merged.manager[field] = remoteAccess.manager[field];
      });
    }
    const mergedRaw = JSON.stringify(merged);
    if (mergedRaw === String(localRaw || '')) return false;
    core.rawSet(core.namespaceKey(key), mergedRaw);
    return true;
  }

  function pendingForKey(key) {
    return core.getSyncQueue().find(item => item.key === key) || null;
  }

  function completePendingForKey(key) {
    core.getSyncQueue()
      .filter(item => item.key === key)
      .forEach(item => core.completeSyncOperation(item.id));
  }

  /*
   * لا نعتبر الرفع ناجحاً محلياً إذا تغيّرت نفس المجموعة أثناء انتظار
   * استجابة الشبكة. في هذه الحالة تكون Firebase قد استلمت النسخة التي بدأنا
   * بها فقط، بينما تبقى العملية الأحدث في الطابور للدفعة التالية. هذا يمنع
   * ضياع فرع/موظف/فاتورة أُضيفت أثناء مزامنة جارية.
   */
  function markUploaded(key, payload, sourcePayload = payload) {
    const currentRaw = core.getRawCompanyDataset ? core.getRawCompanyDataset(key) : localStorage.getItem(key);
    const expectedRaw = sourcePayload.deleted ? null : sourcePayload.value;
    const currentMeta = localMetaFor(key);
    if (currentRaw !== expectedRaw || Number(currentMeta.updatedAt || 0) > Number(payload.updatedAt || 0)) {
      return false;
    }
    core.rawSet(core.metaKey(key), JSON.stringify({
      ...currentMeta,
      updatedAt: Number(payload.updatedAt || Date.now()),
      revision: Number(payload.revision || 1),
      deviceId: payload.deviceId || '',
      source: backendSource,
      seeded: false
    }));
    completePendingForKey(key);
    return true;
  }

  function canApplyRemote(key, payload, allowEqual = true) {
    if (pendingForKey(key)) return false;
    const localMeta = localMetaFor(key);
    const localTime = Number(localMeta.updatedAt || 0);
    if (localMeta.seeded === true || localTime <= 0) return true;
    const remoteTime = Number(payload.updatedAt || 0);
    return allowEqual ? remoteTime >= localTime : remoteTime > localTime;
  }

  function applyRemote(key, payload, options = {}) {
    if (options.force !== true && !canApplyRemote(key, payload, options.allowEqual !== false)) return false;
    // حتى مع force لا نكتب فوق تعديل محلي ما زال ينتظر الرفع.
    if (pendingForKey(key)) return false;
    core.applyRemoteDataset(key, payload.deleted ? null : payload.value, {
      updatedAt: Number(payload.updatedAt || Date.now()),
      revision: Number(payload.revision || 1),
      deviceId: payload.deviceId || null,
      source: backendSource,
      seeded: false
    });
    completePendingForKey(key);
    return true;
  }

  function companyMeta(location, extra = {}) {
    return {
      tenantId: canonicalCompanyId,
      companyId: canonicalCompanyId,
      companyKey: session.companyKey || '',
      companyName: session.companyName || '',
      appName: 'كاش توب 2',
      schema: 19,
      datasetCount: CLOUD_DATA_KEYS.length,
      deviceId: core.rawGet('cashtop_device_id') || '',
      updatedAt: Date.now(),
      ...extra
    };
  }


  async function pullDatasetKeys(keys, options = {}) {
    if (core.localReady && typeof core.localReady.then === 'function') {
      try { await core.localReady; } catch (_) {}
    }
    const requested = [...new Set((Array.isArray(keys) ? keys : []).filter(key => CLOUD_DATA_KEYS.includes(key)))];
    if (!requested.length) return { hasRemote: false, count: 0, applied: 0 };
    const showProgress = options.silentProgress !== true;
    if (showProgress) {
      reportPullStart(requested[0] || '', 0, requested.length);
      reportSyncProgress(0, requested.length, 'جاري سحب أحدث البيانات من قاعدة البيانات...');
    }
    const access = await openLightDatabaseAccess();
    const token = access.token;
    const location = access.location;
    startRealtimeStream(location, token);
    let applied = 0;
    let found = 0;
    let processed = 0;

    try {
      /* بيانات الوصول التي قرأناها للتحقق تُطبّق أيضاً إن كانت أحدث. */
      if (requested.includes('cashtop_company_access')) {
        if (access.accessPayload != null) {
          const payload = normalizeRemotePayload(access.accessPayload);
          found += 1;
          if ((options.force === true || canApplyRemote('cashtop_company_access', payload)) &&
              applyRemote('cashtop_company_access', payload, { force: options.force === true })) applied += 1;
        }
        processed += 1;
        if (showProgress) reportSyncProgress(processed, requested.length, 'تم سحب بيانات الوصول والمستخدمين...');
      }

      const rest = requested.filter(key => key !== 'cashtop_company_access');
      const concurrency = Math.max(1, Math.min(8, Number(options.concurrency || 6)));
      for (let i = 0; i < rest.length; i += concurrency) {
        const chunk = rest.slice(i, i + concurrency);
        const results = await Promise.all(chunk.map(async key => {
          try { return { key, raw: await readDatasetLocation(location, key, token) }; }
          catch (error) { return { key, error }; }
        }));
        for (const result of results) {
          processed += 1;
          if (result.error) {
            console.warn('[CASH TOP 2] progressive dataset pull:', result.key, result.error);
            if (showProgress) reportSyncProgress(processed, requested.length, `تعذر سحب ${result.key} مؤقتاً؛ متابعة بقية البيانات...`);
            continue;
          }
          if (result.raw != null) {
            found += 1;
            const payload = normalizeRemotePayload(result.raw);
            const localMeta = localMetaFor(result.key);
            const localTime = Number(localMeta.updatedAt || 0);
            const remoteTime = Number(payload.updatedAt || 0);
            const pending = Boolean(pendingForKey(result.key));
            const seeded = localMeta.seeded === true || localTime <= 0;
            if ((options.force === true || seeded || (!pending && remoteTime > localTime)) &&
                applyRemote(result.key, payload, { force: options.force === true })) applied += 1;
          }
          if (showProgress) reportSyncProgress(processed, requested.length, `جاري تحديث ${result.key}...`);
        }
      }

      const meta = await readMetaLocation(location, token).catch(() => ({}));
      writeState({
        initialLoaded: true,
        progressiveLoaded: true,
        loadedAt: Date.now(),
        lastRemoteUpdatedAt: Number(meta?.updatedAt || 0),
        lastSuccessAt: Date.now(),
        lastError: '',
        authMode: backendAuthMode(token),
        remotePath: locationPath(location)
      });
      core.updateSyncBadge();
      if (applied > 0) window.dispatchEvent(new CustomEvent('cashtop:sync-complete', { detail: { processed: 0, pulled: applied, uploaded: 0, progressive: true } }));
      return { hasRemote: found > 0, count: found, applied, path: locationPath(location), progressive: true };
    } finally {
      if (showProgress) {
        reportPullEnd(requested[requested.length - 1] || '', processed, requested.length);
        reportSyncProgress(processed, requested.length, 'اكتمل سحب البيانات', { active: false, done: true, success: true });
      }
    }
  }

  async function pullPriorityDatasets(options = {}) {
    return pullDatasetKeys(pagePriorityDatasets(), options);
  }

  function scheduleBackgroundFullPull(delay = 420) {
    clearTimeout(backgroundPullTimer);
    backgroundPullTimer = setTimeout(async () => {
      if (backgroundPullRunning || core.getSyncQueue().length) return;
      backgroundPullRunning = true;
      try {
        const priority = new Set(pagePriorityDatasets());
        const remaining = CLOUD_DATA_KEYS.filter(key => !priority.has(key));
        const chunkSize = 8;
        for (let i = 0; i < remaining.length; i += chunkSize) {
          if (core.getSyncQueue().length) break;
          await pullDatasetKeys(remaining.slice(i, i + chunkSize), { concurrency: 8, silentProgress: true }).catch(error => console.warn('[CASH TOP 2] background dataset sync:', error));
          await new Promise(resolve => {
            if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 900 });
            else setTimeout(resolve, 24);
          });
        }
      } finally {
        backgroundPullRunning = false;
      }
    }, Math.max(0, Number(delay) || 0));
  }

  async function reconcileLegacyAll(options = {}) {
    if (syncing) return { processed: 0, pulled: 0, uploaded: 0, remaining: core.getSyncQueue().length, busy: true };

    syncing = true;
    writeState({ syncing: true, lastError: '', syncStartedAt: Date.now() });
    try {
      const forceProbe = options.forcePathProbe === true || options.forceCheck === true;
      let access = await openDatabaseAccess(forceProbe);
      let token = access.token;
      let resolved = access.resolved;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (attempt > 0) resolved = { location: resolved.location, read: await readLocation(resolved.location, token) };
        const remoteRead = resolved.read;
        const remoteCompany = remoteRead.data && typeof remoteRead.data === 'object' ? remoteRead.data : {};
        if (remoteStats(remoteCompany).hasData && !locationBelongsToCurrentCompany(resolved.location, remoteCompany)) {
          throw new Error('تم منع مزامنة عقدة لا تخص المفتاح الحالي. لا توجد أي بيانات مشتركة بين الشركات.');
        }
        const remoteDatasets = remoteCompany.datasets && typeof remoteCompany.datasets === 'object'
          ? remoteCompany.datasets
          : {};

        const nextDatasets = { ...remoteDatasets };
        const pulls = [];
        const uploads = [];
        const queue = core.getSyncQueue();

        for (const key of CLOUD_DATA_KEYS) {
          const hasRemote = Object.prototype.hasOwnProperty.call(remoteDatasets, key);
          const remote = hasRemote ? normalizeRemotePayload(remoteDatasets[key]) : null;
          const localMeta = localMetaFor(key);
          const localTime = Number(localMeta.updatedAt || 0);
          const remoteTime = Number(remote?.updatedAt || 0);
          const pending = queue.some(item => item.key === key);
          const seeded = localMeta.seeded === true || localTime <= 0;

          /* فتح/قفل استيراد النسخ وخطة الشركة لا يوقفان المزامنة ولا تضيع قيمهما عند وجود تعديل محلي معلّق. */
          if (key === 'cashtop_company_access' && remote && pending) {
            mergeAdminControlledAccess(remoteDatasets[key]);
          }

          if (remote && (seeded || (!pending && remoteTime > localTime))) {
            pulls.push({ key, payload: remote });
            continue;
          }

          /* لا نرفع عشرات المجموعات الفارغة المزروعة تلقائياً عند إنشاء مفتاح جديد. */
          if (!remote && seeded && !pending) continue;

          if (!remote || pending || localTime > remoteTime) {
            const payload = makeLocalPayload(key, remote?.revision || 0);
            uploads.push({ key, payload });
            nextDatasets[key] = payload;
          }
        }

        if (uploads.length === 0) {
          const appliedPulls = pulls.reduce((count, item) => count + (applyRemote(item.key, item.payload) ? 1 : 0), 0);
          writeState({
            syncing: false,
            initialLoaded: true,
            lastRemoteUpdatedAt: Number(remoteCompany.meta?.updatedAt || 0),
            loadedAt: Date.now(),
            lastSuccessAt: Date.now(),
            lastError: '',
            authMode: backendAuthMode(token),
            remotePath: locationPath(resolved.location)
          });
          core.updateSyncBadge();
          return {
            processed: 0,
            pulled: appliedPulls,
            uploaded: 0,
            remaining: core.getSyncQueue().length,
            projectId: cfg.projectId,
            path: locationPath(resolved.location),
            authMode: backendAuthMode(token)
          };
        }

        const nextCompany = {
          ...remoteCompany,
          datasets: nextDatasets,
          meta: {
            ...(remoteCompany.meta || {}),
            ...companyMeta(resolved.location, {
              reconciledAt: Date.now(),
              lastSyncedBy: core.rawGet('cashtop_device_id') || ''
            })
          }
        };

        let written;
        try {
          written = await writeLocation(resolved.location, token, nextCompany, remoteRead.etag);
        } catch (error) {
          if (!token && isPermissionError(error)) {
            token = await requireDatabaseToken();
            selectedLocation = resolved.location;
            resolved = { location: resolved.location, read: await readLocation(resolved.location, token) };
            continue;
          }
          throw error;
        }
        if (written.conflict) continue;

        const appliedPulls = pulls.reduce((count, item) => count + (applyRemote(item.key, item.payload) ? 1 : 0), 0);
        const completedUploads = uploads.reduce((count, item) => count + (markUploaded(item.key, item.payload) ? 1 : 0), 0);

        writeState({
          syncing: false,
          initialLoaded: true,
          lastRemoteUpdatedAt: Number(nextCompany.meta.updatedAt || Date.now()),
          loadedAt: Date.now(),
          lastSuccessAt: Date.now(),
          lastError: '',
          authMode: backendAuthMode(token),
          remotePath: locationPath(resolved.location)
        });
        core.updateSyncBadge();
        window.dispatchEvent(new CustomEvent('cashtop:sync-complete', {
          detail: { processed: completedUploads, pulled: appliedPulls, uploaded: completedUploads }
        }));
        return {
          processed: completedUploads,
          pulled: appliedPulls,
          uploaded: completedUploads,
          remaining: core.getSyncQueue().length,
          projectId: cfg.projectId,
          path: locationPath(resolved.location),
          authMode: backendAuthMode(token)
        };
      }

      throw new Error('حدث تعارض متكرر أثناء المزامنة. أعد المحاولة بعد لحظات.');
    } catch (error) {
      const message = errorMessage(error);
      writeState({ syncing: false, lastError: message, errorAt: Date.now() });
      console.error('[CASH TOP 2] Database API sync:', error);
      throw new Error(message);
    } finally {
      syncing = false;
      core.updateSyncBadge();
    }
  }

  function payloadJsonValue(payload) {
    const normalized = normalizeRemotePayload(payload);
    if (normalized.deleted) return null;
    let value = normalized.value;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (_) { return value; }
    }
    return value;
  }

  function stableRecordId(item) {
    return core.recordIdentity ? core.recordIdentity(item) : '';
  }

  function mergeArrayByDelta(localValue, remoteValue, touchedIds = [], deletedIds = []) {
    const touched = new Set(touchedIds || []);
    const deleted = new Set(deletedIds || []);
    const localMap = new Map(localValue.map(item => [stableRecordId(item), item]).filter(([id]) => id));
    const merged = [];
    const seen = new Set();
    for (const remoteItem of remoteValue) {
      const id = stableRecordId(remoteItem);
      if (id && deleted.has(id)) continue;
      if (id && touched.has(id) && localMap.has(id)) {
        merged.push(localMap.get(id));
        seen.add(id);
      } else {
        merged.push(remoteItem);
        if (id) seen.add(id);
      }
    }
    for (const localItem of localValue) {
      const id = stableRecordId(localItem);
      if (!id) {
        if (!merged.some(item => JSON.stringify(item) === JSON.stringify(localItem))) merged.push(localItem);
        continue;
      }
      if (deleted.has(id) || seen.has(id)) continue;
      if (touched.has(id) || !remoteValue.some(item => stableRecordId(item) === id)) merged.push(localItem);
      seen.add(id);
    }
    return merged;
  }

  function arrayDeltaPresent(remoteValue, desiredValue, touchedIds = [], deletedIds = []) {
    const remoteMap = new Map(remoteValue.map(item => [stableRecordId(item), item]).filter(([id]) => id));
    const desiredMap = new Map(desiredValue.map(item => [stableRecordId(item), item]).filter(([id]) => id));
    for (const id of touchedIds || []) {
      if (!remoteMap.has(id) || JSON.stringify(remoteMap.get(id)) !== JSON.stringify(desiredMap.get(id))) return false;
    }
    for (const id of deletedIds || []) if (remoteMap.has(id)) return false;
    return true;
  }

  function mergePendingPayload(localPayload, remotePayload, pending) {
    if (pending?.forceReplace === true) return localPayload;
    if (!remotePayload || pending?.deletedDataset === true) return localPayload;
    const localValue = payloadJsonValue(localPayload);
    const remoteValue = payloadJsonValue(remotePayload);

    if (Array.isArray(localValue) && Array.isArray(remoteValue) &&
        ((pending?.touchedIds?.length || 0) + (pending?.deletedIds?.length || 0) > 0)) {
      const merged = mergeArrayByDelta(localValue, remoteValue, pending.touchedIds || [], pending.deletedIds || []);
      return { ...localPayload, value: JSON.stringify(merged), deleted: false };
    }

    if (localValue && remoteValue && typeof localValue === 'object' && typeof remoteValue === 'object' &&
        !Array.isArray(localValue) && !Array.isArray(remoteValue) &&
        ((pending?.touchedFields?.length || 0) + (pending?.deletedFields?.length || 0) > 0)) {
      const merged = { ...remoteValue };
      for (const field of pending.touchedFields || []) {
        if (!Object.prototype.hasOwnProperty.call(localValue, field)) continue;
        const nested = pending.nestedArrayChanges?.[field];
        if (nested && Array.isArray(localValue[field]) && Array.isArray(remoteValue[field])) {
          merged[field] = mergeArrayByDelta(localValue[field], remoteValue[field], nested.touchedIds || [], nested.deletedIds || []);
        } else {
          merged[field] = localValue[field];
        }
      }
      for (const field of pending.deletedFields || []) delete merged[field];
      return { ...localPayload, value: JSON.stringify(merged), deleted: false };
    }

    return localPayload;
  }

  function pendingChangesPresent(remotePayload, desiredPayload, pending) {
    if (!remotePayload) return false;
    const remote = normalizeRemotePayload(remotePayload);
    if (pending?.deletedDataset === true) return remote.deleted === true || remote.value == null;
    if (pending?.forceReplace === true) {
      return remote.deleted === desiredPayload.deleted && String(remote.value ?? '') === String(desiredPayload.value ?? '');
    }
    const remoteValue = payloadJsonValue(remote);
    const desiredValue = payloadJsonValue(desiredPayload);

    if (Array.isArray(remoteValue) && Array.isArray(desiredValue) &&
        ((pending?.touchedIds?.length || 0) + (pending?.deletedIds?.length || 0) > 0)) {
      return arrayDeltaPresent(remoteValue, desiredValue, pending.touchedIds || [], pending.deletedIds || []);
    }

    if (remoteValue && desiredValue && typeof remoteValue === 'object' && typeof desiredValue === 'object' &&
        !Array.isArray(remoteValue) && !Array.isArray(desiredValue) &&
        ((pending?.touchedFields?.length || 0) + (pending?.deletedFields?.length || 0) > 0)) {
      for (const field of pending.touchedFields || []) {
        const nested = pending.nestedArrayChanges?.[field];
        if (nested && Array.isArray(remoteValue[field]) && Array.isArray(desiredValue[field])) {
          if (!arrayDeltaPresent(remoteValue[field], desiredValue[field], nested.touchedIds || [], nested.deletedIds || [])) return false;
        } else if (JSON.stringify(remoteValue[field]) !== JSON.stringify(desiredValue[field])) {
          return false;
        }
      }
      for (const field of pending.deletedFields || []) if (Object.prototype.hasOwnProperty.call(remoteValue, field)) return false;
      return true;
    }

    return remote.deleted === desiredPayload.deleted && String(remote.value ?? '') === String(desiredPayload.value ?? '');
  }

  function applyMergedPayloadLocally(key, payload) {
    if (payload.deleted) return;
    const currentRaw = core.getRawCompanyDataset ? core.getRawCompanyDataset(key) : localStorage.getItem(key);
    if (String(currentRaw ?? '') === String(payload.value ?? '')) return;
    core.applyRemoteDataset(key, payload.value, {
      ...localMetaFor(key),
      updatedAt: Number(payload.updatedAt || Date.now()),
      revision: Number(payload.revision || 1),
      deviceId: payload.deviceId || core.rawGet('cashtop_device_id') || '',
      source: backendSource,
      seeded: false,
      merged: true
    });
  }

  /*
   * المزامنة المتينة تعمل على مستوى كل dataset بصورة مستقلة. فشل مجموعة واحدة
   * (مثلاً موظفين أو مخزون) لا يوقف بقية الطابور؛ كل مجموعة تنجح تُحذف فوراً
   * من عداد العمليات المعلقة، بينما تبقى المجموعات المتعثرة للمحاولة التالية.
   */
  async function reconcileDatasetsIndependently(options = {}) {
    if (core.localReady && typeof core.localReady.then === 'function') {
      try { await core.localReady; } catch (_) {}
    }
    if (options.forceRetry === true) datasetRetryState.clear();
    if (syncing) return { processed: 0, pulled: 0, uploaded: 0, failed: 0, remaining: core.getSyncQueue().length, busy: true };

    syncing = true;
    writeState({ syncing: true, lastError: '', lastDeferredError: '', syncStartedAt: Date.now() });
    let location = null;
    let token = '';
    let uploaded = 0;
    let pulled = 0;
    const failedKeys = [];
    const errorSummaries = [];

    try {
      const access = await openLightDatabaseAccess();
      token = access.token;
      location = access.location;
      startRealtimeStream(location, token);
      const manual = options.manual === true || options.forceRetry === true;
      const pendingKeys = [...new Set(core.getSyncQueue().map(item => item.key).filter(key => CLOUD_DATA_KEYS.includes(key)))];
      let pendingProgress = 0;
      if (pendingKeys.length) reportSyncProgress(0, pendingKeys.length, options.importSync ? 'جاري رفع النسخة الاحتياطية...' : 'جاري رفع العمليات المعلقة...');

      const hardware = Math.max(2, Number(navigator.hardwareConcurrency || 4));
      const memory = Math.max(0, Number(navigator.deviceMemory || 0));
      const uploadConcurrency = Math.max(2, Math.min(options.importSync ? 6 : 5, memory && memory <= 2 ? 2 : Math.ceil(hardware / 2)));
      let nextPendingIndex = 0;
      let tokenPromise = null;
      const ensureSharedToken = async () => {
        if (token) return token;
        if (!tokenPromise) tokenPromise = requireDatabaseToken().finally(() => { tokenPromise = null; });
        token = await tokenPromise;
        return token;
      };

      const processPendingKey = async key => {
        try {
          if (!canRetryDatasetNow(key, manual)) {
            failedKeys.push(key);
            return;
          }
          let remoteRaw;
          try {
            remoteRaw = await readDatasetLocation(location, key, token);
          } catch (error) {
            if (!token && isPermissionError(error)) {
              await ensureSharedToken();
              remoteRaw = await readDatasetLocation(location, key, token);
            } else throw error;
          }
          let remote = remoteRaw == null ? null : normalizeRemotePayload(remoteRaw);
          if (key === 'cashtop_company_access' && remoteRaw != null) mergeAdminControlledAccess(remoteRaw);

          let committed = false;
          let desired = null;
          let sourceLocalPayload = null;
          let sourcePending = null;

          for (let attempt = 0; attempt < 4 && !committed; attempt += 1) {
            sourcePending = pendingForKey(key);
            if (!sourcePending) { committed = true; break; }
            sourceLocalPayload = makeLocalPayload(key, remote?.revision || 0);
            const cloudLocalPayload = makeCloudSafePayload(key, sourceLocalPayload, remote);
            desired = mergePendingPayload(cloudLocalPayload, remote, sourcePending);
            try {
              await writeDatasetLocation(location, key, token, desired);
            } catch (error) {
              if (!token && isPermissionError(error)) {
                await ensureSharedToken();
                await writeDatasetLocation(location, key, token, desired);
              } else throw error;
            }
            const verifiedRaw = await readDatasetLocation(location, key, token);
            committed = pendingChangesPresent(verifiedRaw, desired, sourcePending);
            remote = verifiedRaw == null ? null : normalizeRemotePayload(verifiedRaw);
            if (!committed) await new Promise(resolve => setTimeout(resolve, 35 * (attempt + 1)));
          }

          if (!pendingForKey(key)) { clearDatasetFailure(key); return; }
          if (!committed || !desired || !sourceLocalPayload) throw new Error(`تعذر تثبيت تعديلات ${key} بسبب تعارض مزامنة متكرر.`);

          const currentRaw = core.getRawCompanyDataset ? core.getRawCompanyDataset(key) : localStorage.getItem(key);
          const currentMeta = localMetaFor(key);
          const localUnchanged = currentRaw === (sourceLocalPayload.deleted ? null : sourceLocalPayload.value) &&
            Number(currentMeta.updatedAt || 0) <= Number(sourceLocalPayload.updatedAt || 0);

          if (localUnchanged) {
            if (!desired.deleted) applyMergedPayloadLocally(key, desired);
            if (markUploaded(key, desired, sourceLocalPayload)) uploaded += 1;
          }
          clearDatasetFailure(key);
        } catch (error) {
          noteDatasetFailure(key, error);
          failedKeys.push(key);
          errorSummaries.push({ key, message: safeSyncMessage(error) });
          console.warn('[CASH TOP 2] deferred dataset sync:', key, error);
        } finally {
          pendingProgress += 1;
          reportSyncProgress(pendingProgress, Math.max(1, pendingKeys.length), `مزامنة ${key}...`);
          core.updateSyncBadge();
        }
      };

      const workers = Array.from({ length: Math.min(uploadConcurrency, Math.max(1, pendingKeys.length)) }, async () => {
        while (nextPendingIndex < pendingKeys.length) {
          const key = pendingKeys[nextPendingIndex++];
          await processPendingKey(key);
        }
      });
      await Promise.all(workers);

      // بعد رفع ما يمكن رفعه، اسحب بيانات الصفحة. المجموعات التي بقيت معلقة
      // محمية داخل applyRemote ولن تُستبدل بنسخة بعيدة أقدم.
      const pullKeys = options.manual === true || options.forceCheck === true ? CLOUD_DATA_KEYS : pagePriorityDatasets();
      try {
        const pullResult = await pullDatasetKeys(pullKeys, { force: options.force === true, concurrency: 8 });
        pulled = Number(pullResult?.applied || 0);
      } catch (error) {
        errorSummaries.push({ key: '__pull__', message: safeSyncMessage(error) });
        console.warn('[CASH TOP 2] deferred progressive pull:', error);
      }

      await writeMetaLocation(location, token, companyMeta(location, {
        reconciledAt: Date.now(),
        lastSyncedBy: core.rawGet('cashtop_device_id') || ''
      })).catch(error => console.warn('[CASH TOP 2] metadata sync deferred:', error));

      const remaining = core.getSyncQueue().length;
      const deferredMessage = errorSummaries[0]?.message || '';
      writeState({
        syncing: false,
        initialLoaded: true,
        loadedAt: Date.now(),
        lastSuccessAt: uploaded > 0 || pulled > 0 || failedKeys.length === 0 ? Date.now() : readState().lastSuccessAt,
        lastError: '',
        lastDeferredError: deferredMessage,
        deferredAt: failedKeys.length ? Date.now() : 0,
        authMode: backendAuthMode(token),
        remotePath: locationPath(location)
      });
      core.updateSyncBadge();
      window.dispatchEvent(new CustomEvent('cashtop:sync-complete', {
        detail: { processed: uploaded, pulled, uploaded, failed: failedKeys.length, remaining, partial: failedKeys.length > 0 }
      }));
      return {
        processed: uploaded,
        pulled,
        uploaded,
        failed: failedKeys.length,
        failedKeys,
        errors: errorSummaries,
        remaining,
        partial: failedKeys.length > 0,
        deferred: failedKeys.length > 0,
        projectId: cfg.projectId,
        path: locationPath(location),
        authMode: backendAuthMode(token)
      };
    } catch (error) {
      const message = safeSyncMessage(error);
      writeState({ syncing: false, lastError: isTransientNetworkError(error) ? '' : message, lastDeferredError: message, errorAt: Date.now() });
      console.warn('[CASH TOP 2] database access deferred:', error);
      if (isTransientNetworkError(error)) {
        return { processed: uploaded, pulled, uploaded, failed: core.getSyncQueue().length, remaining: core.getSyncQueue().length, deferred: true, networkDeferred: true, message };
      }
      throw new Error(message);
    } finally {
      syncing = false;
      core.updateSyncBadge();
      reportSyncProgress(1, 1, core.getSyncQueue().length ? 'بقيت عمليات معلقة وستُعاد تلقائياً' : 'اكتملت المزامنة', {
        active: false, done: true, success: core.getSyncQueue().length === 0
      });
    }
  }

  async function reconcileAll(options = {}) {
    return reconcileDatasetsIndependently(options);
  }

  async function pullAll(options = {}) {
    return pullDatasetKeys(CLOUD_DATA_KEYS, {
      force: options.force === true,
      concurrency: options.concurrency || 8
    });
  }

  function syncAll(options = {}) {
    const run = async () => {
      if (core.localReady && typeof core.localReady.then === 'function') {
        try { await core.localReady; } catch (_) {}
      }
      if (core.getSyncQueue().length) return reconcileAll(options);
      return options.manual === true || options.forceCheck === true ? pullAll(options) : pullPriorityDatasets(options);
    };
    // كل طلبات المزامنة تمر في سلسلة واحدة حتى لا ترجع الاستعادة busy أثناء دورة قائمة.
    syncSerial = syncSerial.catch(() => null).then(run);
    return syncSerial;
  }

  async function flushPendingQueue() {
    const result = await syncAll({ forceRetry: true });
    return { processed: result.uploaded || 0, remaining: result.remaining || 0, pulled: result.pulled || 0 };
  }

  async function checkRemoteAndPull(force = false) {
    return force ? pullAll({ force: true }) : pullPriorityDatasets();
  }

  async function uploadDataset(key) {
    if (!CLOUD_DATA_KEYS.includes(key)) return false;
    core.enqueueSyncOperation(key);
    const result = await syncAll({ forceRetry: true });
    return Number(result.uploaded || 0) > 0;
  }

  function scheduleSync(delay = 120) {
    clearTimeout(scheduledSync);
    scheduledSync = setTimeout(() => {
      // لا نعتمد على navigator.onLine كحكم نهائي؛ بعض الأجهزة تعطي حالة خاطئة.
      const job = syncAll({ manual: false, forceCheck: false });
      job.then(result => {
        if (core.getSyncQueue().length) {
          // تبقى العمليات المتعثرة معلقة ويُعاد فحصها لاحقاً، من دون تعطيل ما بعدها.
          scheduleSync(result?.networkDeferred ? 2200 : 650);
        } else {
          scheduleBackgroundFullPull(260);
        }
      }).catch(error => {
        console.warn('[CASH TOP 2] scheduled database sync:', error);
        if (core.getSyncQueue().length) scheduleSync(2500);
      });
    }, delay);
  }


  let legacyAuditCleanupDone = false;
  async function pruneRemoteAuditTrailRecent(location, token, limit = 100) {
    try {
      const response = await fetchWithTimeout(auditTrailRecentEndpoint(location, '', token), { method:'GET', headers:{Accept:'application/json'} }, 12000);
      if (!response.ok) return 0;
      const payload = await response.json().catch(()=>null);
      const rows = payload && typeof payload === 'object' ? Object.values(payload).filter(Boolean) : [];
      rows.sort((a,b)=>new Date(b.timestamp||0)-new Date(a.timestamp||0));
      const remove = rows.slice(Math.max(1, Number(limit)||100));
      await Promise.allSettled(remove.map(item=>fetchWithTimeout(auditTrailRecentEndpoint(location, item.id, token), {method:'DELETE'}, 9000)));
      return remove.length;
    } catch (_) { return 0; }
  }
  async function cleanupLegacyAuditTrail(location, token) {
    if (legacyAuditCleanupDone) return;
    legacyAuditCleanupDone = true;
    try { await fetchWithTimeout(auditTrailLegacyRootEndpoint(location, token), {method:'DELETE'}, 12000); } catch (_) {}
  }

  let auditTrailSyncing = false;
  async function flushAuditTrailPending(options = {}) {
    if (auditTrailSyncing) return { uploaded: 0, busy: true };
    const limit = Math.max(1, Number(options.limit || 80));
    const pending = core.getAuditPendingAsync ? await core.getAuditPendingAsync(limit) : (core.getAuditPending?.() || []).slice(0, limit);
    if (!pending.length) return { uploaded: 0, remaining: 0 };
    if (navigator.onLine === false && options.force !== true) return { uploaded: 0, remaining: pending.length, offline: true };
    auditTrailSyncing = true;
    const succeeded = [];
    try {
      const { token, location } = await openLightDatabaseAccess();
      const batch = pending.slice(0, limit);
      const concurrency = Math.min(8, Math.max(1, Number(options.concurrency || 6)));
      let cursor = 0;
      async function worker() {
        while (cursor < batch.length) {
          const index = cursor++;
          const record = batch[index];
          if (!record?.id) continue;
          const stamp = String(record.timestamp || new Date().toISOString());
          const day = stamp.slice(0, 10) || new Date().toISOString().slice(0,10);
          const hour = String(new Date(stamp).getHours()).padStart(2,'0');
          try {
            const response = await fetchWithTimeout(auditTrailRecentEndpoint(location, record.id, token), {
              method: 'PUT', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body: JSON.stringify(record)
            }, 9000);
            if (!response.ok) throw await firebaseError(response);
            succeeded.push(String(record.id));
          } catch (error) {
            if (!isTransientNetworkError(error)) console.warn('[CASH TOP 2] audit upload:', error);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, () => worker()));
      if (succeeded.length) {
        if (core.completeAuditPendingAsync) await core.completeAuditPendingAsync(succeeded);
        else core.completeAuditPending?.(succeeded);
        await pruneRemoteAuditTrailRecent(location, token, 100);
        cleanupLegacyAuditTrail(location, token).catch(() => null);
      }
      const remaining = core.getAuditPendingCountAsync ? await core.getAuditPendingCountAsync() : (core.getAuditPending?.().length || 0);
      if (remaining && navigator.onLine !== false) setTimeout(() => flushAuditTrailPending({ limit: 80 }).catch(() => null), 600);
      return { uploaded: succeeded.length, remaining };
    } finally {
      auditTrailSyncing = false;
    }
  }

  async function fetchAuditTrailRecent(limit = 100) {
    const { token, location } = await openLightDatabaseAccess();
    cleanupLegacyAuditTrail(location, token).catch(() => null);
    const response = await fetchWithTimeout(auditTrailRecentEndpoint(location, '', token), { method:'GET', headers:{Accept:'application/json'} }, 12000);
    if (!response.ok) throw await firebaseError(response);
    const payload = await response.json().catch(()=>null);
    const rows = payload && typeof payload === 'object' ? Object.values(payload).filter(Boolean) : [];
    return rows.sort((a,b)=>new Date(b.timestamp||0)-new Date(a.timestamp||0)).slice(0, Math.max(1, Number(limit)||100));
  }

  async function fetchAuditTrailHour(day, hour) {
    const normalizedDay = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : new Date().toISOString().slice(0,10);
    const normalizedHour = String(Math.max(0, Math.min(23, Number(hour || 0)))).padStart(2,'0');
    const { token, location } = await openLightDatabaseAccess();
    const response = await fetchWithTimeout(auditTrailEndpoint(location, normalizedDay, normalizedHour, '', token), { method: 'GET', headers: { Accept: 'application/json' } }, 12000);
    if (!response.ok) throw await firebaseError(response);
    const payload = await response.json().catch(() => null);
    const rows = payload && typeof payload === 'object' ? Object.values(payload).filter(Boolean) : [];
    return rows.sort((a,b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  }

  async function fetchAuditTrailDay(day) {
    const normalizedDay = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : new Date().toISOString().slice(0,10);
    const result = [];
    for (let hour = 23; hour >= 0; hour -= 1) {
      const rows = await fetchAuditTrailHour(normalizedDay, hour).catch(() => []);
      result.push(...rows);
    }
    return result.sort((a,b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  }

  function signOut() {
    rawStorage.remove(AUTH_KEY);
    writeState({ signedOutAt: Date.now() });
    return Promise.resolve();
  }

  window.CashtopFirebase = {
    syncAll,
    reconcileAll,
    flushAuditTrailPending,
    fetchAuditTrailDay,
    fetchAuditTrailHour,
    fetchAuditTrailRecent,
    flushPendingQueue,
    uploadDataset,
    pullAll,
    pullDatasetKeys,
    pullPriorityDatasets,
    checkRemoteAndPull,
    signOut,
    getState: readState,
    resetRemotePath: () => {
      rawStorage.remove(locationKey);
      selectedLocation = null;
      return Promise.resolve(true);
    },
    getProjectInfo: () => ({
      projectId: cfg.projectId,
      backend: settings.backendName || (isFirestoreBridge ? 'Google Cloud Firestore' : 'Firebase RTDB'),
      databaseURL: cfg.databaseURL,
      path: selectedLocation ? locationPath(selectedLocation) : `${primaryRoot}/${companyIds[0]}`,
      companyIds: [...companyIds],
      authMode: readState().authMode || 'auto'
    })
  };

  window.addEventListener('cashtop:data-changed', () => scheduleSync(45));
  window.addEventListener('cashtop:audit-pending', () => setTimeout(() => flushAuditTrailPending().catch(() => null), 80));
  window.addEventListener('cashtop:sync-now', () => scheduleSync(20));
  window.addEventListener('cashtop:sync-queue-restored', () => scheduleSync(35));
  window.addEventListener('online', () => {
    datasetRetryState.clear();
    scheduleSync(20);
    flushAuditTrailPending({ limit: 120 }).catch(() => null);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(90);
  });

  /* Firebase يستخدم بث SSE لحظياً بين الأجهزة. يبقى polling سريعاً كخطة احتياطية،
     وFirestore يعتمد polling خفيفاً لأن الاتصال الشبكي يُغلق بعد كل دفعة مع بقاء الكاش المحلي. */
  pollTimer = setInterval(() => {
    if (document.hidden || core.getSyncQueue().length) return;
    const realtimeHealthy = !isFirestoreBridge && realtimeSource && realtimeSource.readyState === EventSource.OPEN;
    if (!realtimeHealthy) pullPriorityDatasets({ concurrency: 8, silentProgress: true }).catch(() => null);
  }, isFirestoreBridge ? 2800 : 4500);

  window.addEventListener('pagehide', () => {
    clearTimeout(scheduledSync);
    clearTimeout(backgroundPullTimer);
    clearTimeout(realtimePullTimer);
    stopRealtimeStream();
    if (pollTimer) clearInterval(pollTimer);
  }, { once: true });

  // تنظيف سجل التدقيق القديم مرة واحدة والاحتفاظ بآخر 100 حركة فقط.
  setTimeout(async()=>{if(navigator.onLine===false)return;try{const {token,location}=await openLightDatabaseAccess();await pruneRemoteAuditTrailRecent(location,token,100);await cleanupLegacyAuditTrail(location,token)}catch(_){}},1800);
  // أول دخول: نحاول قاعدة البيانات مباشرة حتى لو كانت navigator.onLine غير دقيقة.
  scheduleSync(10);
  setTimeout(() => flushAuditTrailPending({ limit: 120 }).catch(() => null), 350);
  if (!core.getSyncQueue().length) scheduleBackgroundFullPull(180);
} else if (core) {
  console.warn('[CASH TOP 2] Firebase sync configuration is incomplete.');
  core.updateSyncBadge();
}
})();
