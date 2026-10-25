import {mkdir,lstat,readFile,open,rename} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

/** Private local outbox on the SAME OpenClaw host as the existing sales browser/session. */
export function receiptResultJournal(directory) {
  if(typeof directory!=='string'||!isAbsolute(directory))throw Error('RECEIPT_JOURNAL_ABSOLUTE_DIRECTORY_REQUIRED');
  const path=(id,lease)=>join(directory,createHash('sha256').update(id+'\0'+lease).digest('hex')+'.json');
  return {
    async store(body) {
      if(typeof body.crm_receipt_id!=='string'||!body.crm_receipt_id||typeof body.lease_token!=='string'||!body.lease_token)throw Error('INVALID_RECEIPT_RESULT');
      await mkdir(directory,{recursive:true,mode:0o700});
      const info=await lstat(directory);
      if(!info.isDirectory()||(info.mode&0o077)!==0)throw Error('RECEIPT_JOURNAL_MUST_BE_PRIVATE');
      const temporary=join(directory,'.'+randomUUID()+'.tmp');
      const file=await open(temporary,'wx',0o600);
      try {await file.writeFile(JSON.stringify(body));await file.sync();} finally {await file.close();}
      await rename(temporary,path(body.crm_receipt_id,body.lease_token));
      // Persist the rename across host crashes, not just process restarts.
      const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
    },
    async load(id,lease) {return JSON.parse(await readFile(path(id,lease),'utf8'));},
  };
}

/** Reuse the existing SAPO_SYNC_TOKEN, never copy it into workflow JSON, a URL or a log. */
export function receiptCrmClient({baseUrl,token,journal,fetchImpl=fetch}) {
  const base=new URL(baseUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/api/staff')||typeof token!=='string'||token.length<32||!journal?.store||!journal?.load)
    throw Error('INVALID_RECEIPT_WORKER_CONFIG');
  const post=async(path,body)=>{
    let response;
    try {
      response=await fetchImpl(base.href.replace(/\/$/,'')+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30_000),
        headers:{'content-type':'application/json',accept:'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});
    } catch {throw Error('CRM_TRANSPORT_ERROR');}
    if(!response.ok)throw Error(`CRM_HTTP_${response.status}`);
    try{return await response.json();}catch{throw Error('CRM_INVALID_JSON');}
  };
  return {
    claim:body=>post('/integrations/sapo/goods-receipt-jobs/claim',body),
    async callback(body) {
      // Deliberately retain the result after success; replay is a no-op at CRM.
      await journal.store(body);
      return post('/integrations/sapo/goods-receipt-result',body);
    },
    async replayResult(receiptId,leaseToken) {
      const body=await journal.load(receiptId,leaseToken);
      if(body.crm_receipt_id!==receiptId || body.idempotency_key!==receiptId || !body.lease_token || body.lease_token!==leaseToken)throw Error('INVALID_SAVED_RESULT');
      return post('/integrations/sapo/goods-receipt-result',body);
    },
  };
}
