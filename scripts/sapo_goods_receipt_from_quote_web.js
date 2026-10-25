import {validateReceiptPayload,exactMatch,verifyPurchaseReceipt} from './supplier_receipt_contract_v1.js';

/**
 * Consumer orchestration. Inject the LIVE OpenClaw UI adapter; no guessed Sapo API/selectors.
 * searchPurchaseReceipts must search receipt UUID, PNH and DMH references exhaustively.
 * No adapter method may create supplier/product automatically. No sales-order method exists.
 */
export async function runSupplierReceipt({crm, sapo, notification}) {
  const id = notification?.crm_receipt?.id ?? notification?.crm_receipt_id;
  if (!id || notification.idempotency_key !== id) throw Error('INVALID_NOTIFICATION');
  // Claim failure must stop before even opening a mutating UI action or issuing a callback.
  const claim = await crm.claim({crm_receipt_id:id});
  if (!claim?.lease_token || claim.payload?.crm_receipt?.id !== id) throw Error('INVALID_CLAIM');
  const p = claim.payload;
  const result = {schema_version:1,action:'goods_receipt_result',idempotency_key:id,crm_receipt_id:id,
    crm_order_id:p.crm_order?.id,lease_token:claim.lease_token,
    ...(p.reconciliation_id ? {reconciliation_id:p.reconciliation_id} : {})};
  const liveLease = () => {
    if (!Number.isFinite(Date.parse(claim.lease_until)) || Date.parse(claim.lease_until) <= Date.now()+30_000)
      throw Error('LEASE_EXPIRED_NEEDS_REVIEW');
  };
  let verified;
  try {
    validateReceiptPayload(p); liveLease();
    const lookup = await sapo.searchPurchaseReceipts({crm_receipt_id:id,receipt_code:p.crm_receipt.code,order_code:p.crm_order.code});
    if (lookup?.complete !== true || !Array.isArray(lookup.matches) || lookup.matches.length > 1) throw Error('LOOKUP_AMBIGUOUS');
    let doc = lookup.matches[0];
    if (doc) {
      verified = verifyPurchaseReceipt(doc,p);
    } else {
      if (p.action === 'reconcile_existing') throw Error('EXISTING_RECEIPT_NOT_FOUND');
      const resolved = {};
      for (const kind of ['warehouse','supplier','employee']) {
        resolved[kind] = exactMatch(await sapo.lookup(kind,p[kind]),p[kind],kind);
      }
      const items = [];
      for (const line of p.items) {
        const product = exactMatch(await sapo.lookup('product',{sku:line.sku}),{sku:line.sku},'product');
        items.push({...line,sapo_variant_id:product.id});
      }
      // Recheck after resolving master data; a partial/existing order always blocks creation.
      liveLease();
      const again = await sapo.searchPurchaseReceipts({crm_receipt_id:id,receipt_code:p.crm_receipt.code,order_code:p.crm_order.code});
      if (again?.complete !== true || !Array.isArray(again.matches)) throw Error('LOOKUP_AMBIGUOUS');
      if (again.matches.length) {
        if (again.matches.length !== 1) throw Error('LOOKUP_AMBIGUOUS');
        verified = verifyPurchaseReceipt(again.matches[0],p,resolved);
      } else {
        // Any timeout/uncertain UI result throws to needs_review; never loop a create click.
        const purchase = await sapo.createPurchaseOrder({...p,...resolved,items});
        if (!/^[1-9]\d*$/.test(String(purchase?.id))) throw Error('PURCHASE_ID_MISSING');
        liveLease(); await sapo.activatePurchaseOrder(purchase.id);
        liveLease(); await sapo.receiveAllGoodItems(purchase.id,{items,received_date:p.crm_receipt.received_date});
        doc = await sapo.readPurchaseReceipt(purchase.id);
        verified = verifyPurchaseReceipt(doc,p,resolved);
      }
    }
  } catch {
    // Raw UI/provider errors may contain session credentials: keep details in protected execution logs.
    await crm.callback({...result,ok:false,error:'RECEIPT_NEEDS_REVIEW'});
    return {ok:false,status:'needs_review'};
  }
  // A callback transport failure must be retried as this exact result, never by creating again.
  const callback = {...result,ok:true,sapo_purchase_order_id:String(verified.id),sapo_receipt_id:String(verified.receipt_id),
    sapo_receipt_code:verified.receipt_code,sapo_receipt_url:verified.url};
  await crm.callback(callback);
  return {ok:true,status:'done'};
}
