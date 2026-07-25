(function(){
'use strict';

const settings = window.CASHTOP_FIREBASE || {};
const config = settings.config || {};
const backendMode = String(settings.backendMode || settings.syncMode || '');
const bridgeBase = String(config.databaseURL || '').replace(/\/+$/, '');
const databaseId = String(config.databaseId || '(default)');
if (backendMode !== 'firestore-sdk' || !bridgeBase.startsWith('firestore://')) return;

const nativeFetch = window.fetch.bind(window);
const sdkVersion = String(settings.sdkVersion || '12.16.0');
const fsSettings = settings.firestore || {};
const ADMIN_COLLECTION = String(fsSettings.adminCollection || 'cashtopAdmin');
const ADMIN_DOCUMENT = String(fsSettings.adminDocument || 'main');
const COMPANIES_COLLECTION = String(fsSettings.companiesCollection || settings.collections?.companies || 'companies');
const LICENSES_COLLECTION = String(settings.collections?.licenses || 'licenses');
const KEY_INDEX_COLLECTION = String(fsSettings.keyIndexCollection || 'companyKeys');
const DATASET_COLLECTION = String(fsSettings.datasetCollection || 'datasets');
const META_COLLECTION = String(fsSettings.metaCollection || 'meta');
const META_DOCUMENT = String(fsSettings.metaDocument || 'state');
const GENERIC_NODES_COLLECTION = String(fsSettings.genericNodesCollection || 'nodes');
const ADMIN_STATE_FIELDS = new Set(['superAdmin','companies','keyIndex','retiredKeys','updatedAt']);
const CHUNK_CHARS = Math.max(40000, Math.min(180000, Number(fsSettings.chunkChars || 140000)));
const adminRoot = cleanPath(settings.adminRootPath || 'cashTopExchange/cashTopAdmin');
const companyRoots = [...new Set([
  cleanPath(settings.rootPath || 'cashTopExchange/cashTopPOS'),
  ...(Array.isArray(settings.legacyRootPaths) ? settings.legacyRootPaths.map(cleanPath) : [])
].filter(Boolean))].sort((a,b) => b.length - a.length);

let modulesPromise = null;
let authModulePromise = null;
let contextPromise = null;
let contextEpoch = 0;
let anonymousAuthPromise = null;
let anonymousAuthFailedAt = 0;
const retiredContexts = new Set();

function cleanPath(value){ return String(value || '').replace(/^\/+|\/+$/g, ''); }
function safeSegment(value){ return String(value || '').trim().replace(/[.#$\[\]\/]/g, '_') || '_'; }
function normalizeKey(value){ return String(value || '').trim().toUpperCase(); }
function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
function jsonParse(text, fallback=null){ try { return JSON.parse(text); } catch (_) { return fallback; } }
function delay(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
function isEmbeddedAndroidWebView(){
  const ua=String(globalThis.navigator?.userAgent||'');
  return /Android/i.test(ua)&&(/\bwv\b/i.test(ua)||/Version\/4\.0/i.test(ua)||/; wv\)/i.test(ua)||/Alif|com\.alif\.ide/i.test(ua));
}
function isInternalAssertion(error){
  const text=String(error?.message||error?.code||error||'').toLowerCase();
  return text.includes('internal assertion failed')||text.includes('unexpected state')||
    text.includes('pendingresponses less than 0')||
    text.includes("cannot read properties of null (reading 'database')")||
    text.includes('cannot read properties of null (reading "database")')||
    text.includes('client has already been terminated')||text.includes('the client has already been terminated');
}
function hash(value){
  let h=2166136261;
  for(const char of String(value||'')){h^=char.charCodeAt(0);h=Math.imul(h,16777619);}
  return (h>>>0).toString(36);
}
function isOfflineReadableError(error){
  const text=String(error?.code||error?.message||error||'').toLowerCase();
  return navigator.onLine===false || text.includes('unavailable') || text.includes('deadline-exceeded') ||
    text.includes('network') || text.includes('offline') || text.includes('failed to fetch') ||
    text.includes('client is offline') || text.includes('could not reach cloud firestore backend');
}
async function getDocFresh(ctx,ref){
  // Firestore Lite always reads directly from the server and has no IndexedDB,
  // listen stream, or WebChannel state that can become internally corrupted.
  return await ctx.firestore.getDoc(ref);
}
async function getDocsFresh(ctx,queryRef){
  return await ctx.firestore.getDocs(queryRef);
}
function splitText(text){
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    if (end < text.length) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xD800 && code <= 0xDBFF) end -= 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks.length ? chunks : [''];
}
function randomVersion(){
  const random = crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'').slice(0,14) : Math.random().toString(36).slice(2,16);
  return `${Date.now()}_${random}`;
}
function encodeDocId(value){ return safeSegment(value); }
function pathStarts(path, root){ return path === root || path.startsWith(`${root}/`); }
function getNested(root, segments){
  let current = root;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return null;
    current = current[segment];
  }
  return current == null ? null : current;
}
function setNested(root, segments, value, merge=false){
  if (!segments.length) {
    if (merge && root && typeof root === 'object' && value && typeof value === 'object' && !Array.isArray(root) && !Array.isArray(value)) return { ...root, ...value };
    return value;
  }
  const output = root && typeof root === 'object' && !Array.isArray(root) ? clone(root) : {};
  let current = output;
  for (let index=0; index<segments.length-1; index+=1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) current[segment] = {};
    current = current[segment];
  }
  const leaf = segments[segments.length-1];
  if (merge && current[leaf] && typeof current[leaf] === 'object' && value && typeof value === 'object' && !Array.isArray(current[leaf]) && !Array.isArray(value)) current[leaf] = { ...current[leaf], ...value };
  else current[leaf] = value;
  return output;
}
function deleteNested(root, segments){
  if (!segments.length) return null;
  const output = root && typeof root === 'object' && !Array.isArray(root) ? clone(root) : {};
  let current = output;
  for (let index=0; index<segments.length-1; index+=1) {
    current = current?.[segments[index]];
    if (!current || typeof current !== 'object') return output;
  }
  delete current[segments[segments.length-1]];
  return output;
}

async function loadModules(){
  if (!modulesPromise) {
    // Keep the mandatory path identical to the supplied working test: app + Firestore only.
    modulesPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-firestore-lite.js`)
    ]).then(([app, firestore]) => ({ app, firestore }));
  }
  return modulesPromise;
}

async function loadAuthModule(){
  if (!authModulePromise) {
    authModulePromise = import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-auth.js`).catch(error => {
      authModulePromise = null;
      throw error;
    });
  }
  return authModulePromise;
}

