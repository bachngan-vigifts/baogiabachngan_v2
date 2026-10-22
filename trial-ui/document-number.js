// TỰ SINH bởi `npm run ui:build` từ src/core/document-number.ts – không sửa tay.
// src/core/document-number.ts
var escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");
function documentDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (/* @__PURE__ */ new Date(date + "T00:00:00Z")).toISOString().slice(0, 10) !== date) throw new Error("Ng\xE0y ch\u1EE9ng t\u1EEB kh\xF4ng h\u1EE3p l\u1EC7.");
  return date.slice(8, 10) + date.slice(5, 7) + date.slice(0, 4);
}
function documentSequence(no, prefix, date, legacyHead = `${prefix}_${date.replaceAll("-", "")}_`) {
  const current = new RegExp(`^${escapeRegex(prefix)}_(\\d{3,})_${documentDate(date)}$`).exec(no);
  const legacy = no.startsWith(legacyHead) ? no.slice(legacyHead.length) : "";
  const raw = current?.[1] ?? (/^\d{3,}$/.test(legacy) ? legacy : "");
  const value = raw ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function nextDocumentNumber(prefix, date, used, legacyHead) {
  let max = 0;
  for (const no of used) max = Math.max(max, documentSequence(no, prefix, date, legacyHead) ?? 0);
  if (!Number.isSafeInteger(max + 1)) throw new Error("S\u1ED1 th\u1EE9 t\u1EF1 ch\u1EE9ng t\u1EEB v\u01B0\u1EE3t gi\u1EDBi h\u1EA1n.");
  return `${prefix}_${String(max + 1).padStart(3, "0")}_${documentDate(date)}`;
}
function documentNumberPatterns(prefix, date, legacyHead = `${prefix}_${date.replaceAll("-", "")}_`) {
  return [escapeLike(prefix) + "\\_%\\_" + documentDate(date), escapeLike(legacyHead) + "%"];
}
export {
  documentDate,
  documentNumberPatterns,
  documentSequence,
  nextDocumentNumber
};
