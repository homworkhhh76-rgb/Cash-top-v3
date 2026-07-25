/* إعدادات Cash Top لقاعدتي Cloud Firestore وFirebase Realtime Database.
 * يحدد النظام نوع القاعدة تلقائياً من databaseURL، ويمكن تثبيته عبر backendMode.
 * مفاتيح Firebase Web عامة، والحماية الفعلية تعتمد على Rules وFirebase Auth.
 */
(function(){
'use strict';
const ACTIVE_STORAGE_KEY='cashtop_active_database_v1';
const BACKEND_STORAGE_KEY='cashtop_backend_config_v1';
const MASTER_CONFIG=Object.freeze({
  apiKey:'AIzaSyDt2fEDDgjkRLqcpEFUBTIFne4JOKfPTFs',
  authDomain:'ahmed-97701.firebaseapp.com',
  projectId:'ahmed-97701',
  storageBucket:'ahmed-97701.firebasestorage.app',
  messagingSenderId:'538797847362',
  appId:'1:538797847362:web:87353ac87be8abc0dc4edb',
  measurementId:'G-QEBVE079ER',
  databaseId:'(default)',
  databaseURL:'firestore://ahmed-97701',
  backendMode:'auto'
});
function parse(value,fallback=null){try{return JSON.parse(value)??fallback}catch(_){return fallback}}
function normalizeBackendMode(source){
  const requested=String(source?.backendMode||source?.syncMode||'').trim().toLowerCase();
  const databaseURL=String(source?.databaseURL||'').trim();
  if(['firebase-rtdb-rest','rtdb','realtime-database','database'].includes(requested))return 'firebase-rtdb-rest';
  if(['firestore-sdk','firestore'].includes(requested))return 'firestore-sdk';
  return /^https?:\/\//i.test(databaseURL)?'firebase-rtdb-rest':'firestore-sdk';
}
function normalizedConfig(value){
  const source=value&&typeof value==='object'?value:{};
  const projectId=String(source.projectId||'').trim();
  const backendMode=normalizeBackendMode(source);
  const suppliedDatabaseURL=String(source.databaseURL||'').trim().replace(/\/+$/,'');
  const databaseURL=backendMode==='firebase-rtdb-rest'
    ?(suppliedDatabaseURL||`https://${projectId}-default-rtdb.firebaseio.com`)
    :`firestore://${projectId}`;
  return Object.freeze({
    apiKey:String(source.apiKey||'').trim(),
    authDomain:String(source.authDomain||(projectId?`${projectId}.firebaseapp.com`:'')).trim(),
    projectId,
    storageBucket:String(source.storageBucket||'').trim(),
    messagingSenderId:String(source.messagingSenderId||'').trim(),
    appId:String(source.appId||'').trim(),
    measurementId:String(source.measurementId||'').trim(),
    databaseId:String(source.databaseId||'(default)').trim()||'(default)',
    databaseURL,
    backendMode
  });
}
const page=decodeURIComponent(String(location.pathname||'').split('/').pop()||'');
const adminPage=/^admin(?:-notifications)?\.html$/i.test(page);
const loginPage=page==='صفحة تسجيل الدخول.html'||page==='index.html'||page==='';
const cached=parse(Storage.prototype.getItem.call(localStorage,ACTIVE_STORAGE_KEY),null);
const backendOverride=parse(Storage.prototype.getItem.call(localStorage,BACKEND_STORAGE_KEY),null);
const activeAllowed=!adminPage&&!loginPage&&cached?.config?.projectId;
const selectedSource=activeAllowed?cached.config:(backendOverride?.config||backendOverride||MASTER_CONFIG);
const runtimeConfig=normalizedConfig(selectedSource);
const runtimeBackend=runtimeConfig.backendMode;
window.CASHTOP_FIREBASE=Object.freeze({
  enabled:true,
  authMode:'auto',
  syncMode:runtimeBackend,
  backendMode:runtimeBackend,
  backendName:runtimeBackend==='firestore-sdk'?'Google Cloud Firestore':'Firebase Realtime Database',
  sdkVersion:'12.16.0',
  rootPath:'cashTopExchange/cashTopPOS',
  adminRootPath:'cashTopExchange/cashTopAdmin',
  legacyRootPaths:Object.freeze(['cashTopPOS/v6']),
  activeDatabaseStorageKey:ACTIVE_STORAGE_KEY,
  backendConfigStorageKey:BACKEND_STORAGE_KEY,
  masterConfig:MASTER_CONFIG,
  config:runtimeConfig,
  activeDatabase:activeAllowed?Object.freeze(cached):null,
  firestore:Object.freeze({
    adminCollection:'cashtopAdmin',
    adminDocument:'main',
    companiesCollection:'companies',
    keyIndexCollection:'companyKeys',
    datasetCollection:'datasets',
    metaCollection:'meta',
    metaDocument:'state',
    genericNodesCollection:'nodes',
    authPolicy:'auto',
    chunkChars:140000,
    closeIdleMs:320
  }),
  multiDatabase:Object.freeze({
    databasesCollection:'cashtopDatabases',
    routesCollection:'cashtopDatabaseRoutes',
    rootCollection:'cashtopRoot',
    rootDocument:'main'
  }),
  collections:Object.freeze({licenses:'licenses',users:'users',companies:'companies'})
});
})();