async function initializeContext(){
  if (!contextPromise) {
    contextPromise = (async () => {
      const modules = await loadModules();
      const appOptions = { apiKey:config.apiKey, authDomain:config.authDomain, projectId:config.projectId, storageBucket:config.storageBucket, messagingSenderId:config.messagingSenderId, appId:config.appId, measurementId:config.measurementId };
      const appName=`cashtop-main-${safeSegment(config.projectId)}-${hash(`${config.appId}|${databaseId}`)}-${contextEpoch}`;
      const app = modules.app.getApps().find(item => item.name === appName) || modules.app.initializeApp(appOptions,appName);

      // Firestore Lite is intentionally used here. CASH TOP already owns its local
      // cache/retry layer, so the full SDK's IndexedDB + WebChannel state is unnecessary
      // and was the source of the recurring null internal `database` context error.
      let db;
      const firestoreOptions={ignoreUndefinedProperties:true};
      try {
        db = databaseId && databaseId !== '(default)'
          ? modules.firestore.initializeFirestore(app, firestoreOptions, databaseId)
          : modules.firestore.initializeFirestore(app, firestoreOptions);
      } catch (error) {
        const text=String(error?.code||error?.message||'').toLowerCase();
        if(!text.includes('already-initialized')&&!text.includes('already been started'))throw error;
        db = databaseId && databaseId !== '(default)'
          ? modules.firestore.getFirestore(app, databaseId)
          : modules.firestore.getFirestore(app);
      }

      return { ...modules, appModule:modules.app, app, auth:null, authModule:null, db, authMode:'firestore-rules', authError:'', activeUsers:0, retired:false, cleanupPromise:null, epoch:contextEpoch, transport:'firestore-lite-rest' };
    })().catch(error => {
      contextPromise = null;
      throw error;
    });
  }
  return contextPromise;
}

function canTryAnonymousAuth(){
  const authPolicy = String(fsSettings.authPolicy || settings.authMode || 'auto').toLowerCase();
  return !['none','disabled','firestore-rules','database-rules'].includes(authPolicy);
}

function isFirestorePermissionError(error){
  const code = String(error?.code || error?.message || '').toLowerCase();
  return code.includes('permission-denied') || code.includes('unauthenticated');
}

