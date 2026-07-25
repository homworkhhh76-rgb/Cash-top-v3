(function(){
'use strict';

const settings = window.CASHTOP_FIREBASE || {};
const sdkVersion = String(settings.sdkVersion || '12.16.0');
const masterConfig = normalizeConfig(settings.masterConfig || settings.config || {});
const fsSettings = settings.firestore || {};
const multi = settings.multiDatabase || {};
const ACTIVE_STORAGE_KEY = String(settings.activeDatabaseStorageKey || 'cashtop_active_database_v1');
const ROUTE_CACHE_STORAGE_KEY = String(settings.routeCacheStorageKey || 'cashtop_database_route_cache_v2');
const ROUTE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DATABASES_COLLECTION = String(multi.databasesCollection || 'cashtopDatabases');
const ROUTES_COLLECTION = String(multi.routesCollection || 'cashtopDatabaseRoutes');
const ROOT_COLLECTION = String(multi.rootCollection || 'cashtopRoot');
const ROOT_DOCUMENT = String(multi.rootDocument || 'main');
const ADMIN_COLLECTION = String(fsSettings.adminCollection || 'cashtopAdmin');
const ADMIN_DOCUMENT = String(fsSettings.adminDocument || 'main');
const COMPANIES_COLLECTION = String(fsSettings.companiesCollection || 'companies');
const LICENSES_COLLECTION = String(settings.collections?.licenses || 'licenses');
const KEY_INDEX_COLLECTION = String(fsSettings.keyIndexCollection || 'companyKeys');
const DATASET_COLLECTION = String(fsSettings.datasetCollection || 'datasets');
const META_COLLECTION = String(fsSettings.metaCollection || 'meta');
const META_DOCUMENT = String(fsSettings.metaDocument || 'state');
const GENERIC_NODES_COLLECTION = String(fsSettings.genericNodesCollection || 'nodes');
const CHUNK_CHARS = Math.max(40000, Math.min(180000, Number(fsSettings.chunkChars || 140000)));

let modulesPromise = null;
let authPromise = null;
const contexts = new Map();
const contextEpochs = new Map();

function parse(value, fallback=null){ try { return JSON.parse(value) ?? fallback; } catch (_) { return fallback; } }
function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
function safeSegment(value){ return String(value || '').trim().replace(/[.#$\[\]\/]/g, '_') || '_'; }
function normalizeKey(value){ return String(value || '').trim().toUpperCase(); }
function normalizeConfig(value){
  const source = value && typeof value === 'object' ? value : {};
  const projectId = String(source.projectId || '').trim();
  return {
    apiKey:String(source.apiKey || '').trim(),
    authDomain:String(source.authDomain || (projectId ? `${projectId}.firebaseapp.com` : '')).trim(),
    projectId,
    storageBucket:String(source.storageBucket || '').trim(),
    messagingSenderId:String(source.messagingSenderId || '').trim(),
    appId:String(source.appId || '').trim(),
    measurementId:String(source.measurementId || '').trim(),
    databaseId:String(source.databaseId || '(default)').trim() || '(default)',
    databaseURL:`firestore://${projectId}`
  };
}
function validateConfig(config){
  const normalized = normalizeConfig(config);
  const missing = ['apiKey','authDomain','projectId','appId'].filter(key => !normalized[key]);
  if (missing.length) throw new Error(`حقول إعداد Firebase ناقصة: ${missing.join(', ')}`);
  return normalized;
}
function hash(value){
  let h = 2166136261;
  for (const char of String(value || '')) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function splitText(text){
  const chunks=[];
  for(let start=0; start<text.length;){
    let end=Math.min(text.length,start+CHUNK_CHARS);
    if(end<text.length){const code=text.charCodeAt(end-1);if(code>=0xD800&&code<=0xDBFF)end-=1;}
    chunks.push(text.slice(start,end));start=end;
  }
  return chunks.length?chunks:[''];
}
function randomVersion(){
  const random=crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,14):Math.random().toString(36).slice(2,16);
  return `${Date.now()}_${random}`;
}
async function loadModules(){
  if(!modulesPromise){
    modulesPromise=Promise.all([
      import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-firestore.js`)
    ]).then(([app,firestore])=>({app,firestore}));
  }
  return modulesPromise;
}
async function loadAuth(){
  if(!authPromise) authPromise=import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-auth.js`).catch(error=>{authPromise=null;throw error;});
  return authPromise;
}
function contextId(config){return `${config.projectId}|${config.appId}|${config.databaseId}`;}
function isEmbeddedAndroidWebView(){
  const ua=String(globalThis.navigator?.userAgent||'');
  return /Android/i.test(ua)&&(/\bwv\b/i.test(ua)||/Version\/4\.0/i.test(ua)||/; wv\)/i.test(ua)||/Alif|com\.alif\.ide/i.test(ua));
}
function isInternalAssertion(error){
  const text=String(error?.message||error?.code||error||'').toLowerCase();
  return text.includes('internal assertion failed')||text.includes('unexpected state')||text.includes('pendingresponses less than 0');
}
async function disposeContext(rawConfig){
  const config=validateConfig(rawConfig),id=contextId(config),pending=contexts.get(id);
  contexts.delete(id);
  contextEpochs.set(id,(contextEpochs.get(id)||0)+1);
  if(!pending)return;
  const ctx=await Promise.resolve(pending).catch(()=>null);
  if(!ctx)return;
  try{await ctx.firestore.terminate(ctx.db);}catch(_){}
  try{await ctx.app.deleteApp?.(ctx.app);}catch(_){}
  try{await ctx.appModule?.deleteApp?.(ctx.app);}catch(_){}
}
async function contextFor(rawConfig){
  const config=validateConfig(rawConfig),id=contextId(config);
  if(contexts.has(id))return contexts.get(id);
  const epoch=contextEpochs.get(id)||0;
  const promise=(async()=>{
    const modules=await loadModules();
    const appName=`cashtop-db-${safeSegment(config.projectId)}-${hash(id)}-${epoch}`;
    const appOptions={apiKey:config.apiKey,authDomain:config.authDomain,projectId:config.projectId,storageBucket:config.storageBucket,messagingSenderId:config.messagingSenderId,appId:config.appId,measurementId:config.measurementId};
    const app=modules.app.getApps().find(item=>item.name===appName)||modules.app.initializeApp(appOptions,appName);
    const firestoreOptions={
      localCache:modules.firestore.memoryLocalCache(),
      ignoreUndefinedProperties:true
    };
    if(isEmbeddedAndroidWebView()){
      firestoreOptions.experimentalForceLongPolling=true;
      firestoreOptions.experimentalLongPollingOptions={timeoutSeconds:25};
    }else{
      firestoreOptions.experimentalAutoDetectLongPolling=true;
    }
    let db;
    try{
      db=config.databaseId&&config.databaseId!=='(default)'
        ?modules.firestore.initializeFirestore(app,firestoreOptions,config.databaseId)
        :modules.firestore.initializeFirestore(app,firestoreOptions);
    }catch(error){
      const text=String(error?.code||error?.message||'').toLowerCase();
      if(!text.includes('already-initialized')&&!text.includes('already been started'))throw error;
      db=config.databaseId&&config.databaseId!=='(default)'
        ?modules.firestore.getFirestore(app,config.databaseId)
        :modules.firestore.getFirestore(app);
    }
    return {...modules,appModule:modules.app,app,db,config,auth:null,authModule:null,contextId:id};
  })().catch(error=>{contexts.delete(id);throw error;});
  contexts.set(id,promise);
  return promise;
}
function isPermissionError(error){const code=String(error?.code||error?.message||'').toLowerCase();return code.includes('permission-denied')||code.includes('unauthenticated');}
async function ensureAnonymous(ctx){
  try{
    ctx.authModule=ctx.authModule||await loadAuth();
    ctx.auth=ctx.auth||ctx.authModule.getAuth(ctx.app);
    if(!ctx.auth.currentUser)await ctx.authModule.signInAnonymously(ctx.auth);
    return true;
  }catch(error){console.warn('[CASH TOP MULTI DB] anonymous auth unavailable:',error);return false;}
}
async function executeWorker(ctx,worker){
  try{return await worker(ctx);}catch(error){
    if(isPermissionError(error)&&await ensureAnonymous(ctx))return await worker(ctx);
    throw error;
  }
}
async function run(rawConfig,worker){
  let ctx=await contextFor(rawConfig);
  try{return await executeWorker(ctx,worker);}catch(error){
    if(!isInternalAssertion(error))throw error;
    console.warn('[CASH TOP MULTI DB] Firestore context entered an invalid state; rebuilding once.',error);
    await disposeContext(rawConfig);
    ctx=await contextFor(rawConfig);
    return await executeWorker(ctx,worker);
  }
}
function versionRef(ctx,ref,version){return ctx.firestore.doc(ctx.firestore.collection(ref,'versions'),version);}
function chunksCollection(ctx,ref,version){return ctx.firestore.collection(versionRef(ctx,ref,version),'chunks');}
async function commitInBatches(ctx,operations){
  for(let offset=0;offset<operations.length;offset+=430){
    const batch=ctx.firestore.writeBatch(ctx.db);
    operations.slice(offset,offset+430).forEach(op=>op.type==='set'?batch.set(op.ref,op.data,op.options||{}):batch.delete(op.ref));
    await batch.commit();
  }
}
async function deleteVersion(ctx,ref,version){
  if(!version)return;
  try{
    const vRef=versionRef(ctx,ref,version);
    const snaps=await ctx.firestore.getDocs(ctx.firestore.collection(vRef,'chunks'));
    await commitInBatches(ctx,[...snaps.docs.map(snap=>({type:'delete',ref:snap.ref})),{type:'delete',ref:vRef}]);
  }catch(_){}
}
async function writeJsonRef(ctx,ref,value){
  const previous=await ctx.firestore.getDoc(ref).catch(()=>null);
  const previousVersion=previous?.exists?.()?String(previous.data()?.version||''):'';
  const text=JSON.stringify(value==null?null:value),chunks=splitText(text),version=randomVersion(),vRef=versionRef(ctx,ref,version);
  const operations=[{type:'set',ref:vRef,data:{chunkCount:chunks.length,createdAt:Date.now()}}];
  chunks.forEach((data,index)=>operations.push({type:'set',ref:ctx.firestore.doc(ctx.firestore.collection(vRef,'chunks'),String(index).padStart(6,'0')),data:{index,data}}));
  await commitInBatches(ctx,operations);
  await ctx.firestore.setDoc(ref,{storage:'cashtop-chunked-json-v1',version,chunkCount:chunks.length,jsonLength:text.length,updatedAt:Date.now()});
  if(previousVersion&&previousVersion!==version)deleteVersion(ctx,ref,previousVersion).catch(()=>null);
  return value;
}
async function readJsonRef(ctx,ref,fallback=null){
  const snap=await ctx.firestore.getDoc(ref);
  if(!snap.exists())return fallback;
  const data=snap.data()||{};
  if(data.storage==='cashtop-chunked-json-v1'&&data.version){
    const chunks=await ctx.firestore.getDocs(chunksCollection(ctx,ref,data.version));
    const text=chunks.docs.sort((a,b)=>a.id.localeCompare(b.id)).map(item=>String(item.data()?.data||'')).join('');
    return parse(text,fallback);
  }
  if(typeof data.payload==='string')return parse(data.payload,fallback);
  if(Object.prototype.hasOwnProperty.call(data,'value')&&Object.keys(data).length<=4)return clone(data.value);
  return clone(data);
}
async function deleteJsonRef(ctx,ref){
  const snap=await ctx.firestore.getDoc(ref).catch(()=>null);const version=snap?.exists?.()?String(snap.data()?.version||''):'';
  if(version)await deleteVersion(ctx,ref,version);await ctx.firestore.deleteDoc(ref).catch(()=>null);
}
function rootAdminRef(ctx){return ctx.firestore.doc(ctx.db,ROOT_COLLECTION,ROOT_DOCUMENT);}
function adminRef(ctx){return ctx.firestore.doc(ctx.db,ADMIN_COLLECTION,ADMIN_DOCUMENT);}
function companyRef(ctx,tenantId){return ctx.firestore.doc(ctx.db,COMPANIES_COLLECTION,safeSegment(tenantId));}
function datasetRef(ctx,tenantId,key){return ctx.firestore.doc(companyRef(ctx,tenantId),DATASET_COLLECTION,safeSegment(key));}
function metaRef(ctx,tenantId){return ctx.firestore.doc(companyRef(ctx,tenantId),META_COLLECTION,META_DOCUMENT);}
function nodeRef(ctx,tenantId,key){return ctx.firestore.doc(companyRef(ctx,tenantId),GENERIC_NODES_COLLECTION,safeSegment(key));}
function databaseRecord(value){
  const raw=value&&typeof value==='object'?value:{};
  const config=validateConfig(raw.config||raw);
  const id=safeSegment(raw.id||`${config.projectId}__${config.databaseId||'(default)'}`);
  return {id,name:String(raw.name||config.projectId).trim(),enabled:raw.enabled!==false,config,createdAt:raw.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
}
async function listDatabases(){
  return run(masterConfig,async ctx=>{
    const snaps=await ctx.firestore.getDocs(ctx.firestore.collection(ctx.db,DATABASES_COLLECTION));
    return snaps.docs.map(snap=>({id:snap.id,...clone(snap.data())})).map(record=>({...record,config:normalizeConfig(record.config||record)})).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ar'));
  });
}
async function getDatabase(id){
  return run(masterConfig,async ctx=>{const snap=await ctx.firestore.getDoc(ctx.firestore.doc(ctx.db,DATABASES_COLLECTION,safeSegment(id)));return snap.exists()?{id:snap.id,...clone(snap.data()),config:normalizeConfig(snap.data()?.config||snap.data())}:null;});
}
async function saveDatabase(value){
  const record=databaseRecord(value);
  await run(masterConfig,ctx=>ctx.firestore.setDoc(ctx.firestore.doc(ctx.db,DATABASES_COLLECTION,record.id),record,{merge:true}));
  return record;
}
async function deleteDatabase(id){return run(masterConfig,ctx=>ctx.firestore.deleteDoc(ctx.firestore.doc(ctx.db,DATABASES_COLLECTION,safeSegment(id))));}
async function testDatabase(config){
  const normalized=validateConfig(config);
  return run(normalized,async ctx=>{
    // قراءة مستند الإدارة تكفي لاختبار المشروع وDatabase ID وAuth والقواعد من دون إنشاء بيانات تجريبية.
    const snap=await ctx.firestore.getDoc(adminRef(ctx));
    return {ok:true,projectId:normalized.projectId,databaseId:normalized.databaseId,adminStateExists:snap.exists()};
  });
}
async function getRootAdmin(){return run(masterConfig,ctx=>readJsonRef(ctx,rootAdminRef(ctx),null));}
async function saveRootAdmin(value){return run(masterConfig,ctx=>writeJsonRef(ctx,rootAdminRef(ctx),value));}
async function getRoute(companyKey){
  const key=normalizeKey(companyKey);if(!key)return null;
  return run(masterConfig,async ctx=>{const snap=await ctx.firestore.getDoc(ctx.firestore.doc(ctx.db,ROUTES_COLLECTION,safeSegment(key)));return snap.exists()?{id:snap.id,...clone(snap.data())}:null;});
}
async function saveRoute(route){
  const key=normalizeKey(route?.key||route?.companyKey);if(!key)throw new Error('مفتاح الشركة مطلوب لإنشاء مسار القاعدة.');
  const payload={...clone(route),key,companyKey:key,databaseId:safeSegment(route.databaseId),tenantId:String(route.tenantId||route.companyId||''),companyId:String(route.tenantId||route.companyId||''),updatedAt:Date.now()};
  await run(masterConfig,ctx=>ctx.firestore.setDoc(ctx.firestore.doc(ctx.db,ROUTES_COLLECTION,safeSegment(key)),payload,{merge:true}));return payload;
}
async function deleteRoute(companyKey){const key=normalizeKey(companyKey);return run(masterConfig,ctx=>ctx.firestore.deleteDoc(ctx.firestore.doc(ctx.db,ROUTES_COLLECTION,safeSegment(key))));}
async function readAdminState(config){
  return run(config,async ctx=>{
    const stored=await readJsonRef(ctx,adminRef(ctx),null);
    if(stored&&typeof stored==='object')return stored;
    const snaps=await ctx.firestore.getDocs(ctx.firestore.collection(ctx.db,COMPANIES_COLLECTION));
    const companies={},keyIndex={};
    snaps.docs.forEach(snap=>{
      const company=clone(snap.data())||{};
      const tenantId=String(company.tenantId||company.companyId||snap.id);
      const key=normalizeKey(company.key||company.companyKey||company.licenseKey);
      if(!tenantId)return;
      company.tenantId=tenantId;company.companyId=tenantId;company.key=key;
      companies[tenantId]=company;
      if(key&&company.status!=='deleted'&&company.deleted!==true)keyIndex[safeSegment(key)]={tenantId,companyId:tenantId,key};
    });
    return {companies,keyIndex,retiredKeys:{},updatedAt:0,recoveredFromCompanies:true};
  });
}
async function writeCompanySummary(ctx,company){
  const tenantId=String(company.tenantId||company.companyId||company.id||'').trim();if(!tenantId)return;
  const key=normalizeKey(company.key||company.companyKey||'');
  await ctx.firestore.setDoc(companyRef(ctx,tenantId),{...clone(company),tenantId,companyId:tenantId,key,updatedAtMs:Date.now()},{merge:true});
  if(key&&company.status!=='deleted'&&company.deleted!==true){
    await Promise.all([
      ctx.firestore.setDoc(ctx.firestore.doc(ctx.db,LICENSES_COLLECTION,key),{id:tenantId,licenseId:tenantId,tenantId,companyId:tenantId,licenseKey:key,key,companyName:company.companyName||'',status:company.status||'active',plan:company.plan||'pro',startAt:company.startAt||'',endAt:company.endAt||'',backupImportEnabled:company.backupImportEnabled===true,updatedAtMs:Date.now()},{merge:true}),
      ctx.firestore.setDoc(ctx.firestore.doc(ctx.db,KEY_INDEX_COLLECTION,safeSegment(key)),{tenantId,companyId:tenantId,key,companyName:company.companyName||'',status:company.status||'active',updatedAtMs:Date.now()},{merge:true})
    ]);
  }
}
async function writeAdminState(config,value){
  const state=value&&typeof value==='object'?value:{};
  return run(config,async ctx=>{await writeJsonRef(ctx,adminRef(ctx),state);for(const company of Object.values(state.companies||{}))if(company&&typeof company==='object')await writeCompanySummary(ctx,company);return state;});
}
async function writeCompanyAccess(config,company,accessPayload){
  const tenantId=String(company.tenantId||company.companyId||'');if(!tenantId)throw new Error('معرّف الشركة غير موجود.');
  return run(config,async ctx=>{
    await writeCompanySummary(ctx,company);
    await writeJsonRef(ctx,metaRef(ctx,tenantId),{tenantId,companyId:tenantId,companyKey:company.key,companyName:company.companyName,schema:20,updatedAt:Date.now(),managedBy:'cashTopMultiDatabaseAdmin'});
    await writeJsonRef(ctx,datasetRef(ctx,tenantId,'cashtop_company_access'),accessPayload);
    return true;
  });
}

async function deleteChildKey(config,companyKey){
  const key=normalizeKey(companyKey);if(!key)return;
  return run(config,async ctx=>{
    await Promise.all([
      ctx.firestore.deleteDoc(ctx.firestore.doc(ctx.db,KEY_INDEX_COLLECTION,safeSegment(key))).catch(()=>null),
      ctx.firestore.deleteDoc(ctx.firestore.doc(ctx.db,LICENSES_COLLECTION,key)).catch(()=>null)
    ]);
  });
}
async function readDataset(config,tenantId,key,fallback=null){
  return run(config,ctx=>readJsonRef(ctx,datasetRef(ctx,tenantId,key),fallback));
}
async function writeDataset(config,tenantId,key,value){
  return run(config,ctx=>writeJsonRef(ctx,datasetRef(ctx,tenantId,key),value));
}
async function readLoginBootstrap(config,tenantId,companyKey){
  const canonical=safeSegment(tenantId),key=normalizeKey(companyKey);
  return run(config,async ctx=>{
    const [meta,accessPayload,branchesPayload,employeesPayload]=await Promise.all([
      readJsonRef(ctx,metaRef(ctx,canonical),{}),
      readJsonRef(ctx,datasetRef(ctx,canonical,'cashtop_company_access'),null),
      readJsonRef(ctx,datasetRef(ctx,canonical,'cashtop_branches'),null),
      readJsonRef(ctx,datasetRef(ctx,canonical,'cashtop_employees'),null)
    ]);
    if(accessPayload==null)return null;
    const node={meta:meta||{},datasets:{cashtop_company_access:accessPayload}};
    if(branchesPayload!=null)node.datasets.cashtop_branches=branchesPayload;
    if(employeesPayload!=null)node.datasets.cashtop_employees=employeesPayload;
    const raw=accessPayload&&typeof accessPayload==='object'&&Object.prototype.hasOwnProperty.call(accessPayload,'value')?accessPayload.value:accessPayload;
    let access=raw;
    for(let i=0;i<3&&typeof access==='string';i+=1){const decoded=parse(access,null);if(decoded==null)break;access=decoded;}
    access=access&&typeof access==='object'?access:{};
    const remoteKey=normalizeKey(access.companyKey||node.meta.companyKey||key);
    const remoteTenant=safeSegment(access.tenantId||access.companyId||node.meta.tenantId||node.meta.companyId||canonical);
    if(remoteKey!==key||remoteTenant!==canonical){const error=new Error('مسار قاعدة الشركة لا يطابق المفتاح الحالي.');error.code='CASHTOP_TENANT_INDEX_MISMATCH';throw error;}
    return {companyId:canonical,tenantId:canonical,node,access};
  });
}
async function findKeyInDatabase(database,companyKey){
  const key=normalizeKey(companyKey);
  return run(database.config,async ctx=>{
    const snap=await ctx.firestore.getDoc(ctx.firestore.doc(ctx.db,KEY_INDEX_COLLECTION,safeSegment(key)));
    if(!snap.exists())return null;const entry=clone(snap.data())||{};
    if(entry.status==='deleted')return null;
    return {databaseId:database.id,databaseName:database.name,key,companyKey:key,tenantId:String(entry.tenantId||entry.companyId||''),companyId:String(entry.tenantId||entry.companyId||''),projectId:database.config.projectId};
  });
}
function readRouteCache(){const value=parse(Storage.prototype.getItem.call(localStorage,ROUTE_CACHE_STORAGE_KEY),{});return value&&typeof value==='object'?value:{}}
function writeRouteCache(value){Storage.prototype.setItem.call(localStorage,ROUTE_CACHE_STORAGE_KEY,JSON.stringify(value&&typeof value==='object'?value:{}));return value}
function cacheResolvedRoute(database,route={}){
  const key=normalizeKey(route.key||route.companyKey);if(!key||!database?.config)return null;
  const cache=readRouteCache();
  cache[key]={database:databaseRecord(database),route:{...clone(route),key,companyKey:key},cachedAt:Date.now()};
  writeRouteCache(cache);return cache[key];
}
function getCachedResolvedRoute(companyKey){
  const key=normalizeKey(companyKey),entry=readRouteCache()[key];
  if(!entry||Date.now()-Number(entry.cachedAt||0)>ROUTE_CACHE_TTL_MS)return null;
  try{return {database:databaseRecord(entry.database),route:{...clone(entry.route),key,companyKey:key}}}catch(_){return null}
}
function clearCachedResolvedRoute(companyKey){const key=normalizeKey(companyKey),cache=readRouteCache();if(key)delete cache[key];else Object.keys(cache).forEach(k=>delete cache[k]);writeRouteCache(cache)}
async function resolveKey(companyKey){
  const key=normalizeKey(companyKey);if(!key)return null;
  const cached=getCachedResolvedRoute(key);
  if(cached?.database?.enabled!==false){
    const verified=await findKeyInDatabase(cached.database,key).catch(()=>null);
    if(verified?.tenantId){const result={route:{...cached.route,...verified},database:cached.database};cacheResolvedRoute(result.database,result.route);return result;}
    clearCachedResolvedRoute(key);
  }
  const direct=await getRoute(key).catch(()=>null);
  if(direct?.databaseId){
    const database=await getDatabase(direct.databaseId);
    if(database?.enabled!==false){
      const verified=await findKeyInDatabase(database,key).catch(()=>null);
      if(verified?.tenantId){const result={route:{...direct,...verified},database};cacheResolvedRoute(result.database,result.route);return result;}
    }
  }
  const databases=(await listDatabases()).filter(item=>item.enabled!==false);
  const matches=[];
  for(const database of databases){const match=await findKeyInDatabase(database,key).catch(()=>null);if(match?.tenantId)matches.push({route:match,database});}
  if(matches.length>1){const error=new Error('المفتاح موجود في أكثر من قاعدة بيانات. صحح التكرار من لوحة الأدمن.');error.code='CASHTOP_DUPLICATE_DATABASE_KEY';throw error;}
  if(matches.length===1){await saveRoute(matches[0].route);cacheResolvedRoute(matches[0].database,matches[0].route);return matches[0];}
  return null;
}
function cacheActiveDatabase(database,route={}){
  const payload={databaseId:database.id,databaseName:database.name,projectId:database.config.projectId,config:normalizeConfig(database.config),companyKey:normalizeKey(route.key||route.companyKey),tenantId:String(route.tenantId||route.companyId||''),cachedAt:Date.now()};
  Storage.prototype.setItem.call(localStorage,ACTIVE_STORAGE_KEY,JSON.stringify(payload));cacheResolvedRoute(database,route);return payload;
}
function getCachedActiveDatabase(){return parse(Storage.prototype.getItem.call(localStorage,ACTIVE_STORAGE_KEY),null);}
function clearCachedActiveDatabase(){Storage.prototype.removeItem.call(localStorage,ACTIVE_STORAGE_KEY);}
async function readCompanyNode(config,tenantId){
  return run(config,async ctx=>{
    const company=companyRef(ctx,tenantId);
    const [meta,datasetsSnap,nodesSnap,auditSnap,recentSnap]=await Promise.all([
      readJsonRef(ctx,metaRef(ctx,tenantId),{}),
      ctx.firestore.getDocs(ctx.firestore.collection(company,DATASET_COLLECTION)),
      ctx.firestore.getDocs(ctx.firestore.collection(company,GENERIC_NODES_COLLECTION)),
      ctx.firestore.getDocs(ctx.firestore.collection(company,'auditTrail')),
      ctx.firestore.getDocs(ctx.firestore.collection(company,'auditTrailRecent'))
    ]);
    const datasets={},nodes={};
    for(const snap of datasetsSnap.docs)datasets[snap.id]=await readJsonRef(ctx,snap.ref,null);
    for(const snap of nodesSnap.docs)nodes[snap.id]=await readJsonRef(ctx,snap.ref,null);
    const auditTrail={},auditTrailRecent={};
    auditSnap.docs.forEach(snap=>{const row=snap.data()||{};auditTrail[row.day]=auditTrail[row.day]||{};auditTrail[row.day][row.hour]=auditTrail[row.day][row.hour]||{};auditTrail[row.day][row.hour][row.recordId||snap.id]=clone(row.value);});
    recentSnap.docs.forEach(snap=>{const row=snap.data()||{};auditTrailRecent[row.recordId||snap.id]=clone(row.value);});
    return {...nodes,meta,datasets,auditTrail,auditTrailRecent};
  });
}
async function writeCompanyNode(config,tenantId,node){
  return run(config,async ctx=>{
    if(node?.meta)await writeJsonRef(ctx,metaRef(ctx,tenantId),node.meta);
    for(const [key,value] of Object.entries(node?.datasets||{}))await writeJsonRef(ctx,datasetRef(ctx,tenantId,key),value);
    const reserved=new Set(['meta','datasets','auditTrail','auditTrailRecent']);
    for(const [key,value] of Object.entries(node||{}))if(!reserved.has(key))await writeJsonRef(ctx,nodeRef(ctx,tenantId,key),value);
    for(const [day,hours] of Object.entries(node?.auditTrail||{}))for(const [hour,records] of Object.entries(hours||{}))for(const [recordId,value] of Object.entries(records||{}))await ctx.firestore.setDoc(ctx.firestore.doc(ctx.firestore.collection(companyRef(ctx,tenantId),'auditTrail'),`${safeSegment(day)}__${safeSegment(hour)}__${safeSegment(recordId)}`),{day,hour,recordId,value});
    for(const [recordId,value] of Object.entries(node?.auditTrailRecent||{}))await ctx.firestore.setDoc(ctx.firestore.doc(ctx.firestore.collection(companyRef(ctx,tenantId),'auditTrailRecent'),safeSegment(recordId)),{recordId,value});
    return true;
  });
}
async function deleteCompanyData(config,tenantId){
  return run(config,async ctx=>{
    for(const collectionName of [DATASET_COLLECTION,GENERIC_NODES_COLLECTION,META_COLLECTION,'auditTrail','auditTrailRecent']){
      const snaps=await ctx.firestore.getDocs(ctx.firestore.collection(companyRef(ctx,tenantId),collectionName));
      for(const snap of snaps.docs){if([DATASET_COLLECTION,GENERIC_NODES_COLLECTION,META_COLLECTION].includes(collectionName))await deleteJsonRef(ctx,snap.ref);else await ctx.firestore.deleteDoc(snap.ref);}
    }
    await ctx.firestore.deleteDoc(companyRef(ctx,tenantId)).catch(()=>null);
  });
}

window.CashtopMultiDatabase=Object.freeze({
  masterConfig,normalizeConfig,validateConfig,safeSegment,normalizeKey,
  listDatabases,getDatabase,saveDatabase,deleteDatabase,testDatabase,
  getRootAdmin,saveRootAdmin,getRoute,saveRoute,deleteRoute,resolveKey,
  readAdminState,writeAdminState,writeCompanyAccess,deleteChildKey,readDataset,writeDataset,readLoginBootstrap,
  readCompanyNode,writeCompanyNode,deleteCompanyData,
  cacheActiveDatabase,getCachedActiveDatabase,clearCachedActiveDatabase,
  cacheResolvedRoute,getCachedResolvedRoute,clearCachedResolvedRoute,
  activeStorageKey:ACTIVE_STORAGE_KEY,routeCacheStorageKey:ROUTE_CACHE_STORAGE_KEY
});
})();
