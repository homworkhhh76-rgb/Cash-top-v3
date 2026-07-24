import webpush from 'web-push';
import {collection,cors} from './push-store.js';
export default async function handler(req,res){
  cors(res);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  const auth=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!process.env.PUSH_ADMIN_SECRET||auth!==process.env.PUSH_ADMIN_SECRET)return res.status(401).json({error:'UNAUTHORIZED'});
  try{
    webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
    let query=await collection();
    if(req.body?.companyId)query=query.where('companyId','==',String(req.body.companyId));
    if(req.body?.role)query=query.where('role','==',String(req.body.role));
    const snap=await query.get();
    const payload=JSON.stringify({title:req.body?.title||'Cash Top',body:req.body?.body||'',icon:req.body?.icon||'app-icon.png',badge:req.body?.badge||req.body?.icon||'app-icon.png',image:req.body?.image||'',url:req.body?.url||'index.html'});
    let sent=0,removed=0;
    for(const doc of snap.docs){
      const row=doc.data()||{};
      try{await webpush.sendNotification(row.subscription,payload);sent++}
      catch(e){if(e.statusCode===404||e.statusCode===410){await doc.ref.delete();removed++}}
    }
    return res.status(200).json({ok:true,sent,removed});
  }catch(e){return res.status(500).json({error:e.message||'SEND_FAILED'})}
}