async function ensureAnonymousAuth(ctx){
  if (!canTryAnonymousAuth() || !ctx) return false;
  if (!ctx.authModule || !ctx.auth) {
    try {
      ctx.authModule = await loadAuthModule();
      ctx.auth = ctx.authModule.getAuth(ctx.app);
    } catch (error) {
      anonymousAuthFailedAt = Date.now();
      ctx.authError = String(error?.code || error?.message || error || 'AUTH_MODULE_UNAVAILABLE');
      return false;
    }
  }
  if (ctx.auth.currentUser) {
    ctx.authMode = 'anonymous';
    ctx.authError = '';
    return true;
  }
  if (anonymousAuthPromise) return await anonymousAuthPromise;
  // Do not hammer Identity Toolkit when Anonymous Authentication is disabled.
  if (anonymousAuthFailedAt && Date.now() - anonymousAuthFailedAt < 60000) return false;
  anonymousAuthPromise = (async () => {
    try {
      try { await ctx.authModule.setPersistence(ctx.auth, ctx.authModule.browserLocalPersistence); } catch (_) {}
      try { if (typeof ctx.auth.authStateReady === 'function') await ctx.auth.authStateReady(); } catch (_) {}
      if (!ctx.auth.currentUser) await ctx.authModule.signInAnonymously(ctx.auth);
      ctx.authMode = ctx.auth.currentUser ? 'anonymous' : 'firestore-rules';
      ctx.authError = '';
      return Boolean(ctx.auth.currentUser);
    } catch (error) {
      anonymousAuthFailedAt = Date.now();
      ctx.authMode = 'firestore-rules';
      ctx.authError = String(error?.code || error?.message || error || 'AUTH_UNAVAILABLE');
      console.warn('[CASH TOP Firestore] Anonymous auth unavailable; using Firestore rules directly.', error);
      return false;
    } finally {
      anonymousAuthPromise = null;
    }
  })();
  return await anonymousAuthPromise;
}

async function cleanupRetiredContext(ctx){
  if(!ctx||!ctx.retired||Number(ctx.activeUsers||0)>0)return;
  if(ctx.cleanupPromise)return await ctx.cleanupPromise;
  // Never terminate/delete a Firebase app at runtime. A late Promise may still hold
  // a reference to it, and terminating it recreates the exact null-context failure.
  ctx.cleanupPromise=Promise.resolve().then(()=>{retiredContexts.delete(ctx);});
  return await ctx.cleanupPromise;
}

async function beginNetwork(){
  const ctx=await initializeContext();
  ctx.activeUsers=Number(ctx.activeUsers||0)+1;
  return ctx;
}

async function finishNetwork(ctx){
  if(!ctx)return;
  ctx.activeUsers=Math.max(0,Number(ctx.activeUsers||0)-1);
  if(ctx.retired&&ctx.activeUsers===0)await cleanupRetiredContext(ctx);
}

async function executeFirestoreWorker(ctx,worker){
  try{return await worker(ctx);}
  catch(error){
    // Open Firestore rules work immediately. Only when rules reject the request
    // do we try Anonymous Auth and retry once.
    if(isFirestorePermissionError(error)&&await ensureAnonymousAuth(ctx))return await worker(ctx);
    throw error;
  }
}
async function resetFirestoreContext(failedCtx){
  if(!failedCtx)return;
  const current=await Promise.resolve(contextPromise).catch(()=>null);
  failedCtx.retired=true;
  retiredContexts.add(failedCtx);
  if(current===failedCtx){
    contextPromise=null;
    contextEpoch+=1;
  }
  if(Number(failedCtx.activeUsers||0)===0)await cleanupRetiredContext(failedCtx);
}
async function withFirestoreTask(worker, options={}){
  let ctx=await beginNetwork();
  let released=false;
  try{
    try{return await executeFirestoreWorker(ctx,worker);}
    catch(error){
      if(!isInternalAssertion(error))throw error;
      console.warn('[CASH TOP Firestore] Invalid SDK context detected; rotating Firestore safely once.',error);
      await resetFirestoreContext(ctx);
      await finishNetwork(ctx);
      released=true;
      ctx=await beginNetwork();
      released=false;
          return await executeFirestoreWorker(ctx,worker);
    }
  }finally{
    if(!released)await finishNetwork(ctx);
  }
}

function adminRef(ctx){ return ctx.firestore.doc(ctx.db, ADMIN_COLLECTION, ADMIN_DOCUMENT); }
function companyRef(ctx, companyId){ return ctx.firestore.doc(ctx.db, COMPANIES_COLLECTION, encodeDocId(companyId)); }
function datasetRef(ctx, companyId, datasetKey){ return ctx.firestore.doc(companyRef(ctx, companyId), DATASET_COLLECTION, encodeDocId(datasetKey)); }
function metaRef(ctx, companyId){ return ctx.firestore.doc(companyRef(ctx, companyId), META_COLLECTION, META_DOCUMENT); }
function genericNodeRef(ctx, companyId, nodeKey){ return ctx.firestore.doc(companyRef(ctx, companyId), GENERIC_NODES_COLLECTION, encodeDocId(nodeKey)); }
function adminNodeRef(ctx, nodeKey){ return ctx.firestore.doc(adminRef(ctx), GENERIC_NODES_COLLECTION, encodeDocId(nodeKey)); }
function versionRef(ctx, ref, version){ return ctx.firestore.doc(ctx.firestore.collection(ref, 'versions'), version); }
function chunksCollection(ctx, ref, version){ return ctx.firestore.collection(versionRef(ctx, ref, version), 'chunks'); }

