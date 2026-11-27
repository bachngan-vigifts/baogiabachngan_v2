import { defaultCostDiscount, costModeOf, parsePurchaseCost, purchasePrice } from './quote-math.js';
const el = (tag, cls, text) => { const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n; };
const money = n => new Intl.NumberFormat('vi-VN').format(n) + ' đ';
/** Approval only needs costs for active product lines; explicit zero is a valid cost. */
export const missingPurchaseCost = row => !!(row.name || row.sku) && Number(row.qty) > 0 && !Number.isFinite(row.costPrice);

/** Existing CK is always preserved, including a manually entered percentage. No new stored flag needed. */
export function purchaseCostReviewRows(rows, products = []) {
  const bySku=new Map(products.map(p=>[String(p.sku||'').trim().toLowerCase(),p]));
  return rows.flatMap((row,index)=>{
    if(!(row.name||row.sku))return [];
    const product=bySku.get(String(row.sku||'').trim().toLowerCase());
    const suggested=defaultCostDiscount({...row,...product,name:product?.name||row.name,brand:product?.brand||row.brand,pattern:product?.pattern||row.pattern});
    const mode=costModeOf(row),existing=mode==='manual'?row.costPrice:row.purchaseDiscount;
    const value=Number.isFinite(existing)?existing:mode==='discount'?suggested:null;
    return [{index,row,mode,value,suggested,kept:Number.isFinite(existing)}];
  });
}

/** Returns validated edits only after explicit Apply. Cancelling never mutates the quote. */
export function reviewPurchaseCosts(rows, products = [], { onlyMissing = false, approval = false, sale = false } = {}) {
  const entries=purchaseCostReviewRows(rows,products).filter(entry=>!onlyMissing||missingPurchaseCost(entry.row)||(sale&&!String(entry.row.supplierInfo||'').trim())),dlg=el('dialog','modal purchase-cost-dialog'),form=el('form');
  const head=el('div','modal-head'),heading=el('div');heading.append(el('span','eyebrow','GIÁ MUA · CHỈ MANAGER'),el('h2','',sale?'Giá nhập và NCC · Báo giá Sale':onlyMissing?'Bổ sung giá mua còn thiếu':'Kiểm tra CK mua vào từng mã'));head.append(heading);
  const body=el('div','modal-body');body.append(el('p','muted',onlyMissing?'Chỉ bổ sung các dòng chưa có giá mua. Các dòng đã đủ giá và CK được giữ nguyên.':'Giữ nguyên CK và giá anh đã nhập. Dòng chưa có giá mua dùng CK gợi ý; bấm “Dùng gợi ý” nếu muốn đổi dòng đã có.'));
  if(sale)body.append(el('p','muted','Nhập tên và thông tin liên hệ NCC cho từng sản phẩm. Thông tin này dùng nội bộ, không in trên báo giá khách hàng.'));
  const wrap=el('div','purchase-cost-table-wrap'),table=el('table','purchase-cost-table'),thead=el('thead'),labels=el('tr');
  for(const label of ['Mã / sản phẩm','Chế độ','CK / giá nhập','Giá nhập mỗi SP','CK gợi ý',...(sale?['Thông tin NCC *']:[])])labels.append(el('th','',label));thead.append(labels);table.append(thead);
  const tbody=el('tbody'),controls=[];
  for(const entry of entries){
    const {row,index}=entry,tr=el('tr'),name=el('td');name.append(el('strong','',row.sku||'Chưa có mã'),el('span','purchase-cost-product-name',row.name||''),el('small','muted',entry.kept?'Giữ số đã nhập':entry.value!==null?'CK gợi ý · chưa lưu':'Chưa có giá mua'));
    const modeCell=el('td'),mode=el('select');mode.setAttribute('aria-label','Chế độ giá mua dòng '+(index+1));
    for(const [value,label] of [['discount','CK mua (%)'],['manual','Giá nhập (đ)']]){const option=el('option','',label);option.value=value;mode.append(option);}mode.value=entry.mode;modeCell.append(mode);
    const inputCell=el('td'),input=el('input');input.type='text';input.inputMode='decimal';input.value=entry.value===null?'':String(entry.value);input.setAttribute('aria-label','CK hoặc giá nhập dòng '+(index+1));input.required=true;inputCell.append(input);
    const amount=el('td','num-cell'),suggestion=el('td');
    if(entry.suggested!==null){suggestion.append(el('strong','',entry.suggested+'%'));const use=el('button','btn secondary small','Dùng gợi ý');use.type='button';use.addEventListener('click',()=>{mode.value='discount';input.value=String(entry.suggested);sync();});suggestion.append(use);}else suggestion.append(el('span','muted','Chưa xác định'));
    const sync=()=>{const parsed=parsePurchaseCost(input.value,mode.value),valid=parsed&&parsed.value!==null;input.setCustomValidity(valid?'':'Nhập CK từ 0–100% hoặc giá nhập hợp lệ.');amount.textContent=valid?money(parsed.mode==='manual'?parsed.value:purchasePrice(row.price,parsed.value)):'Chưa có giá';return valid?parsed:null;};
    input.addEventListener('input',()=>{const parsed=sync();if(parsed)mode.value=parsed.mode;});mode.addEventListener('change',()=>{input.value='';sync();input.focus();});sync();
    const supplier=el('textarea');supplier.value=row.supplierInfo||'';supplier.maxLength=2000;supplier.required=sale;supplier.addEventListener('input',()=>supplier.setCustomValidity('')); supplier.placeholder='Tên NCC, người liên hệ / số điện thoại';supplier.setAttribute('aria-label','Thông tin NCC dòng '+(index+1));
    controls.push({entry,input,mode,sync,supplier});tr.append(name,modeCell,inputCell,amount,suggestion);if(sale){const cell=el('td');cell.append(supplier);tr.append(cell);}tbody.append(tr);
  }
  table.append(tbody);wrap.append(table);body.append(wrap);
  const foot=el('div','modal-foot'),cancel=el('button','btn secondary','Huỷ'),apply=el('button','btn primary',approval?'Lưu giá mua & duyệt':'Áp dụng & lưu báo giá');cancel.type='button';apply.type='submit';foot.append(cancel,apply);form.append(head,body,foot);dlg.append(form);document.body.append(dlg);
  return new Promise(resolve=>{
    let settled=false;const done=value=>{if(settled)return;settled=true;dlg.close();dlg.remove();resolve(value);};
    cancel.addEventListener('click',()=>done(null));dlg.addEventListener('cancel',e=>{e.preventDefault();done(null);});dlg.addEventListener('close',()=>done(null));
    form.addEventListener('submit',e=>{e.preventDefault();const edits=[];for(const c of controls){const parsed=c.sync();if(!parsed){c.input.reportValidity();return;}if(sale&&!c.supplier.value.trim()){c.supplier.setCustomValidity('Nhập thông tin NCC.');c.supplier.reportValidity();return;}edits.push({index:c.entry.index,...parsed,...(sale?{supplierInfo:c.supplier.value.trim()}:{})});}done(edits);});
    dlg.showModal();
  });
}
