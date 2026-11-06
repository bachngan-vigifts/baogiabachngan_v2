const statusOf = $ => $('#customer-pending').checked ? 'pending' : $('#customer-status').value;
const kindOf = $ => $('#customer-retail').checked ? 'retail' : $('#customer-kind').value;
export function hasCustomerListFilters($) {
  return $('#customer-mine').checked || !!statusOf($) || !!kindOf($) || ['owner','from','to','province'].some(key=>$('#customer-'+key)?.value);
}
/** Customer list controls share the server pagination and permission scope. */
export function customerListQuery($, {limit, offset, query}) {
  const params = new URLSearchParams({limit:String(limit),offset:String(offset),q:query,filters:'1'});
  for (const key of ['owner','from','to','sort','province']) { const value = $('#customer-'+key)?.value; if(value) params.set(key,value); }
  if($('#customer-mine').checked)params.set('mine','1');
  if(statusOf($))params.set('status',statusOf($));
  if(kindOf($))params.set('kind',kindOf($));
  return params.toString();
}
export function customerListFilterError($) {
  const from=$('#customer-from').value,to=$('#customer-to').value;
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  if((from&&!valid(from))||(to&&!valid(to)))return 'Ngày tạo không hợp lệ. Bộ lọc chưa được áp dụng.';
  return from&&to&&from>to?'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc. Bộ lọc chưa được áp dụng.':'';
}
export function updateCustomerFilterSummary($) {
  const error=customerListFilterError($),notice=$('#customer-filter-error');
  notice.textContent=error;notice.hidden=!error;
  for(const key of ['from','to'])$('#customer-'+key).setAttribute('aria-invalid',String(!!error));
  if(error)return false;
  const filters=[],label=key=>$('#customer-'+key).selectedOptions[0]?.textContent||$('#customer-'+key).value;
  if($('#customer-mine').checked)filters.push('Khách của tôi');
  if(statusOf($))filters.push({pending:'Chờ duyệt',rejected:'Bị từ chối'}[statusOf($)]||'Đã duyệt');
  if(kindOf($))filters.push(kindOf($)==='retail'?'Khách lẻ':'Khách doanh nghiệp');
  if($('#customer-province')?.value)filters.push('Tỉnh/thành: '+label('province'));
  if($('#customer-owner').value)filters.push('Phụ trách: '+label('owner'));
  const date=value=>value.split('-').reverse().join('/');
  if($('#customer-from').value)filters.push('Tạo từ '+date($('#customer-from').value));
  if($('#customer-to').value)filters.push('đến '+date($('#customer-to').value));
  const summary=$('#customer-filter-summary');summary.textContent=filters.length?'Đang lọc: '+filters.join(' · '):'';summary.hidden=!filters.length;
  $('#customer-clear').disabled=!hasCustomerListFilters($)&&$('#customer-sort').value==='newest';
  return true;
}
export function fillCustomerOwners(select, owners) {
  if(!owners)return;
  const value = select.value;
  const rows = [{id:'',name:'Tất cả người phụ trách'},{id:'unassigned',name:'Chưa có người phụ trách'},...owners];
  if(value && !rows.some(row=>row.id===value))rows.push({id:value,name:select.selectedOptions[0]?.textContent || value});
  select.replaceChildren(...rows.map(row=>Object.assign(document.createElement('option'),{value:row.id,textContent:row.name})));
  select.value=value;
}
export function bindCustomerListFilters($, reload) {
  let queued=false;
  const apply=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;if(updateCustomerFilterSummary($))reload();});};
  for(const key of ['owner','from','to','sort','mine','province'])$('#customer-'+key)?.addEventListener('change',apply);
  for(const [select,check,value] of [['status','pending','pending'],['kind','retail','retail']]){
    $('#customer-'+select).addEventListener('change',()=>{$('#customer-'+check).checked=$('#customer-'+select).value===value;apply();});
    $('#customer-'+check).addEventListener('change',()=>{$('#customer-'+select).value=$('#customer-'+check).checked?value:'';apply();});
  }
  $('#customer-clear').addEventListener('click',()=>{
    for(const key of ['owner','from','to','status','kind','province']){const n=$('#customer-'+key);if(n)n.value='';}
    $('#customer-sort').value='newest';
    for(const key of ['mine','pending','retail'])$('#customer-'+key).checked=false;
    apply();
  });
  updateCustomerFilterSummary($);
}

export function fillCustomerProvinces(select,provinces){
 if(!select||!provinces)return;const value=select.value;
 select.replaceChildren(...[{code:'',name:'Tất cả tỉnh/thành'},{code:'unknown',name:'Chưa xác định'},...provinces].map(p=>Object.assign(document.createElement('option'),{value:p.code,textContent:p.name})));select.value=value;
}
