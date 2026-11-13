// Every acknowledgement comes from durable server state; retries never advance a local-only counter.
export async function sendAccountingImport({request,job,rows,onProgress=()=>{},stopped=()=>false}) {
 const fresh=await request('/imports/'+job.id);
 if(fresh.fileHash!==job.fileHash||fresh.totalRows!==rows.length)throw Error('File không khớp lượt nhập đã lưu.');
 if(fresh.state==='completed')return fresh;
 if(fresh.state!=='uploading')throw Error('Lượt nhập đã bị hủy.');
 let current=fresh;
 const present=new Set(fresh.chunks.map(c=>c.chunkNo));
 for(let offset=0;offset<rows.length;offset+=500){
  if(stopped())break;
  const index=offset/500;
  if(present.has(index))continue;
  const payload={rows:rows.slice(offset,offset+500)};
  for(let attempt=0;;attempt++){
   try{current=await request('/imports/'+job.id+'/chunks/'+index,'POST',payload);break;}
   catch(error){if(stopped()||attempt>=1||[400,401,403,404,409,413,422].includes(error.status))throw error;}
  }
  onProgress(current);
 }
 return current;
}
