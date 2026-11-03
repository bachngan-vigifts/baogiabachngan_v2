const crmStaffBase='https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
export const crmSkuKey=value=>String(value??'').trim().toUpperCase();
/** CRM computes filteredStock from real warehouses minus active quote holds. Never use supplier/incoming stock. */
export async function readCrmStock(request,values,fetcher=fetch){
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9_.~+\/-]{16,3000}={0,2}$/.test(authorization))throw Error('Vui lòng đăng nhập CRM để đọc tồn kho.');
 const skus=[...new Map(values.map(v=>String(v??'').trim()).filter(v=>v&&v.length<=100&&!v.includes(',')).map(v=>[crmSkuKey(v),v])).values()];
 const result=new Map();
 for(let i=0;i<skus.length;i+=200){
  const url=new URL(crmStaffBase+'/products');url.searchParams.set('skus',skus.slice(i,i+200).join(','));url.searchParams.set('minStock','0');
  const response=await fetcher(url.href,{headers:{Authorization:authorization,Origin:'https://crm.minhlongonline.com',Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(response.status===401)throw Error('Phiên CRM đã hết hạn. Vui lòng đăng nhập lại CRM.');
  if(response.status===403)throw Error('Tài khoản CRM chưa được cấp quyền xem sản phẩm và tồn kho.');
  if(!response.ok)throw Error('Chưa đọc được tồn CRM. Vui lòng thử lại; không dùng tồn website thay thế.');
  const data=await response.json();if(!Array.isArray(data.products)||!Array.isArray(data.warehouses))throw Error('CRM chưa trả dữ liệu tồn kho hợp lệ.');
  const checkedAt=new Date().toISOString();
  for(const p of data.products){if(p.active===false)continue;const available=Number(p.filteredStock);if(p.filteredStock==null||!Number.isFinite(available))throw Error('CRM chưa trả số tồn khả dụng; chưa thể xác minh sản phẩm.');
   result.set(crmSkuKey(p.sku),{source:'crm',sku:String(p.sku),available:Math.max(0,available),checkedAt,updatedAt:p.stockUpdatedAt||null,productCreatedAt:p.createdAt||null,pattern:String(p.pattern||'').trim().slice(0,100)});}
 }
 return result;
}
