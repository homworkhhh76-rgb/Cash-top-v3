import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function adminApp(){
  if(getApps().length)return getApps()[0];
  const raw=String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'').trim();
  if(raw){
    const serviceAccount=JSON.parse(raw);
    return initializeApp({credential:cert(serviceAccount),projectId:process.env.FIREBASE_PROJECT_ID||serviceAccount.project_id});
  }
  return initializeApp({credential:applicationDefault(),projectId:process.env.FIREBASE_PROJECT_ID||'ahmed-97701'});
}

export async function collection(){
  return getFirestore(adminApp()).collection('pushSubscriptions');
}

export function cors(res){
  res.setHeader('Access-Control-Allow-Origin',process.env.PUSH_ALLOWED_ORIGIN||'*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
}
