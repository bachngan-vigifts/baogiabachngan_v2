/** Explicit directory selection, never a name-based or cross-session association. */
export function createCatalogueCustomerLink({api,getState,identity,onChange}){
 let version=0,timer;
 const node=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
 function mount(input){
  const current=++version;clearTimeout(timer);if(!input)return;
  const area=node('div');area.className='catalogue-customer-link';const status=node('p'),results=node('div');status.className='hint';status.setAttribute('role','status');results.className='catalogue-customer-results';results.setAttribute('aria-label','Khách hàng tìm được');input.after(area);area.append(status,results);
  input.autocomplete='off';input.setAttribute('aria-describedby','catalogue-customer-status');status.id='catalogue-customer-status';
  const label=()=>{status.textContent=getState().meta.customerId?'Đã chọn hồ sơ khách hàng. Sửa tên để chọn lại khách khác.':'Gõ ít nhất 2 ký tự rồi chọn đúng khách từ danh bạ để lưu báo giá.';};label();
  let request=0;
  input.addEventListener('input',()=>{
   getState().meta.customerId='';++request;results.replaceChildren();label();clearTimeout(timer);
   const q=input.value.trim();if(q.length<2)return;
   const id=request,token=identity();timer=setTimeout(async()=>{
    status.textContent='Đang tìm khách hàng…';
    try{const d=await api('api/customers?q='+encodeURIComponent(q));if(current!==version||id!==request||token!==identity()||!input.isConnected)return;
     results.replaceChildren();for(const customer of d.customers){const b=node('button');b.type='button';b.className='btn catalogue-customer-choice';b.append(node('strong',customer.name),node('small',[customer.phone,customer.taxCode].filter(Boolean).join(' · ')));b.addEventListener('click',()=>{if(token!==identity())return;getState().meta.customerId=customer.id;getState().meta.customer=customer.name;input.value=customer.name;results.replaceChildren();label();onChange();});results.append(b);}
     status.textContent=d.customers.length?'Chọn đúng hồ sơ bên dưới.':'Không có khách đã duyệt trong phạm vi phụ trách/chia sẻ. Kiểm tra lại hoặc tạo khách tại CRM.';
    }catch(e){if(current===version&&id===request&&token===identity()&&input.isConnected)status.textContent=e.message;}
   },300);
  });
 }
 async function select(id){const token=identity(),d=await api('api/customers?id='+encodeURIComponent(id));if(token!==identity())throw Error('Tài khoản đã thay đổi, chưa chọn khách.');getState().meta.customerId=d.customer.id;getState().meta.customer=d.customer.name;onChange();return d.customer;}
 return{mount,select};
}
