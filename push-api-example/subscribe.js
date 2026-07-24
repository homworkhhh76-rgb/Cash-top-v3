import { createHash } from 'node:crypto';
import {collection,cors} from './push-store.js';
export default async function handler(req,res){
  cors(res);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  try{
    const sub=req.body?.subscription;
    if(!sub?.endpoint)return res.status(400).json({error:'INVALID_SUBSCRIPTION'});
    const id=createHash('sha256').update(String(sub.endpoint)).digest('hex');
    const col=await collection();
    await col.doc(id).set({subscription:sub,endpoint:sub.endpoint,scope:req.body?.scope||'',userAgent:req.body?.userAgent||'',companyId:req.body?.companyId||'',role:req.body?.role||'',userId:req.body?.userId||'',updatedAt:new Date()},{merge:true});
    return res.status(200).json({ok:true});
  }catch(e){return res.status(500).json({error:e.message||'SUBSCRIBE_FAILED'})}
}
