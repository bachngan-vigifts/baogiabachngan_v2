/** Contact labels include phone/title; saved values respect the activity API's 160-character limit. */
export function customerContactChoices(data) {
  const customer=data.customer||{},byIdentity=new Map();
  const directory=data.contacts||[];
  for(const contact of [...directory.filter(c=>c.isPrimary),{name:customer.contact,phone:customer.phone},...directory.filter(c=>!c.isPrimary)]){
    const name=String(contact.name||'').trim(),phone=String(contact.phone||'').trim(),title=String(contact.title||'').trim();
    if(!name)continue;
    const key=JSON.stringify([name.toLocaleLowerCase('vi'),phone]);
    const value=[name,phone].filter(Boolean).join(' – ');
    const choice={name,value:value.length<=160?value:name,label:[name,phone,title].filter(Boolean).join(' – ')};
    if(!byIdentity.has(key)||title)byIdentity.set(key,choice);
  }
  return [...byIdentity.values()];
}
export function bindCareContactPicker({select,input,status,retry,api,getCustomerId,isConnected=()=>true,doc=document,matchUniqueName=false}) {
  let generation=0,loading=false,choices=[];
  const manual='__manual__';
  function options(rows){select.replaceChildren(...rows.map(([value,label])=>{const o=doc.createElement('option');o.value=value;o.textContent=label;return o;}));}
  function sync(){
    const typed=select.value===manual;
    input.hidden=!typed;input.required=typed;
    if(!typed)input.value=choices[Number(select.value)]?.value||'';
  }
  function clear(){generation++;loading=false;choices=[];select.disabled=true;select.required=true;options([['','Chọn khách hàng trước']]);input.value='';input.hidden=true;input.required=false;status.textContent='Chọn khách hàng để tải người liên hệ.';retry.hidden=true;}
  async function load(id,preserve=''){
    if(!id){clear();return;}
    const request=++generation;loading=true;choices=[];select.disabled=true;options([['','Đang tải người liên hệ…']]);input.value=preserve;input.hidden=true;input.required=false;retry.hidden=true;status.textContent='Đang tải danh bạ của khách hàng…';
    const current=()=>request===generation&&getCustomerId()===id&&isConnected();
    try{
      const data=await api('/customers/'+encodeURIComponent(id)+'/overview');if(!current())return;
      choices=customerContactChoices(data);options([...choices.map((c,i)=>[String(i),c.label]),[manual,'Nhập người liên hệ khác…']]);
      select.disabled=false;loading=false;
      let previous=choices.findIndex(c=>c.value===preserve);
      if(previous<0&&matchUniqueName&&preserve){const names=choices.map((c,i)=>({c,i})).filter(({c})=>c.name.normalize('NFC').toLocaleLowerCase('vi')===preserve.trim().normalize('NFC').toLocaleLowerCase('vi'));if(names.length===1)previous=names[0].i;}
      select.value=preserve?(previous>=0?String(previous):manual):choices.length?'0':manual;
      sync();
      status.textContent=choices.length?`Có ${choices.length} người liên hệ. Chọn người cần ghi giao dịch.`:'Khách chưa có người liên hệ. Anh/chị có thể nhập tên và số điện thoại.';
    }catch{
      if(!current())return;
      loading=false;select.disabled=false;options([[manual,'Nhập người liên hệ khác…']]);select.value=manual;sync();retry.hidden=false;
      status.textContent='Chưa tải được danh bạ. Anh/chị có thể tải lại hoặc nhập người liên hệ bằng tay.';
    }
  }
  select.addEventListener('change',sync);
  retry.addEventListener('click',()=>load(getCustomerId(),input.value));
  clear();return {load,clear,isLoading:()=>loading};
}
