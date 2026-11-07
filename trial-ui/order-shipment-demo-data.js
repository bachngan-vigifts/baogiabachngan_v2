// Synthetic data only. IDs cannot be used to open or update real CRM documents.
export const demoToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
export const addDemoDays=(iso,n)=>new Date(Date.parse(iso+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
export function makeShipmentDemo(today=demoToday()) {
 const orders=[
  {id:'demo-o1',no:'MẪU-001',customer:'Công ty Minh họa An Phú',owner:'Nhân viên mẫu A',stage:'Đang sản xuất',expected:addDemoDays(today,3)},
  {id:'demo-o2',no:'MẪU-002',customer:'Công ty Minh họa Bình An',owner:'Nhân viên mẫu B',stage:'Chờ triển khai',expected:addDemoDays(today,4)},
  {id:'demo-o3',no:'MẪU-003',customer:'Khách Minh họa Thành Công',owner:'Nhân viên mẫu A',stage:'Đã hoàn thành',expected:addDemoDays(today,-3)},
  {id:'demo-o4',no:'MẪU-004',customer:'Công ty Minh họa Đại Phát',owner:'Nhân viên mẫu B',stage:'Chờ xuất kho',expected:addDemoDays(today,-1)},
  {id:'demo-o5',no:'MẪU-005',customer:'Khách Minh họa Hưng Thịnh',owner:'Nhân viên mẫu A',stage:'Đang giao hàng',expected:today},
 ];
 const lines=[
  {id:'demo-l1',orderId:'demo-o1',sku:'MẪU-CHEN',name:'Bộ chén sứ quà tặng',spec:'Hộp 6 chén · in logo xanh',unit:'Bộ',qty:150,price:198000,tax:8},
  {id:'demo-l2',orderId:'demo-o1',sku:'MẪU-CHEN',name:'Bộ chén sứ quà tặng',spec:'Hộp 6 chén · in logo đỏ',unit:'Bộ',qty:40,price:205000,tax:8},
  {id:'demo-l3',orderId:'demo-o2',sku:'MẪU-LY',name:'Ly sứ có nắp',spec:'350 ml · đóng hộp riêng',unit:'Cái',qty:60,price:98000,tax:8},
  {id:'demo-l4',orderId:'demo-o3',sku:'MẪU-BINH',name:'Bình giữ nhiệt',spec:'500 ml · khắc tên',unit:'Cái',qty:50,price:265000,tax:10},
  {id:'demo-l5',orderId:'demo-o4',sku:'MẪU-NON',name:'Nón bảo hiểm',spec:'Màu xanh · in hai mặt',unit:'Cái',qty:80,price:185000,tax:8},
  {id:'demo-l6',orderId:'demo-o5',sku:'MẪU-DH',name:'Đồng hồ treo tường',spec:'30 cm · hộp quà',unit:'Cái',qty:30,price:325000,tax:8},
 ];
 const shipments=[
  {id:'demo-s1',orderId:'demo-o1',date:addDemoDays(today,-2),time:'09:00–11:00',status:'delivered',carrier:'Xe cửa hàng (mẫu)',address:'Địa chỉ minh họa 01',lines:[{lineId:'demo-l1',qty:100}]},
  {id:'demo-s2',orderId:'demo-o1',date:addDemoDays(today,3),time:'Chưa xác định giờ',status:'planned',carrier:'Xe cửa hàng (mẫu)',address:'Địa chỉ minh họa 01',lines:[{lineId:'demo-l1',qty:50},{lineId:'demo-l2',qty:40}]},
  {id:'demo-s3',orderId:'demo-o3',date:addDemoDays(today,-3),time:'14:00–16:00',status:'delivered',carrier:'Giao nội bộ (mẫu)',address:'Địa chỉ minh họa 03',lines:[{lineId:'demo-l4',qty:50}]},
  {id:'demo-s4',orderId:'demo-o4',date:addDemoDays(today,-1),time:'Chưa xác định giờ',status:'planned',carrier:'Giao nội bộ (mẫu)',address:'Địa chỉ minh họa 04',lines:[{lineId:'demo-l5',qty:80}]},
  {id:'demo-s5',orderId:'demo-o5',date:today,time:'09:00–11:00',status:'in_transit',carrier:'Xe cửa hàng (mẫu)',address:'Địa chỉ minh họa 05',lines:[{lineId:'demo-l6',qty:30}]},
 ];
 return {today,orders,lines,shipments};
}
export function lineFacts(data,line) {
 const trips=data.shipments.filter(s=>s.status!=='cancelled'&&s.lines.some(l=>l.lineId===line.id));
 const quantity=status=>trips.filter(s=>status?s.status===status:s.status!=='delivered').reduce((sum,s)=>sum+s.lines.filter(l=>l.lineId===line.id).reduce((n,l)=>n+l.qty,0),0);
 const delivered=quantity('delivered'),scheduled=quantity(null),pending=trips.filter(s=>s.status!=='delivered').sort((a,b)=>a.date.localeCompare(b.date));
 return {delivered,remaining:Math.max(0,line.qty-delivered),available:Math.max(0,line.qty-delivered-scheduled),trips,date:pending[0]?.date||'',overdue:pending.some(s=>s.date<data.today)};
}
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase();
export function demoProductRows(data,{q='',owner='',status='work'}={}) {
 return data.lines.map(line=>({...line,order:data.orders.find(o=>o.id===line.orderId),facts:lineFacts(data,line)})).filter(l=>!owner||l.order.owner===owner)
  .filter(l=>fold([l.name,l.sku,l.spec,l.order.no,l.order.customer].join(' ')).includes(fold(q.trim())))
  .filter(l=>status==='all'||status==='delivered'?status==='all'||l.facts.remaining===0:status==='partial'?l.facts.delivered>0&&l.facts.remaining>0:status==='overdue'?l.facts.overdue:status==='unscheduled'?l.facts.available>0:l.facts.remaining>0);
}
export function demoCalendarDays(anchor,view='month') {
 if(view==='day')return [anchor];
 if(view==='agenda')return Array.from({length:7},(_,i)=>addDemoDays(anchor,i));
 const month=anchor.slice(0,7),first=view==='month'?month+'-01':anchor;
 const weekday=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7,start=addDemoDays(first,-weekday);
 const last=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).getUTCDate();
 const length=view==='month'?Math.ceil((weekday+last)/7)*7:7;
 return Array.from({length},(_,i)=>addDemoDays(start,i));
}
export function shiftDemoCalendar(anchor,view,delta) {
 if(view!=='month')return addDemoDays(anchor,delta*(view==='day'?1:7));
 const d=new Date(anchor+'T12:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+delta);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);
}
export function addDemoShipment(data,lineId,{date,time='',qty}) {
 const line=data.lines.find(l=>l.id===lineId),n=Number(qty),parsed=new Date(date+'T12:00:00Z');
 if(!line||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||date<data.today)throw Error('Chọn ngày hợp lệ từ hôm nay.');
 if(!Number.isFinite(n)||n<=0||n>lineFacts(data,line).available)throw Error('Số lượng vượt phần chưa xếp lịch.');
 if(String(time).length>80)throw Error('Khung giờ tối đa 80 ký tự.');
 const shipment={id:'demo-extra-'+data.shipments.length,orderId:line.orderId,date,time:String(time).trim()||'Chưa xác định giờ',status:'planned',carrier:'Chưa chọn (mẫu)',address:'Địa chỉ minh họa',lines:[{lineId,qty:n}]};
 data.shipments.push(shipment);return shipment;
}