async function commitInBatches(ctx, operations){
  for (let offset=0; offset<operations.length; offset+=430) {
    const batch = ctx.firestore.writeBatch(ctx.db);
    operations.slice(offset, offset+430).forEach(op => {
      if (op.type === 'set') batch.set(op.ref, op.data, op.options || {});
      else if (op.type === 'delete') batch.delete(op.ref);
    });
    await batch.commit();
  }
}

async function deleteVersion(ctx, ref, version){
  if (!version) return;
  try {
    const vRef = versionRef(ctx, ref, version);
    const snaps = await getDocsFresh(ctx,ctx.firestore.collection(vRef, 'chunks'));
    const operations = snaps.docs.map(snap => ({ type:'delete', ref:snap.ref }));
    operations.push({ type:'delete', ref:vRef });
    await commitInBatches(ctx, operations);
  } catch (_) {}
}

async function writeJsonRef(ctx, ref, value){
  const previous = await getDocFresh(ctx,ref).catch(() => null);
  const previousVersion = previous?.exists?.() ? String(previous.data()?.version || '') : '';
  const text = JSON.stringify(value == null ? null : value);
  const chunks = splitText(text);
  const version = randomVersion();
  const vRef = versionRef(ctx, ref, version);
  const operations = [{ type:'set', ref:vRef, data:{ chunkCount:chunks.length, createdAt:Date.now() } }];
  chunks.forEach((data,index) => operations.push({
    type:'set',
    ref:ctx.firestore.doc(ctx.firestore.collection(vRef, 'chunks'), String(index).padStart(6,'0')),
    data:{ index, data }
  }));
  await commitInBatches(ctx, operations);
  await ctx.firestore.setDoc(ref, {
    storage:'cashtop-chunked-json-v1',
    version,
    chunkCount:chunks.length,
    jsonLength:text.length,
    updatedAt:Date.now()
  });
  if (previousVersion && previousVersion !== version) deleteVersion(ctx, ref, previousVersion).catch(() => null);
  return value;
}

async function readJsonRef(ctx, ref, fallback=null){
  const snap = await getDocFresh(ctx,ref);
  if (!snap.exists()) return fallback;
  const data = snap.data() || {};
  if (data.storage === 'cashtop-chunked-json-v1' && data.version) {
    const chunks = await getDocsFresh(ctx,chunksCollection(ctx, ref, data.version));
    const text = chunks.docs.sort((a,b) => a.id.localeCompare(b.id)).map(item => String(item.data()?.data || '')).join('');
    return jsonParse(text, fallback);
  }
  if (typeof data.payload === 'string') return jsonParse(data.payload, fallback);
  if (Object.prototype.hasOwnProperty.call(data, 'value') && Object.keys(data).length <= 4) return clone(data.value);
  return clone(data);
}

async function deleteJsonRef(ctx, ref){
  const snap = await getDocFresh(ctx,ref).catch(() => null);
  const version = snap?.exists?.() ? String(snap.data()?.version || '') : '';
  if (version) await deleteVersion(ctx, ref, version);
  await ctx.firestore.deleteDoc(ref).catch(() => null);
}

async function writeCompanySummary(ctx, company){
  if (!company || typeof company !== 'object') return;
  const tenantId = String(company.tenantId || company.companyId || company.id || '').trim();
  if (!tenantId) return;
  const key = normalizeKey(company.key || company.companyKey || '');
  const summary = { ...clone(company), tenantId, companyId:tenantId, key, updatedAtMs:Date.now() };
  await ctx.firestore.setDoc(companyRef(ctx, tenantId), summary, { merge:true });
  if (key) {
    await Promise.all([
      ctx.firestore.setDoc(ctx.firestore.doc(ctx.db, LICENSES_COLLECTION, key), {
        id:tenantId, licenseId:tenantId, tenantId, companyId:tenantId, licenseKey:key, key,
        companyName:company.companyName || '', status:company.status || 'active', plan:company.plan || 'pro',
        startAt:company.startAt || '', endAt:company.endAt || '', backupImportEnabled:company.backupImportEnabled === true,
        updatedAtMs:Date.now()
      }, { merge:true }),
      ctx.firestore.setDoc(ctx.firestore.doc(ctx.db, KEY_INDEX_COLLECTION, encodeDocId(key)), {
        tenantId, companyId:tenantId, key, companyName:company.companyName || '', status:company.status || 'active', updatedAtMs:Date.now()
      }, { merge:true })
    ]);
  }
}

