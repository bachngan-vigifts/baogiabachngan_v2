// TỰ SINH bởi `npm run ui:build` từ src/modules/quotes/domain/quote-math.ts – không sửa tay.
// src/modules/quotes/domain/quote-math.ts
var num = (v) => Number(v || 0);
var printingWorkshops = ["X\u01B0\u1EDFng in Ti\u1EBFn ph\xE1t", "Th\u01B0\u01A1ng B\xE9 Ba", "Tr\u1ECDng T\xEDn", "X\u01B0\u1EDFng in H\u1EA1nh Nguy\xEAn (Anh Li\xEAm)", "Minh Long"];
var normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
var rate = (r, s) => Number.isFinite(r.taxRate) ? r.taxRate : Number(s.vat || 0);
var discounted = (r) => Math.max(0, Number(r.price || 0) - (r.discountType === "amount" ? Number(r.discount || 0) : Number(r.price || 0) * Number(r.discount || 0) / 100));
var after = (r, s) => discounted(r) + (s.type !== "HRC" ? Number(r.printFee || 0) : 0);
function totals(s) {
  let subtotal = 0, tax = 0;
  const rates = /* @__PURE__ */ new Set();
  for (const r of s.rows) {
    const line = after(r, s) * Number(r.qty || 0), vat = rate(r, s);
    subtotal += line;
    tax += line * vat / 100;
    rates.add(vat);
  }
  return { subtotal, tax, total: subtotal + tax, label: rates.size > 1 ? "Thu\u1EBF VAT theo s\u1EA3n ph\u1EA9m" : `Thu\u1EBF VAT ${rates.size ? [...rates][0] : s.vat || 0}%` };
}
function printingInfo(s) {
  const rows = (s.rows || []).filter((row) => Number(row.printFee) > 0 && Number(row.qty) > 0);
  const enabled = ["B2B", "VIGIFTS"].includes(s.type) && rows.length > 0;
  const minhLong = rows.length > 0 && rows.every((row) => /minh long|healthy cook|su duong sinh/.test(normalize(`${row.brand || ""} ${row.name || ""}`)));
  return { enabled, defaultWorkshop: minhLong ? printingWorkshops[0] : printingWorkshops[1] };
}
function commissionOf(r) {
  const c = r.commission, qty = Math.max(0, num(r.qty)), value = Math.max(0, num(c?.value));
  if (!c || c.excluded || !value || !qty) return 0;
  return Math.round(c.mode === "amount" ? value * qty : discounted(r) * value / 100 * qty);
}
function profit(s, shippingFee = null) {
  const revenue = totals(s).subtotal;
  const cost = s.rows.reduce((sum, row) => sum + (Number(row.costPrice) || 0) * Number(row.qty || 0), 0);
  const shippingCost = s.shipping?.payer === "sender" && Number.isFinite(shippingFee) ? Math.max(0, shippingFee) : 0;
  const hasLineCosts = s.rows.some((row) => row.printing && Number.isFinite(row.printing.unitPrice));
  const printingCost = printingInfo(s).enabled ? hasLineCosts ? s.rows.reduce((sum, row) => sum + Math.round(Math.max(0, Number(row.printing?.unitPrice) || 0) * Math.max(0, Number(row.qty) || 0)), 0) : Math.max(0, Number(s.printing?.totalCost) || 0) : 0;
  const commission = s.rows.reduce((sum, row) => sum + commissionOf(row), 0);
  const gross = revenue - cost - commission - shippingCost - printingCost;
  return { revenue, cost, commission, shippingCost, printingCost, gross, margin: revenue ? gross / revenue * 100 : 0 };
}
var netPrice = (raw, tax, included) => included ? raw / (1 + tax / 100) : raw;
function defaultCostDiscount(product) {
  const text = normalize([product?.brand, product?.name, product?.sku, product?.pattern].filter(Boolean).join(" "));
  if (!text) return null;
  if (text.includes("healthy cook")) return 15;
  if (/\blys\b/.test(text) || text.includes("minh long - lys")) return 19;
  if (/\blocknlock\b/.test(text) || /\block n lock\b/.test(text) || text.includes("lock&lock") || text.includes("lock & lock") || /\block\b/.test(text)) return 58;
  if (/(?:^|[^a-z0-9đ])(?:hoang cung|[dđ]ai cac)(?=$|[^a-z0-9đ])/.test(text)) return 27;
  if (text.includes("minh long")) return 25;
  return null;
}
var purchasePrice = (price, discount) => {
  const value = Number(price) || 0, percent = Number(discount);
  return value <= 0 || !Number.isFinite(percent) ? 0 : Math.round(value * (100 - Math.min(100, Math.max(0, percent))) / 100);
};
var costModeOf = (row) => row.costMode ?? (!Number.isFinite(row.purchaseDiscount) && Number.isFinite(row.costPrice) ? "manual" : "discount");
function parsePurchaseCost(input, mode) {
  let s = input.trim().replace(/\s+/g, ""), factor = 1;
  if (!s) return { mode, value: null };
  if (s.endsWith("%")) {
    mode = "discount";
    s = s.slice(0, -1);
  } else if (/k$/i.test(s)) {
    mode = "manual";
    factor = 1e3;
    s = s.slice(0, -1);
  } else if (/(?:đ|₫|vnd)$/i.test(s)) {
    mode = "manual";
    s = s.replace(/(?:đ|₫|vnd)$/i, "");
  }
  if (/^\d{1,3}(?:[.]\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else if (/^\d{1,3}(?:,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const value = Number(s) * factor;
  if (!Number.isFinite(value) || value < 0 || value > (mode === "discount" ? 100 : 1e12)) return null;
  return { mode, value };
}
function syncPurchaseCost(row) {
  if (costModeOf(row) === "discount") {
    if (Number.isFinite(row.purchaseDiscount)) row.costPrice = purchasePrice(row.price, row.purchaseDiscount);
    else delete row.costPrice;
  }
}
function applyPurchaseCost(row, entry) {
  row.costMode = entry.mode;
  if (entry.mode === "manual") {
    delete row.purchaseDiscount;
    if (entry.value === null) delete row.costPrice;
    else row.costPrice = entry.value;
  } else {
    if (entry.value === null) delete row.purchaseDiscount;
    else row.purchaseDiscount = entry.value;
    syncPurchaseCost(row);
  }
}
var defaultCostPrice = (product, price) => {
  const discount = defaultCostDiscount(product);
  return discount === null ? 0 : purchasePrice(price, discount);
};
function brandDiscountKey(brand) {
  const n = normalize(brand), words = n.split(/[^a-z0-9&]+/).filter(Boolean);
  if (words.includes("lys")) return "lys";
  if (/lock\s*(&|n|and)?\s*lock/.test(n) || words.includes("lock")) return "lock";
  if (/minh long|healthy cook|su duong sinh/.test(n)) return "minhLong";
  return null;
}
function customerDiscount(brand, discounts = {}, mode = "percent", price = 0) {
  const n = normalize(brand);
  const key = brandDiscountKey(n);
  const percent = key && discounts?.[key];
  return typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? mode === "amount" ? price * percent / 100 : percent : 0;
}
export {
  after,
  applyPurchaseCost,
  brandDiscountKey,
  commissionOf,
  costModeOf,
  customerDiscount,
  defaultCostDiscount,
  defaultCostPrice,
  discounted,
  netPrice,
  normalize,
  parsePurchaseCost,
  printingInfo,
  printingWorkshops,
  profit,
  purchasePrice,
  rate,
  syncPurchaseCost,
  totals
};
