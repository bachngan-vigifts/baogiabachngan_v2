/** Excel import: preserve SKU strings (including leading zeroes) and leave missing values editable. */
const heading=value=>String(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/^\uFEFF/,'').trim().toLowerCase();
export function parseSkuQuantities(text,parseNumber){
 const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/),items=[];
 for(let index=0;index<lines.length;index++){
  const cells=lines[index].split('\t').map(value=>value.trim());if(!cells.some(Boolean))continue;
  if(!items.length&&['sku','ma sku','ma hang','ma san pham'].includes(heading(cells[0]))&&['sl','so luong','qty'].includes(heading(cells[1])))continue;
  if(cells.length>2)throw Error(`Dòng ${index+1}: chỉ dán 2 cột Mã hàng và Số lượng.`);
  const [sku='',quantity='']=cells;if(sku.length>200)throw Error(`Dòng ${index+1}: mã hàng quá dài.`);
  const qty=quantity===''?'':parseNumber(quantity);
  if(qty!==''&&(!Number.isFinite(qty)||qty<0||qty>1e12))throw Error(`Dòng ${index+1}: số lượng không hợp lệ.`);
  items.push({sku,qty});
 }
 return items;
}
export function pasteRows(items,products,{blankRow,rowFromProduct}){
 const bySku=new Map(products.map(p=>[p.sku,p])),warnings=[];
 const rows=items.map(({sku,qty})=>{
  const product=bySku.get(sku);
  if(product){
   const row=rowFromProduct(product,{allowMissingPrice:true});
   if(!row)throw Error(`${sku}: chưa đủ thông tin thuế để áp giá. Kiểm tra lại sản phẩm trước khi thêm.`);
   if(row.price==='')warnings.push(`${sku}: chưa có giá trong chính sách đang chọn`);
   return {...row,qty};
  }
  warnings.push(sku?`${sku}: chưa tìm thấy trong danh mục`:'Dòng chưa có mã hàng');
  return {...blankRow(),sku,name:'',qty,price:''};
 });
 return {rows,warnings};
}