async function readAdminState(ctx){ return await readJsonRef(ctx, adminRef(ctx), null); }
async function writeAdminState(ctx, value){
  const state = value && typeof value === 'object' ? value : {};
  await writeJsonRef(ctx, adminRef(ctx), state);
  const companies = Object.values(state.companies || {}).filter(item => item && typeof item === 'object');
  for (let offset=0; offset<companies.length; offset+=8) {
    await Promise.all(companies.slice(offset, offset+8).map(company => writeCompanySummary(ctx, company)));
  }
  return state;
}

async function readAllDatasets(ctx, companyId){
  const snaps = await getDocsFresh(ctx,ctx.firestore.collection(companyRef(ctx, companyId), DATASET_COLLECTION));
  const result = {};
  for (let offset=0; offset<snaps.docs.length; offset+=8) {
    const slice = snaps.docs.slice(offset, offset+8);
    const values = await Promise.all(slice.map(snap => readJsonRef(ctx, snap.ref, null)));
    slice.forEach((snap,index) => { if (values[index] !== null) result[snap.id] = values[index]; });
  }
  return result;
}

async function writeAllDatasets(ctx, companyId, datasets){
  const entries = Object.entries(datasets && typeof datasets === 'object' ? datasets : {});
  for (const [key,value] of entries) await writeJsonRef(ctx, datasetRef(ctx, companyId, key), value);
}

async function readAllGenericNodes(ctx, companyId){
  const snaps = await getDocsFresh(ctx,ctx.firestore.collection(companyRef(ctx, companyId), GENERIC_NODES_COLLECTION));
  const result = {};
  for (let offset=0; offset<snaps.docs.length; offset+=8) {
    const slice = snaps.docs.slice(offset, offset+8);
    const values = await Promise.all(slice.map(snap => readJsonRef(ctx, snap.ref, null)));
    slice.forEach((snap,index) => { if (values[index] !== null) result[snap.id] = values[index]; });
  }
  return result;
}
async function writeAllGenericNodes(ctx, companyId, node){
  const reserved = new Set(['meta','datasets','auditTrail','auditTrailRecent']);
  for (const [key,value] of Object.entries(node && typeof node === 'object' ? node : {})) {
    if (reserved.has(key)) continue;
    await writeJsonRef(ctx, genericNodeRef(ctx, companyId, key), value);
  }
}

function auditDocId(day, hour, recordId){ return `${safeSegment(day)}__${safeSegment(hour)}__${safeSegment(recordId)}`; }
async function readAuditCollection(ctx, companyId, recent=false){
  const col = ctx.firestore.collection(companyRef(ctx, companyId), recent ? 'auditTrailRecent' : 'auditTrail');
  const snaps = await getDocsFresh(ctx,col);
  return snaps.docs.map(snap => ({ id:snap.id, ...(snap.data() || {}) }));
}
async function readAuditPath(ctx, companyId, segments, recent=false){
  const rows = await readAuditCollection(ctx, companyId, recent);
  if (recent) {
    if (segments[0]) return clone(rows.find(row => row.recordId === segments[0] || row.id === safeSegment(segments[0]))?.value ?? null);
    return Object.fromEntries(rows.map(row => [row.recordId || row.id, clone(row.value)]));
  }
  const [day,hour,recordId] = segments;
  if (recordId) return clone(rows.find(row => row.day === day && row.hour === hour && row.recordId === recordId)?.value ?? null);
  const filtered = rows.filter(row => (!day || row.day === day) && (!hour || row.hour === hour));
  if (hour) return Object.fromEntries(filtered.map(row => [row.recordId, clone(row.value)]));
  if (day) {
    const result = {};
    filtered.forEach(row => { result[row.hour] = result[row.hour] || {}; result[row.hour][row.recordId] = clone(row.value); });
    return result;
  }
  const result = {};
  filtered.forEach(row => {
    result[row.day] = result[row.day] || {};
    result[row.day][row.hour] = result[row.day][row.hour] || {};
    result[row.day][row.hour][row.recordId] = clone(row.value);
  });
  return result;
}
async function writeAuditPath(ctx, companyId, segments, value, recent=false, merge=false){
  const col = ctx.firestore.collection(companyRef(ctx, companyId), recent ? 'auditTrailRecent' : 'auditTrail');
  if (recent) {
    const recordId = segments[0];
    if (recordId) {
      const ref = ctx.firestore.doc(col, safeSegment(recordId));
      const current = merge ? await readAuditPath(ctx, companyId, [recordId], true) : null;
      const next = merge && current && typeof current === 'object' && value && typeof value === 'object' ? { ...current, ...value } : value;
      await ctx.firestore.setDoc(ref, { recordId, value:clone(next), updatedAt:Date.now() });
      return next;
    }
    for (const [id,item] of Object.entries(value || {})) await writeAuditPath(ctx, companyId, [id], item, true, merge);
    return value;
  }
  const [day,hour,recordId] = segments;
  if (day && hour && recordId) {
    const ref = ctx.firestore.doc(col, auditDocId(day,hour,recordId));
    const current = merge ? await readAuditPath(ctx, companyId, [day,hour,recordId], false) : null;
    const next = merge && current && typeof current === 'object' && value && typeof value === 'object' ? { ...current, ...value } : value;
    await ctx.firestore.setDoc(ref, { day, hour, recordId, value:clone(next), updatedAt:Date.now() });
    return next;
  }
  if (day && hour) {
    for (const [id,item] of Object.entries(value || {})) await writeAuditPath(ctx, companyId, [day,hour,id], item, false, merge);
    return value;
  }
  if (day) {
    for (const [h,records] of Object.entries(value || {})) await writeAuditPath(ctx, companyId, [day,h], records, false, merge);
    return value;
  }
  for (const [d,hours] of Object.entries(value || {})) await writeAuditPath(ctx, companyId, [d], hours, false, merge);
  return value;
}
async function deleteAuditPath(ctx, companyId, segments, recent=false){
  const col = ctx.firestore.collection(companyRef(ctx, companyId), recent ? 'auditTrailRecent' : 'auditTrail');
  const snaps = await getDocsFresh(ctx,col);
  const [day,hour,recordId] = segments;
  const targets = snaps.docs.filter(snap => {
    const data = snap.data() || {};
    if (recent) return !segments[0] || data.recordId === segments[0] || snap.id === safeSegment(segments[0]);
    return (!day || data.day === day) && (!hour || data.hour === hour) && (!recordId || data.recordId === recordId);
  });
  await commitInBatches(ctx, targets.map(ref => ({ type:'delete', ref:ref.ref })));
  return null;
}

