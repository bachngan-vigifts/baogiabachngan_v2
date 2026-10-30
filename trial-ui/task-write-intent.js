// Manual task creation only. This stores retry identity, never sends in the background.
const memory=new Map(),active=new Map();
const fingerprint=value=>JSON.stringify(value);
export function createTaskWriteIntent({owner,scope,storage=()=>globalThis.sessionStorage}){
 const slot=()=>{const id=owner();if(!id)throw Error('Đăng nhập lại trước khi giao việc.');return 'bn-task-intent:'+encodeURIComponent(id)+':'+scope;};
 const read=key=>{if(memory.has(key))return memory.get(key);try{const value=JSON.parse(storage()?.getItem(key)||'null');if(value?.version===1&&typeof value.key==='string'&&value.content&&typeof value.content==='object'){memory.set(key,value);return value;}}catch{}return null;};
 const write=(key,value)=>{memory.set(key,value);try{if(value)storage()?.setItem(key,JSON.stringify(value));else storage()?.removeItem(key);}catch{/* Keep the same identity in this page if storage is unavailable. */}};
 return {
  pending(){return read(slot());},
  /**
   * Người dùng chủ động bỏ lần giao việc chưa rõ kết quả (vd. gửi lại bị từ chối vì mất quyền): chỉ xoá mã trên máy này,
   * KHÔNG huỷ việc nếu máy chủ đã tạo – giao diện phải nhắc kiểm tra danh sách việc. Không bỏ được khi đang gửi.
   */
  discard(){const key=slot();if(active.has(key))return false;write(key,null);return true;},
  async send(content,send){
   const key=slot(),copy=JSON.parse(JSON.stringify(content)),old=read(key);
   if(old&&fingerprint(old.content)!==fingerprint(copy))throw Error('Lần giao việc trước chưa rõ kết quả. Gửi lại đúng nội dung trước khi tạo việc khác.');
   if(active.has(key))return active.get(key);
   const intent=old||{version:1,key:crypto.randomUUID(),content:copy};write(key,intent);
   const request=Promise.resolve().then(()=>send(intent.key,intent.content)).then(result=>{write(key,null);return result;}).catch(error=>{
    // These validations precede task insertion. Unknown/409/401/403 outcomes keep the intent.
    if(!old&&[400,422].includes(error.status))write(key,null);
    throw error;
   }).finally(()=>{active.delete(key);});
   active.set(key,request);return request;
  },
 };
}
