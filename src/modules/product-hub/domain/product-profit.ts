import {profit,printingInfo,totals,type QuoteDoc} from '../../quotes/domain/quote-math.ts';
/** SKU profitability is a quote estimate, not realized COGS. Never treat missing costs as zero. */
export function productQuoteProfit(sku:string,documents:readonly QuoteDoc[]){
 let quantity=0,estimatedProfit=0,revenue=0,missingCostQty=0,missingPrintingQty=0,coveredQuotes=0;
 for(const document of documents){
  const selected=(Array.isArray(document.rows)?document.rows:[]).filter(r=>r.sku===sku&&Number.isFinite(r.qty)&&r.qty!>0);let covered=false;
  for(const row of selected){
   if(!Number.isFinite(row.costPrice)||row.costPrice!<0){missingCostQty+=row.qty!;continue;}
   if(printingInfo({type:document.type,rows:[row]}).enabled&&!Number.isFinite(row.printing?.unitPrice)){missingPrintingQty+=row.qty!;continue;}
   const perRow={...document,rows:[row],printing:{totalCost:0}},result=profit(perRow);
   quantity+=row.qty!;estimatedProfit+=result.gross;revenue+=totals(perRow).subtotal;covered=true;
  }
  if(covered)coveredQuotes++;
 }
 return{basis:'approved_quotes',beforeShipping:true,quantity,estimatedProfit,revenue,averagePerUnit:quantity?estimatedProfit/quantity:null,margin:revenue?estimatedProfit/revenue*100:null,coveredQuotes,quotes:documents.length,missingCostQty,missingPrintingQty};
}
