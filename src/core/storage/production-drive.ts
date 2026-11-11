import {AppError} from '../errors.ts';
/** Server-only OAuth. No public permissions, arbitrary destinations or credential-bearing URLs. */
export interface ProductionDrive {
 reserveId():Promise<string>;
 ensureFolder(id:string,name:string,ref:string):Promise<void>;
 put(id:string,parent:string,name:string,bytes:Uint8Array,mime:string,sha256:string,md5:string):Promise<void>;
 read(id:string,proof:{parent:string;bytes:number;sha256:string;md5:string}):Promise<Response>;
}
const valid=(s:string)=>/^[A-Za-z0-9_-]{10,160}$/.test(s);
export function productionDrive(config:{clientId:string;clientSecret:string;refreshToken:string;folderId:string;fetch?:typeof fetch}):ProductionDrive {
 if(!valid(config.folderId))throw new Error('Invalid production Drive folder');
 const fetcher=config.fetch||fetch;let token='',until=0,inFlight:Promise<string>|null=null;
 async function access(){
  if(token&&Date.now()<until)return token;
  if(inFlight)return inFlight;
  const job=(async()=>{const r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new AppError(503,'Kết nối Google Drive hết hạn hoặc chưa hợp lệ. Liên hệ quản trị để kết nối lại.','DRIVE_AUTH');const d=await r.json();if(typeof d.access_token!=='string')throw new AppError(503,'Google Drive chưa trả phiên hợp lệ.');token=d.access_token;until=Date.now()+Math.max(0,Number(d.expires_in||300)-60)*1000;return token;})();inFlight=job;try{return await job;}finally{inFlight=null;}
 }
 async function send(path:string,init:RequestInit={},upload=false){try{const authorization='Bearer '+await access();const r=await fetcher('https://www.googleapis.com/'+(upload?'upload/drive/v3/':'drive/v3/')+path,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:authorization},redirect:'manual',signal:AbortSignal.timeout(45000)});if(r.status===401){token='';until=0;}return r;}catch(e){if(e instanceof AppError)throw e;throw fail();}}
 const fail=()=>new AppError(503,'Chưa xác minh được file trên Google Drive. Giữ file đã chọn và bấm thử lại; chưa đánh dấu đã lưu.','DRIVE_UNCERTAIN');
 async function privateFolder(id:string){
  let page='';for(let i=0;i<10;i++){const query=new URLSearchParams({supportsAllDrives:'true',fields:'permissions(type),nextPageToken',pageSize:'100',...(page?{pageToken:page}:{})});const r=await send('files/'+id+'/permissions?'+query);if(!r.ok)throw new AppError(503,'Chưa xác minh được quyền thư mục/file Drive. Quản trị cần kiểm tra quyền truy cập.');const d=await r.json();if(!Array.isArray(d.permissions))throw fail();if(d.permissions.some((p:{type:string})=>p.type==='anyone'))throw new AppError(403,'Thư mục/file Drive đang chia sẻ công khai. Chưa lưu hoặc tải file SX; quản trị cần chọn nơi lưu riêng.','DRIVE_PUBLIC');page=d.nextPageToken||'';if(!page)return;}throw fail();
 }
 async function metadata(id:string){if(!valid(id))throw fail();const r=await send('files/'+id+'?supportsAllDrives=true&fields=id,mimeType,parents,trashed,size,md5Checksum,appProperties');if(r.status===404)return null;if(!r.ok)throw fail();return r.json();}
 return{
  async reserveId(){const r=await send('files/generateIds?count=1&space=drive&type=files');if(!r.ok)throw fail();const d=await r.json(),id=d.ids?.[0];if(typeof id!=='string'||!valid(id))throw fail();return id;},
  async ensureFolder(id,name,ref){
   await privateFolder(config.folderId);let d=await metadata(id);if(!d){const r=await send('files?supportsAllDrives=true&fields=id',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,name:name.slice(0,180),mimeType:'application/vnd.google-apps.folder',parents:[config.folderId],appProperties:{crm_quote:ref}})});if(!r.ok&&r.status!==409)throw fail();d=await metadata(id);}
   if(!d||d.trashed||d.mimeType!=='application/vnd.google-apps.folder'||!d.parents?.includes(config.folderId)||d.appProperties?.crm_quote!==ref)throw fail();await privateFolder(id);
  },
  async put(id,parent,name,bytes,mime,sha256,md5){
   if(!valid(parent))throw fail();let d=await metadata(id);
   if(!d){const boundary='bn-production-'+crypto.randomUUID(),metadataJson=JSON.stringify({id,name,mimeType:mime,parents:[parent],appProperties:{crm_sha256:sha256}});
    const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,bytes as BlobPart,`\r\n--${boundary}--\r\n`],{type:'multipart/related; boundary='+boundary});
    const r=await send('files?uploadType=multipart&supportsAllDrives=true&fields=id',{method:'POST',headers:{'content-type':body.type},body},true);if(!r.ok&&r.status!==409)throw fail();d=await metadata(id);}
   if(!d||d.trashed||!d.parents?.includes(parent)||Number(d.size)!==bytes.length||d.md5Checksum!==md5||d.appProperties?.crm_sha256!==sha256)throw fail();await privateFolder(id);
  },
  async read(id,proof){if(!valid(id))throw fail();const d=await metadata(id);if(!d||d.trashed||!d.parents?.includes(proof.parent)||Number(d.size)!==proof.bytes||d.md5Checksum!==proof.md5||d.appProperties?.crm_sha256!==proof.sha256)throw fail();await privateFolder(id);const r=await send('files/'+id+'?alt=media&supportsAllDrives=true');if(!r.ok)throw fail();return r;},
 };
}
