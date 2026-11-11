/** Presentation only: quantities, permissions and dates come from the existing APIs. */
export const FULFILMENT_STATES = {
  planned:'Chưa giao', in_transit:'Đang giao', partial:'Giao một phần',
  unscheduled:'Chưa xếp đủ lịch', overdue:'Quá hạn', delivered:'Đã giao', failed:'Giao lỗi', cancelled:'Đã huỷ',
};
export const deliveryToday = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'});
export const deliveryIsOverdue = (trip,today=deliveryToday()) => trip.plannedDate<today && ['planned','in_transit','failed'].includes(trip.status);
export const deliveryTone = trip => deliveryIsOverdue(trip)?'overdue':trip.status;
export function orderProductState(row) {
  if(row.orderStatus==='cancelled')return 'cancelled';
  if(row.remainingQty<=1e-9)return 'delivered';
  if(row.overdue)return 'overdue';
  if(row.deliveredQty>1e-9)return 'partial';
  if(row.trips?.some(t=>t.status==='in_transit'))return 'in_transit';
  if(row.availableQty>1e-9)return 'unscheduled';
  return 'planned';
}
export function fulfilmentLegend(keys) {
  const list=document.createElement('ul');list.className='ff-legend';list.setAttribute('aria-label','Chú giải màu trạng thái');
  for(const key of keys){const li=document.createElement('li');li.className='ff-'+key;li.textContent=FULFILMENT_STATES[key];list.append(li);}
  return list;
}
export function fulfilmentBadge(key,label=FULFILMENT_STATES[key]) {
  const n=document.createElement('span');n.className='ff-badge ff-'+key;n.textContent=label;return n;
}
/** Keep the full text in the DOM/title; ellipsis only affects the visible table. */
export function compactFulfilmentTable(table) {
  table.classList.add('ff-table');
  for(const cell of table.querySelectorAll('tbody td')) {
    if(cell.colSpan>1)continue;
    const content=document.createElement('div');content.className='ff-cell';
    content.append(...cell.childNodes);cell.append(content);
    for(const br of content.querySelectorAll('br'))br.replaceWith(document.createTextNode(' · '));
    cell.title=[...content.childNodes].map(n=>n.textContent.trim()).filter(Boolean).join(' · ');
  }
}