async function readCompanyAggregate(ctx, companyId){
  const [meta, datasets, genericNodes, auditTrail, auditTrailRecent] = await Promise.all([
    readJsonRef(ctx, metaRef(ctx, companyId), {}),
    readAllDatasets(ctx, companyId),
    readAllGenericNodes(ctx, companyId),
    readAuditPath(ctx, companyId, [], false).catch(() => ({})),
    readAuditPath(ctx, companyId, [], true).catch(() => ({}))
  ]);
  const result = { meta: meta || {}, datasets: datasets || {}, ...(genericNodes || {}) };
  if (Object.keys(auditTrail || {}).length) result.auditTrail = auditTrail;
  if (Object.keys(auditTrailRecent || {}).length) result.auditTrailRecent = auditTrailRecent;
  return result;
}

async function writeCompanyAggregate(ctx, companyId, value){
  const node = value && typeof value === 'object' ? value : {};
  if (Object.prototype.hasOwnProperty.call(node, 'meta')) await writeJsonRef(ctx, metaRef(ctx, companyId), node.meta || {});
  if (node.datasets && typeof node.datasets === 'object') await writeAllDatasets(ctx, companyId, node.datasets);
  if (node.auditTrail && typeof node.auditTrail === 'object') await writeAuditPath(ctx, companyId, [], node.auditTrail, false, false);
  if (node.auditTrailRecent && typeof node.auditTrailRecent === 'object') await writeAuditPath(ctx, companyId, [], node.auditTrailRecent, true, false);
  await writeAllGenericNodes(ctx, companyId, node);
  const meta = node.meta || {};
  await ctx.firestore.setDoc(companyRef(ctx, companyId), {
    tenantId:String(meta.tenantId || meta.companyId || companyId),
    companyId:String(meta.tenantId || meta.companyId || companyId),
    companyKey:normalizeKey(meta.companyKey || ''),
    companyName:String(meta.companyName || ''),
    updatedAtMs:Date.now()
  }, { merge:true });
  return node;
}

async function deleteCompanyAggregate(ctx, companyId){
  const datasetSnaps = await getDocsFresh(ctx,ctx.firestore.collection(companyRef(ctx, companyId), DATASET_COLLECTION));
  for (const snap of datasetSnaps.docs) await deleteJsonRef(ctx, snap.ref);
  await deleteJsonRef(ctx, metaRef(ctx, companyId));
  const genericSnaps = await getDocsFresh(ctx,ctx.firestore.collection(companyRef(ctx, companyId), GENERIC_NODES_COLLECTION));
  for (const snap of genericSnaps.docs) await deleteJsonRef(ctx, snap.ref);
  await deleteAuditPath(ctx, companyId, [], false);
  await deleteAuditPath(ctx, companyId, [], true);
  await ctx.firestore.deleteDoc(companyRef(ctx, companyId)).catch(() => null);
  return null;
}

