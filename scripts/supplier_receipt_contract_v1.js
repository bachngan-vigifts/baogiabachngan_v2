// Shared, dependency-free contract for the n8n/OpenClaw receipt consumer.
const text = value => typeof value === 'string' && value.trim().length > 0;
const number = (value, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
export function validateReceiptPayload(p) {
  if (!p || p.schema_version !== 1 || p.source !== 'crm_supplier_receipt' ||
      !['create_purchase_receipt','reconcile_existing'].includes(p.action) || !text(p.idempotency_key) ||
      p.idempotency_key !== p.crm_receipt?.id) throw Error('INVALID_RECEIPT_CONTRACT');
  for (const [object, keys] of [[p.crm_order,['id','code']],[p.crm_receipt,['id','code','received_date']],
    [p.supplier,['id','name']],[p.warehouse,['name']],[p.employee,['id','name']]]) {
    if (!object || keys.some(key => !text(object[key]))) throw Error('MISSING_RECEIPT_IDENTITY');
  }
  if (p.action === 'reconcile_existing' && !text(p.reconciliation_id)) throw Error('MISSING_RECONCILIATION_ID');
  if (!Array.isArray(p.items) || !p.items.length) throw Error('EMPTY_GOOD_ITEMS');
  const lines = new Set();
  for (const i of p.items) {
    if (!i || ['crm_line_id','sku','name','unit'].some(k => !text(i[k])) || lines.has(i.crm_line_id) ||
        !number(i.good_quantity) || i.good_quantity === 0 || !number(i.unit_price) ||
        !number(i.purchase_discount_percent,100) || !number(i.vat_percent,100) ||
        'damaged_quantity' in i || 'damaged_qty' in i) throw Error('INVALID_GOOD_ITEM');
    lines.add(i.crm_line_id);
  }
  return p;
}

/** CRM IDs are not Sapo IDs. Only explicit sapo_id is used across the two systems. */
export function exactMatch(candidates, reference, kind) {
  if (!Array.isArray(candidates)) throw Error('INCOMPLETE_IDENTITY_LOOKUP');
  const sapoId = reference.sapo_id || (kind === 'warehouse' ? reference.id : undefined);
  const keys = sapoId ? ['id',sapoId] : kind === 'supplier' && reference.tax_code ? ['tax_code',reference.tax_code] :
    kind === 'supplier' && reference.code ? ['code',reference.code] :
    kind === 'product' ? ['sku',reference.sku] : ['name',reference.name];
  const matches = candidates.filter(c => c && String(c[keys[0]] ?? '').trim() === String(keys[1]).trim());
  if (matches.length !== 1 || !/^[1-9]\d*$/.test(String(matches[0].id))) throw Error('IDENTITY_NOT_UNIQUE_' + kind.toUpperCase());
  return matches[0];
}

export function verifyPurchaseReceipt(doc, p, resolved) {
  if (!doc || doc.kind !== 'purchase_order' || doc.status !== 'completed' || doc.receipt_status !== 'received' ||
      !/^[1-9]\d*$/.test(String(doc.id)) || !/^[1-9]\d*$/.test(String(doc.receipt_id)) || !text(doc.receipt_code) ||
      doc.crm_receipt_id !== p.crm_receipt.id || doc.crm_receipt_code !== p.crm_receipt.code ||
      doc.crm_order_code !== p.crm_order.code || doc.received_date !== p.crm_receipt.received_date ||
      !Array.isArray(doc.items) || doc.items.length !== p.items.length)
    throw Error('PURCHASE_RECEIPT_NOT_VERIFIED');
  // For existing records, verify with the same exact identity rules as a new order.
  for (const kind of ['warehouse','supplier','employee']) {
    const found = exactMatch([doc[kind]],p[kind],kind);
    if (resolved && String(found.id) !== String(resolved[kind].id)) throw Error('WRONG_' + kind.toUpperCase());
  }
  for (const line of p.items) {
    const found = doc.items.filter(i => i.crm_line_id === line.crm_line_id && i.sku === line.sku);
    if (found.length !== 1 || ['good_quantity','unit_price','purchase_discount_percent','vat_percent','unit'].some(k => found[0][k] !== line[k]))
      throw Error('PURCHASE_LINE_MISMATCH');
  }
  const url = new URL(doc.url);
  if (url.origin !== 'https://bachngankiengiang.mysapogo.com' || url.pathname !== `/admin/purchase_orders/${doc.id}` ||
      url.search || url.hash || url.username || url.password) throw Error('INVALID_PURCHASE_LINK');
  return doc;
}
