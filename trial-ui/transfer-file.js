export const TRANSFER_HEADERS=['Kho đi','Kho đến','Mã hàng','Số lượng'];
const fold=x=>String(x??'').normalize('NFD').replace(/[\u0200-\u036f]/g,'').replace(/đ/gi,'d').trim().toLowerCase();
export function parseTransferFile(rows,warehouses){
 const errors=[],lines=[],seen=new Set(),headers=(rows[0]||[]).map(fold),columns=TRANSFER_HEADERS.map(h=>headers.indexOf(fold(h)));
 if(headers.length!==4||columns.some(i=>i<0)||new Set(headers).size!==headers.length)return {errors:['Dùng đúng 4 cột của file mẫu: Kho đi, Kho đến, Mã hàng, Số lượng.'],lines};
 let fromId='',toId='';
 const warehouse=(v)=>{const matches=warehouses.filter(w=>w.id===String(v??'').trim()||fold(w.name)===fold(v));return matches.length===1?matches[0].id:null;};
 for(let i=1;i<rows.length;i++){
  const row=rows[i];if(!row.some(v=>String(v??'').trim()))continue;
  if(lines.length>=200){errors.push('Tối đa 200 mã mỗi file.');break;}
  const [a,b,code,q]=columns.map(c=>row[c]),from=warehouse(a),to=warehouse(b),sku=String(code??'').trim(),qty=Number(q);
  const issues=[];if(!from||!to)issues.push('kho không tồn tại, không được phép chọn hoặc tên không duy nhất');else if(from===to)issues.push('kho đi phải khác kho đến');
  if(fromId&&(fromId!==from||toId!==to))issues.push('một file chỉ dùng một cặp kho đi/kho đến');
  if(typeof code!=='string'||!sku||sku.length>80)issues.push('mã hàng phải là Text, không để trống hoặc vượt 80 ký tự');
  if(!/^\d+(\.\d{1,3})?$/.test(String(q??'').trim())||!Number.isFinite(qty)||qty<=0||qty>1e7)issues.push('số lượng phải dương, tối đa 3 số lẻ; không dùng dấu phân cách hàng nghìn');
  if(seen.has(sku))issues.push('mã hàng bị lặp');seen.add(sku);
  if(issues.length)errors.push(`Dòng ${i+1}: ${issues.join('; ')}.`);else{fromId=from;toId=to;lines.push({sku,qty,row:i+1});}
 }
 if(!lines.length&&!errors.length)errors.push('File chưa có mã hàng.');return {errors,lines,fromId,toId};
}
let pending;
export function transferExcel(){if(globalThis.XLSX)return Promise.resolve(globalThis.XLSX);return pending||=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('./xlsx.full.min.js',import.meta.url).href;s.onload=()=>resolve(globalThis.XLSX);s.onerror=()=>{pending=null;s.remove();reject(Error('Không tải được bộ đọc Excel.'));};document.head.append(s);});}
export function transferTemplate(X){const wb=X.utils.book_new(),ws=X.utils.aoa_to_sheet([TRANSFER_HEADERS]);for(let r=1;r<=200;r++)for(let c=0;c<3;c++)ws[X.utils.encode_cell({r,c})]={t:'s',v:'',z:'@'};ws['!ref']='A1:D201';ws['!cols']=[{wch:38},{wch:38},{wch:24},{wch:16}];X.utils.book_append_sheet(wb,ws,'Điều chuyển');return wb;}
export async function readTransferFile(file,warehouses){
 if(file.size>2*1024*1024)throw Error('File tối đa 2 MB.');if(!/\.(xlsx|xls|csv)$/i.test(file.name))throw Error('Chọn file Excel hoặc CSV.');
 const X=await transferExcel(),wb=/\.csv$/i.test(file.name)?X.read(await file.text(),{type:'string',raw:true}):X.read(await file.arrayBuffer(),{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]];
 if(!ws||X.utils.decode_range(ws['!ref']||'A1').e.r>200)throw Error('Tối đa 200 dòng dữ liệu.');
 if(Object.values(ws).some(c=>c&&typeof c==='object'&&c.f))throw Error('File có công thức. Hãy dán giá trị trước khi nhập.');
 return parseTransferFile(X.utils.sheet_to_json(ws,{header:1,defval:'',raw:true}),warehouses);
}
