export function hasCustomerListFilters($) {
  return ['mine','pending','retail'].some(key=>$('#customer-'+key).checked) || ['owner','from','to'].some(key=>$('#customer-'+key).value);
}
/** Customer list controls share the existing server pagination and mobile filter sheet. */
export function customerListQuery($, {limit, offset, query}) {
  const params = new URLSearchParams({limit:String(limit),offset:String(offset),q:query,filters:'1'});
  for (const key of ['owner','from','to','sort']) { const value = $('#customer-'+key).value; if(value) params.set(key,value); }
  if($('#customer-mine').checked)params.set('mine','1');
  if($('#customer-pending').checked)params.set('status','pending');
  if($('#customer-retail').checked)params.set('kind','retail');
  return params.toString();
}
export function fillCustomerOwners(select, owners) {
  if(!owners)return;
  const value = select.value;
  const rows = [{id:'',name:'Tất cả người phụ trách'},{id:'unassigned',name:'Chưa có người phụ trách'},...owners];
  // Keep the selected owner when a refresh removes their last assignment.
  if(value && !rows.some(row=>row.id===value))rows.push({id:value,name:select.selectedOptions[0]?.textContent || value});
  select.replaceChildren(...rows.map(row=>Object.assign(document.createElement('option'),{value:row.id,textContent:row.name})));
  select.value=value;
}
export function bindCustomerListFilters($, reload) {
  for(const key of ['owner','from','to','sort'])$('#customer-'+key).addEventListener('change',reload);
  $('#customer-clear').addEventListener('click',()=>{
    for(const key of ['owner','from','to'])$('#customer-'+key).value='';
    $('#customer-sort').value='newest';
    for(const key of ['mine','pending','retail'])$('#customer-'+key).checked=false;
    reload();
  });
}
