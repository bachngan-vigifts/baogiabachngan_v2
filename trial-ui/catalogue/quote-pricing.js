/** Quote-local policy; never mutates shared product/library prices. All fees are VND per single product. */
export const defaultQuotePolicy=()=>({enabled:true,basis:'list',discount:0,margin:20,printFee:0,shipping:0,gift:0,coffee:0,costs:{}});
export function cleanQuotePolicy(raw){
 if(!raw||typeof raw!=='object'||typeof raw.enabled!=='boolean'||!['list','cost'].includes(raw.basis))throw Error('Chính sách giá riêng chưa hợp lệ.');
 const out={enabled:raw.enabled,basis:raw.basis,costs:{}};
 for(const [key,max] of Object.entries({discount:100,margin:95,printFee:1e8,shipping:1e8,gift:1e8,coffee:1e8})){
  const n=raw[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>max)throw Error('Kiểm tra chiết khấu, biên lợi nhuận và chi phí.');out[key]=n;
 }
 if(!raw.costs||typeof raw.costs!=='object'||Array.isArray(raw.costs)||Object.keys(raw.costs).length>1000)throw Error('Danh sách giá vốn chưa hợp lệ.');
 for(const [id,n]of Object.entries(raw.costs)){if(!id||id.length>80||typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e10)throw Error('Giá vốn chưa hợp lệ.');Object.defineProperty(out.costs,id,{value:n,enumerable:true,writable:true,configurable:true});}
 return out;
}
export function policyUnitPrice(p,policy,fallback){
 if(!policy?.enabled)return fallback;
 if(p.priceOnRequest)return 0;
 const fees=policy.printFee+policy.shipping+policy.gift+policy.coffee,hasCost=Object.hasOwn(policy.costs,p.id);
 // Margin is profit / selling price, not markup on cost. Discount applies to the list-price branch only.
 const amount=policy.basis==='cost'&&hasCost?(policy.costs[p.id]+fees)/(1-policy.margin/100):Number(p.regular)*(1-policy.discount/100)+fees;
 if(!Number.isFinite(amount)||amount<0||amount>1e10)throw Error('Giá sau tính toán vượt giới hạn 10 tỷ đồng/sản phẩm.');
 return Math.round(amount);
}
