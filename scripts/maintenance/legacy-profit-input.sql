-- Read-only recovery input. No customer/contact data or credentials are exported.
WITH eligible AS (
 SELECT l.id,l.order_id,l.line_no,l.sku,l.name,l.unit,l.qty,l.amount,o.order_date,o.created_at,o.quote_id
 FROM sales_order_lines l JOIN sales_orders o ON o.id=l.order_id
 LEFT JOIN sales_line_costs c ON c.order_line_id=l.id
 WHERE c.order_line_id IS NULL AND o.status<>'cancelled' AND l.qty>0
 AND (o.status<>'draft' OR EXISTS(SELECT 1 FROM sales_contracts k WHERE k.order_id=o.id AND k.status IN ('signed','completed')))
), needed AS (SELECT DISTINCT sku FROM eligible WHERE sku<>''), receipt_moves AS (
 SELECT m.id,m.ref_key,m.ref_code,m.sku,m.unit,m.unit_price,m.note,m.occurred_at,r.id AS receipt_id,r.received_date,
 r.cancelled_at,s.approval_status,s.cancelled_at AS purchase_cancelled_at,
 l.id AS purchase_line_id,l.price,l.purchase_discount,l.confirmed_purchase_discount,l.print_fee,
 j.payload::jsonb AS payload
 FROM product_movements m
 LEFT JOIN supplier_receipts r ON m.ref_key LIKE 'receipt:%' AND r.id=split_part(m.ref_key,':',2)
 LEFT JOIN incoming_shipment_lines l ON l.id=split_part(m.ref_key,':',3) AND l.sku=m.sku
 LEFT JOIN incoming_shipments s ON s.id=l.shipment_id
 LEFT JOIN supplier_receipt_jobs j ON j.receipt_id=r.id
 WHERE m.kind='purchase' AND m.qty>0
), input AS (
 SELECT jsonb_build_object(
 'lines',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',e.id,'orderId',e.order_id,'sku',e.sku,'name',e.name,'unit',e.unit,'lineNo',e.line_no,'qty',e.qty,'amount',e.amount,
   'day',e.order_date,'createdAt',e.created_at,'quoteRef',q.ref,'quoteAt',CASE WHEN q.ref LIKE 'quote-revision:%' THEN NULL ELSE q.at END,
   'quoteRows',(SELECT jsonb_agg(jsonb_build_object('sku',r->'sku','name',r->'name','manualLine',r->'manualLine',
      'qty',r->'qty','costPrice',r->'costPrice','costMode',r->'costMode','purchaseDiscount',r->'purchaseDiscount') ORDER BY n)
      FROM jsonb_array_elements(q.data::jsonb->'rows') WITH ORDINALITY x(r,n))
 ) ORDER BY e.id) FROM eligible e LEFT JOIN LATERAL (
   -- Revisions store the version being replaced: the first replacement after sale contains the version valid at sale.
   SELECT data,at,ref FROM (
    SELECT sq.data,sq.updated_at AS at,'quote:'||sq.id||':r'||sq.revision AS ref,0 AS rank
     FROM staff_quotations sq WHERE sq.id=e.quote_id AND sq.updated_at::timestamptz<=e.created_at::timestamptz
    UNION ALL
    SELECT qr.data,qr.created_at,'quote-revision:'||qr.id,1 FROM quote_revisions qr
     WHERE qr.quote_id=e.quote_id AND qr.created_at::timestamptz>=e.created_at::timestamptz
   ) v ORDER BY rank,at::timestamptz,ref LIMIT 1
 ) q ON true),'[]'::jsonb),
 'movements',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',m.id,'sku',m.sku,'unit',m.unit,'ref',m.ref_key||CASE WHEN m.ref_code<>'' THEN ' ['||m.ref_code||']' ELSE '' END,'storedPrice',m.unit_price,'note',m.note,
   'at',CASE WHEN m.received_date IS NULL OR to_char(m.occurred_at::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD')=m.received_date
     THEN m.occurred_at ELSE m.received_date||'T00:00:00+07:00' END,
   'receiptId',m.receipt_id,'cancelled',m.cancelled_at IS NOT NULL OR m.purchase_cancelled_at IS NOT NULL,
   'approved',m.approval_status='approved','price',m.price,'discount',coalesce(m.confirmed_purchase_discount,m.purchase_discount),
   'printFee',m.print_fee,
   'item',(SELECT i FROM jsonb_array_elements(m.payload->'items') i
      WHERE i->>'crm_line_id'=m.purchase_line_id AND i->>'sku'=m.sku LIMIT 1)
 ) ORDER BY m.id) FROM receipt_moves m),'[]'::jsonb),
 'purchaseOrders',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'sku',l.sku,'unit',l.unit,'ref','purchase:'||s.id||':line:'||l.id||' ['||s.ticket_number||']','at',coalesce(s.approved_at,s.created_at),
    'price',l.price,'discount',coalesce(l.confirmed_purchase_discount,l.purchase_discount),'printFee',l.print_fee
 ) ORDER BY s.id,l.id) FROM incoming_shipment_lines l JOIN incoming_shipments s ON s.id=l.shipment_id
 WHERE s.source='supplier-order' AND s.approval_status='approved' AND s.cancelled_at IS NULL
 AND l.quantity>0 AND l.sku IN(SELECT sku FROM needed)),'[]'::jsonb),
 'products',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'sku',p.sku,'unit',p.unit,'name',p.name,'brand',p.brand,'pattern',p.pattern,'taxable',p.taxable,'taxOut',p.tax_out,
   'taxBasis',p.tax_basis,'at',p.updated_at,
   'prices',(SELECT jsonb_agg(jsonb_build_object('id',v.policy_id,'name',pp.name,'price',v.price) ORDER BY pp.sort_order,pp.id)
      FROM product_prices v JOIN price_policies pp ON pp.id=v.policy_id WHERE v.sku=p.sku)
 ) ORDER BY p.sku) FROM products p WHERE p.sku IN(SELECT sku FROM needed) AND p.approval_status='approved'),'[]'::jsonb)
 ) AS payload
)
SELECT payload,md5(payload::text) AS fingerprint FROM input;