function parseBridgeUrl(rawUrl){
  const raw = String(rawUrl || '');
  if (!(raw === bridgeBase || raw.startsWith(`${bridgeBase}/`) || raw.startsWith(`${bridgeBase}?`))) return null;
  const remainder = raw.slice(bridgeBase.length).replace(/^\//, '');
  const [pathPart, queryPart=''] = remainder.split('?');
  const path = cleanPath(decodeURIComponent(pathPart || '').replace(/\.json$/i, ''));
  return { path, query:new URLSearchParams(queryPart) };
}

async function readPath(ctx, path, query){
  if (pathStarts(path, adminRoot)) {
    const rest = cleanPath(path.slice(adminRoot.length)).split('/').filter(Boolean);
    if (rest[0] && !ADMIN_STATE_FIELDS.has(rest[0])) {
      const value = await readJsonRef(ctx, adminNodeRef(ctx, rest[0]), null);
      return getNested(value, rest.slice(1));
    }
    const state = await readAdminState(ctx);
    let value = getNested(state, rest);
    if (rest[0] === 'companies' && rest.length === 1 && query?.has('equalTo')) {
      const expected = jsonParse(query.get('equalTo'), query.get('equalTo'));
      const orderBy = jsonParse(query.get('orderBy'), query.get('orderBy'));
      value = Object.fromEntries(Object.entries(value || {}).filter(([,item]) => normalizeKey(item?.[orderBy]) === normalizeKey(expected)));
    }
    return value;
  }
  const root = companyRoots.find(item => pathStarts(path, item));
  if (!root) return null;
  const rest = cleanPath(path.slice(root.length)).split('/').filter(Boolean);
  const companyId = rest.shift();
  if (!companyId) return null;
  if (!rest.length) return await readCompanyAggregate(ctx, companyId);
  const section = rest.shift();
  if (section === 'datasets') {
    if (!rest.length) return await readAllDatasets(ctx, companyId);
    const ref = datasetRef(ctx, companyId, rest.shift());
    const value = await readJsonRef(ctx, ref, null);
    return getNested(value, rest);
  }
  if (section === 'meta') {
    const value = await readJsonRef(ctx, metaRef(ctx, companyId), {});
    return getNested(value, rest);
  }
  if (section === 'auditTrail') return await readAuditPath(ctx, companyId, rest, false);
  if (section === 'auditTrailRecent') return await readAuditPath(ctx, companyId, rest, true);
  const generic = await readJsonRef(ctx, genericNodeRef(ctx, companyId, section), null);
  return getNested(generic, rest);
}

async function writePath(ctx, path, value, method){
  const merge = method === 'PATCH';
  if (pathStarts(path, adminRoot)) {
    const rest = cleanPath(path.slice(adminRoot.length)).split('/').filter(Boolean);
    if (rest[0] && !ADMIN_STATE_FIELDS.has(rest[0])) {
      const ref = adminNodeRef(ctx, rest[0]);
      if (method === 'DELETE' && rest.length === 1) return await deleteJsonRef(ctx, ref);
      const currentNode = await readJsonRef(ctx, ref, null);
      const nextNode = method === 'DELETE' ? deleteNested(currentNode, rest.slice(1)) : setNested(currentNode, rest.slice(1), value, merge);
      await writeJsonRef(ctx, ref, nextNode);
      return nextNode;
    }
    const current = await readAdminState(ctx) || {};
    const next = method === 'DELETE' ? deleteNested(current, rest) : setNested(current, rest, value, merge);
    return await writeAdminState(ctx, next || {});
  }
  const root = companyRoots.find(item => pathStarts(path, item));
  if (!root) return null;
  const rest = cleanPath(path.slice(root.length)).split('/').filter(Boolean);
  const companyId = rest.shift();
  if (!companyId) return null;
  if (!rest.length) {
    if (method === 'DELETE') return await deleteCompanyAggregate(ctx, companyId);
    if (merge) {
      const current = await readCompanyAggregate(ctx, companyId);
      return await writeCompanyAggregate(ctx, companyId, { ...current, ...(value || {}) });
    }
    // RTDB-compatible PUT replaces the whole company node, so clear stale
    // datasets/notifications/audit records before restoring or migrating it.
    await deleteCompanyAggregate(ctx, companyId);
    return await writeCompanyAggregate(ctx, companyId, value);
  }
  const section = rest.shift();
  if (section === 'datasets') {
    if (!rest.length) {
      if (method === 'DELETE') {
        const snaps = await getDocsFresh(ctx,ctx.firestore.collection(companyRef(ctx, companyId), DATASET_COLLECTION));
        for (const snap of snaps.docs) await deleteJsonRef(ctx, snap.ref);
        return null;
      }
      await writeAllDatasets(ctx, companyId, value || {});
      return value;
    }
    const datasetKey = rest.shift();
    const ref = datasetRef(ctx, companyId, datasetKey);
    if (method === 'DELETE' && !rest.length) return await deleteJsonRef(ctx, ref);
    const current = await readJsonRef(ctx, ref, null);
    const next = method === 'DELETE' ? deleteNested(current, rest) : setNested(current, rest, value, merge);
    await writeJsonRef(ctx, ref, next);
    return next;
  }
  if (section === 'meta') {
    const ref = metaRef(ctx, companyId);
    if (method === 'DELETE' && !rest.length) return await deleteJsonRef(ctx, ref);
    const current = await readJsonRef(ctx, ref, {});
    const next = method === 'DELETE' ? deleteNested(current, rest) : setNested(current, rest, value, merge);
    await writeJsonRef(ctx, ref, next || {});
    return next;
  }
  if (section === 'auditTrail') {
    if (method === 'DELETE') return await deleteAuditPath(ctx, companyId, rest, false);
    return await writeAuditPath(ctx, companyId, rest, value, false, merge);
  }
  if (section === 'auditTrailRecent') {
    if (method === 'DELETE') return await deleteAuditPath(ctx, companyId, rest, true);
    return await writeAuditPath(ctx, companyId, rest, value, true, merge);
  }
  const ref = genericNodeRef(ctx, companyId, section);
  if (method === 'DELETE' && !rest.length) return await deleteJsonRef(ctx, ref);
  const current = await readJsonRef(ctx, ref, null);
  const next = method === 'DELETE' ? deleteNested(current, rest) : setNested(current, rest, value, merge);
  await writeJsonRef(ctx, ref, next);
  return next;
}

function jsonResponse(value, status=200, extraHeaders={}){
  return new Response(JSON.stringify(value == null ? null : value), {
    status,
    headers:{ 'Content-Type':'application/json;charset=UTF-8', 'Cache-Control':'no-store', 'X-Cashtop-Source':'firestore-server-first', 'ETag':`"ct-${Date.now()}"`, ...extraHeaders }
  });
}

async function raceWithAbort(promise, signal){
  if (!signal) return await promise;
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return await new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once:true });
    Promise.resolve(promise).then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); }
    );
  });
}

