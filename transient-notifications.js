(()=>{'use strict';
const DB=()=>window.CASHTOP_FIREBASE||{};
const APP_ICON='app-icon.png';
const seenKey=scope=>`ct_transient_notif_seen_v55::${scope}`;
const pendingKey='ct_transient_notif_pending_v55';
const managerRoles=new Set(['admin','owner','superadmin','manager','branch-admin','branch_manager']);
const now=()=>Date.now();
const sanitize=v=>String(v||'').trim().replace(/[.#$\[\]\/]/g,'_');
function session(){try{return window.Cashtop?.getSession?.()||JSON.parse(localStorage.getItem('cashtop_session')||'{}')||{}}catch(_){return{}}}
function companyId(){const s=session();return sanitize(s.tenantId||s.companyId||s.licenseId||s.companyKey||'')}
function isManager(){return managerRoles.has(String(session()?.role||'').toLowerCase())}
function notificationEnabled(){try{const a=JSON.parse(localStorage.getItem('cashtop_settings')||'{}'),b=JSON.parse(localStorage.getItem('cashtop_notification_settings')||'{}');return a.notificationsEnabled===true||b.enabled===true}catch(_){return false}}
function companyIcon(){try{const s=JSON.parse(localStorage.getItem('cashtop_settings')||'{}');return String(s.logo||'').trim()||APP_ICON}catch(_){return APP_ICON}}
function baseUrl(){return String(DB()?.config?.databaseURL||'').replace(/\/+$/,'')}
function endpoint(path){const base=baseUrl();if(!base)throw new Error('قاعدة المزامنة غير مضبوطة');return `${base}/${path}.json`}
async function db(path,method='GET',body){const options={method,cache:'no-store',headers:{'Content-Type':'application/json'}};if(body!==undefined)options.body=JSON.stringify(body);const r=await fetch(endpoint(path),options);if(!r.ok)throw new Error(`تعذر مزامنة الإشعار (${r.status})`);if(method==='DELETE')return true;return r.json().catch(()=>null)}
function roots(){const c=DB();return{company:String(c.rootPath||'cashTopExchange/cashTopPOS').replace(/^\/+|\/+$/g,''),admin:String(c.adminRootPath||'cashTopExchange/cashTopAdmin').replace(/^\/+|\/+$/g,'')}}
function companyPath(id=companyId()){return `${roots().company}/${sanitize(id)}/transientNotifications`}
function globalPath(){return `${roots().admin}/transientNotifications`}
function loadSeen(scope){try{return new Set(JSON.parse(localStorage.getItem(seenKey(scope))||'[]').map(String))}catch(_){return new Set()}}
function markSeen(scope,id){const set=loadSeen(scope);set.add(String(id));localStorage.setItem(seenKey(scope),JSON.stringify([...set].slice(-120)))}
function loadPending(){try{const v=JSON.parse(localStorage.getItem(pendingKey)||'[]');return Array.isArray(v)?v:[]}catch(_){return[]}}
function savePending(v){localStorage.setItem(pendingKey,JSON.stringify((v||[]).slice(-50)))}
function normalizeRows(raw){if(!raw)return[];if(Array.isArray(raw))return raw.filter(Boolean);if(typeof raw==='object')return Object.entries(raw).map(([id,v])=>v&&typeof v==='object'?{id,...v}:null).filter(Boolean);return[]}
async function show(payload,scope){if(!('Notification'in window)||Notification.permission!=='granted')return false;const localCompany=scope==='company';if(localCompany&&(!isManager()||!notificationEnabled()))return false;const icon=companyIcon()||payload.icon||APP_ICON;const final={...payload,icon:icon||APP_ICON,badge:icon||APP_ICON,url:payload.url||'notifications.html',data:{...(payload.data||{}),url:payload.url||payload.data?.url||'notifications.html'}};try{if(window.Cashtop?.showSystemNotification&&localCompany)return await window.Cashtop.showSystemNotification(final.title||'كاش توب',final);const reg=await navigator.serviceWorker?.ready;if(reg?.active){reg.active.postMessage({type:'SHOW_NOTIFICATION',payload:final});return true}if(reg?.showNotification){await reg.showNotification(final.title||'كاش توب',final);return true}new Notification(final.title||'كاش توب',final);return true}catch(_){return false}}
async function remove(path,id){try{await db(`${path}/${sanitize(id)}`,'DELETE')}catch(_){}}
async function publish(path,payload,scope){const id=payload.id||`NTF_${now()}_${Math.random().toString(36).slice(2,8)}`;const event={...payload,id,scope,createdAt:now(),expiresAt:now()+45000};await db(`${path}/${sanitize(id)}`,'PUT',event);setTimeout(()=>remove(path,id),18000);return event}
async function queueOrPublish(kind,payload){const path=kind==='global'?globalPath():companyPath(payload.companyId||companyId());try{return await publish(path,payload,kind)}catch(error){const q=loadPending();q.push({kind,payload:{...payload,queuedAt:now()}});savePending(q);throw error}}
async function flushPending(){if(navigator.onLine===false)return;const q=loadPending();if(!q.length)return;const rest=[];for(const item of q){try{const p={...item.payload};delete p.queuedAt;await publish(item.kind==='global'?globalPath():companyPath(p.companyId||companyId()),p,item.kind)}catch(_){rest.push(item)}}savePending(rest)}
async function consume(path,scope){let raw;try{raw=await db(path)}catch(_){return}const rows=normalizeRows(raw).sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));const seen=loadSeen(scope);for(const event of rows){const id=String(event.id||'');if(!id)continue;const age=now()-Number(event.createdAt||0);if(age>50000||Number(event.expiresAt||0)<now()){remove(path,id);continue}if(seen.has(id))continue;if(scope==='company'&&event.target&&event.target!=='managers')continue;const ok=await show(event,scope);if(ok){markSeen(scope,id);seen.add(id)}if(age>18000)remove(path,id)}}
async function poll(){await flushPending().catch(()=>null);await consume(globalPath(),'global').catch(()=>null);const cid=companyId();if(cid&&isManager()&&notificationEnabled())await consume(companyPath(cid),'company').catch(()=>null)}
async function sendCompany(payload={}){const cid=payload.companyId||companyId();if(!cid)throw new Error('لا توجد شركة نشطة لإرسال الإشعار');return queueOrPublish('company',{...payload,companyId:cid,target:'managers',icon:payload.icon||companyIcon(),badge:payload.badge||companyIcon()})}
async function sendGlobal(payload={}){return queueOrPublish('global',{...payload,target:'all',icon:payload.icon||APP_ICON,badge:payload.badge||payload.icon||APP_ICON})}
function notifyInvoice(invoice={}){const c=window.CashtopMulti?.getCurrencyConfig?.()||{base:{symbol:'₪',code:'ILS'}};const symbol=invoice.currencySymbol||c.base?.symbol||c.base?.code||'₪';const customer=invoice.customerName||invoice.customer||'عميل نقدي';const who=invoice.employeeName||invoice.createdByName||invoice.createdBy||invoice.cashierName||invoice.user||'مستخدم النظام';return sendCompany({type:'invoice',title:`فاتورة جديدة - ${customer}`,body:`المبلغ الإجمالي: ${Number(invoice.total||0).toFixed(2)} ${symbol} — بواسطة: ${who}`,tag:`invoice-${invoice.id||now()}`,url:'invoices.html',data:{type:'invoice',invoiceId:invoice.id||''}})}
window.CashtopTransientNotifications={sendCompany,sendGlobal,notifyInvoice,poll,flushPending,companyIcon};
function installPermissionGesture(){if(!('Notification'in window)||Notification.permission!=='default')return;const ask=async()=>{document.removeEventListener('pointerdown',ask,true);document.removeEventListener('keydown',ask,true);try{const permission=await Notification.requestPermission();if(permission==='granted'){try{await window.CashtopPush?.ensureSubscription?.()}catch(_){}setTimeout(poll,50)}}catch(_){}};document.addEventListener('pointerdown',ask,{capture:true,once:true});document.addEventListener('keydown',ask,{capture:true,once:true})}
installPermissionGesture();
window.addEventListener('online',()=>flushPending().then(poll).catch(()=>null));
window.addEventListener('load',()=>{setTimeout(poll,700);setInterval(()=>{if(document.visibilityState==='visible')poll()},2500);setInterval(()=>{if(document.visibilityState!=='visible')poll()},15000)},{once:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});
})();