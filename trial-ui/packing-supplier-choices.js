/** Names only: the packing workflow does not need supplier accounts, costs or private contacts. */
export function initPackingSupplierChoices(root) {
  const list=document.createElement('datalist');list.id='pack-source-supplier-list';root.append(list);
  const sync=row=>{
    const input=row?.querySelector('[data-src-note]'),source=row?.querySelector('[data-src]')?.value;if(!input)return;
    if(source==='supplier'||source==='agent') {input.setAttribute('list',list.id);input.placeholder='Chọn hoặc tìm tên NCC / đại lý';}
    else {input.removeAttribute('list');input.placeholder='Tên cửa hàng / nguồn hàng';}
  };
  root.addEventListener('change',e=>{if(!e.target.matches('[data-src]'))return;const row=e.target.closest('.pack-src');sync(row);const input=row?.querySelector('[data-src-note]');input?.focus();if(input?.hasAttribute('list')){try{input.showPicker?.();}catch{/* Browser may require opening suggestions from the input. */}}});
  root.addEventListener('focusin',e=>{if(e.target.matches('[data-src-note]'))sync(e.target.closest('.pack-src'));});
  return {setSuppliers(suppliers=[]){
    list.replaceChildren();for(const supplier of suppliers){const option=document.createElement('option');option.value=supplier.name;option.textContent=supplier.name;list.append(option);}
    root.querySelectorAll('.pack-src').forEach(sync);
  }};
}
