/** File import creates only a draft through the existing, permission-checked early-request API. */
import {resolveEarlyOrderSources} from './early-order-sources.js';
export const EARLY_FILE_HEADER = ['Mã hàng', 'Tên sản phẩm', 'Số lượng xin trước', 'Số đơn mua CRM (DMH)', 'Số đơn của NCC'];
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/\s+/g,' ').trim();
const crmHeaders=['so don mua crm (dmh)','so don mua crm','lay o so don hang nao','so don hang','so don mua'];
const supplierHeaders=['so don cua ncc','so don ncc','so don ncc (khong bat buoc)'];
export function parseEarlyRequestSheet(table, raw = table) {
  const errors=[], lines=[], seen=new Map();
  const header=table.findIndex(row=>row.some(v=>String(v??'').trim()));
  if(header<0)return {lines,errors:['File chưa có dữ liệu.']};
  const names=table[header].map(fold), columns={
    sku:names.findIndex(v=>['ma hang','sku'].includes(v)),
    name:names.findIndex(v=>['ten hang','ten san pham'].includes(v)),
    qty:names.findIndex(v=>['so luong xin truoc','sl xin truoc','so luong'].includes(v)),
    order:names.findIndex(v=>crmHeaders.includes(v)),
    supplierOrder:names.findIndex(v=>supplierHeaders.includes(v)),
  };
  if(columns.sku<0||columns.qty<0)return {lines,errors:['Thiếu cột Mã hàng hoặc Số lượng xin trước. Hãy dùng file mẫu.']};
  if(names.filter(v=>['ma hang','sku'].includes(v)).length!==1||names.filter(v=>['so luong xin truoc','sl xin truoc','so luong'].includes(v)).length!==1||names.filter(v=>crmHeaders.includes(v)).length>1||names.filter(v=>supplierHeaders.includes(v)).length>1)
    return {lines,errors:['Cột mã hàng, số lượng hoặc số đơn bị lặp.']};
  let count=0;
  for(let i=header+1;i<table.length;i++){
    const row=table[i];if(!row.some(v=>String(v??'').trim()))continue;
    if(++count>300){errors.push('Mỗi file tối đa 300 dòng hàng.');break;}
    const rawQuantity=raw[i]?.[columns.qty];
    const sku=String(row[columns.sku]??'').trim(), quantityText=String(typeof rawQuantity==='number'?rawQuantity:row[columns.qty]??'').trim(),quantity=Number(quantityText);
    const orderNo=String(row[columns.order]??'').trim(),supplierOrderNo=String(row[columns.supplierOrder]??'').trim();
    const pair=JSON.stringify([sku,orderNo?'crm:'+orderNo.toLocaleLowerCase('vi'):supplierOrderNo?'supplier:'+supplierOrderNo.toLocaleLowerCase('vi'):'auto']);
    const problems=[];
    if(orderNo.length>200||supplierOrderNo.length>200)problems.push('số đơn mua CRM / số đơn NCC tối đa 200 ký tự');
    if(!sku||sku.length>200)problems.push('mã hàng trống hoặc quá dài');
    if(!/^\d+$/.test(quantityText)||!Number.isSafeInteger(quantity)||quantity<=0)problems.push('số lượng phải là số nguyên dương, không dùng dấu phân cách');
    if(seen.has(pair))problems.push('mã hàng và đơn lấy hàng trùng dòng '+seen.get(pair));
    if(sku)seen.set(pair,i+1);
    if(problems.length)errors.push(`Dòng ${i+1}: ${problems.join('; ')}.`);
    else lines.push({row:i+1,sku,name:String(row[columns.name]??'').trim(),quantity,orderNo,supplierOrderNo});
  }
  if(!count)errors.push('Chưa có dòng hàng. Điền mã và số lượng vào file mẫu.');
  return {lines,errors};
}
export function earlyFileRequestLines(rows) {
  const groups=new Map();
  for(const row of rows){
    const line=groups.get(row.sku)||{sku:row.sku,quantity:0,sourceOrders:[]};
    line.quantity+=row.quantity;
    if(!Number.isSafeInteger(line.quantity))throw Error(row.sku+': tổng số lượng quá lớn.');
    line.sourceOrders.push({orderNo:row.orderNo,supplierOrderNo:row.supplierOrderNo||'',quantity:row.quantity});groups.set(row.sku,line);
  }
  return [...groups.values()];
}
export function readEarlyRequestWorkbook(X, workbook) {
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  if(!sheet?.['!ref'])throw Error('File chưa có bảng dữ liệu.');
  const range=X.utils.decode_range(sheet['!ref']);
  if(range.e.c>20||range.e.r>301)throw Error('File quá lớn: tối đa 300 dòng hàng và 21 cột.');
  for(let r=range.s.r;r<=range.e.r;r++)for(let c=range.s.c;c<=range.e.c;c++){
    const cell=sheet[X.utils.encode_cell({r,c})];
    if(cell?.f)throw Error(`Dòng ${r+1}: không dùng công thức Excel, hãy dán giá trị.`);
    if(cell?.t==='n'&&(!Number.isFinite(cell.v)||Math.abs(cell.v)>=1e15))throw Error(`Dòng ${r+1}: số quá dài; định dạng Mã hàng là Text để giữ đúng mã.`);
  }
  return parseEarlyRequestSheet(X.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:true}),X.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:true}));
}
export function earlyRequestTemplate(X) {
  const workbook=X.utils.book_new(), sheet=X.utils.aoa_to_sheet([EARLY_FILE_HEADER]);
  // Text cells prevent Excel from dropping leading zeroes when entering SKUs.
  for(let r=1;r<=300;r++)for(const c of [0,3,4])sheet[X.utils.encode_cell({r,c})]={t:'s',v:'',z:'@'};
  sheet['!ref']='A1:E301';sheet['!cols']=[{wch:24},{wch:50},{wch:24},{wch:30},{wch:30}];
  X.utils.book_append_sheet(workbook,sheet,'Xin hàng trước');
  X.utils.book_append_sheet(workbook,X.utils.aoa_to_sheet([
    ['Hướng dẫn'],['Điền tại sheet Xin hàng trước. Tối đa 300 dòng; cùng mã ở nhiều đơn được tách dòng, không lặp mã + số đơn.'],
    ['Mã hàng: giữ dạng Text để không mất số 0 đầu. Tên hàng chỉ để tham khảo.'],
    ['Số lượng xin trước: số nguyên dương, ví dụ 1000; không ghi 1.000 hoặc 1,000.'],
    ['Số đơn mua CRM (DMH): số Đơn mua NCC trên CRM, ví dụ DMH_20261016_059. Có thể để trống.'],
    ['Số đơn của NCC: số đơn do nhà cung cấp cấp. Nếu chỉ nhập số này, hệ thống tìm đơn mua CRM theo mã hàng và NCC đã chọn.'],
    ['Nếu số đơn NCC khớp nhiều đơn CRM, hãy chọn đúng NCC hoặc điền thêm Số đơn mua CRM (DMH). Nhập cả hai thì phải khớp cùng đơn.'],
    ['Để trống cả hai số đơn: hệ thống tự phân bổ trong các đơn đã duyệt còn hàng đang về; xem rõ đơn được chọn trước khi lưu.'],
    ['Chỉ xin hàng còn đang về từ đơn mua đã duyệt. Chọn NCC và ngày lấy trên màn hình.'],
    ['Chọn file để xem trước; lưu nháp, kiểm tra rồi bấm Gửi NCC tại phiếu. Không tự nhận hàng hay cộng kho.'],
  ]),'Hướng dẫn');
  return workbook;
}
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const button=(text,fn,cls='btn secondary')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;};
const label=(text,node)=>{const n=el('label');n.append(el('span','',text),node);return n;};
export function openEarlyRequestFile({api,loadXlsx,suppliers,today,go}) {
  const dialog=el('dialog','modal early-request-dialog early-file-dialog'),head=el('div','modal-head'),body=el('div','modal-body'),foot=el('div','modal-foot');
  let busy=false,parsed=null,resolvedLines=null,valid=false,saved=null,attempt=null,uncertain=false,sequence=0;
  const close=button('Đóng',()=>{if(!busy)dialog.close();});
  head.append(el('h2','','Xin hàng trước bằng file'),close);
  const supplier=el('select');supplier.setAttribute('aria-label','Nhà cung cấp của file');
  supplier.append(Object.assign(el('option','','Tất cả NCC — phân bổ theo đơn mua'),{value:''}));
  for(const s of suppliers)supplier.append(Object.assign(el('option','',s.name),{value:s.id}));
  const date=el('input');date.type='date';date.required=true;date.value=today;date.setAttribute('aria-label','Ngày xin lấy hàng');
  const file=el('input');file.type='file';file.accept='.xlsx,.xls,.csv';file.setAttribute('aria-label','File xin hàng trước');
  const template=button('⬇ Tải file mẫu',async()=>{
    if(busy)return;lock(true);error.textContent='';
    try{const X=await loadXlsx();X.writeFile(earlyRequestTemplate(X),'mau-xin-hang-truoc.xlsx');}catch(e){error.textContent=e.message;}finally{lock(false);}
  });
  const error=el('p','error');error.setAttribute('role','alert');
  const status=el('p','muted small');status.setAttribute('role','status');
  const preview=el('div','table-wrap');
  const save=button('Lưu phiếu nháp',async()=>{
    if(busy||saved||!valid||!date.value)return;
    const payload=uncertain?attempt.body:{lines:resolvedLines,pickupDate:date.value,scope:{supplierId:supplier.value,status:'all'}};
    const fingerprint=JSON.stringify(payload);
    if(attempt?.fingerprint!==fingerprint)attempt={fingerprint,key:crypto.randomUUID(),body:payload};
    lock(true);error.textContent='';
    try{
      const data=await api('/purchase-early-requests','POST',{...payload,clientKey:attempt.key});saved=data.request;uncertain=false;
      status.textContent='Đã lưu phiếu nháp. NCC chưa nhận được yêu cầu; mở phiếu để kiểm tra và Gửi NCC.';
      const link=el('a','btn primary','Mở phiếu / Gửi NCC');link.href='#/purchases?mode=incoming&request='+encodeURIComponent(saved.id);
      link.addEventListener('click',e=>{if(!e.ctrlKey&&!e.metaKey&&e.button===0){e.preventDefault();dialog.close();go(link.getAttribute('href'));}});foot.append(link);
    }catch(e){uncertain=!e.status||e.status>=500;error.textContent=(e.message||'Không lưu được phiếu.')+(uncertain?' Chưa rõ kết quả; bấm Thử lưu lại để kiểm tra đúng lần lưu này.':'');}
    finally{lock(false);}
  },'btn primary');
  function lock(on){busy=on;for(const n of [supplier,date,file,template])n.disabled=on||!!saved||uncertain;close.disabled=on;sync();dialog.setAttribute('aria-busy',String(on));}
  function sync(){save.disabled=busy||!!saved||!valid||!date.value;save.textContent=uncertain?'Thử lưu lại':'Lưu phiếu nháp';}
  async function validate(){
    const seq=++sequence;valid=false;resolvedLines=null;preview.replaceChildren();error.textContent='';sync();if(!parsed||parsed.errors.length){if(parsed)error.textContent=parsed.errors.join('\n');return;}
    lock(true);status.textContent='Đang đối chiếu hàng còn về…';
    try{
      const lookup=new Map();
      for(let i=0;i<parsed.lines.length;i+=50){
        const q=new URLSearchParams({type:'purchase',selected:'1',limit:'100',supplierId:supplier.value,status:'all'});
        for(const l of parsed.lines.slice(i,i+50))q.append('sku',l.sku);
        const data=await api('/purchase-incoming?'+q);
        if(!data.canRequest)throw Error('Chỉ Manager và Sale Admin được xin hàng trước.');
        for(const row of data.rows)lookup.set(row.sku,row);
      }
      if(seq!==sequence||!dialog.open)return;
      const resolutions=new Map(),sourceErrors=new Map(),indices=new Map();
      for(const line of earlyFileRequestLines(parsed.lines)){
        try{resolutions.set(line.sku,resolveEarlyOrderSources(lookup.get(line.sku)?.orders||[],line.sourceOrders));}
        catch(e){sourceErrors.set(line.sku,e.message);}
      }
      const table=el('table','data-table'),th=el('tr'),thead=el('thead'),tbody=el('tbody');
      for(const title of ['Dòng','Mã hàng','Tên sản phẩm','SL xin trước','Số đơn mua CRM đã chọn','Số đơn của NCC','Còn tại đơn','Kiểm tra'])th.append(el('th','',title));thead.append(th);table.append(thead,tbody);
      let problems=0;
      for(const line of parsed.lines){
        const source=lookup.get(line.sku),index=indices.get(line.sku)||0,group=resolutions.get(line.sku)?.groups[index];indices.set(line.sku,index+1);
        const available=group?.available||0,issue=sourceErrors.get(line.sku)||'';
        const selected=group?.allocations.map(a=>a.order.ticketNumber+' ('+a.quantity+')').join(', ')||line.orderNo||'—';
        if(issue)problems++;const row=el('tr');
        for(const value of [line.row,line.sku,source?.name||line.name,line.quantity,selected,line.supplierOrderNo||'—',available,issue||'Hợp lệ'])row.append(el('td',issue?'early-file-error':'',value));tbody.append(row);
      }
      resolvedLines=earlyFileRequestLines(parsed.lines).map(line=>({...line,sourceOrders:resolutions.get(line.sku)?.sources||[]}));
      if(resolvedLines.reduce((n,l)=>n+l.sourceOrders.length,0)>300)throw Error('Phân bổ vượt 300 nguồn đơn mua; tách thành file nhỏ hơn.');
      preview.append(table);valid=problems===0;status.textContent=`${parsed.lines.length} dòng · ${problems} dòng cần sửa. Chưa lưu hoặc gửi NCC.`;
    }catch(e){error.textContent=e.message||'Không đối chiếu được hàng đang về.';status.textContent='Chưa xác minh được dữ liệu. Chọn lại file hoặc NCC để thử lại.';}
    finally{if(seq===sequence)lock(false);}
  }
  file.addEventListener('change',async()=>{
    parsed=null;valid=false;preview.replaceChildren();error.textContent='';status.textContent='';sync();const selected=file.files?.[0];if(!selected)return;
    if(!/\.(xlsx|xls|csv)$/i.test(selected.name)||selected.size>2*1024*1024){error.textContent='Chọn file Excel/CSV tối đa 2 MB.';return;}
    lock(true);
    try{
      const X=await loadXlsx(), workbook=/\.csv$/i.test(selected.name)?X.read(await selected.text(),{type:'string',raw:true,sheetRows:303}):X.read(await selected.arrayBuffer(),{type:'array',sheetRows:303});
      parsed=readEarlyRequestWorkbook(X,workbook);
    }catch(e){error.textContent=e.message||'Không đọc được file.';}
    finally{lock(false);}
    if(parsed)await validate();
  });
  supplier.addEventListener('change',validate);date.addEventListener('input',sync);
  body.append(el('p','muted','Hai cột số đơn có thể để trống. Chỉ nhập Số đơn của NCC: hệ thống tìm Số đơn mua CRM (DMH). Trống cả hai: tự phân bổ theo mã hàng/NCC đã chọn. Bảng xem trước hiện rõ đơn thực lấy; số đơn trùng hoặc không đủ hàng sẽ báo lỗi. Lưu nháp không gửi NCC, không nhận hàng hoặc cộng kho.'),
    label('Nhà cung cấp',supplier),label('Ngày lấy *',date),template,label('File Excel / CSV (tối đa 2 MB)',file),status,error,preview);
  foot.append(save);dialog.append(head,body,foot);document.body.append(dialog);
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>{++sequence;dialog.remove();},{once:true});dialog.showModal();sync();
  return dialog;
}
