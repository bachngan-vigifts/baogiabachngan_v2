/** Trợ lý sản phẩm: giá theo thiết lập báo giá, mức ngân sách dùng chung với Thư viện, đọc phản hồi an toàn, xem trước kết quả. */
import {esc,money,price} from './core.js';
import {savedBudgetRanges} from './library-budget.js';

/** Chiết khấu / phụ phí đang thiết lập – trợ lý lọc ngân sách và gắn giá đúng như Thư viện. */
export const assistantPricing=settings=>({lockDiscount:Number(settings.lockDiscount),minhDiscount:Number(settings.minhDiscount),fee:Number(settings.fee)});
export const pricingHint=settings=>{const p=assistantPricing(settings);return `LocknLock: niêm yết ×${100-p.lockDiscount}% + ${money(p.fee)}. Minh Long: niêm yết ×${100-p.minhDiscount}% + ${money(p.fee)}.`;};

/** "Thêm mức giá": mức tiếp theo sau giá tối đa của nhóm trước, theo các mức ngân sách của Thư viện. */
export function nextBudget(previous,ranges=savedBudgetRanges()){
 const min=previous?.max!=null&&previous.max!==''?Number(previous.max)+1:0,band=ranges.find(([,max])=>max===null||max>=min);
 return {min,max:band?band[1]:null};
}

/** Đọc JSON; trang lỗi (502, hết giờ…) hay mất mạng báo câu dễ hiểu thay vì lỗi cú pháp JSON. */
export async function assistantFetch(url,init,fetcher=fetch){
 let response;try{response=await fetcher(url,init);}catch{throw Error('Mất kết nối mạng. Kiểm tra mạng rồi thử lại.');}
 const text=await response.text();let data;
 try{data=JSON.parse(text);}catch{throw Error(response.status>=500?'Máy chủ hoặc website nhà cung cấp chưa phản hồi. Vui lòng thử lại sau ít phút.':`Phản hồi chưa đọc được (mã ${response.status}). Vui lòng thử lại.`);}
 if(!response.ok)throw Error(data?.error||'Chưa thực hiện được yêu cầu.');
 return data;
}

/** Giá chào hiển thị (đã gồm chiết khấu, phụ phí; bộ 10 SP thì ×10). */
export const offerOf=p=>price(p)*(Number(p.packSize)===10?10:1);

/** Bảng xem trước: kết quả theo nhóm, tick để chọn, nhóm 0 SP gợi ý nới tiêu chí. */
export function previewHtml(result,picked,groupLabel){
 const byGroup=new Map();for(const p of result.products){const g=Number(p.group)||1;if(!byGroup.has(g))byGroup.set(g,[]);byGroup.get(g).push(p);}
 const reports=result.groupReports?.length?result.groupReports:[...byGroup.keys()].map(index=>({index,count:byGroup.get(index).length}));
 const total=result.products.filter(p=>picked.has(p.url)).length;
 return `<div class="panel assistant-preview" style="margin-top:20px"><div class="panel-title"><h3>Kết quả tìm · chọn trước khi đưa vào báo giá</h3><span class="count-badge">${total} / ${result.products.length}</span></div><div class="panel-body">
 ${reports.map(r=>{const rows=byGroup.get(r.index)||[],on=rows.filter(p=>picked.has(p.url)).length;
  return `<section class="assistant-preview-group"><label class="switch-row"><strong>Nhóm ${r.index} · ${esc(groupLabel(r.index))} · ${rows.length} SP</strong>${rows.length?`<input type="checkbox" data-assistant-pick-group="${r.index}" aria-label="Chọn cả nhóm ${r.index}" ${on===rows.length?'checked':''}>`:''}</label>
  ${rows.length?`<ul class="assistant-preview-list" style="list-style:none;margin:0 0 12px;padding:0">${rows.map(p=>`<li><label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" data-assistant-pick="${esc(p.url)}" ${picked.has(p.url)?'checked':''}><span style="flex:1">${esc(p.name)} <small class="muted">${esc(p.brand)}${p.sku?' · '+esc(p.sku):''}</small></span><b>${money(offerOf(p))}</b></label></li>`).join('')}</ul>`
   :'<p class="hint">Không có sản phẩm mới phù hợp (có thể đã nằm trong nhóm trước). Thử nới ngân sách, bỏ bớt từ khóa hoặc chọn danh mục khác.</p>'}</section>`;}).join('')}
 ${(result.errors||[]).filter(e=>!/không có sản phẩm mới phù hợp/.test(e)).map(e=>`<p class="inline-note">${esc(e)}</p>`).join('')}${result.moreAvailable?'<p class="hint">Còn kết quả khác hoặc đã đạt giới hạn; hãy thu hẹp tiêu chí.</p>':''}
 <div class="head-buttons">${`<button class="btn primary" data-action="assistant-apply" ${total?'':'disabled'}>Đưa ${total} sản phẩm vào báo giá</button>`}<button class="btn" data-action="assistant-discard">Bỏ kết quả</button></div></div></div>`;
}
