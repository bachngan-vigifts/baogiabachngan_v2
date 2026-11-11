export const discountProduct=row=>row.manualLine!==true&&!!String(row.sku||'').trim();
export function bulkQuoteDiscount(rows,value,scope='all'){
 if(value===''||value==null||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100)throw Error('Nhập chiết khấu từ 0 đến 100%.');
 if(!['all','zero'].includes(scope))throw Error('Phạm vi chiết khấu chưa hợp lệ.');
 let count=0;const next=rows.map(row=>{if(!discountProduct(row)||scope==='zero'&&Number(row.discount||0)!==0)return row;count++;return{...row,discount:Number(value),discountType:'percent'};});
 return{rows:next,count};
}
export function initBulkQuoteDiscount({button,dialog,getRows,apply,isLocked,context}){
 const form=dialog.querySelector('form'),input=form.elements.discount,scope=form.elements.scope,error=dialog.querySelector('[role="alert"]'),summary=dialog.querySelector('[data-summary]');let opened;
 function preview(){error.textContent='';try{const result=bulkQuoteDiscount(getRows(),input.value,scope.value);summary.textContent=`Áp dụng cho ${result.count} dòng sản phẩm. Dòng phụ phí giữ nguyên. Bấm “Lưu báo giá” sau khi áp dụng để ghi nhận trên CRM.`;}catch{summary.textContent='Nhập CK mới để xem số dòng được thay đổi.';}}
 button.addEventListener('click',()=>{if(isLocked())return;form.reset();error.textContent='';opened=context();preview();dialog.showModal();input.focus();});
 form.addEventListener('input',preview);form.addEventListener('change',preview);
 form.addEventListener('submit',event=>{event.preventDefault();if(isLocked()||opened!==context()){error.textContent='Báo giá đã thay đổi hoặc không còn quyền sửa. Đóng và mở lại.';return;}
  try{const result=bulkQuoteDiscount(getRows(),input.value,scope.value);if(!result.count)throw Error('Không có dòng sản phẩm phù hợp để thay đổi.');apply(result);dialog.close();}catch(e){error.textContent=e.message;}
 });
 dialog.addEventListener('close',()=>{opened=null;form.reset();error.textContent='';});
}