function errorStatus(error){
  const code = String(error?.code || '');
  if (code.includes('permission-denied') || code.includes('unauthenticated')) return 403;
  if (code.includes('not-found')) return 404;
  if (code.includes('resource-exhausted')) return 429;
  if (code.includes('unavailable') || code.includes('deadline-exceeded')) return 503;
  return 500;
}

async function handleBridgeFetch(rawUrl, options={}){
  const parsed = parseBridgeUrl(rawUrl);
  if (!parsed) return nativeFetch(rawUrl, options);
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const method = String(options.method || 'GET').toUpperCase();
  try {
    const task = withFirestoreTask(async ctx => {
      if (method === 'GET') return await readPath(ctx, parsed.path, parsed.query);
      const body = options.body == null || options.body === '' ? null : jsonParse(String(options.body), null);
      if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') return await writePath(ctx, parsed.path, body, method);
      throw Object.assign(new Error(`METHOD_NOT_ALLOWED: ${method}`), { code:'method-not-allowed' });
    }, { write:method !== 'GET' });
    const value = await raceWithAbort(task, options.signal);
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return jsonResponse(value);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    console.error('[CASH TOP Firestore Bridge]', method, parsed.path, error);
    return jsonResponse({ error:{ message:String(error?.message || error), code:String(error?.code || '') } }, errorStatus(error));
  }
}

window.fetch = function(input, init){
  const url = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
  if (parseBridgeUrl(url)) {
    const options = input && typeof input === 'object' && !(input instanceof URL) && !(typeof input === 'string')
      ? { method:input.method, headers:input.headers, body:init?.body, signal:init?.signal, ...init }
      : (init || {});
    return handleBridgeFetch(url, options);
  }
  return nativeFetch(input, init);
};

window.CashtopFirestore = Object.freeze({
  ready: initializeContext,
  runTask: withFirestoreTask,
  closeNetwork: async () => true,
  terminate: async () => {
    const ctx = await initializeContext();
    await resetFirestoreContext(ctx);
    if(Number(ctx.activeUsers||0)===0)await cleanupRetiredContext(ctx);
    return true;
  },
  getInfo: async () => {
    const ctx = await initializeContext();
    return { projectId:config.projectId, databaseId, backend:'Cloud Firestore', persistentCache:false, closesAfterTask:false, transport:'Firestore Lite REST', authMode:ctx.authMode, authError:ctx.authError };
  }
});

window.addEventListener('pagehide', () => {
  // Let the browser close the stable Firestore transport naturally. Explicitly
  // disabling it here can race with the last write while the page is unloading.
}, { once:true });
})();
