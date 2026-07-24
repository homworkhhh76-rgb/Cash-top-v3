(function () {
  'use strict';

  const keepPortraitOrientation = () => {
    const standalone = Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
    if (!standalone || !screen.orientation || typeof screen.orientation.lock !== 'function') return;
    screen.orientation.lock('portrait').catch(() => {});
  };
  keepPortraitOrientation();
  window.addEventListener('pageshow', keepPortraitOrientation, { passive: true });
  window.addEventListener('orientationchange', keepPortraitOrientation, { passive: true });

  const rawGet = key => Storage.prototype.getItem.call(localStorage, key);
  const rawSet = (key, value) => Storage.prototype.setItem.call(localStorage, key, String(value));
  const rawRemove = key => Storage.prototype.removeItem.call(localStorage, key);
  const rawKey = index => Storage.prototype.key.call(localStorage, index);
  const backendSettings = window.CASHTOP_FIREBASE || {};
  const backendBase = String(backendSettings.masterConfig?.databaseURL || backendSettings.config?.databaseURL || '').replace(/\/+$/, '');
  const isFirestoreBridge = backendSettings.backendMode === 'firestore-sdk';
  function transportUrl(url) { return url; }
  const TAB_SESSION_KEY = 'cashtop_tab_session_v2';
  const parse = (value, fallback) => { try { return JSON.parse(value) ?? fallback; } catch (_) { return fallback; } };
  function writeSession(session) {
    rawSet('cashtop_session', JSON.stringify(session));
    try { sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(session)); } catch (_) {}
  }

  function decodeJsonValue(value, fallback = null) {
    let parsed = value;
    for (let i = 0; i < 3 && typeof parsed === 'string'; i += 1) {
      const decoded = parse(parsed, null);
      if (decoded === null) break;
      parsed = decoded;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        Object.prototype.hasOwnProperty.call(parsed, 'value') &&
        (parsed.valueEncoding || Object.prototype.hasOwnProperty.call(parsed, 'deleted') || Object.prototype.hasOwnProperty.call(parsed, 'updatedAt'))) {
      if (parsed.deleted === true) return fallback;
      return decodeJsonValue(parsed.value, fallback);
    }
    return parsed == null ? fallback : parsed;
  }

  function normalizeArray(value) {
    const parsed = decodeJsonValue(value, []);
    if (Array.isArray(parsed)) return parsed.filter(item => item != null);
    if (parsed && typeof parsed === 'object') {
      const recordHints = ['id', 'key', 'companyKey', 'tenantId', 'companyId', 'username', 'name', 'branchId', 'role'];
      if (recordHints.some(key => Object.prototype.hasOwnProperty.call(parsed, key))) return [parsed];
      return Object.entries(parsed).map(([key, item]) => {
        const decoded = decodeJsonValue(item, null);
        if (decoded && typeof decoded === 'object' && !Array.isArray(decoded) && decoded.id == null && !/^\d+$/.test(key)) return { ...decoded, id: key };
        return decoded;
      }).filter(item => item != null && typeof item === 'object');
    }
    return [];
  }

  function cleanupLegacyDemo() {
    const licenses = normalizeArray(rawGet('cashtop_admin_licenses')).filter(item => normalizeKey(item.key) !== 'CASHTOP-DEMO');
    const users = normalizeArray(rawGet('cashtop_admin_users')).filter(item => normalizeKey(item.companyKey) !== 'CASHTOP-DEMO');
    rawSet('cashtop_admin_licenses', JSON.stringify(licenses)); rawSet('cashtop_admin_users', JSON.stringify(users));
    if (normalizeKey(rawGet('cashtop_remembered_key')) === 'CASHTOP-DEMO') { rawRemove('cashtop_remembered_key'); rawRemove('cashtop_remembered_user'); }
  }

  function normalizeKey(value) { return String(value || '').trim().toUpperCase(); }
  function normalizeUsername(value) { return String(value || '').trim().toLowerCase(); }
  function sanitizeSegment(value) { return String(value || '').trim().replace(/[.#$\[\]\/]/g, '_'); }
  function namespaceKey(tenantId, key) { return `cashtop_data::${encodeURIComponent(tenantId)}::${key}`; }
  function metaKey(tenantId, key) { return `cashtop_meta::${encodeURIComponent(tenantId)}::${key}`; }
  function getTenantBindings() { return parse(rawGet('cashtop_tenant_bindings'), {}) || {}; }
  function setTenantBinding(companyKey, tenantId) {
    const key = normalizeKey(companyKey); const tenant = String(tenantId || '').trim();
    if (!key || !tenant) return;
    const bindings = getTenantBindings(); bindings[key] = tenant;
    rawSet('cashtop_tenant_bindings', JSON.stringify(bindings));
  }

  function datasetValue(companyNode, key, fallback) {
    const payload = companyNode?.datasets?.[key];
    if (payload && typeof payload === 'object' && (
      Object.prototype.hasOwnProperty.call(payload, 'value') ||
      Object.prototype.hasOwnProperty.call(payload, 'deleted') ||
      Object.prototype.hasOwnProperty.call(payload, 'updatedAt')
    )) {
      if (payload.deleted === true) return fallback;
      const rawValue = payload.value ?? fallback;
      return payload.valueEncoding === 'local-storage-json-v1' ? decodeJsonValue(rawValue, fallback) : decodeJsonValue(rawValue, rawValue);
    }
    return decodeJsonValue(payload, fallback);
  }

  function usernameToEmail(companyKey, username) {
    const clean = value => String(value).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (String(username).includes('@')) return String(username).trim().toLowerCase();
    return `${clean(companyKey)}.${clean(username)}@login.cashtop.app`;
  }

  function showStatus(message, type = 'info') {
    let box = document.getElementById('loginStatus');
    if (!box) {
      box = document.createElement('div');
      box.id = 'loginStatus';
      box.style.cssText = 'margin:0 0 14px;padding:9px 11px;border-radius:4px;font-size:12px;font-weight:700;line-height:1.7;display:none;';
      document.getElementById('loginForm')?.prepend(box);
    }
    const styles = {
      error: ['#fff0ef', '#b52b1f', '#f2b9b4'], success: ['#eaf8f0', '#087a43', '#a9dfc4'],
      info: ['#eef5fb', '#23668d', '#b8d7ea'], warning: ['#fff7e6', '#9b5b00', '#f2d295']
    }[type] || ['#eef5fb', '#23668d', '#b8d7ea'];
    box.style.background = styles[0]; box.style.color = styles[1]; box.style.border = `1px solid ${styles[2]}`;
    box.textContent = message; box.style.display = 'block';
  }

  function validateLicense(license) {
    if (!license) return { ok: false, message: 'مفتاح الشركة غير موجود أو لم تتم مزامنته بعد.' };
    if (license.status && license.status !== 'active') return { ok: false, message: 'تم إيقاف مفتاح الشركة. راجع مسؤول النظام.' };
    const start = license.startAt ? new Date(license.startAt).getTime() : 0;
    const end = license.endAt ? new Date(license.endAt).getTime() : 0;
    if (start && Number.isFinite(start) && Date.now() < start) return { ok: false, message: 'مدة المفتاح لم تبدأ بعد.' };
    if (end && Number.isFinite(end) && Date.now() >= end) return { ok: false, message: 'انتهت مدة مفتاح الشركة.' };
    return { ok: true, end };
  }

  function saveRemembered(key, username, remember) {
    if (remember) {
      rawSet('cashtop_remembered_key', key);
      rawSet('cashtop_remembered_user', username);
    } else {
      rawRemove('cashtop_remembered_key'); rawRemove('cashtop_remembered_user');
    }
  }

  function findCompanyAccessByKey(companyKey) {
    const boundTenant = String(getTenantBindings()[companyKey] || '').trim();
    const matches = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = rawKey(i);
      if (!key || !key.endsWith('::cashtop_company_access')) continue;
      const access = decodeJsonValue(rawGet(key), null);
      if (!access || normalizeKey(access.companyKey) !== companyKey) continue;
      const tenantId = String(access.tenantId || access.companyId || '');
      if (boundTenant && tenantId !== boundTenant) continue;
      matches.push(access);
    }
    if (boundTenant) return matches.find(access => String(access.tenantId || access.companyId || '') === boundTenant) || null;
    return matches.length === 1 ? matches[0] : null;
  }

  function resolveLocalContext(companyKey) {
    const licenses = normalizeArray(rawGet('cashtop_admin_licenses'));
    const users = normalizeArray(rawGet('cashtop_admin_users'));
    const boundTenant = String(getTenantBindings()[companyKey] || '').trim();
    let license = licenses.find(item => normalizeKey(item.key) === companyKey && (!boundTenant || String(item.tenantId || item.companyId || item.id) === boundTenant)) || null;
    const accessFromScan = findCompanyAccessByKey(companyKey);
    if (!license && accessFromScan) {
      const tenantId = String(accessFromScan.tenantId || accessFromScan.companyId || sanitizeSegment(companyKey));
      license = {
        id: accessFromScan.licenseId || tenantId,
        key: companyKey,
        tenantId,
        companyId: tenantId,
        companyName: accessFromScan.companyName || 'الشركة',
        status: accessFromScan.status || 'active',
        plan: accessFromScan.plan || 'pro',
        backupImportEnabled: accessFromScan.backupImportEnabled === true,
        startAt: accessFromScan.startAt || '',
        endAt: accessFromScan.endAt || ''
      };
      licenses.push(license);
      rawSet('cashtop_admin_licenses', JSON.stringify(licenses));
      setTenantBinding(companyKey, tenantId);
    }
    if (!license) return { license: null, users, access: accessFromScan, branches: [], employees: [] };
    const tenantId = String(boundTenant || license.tenantId || license.companyId || license.id);
    const access = decodeJsonValue(rawGet(namespaceKey(tenantId, 'cashtop_company_access')), accessFromScan || {});
    if (access && Object.keys(access).length) {
      const accessTenant = String(access.tenantId || access.companyId || tenantId);
      if (accessTenant !== tenantId || (access.companyKey && normalizeKey(access.companyKey) !== companyKey)) {
        return { license: null, users: [], access: null, branches: [], employees: [], tenantMismatch: true };
      }
    }
    const branches = normalizeArray(rawGet(namespaceKey(tenantId, 'cashtop_branches')));
    const employees = normalizeArray(rawGet(namespaceKey(tenantId, 'cashtop_employees')));
    return { license, users, access, branches, employees, companyId: tenantId, tenantId };
  }

  function authenticateContext(context, companyKey, username, password) {
    context = {
      ...(context || {}),
      users: normalizeArray(context?.users),
      branches: normalizeArray(context?.branches),
      employees: normalizeArray(context?.employees)
    };
    const checked = validateLicense(context.license || context.access);
    if (!checked.ok) throw new Error(checked.message);
    const uname = normalizeUsername(username);
    let account = null;

    const contextTenant = String(context.tenantId || context.companyId || context.license?.tenantId || context.license?.companyId || '');
    const legacy = context.users.find(item =>
      normalizeKey(item.companyKey) === companyKey &&
      normalizeUsername(item.username) === uname &&
      (!contextTenant || String(item.tenantId || item.companyId || '') === contextTenant)
    );
    if (legacy) account = { ...legacy, role: legacy.role || 'admin' };

    const manager = context.access?.manager;
    if (!account && manager && normalizeUsername(manager.username) === uname) {
      account = {
        id: manager.id || `ADMIN_${uname}`,
        username: manager.username,
        password: manager.password,
        displayName: manager.displayName || manager.name || manager.username,
        role: 'admin', active: manager.active !== false,
        permissions: manager.permissions || {}
      };
    }

    if (!account) {
      const branch = context.branches.find(item => normalizeUsername(item.managerUsername) === uname);
      if (branch) {
        account = {
          id: branch.managerUserId || `BRM_${branch.id}`,
          username: branch.managerUsername,
          password: branch.managerPassword,
          displayName: branch.manager || branch.managerUsername,
          role: 'branch-admin', active: branch.managerActive !== false && branch.status !== 'مجمد',
          permissions: branch.managerPermissions || {}, branchRecordId: branch.id, branchId: branch.isMain === true ? 'MAIN' : branch.id, dataBranchId: branch.isMain === true ? 'MAIN' : branch.id, branchName: branch.name
        };
      }
    }

    if (!account) {
      const employee = context.employees.find(item => normalizeUsername(item.username) === uname);
      if (employee) {
        account = {
          id: employee.id, username: employee.username, password: employee.password,
          displayName: employee.name || employee.username, role: 'employee',
          active: employee.status === 'active', permissions: employee.permissions || {}, branchRecordId: employee.branchId || null, branchId: (context.branches.find(branch => String(branch.id) === String(employee.branchId))?.isMain === true ? 'MAIN' : employee.branchId) || 'MAIN', dataBranchId: (context.branches.find(branch => String(branch.id) === String(employee.branchId))?.isMain === true ? 'MAIN' : employee.branchId) || 'MAIN',
          branchName: employee.branchName || context.branches.find(branch => String(branch.id) === String(employee.branchId))?.name || ''
        };
      }
    }

    if (!account || String(account.password ?? '') !== String(password)) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
    if (account.active === false) throw new Error('تم تعطيل حساب المستخدم أو الفرع.');
    return account;
  }

  function saveSession(context, account, companyKey, remember) {
    const license = context.license || context.access;
    const tenantId = String(context.tenantId || context.companyId || license.tenantId || license.companyId || license.id || sanitizeSegment(companyKey));
    const session = {
      mode: 'local', uid: account.id, username: account.username, displayName: account.displayName || account.username,
      role: account.role || 'user', permissions: account.permissions || {}, branchRecordId: account.branchRecordId || null, branchId: account.branchId || (['admin','owner','company-admin'].includes(String(account.role||'').toLowerCase()) ? 'MAIN' : null), dataBranchId: account.dataBranchId || account.branchId || (['admin','owner','company-admin'].includes(String(account.role||'').toLowerCase()) ? 'MAIN' : null),
      branchName: account.branchName || '', companyKey, tenantId, companyId: tenantId,
      companyName: license.companyName || context.access?.companyName || 'الشركة',
      licenseId: license.id || license.licenseId || tenantId, licenseStart: license.startAt || '', licenseEnd: license.endAt || '',
      plan: license.plan || context.access?.plan || 'pro', status: license.status || 'active', loginAt: new Date().toISOString(), lastLicenseCheck: Date.now(),
      databaseId: window.CashtopMultiDatabase?.getCachedActiveDatabase?.()?.databaseId || '',
      databaseName: window.CashtopMultiDatabase?.getCachedActiveDatabase?.()?.databaseName || '',
      databaseProjectId: window.CashtopMultiDatabase?.getCachedActiveDatabase?.()?.projectId || ''
    };
    writeSession(session);
    setTenantBinding(companyKey, tenantId);
    saveRemembered(companyKey, account.username, remember);
    return session;
  }

  async function localLogin(key, username, password, remember) {
    const context = resolveLocalContext(key);
    if (context.tenantMismatch) throw new Error('تم منع فتح بيانات شركة أخرى لهذا المفتاح. أعد المزامنة من لوحة الإدارة.');
    if (!context.license && !context.access) throw new Error('مفتاح الشركة غير موجود محلياً.');
    const account = authenticateContext(context, key, username, password);
    return saveSession(context, account, key, remember);
  }

  let loginDatabaseToken = '';
  async function getLoginDatabaseToken() {
    if (isFirestoreBridge) return '';
    if (loginDatabaseToken) return loginDatabaseToken;
    const apiKey = window.CASHTOP_FIREBASE?.config?.apiKey;
    if (!apiKey) return '';
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ returnSecureToken: true }), cache: 'no-store'
    });
    if (!response.ok) return '';
    const data = await response.json().catch(() => ({}));
    loginDatabaseToken = data.idToken || '';
    return loginDatabaseToken;
  }
  function withAuth(url, token) {
    if (!token) return url;
    return `${url}${url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(token)}`;
  }
  function loginTransportCandidates(url) {
    // لا يوجد API محلي داخل الاستضافة في النسخة المحمولة.
    return [transportUrl(url)];
  }

  async function fetchJson(url, timeout = 18000) {
    let lastError = null;
    for (const targetUrl of loginTransportCandidates(url)) {
      for (let attempt = 0; attempt < (navigator.onLine === false ? 1 : 2); attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          let response = await fetch(targetUrl, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
          if (!response.ok && (response.status === 401 || response.status === 403)) {
            const token = await getLoginDatabaseToken().catch(() => '');
            if (token) response = await fetch(withAuth(targetUrl, token), { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
          }
          if ([408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, 220));
            continue;
          }
          if (!response.ok) throw new Error(`تعذر قراءة بيانات الدخول من قاعدة البيانات (${response.status}).`);
          const type = String(response.headers.get('content-type') || '').toLowerCase();
          return await response.json();
        } catch (error) {
          lastError = error;
          if (attempt === 0 && navigator.onLine !== false) {
            await new Promise(resolve => setTimeout(resolve, 220));
            continue;
          }
        } finally { clearTimeout(timer); }
      }
    }
    throw lastError || new Error('تعذر قراءة بيانات الدخول من قاعدة البيانات.');
  }


  function adminKeySegment(companyKey) { return sanitizeSegment(normalizeKey(companyKey)); }

  function normalizeAdminIndexEntry(entry) {
    const value = decodeJsonValue(entry, entry);
    if (typeof value === 'string') return { tenantId: value, companyId: value, key: '' };
    if (!value || typeof value !== 'object') return null;
    const tenantId = value.tenantId || value.companyId || value.id || value.company;
    return tenantId ? { ...value, tenantId, companyId: tenantId } : null;
  }

  async function findTenantViaAdminCompanies(companyKey, base, adminRoot) {
    /*
     * بعض الإصدارات القديمة كانت تحفظ الشركة داخل companies لكن keyIndex لا يتم
     * تحديثه دائماً. نجرب استعلاماً مفهرساً أولاً، ثم نقرأ companies فقط كخطة
     * احتياطية نادرة. هذا يمنع ظهور "المفتاح غير موجود" وهو مسجل فعلياً.
     */
    const queryUrl = `${base}/${adminRoot}/companies.json?orderBy=${encodeURIComponent('"key"')}&equalTo=${encodeURIComponent(JSON.stringify(companyKey))}`;
    let companies = null;
    try { companies = await fetchJson(queryUrl, 10000); }
    catch (error) { console.warn('[CASH TOP LOGIN] indexed companies fallback:', error); }
    if (!companies || typeof companies !== 'object' || !Object.keys(companies).length) {
      try { companies = await fetchJson(`${base}/${adminRoot}/companies.json`, 12000); }
      catch (error) { console.warn('[CASH TOP LOGIN] companies fallback:', error); return null; }
    }
    const match = Object.entries(companies || {}).find(([id, company]) => {
      if (!company || typeof company !== 'object') return false;
      return normalizeKey(company.key || company.companyKey) === companyKey && company.deleted !== true && company.status !== 'deleted';
    });
    if (!match) return null;
    const [id, company] = match;
    const tenantId = String(company.tenantId || company.companyId || id || '').trim();
    return tenantId ? { tenantId, companyId: tenantId, key: company.key || companyKey, source: 'companies-fallback' } : null;
  }

  async function fetchLoginBootstrap(companyKey, tenantId) {
    const settings = window.CASHTOP_FIREBASE || {};
    const base = String(settings.config?.databaseURL || '').replace(/\/+$/, '');
    const root = String(settings.rootPath || 'cashTopExchange/cashTopPOS').replace(/^\/+|\/+$/g, '');
    const canonicalTenant = sanitizeSegment(tenantId);
    if (!base || !canonicalTenant) return null;
    const datasetUrl = key => `${base}/${root}/${canonicalTenant}/datasets/${sanitizeSegment(key)}.json`;
    const [meta, accessPayload, branchesPayload, employeesPayload] = await Promise.all([
      fetchJson(`${base}/${root}/${canonicalTenant}/meta.json`, 10000).catch(() => ({})),
      fetchJson(datasetUrl('cashtop_company_access'), 12000),
      fetchJson(datasetUrl('cashtop_branches'), 10000).catch(() => null),
      fetchJson(datasetUrl('cashtop_employees'), 10000).catch(() => null)
    ]);
    const node = { meta: meta && typeof meta === 'object' ? meta : {}, datasets: {} };
    if (accessPayload != null) node.datasets.cashtop_company_access = accessPayload;
    if (branchesPayload != null) node.datasets.cashtop_branches = branchesPayload;
    if (employeesPayload != null) node.datasets.cashtop_employees = employeesPayload;
    const access = datasetValue(node, 'cashtop_company_access', {}) || {};
    const remoteKey = normalizeKey(access.companyKey || node.meta.companyKey || companyKey);
    const remoteTenant = sanitizeSegment(access.tenantId || access.companyId || node.meta.tenantId || node.meta.companyId || canonicalTenant);
    if (remoteKey && remoteKey !== companyKey) {
      const mismatch = new Error('فهرس المفتاح يشير إلى شركة أخرى. تم إيقاف الدخول لحماية البيانات.');
      mismatch.code = 'CASHTOP_TENANT_INDEX_MISMATCH';
      throw mismatch;
    }
    if (remoteTenant && remoteTenant !== canonicalTenant) {
      const mismatch = new Error('معرّف الشركة في قاعدة البيانات لا يطابق المفتاح الحالي.');
      mismatch.code = 'CASHTOP_TENANT_INDEX_MISMATCH';
      throw mismatch;
    }
    return { root, companyId: canonicalTenant, tenantId: canonicalTenant, node, access };
  }

  async function findRemoteCompanyViaAdminIndex(companyKey) {
    const settings = window.CASHTOP_FIREBASE || {}; const base = String(settings.config?.databaseURL || '').replace(/\/+$/,'');
    const adminRoot = String(settings.adminRootPath || 'cashTopExchange/cashTopAdmin').replace(/^\/+|\/+$/g,'');
    if (!base) return null;

    // لا نجعل فشل keyIndex (مفقود/قديم/طلب شبكي عابر) يعني أن المفتاح غير موجود.
    // نجرب الفهرس أولاً للسرعة، ثم سجل companies الموثوق كمصدر احتياطي مستقل.
    let indexedEntry = null;
    try {
      indexedEntry = normalizeAdminIndexEntry(await fetchJson(`${base}/${adminRoot}/keyIndex/${adminKeySegment(companyKey)}.json`, 9000));
    } catch (error) {
      console.warn('[CASH TOP LOGIN] keyIndex unavailable, trying companies:', error);
    }

    if (indexedEntry?.tenantId) {
      try {
        return await fetchLoginBootstrap(companyKey, indexedEntry.tenantId);
      } catch (error) {
        // قد يشير keyIndex قديم إلى tenant سابق. لا ندخل للمسار الخاطئ، بل نبحث
        // عن المفتاح نفسه داخل companies ثم نعيد التحقق من هوية tenant.
        console.warn('[CASH TOP LOGIN] stale keyIndex entry, trying companies:', error);
      }
    }

    try {
      const companyEntry = await findTenantViaAdminCompanies(companyKey, base, adminRoot);
      if (!companyEntry?.tenantId) return null;
      return await fetchLoginBootstrap(companyKey, companyEntry.tenantId);
    } catch (error) {
      console.warn('[CASH TOP LOGIN] admin companies lookup:', error);
      return null;
    }
  }

  async function findRemoteCompany(companyKey) {
    const indexed = await findRemoteCompanyViaAdminIndex(companyKey);
    if (indexed) return indexed;

    // لا نفحص جذر قاعدة البيانات كاملاً ولا نختار شركة بالتخمين. عند غياب
    // فهرس الإدارة نسمح فقط بمسار محلي معروف مسبقاً لنفس المفتاح (ترحيل قديم).
    const settings = window.CASHTOP_FIREBASE || {};
    const cfg = settings.config || {};
    const base = String(cfg.databaseURL || '').replace(/\/+$/, '');
    const boundTenant = sanitizeSegment(getTenantBindings()[companyKey] || '');
    if (!base || !boundTenant) return null;
    const roots = [...new Set([settings.rootPath || 'cashTopExchange/cashTopPOS', ...(settings.legacyRootPaths || [])])]
      .map(root => String(root || '').replace(/^\/+|\/+$/g, '')).filter(Boolean);
    const matches = [];
    for (const root of roots) {
      let remote;
      try {
        /* الجذر الرسمي يستخدم تحميل الدخول الخفيف. الجذور التاريخية نقرأ منها
           بيانات الوصول فقط بدلاً من تنزيل كل المنتجات والفواتير. */
        if (root === String(settings.rootPath || 'cashTopExchange/cashTopPOS').replace(/^\/+|\/+$/g, '')) {
          remote = await fetchLoginBootstrap(companyKey, boundTenant);
        } else {
          const datasetBase = `${base}/${root}/${boundTenant}`;
          const [meta, accessPayload, branchesPayload, employeesPayload] = await Promise.all([
            fetchJson(`${datasetBase}/meta.json`, 9000).catch(() => ({})),
            fetchJson(`${datasetBase}/datasets/cashtop_company_access.json`, 10000),
            fetchJson(`${datasetBase}/datasets/cashtop_branches.json`, 9000).catch(() => null),
            fetchJson(`${datasetBase}/datasets/cashtop_employees.json`, 9000).catch(() => null)
          ]);
          const node = { meta: meta || {}, datasets: { cashtop_company_access: accessPayload } };
          if (branchesPayload != null) node.datasets.cashtop_branches = branchesPayload;
          if (employeesPayload != null) node.datasets.cashtop_employees = employeesPayload;
          remote = { root, companyId: boundTenant, tenantId: boundTenant, node, access: datasetValue(node, 'cashtop_company_access', {}) || {} };
        }
      } catch (error) { console.warn('[CASH TOP LOGIN] database tenant path:', root, error); continue; }
      if (!remote?.node || typeof remote.node !== 'object') continue;
      const access = remote.access || {};
      const remoteKey = normalizeKey(access.companyKey || remote.node.meta?.companyKey || '');
      const tenantId = sanitizeSegment(access.tenantId || access.companyId || remote.node.meta?.tenantId || remote.node.meta?.companyId || boundTenant);
      if (remoteKey !== companyKey || tenantId !== boundTenant) continue;
      matches.push({ ...remote, root, companyId: tenantId, tenantId, access });
    }
    if (matches.length > 1) {
      const mismatch = new Error('تم العثور على أكثر من مسار لنفس الشركة. تم إيقاف الدخول لمنع خلط البيانات.');
      mismatch.code = 'CASHTOP_TENANT_MISMATCH';
      throw mismatch;
    }
    return matches[0] || null;
  }

  function hydrateRemoteCompany(remote, companyKey) {
    const tenantId = String(remote.access?.tenantId || remote.access?.companyId || remote.node?.meta?.tenantId || remote.node?.meta?.companyId || remote.tenantId || remote.companyId || '');
    const canonicalTenant = sanitizeSegment(tenantId);
    const remoteKey = normalizeKey(remote.access?.companyKey || remote.node?.meta?.companyKey || '');
    if (!canonicalTenant || remoteKey !== companyKey || canonicalTenant !== sanitizeSegment(remote.companyId || canonicalTenant)) {
      const mismatch = new Error('بيانات قاعدة البيانات لا تطابق المفتاح الحالي. تم إيقاف الاستيراد لحماية بيانات الشركات.');
      mismatch.code = 'CASHTOP_TENANT_MISMATCH';
      throw mismatch;
    }
    const companyId = canonicalTenant;
    setTenantBinding(companyKey, companyId);
    const datasets = remote.node?.datasets || {};
    Object.entries(datasets).forEach(([key, payload]) => {
      const value = datasetValue(remote.node, key, null);
      if (value === null) return;
      // New sync builds store the complete localStorage JSON as a string. Write
      // that string directly; JSON.stringify would double-encode it and turn
      // arrays such as branches/employees into strings on the next device.
      const storageValue = payload?.valueEncoding === 'local-storage-json-v1' && typeof payload?.value === 'string'
        ? payload.value
        : JSON.stringify(value);
      rawSet(namespaceKey(companyId, key), storageValue);
      rawSet(metaKey(companyId, key), JSON.stringify({
        updatedAt: Number(payload?.updatedAt || remote.node?.meta?.updatedAt || Date.now()),
        revision: Number(payload?.revision || 1), source: 'firestore-multidb-login-bootstrap', seeded: false
      }));
    });

    const access = remote.access || {};
    let licenses = normalizeArray(rawGet('cashtop_admin_licenses')).filter(item => normalizeKey(item.key) !== companyKey || String(item.tenantId || item.companyId || item.id) === companyId);
    const license = {
      id: access.licenseId || companyId, key: companyKey, tenantId: companyId, companyId,
      companyName: access.companyName || remote.node?.meta?.companyName || 'الشركة',
      status: access.status || 'active', plan: access.plan || 'pro', backupImportEnabled: access.backupImportEnabled === true, startAt: access.startAt || '', endAt: access.endAt || '', authVersion: access.authVersion || access.updatedAt || 0
    };
    const idx = licenses.findIndex(item => normalizeKey(item.key) === companyKey);
    if (idx >= 0) licenses[idx] = { ...licenses[idx], ...license }; else licenses.push(license);
    rawSet('cashtop_admin_licenses', JSON.stringify(licenses));

    if (access.manager?.username) {
      const users = normalizeArray(rawGet('cashtop_admin_users')).filter(item => normalizeKey(item.companyKey) !== companyKey || String(item.tenantId || item.companyId || '') === companyId);
      const user = {
        id: access.manager.id || `ADMIN_${companyId}`, companyKey, tenantId: companyId, companyId,
        username: access.manager.username, password: access.manager.password,
        displayName: access.manager.displayName || access.manager.username,
        role: 'admin', active: access.manager.active !== false
      };
      const userIndex = users.findIndex(item => normalizeKey(item.companyKey) === companyKey && normalizeUsername(item.username) === normalizeUsername(user.username));
      if (userIndex >= 0) users[userIndex] = { ...users[userIndex], ...user }; else users.push(user);
      rawSet('cashtop_admin_users', JSON.stringify(users));
    }
    return companyId;
  }

  async function databaseLogin(key, username, password, remember) {
    const multi = window.CashtopMultiDatabase;
    if (!multi) throw new Error('طبقة قواعد البيانات المتعددة غير محملة.');
    const resolved = await multi.resolveKey(key);
    if (!resolved?.database || !resolved?.route?.tenantId) throw new Error('لم يتم العثور على المفتاح في قواعد البيانات المسجلة.');
    const remote = await multi.readLoginBootstrap(resolved.database.config, resolved.route.tenantId, key);
    if (!remote) throw new Error('بيانات دخول الشركة غير موجودة داخل القاعدة المحددة.');
    multi.cacheActiveDatabase(resolved.database, resolved.route);
    hydrateRemoteCompany(remote, key);
    return await localLogin(key, username, password, remember);
  }

  async function firebaseLogin(key, username, password, remember) {
    const settings = window.CASHTOP_FIREBASE;
    const version = settings.sdkVersion || '12.16.0';
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
    ]);
    const firebaseConfig = settings.adminConfig || settings.config;
    const app = appModule.getApps().find(item => item.options?.projectId === firebaseConfig.projectId) || appModule.initializeApp(firebaseConfig);
    const auth = authModule.getAuth(app);
    await authModule.setPersistence(auth, remember ? authModule.browserLocalPersistence : authModule.browserSessionPersistence);
    const credential = await authModule.signInWithEmailAndPassword(auth, usernameToEmail(key, username), password);
    const db = firestoreModule.getFirestore(app);
    const usersCollection = settings.collections?.users || 'users';
    const licensesCollection = settings.collections?.licenses || 'licenses';
    const profileSnap = await firestoreModule.getDoc(firestoreModule.doc(db, usersCollection, credential.user.uid));
    if (!profileSnap.exists()) throw new Error('لا يوجد ملف صلاحيات مرتبط بهذا المستخدم.');
    const profile = profileSnap.data();
    if (profile.active === false) throw new Error('تم تعطيل حساب المستخدم.');
    if (normalizeKey(profile.licenseKey) !== key) throw new Error('المستخدم غير مرتبط بمفتاح الشركة المدخل.');
    const licenseSnap = await firestoreModule.getDoc(firestoreModule.doc(db, licensesCollection, key));
    const license = licenseSnap.exists() ? licenseSnap.data() : null;
    if (license?.endAt?.toDate) license.endAt = license.endAt.toDate().toISOString();
    if (license?.startAt?.toDate) license.startAt = license.startAt.toDate().toISOString();
    const checked = validateLicense(license);
    if (!checked.ok) { await authModule.signOut(auth); throw new Error(checked.message); }
    const session = {
      mode: 'firebase', uid: credential.user.uid, username: profile.username || username,
      displayName: profile.displayName || profile.username || username, role: profile.role || 'user',
      permissions: profile.permissions || {}, branchId: profile.branchId || null,
      companyKey: key, tenantId: profile.tenantId || profile.companyId || license.tenantId || license.companyId,
      companyId: profile.tenantId || profile.companyId || license.tenantId || license.companyId,
      companyName: profile.companyName || license.companyName, licenseId: license.id || key,
      licenseEnd: license.endAt, plan: license.plan || 'pro', backupImportEnabled: license.backupImportEnabled === true,
      status: license.status, loginAt: new Date().toISOString(), lastLicenseCheck: Date.now()
    };
    writeSession(session); setTenantBinding(key, session.tenantId || session.companyId); saveRemembered(key, username, remember);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const key = normalizeKey(document.getElementById('companyKey').value);
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const remember = document.getElementById('rememberMe').checked;
    const button = document.querySelector('.btn-login');
    if (!key || !username || !password) return showStatus('أكمل جميع بيانات الدخول.', 'warning');
    button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحقق...';
    showStatus('جاري التحقق من الحساب والمفتاح...', 'info');
    try {
      let remoteError = null;
      let authenticated = false;
      // نجرب قاعدة البيانات مباشرة؛ navigator.onLine قد يعطي false رغم وجود اتصال فعلي.
      if (window.CASHTOP_FIREBASE?.enabled) {
        try { await databaseLogin(key, username, password, remember); authenticated = true; }
        catch (error) {
          remoteError = error;
          if (['CASHTOP_TENANT_INDEX_MISMATCH','CASHTOP_TENANT_MISMATCH'].includes(String(error?.code || ''))) throw error;
        }
      }
      if (!authenticated) {
        try { await localLogin(key, username, password, remember); authenticated = true; }
        catch (localError) {
          const firebaseReady = Boolean(window.CASHTOP_FIREBASE?.enabled && (window.CASHTOP_FIREBASE?.adminConfig || window.CASHTOP_FIREBASE?.config)?.databaseURL);
          if (firebaseReady && window.CASHTOP_FIREBASE?.authMode === 'firebase-only') {
            await firebaseLogin(key, username, password, remember); authenticated = true;
          } else {
            throw remoteError || localError;
          }
        }
      }
      showStatus('تم تسجيل الدخول بنجاح. جاري فتح لوحة التحكم...', 'success');
      setTimeout(() => location.replace('لوحة التحكم.html'), 80);
    } catch (error) {
      console.error(error);
      let message = String(error.message || 'تعذر تسجيل الدخول.');
      if (String(error.code || '').includes('invalid-credential')) message = 'اسم المستخدم أو كلمة المرور غير صحيحة.';
      showStatus(message, 'error');
      button.disabled = false; button.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> تسجيل الدخول للنظام';
    }
  }

  function displayReason() {
    const reason = new URLSearchParams(location.search).get('reason');
    const messages = {
      expired: 'انتهت مدة مفتاح الشركة، وتم تسجيل خروجك تلقائياً.', stopped: 'تم إيقاف مفتاح الشركة، وتم تسجيل خروجك تلقائياً.',
      deleted: 'تم حذف مفتاح الشركة أو لم يعد متاحاً.', 'user-disabled': 'تم تعطيل حساب المستخدم أو الفرع.',
      'auth-required': 'انتهت جلسة تسجيل الدخول. سجل الدخول مرة أخرى.', 'device-limit': 'تم الوصول إلى الحد الأقصى للأجهزة المسموح بها لهذا المفتاح.',
      'permission-denied': 'لا يملك هذا الحساب صلاحية لفتح أي قسم. راجع مدير النظام.',
      'tenant-mismatch': 'تم منع فتح مسار بيانات لا يخص هذا المفتاح لحماية بيانات الشركات.'
    };
    if (reason && messages[reason]) showStatus(messages[reason], 'warning');
  }

  cleanupLegacyDemo();
  window.handleLogin = handleLogin;
  window.addEventListener('DOMContentLoaded', () => {
    const existingSession = parse((()=>{try{return sessionStorage.getItem(TAB_SESSION_KEY)}catch(_){return null}})(), null) || parse(rawGet('cashtop_session'), null);
    const existingEnd = existingSession?.licenseEnd ? new Date(existingSession.licenseEnd).getTime() : 0;
    if (existingSession && existingSession.status !== 'stopped' && (!existingEnd || existingEnd > Date.now()) && !new URLSearchParams(location.search).get('reason')) {
      location.replace('لوحة التحكم.html'); return;
    }
    const rememberedKey = rawGet('cashtop_remembered_key');
    const rememberedUser = rawGet('cashtop_remembered_user');
    if (rememberedKey) {
      document.getElementById('companyKey').value = rememberedKey;
      document.getElementById('username').value = rememberedUser || '';
      document.getElementById('rememberMe').checked = true;
    }
    const header = document.querySelector('.login-header');
    if (header && !header.querySelector('img')) {
      const img = document.createElement('img'); img.src = 'cashtop-logo.png'; img.alt = 'CASH TOP';
      img.style.cssText = 'width:82px;height:82px;object-fit:cover;border-radius:16px;margin-bottom:10px;box-shadow:0 5px 18px rgba(96,92,168,.2);';
      header.prepend(img);
    }
    displayReason();
    const pushBtn=document.getElementById('enablePushBtn');
    if(pushBtn){pushBtn.addEventListener('click',async()=>{pushBtn.disabled=true;const old=pushBtn.innerHTML;pushBtn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> جاري التفعيل...';try{const result=await window.CashtopPush?.requestAndSubscribe?.();if(result?.ok){pushBtn.innerHTML='<i class="fa-solid fa-circle-check"></i> الإشعارات مفعلة';}else{pushBtn.innerHTML=old;alert(result?.message||'تعذر تفعيل الإشعارات.');}}finally{pushBtn.disabled=false;}});}
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    (async () => {
      try {
        const registration = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
        registration.update().catch(() => null);
        const worker = registration.active || registration.waiting || registration.installing;
        worker?.postMessage?.({ type: 'VERIFY_CACHE' });
        const ready = await navigator.serviceWorker.ready;
        ready.active?.postMessage?.({ type: 'WARM_CACHE' });
      } catch (error) {
        console.warn('[CASH TOP 2] SW:', error);
      }
    })();
  }
})();
