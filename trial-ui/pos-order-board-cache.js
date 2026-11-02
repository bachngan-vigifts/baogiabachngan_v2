const STATUSES=new Set(['all','web','pending','packing','waiting_delivery','completed','cancelled']);
const totalsOf=orders=>{
 const totals=new Map();
 for(const o of orders){if(o.bucket==='cancelled')continue;const t=totals.get(o.currency)||{currency:o.currency,revenue:0,paid:0,outstanding:0,unknownPayment:0,orders:0};t.revenue+=o.total;t.paid+=o.paid??0;t.outstanding+=o.outstanding??0;t.unknownPayment+=o.paymentStatus==='unknown'?1:0;t.orders++;totals.set(o.currency,t);}
 return [...totals.values()];
};
/** RAM only, account/store/filter scoped. Never infer a full cohort from a paginated response. */
export function createPosOrderBoardCache({now=()=>Date.now(),ttl=15000}={}){
 let owner=null;const views=new Map(),cohorts=new Map();
 const scope=(params,member)=>{if(owner!==member){views.clear();cohorts.clear();owner=member;}if(!member)return null;const p=new URLSearchParams(params);p.delete('offset');p.sort();const key=p.toString(),status=p.get('status')||'all';p.delete('status');return{key,cohort:p.toString(),status};};
 const fresh=entry=>entry&&now()-entry.at<ttl;
 return{
  clear(){views.clear();cohorts.clear();},
  remember(params,data,member){
   const s=scope(params,member);if(!s||!STATUSES.has(s.status)||data.registerId!==params.get('registerId')||!Number.isInteger(data.totalOrders)||!Array.isArray(data.orders))return;
   const entry={at:now(),data};views.delete(s.key);views.set(s.key,entry);if(views.size>8)views.delete(views.keys().next().value);
   if(s.status==='all'&&data.nextOffset==null&&Number.isInteger(data.totalOrders)&&data.orders.length===data.totalOrders&&data.counts?.all===data.totalOrders){cohorts.set(s.cohort,entry);if(cohorts.size>2)cohorts.delete(cohorts.keys().next().value);}
  },
  get(params,member){
   const s=scope(params,member);if(!s||!STATUSES.has(s.status))return null;
   const exact=views.get(s.key);if(fresh(exact))return exact.data;
   const cohort=cohorts.get(s.cohort);if(!fresh(cohort))return null;
   const d=cohort.data,orders=d.orders.filter(o=>s.status==='all'||(s.status==='web'?o.orderSource==='web'&&!['completed','cancelled'].includes(o.bucket):o.bucket===s.status));
   return{...d,orders,totals:totalsOf(orders),totalOrders:orders.length,nextOffset:null};
  },
 };
}
