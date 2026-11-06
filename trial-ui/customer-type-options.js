/** Editable native list: existing names are suggestions, new names save with the customer. */
export function bindCustomerTypeOptions({input,api}) {
  const list=document.createElement('datalist');list.id='customer-type-options';
  const hint=document.createElement('small');hint.className='muted';hint.id='customer-type-hint';hint.setAttribute('role','status');
  input.setAttribute('list',list.id);input.setAttribute('aria-describedby',hint.id);
  input.placeholder='Chọn nhóm đã có hoặc nhập nhóm mới';
  input.parentElement.append(list,hint);
  const normal='Chọn nhóm đã có hoặc nhập nhóm mới. Nhóm mới được lưu cùng khách hàng.';
  hint.textContent=normal;
  let request=0;
  return {async refresh(){
    const current=++request;list.replaceChildren();hint.textContent='Đang tải nhóm khách hàng…';
    try{
      const {types}=await api('/customers/types');if(current!==request)return;
      const options=types.map(name=>{const option=document.createElement('option');option.value=name;return option;});
      list.replaceChildren(...options);hint.textContent=normal;
    }catch{
      if(current===request)hint.textContent='Chưa tải được danh sách nhóm. Anh vẫn có thể nhập tên nhóm và lưu khách hàng.';
    }
  }};
}
