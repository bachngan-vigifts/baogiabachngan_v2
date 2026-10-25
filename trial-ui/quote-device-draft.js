/** Local device drafts only. Never submits, approves or creates a server document. */
export function createDeviceDraftStore({storage=()=>localStorage,now=()=>Date.now(),maxBytes=2*1024*1024,ttl=7*864e5}={}){
 const prefix='bn-quote-device-draft:',key=(user,id)=>prefix+JSON.stringify([user,id||'new']);
 return {
  save(user,id,revision,data){if(!user)return false;try{const value=JSON.stringify({user,id:id||'',revision,data,savedAt:now()});if(new TextEncoder().encode(value).length>maxBytes)return false;storage().setItem(key(user,id),value);return true;}catch{return false;}},
  read(user,id,revision){if(!user)return null;try{const value=JSON.parse(storage().getItem(key(user,id))||'null');return value?.user===user&&value.id===(id||'')&&value.revision===revision&&value.data&&typeof value.data==='object'&&now()-value.savedAt>=0&&now()-value.savedAt<=ttl?value:null;}catch{return null;}},
  clear(user,id){try{storage().removeItem(key(user,id));}catch{}},
  clearUser(user){try{const s=storage();for(let i=s.length-1;i>=0;i--){const k=s.key(i);if(k?.startsWith(prefix)){try{if(JSON.parse(s.getItem(k)).user===user)s.removeItem(k);}catch{}}}}catch{}},
 };
}
export function bindQuoteDeviceDraft({form,user,id,revision,dirty,readData,restore,store=createDeviceDraftStore()}){
 const banner=document.createElement('div');banner.className='quote-device-draft';banner.hidden=true;banner.setAttribute('role','status');form.prepend(banner);
 let timer=0,offered='';
 const identity=()=>JSON.stringify([user(),id(),revision()]);
 const message=text=>{banner.replaceChildren(document.createTextNode(text));banner.hidden=false;};
 return {
  schedule(){clearTimeout(timer);if(!dirty()||!user())return;const expected=identity();timer=setTimeout(()=>{if(identity()!==expected||!dirty())return;const saved=store.save(user(),id(),revision(),readData());message(saved?'Đã lưu tạm trên thiết bị · chưa gửi CRM':'Chưa lưu tạm được trên thiết bị. Hãy bấm Lưu báo giá.');},700);},
  offer(){const current=identity();if(current===offered)return;offered=current;banner.hidden=true;const value=store.read(user(),id(),revision());if(!value)return;
   message('Có bản nháp trên thiết bị chưa gửi CRM. ');
   const yes=document.createElement('button');yes.type='button';yes.className='btn secondary small';yes.textContent='Khôi phục nháp';yes.onclick=()=>{if(identity()!==current)return;restore(value.data);message('Đã khôi phục nháp thiết bị · bấm Lưu báo giá để gửi CRM.');};
   const no=document.createElement('button');no.type='button';no.className='btn ghost small';no.textContent='Bỏ bản nháp';no.onclick=()=>{store.clear(user(),id());banner.hidden=true;};banner.append(yes,no);
  },
  saved(oldId){clearTimeout(timer);store.clear(user(),oldId);store.clear(user(),id());banner.hidden=true;offered='';},
  logout(){clearTimeout(timer);store.clearUser(user());banner.hidden=true;offered='';},
 };
}
