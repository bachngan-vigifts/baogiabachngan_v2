// TỰ SINH bởi `npm run ui:build` từ src/modules/sales/domain/submission-review.ts – không sửa tay.
// src/modules/sales/domain/submission-review.ts
var SUBMISSION_PAYMENT_METHODS = { transfer: "Chuy\u1EC3n kho\u1EA3n", cash: "Ti\u1EC1n m\u1EB7t", cod: "Thanh to\xE1n khi nh\u1EADn h\xE0ng (COD)", other: "Kh\xE1c" };
var SUBMISSION_PRINT_MODES = { sample: "L\xE0m m\u1EABu \u0111\u1EC3 kh\xE1ch duy\u1EC7t tr\u01B0\u1EDBc", bulk: "\u0110\xE3 \u0111\u01B0\u1EE3c ph\xE9p s\u1EA3n xu\u1EA5t h\xE0ng lo\u1EA1t" };
var obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var text = (v) => typeof v === "string" ? v.trim() : "";
var date = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + "T00:00:00Z")) && (/* @__PURE__ */ new Date(v + "T00:00:00Z")).toISOString().slice(0, 10) === v;
var fold = (v) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
function submissionReviewProblem(input, printing) {
  if (!obj(input)) return "\u0110i\u1EC1n v\xE0 x\xE1c nh\u1EADn th\xF4ng tin tr\u01B0\u1EDBc khi g\u1EEDi duy\u1EC7t.";
  if (["deliveryAddress", "receiverName", "receiverPhone", "paymentOther", "printInstructions"].some((k) => typeof input[k] === "string" && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[k]))) return "Th\xF4ng tin c\xF3 k\xFD t\u1EF1 \u0111i\u1EC1u khi\u1EC3n kh\xF4ng h\u1EE3p l\u1EC7.";
  if (!date(input.deliveryDate)) return "Ch\u1ECDn ng\xE0y giao h\xE0ng h\u1EE3p l\u1EC7.";
  if (!text(input.deliveryAddress) || text(input.deliveryAddress).length > 2e3 || /^(theo thoa thuan|chua (co|nhap)|cap nhat sau)[.!]?$/i.test(fold(text(input.deliveryAddress)))) return "Nh\u1EADp \u0111\u1ECBa ch\u1EC9 giao h\xE0ng c\u1EE5 th\u1EC3 (t\u1ED1i \u0111a 2.000 k\xFD t\u1EF1).";
  if (!text(input.receiverName) || text(input.receiverName).length > 500) return "Nh\u1EADp t\xEAn ng\u01B0\u1EDDi nh\u1EADn h\xE0ng (t\u1ED1i \u0111a 500 k\xFD t\u1EF1).";
  if (typeof input.receiverPhone !== "string" || !/^[+\d\s().-]+$/.test(input.receiverPhone) || !/^\d{8,15}$/.test(input.receiverPhone.replace(/\D/g, ""))) return "Nh\u1EADp s\u1ED1 \u0111i\u1EC7n tho\u1EA1i ng\u01B0\u1EDDi nh\u1EADn t\u1EEB 8\u201315 ch\u1EEF s\u1ED1.";
  if (!["sender", "receiver"].includes(input.shippingPayer)) return "Ch\u1ECDn r\xF5 c\xF4ng ty hay kh\xE1ch h\xE0ng tr\u1EA3 ph\xED giao h\xE0ng.";
  if (typeof input.paymentMethod !== "string" || !Object.hasOwn(SUBMISSION_PAYMENT_METHODS, input.paymentMethod)) return "Ch\u1ECDn h\xECnh th\u1EE9c thanh to\xE1n.";
  if (input.paymentMethod === "other" && (!text(input.paymentOther) || text(input.paymentOther).length > 1e3)) return "Ghi r\xF5 h\xECnh th\u1EE9c thanh to\xE1n kh\xE1c (t\u1ED1i \u0111a 1.000 k\xFD t\u1EF1).";
  if (printing) {
    if (!["sample", "bulk"].includes(input.printMode)) return "Ch\u1ECDn l\xE0m m\u1EABu duy\u1EC7t ho\u1EB7c s\u1EA3n xu\u1EA5t h\xE0ng lo\u1EA1t.";
    if (!text(input.printInstructions) || text(input.printInstructions).length > 2e3) return "Nh\u1EADp n\u1ED9i dung / y\xEAu c\u1EA7u in logo (t\u1ED1i \u0111a 2.000 k\xFD t\u1EF1).";
    if (input.printMode === "sample" && (!date(input.sampleDate) || input.sampleDate > input.deliveryDate)) return "Ch\u1ECDn ng\xE0y duy\u1EC7t m\u1EABu h\u1EE3p l\u1EC7, kh\xF4ng sau ng\xE0y giao h\xE0ng.";
    if (input.printMode === "bulk" && input.bulkConfirmed !== true) return "X\xE1c nh\u1EADn kh\xE1ch \u0111\xE3 cho ph\xE9p s\u1EA3n xu\u1EA5t h\xE0ng lo\u1EA1t.";
  }
  const checks = input.confirmations;
  if (!obj(checks) || checks.products !== true || checks.delivery !== true || checks.payment !== true || printing && checks.printing !== true) return "\u0110\xE1nh d\u1EA5u \u0111\u1EE7 c\xE1c th\xF4ng tin \u0111\xE3 ki\u1EC3m tra tr\u01B0\u1EDBc khi g\u1EEDi duy\u1EC7t.";
  return "";
}
function normalizeSubmissionReview(input, printing) {
  return { deliveryDate: input.deliveryDate, deliveryAddress: text(input.deliveryAddress), receiverName: text(input.receiverName), receiverPhone: text(input.receiverPhone), shippingPayer: input.shippingPayer, paymentMethod: input.paymentMethod, paymentOther: input.paymentMethod === "other" ? text(input.paymentOther) : "", printMode: printing ? input.printMode : "", printInstructions: printing ? text(input.printInstructions) : "", sampleDate: printing && input.printMode === "sample" ? input.sampleDate : "", bulkConfirmed: printing && input.printMode === "bulk" && input.bulkConfirmed === true, confirmations: { products: true, delivery: true, payment: true, printing } };
}
function readSubmissionRecord(value) {
  try {
    const r = typeof value === "string" ? JSON.parse(value) : value;
    return obj(r) && r.version === 1 && typeof r.printing === "boolean" && typeof r.submittedBy === "string" && typeof r.submittedAt === "string" && typeof r.quoteFingerprint === "string" && typeof r.deliveryFingerprint === "string" && !submissionReviewProblem(r, r.printing === true) ? r : null;
  } catch {
    return null;
  }
}
function submissionPaymentLabel(review) {
  return review.paymentMethod === "other" ? review.paymentOther : SUBMISSION_PAYMENT_METHODS[review.paymentMethod];
}
function submissionQuoteBasis(doc) {
  const basis = { type: doc.type, deliveryDate: doc.deliveryDate || doc.delivery_date || "", customer: doc.customer, customerAddress: doc.customerAddress, notes: doc.notes || "", paymentTerms: doc.paymentTerms || null, rows: (doc.rows || []).map((r) => Object.fromEntries(["sku", "name", "unit", "qty", "price", "discount", "discountType", "printFee", "printDescription", "taxRate", "manualLine", "manualDescription", "designImageKey"].map((k) => [k, r[k] ?? null]))) };
  if (doc.template === "sale" && (doc.rows || []).some((r) => ["materialDescription", "brandDescription", "volumeDescription"].some((k) => r[k] !== void 0))) {
    return JSON.stringify({ ...basis, saleSpecifications: (doc.rows || []).map((r) => [r.materialDescription ?? null, r.brandDescription ?? r.brand ?? null, r.volumeDescription ?? null, r.packagingDescription ?? null, r.bundleContents ?? null]) });
  }
  return JSON.stringify(basis);
}
export {
  SUBMISSION_PAYMENT_METHODS,
  SUBMISSION_PRINT_MODES,
  normalizeSubmissionReview,
  readSubmissionRecord,
  submissionPaymentLabel,
  submissionQuoteBasis,
  submissionReviewProblem
};
