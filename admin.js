(function(){
'use strict';

const $=id=>document.getElementById(id);
const DB=()=>window.CashtopMultiDatabase;
const SESSION_KEY='cashtop_superadmin_session';
const LOCAL_ROOT_KEY='cashtop_root_admin_cache_v1';
const DATABASE_DRAFT_KEY='cashtop_database_form_draft_v2';
const AUTH_USERNAME_DRAFT_KEY='cashtop_superadmin_username_draft_v1';
let rootAdmin={superAdmin:null,updatedAt:0};
let databases=[];
let databaseStates=new Map();
let databaseErrors=new Map();
let editingDatabaseId='';
let editingCompanyRef='';
let preparedBackup=null;
let databaseSaveInProgress=false;

const parse=(value,fallback=null)=>{try{return JSON.parse(value)??fallback}catch(_){return fallback}};
const rawGet=key=>Storage.prototype.getItem.call(localStorage,key);
const rawSet=(key,value)=>Storage.prototype.setItem.call(localStorage,key,String(value));
const rawRemove=key=>Storage.prototype.removeItem.call(localStorage,key);
const normalizeKey=value=>String(value||'').trim().toUpperCase();
const safe=value=>DB().safeSegment(value);
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function emptyChildState(){return {companies:{},keyIndex:{},retiredKeys:{},updatedAt:0};}
function normalizeChildState(value){
  const state=value&&typeof value==='object'?value:{};
  const normalized={companies:state.companies&&typeof state.companies==='object'?state.companies:{},keyIndex:state.keyIndex&&typeof state.keyIndex==='object'?state.keyIndex:{},retiredKeys:state.retiredKeys&&typeof state.retiredKeys==='object'?state.retiredKeys:{},updatedAt:Number(state.updatedAt||0)};
  Object.entries(normalized.companies).forEach(([id,company])=>{
    if(!company||typeof company!=='object')return;
    company.tenantId=String(company.tenantId||company.companyId||id);
    company.companyId=company.tenantId;
    company.key=normalizeKey(company.key||company.companyKey);
    company.backupImportEnabled=company.backupImportEnabled===true;
    if(company.key&&company.status!=='deleted'&&company.deleted!==true)normalized.keyIndex[safe(company.key)]={tenantId:company.tenantId,companyId:company.tenantId,key:company.key};
  });
  return normalized;
}
function normalizeRoot(value){const state=value&&typeof value==='object'?value:{};return {superAdmin:state.superAdmin||null,updatedAt:Number(state.updatedAt||0)};}
function status(message,type='info'){const box=$('authStatus');if(!box)return;box.className=`status show ${type}`;box.textContent=message;}
function toast(message,type='success'){
  let host=document.getElementById('adminToastHost');
  if(!host){host=document.createElement('div');host.id='adminToastHost';host.style.cssText='position:fixed;bottom:18px;right:18px;z-index:99999;display:grid;gap:8px;max-width:min(420px,calc(100vw - 36px))';document.body.appendChild(host);}
  const el=document.createElement('div');el.textContent=message;el.style.cssText=`padding:11px 14px;border-radius:8px;color:#fff;font:700 11px Cairo;box-shadow:0 8px 25px rgba(0,0,0,.18);background:${type==='error'?'#dd4b39':type==='warning'?'#f39c12':'#00a65a'}`;host.appendChild(el);setTimeout(()=>el.remove(),4200);
}
async function hashPassword(password,salt){const data=new TextEncoder().encode(`${salt}:${password}`);const digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function makeSalt(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}_${Math.random()}`;}
function sessionValid(){const session=parse(rawGet(SESSION_KEY),null);return Boolean(session&&Number(session.expiresAt||0)>Date.now());}
async function saveRoot(nextState=rootAdmin){
  const payload=normalizeRoot(clone(nextState));payload.updatedAt=Date.now();
  // لا نحفظ الكاش المحلي قبل نجاح Firestore حتى لا يتكوّن حساب أدمن وهمي عند فشل الشبكة.
  await DB().saveRootAdmin(payload);
  rootAdmin=payload;rawSet(LOCAL_ROOT_KEY,JSON.stringify(payload));return payload;
}
function setupAuthView(){const first=!rootAdmin.superAdmin;$('confirmField').classList.toggle('hidden',!first);$('authSubtitle').textContent=first?'إنشاء أول حساب للمشرف العام':'دخول المشرف العام';$('authButton').innerHTML=first?'<i class="fa-solid fa-user-shield"></i> إنشاء حساب الإدارة':'<i class="fa-solid fa-shield-halved"></i> دخول الإدارة';}
function showApp(){$('authView').classList.add('hidden');$('appView').classList.remove('hidden');render();}
async function handleAuth(event){
  event.preventDefault();
  const button=$('authButton'),username=$('superUsername').value.trim(),password=$('superPassword').value,confirmation=$('superPasswordConfirm').value;
  rawSet(AUTH_USERNAME_DRAFT_KEY,username);button.disabled=true;status('جارٍ التحقق والحفظ...','info');
  try{
    if(!rootAdmin.superAdmin){
      if(password!==confirmation)throw new Error('كلمتا المرور غير متطابقتين.');
      if(password.length<6)throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
      if(!username)throw new Error('اسم المشرف العام مطلوب.');
      const salt=makeSalt();
      const nextRoot={...rootAdmin,superAdmin:{username,passwordHash:await hashPassword(password,salt),salt,createdAt:new Date().toISOString(),authVersion:Date.now()}};
      await saveRoot(nextRoot);
      rawSet(SESSION_KEY,JSON.stringify({username,expiresAt:Date.now()+8*60*60*1000}));rawRemove(AUTH_USERNAME_DRAFT_KEY);showApp();return;
    }
    const expected=await hashPassword(password,rootAdmin.superAdmin.salt);
    if(String(username).toLowerCase()!==String(rootAdmin.superAdmin.username).toLowerCase()||expected!==rootAdmin.superAdmin.passwordHash)throw new Error('بيانات المشرف العام غير صحيحة.');
    rawSet(SESSION_KEY,JSON.stringify({username:rootAdmin.superAdmin.username,expiresAt:Date.now()+8*60*60*1000}));rawRemove(AUTH_USERNAME_DRAFT_KEY);showApp();
  }catch(error){
    // بعض WebView تفرغ حقول كلمات المرور بعد submit؛ نعيد القيم فوراً عند أي فشل.
    requestAnimationFrame(()=>{$('superUsername').value=username;$('superPassword').value=password;if(!rootAdmin.superAdmin)$('superPasswordConfirm').value=confirmation;});
    status(friendlyFirebaseError(error,'تعذر حفظ/تسجيل بيانات المشرف العام'),'error');
  }finally{button.disabled=false;}
}
function databaseById(id){return databases.find(item=>item.id===id)||null;}
function allCompanies(){
  const rows=[];
  databases.forEach(database=>{
    const state=databaseStates.get(database.id)||emptyChildState();
    Object.values(state.companies||{}).forEach(company=>{if(company&&company.deleted!==true&&company.status!=='deleted')rows.push({...clone(company),databaseId:database.id,databaseName:database.name,databaseProjectId:database.config?.projectId});});
  });
  return rows;
}
async function loadDatabasesAndStates(){
  databases=await DB().listDatabases();databaseStates=new Map();databaseErrors=new Map();
  let cursor=0;
  async function worker(){while(cursor<databases.length){const database=databases[cursor++];try{databaseStates.set(database.id,normalizeChildState(await DB().readAdminState(database.config)));}catch(error){databaseStates.set(database.id,emptyChildState());databaseErrors.set(database.id,String(error?.message||error));}}}
  await Promise.all(Array.from({length:Math.min(4,databases.length||1)},worker));
}
function friendlyFirebaseError(error,prefix='تعذر تنفيذ العملية'){
  const code=String(error?.code||'').toLowerCase(),message=String(error?.message||error||'').trim();
  if(code.includes('permission-denied')||message.toLowerCase().includes('permission-denied'))return `${prefix}: الصلاحيات مرفوضة. فعّل Anonymous Authentication وانشر ملف قواعد Firestore الصحيح على المشروع.`;
  if(code.includes('operation-not-allowed')||message.toLowerCase().includes('operation-not-allowed'))return `${prefix}: تسجيل الدخول المجهول غير مفعّل في Firebase Authentication.`;
  if(code.includes('invalid-api-key')||message.toLowerCase().includes('api key'))return `${prefix}: apiKey غير صحيح أو لا يخص هذا المشروع.`;
  if(code.includes('not-found')||message.toLowerCase().includes('database')&&message.toLowerCase().includes('not found'))return `${prefix}: Database ID غير موجود. استخدم (default) للقاعدة الافتراضية.`;
  if(code.includes('unavailable')||message.toLowerCase().includes('network'))return `${prefix}: تعذر الاتصال بالإنترنت أو بخوادم Firestore.`;
  return `${prefix}: ${message||'خطأ غير معروف'}`;
}
function setDatabaseStatus(message,type='info'){
  const box=$('databaseStatus');if(!box)return;box.className=`status show ${type}`;box.textContent=message;
}
function clearDatabaseStatus(){const box=$('databaseStatus');if(box){box.className='status';box.textContent='';}}
function databaseDraftValue(){return {...databaseFormValue(),editingDatabaseId:editingDatabaseId||$('editingDatabaseId').value||'',savedAt:Date.now()};}
function persistDatabaseDraft(){try{rawSet(DATABASE_DRAFT_KEY,JSON.stringify(databaseDraftValue()));}catch(_){}}
function clearDatabaseDraft(){rawRemove(DATABASE_DRAFT_KEY);}
function fillDatabaseForm(value){
  const draft=value&&typeof value==='object'?value:{};const config=draft.config&&typeof draft.config==='object'?draft.config:draft;
  editingDatabaseId=String(draft.editingDatabaseId||draft.id||'');$('editingDatabaseId').value=editingDatabaseId;
  $('databaseName').value=String(draft.name||'');$('databaseEnabled').value=String(draft.enabled!==false);
  $('databaseApiKey').value=String(config.apiKey||'');$('databaseAuthDomain').value=String(config.authDomain||'');$('databaseProjectId').value=String(config.projectId||'');
  $('databaseStorageBucket').value=String(config.storageBucket||'');$('databaseMessagingSenderId').value=String(config.messagingSenderId||'');$('databaseAppId').value=String(config.appId||'');
  $('databaseMeasurementId').value=String(config.measurementId||'');$('databaseId').value=String(config.databaseId||'(default)')||'(default)';
  $('cancelDatabaseEdit').classList.toggle('hidden',!editingDatabaseId);
}
function restoreDatabaseDraft(){const draft=parse(rawGet(DATABASE_DRAFT_KEY),null);if(!draft)return false;fillDatabaseForm(draft);setDatabaseStatus('تمت استعادة آخر بيانات أدخلتها تلقائياً ولم يتم فقدها.','info');return true;}
function validateDatabaseFormValue(value){
  if(!value.name)throw new Error('اسم القاعدة داخل الأدمن مطلوب.');
  DB().validateConfig(value.config);return value;
}
function databaseFormValue(){
  return {id:editingDatabaseId||undefined,name:$('databaseName').value.trim(),enabled:$('databaseEnabled').value==='true',config:{apiKey:$('databaseApiKey').value.trim(),authDomain:$('databaseAuthDomain').value.trim(),projectId:$('databaseProjectId').value.trim(),storageBucket:$('databaseStorageBucket').value.trim(),messagingSenderId:$('databaseMessagingSenderId').value.trim(),appId:$('databaseAppId').value.trim(),measurementId:$('databaseMeasurementId').value.trim(),databaseId:$('databaseId').value.trim()||'(default)'}};
}
function resetDatabaseForm(prefill=false,clearDraft=true){
  editingDatabaseId='';$('editingDatabaseId').value='';$('databaseForm').reset();$('databaseId').value='(default)';$('databaseEnabled').value='true';$('cancelDatabaseEdit').classList.add('hidden');
  if(prefill){const config=window.CASHTOP_FIREBASE.masterConfig;fillDatabaseForm({name:'قاعدة الشركات الرئيسية',enabled:true,config});}
  if(clearDraft)clearDatabaseDraft();clearDatabaseStatus();
}
async function saveDatabase(event){
  event.preventDefault();if(databaseSaveInProgress)return;
  const button=event.submitter||$('saveDatabaseBtn')||$('databaseForm').querySelector('button[type=submit]');
  const snapshot=databaseFormValue(),wasEditing=Boolean(editingDatabaseId);
  persistDatabaseDraft();databaseSaveInProgress=true;button.disabled=true;setDatabaseStatus('جارٍ اختبار الاتصال بقاعدة الشركة...','info');
  try{
    validateDatabaseFormValue(snapshot);
    let connectionError=null;
    try{
      await DB().testDatabase(snapshot.config);
      setDatabaseStatus('نجح الاتصال. جارٍ حفظ تعريف القاعدة في الإدارة الرئيسية...','info');
    }catch(error){
      // نحفظ التعريف في القاعدة الرئيسية حتى لو كانت Auth/Rules في قاعدة الشركة غير مجهزة بعد.
      connectionError=error;setDatabaseStatus('تعذر اختبار قاعدة الشركة، لكن سيتم حفظ تعريفها لتتمكن من تعديلها لاحقاً.','warning');
    }
    const record=await DB().saveDatabase(snapshot);
    const confirmed=await DB().getDatabase(record.id);
    if(!confirmed)throw new Error('تم إرسال الحفظ لكن لم يمكن التحقق من وجود تعريف القاعدة في الإدارة الرئيسية.');
    await loadDatabasesAndStates();render();
    if(!databases.some(item=>item.id===record.id))throw new Error('لم تظهر القاعدة بعد إعادة تحميل القائمة. أعد المحاولة مع اتصال ثابت.');
    // نبقي القيم ظاهرة بعد النجاح أيضاً حتى يتأكد المستخدم مما تم حفظه. لا تُمسح إلا بزر «قاعدة جديدة».
    fillDatabaseForm({...confirmed,editingDatabaseId:record.id});persistDatabaseDraft();
    if(connectionError){
      const detail=friendlyFirebaseError(connectionError,'تم حفظ التعريف، لكن الاتصال بقاعدة الشركة فشل');
      setDatabaseStatus(`${detail} الحقول باقية ويمكنك التصحيح ثم الحفظ مجدداً.`,'warning');toast(detail,'warning');
    }else{
      setDatabaseStatus(wasEditing?'تم تحديث القاعدة والتحقق منها بنجاح.':'تمت إضافة القاعدة والتحقق منها بنجاح. الحقول باقية كما هي.','success');
      toast(wasEditing?'تم تحديث إعدادات القاعدة.':'تمت إضافة قاعدة Firestore الجديدة.');
    }
    if(!record.enabled)toast('القاعدة محفوظة لكنها موقوفة ولن تُستخدم لتسجيل الدخول.','warning');
  }catch(error){
    // لا نستخدم reset هنا إطلاقاً. تبقى القيم في الحقول وتُستعاد حتى بعد إعادة فتح الصفحة.
    fillDatabaseForm({...snapshot,editingDatabaseId:editingDatabaseId||snapshot.id||''});persistDatabaseDraft();
    setDatabaseStatus(friendlyFirebaseError(error,'تعذر إضافة القاعدة'),'error');
    toast(friendlyFirebaseError(error,'تعذر حفظ القاعدة'),'error');
  }finally{databaseSaveInProgress=false;button.disabled=false;}
}
function editDatabase(id){
  const database=databaseById(id);if(!database)return;fillDatabaseForm({...database,editingDatabaseId:id});persistDatabaseDraft();clearDatabaseStatus();scrollTo({top:0,behavior:'smooth'});
}
async function removeDatabase(id){
  const database=databaseById(id),count=Object.values(databaseStates.get(id)?.companies||{}).filter(company=>company&&!company.deleted&&company.status!=='deleted').length;
  if(!database)return;if(count)return toast('لا يمكن حذف قاعدة تحتوي على شركات. انقل أو احذف الشركات أولاً.','error');
  if(!confirm(`حذف تعريف قاعدة ${database.name} من الأدمن الرئيسي؟ لن يتم حذف مشروع Firebase نفسه.`))return;
  try{await DB().deleteDatabase(id);await loadDatabasesAndStates();render();toast('تم حذف تعريف القاعدة من الأدمن.','warning');}catch(error){toast(`تعذر حذف القاعدة: ${error.message||error}`,'error');}
}
function planNote(){const plan=$('plan').value;$('planDetails').innerHTML=plan==='plus'?'<b>Plus:</b> تطبق حدود الخطة المحددة على الشركة.':'<b>Pro:</b> جميع الحدود غير محدودة.';}
function calcExpiry(start=new Date()){const unit=$('durationUnit').value,quantity=Math.max(1,Number($('durationQuantity').value||1));if(unit==='unlimited')return '';const date=new Date(start);if(unit==='minute')date.setMinutes(date.getMinutes()+quantity);if(unit==='hour')date.setHours(date.getHours()+quantity);if(unit==='day')date.setDate(date.getDate()+quantity);if(unit==='month')date.setMonth(date.getMonth()+quantity);if(unit==='year')date.setFullYear(date.getFullYear()+quantity);return date.toISOString();}
function updateExpiryPreview(){const unit=$('durationUnit').value;$('durationQuantity').disabled=unit==='unlimited';$('expiryPreview').textContent=calcExpiry()?'تم تحديد مدة الاشتراك.':'مدة الاشتراك غير محدودة.';}
function generateKey(){return `CT-${Math.random().toString(36).slice(2,6).toUpperCase()}-${Date.now().toString(36).slice(-5).toUpperCase()}`;}
function payload(value){return {value:JSON.stringify(value),valueEncoding:'local-storage-json-v1',deleted:false,updatedAt:Date.now(),revision:1,deviceId:'admin-console',page:'admin.html'};}
function companyAccess(company){const tenantId=String(company.tenantId||company.companyId);return {tenantId,companyId:tenantId,companyKey:company.key,companyName:company.companyName,status:company.status,plan:company.plan,startAt:company.startAt,endAt:company.endAt,durationUnit:company.durationUnit,durationQuantity:company.durationQuantity,backupImportEnabled:company.backupImportEnabled===true,authVersion:company.authVersion,updatedAt:Date.now(),manager:{id:`ADMIN_${tenantId}`,username:company.managerUsername,password:company.managerPassword,displayName:'مدير الشركة',role:'admin',active:company.status==='active',permissions:{},authVersion:company.authVersion}};}
function cacheCompanyLocally(company){
  const tenantId=String(company.tenantId||company.companyId),key=normalizeKey(company.key);
  let licenses=parse(rawGet('cashtop_admin_licenses'),[]);if(!Array.isArray(licenses))licenses=[];licenses=licenses.filter(item=>normalizeKey(item.key)!==key||String(item.tenantId||item.companyId||item.id)===tenantId);const license={id:tenantId,key,tenantId,companyId:tenantId,companyName:company.companyName,status:company.status,plan:company.plan,startAt:company.startAt,endAt:company.endAt,durationUnit:company.durationUnit,durationQuantity:company.durationQuantity,backupImportEnabled:company.backupImportEnabled===true};const licenseIndex=licenses.findIndex(item=>String(item.tenantId||item.companyId||item.id)===tenantId);if(licenseIndex>=0)licenses[licenseIndex]=license;else licenses.push(license);rawSet('cashtop_admin_licenses',JSON.stringify(licenses));
  let users=parse(rawGet('cashtop_admin_users'),[]);if(!Array.isArray(users))users=[];users=users.filter(item=>normalizeKey(item.companyKey)!==key||String(item.tenantId||item.companyId||'')===tenantId);const user={id:`ADMIN_${tenantId}`,companyKey:key,tenantId,companyId:tenantId,username:company.managerUsername,password:company.managerPassword,displayName:'مدير الشركة',role:'admin',active:company.status==='active'};const userIndex=users.findIndex(item=>String(item.tenantId||item.companyId||'')===tenantId&&item.role==='admin');if(userIndex>=0)users[userIndex]=user;else users.push(user);rawSet('cashtop_admin_users',JSON.stringify(users));
}
function findCompanyByRef(ref){const [databaseId,tenantId]=String(ref||'').split('::');const state=databaseStates.get(databaseId);return {databaseId,tenantId,state,company:state?.companies?.[tenantId]||null,database:databaseById(databaseId)};}
async function persistCompany(database,state,company,oldKey=''){
  state.updatedAt=Date.now();await DB().writeAdminState(database.config,state);await DB().writeCompanyAccess(database.config,company,payload(companyAccess(company)));await DB().saveRoute({key:company.key,databaseId:database.id,databaseName:database.name,projectId:database.config.projectId,tenantId:company.tenantId,companyId:company.tenantId,status:company.status});
  if(oldKey&&normalizeKey(oldKey)!==normalizeKey(company.key)){await DB().deleteRoute(oldKey).catch(()=>null);await DB().deleteChildKey(database.config,oldKey).catch(()=>null);}
  cacheCompanyLocally(company);
}
async function saveCompany(event){
  event.preventDefault();const databaseId=$('targetDatabaseId').value,database=databaseById(databaseId);if(!database)return toast('اختر قاعدة بيانات الشركة.','error');if(database.enabled===false)return toast('قاعدة البيانات المختارة موقوفة.','error');
  const key=normalizeKey($('companyKey').value);if(!key)return toast('أدخل مفتاح الشركة.','error');
  const editing=editingCompanyRef?findCompanyByRef(editingCompanyRef):null;if(editing&&editing.databaseId!==databaseId)return toast('لا يمكن نقل الشركة بين القواعد أثناء التعديل. أنشئ شركة جديدة أو استعد نسخة في القاعدة المطلوبة.','error');
  const duplicate=allCompanies().find(company=>normalizeKey(company.key)===key&&`${company.databaseId}::${company.tenantId}`!==editingCompanyRef);if(duplicate)return toast(`المفتاح مستخدم في قاعدة ${duplicate.databaseName}.`,'error');
  const state=databaseStates.get(databaseId)||emptyChildState();const existing=editing?.company||null;const oldKey=existing?.key||'';const now=new Date();const tenantId=String(existing?.tenantId||existing?.companyId||`TENANT_${Date.now()}_${crypto.randomUUID?crypto.randomUUID().slice(0,8):Math.random().toString(36).slice(2,10)}`);
  const company={tenantId,companyId:tenantId,companyName:$('companyName').value.trim(),key,managerUsername:$('managerUsername').value.trim(),managerPassword:$('managerPassword').value||existing?.managerPassword||'',plan:$('plan').value,status:$('status').value,backupImportEnabled:$('backupImportEnabled').value==='true',durationUnit:$('durationUnit').value,durationQuantity:$('durationUnit').value==='unlimited'?null:Math.max(1,Number($('durationQuantity').value||1)),startAt:existing?.startAt||now.toISOString(),endAt:calcExpiry(existing?.startAt?new Date(existing.startAt):now),authVersion:Date.now(),createdAt:existing?.createdAt||now.toISOString(),updatedAt:now.toISOString(),databaseId};
  if(!company.companyName||!company.managerUsername||!company.managerPassword)return toast('أكمل اسم الشركة وبيانات المدير.','error');
  if(oldKey&&normalizeKey(oldKey)!==key){delete state.keyIndex[safe(oldKey)];state.retiredKeys[safe(oldKey)]={tenantId,companyId:tenantId,key:normalizeKey(oldKey),deletedAt:Date.now()};}
  state.companies[tenantId]=company;state.keyIndex[safe(key)]={tenantId,companyId:tenantId,key,databaseId};
  const button=event.submitter||$('companyForm').querySelector('button[type=submit]');button.disabled=true;
  try{await persistCompany(database,state,company,oldKey);databaseStates.set(databaseId,state);resetCompanyForm();render();toast('تم حفظ الشركة وربط المفتاح بقاعدة البيانات المختارة.');}catch(error){toast(`تعذر حفظ الشركة: ${error.message||error}`,'error');}finally{button.disabled=false;}
}
function resetCompanyForm(){editingCompanyRef='';$('editingKey').value='';$('formTitle').textContent='إنشاء شركة ومفتاح جديد';$('companyForm').reset();$('companyKey').value=generateKey();$('durationUnit').value='month';$('durationQuantity').value=1;$('plan').value='plus';$('status').value='active';$('backupImportEnabled').value='false';$('targetDatabaseId').disabled=false;if(databases.filter(item=>item.enabled!==false).length===1)$('targetDatabaseId').value=databases.find(item=>item.enabled!==false).id;$('cancelEdit').classList.add('hidden');planNote();updateExpiryPreview();}
function editCompany(ref){const found=findCompanyByRef(ref),company=found.company;if(!company)return;editingCompanyRef=ref;$('editingKey').value=company.key;$('formTitle').textContent=`تعديل ${company.companyName}`;$('targetDatabaseId').value=found.databaseId;$('targetDatabaseId').disabled=true;$('companyName').value=company.companyName;$('companyKey').value=company.key;$('managerUsername').value=company.managerUsername;$('managerPassword').value=company.managerPassword;$('plan').value=company.plan;$('status').value=company.status;$('backupImportEnabled').value=String(company.backupImportEnabled===true);$('durationUnit').value=company.durationUnit||'unlimited';$('durationQuantity').value=company.durationQuantity||1;$('cancelEdit').classList.remove('hidden');planNote();updateExpiryPreview();scrollTo({top:0,behavior:'smooth'});}
async function toggleCompany(ref){
  const found=findCompanyByRef(ref),company=found.company;if(!company||!found.database)return;company.status=company.status==='active'?'stopped':'active';company.authVersion=Date.now();company.updatedAt=new Date().toISOString();found.state.keyIndex[safe(company.key)]={tenantId:company.tenantId,companyId:company.tenantId,key:company.key,databaseId:found.databaseId};
  try{await persistCompany(found.database,found.state,company);render();toast(company.status==='active'?'تم تفعيل المفتاح.':'تم إيقاف المفتاح وستُغلق الجلسات المفتوحة.','warning');}catch(error){toast(`تعذر تحديث المفتاح: ${error.message||error}`,'error');}
}
async function deleteCompany(ref){
  const found=findCompanyByRef(ref),company=found.company;if(!company||!found.database||!confirm(`حذف شركة ${company.companyName} وتعطيل مفتاحها؟`))return;
  company.status='deleted';company.deleted=true;company.authVersion=Date.now();company.updatedAt=new Date().toISOString();delete found.state.keyIndex[safe(company.key)];found.state.retiredKeys[safe(company.key)]={tenantId:company.tenantId,companyId:company.tenantId,key:company.key,deletedAt:Date.now()};
  try{await DB().writeAdminState(found.database.config,found.state);await DB().writeCompanyAccess(found.database.config,company,payload(companyAccess(company)));await DB().deleteRoute(company.key);await DB().deleteChildKey(found.database.config,company.key);render();toast('تم تعطيل الشركة وحذف توجيه المفتاح من القاعدة الرئيسية.','warning');}catch(error){toast(`تعذر حذف الشركة: ${error.message||error}`,'error');}
}
async function copyKey(key){try{await navigator.clipboard.writeText(key);}catch(_){const input=document.createElement('input');input.value=key;document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();}toast('تم نسخ المفتاح.');}
function formatBytes(bytes){const n=Number(bytes||0);if(n<1024)return `${n} B`;if(n<1024**2)return `${(n/1024).toFixed(2)} KB`;if(n<1024**3)return `${(n/1024**2).toFixed(2)} MB`;return `${(n/1024**3).toFixed(2)} GB`;}
function setRestoreProgress(percent,label=''){const value=Math.max(0,Math.min(100,Math.round(percent)));$('restoreProgress').classList.add('show');$('restoreProgressBar').style.width=`${value}%`;$('restoreProgressLabel').textContent=`${value}%${label?` — ${label}`:''}`;}
async function prepareFullBackup(){
  const button=$('prepareBackupBtn');button.disabled=true;$('downloadBackupBtn').disabled=true;setRestoreProgress(1,'قراءة القواعد');
  try{
    const data={format:'CASH_TOP_MULTI_DATABASE_BACKUP',version:1,createdAt:new Date().toISOString(),rootAdmin:clone(rootAdmin),databases:clone(databases),databaseStates:{},companies:{}};
    let total=databases.reduce((sum,database)=>sum+Object.values(databaseStates.get(database.id)?.companies||{}).filter(company=>company&&!company.deleted&&company.status!=='deleted').length,0)+databases.length,done=0;
    for(const database of databases){data.databaseStates[database.id]=clone(databaseStates.get(database.id)||emptyChildState());data.companies[database.id]={};for(const company of Object.values(databaseStates.get(database.id)?.companies||{})){if(!company||company.deleted||company.status==='deleted')continue;data.companies[database.id][company.tenantId]=await DB().readCompanyNode(database.config,company.tenantId);done++;setRestoreProgress((done/Math.max(1,total))*100,`استخراج ${company.companyName}`);}done++;}
    const text=JSON.stringify(data);preparedBackup={text,bytes:new Blob([text]).size};$('backupSize').textContent=formatBytes(preparedBackup.bytes);$('downloadBackupBtn').disabled=false;setRestoreProgress(100,'النسخة جاهزة');toast('تم تجهيز نسخة تشمل تعريفات القواعد وجميع الشركات.');
  }catch(error){toast(`تعذر تجهيز النسخة: ${error.message||error}`,'error');}finally{button.disabled=false;}
}
function downloadPreparedBackup(){if(!preparedBackup)return toast('قم باستخراج البيانات أولاً.','warning');const blob=new Blob([preparedBackup.text],{type:'application/json;charset=utf-8'}),anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);anchor.download=`CashTop_MultiDB_Backup_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(anchor);anchor.click();setTimeout(()=>{URL.revokeObjectURL(anchor.href);anchor.remove();},500);}
async function restoreFullBackup(){
  const file=$('restoreBackupFile').files?.[0];if(!file)return toast('اختر ملف النسخة الاحتياطية أولاً.','warning');if(!confirm('سيتم استعادة تعريفات القواعد وبيانات الشركات إلى مشاريع Firestore المحددة داخل الملف. هل تريد المتابعة؟'))return;
  const button=$('restoreBackupBtn');button.disabled=true;setRestoreProgress(1,'قراءة الملف');
  try{
    const data=JSON.parse(await file.text());if(data?.format!=='CASH_TOP_MULTI_DATABASE_BACKUP'||!Array.isArray(data.databases))throw new Error('ملف النسخة ليس من نوع النسخ متعدد القواعد.');
    await DB().saveRootAdmin(normalizeRoot(data.rootAdmin));let done=0;const total=data.databases.length+Object.values(data.companies||{}).reduce((sum,map)=>sum+Object.keys(map||{}).length,0);
    for(const database of data.databases){const saved=await DB().saveDatabase(database);const state=normalizeChildState(data.databaseStates?.[saved.id]);await DB().writeAdminState(saved.config,state);for(const company of Object.values(state.companies||{})){if(company?.key&&company.status!=='deleted'&&!company.deleted)await DB().saveRoute({key:company.key,databaseId:saved.id,databaseName:saved.name,projectId:saved.config.projectId,tenantId:company.tenantId});}for(const [tenantId,node] of Object.entries(data.companies?.[saved.id]||{})){await DB().writeCompanyNode(saved.config,tenantId,node);done++;setRestoreProgress((done/Math.max(1,total))*100,`استعادة شركة ${done}`);}done++;setRestoreProgress((done/Math.max(1,total))*100,`استعادة قاعدة ${saved.name}`);}
    rootAdmin=normalizeRoot(data.rootAdmin);await loadDatabasesAndStates();render();setRestoreProgress(100,'اكتملت الاستعادة');toast('تمت استعادة القواعد والشركات بنجاح.');
  }catch(error){toast(`فشل الاستيراد: ${error.message||error}`,'error');}finally{button.disabled=false;}
}
async function changeAdminPassword(event){
  event.preventDefault();const form=$('changeAdminPasswordForm'),button=event.submitter||form.querySelector('button[type=submit]');const current=$('currentAdminPassword').value,next=$('newAdminPassword').value,confirmation=$('confirmNewAdminPassword').value;button.disabled=true;
  try{if(next!==confirmation)throw new Error('تأكيد كلمة المرور الجديدة غير مطابق.');if(next.length<6)throw new Error('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.');const expected=await hashPassword(current,rootAdmin.superAdmin.salt);if(expected!==rootAdmin.superAdmin.passwordHash)throw new Error('كلمة المرور الحالية غير صحيحة.');const salt=makeSalt();const nextRoot={...rootAdmin,superAdmin:{...rootAdmin.superAdmin,passwordHash:await hashPassword(next,salt),salt,authVersion:Date.now(),updatedAt:new Date().toISOString()}};await saveRoot(nextRoot);form.reset();$('adminSettingsModal').classList.remove('show');toast('تم تغيير كلمة مرور المشرف العام.');}catch(error){requestAnimationFrame(()=>{$('currentAdminPassword').value=current;$('newAdminPassword').value=next;$('confirmNewAdminPassword').value=confirmation;});toast(friendlyFirebaseError(error,'تعذر تغيير كلمة المرور'),'error');}finally{button.disabled=false;}
}
function fmt(value){return value?new Date(value).toLocaleString('ar-EG'):'غير محدود';}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function fillDatabaseOptions(){const selected=$('targetDatabaseId').value;$('targetDatabaseId').innerHTML='<option value="">اختر قاعدة البيانات</option>'+databases.filter(item=>item.enabled!==false).map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} — ${escapeHtml(item.config.projectId)}</option>`).join('');if(databases.some(item=>item.id===selected&&item.enabled!==false))$('targetDatabaseId').value=selected;}
function renderDatabases(){
  const counts={};allCompanies().forEach(company=>counts[company.databaseId]=(counts[company.databaseId]||0)+1);
  $('databasesBody').innerHTML=databases.length?databases.map(database=>{const error=databaseErrors.get(database.id),state=error?`<span class="database-state off" title="${escapeHtml(error)}">تعذر الاتصال</span>`:database.enabled===false?'<span class="database-state off">موقوفة</span>':'<span class="database-state ok">مفعلة</span>';return `<tr><td data-label="الاسم"><b>${escapeHtml(database.name)}</b></td><td data-label="Project ID"><code>${escapeHtml(database.config.projectId)}</code></td><td data-label="Database ID"><code>${escapeHtml(database.config.databaseId||'(default)')}</code></td><td data-label="الحالة">${state}</td><td data-label="عدد المفاتيح">${counts[database.id]||0}</td><td data-label="الإجراءات"><div class="actions"><button class="btn btn-light" type="button" onclick="AdminPage.editDatabase('${encodeURIComponent(database.id)}')"><i class="fa-solid fa-pen"></i></button><button class="btn btn-danger" type="button" onclick="AdminPage.removeDatabase('${encodeURIComponent(database.id)}')"><i class="fa-solid fa-trash"></i></button></div></td></tr>`;}).join(''):'<tr><td colspan="6" style="padding:25px;color:#64748b">لا توجد قواعد شركات بعد. أضف أول قاعدة من الحقول أعلاه.</td></tr>';
}
function renderCompanies(){
  const list=allCompanies();$('statAll').textContent=list.length;$('statActive').textContent=list.filter(company=>company.status==='active'&&(!company.endAt||new Date(company.endAt)>new Date())).length;$('statPlus').textContent=list.filter(company=>company.plan==='plus').length;$('statPro').textContent=list.filter(company=>company.plan==='pro').length;
  $('companiesBody').innerHTML=list.length?list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(company=>{const expired=company.endAt&&Date.now()>=new Date(company.endAt).getTime(),statusClass=expired?'expired':company.status==='active'?'active':'stopped',statusText=expired?'منتهي':company.status==='active'?'نشط':'موقوف',lock=company.backupImportEnabled===true?'<span class="badge active"><i class="fa-solid fa-lock-open"></i> مفتوح</span>':'<span class="badge stopped"><i class="fa-solid fa-lock"></i> مقفل</span>',ref=encodeURIComponent(`${company.databaseId}::${company.tenantId}`);return `<tr><td data-label="الشركة"><b>${escapeHtml(company.companyName)}</b></td><td data-label="قاعدة البيانات"><b>${escapeHtml(company.databaseName)}</b><br><small>${escapeHtml(company.databaseProjectId)}</small></td><td data-label="المفتاح"><div class="key-cell"><code>${escapeHtml(company.key)}</code><button class="btn btn-light" type="button" title="نسخ المفتاح" onclick="AdminPage.copy(decodeURIComponent('${encodeURIComponent(company.key)}'))"><i class="fa-solid fa-copy"></i></button></div></td><td data-label="الخطة"><span class="badge ${company.plan}">${company.plan==='plus'?'Plus':'Pro'}</span></td><td data-label="الحالة"><span class="badge ${statusClass}">${statusText}</span></td><td data-label="المدير">${escapeHtml(company.managerUsername)}</td><td data-label="استيراد النسخ">${lock}</td><td data-label="البدء">${fmt(company.startAt)}</td><td data-label="الانتهاء">${fmt(company.endAt)}</td><td data-label="الإجراءات"><div class="actions"><button class="btn btn-light" onclick="AdminPage.editCompany(decodeURIComponent('${ref}'))"><i class="fa-solid fa-pen"></i></button><button class="btn ${company.status==='active'?'btn-warning':'btn-success'}" onclick="AdminPage.toggleCompany(decodeURIComponent('${ref}'))"><i class="fa-solid fa-power-off"></i></button><button class="btn btn-danger" onclick="AdminPage.removeCompany(decodeURIComponent('${ref}'))"><i class="fa-solid fa-trash"></i></button></div></td></tr>`;}).join(''):'<tr><td colspan="10" style="padding:25px;color:#64748b">لا توجد شركات بعد.</td></tr>';
}
function render(){fillDatabaseOptions();renderDatabases();renderCompanies();$('syncMode').textContent=`قاعدة رئيسية + ${databases.length} قواعد شركات`;}

window.AdminPage={editDatabase:id=>editDatabase(decodeURIComponent(id)),removeDatabase:id=>removeDatabase(decodeURIComponent(id)),editCompany,toggleCompany,removeCompany:deleteCompany,copy:copyKey};
window.addEventListener('DOMContentLoaded',async()=>{
  try{rootAdmin=normalizeRoot(await DB().getRootAdmin()||parse(rawGet(LOCAL_ROOT_KEY),null));await loadDatabasesAndStates();rawSet(LOCAL_ROOT_KEY,JSON.stringify(rootAdmin));}catch(error){console.error(error);rootAdmin=normalizeRoot(parse(rawGet(LOCAL_ROOT_KEY),null));toast(`تعذر تحميل قاعدة الإدارة الرئيسية: ${error.message||error}`,'error');}
  setupAuthView();const cachedUsername=rawGet(AUTH_USERNAME_DRAFT_KEY);if(cachedUsername&&!$('superUsername').value)$('superUsername').value=cachedUsername;if(sessionValid())showApp();
  $('authForm').addEventListener('submit',handleAuth);$('superUsername').addEventListener('input',()=>rawSet(AUTH_USERNAME_DRAFT_KEY,$('superUsername').value));
  $('databaseForm').addEventListener('submit',saveDatabase);['input','change'].forEach(type=>$('databaseForm').addEventListener(type,persistDatabaseDraft));$('cancelDatabaseEdit').addEventListener('click',()=>resetDatabaseForm(false,true));
  $('companyForm').addEventListener('submit',saveCompany);$('generateKey').addEventListener('click',()=>{$('companyKey').value=generateKey();});$('plan').addEventListener('change',planNote);$('durationUnit').addEventListener('change',updateExpiryPreview);$('durationQuantity').addEventListener('input',updateExpiryPreview);$('cancelEdit').addEventListener('click',resetCompanyForm);$('logoutBtn').addEventListener('click',()=>{localStorage.removeItem(SESSION_KEY);location.reload();});$('adminSettingsBtn').addEventListener('click',()=>$('adminSettingsModal').classList.add('show'));$('closeAdminSettings').addEventListener('click',()=>$('adminSettingsModal').classList.remove('show'));$('adminSettingsModal').addEventListener('click',event=>{if(event.target===$('adminSettingsModal'))$('adminSettingsModal').classList.remove('show');});$('changeAdminPasswordForm').addEventListener('submit',changeAdminPassword);$('prepareBackupBtn').addEventListener('click',prepareFullBackup);$('downloadBackupBtn').addEventListener('click',downloadPreparedBackup);$('restoreBackupBtn').addEventListener('click',restoreFullBackup);
  resetDatabaseForm(false,false);restoreDatabaseDraft();resetCompanyForm();render();
});
})();
