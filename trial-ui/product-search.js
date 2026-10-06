// TỰ SINH bởi `npm run ui:build` từ src/modules/catalog/domain/product-search.ts – không sửa tay.
// src/core/text/fold.ts
var FROM = "\xE0\xE1\u1EA1\u1EA3\xE3\xE2\u1EA7\u1EA5\u1EAD\u1EA9\u1EAB\u0103\u1EB1\u1EAF\u1EB7\u1EB3\u1EB5\xE8\xE9\u1EB9\u1EBB\u1EBD\xEA\u1EC1\u1EBF\u1EC7\u1EC3\u1EC5\xEC\xED\u1ECB\u1EC9\u0129\xF2\xF3\u1ECD\u1ECF\xF5\xF4\u1ED3\u1ED1\u1ED9\u1ED5\u1ED7\u01A1\u1EDD\u1EDB\u1EE3\u1EDF\u1EE1\xF9\xFA\u1EE5\u1EE7\u0169\u01B0\u1EEB\u1EE9\u1EF1\u1EED\u1EEF\u1EF3\xFD\u1EF5\u1EF7\u1EF9\u0111";
var TO = "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd";
function fold(value) {
  const lower = String(value ?? "").toLowerCase().normalize("NFC");
  let out = "";
  for (const ch of lower) {
    const i = FROM.indexOf(ch);
    out += i >= 0 ? TO[i] : ch;
  }
  return out.trim().replace(/\s+/g, " ");
}

// src/modules/catalog/domain/product-filters.ts
var PRODUCT_GROUPS = {
  dinner: { label: "B\u1ED9 \u0111\u1ED3 \u0103n", all: ["bo (do an|ban an|chen dia)"] },
  tea: { label: "B\u1ED9 tr\xE0", all: ["bo (tra|am tra|tach tra)"] },
  thermalCup: { label: "Ly / c\u1ED1c gi\u1EEF nhi\u1EC7t", all: ["giu nhiet", "\\m(ly|coc|ca)\\M"] },
  thermalBottle: { label: "B\xECnh gi\u1EEF nhi\u1EC7t", all: ["giu nhiet", "\\mbinh\\M"] },
  tableware: { label: "Ch\xE9n, t\xF4, \u0111\u0129a", all: ["\\m(chen|to|dia|tach)\\M"] },
  vase: { label: "B\xECnh hoa", all: ["binh hoa|lo hoa"] },
  cookware: { label: "N\u1ED3i, ch\u1EA3o", all: ["\\m(noi|chao|quanh)\\M"] }
};
var isProductGroup = (v) => typeof v === "string" && Object.hasOwn(PRODUCT_GROUPS, v);
var MINH_LONG_WORDS = ["minh long", "healthy cook", "su duong sinh"];
function priceRange(min, max) {
  const n = (v) => v === null || v === void 0 || v === "" ? null : Number(v);
  const lo = n(min), hi = n(max);
  if (lo !== null && !(Number.isFinite(lo) && lo >= 0) || hi !== null && !(Number.isFinite(hi) && hi >= 0) || lo !== null && hi !== null && lo > hi) return null;
  return { min: lo, max: hi };
}

// src/modules/catalog/domain/product-search.ts
var GROUP_RE = Object.fromEntries(Object.entries(PRODUCT_GROUPS).map(([k, g]) => [k, g.all.map((re) => new RegExp(re.replace(/\\[mM]/g, "\\b")))]));
function hydrateSnapshot(snap) {
  const cols = snap.columns, n = cols.length;
  return snap.products.map((row) => {
    const p = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    const prices = row[n], stock = row[n + 1];
    p.prices = Object.fromEntries(snap.policies.map((x, i) => [x.id, prices[i] ?? null]));
    p.stock = {};
    snap.warehouses.forEach((w, i) => {
      if (stock[i] !== null && stock[i] !== void 0) p.stock[w.id] = stock[i];
    });
    p._hay = fold([p.sku, p.name, p.brand, p.pattern].map((v) => v ?? "").join(" "));
    p._name = fold(p.name);
    const label = fold(`${p.brand ?? ""} ${p.name ?? ""}`);
    p._minhLong = MINH_LONG_WORDS.some((w) => label.includes(w));
    return p;
  });
}
function searchProducts(items, o) {
  const range = priceRange(o.min, o.max);
  if (!range) return null;
  const raw = (o.q || "").trim().split(/\s+/).filter(Boolean);
  const words = fold(o.q).split(" ").filter(Boolean).slice(0, 10);
  const exact = raw.length === 1 ? raw[0].toLowerCase() : null;
  const groupRe = o.group && isProductGroup(o.group) ? GROUP_RE[o.group] : null;
  const priceOn = !!o.policy && (range.min !== null || range.max !== null);
  const out = items.filter((p) => {
    if (words.length && !words.every((w) => p._hay.includes(w))) return false;
    if (groupRe && !groupRe.every((re) => re.test(p._name))) return false;
    if (priceOn) {
      const v = p.prices[o.policy];
      if (v === null || v === void 0 || range.min !== null && v < range.min || range.max !== null && v > range.max) return false;
    }
    if (o.scope === "minhlong" || o.scope === "other") {
      const inScope = o.scope === "minhlong" ? p._minhLong : !p._minhLong;
      if (!inScope && !(exact && p.sku.toLowerCase() === exact)) return false;
    }
    return true;
  });
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return out.sort((a, b) => (exact ? Number(b.sku.toLowerCase() === exact) - Number(a.sku.toLowerCase() === exact) : 0) || cmp(a._name, b._name) || cmp(a.name, b.name) || cmp(a.sku, b.sku));
}
export {
  hydrateSnapshot,
  searchProducts
};
