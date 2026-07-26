/* إعدادات Cash Top متعددة قواعد Firestore.
 * قاعدة الإدارة الرئيسية تحفظ إعدادات قواعد الشركات وفهرس توجيه المفاتيح فقط.
 * مفاتيح Firebase Web عامة، والحماية الفعلية تعتمد على Firestore Rules وFirebase Auth.
 */
(function(){
'use strict';
const ACTIVE_STORAGE_KEY='cashtop_active_database_v1';
const MASTER_CONFIG=Object.freeze({
  apiKey:'AIzaSyDt2fEDDgjkRLqcpEFUBTIFne4JOKfPTFs',
  authDomain:'ahmed-97701.firebaseapp.com',
  projectId:'ahmed-97701',
  storageBucket:'ahmed-97701.firebasestorage.app',
  messagingSenderId:'538797847362',
  appId:'1:538797847362:web:87353ac87be8abc0dc4edb',
  measurementId:'G-QEBVE079ER',
  databaseId:'(default)',
  databaseURL:'firestore://ahmed-97701'
});
function parse(value,fallback=null){try{return JSON.parse(value)??fallback}catch(_){return fallback}}
function normalizedConfig(value){
  const source=value&&typeof value==='object'?value:{};
  const projectId=String(source.projectId||'').trim();
  return Object.freeze({
    apiKey:String(source.apiKey||'').trim(),
    authDomain:String(source.authDomain||(projectId?`${projectId}.firebaseapp.com`:'')).trim(),
    projectId,
    storageBucket:String(source.storageBucket||'').trim(),
    messagingSenderId:String(source.messagingSenderId||'').trim(),
    appId:String(source.appId||'').trim(),
    measurementId:String(source.measurementId||'').trim(),
    databaseId:String(source.databaseId||'(default)').trim()||'(default)',
    databaseURL:`firestore://${projectId}`
  });
}
const page=decodeURIComponent(String(location.pathname||'').split('/').pop()||'');
const adminPage=/^admin(?:-notifications)?\.html$/i.test(page);
const loginPage=page==='صفحة تسجيل الدخول.html'||page==='index.html'||page==='';
const cached=parse(Storage.prototype.getItem.call(localStorage,ACTIVE_STORAGE_KEY),null);
const activeAllowed=!adminPage&&!loginPage&&cached?.config?.projectId;
const runtimeConfig=activeAllowed?normalizedConfig(cached.config):MASTER_CONFIG;
window.CASHTOP_FIREBASE=Object.freeze({
  enabled:true,
  authMode:'auto',
  syncMode:'firestore-sdk',
  backendMode:'firestore-sdk',
  backendName:'Google Cloud Firestore',
  sdkVersion:'12.16.0',
  rootPath:'cashTopExchange/cashTopPOS',
  adminRootPath:'cashTopExchange/cashTopAdmin',
  legacyRootPaths:Object.freeze(['cashTopPOS/v6']),
  activeDatabaseStorageKey:ACTIVE_STORAGE_KEY,
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
    inlineJsonMaxBytes:720000,
    pageSize:20,
    auditRecentLimit:100,
    auditRangeLimit:500,
    closeIdleMs:320
  }),
  sync:Object.freeze({
    datasetCacheTtlMs:120000,
    activePollMs:120000,
    backgroundFullPullMs:900000,
    writeDebounceMs:1200,
    maxFailedOperations:200
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
