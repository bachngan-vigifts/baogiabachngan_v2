/** One-off, reviewed SQL plan. No connection, deployment, implicit warehouse or invented receipt. */
export interface PackingStockRepairPlan {
  slipId:string; warehouseId:string; actorId:string; expectedRevision:number; reason:string;
  receiptId:string; lines:{sku:string;qty:number}[];
}
export function packingStockRepairSql(plan:PackingStockRepairPlan):string {
  if(!plan.slipId||!plan.warehouseId||!plan.actorId||!plan.receiptId||!Number.isSafeInteger(plan.expectedRevision)||plan.expectedRevision<1||
    plan.reason.trim().length<10||!plan.lines.length||plan.lines.length>500||new Set(plan.lines.map(l=>l.sku)).size!==plan.lines.length||
    plan.lines.some(l=>!l.sku.trim()||!Number.isFinite(l.qty)||l.qty<=0))throw Error('INVALID_REPAIR_PLAN');
  const input=JSON.stringify(plan).replace(/'/g,"''");
  return `DO $repair$
DECLARE
 p jsonb := '${input}'::jsonb;
 s packing_slips%rowtype;
 w warehouses%rowtype;
 l record;
 have double precision;
 own double precision;
 opening_at text;
 changed integer := 0;
 evidence boolean;
 before_data jsonb;
 stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
 -- Same order as application writes: order → packing → ledger → sorted balances.
 PERFORM 1 FROM sales_orders WHERE id=(select order_id from packing_slips where id=p->>'slipId') FOR UPDATE;
 SELECT * INTO s FROM packing_slips WHERE id=p->>'slipId' FOR UPDATE;
 IF NOT FOUND OR s.status<>'packed' OR s.packed_by IS NULL OR s.packed_at IS NULL THEN RAISE EXCEPTION 'REPAIR_PHYSICAL_PROOF_REQUIRED'; END IF;
 IF NOT EXISTS(select 1 from staff_members where id=p->>'actorId' and role='manager' and active=true) THEN RAISE EXCEPTION 'REPAIR_MANAGER_REQUIRED'; END IF;
 IF EXISTS(select 1 from sales_orders where id=s.order_id and (status='cancelled' or channel<>'crm' or (warehouse_id is not null and warehouse_id<>p->>'warehouseId'))) THEN RAISE EXCEPTION 'REPAIR_ORDER_WAREHOUSE_CONFLICT'; END IF;
 SELECT * INTO w FROM warehouses WHERE id=p->>'warehouseId' and kind='stock' and active=true;
 IF NOT FOUND OR (s.stock_warehouse_id IS NOT NULL AND s.stock_warehouse_id<>w.id) THEN RAISE EXCEPTION 'REPAIR_WAREHOUSE_CONFLICT'; END IF;
 IF EXISTS(select 1 from stock_moves where ref_type='sales_order' and (ref_id=s.order_id or ref_id like s.order_id||'#%')) THEN RAISE EXCEPTION 'REPAIR_LEGACY_ORDER_REVIEW_REQUIRED'; END IF;
 IF EXISTS(select 1 from (
    select sku,sum(qty) qty from packing_slip_lines where slip_id=s.id and trim(sku)<>'' group by sku
   ) a full join jsonb_to_recordset(p->'lines') as b(sku text,qty double precision) using(sku)
   where a.qty is null or b.qty is null or abs(a.qty-b.qty)>0.0005) THEN RAISE EXCEPTION 'REPAIR_LINES_CHANGED'; END IF;
 IF EXISTS(select 1 from stock_moves where ref_type='packing_slip' and split_part(ref_id,'#',1)=s.id and warehouse_id<>w.id) THEN RAISE EXCEPTION 'REPAIR_OTHER_WAREHOUSE_MOVES'; END IF;
 -- Replay is a no-op only when the full target state already exists.
 IF s.stock_warehouse_id=w.id AND NOT EXISTS(
  select 1 from jsonb_to_recordset(p->'lines') as a(sku text,qty double precision)
  where abs(a.qty+coalesce((select sum(qty) from stock_moves where ref_type='packing_slip' and split_part(ref_id,'#',1)=s.id and sku=a.sku and warehouse_id=w.id),0))>0.0005
 ) THEN RETURN; END IF;
 IF s.revision<>(p->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'REPAIR_REVISION_CHANGED'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('stock_ledger_opening'));
 SELECT min(created_at) INTO opening_at FROM stock_moves WHERE warehouse_id=w.id and ref_type='opening';
 IF opening_at IS NULL OR s.packed_at<=opening_at THEN RAISE EXCEPTION 'REPAIR_BEFORE_OPENING_REVIEW_REQUIRED'; END IF;
 SELECT exists(
  select 1 from supplier_receipts r join supplier_receipt_lines rl on rl.receipt_id=r.id
   join jsonb_to_recordset(p->'lines') as a(sku text,qty double precision) on a.sku=rl.sku
  where r.id=p->>'receiptId' and r.cancelled_at is null and r.warehouse=w.name and r.created_at<=s.packed_at
    and rl.good_qty>=a.qty and exists(select 1 from stock_moves m where m.ref_type='supplier_receipt' and m.ref_id=r.id and m.sku=rl.sku and m.warehouse_id=w.id
    group by m.sku having sum(m.qty)>=a.qty)
 ) INTO evidence;
 IF NOT evidence THEN RAISE EXCEPTION 'REPAIR_RECEIPT_EVIDENCE_REQUIRED'; END IF;
 PERFORM 1 FROM stock_balances b WHERE b.warehouse_id=w.id and b.sku in(select a.sku from jsonb_to_recordset(p->'lines') as a(sku text)) ORDER BY b.sku FOR UPDATE;
 before_data:=jsonb_build_object('slip',to_jsonb(s),'balances',(select jsonb_agg(to_jsonb(b)) from stock_balances b where b.warehouse_id=w.id and b.sku in(select a.sku from jsonb_to_recordset(p->'lines') as a(sku text))));
 FOR l IN select * from jsonb_to_recordset(p->'lines') as a(sku text,qty double precision) order by sku LOOP
  SELECT qty INTO have FROM stock_balances WHERE sku=l.sku and warehouse_id=w.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REPAIR_MISSING_BALANCE'; END IF;
  IF abs(have-coalesce((select sum(qty) from stock_moves where sku=l.sku and warehouse_id=w.id),0))>0.0005 THEN RAISE EXCEPTION 'REPAIR_LEDGER_BALANCE_MISMATCH'; END IF;
  IF NOT EXISTS(select 1 from stock_moves where sku=l.sku and warehouse_id=w.id and qty>0 and created_at<=s.packed_at) THEN RAISE EXCEPTION 'REPAIR_INBOUND_REQUIRED'; END IF;
  SELECT coalesce(sum(qty),0) INTO own FROM stock_moves WHERE ref_type='packing_slip' and split_part(ref_id,'#',1)=s.id and sku=l.sku and warehouse_id=w.id;
  IF abs(own+l.qty)<=0.0005 THEN CONTINUE; END IF;
  IF abs(own)>0.0005 OR EXISTS(select 1 from stock_moves where ref_type='packing_slip' and split_part(ref_id,'#',1)=s.id and sku=l.sku) THEN RAISE EXCEPTION 'REPAIR_PARTIAL_MOVES_REVIEW_REQUIRED'; END IF;
  IF have+0.0005<l.qty THEN RAISE EXCEPTION 'REPAIR_STOCK_SHORT'; END IF;
  INSERT INTO stock_moves(id,sku,warehouse_id,qty,kind,ref_type,ref_id,ref_no,note,created_by,created_at)
   VALUES(gen_random_uuid()::text,l.sku,w.id,-l.qty,'issue','packing_slip',s.id,s.slip_no,left(p->>'reason',500),p->>'actorId',stamp);
  UPDATE stock_balances SET qty=qty-l.qty,updated_at=stamp WHERE sku=l.sku and warehouse_id=w.id;
  changed:=changed+1;
 END LOOP;
 UPDATE packing_slips SET stock_warehouse_id=w.id,revision=revision+1,updated_at=stamp WHERE id=s.id;
 INSERT INTO audit_logs(id,actor_id,module,action,entity_type,entity_id,data,created_at)
 VALUES(gen_random_uuid()::text,p->>'actorId','inventory','repair_packing_stock','packing_slips',s.id,
  jsonb_build_object('reason',p->>'reason','requestedBy',p->>'actorId','receiptEvidence',p->>'receiptId','before',before_data,'lines',p->'lines','postedRows',changed,'warehouseId',w.id)::text,stamp);
END $repair$;`;
}

/** Reopen unsupported completion after opening; pre-opening records get an audit note only. */
export function packingStockReviewSql(plan:{slipId:string;actorId:string;expectedRevision:number;reason:string}):string {
 if(!plan.slipId||!plan.actorId||!Number.isSafeInteger(plan.expectedRevision)||plan.reason.trim().length<10)throw Error('INVALID_REVIEW_PLAN');
 const input=JSON.stringify(plan).replace(/'/g,"''");
 return `DO $review$
 DECLARE p jsonb:='${input}'::jsonb; s packing_slips%rowtype; old_period boolean; marker text:='[STOCK_RECONCILIATION]'; stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 BEGIN
 PERFORM 1 FROM sales_orders WHERE id=(select order_id from packing_slips where id=p->>'slipId') FOR UPDATE;
 SELECT * INTO s FROM packing_slips WHERE id=p->>'slipId' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_SLIP_MISSING'; END IF;
 IF position(marker in coalesce(s.packed_note,''))>0 AND EXISTS(select 1 from audit_logs where entity_id=s.id and action='review_packing_stock') THEN RETURN; END IF;
 IF NOT EXISTS(select 1 from staff_members where id=p->>'actorId' and role='manager' and active=true) THEN RAISE EXCEPTION 'REVIEW_MANAGER_REQUIRED'; END IF;
 IF s.status<>'packed' OR s.revision<>(p->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'REVIEW_SLIP_CHANGED'; END IF;
 IF EXISTS(select 1 from stock_moves where (ref_type='packing_slip' and split_part(ref_id,'#',1)=s.id) or (ref_type='sales_order' and (ref_id=s.order_id or ref_id like s.order_id||'#%'))) THEN RAISE EXCEPTION 'REVIEW_EXISTING_ISSUE_REQUIRED'; END IF;
 IF NOT EXISTS(select 1 from sales_orders where id=s.order_id and channel='crm' and status<>'cancelled') THEN RAISE EXCEPTION 'REVIEW_ORDER_SCOPE'; END IF;
 SELECT coalesce(s.packed_at<=min(created_at),true) INTO old_period FROM stock_moves WHERE ref_type='opening';
 IF old_period THEN
  UPDATE packing_slips SET packed_note=left(marker||' Phiếu trước kỳ tồn đầu; cần đối soát hồ sơ, không trừ bù vào kỳ hiện tại. '||coalesce(packed_note,''),1000),revision=revision+1,updated_at=stamp WHERE id=s.id;
 ELSE
  UPDATE packing_slips SET status='sent',source='warehouse',
   source_note=left('Nguồn ban đầu: '||s.source||case when s.source_note<>'' then ' · '||s.source_note else '' end,200),
   stock_warehouse_id=null,packed_at=null,packed_by=null,
   packed_note=left(marker||' Chưa đủ bằng chứng nhập/xuất kho; xác minh kho thực nhận trước khi xác nhận lại. '||coalesce(packed_note,''),1000),
   sent_at=coalesce(sent_at,stamp),sent_by=coalesce(sent_by,p->>'actorId'),revision=revision+1,updated_at=stamp WHERE id=s.id;
 END IF;
 INSERT INTO audit_logs(id,actor_id,module,action,entity_type,entity_id,data,created_at)
 VALUES(gen_random_uuid()::text,p->>'actorId','inventory','review_packing_stock','packing_slips',s.id,
  jsonb_build_object('reason',p->>'reason','before',to_jsonb(s),'preOpening',old_period,'inventoryChanged',false,'deliveryAndFinancialStatusChanged',false)::text,stamp);
 END $review$;`;
}
