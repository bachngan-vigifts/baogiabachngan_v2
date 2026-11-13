// Device-local backup of the source file only. No credentials/session tokens are stored.
let ready;
function db(){return ready ||= new Promise((resolve,reject)=>{
 const req=indexedDB.open('crm-accounting-import-files',1);
 req.onupgradeneeded=()=>req.result.createObjectStore('files');
 req.onblocked=()=>{ready=null;reject(Error('Bộ nhớ file đang bị khóa bởi tab khác. Đóng tab đó rồi thử lại.'));};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>{ready=null;reject(Error('Không mở được bộ nhớ file trên thiết bị.'));};
});}
async function transaction(mode,action){const base=await db();return new Promise((resolve,reject)=>{
 const tx=base.transaction('files',mode),req=action(tx.objectStore('files'));let value;
 req.onsuccess=()=>value=req.result;
 tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(Error('Không lưu được bản sao file trên thiết bị. Kiểm tra dung lượng/chế độ riêng tư.'));
});}
export const importFileCache={get:key=>transaction('readonly',s=>s.get(key)),set:(key,value)=>transaction('readwrite',s=>s.put(value,key)),remove:key=>transaction('readwrite',s=>s.delete(key))};
